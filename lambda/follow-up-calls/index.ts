import { QueryCommand, GetCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";

/**
 * Routes handled:
 *   GET /follow-up-calls?appointmentId=...  -> the follow-up call record (status
 *       + timeline of non-sensitive audit events) for one appointment. Doctors
 *       can view any of their own patients' calls; patients can only view their
 *       own. Never returns raw audio or full transcripts — see callAudit.ts.
 *   GET /follow-up-calls                    -> (no appointmentId) the calling
 *       doctor's full call history across every appointment — the "Call
 *       history" list — via the DOCTOR_FOLLOWUPS#<doctorId> pointer items
 *       lambda/outbound-call-initiator writes at call-creation time.
 *
 * Starting a call is handled by lambda/outbound-call-initiator's API branch
 * (POST /appointments/{id}/follow-up-call), not here, since that path needs
 * to invoke Connect/Chime/Twilio and this one is read-only.
 */
export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const claims = getClaims(event);
  if (!claims) return jsonResponse(401, { message: "Unauthorized" });

  if (method !== "GET") return jsonResponse(405, { message: "Method not allowed" });

  const appointmentId = event.queryStringParameters?.appointmentId;

  if (!appointmentId) {
    if (!claims["cognito:groups"]?.includes("Doctors")) {
      return jsonResponse(403, { message: "Only doctors can list their full call history" });
    }
    const calls = await listCallsForDoctor(claims.sub);
    return jsonResponse(200, { calls });
  }

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

/** BatchGet the FOLLOWUP_CALL#<id>/DETAILS items pointed to by a doctor's GSI1 pointer query. */
async function listCallsForDoctor(doctorId: string) {
  const pointerRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `DOCTOR_FOLLOWUPS#${doctorId}` },
      ScanIndexForward: false,
    })
  );
  const ids = Array.from(new Set((pointerRes.Items || []).map((p) => p.followUpCallId).filter(Boolean)));
  if (ids.length === 0) return [];

  const calls: Record<string, any>[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    let keys = ids.slice(i, i + 25).map((id) => ({ PK: `FOLLOWUP_CALL#${id}`, SK: "DETAILS" }));
    while (keys.length > 0) {
      const res: any = await ddb.send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys } } }));
      calls.push(...((res.Responses?.[TABLE_NAME] as Record<string, any>[]) || []));
      keys = res.UnprocessedKeys?.[TABLE_NAME]?.Keys || [];
    }
  }
  return calls.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}
