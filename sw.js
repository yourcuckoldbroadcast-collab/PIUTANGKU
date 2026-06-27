/* PiutangKu — Service Worker
 * App shell wajib di-cache secara utuh. Kode aplikasi memakai network-first
 * dengan batas waktu; aset statis memakai cache-first.
 */
"use strict";

const CACHE_PREFIX = "piutangku-";
const CACHE_NAME = `${CACHE_PREFIX}v10`;
const NETWORK_TIMEOUT_MS = 5000;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/db.js",
  "./js/calc.js",
  "./js/charts.js",
  "./js/app.js",
];

const OPTIONAL_ASSETS = [
  "./fonts/pjs-400.woff2",
  "./fonts/pjs-500.woff2",
  "./fonts/pjs-600.woff2",
  "./fonts/pjs-700.woff2",
  "./fonts/pjs-800.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon.svg",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.ico",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
];

function reloadRequest(url) {
  return new Request(url, { cache: "reload" });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Aset inti wajib lengkap. Jika salah satu gagal, worker lama tetap dipakai.
    await cache.addAll(CORE_ASSETS.map(reloadRequest));
    // Ikon/font bersifat tambahan; kegagalannya tidak merusak app shell inti.
    await Promise.allSettled(OPTIONAL_ASSETS.map((url) => cache.add(reloadRequest(url))));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function fetchWithTimeout(request, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function cacheable(response) {
  return response && response.ok && (response.type === "basic" || response.type === "default");
}

async function cacheResponse(request, response) {
  if (!cacheable(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function networkFirst(request, fallbackRequest, event) {
  try {
    const response = await fetchWithTimeout(request);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    event.waitUntil(cacheResponse(request, response));
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackRequest) {
      const fallback = await caches.match(fallbackRequest);
      if (fallback) return fallback;
    }
    return new Response("PiutangKu belum tersedia offline. Sambungkan internet lalu buka ulang aplikasi.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request, event) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (!response.ok) return response;
    event.waitUntil(cacheResponse(request, response));
    return response;
  } catch (_) {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html", event));
    return;
  }

  const isAppCode = /\.(?:js|css|html|webmanifest)$/i.test(url.pathname);
  if (isAppCode) {
    event.respondWith(networkFirst(request, null, event));
    return;
  }

  event.respondWith(cacheFirst(request, event));
});
