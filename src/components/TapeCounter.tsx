"use client";

import { useSyncExternalStore, type CSSProperties } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True when the visitor asked the system for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]; // the extra 0 lets a drum roll from 9 into the next turn

type TapeCounterProps = {
  /** Seconds of tape travel since the last reset (may be negative after rewinding) */
  value: number;
  onReset: () => void;
};

/**
 * A 3-digit mechanical tape counter. Drums roll like an odometer: the units
 * drum turns continuously, and each higher drum turns while the one below it
 * passes from 9 to 0. With reduced motion the digits just change.
 */
export function TapeCounter({ value, onReset }: TapeCounterProps) {
  const reduced = useReducedMotion();
  const count = ((value % 1000) + 1000) % 1000; // wraps like the real thing, also when rewound past 000
  const shown = reduced ? Math.floor(count) : count;
  const label = String(Math.floor(count)).padStart(3, "0");

  // Odometer positions (0..10) for hundreds, tens and units.
  const units = shown % 10;
  const carry = (below: number) => (below > 9 ? below - 9 : 0);
  const tens = (Math.floor(shown / 10) % 10) + carry(units);
  const hundreds = (Math.floor(shown / 100) % 10) + carry(Math.floor(shown / 10) % 10 === 9 ? units : 0);
  const turns = Math.floor(shown / 10); // changes when the units drum wraps

  return (
    <div className="flex items-center gap-2">
      <span className="deck-caption" aria-hidden>
        COUNTER
      </span>
      <div className="counter" role="img" aria-label={`Tape counter ${label}`}>
        {[
          { position: hundreds, key: `h${Math.floor(shown / 1000)}` },
          { position: tens, key: `t${Math.floor(shown / 100)}` },
          { position: units, key: `u${turns}` },
        ].map(({ position, key }, i) => (
          // A new key on wrap-around remounts the drum, so it doesn't spin backwards.
          <span key={`${i}-${key}`} className="counter-drum" aria-hidden>
            <span
              className="counter-strip"
              data-animate={!reduced || undefined}
              style={{ "--pos": position } as CSSProperties}
            >
              {DIGITS.map((d, j) => (
                <span key={j}>{d}</span>
              ))}
            </span>
          </span>
        ))}
      </div>
      <button type="button" className="counter-reset" aria-label="Reset the tape counter to 000" onClick={onReset}>
        RESET
      </button>
    </div>
  );
}
