// Makes the app installable and keeps it usable when the network drops.
//
// Strategy: always try the network first, fall back to the cache only when the
// network fails. That order matters during development - a cache-first worker
// would keep serving your old code after you push changes, which is maddening
// to debug.

const CACHE = "rehearse-v1";

const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/i18n.js",
  "/config.js",
  "/icon-192.png",
  "/icon-512.png",
];

// Store the shell the first time the app runs.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Delete caches left over from older versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never cache the AI endpoint or anything going to Supabase - those need to be live.
  if (request.method !== "GET" || request.url.includes("/api/") || request.url.includes("supabase")) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Keep a fresh copy for the next time the network is unavailable.
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("/index.html")))
  );
});
