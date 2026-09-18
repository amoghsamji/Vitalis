import { PutCommand, GetCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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
    return jsonResponse(200, { appointments: result.Items || [] });
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
      status: "confirmed",
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
