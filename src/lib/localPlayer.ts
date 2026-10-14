// Plays an offline tape's files with a <video> element (which plays audio files
// too), behind the same interface and events as the YouTube player, so every
// deck control works the same way. Track IDs are the files' positions ("0", "1"…).
import type { LocalTrack } from "./localFolder";
import { PlayerState, type YTPlayer, type YTPlayerOptions } from "./youtube";

/** Error codes for offline files (YouTube's own codes are all below 200). */
export const LOCAL_FILE_MISSING = 1404;
export const LOCAL_FILE_UNPLAYABLE = 1415;

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Shown on the screen for audio files when the folder has no cover image.
const DEFAULT_POSTER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#0b0d0b"/>` +
      `<text x="160" y="92" fill="#ffb54a" font-family="monospace" font-size="20" text-anchor="middle" letter-spacing="4">OFFLINE TAPE</text>` +
      `<text x="160" y="122" fill="#a8742f" font-family="monospace" font-size="12" text-anchor="middle" letter-spacing="2">AUDIO</text></svg>`,
  );

export class LocalPlayer implements YTPlayer {
  private readonly video: HTMLVideoElement;
  private readonly coverUrl: string | null;
  private fileUrl: string | null = null;
  private current = "";
  private cueOnly = false;
  private startAt = 0;
  private loadToken = 0;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private readonly tracks: LocalTrack[],
    cover: File | null,
    private readonly events: NonNullable<YTPlayerOptions["events"]>,
  ) {
    this.coverUrl = cover ? URL.createObjectURL(cover) : null;
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.poster = this.coverUrl ?? DEFAULT_POSTER;
    video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;display:block";
    container.replaceChildren(video);
    this.video = video;

    const on = (type: string, handler: () => void) => {
      video.addEventListener(type, handler);
      this.cleanup.push(() => video.removeEventListener(type, handler));
    };
    on("loadedmetadata", () => {
      if (this.startAt > 0) video.currentTime = Math.min(this.startAt, video.duration || this.startAt);
      if (this.cueOnly) this.emit(PlayerState.CUED);
    });
    on("playing", () => this.emit(PlayerState.PLAYING));
    on("waiting", () => !video.paused && this.emit(PlayerState.BUFFERING));
    on("pause", () => !video.ended && this.emit(PlayerState.PAUSED));
    on("ended", () => this.emit(PlayerState.ENDED));
    on("error", () => video.src && this.events.onError?.({ target: this, data: LOCAL_FILE_UNPLAYABLE }));
    on("ratechange", () => this.events.onPlaybackRateChange?.({ target: this, data: video.playbackRate }));

    // Ready once the constructor has returned, like the YouTube player.
    window.setTimeout(() => this.events.onReady?.({ target: this, data: 0 }), 0);
  }

  private emit(state: number) {
    this.events.onStateChange?.({ target: this, data: state });
  }

  private async open(id: string, autoplay: boolean, startSeconds = 0) {
    const token = ++this.loadToken;
    this.current = id;
    const track = this.tracks[Number(id)];
    if (!track) {
      this.events.onError?.({ target: this, data: LOCAL_FILE_MISSING });
      return;
    }
    this.emit(PlayerState.UNSTARTED);
    let file: File;
    try {
      file = await track.file.getFile();
    } catch {
      if (token === this.loadToken) this.events.onError?.({ target: this, data: LOCAL_FILE_MISSING });
      return;
    }
    if (token !== this.loadToken) return; // another track was asked for meanwhile
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = URL.createObjectURL(file);
    this.cueOnly = !autoplay;
    this.startAt = startSeconds;
    this.video.src = this.fileUrl;
    if (autoplay) void this.video.play().catch(() => {});
  }

  cueVideoById(video: string | { videoId: string; startSeconds?: number }) {
    const request = typeof video === "string" ? { videoId: video } : video;
    void this.open(request.videoId, false, request.startSeconds);
  }

  loadVideoById(video: string | { videoId: string; startSeconds?: number }) {
    const request = typeof video === "string" ? { videoId: video } : video;
    void this.open(request.videoId, true, request.startSeconds);
  }

  playVideo() {
    this.cueOnly = false;
    void this.video.play().catch(() => {});
  }

  pauseVideo() {
    this.video.pause();
  }

  seekTo(seconds: number) {
    this.video.currentTime = seconds;
  }

  setVolume(volume: number) {
    this.video.volume = Math.min(1, Math.max(0, volume / 100));
  }

  setPlaybackRate(rate: number) {
    this.video.defaultPlaybackRate = rate; // keeps the speed when the next file loads
    this.video.playbackRate = rate;
  }

  getPlaybackRate() {
    return this.video.playbackRate;
  }

  getAvailablePlaybackRates() {
    return RATES;
  }

  getCurrentTime() {
    return this.video.currentTime || 0;
  }

  getDuration() {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }

  getVideoData() {
    return { title: this.tracks[Number(this.current)]?.title, author: "", video_id: this.current };
  }

  getTrackList() {
    return this.tracks.map(({ id, title }) => ({ id, title }));
  }

  getArtworkUrl() {
    return this.coverUrl;
  }

  // YouTube playlist calls: offline tapes are sequenced by the deck instead.
  cuePlaylist() {}
  loadPlaylist() {}
  nextVideo() {}
  previousVideo() {}
  getPlaylist() {
    return null;
  }
  getPlaylistIndex() {
    return -1;
  }

  destroy() {
    this.loadToken++;
    this.cleanup.forEach((undo) => undo());
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    if (this.coverUrl) URL.revokeObjectURL(this.coverUrl);
  }
}
