import { mapIntentToDirective, type ScriptSessionState } from "../lambda/lex-fulfillment/script";

const freshSession: ScriptSessionState = { fallbackCount: 0, verified: true };

describe("mapIntentToDirective: call-outcome intent mapping", () => {
  test("PatientIsFine -> step C, thanks + ends call, no doctor notification", () => {
    const d = mapIntentToDirective("PatientIsFine", freshSession, "Amogh");
    expect(d.endCall).toBe(true);
    expect(d.action).toBe("end_call");
    expect(d.notifyDoctor).toBeNull();
    expect(d.message).toMatch(/follow your care team's instructions/i);
  });

  test("ProblemPersists -> step D, offers scheduling, notifies doctor of persistent symptoms", () => {
    const d = mapIntentToDirective("ProblemPersists", freshSession, "Amogh");
    expect(d.endCall).toBe(false);
    expect(d.action).toBe("ask_schedule_preference");
    expect(d.notifyDoctor?.type).toBe("persistent_symptoms");
    expect(d.message).toMatch(/schedule a follow-up appointment/i);
  });

  test("ScheduleFollowUp -> step E, offers slots, notifies doctor of the request", () => {
    const d = mapIntentToDirective("ScheduleFollowUp", freshSession, "Amogh");
    expect(d.endCall).toBe(false);
    expect(d.action).toBe("offer_slots");
    expect(d.notifyDoctor?.type).toBe("follow_up_requested");
    expect(d.auditEvent).toBe("appointment_offered");
  });

  test("DeclineFollowUp -> step F, ends call, no doctor notification", () => {
    const d = mapIntentToDirective("DeclineFollowUp", freshSession, "Amogh");
    expect(d.endCall).toBe(true);
    expect(d.action).toBe("end_call");
    expect(d.notifyDoctor).toBeNull();
  });

  test("EmergencySymptoms -> step G, urgent-care message, high-priority notification, ends call, never schedules or diagnoses", () => {
    const d = mapIntentToDirective("EmergencySymptoms", freshSession, "Amogh");
    expect(d.endCall).toBe(true);
    expect(d.action).toBe("escalate_emergency");
    expect(d.notifyDoctor?.type).toBe("emergency_symptoms");
    expect(d.message).toMatch(/911|emergency room/i);
    expect(d.message).not.toMatch(/schedule/i);
  });

  test("FallbackIntent -> step H, first occurrence repeats the prompt without ending the call", () => {
    const d = mapIntentToDirective("FallbackIntent", { fallbackCount: 0, verified: true }, "Amogh");
    expect(d.endCall).toBe(false);
    expect(d.action).toBe("repeat_prompt");
    expect(d.notifyDoctor).toBeNull();
  });

  test("FallbackIntent -> step H, repeated fallback offers transfer/callback then ends safely and flags an unreachable patient", () => {
    const d = mapIntentToDirective("FallbackIntent", { fallbackCount: 1, verified: true }, "Amogh");
    expect(d.endCall).toBe(true);
    expect(d.action).toBe("offer_transfer_then_end");
    expect(d.notifyDoctor?.type).toBe("patient_unreachable");
  });

  test("unknown/unrecognized intent name falls back to the fallback-intent script rather than throwing", () => {
    const d = mapIntentToDirective("SomethingLexNeverEmits" as any, freshSession, "Amogh");
    expect(d.action).toBe("repeat_prompt");
  });
});
