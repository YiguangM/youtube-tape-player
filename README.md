<p align="center">
  <img src="public/icons/icon-192.png" width="96" alt="Tape Deck icon">
</p>

<h1 align="center">Tape Deck</h1>

<p align="center">A YouTube player dressed up as a retro cassette deck. Paste a YouTube link to record a tape, pop it in, and press play.</p>

![The Tape Deck playing Big Buck Bunny, with tapes in the rack](docs/screenshots/deck.png)

## Features

**Playing**

- **Videos and playlists:** a playlist link records a *mixtape* that plays the whole playlist. Step through songs with the TRK buttons or Shift+N / Shift+P.
- **Resume where you stopped:** every tape remembers its position (and, on a mixtape, its track), saved every few seconds and whenever you pause, stop, eject, switch tapes or close the app. A tape left within 10 seconds of its end starts over.
- **AUTO-REVERSE switch:** OFF, ONE (repeat the track) or ALL (repeat the tape or mixtape).
- **SHUFFLE:** plays a mixtape's tracks in a random order without repeating any until all have played; PREV goes back through what actually played.
- **Speed:** 0.5x, 1x, 1.5x or 2x, remembered between visits.
- **Volume knob:** hover over it and scroll the mouse wheel, drag it up or down, or use the arrow keys when it's focused.
- **REW / FF:** hold to wind (it speeds up the longer you hold), tap to skip 10 seconds. Unplayable videos on a mixtape are skipped with a short notice.

**Retro touches**

- **Tape counter:** a mechanical 000–999 counter that follows the tape (faster at higher speeds, backwards when rewinding), with RESET.
- **A–B repeat:** press A-B once to mark A, again to mark B (playback loops between them), and a third time to clear.
- **Sleep timer:** a rotary dial for 15, 30 or 60 minutes. When it runs out the music fades out over about 5 seconds and stops. Hover over the dial or focus it to see the time left.
- **Labels and shells:** write your own label (handwritten or typed lettering) and pick a shell colour, including clear plastic, with a live preview.
- **Sound effects:** optional mechanical clicks, tape door sounds and a winding whir, synthesized in the browser. Off until you switch SOUND FX on.

**Your rack**

- **Custom mixtapes:** "+ New mixtape", then add single-video tapes with their **+** button. The ✎ button renames a mixtape and reorders or removes tracks. Custom mixtapes play exactly like playlist mixtapes.
- **Share a mixtape:** the share button makes a link with the mixtape's name and video IDs. Opening it shows a card asking whether to add it; nothing is added without your OK.
- **Search and sort:** once the rack holds more than 8 tapes, filter by title and sort by recently added, recently played, or title.
- **Export and import:** save the whole rack (tapes, mixtapes, labels, shells and resume positions) as a JSON file, then load it back with **Merge** (skip duplicates) or **Replace** (asks first).
- **Cover art:** save a video's thumbnail as `Title - Channel.jpg` from the rack or with the deck's COVER button.

**Mini player**

