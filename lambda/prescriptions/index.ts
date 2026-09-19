import { GetCommand, PutCommand, QueryCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { TranslateClient, TranslateTextCommand } from "@aws-sdk/client-translate";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { emitPrescriptionUploadedIfReady } from "../_shared/prescriptionEvent";
import { randomUUID } from "crypto";

const s3 = new S3Client({});
const polly = new PollyClient({});
const translate = new TranslateClient({});
const BUCKET = process.env.PDF_BUCKET as string;

/**
 * Routes handled:
 *   POST /prescriptions/presign        -> body {appointmentId}; presigned S3 PUT URL
 *                                          for the treating doctor to upload a scanned
 *                                          prescription PDF.
 *   POST /prescriptions/confirm        -> body {appointmentId, key, followUpSummary}; records
 *                                          a "pdf"-type prescription and (idempotently) fires
 *                                          the "prescription_uploaded" workflow event once the
 *                                          appointment is also marked completed.
 *   POST /prescriptions                -> body {appointmentId, diagnosis, notes, medications};
 *                                          records a "digital"-type prescription issued directly
 *                                          by the treating doctor (no file upload). Also
 *                                          (idempotently) fires "prescription_uploaded".
 *   GET  /prescriptions?appointmentId=... -> list prescriptions for an appointment
 *   GET  /prescriptions/{id}           -> single prescription by id
 *   GET  /prescriptions/{id}/download  -> presigned S3 GET URL for a "pdf"-type prescription
 *   POST /prescriptions/{id}/audio     -> body {languageCode?}; Amazon Polly reads the
 *                                          prescription aloud (translated first via Amazon
 *                                          Translate if languageCode isn't "en"); returns a
 *                                          presigned S3 GET URL for the generated MP3.
 *   POST /prescriptions/{id}/translate -> body {targetLanguage}; Amazon Translate renders the
 *                                          diagnosis/notes/medication instructions in the
 *                                          target language. Stateless — nothing is persisted.
 *   GET  /patients/{id}/prescriptions  -> list all prescriptions (pdf + digital) for a patient
 *   GET  /doctors/{id}/prescriptions   -> list all prescriptions (pdf + digital) issued by a doctor
 *
 * Prescription PDFs live in the same pdfBucket as lab-result PDFs, under the
 * `prescriptions/<appointmentId>/<uuid>.pdf` prefix, never made public.
 * Generated audio lives under `prescriptions/audio/<prescriptionId>/<languageCode>.mp3`.
 *
 * Every prescription record (PK=PRESCRIPTION#<id>, SK=DETAILS) is additionally indexed by
 * two pointer items so it can be found without knowing its appointment:
 *   PK=PRESCRIPTION#<id> / SK=PATIENT_INDEX -> GSI1PK=PATIENT_PRESCRIPTIONS#<patientId>
 *   PK=PRESCRIPTION#<id> / SK=DOCTOR_INDEX  -> GSI1PK=DOCTOR_PRESCRIPTIONS#<doctorId>
 * (GSI1SK is `<isoTimestamp>#<id>` on both, so a Query naturally comes back in issue order.)
 * The DETAILS item itself keeps GSI1PK=APPT_PRESCRIPTION#<appointmentId> as before, so
 * lambda/_shared/prescriptionEvent.ts's appointment-scoped lookup works unchanged for both types.
 */

const SUPPORTED_LANGUAGES: Record<string, { voiceId: string; languageCode: string }> = {
  en: { voiceId: "Joanna", languageCode: "en-US" },
  es: { voiceId: "Conchita", languageCode: "es-ES" },
  fr: { voiceId: "Celine", languageCode: "fr-FR" },
  de: { voiceId: "Marlene", languageCode: "de-DE" },
  hi: { voiceId: "Aditi", languageCode: "hi-IN" },
};

async function getAppointment(appointmentId: string) {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${appointmentId}`, SK: "DETAILS" } })
  );
  return result.Item;
}

async function getPrescription(id: string) {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PRESCRIPTION#${id}`, SK: "DETAILS" } })
  );
  return result.Item;
}

function isTreatingDoctor(claims: Record<string, string>, appt: any) {
  return Boolean(claims["cognito:groups"]?.includes("Doctors")) && claims.sub === appt?.doctorId;
}

function isSelfOrTreatingDoctor(claims: Record<string, string>, appt: any) {
  return claims.sub === appt?.patientId || isTreatingDoctor(claims, appt);
}

/** Pointer items so a prescription can be listed by patient or doctor without a table scan. */
async function writeListingPointers(prescriptionId: string, patientId: string, doctorId: string, timestamp: string) {
  await Promise.all([
    ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `PRESCRIPTION#${prescriptionId}`,
          SK: "PATIENT_INDEX",
          GSI1PK: `PATIENT_PRESCRIPTIONS#${patientId}`,
          GSI1SK: `${timestamp}#${prescriptionId}`,
          prescriptionId,
        },
      })
    ),
    ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `PRESCRIPTION#${prescriptionId}`,
          SK: "DOCTOR_INDEX",
          GSI1PK: `DOCTOR_PRESCRIPTIONS#${doctorId}`,
          GSI1SK: `${timestamp}#${prescriptionId}`,
          prescriptionId,
        },
      })
    ),
  ]);
}

