// Server only. Saves a YouTube video's audio with yt-dlp and FFmpeg: the same
// pipeline as PackJC/YoutubeToMP3 (fetch the audio stream, convert it with
// FFmpeg, tag it), run through yt-dlp because it keeps up with YouTube's
// changes. Both tools are installed separately (see the README).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { AudioFormat } from "./audioFormats";

export type AudioTools = { ytDlp: string; ffmpeg: string; deno: string | null };

export type ConvertProgress = { stage: "download"; done: number } | { stage: "convert" };

export type Converted = { file: string; title: string; author: string };

/** A failure worth showing to the listener as is. */
export class AudioError extends Error {}

const EXE = process.platform === "win32" ? ".exe" : "";
const MAX_SECONDS = 3 * 60 * 60; // longer videos (and live streams) aren't saved
const ATTEMPTS = 3; // YouTube sometimes refuses a download link; a fresh one usually works

// Quality per format: VBR best for MP3 (about 245 kb/s); 192 kb/s for AAC;
// Opus is normally YouTube's own stream, copied without re-encoding.
const QUALITY: Record<AudioFormat, string> = { mp3: "0", m4a: "192K", opus: "0" };

// The tools live outside the project, so the file checks below are marked
// turbopackIgnore: they mustn't make the build trace the whole project.

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const full = dir && path.join(dir, name + EXE);
    if (full && existsSync(/*turbopackIgnore: true*/ full)) return full;
  }
  return null;
}

/** Looks in winget's package folders, for tools installed after this server started (so not on its PATH yet). */
function inWingetPackages(prefixes: string[], file: string): string | null {
  const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
  if (!root || !existsSync(/*turbopackIgnore: true*/ root)) return null;
  const search = (dir: string, depth: number): string | null => {
    const entries = readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === file)) return path.join(dir, file);
    if (depth === 0) return null;
    for (const e of entries) {
      const found = e.isDirectory() ? search(path.join(dir, e.name), depth - 1) : null;
      if (found) return found;
    }
    return null;
  };
  try {
    for (const name of readdirSync(/*turbopackIgnore: true*/ root)) {
      if (!prefixes.some((p) => name.startsWith(p))) continue;
      const found = search(path.join(root, name), 2); // e.g. <package>/ffmpeg-<version>/bin/ffmpeg.exe
      if (found) return found;
    }
  } catch {
    // Unreadable folder: treat as not installed.
  }
  return null;
}

/** yt-dlp and FFmpeg (both needed) and Deno (optional; Node runs YouTube's player code otherwise). */
export function findAudioTools(): AudioTools | null {
  const ytDlp = onPath("yt-dlp") ?? inWingetPackages(["yt-dlp.yt-dlp_"], "yt-dlp.exe");
  const ffmpeg = onPath("ffmpeg") ?? inWingetPackages(["yt-dlp.FFmpeg_", "Gyan.FFmpeg", "BtbN.FFmpeg"], "ffmpeg.exe");
  if (!ytDlp || !ffmpeg) return null;
  return { ytDlp, ffmpeg, deno: onPath("deno") ?? inWingetPackages(["DenoLand.Deno_"], "deno.exe") };
}

/** Stops yt-dlp and everything it started (FFmpeg, and on Windows its own child process). */
function killTree(child: ChildProcess) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function eachLine(stream: NodeJS.ReadableStream, onLine: (line: string) => void) {
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? "";
    lines.forEach((line) => line && onLine(line));
  });
  stream.on("end", () => rest && onLine(rest));
}

type Attempt = { converted?: Converted; errors: string[]; exitCode: number | null };

