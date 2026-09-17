import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { randomUUID } from "crypto";

/**
 * Routes handled:
 *   GET  /doctors                 -> public directory listing (filter by specialty/language via querystring)
 *   GET  /doctors/{id}            -> public doctor profile
 *   PUT  /doctors/{id}            -> auth: doctor updates their own profile
 */
export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const id = event.pathParameters?.id;

  if (method === "GET" && !id) {
    const qs = event.queryStringParameters || {};
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "SK = :profile",
        ExpressionAttributeValues: { ":profile": "PROFILE" },
      })
    );
    let doctors = (result.Items || []).filter((i) => i.PK.startsWith("DOCTOR#"));
    if (qs.specialty) doctors = doctors.filter((d) => d.specialty === qs.specialty);
    if (qs.language) doctors = doctors.filter((d) => (d.languages || []).includes(qs.language));
    return jsonResponse(200, { doctors });
  }

  if (method === "GET" && id) {
    const result = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: `DOCTOR#${id}`, SK: "PROFILE" } })
    );
    if (!result.Item) return jsonResponse(404, { message: "Doctor not found" });
    return jsonResponse(200, result.Item);
  }

  if (method === "PUT" && id) {
    const claims = getClaims(event);
    if (!claims || claims.sub !== id) {
      return jsonResponse(403, { message: "You can only update your own profile" });
    }
    const body = JSON.parse(event.body || "{}");
    const item = {
      PK: `DOCTOR#${id}`,
      SK: "PROFILE",
      id,
      name: body.name,
      specialty: body.specialty,
      languages: body.languages || [],
      consultationTypes: body.consultationTypes || [], // e.g. ["video", "chat"]
      bio: body.bio,
      availabilityStatus: body.availabilityStatus || "unavailable", // "available_now" | "unavailable"
      averageRating: body.averageRating ?? null,
      updatedAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return jsonResponse(200, item);
  }

  return jsonResponse(405, { message: "Method not allowed" });
};

/** Helper other handlers can reuse to create a fresh doctor id if needed. */
export const newDoctorId = () => randomUUID();
