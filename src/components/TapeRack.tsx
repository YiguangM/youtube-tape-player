"use client";

import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { tapeColors } from "./Cassette";
import { ICONS } from "./controls";
import { AddToMixtapeDialog, MixtapeEditorDialog, NewMixtapeDialog, ShareMixtapeDialog } from "./MixtapeDialogs";
import { RackImportDialog } from "./RackImportDialog";
import { TapeLookDialog } from "./TapeLookDialog";
import {
  labelText,
  newMixtape,
  RACK_TOOLS_AFTER,
  rackOrder,
  tapeKey,
  withMixtapeTracks,
  withTape,
  withLook,
  withUpdatedTape,
  type CustomMixtape,
  type Rack,
  type RackSort,
  type Tape,
  type Track,
} from "@/lib/rackStore";
import { checkRackFile, downloadText, exportRack, mergeRacks, MAX_IMPORT_BYTES } from "@/lib/rackFile";
import { useRackSort } from "@/lib/settings";
import { clearLocationHash, mixtapeShareLink, readSharedMixtape, useLocationHash, type SharedMixtape } from "@/lib/shareLink";
import { labelFamily, shellById } from "@/lib/shells";
import { coverUrl, parseYouTubeLink } from "@/lib/youtube";

type TapeRackProps = {
  /** The whole rack (for export and import); its tapes are shown */
  rack: Rack;
  /** Key of the tape in the deck, if any */
  activeKey: string | null;
  onInsert: (tape: Tape) => void;
  /** A new tape was recorded; `insert` is true when the deck was empty */
  onAdd: (tape: Tape, insert: boolean) => void;
  onRemove: (tape: Tape) => void;
  /** Applies an edit to the rack (used for building custom mixtapes) */
  onUpdateRack: (update: (rack: Rack) => Rack) => void;
  deckEmpty: boolean;
};

type OpenDialog =
  | { type: "new" }
  | { type: "add"; track: Track }
  | { type: "edit"; id: string }
  | { type: "look"; key: string }
  | { type: "import"; incoming: Rack; skipped: number }
  | { type: "share"; id: string }
  | null;

