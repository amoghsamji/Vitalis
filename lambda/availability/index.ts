import { PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { randomUUID } from "crypto";

/**
 * Routes handled:
 *   GET    /doctors/{id}/availability            -> list open slots
 *   POST   /doctors/{id}/availability             -> doctor creates a slot
 *   DELETE /doctors/{id}/availability/{slotId}    -> doctor removes a slot
 *
 * Slot status lifecycle: "open" -> "held" (temporary reservation while a patient is
 * mid-booking) -> "booked". The appointments handler is responsible for flipping
 * "held" -> "booked" atomically as part of its reserve->create->confirm sequence,
 * using a ConditionExpression so two patients can never win the same slot.
 */
export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const doctorId = event.pathParameters?.id;
  const slotId = event.pathParameters?.slotId;

  if (method === "GET") {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": `DOCTOR#${doctorId}`, ":prefix": "SLOT#" },
      })
    );
    const slots = (result.Items || []).filter((s) => s.status === "open");
    return jsonResponse(200, { slots });
  }

  if (method === "POST") {
    const claims = getClaims(event);
    if (!claims || claims.sub !== doctorId) {
      return jsonResponse(403, { message: "Only the doctor can add their own slots" });
    }
    const body = JSON.parse(event.body || "{}");
    const newSlotId = randomUUID();
    const item = {
      PK: `DOCTOR#${doctorId}`,
      SK: `SLOT#${body.startTime}`, // ISO timestamp sorts naturally
      id: newSlotId,
      doctorId,
      startTime: body.startTime,
      endTime: body.endTime,
      consultationType: body.consultationType || "video",
      status: "open",
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return jsonResponse(201, item);
  }

  if (method === "DELETE") {
    const claims = getClaims(event);
    if (!claims || claims.sub !== doctorId) {
      return jsonResponse(403, { message: "Only the doctor can remove their own slots" });
    }
    try {
      await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `DOCTOR#${doctorId}`, SK: `SLOT#${slotId}` },
          ConditionExpression: "attribute_not_exists(#s) OR #s = :open",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":open": "open" },
        })
      );
      return jsonResponse(204, {});
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return jsonResponse(409, { message: "Cannot remove a slot that's held or booked" });
      }
      throw err;
    }
  }

  return jsonResponse(405, { message: "Method not allowed" });
};
