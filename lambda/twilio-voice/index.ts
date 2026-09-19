import twilio from "twilio";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { ddb, TABLE_NAME } from "../_shared/ddb";
import { recordCallEvent, updateCallStatus } from "../_shared/callAudit";
import { mapIntentToDirective, type GeminiIntent, type ScriptSessionState } from "./script";
import { classifyConditionResponse, resolveSlotChoice } from "./gemini";
import { xmlResponse, gatherSpeech, sayAndHangup } from "./twiml";

const lambdaClient = new LambdaClient({});

/**
 * Public (unauthenticated) Twilio Voice webhook handler — the Twilio
 * equivalent of lambda/chime-sma-handler / lambda/lex-fulfillment combined,
 * since Twilio has no separate telephony-vs-NLU split the way Chime SMA +
 * Lex do. Three turns, routed on the rawPath suffix:
 *   POST /follow-up-calls/twilio/answer   -> opening question
 *   POST /follow-up-calls/twilio/input    -> speech turn (condition, or slot choice)
 *   POST /follow-up-calls/twilio/status   -> Twilio's call-status callback
 *
 * Every route requires a valid Twilio request signature (never trusts the
 * caller otherwise, since these routes carry no Cognito auth) and a
 * `followUpCallId` set on the webhook URL when outbound-call-initiator
 * placed the call (see lambda/outbound-call-initiator's placeTwilioCall).
 *
 * State that Lex would keep in sessionState.sessionAttributes is persisted
 * instead on the FOLLOWUP_CALL#<id>/DETAILS item (`conversationState`,
 * `offeredSlots`, `fallbackCount`) since Twilio's webhooks are stateless
 * between turns.
 */
export const handler = async (event: any) => {
  const method = event.requestContext?.http?.method;
  const path: string = event.rawPath || "";
  const followUpCallId = event.queryStringParameters?.followUpCallId;

  // TEMPORARY debug log while diagnosing a live "invalid url" spoken error —
  // remove once resolved.
  console.log("Incoming Twilio webhook:", {
    method,
    path,
    rawQueryString: event.rawQueryString,
    followUpCallId,
    hasSignatureHeader: Boolean(event.headers?.["x-twilio-signature"] || event.headers?.["X-Twilio-Signature"]),
    allHeaderKeys: Object.keys(event.headers || {}),
    allHeaders: event.headers,
  });

  if (method !== "POST" || !followUpCallId) {
    return xmlResponse(sayAndHangup("An error occurred. Goodbye."));
  }

  if (!verifyTwilioSignature(event)) {
    console.log("Signature verification FAILED", {
      base: process.env.PUBLIC_API_BASE_URL,
      domainName: event.requestContext?.domainName,
      rawPath: event.rawPath,
      rawQueryString: event.rawQueryString,
    });
    return { statusCode: 403, body: "Invalid signature" };
  }

  const params = parseFormBody(event);
  console.log("Parsed Twilio params:", params);

  if (path.endsWith("/answer")) return handleAnswer(followUpCallId, params);
  if (path.endsWith("/input")) return handleInput(followUpCallId, params);
  if (path.endsWith("/status")) return handleStatus(followUpCallId, params);

  return { statusCode: 404, body: "Not found" };
};

// ---------------------------------------------------------------------------
// /answer
// ---------------------------------------------------------------------------
async function handleAnswer(followUpCallId: string, params: Record<string, string>) {
  const call = await getCall(followUpCallId);
  if (!call || isTerminal(call.status)) {
    return xmlResponse(sayAndHangup("This call is no longer active. Goodbye."));
  }

  // Same context lookup Chime's SMA handler makes via direct invoke — also
  // records the "answered" audit event, so this route doesn't duplicate it.
  const contextRes = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.FETCH_PATIENT_CONTEXT_FN_NAME,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(
        JSON.stringify({
          patientId: call.patientId,
          appointmentId: call.appointmentId,
          doctorId: call.doctorId,
          followUpCallId,
        })
      ),
    })
  );
  const context = JSON.parse(Buffer.from(contextRes.Payload ?? []).toString() || "{}");

  if (!context.patientFound || !context.followUpCallsEnabled) {
    await recordCallEvent(followUpCallId, "opted_out", { detectedAtCallStart: true });
    await updateCallStatus(followUpCallId, "opted_out");
    return xmlResponse(sayAndHangup("I'm sorry, I'm not able to discuss any health information on this call. Goodbye."));
  }

  const firstName = context.firstName ?? "there";
  const doctorName = context.doctorName ?? "your doctor";

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `FOLLOWUP_CALL#${followUpCallId}`, SK: "DETAILS" },
      UpdateExpression:
        "SET conversationState = :state, fallbackCount = :zero, patientFirstName = :fn, doctorName = :dn, answeredAt = :now",
      ExpressionAttributeValues: {
        ":state": "asked_condition",
        ":zero": 0,
        ":fn": firstName,
        ":dn": doctorName,
        ":now": new Date().toISOString(),
      },
    })
  );
  await updateCallStatus(followUpCallId, "in_progress", { twilioCallSid: params.CallSid ?? null });

  const greeting =
    `Hello, this is Vitalis, an automated follow-up assistant calling on behalf of Dr. ${doctorName}. ` +
    `I'm calling to check how you're doing after your recent appointment. How are you feeling now?`;

  return xmlResponse(gatherSpeech(greeting, inputUrl(followUpCallId)));
}

