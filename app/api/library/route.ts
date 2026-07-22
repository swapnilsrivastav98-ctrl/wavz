import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { addBook, getLibrary, parseChapters } from "@/lib/library";

export async function GET() {
  const library = await getLibrary();
  return NextResponse.json(library);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { title, author, chapters: rawChapters, coverKey } = body;

  const chapters = parseChapters(rawChapters);

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof author !== "string" ||
    !chapters
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const book = {
    id: randomUUID(),
    title: title.trim(),
    author: author.trim(),
    chapters,
    coverKey: typeof coverKey === "string" && coverKey ? coverKey : null,
    addedAt: new Date().toISOString(),
  };

  await addBook(book);
  return NextResponse.json({ book }, { status: 201 });
}
