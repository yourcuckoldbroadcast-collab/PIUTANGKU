/* PiutangKu — Service Worker
 * Offline-first. Semua data tersimpan di IndexedDB (tanpa jaringan).
 * Service worker ini meng-cache "app shell" (HTML, CSS, JS, font, ikon)
 * agar aplikasi tetap bisa dibuka tanpa koneksi internet.
 *
 * Strategi:
 * - Kode aplikasi (HTML/CSS/JS/manifest) -> NETWORK-FIRST: selalu ambil versi
 *   terbaru saat online (sehingga update langsung terlihat), fallback ke cache
 *   saat offline. Ini memperbaiki masalah "sudah upload tapi tampilan tidak berubah".
 * - Aset statis (font, ikon, gambar) -> CACHE-FIRST: cepat, jarang berubah.
 */
"use strict";

/* Naikkan versi ini setiap kali ingin memaksa cache lama dibuang. */
var CACHE = "piutangku-v3";

/* Daftar aset inti. URL relatif agar aman di GitHub Pages (subpath repo). */
var ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/db.js",
  "./js/calc.js",
  "./js/charts.js",
  "./js/app.js",
  "./fonts/pjs-400.woff2",
  "./fonts/pjs-500.woff2",
  "./fonts/pjs-600.woff2",
  "./fonts/pjs-700.woff2",
  "./fonts/pjs-800.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.ico",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png"
];

/* Install: simpan app shell ke cache (selalu ambil fresh) lalu langsung aktif. */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(
        ASSETS.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {
            /* abaikan aset yang gagal di-cache */
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* Activate: hapus cache versi lama lalu ambil alih klien. */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE) {
            return caches.delete(key);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* Simpan salinan respons yang valid ke cache. */
function putInCache(req, res) {
  if (res && res.status === 200 && (res.type === "basic" || res.type === "default")) {
    var copy = res.clone();
    caches.open(CACHE).then(function (cache) {
      cache.put(req, copy);
    });
  }
  return res;
}

self.addEventListener("fetch", function (event) {
  var req = event.request;

  /* Hanya tangani GET same-origin. */
  if (req.method !== "GET") {
    return;
  }
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  /* Navigasi (buka halaman) -> network-first, fallback index.html (SPA hash-router). */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (res) {
        return putInCache(req, res);
      }).catch(function () {
        return caches.match("./index.html").then(function (cached) {
          return cached || caches.match("./");
        });
      })
    );
    return;
  }

  /* Kode aplikasi (HTML/CSS/JS/manifest) -> network-first agar update langsung terlihat. */
  var isAppCode = /\.(?:js|css|html|webmanifest)$/i.test(url.pathname);
  if (isAppCode) {
    event.respondWith(
      fetch(req).then(function (res) {
        return putInCache(req, res);
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  /* Aset lain (font, ikon, gambar) -> cache-first. */
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(req).then(function (res) {
        return putInCache(req, res);
      }).catch(function () {
        return cached;
      });
    })
  );
});
