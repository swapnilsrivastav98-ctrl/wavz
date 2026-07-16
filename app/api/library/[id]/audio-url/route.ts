import { NextResponse } from "next/server";
import { getLibrary } from "@/lib/library";
import { getPresignedGetUrl } from "@/lib/r2";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const key = new URL(req.url).searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const { books } = await getLibrary();
  const book = books.find((b) => b.id === id);
  if (!book) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const validKey = book.chapters.some((c) => c.key === key) || book.coverKey === key;
  if (!validKey) {
    return NextResponse.json({ error: "Invalid key" }, { status: 403 });
  }

  const url = await getPresignedGetUrl(key);
  return NextResponse.json({ url });
}
