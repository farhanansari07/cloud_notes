import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bucketName = process.env.S3_BUCKET_NAME;
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

export const handler = async (event) => {
  try {
    if (event.requestContext?.http?.method === "OPTIONS") {
      return response(204, {});
    }

    const body = JSON.parse(event.body || "{}");
    const action = String(body.action || "put");

    if (action === "get") {
      return createDownloadUrl(body);
    }

    const fileName = String(body.fileName || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileType = String(body.fileType || "application/octet-stream");
    const userId = String(body.userId || "unknown-user").replace(/[^a-zA-Z0-9_-]/g, "_");

    if (!bucketName) {
      return response(500, { message: "S3_BUCKET_NAME is not configured." });
    }

    const key = `notes/${userId}/${Date.now()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: fileType
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    return response(200, {
      uploadUrl,
      key
    });
  } catch (error) {
    return response(500, {
      message: error.message || "Could not create presigned URL."
    });
  }
};

async function createDownloadUrl(body) {
  const key = String(body.key || "");
  const userId = String(body.userId || "").replace(/[^a-zA-Z0-9_-]/g, "_");

  if (!bucketName) {
    return response(500, { message: "S3_BUCKET_NAME is not configured." });
  }

  if (!userId || !key.startsWith(`notes/${userId}/`)) {
    return response(400, { message: "Invalid attachment key." });
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key
  });

  const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  return response(200, { downloadUrl });
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "OPTIONS,POST"
    },
    body: JSON.stringify(body)
  };
}