// ---------------------------------------------------------------------------
// /input
// ---------------------------------------------------------------------------
async function handleInput(followUpCallId: string, params: Record<string, string>) {
  const call = await getCall(followUpCallId);
  if (!call || isTerminal(call.status)) {
    return xmlResponse(sayAndHangup("This call is no longer active. Goodbye."));
  }

  // Fresh re-check, every turn — never trust anything cached from /answer.
  const patientRes = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PATIENT#${call.patientId}`, SK: "PROFILE" } })
  );
  if (!patientRes.Item?.followUpCallsEnabled) {
    await recordCallEvent(followUpCallId, "opted_out", { detectedDuringCall: true });
    await endCall(followUpCallId, "UNKNOWN", null);
    return xmlResponse(sayAndHangup("I'm sorry, I'm not able to discuss any health information on this call. Goodbye."));
  }

  const speech = (params.SpeechResult || "").trim();
  const firstName = call.patientFirstName || "there";
  const doctorName = call.doctorName || "your doctor";

  if (call.conversationState === "awaiting_slot_choice") {
    return handleSlotChoiceTurn(followUpCallId, call, speech);
  }

  return handleConditionTurn(followUpCallId, call, speech, firstName, doctorName);
}

async function handleConditionTurn(
  followUpCallId: string,
  call: Record<string, any>,
  speech: string,
  firstName: string,
  doctorName: string
) {
  const session: ScriptSessionState = { fallbackCount: Number(call.fallbackCount ?? 0) };
  const intent: GeminiIntent = speech ? (await classifyConditionResponse(speech, doctorName)).intent : "UNKNOWN";
  const directive = mapIntentToDirective(intent, session, firstName, doctorName);

  await recordCallEvent(followUpCallId, directive.auditEvent, { intent });

  if (directive.notifyDoctor) await notifyDoctor(call, followUpCallId, directive.notifyDoctor);

  if (directive.action === "repeat_prompt") {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `FOLLOWUP_CALL#${followUpCallId}`, SK: "DETAILS" },
        UpdateExpression: "SET fallbackCount = :n",
        ExpressionAttributeValues: { ":n": session.fallbackCount + 1 },
      })
    );
    return xmlResponse(gatherSpeech(directive.message, inputUrl(followUpCallId)));
  }

  if (directive.action === "offer_slots") {
    const slotsRes = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.GET_NEXT_SLOTS_FN_NAME,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify({ doctorId: call.doctorId, count: 3 })),
      })
    );
    const { slots } = JSON.parse(Buffer.from(slotsRes.Payload ?? []).toString() || "{}");
    return offerSlots(followUpCallId, call, directive.message, slots || []);
  }

  // ask_schedule_preference / end_call / escalate_emergency / give_up all
  // just speak the directive's message; only endCall ones actually hang up.
  if (directive.endCall) {
    await endCall(followUpCallId, directive.outcome, null);
    return xmlResponse(sayAndHangup(directive.message));
  }

  return xmlResponse(gatherSpeech(directive.message, inputUrl(followUpCallId)));
}

async function offerSlots(followUpCallId: string, call: Record<string, any>, leadIn: string, slots: any[]) {
  if (slots.length === 0) {
    await endCall(followUpCallId, "PERSISTING", null);
    return xmlResponse(
      sayAndHangup(`${leadIn} I couldn't find any open times with your doctor right now. Please contact your clinic to schedule. Goodbye.`)
    );
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `FOLLOWUP_CALL#${followUpCallId}`, SK: "DETAILS" },
      UpdateExpression: "SET conversationState = :state, offeredSlots = :slots, fallbackCount = :zero",
      ExpressionAttributeValues: { ":state": "awaiting_slot_choice", ":slots": slots, ":zero": 0 },
    })
  );

  const optionsText = slots.map((s: any) => new Date(s.startTime).toLocaleString()).join(", ");
  return xmlResponse(gatherSpeech(`${leadIn} I found these times: ${optionsText}. Which would you like?`, inputUrl(followUpCallId)));
}

