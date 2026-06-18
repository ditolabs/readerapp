/* ════════════════════════════════════════
   ReaderApp — sw.js
   Cache-First + Network Fallback strategy
   ════════════════════════════════════════ */

const CACHE_NAME   = 'readerapp-v1';
const CDN_CACHE    = 'readerapp-cdn-v1';

// File app lokal yang wajib di-cache saat install
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

// ── Install: precache semua asset lokal ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: hapus cache lama ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CDN_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Cache-First untuk asset lokal & CDN ──
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET dan chrome-extension
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // IndexedDB / internal API — biarkan lewat
  if (url.pathname.startsWith('/api/')) return;

  const isLocal = url.origin === self.location.origin;
  const isCDN   = url.hostname.includes('cdnjs.cloudflare.com');

  if (isLocal || isCDN) {
    // Cache-First: cek cache dulu, baru network
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;

        return fetch(request)
          .then(response => {
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            // Simpan ke cache yang sesuai
            const cacheName = isLocal ? CACHE_NAME : CDN_CACHE;
            caches.open(cacheName).then(cache => cache.put(request, response.clone()));
            return response;
          })
          .catch(() => {
            // Offline fallback untuk navigasi
            if (request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
      })
    );
  }
  // Resource lain (gambar eksternal dll) — biarkan network biasa
});
