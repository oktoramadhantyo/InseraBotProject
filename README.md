# BotInsera

Mengotomatiskan proses copy-paste manual data tiket dari **web Insera (ALL TICKET LIST)**
ke Google Spreadsheet (tab **`copas tket`**), memakai Chrome yang sudah login manual oleh user.

BotInsera **tidak menggantikan** BotTele — BotTele tetap berfungsi untuk monitoring tiket bersih.

---

## Prinsip Kerja

1. **Attach ke Chrome existing** yang sudah login ke Insera (lewat remote debugging port),
   TIDAK membuka browser baru & TIDAK login otomatis.
2. **Inject tombol Start/Stop** ke halaman Insera untuk mengontrol proses sync.
3. **Baca langsung elemen tabel HTML** (`<tr>`/`<td>`), bukan tombol bawaan Insera.
4. **Tulis ke `copas tket`** via `gspread`, hindari duplikat berdasarkan No Tiket (`INCIDENT`).
5. **Sel kolom INCIDENT** pada baris yang ditulis/di-update bot diberi **latar belakang kuning** sebagai penanda "by bot".

---

## Setup Awal

### 1. Jalankan Chrome dengan remote debugging

Tutup semua Chrome dulu, lalu jalankan Chrome dengan flag berikut (bisa melalui shortcut/Cmd):

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="C:\chrome-debug"
```

> Gunakan `C:\chrome-debug` agar profil Chrome-nya terpisah dari profil harianmu,
> dan tetap login manual ke Insera (OTP) di sesi Chrome tersebut.

### 2. Salin konfigurasi

```bat
copy .env.example .env
```

Lalu isi di `.env` (opsional, karena ada default):
- `DEBUG_PORT` (default `9222`)
- `INTERVAL_MENIT` (default `5`)
- `SHEET_ID`, `CREDENTIAL_FILE`, `TAB_TUJUAN` (default sudah mengarah ke project BotTele / `copas tket`)
- atau `GOOGLE_CREDENTIALS` bila memakai JSON kredensial inline.

### 3. Install dependensi

```bash
pip install -r requirements.txt
```

Pastikan file kredensial Google Service Account (`modern-triumph-...json`) ada di folder ini
(atau di-set via `GOOGLE_CREDENTIALS`).

---

## Cara Menjalankan

```bash
# Uji: attach, inject tombol, cek state, lalu keluar
python main.py --cek

# Uji: jalankan satu siklus sync lalu keluar
python main.py --sekali

# Normal: jalankan loop (biarkan berjalan), kontrol lewat tombol Start/Stop di halaman
python main.py

# Normal dengan interval berbeda
python main.py --interval 10
```

Setelah `python main.py` berjalan, buka halaman ALL TICKET LIST di Chrome (yang di-attach),
lalu klik tombol **"▶ Start"** untuk memulai sync berkala, atau **"■ Stop"** untuk berhenti.

---

## Struktur Project

```
projek magang-BotInsera/
│
├── scraper/               # Tangkap data dari web Insera
│   ├── browser.py         # attach ke Chrome existing (remote debugging port)
│   ├── navigasi.py        # navigasi, filter, pagination
│   ├── injector.py        # inject tombol custom Start/Stop
│   └── reader.py          # baca <tr>/<td> seluruh kolom tabel
│
├── writer/                # Tulis ke Google Spreadsheet
│   └── google_sheet.py    # gspread → tab `copas tket`, hindari duplikat by INCIDENT
│
├── core/                  # Logika utama & konfigurasi
│   ├── config.py          # URL, SHEET_ID, interval, debug port
│   ├── pipeline.py        # scrape → parse → tulis
│   └── scheduler.py       # loop cek state Start/Stop
│
├── main.py                # entry point
├── requirements.txt
├── .env.example
└── BRIEF.md               # dokumen acuan
```

---

## Catatan Penting

- **Login TIDAK otomatis** — user harus sudah login manual (termasuk OTP) di Chrome yang di-attach.
- **TIDAK memakai tombol bawaan Insera** (Copy All Tickets / Download CSV) sebagai sumber data.
- Selector tabel & pagination perlu **divalidasi di halaman nyata** (lih. `core/config.py` &
  `scraper/navigasi.py`), karena struktur halaman belum divalidasi langsung.
