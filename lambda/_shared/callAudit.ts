import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";

/**
 * Audit trail for automated follow-up calls. Every call gets exactly one
 * FOLLOWUP_CALL#<id> / DETAILS item (the call record) plus an append-only
 * sequence of FOLLOWUP_CALL#<id> / EVENT#<isoTimestamp>#<seq> items — one per
 * lifecycle transition. GSI1PK APPT_FOLLOWUP#<appointmentId> lets callers
 * find the (at most one live) follow-up call for a given appointment, which
 * is also how idempotency is enforced (see lambda/follow-up-calls).
 *
 * Allowed event names (matches the spec's audit list exactly):
 *   requested | initiated | answered | verified | intent_detected |
 *   appointment_offered | appointment_scheduled | opted_out | failed | ended
 */
export type CallEventName =
  | "requested"
  | "initiated"
  | "answered"
  | "verified"
  | "intent_detected"
  | "appointment_offered"
  | "appointment_scheduled"
  | "opted_out"
  | "failed"
  | "ended";

export async function recordCallEvent(
  followUpCallId: string,
  eventName: CallEventName,
  detail: Record<string, unknown> = {}
): Promise<void> {
  const timestamp = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `FOLLOWUP_CALL#${followUpCallId}`,
        SK: `EVENT#${timestamp}#${eventName}`,
        followUpCallId,
        event: eventName,
        // Never store raw audio or prescription/diagnosis contents here — only
        // non-sensitive routing/outcome facts (slot chosen, intent name, etc).
        detail,
        timestamp,
      },
    })
  );
}

export async function findActiveFollowUpCallForAppointment(appointmentId: string) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `APPT_FOLLOWUP#${appointmentId}` },
    })
  );
  const items = result.Items || [];
  // "Active" = not failed/ended/opted_out terminal-with-no-retry. Retries are
  // only for technical initiation failures (see outbound-call-initiator), so
  // a "failed" record with retriesExhausted=false is still considered active
  // for idempotency purposes (don't fire a second parallel call).
  return items.find((i) => !["ended", "opted_out"].includes(i.status)) ?? items[0] ?? null;
}
