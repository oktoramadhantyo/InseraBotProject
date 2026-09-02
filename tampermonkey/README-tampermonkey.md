# BotInsera — Versi Tampermonkey (userscript)

Sistem baru pengganti sistem lama yang pakai Tampermonkey + copy-paste manual.

**Bedanya dari sistem lama:** userscript ini bukan cuma bikin tombol copy — saat tombol
"**Sync ke Sheets**" diklik, data tabel dibaca otomatis lalu **langsung dikirim** ke
Google Apps Script yang menulis ke tab `copas tket` (tanpa paste manual).

---

## Arsitektur

```
Tampermonkey userscript (di halaman ALL TICKET LIST Insera)
   │ 1. Inject tombol "Sync ke Sheets"
   │ 2. Saat diklik: baca seluruh <tr>/<td> dari tabel (semua kolom)
   │ 3. Kirim data (JSON) via POST → URL Web App Apps Script
   ▼
Google Apps Script Web App  (file: apps_script/code.gs)
   │ 4. Terima JSON
   │ 5. Tulis/update ke tab `copas tket`
   │ 6. Hindari duplikat by INCIDENT + warna kuning pada sel INCIDENT
   ▼
Google Spreadsheet  (tab `copas tket`)
```

---

## File di folder ini

| File | Fungsi |
|---|---|
| `apps_script/code.gs` | Script Google Apps Script (Web App backend) |
| `tampermonkey/insera-sync.user.js` | Userscript yang dipasang di Tampermonkey |
| `README-tampermonkey.md` | Panduan langkah demi langkah ini |

> Catatan: folder `scraper/`, `writer/`, `core/`, `main.py` (versi Python/Selenium yang
> sempat dibangun) TIDAK dipakai untuk arah ini. Bisa dihapus bila tidak dibutuhkan,
> atau disimpan untuk alternatif.

---

## Langkah 1 — Deploy Google Apps Script

1. Buka spreadsheet target (yang punya tab **`copas tket`**) di Google Sheets.
2. Menu **Extensions → Apps Script** (ini membuat *container-bound* script yang langsung
   bisa akses spreadsheet ini lewat `SpreadsheetApp.getActiveSpreadsheet()`).
3. Hapus isi default, lalu **tempel seluruh isi `apps_script/code.gs`**.
4. Ganti nilai konstanta di paling atas:
   - `ACCESS_TOKEN` → isi **password rahasia** (misal `binsera2026x`).
5. Klik **Save** (ikon disket / Ctrl+S).
6. **Deploy → New deployment**:
   - Select type: **Web app**
   - **Execute as**: *Me* (akun kamu)
   - **Who has access**: *Anyone* (dibatasi oleh token di kode)
   - Klik **Deploy**, lalu **Authorize access** (pilih akun, Allow).
7. **Salin URL Web App** (berakhiran `/exec`).

> Setiap kali mengubah `code.gs`, deploy ulang → **Manage deployments → Edit →
> New version** lalu *Save*.

---

## Langkah 2 — Pasang userscript di Tampermonkey

1. Install ekstensi **Tampermonkey** di Chrome.
2. Buka dashboard Tampermonkey → **Create a new script**.
3. Tempel seluruh isi `tampermonkey/insera-sync.user.js`.
4. Edit bagian konfigurasi di paling atas:
   - `USERS_URL` → isi **URL Web App** dari Langkah 1 (sama, berakhiran `/exec`).
   - `ACCESS_TOKEN` → isi **token yang sama** dengan `ACCESS_TOKEN` di code.gs.
   - `COL_INCIDENT` → biarkan `0` (kolom INCIDENT umumnya kolom pertama).
5. **Save** (Ctrl+S). Userscript otomatis aktif untuk halaman `oss-incident.telkom.co.id/*`.

---

## Langkah 3 — Pakai

1. Login manual ke halaman **ALL TICKET LIST** Insera di Chrome.
2. Pastikan filter & data yang mau disync sudah tampil di tabel.
3. Tombol **"🔄 Sync ke Sheets"** muncul di kanan bawah halaman.
4. Klik tombol tersebut.
5. Muncul notifikasi jumlah data yang diproses (Baru/Update).

Data langsung masuk ke tab `copas tket`:
- No INCIDENT yang **belum ada** → ditambahkan (baris baru).
- No INCIDENT yang **sudah ada** → kolom di-update.
- Sel **INCIDENT** pada baris yang diproses bot diberi **latar kuning** `#FFEB3B`.

### Pagination (semua halaman)
Halaman Insera memakai pagination ICEfaces via URL query (`?-p=N`) yang melakukan
**full-page reload** saat diklik. BotInsera TIDAK menggeser halaman yang sedang dibuka user.
Sebagai gantinya, saat tombol "Sync ke Sheets" diklik, userscript:
1. Membaca baris dari halaman yang sedang aktif (via DOM).
2. Mendeteksi halaman lain (2, 3, dst) dari `<span class="pagelinks">`.
3. `fetch` halaman-halaman tersebut **di background** (GET, same-origin + session cookie),
   lalu parse tabel `#datalistInboxAllticketV2`.
4. Menggabungkan seluruh baris (anti-duplikat by INCIDENT) lalu kirim ke Apps Script sekali.

Hasilnya tampil di toast: jumlah baris, jumlah halaman, dan kolom/baris.
Jika tidak ada pagination (cuma 1 halaman), cukup membaca halaman aktif.

---

## Troubleshooting

| Gejala | Penyebab / Solusi |
|---|---|
| Tombol tidak muncul | Pastikan Tampermonkey aktif & halaman di `oss-incident.telkom.co.id`. Refresh halaman. |
| "Token salah!" | `ACCESS_TOKEN` di userscript tidak sama dengan di `code.gs`. |
| Respon tidak ter-parse | URL `USERS_URL` salah / perlu redeploy Apps Script (versi baru). |
| CORS error | Sudah pakai `GM_xmlhttpRequest` + `@connect script.google.com`. Pastikan `@grant GM_xmlhttpRequest` ada. |
| "Tidak ada baris terbaca" | Selector tabel `tbody tr` tidak cocok struktur halaman. Perlu sesuaikan `bacaSemuaBaris()` (lih. catatan di bawah). |

---

## Catatan: Validasi selector tabel

Userscript memakai `document.querySelectorAll("tbody tr")` untuk membaca baris.
Karena struktur HTML halaman Insera belum dilihat langsung, selector ini **perlu
divalidasi di halaman nyata**. Jika tabel memakai struktur lain, sesuaikan di fungsi
`bacaSemuaBaris()` (misal `#tabel tr` atau `.ui-datatable-data tr`).
Lihat DevTools → Elements untuk memastikan selector yang tepat.
