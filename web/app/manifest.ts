import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scarlet Thread",
    short_name: "Scarlet Thread",
    description: "Read the Bible front to back, and build the connections yourself.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
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
