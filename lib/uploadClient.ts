import { uploadWithProgress } from "./uploadWithProgress";
import type { Chapter } from "./types";

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const UPLOAD_CONCURRENCY = 4;
const READ_DURATION_TIMEOUT_MS = 8000;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|m4b|wav|aac|ogg|oga|flac|opus)$/i;

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name);
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

export async function presignUpload(
  file: File,
  kind: "audio" | "cover",
  id: string,
  signal?: AbortSignal
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

export function readAudioDuration(file: File): Promise<number | null> {
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

export type FileStatus = "pending" | "uploading" | "done";

// Uploads run several files at once (instead of one at a time) so a large
// folder of chapters doesn't pay full round-trip latency file-by-file.
export async function uploadChaptersConcurrently(
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

      const duration = await readAudioDuration(file);
      const presigned = await presignUpload(file, "audio", ids[i], signal);
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
