import { NextResponse } from "next/server";
import { getPresignedPutUrl } from "@/lib/r2";

const ALLOWED_KINDS = new Set(["audio", "cover"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(req: Request) {
  const body = await req.json();
  const { fileName, fileType, kind, id } = body;

  if (
    typeof fileName !== "string" ||
    typeof fileType !== "string" ||
    typeof kind !== "string" ||
    !ALLOWED_KINDS.has(kind) ||
    typeof id !== "string" ||
    !UUID_RE.test(id)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // The client generates and reuses this id per file selection, so retrying
  // a failed upload overwrites the same object instead of leaving an orphan.
  const prefix = kind === "audio" ? "audio" : "covers";
  const key = `${prefix}/${id}-${sanitizeFileName(fileName)}`;
  const url = await getPresignedPutUrl(key, fileType);

  return NextResponse.json({ url, key });
}
