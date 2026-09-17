import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { jsonResponse, getClaims } from "../_shared/ddb";
import { randomUUID } from "crypto";

const s3 = new S3Client({});
const BUCKET = process.env.PDF_BUCKET as string;

/**
 * Routes handled:
 *   POST /uploads/lab-pdf -> auth: returns a presigned S3 PUT URL for the
 *   caller to upload a lab-result PDF directly from the browser. The object
 *   key is scoped under the caller's own Cognito sub so callers can't stomp
 *   on each other's uploads. Once the file lands, the existing pdf-intake
 *   S3-trigger Lambda picks it up and runs Textract, unchanged.
 */
export const handler = async (event: any) => {
  const method = event.requestContext.http.method;
  const path: string = event.rawPath;

  if (method !== "POST" || !path.endsWith("/uploads/lab-pdf")) {
    return jsonResponse(405, { message: "Method not allowed" });
  }

  const claims = getClaims(event);
  if (!claims) return jsonResponse(401, { message: "Unauthorized" });

  const body = JSON.parse(event.body || "{}");
  const fileName: string = body.fileName || "upload.pdf";
  const contentType: string = body.contentType || "application/pdf";
  const key = `lab-pdfs/${claims.sub}/${randomUUID()}-${fileName}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 }
  );

  return jsonResponse(200, { uploadUrl, key });
};
