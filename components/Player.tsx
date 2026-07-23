"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { clearProgress, getProgress, setProgress } from "@/lib/progress";
import { formatClock } from "@/lib/format";
import {
  collator,
  isAudioFile,
  presignUpload,
  uploadChaptersConcurrently,
  type FileStatus,
} from "@/lib/uploadClient";
import { uploadWithProgress } from "@/lib/uploadWithProgress";

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
const SKIP_BACK_SECONDS = 15;
const SKIP_FORWARD_SECONDS = 30;
const SAVE_INTERVAL_SECONDS = 5;
const MAX_LOAD_RETRIES = 2;
const AUTO_SPLIT_INTERVAL_SECONDS = 3600;

interface PlayerChapter {
  key: string;
  label: string;
  duration: number | null;
  url: string;
  markers?: number[];
}

interface Segment {
  chapterIndex: number;
  key: string;
  label: string;
  numberLabel: string;
  start: number;
  end: number | null;
  partIndex: number;
  partCount: number;
}

interface PlayerProps {
  bookId: string;
  title: string;
  author: string;
  chapters: PlayerChapter[];
  coverUrl: string | null;
}

export default function Player({ bookId, title, author, chapters, coverUrl }: PlayerProps) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSavedRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const appliedResumeRef = useRef(false);
  const retryCountRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);

  // Always start deterministic (chapter 0) so server/client render match —
  // the actual saved chapter/position is applied once metadata loads, below.
  const [chapterIndex, setChapterIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [chapterUrls, setChapterUrls] = useState(() => chapters.map((c) => c.url));
  const [loadError, setLoadError] = useState(false);

  const [reordering, setReordering] = useState(false);
  const [draftChapters, setDraftChapters] = useState(chapters);
  const [savingOrder, setSavingOrder] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const [addingChapters, setAddingChapters] = useState(false);
  const [newChapterFiles, setNewChapterFiles] = useState<File[]>([]);
  const [newChapterStatuses, setNewChapterStatuses] = useState<FileStatus[]>([]);
  const [newChapterProgress, setNewChapterProgress] = useState<number[]>([]);
  const [savingChapters, setSavingChapters] = useState(false);
  const [addChaptersError, setAddChaptersError] = useState<string | null>(null);
  const newChapterIdsRef = useRef<string[]>([]);
  const newChapterInputRef = useRef<HTMLInputElement>(null);

  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [splittingChapter, setSplittingChapter] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  const segments = useMemo<Segment[]>(() => {
    const out: Segment[] = [];
    chapters.forEach((c, ci) => {
      const markers = c.markers ?? [];
      const bounds = [0, ...markers, c.duration ?? Infinity];
      const partCount = bounds.length - 1;
      for (let p = 0; p < partCount; p++) {
        out.push({
          chapterIndex: ci,
          key: c.key,
          label: partCount > 1 ? `${c.label} — Part ${p + 1}` : c.label,
          numberLabel: partCount > 1 ? `${ci + 1}.${p + 1}` : `${ci + 1}`,
          start: bounds[p],
          end: Number.isFinite(bounds[p + 1]) ? bounds[p + 1] : null,
          partIndex: p,
          partCount,
        });
      }
    });
    return out;
  }, [chapters]);

  const autoSplitCandidates = useMemo(
    () =>
      chapters.filter(
        (c) =>
          c.duration != null &&
          c.duration > AUTO_SPLIT_INTERVAL_SECONDS &&
          (!c.markers || c.markers.length === 0)
      ),
    [chapters]
  );

  const currentSegmentIndex = useMemo(() => {
    let fallback = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (s.chapterIndex !== chapterIndex) continue;
      fallback = i;
      if (currentTime >= s.start && (s.end == null || currentTime < s.end)) return i;
    }
    return fallback;
  }, [segments, chapterIndex, currentTime]);

  async function refreshChapterUrl(index: number): Promise<string> {
    const key = chapters[index].key;
    const res = await fetch(`/api/library/${bookId}/audio-url?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error("Failed to refresh audio URL");
    const data = await res.json();
    return data.url as string;
  }

  async function retryLoad() {
    retryCountRef.current = 0;
    setLoadError(false);
    wasPlayingRef.current = true;
    try {
      const freshUrl = await refreshChapterUrl(chapterIndex);
      setChapterUrls((prev) => {
        const next = [...prev];
        next[chapterIndex] = freshUrl;
        return next;
      });
    } catch {
      setLoadError(true);
    }
  }

  function startReordering() {
    setDraftChapters(chapters);
    setReorderError(null);
    setReordering(true);
  }

  function cancelReordering() {
    setReordering(false);
    setReorderError(null);
  }

  function moveDraftChapter(index: number, direction: -1 | 1) {
    setDraftChapters((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveOrder() {
    setSavingOrder(true);
    setReorderError(null);
    try {
      const res = await fetch(`/api/library/${bookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterOrder: draftChapters.map((c) => c.key) }),
      });
      if (!res.ok) throw new Error("Failed to save chapter order");
      clearProgress(bookId);
      setReordering(false);
      router.refresh();
    } catch {
      setReorderError("Couldn't save the new order. Try again.");
    } finally {
      setSavingOrder(false);
    }
  }

  function startAddingChapters() {
    setNewChapterFiles([]);
    setAddChaptersError(null);
    setAddingChapters(true);
  }

  function cancelAddingChapters() {
    setAddingChapters(false);
    setNewChapterFiles([]);
    setAddChaptersError(null);
  }

  function handleNewChapterSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
      .filter(isAudioFile)
      .sort((a, b) => collator.compare(a.name, b.name));
    setNewChapterFiles(files);
    newChapterIdsRef.current = files.map(() => crypto.randomUUID());
  }

  function removeNewChapterFile(index: number) {
    setNewChapterFiles((prev) => prev.filter((_, i) => i !== index));
    newChapterIdsRef.current = newChapterIdsRef.current.filter((_, i) => i !== index);
  }

  async function submitNewChapters() {
    if (newChapterFiles.length === 0) return;
    setSavingChapters(true);
    setAddChaptersError(null);
    setNewChapterStatuses(new Array(newChapterFiles.length).fill("pending"));
    setNewChapterProgress(new Array(newChapterFiles.length).fill(0));

    const controller = new AbortController();
    try {
      const newChapters = await uploadChaptersConcurrently(
        newChapterFiles,
        newChapterIdsRef.current,
        controller.signal,
        (i, s) =>
          setNewChapterStatuses((prev) => {
            const next = prev.slice();
            next[i] = s;
            return next;
          }),
        (i, fraction) =>
          setNewChapterProgress((prev) => {
            const next = prev.slice();
            next[i] = fraction;
            return next;
          })
      );

      const res = await fetch(`/api/library/${bookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newChapters }),
      });
      if (!res.ok) throw new Error("Failed to add chapters");

      setAddingChapters(false);
      setNewChapterFiles([]);
      router.refresh();
    } catch {
      setAddChaptersError("Couldn't add chapters. Try again.");
    } finally {
      setSavingChapters(false);
      setNewChapterStatuses([]);
      setNewChapterProgress([]);
    }
  }

  async function handleCoverSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setCoverUploading(true);
    setCoverError(null);
    try {
      const coverId = crypto.randomUUID();
      const presigned = await presignUpload(file, "cover", coverId);
      await uploadWithProgress(presigned.url, file, () => {});

      const res = await fetch(`/api/library/${bookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverKey: presigned.key }),
      });
      if (!res.ok) throw new Error("Failed to update cover");

      router.refresh();
    } catch {
      setCoverError("Couldn't update the cover. Try again.");
    } finally {
      setCoverUploading(false);
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const saved = getProgress(bookId);
    let cancelled = false;
    retryCountRef.current = 0;
    setLoadError(false);

    function onLoadedMetadata() {
      if (!audio) return;
      setDuration(audio.duration);

      if (pendingSeekRef.current != null) {
        const seekTo = pendingSeekRef.current;
        pendingSeekRef.current = null;
        appliedResumeRef.current = true;
        audio.currentTime = seekTo;
        setCurrentTime(seekTo);
        audio.volume = volume;
        audio.playbackRate = rate;
        if (wasPlayingRef.current) {
          audio.play().catch(() => {});
        }
        return;
      }

      if (!appliedResumeRef.current) {
        const validSavedChapter =
          saved && saved.chapterIndex >= 0 && saved.chapterIndex < chapters.length;

        if (validSavedChapter && saved!.chapterIndex !== chapterIndex) {
          setChapterIndex(saved!.chapterIndex);
          audio.volume = volume;
          audio.playbackRate = rate;
          return;
        }

        appliedResumeRef.current = true;
        if (validSavedChapter && saved!.position > 0 && saved!.position < audio.duration - 2) {
          audio.currentTime = saved!.position;
          setCurrentTime(saved!.position);
        }
      }

      audio.volume = volume;
      audio.playbackRate = rate;
      if (wasPlayingRef.current) {
        audio.play().catch(() => {});
      }
    }

    function onTimeUpdate() {
      if (!audio) return;
      setCurrentTime(audio.currentTime);
      if (Math.abs(audio.currentTime - lastSavedRef.current) >= SAVE_INTERVAL_SECONDS) {
        setProgress(bookId, chapterIndex, audio.currentTime);
        lastSavedRef.current = audio.currentTime;
      }
    }

    function onPlay() {
      setIsPlaying(true);
      wasPlayingRef.current = true;
    }

    function onPause() {
      if (!audio) return;
      setIsPlaying(false);
      wasPlayingRef.current = false;
      setProgress(bookId, chapterIndex, audio.currentTime);
      lastSavedRef.current = audio.currentTime;
    }

    function onEnded() {
      if (!audio) return;
      if (chapterIndex < chapters.length - 1) {
        wasPlayingRef.current = true;
        setChapterIndex(chapterIndex + 1);
      } else {
        setIsPlaying(false);
        wasPlayingRef.current = false;
        setProgress(bookId, chapterIndex, audio.duration);
      }
    }

    async function onError() {
      if (!audio || cancelled) return;
      if (retryCountRef.current >= MAX_LOAD_RETRIES) {
        setLoadError(true);
        setIsPlaying(false);
        wasPlayingRef.current = false;
        return;
      }
      retryCountRef.current += 1;
      try {
        const freshUrl = await refreshChapterUrl(chapterIndex);
        if (cancelled) return;
        setChapterUrls((prev) => {
          const next = [...prev];
          next[chapterIndex] = freshUrl;
          return next;
        });
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setIsPlaying(false);
          wasPlayingRef.current = false;
        }
      }
    }

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      cancelled = true;
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterIndex, chapters.length]);

  useEffect(() => {
    function handleVisibility() {
      const audio = audioRef.current;
      if (audio && document.visibilityState === "hidden") {
        setProgress(bookId, chapterIndex, audio.currentTime);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [bookId, chapterIndex]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play();
    else audio.pause();
  }

  function skip(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const max = duration || audio.duration || 0;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), max);
    setCurrentTime(audio.currentTime);
  }

  function goToSegment(index: number) {
    const seg = segments[index];
    if (!seg) return;
    const audio = audioRef.current;
    if (seg.chapterIndex === chapterIndex) {
      if (!audio) return;
      audio.currentTime = seg.start;
      setCurrentTime(seg.start);
      wasPlayingRef.current = true;
      audio.play().catch(() => {});
      return;
    }
    wasPlayingRef.current = true;
    appliedResumeRef.current = true;
    pendingSeekRef.current = seg.start;
    setChapterIndex(seg.chapterIndex);
  }

  async function patchMarkers(key: string, markers: number[]) {
    setSplittingChapter(true);
    setSplitError(null);
    try {
      const res = await fetch(`/api/library/${bookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterMarkers: { key, markers } }),
      });
      if (!res.ok) throw new Error("Failed to update chapter splits");
      router.refresh();
    } catch {
      setSplitError("Couldn't update splits. Try again.");
    } finally {
      setSplittingChapter(false);
    }
  }

  function removeMarker(chapterIdx: number, markerValue: number) {
    const target = chapters[chapterIdx];
    const next = (target.markers ?? []).filter((m) => m !== markerValue);
    patchMarkers(target.key, next);
  }

  async function autoSplitBook() {
    if (autoSplitCandidates.length === 0) return;
    const ok = window.confirm(
      `Split ${autoSplitCandidates.length} chapter${
        autoSplitCandidates.length > 1 ? "s" : ""
      } over 1 hour into 1-hour parts? Chapters that already have manual splits are left alone.`
    );
    if (!ok) return;

    setSplittingChapter(true);
    setSplitError(null);
    try {
      for (const c of autoSplitCandidates) {
        const markers: number[] = [];
        for (let t = AUTO_SPLIT_INTERVAL_SECONDS; t < c.duration!; t += AUTO_SPLIT_INTERVAL_SECONDS) {
          markers.push(t);
        }
        const res = await fetch(`/api/library/${bookId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chapterMarkers: { key: c.key, markers } }),
        });
        if (!res.ok) throw new Error("Failed to auto-split");
      }
      router.refresh();
    } catch {
      setSplitError("Couldn't auto-split all chapters. Try again.");
    } finally {
      setSplittingChapter(false);
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  }

  function handleVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }

  function handleRateChange(newRate: number) {
    setRate(newRate);
    if (audioRef.current) audioRef.current.playbackRate = newRate;
  }

  const chapter = chapters[chapterIndex];
  const activeSegment = segments[currentSegmentIndex];
  const segStart = activeSegment?.start ?? 0;
  const segEnd = activeSegment?.end ?? duration;
  const segElapsed = Math.min(Math.max(0, currentTime - segStart), Math.max(0, segEnd - segStart));
  const segTotal = Math.max(0, segEnd - segStart);
  const seekPct = segTotal ? (segElapsed / segTotal) * 100 : 0;
  const volumePct = volume * 100;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-4 py-8">
      <div className="mb-8 flex w-full items-center justify-between">
        <Link
          href="/"
          aria-label="Back to library"
          className="neu-raised neu-pressable flex h-11 w-11 items-center justify-center rounded-full text-zinc-300 hover:text-white"
        >
          ←
        </Link>
        <p className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
          Playing now
        </p>
        <a
          href="#chapters"
          aria-label="Jump to chapters"
          className="neu-raised neu-pressable flex h-11 w-11 items-center justify-center rounded-full text-lg text-zinc-300 hover:text-white"
        >
          ☰
        </a>
      </div>

      <div className="group relative mb-2 aspect-square w-full max-w-xs">
        <div className="cover-glow h-full w-full overflow-hidden rounded-full bg-surface">
          {coverUrl ? (
            <Image
              src={coverUrl}
              alt={title}
              width={400}
              height={400}
              unoptimized
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-6xl text-zinc-600">
              📖
            </div>
          )}
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          onChange={handleCoverSelect}
          className="hidden"
        />
        <button
          onClick={() => coverInputRef.current?.click()}
          disabled={coverUploading}
          aria-label="Replace cover image"
          className="absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-base text-zinc-200 opacity-100 backdrop-blur transition-opacity hover:bg-black/80 disabled:opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          {coverUploading ? "…" : "✏️"}
        </button>
      </div>
      {coverError && <p className="mb-4 text-xs text-red-400">{coverError}</p>}

      <h1 className="mt-4 text-center text-xl font-semibold text-zinc-50">{title}</h1>
      <p className="text-center text-sm text-zinc-400">{author}</p>
      {segments.length > 1 && (
        <p className="mb-2 mt-1 text-center text-xs text-zinc-500">
          Chapter {chapterIndex + 1} of {chapters.length} ·{" "}
          {segments[currentSegmentIndex]?.label ?? chapter.label}
        </p>
      )}

      <audio
        key={chapterIndex}
        ref={audioRef}
        src={chapterUrls[chapterIndex]}
        preload="metadata"
        className="mt-6"
      />

      {loadError && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-500/10 px-3.5 py-2 text-xs text-red-400">
          <span>Couldn&apos;t load this chapter.</span>
          <button
            onClick={retryLoad}
            className="font-medium underline underline-offset-2 hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mt-6 w-full">
        <input
          type="range"
          min={segStart}
          max={segEnd || segStart}
          value={currentTime}
          onChange={handleSeek}
          className="player-range"
          style={{ "--range-progress": `${seekPct}%` } as React.CSSProperties}
        />
        <div className="mt-2 flex justify-between text-xs tabular-nums text-zinc-400">
          <span>{formatClock(segElapsed)}</span>
          <span>{formatClock(segTotal)}</span>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center gap-5">
        {segments.length > 1 && (
          <button
            onClick={() => goToSegment(currentSegmentIndex - 1)}
            disabled={currentSegmentIndex === 0}
            aria-label="Previous chapter"
            className="neu-raised neu-pressable flex h-11 w-11 items-center justify-center rounded-full text-lg text-zinc-300 hover:text-white disabled:opacity-30"
          >
            ⏮
          </button>
        )}

        <button
          onClick={() => skip(-SKIP_BACK_SECONDS)}
          aria-label={`Back ${SKIP_BACK_SECONDS} seconds`}
          className="neu-raised neu-pressable flex h-14 w-14 flex-col items-center justify-center rounded-full text-zinc-300 hover:text-white"
        >
          <span className="text-xl leading-none">⟲</span>
          <span className="mt-0.5 text-[10px] leading-none">{SKIP_BACK_SECONDS}s</span>
        </button>

        <button
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="accent-gradient accent-glow neu-pressable flex h-18 w-18 items-center justify-center rounded-full text-2xl text-white"
          style={{ height: "4.5rem", width: "4.5rem" }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <button
          onClick={() => skip(SKIP_FORWARD_SECONDS)}
          aria-label={`Forward ${SKIP_FORWARD_SECONDS} seconds`}
          className="neu-raised neu-pressable flex h-14 w-14 flex-col items-center justify-center rounded-full text-zinc-300 hover:text-white"
        >
          <span className="text-xl leading-none">⟳</span>
          <span className="mt-0.5 text-[10px] leading-none">{SKIP_FORWARD_SECONDS}s</span>
        </button>

        {segments.length > 1 && (
          <button
            onClick={() => goToSegment(currentSegmentIndex + 1)}
            disabled={currentSegmentIndex === segments.length - 1}
            aria-label="Next chapter"
            className="neu-raised neu-pressable flex h-11 w-11 items-center justify-center rounded-full text-lg text-zinc-300 hover:text-white disabled:opacity-30"
          >
            ⏭
          </button>
        )}
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => handleRateChange(s)}
            className={`neu-pressable rounded-full px-3.5 py-1.5 text-xs font-medium ${
              rate === s
                ? "accent-gradient text-white"
                : "neu-raised-sm text-zinc-300 hover:text-white"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="mt-6 flex w-full items-center gap-3">
        <span className="text-xs text-zinc-400">🔈</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={handleVolume}
          className="player-range flex-1"
          style={{ "--range-progress": `${volumePct}%` } as React.CSSProperties}
        />
      </div>

      <div id="chapters" className="mt-8 w-full scroll-mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Chapters</p>
            {reordering ? (
              <div className="flex items-center gap-3">
                {reorderError && <span className="text-xs text-red-400">{reorderError}</span>}
                <button
                  onClick={cancelReordering}
                  disabled={savingOrder}
                  className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={saveOrder}
                  disabled={savingOrder}
                  className="accent-gradient neu-pressable rounded-full px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {savingOrder ? "Saving..." : "Save order"}
                </button>
              </div>
            ) : addingChapters ? (
              <div className="flex items-center gap-3">
                {addChaptersError && <span className="text-xs text-red-400">{addChaptersError}</span>}
                <button
                  onClick={cancelAddingChapters}
                  disabled={savingChapters}
                  className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitNewChapters}
                  disabled={savingChapters || newChapterFiles.length === 0}
                  className="accent-gradient neu-pressable rounded-full px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {savingChapters ? "Adding..." : "Add"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {splitError && <span className="text-xs text-red-400">{splitError}</span>}
                {autoSplitCandidates.length > 0 && (
                  <button
                    onClick={autoSplitBook}
                    disabled={splittingChapter}
                    className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                  >
                    {splittingChapter ? "Splitting..." : "Auto-split into chapters"}
                  </button>
                )}
                {chapters.length > 1 && (
                  <button
                    onClick={startReordering}
                    className="text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    Reorder
                  </button>
                )}
                <button
                  onClick={startAddingChapters}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Add chapters
                </button>
              </div>
            )}
          </div>

          {addingChapters && (
            <div className="neu-inset mb-3 rounded-2xl p-3">
              <input
                ref={newChapterInputRef}
                type="file"
                accept="audio/*"
                multiple
                onChange={handleNewChapterSelect}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => newChapterInputRef.current?.click()}
                  className="rounded-full bg-surface-2 px-3 py-1.5 text-xs text-white hover:opacity-90"
                >
                  Choose files
                </button>
                <span className="text-xs text-zinc-500">
                  {newChapterFiles.length > 0
                    ? `${newChapterFiles.length} file${newChapterFiles.length > 1 ? "s" : ""} selected`
                    : "no files selected"}
                </span>
              </div>
              {newChapterFiles.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {newChapterFiles.map((file, i) => (
                    <li
                      key={`${file.name}-${i}`}
                      className="flex items-center justify-between gap-2 text-xs text-zinc-300"
                    >
                      <span className="truncate">
                        {i + 1}. {file.name}
                      </span>
                      {savingChapters ? (
                        <span className="shrink-0 text-zinc-500">
                          {newChapterStatuses[i] === "done"
                            ? "Done"
                            : newChapterStatuses[i] === "uploading"
                            ? `${Math.round((newChapterProgress[i] ?? 0) * 100)}%`
                            : "Waiting…"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeNewChapterFile(i)}
                          className="shrink-0 text-zinc-500 hover:text-red-400"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {segments.length > 1 && (reordering ? (
            <ul className="neu-inset max-h-64 overflow-y-auto rounded-2xl p-1.5">
              {draftChapters.map((c, i) => (
                <li key={c.key} className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm text-zinc-300">
                  <span className="flex-1 truncate">
                    {i + 1}. {c.label}
                  </span>
                  <button
                    onClick={() => moveDraftChapter(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${c.label} up`}
                    className="neu-raised-sm neu-pressable flex h-7 w-7 items-center justify-center rounded-full text-xs text-zinc-300 hover:text-white disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveDraftChapter(i, 1)}
                    disabled={i === draftChapters.length - 1}
                    aria-label={`Move ${c.label} down`}
                    className="neu-raised-sm neu-pressable flex h-7 w-7 items-center justify-center rounded-full text-xs text-zinc-300 hover:text-white disabled:opacity-30"
                  >
                    ↓
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="neu-inset max-h-64 overflow-y-auto rounded-2xl p-1.5">
              {segments.map((seg, i) => {
                const chapterDuration = chapters[seg.chapterIndex].duration;
                const segDuration =
                  seg.end != null
                    ? seg.end - seg.start
                    : chapterDuration != null
                    ? chapterDuration - seg.start
                    : null;
                return (
                  <li key={`${seg.key}-${seg.partIndex}`} className="flex items-center gap-1">
                    <button
                      onClick={() => goToSegment(i)}
                      className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left text-sm ${
                        i === currentSegmentIndex
                          ? "neu-raised-sm text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <span className="truncate">
                        {seg.numberLabel}. {seg.label}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {segDuration != null && (
                          <span className="text-xs text-zinc-500">{formatClock(segDuration)}</span>
                        )}
                        {i === currentSegmentIndex && (
                          <span className="accent-gradient flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-white">
                            {isPlaying ? "⏸" : "▶"}
                          </span>
                        )}
                      </span>
                    </button>
                    {seg.partIndex > 0 && (
                      <button
                        onClick={() => removeMarker(seg.chapterIndex, seg.start)}
                        disabled={splittingChapter}
                        aria-label={`Remove split before ${seg.label}`}
                        className="neu-raised-sm neu-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs text-zinc-400 hover:text-red-400 disabled:opacity-40"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ))}
      </div>
    </div>
  );
}