- **MINI PLAYER** shrinks Tape Deck into a compact player with the video, Prev / Play-Stop / Next, speed and volume. See [which mini player you get](#mini-player-modes).
- **FLOATING** opens the compact controls in a small window that stays on top of your other windows (Chrome and Edge).

## Screenshots

| Mixtape (dark theme) | Mini player |
| --- | --- |
| ![A playlist recorded as a mixtape, on track 4 of 18](docs/screenshots/mixtape.png) | ![The mini player: cassette, track title, speed, Prev / Stop / Next and the volume knob](docs/screenshots/mini-player.png) |

![Close-up of the deck controls](docs/screenshots/controls.png)

## Keyboard shortcuts

| Keys | What they do |
| --- | --- |
| Space or K | Play / pause |
| ← / → | Skip back / forward 10 seconds |
| Home | Rewind to the start of the tape (or of the current mixtape track) |
| Shift+N / Shift+P | Next / previous mixtape track |
| Shift+&gt; / Shift+&lt; | Faster / slower |
| Esc | Leave the mini player, or close the floating window |
| Arrow keys on a focused knob, dial or switch | Turn the volume knob or sleep dial, move the AUTO-REVERSE switch (Page Up / Page Down / Home / End work on the knob and dial) |

Shortcuts are ignored while you type in a field or while a button has focus. The REW key also gets you back to the start: hold it to wind.

## Mini player modes

| Where Tape Deck is running | MINI PLAYER does | FLOATING does |
| --- | --- | --- |
| The app window from the desktop icon | Shrinks the window into the bottom-right corner of the screen, video on top and controls below. ⤢ or Esc puts it back. | Opens the always-on-top window |
| A normal Chrome or Edge tab (version 116+) | Opens the always-on-top window, since a tab can't resize itself | Same |
| Other browsers | Shows a message (neither mode is available) | Not shown |

The always-on-top window uses the browser's Document Picture-in-Picture feature and holds only the controls: the YouTube player stays in the main window, because moving it would reload it and stop the music. The corner mini window keeps the video visible because YouTube's embed rules don't allow playing a hidden player.

## Get started

You need [Node.js](https://nodejs.org) and Chrome or Edge.

```bash
git clone https://github.com/YiguangM/youtube-tape-player.git
cd youtube-tape-player
npm install
```

### Open it with one click (Windows)

Run this once to add a **Tape Deck** icon to your Desktop and Start menu:

```powershell
powershell -ExecutionPolicy Bypass -File launcher\install-shortcut.ps1
```

Clicking the icon starts the app and opens it in its own window. Closing the window stops it again. The first launch, and the first launch after any code change, takes a little longer while the app is prepared.

If you move the project folder, run the command again to update the shortcuts. To pin Tape Deck to the taskbar, right-click it in the Start menu and choose **Pin to taskbar**.

### Install it from the browser

The app includes a web app manifest. In Chrome or Edge, use the install button in the address bar (or **⋮ → Cast, save and share → Install page as app**) to add it with its own icon. Once the app is deployed to a public URL, anyone can install it this way.

## Your data

Everything stays in your browser's local storage; there are no accounts and no server-side storage. The rack uses a versioned schema (version 2, key `tapedeck:rack`). Racks saved by earlier versions of Tape Deck are migrated automatically, and if saved data can't be read it's kept in `tapedeck:rack-unreadable` instead of being overwritten. Settings (volume, speed, repeat, shuffle, sorting, sound effects) are stored separately. Use **Export** to keep a copy or move your rack to another browser.

## Develop

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

| Command         | What it does                         |
| --------------- | ------------------------------------ |
| `npm run dev`   | Development server with live reload  |
| `npm run build` | Production build                     |
| `npm start`     | Serve the production build           |
| `npm run lint`  | Lint the code                        |

### Where things live

- `src/components/TapeDeck.tsx`: the deck, its controls and the YouTube player
- `src/components/TapeRack.tsx`: the rack: recording, search and sort, mixtapes, sharing, export and import
- `src/components/Cassette.tsx`: the cassette drawing and spinning reels
- `src/components/MiniPlayer.tsx`, `src/lib/appWindow.ts`, `src/lib/pip.ts`: the mini player, window resizing and the floating window
- `src/components/VolumeKnob.tsx`, `SleepDial.tsx`, `TapeCounter.tsx`, `controls.tsx`: deck controls
- `src/components/MixtapeDialogs.tsx`, `TapeLookDialog.tsx`, `RackImportDialog.tsx`, `Dialog.tsx`: dialogs
- `src/lib/rackStore.ts`: the versioned rack schema, migration and rack updates
- `src/lib/sequencer.ts`: mixtape track order (shuffle, repeat, play history)
- `src/lib/settings.ts`, `stored.ts`: remembered settings and safe localStorage access
- `src/lib/mediaSession.ts`, `sleepTimer.ts`, `sfx.ts`, `shells.ts`, `rackFile.ts`, `shareLink.ts`: one feature each
- `src/app/api/tape/route.ts`: looks up a video's or playlist's title and checks it can be embedded
- `src/app/api/cover/route.ts`: serves a video's thumbnail as a named download
- `src/app/manifest.ts`, `src/app/icon.svg`, `public/icons/`: app name and icons
- `launcher/`: the Windows launcher and shortcut installer

## Known limitations

- **Media keys and the Windows media flyout:** Tape Deck publishes what's playing and handles the media keys through the Media Session API, but in Chrome and Edge the YouTube player (which runs in its own iframe) registers a media session too, and the browser sends the system media controls to YouTube's. In practice: **Play/Pause works** (YouTube pauses and the deck follows), but **Next/Previous from the keyboard or the flyout don't change tracks or tapes**, and the flyout shows YouTube's title and artwork. Tested with Chrome and Edge on Windows. The deck's handlers stay in place for browsers that route media keys to the page.
- **The always-on-top window is controls only.** The video plays in the main Tape Deck window, which has to stay open (it can be behind other windows).
- **Share links point to where Tape Deck is running.** From the desktop icon that's `localhost`, so the links only work on your own computer until the app is deployed to a public address.
- **YouTube limits:** Mixes (auto-generated playlists) can't be played outside YouTube; very long playlists may be cut short, since a mixtape uses the video list YouTube's embedded player provides; videos whose owners don't allow embedding are skipped.
- **The sleep timer** isn't remembered if you reload the page.

## Credits

The screenshots show footage from *Big Buck Bunny* (Blender Foundation) and *Wing It!* ([Blender Studio](https://studio.blender.org)), both released under Creative Commons Attribution (CC BY) licenses. Videos play through YouTube's embedded player.
