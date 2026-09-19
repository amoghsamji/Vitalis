import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { recordCallEvent, updateCallStatus } from "../_shared/callAudit";

const lambdaClient = new LambdaClient({});

/**
 * Amazon Chime SDK Voice (PSTN Audio) SIP media application Lambda —
 * outbound-only. This is Chime's equivalent of the Connect contact flow, and
 * exists because Connect can't be provisioned on this AWS account (AISPL
 * billing restriction — see lib/vitalis-stack.ts). Chime invokes this
 * function directly for every state change on a call; it responds with the
 * next call-control action(s) to take.
 *
 * Only the events this feature actually uses are handled:
 *   NEW_OUTBOUND_CALL   -> resolve context via fetch-patient-context (same
 *                          Lambda the old Connect contact flow invoked), then
 *                          either Hangup (not eligible) or StartBotConversation
 *                          against the same Lex bot lex-fulfillment already
 *                          serves — no changes needed there at all.
 *   ACTIONS_SUCCESSFUL / -> the Lex conversation ended (Close, or Lex gave up).
 *   ACTION_FAILED          Record it and hang up; lex-fulfillment already
 *                          recorded the specific business outcome per turn.
 *   HANGUP              -> caller/carrier ended the call outside the above
 *                          (no answer, mid-call drop). Record and no-op.
 *
 * The five non-sensitive ids (patientId/appointmentId/doctorId/
 * prescriptionId/followUpCallId) only arrive once, in NEW_OUTBOUND_CALL's
 * ArgumentsMap (set by outbound-call-initiator's CreateSipMediaApplicationCall
 * call). They're carried forward via Chime's TransactionAttributes, which
 * persist for the life of the call across every later invocation for the
 * same CallId — no DynamoDB round trip needed just to remember which call
 * this is.
 */
export const handler = async (event: any) => {
  const invocationType = event?.InvocationEventType;
  const transactionAttributes = event?.CallDetails?.TransactionAttributes ?? {};

  if (invocationType === "NEW_OUTBOUND_CALL") {
    return handleNewOutboundCall(event);
  }

  const followUpCallId: string | undefined = transactionAttributes.followUpCallId;

  if (invocationType === "ACTIONS_SUCCESSFUL" || invocationType === "ACTION_FAILED") {
    const actionType = event?.ActionData?.Type;
    if (actionType === "StartBotConversation" && followUpCallId) {
      await recordCallEvent(followUpCallId, "ended", {
        reason: invocationType === "ACTION_FAILED" ? "bot_action_failed" : "bot_conversation_completed",
        actionData: invocationType === "ACTION_FAILED" ? event?.ErrorType ?? null : undefined,
      });
      await updateCallStatus(followUpCallId, invocationType === "ACTION_FAILED" ? "failed" : "ended");
    }
    return respond([hangupAction()]);
  }

  if (invocationType === "HANGUP") {
    if (followUpCallId) {
      await recordCallEvent(followUpCallId, "ended", { reason: "hangup" });
      await updateCallStatus(followUpCallId, "ended");
    }
    return respond([]);
  }

  // Anything else (RINGING, CALL_ANSWERED, etc.) — no action needed.
  return respond([]);
};

async function handleNewOutboundCall(event: any) {
  const args = event?.ArgumentsMap ?? {};
  const { patientId, appointmentId, doctorId, prescriptionId, followUpCallId } = args;

  if (!followUpCallId) {
    // Nothing to audit against — refuse to guess. Hang up rather than start
    // a conversation with no way to record what happened on it.
    return respond([hangupAction()]);
  }

  // Same context lookup the Connect contact flow used to make as an
  // "Invoke AWS Lambda function" block — reused verbatim via direct invoke.
  // It also records the "answered" audit event.
  const contextRes = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.FETCH_PATIENT_CONTEXT_FN_NAME,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({ patientId, appointmentId, doctorId, followUpCallId })),
    })
  );
  const context = JSON.parse(Buffer.from(contextRes.Payload ?? []).toString() || "{}");

  if (!context.patientFound || !context.followUpCallsEnabled) {
    await recordCallEvent(followUpCallId, "opted_out", { detectedAtCallStart: true });
    await updateCallStatus(followUpCallId, "opted_out");
    return respond([hangupAction()], { followUpCallId });
  }

  const sessionAttributes: Record<string, string> = {
    followUpCallId,
    patientId: patientId ?? "",
    doctorId: doctorId ?? "",
    appointmentId: appointmentId ?? "",
    prescriptionId: prescriptionId ?? "",
    patientFirstName: context.firstName ?? "there",
    fallbackCount: "0",
    verified: "false",
  };

  const welcomeMessage =
    `Hello ${context.firstName ?? "there"}, this is an automated follow-up call from ` +
    `${context.doctorName ?? "your doctor"}'s office regarding your recent ${context.appointmentType ?? "appointment"}. ` +
    `How are you feeling?`;

  return respond(
    [
      {
        Type: "StartBotConversation",
        Parameters: {
          BotAliasArn: process.env.LEX_BOT_ALIAS_ARN,
          LocaleId: "en_US",
          Configuration: {
            SessionState: {
              SessionAttributes: sessionAttributes,
              DialogAction: { Type: "ElicitIntent" },
            },
            WelcomeMessages: [{ Content: welcomeMessage, ContentType: "PlainText" }],
          },
        },
      },
    ],
    // Persist the ids for every later invocation of this same call (see
    // module doc comment) — this is the only invocation type that ever sees
    // ArgumentsMap, so it's the only place these need to be written down.
    { patientId, appointmentId, doctorId, prescriptionId, followUpCallId }
  );
}

function hangupAction() {
  return { Type: "Hangup", Parameters: { SipResponseCode: "0", ParticipantTag: "" } };
}

function respond(actions: unknown[], transactionAttributes?: Record<string, unknown>) {
  return {
    SchemaVersion: "1.0",
    Actions: actions,
    ...(transactionAttributes ? { TransactionAttributes: transactionAttributes } : {}),
  };
}
