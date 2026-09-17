import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwAuth from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigwInt from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { RemovalPolicy, Duration } from "aws-cdk-lib";
import * as path from "path";

/**
 * VITALIS — all-serverless stack.
 *
 * Design notes (kept deliberately cheap for a ~$100 AWS credit budget):
 *  - Everything is pay-per-request: Lambda, DynamoDB (on-demand), API Gateway HTTP API,
 *    S3, EventBridge. Nothing here bills while idle.
 *  - No NAT Gateway, no RDS/Aurora, no Amazon Connect phone numbers (those have real
 *    per-hour / per-minute costs even at zero usage). Voice-calling and video-consult
 *    integrations are stubbed behind clean Lambda interfaces (see notifications/ and
 *    the workflow engine's "call_patient" action) so you can wire in Amazon Connect,
 *    Pinpoint, Chime SDK, or keep Twilio/ElevenLabs later without re-architecting.
 *  - Single-table DynamoDB design (see the README-ish comments atop each
 *    lambda/&lt;name&gt;/index.ts handler) to keep costs and infra surface minimal.
 *  - The no-code workflow graph is stored as JSON in DynamoDB and walked by a single
 *    "workflow-engine" Lambda triggered off EventBridge — not a static Step Functions
 *    state machine — because the graph shape is user-defined at runtime, not known
 *    at deploy time. Step Functions shines for fixed pipelines; here the graph itself
 *    is data. (Swap to Step Functions Distributed Map / dynamic parallel state later
 *    if you want built-in visual execution history in the AWS console.)
 */
