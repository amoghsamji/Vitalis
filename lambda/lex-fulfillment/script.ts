/**
 * Pure, side-effect-free mapping from a detected Lex V2 intent name (+ small
 * bits of session state) to the call script step it corresponds to (see the
 * spec's steps A-H). Kept separate from index.ts (the actual Lex fulfillment
 * handler, which does the AWS calls) so the branching logic itself — the
 * part reviewers actually care about getting right — is unit-testable
 * without mocking DynamoDB/Lambda/Connect. index.ts is a thin wrapper that
 * calls this function and then executes whatever `directive` it returns.
 */
export type IntentName =
  | "PatientIsFine"
  | "ProblemPersists"
  | "ScheduleFollowUp"
  | "DeclineFollowUp"
  | "EmergencySymptoms"
  | "FallbackIntent";

export interface ScriptSessionState {
  /** How many times FallbackIntent has fired in a row this call. */
  fallbackCount: number;
  /** True once step B's "are you feeling better, or does it persist" has been asked. */
  verified: boolean;
}

export type DirectiveAction =
  | "end_call"
  | "ask_schedule_preference"
  | "offer_slots"
  | "confirm_appointment"
  | "escalate_emergency"
  | "repeat_prompt"
  | "offer_transfer_then_end";

export interface ScriptDirective {
  message: string;
  action: DirectiveAction;
  endCall: boolean;
  notifyDoctor: {
    type: "persistent_symptoms" | "follow_up_requested" | "emergency_symptoms" | "patient_unreachable";
    message: string;
  } | null;
  /** Which call-audit event name (see lambda/_shared/callAudit.ts) this step logs. */
  auditEvent: "intent_detected" | "appointment_offered" | "appointment_scheduled" | "opted_out";
}

const MAX_FALLBACK_REPEATS = 1;

/**
 * @param intentName        The Lex-resolved intent for this turn.
 * @param session            Running state for this call (fallback count etc).
 * @param patientFirstName   Used to personalize a couple of messages.
 */
export function mapIntentToDirective(
  intentName: IntentName,
  session: ScriptSessionState,
  patientFirstName = "there"
): ScriptDirective {
  switch (intentName) {
    // Step C
    case "PatientIsFine":
      return {
        message:
          "Thank you for the update. Please follow your care team's instructions. If you need help, contact your clinic. Take care.",
        action: "end_call",
        endCall: true,
        notifyDoctor: null,
        auditEvent: "intent_detected",
      };

    // Step D
    case "ProblemPersists":
      return {
        message: "I'm sorry to hear that. Would you like me to help schedule a follow-up appointment?",
        action: "ask_schedule_preference",
        endCall: false,
        notifyDoctor: {
          type: "persistent_symptoms",
          message: `${patientFirstName} reported persistent symptoms during their automated follow-up call.`,
        },
        auditEvent: "intent_detected",
      };

    // Step E (yes branch) — the offer itself; actual slot fetch/reservation
    // happens in index.ts using lambda/get-next-slots and
    // lambda/reserve-slot-and-schedule, then confirm_appointment is used to
    // read back date/time/doctor/type.
    case "ScheduleFollowUp":
      return {
        message: "Sure — let me find the next available times with your doctor.",
        action: "offer_slots",
        endCall: false,
        notifyDoctor: {
          type: "follow_up_requested",
          message: `${patientFirstName} asked to schedule a follow-up appointment during their automated call.`,
        },
        auditEvent: "appointment_offered",
      };

    // Step F (no branch)
    case "DeclineFollowUp":
      return {
        message: "Understood. Please contact your clinic if you need further assistance.",
        action: "end_call",
        endCall: true,
        notifyDoctor: null,
        auditEvent: "intent_detected",
      };

    // Step G — never diagnose, never offer routine scheduling.
    case "EmergencySymptoms":
      return {
        message:
          "This sounds like it may need urgent attention. Please hang up and call 911 or go to your nearest emergency room right away. Your care team is also being notified.",
        action: "escalate_emergency",
        endCall: true,
        notifyDoctor: {
          type: "emergency_symptoms",
          message: `${patientFirstName} reported possible emergency symptoms during their automated follow-up call. Urgent-care guidance was given; no scheduling or diagnosis occurred on the call.`,
        },
        auditEvent: "intent_detected",
      };

    // Step H — low confidence / silence / repeated fallback.
    case "FallbackIntent":
    default: {
      if (session.fallbackCount < MAX_FALLBACK_REPEATS) {
        return {
          message: "Sorry, I didn't quite catch that. Are you feeling better, or does the problem still persist?",
          action: "repeat_prompt",
          endCall: false,
          notifyDoctor: null,
          auditEvent: "intent_detected",
        };
      }
      return {
        message:
          "I'm having trouble understanding. I can transfer you to your clinic now, or have your care team call you back. Either way, we'll follow up. Goodbye for now.",
        action: "offer_transfer_then_end",
        endCall: true,
        notifyDoctor: {
          type: "patient_unreachable",
          message: `Automated follow-up call with ${patientFirstName} ended in fallback (could not understand responses) — please follow up directly.`,
        },
        auditEvent: "intent_detected",
      };
    }
  }
}
