"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog } from "./Dialog";
import { MAX_NAME, moveItem, type CustomMixtape, type Track } from "@/lib/rackStore";

/** Closes the dialog an element is in, the native way, so focus returns to the opener. */
const closeDialogOf = (element: Element) => element.closest("dialog")?.close();

/** Name field + button, used to create a mixtape. */
function NameForm({ submitLabel, onSubmit }: { submitLabel: string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
    closeDialogOf(event.currentTarget);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="mixtape-name">
        Mixtape name
      </label>
      <input
        id="mixtape-name"
        className="field min-w-0 flex-1"
        placeholder="Mixtape name, e.g. Road trip"
        maxLength={MAX_NAME}
        value={name}
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="btn-primary" disabled={!name.trim()}>
        {submitLabel}
      </button>
    </form>
  );
}

export function NewMixtapeDialog({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  return (
    <Dialog title="New mixtape" onClose={onClose}>
      <p className="text-sm text-muted">
        Give it a name, then add single-video tapes to it with the + button on each tape in the rack.
      </p>
      <NameForm submitLabel="Create mixtape" onSubmit={onCreate} />
    </Dialog>
  );
}

type AddToMixtapeProps = {
  track: Track;
  mixtapes: CustomMixtape[];
  onAdd: (mixtapeId: string) => void;
  onCreateAndAdd: (name: string) => void;
  onClose: () => void;
};

export function AddToMixtapeDialog({ track, mixtapes, onAdd, onCreateAndAdd, onClose }: AddToMixtapeProps) {
  return (
    <Dialog title="Add to mixtape" onClose={onClose}>
      <p className="text-sm text-muted">
        Adding <span className="font-semibold text-foreground">{track.title}</span>
      </p>
      {mixtapes.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Your mixtapes">
          {mixtapes.map((mix) => {
            const already = mix.tracks.some((t) => t.id === track.id);
            return (
              <li key={mix.id}>
                <button
                  type="button"
                  className="mix-choice"
                  disabled={already}
                  onClick={(e) => {
                    onAdd(mix.id);
                    closeDialogOf(e.currentTarget);
                  }}
                >
                  <span className="font-marker">{mix.title}</span>
                  <span className="text-xs text-muted">
                    {already ? "Already on this mixtape" : `${mix.tracks.length} ${mix.tracks.length === 1 ? "track" : "tracks"}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm font-semibold">{mixtapes.length > 0 ? "Or start a new one" : "Start a new mixtape"}</p>
      <NameForm submitLabel="Create and add" onSubmit={onCreateAndAdd} />
    </Dialog>
  );
}

type EditorProps = {
  mixtape: CustomMixtape;
  inDeck: boolean;
  onRename: (name: string) => void;
  onChangeTracks: (tracks: Track[]) => void;
  onClose: () => void;
};

export function MixtapeEditorDialog({ mixtape, inDeck, onRename, onChangeTracks, onClose }: EditorProps) {
  const listRef = useRef<HTMLOListElement>(null);
  // After moving a track, keep keyboard focus on the same button of that track.
  const [refocus, setRefocus] = useState<{ id: string; action: string } | null>(null);

  useEffect(() => {
    if (!refocus) return;
    const button = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-track="${refocus.id}"][data-action="${refocus.action}"]:not(:disabled)`,
    );
    (button ?? listRef.current?.querySelector<HTMLButtonElement>(`[data-track="${refocus.id}"] button:not(:disabled)`))?.focus();
  }, [refocus, mixtape.tracks]);

  function move(index: number, to: number, action: string) {
    onChangeTracks(moveItem(mixtape.tracks, index, to));
    setRefocus({ id: mixtape.tracks[index].id, action });
  }

  return (
    <Dialog title="Edit mixtape" onClose={onClose}>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Name
        <input
          className="field font-normal"
          maxLength={MAX_NAME}
          value={mixtape.title}
          autoComplete="off"
          onChange={(e) => onRename(e.target.value)}
        />
      </label>

      {mixtape.tracks.length === 0 ? (
        <p className="rack-empty">No tracks yet. Use the + button on a video tape in the rack to add it here.</p>
      ) : (
        <ol ref={listRef} className="mix-tracks" aria-label="Tracks">
          {mixtape.tracks.map((track, i) => (
            <li key={track.id} className="mix-track" data-track={track.id}>
              <span className="mix-track-no" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{track.title || track.id}</span>
                <span className="block truncate text-xs text-muted">{track.author}</span>
              </span>
              <button
                type="button"
                className="mix-btn"
                data-track={track.id}
                data-action="up"
                aria-label={`Move ${track.title} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1, "up")}
              >
                ↑
              </button>
              <button
                type="button"
                className="mix-btn"
                data-track={track.id}
                data-action="down"
                aria-label={`Move ${track.title} down`}
                disabled={i === mixtape.tracks.length - 1}
                onClick={() => move(i, i + 1, "down")}
              >
                ↓
              </button>
              <button
                type="button"
                className="mix-btn"
                aria-label={`Remove ${track.title} from the mixtape`}
                onClick={() => onChangeTracks(mixtape.tracks.filter((t) => t.id !== track.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}

      {inDeck && (
        <p className="text-xs text-muted">This mixtape is in the deck. Changes apply the next time it goes in.</p>
      )}
      <div className="flex justify-end">
        <button type="button" className="btn-primary h-11" onClick={(e) => closeDialogOf(e.currentTarget)}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
