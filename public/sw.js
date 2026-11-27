// Service worker de Scan Prix : permet d'ouvrir l'app sans réseau (les photos sont alors mises en attente).
const CACHE = "scanprix-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Page : réseau d'abord (toujours la dernière version), copie gardée pour le hors-ligne.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((rep) => {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put("/", copie));
          return rep;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error())),
    );
    return;
  }

  // Fichiers de l'app (noms uniques par version), logos et icônes : cache d'abord.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/bannieres/") || /\.(png|webp|ico|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((rep) => {
            if (rep.ok) {
              const copie = rep.clone();
              caches.open(CACHE).then((c) => c.put(req, copie));
            }
            return rep;
          }),
      ),
    );
  }
});
