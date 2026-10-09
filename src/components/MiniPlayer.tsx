"use client";

import { Cassette } from "./Cassette";
import { ICONS, Key, SpeedSelector } from "./controls";
import { VolumeKnob } from "./VolumeKnob";
import type { LabelFont, ShellId } from "@/lib/shells";
import { formatTime } from "@/lib/youtube";

type MiniPlayerProps = {
  tape: { id: string; title: string; author: string; shell?: ShellId; font?: LabelFont } | null;
  title: string;
  subtitle: string;
  note?: string;
  time: number;
  duration: number;
  /** 0..1 through the current video */
  progress: number;
  /** 0..1 through the whole tape (differs from progress on a mixtape) */
  reelProgress: number;
  motion: number;
  playing: boolean;
  ready: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onPlayStop: () => void;
  onNext: () => void;
  speed: number;
  isSpeedAvailable: (speed: number) => boolean;
  onSpeedChange: (speed: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onExpand: () => void;
  /** What the expand button does, e.g. "Back to full size" or "Back to the deck" */
  expandLabel?: string;
};

/**
 * The compact player, shown when the window is shrunk into the screen corner
 * and in the floating always-on-top window.
 */
export function MiniPlayer(props: MiniPlayerProps) {
  const { tape, title, subtitle, note, time, duration, progress, reelProgress, motion, playing, ready } = props;

  return (
    <div className="mini">
      <div className="mini-header">
        <span className="deck-brand text-[10px]">TAPE DECK</span>
        <button
          type="button"
          className="mini-expand"
          aria-label={props.expandLabel ?? "Back to full size"}
          title={`${props.expandLabel ?? "Back to full size"} (Esc)`}
          onClick={props.onExpand}
        >
          <span className="h-4 w-4" aria-hidden>
            {ICONS.expand}
          </span>
        </button>
      </div>

      <div className="mini-top">
        <div className="mini-cassette">
          {tape ? (
            <Cassette
              id={tape.id}
              title={tape.title}
              author={tape.author}
              progress={reelProgress}
              motion={motion}
              note={note}
              shell={tape.shell}
              font={tape.font}
            />
          ) : (
            <div className="bay-empty text-[10px]">No tape</div>
          )}
        </div>
        <div className="mini-info">
          <p className="mini-title" title={title}>
            {title}
          </p>
          <p className="mini-sub" title={subtitle}>
            {subtitle}
          </p>
          <p className="mini-time">
            {formatTime(time)} / {formatTime(duration)}
          </p>
          <SpeedSelector
            speed={props.speed}
            isAvailable={props.isSpeedAvailable}
            onChange={props.onSpeedChange}
            className="speed-compact"
          />
        </div>
      </div>

      <div className="mini-progress" aria-hidden>
        <div style={{ width: `${progress * 100}%` }} />
      </div>

      <div role="group" aria-label="Playback" className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
        <Key
          label="PREV"
          icon={ICONS.prevTrack}
          className="key-mini"
          aria-label="Previous"
          disabled={!props.canPrevious}
          onClick={props.onPrevious}
        />
        <Key
          label={playing ? "STOP" : "PLAY"}
          icon={playing ? ICONS.stop : ICONS.play}
          className="key-mini"
          led={playing}
          disabled={!ready}
          onClick={props.onPlayStop}
        />
        <Key
          label="NEXT"
          icon={ICONS.nextTrack}
          className="key-mini"
          aria-label="Next"
          disabled={!props.canNext}
          onClick={props.onNext}
        />
        <VolumeKnob value={props.volume} onChange={props.onVolumeChange} size={54} className="ml-1" />
      </div>
    </div>
  );
}
