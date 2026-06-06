/* ============================================================
   app.js — Controller utama PiutangKu
   Memakai global: DB (penyimpanan), Calc (logika), Charts (SVG).
   Arsitektur: state di memori + hash router + render string ke #app.
   ============================================================ */
(() => {
  "use strict";

  const $app = document.getElementById("app");
  const DAY = 86400000;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* state global di memori (cermin dari IndexedDB) */
  let state = { debtors: [], loans: [], payments: [] };
  let debtorFilter = "all";      // all | due | lunas
  let debtorQuery = "";
  let pendingToast = null;        // toast yang tampil setelah navigasi
  let sheetAttachments = [];      // lampiran sementara saat menambah pinjaman
  let debtorPhoto = null;         // foto sementara saat menambah/ubah debitur (dataURL)
  let deferredPrompt = null;      // event beforeinstallprompt
  let installDismissed = false;

  /* ---------------------------------------------------------
     Util kecil
     --------------------------------------------------------- */
  const rupiah = Calc.rupiah;
  const rupiahShort = Calc.rupiahShort;
  const tanggal = Calc.tanggal;
  const relTime = Calc.waktuRelatif;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function icon(id, size) {
    const s = size ? ` style="width:${size}px;height:${size}px"` : "";
    return `<svg${s} aria-hidden="true"><use href="#${id}"/></svg>`;
  }
  function shade(hex, f) {
    const m = String(hex).replace("#", "");
    if (m.length < 6) return hex;
    const c = (i) => clamp(Math.round(parseInt(m.slice(i, i + 2), 16) * f), 0, 255);
    const h = (n) => n.toString(16).padStart(2, "0");
    return "#" + h(c(0)) + h(c(2)) + h(c(4));
  }
  function avatarHtml(d, size) {
    const cls = size === "lg" ? " lg" : size === "sm" ? " sm" : "";
    if (d.photo) {
      return `<div class="avatar${cls} has-photo"><img src="${d.photo}" alt="" loading="lazy"></div>`;
    }
    const base = d.color || Calc.avatarColor(d.name || "?");
    const bg = `linear-gradient(135deg, ${shade(base, 0.95)}, ${shade(base, 0.72)})`;
    const inner = d.emoji ? `<span class="em">${d.emoji}</span>` : escapeHtml(Calc.initials(d.name));
    return `<div class="avatar${cls}" style="background:${bg}">${inner}</div>`;
  }
  function statusPill(sum) {
    if (sum.totalBorrowed === 0) return `<span class="pill neutral"><span class="dotk"></span>Baru</span>`;
    if (sum.hasDebt) return `<span class="pill due"><span class="dotk"></span>Berutang</span>`;
    return `<span class="pill lunas"><span class="dotk"></span>Lunas</span>`;
  }
  const byId = (store, id) => state[store].find((x) => x.id === id);

  /* ilustrasi SVG ringan (on-brand, tanpa IP) */
  const ART = {
    hero: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="30" y="20" width="60" height="80" rx="10" fill="#fff" opacity=".95"/>
      <rect x="46" y="13" width="28" height="14" rx="7" fill="#2F8169"/>
      <rect x="40" y="40" width="40" height="6" rx="3" fill="#B5E8D2"/>
      <rect x="40" y="54" width="28" height="6" rx="3" fill="#D6F1E5"/>
      <rect x="40" y="68" width="34" height="6" rx="3" fill="#D6F1E5"/>
      <circle cx="84" cy="86" r="20" fill="#FFB38A"/>
      <text x="84" y="93" text-anchor="middle" font-size="20" font-weight="800" fill="#fff" font-family="sans-serif">Rp</text>
    </svg>`,
    ledger: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="22" y="20" width="64" height="84" rx="12" fill="#EAF8F1"/>
      <rect x="34" y="14" width="40" height="84" rx="12" fill="#fff" stroke="#D6F1E5" stroke-width="2"/>
      <rect x="44" y="34" width="34" height="6" rx="3" fill="#B5E8D2"/>
      <rect x="44" y="48" width="24" height="6" rx="3" fill="#E2E8E2"/>
      <rect x="44" y="62" width="30" height="6" rx="3" fill="#E2E8E2"/>
      <circle cx="86" cy="86" r="22" fill="#8FDCC2"/>
      <path d="M77 86l6 6 12-13" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    calm: `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="42" fill="#F2F1FF"/>
      <path d="M40 64c6 8 34 8 40 0" stroke="#B8B5FF" stroke-width="4" stroke-linecap="round"/>
      <circle cx="48" cy="52" r="3.5" fill="#8E89F0"/>
      <circle cx="72" cy="52" r="3.5" fill="#8E89F0"/>
      <path d="M84 34l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#FFB38A"/>
    </svg>`,
  };

  /* ---------------------------------------------------------
     Render shell
     --------------------------------------------------------- */
  function navItem(key, href, ic, label, active) {
    return `<a class="nav-item${active === key ? " active" : ""}" href="${href}">${icon(ic)}<span>${label}</span></a>`;
  }
  function bottomNav(active) {
    return `<nav class="bottom-nav">
      ${navItem("home", "#/", "ic-home", "Beranda", active)}
      ${navItem("peminjam", "#/peminjam", "ic-users", "Debitur", active)}
      <div class="nav-fab-slot"><button class="fab" data-act="quick-add" aria-label="Tambah">${icon("ic-plus")}</button></div>
      ${navItem("statistik", "#/statistik", "ic-chart", "Statistik", active)}
      ${navItem("lainnya", "#/lainnya", "ic-more", "Lainnya", active)}
    </nav>`;
  }
  function render(inner, opts = {}) {
    const nav = opts.nav !== false;
    const screenCls = "screen" + (nav ? "" : " no-nav") + (opts.fab ? " has-fab" : "");
    $app.innerHTML =
      `<div class="${screenCls}">${inner}</div>` +
      (nav ? bottomNav(opts.active || "") : "") +
      (opts.fab ? `<button class="fab-float" data-act="${opts.fab.act}" ${opts.fab.data || ""} aria-label="${opts.fab.label}">${icon("ic-plus")}</button>` : "") +
      `<div class="toast-host"></div>`;
    const sc = $app.querySelector(".screen");
    if (sc) sc.scrollTop = 0;
    if (pendingToast) { toast(pendingToast.text, pendingToast.type); pendingToast = null; }
  }

  /* ---------------------------------------------------------
     BERANDA
     --------------------------------------------------------- */
  function renderHome() {
    const g = Calc.globalSummary(state.debtors, state.loans, state.payments);
    const rem = Calc.reminders(state.debtors, state.loans, state.payments);

    if (state.debtors.length === 0) {
      render(`
        ${topbarBrand(rem.length)}
        <div class="empty" style="margin-top:30px">
          <div class="e-art">${ART.ledger}</div>
          <h3>Mulai catat piutangmu</h3>
          <p>Belum ada data. Tambahkan debitur pertamamu, atau muat data contoh untuk melihat cara kerjanya.</p>
          <div class="empty-actions">
            <button class="btn btn-primary" data-act="add-debtor">${icon("ic-user-plus")} Tambah Debitur</button>
            <button class="btn btn-soft" data-act="seed">${icon("ic-coins")} Muat Data Contoh</button>
          </div>
        </div>
      `, { active: "home" });
      return;
    }

    // debitur teraktif (punya sisa) diurutkan sisa terbesar, lalu aktivitas terbaru
    const cards = state.debtors
      .map((d) => ({ d, s: Calc.debtorSummary(d, state.loans, state.payments) }))
      .sort((a, b) => (b.s.remaining - a.s.remaining) || ((b.s.lastActivity || 0) - (a.s.lastActivity || 0)))
      .slice(0, 5);

    const remPreview = rem.slice(0, 2).map(remCardHtml).join("");

    render(`
      ${topbarBrand(rem.length)}
      <div class="hero">
        <div class="hero-art">${ART.hero}</div>
        <div class="hero-label">Total Piutang Aktif</div>
        <div class="hero-amount tnum">${rupiah(g.totalActive)}</div>
        <span class="hero-sub">${icon("ic-users", 14)} ${g.activeDebtors} dari ${g.debtorCount} debitur masih berutang</span>
      </div>

      <div class="stat-row stagger">
        ${statCard("ic-users", "ic-lav", "Total Debitur", String(g.debtorCount))}
        ${statCard("ic-wallet", "ic-orange", "Masih Berutang", String(g.activeDebtors))}
        ${statCard("ic-trend", "ic-mint", "Pelunasan", g.repaymentRate + "%")}
      </div>

      ${rem.length ? `
        <div class="sec-head"><h2>Pengingat</h2><a class="link" href="#/pengingat">Lihat semua ${icon("ic-chevron", 14)}</a></div>
        <div class="list">${remPreview}</div>` : ""}

      <div class="sec-head"><h2>Debitur</h2><a class="link" href="#/peminjam">Lihat semua ${icon("ic-chevron", 14)}</a></div>
      <div class="list stagger">${cards.map(({ d, s }) => debtorRow(d, s)).join("")}</div>
      <div style="height:8px"></div>
    `, { active: "home" });

    maybeInstallBanner();
  }

  function topbarBrand(remCount) {
    return `<header class="topbar brand">
      <div class="brand-mark"><img class="logo" src="icons/icon-192.png" alt="">Piutang<b>Ku</b></div>
      <span class="tb-spacer"></span>
      <button class="icon-btn ghost dot-badge" data-count="${remCount || 0}" data-act="go" data-go="/pengingat" aria-label="Pengingat">${icon("ic-bell")}</button>
    </header>`;
  }
  function statCard(ic, tone, label, value) {
    return `<div class="stat-card"><div class="stat-ic ${tone}">${icon(ic)}</div>
      <div class="stat-label">${label}</div><div class="stat-value tnum">${escapeHtml(value)}</div></div>`;
  }
  function debtorRow(d, s) {
    const right = s.totalBorrowed === 0
      ? `<div class="row-amt muted">—</div><div class="tiny">belum ada pinjaman</div>`
      : s.hasDebt
        ? `<div class="row-amt due tnum">${rupiah(s.remaining)}</div><div class="tiny">sisa</div>`
        : `<div class="row-amt tnum" style="color:var(--pos)">Lunas</div><div class="tiny">${s.loanCount} pinjaman</div>`;
    const activity = s.lastActivity ? "Aktivitas " + relTime(s.lastActivity) : "Debitur baru";
    return `<button class="row-card" data-act="go" data-go="/peminjam/${d.id}">
      ${avatarHtml(d)}
      <div class="row-main">
        <div class="row-name">${escapeHtml(d.name)}</div>
        <div class="row-sub">
          ${d.tag ? `<span class="pill mint row-tag">${escapeHtml(d.tag)}</span>` : ""}
          <span class="row-act">${activity}</span>
        </div>
      </div>
      <div class="row-right">${right}</div>
      <span class="row-chevron">${icon("ic-chevron")}</span>
    </button>`;
  }

  /* ---------------------------------------------------------
     DAFTAR DEBITUR
     --------------------------------------------------------- */
  function renderDebtors() {
    render(`
      <header class="topbar solid">
        <span class="tb-title">Daftar Debitur</span>
        <button class="icon-btn" data-act="add-debtor" aria-label="Tambah debitur">${icon("ic-user-plus")}</button>
      </header>
      <div class="search-wrap">${icon("ic-search")}
        <input type="search" placeholder="Cari nama debitur…" data-input="search" value="${escapeHtml(debtorQuery)}" autocomplete="off">
      </div>
      <div class="tabs">
        <button class="tab${debtorFilter === "all" ? " active" : ""}" data-act="filter" data-val="all">Semua</button>
        <button class="tab${debtorFilter === "due" ? " active" : ""}" data-act="filter" data-val="due">Masih Berutang</button>
        <button class="tab${debtorFilter === "lunas" ? " active" : ""}" data-act="filter" data-val="lunas">Lunas</button>
      </div>
      <div class="list stagger" id="debtor-list" style="margin-top:14px">${debtorListHtml()}</div>
      <div style="height:8px"></div>
    `, { active: "peminjam" });
  }
  function debtorListHtml() {
    const q = debtorQuery.trim().toLowerCase();
    let rows = state.debtors.map((d) => ({ d, s: Calc.debtorSummary(d, state.loans, state.payments) }));
    if (debtorFilter === "due") rows = rows.filter((r) => r.s.hasDebt);
    else if (debtorFilter === "lunas") rows = rows.filter((r) => r.s.totalBorrowed > 0 && !r.s.hasDebt);
    if (q) rows = rows.filter((r) => r.d.name.toLowerCase().includes(q) || (r.d.tag || "").toLowerCase().includes(q));
    rows.sort((a, b) => (b.s.remaining - a.s.remaining) || a.d.name.localeCompare(b.d.name));
    if (!rows.length) {
      return `<div class="empty" style="padding:40px 20px">
        <div class="e-art" style="width:90px;height:90px">${ART.calm}</div>
        <h3 style="font-size:16px">Tidak ditemukan</h3>
        <p>Coba ubah kata kunci atau filter.</p></div>`;
    }
    return rows.map(({ d, s }) => debtorRow(d, s)).join("");
  }
  function refreshDebtorList() {
    const list = document.getElementById("debtor-list");
    if (list) list.innerHTML = debtorListHtml();
  }

  /* ---------------------------------------------------------
     PROFIL DEBITUR
     --------------------------------------------------------- */
  function renderProfile(id) {
    const d = byId("debtors", id);
    if (!d) { go("/peminjam"); return; }
    const s = Calc.debtorSummary(d, state.loans, state.payments);
    const ts = Calc.trustScore(d, state.loans, state.payments);

    const loansHtml = s.loans.length
      ? s.loans.map((l) => loanCard(l)).join("")
      : `<div class="center muted" style="padding:18px 10px;font-size:13px">Belum ada pinjaman untuk debitur ini.</div>`;

    render(`
      <header class="topbar">
        <button class="icon-btn ghost" data-act="back" aria-label="Kembali">${icon("ic-back")}</button>
        <span class="tb-spacer"></span>
        <button class="icon-btn ghost" data-act="edit-debtor" data-id="${d.id}" aria-label="Ubah">${icon("ic-edit")}</button>
        <button class="icon-btn ghost" data-act="del-debtor" data-id="${d.id}" aria-label="Hapus">${icon("ic-trash")}</button>
      </header>

      <div class="profile-head">
        <div class="profile-top">
          ${avatarHtml(d, "lg")}
          <div style="min-width:0">
            <div class="profile-name">${escapeHtml(d.name)}</div>
            <div class="profile-meta">
              ${d.tag ? `<span class="profile-contact">${icon("ic-tag")} ${escapeHtml(d.tag)}</span>` : ""}
              ${d.phone ? `<a class="profile-contact" href="tel:${encodeURIComponent(d.phone)}">${icon("ic-phone")} ${escapeHtml(d.phone)}</a>` : ""}
            </div>
          </div>
        </div>
        ${d.note ? `<div class="profile-note"><span class="nlabel">Catatan</span>${escapeHtml(d.note)}</div>` : ""}
      </div>

      ${trustHtml(d, ts)}

      <div class="summary">
        <h3>Ringkasan</h3>
        <div class="sum-grid">
          <div class="sum-cells">
            <div class="sum-cell"><div class="scl">Total Dipinjam</div><div class="scv tnum">${rupiahShort(s.totalBorrowed)}</div></div>
            <div class="sum-cell dim"><div class="scl">Sudah Dibayar</div><div class="scv tnum">${rupiahShort(s.totalPaid)}</div></div>
            <div class="sum-cell due"><div class="scl">Sisa</div><div class="scv tnum">${rupiahShort(s.remaining)}</div></div>
          </div>
          <div class="progress">
            <div class="progress-track"><div class="progress-fill mint" style="width:${s.percent}%">${s.percent >= 18 ? `<span class="progress-pct">${s.percent}%</span>` : ""}</div></div>
            <div class="progress-meta"><span>${s.percent}% terbayar</span><span>${rupiah(s.totalPaid)} / ${rupiah(s.totalBorrowed)}</span></div>
          </div>
        </div>
      </div>

      <div class="sec-head"><h2>Pinjaman</h2>
        <button class="add-loan-link" data-act="add-loan" data-debtor="${d.id}">${icon("ic-plus")} Tambah</button></div>
      <div class="list stagger">${loansHtml}</div>
      <div style="height:18px"></div>
    `, { nav: false, fab: { act: "add-loan", data: `data-debtor="${d.id}"`, label: "Tambah pinjaman" } });
  }

  function trustHtml(d, ts) {
    if (ts.score === null) {
      return `<div class="trust">
        <div class="trust-top">
          <div class="trust-gauge">${Charts.gauge(0, "var(--lav-300)")}<div class="gnum">–</div></div>
          <div class="trust-info"><div class="tlabel">Skor Kepercayaan</div>
            <div class="trust-cat"><span style="color:var(--lav-700)">⚪ Baru</span></div></div>
        </div>
        <div class="trust-hint">${escapeHtml(ts.reason)}</div>
      </div>`;
    }
    const colorMap = { green: "var(--pos)", yellow: "var(--warn)", red: "var(--due)" };
    const col = colorMap[ts.color] || "var(--mint-500)";
    const bars = trustBars(d).map((b) =>
      `<div class="tbar-row"><span class="tbar-label">${b.label}</span>
        <span class="tbar-track"><span class="tbar-fill" style="width:${b.val}%;background:${b.color}"></span></span>
        <span class="tbar-val">${b.val}</span></div>`).join("");
    return `<div class="trust">
      <div class="trust-top">
        <div class="trust-gauge">${Charts.gauge(ts.score, col)}<div class="gnum">${ts.score}</div></div>
        <div class="trust-info">
          <div class="tlabel">Skor Kepercayaan</div>
          <div class="trust-cat"><span>${ts.emoji}</span><span style="color:${col}">${ts.label}</span></div>
        </div>
      </div>
      <div class="trust-bars">${bars}</div>
      <div class="trust-hint">${icon("ic-info", 12)} ${escapeHtml(cap(ts.reason))}</div>
    </div>`;
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  function trustBars(d) {
    const s = Calc.debtorSummary(d, state.loans, state.payments);
    const active = s.loans.filter((l) => !Calc.loanSummary(l, state.payments).lunas);
    const settled = s.loans.filter((l) => Calc.loanSummary(l, state.payments).lunas);
    const lastT = (l, ls) => ls.payments.length ? new Date(ls.payments[ls.payments.length - 1].date).getTime() : new Date(l.date).getTime();

    const repay = s.totalBorrowed > 0 ? s.percent : 0;

    let punct = 100;
    if (active.length) {
      let oldest = 0;
      active.forEach((l) => {
        const ls = Calc.loanSummary(l, state.payments);
        const idle = Math.floor((Date.now() - lastT(l, ls)) / DAY);
        if (idle > oldest) oldest = idle;
      });
      punct = Math.round(100 * clamp(1 - Math.max(0, oldest - 30) / 90, 0, 1));
    }

    let speed;
    if (!settled.length) speed = active.length ? 50 : 100;
    else {
      let total = 0;
      settled.forEach((l) => {
        const ls = Calc.loanSummary(l, state.payments);
        total += Math.max(0, Math.round((lastT(l, ls) - new Date(l.date).getTime()) / DAY));
      });
      speed = Math.round(100 * clamp(1 - Math.max(0, total / settled.length - 15) / 75, 0, 1));
    }
    return [
      { label: "Pelunasan", val: repay, color: "var(--mint-500)" },
      { label: "Ketepatan", val: punct, color: "var(--lav-500)" },
      { label: "Kecepatan", val: speed, color: "var(--orange-500)" },
    ];
  }

  function loanCard(l) {
    const ls = Calc.loanSummary(l, state.payments);
    return `<button class="loan-card${ls.lunas ? " settled" : ""}" data-act="go" data-go="/pinjaman/${l.id}">
      <div class="loan-top">
        <div><div class="loan-title">${escapeHtml(l.description || "Pinjaman")}</div>
          <div class="loan-date">${tanggal(l.date)}${l.attachments && l.attachments.length ? " · " + icon("ic-image", 11) + " " + l.attachments.length : ""}</div></div>
        <div class="loan-amt tnum">${rupiah(l.amount)}</div>
      </div>
      <div class="loan-stats">
        <div class="ls"><span class="k">Dibayar</span><span class="v paid tnum">${rupiah(ls.paid)}</span></div>
        <div class="ls" style="text-align:right"><span class="k">${ls.lunas ? "Status" : "Sisa"}</span>
          <span class="v ${ls.lunas ? "" : "due"} tnum">${ls.lunas ? "Lunas ✓" : rupiah(ls.remaining)}</span></div>
      </div>
      <div class="mini-prog"><span style="width:${ls.percent}%"></span></div>
    </button>`;
  }

  /* ---------------------------------------------------------
     DETAIL PINJAMAN (timeline)
     --------------------------------------------------------- */
  function renderLoan(id) {
    const l = byId("loans", id);
    if (!l) { go("/peminjam"); return; }
    const d = byId("debtors", l.debtorId);
    const ls = Calc.loanSummary(l, state.payments);

    // bangun timeline
    let items = `<div class="tl-item">
        <div class="tl-node add">${icon("ic-receipt")}</div>
        <div class="tl-body"><div><div class="tt">Pinjaman dibuat</div><div class="dd">${tanggal(l.date, "long")}</div></div>
          <div class="vv add tnum">${rupiah(l.amount)}</div></div>
      </div>`;
    ls.payments.forEach((p) => {
      items += `<div class="tl-item">
        <div class="tl-node pay">${icon("ic-check")}</div>
        <div class="tl-body">
          <div><div class="tt">Pembayaran${p.note ? " · " + escapeHtml(p.note) : ""}</div><div class="dd">${tanggal(p.date, "long")}</div></div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="vv pay tnum">${rupiah(p.amount)}</div>
            <button class="tl-del" data-act="del-payment" data-id="${p.id}" data-loan="${l.id}" aria-label="Hapus pembayaran">${icon("ic-trash")}</button>
          </div>
        </div>
      </div>`;
    });
    items += ls.lunas
      ? `<div class="tl-item"><div class="tl-node pay">${icon("ic-check-circle")}</div>
          <div class="tl-body"><div class="tt" style="color:var(--pos)">Lunas 🎉</div><div class="vv pay">Selesai</div></div></div>`
      : `<div class="tl-item"><div class="tl-node rest">${icon("ic-clock")}</div>
          <div class="tl-body"><div class="tt">Sisa belum dibayar</div><div class="vv rest tnum">${rupiah(ls.remaining)}</div></div></div>`;

    const attachments = (l.attachments && l.attachments.length) || true ? `
      <div class="summary"><h3>Bukti / Lampiran</h3>
        <div class="attach-row" style="margin-top:0">
          ${(l.attachments || []).map((a, i) => `<div class="attach-thumb"><img src="${a.dataUrl}" alt="${escapeHtml(a.name || "bukti")}">
            <button class="x" data-act="del-attach" data-loan="${l.id}" data-idx="${i}" aria-label="Hapus">${icon("ic-x")}</button></div>`).join("")}
          <button class="attach-add" data-act="add-attach" data-loan="${l.id}" aria-label="Tambah bukti">${icon("ic-plus")}</button>
        </div>
      </div>` : "";

    render(`
      <header class="topbar">
        <button class="icon-btn ghost" data-act="back" aria-label="Kembali">${icon("ic-back")}</button>
        <span class="tb-title">Detail Pinjaman</span>
        <button class="icon-btn ghost" data-act="edit-loan" data-id="${l.id}" aria-label="Ubah pinjaman">${icon("ic-edit")}</button>
        <button class="icon-btn ghost" data-act="del-loan" data-id="${l.id}" aria-label="Hapus pinjaman">${icon("ic-trash")}</button>
      </header>

      <div class="tl-card">
        <div class="tl-head">
          <div><div class="tlt">${escapeHtml(l.description || "Pinjaman")}</div>
            <div class="tld">${d ? escapeHtml(d.name) : "—"} · ${tanggal(l.date)}</div></div>
          <div class="tl-chip tnum">${rupiah(l.amount)}</div>
        </div>
        <div class="tl-sum">
          <div class="c tot"><div class="k">Total</div><div class="v tnum">${rupiahShort(l.amount)}</div></div>
          <div class="c paid"><div class="k">Dibayar</div><div class="v tnum">${rupiahShort(ls.paid)}</div></div>
          <div class="c due"><div class="k">Sisa</div><div class="v tnum">${rupiahShort(ls.remaining)}</div></div>
        </div>
      </div>

      <div class="block-title" style="margin:20px 22px 4px">Riwayat</div>
      <div class="timeline">${items}</div>

      ${attachments}

      ${ls.lunas
        ? `<div class="btn-block-pad"><button class="btn btn-soft" disabled>${icon("ic-check-circle")} Pinjaman Sudah Lunas</button></div>`
        : `<div class="btn-block-pad"><button class="btn btn-primary" data-act="add-payment" data-loan="${l.id}">${icon("ic-plus-circle")} Catat Pembayaran</button></div>`}
      <div style="height:8px"></div>
    `, { nav: false });
  }

  /* ---------------------------------------------------------
     STATISTIK
     --------------------------------------------------------- */
  function renderStats() {
    const g = Calc.globalSummary(state.debtors, state.loans, state.payments);
    if (state.loans.length === 0) {
      render(`
        <header class="topbar solid"><span class="tb-title">Statistik</span></header>
        <div class="empty" style="margin-top:30px"><div class="e-art">${ART.calm}</div>
          <h3>Belum ada statistik</h3><p>Tambahkan pinjaman terlebih dahulu untuk melihat grafik dan ringkasan.</p>
          <button class="btn btn-primary" style="width:auto" data-act="quick-add">${icon("ic-plus")} Tambah Data</button></div>
      `, { active: "statistik" });
      return;
    }

    // pinjaman per bulan (6 bulan terakhir)
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: dt.getFullYear(), m: dt.getMonth(), label: dt.toLocaleDateString("id-ID", { month: "short" }), sum: 0 });
    }
    state.loans.forEach((l) => {
      const dt = new Date(l.date);
      const slot = months.find((x) => x.y === dt.getFullYear() && x.m === dt.getMonth());
      if (slot) slot.sum += Number(l.amount) || 0;
    });
    const windowTotal = months.reduce((a, b) => a + b.sum, 0);

    // piutang terbesar
    const top = state.debtors
      .map((d) => ({ d, s: Calc.debtorSummary(d, state.loans, state.payments) }))
      .filter((r) => r.s.remaining > 0)
      .sort((a, b) => b.s.remaining - a.s.remaining)
      .slice(0, 5);
    const maxRem = top.length ? top[0].s.remaining : 1;

    render(`
      <header class="topbar solid"><span class="tb-title">Statistik</span></header>

      <div class="stat-hero">
        <div class="sh-label">Pinjaman diberikan · 6 bulan terakhir</div>
        <div class="sh-amt tnum">${rupiah(windowTotal)}</div>
        <div class="chart-area">${Charts.areaChart(months.map((x) => x.sum), { labels: months.map((x) => x.label) })}</div>
      </div>

      <div class="block-title" style="margin:22px 20px 10px">Komposisi Piutang</div>
      <div class="donut-card">
        <div class="donut-wrap">${Charts.donut(g.repaymentRate)}
          <div class="donut-center"><div class="dc-pct">${g.repaymentRate}%</div></div>
        </div>
        <div class="legend">
          <div class="legend-item"><span class="lg-dot" style="background:var(--mint-500)"></span>
            <div class="lg-txt"><div class="t">Sudah Dibayar</div><div class="v tnum">${rupiah(g.totalPaid)}</div></div></div>
          <div class="legend-item"><span class="lg-dot" style="background:var(--orange-300)"></span>
            <div class="lg-txt"><div class="t">Sisa Piutang</div><div class="v tnum">${rupiah(g.totalActive)}</div></div></div>
        </div>
      </div>

      <div class="mini-stat-grid" style="margin-top:14px">
        ${miniStat("ic-users", "ic-lav", "Total Debitur", String(g.debtorCount))}
        ${miniStat("ic-wallet", "ic-orange", "Masih Berutang", String(g.activeDebtors))}
        ${miniStat("ic-receipt", "ic-mint", "Total Pinjaman", String(g.loanCount))}
        ${miniStat("ic-coins", "ic-lav", "Total Pembayaran", String(g.paymentCount))}
      </div>

      ${top.length ? `
        <div class="block-title" style="margin:24px 20px 10px">Piutang Terbesar</div>
        <div class="bar-list">
          ${top.map(({ d, s }) => `
            <div class="bar-item">
              <div class="bh"><div class="bn">${avatarHtml(d, "sm")} ${escapeHtml(d.name)}</div><div class="bv tnum">${rupiah(s.remaining)}</div></div>
              <div class="bt"><div class="bf" style="width:${Math.round((s.remaining / maxRem) * 100)}%"></div></div>
            </div>`).join("")}
        </div>` : ""}
      <div style="height:14px"></div>
    `, { active: "statistik" });
  }
  function miniStat(ic, tone, k, v) {
    return `<div class="mini-stat"><div class="mic ${tone}">${icon(ic)}</div>
      <div class="mt"><div class="k">${k}</div><div class="v tnum">${escapeHtml(v)}</div></div></div>`;
  }

  /* ---------------------------------------------------------
     PENGINGAT
     --------------------------------------------------------- */
  function renderReminders() {
    const rem = Calc.reminders(state.debtors, state.loans, state.payments);
    render(`
      <header class="topbar solid">
        <button class="icon-btn" data-act="back" aria-label="Kembali">${icon("ic-back")}</button>
        <span class="tb-title">Pengingat</span><span style="width:42px"></span>
      </header>
      ${rem.length ? `<div class="list stagger" style="margin-top:6px">${rem.map(remCardHtml).join("")}</div>
        <div class="io-info"><span>${icon("ic-info")}</span><div class="it"><b>Pengingat otomatis</b>Muncul untuk debitur yang masih punya sisa dan sudah lama tidak melakukan pembayaran.</div></div>`
        : `<div class="empty" style="margin-top:30px"><div class="e-art">${ART.calm}</div>
            <h3>Semua aman 👌</h3><p>Tidak ada pengingat saat ini. Tidak ada pembayaran yang tertunda terlalu lama.</p></div>`}
      <div style="height:14px"></div>
    `, { nav: false });
  }
  function remCardHtml(r) {
    const sev = r.severity === "high" ? " over" : "";
    return `<button class="rem-card${sev}" data-act="go" data-go="/peminjam/${r.debtorId}">
      <div class="rem-ic">${icon("ic-alert")}</div>
      <div class="rem-main"><div class="rn">${escapeHtml(r.name)}</div><div class="rd">${escapeHtml(r.message)}</div></div>
      <div class="rem-amt tnum">${rupiah(r.remaining)}</div>
    </button>`;
  }

  /* ---------------------------------------------------------
     LAINNYA
     --------------------------------------------------------- */
  function renderMore() {
    const g = Calc.globalSummary(state.debtors, state.loans, state.payments);
    const rem = Calc.reminders(state.debtors, state.loans, state.payments);
    render(`
      <header class="topbar solid"><span class="tb-title">Lainnya</span></header>
      <div class="menu-group">
        ${menuItem("ic-bell", "ic-orange", "Pengingat", rem.length ? `${rem.length} perlu perhatian` : "Tidak ada", "go", `data-go="/pengingat"`)}
        ${menuItem("ic-folder", "ic-lav", "Cadangkan & Pulihkan", "Backup / restore data (.json)", "go", `data-go="/data"`)}
      </div>
      <div class="menu-group">
        ${menuItem("ic-coins", "ic-mint", "Muat Data Contoh", "Isi aplikasi dengan data demo", "seed", "")}
        ${menuItem("ic-info", "ic-lav", "Tentang PiutangKu", "Versi & informasi aplikasi", "about", "")}
      </div>
      <div class="menu-group">
        ${menuItem("ic-trash", "ic-orange", "Hapus Semua Data", "Mengosongkan seluruh catatan", "clear-all", "", true)}
      </div>
      <div class="center muted" style="font-size:11.5px;margin:18px 20px 6px;line-height:1.5">
        PiutangKu · Buku Piutang Digital<br>${g.debtorCount} debitur · ${g.loanCount} pinjaman · ${g.paymentCount} pembayaran<br>
        Semua data tersimpan di perangkat ini.
      </div>
      <div style="height:8px"></div>
    `, { active: "lainnya" });
  }
  function menuItem(ic, tone, title, desc, act, data, danger) {
    return `<button class="menu-item${danger ? " danger" : ""}" data-act="${act}" ${data || ""}>
      <div class="menu-ic ${tone}">${icon(ic)}</div>
      <div class="menu-txt"><div class="mt">${title}</div><div class="md">${desc}</div></div>
      <span class="chev">${icon("ic-chevron")}</span>
    </button>`;
  }

  /* ---------------------------------------------------------
     CADANGKAN & PULIHKAN
     --------------------------------------------------------- */
  function renderData() {
    render(`
      <header class="topbar solid">
        <button class="icon-btn" data-act="back" aria-label="Kembali">${icon("ic-back")}</button>
        <span class="tb-title">Cadangkan & Pulihkan</span><span style="width:42px"></span>
      </header>
      <div class="io-card exp">
        <h3>${icon("ic-download")} Cadangkan Data</h3>
        <p>Simpan seluruh catatan ke satu berkas <b>.json</b>. Berguna untuk pindah perangkat atau berjaga-jaga.</p>
        <button class="btn btn-ghost" data-act="export">${icon("ic-download")} Unduh File Cadangan</button>
      </div>
      <div class="io-card imp" style="margin-top:14px">
        <h3>${icon("ic-upload")} Pulihkan Data</h3>
        <p>Muat berkas cadangan <b>.json</b>. Kamu bisa mengganti seluruh data atau menggabungkannya.</p>
        <button class="btn btn-ghost" data-act="import-pick">${icon("ic-upload")} Pilih File Cadangan</button>
      </div>
      <div class="io-info"><span>${icon("ic-shield")}</span>
        <div class="it"><b>Privasi</b>Datamu tidak pernah dikirim ke mana pun. Semuanya tersimpan lokal di browser perangkat ini.</div></div>
      <div style="height:14px"></div>
    `, { nav: false });
  }

  /* ---------------------------------------------------------
     SHEET & DIALOG
     --------------------------------------------------------- */
  function closeScrim() {
    $app.querySelectorAll(".scrim").forEach((sc) => {
      sc.classList.remove("show");
      setTimeout(() => sc.remove(), 300);
    });
  }
  // Pasang scrim secara deterministik:
  // 1) buang scrim lama SEKARANG (bukan setelah 300ms) agar tak ada dua scrim bertumpuk
  //    — inilah sumber bug "hanya muncul blur" saat membuka sheet dari sheet lain.
  // 2) paksa reflow agar gaya awal (translateY/scale/opacity) ter-commit sebelum .show,
  //    sehingga transisi buka SELALU berjalan (tidak kadang gagal seperti pada rAF tunggal).
  function mountScrim(wrap) {
    $app.querySelectorAll(".scrim").forEach((sc) => sc.remove());
    $app.appendChild(wrap);
    void wrap.getBoundingClientRect();
    requestAnimationFrame(() => wrap.classList.add("show"));
    return wrap;
  }
  function openSheet(title, body) {
    const wrap = document.createElement("div");
    wrap.className = "scrim";
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      <div class="sheet-head"><h3>${escapeHtml(title)}</h3>
        <button class="icon-btn" data-act="close-sheet" aria-label="Tutup">${icon("ic-x")}</button></div>
      <div class="sheet-body">${body}</div></div>`;
    return mountScrim(wrap);
  }
  function openDialog({ icon: dic, tone, title, msg, confirmLabel, confirmClass, act, data }) {
    const wrap = document.createElement("div");
    wrap.className = "scrim center";
    wrap.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true">
      <div class="dic ${tone || "ic-orange"}">${icon(dic || "ic-alert")}</div>
      <h3>${escapeHtml(title)}</h3><p>${escapeHtml(msg)}</p>
      <div class="dialog-actions">
        <button class="btn btn-ghost" data-act="close-sheet">Batal</button>
        <button class="btn ${confirmClass || "btn-danger"}" data-act="${act}" ${data || ""}>${escapeHtml(confirmLabel || "Hapus")}</button>
      </div></div>`;
    return mountScrim(wrap);
  }

  const TAGS = ["Tetangga", "Keluarga", "Teman", "Pelanggan", "Warung", "UMKM", "Lainnya"];

  // isi bingkai foto (kotak + tombol hapus); dipakai ulang saat refresh
  function photoFrameInner() {
    const box = `<div class="photo-box${debtorPhoto ? " has" : ""}" data-act="photo-pick" role="button" tabindex="0" aria-label="Pilih foto debitur">${
      debtorPhoto ? `<img src="${debtorPhoto}" alt="">` : `<span class="ph-empty">${icon("ic-camera")}</span>`
    }</div>`;
    const del = debtorPhoto ? `<button type="button" class="ph-del" data-act="photo-del" aria-label="Hapus foto">${icon("ic-x")}</button>` : "";
    return box + del;
  }
  function refreshPhotoBox() {
    const frame = $app.querySelector(".photo-frame");
    if (frame) frame.innerHTML = photoFrameInner();
    const btn = $app.querySelector(".photo-btn");
    if (btn) btn.innerHTML = `${icon("ic-camera")} ${debtorPhoto ? "Ganti Foto" : "Pilih Foto"}`;
  }
  function pickDebtorPhoto() {
    pickFile("image/*", false, async (files) => {
      if (!files.length) return;
      try { debtorPhoto = await resizeImage(files[0], 320); }
      catch (_) { toast("Gagal membaca gambar", "err"); return; }
      refreshPhotoBox();
    });
  }

  function debtorFormBody(d) {
    const tag = d ? (d.tag || "") : "";
    const isCustomTag = !!tag && !TAGS.includes(tag);     // label di luar daftar = ketik manual (Lainnya)
    const selected = isCustomTag ? "Lainnya" : tag;       // yang ditandai aktif di dropdown
    const ddItems = TAGS.map((t) =>
      `<button type="button" class="dd-item${selected === t ? " active" : ""}" data-act="dd-pick" data-val="${t}">${t}</button>`).join("");
    const triggerLabel = selected ? escapeHtml(selected) : "Pilih label";

    return `
      <div class="field photo-field">
        <div class="photo-pick">
          <div class="photo-frame">${photoFrameInner()}</div>
          <div class="photo-side">
            <div class="photo-title">Foto debitur <span class="opt">(opsional)</span></div>
            <div class="photo-desc">Pakai foto wajah agar mudah mengenali. Tersimpan di perangkat ini saja.</div>
            <button type="button" class="btn btn-soft sm photo-btn" data-act="photo-pick">${icon("ic-camera")} ${debtorPhoto ? "Ganti Foto" : "Pilih Foto"}</button>
          </div>
        </div>
      </div>

      <div class="field"><label>Nama debitur</label>
        <input class="input" id="f-name" placeholder="cth. Budi Santoso" value="${d ? escapeHtml(d.name) : ""}" autocomplete="off"></div>

      <div class="field"><label>No. telepon <span class="opt">(opsional)</span></label>
        <input class="input" id="f-phone" inputmode="tel" placeholder="cth. 0812-3456-7890" value="${d ? escapeHtml(d.phone || "") : ""}" autocomplete="off"></div>

      <div class="field"><label>Label <span class="opt">(opsional)</span></label>
        <div class="dd-wrap" data-dd>
          <button type="button" class="dd-trigger" data-act="dd-toggle" aria-expanded="false">
            <span class="dd-current${selected ? "" : " ph"}">${triggerLabel}</span>
            ${icon("ic-chevron-down")}
          </button>
          <div class="dd-panel hidden">${ddItems}</div>
        </div>
        <input type="hidden" id="f-tag" value="${escapeHtml(selected)}">
        <input class="input dd-custom" id="f-tag-custom" placeholder="Ketik label sendiri…" autocomplete="off"
          value="${isCustomTag ? escapeHtml(tag) : ""}" style="margin-top:8px;${selected === "Lainnya" ? "" : "display:none"}"></div>

      <div class="field"><label>Catatan <span class="opt">(opsional)</span></label>
        <textarea class="textarea" id="f-note" placeholder="cth. teman kerja, biasanya bayar tiap gajian">${d ? escapeHtml(d.note || "") : ""}</textarea></div>

      <button class="btn btn-primary" data-act="${d ? "save-debtor" : "create-debtor"}" ${d ? `data-id="${d.id}"` : ""}>
        ${icon("ic-check")} ${d ? "Simpan Perubahan" : "Simpan Debitur"}</button>`;
  }
  function openDebtorSheet(d) {
    debtorPhoto = d && d.photo ? d.photo : null;
    openSheet(d ? "Ubah Debitur" : "Debitur Baru", debtorFormBody(d));
  }

  function loanFormBody(debtorId) {
    const needPick = !debtorId;
    const options = state.debtors
      .slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((x) => `<option value="${x.id}"${x.id === debtorId ? " selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
    return `
      ${needPick ? `<div class="field"><label>Debitur</label>
        <div class="select-wrap"><select class="select" id="f-debtor"><option value="" disabled ${debtorId ? "" : "selected"}>Pilih debitur…</option>${options}</select></div></div>` : ""}
      <div class="field"><label>Jumlah pinjaman</label>
        <div class="input-icon"><span class="pre">Rp</span>
          <input class="input amount-input" id="f-amount" inputmode="numeric" data-input="rupiah" placeholder="0"></div></div>
      <div class="field"><label>Keterangan</label>
        <input class="input" id="f-desc" placeholder="cth. pinjam untuk servis motor" autocomplete="off"></div>
      <div class="field"><label>Tanggal pinjam</label>
        <input class="input" id="f-date" type="date" value="${Calc.todayISO()}"></div>
      <div class="field"><label>Bukti / lampiran <span class="opt">(opsional)</span></label>
        <div class="attach-row" id="f-attach">${attachThumbs()}
          <button class="attach-add" data-act="sheet-attach" aria-label="Tambah foto">${icon("ic-image")}</button></div></div>
      <button class="btn btn-primary" data-act="create-loan" ${debtorId ? `data-debtor="${debtorId}"` : ""}>${icon("ic-check")} Simpan Pinjaman</button>`;
  }
  function attachThumbs() {
    return sheetAttachments.map((a, i) => `<div class="attach-thumb"><img src="${a.dataUrl}" alt="">
      <button class="x" data-act="sheet-attach-del" data-idx="${i}" aria-label="Hapus">${icon("ic-x")}</button></div>`).join("");
  }
  function openAddLoan(debtorId) {
    if (state.debtors.length === 0) {
      toast("Tambahkan debitur dulu", "err");
      openDebtorSheet(null);
      return;
    }
    sheetAttachments = [];
    openSheet("Pinjaman Baru", loanFormBody(debtorId));
  }

  function openEditLoan(loanId) {
    const loan = byId("loans", loanId);
    if (!loan) return;
    sheetAttachments = (loan.attachments || []).slice();   // edit lampiran lewat buffer sementara
    openSheet("Ubah Pinjaman", `
      <div class="field"><label>Jumlah pinjaman</label>
        <div class="input-icon"><span class="pre">Rp</span>
          <input class="input amount-input" id="f-amount" inputmode="numeric" data-input="rupiah" value="${Number(loan.amount || 0).toLocaleString("id-ID")}"></div></div>
      <div class="field"><label>Keterangan</label>
        <input class="input" id="f-desc" placeholder="cth. pinjam untuk servis motor" value="${escapeHtml(loan.description || "")}" autocomplete="off"></div>
      <div class="field"><label>Tanggal pinjam</label>
        <input class="input" id="f-date" type="date" value="${loan.date || Calc.todayISO()}"></div>
      <div class="field"><label>Bukti / lampiran <span class="opt">(opsional)</span></label>
        <div class="attach-row" id="f-attach">${attachThumbs()}
          <button class="attach-add" data-act="sheet-attach" aria-label="Tambah foto">${icon("ic-image")}</button></div></div>
      <button class="btn btn-primary" data-act="save-loan" data-id="${loan.id}">${icon("ic-check")} Simpan Perubahan</button>`);
  }
  async function saveLoan(id) {
    const loan = byId("loans", id);
    if (!loan) return;
    const amount = Calc.parseRupiah(document.getElementById("f-amount").value);
    if (!amount || amount <= 0) { toast("Jumlah pinjaman belum benar", "err"); return; }
    const ls = Calc.loanSummary(loan, state.payments);
    if (amount < ls.paid) { toast("Tidak boleh kurang dari yang sudah dibayar (" + rupiah(ls.paid) + ")", "err"); return; }
    loan.amount = amount;
    loan.description = (document.getElementById("f-desc").value || "").trim() || "Pinjaman";
    loan.date = document.getElementById("f-date").value || loan.date || Calc.todayISO();
    loan.attachments = sheetAttachments.slice();
    await DB.put("loans", loan);
    sheetAttachments = [];
    await refresh();
    rerender();
    toast("Perubahan disimpan", "ok");
  }

  function paymentFormBody(loan) {
    const ls = Calc.loanSummary(loan, state.payments);
    const d = byId("debtors", loan.debtorId);
    const quick = [50000, 100000, 200000].filter((q) => q < ls.remaining);
    const chips = quick.map((q) => `<button class="quick-amt" data-act="quick-amt" data-val="${q}">+${rupiahShort(q)}</button>`).join("")
      + `<button class="quick-amt" data-act="quick-amt" data-val="${ls.remaining}" style="background:var(--pos-bg);color:var(--pos);border-color:transparent">Lunasi ${rupiahShort(ls.remaining)}</button>`;
    return `
      <div class="pay-ctx">
        <div><div class="pk">${d ? escapeHtml(d.name) : ""} · ${escapeHtml(loan.description || "Pinjaman")}</div>
          <div class="pt tnum">${rupiah(loan.amount)}</div></div>
        <div class="pr"><div class="k">Sisa</div><div class="v tnum">${rupiah(ls.remaining)}</div></div>
      </div>
      <div class="field"><label>Jumlah pembayaran</label>
        <div class="input-icon"><span class="pre">Rp</span>
          <input class="input amount-input" id="f-pay-amount" inputmode="numeric" data-input="rupiah" placeholder="0"></div></div>
      <div class="quick-amts">${chips}</div>
      <div class="field"><label>Tanggal bayar</label>
        <input class="input" id="f-pay-date" type="date" value="${Calc.todayISO()}"></div>
      <div class="field"><label>Catatan <span class="opt">(opsional)</span></label>
        <input class="input" id="f-pay-note" placeholder="cth. transfer / tunai" autocomplete="off"></div>
      <button class="btn btn-primary" data-act="create-payment" data-loan="${loan.id}">${icon("ic-check")} Catat Pembayaran</button>`;
  }
  function openAddPayment(loanId) {
    const loan = byId("loans", loanId);
    if (!loan) return;
    openSheet("Catat Pembayaran", paymentFormBody(loan));
  }

  function openQuickAdd() {
    openSheet("Tambah Baru", `
      <button class="menu-item" style="border-radius:14px;border-bottom:none;background:var(--mint-50);margin-bottom:10px" data-act="add-loan">
        <div class="menu-ic ic-mint">${icon("ic-receipt")}</div>
        <div class="menu-txt"><div class="mt">Pinjaman Baru</div><div class="md">Catat uang yang dipinjamkan</div></div>
        <span class="chev">${icon("ic-chevron")}</span></button>
      <button class="menu-item" style="border-radius:14px;border-bottom:none;background:var(--lav-50)" data-act="add-debtor">
        <div class="menu-ic ic-lav">${icon("ic-user-plus")}</div>
        <div class="menu-txt"><div class="mt">Debitur Baru</div><div class="md">Tambahkan orang yang berutang</div></div>
        <span class="chev">${icon("ic-chevron")}</span></button>`);
  }

  function openAbout() {
    openSheet("Tentang PiutangKu", `
      <div class="center" style="padding:6px 4px 10px">
        <img src="icons/icon-192.png" alt="" style="width:72px;height:72px;border-radius:20px;margin:0 auto 12px;box-shadow:var(--sh-md)">
        <h3 style="font-size:19px;font-weight:800;color:var(--ink)">PiutangKu</h3>
        <p class="muted" style="font-size:13px;margin-top:4px">Buku piutang digital · v1.0</p>
      </div>
      <p style="font-size:13.5px;color:var(--text);line-height:1.6;margin:6px 2px">
        Aplikasi sederhana untuk mencatat siapa yang masih berutang kepadamu dan berapa sisanya.
        Cocok untuk perorangan, warung, kos, dan UMKM. Bekerja sepenuhnya <b>offline</b> — semua data
        tersimpan di perangkatmu, tidak ada yang dikirim ke server.
      </p>
      <div class="io-info" style="margin:14px 0 0"><span>${icon("ic-shield")}</span>
        <div class="it"><b>Datamu milikmu</b>Cadangkan secara berkala lewat menu Cadangkan & Pulihkan agar tidak hilang saat mengganti perangkat atau membersihkan browser.</div></div>
      <button class="btn btn-soft" style="margin-top:16px" data-act="close-sheet">${icon("ic-check")} Mengerti</button>`);
  }

  /* ---------------------------------------------------------
     Aksi data (CRUD)
     --------------------------------------------------------- */
  async function saveDebtor(id) {
    const name = (document.getElementById("f-name").value || "").trim();
    if (!name) { toast("Nama wajib diisi", "err"); return; }
    const existing = id ? byId("debtors", id) : null;
    let tag = (document.getElementById("f-tag").value || "");
    if (tag === "Lainnya") {
      const custom = document.getElementById("f-tag-custom");
      tag = custom ? (custom.value || "").trim() : "";
    }
    const obj = {
      id: id || Calc.uid(),
      name,
      phone: (document.getElementById("f-phone").value || "").trim(),
      tag,
      photo: debtorPhoto || "",
      // pertahankan emoji/warna lama agar data lama tetap tampil (foto diprioritaskan saat render)
      emoji: existing ? (existing.emoji || "") : "",
      color: existing ? (existing.color || "") : "",
      note: (document.getElementById("f-note").value || "").trim(),
      createdAt: existing ? existing.createdAt : Calc.todayISO(),
    };
    await DB.put("debtors", obj);
    debtorPhoto = null;
    await refresh();
    if (id) { rerender(); toast("Perubahan disimpan", "ok"); }
    else { go("/peminjam/" + obj.id, { text: "Debitur ditambahkan", type: "ok" }); }
  }
  async function createLoan(ctxDebtor) {
    const debtorId = ctxDebtor || (document.getElementById("f-debtor") && document.getElementById("f-debtor").value);
    if (!debtorId) { toast("Pilih debitur dulu", "err"); return; }
    const amount = Calc.parseRupiah(document.getElementById("f-amount").value);
    if (!amount || amount <= 0) { toast("Jumlah pinjaman belum benar", "err"); return; }
    const desc = (document.getElementById("f-desc").value || "").trim();
    const date = document.getElementById("f-date").value || Calc.todayISO();
    const obj = {
      id: Calc.uid(), debtorId, amount, date,
      description: desc || "Pinjaman",
      attachments: sheetAttachments.slice(),
      createdAt: Calc.todayISO(),
    };
    await DB.put("loans", obj);
    sheetAttachments = [];
    await refresh();
    go("/pinjaman/" + obj.id, { text: "Pinjaman dicatat", type: "ok" });
  }
  async function createPayment(loanId) {
    const loan = byId("loans", loanId);
    if (!loan) return;
    const ls = Calc.loanSummary(loan, state.payments);
    const amount = Calc.parseRupiah(document.getElementById("f-pay-amount").value);
    if (!amount || amount <= 0) { toast("Jumlah pembayaran belum benar", "err"); return; }
    if (amount > ls.remaining) { toast("Melebihi sisa pinjaman (" + rupiah(ls.remaining) + ")", "err"); return; }
    const obj = {
      id: Calc.uid(), loanId, debtorId: loan.debtorId, amount,
      date: document.getElementById("f-pay-date").value || Calc.todayISO(),
      note: (document.getElementById("f-pay-note").value || "").trim(),
      createdAt: Calc.todayISO(),
    };
    await DB.put("payments", obj);
    await refresh();
    rerender();
    const after = Calc.loanSummary(byId("loans", loanId), state.payments);
    toast(after.lunas ? "Lunas! 🎉" : "Pembayaran dicatat", "ok");
  }

  async function delDebtor(id) {
    await DB.deleteDebtorCascade(id);
    await refresh();
    go("/peminjam", { text: "Debitur dihapus", type: "ok" });
  }
  async function delLoan(id) {
    const loan = byId("loans", id);
    const debtorId = loan ? loan.debtorId : null;
    await DB.deleteLoanCascade(id);
    await refresh();
    go(debtorId ? "/peminjam/" + debtorId : "/peminjam", { text: "Pinjaman dihapus", type: "ok" });
  }
  async function delPayment(id, loanId) {
    await DB.del("payments", id);
    await refresh();
    rerender();
    toast("Pembayaran dihapus", "ok");
  }
  async function delAttachment(loanId, idx) {
    const loan = byId("loans", loanId);
    if (!loan || !loan.attachments) return;
    loan.attachments.splice(idx, 1);
    await DB.put("loans", loan);
    await refresh();
    rerender();
    toast("Lampiran dihapus", "ok");
  }
  async function seedSample() {
    await DB.replaceAll(Calc.sampleData());
    await refresh();
    go("/", { text: "Data contoh dimuat", type: "ok" });
  }
  async function clearAllData() {
    await DB.clearAll();
    await refresh();
    go("/", { text: "Semua data dihapus", type: "ok" });
  }

  /* ---------------------------------------------------------
     Lampiran & import/export via file
     --------------------------------------------------------- */
  function pickFile(accept, multiple, cb) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = accept; inp.multiple = !!multiple;
    inp.style.display = "none";
    inp.addEventListener("change", () => { cb(Array.from(inp.files || [])); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  }
  function readAsDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  // Kecilkan & kompres gambar (untuk foto avatar) agar hemat penyimpanan & ukuran backup.
  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          try { resolve(canvas.toDataURL("image/jpeg", 0.85)); }
          catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function readAsText(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
  }

  function sheetAddAttachment() {
    pickFile("image/*", true, async (files) => {
      for (const f of files) {
        try { const url = await readAsDataURL(f); sheetAttachments.push({ name: f.name, type: f.type, dataUrl: url }); }
        catch (_) { toast("Gagal membaca gambar", "err"); }
      }
      const host = document.getElementById("f-attach");
      if (host) host.innerHTML = attachThumbs() + `<button class="attach-add" data-act="sheet-attach" aria-label="Tambah foto">${icon("ic-image")}</button>`;
    });
  }
  function loanAddAttachment(loanId) {
    pickFile("image/*", true, async (files) => {
      const loan = byId("loans", loanId);
      if (!loan) return;
      loan.attachments = loan.attachments || [];
      for (const f of files) {
        try { const url = await readAsDataURL(f); loan.attachments.push({ name: f.name, type: f.type, dataUrl: url }); }
        catch (_) { toast("Gagal membaca gambar", "err"); }
      }
      await DB.put("loans", loan);
      await refresh();
      rerender();
      toast("Bukti ditambahkan", "ok");
    });
  }

  function exportData() {
    const payload = {
      app: "PiutangKu", version: 1, exportedAt: new Date().toISOString(),
      debtors: state.debtors, loans: state.loans, payments: state.payments,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "piutangku-backup-" + Calc.todayISO() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("File cadangan diunduh", "ok");
  }
  function importPick() {
    pickFile("application/json,.json", false, async (files) => {
      if (!files.length) return;
      let obj;
      try { obj = JSON.parse(await readAsText(files[0])); }
      catch (_) { toast("Berkas bukan JSON yang valid", "err"); return; }
      const v = Calc.validateImport(obj);
      if (!v.ok) { toast(v.error, "err"); return; }
      pendingImport = v.data;
      openSheet("Pulihkan Data", `
        <p style="font-size:13.5px;color:var(--text);line-height:1.55;margin:2px 2px 16px">
          Ditemukan <b>${v.data.debtors.length} debitur</b>, <b>${v.data.loans.length} pinjaman</b>,
          dan <b>${v.data.payments.length} pembayaran</b>. Pilih cara memuat:</p>
        <button class="btn btn-primary" style="margin-bottom:10px" data-act="import-replace">${icon("ic-upload")} Ganti Semua Data</button>
        <button class="btn btn-lav" data-act="import-merge">${icon("ic-plus")} Gabungkan dengan Data Saat Ini</button>
        <p class="muted center" style="font-size:11.5px;margin-top:12px">“Ganti” menghapus data lama lebih dulu. “Gabungkan” menambahkan & memperbarui berdasarkan ID.</p>`);
    });
  }
  let pendingImport = null;
  async function doImport(mode) {
    if (!pendingImport) return;
    if (mode === "replace") {
      await DB.replaceAll(pendingImport);
    } else {
      for (const d of pendingImport.debtors) await DB.put("debtors", d);
      for (const l of pendingImport.loans) await DB.put("loans", l);
      for (const p of pendingImport.payments) await DB.put("payments", p);
    }
    pendingImport = null;
    await refresh();
    go("/", { text: mode === "replace" ? "Data diganti" : "Data digabungkan", type: "ok" });
  }

  /* ---------------------------------------------------------
     Toast
     --------------------------------------------------------- */
  function toast(text, type) {
    let host = $app.querySelector(".toast-host");
    if (!host) { host = document.createElement("div"); host.className = "toast-host"; $app.appendChild(host); }
    const t = document.createElement("div");
    t.className = "toast " + (type === "err" ? "err" : "ok");
    t.innerHTML = `${icon(type === "err" ? "ic-alert" : "ic-check-circle")}<span>${escapeHtml(text)}</span>`;
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 320); }, 2400);
  }

  /* ---------------------------------------------------------
     Install banner (PWA)
     --------------------------------------------------------- */
  function maybeInstallBanner() {
    if (!deferredPrompt || installDismissed) return;
    if ($app.querySelector(".install-banner")) return;
    const b = document.createElement("div");
    b.className = "install-banner";
    b.innerHTML = `<img class="ib-logo" src="icons/icon-192.png" alt="">
      <div class="ib-txt"><div class="t">Pasang PiutangKu</div><div class="d">Buka cepat dari layar utama, tetap jalan offline.</div></div>
      <button class="ib-btn" data-act="install">Pasang</button>
      <button class="ib-x" data-act="dismiss-install" aria-label="Tutup">${icon("ic-x")}</button>`;
    $app.appendChild(b);
  }

  /* ---------------------------------------------------------
     Event delegation
     --------------------------------------------------------- */
  $app.addEventListener("click", async (e) => {
    // tutup sheet saat menyentuh latar
    if (e.target.classList && e.target.classList.contains("scrim")) { closeScrim(); return; }

    // tutup dropdown label bila klik di luar area dropdown
    const openDD = $app.querySelector(".dd-panel:not(.hidden)");
    if (openDD && !e.target.closest("[data-dd]")) {
      openDD.classList.add("hidden");
      const trg = openDD.parentElement.querySelector(".dd-trigger");
      if (trg) trg.setAttribute("aria-expanded", "false");
    }

    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    const loanId = el.dataset.loan;
    const debtorId = el.dataset.debtor;

    switch (act) {
      case "go": go(el.dataset.go); break;
      case "back": history.length > 1 ? history.back() : go("/"); break;
      case "close-sheet": closeScrim(); break;

      case "quick-add": openQuickAdd(); break;
      case "add-debtor": closeScrim(); openDebtorSheet(null); break;
      case "edit-debtor": openDebtorSheet(byId("debtors", id)); break;
      case "add-loan": closeScrim(); openAddLoan(debtorId || null); break;
      case "edit-loan": openEditLoan(id); break;
      case "add-payment": openAddPayment(loanId); break;
      case "about": openAbout(); break;

      case "filter": debtorFilter = el.dataset.val; renderDebtors(); break;

      case "pick-noop": break;
      case "quick-amt": {
        const inp = document.getElementById("f-pay-amount");
        if (inp) { inp.value = Number(el.dataset.val).toLocaleString("id-ID"); }
        break;
      }

      case "dd-toggle": {
        const panel = el.parentElement.querySelector(".dd-panel");
        const willOpen = panel.classList.contains("hidden");
        panel.classList.toggle("hidden", !willOpen);
        el.setAttribute("aria-expanded", String(willOpen));
        break;
      }
      case "dd-pick": {
        const val = el.dataset.val;
        const wrap = el.closest("[data-dd]");
        const field = wrap.parentElement;
        const hidden = field.querySelector("#f-tag");
        const current = wrap.querySelector(".dd-current");
        const custom = field.querySelector("#f-tag-custom");
        if (hidden) hidden.value = val;
        if (current) { current.textContent = val; current.classList.remove("ph"); }
        wrap.querySelectorAll(".dd-item.active").forEach((x) => x.classList.remove("active"));
        el.classList.add("active");
        wrap.querySelector(".dd-panel").classList.add("hidden");
        const trg = wrap.querySelector(".dd-trigger");
        if (trg) trg.setAttribute("aria-expanded", "false");
        if (custom) {
          if (val === "Lainnya") { custom.style.display = ""; custom.focus(); }
          else { custom.style.display = "none"; }
        }
        break;
      }
      case "photo-pick": pickDebtorPhoto(); break;
      case "photo-del": debtorPhoto = null; refreshPhotoBox(); break;

      case "create-debtor": await saveDebtor(null); break;
      case "save-debtor": await saveDebtor(id); break;
      case "create-loan": await createLoan(debtorId || null); break;
      case "save-loan": await saveLoan(id); break;
      case "create-payment": await createPayment(loanId); break;

      case "sheet-attach": sheetAddAttachment(); break;
      case "sheet-attach-del": sheetAttachments.splice(Number(el.dataset.idx), 1); {
        const host = document.getElementById("f-attach");
        if (host) host.innerHTML = attachThumbs() + `<button class="attach-add" data-act="sheet-attach" aria-label="Tambah foto">${icon("ic-image")}</button>`;
      } break;
      case "add-attach": loanAddAttachment(loanId); break;
      case "del-attach": await delAttachment(loanId, Number(el.dataset.idx)); break;

      case "del-debtor": {
        const d = byId("debtors", id);
        openDialog({ icon: "ic-trash", title: "Hapus debitur?", msg: `Semua pinjaman & pembayaran ${d ? d.name : "ini"} akan ikut terhapus. Tindakan ini tidak bisa dibatalkan.`, confirmLabel: "Hapus", act: "confirm-del-debtor", data: `data-id="${id}"` });
      } break;
      case "confirm-del-debtor": await delDebtor(id); break;

      case "del-loan":
        openDialog({ icon: "ic-trash", title: "Hapus pinjaman?", msg: "Pinjaman ini beserta riwayat pembayarannya akan dihapus permanen.", confirmLabel: "Hapus", act: "confirm-del-loan", data: `data-id="${id}"` });
        break;
      case "confirm-del-loan": await delLoan(id); break;

      case "del-payment":
        openDialog({ icon: "ic-trash", title: "Hapus pembayaran?", msg: "Catatan pembayaran ini akan dihapus.", confirmLabel: "Hapus", act: "confirm-del-payment", data: `data-id="${id}" data-loan="${loanId}"` });
        break;
      case "confirm-del-payment": await delPayment(id, loanId); break;

      case "seed":
        if (state.debtors.length) {
          openDialog({ icon: "ic-coins", tone: "ic-mint", title: "Muat data contoh?", msg: "Ini akan mengganti seluruh data yang ada sekarang dengan data demo.", confirmLabel: "Muat Contoh", confirmClass: "btn-primary", act: "confirm-seed" });
        } else { await seedSample(); }
        break;
      case "confirm-seed": await seedSample(); break;

      case "clear-all":
        openDialog({ icon: "ic-trash", title: "Hapus semua data?", msg: "Seluruh debitur, pinjaman, dan pembayaran akan dihapus permanen dari perangkat ini.", confirmLabel: "Hapus Semua", act: "confirm-clear" });
        break;
      case "confirm-clear": await clearAllData(); break;

      case "export": exportData(); break;
      case "import-pick": importPick(); break;
      case "import-replace": await doImport("replace"); break;
      case "import-merge": await doImport("merge"); break;

      case "install":
        if (deferredPrompt) { deferredPrompt.prompt(); try { await deferredPrompt.userChoice; } catch (_) {} deferredPrompt = null; }
        { const b = $app.querySelector(".install-banner"); if (b) b.remove(); }
        break;
      case "dismiss-install":
        installDismissed = true; { const b = $app.querySelector(".install-banner"); if (b) b.remove(); }
        break;
    }
  });

  // input: format rupiah & pencarian
  $app.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.input) return;
    if (t.dataset.input === "rupiah") {
      const digits = (t.value || "").replace(/[^\d]/g, "");
      t.value = digits ? Number(digits).toLocaleString("id-ID") : "";
    } else if (t.dataset.input === "search") {
      debtorQuery = t.value;
      refreshDebtorList();
    }
  });

  /* ---------------------------------------------------------
     Router
     --------------------------------------------------------- */
  function go(path, msg) {
    pendingToast = msg || null;
    if ("#" + path === location.hash) route();
    else location.hash = "#" + path;
  }
  function route() {
    const parts = location.hash.replace(/^#/, "").split("/").filter(Boolean);
    const top = parts[0] || "";
    // shortcut PWA
    if (top === "tambah-pinjaman") { history.replaceState(null, "", location.pathname + location.search + "#/"); renderHome(); openAddLoan(null); return; }
    if (top === "tambah-peminjam") { history.replaceState(null, "", location.pathname + location.search + "#/"); renderHome(); openDebtorSheet(null); return; }
    switch (top) {
      case "": renderHome(); break;
      case "peminjam": parts[1] ? renderProfile(parts[1]) : renderDebtors(); break;
      case "pinjaman": renderLoan(parts[1]); break;
      case "statistik": renderStats(); break;
      case "pengingat": renderReminders(); break;
      case "lainnya": renderMore(); break;
      case "data": renderData(); break;
      default: renderHome();
    }
  }
  const rerender = route;

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  async function refresh() { state = await DB.snapshot(); }

  function registerSW() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredPrompt = e;
    if ((location.hash === "" || location.hash === "#/" ) && !installDismissed) maybeInstallBanner();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null; const b = $app.querySelector(".install-banner"); if (b) b.remove();
  });
  window.addEventListener("hashchange", route);

  (async function init() {
    try { await DB.open(); await refresh(); }
    catch (err) { console.error(err); }
    route();
    registerSW();
  })();
})();
