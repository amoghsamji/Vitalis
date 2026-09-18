import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../_shared/ddb";
import { randomUUID } from "crypto";

/**
 * Direct-invoke Lambda (no API Gateway envelope) that persists an in-app
 * doctor notification. Reuses the existing NOTIFICATION# item shape from
 * lambda/notifications/index.ts (same table, same PK prefix) rather than
 * inventing a second notification mechanism, but adds a GSI1 entry keyed by
 * doctor so lambda/notifications/index.ts's new GET /doctors/{id}/notifications
 * route can list them.
 *
 * Called for: persistent symptoms, follow-up requested, emergency symptoms,
 * unreachable patient (see lambda/lex-fulfillment and lambda/outbound-call-initiator).
 */
export type DoctorNotificationType =
  | "persistent_symptoms"
  | "follow_up_requested"
  | "emergency_symptoms"
  | "patient_unreachable";

interface NotifyDoctorEvent {
  doctorId: string;
  type: DoctorNotificationType;
  appointmentId: string;
  patientId: string;
  followUpCallId?: string;
  message: string;
}

export const handler = async (event: NotifyDoctorEvent) => {
  const id = randomUUID();
  const item = {
    PK: `NOTIFICATION#${id}`,
    SK: "DETAILS",
    GSI1PK: `DOCTOR_NOTIFICATIONS#${event.doctorId}`,
    GSI1SK: new Date().toISOString(),
    id,
    type: event.type,
    doctorId: event.doctorId,
    appointmentId: event.appointmentId,
    patientId: event.patientId,
    followUpCallId: event.followUpCallId ?? null,
    message: event.message,
    read: false,
    createdAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return { statusCode: 200, id };
};
