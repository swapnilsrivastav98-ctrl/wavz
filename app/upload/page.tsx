"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
import { uploadWithProgress } from "@/lib/uploadWithProgress";
import type { Chapter } from "@/lib/types";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

async function presign(file: File, kind: "audio" | "cover", id: string) {
  const res = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, fileType: file.type, kind, id }),
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  return (await res.json()) as { url: string; key: string };
}

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;
    audio.onloadedmetadata = () => {
      resolve(Number.isFinite(audio.duration) ? audio.duration : null);
      URL.revokeObjectURL(objectUrl);
    };
    audio.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(objectUrl);
    };
  });
}

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

const AUDIO_EXTENSIONS = /\.(mp3|m4a|m4b|wav|aac|ogg|oga|flac|opus)$/i;

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name);
}

function folderNameOf(file: File): string | null {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!relativePath) return null;
  const [folder] = relativePath.split("/");
  return folder || null;
}

export default function UploadPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [chapterFiles, setChapterFiles] = useState<File[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chapterIdsRef = useRef<string[]>([]);
  const coverIdRef = useRef<string | null>(null);

  function applyChapterFiles(files: File[]) {
    const sorted = files.sort((a, b) => collator.compare(a.name, b.name));
    setChapterFiles(sorted);
    chapterIdsRef.current = sorted.map(() => crypto.randomUUID());
  }

  function handleAudioSelect(e: React.ChangeEvent<HTMLInputElement>) {
    applyChapterFiles(Array.from(e.target.files ?? []));
  }

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const allFiles = Array.from(e.target.files ?? []);
    const audioFiles = allFiles.filter(isAudioFile);
    applyChapterFiles(audioFiles);

    if (!title.trim() && audioFiles.length > 0) {
      const folderName = folderNameOf(audioFiles[0]);
      if (folderName) setTitle(folderName);
    }
  }

  function removeChapter(index: number) {
    setChapterFiles((prev) => prev.filter((_, i) => i !== index));
    chapterIdsRef.current = chapterIdsRef.current.filter((_, i) => i !== index);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (chapterFiles.length === 0 || !title.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const chapters: Chapter[] = [];
      for (let i = 0; i < chapterFiles.length; i++) {
        const file = chapterFiles[i];
        setStatus(
          chapterFiles.length > 1
            ? `Uploading chapter ${i + 1} of ${chapterFiles.length}: ${file.name}`
            : `Uploading audiobook file...`
        );
        setProgress(0);

        const duration = await readDuration(file);
        const id = chapterIdsRef.current[i];
        const presigned = await presign(file, "audio", id);
        await uploadWithProgress(presigned.url, file, setProgress);

        chapters.push({ key: presigned.key, label: stripExtension(file.name), duration });
      }

      let coverKey: string | null = null;
      if (coverFile) {
        setStatus("Uploading cover art...");
        setProgress(0);
        if (!coverIdRef.current) coverIdRef.current = crypto.randomUUID();
        const coverPresigned = await presign(coverFile, "cover", coverIdRef.current);
        await uploadWithProgress(coverPresigned.url, coverFile, setProgress);
        coverKey = coverPresigned.key;
      }

      setStatus("Saving to library...");
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author, chapters, coverKey }),
      });
      if (!res.ok) throw new Error("Failed to save book");

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
      setStatus(null);
    }
  }

  return (
    <div className="flex flex-1 justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Library
        </Link>
        <h1 className="mt-3 mb-6 text-2xl font-semibold tracking-tight">
          Add an audiobook
        </h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Title</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="neu-inset w-full rounded-xl px-4 py-2.5 text-zinc-100 outline-none placeholder:text-zinc-500"
              placeholder="Project Hail Mary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-zinc-400">Author</label>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="neu-inset w-full rounded-xl px-4 py-2.5 text-zinc-100 outline-none placeholder:text-zinc-500"
              placeholder="Andy Weir"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-zinc-400">
              Audio file(s) (mp3, m4a, etc.) — select multiple files, or a
              whole folder, if the book is split into several files;
              they&apos;ll be sorted by filename and played as chapters
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept="audio/*"
                multiple
                onChange={handleAudioSelect}
                className="text-sm text-zinc-300 file:mr-4 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:text-white hover:file:opacity-90"
              />
              <span className="text-xs text-zinc-500">or</span>
              <input
                type="file"
                // @ts-expect-error non-standard attributes for folder selection, supported by Chrome/Safari/Edge
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderSelect}
                className="text-sm text-zinc-300 file:mr-4 file:rounded-full file:border-0 file:bg-surface-2 file:px-4 file:py-2 file:text-white hover:file:opacity-90"
              />
            </div>
            {chapterFiles.length > 0 && (
              <ul className="neu-inset mt-3 space-y-1 rounded-xl p-3">
                {chapterFiles.map((file, i) => (
                  <li
                    key={`${file.name}-${i}`}
                    className="flex items-center justify-between gap-2 text-sm text-zinc-300"
                  >
                    <span className="truncate">
                      {i + 1}. {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeChapter(i)}
                      className="shrink-0 text-xs text-zinc-500 hover:text-red-400"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-zinc-400">
              Cover image (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                setCoverFile(e.target.files?.[0] ?? null);
                coverIdRef.current = null;
              }}
              className="w-full text-sm text-zinc-300 file:mr-4 file:rounded-full file:border-0 file:bg-surface-2 file:px-4 file:py-2 file:text-white hover:file:opacity-90"
            />
          </div>

          {status && (
            <div className="neu-raised rounded-xl p-4">
              <p className="mb-2 text-sm text-zinc-300">{status}</p>
              <div className="neu-inset h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="accent-gradient h-full rounded-full transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting || chapterFiles.length === 0 || !title.trim()}
            className="accent-gradient accent-glow neu-pressable w-full rounded-xl px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Uploading..." : "Add to library"}
          </button>
        </form>
      </div>
    </div>
  );
}
