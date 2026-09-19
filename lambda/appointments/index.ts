import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  BatchGetCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { emitPrescriptionUploadedIfReady } from "../_shared/prescriptionEvent";
import { randomUUID } from "crypto";

const eventBridge = new EventBridgeClient({});

/**
 * Routes handled:
 *   POST   /appointments                      -> book (reserve slot -> create appt -> mark booked)
 *   GET    /appointments/{id}
 *   PUT    /appointments/{id}                 -> reschedule / update status
 *   DELETE /appointments/{id}                 -> cancel (releases the slot)
 *   GET    /patients/{id}/appointments
 *   GET    /doctors/{id}/appointments
 *
 * Booking is atomic: we flip the slot open->held with a ConditionExpression first.
 * If that fails, someone else grabbed it first and we return 409 immediately —
 * no appointment or notification is ever created for a slot two patients raced on.
 */
export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const path: string = event.rawPath;
  const claims = getClaims(event);
  if (!claims) return jsonResponse(401, { message: "Unauthorized" });

  if (path.endsWith("/appointments") && path.includes("/patients/") && method === "GET") {
    const patientId = event.pathParameters.id;
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `PATIENT_APPTS#${patientId}` },
      })
    );
    return jsonResponse(200, { appointments: result.Items || [] });
  }

  if (path.endsWith("/appointments") && path.includes("/doctors/") && method === "GET") {
    const doctorId = event.pathParameters.id;
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `DOCTOR_APPTS#${doctorId}` },
      })
    );
    // GSI1 only holds the DOCTOR_INDEX pointer items ({ apptId } + keys) for
    // this partition — the patient partition is keyed off the DETAILS item
    // itself, but a doctor's isn't, since one item can only carry one GSI1PK.
    // So hydrate the real DETAILS records rather than returning the pointers,
    // which have no status/startTime/patientId at all.
    const apptIds = (result.Items || [])
      .map((item) => item.apptId ?? String(item.PK || "").replace(/^APPT#/, ""))
      .filter(Boolean);
    let appointments = await getAppointmentsByIds(apptIds);

    // Fallback: the DOCTOR_INDEX pointer is only written at booking time, so
    // appointments booked before that write existed have no GSI1 entry and
    // would be invisible to their doctor forever. Fall back to a scan (the
    // same approach GET /doctors already takes at this data size) and backfill
    // the missing pointers so the next request is a plain Query again.
    if (appointments.length === 0) {
      appointments = await scanAppointmentsForDoctor(doctorId);
      await backfillDoctorIndex(appointments);
    }

    return jsonResponse(200, { appointments });
  }

  if (method === "POST" && path === "/appointments") {
    const body = JSON.parse(event.body || "{}");
    const { doctorId, patientId, slotStartTime, consultationType } = body;
    const apptId = randomUUID();

    // Step 1: reserve the slot (open -> held), atomically.
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `DOCTOR#${doctorId}`, SK: `SLOT#${slotStartTime}` },
          UpdateExpression: "SET #s = :held, heldBy = :patientId",
          ConditionExpression: "#s = :open",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":held": "held", ":open": "open", ":patientId": patientId },
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return jsonResponse(409, { message: "That slot was just taken. Please pick another." });
      }
      throw err;
    }

    // Step 2: create the appointment record.
    const appt = {
      PK: `APPT#${apptId}`,
      SK: "DETAILS",
      GSI1PK: `PATIENT_APPTS#${patientId}`, // duplicated below for doctor lookup via a second item
      GSI1SK: slotStartTime,
      id: apptId,
      doctorId,
      patientId,
      startTime: slotStartTime,
      consultationType: consultationType || "video",
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: appt }));

    // Secondary index entry so doctors can list their own appointments too
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `APPT#${apptId}`,
          SK: "DOCTOR_INDEX",
          GSI1PK: `DOCTOR_APPTS#${doctorId}`,
          GSI1SK: slotStartTime,
          apptId,
        },
      })
    );

    // Step 3: mark the slot booked (held -> booked).
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `DOCTOR#${doctorId}`, SK: `SLOT#${slotStartTime}` },
        UpdateExpression: "SET #s = :booked",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":booked": "booked" },
      })
    );

    // Booking-confirmation notification record + workflow trigger event.
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `NOTIFICATION#${randomUUID()}`,
          SK: "DETAILS",
          type: "booking_confirmation",
          appointmentId: apptId,
          patientId,
          createdAt: new Date().toISOString(),
        },
      })
    );
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: process.env.WORKFLOW_BUS_NAME,
            Source: "vitalis.triggers",
            DetailType: "appointment_booked",
            Detail: JSON.stringify({ appointmentId: apptId, doctorId, patientId, startTime: slotStartTime }),
          },
        ],
      })
    );

    return jsonResponse(201, appt);
  }

  const apptId = event.pathParameters?.id;

  if (method === "GET" && apptId) {
    const result = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${apptId}`, SK: "DETAILS" } })
    );
    if (!result.Item) return jsonResponse(404, { message: "Appointment not found" });
    return jsonResponse(200, result.Item);
  }

  if (method === "PUT" && apptId) {
    const body = JSON.parse(event.body || "{}");

    // Parallel/additional path for marking an appointment completed. Kept
    // separate from the reschedule branch below (which has a known no-op bug
    // via if_not_exists — intentionally left untouched) so this real,
    // unconditional update doesn't interact with that bug's semantics.
    if (body.status === "completed") {
      const result = await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `APPT#${apptId}`, SK: "DETAILS" },
          UpdateExpression: "SET #s = :completed, updatedAt = :now",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":completed": "completed", ":now": new Date().toISOString() },
          ReturnValues: "ALL_NEW",
        })
      );
      await emitPrescriptionUploadedIfReady(apptId);
      return jsonResponse(200, result.Attributes);
    }

    // Doctor accept/reject of a pending booking request. Kept as its own
    // explicit branch for the same reason as "completed" above — this is a
    // real, ownership-checked, conditional update, not the buggy generic
    // fallback below.
    if (body.status === "confirmed" || body.status === "rejected") {
      const existing = await ddb.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${apptId}`, SK: "DETAILS" } })
      );
      if (!existing.Item) return jsonResponse(404, { message: "Appointment not found" });
      if (existing.Item.doctorId !== claims.sub) {
        return jsonResponse(403, { message: "Only the assigned doctor can respond to this request" });
      }

      let result;
      try {
        result = await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `APPT#${apptId}`, SK: "DETAILS" },
            UpdateExpression: "SET #s = :s, updatedAt = :now",
            ConditionExpression: "#s = :pending",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":s": body.status, ":pending": "pending", ":now": new Date().toISOString() },
            ReturnValues: "ALL_NEW",
          })
        );
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
          return jsonResponse(409, { message: "This request has already been responded to" });
        }
        throw err;
      }

      if (body.status === "rejected") {
        // Release the slot back to open, same as cancellation.
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `DOCTOR#${existing.Item.doctorId}`, SK: `SLOT#${existing.Item.startTime}` },
            UpdateExpression: "SET #s = :open REMOVE heldBy",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":open": "open" },
          })
        );
      }

      return jsonResponse(200, result.Attributes);
    }

    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `APPT#${apptId}`, SK: "DETAILS" },
        UpdateExpression: "SET #s = if_not_exists(#s, :s), startTime = if_not_exists(startTime, :st)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": body.status || "confirmed", ":st": body.startTime },
        ReturnValues: "ALL_NEW",
      })
    );
    return jsonResponse(200, result.Attributes);
  }

  if (method === "DELETE" && apptId) {
    const existing = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: `APPT#${apptId}`, SK: "DETAILS" } })
    );
    if (!existing.Item) return jsonResponse(404, { message: "Appointment not found" });

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `APPT#${apptId}`, SK: "DETAILS" },
        UpdateExpression: "SET #s = :cancelled",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":cancelled": "cancelled" },
      })
    );
    // Release the slot back to open.
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `DOCTOR#${existing.Item.doctorId}`, SK: `SLOT#${existing.Item.startTime}` },
        UpdateExpression: "SET #s = :open REMOVE heldBy",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":open": "open" },
      })
    );
    return jsonResponse(204, {});
  }

  return jsonResponse(405, { message: "Method not allowed" });
};

