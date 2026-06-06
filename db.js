/* ============================================================
   db.js — Lapisan penyimpanan IndexedDB
   Semua data PiutangKu disimpan lokal di perangkat (offline-first).
   Tiga "tabel": debtors (peminjam), loans (pinjaman), payments (pembayaran).
   ============================================================ */

const DB = (() => {
  const NAME = "piutangku";
  const VERSION = 1;
  const STORES = ["debtors", "loans", "payments"];
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("debtors")) {
          db.createObjectStore("debtors", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("loans")) {
          const s = db.createObjectStore("loans", { keyPath: "id" });
          s.createIndex("debtorId", "debtorId", { unique: false });
        }
        if (!db.objectStoreNames.contains("payments")) {
          const s = db.createObjectStore("payments", { keyPath: "id" });
          s.createIndex("loanId", "loanId", { unique: false });
          s.createIndex("debtorId", "debtorId", { unique: false });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }
  const wrap = (request) =>
    new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });

  // ---- CRUD generik ----
  async function getAll(store) { return wrap((await tx(store, "readonly")).getAll()); }
  async function get(store, id) { return wrap((await tx(store, "readonly")).get(id)); }
  async function put(store, obj) { await wrap((await tx(store, "readwrite")).put(obj)); return obj; }
  async function del(store, id) { return wrap((await tx(store, "readwrite")).delete(id)); }

  async function byIndex(store, index, value) {
    const os = await tx(store, "readonly");
    return wrap(os.index(index).getAll(value));
  }

  async function clearStore(store) { return wrap((await tx(store, "readwrite")).clear()); }
  async function clearAll() { for (const s of STORES) await clearStore(s); }

  // ---- Operasi level domain ----
  async function snapshot() {
    const [debtors, loans, payments] = await Promise.all([
      getAll("debtors"), getAll("loans"), getAll("payments"),
    ]);
    return { debtors, loans, payments };
  }

  // Hapus peminjam beserta seluruh pinjaman & pembayarannya
  async function deleteDebtorCascade(debtorId) {
    const loans = await byIndex("loans", "debtorId", debtorId);
    const pays = await byIndex("payments", "debtorId", debtorId);
    for (const p of pays) await del("payments", p.id);
    for (const l of loans) await del("loans", l.id);
    await del("debtors", debtorId);
  }

  // Hapus satu pinjaman beserta pembayarannya
  async function deleteLoanCascade(loanId) {
    const pays = await byIndex("payments", "loanId", loanId);
    for (const p of pays) await del("payments", p.id);
    await del("loans", loanId);
  }

  // Ganti seluruh data (dipakai saat Import)
  async function replaceAll({ debtors = [], loans = [], payments = [] }) {
    await clearAll();
    for (const d of debtors) await put("debtors", d);
    for (const l of loans) await put("loans", l);
    for (const p of payments) await put("payments", p);
  }

  return {
    open, snapshot,
    getAll, get, put, del, byIndex,
    clearAll, replaceAll,
    deleteDebtorCascade, deleteLoanCascade,
  };
})();
