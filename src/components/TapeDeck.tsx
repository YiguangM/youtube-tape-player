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
import { ICONS, Key, SlideSwitch, SPEEDS, SpeedSelector } from "./controls";
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
import { useMediaSession } from "@/lib/mediaSession";
import { openFloatingWindow, useFloatingWindowSupported } from "@/lib/pip";
import {
  rackOrder,
  resumePoint,
  tapeKey,
  useRack,
  withoutTape,
  withResume,
  withTape,
  withUpdatedTape,
  type Tape,
} from "@/lib/rackStore";
import {
  currentTrack,
  hasNext,
  nextInSequence,
  previousInSequence,
  reshuffle,
  startSequence,
  type Repeat,
  type Sequence,
} from "@/lib/sequencer";
import { useAutoNext, useRackSort, useRepeat, useShuffle, useSpeed, useVolume } from "@/lib/settings";
import { keyClick } from "@/lib/sfx";
import { PlayerState, coverUrl, formatTime, loadYouTubeApi, type YTPlayer } from "@/lib/youtube";

type Status = "empty" | "loading" | "cued" | "playing" | "buffering" | "paused" | "ended" | "jammed";
/** The tape in the deck, and where to start it. */
type Slot = { tape: Tape; autoplay: boolean; insertedAt: number; start: { seconds: number; track: number } };
type Wind = { dir: 1 | -1; from: number; startedAt: number };
type Track = { index: number; count: number; title: string };
/** A mixtape being played: its video IDs, titles and channels learned so far, and the play order. */
type Mix = { ids: string[]; titles: Record<number, string>; authors: Record<number, string>; sequence: Sequence };

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

const REPEAT_OPTIONS = [
  { value: "off", label: "OFF", description: "Repeat off" },
  { value: "one", label: "ONE", description: "Repeat the current track" },
  { value: "all", label: "ALL", description: "Repeat the whole tape" },
] as const;

/** Keep seeks inside the tape, stopping just short of the end like a real deck. */
function clampToTape(seconds: number, total: number) {
  return Math.min(Math.max(seconds, 0), Math.max(0, total - 0.5));
}

