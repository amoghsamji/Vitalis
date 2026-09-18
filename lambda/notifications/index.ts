import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { randomUUID } from "crypto";

const sns = new SNSClient({});

/**
 * Two ways to call this function:
 *   1. Direct Lambda invoke (from the workflow engine) with a payload like
 *      { type: "sms", phoneNumber, message, patientId }
 *   2. As an API route, if you choose to expose one later.
 *
 * "AI voice call" is intentionally NOT implemented as a real phone call here —
 * see the workflow-engine's call_patient action for where to plug in
 * Amazon Connect / Pinpoint / your existing ElevenLabs+Twilio setup. Wiring an
 * outbound calling service costs money the moment you provision a phone
 * number, so it's left as a clearly marked seam rather than built by default.
 */
export const handler = async (event: any) => {
  // API route: GET /doctors/{id}/notifications -> in-app notifications for a
  // doctor (booking confirmations plus the follow-up-call escalations written
  // by lambda/notify-doctor: persistent symptoms, follow-up requested,
  // emergency symptoms, unreachable patient).
  if (event?.requestContext?.http?.method === "GET" && event.pathParameters?.id) {
    const claims = getClaims(event);
    if (!claims) return jsonResponse(401, { message: "Unauthorized" });
    const doctorId = event.pathParameters.id;
    if (claims.sub !== doctorId) return jsonResponse(403, { message: "Forbidden" });

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `DOCTOR_NOTIFICATIONS#${doctorId}` },
        ScanIndexForward: false,
      })
    );
    return jsonResponse(200, { notifications: result.Items || [] });
  }

  // Direct invoke path (no API Gateway envelope)
  if (event.type === "sms") {
    await sns.send(
      new PublishCommand({
        PhoneNumber: event.phoneNumber,
        Message: event.message,
      })
    );
    await logNotification("sms", event);
    return { statusCode: 200 };
  }

  return jsonResponse(400, { message: "Unsupported notification type" });
};

async function logNotification(type: string, payload: any) {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `NOTIFICATION#${randomUUID()}`,
        SK: "DETAILS",
        type,
        payload,
        sentAt: new Date().toISOString(),
      },
    })
  );
}
