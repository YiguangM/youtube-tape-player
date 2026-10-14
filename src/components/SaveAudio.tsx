"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ICONS } from "./controls";
import { Dialog } from "./Dialog";
import { AUDIO_FORMATS, audioFormat, type AudioFormat } from "@/lib/audioFormats";
import {
  checkAudioSupport,
  convertAudio,
  downloadConverted,
  pickAudioFile,
  pickAudioFolder,
  removeIfEmpty,
  saveCover,
  SaveError,
  writeConverted,
  type AudioSupport,
  type SaveProgress,
} from "@/lib/audioSave";
import { safeFileName, titleWithChannel } from "@/lib/fileName";
import { useFolderPickerSupported } from "@/lib/localFolder";
import { useAudioFormat } from "@/lib/settings";

export type SaveTrack = { id: string; title: string; author: string };

type SaveAudioProps = {
  /** The video in the deck now, with its title and channel. */
  current: SaveTrack | null;
  /** The mixtape in the deck, if any: its name and tracks (titles where known so far). */
  mixtape: { name: string; tracks: { id: string; title?: string }[] } | null;
  onNotice: (message: string) => void;
  /** Adds a folder of saved tracks to the rack as an offline tape. */
  onAddOfflineTape: (folder: FileSystemDirectoryHandle, count: number) => void;
};

type Stage = SaveProgress | { stage: "write" };
type Job = { format: AudioFormat; total: number; index: number; stage: Stage };
type Outcome =
  | { type: "error"; message: string }
  | { type: "folder"; folder: FileSystemDirectoryHandle; saved: number; total: number; failed: { title: string; reason: string }[] };

const INSTALL_COMMAND = "winget install yt-dlp.yt-dlp";

const messageOf = (error: unknown) => (error instanceof SaveError ? error.message : "Couldn't save the audio.");

/** How far through one track the job is, from 0 to 1 (downloading is most of the wait). */
function trackDone(stage: Stage) {
  if (stage.stage === "download") return stage.done * 0.8;
  return stage.stage === "convert" ? 0.85 : 0.95;
}

/**
 * The deck's MP3 button: saves the audio of what's playing (or a whole
 * mixtape, into a folder) as MP3, M4A or Opus, with progress on the deck.
 * Hidden when Tape Deck isn't running on the listener's own computer.
 */