export class VitalisStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------
    // 1. AUTH — Cognito User Pool with Doctor / Patient groups
    // ---------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, "VitalisUserPool", {
      userPoolName: "vitalis-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }), // "doctor" | "patient"
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY, // dev-friendly; switch to RETAIN before real launch
    });

    const userPoolClient = new cognito.UserPoolClient(this, "VitalisUserPoolClient", {
      userPool,
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
    });

    new cognito.CfnUserPoolGroup(this, "DoctorsGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "Doctors",
      description: "Clinicians who manage availability, patients, and workflows",
    });

    new cognito.CfnUserPoolGroup(this, "PatientsGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "Patients",
      description: "Patients who book appointments and attend consultations",
    });

    // ---------------------------------------------------------------------
    // 2. DATA — single-table DynamoDB design
    // ---------------------------------------------------------------------
    // PK / SK patterns (see each handler for exact keys):
    //   DOCTOR#<id>              / PROFILE                 -> doctor profile
    //   DOCTOR#<id>              / SLOT#<isoTimestamp>      -> availability slot
    //   PATIENT#<id>             / PROFILE                 -> patient profile
    //   PATIENT#<id>             / CONDITION#<id>          -> ICD-10 condition
    //   PATIENT#<id>             / MEDICATION#<id>         -> medication record
    //   APPT#<id>                / DETAILS                 -> appointment
    //   CONSULT#<apptId>         / MSG#<isoTimestamp>      -> chat message
    //   WORKFLOW#<id>            / DEFINITION              -> workflow graph JSON
    //   WORKFLOW#<id>            / RUN#<runId>             -> execution/audit log
    //   NOTIFICATION#<id>        / DETAILS
    // GSI1 (GSI1PK/GSI1SK) is used for reverse lookups, e.g. list all appointments
    // for a given patient, or all slots for a doctor within a date range.
    const table = new dynamodb.Table(this, "VitalisTable", {
      tableName: "vitalis-table",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false }, // flip on before production
    });

    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
    });

    // ---------------------------------------------------------------------
    // 3. STORAGE — S3 bucket for uploaded lab/medical-record PDFs
    // ---------------------------------------------------------------------
    const pdfBucket = new s3.Bucket(this, "VitalisPdfBucket", {
      bucketName: `vitalis-pdf-intake-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"], // tighten to your frontend domain before production
          allowedHeaders: ["*"],
        },
      ],
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // ---------------------------------------------------------------------
    // 4. EVENT BUS — workflow triggers (lab result received, appt missed, etc.)
    // ---------------------------------------------------------------------
    const workflowBus = new events.EventBus(this, "VitalisWorkflowBus", {
      eventBusName: "vitalis-workflow-bus",
    });

    // SNS topic used for outbound SMS (cheap, pay-per-message; stands in for the
    // "send SMS" workflow action). Swap/extend with Pinpoint or Connect later.
    const smsTopic = new sns.Topic(this, "VitalisSmsTopic", {
      topicName: "vitalis-patient-sms",
    });

    // ---------------------------------------------------------------------
    // 5. LAMBDA FUNCTIONS
    // ---------------------------------------------------------------------
    const commonEnv = {
      TABLE_NAME: table.tableName,
      PDF_BUCKET: pdfBucket.bucketName,
      WORKFLOW_BUS_NAME: workflowBus.eventBusName,
      SMS_TOPIC_ARN: smsTopic.topicArn,
    };

    const makeFn = (id: string, entry: string, extraEnv: Record<string, string> = {}) =>
      new nodejs.NodejsFunction(this, id, {
        entry: path.join(__dirname, "..", "lambda", entry),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 256,
        timeout: Duration.seconds(15),
        environment: { ...commonEnv, ...extraEnv },
        logRetention: logs.RetentionDays.ONE_WEEK,
        bundling: { minify: true, sourceMap: false },
      });

    const doctorsFn = makeFn("DoctorsFn", "doctors/index.ts");
    const patientsFn = makeFn("PatientsFn", "patients/index.ts");
    const appointmentsFn = makeFn("AppointmentsFn", "appointments/index.ts");
    const availabilityFn = makeFn("AvailabilityFn", "availability/index.ts");
    const notificationsFn = makeFn("NotificationsFn", "notifications/index.ts");
    const workflowEngineFn = makeFn("WorkflowEngineFn", "workflow-engine/index.ts", {
      NOTIFICATIONS_FN_NAME: "placeholder", // patched below after creation
    });
    const pdfIntakeFn = makeFn("PdfIntakeFn", "pdf-intake/index.ts");
    const uploadsFn = makeFn("UploadsFn", "uploads/index.ts");
    const workflowsFn = makeFn("WorkflowsFn", "workflows/index.ts");

    // Cognito post-confirmation trigger: self-signup users pick a role
    // (custom:role = "doctor" | "patient") but aren't added to the matching
    // Doctors/Patients group automatically — this Lambda does that so the
    // cognito:groups checks in lambda/patients/index.ts work for them too.
    const postConfirmationFn = makeFn("PostConfirmationFn", "post-confirmation/index.ts");

    // Grants
    for (const fn of [doctorsFn, patientsFn, appointmentsFn, availabilityFn, workflowEngineFn, pdfIntakeFn, workflowsFn, postConfirmationFn]) {
      table.grantReadWriteData(fn);
    }
    pdfBucket.grantRead(pdfIntakeFn);
    pdfBucket.grantPut(uploadsFn);
    pdfIntakeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["textract:AnalyzeDocument", "textract:DetectDocumentText"],
        resources: ["*"],
      })
    );
    workflowBus.grantPutEventsTo(pdfIntakeFn);
    workflowBus.grantPutEventsTo(appointmentsFn);
    smsTopic.grantPublish(notificationsFn);
    smsTopic.grantPublish(workflowEngineFn);
    workflowEngineFn.addEnvironment("NOTIFICATIONS_FN_NAME", notificationsFn.functionName);
    notificationsFn.grantInvoke(workflowEngineFn);

    // Resource is "*" rather than userPool.userPoolArn deliberately: CDK
    // always makes a Function's CfnFunction resource depend on its role's
    // attached policies (so IAM permissions are in place before the function
    // can be invoked). Scoping this statement to the pool's own ARN would
    // make that policy depend on the UserPool, while the UserPool already
    // depends on this same function (as its post-confirmation trigger) —
    // a real cycle CloudFormation rejects at deploy time. The action is
    // narrow (AdminAddUserToGroup only) and this function's own code is the
    // only thing that decides which pool/user/group to call it with, so the
    // wildcard resource doesn't meaningfully widen what this Lambda can do.
    postConfirmationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminAddUserToGroup"],
        resources: ["*"],
      })
    );
    userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFn);

    // S3 -> Lambda trigger: new PDF uploaded -> extract via Textract
    pdfBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(pdfIntakeFn)
    );

    // EventBridge -> workflow engine: any "vitalis.triggers" event runs the graph walker
    new events.Rule(this, "WorkflowTriggerRule", {
      eventBus: workflowBus,
      eventPattern: { source: ["vitalis.triggers"] },
      targets: [new targets.LambdaFunction(workflowEngineFn)],
    });

    // ---------------------------------------------------------------------
    // 6. API GATEWAY — HTTP API, Cognito-authorized
    // ---------------------------------------------------------------------
    const authorizer = new apigwAuth.HttpUserPoolAuthorizer(
      "VitalisAuthorizer",
      userPool,
      { userPoolClients: [userPoolClient] }
    );

    const httpApi = new apigwv2.HttpApi(this, "VitalisHttpApi", {
      apiName: "vitalis-api",
      corsPreflight: {
        allowHeaders: ["Authorization", "Content-Type"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["*"], // tighten before production
      },
    });

    const addRoute = (
      path_: string,
      methods: apigwv2.HttpMethod[],
      fn: lambda.IFunction,
      authorize = true
    ) => {
      httpApi.addRoutes({
        path: path_,
        methods,
        integration: new apigwInt.HttpLambdaIntegration(`${path_}-int-${methods.join("")}`, fn),
        authorizer: authorize ? authorizer : undefined,
      });
    };

    // Doctors + availability (public read for directory, auth for writes handled inside handler)
    addRoute("/doctors", [apigwv2.HttpMethod.GET], doctorsFn, false);
    addRoute("/doctors/{id}", [apigwv2.HttpMethod.GET], doctorsFn, false);
    addRoute("/doctors/{id}", [apigwv2.HttpMethod.PUT], doctorsFn, true);
    addRoute("/doctors/{id}/availability", [apigwv2.HttpMethod.GET], availabilityFn, false);
    addRoute("/doctors/{id}/availability", [apigwv2.HttpMethod.POST], availabilityFn, true);
    addRoute("/doctors/{id}/availability/{slotId}", [apigwv2.HttpMethod.DELETE], availabilityFn, true);

    // Patients
    addRoute("/patients/{id}", [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT], patientsFn, true);
    addRoute("/patients/{id}/conditions", [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], patientsFn, true);
    addRoute("/patients/{id}/medications", [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], patientsFn, true);

    // Appointments (booking, reschedule, cancel)
    addRoute("/appointments", [apigwv2.HttpMethod.POST], appointmentsFn, true);
    addRoute("/appointments/{id}", [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE], appointmentsFn, true);
    addRoute("/patients/{id}/appointments", [apigwv2.HttpMethod.GET], appointmentsFn, true);
    addRoute("/doctors/{id}/appointments", [apigwv2.HttpMethod.GET], appointmentsFn, true);

    // Presigned S3 URL for browser-side lab PDF upload
    addRoute("/uploads/lab-pdf", [apigwv2.HttpMethod.POST], uploadsFn, true);

    // Workflow automation CRUD (workflow-engine executes these; this is how doctors
    // create/edit them)
    addRoute("/workflows", [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], workflowsFn, true);
    addRoute("/workflows/{id}", [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE], workflowsFn, true);
    addRoute("/workflows/{id}/runs", [apigwv2.HttpMethod.GET], workflowsFn, true);

    // ---------------------------------------------------------------------
    // 7. OUTPUTS
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "PdfBucketName", { value: pdfBucket.bucketName });
    new cdk.CfnOutput(this, "WorkflowBusName", { value: workflowBus.eventBusName });
  }
}
