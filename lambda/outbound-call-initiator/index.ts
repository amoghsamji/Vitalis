import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  ConnectClient,
  StartOutboundVoiceContactCommand,
} from "@aws-sdk/client-connect";
import {
  ChimeSDKVoiceClient,
  CreateSipMediaApplicationCallCommand,
} from "@aws-sdk/client-chime-sdk-voice";
import twilio from "twilio";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { recordCallEvent, updateCallStatus, findActiveFollowUpCallForAppointment } from "../_shared/callAudit";
import { randomUUID } from "crypto";

const connect = new ConnectClient({});
const chimeVoice = new ChimeSDKVoiceClient({});

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

/**
 * Two ways to call this function:
 *   1. As the API route POST /appointments/{id}/follow-up-call — the doctor's
 *      manual "Start follow-up call" test button (spec item 6).
 *   2. Direct Lambda invoke (Event) with { followUpCallId, appointmentId,
 *      patientId, doctorId, prescriptionId } from anything that enqueues a call.
 *
 * Both paths converge on dialCall(), which re-checks patient consent and the
 * appointment's completed+prescription-uploaded state fresh (never trusts
 * whatever was true when the call was first requested), then places the call
 * via whichever telephony provider CDK enabled (see CALL_PROVIDER below) with
 * ONLY the five whitelisted, non-sensitive contact attributes. Retries
 * (exponential backoff, capped at MAX_ATTEMPTS) only wrap the initiation API
 * call itself — i.e. only technical initiation failures — never a
 * business-rule rejection (opted out, not eligible), and never after the
 * patient has explicitly declined/opted out.
 */
export const handler = async (event: any) => {
  // API Gateway path
  if (event?.requestContext?.http) {
    const claims = getClaims(event);
    if (!claims) return jsonResponse(401, { message: "Unauthorized" });
    if (!claims["cognito:groups"]?.includes("Doctors")) {
      return jsonResponse(403, { message: "Only doctors can start a follow-up call" });
    }
    const appointmentId = event.pathParameters?.id;
    const apptRes = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${appointmentId}`, SK: "DETAILS" } })
    );
    const appt = apptRes.Item;
    if (!appt) return jsonResponse(404, { message: "Appointment not found" });
    if (appt.doctorId !== claims.sub) return jsonResponse(403, { message: "Forbidden" });

    const result = await requestFollowUpCall(appointmentId, appt.doctorId, appt.patientId);
    return jsonResponse(result.statusCode, result.body);
  }

  // Direct invoke path from lambda/workflow-engine's call_patient action:
  // { requestFollowUp: true, appointmentId, doctorId, patientId }. Goes
  // through the same eligibility/idempotency gate as the doctor's manual
  // button (requestFollowUpCall), since it's the exact same operation
  // triggered automatically instead of by a click.
  if (event?.requestFollowUp) {
    return requestFollowUpCall(event.appointmentId, event.doctorId, event.patientId);
  }

  // Direct invoke path used for retries / already-created call records.
  return dialCall(event.followUpCallId);
};

async function requestFollowUpCall(appointmentId: string, doctorId: string, patientId: string) {
  // Idempotency: never start a second call for an appointment that already
  // has an active (or even a not-yet-exhausted-failed) follow-up call.
  const existing = await findActiveFollowUpCallForAppointment(appointmentId);
  if (existing) {
    return { statusCode: 200, body: { followUpCall: existing, alreadyRequested: true } };
  }

  const patientRes = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PATIENT#${patientId}`, SK: "PROFILE" } })
  );
  const patient = patientRes.Item;
  if (!patient?.followUpCallsEnabled) {
    return { statusCode: 409, body: { message: "Patient has not consented to automated follow-up calls" } };
  }

  const apptRes = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${appointmentId}`, SK: "DETAILS" } })
  );
  const appt = apptRes.Item;
  if (appt?.status !== "completed") {
    return { statusCode: 409, body: { message: "Appointment must be completed before a follow-up call" } };
  }

  const rxRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `APPT_PRESCRIPTION#${appointmentId}` },
      Limit: 1,
    })
  );
  const prescription = rxRes.Items?.[0];
  if (!prescription) {
    return { statusCode: 409, body: { message: "No prescription on file for this appointment yet" } };
  }

  const followUpCallId = randomUUID();
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `FOLLOWUP_CALL#${followUpCallId}`,
          SK: "DETAILS",
          GSI1PK: `APPT_FOLLOWUP#${appointmentId}`,
          GSI1SK: "DETAILS",
          id: followUpCallId,
          appointmentId,
          patientId,
          doctorId,
          prescriptionId: prescription.id,
          status: "requested",
          attempts: 0,
          createdAt: new Date().toISOString(),
        },
        // Idempotency key: one FOLLOWUP_CALL DETAILS item per id, and the
        // GSI1 lookup above already prevents a second live item per appointment.
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return { statusCode: 409, body: { message: "Follow-up call already requested" } };
    }
    throw err;
  }

  // Pointer item so lambda/follow-up-calls can list a doctor's full call
  // history (GET /follow-up-calls with no appointmentId), not just one
  // appointment's — same pattern as the DOCTOR_INDEX pointers used for
  // appointments/prescriptions.
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `FOLLOWUP_CALL#${followUpCallId}`,
        SK: "DOCTOR_INDEX",
        GSI1PK: `DOCTOR_FOLLOWUPS#${doctorId}`,
        GSI1SK: new Date().toISOString(),
        followUpCallId,
      },
    })
  );

  await recordCallEvent(followUpCallId, "requested", { appointmentId, doctorId, patientId });

  const result = await dialCall(followUpCallId);
  return { statusCode: 202, body: { followUpCallId, dialResult: result } };
}

