import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../_shared/ddb";
import { recordCallEvent } from "../_shared/callAudit";
import { mapIntentToDirective, type IntentName, type ScriptSessionState } from "./script";

const lambdaClient = new LambdaClient({});

/**
 * Lex V2 code-hook Lambda (DialogCodeHook + FulfillmentCodeHook), associated
 * with the CfnBot in lib/vitalis-stack.ts. The Connect contact flow transfers
 * the call to this bot for the whole conversation; this Lambda does the
 * actual branching (see script.ts) and any side effects (paging the doctor,
 * offering/reserving a slot). It re-checks patient consent/eligibility via
 * fetch-patient-context's underlying data before doing anything sensitive,
 * consistent with the "verify every time, not just at enqueue" rule.
 */
export const handler = async (lexEvent: any) => {
  const sessionAttrs = lexEvent.sessionState?.sessionAttributes ?? {};
  const followUpCallId: string | undefined = sessionAttrs.followUpCallId;
  const patientFirstName: string = sessionAttrs.patientFirstName || "there";
  const doctorId: string | undefined = sessionAttrs.doctorId;
  const patientId: string | undefined = sessionAttrs.patientId;
  const appointmentId: string | undefined = sessionAttrs.appointmentId;

  const intentName = (lexEvent.sessionState?.intent?.name ?? "FallbackIntent") as IntentName;
  const session: ScriptSessionState = {
    fallbackCount: Number(sessionAttrs.fallbackCount ?? 0),
    verified: sessionAttrs.verified === "true",
  };

  // Patient opted out (or was never eligible) between when the call was
  // dialed and this turn — never continue with medical content. Checked
  // fresh from DynamoDB, not from session attributes, since those are only
  // as fresh as the last turn.
  if (patientId) {
    const patientRes = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: `PATIENT#${patientId}`, SK: "PROFILE" } })
    );
    if (!patientRes.Item?.followUpCallsEnabled) {
      if (followUpCallId) await recordCallEvent(followUpCallId, "opted_out", { detectedDuringCall: true });
      return closeResponse(
        lexEvent,
        "I'm sorry, I'm not able to discuss any health information on this call. Goodbye.",
        { fallbackCount: "0" }
      );
    }
  }

  const directive = mapIntentToDirective(intentName, session, patientFirstName);

  if (followUpCallId) {
    await recordCallEvent(followUpCallId, directive.auditEvent, { intent: intentName });
  }

  if (directive.notifyDoctor && doctorId && appointmentId && patientId) {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.NOTIFY_DOCTOR_FN_NAME,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({
            doctorId,
            type: directive.notifyDoctor.type,
            appointmentId,
            patientId,
            followUpCallId,
            message: directive.notifyDoctor.message,
          })
        ),
      })
    );
  }

  const newSessionAttrs = {
    ...sessionAttrs,
    fallbackCount: intentName === "FallbackIntent" ? String(session.fallbackCount + 1) : "0",
    verified: "true",
  };

  // Emergency / decline / fine / transfer-then-end all close the dialog.
  if (directive.endCall) {
    if (followUpCallId) await recordCallEvent(followUpCallId, "ended", { finalIntent: intentName });
    return closeResponse(lexEvent, directive.message, newSessionAttrs);
  }

  // ScheduleFollowUp: fetch slots and hand them back as an ElicitSlot-style
  // message; actual reservation happens on a follow-up turn once the patient
  // states a preference, via reserve-slot-and-schedule (kept as a distinct
  // Lambda so it can enforce the same atomic conditional write used by the
  // normal booking API — see that file for the race-prevention logic).
  if (directive.action === "offer_slots" && doctorId) {
    const slotsRes = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.GET_NEXT_SLOTS_FN_NAME,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify({ doctorId, count: 3 })),
      })
    );
    const payload = JSON.parse(Buffer.from(slotsRes.Payload ?? []).toString() || "{}");
    const slots = payload.slots ?? [];
    const optionsText = slots
      .map((s: any, i: number) => `option ${i + 1}: ${new Date(s.startTime).toLocaleString()}`)
      .join(", ");
    return elicitResponse(
      lexEvent,
      slots.length
        ? `${directive.message} I found these times: ${optionsText}. Which would you like?`
        : "I couldn't find any open times with your doctor right now. Please contact your clinic to schedule. Goodbye.",
      { ...newSessionAttrs, offeredSlots: JSON.stringify(slots) }
    );
  }

  return elicitResponse(lexEvent, directive.message, newSessionAttrs);
};

function closeResponse(lexEvent: any, message: string, sessionAttributes: Record<string, string>) {
  return {
    sessionState: {
      sessionAttributes,
      dialogAction: { type: "Close" },
      intent: { ...lexEvent.sessionState?.intent, state: "Fulfilled" },
    },
    messages: [{ contentType: "PlainText", content: message }],
  };
}

function elicitResponse(lexEvent: any, message: string, sessionAttributes: Record<string, string>) {
  return {
    sessionState: {
      sessionAttributes,
      dialogAction: { type: "ElicitIntent" },
      intent: { ...lexEvent.sessionState?.intent, state: "InProgress" },
    },
    messages: [{ contentType: "PlainText", content: message }],
  };
}
