import type { MetadataRoute } from "next";

// The web app manifest (served at /manifest.webmanifest), so Normal Finance can be added to a phone's
// home screen and opens like an app, without the browser's address bar. It opens on My claims; a
// signed-out visit goes to /login as usual. Icons are in public/icons (from public/logo.svg); the
// maskable one keeps the logo inside the safe zone Android crops to.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Normal Finance",
    short_name: "Normal Finance",
    description: "Claims, budgets and reimbursements for Normal.",
    start_url: "/claims",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f5f1",
    theme_color: "#f7f5f1",
    lang: "en-SG",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
