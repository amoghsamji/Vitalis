import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { emitPrescriptionUploadedIfReady } from "../_shared/prescriptionEvent";
import { randomUUID } from "crypto";

const s3 = new S3Client({});
const BUCKET = process.env.PDF_BUCKET as string;

/**
 * Routes handled:
 *   POST /prescriptions/presign  -> body {appointmentId}; presigned S3 PUT URL
 *                                   for the treating doctor to upload a prescription PDF.
 *   POST /prescriptions/confirm  -> body {appointmentId, key, followUpSummary}; records
 *                                   the prescription and (idempotently) fires the
 *                                   "prescription_uploaded" workflow event once the
 *                                   appointment is also marked completed.
 *   GET  /prescriptions?appointmentId=... -> list prescriptions for an appointment
 *   GET  /prescriptions/{id}     -> single prescription by id
 *
 * Prescription PDFs live in the same pdfBucket as lab-result PDFs, under the
 * `prescriptions/<appointmentId>/<uuid>.pdf` prefix, never made public.
 */

async function getAppointment(appointmentId: string) {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${appointmentId}`, SK: "DETAILS" } })
  );
  return result.Item;
}

function isTreatingDoctor(claims: Record<string, string>, appt: any) {
  return Boolean(claims["cognito:groups"]?.includes("Doctors")) && claims.sub === appt?.doctorId;
}

function isSelfOrTreatingDoctor(claims: Record<string, string>, appt: any) {
  return claims.sub === appt?.patientId || isTreatingDoctor(claims, appt);
}

export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const path: string = event.rawPath;
  const claims = getClaims(event);
  if (!claims) return jsonResponse(401, { message: "Unauthorized" });

  if (method === "POST" && path.endsWith("/prescriptions/presign")) {
    const body = JSON.parse(event.body || "{}");
    const { appointmentId } = body;
    const appt = await getAppointment(appointmentId);
    if (!appt) return jsonResponse(404, { message: "Appointment not found" });
    if (!isTreatingDoctor(claims, appt)) return jsonResponse(403, { message: "Forbidden" });

    const key = `prescriptions/${appointmentId}/${randomUUID()}.pdf`;
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: "application/pdf" }),
      { expiresIn: 300 }
    );
    return jsonResponse(200, { uploadUrl, key });
  }

  if (method === "POST" && path.endsWith("/prescriptions/confirm")) {
    const body = JSON.parse(event.body || "{}");
    const { appointmentId, key, followUpSummary } = body;
    const appt = await getAppointment(appointmentId);
    if (!appt) return jsonResponse(404, { message: "Appointment not found" });
    if (!isTreatingDoctor(claims, appt)) return jsonResponse(403, { message: "Forbidden" });

    const prescriptionId = randomUUID();
    const item = {
      PK: `PRESCRIPTION#${prescriptionId}`,
      SK: "DETAILS",
      GSI1PK: `APPT_PRESCRIPTION#${appointmentId}`,
      GSI1SK: "DETAILS",
      id: prescriptionId,
      appointmentId,
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      key,
      uploadedAt: new Date().toISOString(),
      followUpSummary: followUpSummary ?? null,
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

    await emitPrescriptionUploadedIfReady(appointmentId);

    return jsonResponse(201, item);
  }

  if (method === "GET" && path.endsWith("/prescriptions")) {
    const appointmentId = event.queryStringParameters?.appointmentId;
    if (!appointmentId) return jsonResponse(400, { message: "appointmentId query param required" });
    const appt = await getAppointment(appointmentId);
    if (!appt) return jsonResponse(404, { message: "Appointment not found" });
    if (!isSelfOrTreatingDoctor(claims, appt)) return jsonResponse(403, { message: "Forbidden" });

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `APPT_PRESCRIPTION#${appointmentId}` },
      })
    );
    return jsonResponse(200, { prescriptions: result.Items || [] });
  }

  if (method === "GET" && event.pathParameters?.id) {
    const id = event.pathParameters.id;
    const result = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PRESCRIPTION#${id}`, SK: "DETAILS" } })
    );
    if (!result.Item) return jsonResponse(404, { message: "Prescription not found" });
    const appt = await getAppointment(result.Item.appointmentId);
    if (!isSelfOrTreatingDoctor(claims, appt)) return jsonResponse(403, { message: "Forbidden" });
    return jsonResponse(200, result.Item);
  }

  return jsonResponse(405, { message: "Method not allowed" });
};
