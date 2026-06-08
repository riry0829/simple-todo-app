// オフラインで動かすための簡易キャッシュ（アプリシェル）
const CACHE = "simple-todo-v2";
const ASSETS = [
  ".",
  "index.html",
  "style.css",
  "app.js",
  "config.js",
  "drive-sync.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

// キャッシュ優先（オフライン対応）。なければネットワークから取得してキャッシュ。
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // 同一オリジンのみキャッシュ対象。Google API / GIS 等の外部通信はそのまま素通し。
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => cached);
    })
  );
});
