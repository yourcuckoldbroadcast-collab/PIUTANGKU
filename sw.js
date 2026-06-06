/* PiutangKu — Service Worker
 * Offline-first. Semua data tersimpan di IndexedDB (tanpa jaringan).
 * Service worker ini hanya meng-cache "app shell" (HTML, CSS, JS, font, ikon)
 * agar aplikasi tetap bisa dibuka tanpa koneksi internet.
 */
"use strict";

var CACHE = "piutangku-v2";

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

/* Install: simpan app shell ke cache lalu langsung aktif. */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* Tambahkan satu per satu agar satu aset gagal tidak menggagalkan semua. */
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

/* Fetch:
 * - Permintaan navigasi (buka halaman) -> fallback ke index.html saat offline (mendukung SPA hash-router).
 * - Aset lain -> cache-first, lalu jaringan (sekaligus mengisi cache runtime).
 */
self.addEventListener("fetch", function (event) {
  var req = event.request;

  /* Hanya tangani GET. Biarkan metode lain lewat apa adanya. */
  if (req.method !== "GET") {
    return;
  }

  var url = new URL(req.url);

  /* Hanya tangani permintaan same-origin. */
  if (url.origin !== self.location.origin) {
    return;
  }

  /* Permintaan navigasi: utamakan jaringan, fallback ke index.html dari cache. */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match("./index.html").then(function (cached) {
          return cached || caches.match("./");
        });
      })
    );
    return;
  }

  /* Aset statis: cache-first. */
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(req).then(function (res) {
        /* Simpan salinan ke cache bila respons valid & dapat disimpan. */
        if (res && res.status === 200 && (res.type === "basic" || res.type === "default")) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      }).catch(function () {
        /* Tidak ada di cache & jaringan gagal: tidak ada yang bisa diberikan. */
        return cached;
      });
    })
  );
});
