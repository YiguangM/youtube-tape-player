// The tape rack, kept in localStorage under a versioned schema.
//
// Version 1 (key "tapedeck:tapes") was a bare array of { kind?, id, title, author }.
// Version 2 (key "tapedeck:rack") wraps the tapes with a version number, adds
// timestamps, and keeps a resume position per tape. Version 1 racks are migrated
// automatically the first time the app loads.
import { createStoredValue, readStorage, removeStorage, writeStorage } from "./stored";
import { isListId, isVideoId } from "./youtube";

export const RACK_VERSION = 2;
const RACK_KEY = "tapedeck:rack";
const LEGACY_KEY = "tapedeck:tapes";
const BACKUP_KEY = "tapedeck:rack-unreadable";

type TapeBase = {
  id: string;
  title: string;
  author: string;
  addedAt: number;
  playedAt?: number;
};
export type VideoTape = TapeBase & { kind: "video" };
/** A YouTube playlist, played as a mixtape. */
export type PlaylistTape = TapeBase & { kind: "playlist" };
export type Tape = VideoTape | PlaylistTape;
export type TapeKind = Tape["kind"];

/**
 * Where a tape was left: seconds into the video (t) of its length (d) and, on a
 * mixtape, the track index and how many tracks it had (n).
 */
export type Resume = { t: number; d: number; track?: number; n?: number; at: number };

export type Rack = {
  version: typeof RACK_VERSION;
  tapes: Tape[];
  resume: Record<string, Resume>;
};

const EMPTY_RACK: Rack = { version: RACK_VERSION, tapes: [], resume: {} };
const MAX_TEXT = 300;

export const tapeKey = (tape: { kind: TapeKind; id: string }) => `${tape.kind}:${tape.id}`;

// --- Decoding ---------------------------------------------------------------

const text = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_TEXT) : undefined);
const nonNegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

export function decodeTape(value: unknown): Tape | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const base = {
    id: typeof v.id === "string" ? v.id : "",
    title: text(v.title) ?? "",
    author: text(v.author) ?? "",
    addedAt: nonNegative(v.addedAt) ?? 0,
    ...(nonNegative(v.playedAt) !== undefined && { playedAt: nonNegative(v.playedAt) }),
  };
  if (v.kind === "video" && isVideoId(base.id)) return { ...base, kind: "video" };
  if (v.kind === "playlist" && isListId(base.id)) return { ...base, kind: "playlist" };
  return undefined;
}

function decodeResume(value: unknown): Resume | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const t = nonNegative(v.t);
  const d = nonNegative(v.d);
  if (t === undefined || d === undefined) return undefined;
  const track = nonNegative(v.track);
  const n = nonNegative(v.n);
  return {
    t,
    d,
    at: nonNegative(v.at) ?? 0,
    ...(track !== undefined && Number.isInteger(track) && { track }),
    ...(n !== undefined && Number.isInteger(n) && { n }),
  };
}

/** Validates a version 2 rack, dropping any tapes or resume entries that don't fit. */
export function decodeRack(value: unknown): Rack | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.version !== RACK_VERSION || !Array.isArray(v.tapes)) return undefined;

  const seen = new Set<string>();
  const tapes: Tape[] = [];
  for (const item of v.tapes) {
    const tape = decodeTape(item);
    if (tape && !seen.has(tapeKey(tape))) {
      seen.add(tapeKey(tape));
      tapes.push(tape);
    }
  }

  const resume: Record<string, Resume> = {};
  if (v.resume && typeof v.resume === "object") {
    for (const [key, entry] of Object.entries(v.resume as Record<string, unknown>)) {
      const decoded = decodeResume(entry);
      if (decoded && seen.has(key)) resume[key] = decoded;
    }
  }
  return { version: RACK_VERSION, tapes, resume };
}

/** Converts a version 1 rack, keeping its order as the "added" order. */
function migrateFromV1(): Rack | undefined {
  const raw = readStorage(LEGACY_KEY);
  if (raw === null) return undefined;
  let items: unknown;
  try {
    items = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(items)) return undefined;
  const now = Date.now();
  const tapes = items.map((item, i) =>
    item && typeof item === "object"
      ? { ...item, kind: (item as { kind?: unknown }).kind === "playlist" ? "playlist" : "video", addedAt: now - (items.length - i) * 1000 }
      : item,
  );
  return decodeRack({ version: RACK_VERSION, tapes, resume: {} });
}

export const useRack = createStoredValue<Rack>(RACK_KEY, EMPTY_RACK, decodeRack, {
  migrate: migrateFromV1,
  afterMigrate: () => removeStorage(LEGACY_KEY),
  // Keep a copy rather than letting the next save overwrite data we couldn't read.
  onUnreadable: (raw) => {
    if (readStorage(BACKUP_KEY) === null) writeStorage(BACKUP_KEY, raw);
  },
});

// --- Updates (pure: each returns a new rack) -----------------------------------

export function withTape(rack: Rack, tape: Tape): Rack {
  if (rack.tapes.some((t) => tapeKey(t) === tapeKey(tape))) return rack;
  return { ...rack, tapes: [...rack.tapes, tape] };
}

export function withoutTape(rack: Rack, key: string): Rack {
  const resume = { ...rack.resume };
  delete resume[key];
  return { ...rack, tapes: rack.tapes.filter((t) => tapeKey(t) !== key), resume };
}

export function withResume(rack: Rack, key: string, entry: Resume): Rack {
  if (!rack.tapes.some((t) => tapeKey(t) === key)) return rack;
  return { ...rack, resume: { ...rack.resume, [key]: entry } };
}

const NEAR_END = 10; // seconds: closer than this to the end starts over

/**
 * Where to start a tape: its saved position, or the beginning if it was left
 * within 10 seconds of the end. On a mixtape, a track left near its end moves
 * on to the next track.
 */
export function resumePoint(rack: Rack, key: string): { seconds: number; track: number } {
  const saved = rack.resume[key];
  if (!saved) return { seconds: 0, track: 0 };
  const track = saved.track ?? 0;
  const nearEnd = saved.d > 0 && saved.t > saved.d - NEAR_END;
  if (!nearEnd) return { seconds: saved.t, track };
  const isLastTrack = saved.n === undefined || track >= saved.n - 1;
  return isLastTrack ? { seconds: 0, track: 0 } : { seconds: 0, track: track + 1 };
}
