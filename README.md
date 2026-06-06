# PiutangKu — Buku Piutang Digital

Aplikasi web (PWA) untuk mencatat **piutang/pinjaman dari sisi pemberi pinjaman**. Cocok untuk individu, UMKM, warung, atau kos yang sering meminjamkan uang dan ingin mencatat siapa berutang, berapa, dan sudah dibayar berapa — semuanya rapi dalam satu tempat.

Dibuat **offline-first**: semua data tersimpan di perangkat Anda (browser) memakai IndexedDB. Tidak ada server, tidak ada akun, tidak ada data yang dikirim ke mana pun. Bisa dipasang ke layar utama HP seperti aplikasi biasa.

---

## ✨ Fitur

- **Dashboard** — ringkasan total piutang aktif, total dipinjam, total terbayar, jumlah debitur, dan tingkat pelunasan.
- **Daftar Debitur** — dengan pencarian dan filter (Semua / Masih berutang / Lunas), avatar inisial berwarna atau emoji pilihan.
- **Profil Debitur** — rincian setiap orang: total pinjaman, sisa, progres pelunasan, dan daftar seluruh pinjamannya.
- **Riwayat & Timeline** — alur tiap pinjaman dari awal dipinjam → setiap pembayaran → lunas, lengkap dengan tanggal.
- **Tambah Pinjaman & Pembayaran** — input nominal dengan format ribuan otomatis (Rp), tanggal, catatan, dan tombol cepat (mis. "Lunasi").
- **Skor Kepercayaan** 🟢🟡🔴 — penilaian otomatis tiap debitur berdasarkan ketepatan & kecepatan membayar (pembeda utama aplikasi ini).
- **Lampiran Bukti** — simpan foto/berkas bukti transfer atau perjanjian pada tiap pinjaman.
- **Pengingat** — menyoroti debitur yang sudah lama tidak membayar dan masih punya sisa utang.
- **Statistik** — grafik tren pinjaman, donut tingkat pelunasan, dan daftar piutang terbesar.
- **Cadangkan & Pulihkan (Export/Import JSON)** — amankan data Anda atau pindahkan ke perangkat lain.
- **Data Contoh** — sekali klik untuk mengisi data demo dan menjelajah fitur.

---

## 🚀 Menjalankan secara lokal

Karena memakai Service Worker dan IndexedDB, aplikasi harus dibuka lewat **server HTTP**, bukan dengan klik-dobel berkas `index.html` (protokol `file://` memblokir service worker).

Pilih salah satu cara dari dalam folder proyek:

```bash
# Python 3
python3 -m http.server 8080

# atau Node.js
npx serve .
```

Lalu buka `http://localhost:8080` di browser.

---

## 🌐 Deploy ke GitHub Pages

Aplikasi ini sudah memakai **path relatif**, jadi aman dijalankan dari subpath repo (mis. `https://username.github.io/piutangku/`).

1. Buat repository baru di GitHub, lalu unggah seluruh isi folder ini (termasuk berkas `.nojekyll`).
   ```bash
   git init
   git add .
   git commit -m "PiutangKu"
   git branch -M main
   git remote add origin https://github.com/USERNAME/NAMA-REPO.git
   git push -u origin main
   ```
2. Di GitHub: **Settings → Pages**.
3. Pada **Build and deployment → Source**, pilih **Deploy from a branch**.
4. Pilih branch `main` dan folder `/ (root)`, lalu **Save**.
5. Tunggu beberapa menit, lalu akses `https://USERNAME.github.io/NAMA-REPO/`.

> Berkas `.nojekyll` disertakan agar GitHub Pages menyajikan berkas apa adanya (tanpa pemrosesan Jekyll).

Setelah dibuka sekali saat online, aplikasi akan tersimpan di cache dan **bisa dibuka kembali tanpa internet**.

---

## 🗂️ Struktur folder