/** The rack: record tapes from YouTube links, and pick one to put in the deck. */
export function TapeRack({ rack, activeKey, onInsert, onAdd, onRemove, onUpdateRack, deckEmpty }: TapeRackProps) {
  const tapes = rack.tapes;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // Short confirmations ("Added to Road trip"), announced to screen readers.
  const [rackNotice, setRackNotice] = useState<string | null>(null);
  const noticeTimer = useRef(0);
  const mixtapes = tapes.filter((t): t is CustomMixtape => t.kind === "custom");

  // Search and sort only appear once the rack is big enough to need them.
  const [sort, setSort] = useRackSort();
  const [query, setQuery] = useState("");
  const showTools = tapes.length > RACK_TOOLS_AFTER;
  const needle = showTools ? query.trim().toLocaleLowerCase() : "";
  const shown = rackOrder(tapes, sort).filter(
    (t) => !needle || t.title.toLocaleLowerCase().includes(needle) || labelText(t).toLocaleLowerCase().includes(needle),
  );

  function notify(message: string, ms = 4000) {
    setRackNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setRackNotice(null), ms);
  }

  function createMixtape(name: string, firstTrack?: Track) {
    const mix = newMixtape(name);
    onUpdateRack((r) => withTape(r, { ...mix, tracks: firstTrack ? [firstTrack] : [] }));
    notify(firstTrack ? `Added to ${mix.title}` : `Created ${mix.title}`);
    return mix;
  }

  function addToMixtape(mixtapeId: string, track: Track) {
    const mix = mixtapes.find((m) => m.id === mixtapeId);
    if (!mix) return;
    if (mix.tracks.some((t) => t.id === track.id)) {
      notify(`Already on ${mix.title}`);
      return;
    }
    onUpdateRack((r) => withMixtapeTracks(r, mixtapeId, [...mix.tracks, track]));
    notify(`Added to ${mix.title}`);
  }

  // A shared mixtape link (#mix=…) opened the app: offer it, never add it on its own.
  const shared = readSharedMixtape(useLocationHash());
  const [addingShared, setAddingShared] = useState(false);

  async function addShared(mix: SharedMixtape) {
    setAddingShared(true);
    // Look up titles a few at a time; unknown or unavailable videos still go on
    // the tape and are skipped when played.
    const tracks: Track[] = new Array(mix.ids.length);
    let next = 0;
    async function worker() {
      while (next < mix.ids.length) {
        const i = next++;
        const id = mix.ids[i];
        try {
          const res = await fetch(`/api/tape?id=${id}`);
          const data = (await res.json()) as { title?: string; author?: string };
          tracks[i] = { id, title: res.ok && data.title ? data.title : "Unavailable video", author: data.author ?? "" };
        } catch {
          tracks[i] = { id, title: "Unknown video", author: "" };
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    const created = newMixtape(mix.name);
    onUpdateRack((r) => withTape(r, { ...created, tracks }));
    clearLocationHash();
    setAddingShared(false);
    notify(`Added ${created.title} (${tracks.length} ${tracks.length === 1 ? "track" : "tracks"})`);
  }

  async function importFile(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      notify("That file is too big to be a Tape Deck rack.", 8000);
      return;
    }
    const check = checkRackFile(await file.text(), file.size);
    if (!check.ok) notify(check.error, 8000);
    else setDialog({ type: "import", incoming: check.rack, skipped: check.skipped });
  }

  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // A pasted link pointing at a video inside a playlist: ask which one to record.
  const [choice, setChoice] = useState<{ videoId: string; listId: string } | null>(null);

  function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseYouTubeLink(link);
    if (!parsed) {
      setFormError("That doesn't look like a YouTube video or playlist link.");
    } else if (parsed.videoId && parsed.listId) {
      setFormError(null);
      setChoice({ videoId: parsed.videoId, listId: parsed.listId });
    } else if (parsed.listId) {
      void record("playlist", parsed.listId);
    } else if (parsed.videoId) {
      void record("video", parsed.videoId);
    } else {
      setFormError(
        "YouTube Mixes are made on the fly for each viewer, so they can't play here. Try a regular playlist link.",
      );
    }
  }

  async function record(kind: "video" | "playlist", id: string) {
    setChoice(null);
    setFormError(null);

    const existing = tapes.find((t) => t.kind === kind && t.id === id);
    if (existing) {
      setLink("");
      onInsert(existing);
      return;
    }

    setAdding(true);
    try {
      const res = await fetch(`/api/tape?${kind === "playlist" ? "list" : "id"}=${encodeURIComponent(id)}`);
      const data = (await res.json()) as { title?: string; author?: string; error?: string };
      if (!res.ok || !data.title) {
        setFormError(data.error ?? "Couldn't record that tape.");
        return;
      }
      setLink("");
      onAdd({ kind, id, title: data.title, author: data.author ?? "", addedAt: Date.now() }, deckEmpty);
    } catch {
      setFormError("Couldn't reach the app's server. Is it still running?");
    } finally {
      setAdding(false);
    }
  }

  return (
    <section aria-labelledby="rack-heading" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <h2 id="rack-heading" className="font-marker text-2xl sm:text-3xl">
          Tape rack
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          <span className="rack-notice" role="status" aria-live="polite">
            {rackNotice}
          </span>
          <span className="text-sm text-muted">
            {tapes.length} {tapes.length === 1 ? "tape" : "tapes"}
          </span>
          <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={() => setDialog({ type: "new" })}>
            + New mixtape
          </button>
          <button
            type="button"
            className="btn-secondary h-9 px-3 text-sm"
            disabled={tapes.length === 0}
            title="Download your rack as a JSON file"
            onClick={() => {
              const file = exportRack(rack);
              downloadText(file.name, file.text);
              notify(`Exported ${tapes.length} ${tapes.length === 1 ? "tape" : "tapes"}`);
            }}
          >
            Export
          </button>
          <button
            type="button"
            className="btn-secondary h-9 px-3 text-sm"
            title="Load a rack from an exported JSON file"
            onClick={() => fileInput.current?.click()}
          >
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-label="Rack file to import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // allow picking the same file again
              if (file) void importFile(file);
            }}
          />
        </div>
      </div>

      <form onSubmit={submitLink} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="tape-link" className="sr-only">
          YouTube link
        </label>
        <input
          id="tape-link"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a YouTube video or playlist link"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setFormError(null);
            setChoice(null);
          }}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? "tape-link-error" : undefined}
          className="field min-w-0 flex-1"
        />
        <button type="submit" className="btn-primary" disabled={adding || !link.trim()}>
          {adding ? "Recording…" : "Record tape"}
        </button>
      </form>
      {shared && (
        <section className="share-card" aria-labelledby="share-card-title">
          <p id="share-card-title">
            Add <strong className="font-marker">“{shared.name}”</strong> ({shared.ids.length}{" "}
            {shared.ids.length === 1 ? "track" : "tracks"}) to your rack?
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary h-11" disabled={addingShared} onClick={clearLocationHash}>
              Dismiss
            </button>
            <button type="button" className="btn-primary h-11" disabled={addingShared} onClick={() => void addShared(shared)}>
              {addingShared ? "Adding…" : "Add to rack"}
            </button>
          </div>
        </section>
      )}

      {formError && (
        <p id="tape-link-error" role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      {choice && (
        <div role="group" aria-labelledby="choice-text" className="choice">
          <p id="choice-text">This video is part of a playlist. What should go on the tape?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={adding}
              onClick={() => void record("video", choice.videoId)}
            >
              Just this video
            </button>
            <button
              type="button"
              className="btn-primary h-11"
              disabled={adding}
              onClick={() => void record("playlist", choice.listId)}
            >
              Whole playlist
            </button>
          </div>
        </div>
      )}

      {showTools && (
        <div className="rack-tools" role="search">
          <label className="sr-only" htmlFor="rack-search">
            Search the rack by title
          </label>
          <input
            id="rack-search"
            type="search"
            className="field min-w-0 flex-1"
            placeholder="Search tapes"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="sr-only" htmlFor="rack-sort">
            Sort the rack
          </label>
          <select id="rack-sort" className="field rack-sort" value={sort} onChange={(e) => setSort(e.target.value as RackSort)}>
            <option value="added">Recently added</option>
            <option value="played">Recently played</option>
            <option value="title">Title A–Z</option>
          </select>
          {needle && (
            <span className="text-sm text-muted" aria-live="polite">
              {shown.length} of {tapes.length}
            </span>
          )}
        </div>
      )}

      {tapes.length === 0 ? (
        <p className="rack-empty">
          No tapes yet. Record one from a YouTube link and it goes straight into the deck.
        </p>
      ) : shown.length === 0 ? (
        <p className="rack-empty">No tapes match “{query.trim()}”.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((t) => {
            const inDeck = activeKey === tapeKey(t);
            return (
              <li
                key={tapeKey(t)}
                className="spine"
                data-active={inDeck || undefined}
                style={{ "--stripe": tapeColors(t.id)[0] } as CSSProperties}
              >
                <button type="button" className="spine-main" onClick={() => onInsert(t)}>
                  <span
                    className="spine-side"
                    aria-hidden
                    style={t.shell ? { background: shellById(t.shell).top, color: shellById(t.shell).ink } : undefined}
                  >
                    A
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">Insert </span>
                    <span className="spine-title" style={t.label ? { fontFamily: labelFamily(t.label.font) } : undefined}>
                      {labelText(t)}
                    </span>
                    <span className="spine-author">
                      {t.kind !== "video" && <span className="spine-mix">{t.kind === "custom" ? "MY MIX" : "MIXTAPE"}</span>}
                      {t.kind === "custom"
                        ? `${t.tracks.length} ${t.tracks.length === 1 ? "track" : "tracks"}`
                        : t.author || "Unknown artist"}
                    </span>
                  </span>
                  {inDeck && <span className="spine-badge">IN DECK</span>}
                </button>
                {t.kind === "video" && (
                  <a
                    className="spine-action"
                    href={coverUrl(t.id, t.title, t.author)}
                    download
                    aria-label={`Save cover art for ${t.title}`}
                    title="Save cover art (thumbnail)"
                  >
                    <span className="h-4 w-4" aria-hidden>
                      {ICONS.cover}
                    </span>
                  </a>
                )}
                {t.kind === "video" && (
                  <button
                    type="button"
                    className="spine-action"
                    aria-label={`Add ${t.title} to a mixtape`}
                    title="Add to a mixtape"
                    onClick={() => setDialog({ type: "add", track: { id: t.id, title: t.title, author: t.author } })}
                  >
                    +
                  </button>
                )}
                {t.kind === "custom" && (
                  <button
                    type="button"
                    className="spine-action"
                    aria-label={`Share ${t.title}`}
                    title={t.tracks.length ? "Share as a link" : "Add tracks before sharing"}
                    disabled={t.tracks.length === 0}
                    onClick={() => setDialog({ type: "share", id: t.id })}
                  >
                    <span className="h-4 w-4" aria-hidden>
                      {ICONS.share}
                    </span>
                  </button>
                )}
                {t.kind === "custom" && (
                  <button
                    type="button"
                    className="spine-action"
                    aria-label={`Edit ${t.title}`}
                    title="Rename, reorder or remove tracks"
                    onClick={() => setDialog({ type: "edit", id: t.id })}
                  >
                    ✎
                  </button>
                )}
                <button
                  type="button"
                  className="spine-action"
                  aria-label={`Change the label and shell of ${t.title}`}
                  title="Label & shell"
                  onClick={() => setDialog({ type: "look", key: tapeKey(t) })}
                >
                  <span className="h-4 w-4" aria-hidden>
                    {ICONS.look}
                  </span>
                </button>
                <button
                  type="button"
                  className="spine-remove"
                  aria-label={`Remove ${t.title}`}
                  onClick={() => onRemove(t)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.type === "new" && (
        <NewMixtapeDialog
          onClose={() => setDialog(null)}
          onCreate={(name) => createMixtape(name)}
        />
      )}
      {dialog?.type === "add" && (
        <AddToMixtapeDialog
          track={dialog.track}
          mixtapes={mixtapes}
          onClose={() => setDialog(null)}
          onAdd={(id) => addToMixtape(id, dialog.track)}
          onCreateAndAdd={(name) => createMixtape(name, dialog.track)}
        />
      )}
      {dialog?.type === "share" &&
        (() => {
          const mix = mixtapes.find((m) => m.id === dialog.id);
          if (!mix) return null;
          const link = mixtapeShareLink(mix.title, mix.tracks.map((t) => t.id), window.location.origin + window.location.pathname);
          return <ShareMixtapeDialog name={mix.title} link={link} onClose={() => setDialog(null)} />;
        })()}
      {dialog?.type === "import" && (
        <RackImportDialog
          found={dialog.incoming.tapes.length}
          skipped={dialog.skipped}
          currentCount={tapes.length}
          onClose={() => setDialog(null)}
          onMerge={() => {
            const merged = mergeRacks(rack, dialog.incoming);
            onUpdateRack(() => merged.rack);
            notify(`Added ${merged.added}, skipped ${merged.duplicates} already in the rack`);
          }}
          onReplace={() => {
            onUpdateRack(() => dialog.incoming);
            const n = dialog.incoming.tapes.length;
            notify(`Rack replaced: ${n} ${n === 1 ? "tape" : "tapes"}`);
          }}
        />
      )}
      {dialog?.type === "look" &&
        (() => {
          const target = tapes.find((t) => tapeKey(t) === dialog.key);
          if (!target) return null;
          return (
            <TapeLookDialog
              tape={target}
              onClose={() => setDialog(null)}
              onSave={(label, shell) => {
                onUpdateRack((r) => withLook(r, dialog.key, label, shell));
                notify(`Updated ${target.title}`);
              }}
            />
          );
        })()}
      {dialog?.type === "edit" &&
        (() => {
          const mix = mixtapes.find((m) => m.id === dialog.id);
          if (!mix) return null;
          return (
            <MixtapeEditorDialog
              mixtape={mix}
              inDeck={activeKey === tapeKey(mix)}
              onClose={() => setDialog(null)}
              onRename={(name) => onUpdateRack((r) => withUpdatedTape(r, tapeKey(mix), (t) => ({ ...t, title: name })))}
              onChangeTracks={(tracks) => onUpdateRack((r) => withMixtapeTracks(r, mix.id, tracks))}
            />
          );
        })()}
    </section>
  );
}
