import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../_shared/ddb";

/**
 * Invoked (direct Lambda invoke, or via Lex fulfillment) to find the next N
 * open slots for a doctor, for the "schedule a follow-up appointment" branch
 * of the call script (step E). Read-only — reserving a slot happens in
 * lambda/reserve-slot-and-schedule, atomically, only once the patient picks one.
 */
export const handler = async (event: { doctorId: string; count?: number }) => {
  const { doctorId, count = 3 } = event;
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": `DOCTOR#${doctorId}`, ":prefix": "SLOT#" },
    })
  );
  const openSlots = (result.Items || [])
    .filter((s) => s.status === "open")
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    .slice(0, count);

  return { slots: openSlots };
};
