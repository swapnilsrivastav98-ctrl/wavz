import { NextResponse } from "next/server";
import {
  addChapters,
  deleteBook,
  getLibrary,
  parseChapters,
  reorderChapters,
  updateCover,
} from "@/lib/library";
import { deleteObjects } from "@/lib/r2";

function errorResponse(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  const status = message === "Book not found" ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  if ("chapterOrder" in body) {
    const { chapterOrder } = body;
    if (
      !Array.isArray(chapterOrder) ||
      chapterOrder.some((k) => typeof k !== "string")
    ) {
      return NextResponse.json({ error: "chapterOrder must be an array of keys" }, { status: 400 });
    }
    try {
      const book = await reorderChapters(id, chapterOrder);
      return NextResponse.json({ book });
    } catch (err) {
      return errorResponse(err, "Failed to reorder chapters");
    }
  }

  if ("newChapters" in body) {
    const chapters = parseChapters(body.newChapters);
    if (!chapters) {
      return NextResponse.json({ error: "newChapters must be a non-empty array of chapters" }, { status: 400 });
    }
    try {
      const book = await addChapters(id, chapters);
      return NextResponse.json({ book });
    } catch (err) {
      return errorResponse(err, "Failed to add chapters");
    }
  }

  if ("coverKey" in body) {
    const { coverKey } = body;
    if (coverKey !== null && typeof coverKey !== "string") {
      return NextResponse.json({ error: "coverKey must be a string or null" }, { status: 400 });
    }
    try {
      const { book, oldCoverKey } = await updateCover(id, coverKey || null);
      if (oldCoverKey && oldCoverKey !== coverKey) {
        await deleteObjects([oldCoverKey]);
      }
      return NextResponse.json({ book });
    } catch (err) {
      return errorResponse(err, "Failed to update cover");
    }
  }

  return NextResponse.json({ error: "No recognized update fields provided" }, { status: 400 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const library = await getLibrary();
  const book = library.books.find((b) => b.id === id);

  if (!book) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const keys = book.chapters.map((c) => c.key);
  if (book.coverKey) keys.push(book.coverKey);

  await deleteObjects(keys);
  await deleteBook(id);

  return NextResponse.json({ ok: true });
}
