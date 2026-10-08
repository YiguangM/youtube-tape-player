import type { NextRequest } from "next/server";
import { isListId, isVideoId } from "@/lib/youtube";

// Looks up a video's or playlist's title and channel through YouTube's public
// oEmbed endpoint. Running it on the server avoids browser CORS limits, and
// doubles as a check that the video or playlist exists and can be embedded
// before it goes in the rack.
//
//   /api/tape?id=<video id>      a single video
//   /api/tape?list=<playlist id> a playlist (recorded as a mixtape)
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const listId = params.get("list");
  const videoId = params.get("id");

  let pageUrl: string;
  let kind: "video" | "playlist";
  if (listId !== null) {
    if (!isListId(listId)) {
      return Response.json({ error: "That isn't a valid YouTube playlist ID." }, { status: 400 });
    }
    pageUrl = `https://www.youtube.com/playlist?list=${listId}`;
    kind = "playlist";
  } else {
    if (!videoId || !isVideoId(videoId)) {
      return Response.json({ error: "That isn't a valid YouTube video ID." }, { status: 400 });
    }
    pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    kind = "video";
  }

  const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`;

  let res: Response;
  try {
    res = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
  } catch {
    return Response.json({ error: "Couldn't reach YouTube. Try again in a moment." }, { status: 502 });
  }

  if (res.status === 401 || res.status === 403) {
    const error =
      kind === "playlist"
        ? "That playlist is private, so it can't play here."
        : "That video is private or its owner doesn't allow it to play outside YouTube.";
    return Response.json({ error }, { status: 422 });
  }
  if (!res.ok) {
    const error =
      kind === "playlist"
        ? "Couldn't find that playlist. It may be private or deleted."
        : "Couldn't find that video. It may have been removed.";
    return Response.json({ error }, { status: 404 });
  }

  const data = (await res.json()) as { title?: string; author_name?: string };
  return Response.json({
    kind,
    id: kind === "playlist" ? listId : videoId,
    title: data.title?.trim() || (kind === "playlist" ? "Untitled mixtape" : "Untitled tape"),
    author: data.author_name?.trim() || "",
  });
}
