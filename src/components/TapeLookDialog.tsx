"use client";

import { useState, type CSSProperties } from "react";
import { Cassette } from "./Cassette";
import { Dialog } from "./Dialog";
import { MAX_LABEL, type Tape, type TapeLabel } from "@/lib/rackStore";
import { LABEL_FONTS, SHELLS, type LabelFont, type ShellId } from "@/lib/shells";

type TapeLookDialogProps = {
  tape: Tape;
  onSave: (label: TapeLabel, shell: ShellId) => void;
  onClose: () => void;
};

/** Write your own label on a tape and pick its shell colour, with a live preview. */
export function TapeLookDialog({ tape, onSave, onClose }: TapeLookDialogProps) {
  const [text, setText] = useState(tape.label?.text ?? "");
  const [font, setFont] = useState<LabelFont>(tape.label?.font ?? "handwritten");
  const [shell, setShell] = useState<ShellId>(tape.shell ?? "smoke");

  return (
    <Dialog title="Label & shell" onClose={onClose}>
      <div className="look-preview" aria-hidden>
        <Cassette
          id={tape.id}
          title={text.trim() || tape.title}
          author={tape.kind === "custom" ? "" : tape.author}
          progress={0.35}
          motion={0}
          note={tape.kind === "video" ? undefined : "MIXTAPE"}
          shell={shell}
          font={font}
        />
      </div>

      <label className="flex flex-col gap-1 text-sm font-semibold">
        Label text
        <input
          className="field font-normal"
          maxLength={MAX_LABEL}
          placeholder={tape.title}
          value={text}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <span className="text-xs font-normal text-muted">Leave empty to use the video title.</span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Lettering</legend>
        <div className="flex flex-wrap gap-2">
          {LABEL_FONTS.map((f) => (
            <label key={f.id} className="look-option">
              <input
                type="radio"
                name="label-font"
                className="sr-only"
                checked={font === f.id}
                onChange={() => setFont(f.id)}
              />
              <span style={{ fontFamily: f.family }}>{f.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Shell</legend>
        <div className="flex flex-wrap gap-2">
          {SHELLS.map((s) => (
            <label key={s.id} className="look-swatch" title={s.name}>
              <input
                type="radio"
                name="shell"
                className="sr-only"
                aria-label={s.name}
                checked={shell === s.id}
                onChange={() => setShell(s.id)}
              />
              <span
                style={{ "--top": s.top, "--bottom": s.bottom, "--edge": s.edge } as CSSProperties}
                data-clear={s.id === "clear" || undefined}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn-secondary h-11"
          onClick={() => {
            setText("");
            setFont("handwritten");
            setShell("smoke");
          }}
        >
          Reset to default
        </button>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary h-11" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary h-11"
            onClick={(e) => {
              onSave({ text: text.trim(), font }, shell);
              e.currentTarget.closest("dialog")?.close();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}