function loadVideo(player: YTPlayer, videoId: string, autoplay: boolean, startSeconds = 0) {
  const request = { videoId, startSeconds };
  if (autoplay) player.loadVideoById(request);
  else player.cueVideoById(request);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function TapeDeck() {
  const [rack, updateRack] = useRack();
  const tapes = rack.tapes;
  const [rackSort] = useRackSort();
  // The rack as the listener sees it, which AUTO NEXT and PREV/NEXT tape follow.
  const orderedTapes = rackOrder(tapes, rackSort);
  const [volume, setVolume] = useVolume();
  const [autoNext, setAutoNext] = useAutoNext();
  const [repeat, setRepeat] = useRepeat();
  const [shuffle, setShuffle] = useShuffle();
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
  const [mix, setMix] = useState<Mix | null>(null);
  const [deckMessage, setDeckMessage] = useState<string | null>(null);
  // A short-lived message on the display, e.g. a skipped track.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef(0);

  function showNotice(message: string) {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  }
  // Set while a YouTube playlist is cued just to read its list of videos.
  const resolvingPlaylist = useRef(false);
  // Unplayable tracks skipped in a row, so a mixtape of broken videos can't loop forever.
  const skippedInARow = useRef(0);
  // Which way the listener last moved through a mixtape, so skips keep going that way.
  const direction = useRef<1 | -1>(1);
  const markedPlayed = useRef(0);

  const track: Track | null = mix
    ? {
        index: currentTrack(mix.sequence),
        count: mix.ids.length,
        title: mix.titles[currentTrack(mix.sequence)] ?? "",
      }
    : null;

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
    setMix(null);
    setAvailableRates(null);
    setDeckMessage(null);
  }

  /** Puts a tape into the player: a video directly, a playlist via its list of videos. */
  function loadSlot(player: YTPlayer, loaded: Slot) {
    resolvingPlaylist.current = false;
    skippedInARow.current = 0;
    if (loaded.tape.kind === "playlist") {
      // Cue the playlist only to learn its videos (see onPlayerState: CUED);
      // the deck then plays them one by one so it controls the order.
      resolvingPlaylist.current = true;
      player.cuePlaylist({ list: loaded.tape.id, listType: "playlist", index: 0 });
    } else if (loaded.tape.kind === "custom") {
      // A custom mixtape already knows its videos and titles.
      const tracks = loaded.tape.tracks;
      if (tracks.length === 0) {
        setStatus("jammed");
        setDeckMessage("This mixtape is empty. Add tapes to it with the + button in the rack.");
        return;
      }
      const first = Math.min(loaded.start.track, tracks.length - 1);
      const titles = Object.fromEntries(tracks.map((t, i) => [i, t.title]));
      const authors = Object.fromEntries(tracks.map((t, i) => [i, t.author]));
      playTrack(
        { ids: tracks.map((t) => t.id), titles, authors, sequence: startSequence(tracks.length, first, shuffle) },
        loaded.autoplay,
        first === loaded.start.track ? loaded.start.seconds : 0,
      );
    } else {
      loadVideo(player, loaded.tape.id, loaded.autoplay, loaded.start.seconds);
    }
  }

  /** Starts a mixtape playing from its sequence's current track. */
  function playTrack(next: Mix, autoplay: boolean, startSeconds = 0) {
    setMix(next);
    // Clear the old track's position so the slider waits for the new one.
    setTime(startSeconds);
    setDuration(0);
    const player = playerRef.current;
    if (player) loadVideo(player, next.ids[currentTrack(next.sequence)], autoplay, startSeconds);
  }

  /** Learned a playlist's videos: build the mixtape and cue its starting track. */
  function startPlaylist(player: YTPlayer, loaded: Slot) {
    const ids = (player.getPlaylist() ?? []).filter(Boolean);
    if (ids.length === 0) {
      setStatus("jammed");
      setDeckMessage("This playlist is empty or can't be played here.");
      return;
    }
    const first = Math.min(loaded.start.track, ids.length - 1);
    const sequence = startSequence(ids.length, first, shuffle);
    playTrack({ ids, titles: {}, authors: {}, sequence }, loaded.autoplay, first === loaded.start.track ? loaded.start.seconds : 0);
  }

  /** Moves a mixtape on by one track; false when the tape has run out. */
  function advanceMix(autoplay: boolean): boolean {
    if (!mix) return false;
    direction.current = 1;
    const next = nextInSequence(mix.sequence, shuffle, repeat);
    if (!next) return false;
    playTrack({ ...mix, sequence: next }, autoplay);
    return true;
  }

  function stepBack(previous: Sequence) {
    if (!mix) return;
    direction.current = -1;
    playTrack({ ...mix, sequence: previous }, true);
  }

  function replayCurrent() {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(0, true);
    player.playVideo();
  }

  function endOfTape() {
    setStatus("ended");
    setStopped(true);
    saveResume();
    const index = slot ? orderedTapes.findIndex((t) => tapeKey(t) === tapeKey(slot.tape)) : -1;
    const next = index >= 0 ? orderedTapes[index + 1] : undefined;
    if (autoNext && next) load(next, true);
  }

  // --- YouTube player events -------------------------------------------------

  const onPlayerReady = useEffectEvent((player: YTPlayer) => {
    playerRef.current = player;
    setPlayerReady(true);
    player.setVolume(volume);
    requestRate(player, speed);
    if (slot) loadSlot(player, slot);
  });

  const onPlayerState = useEffectEvent((state: number) => {
    switch (state) {
      case PlayerState.PLAYING: {
        setStatus("playing");
        setStopped(false);
        setDeckMessage(null);
        skippedInARow.current = 0;
        if (slot && markedPlayed.current !== slot.insertedAt) {
          // For "recently played" sorting: once per time the tape goes in.
          markedPlayed.current = slot.insertedAt;
          updateRack((r) => withUpdatedTape(r, tapeKey(slot.tape), (t) => ({ ...t, playedAt: Date.now() })));
        }
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
      case PlayerState.CUED: {
        const player = playerRef.current;
        if (resolvingPlaylist.current && player && slot) {
          resolvingPlaylist.current = false;
          startPlaylist(player, slot);
          break;
        }
        setStatus("cued");
        setStopped(true);
        break;
      }
      case PlayerState.ENDED:
        // AUTO-REVERSE: ONE replays the track; ALL loops the tape (a mixtape wraps
        // around inside advanceMix). Otherwise move on, or the tape has ended.
        if (repeat === "one" || (repeat === "all" && !mix)) replayCurrent();
        else if (!advanceMix(true)) endOfTape();
        break;
    }
  });

  const onPlayerError = useEffectEvent((code: number) => {
    const reason = PLAYER_ERRORS[code] ?? `The tape jammed (YouTube error ${code}).`;
    // One unplayable song shouldn't stop a whole mixtape: skip to the next track.
    if (mix && skippedInARow.current < mix.ids.length) {
      skippedInARow.current += 1;
      showNotice(`Skipped track ${currentTrack(mix.sequence) + 1}: ${reason}`);
      // Going back through the history? Keep going back past the broken track.
      const previous = direction.current < 0 ? previousInSequence(mix.sequence, shuffle) : null;
      if (previous) stepBack(previous);
      else if (!advanceMix(true)) endOfTape();
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
  const onSlotChange = useEffectEvent(() => {
    const player = playerRef.current;
    if (slot && player) loadSlot(player, slot);
  });
  useEffect(() => onSlotChange(), [slot]);

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
    // Learn each mixtape track's title and channel once its video has loaded.
    if (mix) {
      const index = currentTrack(mix.sequence);
      const data = player.getVideoData?.();
      const title = data?.title;
      const author = data?.author ?? "";
      if (title && data.video_id === mix.ids[index] && (mix.titles[index] !== title || (author && !mix.authors[index]))) {
        setMix((m) => m && { ...m, titles: { ...m.titles, [index]: title }, authors: { ...m.authors, [index]: author || m.authors[index] } });
      }
    }
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
  // Not ready for transport keys yet: no player, or a tape (or playlist) still loading.
  const keysReady = playerReady && status !== "loading";

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
    setMix(null);
    resolvingPlaylist.current = false;
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

  // When the track was last restarted. YouTube reports the new position a moment
  // late, so a quick second PREV would otherwise just restart the track again.
  const restartedAt = useRef(0);

  function restartCurrent() {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(0, true);
    setTime(0);
    restartedAt.current = performance.now();
  }

  /** Far enough into the track that PREV should restart it rather than go back. */
  function pastTrackStart(player: YTPlayer) {
    const justRestarted = performance.now() - restartedAt.current < RESTART_TRACK_AFTER * 1000;
    return !justRestarted && (player.getCurrentTime() || 0) > RESTART_TRACK_AFTER;
  }

  // Mixtape track skipping, like a deck's music-search buttons. PREV restarts the
  // track if it's a few seconds in, otherwise steps back through what was played.
  function previousTrack() {
    const player = playerRef.current;
    if (!player || !mix) return;
    keyClick();
    const previous = previousInSequence(mix.sequence, shuffle);
    if (pastTrackStart(player) || !previous) restartCurrent();
    else stepBack(previous);
  }

  function nextTrack() {
    if (!mix || !hasNext(mix.sequence, repeat)) return;
    keyClick();
    advanceMix(true);
  }

  function changeRepeat(value: Repeat) {
    keyClick();
    setRepeat(value);
    // Leaving ALL: drop tracks queued for another lap, so the tape ends at its end.
    if (repeat === "all" && value !== "all") {
      setMix((m) => m && { ...m, sequence: reshuffle(m.sequence, shuffle) });
    }
  }

  function toggleShuffle() {
    keyClick();
    setShuffle(!shuffle);
    setMix((m) => m && { ...m, sequence: reshuffle(m.sequence, !shuffle) });
  }

  // Mini player PREV / NEXT: through a mixtape's tracks, then on to the
  // neighbouring tapes in the rack.
  function rackNeighbour(offset: 1 | -1): Tape | undefined {
    if (!slot) return undefined;
    const index = orderedTapes.findIndex((t) => tapeKey(t) === tapeKey(slot.tape));
    return index >= 0 ? orderedTapes[index + offset] : undefined;
  }

  function skipBack() {
    const player = playerRef.current;
    if (!player) return;
    const previousTape = rackNeighbour(-1);
    const previous = mix && previousInSequence(mix.sequence, shuffle);
    if (pastTrackStart(player) || (!previous && !previousTape)) {
      keyClick();
      restartCurrent();
    } else if (mix && previous) {
      keyClick();
      stepBack(previous);
    } else if (previousTape) {
      keyClick("clunk");
      load(previousTape, true);
    }
  }

  function skipForward() {
    if (!playerRef.current) return;
    if (mix && hasNext(mix.sequence, repeat)) {
      keyClick();
      advanceMix(true);
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
    const player = playerRef.current;
    const total = player?.getDuration() || 0;
    if (!player || total <= 0) return; // still loading
    // Stop just short of the end: a video sought to its very end may restart
    // instead of finishing, and then the next track wouldn't follow.
    const target = clampToTape(seconds, total);
    player.seekTo(target, true);
    setTime(target);
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
    if (target?.closest("input, textarea, select, button, a, dialog, [role='slider'], [contenteditable='true']")) return;
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
  const isMixtape = tape?.kind === "playlist" || tape?.kind === "custom";
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
    ready: keysReady,
    canPrevious: keysReady,
    canNext: keysReady && ((!!mix && hasNext(mix.sequence, repeat)) || !!rackNeighbour(1)),
    onPrevious: skipBack,
    onPlayStop: playing ? stop : play,
    onNext: skipForward,
    speed,
    isSpeedAvailable,
    onSpeedChange: changeSpeed,
    volume,
    onVolumeChange: setVolume,
  };

  // The operating system's media controls and hardware media keys.
  const currentVideo = mix ? mix.ids[currentTrack(mix.sequence)] : tape?.kind === "video" ? tape.id : undefined;
  useMediaSession({
    info: tape
      ? {
          title: track?.title || tape.title,
          artist: tape.author,
          album: isMixtape ? tape.title : "Tape Deck",
          artwork: currentVideo ? `https://i.ytimg.com/vi/${currentVideo}/hqdefault.jpg` : undefined,
        }
      : null,
    state: playing ? "playing" : slot ? "paused" : "none",
    position: duration > 0 ? { duration, position: time, playbackRate: speed } : null,
    hasPrevious: keysReady,
    hasNext: miniPlayerProps.canNext,
    actions: {
      play,
      pause: () => playing && pause(),
      stop,
      previousTrack: skipBack,
      nextTrack: skipForward,
      seekBy: nudge,
      seekTo: seek,
    },
  });

  let displayLine = "Paste a YouTube link below to record a tape";
  if (deckMessage) displayLine = deckMessage;
  else if (notice) displayLine = notice;
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
              {currentVideo && (
                <a
                  className="plate-btn"
                  href={coverUrl(currentVideo, track?.title || tape?.title || "", (mix && mix.authors[track?.index ?? -1]) || tape?.author || "")}
                  download
                  aria-label="Save cover art for what's playing"
                  title="Save the cover art (thumbnail) of what's playing"
                >
                  <span className="h-3.5 w-3.5" aria-hidden>
                    {ICONS.cover}
                  </span>
                  COVER
                </a>
              )}
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
                disabled={!keysReady}
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
                disabled={!keysReady}
                onClick={play}
              />
              <Key
                label="FF"
                aria-label="Fast forward"
                title="Hold to fast forward, tap to skip ahead 10s"
                icon={ICONS.ff}
                down={wind?.dir === 1}
                disabled={!keysReady}
                onPointerDown={(e) => startWind(1, e)}
                onPointerUp={endWind}
                onPointerCancel={endWind}
                onLostPointerCapture={endWind}
                onClick={(e) => e.detail === 0 && nudge(NUDGE_SECONDS)}
              />
              <Key label="STOP" icon={ICONS.stop} disabled={!keysReady} onClick={stop} />
              <Key
                label="PAUSE"
                icon={ICONS.pause}
                down={pauseLatched}
                aria-pressed={pauseLatched}
                disabled={!keysReady}
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
                  disabled={!mix || !keysReady}
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
                  disabled={!mix || !keysReady || !hasNext(mix.sequence, repeat)}
                  onClick={nextTrack}
                >
                  <span className="h-4 w-4" aria-hidden>
                    {ICONS.nextTrack}
                  </span>
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="deck-caption">SPEED</span>
                <SpeedSelector speed={speed} isAvailable={isSpeedAvailable} onChange={changeSpeed} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <SlideSwitch
                label="AUTO-REVERSE"
                value={repeat}
                options={REPEAT_OPTIONS}
                onChange={changeRepeat}
              />
              <button
                type="button"
                className="toggle"
                aria-pressed={shuffle}
                title="Play mixtape tracks in a random order (no repeats until every track has played)"
                onClick={toggleShuffle}
              >
                <span className={`led ${shuffle ? "led-on" : ""}`} aria-hidden />
                SHUFFLE
              </button>
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
          onUpdateRack={updateRack}
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
