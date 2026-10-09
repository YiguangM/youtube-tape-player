// Exporting the rack to a JSON file and importing it back.
import { decodeRack, RACK_VERSION, tapeKey, type Rack } from "./rackStore";

export const MAX_IMPORT_BYTES = 2_000_000;

/** The file contents and name for "Export rack". */
export function exportRack(rack: Rack, now = new Date()): { name: string; text: string } {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  const file = { app: "Tape Deck", version: RACK_VERSION, exportedAt: now.toISOString(), tapes: rack.tapes, resume: rack.resume };
  return { name: `tape-deck-rack-${date}.json`, text: JSON.stringify(file, null, 2) };
}

export type ImportCheck =
  | { ok: true; rack: Rack; skipped: number }
  | { ok: false; error: string };

/**
 * Checks an imported file: size, JSON, schema version and every tape (only
 * valid YouTube video and playlist IDs get through). Tapes that don't pass are
 * counted as skipped rather than failing the whole import.
 */
export function checkRackFile(text: string, bytes: number): ImportCheck {
  if (bytes > MAX_IMPORT_BYTES) {
    return { ok: false, error: `That file is too big (over ${MAX_IMPORT_BYTES / 1_000_000} MB) to be a Tape Deck rack.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON, so it can't be a Tape Deck rack export." };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { tapes?: unknown }).tapes)) {
    return { ok: false, error: "That file doesn't contain a Tape Deck rack." };
  }
  const version = (parsed as { version?: unknown }).version;
  if (version !== RACK_VERSION) {
    return { ok: false, error: `That rack was saved by a different version of Tape Deck (schema ${String(version)}, expected ${RACK_VERSION}).` };
  }
  const rack = decodeRack(parsed);
  if (!rack) return { ok: false, error: "That file doesn't contain a Tape Deck rack." };
  const total = (parsed as { tapes: unknown[] }).tapes.length;
  return { ok: true, rack, skipped: total - rack.tapes.length };
}

/** Adds the imported tapes the rack doesn't have yet (and their resume positions). */
export function mergeRacks(current: Rack, incoming: Rack): { rack: Rack; added: number; duplicates: number } {
  const have = new Set(current.tapes.map(tapeKey));
  const fresh = incoming.tapes.filter((t) => !have.has(tapeKey(t)));
  const resume = { ...current.resume };
  for (const tape of fresh) {
    const saved = incoming.resume[tapeKey(tape)];
    if (saved) resume[tapeKey(tape)] = saved;
  }
  return {
    rack: { ...current, tapes: [...current.tapes, ...fresh], resume },
    added: fresh.length,
    duplicates: incoming.tapes.length - fresh.length,
  };
}

/** Saves text as a file through the browser's download. */
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
