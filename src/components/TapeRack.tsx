"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { tapeColors } from "./Cassette";
import { tapeKey, type Tape, type TapeKind } from "@/lib/rackStore";
import { parseYouTubeLink } from "@/lib/youtube";

type TapeRackProps = {
  tapes: Tape[];
  /** Key of the tape in the deck, if any */
  activeKey: string | null;
  onInsert: (tape: Tape) => void;
  /** A new tape was recorded; `insert` is true when the deck was empty */
  onAdd: (tape: Tape, insert: boolean) => void;
  onRemove: (tape: Tape) => void;
  deckEmpty: boolean;
};

/** The rack: record tapes from YouTube links, and pick one to put in the deck. */
export function TapeRack({ tapes, activeKey, onInsert, onAdd, onRemove, deckEmpty }: TapeRackProps) {
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

  async function record(kind: TapeKind, id: string) {
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
        <span className="text-sm text-muted">
          {tapes.length} {tapes.length === 1 ? "tape" : "tapes"}
        </span>
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

      {tapes.length === 0 ? (
        <p className="rack-empty">
          No tapes yet. Record one from a YouTube link and it goes straight into the deck.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tapes.map((t) => {
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
                      {t.kind === "playlist" && <span className="spine-mix">MIXTAPE</span>}
                      {t.author || "Unknown artist"}
                    </span>
                  </span>
                  {inDeck && <span className="spine-badge">IN DECK</span>}
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
    </section>
  );
}
