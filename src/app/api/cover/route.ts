import type { NextRequest } from "next/server";
import { attachment, safeFileName, titleWithChannel } from "@/lib/fileName";
import { isVideoId } from "@/lib/youtube";

// Downloads a video's thumbnail ("cover art") with a readable file name:
//   /api/cover?id=<video id>&title=<title>&author=<channel>
// Saves as "Title - Channel.jpg". Only the thumbnail image is fetched, from
// YouTube's public image host; nothing is downloaded from the video itself.

// Largest first; YouTube answers 404 for sizes a video doesn't have.
const SIZES = ["maxresdefault", "sddefault", "hqdefault", "mqdefault"];

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
  const name = safeFileName(titleWithChannel(title, author)) || id;

  return new Response(image.body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": attachment(`${name}.jpg`),
      "Cache-Control": "no-store",
    },
  });
}
