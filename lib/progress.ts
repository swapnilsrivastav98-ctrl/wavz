const STORAGE_KEY = "wavz_progress";

export interface ProgressEntry {
  chapterIndex: number;
  position: number;
  updatedAt: string;
}

type ProgressMap = Record<string, ProgressEntry>;

function readAll(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ProgressMap) : {};
  } catch {
    return {};
  }
}

export function getProgress(bookId: string): ProgressEntry | null {
  return readAll()[bookId] ?? null;
}

export function setProgress(bookId: string, chapterIndex: number, position: number): void {
  if (typeof window === "undefined") return;
  const all = readAll();
  all[bookId] = { chapterIndex, position, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function getAllProgress(): ProgressMap {
  return readAll();
}

export function clearProgress(bookId: string): void {
  if (typeof window === "undefined") return;
  const all = readAll();
  if (!(bookId in all)) return;
  delete all[bookId];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
