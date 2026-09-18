import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { ddb, TABLE_NAME } from "./ddb";

const eventBridge = new EventBridgeClient({});

// 3 days: enough time for post-consult symptoms to resolve or escalate, short
// enough that the follow-up call is still relevant — arbitrary but documented default.
const FOLLOW_UP_DELAY_DAYS = 3;

/**
 * Idempotently emits a "prescription_uploaded" event to the workflow bus once
 * BOTH conditions are true for an appointment: its status is "completed" AND
 * a prescription record exists for it. Called from both lambda/appointments
 * (after status flips to completed) and lambda/prescriptions (after confirm),
 * so it must be safe to call from either order, any number of times.
 *
 * "Already emitted" is decided by a single source of truth: a conditional
 * PutCommand on an EVENT_MARKER# item, which only one caller can ever win.
 */
export async function emitPrescriptionUploadedIfReady(appointmentId: string): Promise<void> {
  const apptResult = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${appointmentId}`, SK: "DETAILS" } })
  );
  const appt = apptResult.Item;
  if (!appt || appt.status !== "completed") return;

  const rxResult = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `APPT_PRESCRIPTION#${appointmentId}` },
      Limit: 1,
    })
  );
  const prescription = rxResult.Items?.[0];
  if (!prescription) return;

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { PK: `APPT#${appointmentId}`, SK: "EVENT_MARKER#prescription_uploaded", emittedAt: new Date().toISOString() },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return; // already emitted by a concurrent/earlier call
    }
    throw err;
  }

  const followUpDueAt = new Date(Date.now() + FOLLOW_UP_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.WORKFLOW_BUS_NAME,
          Source: "vitalis.triggers",
          DetailType: "prescription_uploaded",
          Detail: JSON.stringify({
            appointmentId,
            patientId: appt.patientId,
            doctorId: appt.doctorId,
            prescriptionId: prescription.id,
            followUpDueAt,
          }),
        },
      ],
    })
  );
}
