// Moving and resizing the window. Browsers only allow this for app windows, such
// as the one the Tape Deck desktop icon opens; in a normal tab these calls do nothing.

export type WindowBounds = { x: number; y: number; width: number; height: number };

/** Size of the page inside the mini window, in CSS pixels. */
export const MINI_CONTENT = { width: 380, height: 272 };
const CORNER_MARGIN = 12;
const FULL_SIZE = { width: 1120, height: 1000 }; // matches the launcher's --window-size

type ScreenWithOffset = Screen & { availLeft?: number; availTop?: number };

export function currentBounds(): WindowBounds {
  return { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight };
}

const SETTLE_MS = 200;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Moves and resizes the window, landing on the exact size.
 *
 * With display scaling, Chrome lands every resize a fixed couple of pixels off,
 * and every move grows the window by a pixel; left alone, the window creeps
 * bigger on each mini/full round trip. So: resize, then move (the browser won't
 * move a window to where it doesn't fit), resize again to measure the offset,
 * and finally resize aimed off by that offset. Nothing moves after the last
 * resize, which keeps the top-left corner where it is. `target` is re-evaluated
 * so the corner position can use the mini window's real frame size.
 */
export async function applyBounds(target: () => WindowBounds) {
  const first = target();
  window.resizeTo(first.width, first.height);
  window.moveTo(first.x, first.y);
  await wait(SETTLE_MS);

  const goal = target();
  window.resizeTo(goal.width, goal.height);
  await wait(SETTLE_MS);

  const offsetW = window.outerWidth - goal.width;
  const offsetH = window.outerHeight - goal.height;
  if (offsetW || offsetH) window.resizeTo(goal.width - offsetW, goal.height - offsetH);
}

/** The mini window, tucked into the bottom-right corner just above the taskbar. */
export function cornerBounds(): WindowBounds {
  const screen = window.screen as ScreenWithOffset;
  // Add the title bar and borders so the page itself gets MINI_CONTENT.
  const width = MINI_CONTENT.width + (window.outerWidth - window.innerWidth);
  const height = MINI_CONTENT.height + (window.outerHeight - window.innerHeight);
  return {
    width,
    height,
    x: (screen.availLeft ?? 0) + screen.availWidth - width - CORNER_MARGIN,
    y: (screen.availTop ?? 0) + screen.availHeight - height - CORNER_MARGIN,
  };
}

/** The normal deck window, centred on the screen. */
export function fullBounds(): WindowBounds {
  const screen = window.screen as ScreenWithOffset;
  const width = Math.min(FULL_SIZE.width, screen.availWidth);
  const height = Math.min(FULL_SIZE.height, screen.availHeight);
  return {
    width,
    height,
    x: (screen.availLeft ?? 0) + Math.round((screen.availWidth - width) / 2),
    y: (screen.availTop ?? 0) + Math.round((screen.availHeight - height) / 2),
  };
}

/**
 * The window opened mini-sized or partly off-screen. That happens after a reload
 * in mini mode, or because the browser reopens app windows where they were last
 * closed, which may have been the mini player's corner.
 */
export function needsRecentring(): boolean {
  const screen = window.screen as ScreenWithOffset;
  const left = screen.availLeft ?? 0;
  const top = screen.availTop ?? 0;
  const slack = 20; // maximized windows overhang the screen edge slightly
  const offScreen =
    window.screenX < left - slack ||
    window.screenY < top - slack ||
    window.screenX + window.outerWidth > left + screen.availWidth + slack ||
    window.screenY + window.outerHeight > top + screen.availHeight + slack;
  const miniSized = window.outerWidth < 560 && window.outerHeight < 480;
  return offScreen || miniSized;
}