```
piutangku/
├─ index.html              # Kerangka aplikasi + sprite ikon SVG
├─ manifest.webmanifest    # Metadata PWA (nama, ikon, shortcut)
├─ sw.js                   # Service worker (offline / cache app shell)
├─ .nojekyll               # Nonaktifkan Jekyll di GitHub Pages
├─ css/
│  └─ styles.css           # Sistem desain (palet pastel)
├─ js/
│  ├─ db.js                # Lapisan IndexedDB (global: DB)
│  ├─ calc.js              # Perhitungan & format (global: Calc)
│  ├─ charts.js            # Grafik SVG (global: Charts)
│  └─ app.js               # Kontroler UI & router
├─ fonts/                  # Plus Jakarta Sans (lokal, woff2)
└─ icons/                  # Ikon aplikasi & favicon
```

Skrip dimuat berurutan sebagai *classic script*: `db.js → calc.js → charts.js → app.js`.

---

## 🧮 Model data

Disimpan di IndexedDB (database `piutangku`) dalam tiga object store: `debtors`, `loans`, `payments`.

```js
// Debitur (peminjam)
{ id, name, phone, tag, emoji, color, note, createdAt }

// Pinjaman
{ id, debtorId, amount, date, description,
  attachments: [{ name, type, dataUrl }], createdAt }

// Pembayaran (cicilan / pelunasan)
{ id, loanId, debtorId, amount, date, note, createdAt }
```

`amount` dalam rupiah (angka bulat), `date` format ISO `YYYY-MM-DD`.

---

## 💾 Format berkas cadangan (Export/Import)

Tombol **Cadangkan** mengunduh berkas `piutangku-backup-YYYY-MM-DD.json` berbentuk:

```json
{
  "app": "PiutangKu",
  "version": 1,
  "exportedAt": "2026-06-06T08:00:00.000Z",
  "debtors": [ ... ],
  "loans": [ ... ],
  "payments": [ ... ]
}
```

Saat **Pulihkan**, Anda bisa memilih **Ganti** (timpa seluruh data) atau **Gabungkan** (tambahkan ke data yang ada). Berkas yang tidak punya larik `debtors` akan ditolak.

---

## 🛡️ Cara kerja Skor Kepercayaan

Setiap debitur dinilai dari riwayat pinjamannya. Skor mulai dari **100** lalu disesuaikan:

**Pinjaman yang masih berjalan** (berdasarkan lama tidak ada pembayaran sejak aktivitas terakhir):
- lebih dari 90 hari → −25 (dihitung menunggak)
- lebih dari 60 hari → −15 (dihitung menunggak)
- lebih dari 30 hari → −7

**Rata-rata kecepatan pelunasan** (untuk pinjaman yang sudah lunas):
- lebih dari 90 hari → −15
- lebih dari 60 hari → −10
- lebih dari 30 hari → −5
- 30 hari atau kurang → +3 (bonus, membayar cepat)

Skor akhir dibatasi pada rentang 0–100, lalu dikategorikan:

| Skor | Kategori | Tanda |
|------|----------|-------|
| 80–100 | Lancar | 🟢 |
| 60–79 | Sering Terlambat | 🟡 |
| 0–59 | Risiko Tinggi | 🔴 |
| (belum ada pinjaman) | Baru | ⚪ |

Pengingat muncul untuk debitur yang masih punya sisa utang dan **sudah ≥ 45 hari** tanpa pembayaran.

> Skor ini hanya alat bantu berdasarkan catatan Anda sendiri, bukan penilaian kredit resmi.

---

## 🧰 Teknologi

- **Vanilla JavaScript** (tanpa framework, tanpa proses build).
- **IndexedDB** untuk penyimpanan lokal.
- **PWA** — Web App Manifest + Service Worker (installable & offline).
- **SVG** untuk semua grafik dan ikon.
- **Plus Jakarta Sans** (dibundel lokal, tidak memanggil server font).

---

## 🔒 Privasi

Seluruh data — debitur, pinjaman, pembayaran, dan lampiran — disimpan **hanya di perangkat Anda** melalui IndexedDB browser. Tidak ada pengiriman ke server mana pun dan tidak ada pelacakan. Membersihkan data situs di browser atau menekan **Hapus Semua Data** akan menghapusnya secara permanen, jadi cadangkan (export) secara berkala.

---

*PiutangKu — catat piutang dengan tenang.*
