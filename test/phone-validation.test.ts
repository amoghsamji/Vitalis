// Must match the regex duplicated in lambda/patients/index.ts and
// frontend/lib/constants.ts PHONE_E164_REGEX.
const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;

describe("PHONE_E164_REGEX", () => {
  test.each(["+919876543210", "+14155552671"])("accepts valid E.164 number %s", (phone) => {
    expect(PHONE_E164_REGEX.test(phone)).toBe(true);
  });

  test.each([
    ["9876543210", "missing +"],
    ["+91 9876543210", "contains space"],
    ["+91-9876543210", "contains dash"],
    ["+911", "too short"],
    ["+0123456789", "leading 0 after +"],
  ])("rejects %s (%s)", (phone) => {
    expect(PHONE_E164_REGEX.test(phone)).toBe(false);
  });
});
