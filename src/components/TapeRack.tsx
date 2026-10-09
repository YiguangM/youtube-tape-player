"use client";

import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { tapeColors } from "./Cassette";
import { ICONS } from "./controls";
import { AddToMixtapeDialog, MixtapeEditorDialog, NewMixtapeDialog } from "./MixtapeDialogs";
import {
  newMixtape,
  RACK_TOOLS_AFTER,
  rackOrder,
  tapeKey,
  withMixtapeTracks,
  withTape,
  withUpdatedTape,
  type CustomMixtape,
  type Rack,
  type RackSort,
  type Tape,
  type Track,
} from "@/lib/rackStore";
import { useRackSort } from "@/lib/settings";
import { coverUrl, parseYouTubeLink } from "@/lib/youtube";

type TapeRackProps = {
  tapes: Tape[];
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

type OpenDialog = { type: "new" } | { type: "add"; track: Track } | { type: "edit"; id: string } | null;

/** The rack: record tapes from YouTube links, and pick one to put in the deck. */
export function TapeRack({ tapes, activeKey, onInsert, onAdd, onRemove, onUpdateRack, deckEmpty }: TapeRackProps) {
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
  const shown = rackOrder(tapes, sort).filter((t) => !needle || t.title.toLocaleLowerCase().includes(needle));

  function notify(message: string) {
    setRackNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setRackNotice(null), 4000);
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
                  <span className="spine-side" aria-hidden>
                    A
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">Insert </span>
                    <span className="spine-title">{t.title}</span>
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
                    aria-label={`Edit ${t.title}`}
                    title="Rename, reorder or remove tracks"
                    onClick={() => setDialog({ type: "edit", id: t.id })}
                  >
                    ✎
                  </button>
                )}
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
