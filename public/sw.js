const CACHE_PREFIX = "pipcircuit";
const CACHE_VERSION = "v3";
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const PAGE_CACHE = `${CACHE_PREFIX}-pages-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";
const APP_SHELL_ROUTES = [
  "/",
  "/dashboard",
  "/observations",
  "/tags",
  "/settings",
  "/chart",
  "/accounts",
  "/login",
  "/callback",
  "/ctrader-callback",
];

const PRECACHE_URLS = [
  ...APP_SHELL_ROUTES,
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon.svg",
  "/pj-icon.svg",
];

async function matchAny(cache, urls) {
  for (const url of urls) {
    const match = await cache.match(url);
    if (match) return match;
  }
  return null;
}

function isStaticAsset(pathname) {
  if (pathname.startsWith("/_next/static/")) return true;
  return /\.(?:js|css|png|jpg|jpeg|webp|svg|gif|ico|woff2?)$/i.test(pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pageCache = await caches.open(PAGE_CACHE);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (response.ok) {
              await pageCache.put(url, response.clone());
            }
          } catch {
            // Ignore failures during install; runtime caching will handle later.
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !key.endsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const pageCache = await caches.open(PAGE_CACHE);
        const runtimeCache = await caches.open(RUNTIME_CACHE);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            await pageCache.put(request, networkResponse.clone());
            await runtimeCache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cachedExact = await pageCache.match(request);
          if (cachedExact) return cachedExact;

          const cachedPath = await pageCache.match(url.pathname);
          if (cachedPath) return cachedPath;

          const runtimeExact = await runtimeCache.match(request);
          if (runtimeExact) return runtimeExact;

          const runtimePath = await runtimeCache.match(url.pathname);
          if (runtimePath) return runtimePath;

          const cachedShell = await matchAny(pageCache, APP_SHELL_ROUTES);
          if (cachedShell) return cachedShell;

          const runtimeShell = await matchAny(runtimeCache, APP_SHELL_ROUTES);
          if (runtimeShell) return runtimeShell;

          const cachedOffline = await pageCache.match(OFFLINE_URL);
          if (cachedOffline) return cachedOffline;

          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const staticCache = await caches.open(STATIC_CACHE);
        const cached = await staticCache.match(request);
        const networkFetch = fetch(request)
          .then(async (response) => {
            if (response && response.ok) {
              await staticCache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => undefined);

        return cached || (await networkFetch) || Response.error();
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const runtimeCache = await caches.open(RUNTIME_CACHE);
      const cached = await runtimeCache.match(request);
      if (cached) return cached;

      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          await runtimeCache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cachedOffline = await caches.match(OFFLINE_URL);
        return (
          cachedOffline ||
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }
    })()
  );
});
