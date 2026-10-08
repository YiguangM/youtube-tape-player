"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Cassette } from "./Cassette";
import { ICONS, Key, SPEEDS, SpeedSelector } from "./controls";
import { MiniPlayer } from "./MiniPlayer";
import { TapeRack } from "./TapeRack";
import { VolumeKnob } from "./VolumeKnob";
import {
  applyBounds,
  cornerBounds,
  currentBounds,
  fullBounds,
  MINI_CONTENT,
  needsRecentring,
  type WindowBounds,
} from "@/lib/appWindow";
import { openFloatingWindow, useFloatingWindowSupported } from "@/lib/pip";
import {
  resumePoint,
  tapeKey,
  useRack,
  withoutTape,
  withResume,
  withTape,
  type Tape,
} from "@/lib/rackStore";
import { useAutoNext, useSpeed, useVolume } from "@/lib/settings";
import { keyClick } from "@/lib/sfx";
import { PlayerState, formatTime, loadYouTubeApi, type YTPlayer } from "@/lib/youtube";

type Status = "empty" | "loading" | "cued" | "playing" | "buffering" | "paused" | "ended" | "jammed";
/** The tape in the deck, and where to start it. */
type Slot = { tape: Tape; autoplay: boolean; insertedAt: number; start: { seconds: number; track: number } };
type Wind = { dir: 1 | -1; from: number; startedAt: number };
type Track = { index: number; count: number; title: string };

const PLAYER_ERRORS: Record<number, string> = {
  2: "That video ID isn't valid.",
  5: "This video can't play in this browser.",
  100: "Video not found. It may be private or removed.",
  101: "The owner doesn't allow this video to play outside YouTube.",
  150: "The owner doesn't allow this video to play outside YouTube.",
};

const NUDGE_SECONDS = 10;
const TAP_MS = 250; // a press shorter than this skips instead of winding
const RESTART_TRACK_AFTER = 3; // PREV restarts the current track if it's this far in
const RATE_ECHO_MS = 3000; // how long YouTube may take to report back a speed we set
const RESUME_SAVE_MS = 5000; // how often the playing position is saved

/** Keep seeks inside the tape, stopping just short of the end like a real deck. */
function clampToTape(seconds: number, total: number) {
  return Math.min(Math.max(seconds, 0), Math.max(0, total - 0.5));
}

function loadIntoPlayer(player: YTPlayer, slot: Slot) {
  const { tape, autoplay, start } = slot;
  if (tape.kind === "playlist") {
    const request = { list: tape.id, listType: "playlist" as const, index: start.track, startSeconds: start.seconds };
    if (autoplay) player.loadPlaylist(request);
    else player.cuePlaylist(request);
  } else {
    const request = { videoId: tape.id, startSeconds: start.seconds };
    if (autoplay) player.loadVideoById(request);
    else player.cueVideoById(request);
  }
}

