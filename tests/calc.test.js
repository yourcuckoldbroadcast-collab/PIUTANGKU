"use strict";
const assert = require("node:assert/strict");
const Calc = require("../js/calc.js");

function base() {
  return {
    app: "PiutangKu",
    version: Calc.BACKUP_VERSION,
    debtors: [{ id: "d1", name: "Ari", phone: "", tag: "", note: "", photo: "", createdAt: "2026-06-01" }],
    loans: [
      { id: "l1", debtorId: "d1", amount: 100000, date: "2026-06-01", description: "A", attachments: [], createdAt: "2026-06-01T01:00:00.000Z" },
      { id: "l2", debtorId: "d1", amount: 100000, date: "2026-06-02", description: "B", attachments: [], createdAt: "2026-06-02T01:00:00.000Z" },
    ],
    payments: [],
  };
}

{
  const data = base();
  data.payments.push({ id: "p1", loanId: "l1", debtorId: "d1", amount: 200000, date: "2026-06-03", note: "", createdAt: "2026-06-03" });
  const summary = Calc.debtorSummary(data.debtors[0], data.loans, data.payments);
  assert.equal(summary.totalPaid, 100000, "kelebihan pembayaran harus dibatasi per pinjaman");
  assert.equal(summary.remaining, 100000, "pinjaman kedua tidak boleh tertutup oleh kelebihan pinjaman pertama");
}

{
  const data = base();
  assert.equal(Calc.validateImport(data).ok, true, "backup valid harus diterima");
}

{
  const data = base();
  data.debtors.push({ ...data.debtors[0] });
  assert.equal(Calc.validateImport(data).ok, false, "ID duplikat harus ditolak");
}

{
  const data = base();
  data.loans[0].debtorId = "hilang";
  assert.equal(Calc.validateImport(data).ok, false, "relasi yatim harus ditolak");
}

{
  const data = base();
  data.payments.push({ id: "p1", loanId: "l1", debtorId: "d1", amount: 100001, date: "2026-06-03", note: "", createdAt: "2026-06-03" });
  assert.equal(Calc.validateImport(data).ok, false, "pembayaran berlebih harus ditolak");
}

{
  const data = base();
  data.debtors[0].photo = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
  assert.equal(Calc.validateImport(data).ok, false, "SVG aktif pada import harus ditolak");
}

{
  const local = new Date(2026, 5, 26, 0, 30, 0);
  assert.equal(Calc.dateToLocalISO(local), "2026-06-26", "tanggal harus memakai kalender lokal");
}

{
  const allocation = Calc.smartAllocate(150, [{ id: "a", remaining: 100 }, { id: "b", remaining: 200 }]);
  assert.deepEqual(allocation.alloc, { a: 100, b: 50 });
  assert.equal(allocation.cleared, 1);
}

console.log("Semua pengujian Calc lulus.");
