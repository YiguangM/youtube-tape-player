"use client";

import { useState } from "react";
import { Dialog } from "./Dialog";

type RackImportDialogProps = {
  found: number;
  skipped: number;
  currentCount: number;
  onMerge: () => void;
  onReplace: () => void;
  onClose: () => void;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const closeDialogOf = (element: Element) => element.closest("dialog")?.close();

/** Choose how to bring an imported rack in: merge it, or replace the current one (confirmed). */
export function RackImportDialog({ found, skipped, currentCount, onMerge, onReplace, onClose }: RackImportDialogProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Dialog title="Import rack" onClose={onClose}>
      <p>
        This file has <strong>{plural(found, "tape")}</strong>.
        {skipped > 0 && ` ${plural(skipped, "entry", "entries")} ${skipped === 1 ? "wasn't a" : "weren't"} valid YouTube ${skipped === 1 ? "tape" : "tapes"} and will be skipped.`}
      </p>

      {!confirming ? (
        <>
          <ul className="flex flex-col gap-2 text-sm text-muted">
            <li>
              <strong className="text-foreground">Merge</strong> adds the tapes you don&apos;t have yet and keeps
              everything already in your rack.
            </li>
            <li>
              <strong className="text-foreground">Replace</strong> swaps your current rack ({plural(currentCount, "tape")})
              for the one in the file.
            </li>
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary h-11" onClick={() => setConfirming(true)} disabled={found === 0}>
              Replace…
            </button>
            <button
              type="button"
              className="btn-primary h-11"
              disabled={found === 0}
              onClick={(e) => {
                onMerge();
                closeDialogOf(e.currentTarget);
              }}
            >
              Merge
            </button>
          </div>
        </>
      ) : (
        <>
          <p role="alert" className="font-semibold text-danger">
            Replace your rack of {plural(currentCount, "tape")} with the {plural(found, "tape")} from this file? This
            can&apos;t be undone (export your rack first if you might want it back).
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary h-11" onClick={() => setConfirming(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary h-11"
              onClick={(e) => {
                onReplace();
                closeDialogOf(e.currentTarget);
              }}
            >
              Replace rack
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