/** Where a playlist is up to, or null when a single video is loaded. */
function readTrack(player: YTPlayer): Track | null {
  const list = player.getPlaylist();
  if (!list || list.length === 0) return null;
  return {
    index: Math.max(0, player.getPlaylistIndex()),
    count: list.length,
    title: player.getVideoData?.().title ?? "",
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function TapeDeck() {
  const [rack, updateRack] = useRack();
  const tapes = rack.tapes;
  const [volume, setVolume] = useVolume();
  const [autoNext, setAutoNext] = useAutoNext();
  const [speed, setSpeed] = useSpeed();
  // Speeds the current video allows (null until it starts playing).
  const [availableRates, setAvailableRates] = useState<number[] | null>(null);

  const [slot, setSlot] = useState<Slot | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [status, setStatus] = useState<Status>("empty");
  const [stopped, setStopped] = useState(true); // STOP pressed: no keys latched
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [wind, setWind] = useState<Wind | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [deckMessage, setDeckMessage] = useState<string | null>(null);

  // Mini mode shrinks the whole window into a compact player in the screen corner.
  const [mini, setMini] = useState(false);
  const restoreBounds = useRef<WindowBounds | null>(null);
  // The floating player: a separate always-on-top window (Chrome and Edge only).
  const floatingSupported = useFloatingWindowSupported();
  const [floatWindow, setFloatWindow] = useState<Window | null>(null);

  const screenRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  // Speeds we recently asked YouTube for, so their late echoes aren't mistaken
  // for the listener picking a speed in YouTube's own menu.
  const rateRequests = useRef<{ rate: number; at: number }[]>([]);

  function requestRate(player: YTPlayer, rate: number) {
    const now = performance.now();
    rateRequests.current = [...rateRequests.current.filter((r) => now - r.at < RATE_ECHO_MS), { rate, at: now }];
    player.setPlaybackRate(rate);
  }

  const tape = slot?.tape ?? null;
  const hasTape = slot !== null;

  // --- Resume positions ---------------------------------------------------------

  const lastResumeSave = useRef(0);

  /** Saves where the tape in the deck is up to, once it has actually played. */
  function saveResume() {
    const player = playerRef.current;
    if (!slot || !player) return;
    if (!["playing", "buffering", "paused", "ended"].includes(status)) return; // cued: nothing new to save
    const d = player.getDuration() || 0;
    if (d <= 0) return;
    lastResumeSave.current = performance.now();
    const t = player.getCurrentTime() || 0;
    updateRack((r) =>
      withResume(r, tapeKey(slot.tape), {
        t,
        d,
        at: Date.now(),
        ...(track && { track: track.index, n: track.count }),
      }),
    );
  }

  const onPageHide = useEffectEvent(() => saveResume());
  useEffect(() => {
    const handler = () => onPageHide();
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, []);

  function load(next: Tape, autoplay: boolean) {
    saveResume(); // remember where the outgoing tape was left
    setSlot({ tape: next, autoplay, insertedAt: Date.now(), start: resumePoint(rack, tapeKey(next)) });
    setStatus("loading");
    setStopped(!autoplay);
    setTime(0);
    setDuration(0);
    setWind(null);
    setTrack(null);
    setAvailableRates(null);
    setDeckMessage(null);
  }

  // --- YouTube player events -------------------------------------------------

  const onPlayerReady = useEffectEvent((player: YTPlayer) => {
    playerRef.current = player;
    setPlayerReady(true);
    player.setVolume(volume);
    requestRate(player, speed);
    if (slot) loadIntoPlayer(player, slot);
  });

  const onPlayerState = useEffectEvent((state: number) => {
    switch (state) {
      case PlayerState.PLAYING: {
        setStatus("playing");
        setStopped(false);
        setDeckMessage(null);
        // YouTube can reset the speed when a new video or track starts; keep ours.
        const player = playerRef.current;
        if (player) {
          setAvailableRates(player.getAvailablePlaybackRates());
          if (player.getPlaybackRate() !== speed) requestRate(player, speed);
        }
        break;
      }
      case PlayerState.BUFFERING:
        setStatus("buffering");
        break;
      case PlayerState.PAUSED:
        setStatus("paused");
        saveResume();
        break;
      case PlayerState.CUED:
        setStatus("cued");
        setStopped(true);
        break;
      case PlayerState.ENDED: {
        // Mid-mixtape, YouTube moves on to the next track by itself.
        const current = playerRef.current && readTrack(playerRef.current);
        if (current && current.index < current.count - 1) break;

        setStatus("ended");
        setStopped(true);
        saveResume();
        const index = slot ? tapes.findIndex((t) => tapeKey(t) === tapeKey(slot.tape)) : -1;
        const next = index >= 0 ? tapes[index + 1] : undefined;
        if (autoNext && next) load(next, true);
        break;
      }
    }
  });

  const onPlayerError = useEffectEvent((code: number) => {
    const reason = PLAYER_ERRORS[code] ?? `The tape jammed (YouTube error ${code}).`;
    // One unplayable song shouldn't stop a whole mixtape: skip to the next track.
    const player = playerRef.current;
    const current = player && readTrack(player);
    if (player && current && current.index < current.count - 1) {
      setDeckMessage(`Skipped track ${current.index + 1}: ${reason}`);
      player.nextVideo();
      return;
    }
    setStatus("jammed");
    setStopped(true);
    setDeckMessage(reason);
  });

  // The deck's speed wins over late echoes of our own requests and over YouTube
  // resetting to 1x on a new video; a different speed picked in YouTube's own
  // settings menu is adopted.
  const onRateChange = useEffectEvent((rate: number) => {
    const player = playerRef.current;
    if (!player || rate === speed) return;
    const now = performance.now();
    const echo = rateRequests.current.some((r) => r.rate === rate && now - r.at < RATE_ECHO_MS);
    if (echo || rate === 1) requestRate(player, speed);
    else setSpeed(rate);
  });

  const onApiFailed = useEffectEvent((error: Error) => {
    setStatus("jammed");
    setDeckMessage(error.message);
  });

  // Build the YouTube player when a tape goes in; tear it down on eject.
  useEffect(() => {
    const screen = screenRef.current;
    if (!hasTape || !screen) return;

    let cancelled = false;
    let player: YTPlayer | null = null;

    loadYouTubeApi().then(
      (YT) => {
        if (cancelled) return;
        // YouTube replaces this element with its iframe, so keep it out of React's tree.
        const mount = document.createElement("div");
        screen.replaceChildren(mount);
        player = new YT.Player(mount, {
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: (e) => !cancelled && onPlayerReady(e.target),
            onStateChange: (e) => !cancelled && onPlayerState(e.data),
            onError: (e) => !cancelled && onPlayerError(e.data),
            onPlaybackRateChange: (e) => !cancelled && onRateChange(e.data),
          },
        });
      },
      (error: Error) => !cancelled && onApiFailed(error),
    );

    return () => {
      cancelled = true;
      playerRef.current = null;
      player?.destroy();
      screen.replaceChildren();
    };
  }, [hasTape]);

  // Swap tapes on an existing player. (A brand-new player loads the tape in onPlayerReady.)
  useEffect(() => {
    const player = playerRef.current;
    if (slot && player) loadIntoPlayer(player, slot);
  }, [slot]);

  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (playerRef.current) requestRate(playerRef.current, speed);
  }, [speed]);

  // Follow the playhead (except while winding: the wind loop drives the display
  // then), and save the position every few seconds while playing.
  const onPoll = useEffectEvent(() => {
    const player = playerRef.current;
    if (!player) return;
    setTime(player.getCurrentTime() || 0);
    setDuration(player.getDuration() || 0);
    const next = readTrack(player);
    setTrack((previous) =>
      previous && next && previous.index === next.index && previous.count === next.count && previous.title === next.title
        ? previous
        : next,
    );
    if (status === "playing" && performance.now() - lastResumeSave.current > RESUME_SAVE_MS) saveResume();
  });

  useEffect(() => {
    if (!hasTape || wind) return;
    const timer = window.setInterval(() => onPoll(), 250);
    return () => window.clearInterval(timer);
  }, [hasTape, wind]);

  // Hold REW/FF to wind, speeding up the longer it's held. A quick tap skips 10s.
  useEffect(() => {
    const player = playerRef.current;
    if (!wind || !player) return;

    const total = player.getDuration() || 0;
    let position = wind.from;
    const timer = window.setInterval(() => {
      const heldSeconds = (performance.now() - wind.startedAt) / 1000;
      position = clampToTape(position + wind.dir * Math.min(2 + heldSeconds * 4, 20), total);
      player.seekTo(position, false);
      setTime(position);
    }, 100);

    return () => {
      window.clearInterval(timer);
      if (playerRef.current !== player) return; // tape was ejected mid-wind
      const tapped = performance.now() - wind.startedAt < TAP_MS;
      const target = tapped ? clampToTape(wind.from + wind.dir * NUDGE_SECONDS, total) : position;
      player.seekTo(target, true);
      setTime(target);
    };
  }, [wind]);

  // --- Controls ---------------------------------------------------------------

  const playing = status === "playing" || status === "buffering";

  function insert(next: Tape) {
    keyClick("clunk");
    load(next, false);
  }

  function eject() {
    if (!slot) return;
    keyClick("clunk");
    saveResume();
    setSlot(null);
    setPlayerReady(false);
    setStatus("empty");
    setStopped(true);
    setTime(0);
    setDuration(0);
    setWind(null);
    setTrack(null);
    setDeckMessage(null);
  }

  function play() {
    const player = playerRef.current;
    if (!player) return;
    keyClick();
    setStopped(false);
    player.playVideo();
  }

  function pause() {
    const player = playerRef.current;
    if (!player) return;
    keyClick();
    if (playing) player.pauseVideo();
    else if (status === "paused" && !stopped) player.playVideo();
  }

  function stop() {
    const player = playerRef.current;
    if (!player) return;
    keyClick();
    setStopped(true);
    if (playing) player.pauseVideo();
  }

  function nudge(seconds: number) {
    const player = playerRef.current;
    if (!player) return;
    const target = clampToTape((player.getCurrentTime() || 0) + seconds, player.getDuration() || 0);
    player.seekTo(target, true);
    setTime(target);
  }

  // Mixtape track skipping, like a deck's music-search buttons.
  function previousTrack() {
    const player = playerRef.current;
    if (!player || !track) return;
    keyClick();
    if (track.index === 0 || (player.getCurrentTime() || 0) > RESTART_TRACK_AFTER) {
      player.seekTo(0, true);
      setTime(0);
    } else {
      player.previousVideo();
    }
  }

  function nextTrack() {
    const player = playerRef.current;
    if (!player || !track || track.index >= track.count - 1) return;
    keyClick();
    player.nextVideo();
  }

  // Mini player PREV / NEXT: through a mixtape's tracks, then on to the
  // neighbouring tapes in the rack.
  function rackNeighbour(offset: 1 | -1): Tape | undefined {
    if (!slot) return undefined;
    const index = tapes.findIndex((t) => tapeKey(t) === tapeKey(slot.tape));
    return index >= 0 ? tapes[index + offset] : undefined;
  }

  function skipBack() {
    const player = playerRef.current;
    if (!player) return;
    const previousTape = rackNeighbour(-1);
    const onFirstTrack = !track || track.index === 0;
    if ((player.getCurrentTime() || 0) > RESTART_TRACK_AFTER || (onFirstTrack && !previousTape)) {
      keyClick();
      player.seekTo(0, true);
      setTime(0);
    } else if (!onFirstTrack) {
      keyClick();
      player.previousVideo();
    } else if (previousTape) {
      keyClick("clunk");
      load(previousTape, true);
    }
  }

  function skipForward() {
    const player = playerRef.current;
    if (!player) return;
    if (track && track.index < track.count - 1) {
      keyClick();
      player.nextVideo();
      return;
    }
    const nextTape = rackNeighbour(1);
    if (nextTape) {
      keyClick("clunk");
      load(nextTape, true);
    }
  }

  function isSpeedAvailable(option: number) {
    return availableRates === null || availableRates.includes(option);
  }

  function changeSpeed(option: number) {
    if (option === speed || !isSpeedAvailable(option)) return;
    keyClick();
    setSpeed(option);
  }

  function stepSpeed(direction: 1 | -1) {
    const options = direction > 0 ? SPEEDS.filter((s) => s > speed) : SPEEDS.filter((s) => s < speed).reverse();
    const next = options.find(isSpeedAvailable);
    if (next !== undefined) changeSpeed(next);
  }

  function enterMini() {
    keyClick();
    const before = currentBounds();
    restoreBounds.current = before;
    setMini(true);
    void applyBounds(cornerBounds);
    // A normal browser tab can't resize itself; if nothing happened, stay full size.
    window.setTimeout(() => {
      if (window.outerWidth === before.width && window.outerHeight === before.height) {
        setMini(false);
        setDeckMessage("Mini mode needs the Tape Deck app window. Open it from the desktop icon.");
      }
    }, 600);
  }

  function exitMini() {
    keyClick();
    setMini(false);
    const saved = restoreBounds.current ?? fullBounds();
    restoreBounds.current = null;
    void applyBounds(() => saved);
  }

  async function toggleFloating() {
    keyClick();
    if (floatWindow) {
      floatWindow.close();
      return;
    }
    try {
      const floating = await openFloatingWindow(MINI_CONTENT.width, MINI_CONTENT.height);
      if (!floating) return;
      floating.document.body.className = "floating-body";
      floating.addEventListener("pagehide", () => setFloatWindow(null), { once: true });
      setFloatWindow(floating);
    } catch {
      setDeckMessage("Couldn't open the floating player in this browser.");
    }
  }

  function closeFloating() {
    keyClick();
    floatWindow?.close();
    window.focus();
  }

  function seek(seconds: number) {
    playerRef.current?.seekTo(seconds, true);
    setTime(seconds);
  }

  function startWind(dir: 1 | -1, event: ReactPointerEvent<HTMLButtonElement>) {
    const player = playerRef.current;
    if (!player || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    keyClick();
    setWind({ dir, from: player.getCurrentTime() || 0, startedAt: performance.now() });
  }

  function endWind() {
    setWind(null);
  }

  // Keyboard: Space/K play-pause, arrows skip, Shift+N / Shift+P change track,
  // Shift+< / Shift+> change speed. Ignored while typing or on a focused control.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      if (floatWindow && event.view === floatWindow) closeFloating();
      else if (mini) exitMini();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, button, a, [role='slider'], [contenteditable='true']")) return;
    const player = playerRef.current;
    if (event.key === ">" || event.key === "<") {
      event.preventDefault();
      stepSpeed(event.key === ">" ? 1 : -1);
      return;
    }
    if (!player) return;

    if (event.shiftKey && (event.key === "N" || event.key === "P")) {
      event.preventDefault();
      if (event.key === "N") nextTrack();
      else previousTrack();
    } else if (event.key === " " || event.key === "k") {
      event.preventDefault();
      if (playing) {
        keyClick();
        player.pauseVideo();
      } else {
        play();
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      keyClick();
      seek(0); // rewind to the start of the tape (or the current mixtape track)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      nudge(-NUDGE_SECONDS);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nudge(NUDGE_SECONDS);
    }
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // The shortcuts work in the floating player too, and it closes along with the deck.
  useEffect(() => {
    if (!floatWindow) return;
    const handler = (event: KeyboardEvent) => onKeyDown(event);
    floatWindow.addEventListener("keydown", handler);
    return () => {
      floatWindow.removeEventListener("keydown", handler);
      floatWindow.close();
    };
  }, [floatWindow]);

  // After a reload in mini mode, or a relaunch where the window was last closed in
  // the corner, bring the full deck back to normal size in the middle of the screen.
  useEffect(() => {
    if (needsRecentring()) void applyBounds(fullBounds);
  }, []);

  // --- Tape rack --------------------------------------------------------------

  function addTape(added: Tape, insertNow: boolean) {
    updateRack((r) => withTape(r, added));
    if (insertNow) insert(added); // the first tape goes straight into an empty deck
  }

  function removeTape(removed: Tape) {
    updateRack((r) => withoutTape(r, tapeKey(removed)));
  }

  // --- Display ----------------------------------------------------------------

  const progress = duration > 0 ? Math.min(time / duration, 1) : 0;
  // On a mixtape the reels show how far through the whole playlist you are.
  const reelProgress = track ? Math.min((track.index + progress) / track.count, 1) : progress;
  const isMixtape = tape?.kind === "playlist";
  const cassetteNote = isMixtape ? (track ? `MIXTAPE · ${track.count} TRACKS` : "MIXTAPE") : undefined;
  const motion = wind ? wind.dir * 12 : status === "playing" ? speed : 0;
  const counter = String(Math.floor(time) % 1000).padStart(3, "0");
  const playLatched = playing || (status === "paused" && !stopped);
  const pauseLatched = status === "paused" && !stopped;

  let statusText = "NO TAPE";
  if (slot && wind) statusText = wind.dir > 0 ? "FF >>" : "<< REW";
  else if (slot) {
    statusText = {
      empty: "NO TAPE",
      loading: "LOADING",
      cued: "READY",
      playing: "PLAY >",
      buffering: "PLAY >",
      paused: stopped ? "STOP" : "PAUSE ||",
      ended: "END OF TAPE",
      jammed: "JAMMED",
    }[status];
    if (playing && speed !== 1) statusText += ` ${speed}x`;
  }

  // Shared by the corner mini player and the floating window.
  const miniPlayerProps = {
    tape,
    title: track?.title || tape?.title || "No tape in the deck",
    subtitle: !tape
      ? "Pick a tape in the rack"
      : track
        ? `Track ${track.index + 1} of ${track.count} · ${tape.title}`
        : tape.author || statusText,
    note: cassetteNote,
    time,
    duration,
    progress,
    reelProgress,
    motion,
    playing,
    ready: playerReady,
    canPrevious: playerReady,
    canNext: playerReady && ((!!track && track.index < track.count - 1) || !!rackNeighbour(1)),
    onPrevious: skipBack,
    onPlayStop: playing ? stop : play,
    onNext: skipForward,
    speed,
    isSpeedAvailable,
    onSpeedChange: changeSpeed,
    volume,
    onVolumeChange: setVolume,
  };

  let displayLine = "Paste a YouTube link below to record a tape";
  if (deckMessage) displayLine = deckMessage;
  else if (track) displayLine = `${pad2(track.index + 1)}/${pad2(track.count)}  ${track.title || tape?.title || ""}`;
  else if (tape) displayLine = `${tape.title}${tape.author ? ` · ${tape.author}` : ""}`;

  return (
    <div className="flex flex-1 flex-col" data-mini={mini || undefined}>
      <div
        className="full-layout mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 sm:px-6 sm:py-12"
        inert={mini}
      >
        <header className="flex flex-col gap-2">
          <h1 className="font-marker text-4xl sm:text-5xl">Tape Deck</h1>
          <p className="text-muted">
            Paste a YouTube video or playlist link, pop the tape in, press play.
          </p>
        </header>

        <section aria-label="Cassette deck" className="deck">
          <div className="deck-plate">
            <span className="deck-brand">TAPE DECK</span>
            <span className="deck-model">YT-85 · STEREO CASSETTE</span>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-x-4">
              <button
                type="button"
                className="plate-btn"
                title="Shrink Tape Deck into a mini player in the corner of your screen"
                onClick={enterMini}
              >
                <span className="h-3.5 w-3.5" aria-hidden>
                  {ICONS.corner}
                </span>
                MINI PLAYER
              </button>
              {floatingSupported && (
                <button
                  type="button"
                  className="plate-btn"
                  aria-pressed={floatWindow !== null}
                  title="Open a small player that floats on top of your other windows"
                  onClick={() => void toggleFloating()}
                >
                  <span className="h-3.5 w-3.5" aria-hidden>
                    {ICONS.miniPlayer}
                  </span>
                  FLOATING
                </button>
              )}
              <span className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em]">
                <span className={`led ${playing ? "led-on" : ""}`} aria-hidden />
                PLAY
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-2">
            <div className="bay min-w-0">
              {tape && slot ? (
                <div key={slot.insertedAt} className="tape-in">
                  <Cassette
                    id={tape.id}
                    title={tape.title}
                    author={tape.author}
                    progress={reelProgress}
                    motion={motion}
                    note={cassetteNote}
                  />
                </div>
              ) : (
                <div className="bay-empty">Insert a tape</div>
              )}
            </div>

            <div className="monitor min-w-0">
              <div className="screen-host relative aspect-video min-h-[200px] w-full overflow-hidden rounded-md bg-black">
                <div ref={screenRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
                {!playerReady && (
                  <div className="screen-idle absolute inset-0 grid place-items-center">
                    {!slot ? "NO TAPE" : status === "jammed" ? "NO SIGNAL" : "LOADING…"}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-4 pb-5 sm:px-6 sm:pb-6">
            <div className="vfd">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <span className="flex items-baseline gap-2">
                  <span className="vfd-label">CNT</span>
                  <span className="vfd-big">{counter}</span>
                </span>
                <span className="vfd-big" aria-live="polite">
                  {statusText}
                </span>
                <span className="vfd-big">
                  {formatTime(time)} / {formatTime(duration)}
                </span>
              </div>
              <p className="vfd-line" title={displayLine}>
                {displayLine}
              </p>
              <input
                type="range"
                aria-label="Tape position"
                aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
                className="slider slider-amber mt-2"
                min={0}
                max={Math.max(duration, 0)}
                step={1}
                value={Math.min(time, duration)}
                disabled={!playerReady || duration <= 0}
                onChange={(e) => seek(Number(e.target.value))}
                style={{ "--fill": `${progress * 100}%` } as CSSProperties}
              />
            </div>

            <div role="group" aria-label="Transport controls" className="grid grid-cols-6 gap-2 sm:gap-3">
              <Key
                label="REW"
                aria-label="Rewind"
                title="Hold to rewind, tap to skip back 10s"
                icon={ICONS.rew}
                down={wind?.dir === -1}
                disabled={!playerReady}
                onPointerDown={(e) => startWind(-1, e)}
                onPointerUp={endWind}
                onPointerCancel={endWind}
                onLostPointerCapture={endWind}
                onClick={(e) => e.detail === 0 && nudge(-NUDGE_SECONDS)}
              />
              <Key
                label="PLAY"
                icon={ICONS.play}
                down={playLatched}
                led={playing}
                aria-pressed={playLatched}
                disabled={!playerReady}
                onClick={play}
              />
              <Key
                label="FF"
                aria-label="Fast forward"
                title="Hold to fast forward, tap to skip ahead 10s"
                icon={ICONS.ff}
                down={wind?.dir === 1}
                disabled={!playerReady}
                onPointerDown={(e) => startWind(1, e)}
                onPointerUp={endWind}
                onPointerCancel={endWind}
                onLostPointerCapture={endWind}
                onClick={(e) => e.detail === 0 && nudge(NUDGE_SECONDS)}
              />
              <Key label="STOP" icon={ICONS.stop} disabled={!playerReady} onClick={stop} />
              <Key
                label="PAUSE"
                icon={ICONS.pause}
                down={pauseLatched}
                aria-pressed={pauseLatched}
                disabled={!playerReady}
                onClick={pause}
              />
              <Key label="EJECT" icon={ICONS.eject} className="key-eject" disabled={!slot} onClick={eject} />
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-3">
                <span className="deck-caption">VOLUME</span>
                <VolumeKnob value={volume} onChange={setVolume} size={60} />
              </div>
              <div role="group" aria-label="Mixtape tracks" className="track">
                <button
                  type="button"
                  className="track-btn"
                  aria-label="Previous track"
                  title="Previous track (Shift+P)"
                  disabled={!track || !playerReady}
                  onClick={previousTrack}
                >
                  <span className="h-4 w-4" aria-hidden>
                    {ICONS.prevTrack}
                  </span>
                </button>
                <span className="track-label" aria-live="polite">
                  {track ? `TRK ${pad2(track.index + 1)}/${pad2(track.count)}` : "TRK --/--"}
                </span>
                <button
                  type="button"
                  className="track-btn"
                  aria-label="Next track"
                  title="Next track (Shift+N)"
                  disabled={!track || !playerReady || track.index >= track.count - 1}
                  onClick={nextTrack}
                >
                  <span className="h-4 w-4" aria-hidden>
                    {ICONS.nextTrack}
                  </span>
                </button>
              </div>
              <button
                type="button"
                className="toggle"
                aria-pressed={autoNext}
                title="When a tape ends, play the next one in the rack"
                onClick={() => {
                  keyClick();
                  setAutoNext(!autoNext);
                }}
              >
                <span className={`led ${autoNext ? "led-on" : ""}`} aria-hidden />
                AUTO NEXT
              </button>
              <div className="flex items-center gap-3">
                <span className="deck-caption">SPEED</span>
                <SpeedSelector speed={speed} isAvailable={isSpeedAvailable} onChange={changeSpeed} />
              </div>
            </div>

            <p className="deck-caption leading-relaxed normal-case tracking-normal">
              Hold REW / FF to wind · Space play/pause · ← → skip 10s · Home rewind to start · Shift+N / Shift+P change track · Shift+&lt; / Shift+&gt; speed
            </p>
          </div>
        </section>

        <TapeRack
          tapes={tapes}
          activeKey={tape ? tapeKey(tape) : null}
          deckEmpty={!slot}
          onInsert={insert}
          onAdd={addTape}
          onRemove={removeTape}
        />

        <footer className="text-sm text-muted">
          Videos play through YouTube&apos;s embedded player. Your tape rack is saved in this browser.
        </footer>
      </div>

      {mini && (
        <div className="mini-layer">
          <MiniPlayer {...miniPlayerProps} onExpand={exitMini} />
        </div>
      )}

      {floatWindow &&
        createPortal(
          <MiniPlayer {...miniPlayerProps} onExpand={closeFloating} expandLabel="Back to the deck" />,
          floatWindow.document.body,
        )}
    </div>
  );
}
