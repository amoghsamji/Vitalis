/**
 * Pure, side-effect-free mapping from a Gemini-classified patient-response
 * intent (+ small bits of call state) to the call script step it corresponds
 * to. Mirrors lambda/lex-fulfillment/script.ts's shape exactly (same kind of
 * `{message, action, endCall, notifyDoctor, auditEvent}` directive, reusing
 * the exact CallEventName/DoctorNotificationType unions), just keyed on the
 * Gemini intent taxonomy instead of Lex intent names — kept separate from
 * index.ts so the branching logic is unit-testable without mocking Twilio/
 * DynamoDB/Lambda (see test/twilio-call-outcome-mapping.test.ts).
 */
import type { CallEventName } from "../_shared/callAudit";
import type { DoctorNotificationType } from "../notify-doctor";

export type GeminiIntent =
  | "FINE"
  | "IMPROVING"
  | "PERSISTING"
  | "WORSENING"
  | "REQUEST_APPOINTMENT"
  | "DECLINE_APPOINTMENT"
  | "CANNOT_TALK_NOW"
  | "UNKNOWN";

export interface ScriptSessionState {
  /** How many times UNKNOWN/low-confidence has fired in a row this call. */
  fallbackCount: number;
}

export type DirectiveAction =
  | "end_call"
  | "ask_schedule_preference"
  | "offer_slots"
  | "escalate_emergency"
  | "repeat_prompt"
  | "give_up";

export interface ScriptDirective {
  message: string;
  action: DirectiveAction;
  endCall: boolean;
  notifyDoctor: { type: DoctorNotificationType; message: string } | null;
  auditEvent: CallEventName;
  /** Set only when endCall is true — the call-history "outcome" column. */
  outcome: string | null;
}

const MAX_FALLBACK_REPEATS = 1;

export function mapIntentToDirective(
  intent: GeminiIntent,
  session: ScriptSessionState,
  patientFirstName = "there",
  doctorName = "your doctor"
): ScriptDirective {
  switch (intent) {
    case "FINE":
    case "IMPROVING":
      return {
        message:
          "I'm glad to hear that. Thank you for your time. Please continue following your care team's instructions, and take care.",
        action: "end_call",
        endCall: true,
        notifyDoctor: null,
        auditEvent: "intent_detected",
        outcome: intent,
      };

    case "PERSISTING":
      return {
        message: `I'm sorry to hear that. Would you like me to help you schedule another appointment with Dr. ${doctorName}?`,
        action: "ask_schedule_preference",
        endCall: false,
        notifyDoctor: {
          type: "persistent_symptoms",
          message: `${patientFirstName} reported persistent symptoms during their automated follow-up call.`,
        },
        auditEvent: "intent_detected",
        outcome: null,
      };

    // Never diagnoses or names a condition — only a safe escalation message,
    // per the spec's explicit constraint.
    case "WORSENING":
      return {
        message:
          "I'm sorry to hear that. I'm having your care team notified so they can follow up with you. " +
          "If you believe this is an emergency, please contact your local emergency service or seek immediate medical care.",
        action: "escalate_emergency",
        endCall: true,
        notifyDoctor: {
          type: "emergency_symptoms",
          message: `${patientFirstName} reported worsening symptoms during their automated follow-up call. No diagnosis or scheduling occurred on the call.`,
        },
        auditEvent: "intent_detected",
        outcome: "WORSENING",
      };

    case "REQUEST_APPOINTMENT":
      return {
        message: `Sure — let me find the next available times with Dr. ${doctorName}.`,
        action: "offer_slots",
        endCall: false,
        notifyDoctor: {
          type: "follow_up_requested",
          message: `${patientFirstName} asked to schedule a follow-up appointment during their automated call.`,
        },
        auditEvent: "appointment_offered",
        outcome: null,
      };

    // Response to the PERSISTING branch's "would you like to schedule?" —
    // mirrors Lex's separate DeclineFollowUp intent (step F).
    case "DECLINE_APPOINTMENT":
      return {
        message: "Understood. Please contact your clinic if you need further assistance. Take care.",
        action: "end_call",
        endCall: true,
        notifyDoctor: null,
        auditEvent: "intent_detected",
        outcome: "PERSISTING",
      };

    case "CANNOT_TALK_NOW":
      return {
        message: "No problem — we'll try reaching you another time. Take care.",
        action: "end_call",
        endCall: true,
        notifyDoctor: null,
        auditEvent: "intent_detected",
        outcome: "UNKNOWN",
      };

    case "UNKNOWN":
    default: {
      if (session.fallbackCount < MAX_FALLBACK_REPEATS) {
        return {
          message: "Sorry, I didn't quite catch that. Are you feeling better, or does the problem still persist?",
          action: "repeat_prompt",
          endCall: false,
          notifyDoctor: null,
          auditEvent: "intent_detected",
          outcome: null,
        };
      }
      return {
        message: "I'm having trouble understanding. Your care team will follow up with you directly. Goodbye for now.",
        action: "give_up",
        endCall: true,
        notifyDoctor: {
          type: "patient_unreachable",
          message: `Automated follow-up call with ${patientFirstName} ended without a clear response — please follow up directly.`,
        },
        auditEvent: "intent_detected",
        outcome: "UNKNOWN",
      };
    }
  }
}
