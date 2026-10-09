import type { ComponentProps, CSSProperties, KeyboardEvent, ReactNode } from "react";

type KeyProps = ComponentProps<"button"> & {
  label: string;
  icon: ReactNode;
  down?: boolean;
  led?: boolean;
};

/** A silver piano-key deck button. `down` latches it; `led` lights its lamp. */
export function Key({ label, icon, down, led, className, ...props }: KeyProps) {
  return (
    <button type="button" data-down={down || undefined} className={`key ${className ?? ""}`} {...props}>
      <span className={`key-led ${led ? "key-led-on" : ""}`} aria-hidden />
      <span className="h-5 w-5" aria-hidden>
        {icon}
      </span>
      <span className="text-[10px] font-semibold tracking-[0.16em]">{label}</span>
    </button>
  );
}

type SlideSwitchProps<T extends string> = {
  label: string;
  value: T;
  options: readonly { value: T; label: string; description: string }[];
  onChange: (value: T) => void;
};

/**
 * A multi-position slide switch (a radio group). Click a position, or use the
 * arrow keys when it's focused.
 */
export function SlideSwitch<T extends string>({ label, value, options, onChange }: SlideSwitchProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    // Keep focus on the newly selected position (roving tab stop).
    const group = event.currentTarget;
    requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  }

  return (
    <div className="flex items-center gap-3">
      <span className="deck-caption" aria-hidden>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="slide-switch"
        style={{ "--positions": options.length, "--index": index } as CSSProperties}
        onKeyDown={onKeyDown}
      >
        <span className="slide-knob" aria-hidden />
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            aria-label={option.description}
            title={option.description}
            tabIndex={option.value === value ? 0 : -1}
            className="slide-pos"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const SPEEDS = [0.5, 1, 1.5, 2] as const;

type SpeedSelectorProps = {
  speed: number;
  isAvailable: (speed: number) => boolean;
  onChange: (speed: number) => void;
  className?: string;
};

/** 0.5x / 1x / 1.5x / 2x buttons; the current speed lights up. */
export function SpeedSelector({ speed, isAvailable, onChange, className }: SpeedSelectorProps) {
  return (
    <div role="group" aria-label="Playback speed" className={`speed ${className ?? ""}`}>
      {SPEEDS.map((option) => (
        <button
          key={option}
          type="button"
          className="speed-btn"
          aria-pressed={speed === option}
          disabled={!isAvailable(option)}
          onClick={() => onChange(option)}
        >
          {option}x
        </button>
      ))}
    </div>
  );
}

export const ICONS = {
  rew: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.5 6v12L3 12zM21 6v12l-8.5-6z" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 5v14l12-7z" />
    </svg>
  ),
  ff: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 6v12l8.5-6zM12.5 6v12L21 12z" />
    </svg>
  ),
  stop: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
  eject: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 5l8 9H4z" />
      <rect x="4" y="16" width="16" height="3" rx="1" />
    </svg>
  ),
  prevTrack: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="6" width="2.5" height="12" rx="0.5" />
      <path d="M19 6v12l-9.5-6z" />
    </svg>
  ),
  nextTrack: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 6v12l9.5-6z" />
      <rect x="16.5" y="6" width="2.5" height="12" rx="0.5" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" />
    </svg>
  ),
  look: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.2-1-1.4-1-2.4 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4.1-4-7.5-9-7.5z" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" />
      <circle cx="10" cy="7" r="1" fill="currentColor" />
      <circle cx="15" cy="7.5" r="1" fill="currentColor" />
    </svg>
  ),
  cover: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7 10l5 5 5-5M5 19h14" />
    </svg>
  ),
  corner: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 9l7 7M16 11v5h-5" />
    </svg>
  ),
  miniPlayer: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  ),
};
