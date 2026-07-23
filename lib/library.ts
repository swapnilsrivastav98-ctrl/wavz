import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "./r2";
import type { Book, Chapter, Library } from "./types";

const MANIFEST_KEY = "library.json";

export function parseChapters(input: unknown): Chapter[] | null {
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

async function streamToString(stream: unknown): Promise<string> {
  const body = stream as {
    transformToString?: () => Promise<string>;
  };
  if (typeof body.transformToString === "function") {
    return body.transformToString();
  }
  throw new Error("Unsupported R2 response body stream");
}

export async function getLibrary(): Promise<Library> {
  try {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: MANIFEST_KEY })
    );
    const text = await streamToString(res.Body);
    return JSON.parse(text) as Library;
  } catch (err) {
    if (err instanceof NoSuchKey) {
      return { books: [] };
    }
    // R2 can also surface a generic 404 without the typed NoSuchKey error
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "NoSuchKey"
    ) {
      return { books: [] };
    }
    throw err;
  }
}

async function saveLibrary(library: Library): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: MANIFEST_KEY,
      Body: JSON.stringify(library, null, 2),
      ContentType: "application/json",
    })
  );
}

export async function addBook(book: Book): Promise<void> {
  const library = await getLibrary();
  library.books.push(book);
  await saveLibrary(library);
}

export async function deleteBook(id: string): Promise<void> {
  const library = await getLibrary();
  library.books = library.books.filter((b) => b.id !== id);
  await saveLibrary(library);
}

export async function addChapters(id: string, newChapters: Chapter[]): Promise<Book> {
  const library = await getLibrary();
  const book = library.books.find((b) => b.id === id);
  if (!book) throw new Error("Book not found");

  book.chapters = [...book.chapters, ...newChapters];
  await saveLibrary(library);
  return book;
}

export async function updateCover(
  id: string,
  coverKey: string | null
): Promise<{ book: Book; oldCoverKey: string | null }> {
  const library = await getLibrary();
  const book = library.books.find((b) => b.id === id);
  if (!book) throw new Error("Book not found");

  const oldCoverKey = book.coverKey;
  book.coverKey = coverKey;
  await saveLibrary(library);
  return { book, oldCoverKey };
}

export async function setChapterMarkers(
  id: string,
  key: string,
  markers: number[]
): Promise<Book> {
  const library = await getLibrary();
  const book = library.books.find((b) => b.id === id);
  if (!book) throw new Error("Book not found");

  const chapter = book.chapters.find((c) => c.key === key);
  if (!chapter) throw new Error("Chapter not found");

  const cleaned = Array.from(new Set(markers.map((m) => Math.round(m * 100) / 100)))
    .filter((m) => m > 0 && (chapter.duration == null || m < chapter.duration))
    .sort((a, b) => a - b);

  chapter.markers = cleaned.length > 0 ? cleaned : undefined;
  await saveLibrary(library);
  return book;
}

export async function reorderChapters(id: string, orderedKeys: string[]): Promise<Book> {
  const library = await getLibrary();
  const book = library.books.find((b) => b.id === id);
  if (!book) throw new Error("Book not found");

  const currentKeys = book.chapters.map((c) => c.key);
  const sameSet =
    orderedKeys.length === currentKeys.length &&
    currentKeys.every((k) => orderedKeys.includes(k));
  if (!sameSet) throw new Error("Chapter order must match existing chapters");

  const byKey = new Map(book.chapters.map((c) => [c.key, c]));
  book.chapters = orderedKeys.map((k) => byKey.get(k)!);

  await saveLibrary(library);
  return book;
}
