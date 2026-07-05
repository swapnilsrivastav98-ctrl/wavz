import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!accountId || !accessKeyId || !secretAccessKey) {
  throw new Error(
    "Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env.local"
  );
}

export const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "wavz";

// R2 buckets created under a data jurisdiction (e.g. EU) are only reachable
// through a jurisdiction-specific endpoint, not the default global one.
const jurisdiction = process.env.R2_JURISDICTION;
const endpoint = jurisdiction
  ? `https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`
  : `https://${accountId}.r2.cloudflarestorage.com`;

export const r2 = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

export async function getPresignedGetUrl(
  key: string,
  expiresInSeconds = 6 * 60 * 60
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2, command, { expiresIn: expiresInSeconds });
}

export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 15 * 60
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn: expiresInSeconds });
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await r2.send(
    new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    })
  );
}
