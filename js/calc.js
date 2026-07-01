/* ============================================================
   calc.js — Logika & perhitungan murni (tanpa DOM, bisa diuji terpisah)
   ============================================================ */

const Calc = (() => {
  const DAY = 86400000;
  const MAX_MONEY = 1_000_000_000_000_000;
  const BACKUP_VERSION = 4;
  const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function dateValue(v) {
    if (typeof v === "string") {
      const match = ISO_DATE.exec(v);
      if (match) {
        const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (d.getFullYear() === Number(match[1]) && d.getMonth() === Number(match[2]) - 1 && d.getDate() === Number(match[3])) return d;
        return new Date(NaN);
      }
    }
    return new Date(v);
  }
  const toTime = (v) => { const n = dateValue(v).getTime(); return isNaN(n) ? 0 : n; };

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
    const d = dateValue(iso);
    if (isNaN(d)) return "-";
    if (opt === "long") return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  }
  function dateToLocalISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function todayISO() { return dateToLocalISO(new Date()); }

  function waktuRelatif(iso, now = Date.now()) {
    const d = toTime(iso);
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
    const amount = Math.max(0, Number(loan && loan.amount) || 0);
    const pays = (payments || []).filter((p) => p.loanId === loan.id);
    const rawPaid = pays.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) || 0), 0);
    // Pembayaran berlebih tidak boleh menutupi pinjaman lain pada ringkasan.
    const paid = Math.min(amount, rawPaid);
    const remaining = Math.max(0, amount - paid);
    return {
      paid,
      rawPaid,
      overpaid: Math.max(0, rawPaid - amount),
      remaining,
      percent: pct(paid, amount),
      lunas: amount > 0 && remaining <= 0,
      paymentCount: pays.length,
      payments: pays.slice().sort((a, b) =>
        (toTime(a.date) - toTime(b.date)) || (toTime(a.createdAt || a.date) - toTime(b.createdAt || b.date))
      ),
    };
  }

  // ---------- Ringkasan debitur ----------
  function debtorSummary(debtor, loans, payments) {
    const dl = (loans || []).filter((loan) => loan.debtorId === debtor.id);
    const loanIds = new Set(dl.map((loan) => loan.id));
    const relatedPayments = (payments || []).filter((payment) => loanIds.has(payment.loanId));
    const summaries = dl.map((loan) => loanSummary(loan, relatedPayments));
    const totalBorrowed = dl.reduce((sum, loan) => sum + Math.max(0, Number(loan.amount) || 0), 0);
    const totalPaid = summaries.reduce((sum, item) => sum + item.paid, 0);
    const remaining = summaries.reduce((sum, item) => sum + item.remaining, 0);

    // Aktivitas terakhir hanya memakai pembayaran yang benar-benar terkait pinjaman debitur.
    let lastActivity = null;
    [...dl.map((loan) => loan.date), ...relatedPayments.map((payment) => payment.date)].forEach((value) => {
      const time = toTime(value);
      if (time && (lastActivity === null || time > lastActivity)) lastActivity = time;
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
    const loanList = loans || [];
    const paymentList = payments || [];
    const summaries = loanList.map((loan) => loanSummary(loan, paymentList));
    const totalBorrowed = loanList.reduce((sum, loan) => sum + Math.max(0, Number(loan.amount) || 0), 0);
    const totalPaid = summaries.reduce((sum, item) => sum + item.paid, 0);
    const totalActive = summaries.reduce((sum, item) => sum + item.remaining, 0);
    const validLoanIds = new Set(loanList.map((loan) => loan.id));
    let activeDebtors = 0;
    (debtors || []).forEach((debtor) => {
      if (debtorSummary(debtor, loanList, paymentList).hasDebt) activeDebtors++;
    });
    return {
      totalActive,
      totalBorrowed,
      totalPaid,
      debtorCount: (debtors || []).length,
      activeDebtors,
      repaymentRate: pct(totalPaid, totalBorrowed),
      loanCount: loanList.length,
      paymentCount: paymentList.filter((payment) => validLoanIds.has(payment.loanId)).length,
    };
  }

  // ---------- Profil Pembayaran Debitur ----------
  // Indikator perilaku pembayaran 0–100. Bukan skor kredit dan tidak memakai
  // istilah "terlambat" karena data PiutangKu belum memiliki tanggal jatuh tempo.
  //
  // Prinsip:
  // - Pelunasan, aktivitas, dan kecepatan dinormalisasi secara terpisah.
  // - Geometric mean mengurangi kemampuan satu indikator bagus menutupi indikator
  //   yang sangat buruk.
  // - Skor ditarik ke nilai netral 50 ketika histori masih sedikit (confidence
  //   shrinkage), sehingga satu transaksi tidak langsung menghasilkan 0/100.
  // - Hutang aktif yang sangat lama tanpa aktivitas diberi hard gate.
  function median(values) {
    const list = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!list.length) return null;
    const middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }

  function clampScore(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }

  function durationScore(days) {
    const d = Math.max(0, Number(days) || 0);
    if (d <= 30) return 100;
    if (d <= 60) return 100 - ((d - 30) / 30) * 15;
    if (d <= 90) return 85 - ((d - 60) / 30) * 15;
    if (d <= 180) return 70 - ((d - 90) / 90) * 30;
    if (d <= 365) return 40 - ((d - 180) / 185) * 25;
    return Math.max(5, 15 - ((d - 365) / 365) * 10);
  }

  function trustScore(debtor, loans, payments, now = Date.now()) {
    const dl = (loans || []).filter((loan) => loan.debtorId === debtor.id);
    if (!dl.length) {
      return {
        score: null, category: "baru", label: "Baru", emoji: "⚪", color: "ghost",
        confidence: "none", confidenceLabel: "Belum ada data",
        reason: "Belum ada riwayat pinjaman.",
        breakdown: { pelunasan: 50, aktivitas: 50, kecepatan: 50 },
      };
    }

    const summaries = dl.map((loan) => ({ loan, summary: loanSummary(loan, payments || []) }));
    const totalBorrowed = summaries.reduce((sum, item) => sum + Math.max(0, Number(item.loan.amount) || 0), 0);
    const totalPaid = summaries.reduce((sum, item) => sum + item.summary.paid, 0);
    const settled = summaries.filter((item) => item.summary.lunas);
    const active = summaries.filter((item) => !item.summary.lunas && item.summary.remaining > 0);
    const paymentCount = summaries.reduce((sum, item) => sum + item.summary.paymentCount, 0);

    const progressScore = totalBorrowed > 0 ? (totalPaid / totalBorrowed) * 100 : 50;
    const settledRatio = dl.length ? (settled.length / dl.length) * 100 : 50;
    const pelunasan = Math.round(clampScore(progressScore * 0.78 + settledRatio * 0.22));

    let oldestIdleDays = 0;
    let aktivitas = 100;
    if (active.length) {
      let weightedRecency = 0;
      let remainingWeight = 0;
      active.forEach(({ loan, summary }) => {
        const last = summary.payments.length
          ? toTime(summary.payments[summary.payments.length - 1].date)
          : toTime(loan.date);
        const idle = Math.max(0, Math.floor((now - last) / DAY));
        oldestIdleDays = Math.max(oldestIdleDays, idle);
        const weight = Math.max(1, summary.remaining);
        const recency = 100 * Math.exp(-0.015 * idle);
        weightedRecency += recency * weight;
        remainingWeight += weight;
      });
      const recencyScore = remainingWeight ? weightedRecency / remainingWeight : 50;
      const firstLoanTimes = dl.map((loan) => toTime(loan.date)).filter(Boolean);
      const firstLoanTime = firstLoanTimes.length ? Math.min(...firstLoanTimes) : now;
      const activeMonths = Math.max(1, (now - firstLoanTime) / (30 * DAY));
      const frequencyScore = clampScore((paymentCount / activeMonths) * 100);
      aktivitas = Math.round(clampScore(recencyScore * 0.72 + frequencyScore * 0.28));
    }

    const settlementDurations = settled.map(({ loan, summary }) => {
      const end = summary.payments.length
        ? toTime(summary.payments[summary.payments.length - 1].date)
        : toTime(loan.date);
      return Math.max(0, Math.round((end - toTime(loan.date)) / DAY));
    });
    const medianDuration = median(settlementDurations);
    const kecepatan = Math.round(clampScore(medianDuration == null ? 50 : durationScore(medianDuration)));

    const FLOOR = 1;
    const geoMean = Math.pow(
      Math.max(pelunasan, FLOOR) * Math.max(aktivitas, FLOOR) * Math.max(kecepatan, FLOOR),
      1 / 3
    );
    const weightedAverage = pelunasan * 0.45 + aktivitas * 0.25 + kecepatan * 0.30;
    const rawScore = geoMean * 0.65 + weightedAverage * 0.35;

    const evidenceUnits = paymentCount + settled.length * 2 + Math.min(2, dl.length * 0.5);
    const evidence = Math.min(1, evidenceUnits / 10);
    let score = 50 + evidence * (rawScore - 50);

    let gate = "none";
    if (active.length && oldestIdleDays > 180) {
      score = Math.min(score, 30);
      gate = "very-idle";
    } else if (active.length && oldestIdleDays > 90) {
      score = Math.min(score, 45);
      gate = "idle";
    }
    score = Math.round(Math.max(1, Math.min(100, score)));

    let category, label, emoji, color;
    if (score >= 80) { category = "sangat-baik"; label = "Sangat Baik"; emoji = "🟢"; color = "green"; }
    else if (score >= 65) { category = "baik"; label = "Baik"; emoji = "🟢"; color = "green"; }
    else if (score >= 50) { category = "cukup"; label = "Cukup"; emoji = "🟡"; color = "yellow"; }
    else if (score >= 35) { category = "pantau"; label = "Perlu Pengawasan"; emoji = "🟡"; color = "yellow"; }
    else { category = "risiko"; label = "Risiko Aktivitas Tinggi"; emoji = "🔴"; color = "red"; }

    let confidence, confidenceLabel;
    if (evidence < 0.35) { confidence = "low"; confidenceLabel = "Data terbatas"; }
    else if (evidence < 0.75) { confidence = "medium"; confidenceLabel = "Data sedang"; }
    else { confidence = "high"; confidenceLabel = "Data kuat"; }

    const reasons = [];
    if (gate === "very-idle") reasons.push("hutang aktif tanpa aktivitas lebih dari 180 hari");
    else if (gate === "idle") reasons.push("hutang aktif tanpa aktivitas lebih dari 90 hari");
    if (settled.length) reasons.push(`median pelunasan ${Math.round(medianDuration)} hari`);
    else reasons.push("belum ada pinjaman yang selesai");
    reasons.push(confidenceLabel.toLowerCase());

    return {
      score, category, label, emoji, color, confidence, confidenceLabel,
      reason: reasons.join(" · "),
      breakdown: {
        pelunasan, aktivitas, kecepatan,
        geometricMean: Math.round(geoMean),
        weightedAverage: Math.round(weightedAverage),
        evidence: Math.round(evidence * 100),
        gate,
      },
    };
  }

  // ---------- Pengingat Fleksibel ----------
  // Satu debitur hanya memiliki satu kebijakan pengingat. Pilihan manual
  // menggantikan threshold otomatis, sehingga tidak ada dua reminder bertabrakan.
  function reminderConfig(debtor) {
    const mode = debtor && ["auto", "custom", "off"].includes(debtor.reminderMode)
      ? debtor.reminderMode : "auto";
    if (mode === "off") return { mode, enabled: false, days: 0, label: "Nonaktif" };
    const rawDays = mode === "auto" ? 45 : Number(debtor.reminderDays);
    const days = Number.isInteger(rawDays) && rawDays >= 1 && rawDays <= 3650 ? rawDays : (mode === "auto" ? 45 : 30);
    return { mode, enabled: true, days, label: mode === "auto" ? "Otomatis 45 hari" : `${days} hari` };
  }

  function reminderStatus(debtor, loans, payments, now = Date.now()) {
    const config = reminderConfig(debtor);
    const summary = debtorSummary(debtor, loans || [], payments || []);
    if (!config.enabled || !summary.hasDebt || summary.lastActivity == null) return null;

    const activityDueAt = summary.lastActivity + config.days * DAY;
    const nextAt = toTime(debtor.reminderNextAt);
    const snoozedUntil = toTime(debtor.reminderSnoozedUntil);
    const dueAt = Math.max(activityDueAt, nextAt || 0, snoozedUntil || 0);
    const days = Math.max(0, Math.floor((now - summary.lastActivity) / DAY));
    const overdueDays = Math.max(0, Math.floor((now - dueAt) / DAY));
    const due = now >= dueAt;

    return {
      debtorId: debtor.id,
      name: debtor.name,
      remaining: summary.remaining,
      days,
      due,
      dueAt,
      overdueDays,
      reminderDays: config.days,
      mode: config.mode,
      message: due
        ? `${days} hari tanpa aktivitas · pengingat ${config.days} hari`
        : `Pengingat berikutnya ${tanggal(dateToLocalISO(new Date(dueAt)), "long")}`,
      severity: overdueDays >= 30 || days >= config.days * 2 ? "high" : "mid",
    };
  }

  function reminders(debtors, loans, payments, now = Date.now()) {
    const out = [];
    (debtors || []).forEach((debtor) => {
      const status = reminderStatus(debtor, loans, payments, now);
      if (status && status.due) out.push(status);
    });
    return out.sort((a, b) =>
      (b.overdueDays - a.overdueDays) || (b.remaining - a.remaining) || String(a.name).localeCompare(String(b.name))
    );
  }

  // ---------- Validasi & normalisasi import ----------
  function cleanText(value, max, required = false) {
    if (value == null) value = "";
    if (typeof value !== "string") return null;
    const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
    if ((required && !text) || text.length > max) return null;
    return text;
  }

  function cleanId(value) {
    if (typeof value !== "string") return null;
    const id = value.trim();
    return /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : null;
  }

  function cleanMoney(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 && number <= MAX_MONEY ? number : null;
  }

  function cleanDate(value) {
    if (typeof value !== "string" || !ISO_DATE.test(value) || !toTime(value)) return null;
    return value;
  }

  function cleanCreatedAt(value, fallback) {
    if (value == null || value === "") return fallback;
    if (typeof value !== "string" || !toTime(value)) return null;
    return value;
  }

  function imageDataInfo(value, maxBytes) {
    if (value === "") return { ok: true, value: "", type: "" };
    if (typeof value !== "string") return { ok: false };
    const match = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(value);
    if (!match) return { ok: false };
    const encoded = match[2].replace(/\s/g, "");
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const bytes = Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
    if (bytes > maxBytes) return { ok: false, tooLarge: true };
    return { ok: true, value: `data:image/${match[1].toLowerCase()};base64,${encoded}`, type: `image/${match[1].toLowerCase()}`, bytes };
  }

  function failImport(message) { return { ok: false, error: message }; }

  function validateImport(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return failImport("Berkas tidak valid.");
    if (obj.app != null && obj.app !== "PiutangKu") return failImport("Berkas bukan cadangan PiutangKu.");
    if (obj.version != null && (!Number.isInteger(Number(obj.version)) || Number(obj.version) > BACKUP_VERSION)) {
      return failImport("Versi cadangan lebih baru dan belum didukung aplikasi ini.");
    }
    if (!Array.isArray(obj.debtors)) return failImport("Format tidak dikenali: daftar debitur tidak ditemukan.");
    if (!Array.isArray(obj.loans) || !Array.isArray(obj.payments)) return failImport("Struktur pinjaman atau pembayaran rusak.");
    if (obj.debtors.length > 10000 || obj.loans.length > 50000 || obj.payments.length > 100000) {
      return failImport("Cadangan terlalu besar untuk diproses dengan aman.");
    }

    const debtors = [];
    const debtorIds = new Set();
    const pendingGalleryByDebtor = new Map();
    for (let i = 0; i < obj.debtors.length; i++) {
      const source = obj.debtors[i];
      if (!source || typeof source !== "object" || Array.isArray(source)) return failImport(`Debitur ke-${i + 1} tidak valid.`);
      const id = cleanId(source.id);
      const name = cleanText(source.name, 120, true);
      if (!id || debtorIds.has(id)) return failImport(`ID debitur ke-${i + 1} tidak valid atau duplikat.`);
      if (!name) return failImport(`Nama debitur ke-${i + 1} kosong atau terlalu panjang.`);
      const phone = cleanText(source.phone, 40);
      const tag = cleanText(source.tag, 60);
      const note = cleanText(source.note, 2000);
      if (phone == null || tag == null || note == null) return failImport(`Teks pada debitur “${name}” melewati batas aman.`);
      const photo = imageDataInfo(source.photo || "", 600 * 1024);
      if (!photo.ok) return failImport(`Foto debitur “${name}” tidak valid atau terlalu besar.`);
      const createdAt = cleanCreatedAt(source.createdAt, todayISO());
      if (!createdAt) return failImport(`Tanggal pembuatan debitur “${name}” tidak valid.`);
      const normalized = { id, name, phone, tag, note, photo: photo.value, createdAt };
      const reminderMode = ["auto", "custom", "off"].includes(source.reminderMode) ? source.reminderMode : "auto";
      const reminderDaysRaw = Number(source.reminderDays);
      const reminderDays = Number.isInteger(reminderDaysRaw) && reminderDaysRaw >= 1 && reminderDaysRaw <= 3650
        ? reminderDaysRaw : (reminderMode === "custom" ? 30 : 45);
      normalized.reminderMode = reminderMode;
      if (reminderMode === "custom") normalized.reminderDays = reminderDays;
      const reminderNextAt = source.reminderNextAt ? cleanCreatedAt(source.reminderNextAt, "") : "";
      const reminderSnoozedUntil = source.reminderSnoozedUntil ? cleanCreatedAt(source.reminderSnoozedUntil, "") : "";
      if (source.reminderNextAt && !reminderNextAt) return failImport(`Jadwal pengingat debitur “${name}” tidak valid.`);
      if (source.reminderSnoozedUntil && !reminderSnoozedUntil) return failImport(`Waktu tunda pengingat debitur “${name}” tidak valid.`);
      if (reminderNextAt) normalized.reminderNextAt = reminderNextAt;
      if (reminderSnoozedUntil) normalized.reminderSnoozedUntil = reminderSnoozedUntil;
      const emoji = cleanText(source.emoji, 8);
      const color = typeof source.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(source.color) ? source.color : "";
      if (emoji) normalized.emoji = emoji;
      if (color) normalized.color = color;
      if (source.loanSort && typeof source.loanSort === "object") {
        const by = ["amount", "date", "manual"].includes(source.loanSort.by) ? source.loanSort.by : "date";
        normalized.loanSort = { by, dir: source.loanSort.dir === "asc" ? "asc" : "desc" };
      }

      const sourceGallery = source.galleryAttachments == null ? [] : source.galleryAttachments;
      if (!Array.isArray(sourceGallery) || sourceGallery.length > 24) {
        return failImport(`Galeri bukti debitur “${name}” melebihi batas 24 gambar.`);
      }
      const galleryIds = new Set();
      const galleryAttachments = [];
      for (let j = 0; j < sourceGallery.length; j++) {
        const attachment = sourceGallery[j];
        if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
          return failImport(`Bukti galeri ke-${j + 1} milik “${name}” rusak.`);
        }
        const attachmentId = cleanId(attachment.id);
        const image = imageDataInfo(attachment.dataUrl, 1600 * 1024);
        const attachmentName = cleanText(attachment.name || `bukti-${j + 1}.jpg`, 120, true);
        const created = cleanCreatedAt(attachment.createdAt, createdAt);
        const rawLoanIds = attachment.loanIds;
        if (!attachmentId || galleryIds.has(attachmentId)) {
          return failImport(`ID bukti galeri ke-${j + 1} milik “${name}” tidak valid atau duplikat.`);
        }
        if (!image.ok || !attachmentName) {
          return failImport(`Bukti galeri ke-${j + 1} milik “${name}” tidak valid atau terlalu besar.`);
        }
        if (!created) return failImport(`Waktu bukti galeri ke-${j + 1} milik “${name}” tidak valid.`);
        if (!Array.isArray(rawLoanIds) || rawLoanIds.length < 1 || rawLoanIds.length > 100) {
          return failImport(`Tag hutang pada bukti galeri ke-${j + 1} milik “${name}” tidak valid.`);
        }
        const loanIds = [];
        const seenLoanIds = new Set();
        for (const rawLoanId of rawLoanIds) {
          const loanId = cleanId(rawLoanId);
          if (!loanId || seenLoanIds.has(loanId)) {
            return failImport(`Tag hutang pada bukti galeri ke-${j + 1} milik “${name}” rusak atau duplikat.`);
          }
          seenLoanIds.add(loanId);
          loanIds.push(loanId);
        }
        galleryIds.add(attachmentId);
        const rawReceiptType = attachment.receiptType;
        if (rawReceiptType != null && rawReceiptType !== "" && !["loan", "payment"].includes(rawReceiptType)) {
          return failImport(`Jenis resi pada bukti galeri ke-${j + 1} milik “${name}” tidak valid.`);
        }
        // Migrasi cadangan v1.9: bukti galeri lama dibuat khusus untuk pembayaran,
        // sehingga field yang belum ada dipetakan aman ke "payment" tanpa mengubah gambar/tag.
        const receiptType = rawReceiptType === "loan" ? "loan" : "payment";
        galleryAttachments.push({
          id: attachmentId,
          name: attachmentName,
          type: image.type,
          dataUrl: image.value,
          createdAt: created,
          loanIds,
          receiptType,
        });
      }
      normalized.galleryAttachments = [];
      pendingGalleryByDebtor.set(id, galleryAttachments);
      debtors.push(normalized);
      debtorIds.add(id);
    }

    const loans = [];
    const loanIds = new Set();
    const loanById = new Map();
    for (let i = 0; i < obj.loans.length; i++) {
      const source = obj.loans[i];
      if (!source || typeof source !== "object" || Array.isArray(source)) return failImport(`Pinjaman ke-${i + 1} tidak valid.`);
      const id = cleanId(source.id);
      const debtorId = cleanId(source.debtorId);
      const amount = cleanMoney(source.amount);
      const date = cleanDate(source.date);
      const description = cleanText(source.description || "Pinjaman", 300, true);
      if (!id || loanIds.has(id)) return failImport(`ID pinjaman ke-${i + 1} tidak valid atau duplikat.`);
      if (!debtorId || !debtorIds.has(debtorId)) return failImport(`Pinjaman ke-${i + 1} merujuk debitur yang tidak ditemukan.`);
      if (!amount) return failImport(`Nominal pinjaman ke-${i + 1} tidak valid.`);
      if (!date) return failImport(`Tanggal pinjaman ke-${i + 1} tidak valid.`);
      if (!description) return failImport(`Keterangan pinjaman ke-${i + 1} tidak valid.`);
      const createdAt = cleanCreatedAt(source.createdAt, date);
      if (!createdAt) return failImport(`Waktu pembuatan pinjaman ke-${i + 1} tidak valid.`);
      const sourceAttachments = source.attachments == null ? [] : source.attachments;
      if (!Array.isArray(sourceAttachments) || sourceAttachments.length > 8) return failImport(`Lampiran pinjaman ke-${i + 1} melebihi batas 8 gambar.`);
      const attachments = [];
      for (let j = 0; j < sourceAttachments.length; j++) {
        const attachment = sourceAttachments[j];
        if (!attachment || typeof attachment !== "object") return failImport(`Lampiran ${j + 1} pada pinjaman ke-${i + 1} rusak.`);
        const image = imageDataInfo(attachment.dataUrl, 1600 * 1024);
        const name = cleanText(attachment.name || `bukti-${j + 1}.jpg`, 120, true);
        if (!image.ok || !name) return failImport(`Lampiran ${j + 1} pada pinjaman ke-${i + 1} tidak valid atau terlalu besar.`);
        attachments.push({ name, type: image.type, dataUrl: image.value });
      }
      const normalized = { id, debtorId, amount, date, description, attachments, createdAt };
      if (Number.isFinite(source.order)) normalized.order = Math.max(0, Math.floor(source.order));
      loans.push(normalized);
      loanIds.add(id);
      loanById.set(id, normalized);
    }

    for (const debtor of debtors) {
      const galleryAttachments = pendingGalleryByDebtor.get(debtor.id) || [];
      for (let i = 0; i < galleryAttachments.length; i++) {
        const attachment = galleryAttachments[i];
        for (const loanId of attachment.loanIds) {
          const loan = loanById.get(loanId);
          if (!loan || loan.debtorId !== debtor.id) {
            return failImport(`Bukti galeri ke-${i + 1} milik “${debtor.name}” merujuk hutang yang tidak ditemukan atau milik debitur lain.`);
          }
        }
      }
      debtor.galleryAttachments = galleryAttachments;
    }

    const payments = [];
    const paymentIds = new Set();
    const paidByLoan = new Map();
    for (let i = 0; i < obj.payments.length; i++) {
      const source = obj.payments[i];
      if (!source || typeof source !== "object" || Array.isArray(source)) return failImport(`Pembayaran ke-${i + 1} tidak valid.`);
      const id = cleanId(source.id);
      const loanId = cleanId(source.loanId);
      const debtorId = cleanId(source.debtorId);
      const amount = cleanMoney(source.amount);
      const date = cleanDate(source.date);
      const note = cleanText(source.note, 300);
      if (!id || paymentIds.has(id)) return failImport(`ID pembayaran ke-${i + 1} tidak valid atau duplikat.`);
      const loan = loanById.get(loanId);
      if (!loan) return failImport(`Pembayaran ke-${i + 1} merujuk pinjaman yang tidak ditemukan.`);
      if (!debtorId || debtorId !== loan.debtorId) return failImport(`Relasi debitur pada pembayaran ke-${i + 1} tidak konsisten.`);
      if (!amount) return failImport(`Nominal pembayaran ke-${i + 1} tidak valid.`);
      if (!date) return failImport(`Tanggal pembayaran ke-${i + 1} tidak valid.`);
      if (note == null) return failImport(`Catatan pembayaran ke-${i + 1} terlalu panjang.`);
      const nextPaid = (paidByLoan.get(loanId) || 0) + amount;
      if (nextPaid > loan.amount) return failImport(`Total pembayaran untuk “${loan.description}” melebihi nominal pinjaman.`);
      const createdAt = cleanCreatedAt(source.createdAt, date);
      if (!createdAt) return failImport(`Waktu pembuatan pembayaran ke-${i + 1} tidak valid.`);
      payments.push({ id, loanId, debtorId, amount, date, note, createdAt });
      paymentIds.add(id);
      paidByLoan.set(loanId, nextPaid);
    }

    return { ok: true, data: { debtors, loans, payments }, version: BACKUP_VERSION };
  }

  // ---------- Data contoh ----------
  function sampleData(now = Date.now()) {
    const iso = (daysAgo) => dateToLocalISO(new Date(now - daysAgo * DAY));
    const debtors = [];
    const loans = [];
    const payments = [];
    const D = (name, phone, tag, note) => {
      const id = uid();
      debtors.push({ id, name, phone, tag, note, galleryAttachments: [], createdAt: iso(60) });
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

    // Lama tanpa aktivitas -> indikator "Perlu Dipantau" + memicu pengingat
    const hadi = D("Hadi", "0852-1212-3434", "Teman", "Sering telat bayar.");
    const lh = L(hadi, 2000000, 130, "Pinjam renovasi rumah");
    P(lh, hadi, 500000, 100);

    // Sangat lama tanpa aktivitas -> indikator merah + pengingat
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
    trustScore, reminderConfig, reminderStatus, reminders, validateImport, sampleData, dateToLocalISO, BACKUP_VERSION,
  };
})();

// Ekspor untuk pengujian Node (diabaikan di browser)
if (typeof module !== "undefined" && module.exports) module.exports = Calc;
