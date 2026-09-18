export const CONSENT_VERSION = "1.0";

// Must match the inline duplicate in lambda/patients/index.ts exactly.
export const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;

// Follow-up calls can only be enabled when the phone number is valid E.164
// AND consent was given. Mirrors the gating logic in lambda/patients/index.ts.
export function computeFollowUpEnabled(phone: string, consentGiven: boolean): boolean {
  return PHONE_E164_REGEX.test(phone) && consentGiven;
}
