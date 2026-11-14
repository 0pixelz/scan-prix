import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scan Prix",
    short_name: "Scan Prix",
    description: "Photographier des cartes de prix en magasin et exporter en Excel",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#0f172a",
    lang: "fr-CA",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
