import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "./r2";
import type { Book, Library } from "./types";

const MANIFEST_KEY = "library.json";

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
