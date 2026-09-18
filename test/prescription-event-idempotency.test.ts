import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

// Hand-rolled mocks for ddb.send and EventBridge.send (no aws-sdk-client-mock
// dependency needed) — simulates two concurrent callers racing to write the
// same idempotency marker for the same appointment.
const ddbSend = jest.fn();
jest.mock("../lambda/_shared/ddb", () => ({
  ddb: { send: (...args: any[]) => ddbSend(...args) },
  TABLE_NAME: "vitalis-table-test",
}));

const eventBridgeSend = jest.fn();
jest.mock("@aws-sdk/client-eventbridge", () => {
  const actual = jest.requireActual("@aws-sdk/client-eventbridge");
  return {
    ...actual,
    EventBridgeClient: jest.fn().mockImplementation(() => ({ send: (...args: any[]) => eventBridgeSend(...args) })),
  };
});

import { emitPrescriptionUploadedIfReady } from "../lambda/_shared/prescriptionEvent";

describe("emitPrescriptionUploadedIfReady", () => {
  beforeEach(() => {
    ddbSend.mockReset();
    eventBridgeSend.mockReset();
  });

  test("fires PutEvents exactly once when two calls race on the same appointment", async () => {
    const appointmentId = "appt-1";
    const appt = { status: "completed", patientId: "patient-1", doctorId: "doctor-1" };
    const prescription = { id: "rx-1" };

    // Sequence for call #1: get appointment, query prescription, conditional put (succeeds)
    // Sequence for call #2: get appointment, query prescription, conditional put (rejects)
    ddbSend
      .mockResolvedValueOnce({ Item: appt }) // call 1: GetCommand appointment
      .mockResolvedValueOnce({ Items: [prescription] }) // call 1: QueryCommand prescription
      .mockResolvedValueOnce({}) // call 1: PutCommand marker succeeds
      .mockResolvedValueOnce({ Item: appt }) // call 2: GetCommand appointment
      .mockResolvedValueOnce({ Items: [prescription] }) // call 2: QueryCommand prescription
      .mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: "already exists", $metadata: {} })
      ); // call 2: PutCommand marker rejected

    eventBridgeSend.mockResolvedValue({});

    // Run sequentially (rather than via Promise.all) so each call's three
    // sequential ddb.send steps consume the queued mocks in the intended
    // order — this still exercises the same "second caller loses the
    // conditional write" idempotency path as a real race would.
    await emitPrescriptionUploadedIfReady(appointmentId);
    await emitPrescriptionUploadedIfReady(appointmentId);

    expect(eventBridgeSend).toHaveBeenCalledTimes(1);
  });

  test("no-ops when appointment isn't completed yet", async () => {
    ddbSend.mockResolvedValueOnce({ Item: { status: "confirmed" } });
    await emitPrescriptionUploadedIfReady("appt-2");
    expect(eventBridgeSend).not.toHaveBeenCalled();
  });

  test("no-ops when no prescription exists yet", async () => {
    ddbSend
      .mockResolvedValueOnce({ Item: { status: "completed", patientId: "p", doctorId: "d" } })
      .mockResolvedValueOnce({ Items: [] });
    await emitPrescriptionUploadedIfReady("appt-3");
    expect(eventBridgeSend).not.toHaveBeenCalled();
  });
});
