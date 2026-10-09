import type { NextRequest } from "next/server";
import { isVideoId } from "@/lib/youtube";

// Downloads a video's thumbnail ("cover art") with a readable file name:
//   /api/cover?id=<video id>&title=<title>&author=<channel>
// Saves as "Title - Channel.jpg". Only the thumbnail image is fetched, from
// YouTube's public image host; nothing is downloaded from the video itself.

// Largest first; YouTube answers 404 for sizes a video doesn't have.
const SIZES = ["maxresdefault", "sddefault", "hqdefault", "mqdefault"];
const MAX_NAME_LENGTH = 150;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Makes a name safe as a file name on Windows, macOS and Linux. */
function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ") // control and reserved characters
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "") // Windows drops trailing dots and spaces
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return WINDOWS_RESERVED.test(cleaned) ? `${cleaned}_` : cleaned;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  if (!isVideoId(id)) {
    return Response.json({ error: "That isn't a valid YouTube video ID." }, { status: 400 });
  }

  let image: Response | null = null;
  for (const size of SIZES) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        image = res;
        break;
      }
    } catch {
      // Try the next size.
    }
  }
  if (!image) {
    return Response.json({ error: "Couldn't get the cover art for this video." }, { status: 404 });
  }

  const title = (params.get("title") ?? "").slice(0, 300);
  const author = (params.get("author") ?? "").slice(0, 300);
  const name = safeFileName(author && !title.includes(author) ? `${title} - ${author}` : title) || id;
  // ASCII-only fallback for old clients, plus the full UTF-8 name (RFC 6266).
  const asciiName = name.replace(/[^\x20-\x7e]/g, "_");

  return new Response(image.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="${asciiName}.jpg"; filename*=UTF-8''${encodeURIComponent(`${name}.jpg`)}`,
      "Cache-Control": "no-store",
    },
  });
}
