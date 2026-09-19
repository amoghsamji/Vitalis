import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

// Same hand-rolled mock pattern as test/appointment-slot-race.test.ts and
// test/prescription-event-idempotency.test.ts.
const ddbSend = jest.fn();
jest.mock("../lambda/_shared/ddb", () => ({
  ddb: { send: (...args: any[]) => ddbSend(...args) },
  TABLE_NAME: "vitalis-table-test",
  jsonResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getClaims: (event: any) => event?.requestContext?.authorizer?.jwt?.claims ?? null,
}));

const eventBridgeSend = jest.fn();
jest.mock("@aws-sdk/client-eventbridge", () => {
  const actual = jest.requireActual("@aws-sdk/client-eventbridge");
  return {
    ...actual,
    EventBridgeClient: jest.fn().mockImplementation(() => ({ send: (...args: any[]) => eventBridgeSend(...args) })),
  };
});

import { handler } from "../lambda/appointments";

function putRequest(apptId: string, doctorSub: string, status: "confirmed" | "rejected") {
  return {
    requestContext: {
      http: { method: "PUT" },
      authorizer: { jwt: { claims: { sub: doctorSub } } },
    },
    rawPath: `/appointments/${apptId}`,
    pathParameters: { id: apptId },
    body: JSON.stringify({ status }),
  };
}

describe("PUT /appointments/{id} — doctor accept/reject", () => {
  beforeEach(() => {
    ddbSend.mockReset();
    eventBridgeSend.mockReset();
  });

  test("assigned doctor can accept a pending request", async () => {
    ddbSend
      .mockResolvedValueOnce({ Item: { doctorId: "doctor-1", startTime: "2026-10-01T10:00:00.000Z", status: "pending" } })
      .mockResolvedValueOnce({ Attributes: { status: "confirmed" } });

    const res = await handler(putRequest("appt-1", "doctor-1", "confirmed"));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("confirmed");
    expect(ddbSend).toHaveBeenCalledTimes(2); // Get + conditional Update, no slot release
  });

  test("a doctor who doesn't own the appointment gets 403", async () => {
    ddbSend.mockResolvedValueOnce({
      Item: { doctorId: "doctor-1", startTime: "2026-10-01T10:00:00.000Z", status: "pending" },
    });

    const res = await handler(putRequest("appt-1", "doctor-2", "confirmed"));

    expect(res.statusCode).toBe(403);
    expect(ddbSend).toHaveBeenCalledTimes(1); // only the Get — no Update attempted
  });

  test("responding to an already-answered request returns 409", async () => {
    ddbSend
      .mockResolvedValueOnce({ Item: { doctorId: "doctor-1", startTime: "2026-10-01T10:00:00.000Z", status: "pending" } })
      .mockRejectedValueOnce(
        new ConditionalCheckFailedException({ message: "conditional check failed", $metadata: {} })
      );

    const res = await handler(putRequest("appt-1", "doctor-1", "confirmed"));

    expect(res.statusCode).toBe(409);
  });

  test("rejecting a pending request releases the slot back to open", async () => {
    ddbSend
      .mockResolvedValueOnce({ Item: { doctorId: "doctor-1", startTime: "2026-10-01T10:00:00.000Z", status: "pending" } })
      .mockResolvedValueOnce({ Attributes: { status: "rejected" } })
      .mockResolvedValueOnce({}); // slot release UpdateCommand

    const res = await handler(putRequest("appt-1", "doctor-1", "rejected"));

    expect(res.statusCode).toBe(200);
    expect(ddbSend).toHaveBeenCalledTimes(3);
    const slotReleaseCall = ddbSend.mock.calls[2][0];
    expect(slotReleaseCall.input.Key).toEqual({ PK: "DOCTOR#doctor-1", SK: "SLOT#2026-10-01T10:00:00.000Z" });
    expect(slotReleaseCall.input.ExpressionAttributeValues).toEqual({ ":open": "open" });
  });
});
