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
import * as connect from "aws-cdk-lib/aws-connect";
import * as lex from "aws-cdk-lib/aws-lex";
import * as cr from "aws-cdk-lib/custom-resources";
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

    const oauthRedirectUrl = this.node.tryGetContext("oauthRedirectUrl") as string | undefined;
    const googleClientId = this.node.tryGetContext("googleClientId") as string | undefined;
    const googleClientSecret = this.node.tryGetContext("googleClientSecret") as string | undefined;
    const googleEnabled = Boolean(oauthRedirectUrl && googleClientId && googleClientSecret);
    if ([oauthRedirectUrl, googleClientId, googleClientSecret].some(Boolean) && !googleEnabled) {
      throw new Error("Google sign-in needs oauthRedirectUrl, googleClientId, and googleClientSecret CDK context values.");
    }

    const cognitoDomainPrefix = `vitalis-${this.account}-${this.region}`;
    userPool.addDomain("HostedUiDomain", { cognitoDomain: { domainPrefix: cognitoDomainPrefix } });

    const userPoolClient = new cognito.UserPoolClient(this, "VitalisUserPoolClient", {
      userPool,
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
      supportedIdentityProviders: googleEnabled
        ? [cognito.UserPoolClientIdentityProvider.COGNITO, cognito.UserPoolClientIdentityProvider.GOOGLE]
        : [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: googleEnabled
        ? {
            callbackUrls: [oauthRedirectUrl!],
            logoutUrls: [oauthRedirectUrl!],
            flows: { implicitCodeGrant: true },
            scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
          }
        : undefined,
    });

    if (googleEnabled) {
      const googleProvider = new cognito.CfnUserPoolIdentityProvider(this, "GoogleIdentityProvider", {
        userPoolId: userPool.userPoolId,
        providerName: "Google",
        providerType: "Google",
        providerDetails: {
          client_id: googleClientId!,
          client_secret: googleClientSecret!,
          authorize_scopes: "openid email profile",
        },
        attributeMapping: {
          email: "email",
          given_name: "given_name",
          family_name: "family_name",
        },
      });
      userPoolClient.node.addDependency(googleProvider);
    }

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
    //   PRESCRIPTION#<id>        / DETAILS                 -> prescription record, either
    //                                                          type "pdf" (doctor-uploaded scan) or
    //                                                          "digital" (structured diagnosis/notes/
    //                                                          medications issued directly). GSI1PK
    //                                                          APPT_PRESCRIPTION#<appointmentId> for
    //                                                          appointment-scoped lookup either way.
    //   PRESCRIPTION#<id>        / PATIENT_INDEX            -> pointer item, GSI1PK
    //                                                          PATIENT_PRESCRIPTIONS#<patientId>, for
    //                                                          a patient's full prescription list
    //   PRESCRIPTION#<id>        / DOCTOR_INDEX             -> pointer item, GSI1PK
    //                                                          DOCTOR_PRESCRIPTIONS#<doctorId>, for
    //                                                          a doctor's issued-prescription list
    //   APPT#<id>                / EVENT_MARKER#prescription_uploaded -> idempotency marker,
    //                                                          written once via a conditional
    //                                                          PutCommand so the "prescription_uploaded"
    //                                                          workflow event fires exactly once
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
    const prescriptionsFn = makeFn("PrescriptionsFn", "prescriptions/index.ts");

    // Cognito post-confirmation trigger: self-signup users pick a role
    // (custom:role = "doctor" | "patient") but aren't added to the matching
    // Doctors/Patients group automatically — this Lambda does that so the
    // cognito:groups checks in lambda/patients/index.ts work for them too.
    const postConfirmationFn = makeFn("PostConfirmationFn", "post-confirmation/index.ts");

    // Grants
    for (const fn of [doctorsFn, patientsFn, appointmentsFn, availabilityFn, workflowEngineFn, pdfIntakeFn, workflowsFn, postConfirmationFn, prescriptionsFn]) {
      table.grantReadWriteData(fn);
    }
    pdfBucket.grantRead(pdfIntakeFn);
    pdfBucket.grantPut(uploadsFn);
    pdfBucket.grantReadWrite(prescriptionsFn);
    workflowBus.grantPutEventsTo(prescriptionsFn);
    // Digital-prescription features: Amazon Polly reads a prescription aloud
    // (optionally translated first), Amazon Translate renders it in another
    // language. Neither action supports resource-level ARN scoping in IAM.
    prescriptionsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["polly:SynthesizeSpeech", "translate:TranslateText"],
        resources: ["*"],
      })
    );
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
    // 5b. AUTOMATED FOLLOW-UP CALLS — Amazon Connect + Lex V2, Amazon Chime
    //     SDK Voice + Lex V2, or Twilio Voice + Gemini (three interchangeable
    //     providers selected at deploy time — see CALL_PROVIDER below)
    // ---------------------------------------------------------------------
    // New DynamoDB item shapes used only by this feature (same single table):
    //   FOLLOWUP_CALL#<id>  / DETAILS          -> call record (status, ids, GSI1PK
    //                                              APPT_FOLLOWUP#<appointmentId> for
    //                                              one-active-call-per-appointment lookup).
    //                                              Twilio-only fields: provider,
    //                                              twilioCallSid, conversationState,
    //                                              offeredSlots, outcome, answeredAt,
    //                                              endedAt, duration (see
    //                                              lambda/twilio-voice and the small
    //                                              extension in lambda/_shared/callAudit.ts)
    //   FOLLOWUP_CALL#<id>  / EVENT#<ts>#<name> -> append-only audit trail (see
    //                                              lambda/_shared/callAudit.ts for the
    //                                              exact allowed event names)
    //   FOLLOWUP_CALL#<id>  / DOCTOR_INDEX      -> pointer item, GSI1PK
    //                                              DOCTOR_FOLLOWUPS#<doctorId>, for a
    //                                              doctor's full call-history list
    //   NOTIFICATION#<id>   / DETAILS          -> reused for doctor in-app notifications,
    //                                              with GSI1PK DOCTOR_NOTIFICATIONS#<doctorId>
    //
    // See README.md "Automated follow-up calls" for the full manual Connect/Lex
    // console checklist this stack alone can't complete (claiming a phone number,
    // building+publishing the Lex bot version, associating the bot with the
    // Connect instance, and authoring the Lex "get customer input" block inside
    // the contact flow — none of which CloudFormation's Connect/Lex L1s support
    // end-to-end; see the comments below for exactly where each gap is).

    const fetchPatientContextFn = makeFn("FetchPatientContextFn", "fetch-patient-context/index.ts");
    const getNextSlotsFn = makeFn("GetNextSlotsFn", "get-next-slots/index.ts");
    const reserveSlotFn = makeFn("ReserveSlotAndScheduleFn", "reserve-slot-and-schedule/index.ts");
    const notifyDoctorFn = makeFn("NotifyDoctorFn", "notify-doctor/index.ts");
    const outboundCallInitiatorFn = makeFn("OutboundCallInitiatorFn", "outbound-call-initiator/index.ts", {
      // Filled in below once the Connect instance/contact flow exist.
      CONNECT_INSTANCE_ID: "placeholder",
      CONNECT_CONTACT_FLOW_ID: "placeholder",
    });
    const followUpCallsFn = makeFn("FollowUpCallsFn", "follow-up-calls/index.ts");
    const lexFulfillmentFn = makeFn("LexFulfillmentFn", "lex-fulfillment/index.ts", {
      NOTIFY_DOCTOR_FN_NAME: notifyDoctorFn.functionName,
      GET_NEXT_SLOTS_FN_NAME: getNextSlotsFn.functionName,
    });

    for (const fn of [
      fetchPatientContextFn,
      getNextSlotsFn,
      reserveSlotFn,
      notifyDoctorFn,
      outboundCallInitiatorFn,
      followUpCallsFn,
      lexFulfillmentFn,
    ]) {
      table.grantReadWriteData(fn);
    }
    notifyDoctorFn.grantInvoke(lexFulfillmentFn);
    getNextSlotsFn.grantInvoke(lexFulfillmentFn);
    reserveSlotFn.grantInvoke(lexFulfillmentFn);
    outboundCallInitiatorFn.grantInvoke(workflowEngineFn);
    workflowEngineFn.addEnvironment("OUTBOUND_CALL_INITIATOR_FN_NAME", outboundCallInitiatorFn.functionName);

    // Connect needs explicit permission to invoke StartOutboundVoiceContact,
    // and to invoke the Lambdas used as contact-flow "Invoke AWS Lambda"
    // blocks (fetch-patient-context). Resource is "*" for the Connect action
    // because the instance ARN isn't known until CfnInstance below exists in
    // the same stack and — same cyclic-dependency shape as the Cognito
    // post-confirmation trigger above — scoping it would create a dependency
    // cycle; the action itself is narrow.
    outboundCallInitiatorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["connect:StartOutboundVoiceContact"],
        resources: ["*"],
      })
    );

    // ---------------------------------------------------------------------
    // Amazon Connect + Lex V2 are gated behind a context flag because some
    // AWS account types (e.g. AISPL — the India-billed AWS reseller entity)
    // are blocked from creating Amazon Connect instances entirely, in every
    // region, until the account's billing relationship is migrated to a
    // standard AWS Inc. account (an AWS Support/billing action, not
    // something CDK/CloudFormation can route around). Deploy with
    // `-c enableConnectLex=true` once that's sorted out; until then this
    // whole block (and the automated voice call feature end-to-end) is
    // skipped, and outboundCallInitiatorFn keeps its placeholder env vars
    // set above, so `POST /appointments/{id}/follow-up-call` and the
    // workflow engine's `call_patient` action will fail cleanly (a caught
    // Connect API error) rather than the stack failing to deploy.
    // ---------------------------------------------------------------------
    const enableConnectLex = this.node.tryGetContext("enableConnectLex") === true
      || this.node.tryGetContext("enableConnectLex") === "true";

    // ---------------------------------------------------------------------
    // Amazon Chime SDK Voice is a second, independent way to place the
    // follow-up call, alongside Connect above. It exists because this AWS
    // account is billed through AISPL (the India-billed reseller entity),
    // and AISPL accounts are blocked from creating Amazon Connect instances
    // entirely, in every region, until the account's billing relationship is
    // migrated to a standard AWS Inc. account — confirmed by an actual
    // deploy attempt, not assumed:
    //   "You're signed in with an AWS account that was provided by AISPL.
    //    These accounts cannot create Amazon Connect instances."
    // Deploy with `-c enableChimeVoice=true` to use this path instead of (or
    // alongside) `-c enableConnectLex=true`. Both share the same Lex bot
    // below — the follow-up conversation script (lambda/lex-fulfillment)
    // doesn't know or care which telephony service started it.
    // ---------------------------------------------------------------------
    const enableChimeVoice = this.node.tryGetContext("enableChimeVoice") === true
      || this.node.tryGetContext("enableChimeVoice") === "true";

    // ---------------------------------------------------------------------
    // Twilio Voice + Gemini is a THIRD, fully independent way to place the
    // follow-up call — it needs none of the Lex bot / Connect instance /
    // Chime SMA plumbing above (see the standalone block further down, after
    // httpApi exists). It sidesteps the AISPL/Connect billing block via a
    // completely different mechanism: Twilio doesn't care what kind of AWS
    // account is behind it. Deploy with `-c enableTwilioVoice=true
    // -c twilioAccountSid=... -c twilioAuthToken=... -c twilioPhoneNumber=...
    // -c geminiApiKey=...` (same "CDK context, not Secrets Manager" pattern
    // already used for Google OAuth's client id/secret above).
    // ---------------------------------------------------------------------
    const enableTwilioVoice = this.node.tryGetContext("enableTwilioVoice") === true
      || this.node.tryGetContext("enableTwilioVoice") === "true";
    const twilioAccountSid = this.node.tryGetContext("twilioAccountSid") as string | undefined;
    const twilioAuthToken = this.node.tryGetContext("twilioAuthToken") as string | undefined;
    const twilioPhoneNumber = this.node.tryGetContext("twilioPhoneNumber") as string | undefined;
    const geminiApiKey = this.node.tryGetContext("geminiApiKey") as string | undefined;
    if (enableTwilioVoice && !(twilioAccountSid && twilioAuthToken && twilioPhoneNumber && geminiApiKey)) {
      throw new Error(
        "enableTwilioVoice needs twilioAccountSid, twilioAuthToken, twilioPhoneNumber, and geminiApiKey CDK context values."
      );
    }

    // Which provider outboundCallInitiatorFn actually dials with, when more
    // than one is enabled at once. An explicit `-c callProvider=...` picks;
    // otherwise exactly one enabled provider is required — never guessed.
    const enabledCallProviders = [
      enableConnectLex && "connect",
      enableChimeVoice && "chime",
      enableTwilioVoice && "twilio",
    ].filter((p): p is string => Boolean(p));
    const callProviderOverride = this.node.tryGetContext("callProvider") as string | undefined;
    if (callProviderOverride && !enabledCallProviders.includes(callProviderOverride)) {
      throw new Error(`callProvider=${callProviderOverride} isn't one of the enabled providers: ${enabledCallProviders.join(", ") || "(none)"}`);
    }
    if (!callProviderOverride && enabledCallProviders.length > 1) {
      throw new Error(
        `Multiple call providers enabled (${enabledCallProviders.join(", ")}) — pass -c callProvider=connect|chime|twilio to pick one.`
      );
    }
    const resolvedCallProvider = callProviderOverride ?? enabledCallProviders[0];

    // ---------------------------------------------------------------------
    // Lex V2 bot — CfnBot (module is aws-cdk-lib/aws-lex; despite the name,
    // AWS::Lex::Bot IS the Lex V2 resource type — "aws-lexv2bot" does not
    // exist as a separate CDK module in this aws-cdk-lib version, confirmed
    // against the installed type defs before writing this). Five custom
    // intents map to script steps C-G; FallbackIntent (step H) is Lex's
    // built-in AMAZON.FallbackIntent, configured rather than declared, since
    // Lex V2 auto-provisions it for every bot locale and CfnBot's `intents`
    // array is for custom intents only.
    //
    // Shared by both telephony backends (hence gated on either flag, not
    // just enableConnectLex) — this bot and lexFulfillmentFn are the entire
    // conversation; only how a call reaches them differs.
    // ---------------------------------------------------------------------
    if (enableConnectLex || enableChimeVoice) {
    const lexRole = new iam.Role(this, "VitalisLexBotRole", {
      assumedBy: new iam.ServicePrincipal("lexv2.amazonaws.com"),
    });
    lexRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["polly:SynthesizeSpeech"],
        resources: ["*"],
      })
    );

    const utterances = (...texts: string[]) => texts.map((utterance) => ({ utterance }));
    // Every intent below routes to lexFulfillmentFn for both dialog
    // management and fulfillment (matches that Lambda's own doc comment —
    // "Lex V2 code-hook Lambda (DialogCodeHook + FulfillmentCodeHook)" — which
    // the intent definitions never actually set until this fix; without it,
    // the alias-level codeHookSpecification below only *authorizes* the
    // Lambda, it doesn't route any specific intent's turns to it).
    const codeHooks = {
      dialogCodeHook: { enabled: true },
      fulfillmentCodeHook: { enabled: true },
    };

    const followUpBot = new lex.CfnBot(this, "VitalisFollowUpBot", {
      name: "vitalis-follow-up-call-bot",
      // NOTE: aws-cdk-lib's generated CfnBot maps `dataPrivacy` through the
      // generic (untyped) objectToCloudFormation() helper rather than the
      // camelCase->PascalCase DataPrivacyProperty mapper used elsewhere in
      // this file, so the raw CloudFormation key (`ChildDirected`, not
      // `childDirected`) must be used here or the deploy fails with
      // "Required property [ChildDirected] not found".
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      roleArn: lexRole.roleArn,
      autoBuildBotLocales: true,
      botLocales: [
        {
          localeId: "en_US",
          nluConfidenceThreshold: 0.4,
          intents: [
            {
              name: "PatientIsFine",
              sampleUtterances: utterances("I'm fine", "I'm feeling better", "No problems", "All good", "Feeling great"),
              ...codeHooks,
            },
            {
              name: "ProblemPersists",
              sampleUtterances: utterances(
                "It still hurts",
                "The problem persists",
                "I'm not feeling better",
                "Still having symptoms",
                "It hasn't gone away"
              ),
              ...codeHooks,
            },
            {
              name: "ScheduleFollowUp",
              sampleUtterances: utterances("Yes please", "Yes schedule it", "That would help", "Book an appointment", "Yes"),
              ...codeHooks,
            },
            {
              name: "DeclineFollowUp",
              sampleUtterances: utterances("No thanks", "Not right now", "No", "I'll contact the clinic myself"),
              ...codeHooks,
            },
            {
              name: "EmergencySymptoms",
              sampleUtterances: utterances(
                "I can't breathe",
                "I have severe chest pain",
                "This is an emergency",
                "I think I need an ambulance",
                "I'm bleeding a lot"
              ),
              ...codeHooks,
            },
            // Lex V2's CloudFormation import (unlike the console/API bot-build
            // flow) requires every locale to explicitly declare its fallback
            // intent — omitting it fails the whole bot import with "Locale
            // 'en_US' ... doesn't contain a fallback intent" (confirmed via a
            // real deploy attempt, not assumed). No sampleUtterances: Lex
            // reserves AMAZON.FallbackIntent as the catch-all for anything
            // that doesn't match another intent, so it can't declare its own.
            {
              name: "FallbackIntent",
              parentIntentSignature: "AMAZON.FallbackIntent",
              ...codeHooks,
            },
          ],
        },
      ],
      // Used for console "Test bot" only. Production traffic uses the
      // published BotAlias below.
      testBotAliasSettings: {
        botAliasLocaleSettings: [
          {
            localeId: "en_US",
            botAliasLocaleSetting: {
              enabled: true,
              codeHookSpecification: {
                lambdaCodeHook: {
                  lambdaArn: lexFulfillmentFn.functionArn,
                  codeHookInterfaceVersion: "1.0",
                },
              },
            },
          },
        ],
      },
    });

    lexFulfillmentFn.addPermission("AllowLexInvoke", {
      principal: new iam.ServicePrincipal("lexv2.amazonaws.com"),
      sourceArn: followUpBot.attrArn,
    });

    const followUpBotVersion = new lex.CfnBotVersion(this, "VitalisFollowUpBotVersion", {
      botId: followUpBot.attrId,
      botVersionLocaleSpecification: [
        {
          localeId: "en_US",
          botVersionLocaleDetails: { sourceBotVersion: "DRAFT" },
        },
      ],
    });

    const followUpBotAlias = new lex.CfnBotAlias(this, "VitalisFollowUpBotAlias", {
      botId: followUpBot.attrId,
      botAliasName: "prod",
      botVersion: followUpBotVersion.attrBotVersion,
      botAliasLocaleSettings: [
        {
          localeId: "en_US",
          botAliasLocaleSetting: {
            enabled: true,
            codeHookSpecification: {
              lambdaCodeHook: {
                lambdaArn: lexFulfillmentFn.functionArn,
                codeHookInterfaceVersion: "1.0",
              },
            },
          },
        },
      ],
    });
    lexFulfillmentFn.addPermission("AllowLexAliasInvoke", {
      principal: new iam.ServicePrincipal("lexv2.amazonaws.com"),
      sourceArn: followUpBotAlias.attrArn,
    });

    new cdk.CfnOutput(this, "LexFollowUpBotId", { value: followUpBot.attrId });
    new cdk.CfnOutput(this, "LexFollowUpBotAliasId", { value: followUpBotAlias.attrBotAliasId });

    // -----------------------------------------------------------------
    // Amazon Connect instance — CfnInstance. Kept behind its own flag
    // (rather than deleted) in case this account's AISPL billing is ever
    // migrated: at that point `-c enableConnectLex=true` alone brings this
    // path back with no code changes.
    // -----------------------------------------------------------------
    if (enableConnectLex) {
    const connectInstance = new connect.CfnInstance(this, "VitalisConnectInstance", {
      identityManagementType: "CONNECT_MANAGED",
      instanceAlias: `vitalis-${this.account}-${this.region}`,
      attributes: {
        inboundCalls: true,
        outboundCalls: true,
        contactflowLogs: true,
      },
    });

    fetchPatientContextFn.addPermission("AllowConnectInvoke", {
      principal: new iam.ServicePrincipal("connect.amazonaws.com"),
      sourceArn: connectInstance.attrArn,
    });

    // ---------------------------------------------------------------------
    // Contact flow — CfnContactFlow DOES support content-as-code (confirmed:
    // the `content` prop is a plain string of Connect Flow Language JSON).
    // What's below is a minimal, real flow: greet -> invoke
    // fetch-patient-context for server-side context -> disconnect. It does
    // NOT include the "Get customer input (Amazon Lex)" block that transfers
    // the live conversation to followUpBotAlias — Connect Flow Language's
    // Lex V2 block references the bot by an ARN that also needs the
    // connect:AssociateBot association (not a CloudFormation-managed
    // resource; see README manual step 4) to actually be selectable, and
    // hand-authoring that block's JSON blind (vs. exporting it from the
    // visual designer after the association exists) risks shipping a flow
    // that LOOKS complete but silently fails at runtime — so it's called
    // out as a manual console edit instead of guessed at here. (This gap is
    // exactly what the enableChimeVoice path below closes: Chime's
    // StartBotConversation action references the bot alias directly from
    // Lambda-returned call-control actions, with no separate association
    // resource needed.)
    // ---------------------------------------------------------------------
    const contactFlowContent = {
      Version: "2019-10-30",
      StartAction: "invoke-context",
      Actions: [
        {
          Identifier: "invoke-context",
          Type: "InvokeLambdaFunction",
          Parameters: { LambdaFunctionARN: fetchPatientContextFn.functionArn },
          Transitions: { NextAction: "disconnect", Errors: [{ NextAction: "disconnect", ErrorType: "NoMatchingError" }] },
        },
        {
          Identifier: "disconnect",
          Type: "DisconnectParticipant",
          Parameters: {},
          Transitions: {},
        },
      ],
    };

    const contactFlow = new connect.CfnContactFlow(this, "VitalisFollowUpContactFlow", {
      instanceArn: connectInstance.attrArn,
      name: "vitalis-follow-up-call",
      type: "CONTACT_FLOW",
      content: JSON.stringify(contactFlowContent),
    });

    if (resolvedCallProvider === "connect") outboundCallInitiatorFn.addEnvironment("CALL_PROVIDER", "connect");
    outboundCallInitiatorFn.addEnvironment("CONNECT_INSTANCE_ID", connectInstance.attrId);
    outboundCallInitiatorFn.addEnvironment("CONNECT_CONTACT_FLOW_ID", contactFlow.attrContactFlowArn);

    // Outbound calls need a source number, and claiming one is a real,
    // recurring monthly charge (unlike everything else in this stack) — so
    // CDK never claims it automatically. Claim it yourself (AWS Console:
    // Connect > Phone numbers, or `aws connect claim-phone-number`) and pass
    // it in explicitly with `-c connectSourcePhoneNumber=+1XXXXXXXXXX`; until
    // then this stays unset and calls fail fast with a clear Connect error
    // instead of a surprise line item.
    const connectSourcePhoneNumber = this.node.tryGetContext("connectSourcePhoneNumber");
    if (connectSourcePhoneNumber) {
      outboundCallInitiatorFn.addEnvironment("CONNECT_SOURCE_PHONE_NUMBER", connectSourcePhoneNumber);
    }

    new cdk.CfnOutput(this, "ConnectInstanceId", { value: connectInstance.attrId });
    new cdk.CfnOutput(this, "ConnectInstanceArn", { value: connectInstance.attrArn });
    new cdk.CfnOutput(this, "FollowUpContactFlowArn", { value: contactFlow.attrContactFlowArn });
    } // end if (enableConnectLex)

    // -----------------------------------------------------------------
    // Amazon Chime SDK Voice (PSTN Audio) — the AISPL-compatible path.
    //
    // Chime SDK Voice's outbound-calling resources (SIP media applications)
    // have NO native CloudFormation resource type in this aws-cdk-lib
    // version — confirmed empirically against the installed package (no
    // AWS::ChimeSDKVoice::* type exists anywhere in it, unlike Connect and
    // Lex which are both natively supported above). A small purpose-built
    // custom resource (lambda/chime-sma-provisioner) fills that one gap;
    // everything else here is native CDK/IAM.
    // -----------------------------------------------------------------
    if (enableChimeVoice) {
    const chimeSmaHandlerFn = makeFn("ChimeSmaHandlerFn", "chime-sma-handler/index.ts", {
      FETCH_PATIENT_CONTEXT_FN_NAME: fetchPatientContextFn.functionName,
      LEX_BOT_ALIAS_ARN: followUpBotAlias.attrArn,
    });
    table.grantReadWriteData(chimeSmaHandlerFn);
    fetchPatientContextFn.grantInvoke(chimeSmaHandlerFn);

    // Chime SDK Voice needs permission to invoke this Lambda for every call
    // state change. sourceAccount-only (no sourceArn) is deliberate: scoping
    // to the SIP media application's ARN would create a dependency cycle
    // identical to the Connect/Cognito ones noted elsewhere in this file —
    // the SMA (created just below) needs this Lambda's ARN to exist first.
    chimeSmaHandlerFn.addPermission("AllowChimeVoiceInvoke", {
      principal: new iam.ServicePrincipal("voiceconnector.chime.amazonaws.com"),
      sourceAccount: this.account,
    });

    const chimeSmaProvisionerFn = makeFn("ChimeSmaProvisionerFn", "chime-sma-provisioner/index.ts");
    chimeSmaProvisionerFn.addToRolePolicy(
      new iam.PolicyStatement({
        // Resources are "*" because the SIP media application doesn't exist
        // yet at policy-grant time (same chicken-and-egg reasoning as every
        // other "*" resource statement in this file) and because Chime SDK
        // Voice's create/update/delete actions for this resource type don't
        // support resource-level ARN scoping in IAM.
        // The IAM action namespace for this service is "chime:", not
        // "chime-sdk-voice:" (the SDK package/client name) — confirmed by an
        // actual AccessDenied error naming the action exactly, not assumed.
        actions: [
          "chime:CreateSipMediaApplication",
          "chime:UpdateSipMediaApplication",
          "chime:DeleteSipMediaApplication",
        ],
        resources: ["*"],
      })
    );

    const chimeSmaProvider = new cr.Provider(this, "ChimeSmaProvider", {
      onEventHandler: chimeSmaProvisionerFn,
    });

    const chimeSma = new cdk.CustomResource(this, "ChimeSmaResource", {
      serviceToken: chimeSmaProvider.serviceToken,
      properties: {
        Region: this.region,
        Name: "vitalis-follow-up-sma",
        LambdaArn: chimeSmaHandlerFn.functionArn,
      },
    });

    // Chime SDK Voice needs explicit permission to start a conversation with
    // this Lex bot alias on the caller's behalf — the resource-policy
    // equivalent of Connect's connect:AssociateBot, but natively
    // CloudFormation-manageable via AWS::Lex::ResourcePolicy (no manual
    // console step required, unlike the Connect path above).
    new lex.CfnResourcePolicy(this, "VitalisFollowUpBotChimePolicy", {
      resourceArn: followUpBotAlias.attrArn,
      policy: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "voiceconnector.chime.amazonaws.com" },
            Action: "lex:StartConversation",
            Resource: followUpBotAlias.attrArn,
            Condition: {
              StringEquals: { "AWS:SourceAccount": this.account },
              ArnLike: { "AWS:SourceArn": chimeSma.getAttString("SipMediaApplicationArn") },
            },
          },
        ],
      },
    });

    if (resolvedCallProvider === "chime") outboundCallInitiatorFn.addEnvironment("CALL_PROVIDER", "chime");
    outboundCallInitiatorFn.addEnvironment("CHIME_SIP_MEDIA_APPLICATION_ID", chimeSma.getAttString("SipMediaApplicationId"));
    outboundCallInitiatorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["chime:CreateSipMediaApplicationCall"],
        resources: ["*"],
      })
    );

    // Same real, recurring-monthly-charge situation as Connect's source
    // number (see connectSourcePhoneNumber above) — CDK never claims this
    // automatically. Claim one in the Chime SDK Voice console (or
    // `aws chime-sdk-voice create-phone-number-order`) and pass it in with
    // `-c chimeSourcePhoneNumber=+1XXXXXXXXXX`; until then this stays unset
    // and calls fail fast with a clear Chime error instead of a surprise
    // line item.
    const chimeSourcePhoneNumber = this.node.tryGetContext("chimeSourcePhoneNumber");
    if (chimeSourcePhoneNumber) {
      outboundCallInitiatorFn.addEnvironment("CHIME_SOURCE_PHONE_NUMBER", chimeSourcePhoneNumber);
    }

    new cdk.CfnOutput(this, "ChimeSipMediaApplicationId", { value: chimeSma.getAttString("SipMediaApplicationId") });
    } // end if (enableChimeVoice)
    } // end if (enableConnectLex || enableChimeVoice)

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

    // ---------------------------------------------------------------------
    // Twilio Voice + Gemini follow-up calls — structurally independent of
    // the enableConnectLex/enableChimeVoice block above (no Lex bot/Connect
    // instance/Chime SMA needed), but placed here rather than with them
    // because it needs httpApi.apiEndpoint for its own webhook URLs.
    // ---------------------------------------------------------------------
    if (enableTwilioVoice) {
      const twilioVoiceFn = makeFn("TwilioVoiceFn", "twilio-voice/index.ts", {
        TWILIO_ACCOUNT_SID: twilioAccountSid as string,
        TWILIO_AUTH_TOKEN: twilioAuthToken as string,
        GEMINI_API_KEY: geminiApiKey as string,
        PUBLIC_API_BASE_URL: httpApi.apiEndpoint,
        NOTIFY_DOCTOR_FN_NAME: notifyDoctorFn.functionName,
        GET_NEXT_SLOTS_FN_NAME: getNextSlotsFn.functionName,
        RESERVE_SLOT_AND_SCHEDULE_FN_NAME: reserveSlotFn.functionName,
        FETCH_PATIENT_CONTEXT_FN_NAME: fetchPatientContextFn.functionName,
      });
      table.grantReadWriteData(twilioVoiceFn);
      notifyDoctorFn.grantInvoke(twilioVoiceFn);
      getNextSlotsFn.grantInvoke(twilioVoiceFn);
      reserveSlotFn.grantInvoke(twilioVoiceFn);
      fetchPatientContextFn.grantInvoke(twilioVoiceFn);

      // Twilio calls these directly — no Cognito JWT, so unauthenticated.
      // Protected instead by X-Twilio-Signature validation inside the
      // handler (see lambda/twilio-voice/index.ts).
      addRoute("/follow-up-calls/twilio/answer", [apigwv2.HttpMethod.POST], twilioVoiceFn, false);
      addRoute("/follow-up-calls/twilio/input", [apigwv2.HttpMethod.POST], twilioVoiceFn, false);
      addRoute("/follow-up-calls/twilio/status", [apigwv2.HttpMethod.POST], twilioVoiceFn, false);

      if (resolvedCallProvider === "twilio") {
        outboundCallInitiatorFn.addEnvironment("CALL_PROVIDER", "twilio");
        outboundCallInitiatorFn.addEnvironment("TWILIO_ACCOUNT_SID", twilioAccountSid as string);
        outboundCallInitiatorFn.addEnvironment("TWILIO_AUTH_TOKEN", twilioAuthToken as string);
        outboundCallInitiatorFn.addEnvironment("TWILIO_PHONE_NUMBER", twilioPhoneNumber as string);
        outboundCallInitiatorFn.addEnvironment("PUBLIC_API_BASE_URL", httpApi.apiEndpoint);
      }
    }

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

    // Prescriptions: PDF upload (doctor-only presign/confirm), digital issuance
    // (structured diagnosis/notes/medications, no file), and read routes. Audio
    // (Polly) and translate (Translate) are doctor- or patient-readable
    // sub-actions on a single prescription; see lambda/prescriptions for the
    // full route table and the "who can call what" auth rules.
    addRoute("/prescriptions/presign", [apigwv2.HttpMethod.POST], prescriptionsFn, true);
    addRoute("/prescriptions/confirm", [apigwv2.HttpMethod.POST], prescriptionsFn, true);
    addRoute("/prescriptions", [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], prescriptionsFn, true);
    addRoute("/prescriptions/{id}", [apigwv2.HttpMethod.GET], prescriptionsFn, true);
    addRoute("/prescriptions/{id}/download", [apigwv2.HttpMethod.GET], prescriptionsFn, true);
    addRoute("/prescriptions/{id}/audio", [apigwv2.HttpMethod.POST], prescriptionsFn, true);
    addRoute("/prescriptions/{id}/translate", [apigwv2.HttpMethod.POST], prescriptionsFn, true);
    addRoute("/patients/{id}/prescriptions", [apigwv2.HttpMethod.GET], prescriptionsFn, true);
    addRoute("/doctors/{id}/prescriptions", [apigwv2.HttpMethod.GET], prescriptionsFn, true);

    // Automated follow-up calls: doctor's manual "Start follow-up call" test
    // button, and reading back call status/audit timeline.
    addRoute("/appointments/{id}/follow-up-call", [apigwv2.HttpMethod.POST], outboundCallInitiatorFn, true);
    addRoute("/follow-up-calls", [apigwv2.HttpMethod.GET], followUpCallsFn, true);
    addRoute("/doctors/{id}/notifications", [apigwv2.HttpMethod.GET], notificationsFn, true);

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
    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `${cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
    });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "PdfBucketName", { value: pdfBucket.bucketName });
    new cdk.CfnOutput(this, "WorkflowBusName", { value: workflowBus.eventBusName });
  }
}
