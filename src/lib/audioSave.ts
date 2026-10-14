// Saving a video's audio from the deck: asks /api/audio to convert it (with
// progress), then writes the file where the listener chose with the browser's
// save dialog, or downloads it in browsers without one.
import { audioFormat, type AudioFormat } from "./audioFormats";

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      id?: string;
      startIn?: string;
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

/** "ready"; "needs-tools" (yt-dlp or FFmpeg missing); "unavailable" (not running on this computer). */
export type AudioSupport = "ready" | "needs-tools" | "unavailable";

export async function checkAudioSupport(): Promise<AudioSupport> {
  try {
    const res = await fetch("/api/audio", { cache: "no-store" });
    const data = (await res.json()) as { available?: boolean; reason?: string };
    if (data.available) return "ready";
    return data.reason === "tools" ? "needs-tools" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export type SaveProgress = { stage: "download"; done: number } | { stage: "convert" };
export type Converted = { file: string; title: string; author: string };

/** A failure. `fatal` ones (server unreachable, tools missing, busy) would fail for every track. */
export class SaveError extends Error {
  constructor(message: string, readonly fatal = false) {
    super(message);
  }
}

/** Has Tape Deck's server convert a video's audio, reporting progress until it's ready to fetch. */
export async function convertAudio(
  videoId: string,
  format: AudioFormat,
  signal: AbortSignal,
  onProgress: (progress: SaveProgress) => void,
): Promise<Converted> {
  let res: Response;
  try {
    res = await fetch("/api/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: videoId, format }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new SaveError("Couldn't reach Tape Deck's server. Is it still running?", true);
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new SaveError(data.error ?? "Couldn't save the audio.", res.status !== 400);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line) as SaveProgress | { error: string } | (Converted & { done: true });
      if ("error" in event) throw new SaveError(event.error);
      if ("file" in event) return { file: event.file, title: event.title, author: event.author };
      onProgress(event);
    }
  }
  throw new SaveError("The conversion stopped unexpectedly.");
}

/** Writes a converted file into `target`. An interrupted write leaves the target as it was. */
export async function writeConverted(file: string, target: FileSystemFileHandle, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/audio?file=${encodeURIComponent(file)}`, { signal });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new SaveError(data.error ?? "Couldn't fetch the converted file.");
  }
  const writable = await target.createWritable();
  await res.body.pipeTo(writable, { signal });
}

/** For browsers without a save dialog: let the browser download it. */
export function downloadConverted(file: string) {
  const link = document.createElement("a");
  link.href = `/api/audio?file=${encodeURIComponent(file)}`;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

const isCancel = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * Opens the save dialog for one file. Returns null if the listener cancels,
 * or undefined if this browser has no save dialog.
 */
export async function pickAudioFile(suggestedName: string, format: AudioFormat): Promise<FileSystemFileHandle | null | undefined> {
  if (typeof window.showSaveFilePicker !== "function") return undefined;
  const { name, mime } = audioFormat(format);
  try {
    return await window.showSaveFilePicker({
      id: "tapedeck-audio",
      startIn: "music",
      suggestedName,
      types: [{ description: `${name} audio`, accept: { [mime]: [`.${format}`] } }],
    });
  } catch (error) {
    if (isCancel(error)) return null;
    throw new SaveError("The browser didn't allow saving there. Pick another folder.");
  }
}

/** Opens the folder dialog for saving several files. Returns null if the listener cancels. */
export async function pickAudioFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await window.showDirectoryPicker?.({ id: "tapedeck-audio", mode: "readwrite", startIn: "music" })) ?? null;
  } catch (error) {
    if (isCancel(error)) return null;
    throw new SaveError("The browser didn't allow saving into that folder. Pick another one.");
  }
}

/** Removes a file the save dialog created but nothing was written to. */
export async function removeIfEmpty(target: FileSystemFileHandle) {
  try {
    if ((await target.getFile()).size === 0) await (target as FileSystemFileHandle & { remove?: () => Promise<void> }).remove?.();
  } catch {
    // Leave it.
  }
}

/** Saves a video's cover art into a folder (used as an offline tape's cover). */
export async function saveCover(videoId: string, folder: FileSystemDirectoryHandle, signal: AbortSignal) {
  try {
    const res = await fetch(`/api/cover?id=${encodeURIComponent(videoId)}`, { signal });
    if (!res.ok || !res.body) return;
    const file = await folder.getFileHandle("cover.jpg", { create: true });
    await res.body.pipeTo(await file.createWritable(), { signal });
  } catch {
    // The tape just won't have a cover.
  }
}
