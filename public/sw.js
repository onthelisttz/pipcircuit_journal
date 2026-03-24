const CACHE_PREFIX = "pipcircuit";
const CACHE_VERSION = "v31";
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
  "/pj-icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function isNextDataOrRSC(pathname, search) {
  if (pathname.startsWith("/_next/data/")) return true;
  if (search.includes("_rsc=")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Install – precache app shell pages and key assets
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pageCache = await caches.open(PAGE_CACHE);
      // Precache each URL individually so one failure doesn't block the rest
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (response.ok) {
              await pageCache.put(url, response.clone());
            }
          } catch {
            // Ignore – runtime caching will handle later
          }
        })
      );
      // Force the waiting SW to become the active SW
      await self.skipWaiting();
    })()
  );
});

// ---------------------------------------------------------------------------
// Activate – clean old caches and take control of all clients
// ---------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(CACHE_PREFIX) && !key.endsWith(CACHE_VERSION)
          )
          .map((key) => caches.delete(key))
      );
      // Take control of all open tabs immediately
      await self.clients.claim();
    })()
  );
});

// ---------------------------------------------------------------------------
// Fetch – strategy depends on resource type
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API calls
  if (url.pathname.startsWith("/api/")) return;

  // ----- Navigation requests (HTML pages) -----
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  // ----- Next.js static assets (/_next/static/) – cache-first (immutable) -----
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleImmutableStatic(request));
    return;
  }

  // ----- Next.js data/RSC requests -----
  if (isNextDataOrRSC(url.pathname, url.search)) {
    event.respondWith(handleNetworkFirst(request, RUNTIME_CACHE));
    return;
  }

  // ----- Other static assets (images, fonts, etc.) – stale-while-revalidate -----
  if (isStaticAsset(url.pathname)) {
    event.respondWith(handleStaleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // ----- Everything else – network first with cache fallback -----
  event.respondWith(handleNetworkFirst(request, RUNTIME_CACHE));
});

// ---------------------------------------------------------------------------
// Strategy: Navigation – network first, then cache, then offline page
// ---------------------------------------------------------------------------

async function handleNavigation(request, url) {
  const pageCache = await caches.open(PAGE_CACHE);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      // Cache both by full URL and by pathname for flexible matching
      await pageCache.put(request, networkResponse.clone());
      await pageCache.put(url.pathname, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Offline – try cache in order of specificity
    const cachedExact = await pageCache.match(request);
    if (cachedExact) return cachedExact;

    const cachedPath = await pageCache.match(url.pathname);
    if (cachedPath) return cachedPath;

    // Try any cached app shell page (they all share the same Next.js shell)
    const cachedShell = await matchAny(pageCache, APP_SHELL_ROUTES);
    if (cachedShell) return cachedShell;

    const cachedOffline = await pageCache.match(OFFLINE_URL);
    if (cachedOffline) return cachedOffline;

    return new Response("Offline – please reconnect to the internet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

// ---------------------------------------------------------------------------
// Strategy: Cache-first for immutable assets (content-hashed _next/static)
// ---------------------------------------------------------------------------

async function handleImmutableStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return Response.error();
  }
}

// ---------------------------------------------------------------------------
// Strategy: Stale-while-revalidate for general static assets
// ---------------------------------------------------------------------------

async function handleStaleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached || (await networkFetch) || Response.error();
}

// ---------------------------------------------------------------------------
// Strategy: Network-first with cache fallback
// ---------------------------------------------------------------------------

async function handleNetworkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

// ---------------------------------------------------------------------------
// Message handler – supports skipWaiting from the client
// ---------------------------------------------------------------------------

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
