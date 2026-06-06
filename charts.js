/* ============================================================
   charts.js — Generator grafik SVG murni (mengembalikan string).
   Tanpa dependensi & tanpa DOM. Semua skala mengikuti lebar wadah.
   ============================================================ */

const Charts = (() => {
  const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---- Path melengkung halus (cardinal spline) ---- */
  function smoothPath(pts) {
    if (!pts.length) return "";
    if (pts.length === 1) return `M ${n2(pts[0].x)},${n2(pts[0].y)}`;
    const t = 0.18;
    let d = `M ${n2(pts[0].x)},${n2(pts[0].y)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) * t;
      const c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t;
      const c2y = p2.y - (p3.y - p1.y) * t;
      d += ` C ${n2(c1x)},${n2(c1y)} ${n2(c2x)},${n2(c2y)} ${n2(p2.x)},${n2(p2.y)}`;
    }
    return d;
  }

  /* =========================================================
     Gauge lingkaran kecil untuk skor kepercayaan (0–100).
     Pusat angka digambar oleh HTML (.gnum) di atasnya.
     ========================================================= */
  function gauge(score, color = "#54BD9A") {
    const s = clamp(Number(score) || 0, 0, 100);
    const r = 27, cx = 32, cy = 32, w = 7;
    const C = 2 * Math.PI * r;
    const on = n2((s / 100) * C);
    const uid = "g" + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 64 64" style="width:100%;height:100%;display:block" aria-hidden="true">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${w}"/>
  <circle id="${uid}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"
    stroke-linecap="round" stroke-dasharray="${on} ${n2(C)}" transform="rotate(-90 ${cx} ${cy})"/>
</svg>`;
  }

  /* =========================================================
     Donut: porsi terbayar (mint) vs sisa (oranye).
     Pusat (persen + label) digambar oleh HTML (.donut-center).
     ========================================================= */
  function donut(paidPct, opts = {}) {
    const p = clamp(Number(paidPct) || 0, 0, 100);
    const paidColor = opts.paidColor || "#54BD9A";
    const restColor = opts.restColor || "#FFD0B0";
    const r = 52, cx = 64, cy = 64, w = 16;
    const C = 2 * Math.PI * r;
    const paid = n2((p / 100) * C);
    const gap = p > 1 && p < 99 ? 3 : 0; // celah kecil antar segmen
    return `<svg viewBox="0 0 128 128" style="width:100%;height:100%;display:block" aria-hidden="true">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${restColor}" stroke-width="${w}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${paidColor}" stroke-width="${w}"
    stroke-linecap="round" stroke-dasharray="${Math.max(0, paid - gap)} ${n2(C)}"
    transform="rotate(-90 ${cx} ${cy})"/>
</svg>`;
  }

  /* =========================================================
     Area chart melengkung dengan gradient.
     values: array angka. labels: array string (opsional, sumbu X).
     ========================================================= */
  function areaChart(values, opts = {}) {
    const W = 340, H = 132;
    const padX = 10, padTop = 14, padBot = opts.labels ? 22 : 12;
    const vals = (values && values.length ? values : [0, 0]).map((v) => Number(v) || 0);
    const max = Math.max(1, ...vals);
    const min = 0;
    const stroke = opts.stroke || "#3DA382";
    const innerW = W - padX * 2;
    const innerH = H - padTop - padBot;
    const stepX = vals.length > 1 ? innerW / (vals.length - 1) : 0;
    const yOf = (v) => padTop + innerH - ((v - min) / (max - min || 1)) * innerH;
    const pts = vals.map((v, i) => ({ x: padX + i * stepX, y: yOf(v) }));
    const line = smoothPath(pts);
    const base = padTop + innerH;
    const fill = `${line} L ${n2(pts[pts.length - 1].x)},${base} L ${n2(pts[0].x)},${base} Z`;
    const uid = "a" + Math.random().toString(36).slice(2, 7);

    let dots = "";
    if (opts.dots !== false && pts.length) {
      const last = pts[pts.length - 1];
      dots = `<circle cx="${n2(last.x)}" cy="${n2(last.y)}" r="4.5" fill="#fff" stroke="${stroke}" stroke-width="3"/>`;
    }
    let labels = "";
    if (opts.labels) {
      labels = opts.labels.map((lb, i) => {
        const x = padX + i * stepX;
        return `<text x="${n2(x)}" y="${H - 5}" text-anchor="middle" font-size="9.5"
          fill="var(--faint)" font-weight="600" font-family="var(--font)">${lb}</text>`;
      }).join("");
    }
    // garis kisi tipis
    const grid = [0.5].map((g) => {
      const y = padTop + innerH * g;
      return `<line x1="${padX}" y1="${n2(y)}" x2="${W - padX}" y2="${n2(y)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"/>`;
    }).join("");

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
  style="width:100%;height:auto;display:block;overflow:visible" aria-hidden="true">
  <defs>
    <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${stroke}" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="${stroke}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  ${grid}
  <path d="${fill}" fill="url(#${uid})"/>
  <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  ${dots}
  ${labels}
</svg>`;
  }

  /* ---- mini sparkline (opsional, dipakai bila perlu) ---- */
  function spark(values, color = "#3DA382") {
    const W = 80, H = 28;
    const vals = (values && values.length ? values : [0, 0]).map((v) => Number(v) || 0);
    const max = Math.max(1, ...vals);
    const step = vals.length > 1 ? W / (vals.length - 1) : 0;
    const pts = vals.map((v, i) => ({ x: i * step, y: H - (v / max) * (H - 4) - 2 }));
    return `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;height:${H}px;display:block" aria-hidden="true">
  <path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
</svg>`;
  }

  return { gauge, donut, areaChart, spark, smoothPath };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Charts;
