import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Orbs — Play. Win. Grow.",
    short_name: "Orbs",
    description: "Live skill games powered by Solana rewards.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#050817",
    theme_color: "#050817",
    orientation: "any",
    icons: [
      { src: "/orbs-logo-128.png", sizes: "128x128", type: "image/png" },
      { src: "/orbs-logo-256.png", sizes: "256x256", type: "image/png" },
      { src: "/orbs-logo-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
