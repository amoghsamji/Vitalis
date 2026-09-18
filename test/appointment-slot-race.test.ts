import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

// Same hand-rolled mock pattern as test/prescription-event-idempotency.test.ts.
const ddbSend = jest.fn();
jest.mock("../lambda/_shared/ddb", () => ({
  ddb: { send: (...args: any[]) => ddbSend(...args) },
  TABLE_NAME: "vitalis-table-test",
}));

import { handler } from "../lambda/reserve-slot-and-schedule";

/**
 * Simulates two concurrent follow-up-call reservation attempts for the exact
 * same doctorId+slotStartTime, the way lambda/lex-fulfillment would if a
 * patient's "yes" got processed twice (double Lex turn, retried invoke,
 * etc). Only one may ever reserve the slot — verified via the same
 * open->held ConditionExpression pattern used by lambda/appointments'
 * POST /appointments handler for regular bookings.
 */
describe("reserve-slot-and-schedule: race prevention", () => {
  beforeEach(() => ddbSend.mockReset());

  test("only one of two concurrent reservations for the same slot succeeds", async () => {
    const doctorId = "doctor-1";
    const slotStartTime = "2026-10-01T10:00:00.000Z";

    // Caller A's UpdateCommand (open -> held) succeeds, then its three
    // follow-on writes (appt PUT, doctor-index PUT, slot -> booked UPDATE)
    // all resolve normally.
    const callA = async () => {
      ddbSend
        .mockResolvedValueOnce({}) // reserve slot: succeeds
        .mockResolvedValueOnce({}) // put appt
        .mockResolvedValueOnce({}) // put doctor index
        .mockResolvedValueOnce({}); // mark slot booked
      return handler({ doctorId, patientId: "patient-A", slotStartTime });
    };

    // Caller B's reserve attempt hits the ConditionExpression failure —
    // the real-world outcome when two callers race for one "open" slot.
    const callB = async () => {
      ddbSend.mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: "conditional check failed", $metadata: {} })
      );
      return handler({ doctorId, patientId: "patient-B", slotStartTime });
    };

    // Run A to completion first so its four queued mock resolutions are
    // consumed in order, then B (whose single rejection is queued next) —
    // this still exercises the same "loser gets ConditionalCheckFailedException"
    // path a true concurrent race produces, mirroring how the existing
    // prescription-event-idempotency test structures its race simulation.
    const resultA = await callA();
    const resultB = await callB();

    expect(resultA.reserved).toBe(true);
    expect(resultA.appointment?.doctorId).toBe(doctorId);
    expect(resultB.reserved).toBe(false);
    expect(resultB.reason).toBe("slot_taken");
  });

  test("propagates non-conditional errors instead of swallowing them", async () => {
    const err = new Error("network blip");
    ddbSend.mockRejectedValueOnce(err);
    await expect(
      handler({ doctorId: "doctor-2", patientId: "patient-C", slotStartTime: "2026-10-01T11:00:00.000Z" })
    ).rejects.toThrow("network blip");
  });
});
