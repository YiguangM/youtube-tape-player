// The tape rack, kept in localStorage under a versioned schema.
//
// Version 1 (key "tapedeck:tapes") was a bare array of { kind?, id, title, author }.
// Version 2 (key "tapedeck:rack") wraps the tapes with a version number, adds
// timestamps, and keeps a resume position per tape. Version 1 racks are migrated
// automatically the first time the app loads. Later additions to version 2
// (custom mixtapes, custom labels and shell colours) are new tape kinds or
// optional fields, so older version 2 racks still decode as they are.
import { SHELL_IDS, type LabelFont, type ShellId } from "./shells";
import { createStoredValue, readStorage, removeStorage, writeStorage } from "./stored";
import { isListId, isVideoId } from "./youtube";

export const RACK_VERSION = 2;
const RACK_KEY = "tapedeck:rack";
const LEGACY_KEY = "tapedeck:tapes";
const BACKUP_KEY = "tapedeck:rack-unreadable";

/** A handwritten-or-typed label the listener wrote on the cassette. */
export type TapeLabel = { text: string; font: LabelFont };

type TapeBase = {
  id: string;
  title: string;
  author: string;
  addedAt: number;
  playedAt?: number;
  label?: TapeLabel;
  shell?: ShellId;
};
export type VideoTape = TapeBase & { kind: "video" };
/** A YouTube playlist, played as a mixtape. Read-only: YouTube owns its tracks. */
export type PlaylistTape = TapeBase & { kind: "playlist" };
/** A track on a custom mixtape. */
export type Track = { id: string; title: string; author: string };
/** A mixtape the listener built from single videos in their rack. */
export type CustomMixtape = TapeBase & { kind: "custom"; tracks: Track[] };
export type Tape = VideoTape | PlaylistTape | CustomMixtape;
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
const MAX_TRACKS = 500;
const MIXTAPE_ID = /^m[a-z0-9]{6,24}$/;
export const MAX_NAME = 80;
export const MAX_LABEL = 60;

export const tapeKey = (tape: { kind: TapeKind; id: string }) => `${tape.kind}:${tape.id}`;

// --- Decoding ---------------------------------------------------------------

const text = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_TEXT) : undefined);
const nonNegative = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

function decodeTrack(value: unknown): Track | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !isVideoId(v.id)) return undefined;
  return { id: v.id, title: text(v.title) ?? "", author: text(v.author) ?? "" };
}

function decodeTracks(value: unknown): Track[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const item of value) {
    const track = decodeTrack(item);
    if (track && !seen.has(track.id) && tracks.length < MAX_TRACKS) {
      seen.add(track.id);
      tracks.push(track);
    }
  }
  return tracks;
}

function decodeLabel(value: unknown): TapeLabel | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const labelText = typeof v.text === "string" ? v.text.slice(0, MAX_LABEL) : "";
  const font: LabelFont = v.font === "typed" ? "typed" : "handwritten";
  return labelText.trim() || font !== "handwritten" ? { text: labelText, font } : undefined;
}

export function decodeTape(value: unknown): Tape | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const label = decodeLabel(v.label);
  const shell = SHELL_IDS.find((id) => id === v.shell);
  const base = {
    id: typeof v.id === "string" ? v.id : "",
    title: text(v.title) ?? "",
    author: text(v.author) ?? "",
    addedAt: nonNegative(v.addedAt) ?? 0,
    ...(nonNegative(v.playedAt) !== undefined && { playedAt: nonNegative(v.playedAt) }),
    ...(label && { label }),
    ...(shell && shell !== "smoke" && { shell }),
  };
  if (v.kind === "video" && isVideoId(base.id)) return { ...base, kind: "video" };
  if (v.kind === "playlist" && isListId(base.id)) return { ...base, kind: "playlist" };
  if (v.kind === "custom" && MIXTAPE_ID.test(base.id)) {
    const tracks = decodeTracks(v.tracks);
    if (tracks) return { ...base, title: base.title.slice(0, MAX_NAME), kind: "custom", tracks };
  }
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

export function withUpdatedTape(rack: Rack, key: string, update: (tape: Tape) => Tape): Rack {
  return { ...rack, tapes: rack.tapes.map((t) => (tapeKey(t) === key ? update(t) : t)) };
}

/** The text on the cassette label: the listener's own, or the video title. */
export function labelText(tape: Tape): string {
  return tape.label?.text.trim() || tape.title;
}

/** Sets or clears a tape's custom label and shell colour. */
export function withLook(rack: Rack, key: string, label: TapeLabel | undefined, shell: ShellId | undefined): Rack {
  return withUpdatedTape(rack, key, (t) => {
    const next = { ...t };
    delete next.label;
    delete next.shell;
    if (label && (label.text.trim() || label.font !== "handwritten")) {
      next.label = { text: label.text.slice(0, MAX_LABEL), font: label.font };
    }
    if (shell && shell !== "smoke") next.shell = shell;
    return next;
  });
}

// --- Custom mixtapes ---------------------------------------------------------

export function newMixtape(name: string): CustomMixtape {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const id = "m" + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
  return { kind: "custom", id, title: name.trim().slice(0, MAX_NAME) || "Untitled mixtape", author: "", addedAt: Date.now(), tracks: [] };
}

/**
 * Replaces a custom mixtape's tracks. Its saved position is dropped, since the
 * old track index may now point at a different song.
 */
export function withMixtapeTracks(rack: Rack, mixtapeId: string, tracks: Track[]): Rack {
  const key = tapeKey({ kind: "custom", id: mixtapeId });
  const updated = withUpdatedTape(rack, key, (t) => (t.kind === "custom" ? { ...t, tracks: tracks.slice(0, MAX_TRACKS) } : t));
  const resume = { ...updated.resume };
  delete resume[key];
  return { ...updated, resume };
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

// --- Sorting ------------------------------------------------------------------

export type RackSort = "added" | "played" | "title";
/** The search and sort toolbar appears once the rack holds more tapes than this. */
export const RACK_TOOLS_AFTER = 8;

const byTitle = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

export function sortTapes(tapes: Tape[], sort: RackSort): Tape[] {
  const sorted = [...tapes];
  if (sort === "title") return sorted.sort((a, b) => byTitle.compare(a.title, b.title));
  if (sort === "played") {
    return sorted.sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0) || b.addedAt - a.addedAt);
  }
  return sorted.sort((a, b) => b.addedAt - a.addedAt);
}

/** The rack in the order it's shown: sorted once the toolbar is showing. */
export function rackOrder(tapes: Tape[], sort: RackSort): Tape[] {
  return tapes.length > RACK_TOOLS_AFTER ? sortTapes(tapes, sort) : tapes;
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
