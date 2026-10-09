"use client";

import { useEffect, useEffectEvent, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { SLEEP_OPTIONS, type SleepMinutes } from "@/lib/sleepTimer";
import { formatTime } from "@/lib/youtube";

const ANGLES = [-120, -40, 40, 120]; // pointer angle for OFF, 15, 30, 60
const LABELS = ["OFF", "15", "30", "60"];

type SleepDialProps = {
  minutes: SleepMinutes;
  /** Milliseconds left on the timer */
  remaining: number;
  onChange: (minutes: SleepMinutes) => void;
};

/**
 * A 4-position rotary dial for the sleep timer: click to turn it to the next
 * position, scroll over it, or use the arrow keys. Hover or focus shows the
 * time left.
 */
export function SleepDial({ minutes, remaining, onChange }: SleepDialProps) {
  const dialRef = useRef<HTMLDivElement>(null);
  const index = Math.max(0, SLEEP_OPTIONS.indexOf(minutes));
  const left = minutes === 0 ? "Off" : `${formatTime(remaining / 1000)} left`;

  function step(by: number) {
    const next = Math.min(SLEEP_OPTIONS.length - 1, Math.max(0, index + by));
    if (next !== index) onChange(SLEEP_OPTIONS[next]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, () => void> = {
      ArrowUp: () => step(1),
      ArrowRight: () => step(1),
      ArrowDown: () => step(-1),
      ArrowLeft: () => step(-1),
      Home: () => onChange(0),
      End: () => onChange(60),
      Enter: () => onChange(SLEEP_OPTIONS[(index + 1) % SLEEP_OPTIONS.length]),
      " ": () => onChange(SLEEP_OPTIONS[(index + 1) % SLEEP_OPTIONS.length]),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation(); // don't trigger the deck's own shortcuts
    move();
  }

  // Scrolling over the dial clicks it round one position per notch.
  const onWheelStep = useEffectEvent((by: number) => step(by));
  useEffect(() => {
    const dial = dialRef.current;
    if (!dial) return;
    let carry = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // A mouse-wheel notch (its size varies with display scaling) is one click
      // of the dial; small touchpad scrolls add up until they make one.
      const notch = event.deltaMode !== 0 || Math.abs(event.deltaY) >= 30;
      carry = notch ? -Math.sign(event.deltaY) * 80 : carry - event.deltaY;
      if (Math.abs(carry) >= 80) {
        onWheelStep(carry > 0 ? 1 : -1);
        carry = 0;
      }
    };
    dial.addEventListener("wheel", onWheel, { passive: false });
    return () => dial.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="sleep">
      <span className="deck-caption" aria-hidden>
        SLEEP
      </span>
      <div className="sleep-face">
        {LABELS.map((label, i) => (
          <span
            key={label}
            className="sleep-mark"
            data-on={i === index || undefined}
            style={{ "--angle": `${ANGLES[i]}deg` } as CSSProperties}
            aria-hidden
          >
            {label}
          </span>
        ))}
        <div
          ref={dialRef}
          role="slider"
          tabIndex={0}
          aria-label="Sleep timer"
          aria-valuemin={0}
          aria-valuemax={SLEEP_OPTIONS.length - 1}
          aria-valuenow={index}
          aria-valuetext={minutes === 0 ? "Off" : `${minutes} minutes, ${left}`}
          title={minutes === 0 ? "Sleep timer: off" : `Sleep timer: ${left}`}
          className="sleep-dial"
          style={{ "--angle": `${ANGLES[index]}deg` } as CSSProperties}
          onClick={() => onChange(SLEEP_OPTIONS[(index + 1) % SLEEP_OPTIONS.length])}
          onKeyDown={onKeyDown}
        >
          <span className="sleep-cap" aria-hidden />
        </div>
        <span className="sleep-left" aria-hidden>
          {left}
        </span>
      </div>
    </div>
  );
}
