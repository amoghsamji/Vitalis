import { mapIntentToDirective, type ScriptSessionState } from "../lambda/twilio-voice/script";

const freshSession: ScriptSessionState = { fallbackCount: 0 };

describe("mapIntentToDirective (Twilio/Gemini): call-outcome intent mapping", () => {
  test("FINE -> thanks + ends call, no doctor notification, outcome FINE", () => {
    const d = mapIntentToDirective("FINE", freshSession, "Amogh", "Sharma");
    expect(d.endCall).toBe(true);
    expect(d.action).toBe("end_call");
    expect(d.notifyDoctor).toBeNull();
    expect(d.outcome).toBe("FINE");
  });

  test("IMPROVING -> ends call, no doctor notification, outcome IMPROVING", () => {
    const d = mapIntentToDirective("IMPROVING", freshSession, "Amogh", "Sharma");
    expect(d.endCall).toBe(true);
    expect(d.notifyDoctor).toBeNull();
    expect(d.outcome).toBe("IMPROVING");
  });

  test("PERSISTING -> offers scheduling, notifies doctor of persistent symptoms, doesn't end the call", () => {
    const d = mapIntentToDirective("PERSISTING", freshSession, "Amogh", "Sharma");
    expect(d.endCall).toBe(false);
    expect(d.action).toBe("ask_schedule_preference");
    expect(d.notifyDoctor?.type).toBe("persistent_symptoms");
    expect(d.outcome).toBeNull();
  });

  test("WORSENING -> escalation message, high-priority notification, ends call, never diagnoses or schedules", () => {
    const d = mapIntentToDirective("WORSENING", freshSession, "Amogh", "Sharma");
    expect(d.endCall).toBe(true);
    expect(d.action).toBe("escalate_emergency");
    expect(d.notifyDoctor?.type).toBe("emergency_symptoms");
    expect(d.message).not.toMatch(/schedule/i);
    expect(d.outcome).toBe("WORSENING");
  });

  test("REQUEST_APPOINTMENT -> offers slots, notifies doctor, doesn't end the call", () => {
    const d = mapIntentToDirective("REQUEST_APPOINTMENT", freshSession, "Amogh", "Sharma");
    expect(d.endCall).toBe(false);
    expect(d.action).toBe("offer_slots");
    expect(d.notifyDoctor?.type).toBe("follow_up_requested");
    expect(d.auditEvent).toBe("appointment_offered");
  });

  test("DECLINE_APPOINTMENT -> ends call, no notification, outcome PERSISTING", () => {
    const d = mapIntentToDirective("DECLINE_APPOINTMENT", freshSession, "Amogh", "Sharma");
    expect(d.endCall).toBe(true);
    expect(d.notifyDoctor).toBeNull();
    expect(d.outcome).toBe("PERSISTING");
  });

  test("CANNOT_TALK_NOW -> ends call politely, no notification", () => {
    const d = mapIntentToDirective("CANNOT_TALK_NOW", freshSession, "Amogh", "Sharma");
    expect(d.endCall).toBe(true);
    expect(d.notifyDoctor).toBeNull();
    expect(d.outcome).toBe("UNKNOWN");
  });

  test("UNKNOWN -> first occurrence repeats the prompt without ending the call", () => {
    const d = mapIntentToDirective("UNKNOWN", { fallbackCount: 0 }, "Amogh", "Sharma");
    expect(d.endCall).toBe(false);
    expect(d.action).toBe("repeat_prompt");
    expect(d.notifyDoctor).toBeNull();
  });

  test("UNKNOWN -> repeated fallback gives up safely and flags an unreachable patient", () => {
    const d = mapIntentToDirective("UNKNOWN", { fallbackCount: 1 }, "Amogh", "Sharma");
    expect(d.endCall).toBe(true);
    expect(d.action).toBe("give_up");
    expect(d.notifyDoctor?.type).toBe("patient_unreachable");
  });

  test("unrecognized intent falls back to the UNKNOWN script rather than throwing", () => {
    const d = mapIntentToDirective("SomethingGeminiNeverEmits" as any, freshSession, "Amogh", "Sharma");
    expect(d.action).toBe("repeat_prompt");
  });
});
