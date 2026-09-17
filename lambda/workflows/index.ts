import { PutCommand, GetCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, jsonResponse, getClaims } from "../_shared/ddb";
import { randomUUID } from "crypto";

/**
 * Routes handled:
 *   GET    /workflows              -> list the caller's own workflow definitions
 *   POST   /workflows              -> create a workflow, owned by the caller
 *   GET    /workflows/{id}         -> fetch one (owner only)
 *   PUT    /workflows/{id}         -> update name/triggerType/graph/enabled (owner only)
 *   DELETE /workflows/{id}         -> delete (owner only)
 *   GET    /workflows/{id}/runs    -> list this workflow's RUN# audit records (owner only)
 *
 * A workflow definition item: PK WORKFLOW#<id>, SK DEFINITION, plus
 * GSI1PK DOCTOR_WORKFLOWS#<doctorId> / GSI1SK WORKFLOW#<id> so a doctor's own list can be
 * queried instead of scanned. lambda/workflow-engine/index.ts reads these same items to
 * execute them but doesn't care about doctorId — ownership only gates this CRUD API.
 */
export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const path: string = event.rawPath;
  const id = event.pathParameters?.id;

  const claims = getClaims(event);
  if (!claims) return jsonResponse(401, { message: "Unauthorized" });

  if (method === "GET" && path === "/workflows") {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `DOCTOR_WORKFLOWS#${claims.sub}` },
      })
    );
    return jsonResponse(200, { workflows: result.Items || [] });
  }

  if (method === "POST" && path === "/workflows") {
    const body = JSON.parse(event.body || "{}");
    const workflowId = randomUUID();
    const now = new Date().toISOString();
    const item = {
      PK: `WORKFLOW#${workflowId}`,
      SK: "DEFINITION",
      GSI1PK: `DOCTOR_WORKFLOWS#${claims.sub}`,
      GSI1SK: `WORKFLOW#${workflowId}`,
      id: workflowId,
      doctorId: claims.sub,
      name: body.name || "Untitled workflow",
      triggerType: body.triggerType,
      enabled: body.enabled ?? false,
      graph: body.graph,
      createdAt: now,
      updatedAt: now,
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return jsonResponse(201, item);
  }

  if (path.endsWith("/runs") && method === "GET") {
    const owned = await checkOwnership(id, claims.sub);
    if (owned === "not_found") return jsonResponse(404, { message: "Workflow not found" });
    if (owned === "forbidden") return jsonResponse(403, { message: "Not your workflow" });

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": `WORKFLOW#${id}`, ":prefix": "RUN#" },
        ScanIndexForward: false,
      })
    );
    return jsonResponse(200, { runs: result.Items || [] });
  }

  if (method === "GET") {
    const result = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: `WORKFLOW#${id}`, SK: "DEFINITION" } })
    );
    if (!result.Item) return jsonResponse(404, { message: "Workflow not found" });
    if (result.Item.doctorId !== claims.sub) return jsonResponse(403, { message: "Not your workflow" });
    return jsonResponse(200, result.Item);
  }

  if (method === "PUT") {
    const owned = await checkOwnership(id, claims.sub);
    if (owned === "not_found") return jsonResponse(404, { message: "Workflow not found" });
    if (owned === "forbidden") return jsonResponse(403, { message: "Not your workflow" });

    const body = JSON.parse(event.body || "{}");
    const item = {
      PK: `WORKFLOW#${id}`,
      SK: "DEFINITION",
      GSI1PK: `DOCTOR_WORKFLOWS#${claims.sub}`,
      GSI1SK: `WORKFLOW#${id}`,
      id,
      doctorId: claims.sub,
      name: body.name || "Untitled workflow",
      triggerType: body.triggerType,
      enabled: body.enabled ?? false,
      graph: body.graph,
      updatedAt: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return jsonResponse(200, item);
  }

  if (method === "DELETE") {
    const owned = await checkOwnership(id, claims.sub);
    if (owned === "not_found") return jsonResponse(404, { message: "Workflow not found" });
    if (owned === "forbidden") return jsonResponse(403, { message: "Not your workflow" });

    await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: `WORKFLOW#${id}`, SK: "DEFINITION" } }));
    return jsonResponse(204, {});
  }

  return jsonResponse(405, { message: "Method not allowed" });
};

async function checkOwnership(id: string, callerSub: string): Promise<"ok" | "not_found" | "forbidden"> {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `WORKFLOW#${id}`, SK: "DEFINITION" } })
  );
  if (!result.Item) return "not_found";
  if (result.Item.doctorId !== callerSub) return "forbidden";
  return "ok";
}