function runOnce(args: string[], tools: AudioTools, signal: AbortSignal, onProgress: (p: ConvertProgress) => void) {
  return new Promise<Attempt>((resolve) => {
    const child = spawn(tools.ytDlp, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const attempt: Attempt = { errors: [], exitCode: null };
    const stop = () => killTree(child);
    signal.addEventListener("abort", stop, { once: true });

    const onLine = (line: string) => {
      if (line.startsWith("@progress ")) {
        const [downloaded, total, estimate] = line.split(" ").slice(1).map(Number);
        const size = total || estimate;
        if (size > 0 && downloaded >= 0) onProgress({ stage: "download", done: Math.min(1, downloaded / size) });
      } else if (line.startsWith("@convert ExtractAudio started")) {
        onProgress({ stage: "convert" });
      } else if (line.startsWith("@done ")) {
        try {
          const info = JSON.parse(line.slice(6)) as { title?: string; uploader?: string; channel?: string; filepath?: string };
          if (info.filepath) {
            attempt.converted = { file: info.filepath, title: info.title ?? "", author: info.channel || info.uploader || "" };
          }
        } catch {
          // Not the line we printed.
        }
      } else if (line.startsWith("ERROR:")) {
        attempt.errors.push(line.slice(6).trim());
      }
    };
    eachLine(child.stdout, onLine);
    eachLine(child.stderr, onLine);
    child.on("error", (error) => attempt.errors.push(error.message));
    child.on("close", (code) => {
      signal.removeEventListener("abort", stop);
      attempt.exitCode = code;
      resolve(attempt);
    });
  });
}

/** Turns yt-dlp's error into something a listener can act on. */
function explain(errors: string[]): string {
  const text = errors.join(" ");
  if (/private video/i.test(text)) return "That video is private.";
  if (/confirm your age|age.restricted|inappropriate for some users/i.test(text)) return "That video is age-restricted, so it can't be saved.";
  if (/not a bot|sign in to confirm/i.test(text)) return "YouTube wants to check this computer isn't a bot. Try again later.";
  if (/members.only|join this channel/i.test(text)) return "That video is for channel members only.";
  if (/unavailable|has been removed|not available|does not exist/i.test(text)) return "That video isn't available. It may have been removed.";
  if (/HTTP Error 403/i.test(text)) return "YouTube refused the download. Try again in a minute, or update yt-dlp.";
  if (/unable to download|timed out|getaddrinfo|connection/i.test(text)) return "Couldn't reach YouTube. Check the internet connection and try again.";
  if (/ffmpeg|ffprobe|postprocessing/i.test(text)) return "FFmpeg couldn't convert the audio.";
  return errors[0] ? `Couldn't save the audio: ${errors[0]}` : "Couldn't save the audio.";
}

/**
 * Downloads a video's best audio into `dir` and converts it to `format`, with
 * its title, channel and cover art embedded. Retries when YouTube refuses the
 * download link. Rejects with an AudioError, or an AbortError if `signal` fires.
 */
export async function convertAudio(
  tools: AudioTools,
  videoId: string,
  format: AudioFormat,
  dir: string,
  signal: AbortSignal,
  onProgress: (p: ConvertProgress) => void,
): Promise<Converted> {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--color", "never",
    "--newline",
    "--progress",
    "--progress-template", "download:@progress %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
    "--progress-template", "postprocess:@convert %(progress.postprocessor)s %(progress.status)s",
    "--print", "after_move:@done %(.{title,uploader,channel,filepath})j",
    "--match-filters", `!is_live & duration <=? ${MAX_SECONDS}`,
    "--socket-timeout", "20",
    "-f", "bestaudio/best",
    "-x", "--audio-format", format, "--audio-quality", QUALITY[format],
    "--embed-metadata", "--embed-thumbnail", "--convert-thumbnails", "jpg",
    "--ffmpeg-location", tools.ffmpeg,
    "--js-runtimes", tools.deno ? `deno:${tools.deno}` : `node:${process.execPath}`,
    "-P", dir,
    "-o", "audio.%(ext)s",
    "--", `https://www.youtube.com/watch?v=${videoId}`,
  ];

  let errors: string[] = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    signal.throwIfAborted();
    const attempt = await runOnce(args, tools, signal, onProgress);
    signal.throwIfAborted();
    if (attempt.converted && existsSync(/*turbopackIgnore: true*/ attempt.converted.file)) return attempt.converted;
    errors = attempt.errors;
    // A clean exit with nothing saved means the video didn't pass --match-filters.
    if (errors.length === 0 && attempt.exitCode === 0) throw new AudioError("Live streams and videos over 3 hours can't be saved.");
    if (!errors.some((e) => /HTTP Error 403/.test(e))) break;
  }
  throw new AudioError(explain(errors));
}
