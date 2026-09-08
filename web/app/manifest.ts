import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scarlet Thread",
    short_name: "Scarlet Thread",
    description: "Read the Bible front to back, and build the connections yourself.",
    start_url: "/",
    display: "standalone",
    // A-037: was hardcoded "portrait", which locks an installed PWA out of
    // landscape entirely -- including on tablets, where the wide
    // parallel-reader (MirrorSplitView) and the mountain layout are
    // genuinely usable in landscape. "any" lets the OS/window manager
    // decide instead of the manifest forcing a single orientation.
    orientation: "any",
    background_color: "#0d1420",
    theme_color: "#0d1420",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
