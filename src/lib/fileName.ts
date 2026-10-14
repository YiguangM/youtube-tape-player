// Readable, safe names for the files Tape Deck saves (cover art and audio).

const MAX_NAME_LENGTH = 150;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Makes a name safe as a file name on Windows, macOS and Linux. */
export function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ") // control and reserved characters
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "") // Windows drops trailing dots and spaces
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return WINDOWS_RESERVED.test(cleaned) ? `${cleaned}_` : cleaned;
}

/** "Title - Channel", or just the title when it already names the channel. */
export function titleWithChannel(title: string, author: string): string {
  return author && !title.includes(author) ? `${title} - ${author}` : title;
}

/** A Content-Disposition header that saves as `name`: ASCII fallback plus the full UTF-8 name (RFC 6266). */
export function attachment(name: string): string {
  const asciiName = name.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
