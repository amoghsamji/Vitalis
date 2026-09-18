import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";

/**
 * Routes handled:
 *   GET /follow-up-calls?appointmentId=...  -> the follow-up call record (status
 *       + timeline of non-sensitive audit events) for one appointment. Doctors
 *       can view any of their own patients' calls; patients can only view their
 *       own. Never returns raw audio or full transcripts — see callAudit.ts.
 *
 * Starting a call is handled by lambda/outbound-call-initiator's API branch
 * (POST /appointments/{id}/follow-up-call), not here, since that path needs
 * to invoke Connect and this one is read-only.
 */
export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const claims = getClaims(event);
  if (!claims) return jsonResponse(401, { message: "Unauthorized" });

  if (method !== "GET") return jsonResponse(405, { message: "Method not allowed" });

  const appointmentId = event.queryStringParameters?.appointmentId;
  if (!appointmentId) return jsonResponse(400, { message: "appointmentId query param required" });

  const apptRes = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${appointmentId}`, SK: "DETAILS" } })
  );
  const appt = apptRes.Item;
  if (!appt) return jsonResponse(404, { message: "Appointment not found" });

  const isDoctor = claims["cognito:groups"]?.includes("Doctors") && claims.sub === appt.doctorId;
  const isPatient = claims.sub === appt.patientId;
  if (!isDoctor && !isPatient) return jsonResponse(403, { message: "Forbidden" });

  const linkRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `APPT_FOLLOWUP#${appointmentId}` },
    })
  );
  const call = linkRes.Items?.[0];
  if (!call) return jsonResponse(200, { call: null, events: [] });

  // Patients get a status-only view (no event detail payloads, which may
  // reference internal intent names) — doctors get the full timeline.
  if (isPatient && !isDoctor) {
    return jsonResponse(200, { call: { status: call.status, createdAt: call.createdAt }, events: [] });
  }

  const eventsRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `FOLLOWUP_CALL#${call.id}`, ":prefix": "EVENT#" },
    })
  );

  return jsonResponse(200, { call, events: eventsRes.Items || [] });
};
