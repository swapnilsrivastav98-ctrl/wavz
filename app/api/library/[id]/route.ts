import { NextResponse } from "next/server";
import { deleteBook, getLibrary, reorderChapters } from "@/lib/library";
import { deleteObjects } from "@/lib/r2";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
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
    const message = err instanceof Error ? err.message : "Failed to reorder chapters";
    const status = message === "Book not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
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
