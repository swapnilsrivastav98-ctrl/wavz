import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { addBook, getLibrary } from "@/lib/library";
import type { Chapter } from "@/lib/types";

export async function GET() {
  const library = await getLibrary();
  return NextResponse.json(library);
}

function parseChapters(input: unknown): Chapter[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;

  const chapters: Chapter[] = [];
  for (const item of input) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as { key?: unknown }).key !== "string" ||
      !(item as { key: string }).key
    ) {
      return null;
    }
    const label =
      typeof (item as { label?: unknown }).label === "string" &&
      (item as { label: string }).label
        ? (item as { label: string }).label
        : `Chapter ${chapters.length + 1}`;
    const duration =
      typeof (item as { duration?: unknown }).duration === "number"
        ? (item as { duration: number }).duration
        : null;
    chapters.push({ key: (item as { key: string }).key, label, duration });
  }
  return chapters;
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
