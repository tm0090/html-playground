const CACHE_NAME = 'finish-timer-v1';

// Files to cache for offline use
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/main.js',
    '/manifest.json',
    '/icon.svg',
];

// ─── Install: pre-cache local assets ─────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        })
    );
    // Activate immediately without waiting for existing tabs to close
    self.skipWaiting();
});

// ─── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    // Take control of all open clients immediately
    self.clients.claim();
});

// ─── Fetch: cache-first for local assets, network-first for CDN ───────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // CDN resources (Tailwind, Google Fonts) — network first, fall back to cache
    if (url.origin !== self.location.origin) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Cache a fresh copy
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Local assets — cache first, fall back to network
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((response) => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                return response;
            });
        })
    );
});
