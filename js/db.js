/* ============================================================
   db.js — Lapisan penyimpanan IndexedDB
   Semua operasi multi-record penting dijalankan dalam satu
   transaksi agar data tidak tersimpan setengah bila terjadi gagal tulis.
   ============================================================ */

const DB = (() => {
  "use strict";

  const NAME = "piutangku";
  const VERSION = 1;
  const STORES = ["debtors", "loans", "payments"];
  let _db = null;
  let _opening = null;

  function makeError(message, code, cause) {
    const err = new Error(message);
    err.code = code;
    if (cause) err.cause = cause;
    return err;
  }

  function open() {
    if (_db) return Promise.resolve(_db);
    if (_opening) return _opening;

    _opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      let settled = false;

      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("debtors")) {
          db.createObjectStore("debtors", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("loans")) {
          const store = db.createObjectStore("loans", { keyPath: "id" });
          store.createIndex("debtorId", "debtorId", { unique: false });
        }
        if (!db.objectStoreNames.contains("payments")) {
          const store = db.createObjectStore("payments", { keyPath: "id" });
          store.createIndex("loanId", "loanId", { unique: false });
          store.createIndex("debtorId", "debtorId", { unique: false });
        }
      };

      req.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(makeError(
          "Pembaruan basis data tertahan oleh tab PiutangKu lain. Tutup tab lain lalu muat ulang.",
          "DB_BLOCKED"
        ));
      };

      req.onerror = () => {
        if (settled) return;
        settled = true;
        reject(makeError("Basis data tidak dapat dibuka.", "DB_OPEN_FAILED", req.error));
      };

      req.onsuccess = () => {
        if (settled) {
          req.result.close();
          return;
        }
        settled = true;
        _db = req.result;
        _db.onversionchange = () => {
          _db.close();
          _db = null;
          window.dispatchEvent(new CustomEvent("piutangku:db-versionchange"));
        };
        resolve(_db);
      };
    }).finally(() => {
      _opening = null;
    });

    return _opening;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || makeError("Operasi basis data gagal.", "DB_REQUEST_FAILED"));
    });
  }

  async function transact(storeNames, mode, operation) {
    const db = await open();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];

    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(names, mode);
      } catch (error) {
        reject(makeError("Transaksi basis data tidak dapat dimulai.", "DB_TX_START_FAILED", error));
        return;
      }

      let result;
      let operationError = null;
      let finished = false;

      const fail = (error) => {
        if (finished) return;
        finished = true;
        reject(error instanceof Error ? error : makeError("Transaksi basis data gagal.", "DB_TX_FAILED", error));
      };

      tx.oncomplete = () => {
        if (finished) return;
        finished = true;
        if (operationError) reject(operationError);
        else resolve(result);
      };
      tx.onabort = () => fail(operationError || makeError("Transaksi basis data dibatalkan.", "DB_TX_ABORTED", tx.error));
      tx.onerror = () => {
        // onabort biasanya menyusul. Hindari reject dua kali.
        operationError = operationError || makeError("Transaksi basis data gagal.", "DB_TX_FAILED", tx.error);
      };

      try {
        const stores = Object.fromEntries(names.map((name) => [name, tx.objectStore(name)]));
        Promise.resolve(operation(stores, tx))
          .then((value) => { result = value; })
          .catch((error) => {
            operationError = error instanceof Error ? error : makeError("Operasi basis data gagal.", "DB_OPERATION_FAILED", error);
            try { tx.abort(); } catch (_) { fail(operationError); }
          });
      } catch (error) {
        operationError = error;
        try { tx.abort(); } catch (_) { fail(error); }
      }
    });
  }

  // ---- CRUD generik ----
  function getAll(store) {
    return transact(store, "readonly", ({ [store]: objectStore }) => requestResult(objectStore.getAll()));
  }

  function get(store, id) {
    return transact(store, "readonly", ({ [store]: objectStore }) => requestResult(objectStore.get(id)));
  }

  async function put(store, object) {
    await transact(store, "readwrite", ({ [store]: objectStore }) => requestResult(objectStore.put(object)));
    return object;
  }

  function putMany(store, objects) {
    return transact(store, "readwrite", async ({ [store]: objectStore }) => {
      await Promise.all((objects || []).map((object) => requestResult(objectStore.put(object))));
      return objects || [];
    });
  }

  function del(store, id) {
    return transact(store, "readwrite", ({ [store]: objectStore }) => requestResult(objectStore.delete(id)));
  }

  function byIndex(store, index, value) {
    return transact(store, "readonly", ({ [store]: objectStore }) => requestResult(objectStore.index(index).getAll(value)));
  }

  function clearAll() {
    return transact(STORES, "readwrite", async (stores) => {
      await Promise.all(STORES.map((name) => requestResult(stores[name].clear())));
    });
  }

  // ---- Operasi level domain ----
  function snapshot() {
    return transact(STORES, "readonly", async (stores) => {
      const [debtors, loans, payments] = await Promise.all([
        requestResult(stores.debtors.getAll()),
        requestResult(stores.loans.getAll()),
        requestResult(stores.payments.getAll()),
      ]);
      return { debtors, loans, payments };
    });
  }

  function deleteCursorMatches(index, value) {
    return new Promise((resolve, reject) => {
      const req = index.openCursor(IDBKeyRange.only(value));
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
        cursor.delete();
        cursor.continue();
      };
    });
  }

  // Hapus peminjam beserta seluruh pinjaman & pembayarannya secara atomik.
  function deleteDebtorCascade(debtorId) {
    return transact(STORES, "readwrite", async (stores) => {
      await Promise.all([
        deleteCursorMatches(stores.payments.index("debtorId"), debtorId),
        deleteCursorMatches(stores.loans.index("debtorId"), debtorId),
      ]);
      await requestResult(stores.debtors.delete(debtorId));
    });
  }

  // Hapus satu pinjaman beserta pembayarannya secara atomik.
  function deleteLoanCascade(loanId) {
    return transact(["loans", "payments"], "readwrite", async (stores) => {
      await deleteCursorMatches(stores.payments.index("loanId"), loanId);
      await requestResult(stores.loans.delete(loanId));
    });
  }

  // Hapus beberapa pinjaman dan pembayaran terkait dalam satu transaksi.
  function deleteLoansCascade(loanIds) {
    const ids = Array.from(new Set((loanIds || []).filter(Boolean)));
    if (!ids.length) return Promise.resolve();
    const idSet = new Set(ids);

    return transact(["loans", "payments"], "readwrite", async (stores) => {
      await new Promise((resolve, reject) => {
        const req = stores.payments.openCursor();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) { resolve(); return; }
          if (idSet.has(cursor.value.loanId)) cursor.delete();
          cursor.continue();
        };
      });
      await Promise.all(ids.map((id) => requestResult(stores.loans.delete(id))));
    });
  }

  function putDebtorAndLoans(debtor, loans) {
    return transact(["debtors", "loans"], "readwrite", async (stores) => {
      await requestResult(stores.debtors.put(debtor));
      await Promise.all((loans || []).map((loan) => requestResult(stores.loans.put(loan))));
    });
  }

  // Catat beberapa pembayaran sebagai satu kesatuan dan validasi kembali
  // terhadap saldo terbaru di IndexedDB. Ini mencegah pembayaran berlebih
  // bila dua tab menulis pada waktu hampir bersamaan.
  function addPayments(payments) {
    const records = payments || [];
    return transact(["loans", "payments"], "readwrite", async (stores) => {
      const grouped = new Map();
      records.forEach((payment) => {
        if (!grouped.has(payment.loanId)) grouped.set(payment.loanId, []);
        grouped.get(payment.loanId).push(payment);
      });

      const checks = await Promise.all(Array.from(grouped.entries()).map(async ([loanId, additions]) => {
        const [loan, existing] = await Promise.all([
          requestResult(stores.loans.get(loanId)),
          requestResult(stores.payments.index("loanId").getAll(loanId)),
        ]);
        if (!loan) throw makeError("Pinjaman untuk pembayaran tidak ditemukan.", "PAYMENT_LOAN_MISSING");
        if (additions.some((payment) => payment.debtorId !== loan.debtorId)) {
          throw makeError("Relasi debitur pada pembayaran tidak konsisten.", "PAYMENT_DEBTOR_MISMATCH");
        }
        const currentPaid = existing.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
        const added = additions.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
        if (currentPaid + added > Number(loan.amount || 0)) {
          throw makeError("Pembayaran melebihi sisa pinjaman terbaru. Muat ulang lalu periksa nominal.", "PAYMENT_OVERFLOW");
        }
        return true;
      }));
      if (!checks.every(Boolean)) throw makeError("Pembayaran gagal divalidasi.", "PAYMENT_VALIDATION_FAILED");
      await Promise.all(records.map((payment) => requestResult(stores.payments.add(payment))));
      return records;
    });
  }

  function saveLoan(loan) {
    return transact(["loans", "payments"], "readwrite", async (stores) => {
      const existingPayments = await requestResult(stores.payments.index("loanId").getAll(loan.id));
      const paid = existingPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
      if (paid > Number(loan.amount || 0)) {
        throw makeError("Nominal pinjaman lebih kecil daripada pembayaran terbaru. Muat ulang data.", "LOAN_BELOW_PAID");
      }
      await requestResult(stores.loans.put(loan));
      return loan;
    });
  }

  // Ganti seluruh data secara atomik (dipakai saat import/seed).
  function replaceAll({ debtors = [], loans = [], payments = [] }) {
    return transact(STORES, "readwrite", async (stores) => {
      await Promise.all(STORES.map((name) => requestResult(stores[name].clear())));
      await Promise.all([
        ...debtors.map((item) => requestResult(stores.debtors.put(item))),
        ...loans.map((item) => requestResult(stores.loans.put(item))),
        ...payments.map((item) => requestResult(stores.payments.put(item))),
      ]);
    });
  }

  function close() {
    if (_db) _db.close();
    _db = null;
  }

  return {
    open, close, transact, snapshot,
    getAll, get, put, putMany, del, byIndex,
    clearAll, replaceAll, addPayments, saveLoan, putDebtorAndLoans,
    deleteDebtorCascade, deleteLoanCascade, deleteLoansCascade,
  };
})();
