const CACHE_NAME = "app-shell-v1";
const RUNTIME_CACHE = "runtime-v1";
const APP_SHELL_URLS = ["/", "/favicon.png", "/opengraph.jpg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![CACHE_NAME, RUNTIME_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, response.clone());
          return response;
        } catch (error) {
          const cache = await caches.open(RUNTIME_CACHE);
          const cached = await cache.match(request);
          if (cached) return cached;

          const fallback = await caches.match("/");
          if (fallback) return fallback;

          throw error;
        }
      })()
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/images/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw error;
      }
    })()
  );
});
