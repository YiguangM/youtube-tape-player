// Offline tapes: folders of audio or video files on this computer.
//
// Folders are opened with the browser's folder picker (File System Access API,
// Chrome and Edge), so the app can only read folders the listener chose. The
// folder handle is kept in IndexedDB so the tape works again after a reload;
// the browser may ask for permission again after a restart. Files never leave
// the computer.
import { useSyncExternalStore } from "react";

type ReadPermission = { mode: "read" };

/** The parts of the File System Access API this app uses. */
type FolderHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission?(descriptor: ReadPermission): Promise<PermissionState>;
  requestPermission?(descriptor: ReadPermission): Promise<PermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite"; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

export type LocalTrack = { id: string; title: string; file: FileSystemFileHandle; video: boolean };

const AUDIO = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus"];
const VIDEO = ["mp4", "m4v", "webm", "mov"];
const COVERS = ["cover", "folder", "front", "album"];
const IMAGES = ["jpg", "jpeg", "png", "webp"];
const naturally = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const extension = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/** "03 - My_Song.mp3" -> "My Song" */
export function trackTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  return base.replace(/^\d{1,3}\s*[-._)]\s*/, "").trim() || base.trim() || fileName;
}

const noSubscription = () => () => {};

/** True when this browser has the folder picker (Chrome and Edge on desktop). */
export function useFolderPickerSupported(): boolean {
  return useSyncExternalStore(noSubscription, () => typeof window.showDirectoryPicker === "function", () => false);
}

/** Opens the system folder dialog. Returns null if the listener cancels. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await window.showDirectoryPicker?.({ id: "tapedeck-music", mode: "read", startIn: "music" })) ?? null;
  } catch {
    return null; // cancelled, or blocked
  }
}

/** The folder's audio/video files (sorted by name, numbers in order) and its cover image, if any. */
export async function readFolder(handle: FileSystemDirectoryHandle): Promise<{ tracks: LocalTrack[]; cover: File | null }> {
  const files: FileSystemFileHandle[] = [];
  let coverHandle: FileSystemFileHandle | null = null;
  for await (const entry of (handle as FolderHandle).values()) {
    if (entry.kind !== "file") continue;
    const file = entry as FileSystemFileHandle;
    const ext = extension(file.name);
    if (AUDIO.includes(ext) || VIDEO.includes(ext)) files.push(file);
    else if (IMAGES.includes(ext) && COVERS.includes(file.name.replace(/\.[^.]+$/, "").toLowerCase())) coverHandle ??= file;
  }
  files.sort((a, b) => naturally.compare(a.name, b.name));
  const tracks = files.map((file, i) => ({ id: String(i), title: trackTitle(file.name), file, video: VIDEO.includes(extension(file.name)) }));
  const cover = coverHandle ? await coverHandle.getFile().catch(() => null) : null;
  return { tracks, cover };
}

/** Makes sure the app may read the folder, asking the listener if needed. */
export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const folder = handle as FolderHandle;
  try {
    if (!folder.queryPermission) return true; // e.g. the browser's private file system
    if ((await folder.queryPermission({ mode: "read" })) === "granted") return true;
    return (await folder.requestPermission?.({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

// --- Remembering folders (IndexedDB) ------------------------------------------

const DB_NAME = "tapedeck";
const STORE = "folders";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(undefined);
      };
    });
  } catch {
    return undefined; // IndexedDB unavailable (e.g. some private windows)
  }
}

export async function rememberFolder(tapeId: string, handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await withStore("readwrite", (store) => store.put(handle, tapeId))) !== undefined;
}

export async function recallFolder(tapeId: string): Promise<FileSystemDirectoryHandle | null> {
  const handle = await withStore<unknown>("readonly", (store) => store.get(tapeId));
  return handle && typeof handle === "object" && (handle as FileSystemHandle).kind === "directory"
    ? (handle as FileSystemDirectoryHandle)
    : null;
}

export async function forgetFolder(tapeId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(tapeId));
}

export type OpenedFolder =
  | { ok: true; tracks: LocalTrack[]; cover: File | null }
  | { ok: false; error: string };

/** Reopens an offline tape's folder: recall it, get permission, list its files. */
export async function openFolderTape(tapeId: string): Promise<OpenedFolder> {
  const handle = await recallFolder(tapeId);
  if (!handle) return { ok: false, error: "This browser no longer has that folder. Remove the tape and add the folder again." };
  if (!(await ensureReadPermission(handle))) return { ok: false, error: "Tape Deck needs permission to read that folder. Insert the tape again and choose Allow." };
  try {
    const { tracks, cover } = await readFolder(handle);
    if (tracks.length === 0) return { ok: false, error: "That folder has no audio or video files any more." };
    return { ok: true, tracks, cover };
  } catch {
    return { ok: false, error: "Couldn't open that folder. It may have been moved or deleted." };
  }
}
