import { ScanCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { ddb, TABLE_NAME } from "../_shared/ddb";
import { randomUUID } from "crypto";

const lambdaClient = new LambdaClient({});

/**
 * The heart of the no-code automation feature.
 *
 * A workflow is stored as a JSON graph:
 *   {
 *     id, name,
 *     trigger: { type: "lab_result_received" | "appointment_booked" | "appointment_missed" | ... },
 *     nodes: [
 *       { id, kind: "condition", check: "cholesterol_gt_240" | "patient_age_gt" | ..., params: {...},
 *         onTrue: <nextNodeId>, onFalse: <nextNodeId|null> },
 *       { id, kind: "action", action: "call_patient" | "send_sms" | "schedule_appointment" |
 *             "create_lab_order" | "create_referral" | "update_patient_record" | "assign_staff",
 *         params: {...}, next: <nextNodeId|null> },
 *       { id, kind: "output", output: "log_completion" | "generate_transcript" | "create_report" |
 *             "send_summary_to_doctor", params: {...}, next: <nextNodeId|null> }
 *     ],
 *     startNodeId
 *   }
 *
 * This function:
 *   1. Reads the EventBridge event (source: "vitalis.triggers").
 *   2. Scans for workflows whose trigger.type matches the event's detail-type.
 *      (For real scale, replace the Scan with a GSI keyed on trigger type —
 *      left as a Scan here to keep the skeleton simple; fine at low volume.)
 *   3. Walks each matching workflow's graph from startNodeId, evaluating
 *      conditions and dispatching actions, writing an audit-log RUN record
 *      as it goes.
 */
export const handler = async (event: any) => {
  const triggerType = event["detail-type"];
  const detail = event.detail || {};

  const workflows = await findWorkflowsForTrigger(triggerType);

  for (const workflow of workflows) {
    await runWorkflow(workflow, detail);
  }

  return { statusCode: 200, workflowsRun: workflows.length };
};

async function findWorkflowsForTrigger(triggerType: string) {
  const result = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "SK = :def AND triggerType = :tt AND enabled = :en",
      ExpressionAttributeValues: { ":def": "DEFINITION", ":tt": triggerType, ":en": true },
    })
  );
  return result.Items || [];
}

async function runWorkflow(workflow: any, eventDetail: Record<string, any>) {
  const runId = randomUUID();
  const auditLog: Array<{ nodeId: string; kind: string; outcome: string; timestamp: string }> = [];
  const graph = workflow.graph;
  let currentNodeId: string | null = graph.startNodeId;
  let guard = 0;

  while (currentNodeId && guard < 100) {
    guard += 1;
    const node = graph.nodes.find((n: any) => n.id === currentNodeId);
    if (!node) break;

    if (node.kind === "condition") {
      const passed = evaluateCondition(node.check, node.params, eventDetail);
      auditLog.push({ nodeId: node.id, kind: "condition", outcome: passed ? "true" : "false", timestamp: new Date().toISOString() });
      currentNodeId = passed ? node.onTrue : node.onFalse;
      continue;
    }

    if (node.kind === "action") {
      await executeAction(node.action, node.params, eventDetail);
      auditLog.push({ nodeId: node.id, kind: "action", outcome: node.action, timestamp: new Date().toISOString() });
      currentNodeId = node.next;
      continue;
    }

    if (node.kind === "output") {
      auditLog.push({ nodeId: node.id, kind: "output", outcome: node.output, timestamp: new Date().toISOString() });
      currentNodeId = node.next;
      continue;
    }

    currentNodeId = null;
  }

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `WORKFLOW#${workflow.id}`,
        SK: `RUN#${runId}`,
        runId,
        workflowId: workflow.id,
        eventDetail,
        auditLog,
        completedAt: new Date().toISOString(),
      },
    })
  );
}

/**
 * lab_result_received and appointment_booked events carry a patientId but not a phone
 * number — resolve it from the patient's own profile so send_sms works without every
 * event producer having to duplicate this lookup.
 */
async function resolvePatientPhone(patientId: string | undefined): Promise<string | null> {
  if (!patientId) return null;
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PATIENT#${patientId}`, SK: "PROFILE" } })
  );
  return result.Item?.phone ?? null;
}

/** Conditions are simple, named, and data-driven — extend this map as you add more. */
function evaluateCondition(check: string, params: any, eventDetail: Record<string, any>): boolean {
  switch (check) {
    case "value_greater_than": {
      const value = Number(eventDetail.extractedFields?.[params.field]);
      return !Number.isNaN(value) && value > Number(params.threshold);
    }
    case "patient_age_gt":
      return Number(eventDetail.patientAge ?? 0) > Number(params.age);
    case "always_true":
      return true;
    default:
      return false;
  }
}

/** Actions are the "do something in the real world" steps. */
async function executeAction(action: string, params: any, eventDetail: Record<string, any>) {
  switch (action) {
    case "send_sms": {
      const phoneNumber = params.phoneNumber ?? eventDetail.phoneNumber ?? (await resolvePatientPhone(eventDetail.patientId));
      if (!phoneNumber) {
        console.log("send_sms skipped — no phone number available", { patientId: eventDetail.patientId });
        return;
      }
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: process.env.NOTIFICATIONS_FN_NAME,
          InvocationType: "Event",
          Payload: Buffer.from(
            JSON.stringify({
              type: "sms",
              phoneNumber,
              message: params.message ?? "This is a message from your care team.",
            })
          ),
        })
      );
      return;
    }
    case "call_patient": {
      // Real implementation: Amazon Connect + Lex V2 automated follow-up call
      // (see lambda/outbound-call-initiator, lambda/lex-fulfillment, and
      // lib/vitalis-stack.ts's Connect/Lex resources). node.params can carry
      // followUpDelayDays / fallbackBehavior from the workflow builder, but
      // this trigger already only fires "prescription_uploaded" events
      // (followUpDueAt is computed by lambda/_shared/prescriptionEvent.ts),
      // so we call immediately here — a real scheduler that waits until
      // followUpDueAt would be a separate piece of infra (see README "Known
      // gaps"), not built here per the "don't build a scheduler" guidance.
      const { appointmentId, doctorId, patientId } = eventDetail;
      if (!appointmentId || !doctorId || !patientId) {
        console.log("call_patient skipped — event missing appointmentId/doctorId/patientId", eventDetail);
        return;
      }
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: process.env.OUTBOUND_CALL_INITIATOR_FN_NAME,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({ requestFollowUp: true, appointmentId, doctorId, patientId })),
        })
      );
      return;
    }
    case "schedule_appointment":
      // Seam for Google Calendar API call (see a future googleCalendar Lambda/service).
      console.log("schedule_appointment action reached — wire in Google Calendar here", params);
      return;
    case "create_lab_order":
    case "create_referral":
    case "update_patient_record":
    case "assign_staff":
      // These are straightforward DynamoDB writes; implement per your exact
      // record shape once the patient data model settles.
      console.log(`${action} action reached`, params);
      return;
    default:
      console.log("Unknown action", action);
  }
}
