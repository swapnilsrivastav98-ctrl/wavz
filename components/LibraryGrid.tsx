"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { getAllProgress, clearProgress, type ProgressEntry } from "@/lib/progress";
import { formatDuration } from "@/lib/format";
import type { Book } from "@/lib/types";

type BookWithCover = Book & { coverUrl: string | null };

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot() {
  return JSON.stringify(getAllProgress());
}

function getServerSnapshot() {
  return "{}";
}

function totalDuration(book: Book): number | null {
  let total = 0;
  for (const c of book.chapters) {
    if (c.duration == null) return null;
    total += c.duration;
  }
  return total;
}

function elapsedSeconds(book: Book, entry: ProgressEntry): number | null {
  let elapsed = 0;
  for (let i = 0; i < entry.chapterIndex; i++) {
    const d = book.chapters[i]?.duration;
    if (d == null) return null;
    elapsed += d;
  }
  return elapsed + entry.position;
}

export default function LibraryGrid({ books }: { books: BookWithCover[] }) {
  const router = useRouter();
  const progressJson = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const progress = JSON.parse(progressJson) as Record<string, ProgressEntry>;
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent, book: BookWithCover) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${book.title}"? This removes the files from storage too.`)) {
      return;
    }
    setDeletingId(book.id);
    try {
      const res = await fetch(`/api/library/${book.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      clearProgress(book.id);
      router.refresh();
    } catch {
      window.alert("Failed to delete. Check the console/network tab for details.");
      setDeletingId(null);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {books.map((book) => {
        const entry = progress[book.id];
        const duration = totalDuration(book);
        const elapsed = entry ? elapsedSeconds(book, entry) : null;
        const fraction =
          elapsed !== null && duration ? Math.min(1, elapsed / duration) : undefined;

        return (
          <Link
            key={book.id}
            href={`/book/${book.id}`}
            className="group flex flex-col gap-2"
          >
            <div className="neu-raised relative aspect-square w-full overflow-hidden rounded-2xl transition-transform group-hover:scale-[1.02]">
              {book.coverUrl ? (
                <Image
                  src={book.coverUrl}
                  alt={book.title}
                  fill
                  sizes="(max-width: 640px) 50vw, 20vw"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-4xl text-zinc-600">
                  📖
                </div>
              )}

              <button
                onClick={(e) => handleDelete(e, book)}
                disabled={deletingId === book.id}
                aria-label={`Delete ${book.title}`}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-zinc-200 opacity-100 backdrop-blur transition-opacity hover:bg-red-600 disabled:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              >
                {deletingId === book.id ? "…" : "✕"}
              </button>

              {fraction !== undefined && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                  <div
                    className="accent-gradient h-full"
                    style={{ width: `${fraction * 100}%` }}
                  />
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="truncate text-sm font-medium text-zinc-100">
                {book.title}
              </p>
              <p className="truncate text-xs text-zinc-400">
                {book.author || "Unknown author"}
                {duration ? ` · ${formatDuration(duration)}` : ""}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