/** BatchGet the PRESCRIPTION#<id>/DETAILS items pointed to by a GSI1 pointer-item query. */
async function hydratePrescriptions(pointerItems: Record<string, any>[]) {
  const ids = Array.from(new Set(pointerItems.map((p) => p.prescriptionId).filter(Boolean)));
  if (ids.length === 0) return [];

  const prescriptions: Record<string, any>[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    let keys = ids.slice(i, i + 25).map((id) => ({ PK: `PRESCRIPTION#${id}`, SK: "DETAILS" }));
    while (keys.length > 0) {
      const res: any = await ddb.send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys } } }));
      prescriptions.push(...((res.Responses?.[TABLE_NAME] as Record<string, any>[]) || []));
      keys = res.UnprocessedKeys?.[TABLE_NAME]?.Keys || [];
    }
  }
  return prescriptions.sort((a, b) =>
    String(b.issuedAt || b.uploadedAt || "").localeCompare(String(a.issuedAt || a.uploadedAt || ""))
  );
}

/** Renders the spoken/translatable text for a prescription's own default (English) content. */
function buildPrescriptionText(item: Record<string, any>): string | null {
  if (item.type === "digital") {
    const lines: string[] = [];
    if (item.diagnosis) lines.push(`Diagnosis: ${item.diagnosis}.`);
    for (const med of item.medications || []) {
      const parts = [med.name, med.dosage, med.frequency].filter(Boolean).join(", ");
      const duration = med.duration ? `, for ${med.duration}` : "";
      const instructions = med.instructions ? ` ${med.instructions}` : "";
      lines.push(`${parts}${duration}.${instructions}`);
    }
    if (item.notes) lines.push(`Notes: ${item.notes}.`);
    return lines.length > 0 ? lines.join(" ") : null;
  }
  return item.followUpSummary || null;
}

