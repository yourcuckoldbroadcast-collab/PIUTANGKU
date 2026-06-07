/* ============================================================
   calc.js — Logika & perhitungan murni (tanpa DOM, bisa diuji terpisah)
   ============================================================ */

const Calc = (() => {
  const DAY = 86400000;
  const toTime = (v) => { const n = new Date(v).getTime(); return isNaN(n) ? 0 : n; };

  // ---------- ID unik ----------
  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  // ---------- Format ----------
  function rupiah(n) {
    n = Math.round(Number(n) || 0);
    return "Rp " + n.toLocaleString("id-ID");
  }
  // angka -> "Rp 1.500.000" singkat untuk hero (opsional ringkas)
  function rupiahShort(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return "Rp " + (n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " M";
    if (n >= 1e6) return "Rp " + (n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";
    return rupiah(n);
  }
  function parseRupiah(str) {
    if (typeof str === "number") return str;
    const digits = String(str).replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : 0;
  }
  function tanggal(iso, opt = "short") {
    const d = new Date(iso);
    if (isNaN(d)) return "-";
    if (opt === "long") return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function waktuRelatif(iso, now = Date.now()) {
    const d = new Date(iso).getTime();
    if (isNaN(d)) return "-";
    const diff = Math.floor((now - d) / DAY);
    if (diff < 0) return tanggal(iso);
    if (diff === 0) return "hari ini";
    if (diff === 1) return "kemarin";
    if (diff < 30) return diff + " hari lalu";
    if (diff < 60) return "1 bulan lalu";
    if (diff < 365) return Math.floor(diff / 30) + " bulan lalu";
    return Math.floor(diff / 365) + " tahun lalu";
  }

  function pct(part, whole) {
    if (!whole) return 0;
    return Math.min(100, Math.round((part / whole) * 100));
  }

  // ---------- Avatar ----------
  const AVATAR_COLORS = ["#8FDCC2", "#B8B5FF", "#FFB38A", "#7FB5E6", "#E59ABF", "#9BD49B", "#F2C76B"];
  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < String(name).length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // ---------- Ringkasan pinjaman ----------
  function loanSummary(loan, payments) {
    const pays = payments.filter((p) => p.loanId === loan.id);
    const paid = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const remaining = Math.max(0, (Number(loan.amount) || 0) - paid);
    return {
      paid,
      remaining,
      percent: pct(paid, loan.amount),
      lunas: remaining <= 0,
      paymentCount: pays.length,
      payments: pays.slice().sort((a, b) => new Date(a.date) - new Date(b.date)),
    };
  }

  // ---------- Ringkasan debitur ----------
  function debtorSummary(debtor, loans, payments) {
    const dl = loans.filter((l) => l.debtorId === debtor.id);
    const dp = payments.filter((p) => p.debtorId === debtor.id);
    const totalBorrowed = dl.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const totalPaid = dp.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const remaining = Math.max(0, totalBorrowed - totalPaid);
    // aktivitas terakhir = tanggal pembayaran terbaru, atau tanggal pinjaman terbaru
    let lastActivity = null;
    [...dl.map((l) => l.date), ...dp.map((p) => p.date)].forEach((d) => {
      const t = new Date(d).getTime();
      if (!isNaN(t) && (lastActivity === null || t > lastActivity)) lastActivity = t;
    });
    return {
      loanCount: dl.length,
      totalBorrowed,
      totalPaid,
      remaining,
      percent: pct(totalPaid, totalBorrowed),
      lunas: totalBorrowed > 0 && remaining <= 0,
      hasDebt: remaining > 0,
      lastActivity,
      // tanggal terbaru dulu; bila tanggalnya sama, yang paling baru DIINPUT
      // tampil lebih dulu. createdAt presisi dipakai sebagai pemecah seri,
      // karena urutan dari IndexedDB (getAll) mengikuti id acak, bukan waktu input.
      loans: dl.slice().sort((a, b) =>
        (toTime(b.date) - toTime(a.date)) ||
        (toTime(b.createdAt || b.date) - toTime(a.createdAt || a.date))
      ),
    };
  }

  // ---------- SmartPay: alokasi pembayaran otomatis ----------
  // Strategi "Debt Cleanup": lunasi sisa hutang TERKECIL dulu sampai dana habis,
  // supaya jumlah item hutang aktif berkurang secepat mungkin.
  // items: [{id, remaining, createdAt?, date?}], amount: number
  // return: { alloc: {id: nominal}, allocated, leftover, cleared }
  function smartAllocate(amount, items) {
    let left = Math.max(0, Math.floor(Number(amount) || 0));
    const start = left;
    const order = (items || [])
      .filter((it) => (Number(it.remaining) || 0) > 0)
      .slice()
      .sort((a, b) =>
        ((Number(a.remaining) || 0) - (Number(b.remaining) || 0)) ||
        (toTime(a.createdAt || a.date) - toTime(b.createdAt || b.date))
      );
    const alloc = {};
    let cleared = 0;
    for (const it of order) {
      if (left <= 0) break;
      const rem = Number(it.remaining) || 0;
      const pay = Math.min(rem, left);
      if (pay > 0) {
        alloc[it.id] = pay;
        left -= pay;
        if (pay >= rem) cleared++;
      }
    }
    return { alloc, allocated: start - left, leftover: left, cleared };
  }

  // ---------- Ringkasan global (dashboard) ----------
  function globalSummary(debtors, loans, payments) {
    const totalBorrowed = loans.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const totalActive = Math.max(0, totalBorrowed - totalPaid);
    let activeDebtors = 0;
    debtors.forEach((d) => { if (debtorSummary(d, loans, payments).hasDebt) activeDebtors++; });
    return {
      totalActive,
      totalBorrowed,
      totalPaid,
      debtorCount: debtors.length,
      activeDebtors,
      repaymentRate: pct(totalPaid, totalBorrowed),
      loanCount: loans.length,
      paymentCount: payments.length,
    };
  }

  // ---------- Skor Kepercayaan ----------
  // Heuristik sederhana & transparan, 0–100.
  // Mulai dari 100, dikurangi bila pinjaman lama menganggur tanpa bayar,
  // dan disesuaikan dengan kecepatan pelunasan pinjaman yang sudah lunas.
  function trustScore(debtor, loans, payments, now = Date.now()) {
    const dl = loans.filter((l) => l.debtorId === debtor.id);
    if (dl.length === 0) {
      return { score: null, category: "baru", label: "Baru", emoji: "⚪", color: "ghost", reason: "Belum ada riwayat pinjaman." };
    }
    let score = 100;
    const durations = [];
    const reasons = [];
    let overdueCount = 0;

    dl.forEach((loan) => {
      const sm = loanSummary(loan, payments);
      if (sm.lunas) {
        const lastPay = sm.payments.length ? new Date(sm.payments[sm.payments.length - 1].date).getTime() : new Date(loan.date).getTime();
        durations.push(Math.max(0, Math.round((lastPay - new Date(loan.date).getTime()) / DAY)));
      } else {
        const lastPay = sm.payments.length ? new Date(sm.payments[sm.payments.length - 1].date).getTime() : new Date(loan.date).getTime();
        const idle = Math.round((now - lastPay) / DAY);
        if (idle > 90) { score -= 25; overdueCount++; }
        else if (idle > 60) { score -= 15; overdueCount++; }
        else if (idle > 30) { score -= 7; }
      }
    });

    if (durations.length) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      if (avg > 90) { score -= 15; reasons.push("rata-rata pelunasan lambat"); }
      else if (avg > 60) { score -= 10; reasons.push("pelunasan agak lambat"); }
      else if (avg > 30) { score -= 5; }
      else { score += 3; reasons.push("pelunasan cepat"); }
    }
    if (overdueCount) reasons.push(`${overdueCount} pinjaman menunggak`);

    score = Math.max(0, Math.min(100, Math.round(score)));

    let category, label, emoji, color;
    if (score >= 80) { category = "lancar"; label = "Lancar"; emoji = "🟢"; color = "green"; }
    else if (score >= 60) { category = "terlambat"; label = "Sering Terlambat"; emoji = "🟡"; color = "yellow"; }
    else { category = "risiko"; label = "Risiko Tinggi"; emoji = "🔴"; color = "red"; }

    return { score, category, label, emoji, color, reason: reasons.length ? reasons.join(", ") : "Riwayat baik." };
  }

  // ---------- Pengingat ----------
  // Debitur yang masih punya sisa & sudah lama tidak ada pembayaran.
  function reminders(debtors, loans, payments, now = Date.now(), idleThreshold = 45) {
    const out = [];
    debtors.forEach((d) => {
      const sm = debtorSummary(d, loans, payments);
      if (!sm.hasDebt || sm.lastActivity == null) return;
      const days = Math.floor((now - sm.lastActivity) / DAY);
      if (days >= idleThreshold) {
        out.push({
          debtorId: d.id,
          name: d.name,
          days,
          remaining: sm.remaining,
          message: `Belum ada pembayaran selama ${days} hari`,
          severity: days >= 90 ? "high" : "mid",
        });
      }
    });
    return out.sort((a, b) => b.days - a.days);
  }

  // ---------- Validasi import ----------
  function validateImport(obj) {
    if (!obj || typeof obj !== "object") return { ok: false, error: "Berkas tidak valid." };
    if (!Array.isArray(obj.debtors)) return { ok: false, error: "Format tidak dikenali (debitur tidak ditemukan)." };
    const debtors = obj.debtors || [];
    const loans = obj.loans || [];
    const payments = obj.payments || [];
    if (!Array.isArray(loans) || !Array.isArray(payments)) return { ok: false, error: "Struktur data rusak." };
    return { ok: true, data: { debtors, loans, payments } };
  }

  // ---------- Data contoh ----------
  function sampleData(now = Date.now()) {
    const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString().slice(0, 10);
    const debtors = [];
    const loans = [];
    const payments = [];
    const D = (name, phone, tag, note) => {
      const id = uid();
      debtors.push({ id, name, phone, tag, note, createdAt: iso(60) });
      return id;
    };
    const L = (debtorId, amount, daysAgo, description) => {
      const id = uid();
      loans.push({ id, debtorId, amount, date: iso(daysAgo), description, attachments: [], createdAt: iso(daysAgo) });
      return id;
    };
    const P = (loanId, debtorId, amount, daysAgo) => {
      payments.push({ id: uid(), loanId, debtorId, amount, date: iso(daysAgo), note: "", createdAt: iso(daysAgo) });
    };

    const budi = D("Budi", "0812-3456-7890", "Tetangga", "Orang baik, kerja di bengkel.");
    const l1 = L(budi, 500000, 30, "Pinjam untuk servis motor");
    P(l1, budi, 100000, 26); P(l1, budi, 150000, 16);
    const l2 = L(budi, 1000000, 47, "Pinjam untuk beli ban");
    P(l2, budi, 1000000, 35);

    const andi = D("Andi", "0813-1111-2222", "Teman", "");
    L(andi, 1200000, 2, "Pinjam modal jualan");

    const dewi = D("Dewi", "0857-9090-1212", "Keluarga", "Sepupu dari ibu.");
    L(dewi, 850000, 10, "Pinjam biaya sekolah anak");

    const rudi = D("Rudi", "0821-3333-4444", "Tetangga", "");
    const lr = L(rudi, 1000000, 50, "Pinjam darurat");
    P(lr, rudi, 350000, 40);

    const siti = D("Siti", "0856-7777-8888", "Teman", "Selalu tepat waktu.");
    const ls = L(siti, 500000, 60, "Pinjam beli HP");
    P(ls, siti, 250000, 50); P(ls, siti, 250000, 20);

    const joko = D("Joko", "0878-5555-6666", "Tetangga", "");
    const lj = L(joko, 300000, 70, "Pinjam ongkos");
    P(lj, joko, 300000, 35);

    const nina = D("Nina", "0811-2323-4545", "Warung", "Langganan warung, kasbon rutin.");
    const ln = L(nina, 400000, 8, "Kasbon sembako");

    const eko = D("Eko", "0838-9898-1010", "UMKM", "");
    L(eko, 1000000, 5, "Pinjam tambah stok");

    // Menunggak agak lama -> skor "Sering Terlambat" 🟡 + memicu pengingat
    const hadi = D("Hadi", "0852-1212-3434", "Teman", "Sering telat bayar.");
    const lh = L(hadi, 2000000, 130, "Pinjam renovasi rumah");
    P(lh, hadi, 500000, 100);

    // Menunggak parah -> skor "Risiko Tinggi" 🔴 + pengingat
    const bayu = D("Bayu", "0899-5656-7878", "Kenalan", "");
    L(bayu, 1000000, 200, "Pinjam usaha (belum jelas)");
    L(bayu, 500000, 150, "Pinjam tambahan");

    // Beberapa yang lunas (menyeimbangkan tingkat pelunasan)
    const sari = D("Sari", "0813-4545-6767", "Tetangga", "");
    const lsa = L(sari, 700000, 90, "Pinjam acara keluarga");
    P(lsa, sari, 700000, 60);
    const tono = D("Tono", "0877-8989-1010", "Teman", "");
    const lt = L(tono, 1200000, 80, "Pinjam beli motor bekas");
    P(lt, tono, 600000, 60); P(lt, tono, 600000, 25);

    return { debtors, loans, payments };
  }

  return {
    uid, rupiah, rupiahShort, parseRupiah, tanggal, todayISO, waktuRelatif, pct,
    avatarColor, initials,
    loanSummary, debtorSummary, globalSummary, smartAllocate,
    trustScore, reminders, validateImport, sampleData,
  };
})();

// Ekspor untuk pengujian Node (diabaikan di browser)
if (typeof module !== "undefined" && module.exports) module.exports = Calc;
