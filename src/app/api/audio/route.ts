import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { audioFormat, isAudioFormat } from "@/lib/audioFormats";
import { attachment, safeFileName, titleWithChannel } from "@/lib/fileName";
import { isVideoId } from "@/lib/youtube";
import { AudioError, convertAudio, findAudioTools } from "@/lib/ytDlp";

// Saves a video's audio as MP3, M4A or Opus, with its title, channel and cover
// art, using yt-dlp and FFmpeg on the computer running Tape Deck.
//
//   GET  /api/audio               whether saving audio works here
//   POST /api/audio {id, format}  converts it, streaming progress as JSON lines
//                                 and ending with {done, file, title, author}
//   GET  /api/audio?file=<token>  the converted file, once (then it's deleted)
//
// Only answers requests from this computer, so a copy of Tape Deck deployed to
// a public address never becomes a public converter.

const WORK_DIR = path.join(os.tmpdir(), "tapedeck-audio");
const MAX_RUNNING = 2;
const KEEP_MS = 10 * 60 * 1000; // converted files not fetched by then are deleted

type Ready = { file: string; dir: string; name: string; mime: string; at: number };
// Kept on globalThis so it survives the dev server reloading this module.
const shared = globalThis as typeof globalThis & { tapeDeckAudio?: { ready: Map<string, Ready>; running: number } };
const state = (shared.tapeDeckAudio ??= { ready: new Map(), running: 0 });

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Deletes a job's folder (retrying while Windows still has a just-stopped process's files open). */
const discard = (dir: string) => rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});

/** Refuses requests that don't come from a Tape Deck page on this computer. */
function refuse(request: NextRequest): Response | null {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  const site = request.headers.get("sec-fetch-site");
  if (LOCAL_HOSTS.has(host) && (site === null || site === "same-origin" || site === "none")) return null;
  return Response.json({ error: "Saving audio only works in Tape Deck running on your own computer." }, { status: 403 });
}

/** Deletes converted files nobody fetched, and leftovers from an earlier run. */
async function sweep() {
  const now = Date.now();
  for (const [token, ready] of state.ready) {
    if (now - ready.at > KEEP_MS) {
      state.ready.delete(token);
      await discard(ready.dir);
    }
  }
  const inUse = new Set([...state.ready.values()].map((r) => r.dir));
  for (const name of await readdir(WORK_DIR).catch(() => [] as string[])) {
    const dir = path.join(WORK_DIR, name);
    if (inUse.has(dir)) continue;
    const info = await stat(dir).catch(() => null);
    if (info && now - info.mtimeMs > 2 * KEEP_MS) await discard(dir);
  }
}

export async function GET(request: NextRequest) {
  const refusal = refuse(request);
  const token = request.nextUrl.searchParams.get("file");

  if (token === null) {
    if (refusal) return Response.json({ available: false, reason: "remote" });
    return Response.json(findAudioTools() ? { available: true } : { available: false, reason: "tools" });
  }
  if (refusal) return refusal;

  const ready = state.ready.get(token);
  if (!ready) return Response.json({ error: "That file has expired. Save it again." }, { status: 404 });
  state.ready.delete(token);
  const cleanUp = () => void discard(ready.dir);
  let size: number;
  try {
    size = (await stat(ready.file)).size;
  } catch {
    cleanUp();
    return Response.json({ error: "That file has expired. Save it again." }, { status: 404 });
  }
  const stream = createReadStream(ready.file);
  stream.on("close", cleanUp); // after it's sent, or if the listener stops it
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": ready.mime,
      "Content-Length": String(size),
      "Content-Disposition": attachment(ready.name),
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const refusal = refuse(request);
  if (refusal) return refusal;

  let body: { id?: unknown; format?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Send the video ID and format as JSON." }, { status: 400 });
  }
  const { id, format } = body;
  if (typeof id !== "string" || !isVideoId(id)) {
    return Response.json({ error: "That isn't a valid YouTube video ID." }, { status: 400 });
  }
  if (!isAudioFormat(format)) return Response.json({ error: "Pick MP3, M4A or Opus." }, { status: 400 });

  const tools = findAudioTools();
  if (!tools) {
    return Response.json({ error: "Saving audio needs yt-dlp and FFmpeg on this computer. See the README." }, { status: 503 });
  }
  if (state.running >= MAX_RUNNING) {
    return Response.json({ error: "Tape Deck is already saving audio. Try again when that finishes." }, { status: 429 });
  }

  state.running++;
  let dir: string;
  try {
    await sweep();
    await mkdir(WORK_DIR, { recursive: true });
    dir = await mkdtemp(path.join(WORK_DIR, "job-"));
  } catch {
    state.running--;
    return Response.json({ error: "Couldn't create a temporary folder for the conversion." }, { status: 500 });
  }

  // Stops yt-dlp if the listener cancels or closes Tape Deck.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The listener has gone.
        }
      };
      try {
        const result = await convertAudio(tools, id, format, dir, abort.signal, send);
        const ext = path.extname(result.file).slice(1) || format;
        const token = randomUUID();
        state.ready.set(token, {
          file: result.file,
          dir,
          name: `${safeFileName(titleWithChannel(result.title, result.author)) || id}.${ext}`,
          mime: audioFormat(format).mime,
          at: Date.now(),
        });
        send({ done: true, file: token, title: result.title, author: result.author });
      } catch (error) {
        await discard(dir);
        if (!abort.signal.aborted) {
          send({ error: error instanceof AudioError ? error.message : "Couldn't save the audio." });
        }
      } finally {
        state.running--;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform" },
  });
}
