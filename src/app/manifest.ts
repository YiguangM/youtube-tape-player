import type { MetadataRoute } from "next";

// Lets browsers install Tape Deck as an app with its own icon and window.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Tape Deck",
    short_name: "Tape Deck",
    description: "Play YouTube videos on a retro cassette deck.",
    start_url: "/",
    display: "standalone",
    background_color: "#131110",
    theme_color: "#131110",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
