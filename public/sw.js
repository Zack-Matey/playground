// Playground service worker: keeps engines and pages so the site is installable and languages you've used work offline.
// - Engines (/engines/<id>-<version>/…) and build assets (/_next/static/…): cache first. Their URLs change whenever
//   their content does, so a cached copy is always right. Old engine versions are pruned on activate.
// - Pages: network first, falling back to the last cached copy.
const VERSION = "v1";
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const ENGINES = "engines";
const IMMUTABLE = /^\/_next\/static\/|^\/icons\/|^\/fonts\//;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== ASSETS && k !== ENGINES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const cacheable = (res) => res && res.ok && res.status === 200 && res.type === "basic";

async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) {
    if (cacheName === ENGINES) await pruneOtherVersions(cache, new URL(req.url).pathname);
    cache.put(req, res.clone());
  }
  return res;
}

// A new engine version (e.g. /engines/go-go1.28.0/) replaces the old one's files instead of piling up beside them.
async function pruneOtherVersions(cache, path) {
  const m = /^\/engines\/([a-z]+)-([^/]+)\//.exec(path);
  if (!m) return;
  for (const req of await cache.keys()) {
    const o = /^\/engines\/([a-z]+)-([^/]+)\//.exec(new URL(req.url).pathname);
    if (o && o[1] === m[1] && o[2] !== m[2]) await cache.delete(req);
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/engines/")) return e.respondWith(cacheFirst(ENGINES, req));
  if (IMMUTABLE.test(url.pathname)) return e.respondWith(cacheFirst(ASSETS, req));
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (cacheable(res)) {
          const copy = res.clone();
          caches.open(PAGES).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req, { cacheName: PAGES, ignoreVary: true })) ?? Response.error()),
  );
});
