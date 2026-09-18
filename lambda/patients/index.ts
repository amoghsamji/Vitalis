import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { randomUUID } from "crypto";

/**
 * Routes handled:
 *   GET  /patients/{id}                 -> patient profile (self or treating doctor)
 *   PUT  /patients/{id}                 -> update profile
 *   GET  /patients/{id}/conditions      -> list ICD-10 conditions
 *   POST /patients/{id}/conditions      -> add condition
 *   GET  /patients/{id}/medications     -> list medications
 *   POST /patients/{id}/medications     -> add medication
 */
export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const id = event.pathParameters?.id;
  const path: string = event.rawPath;
  const claims = getClaims(event);

  if (!claims) return jsonResponse(401, { message: "Unauthorized" });

  const isSelfOrDoctor = claims.sub === id || claims["cognito:groups"]?.includes("Doctors");
  if (!isSelfOrDoctor) return jsonResponse(403, { message: "Forbidden" });

  if (path.endsWith("/conditions")) {
    if (method === "GET") {
      const result = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: { ":pk": `PATIENT#${id}`, ":prefix": "CONDITION#" },
        })
      );
      return jsonResponse(200, { conditions: result.Items || [] });
    }
    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const conditionId = randomUUID();
      const item = {
        PK: `PATIENT#${id}`,
        SK: `CONDITION#${conditionId}`,
        id: conditionId,
        icd10Code: body.icd10Code,
        description: body.description,
        hccCategory: body.hccCategory ?? null,
        rafScore: body.rafScore ?? null,
        diagnosedAt: body.diagnosedAt ?? new Date().toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return jsonResponse(201, item);
    }
  }

  if (path.endsWith("/medications")) {
    if (method === "GET") {
      const result = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: { ":pk": `PATIENT#${id}`, ":prefix": "MEDICATION#" },
        })
      );
      return jsonResponse(200, { medications: result.Items || [] });
    }
    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const medId = randomUUID();
      const item = {
        PK: `PATIENT#${id}`,
        SK: `MEDICATION#${medId}`,
        id: medId,
        name: body.name,
        dosage: body.dosage,
        frequency: body.frequency,
        prescriber: body.prescriber,
        status: body.status || "active",
      };
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return jsonResponse(201, item);
    }
  }

  if (method === "GET") {
    const result = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PATIENT#${id}`, SK: "PROFILE" } })
    );
    if (!result.Item) return jsonResponse(404, { message: "Patient not found" });
    return jsonResponse(200, result.Item);
  }

  if (method === "PUT") {
    const body = JSON.parse(event.body || "{}");

    // Must match frontend/lib/constants.ts PHONE_E164_REGEX exactly — lambdas
    // don't share files with the frontend, so this is duplicated here.
    const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;
    const CONSENT_VERSION = "1.0";

    if (body.phone) {
      if (!PHONE_E164_REGEX.test(body.phone)) {
        return jsonResponse(400, { message: "Phone number must be in E.164 format, e.g. +919876543210" });
      }
    }

    const phoneValid = Boolean(body.phone) && PHONE_E164_REGEX.test(body.phone);
    const followUpCallsEnabled = Boolean(body.followUpCallsEnabled) && phoneValid && Boolean(body.consentGiven);

    const item = {
      PK: `PATIENT#${id}`,
      SK: "PROFILE",
      GSI1PK: "PATIENT",
      GSI1SK: `PATIENT#${id}`,
      id,
      name: body.name,
      dob: body.dob,
      insurance: body.insurance ?? null,
      mrn: body.mrn ?? null,
      riskLevel: body.riskLevel ?? "unknown",
      phone: body.phone,
      email: body.email,
      followUpCallsEnabled,
      consentTimestamp: followUpCallsEnabled ? new Date().toISOString() : null,
      consentVersion: followUpCallsEnabled ? CONSENT_VERSION : null,
      updatedAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return jsonResponse(200, item);
  }

  return jsonResponse(405, { message: "Method not allowed" });
};