async function translateText(text: string, targetLanguage: string): Promise<string> {
  const result = await translate.send(
    new TranslateTextCommand({ Text: text, SourceLanguageCode: "en", TargetLanguageCode: targetLanguage })
  );
  return result.TranslatedText || text;
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
    const uploadedAt = new Date().toISOString();
    const item = {
      PK: `PRESCRIPTION#${prescriptionId}`,
      SK: "DETAILS",
      GSI1PK: `APPT_PRESCRIPTION#${appointmentId}`,
      GSI1SK: "DETAILS",
      id: prescriptionId,
      type: "pdf",
      appointmentId,
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      key,
      uploadedAt,
      followUpSummary: followUpSummary ?? null,
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    await writeListingPointers(prescriptionId, appt.patientId, appt.doctorId, uploadedAt);

    await emitPrescriptionUploadedIfReady(appointmentId);

    return jsonResponse(201, item);
  }

  if (method === "POST" && path.includes("/prescriptions/") && path.endsWith("/audio")) {
    const id = event.pathParameters?.id;
    const item = id ? await getPrescription(id) : null;
    if (!item) return jsonResponse(404, { message: "Prescription not found" });
    const appt = await getAppointment(item.appointmentId);
    if (!isSelfOrTreatingDoctor(claims, appt)) return jsonResponse(403, { message: "Forbidden" });

    const body = JSON.parse(event.body || "{}");
    const languageCode: string = body.languageCode || "en";
    const voice = SUPPORTED_LANGUAGES[languageCode];
    if (!voice) return jsonResponse(400, { message: `Unsupported languageCode: ${languageCode}` });

    let text = buildPrescriptionText(item);
    if (!text) return jsonResponse(400, { message: "Nothing to read aloud for this prescription" });
    if (languageCode !== "en") text = await translateText(text, languageCode);

    const synthesis = await polly.send(
      new SynthesizeSpeechCommand({
        Text: text,
        OutputFormat: "mp3",
        VoiceId: voice.voiceId as any,
        Engine: "standard",
      })
    );
    if (!synthesis.AudioStream) return jsonResponse(502, { message: "Polly returned no audio" });
    const audioBytes = await (synthesis.AudioStream as any).transformToByteArray();

    const audioKey = `prescriptions/audio/${id}/${languageCode}.mp3`;
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: audioKey, Body: Buffer.from(audioBytes), ContentType: "audio/mpeg" })
    );
    const audioUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: audioKey }), {
      expiresIn: 3600,
    });
    return jsonResponse(200, { audioUrl, languageCode });
  }

  if (method === "POST" && path.includes("/prescriptions/") && path.endsWith("/translate")) {
    const id = event.pathParameters?.id;
    const item = id ? await getPrescription(id) : null;
    if (!item) return jsonResponse(404, { message: "Prescription not found" });
    const appt = await getAppointment(item.appointmentId);
    if (!isSelfOrTreatingDoctor(claims, appt)) return jsonResponse(403, { message: "Forbidden" });

    const body = JSON.parse(event.body || "{}");
    const targetLanguage: string = body.targetLanguage;
    if (!targetLanguage || !SUPPORTED_LANGUAGES[targetLanguage]) {
      return jsonResponse(400, { message: `Unsupported targetLanguage: ${targetLanguage}` });
    }
    if (targetLanguage === "en") return jsonResponse(200, { targetLanguage, diagnosis: item.diagnosis ?? null, notes: item.notes ?? null, followUpSummary: item.followUpSummary ?? null, medications: item.medications ?? null });

    if (item.type === "digital") {
      const [diagnosis, notes, medications] = await Promise.all([
        item.diagnosis ? translateText(item.diagnosis, targetLanguage) : Promise.resolve(null),
        item.notes ? translateText(item.notes, targetLanguage) : Promise.resolve(null),
        Promise.all(
          (item.medications || []).map(async (med: any) => ({
            name: med.name, // drug names are left untranslated deliberately
            dosage: med.dosage ? await translateText(med.dosage, targetLanguage) : med.dosage,
            frequency: med.frequency ? await translateText(med.frequency, targetLanguage) : med.frequency,
            duration: med.duration ? await translateText(med.duration, targetLanguage) : med.duration,
            instructions: med.instructions ? await translateText(med.instructions, targetLanguage) : med.instructions,
          }))
        ),
      ]);
      return jsonResponse(200, { targetLanguage, diagnosis, notes, medications });
    }

    const followUpSummary = item.followUpSummary ? await translateText(item.followUpSummary, targetLanguage) : null;
    return jsonResponse(200, { targetLanguage, followUpSummary });
  }

  if (method === "POST" && path.endsWith("/prescriptions")) {
    const body = JSON.parse(event.body || "{}");
    const { appointmentId, diagnosis, notes, medications } = body;
    const appt = await getAppointment(appointmentId);
    if (!appt) return jsonResponse(404, { message: "Appointment not found" });
    if (!isTreatingDoctor(claims, appt)) return jsonResponse(403, { message: "Forbidden" });
    if (!Array.isArray(medications) || medications.length === 0) {
      return jsonResponse(400, { message: "At least one medication is required" });
    }
    for (const med of medications) {
      if (!med?.name || !med?.dosage || !med?.frequency) {
        return jsonResponse(400, { message: "Each medication needs a name, dosage, and frequency" });
      }
    }

    const prescriptionId = randomUUID();
    const issuedAt = new Date().toISOString();
    const item = {
      PK: `PRESCRIPTION#${prescriptionId}`,
      SK: "DETAILS",
      GSI1PK: `APPT_PRESCRIPTION#${appointmentId}`,
      GSI1SK: "DETAILS",
      id: prescriptionId,
      type: "digital",
      appointmentId,
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      diagnosis: diagnosis ?? null,
      notes: notes ?? null,
      medications,
      issuedAt,
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    await writeListingPointers(prescriptionId, appt.patientId, appt.doctorId, issuedAt);

    await emitPrescriptionUploadedIfReady(appointmentId);

    return jsonResponse(201, item);
  }

  if (method === "GET" && path.includes("/patients/") && path.endsWith("/prescriptions")) {
    const patientId = event.pathParameters.id;
    if (claims.sub !== patientId && !claims["cognito:groups"]?.includes("Doctors")) {
      return jsonResponse(403, { message: "Forbidden" });
    }
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `PATIENT_PRESCRIPTIONS#${patientId}` },
      })
    );
    const prescriptions = await hydratePrescriptions(result.Items || []);
    return jsonResponse(200, { prescriptions });
  }

  if (method === "GET" && path.includes("/doctors/") && path.endsWith("/prescriptions")) {
    const doctorId = event.pathParameters.id;
    if (claims.sub !== doctorId) return jsonResponse(403, { message: "Forbidden" });
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `DOCTOR_PRESCRIPTIONS#${doctorId}` },
      })
    );
    const prescriptions = await hydratePrescriptions(result.Items || []);
    return jsonResponse(200, { prescriptions });
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

  if (method === "GET" && path.endsWith("/download")) {
    const id = event.pathParameters?.id;
    const item = id ? await getPrescription(id) : null;
    if (!item) return jsonResponse(404, { message: "Prescription not found" });
    if (item.type !== "pdf" || !item.key) return jsonResponse(400, { message: "This prescription has no PDF to download" });
    const appt = await getAppointment(item.appointmentId);
    if (!isSelfOrTreatingDoctor(claims, appt)) return jsonResponse(403, { message: "Forbidden" });

    const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: item.key }), {
      expiresIn: 300,
    });
    return jsonResponse(200, { downloadUrl });
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
