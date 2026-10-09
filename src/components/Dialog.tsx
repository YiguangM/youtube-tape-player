"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * A modal built on the native <dialog> element, which traps focus, closes on
 * Esc and returns focus to where it was. Render it to open it; it calls
 * onClose when it closes so the parent can stop rendering it.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="dialog-head">
        <h3 id={titleId} className="font-marker text-xl">
          {title}
        </h3>
        <button type="button" className="dialog-close" aria-label="Close" onClick={() => ref.current?.close()}>
          ×
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
