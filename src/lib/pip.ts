import { useSyncExternalStore } from "react";

// Document Picture-in-Picture: an always-on-top window the page can render its
// own UI into. Supported in Chrome and Edge 116+.
// https://developer.mozilla.org/docs/Web/API/Document_Picture-in-Picture_API
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

const noSubscription = () => () => {};

/** True when this browser can open a floating, always-on-top player window. */
export function useFloatingWindowSupported(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => "documentPictureInPicture" in window,
    () => false,
  );
}

/**
 * Opens an always-on-top window and copies this page's styles and fonts into it,
 * so React can render into its body with a portal.
 */
export async function openFloatingWindow(width: number, height: number): Promise<Window | null> {
  const api = window.documentPictureInPicture;
  if (!api) return null;

  const floating = await api.requestWindow({ width, height });
  const doc = floating.document;

  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      doc.head.append(link);
      continue;
    }
    try {
      const style = doc.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      doc.head.append(style);
    } catch {
      // Stylesheets we aren't allowed to read are skipped.
    }
  }

  // Font CSS variables from next/font live on <html>.
  doc.documentElement.className = document.documentElement.className;
  doc.title = document.title;
  return floating;
}
