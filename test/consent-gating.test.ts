const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;

// Mirrors the gating rule in lambda/patients/index.ts PUT handler and
// frontend/app/(app)/patient/profile/page.tsx computeFollowUpEnabled.
function computeFollowUpEnabled(phone: string, consentGiven: boolean): boolean {
  return PHONE_E164_REGEX.test(phone) && consentGiven;
}

describe("computeFollowUpEnabled", () => {
  test("true when phone valid and consent given", () => {
    expect(computeFollowUpEnabled("+919876543210", true)).toBe(true);
  });

  test("false when phone invalid and consent given", () => {
    expect(computeFollowUpEnabled("9876543210", true)).toBe(false);
  });

  test("false when phone valid and consent not given", () => {
    expect(computeFollowUpEnabled("+919876543210", false)).toBe(false);
  });

  test("false when phone invalid and consent not given", () => {
    expect(computeFollowUpEnabled("", false)).toBe(false);
  });
});
