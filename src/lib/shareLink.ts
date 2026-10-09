// Shareable links for custom mixtapes.
//
//   https://…/#mix=<name>.<ids>
//
// <name> is the mixtape name as UTF-8 in URL-safe base64, and <ids> are the
// 11-character YouTube video IDs back to back (they're URL-safe already). The
// link lives in the hash, so it never reaches a server.
import { useSyncExternalStore } from "react";
import { MAX_NAME } from "./rackStore";
import { isVideoId } from "./youtube";

export const MAX_SHARED_TRACKS = 200;
const HASH_EVENT = "tapedeck:hash";

export type SharedMixtape = { name: string; ids: string[] };

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string | null {
  try {
    const base64 = code.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(code.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function mixtapeShareLink(name: string, ids: string[], base: string): string {
  const safeIds = ids.filter(isVideoId).slice(0, MAX_SHARED_TRACKS);
  return `${base}#mix=${toBase64Url(name.slice(0, MAX_NAME))}.${safeIds.join("")}`;
}

/** Reads a shared mixtape from a URL hash, or null if it isn't a valid one. */
export function readSharedMixtape(hash: string): SharedMixtape | null {
  const match = /^#mix=([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return null;
  const name = fromBase64Url(match[1]);
  const packed = match[2];
  if (name === null || packed.length % 11 !== 0 || packed.length / 11 > MAX_SHARED_TRACKS) return null;
  const ids = packed.match(/.{11}/g) ?? [];
  if (!ids.every(isVideoId)) return null;
  const cleanName = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_NAME);
  return { name: cleanName || "Shared mixtape", ids: [...new Set(ids)] };
}

// --- The page's URL hash as React state --------------------------------------

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener(HASH_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener(HASH_EVENT, onChange);
  };
}

export function useLocationHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => "");
}

/** Removes the hash from the address bar without adding a history entry. */
export function clearLocationHash() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new Event(HASH_EVENT));
}