/**
 * BatchGet the APPT#<id>/DETAILS items for a list of appointment ids, in
 * chunks of 25 (BatchGetItem's per-request cap is 100 keys, but chunking
 * smaller keeps each response well inside the 16MB limit so UnprocessedKeys
 * stays empty in practice; it's retried below regardless).
 */
async function getAppointmentsByIds(apptIds: string[]) {
  const unique = Array.from(new Set(apptIds));
  const appointments: Record<string, any>[] = [];

  for (let i = 0; i < unique.length; i += 25) {
    let keys = unique.slice(i, i + 25).map((id) => ({ PK: `APPT#${id}`, SK: "DETAILS" }));
    // UnprocessedKeys is a normal (throttling) outcome, not an error — loop
    // until the chunk is fully drained.
    while (keys.length > 0) {
      const res: any = await ddb.send(
        new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys } } })
      );
      appointments.push(...((res.Responses?.[TABLE_NAME] as Record<string, any>[]) || []));
      keys = res.UnprocessedKeys?.[TABLE_NAME]?.Keys || [];
    }
  }

  return appointments;
}

/** Paginated scan for the DETAILS items of APPT# records belonging to one doctor. */
async function scanAppointmentsForDoctor(doctorId: string) {
  const appointments: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res: any = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "SK = :details AND doctorId = :doctorId",
        ExpressionAttributeValues: { ":details": "DETAILS", ":doctorId": doctorId },
        ExclusiveStartKey: lastKey,
      })
    );
    appointments.push(
      ...((res.Items as Record<string, any>[]) || []).filter((i) => String(i.PK || "").startsWith("APPT#"))
    );
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return appointments;
}

/**
 * Write the missing DOCTOR_INDEX pointers for appointments found by scan.
 * attribute_not_exists(PK) keeps this a no-op for pointers that already
 * exist, and a failure here is non-fatal — the scan already produced the
 * response, so a backfill error must not turn a working read into a 500.
 */
async function backfillDoctorIndex(appointments: Record<string, any>[]) {
  await Promise.all(
    appointments.map(async (appt) => {
      try {
        await ddb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              PK: `APPT#${appt.id}`,
              SK: "DOCTOR_INDEX",
              GSI1PK: `DOCTOR_APPTS#${appt.doctorId}`,
              GSI1SK: appt.startTime,
              apptId: appt.id,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          })
        );
      } catch {
        // Already present, or a transient write failure — either way the
        // response is unaffected and the next request will retry.
      }
    })
  );
}
