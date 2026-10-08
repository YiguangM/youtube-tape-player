import type { ComponentProps, ReactNode } from "react";

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
