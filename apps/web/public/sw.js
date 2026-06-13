/* Hand-written service worker for cache-first offline support. Plain JS, no build step. */
const VERSION = "sd-v1";
const SHELL = "sd-shell-" + VERSION;
const RUNTIME = "sd-runtime-" + VERSION;

// Stable key under which we store the SPA navigation shell.
const SHELL_KEY = "/index.html";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Optionally pre-open caches so they exist immediately.
  event.waitUntil(
    (async () => {
      try {
        await caches.open(SHELL);
        await caches.open(RUNTIME);
      } catch (_err) {
        /* non-fatal */
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith("sd-") && k !== SHELL && k !== RUNTIME)
            .map((k) => caches.delete(k)),
        );
      } catch (_err) {
        /* non-fatal */
      }
    })(),
  );
});

function isStaticAsset(request, url) {
  const dest = request.destination;
  if (dest === "script" || dest === "style" || dest === "font" || dest === "image") {
    return true;
  }
  return url.pathname.startsWith("/assets/");
}

// Network-first for navigations; fall back to cached shell when offline.
async function handleNavigation(request) {
  const cache = await caches.open(SHELL);
  try {
    const resp = await fetch(request);
    // Store the latest shell under a stable key so any route falls back to it.
    try {
      await cache.put(SHELL_KEY, resp.clone());
    } catch (_err) {
      /* ignore opaque/uncacheable */
    }
    return resp;
  } catch (_err) {
    const cached = (await cache.match(SHELL_KEY)) || (await cache.match(request));
    if (cached) return cached;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

// Stale-while-revalidate for same-origin static assets.
async function handleStatic(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((resp) => {
      try {
        if (resp && resp.ok) cache.put(request, resp.clone());
      } catch (_err) {
        /* ignore */
      }
      return resp;
    })
    .catch(() => undefined);

  if (cached) {
    // Update in the background; serve cache immediately.
    void fetchPromise;
    return cached;
  }
  const resp = await fetchPromise;
  if (resp) return resp;
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

// Network-first for cross-origin API GETs; fall back to runtime cache offline.
async function handleApi(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const resp = await fetch(request);
    try {
      if (resp && resp.ok) await cache.put(request, resp.clone());
    } catch (_err) {
      /* ignore */
    }
    return resp;
  } catch (_err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET; let everything else hit the network normally.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (_err) {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  if (request.mode === "navigate" && sameOrigin) {
    event.respondWith(handleNavigation(request).catch(() => fetch(request)));
    return;
  }

  if (sameOrigin && isStaticAsset(request, url)) {
    event.respondWith(handleStatic(request).catch(() => fetch(request)));
    return;
  }

  if (!sameOrigin) {
    // Cross-origin API GETs.
    event.respondWith(handleApi(request).catch(() => fetch(request)));
    return;
  }

  // Other same-origin GETs: pass through.
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "purge") {
    event.waitUntil(
      (async () => {
        try {
          const keys = await caches.keys();
          await Promise.all(
            keys.filter((k) => k.startsWith("sd-")).map((k) => caches.delete(k)),
          );
        } catch (_err) {
          /* non-fatal */
        }
      })(),
    );
  }
});
