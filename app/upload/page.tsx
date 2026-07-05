"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { uploadWithProgress } from "@/lib/uploadWithProgress";
import type { Chapter } from "@/lib/types";

const UPLOAD_CONCURRENCY = 4;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

async function presign(
  file: File,
  kind: "audio" | "cover",
  id: string,
  signal: AbortSignal
) {
  const res = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, fileType: file.type, kind, id }),
    signal,
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  return (await res.json()) as { url: string; key: string };
}

const READ_DURATION_TIMEOUT_MS = 8000;

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };

    // Some files never fire loadedmetadata or error (malformed tags, unusual
    // VBR headers) — without a fallback the whole upload queue hangs forever.
    const timer = setTimeout(() => finish(null), READ_DURATION_TIMEOUT_MS);

    audio.src = objectUrl;
    audio.onloadedmetadata = () => {
      finish(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => finish(null);
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

type FileStatus = "pending" | "uploading" | "done";

// Uploads run several files at once (instead of one at a time) so a large
// folder of chapters doesn't pay full round-trip latency file-by-file.
async function uploadChaptersConcurrently(
  files: File[],
  ids: string[],
  signal: AbortSignal,
  onStatus: (index: number, status: FileStatus) => void,
  onProgress: (index: number, fraction: number) => void
): Promise<Chapter[]> {
  const chapters: Chapter[] = new Array(files.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= files.length) return;
      const file = files[i];
      onStatus(i, "uploading");

      const duration = await readDuration(file);
      const presigned = await presign(file, "audio", ids[i], signal);
      await uploadWithProgress(presigned.url, file, (fraction) => onProgress(i, fraction), signal);

      chapters[i] = { key: presigned.key, label: stripExtension(file.name), duration };
      onProgress(i, 1);
      onStatus(i, "done");
    }
  }

  const workerCount = Math.min(UPLOAD_CONCURRENCY, files.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return chapters;
}

export default function UploadPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [chapterFiles, setChapterFiles] = useState<File[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [fileProgress, setFileProgress] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chapterIdsRef = useRef<string[]>([]);
  const coverIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Byte-weighted aggregate of all in-flight chapter uploads, so the single
  // progress bar reflects overall completion while files upload concurrently.
  useEffect(() => {
    if (fileProgress.length === 0) return;
    const totalBytes = chapterFiles.reduce((sum, f) => sum + f.size, 0) || 1;
    const doneBytes = chapterFiles.reduce(
      (sum, f, i) => sum + f.size * (fileProgress[i] ?? 0),
      0
    );
    setProgress(doneBytes / totalBytes);
  }, [fileProgress, chapterFiles]);

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

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    setSubmitting(true);
    setError(null);
    setStatus("Uploading files…");
    setProgress(0);
    setFileStatuses(new Array(chapterFiles.length).fill("pending"));
    setFileProgress(new Array(chapterFiles.length).fill(0));

    try {
      let chapters: Chapter[];
      try {
        chapters = await uploadChaptersConcurrently(
          chapterFiles,
          chapterIdsRef.current,
          signal,
          (i, s) =>
            setFileStatuses((prev) => {
              const next = prev.slice();
              next[i] = s;
              return next;
            }),
          (i, fraction) =>
            setFileProgress((prev) => {
              const next = prev.slice();
              next[i] = fraction;
              return next;
            })
        );
      } catch (err) {
        // A single failed file shouldn't leave the other workers running.
        controller.abort();
        throw err;
      }

      setFileStatuses([]);
      setFileProgress([]);

      let coverKey: string | null = null;
      if (coverFile) {
        setStatus("Uploading cover art...");
        setProgress(0);
        if (!coverIdRef.current) coverIdRef.current = crypto.randomUUID();
        const coverPresigned = await presign(coverFile, "cover", coverIdRef.current, signal);
        await uploadWithProgress(coverPresigned.url, coverFile, setProgress, signal);
        coverKey = coverPresigned.key;
      }

      setStatus("Saving to library...");
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author, chapters, coverKey }),
        signal,
      });
      if (!res.ok) throw new Error("Failed to save book");

      router.push("/");
      router.refresh();
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === "AbortError";
      setError(cancelled ? null : err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
      setStatus(null);
      setFileStatuses([]);
      setFileProgress([]);
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
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
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                multiple
                onChange={handleAudioSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className="rounded-full bg-accent px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Choose Files
              </button>
              <span className="text-xs text-zinc-500">or</span>
              <input
                ref={folderInputRef}
                type="file"
                // @ts-expect-error non-standard attributes for folder selection, supported by Chrome/Safari/Edge
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="rounded-full bg-surface-2 px-4 py-2 text-sm text-white hover:opacity-90"
              >
                Choose Folder
              </button>
              <span className="text-sm text-zinc-300">
                {chapterFiles.length > 0
                  ? `${chapterFiles.length} file${chapterFiles.length > 1 ? "s" : ""} selected`
                  : "no files selected"}
              </span>
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
                    {submitting ? (
                      <span className="shrink-0 text-xs text-zinc-500">
                        {fileStatuses[i] === "done"
                          ? "Done"
                          : fileStatuses[i] === "uploading"
                          ? `${Math.round((fileProgress[i] ?? 0) * 100)}%`
                          : "Waiting…"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => removeChapter(i)}
                        className="shrink-0 text-xs text-zinc-500 hover:text-red-400"
                      >
                        Remove
                      </button>
                    )}
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
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm text-zinc-300">
                  {status}
                  {fileStatuses.length > 0 &&
                    ` (${fileStatuses.filter((s) => s === "done").length} of ${fileStatuses.length})`}
                </p>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="shrink-0 text-xs text-zinc-500 hover:text-red-400"
                >
                  Cancel
                </button>
              </div>
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
