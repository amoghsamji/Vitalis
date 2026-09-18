import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../_shared/ddb";
import { recordCallEvent } from "../_shared/callAudit";

/**
 * Invoked by the Amazon Connect contact flow (as a plain "Invoke AWS Lambda
 * function" block) right after the call connects. Connect passes only the
 * minimal contact attributes set at StartOutboundVoiceContact time
 * (patientId, appointmentId, prescriptionId, doctorId, followUpCallId) —
 * this Lambda resolves those into the small amount of context the bot
 * actually needs to speak.
 *
 * Deliberately returns ONLY: first name (for the low-risk identity check),
 * doctor's display name, appointment type/date, and whether the patient is
 * still opted in. It never returns prescription contents, diagnosis, or any
 * other clinical detail — those never enter a Connect contact attribute.
 */
export const handler = async (event: any) => {
  const attrs = event?.Details?.ContactData?.Attributes ?? event ?? {};
  const { patientId, appointmentId, doctorId, followUpCallId } = attrs;

  const [patientRes, apptRes, doctorRes] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PATIENT#${patientId}`, SK: "PROFILE" } })),
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${appointmentId}`, SK: "DETAILS" } })),
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `DOCTOR#${doctorId}`, SK: "PROFILE" } })),
  ]);

  const patient = patientRes.Item;
  const appt = apptRes.Item;
  const doctor = doctorRes.Item;

  if (followUpCallId) {
    await recordCallEvent(followUpCallId, "answered", { appointmentId });
  }

  const firstName = (patient?.name || "").split(" ")[0] || null;

  return {
    firstName,
    doctorName: doctor?.name ?? "your doctor",
    appointmentType: appt?.consultationType ?? "appointment",
    appointmentDate: appt?.startTime ?? null,
    // Fresh consent/eligibility re-check — the contact flow / Lex fulfillment
    // must not proceed with any medical discussion if this is false, even
    // though outbound-call-initiator already checked it before dialing.
    followUpCallsEnabled: Boolean(patient?.followUpCallsEnabled),
    patientFound: Boolean(patient),
  };
};