async function dialCall(followUpCallId: string) {
  const callRes = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `FOLLOWUP_CALL#${followUpCallId}`, SK: "DETAILS" } })
  );
  const call = callRes.Item;
  if (!call) return { ok: false, reason: "call_not_found" };

  // Fresh re-check, every single dial attempt — not just at enqueue time.
  const [patientRes, apptRes] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PATIENT#${call.patientId}`, SK: "PROFILE" } })),
    ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${call.appointmentId}`, SK: "DETAILS" } })),
  ]);
  const patient = patientRes.Item;
  const appt = apptRes.Item;

  if (!patient?.followUpCallsEnabled || !patient?.phone) {
    await recordCallEvent(followUpCallId, "opted_out", { reason: "not_eligible_at_dial_time" });
    await updateCallStatus(followUpCallId, "opted_out");
    return { ok: false, reason: "not_eligible" };
  }
  if (appt?.status !== "completed") {
    await recordCallEvent(followUpCallId, "failed", { reason: "appointment_not_completed", retryable: false });
    await updateCallStatus(followUpCallId, "failed");
    return { ok: false, reason: "appointment_not_completed" };
  }

  // Which telephony provider actually places the call is decided entirely by
  // CDK context, not by anything here — see lib/vitalis-stack.ts. Both
  // Amazon Connect and Amazon Chime SDK Voice can be provisioned side by
  // side (each behind its own flag); CALL_PROVIDER picks whichever one is
  // live. Unset (neither flag passed at deploy) fails fast and clearly
  // rather than attempting a call against placeholder resource ids.
  const provider = process.env.CALL_PROVIDER;
  if (provider !== "connect" && provider !== "chime" && provider !== "twilio") {
    await recordCallEvent(followUpCallId, "failed", {
      error:
        "No telephony provider configured (deploy with -c enableConnectLex=true, -c enableChimeVoice=true, or -c enableTwilioVoice=true)",
      retryable: false,
    });
    await updateCallStatus(followUpCallId, "failed");
    return { ok: false, reason: "no_call_provider_configured" };
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const placed =
        provider === "connect"
          ? await placeConnectCall(call, followUpCallId, patient.phone)
          : provider === "chime"
            ? await placeChimeCall(call, followUpCallId, patient.phone)
            : await placeTwilioCall(call, followUpCallId, patient.phone);
      await recordCallEvent(followUpCallId, "initiated", { ...placed, provider, attempt });
      await updateCallStatus(followUpCallId, "initiated", {
        provider,
        ...("twilioCallSid" in placed ? { twilioCallSid: placed.twilioCallSid } : {}),
      });
      return { ok: true, provider, ...placed };
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableCallError(err);
      if (!retryable || attempt === MAX_ATTEMPTS) {
        await recordCallEvent(followUpCallId, "failed", {
          error: err instanceof Error ? err.message : String(err),
          attempt,
          retryable,
          provider,
        });
        await updateCallStatus(followUpCallId, "failed");
        return { ok: false, reason: "initiation_failed" };
      }
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  return { ok: false, reason: "initiation_failed", error: lastErr };
}

async function placeConnectCall(call: Record<string, any>, followUpCallId: string, patientPhone: string) {
  const result = await connect.send(
    new StartOutboundVoiceContactCommand({
      DestinationPhoneNumber: patientPhone,
      ContactFlowId: process.env.CONNECT_CONTACT_FLOW_ID,
      InstanceId: process.env.CONNECT_INSTANCE_ID,
      // Connect requires one of these to know what to dial *from*.
      // SOURCE_PHONE_NUMBER is set once a number is claimed in the Connect
      // instance (see vitalis-stack.ts); until then this is undefined and
      // the call fails fast with a clear Connect error instead of silently
      // misdialing.
      SourcePhoneNumber: process.env.CONNECT_SOURCE_PHONE_NUMBER,
      // Minimal, non-sensitive contact attributes only — per spec, never
      // prescription contents/diagnosis. fetch-patient-context resolves
      // everything else server-side from these five IDs.
      Attributes: {
        patientId: call.patientId,
        appointmentId: call.appointmentId,
        prescriptionId: call.prescriptionId,
        doctorId: call.doctorId,
        followUpCallId,
      },
    })
  );
  return { connectContactId: result.ContactId };
}

async function placeChimeCall(call: Record<string, any>, followUpCallId: string, patientPhone: string) {
  const result = await chimeVoice.send(
    new CreateSipMediaApplicationCallCommand({
      FromPhoneNumber: process.env.CHIME_SOURCE_PHONE_NUMBER,
      ToPhoneNumber: patientPhone,
      SipMediaApplicationId: process.env.CHIME_SIP_MEDIA_APPLICATION_ID,
      // Same five non-sensitive ids as the Connect path, delivered to
      // chime-sma-handler's NEW_OUTBOUND_CALL event as event.ArgumentsMap.
      ArgumentsMap: {
        patientId: call.patientId,
        appointmentId: call.appointmentId,
        prescriptionId: call.prescriptionId,
        doctorId: call.doctorId,
        followUpCallId,
      },
    })
  );
  return { chimeTransactionId: result.SipMediaApplicationCall?.TransactionId };
}

async function placeTwilioCall(call: Record<string, any>, followUpCallId: string, patientPhone: string) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const base = process.env.PUBLIC_API_BASE_URL;

  // Twilio has no ArgumentsMap/contact-attributes equivalent — the call's
  // identifying id travels as a query param on the webhook URLs it's given
  // instead (lambda/twilio-voice reads it back on every turn).
  const result = await client.calls.create({
    to: patientPhone,
    from: process.env.TWILIO_PHONE_NUMBER as string,
    url: `${base}/follow-up-calls/twilio/answer?followUpCallId=${followUpCallId}`,
    statusCallback: `${base}/follow-up-calls/twilio/status?followUpCallId=${followUpCallId}`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });
  return { twilioCallSid: result.sid };
}

/** Only transient/technical provider errors are worth retrying. */
function isRetryableCallError(err: unknown): boolean {
  const name = (err as any)?.name ?? "";
  if (name === "RestException" && typeof (err as any)?.status === "number") {
    // Twilio's SDK throws RestException for both 429s and 5xx transport
    // failures — only those are worth retrying, never a 4xx business
    // rejection (bad number, unverified trial destination, etc).
    const status = (err as any).status;
    return status === 429 || status >= 500;
  }
  return [
    "ThrottlingException",
    "InternalServiceException",
    "TooManyRequestsException",
    // Chime SDK Voice's equivalents
    "ServiceUnavailableException",
    "ServiceFailureException",
  ].includes(name);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
