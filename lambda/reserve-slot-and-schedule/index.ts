import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, TABLE_NAME } from "../_shared/ddb";
import { recordCallEvent } from "../_shared/callAudit";
import { randomUUID } from "crypto";

/**
 * Atomically reserves a doctor's slot and creates the follow-up appointment,
 * using the exact same open->held->booked ConditionExpression pattern as
 * lambda/appointments/index.ts's POST /appointments handler (see there for
 * the rationale) — this is the follow-up-call equivalent, invoked from
 * lambda/lex-fulfillment when the patient accepts a proposed slot (script
 * step E), never called with a slot the patient hasn't just been read aloud.
 *
 * Race prevention: two concurrent callers (e.g. the same patient pressing
 * "yes" twice, or two different flows) racing for the same doctorId+slot
 * will have exactly one UpdateCommand succeed — the other gets a
 * ConditionalCheckFailedException and this function returns
 * { reserved: false } instead of throwing, so callers can offer the next slot.
 */
interface ReserveEvent {
  doctorId: string;
  patientId: string;
  slotStartTime: string;
  consultationType?: string;
  followUpCallId?: string;
}

export const handler = async (event: ReserveEvent) => {
  const { doctorId, patientId, slotStartTime, consultationType, followUpCallId } = event;
  const apptId = randomUUID();

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `DOCTOR#${doctorId}`, SK: `SLOT#${slotStartTime}` },
        UpdateExpression: "SET #s = :held, heldBy = :patientId",
        ConditionExpression: "#s = :open",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":held": "held", ":open": "open", ":patientId": patientId },
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return { reserved: false, reason: "slot_taken" };
    }
    throw err;
  }

  const appt = {
    PK: `APPT#${apptId}`,
    SK: "DETAILS",
    GSI1PK: `PATIENT_APPTS#${patientId}`,
    GSI1SK: slotStartTime,
    id: apptId,
    doctorId,
    patientId,
    startTime: slotStartTime,
    consultationType: consultationType || "video",
    status: "confirmed",
    source: "automated_follow_up_call",
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: appt }));
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `APPT#${apptId}`,
        SK: "DOCTOR_INDEX",
        GSI1PK: `DOCTOR_APPTS#${doctorId}`,
        GSI1SK: slotStartTime,
        apptId,
      },
    })
  );
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `DOCTOR#${doctorId}`, SK: `SLOT#${slotStartTime}` },
      UpdateExpression: "SET #s = :booked",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":booked": "booked" },
    })
  );

  if (followUpCallId) {
    await recordCallEvent(followUpCallId, "appointment_scheduled", { appointmentId: apptId, doctorId, slotStartTime });
  }

  return { reserved: true, appointment: appt };
};