async function handleSlotChoiceTurn(followUpCallId: string, call: Record<string, any>, speech: string) {
  const offeredSlots: any[] = call.offeredSlots || [];
  const fallbackCount = Number(call.fallbackCount ?? 0);
  const { selectedIndex } = speech ? await resolveSlotChoice(speech, offeredSlots) : { selectedIndex: -1 };

  if (selectedIndex === -1) {
    if (fallbackCount < 1) {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `FOLLOWUP_CALL#${followUpCallId}`, SK: "DETAILS" },
          UpdateExpression: "SET fallbackCount = :n",
          ExpressionAttributeValues: { ":n": fallbackCount + 1 },
        })
      );
      return xmlResponse(gatherSpeech("Sorry, which time would you like?", inputUrl(followUpCallId)));
    }
    await endCall(followUpCallId, "PERSISTING", null);
    return xmlResponse(sayAndHangup("I'm having trouble catching that. Please contact your clinic to schedule. Goodbye."));
  }

  const chosen = offeredSlots[selectedIndex];
  const reserveRes = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.RESERVE_SLOT_AND_SCHEDULE_FN_NAME,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(
        JSON.stringify({
          doctorId: call.doctorId,
          patientId: call.patientId,
          slotStartTime: chosen.startTime,
          consultationType: chosen.consultationType,
          followUpCallId,
        })
      ),
    })
  );
  const result = JSON.parse(Buffer.from(reserveRes.Payload ?? []).toString() || "{}");

  if (!result.reserved) {
    // Race lost — someone else took it. Refetch and re-offer (never claim a
    // booking that didn't happen).
    const slotsRes = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.GET_NEXT_SLOTS_FN_NAME,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify({ doctorId: call.doctorId, count: 3 })),
      })
    );
    const { slots } = JSON.parse(Buffer.from(slotsRes.Payload ?? []).toString() || "{}");
    return offerSlots(followUpCallId, call, "I'm sorry, that time is no longer available. Let me check the other available times.", slots || []);
  }

  await endCall(followUpCallId, "APPOINTMENT_BOOKED", result.appointment.id);
  const when = new Date(chosen.startTime).toLocaleString();
  return xmlResponse(sayAndHangup(`Your appointment with Dr. ${call.doctorName || "your doctor"} has been scheduled for ${when}. Thank you. Take care.`));
}

// ---------------------------------------------------------------------------
// /status
// ---------------------------------------------------------------------------
async function handleStatus(followUpCallId: string, params: Record<string, string>) {
  const call = await getCall(followUpCallId);
  // No record, or already in a terminal state — idempotent no-op. Twilio
  // documents that status callbacks may be retried; this must never
  // double-process a terminal transition.
  if (!call || isTerminal(call.status)) return { statusCode: 200, body: "" };

  const status: string = params.CallStatus || "";

  if (status === "ringing") {
    await recordCallEvent(followUpCallId, "ringing", {});
  } else if (status === "completed") {
    await endCall(followUpCallId, null, null, { durationSeconds: Number(params.CallDuration) || undefined });
  } else if (["busy", "no-answer", "failed", "canceled"].includes(status)) {
    await recordCallEvent(followUpCallId, "failed", { twilioStatus: status });
    await updateCallStatus(followUpCallId, "failed", {
      outcome: status === "no-answer" ? "NO_ANSWER" : status === "busy" ? "BUSY" : "FAILED",
      endedAt: new Date().toISOString(),
    });
  }

  return { statusCode: 200, body: "" };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
async function getCall(followUpCallId: string) {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `FOLLOWUP_CALL#${followUpCallId}`, SK: "DETAILS" } })
  );
  return res.Item;
}

function isTerminal(status: string): boolean {
  return ["ended", "failed", "opted_out"].includes(status);
}

async function notifyDoctor(
  call: Record<string, any>,
  followUpCallId: string,
  notify: { type: string; message: string }
) {
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.NOTIFY_DOCTOR_FN_NAME,
      InvocationType: "Event",
      Payload: Buffer.from(
        JSON.stringify({
          doctorId: call.doctorId,
          type: notify.type,
          appointmentId: call.appointmentId,
          patientId: call.patientId,
          followUpCallId,
          message: notify.message,
        })
      ),
    })
  );
}

async function endCall(
  followUpCallId: string,
  outcome: string | null,
  bookedAppointmentId: string | null,
  extra: { durationSeconds?: number } = {}
) {
  const now = new Date().toISOString();
  await recordCallEvent(followUpCallId, "ended", { outcome, bookedAppointmentId });

  const call = await getCall(followUpCallId);
  const durationSeconds =
    extra.durationSeconds ??
    (call?.answeredAt ? Math.round((Date.now() - new Date(call.answeredAt).getTime()) / 1000) : undefined);

  await updateCallStatus(followUpCallId, "ended", {
    ...(outcome ? { outcome } : {}),
    ...(bookedAppointmentId ? { bookedAppointmentId, appointmentBooked: true } : {}),
    endedAt: now,
    ...(durationSeconds !== undefined ? { duration: durationSeconds } : {}),
  });
}

function inputUrl(followUpCallId: string): string {
  return `${process.env.PUBLIC_API_BASE_URL}/follow-up-calls/twilio/input?followUpCallId=${followUpCallId}`;
}

function verifyTwilioSignature(event: any): boolean {
  const signature = event.headers?.["x-twilio-signature"] || event.headers?.["X-Twilio-Signature"];
  if (!signature) return false;

  const url = `${process.env.PUBLIC_API_BASE_URL}${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;
  const params = parseFormBody(event);

  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN as string, signature, url, params);
}

function parseFormBody(event: any): Record<string, string> {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf-8") : event.body || "";
  const parsed = new URLSearchParams(raw);
  return Object.fromEntries(parsed.entries());
}
