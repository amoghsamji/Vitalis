import { TextractClient, AnalyzeDocumentCommand } from "@aws-sdk/client-textract";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../_shared/ddb";
import { randomUUID } from "crypto";

const textract = new TextractClient({});
const eventBridge = new EventBridgeClient({});

/**
 * Triggered automatically whenever a PDF lands in the intake S3 bucket
 * (see VitalisStack -> pdfBucket.addEventNotification).
 *
 * Flow:
 *   1. Run Textract AnalyzeDocument (FORMS + TABLES) against the uploaded PDF.
 *   2. Pull out key/value pairs (name, DOB, MRN, insurance) and any table rows
 *      that look like lab results.
 *   3. Persist a LAB_RESULT record in DynamoDB.
 *   4. Emit a "lab_result_received" event onto the workflow bus so any matching
 *      no-code workflow (e.g. "abnormal result detected") fires automatically.
 *
 * NOTE: the key/value parsing below is intentionally simple — real lab reports
 * vary a lot in layout. Treat this as the integration point to harden with
 * per-lab-vendor templates or a Textract "queries" configuration.
 */
export const handler = async (event: any) => {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  // Key shape is "lab-pdfs/<patientId>/<uuid>-<filename>" (see lambda/uploads/index.ts) —
  // the patient's own Cognito sub is embedded in the path, so we can recover it here
  // without a separate lookup.
  const patientId = key.split("/")[1];

  const textractResult = await textract.send(
    new AnalyzeDocumentCommand({
      Document: { S3Object: { Bucket: bucket, Name: key } },
      FeatureTypes: ["FORMS", "TABLES"],
    })
  );

  const blocks = textractResult.Blocks || [];
  const keyValuePairs = extractKeyValuePairs(blocks);

  const recordId = randomUUID();
  const item = {
    PK: `LAB_RESULT#${recordId}`,
    SK: "DETAILS",
    id: recordId,
    sourceKey: key,
    patientId,
    extractedFields: keyValuePairs,
    createdAt: new Date().toISOString(),
    status: "extracted", // downstream workflow / staff review can move this to "reviewed"
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: process.env.WORKFLOW_BUS_NAME,
          Source: "vitalis.triggers",
          DetailType: "lab_result_received",
          Detail: JSON.stringify({ labResultId: recordId, patientId, extractedFields: keyValuePairs }),
        },
      ],
    })
  );

  return { statusCode: 200 };
};

function extractKeyValuePairs(blocks: any[]): Record<string, string> {
  const blockMap = new Map(blocks.map((b) => [b.Id, b]));
  const kvs: Record<string, string> = {};

  const keyBlocks = blocks.filter(
    (b) => b.BlockType === "KEY_VALUE_SET" && b.EntityTypes?.includes("KEY")
  );

  for (const keyBlock of keyBlocks) {
    const keyText = getText(keyBlock, blockMap);
    const valueBlockId = keyBlock.Relationships?.find((r: any) => r.Type === "VALUE")?.Ids?.[0];
    const valueBlock = valueBlockId ? blockMap.get(valueBlockId) : undefined;
    const valueText = valueBlock ? getText(valueBlock, blockMap) : "";
    if (keyText) kvs[keyText.trim()] = valueText.trim();
  }
  return kvs;
}

function getText(block: any, blockMap: Map<string, any>): string {
  let text = "";
  for (const rel of block.Relationships || []) {
    if (rel.Type !== "CHILD") continue;
    for (const childId of rel.Ids) {
      const child = blockMap.get(childId);
      if (child?.BlockType === "WORD") text += child.Text + " ";
      if (child?.BlockType === "SELECTION_ELEMENT" && child.SelectionStatus === "SELECTED") {
        text += "SELECTED ";
      }
    }
  }
  return text;
}