export function SaveAudio({ current, mixtape, onNotice, onAddOfflineTape }: SaveAudioProps) {
  const [support, setSupport] = useState<AudioSupport | null>(null);
  const [format, setFormat] = useAudioFormat();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"track" | "mixtape">("track");
  const [pickError, setPickError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const canPickFolders = useFolderPickerSupported();

  useEffect(() => {
    let live = true;
    void checkAudioSupport().then((result) => live && setSupport(result));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []); // the deck went away mid-save

  function notify(message: string) {
    onNotice(message);
    setAnnouncement(message);
  }

  async function openDialog() {
    setScope("track");
    setPickError(null);
    setCopied(false);
    setOpen(true);
    if (support === "needs-tools") setSupport(await checkAudioSupport());
  }

  function begin(format: AudioFormat, total: number) {
    const abort = new AbortController();
    abortRef.current = abort;
    setJob({ format, total, index: 0, stage: { stage: "download", done: 0 } });
    return abort;
  }

  const step = (index: number, stage: Stage) => setJob((j) => (j ? { ...j, index, stage } : j));

  function end() {
    abortRef.current = null;
    setJob(null);
  }

  async function save(event: MouseEvent<HTMLButtonElement>) {
    const dialog = event.currentTarget.closest("dialog");
    setPickError(null);
    try {
      if (scope === "mixtape" && mixtape) {
        const parent = await pickAudioFolder();
        if (!parent) return; // cancelled: stay in the dialog
        dialog?.close();
        void saveMixtape(parent, mixtape, format);
      } else if (current) {
        const name = `${safeFileName(titleWithChannel(current.title, current.author)) || current.id}.${format}`;
        const target = await pickAudioFile(name, format);
        if (target === null) return;
        dialog?.close();
        void saveTrack(current, target ?? null, format);
      }
    } catch (error) {
      setPickError(messageOf(error));
    }
  }

  async function saveTrack(track: SaveTrack, target: FileSystemFileHandle | null, format: AudioFormat) {
    const abort = begin(format, 1);
    try {
      const converted = await convertAudio(track.id, format, abort.signal, (p) => step(0, p));
      step(0, { stage: "write" });
      if (target) await writeConverted(converted.file, target, abort.signal);
      else downloadConverted(converted.file);
      notify(`Saved "${target?.name ?? (converted.title || track.title)}"`);
    } catch (error) {
      if (target) await removeIfEmpty(target);
      if (abort.signal.aborted) notify("Stopped saving the audio.");
      else setOutcome({ type: "error", message: messageOf(error) });
    } finally {
      end();
    }
  }

  async function saveMixtape(parent: FileSystemDirectoryHandle, mix: NonNullable<SaveAudioProps["mixtape"]>, format: AudioFormat) {
    const total = mix.tracks.length;
    const abort = begin(format, total);
    const digits = Math.max(2, String(total).length);
    const failed: { title: string; reason: string }[] = [];
    let saved = 0;
    let folder: FileSystemDirectoryHandle;
    try {
      folder = await parent.getDirectoryHandle(safeFileName(mix.name) || "Mixtape", { create: true });
    } catch {
      setOutcome({ type: "error", message: `Couldn't create a folder in "${parent.name}". Pick another folder.` });
      end();
      return;
    }

    for (let i = 0; i < total && !abort.signal.aborted; i++) {
      const { id, title } = mix.tracks[i];
      let target: FileSystemFileHandle | null = null;
      try {
        step(i, { stage: "download", done: 0 });
        const converted = await convertAudio(id, format, abort.signal, (p) => step(i, p));
        step(i, { stage: "write" });
        const name = `${String(i + 1).padStart(digits, "0")} - ${safeFileName(converted.title) || id}.${format}`;
        target = await folder.getFileHandle(name, { create: true });
        await writeConverted(converted.file, target, abort.signal);
        saved += 1;
        if (saved === 1) await saveCover(id, folder, abort.signal); // the offline tape's cover
      } catch (error) {
        if (target) await removeIfEmpty(target);
        if (abort.signal.aborted) break;
        failed.push({ title: title || `Track ${i + 1}`, reason: messageOf(error) });
        if (error instanceof SaveError && error.fatal) break; // would fail for every track
      }
    }

    end();
    if (abort.signal.aborted) {
      notify(saved ? `Stopped. Saved ${saved} of ${total} tracks to "${folder.name}".` : "Stopped saving the audio.");
    } else if (saved === 0) {
      setOutcome({ type: "error", message: failed[0]?.reason ?? "Couldn't save the audio." });
    } else {
      setOutcome({ type: "folder", folder, saved, total, failed });
      setAnnouncement(`Saved ${saved} of ${total} tracks.`);
    }
  }

  const announcer = (
    <span className="sr-only" role="status">
      {announcement}
    </span>
  );

  let control = null;
  if (job) {
    const percent = Math.round(((job.index + trackDone(job.stage)) / job.total) * 100);
    const of = job.total > 1 ? `${String(job.index + 1).padStart(2, "0")}/${String(job.total).padStart(2, "0")} ` : "";
    const doing =
      job.stage.stage === "download"
        ? `${Math.round(job.stage.done * 100)}%`
        : job.stage.stage === "convert"
          ? "CONVERTING"
          : "SAVING";
    const spoken =
      job.stage.stage === "download" ? "downloading" : job.stage.stage === "convert" ? "converting" : "saving the file";
    control = (
      <span className="save-progress">
        <span aria-hidden>{audioFormat(job.format).id.toUpperCase()}</span>
        <span
          className="save-meter"
          role="progressbar"
          aria-label="Saving audio"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${job.total > 1 ? `Track ${job.index + 1} of ${job.total}, ` : ""}${spoken}, ${percent}% done`}
        >
          <span style={{ width: `${percent}%` }} />
        </span>
        <span className="save-status" aria-hidden>
          {of}
          {doing}
        </span>
        <button
          type="button"
          className="save-stop"
          aria-label="Stop saving the audio"
          title="Stop saving"
          onClick={() => abortRef.current?.abort()}
        >
          ×
        </button>
      </span>
    );
  } else if (current && (support === "ready" || support === "needs-tools")) {
    control = (
      <button
        type="button"
        className="plate-btn"
        aria-haspopup="dialog"
        aria-label="Save the audio of what's playing"
        title="Save the audio of what's playing as MP3, M4A or Opus"
        onClick={() => void openDialog()}
      >
        <span className="h-3.5 w-3.5" aria-hidden>
          {ICONS.audio}
        </span>
        MP3
      </button>
    );
  }

  const offerMixtape = !!mixtape && mixtape.tracks.length > 1 && canPickFolders;

  return (
    <>
      {control}
      {announcer}

      {open && support === "needs-tools" && (
        <Dialog title="Save audio" onClose={() => setOpen(false)}>
          <p>
            Saving audio needs two free tools on this computer: <strong>yt-dlp</strong> and <strong>FFmpeg</strong>.
          </p>
          <p className="text-sm">On Windows, open PowerShell, run this command, then choose Check again:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="save-command">{INSTALL_COMMAND}</code>
            <button
              type="button"
              className="btn-secondary h-9 px-3 text-sm"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(INSTALL_COMMAND)
                  .then(() => setCopied(true))
                  .catch(() => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-muted">
            On a Mac, run <code>brew install yt-dlp ffmpeg deno</code>. On Linux, install yt-dlp, FFmpeg and Deno with
            your package manager.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary h-11" onClick={() => void checkAudioSupport().then(setSupport)}>
              Check again
            </button>
            <button type="button" className="btn-primary h-11" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
              Close
            </button>
          </div>
        </Dialog>
      )}

      {open && support === "ready" && current && (
        <Dialog title="Save audio" onClose={() => setOpen(false)}>
          <p className="text-sm">The file gets the video&apos;s title, channel and cover art.</p>

          {offerMixtape && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-semibold">What to save</legend>
              <label className="save-option">
                <input type="radio" name="save-scope" checked={scope === "track"} onChange={() => setScope("track")} />
                <span>
                  <span className="font-semibold">This track</span>
                  <span className="block text-xs text-muted">{current.title}</span>
                </span>
              </label>
              <label className="save-option">
                <input type="radio" name="save-scope" checked={scope === "mixtape"} onChange={() => setScope("mixtape")} />
                <span>
                  <span className="font-semibold">The whole mixtape ({mixtape.tracks.length} tracks)</span>
                  <span className="block text-xs text-muted">
                    Into a new folder called &quot;{safeFileName(mixtape.name) || "Mixtape"}&quot; inside the folder you pick
                  </span>
                </span>
              </label>
            </fieldset>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">Format</legend>
            {AUDIO_FORMATS.map((f) => (
              <label key={f.id} className="save-option">
                <input type="radio" name="save-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
                <span>
                  <span className="font-semibold">{f.name}</span>
                  <span className="block text-xs text-muted">{f.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <p className="text-xs text-muted">
            Only save videos you have the right to keep, such as your own uploads or music shared under a Creative
            Commons licence.
          </p>
          {pickError && (
            <p role="alert" className="text-sm text-danger">
              {pickError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary h-11" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
              Cancel
            </button>
            <button type="button" className="btn-primary h-11" onClick={(e) => void save(e)}>
              Save…
            </button>
          </div>
        </Dialog>
      )}

      {outcome?.type === "error" && (
        <Dialog title="Couldn't save the audio" onClose={() => setOutcome(null)}>
          <p role="alert">{outcome.message}</p>
          <div className="flex justify-end">
            <button type="button" className="btn-primary h-11" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
              OK
            </button>
          </div>
        </Dialog>
      )}

      {outcome?.type === "folder" && (
        <Dialog title="Mixtape saved" onClose={() => setOutcome(null)}>
          <p>
            Saved {outcome.saved} of {outcome.total} tracks to the folder &quot;{outcome.folder.name}&quot;.
          </p>
          {outcome.failed.length > 0 && (
            <div className="text-sm">
              <p className="font-semibold">Not saved:</p>
              <ul className="mt-1 list-disc pl-5">
                {outcome.failed.slice(0, 5).map((f, i) => (
                  <li key={i}>
                    {f.title}: {f.reason}
                  </li>
                ))}
              </ul>
              {outcome.failed.length > 5 && <p className="mt-1 text-muted">…and {outcome.failed.length - 5} more.</p>}
            </div>
          )}
          <p className="text-sm text-muted">Add the folder to your rack to play it without the internet.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary h-11" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary h-11"
              onClick={(e) => {
                onAddOfflineTape(outcome.folder, outcome.saved);
                e.currentTarget.closest("dialog")?.close();
              }}
            >
              Add as offline tape
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
