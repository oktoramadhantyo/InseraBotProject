# BRIEF — BotInsera (Acuan Final)

Dokumen acuan bersama (gabungan dari `notesss.md` + keputusan yang disepakati dalam brainstorming).
Ini versi ringkas dari PRD, dipakai sebagai cetak biru sebelum & saat coding.

---

## 1. Tujuan

Mengotomatiskan proses **copy-paste manual** data tiket dari **web Insera (ALL TICKET LIST)**
ke tab **`copas tket`** di Google Spreadsheet, memakai browser Chrome yang **sudah login manual oleh user**.

BotInsera **tidak menggantikan** BotTele — BotTele tetap dipakai untuk monitoring tiket bersih.

## 2. Metode / Prinsip

- **Attach ke Chrome existing** yang sudah login (via `debuggerAddress` / remote debugging port),
  BUKAN buka browser baru, BUKAN login otomatis (login pakai OTP → TIDAK boleh diotomatisasi).
- **Baca langsung elemen tabel HTML** (`<tr>` / `<td>`), BUKAN tombol bawaan Insera
  ("Copy All Tickets" / "Download CSV" / "Copy Incident-Address").
- **Inject tombol custom ke halaman** untuk kontrol **Start / Stop** proses sync.
- Tulis hasil ke Google Sheets via `gspread`, hindari duplikat berdasarkan No Tiket (`INCIDENT`).

## 3. Target Halaman

- URL: `oss-incident.telkom.co.id/jw/web/userview/ticketIncidentService/ticketIncidentService/_/allTicketList`
- Judul: **"ALL TICKET LIST"**
- Pagination: contoh "150 items found, displaying 1 to 100". Ada dropdown jumlah item/halaman
  (default "100") — perlu handle multi-page atau perbesar jumlah item bila perlu.

## 4. Struktur Tabel

- Total **80+ kolom** (bisa di-scroll ke kanan).
- Kolom awal (dari kiri): `INCIDENT | TTR CUSTOMER | SUMMARY | REPORTED DATE | OWNER GROUP | OWNER | CUSTOMER SEGMENT | SERVICE TYPE | WITEL | WORKZONE`
- Kolom lain antara lain: STATUS, STATUS DATE, TICKET ID GAMAS, REPORTED BY, CONTACT PHONE,
  CONTACT NAME, CONTACT EMAIL, BOOKING DATE, DESCRIPTION ASSIGMENT, REPORTED PRIORITY, SOURCE
  TICKET, SUBSIDIARY, EXTERNAL TICKET ID, CHANNEL, CUSTOMER TYPE, CLOSED BY, CUSTOMER ID,
  CUSTOMER NAME, SERVICE ID, SERVICE NO, SYMPTOM, dll.

> **Keputusan**: ambil **semua kolom lengkap** yang tampil, agar hasilnya identik dengan paste manual
> ke `copas tket` (81 kolom) dan formula filter otomatis tidak rusak.

## 5. Elemen UI di Halaman

- Tombol bawaan (referensi posisi, JANGAN dipakai): "Copy All Tickets" (biru), "Download CSV" (hijau),
  "Copy (Incident - Address)" (oranye) — di kanan atas.
- Panel filter di atas tabel (Reported Date From/To, Status Date From/To, Customer, External Ticket ID,
  PL-TSEL, Service Number, ID Ticket, dll) — dipakai user untuk menyaring. Script tidak wajib menyentuh
  filter ini bila tujuannya membaca semua data yang sedang tampil.
- Tombol "show" untuk submit filter.
- Kolom INCIDENT biasanya berupa link — no tiket ini jadi **primary key** anti-duplikat.

## 6. Struktur Project (dipisah per tools)

```
projek magang-BotInsera/
│
├── scraper/               # Tangkap data dari web Insera
│   ├── __init__.py
│   ├── browser.py         # attach ke Chrome existing (remote debugging port)
│   ├── navigasi.py        # navigasi, filter, pagination
│   ├── injector.py        # inject tombol custom Start/Stop
│   └── reader.py          # baca <tr>/<td> seluruh kolom tabel
│
├── writer/                # Tulis ke Google Spreadsheet
│   ├── __init__.py
│   └── google_sheet.py    # gspread → tab `copas tket`, hindari duplikat by INCIDENT
│
├── core/                  # Logika utama & konfigurasi
│   ├── __init__.py
│   ├── config.py          # URL, SHEET_ID, interval, debug port
│   ├── pipeline.py        # scrape → parse → tulis
│   └── scheduler.py       # loop cek state Start/Stop
│
├── main.py                # entry point
├── requirements.txt
├── .env.example
└── README.md
```

## 7. Mekanisme Trigger (Start/Stop)

- **Loop Python berjalan terus**; tiap interval mengecek **state** tombol (Start/Stop) di halaman.
- Jika state **Start** → baca tabel → tulis ke `copas tket` → tidur → cek lagi.
- Jika state **Stop** → lewati pembacaan → cek lagi.
- Bisa juga dijalankan **otomatis berkala** tanpa klik; tombol tetap tersedia sebagai opsi manual.

## 8. Dependensi

| Library | Fungsi |
|---|---|
| `selenium` | Kontrol browser untuk membaca tabel Insera |
| `gspread` | Tulis ke Google Spreadsheet |
| `google-auth` | Autentikasi ke Google API |
| `python-dotenv` | Baca file `.env` |

> Kredensial Google Service Account & `SHEET_ID` dipakai dari project BotTele
> (`modern-triumph-...json` dan SHEET_ID yang sama).

## 9. Constraint Penting

- TIDAK boleh ada automasi login (termasuk OTP) — user selalu login manual dulu.
- TIDAK boleh memakai tombol bawaan Insera sebagai sumber data — harus baca elemen tabel HTML.
- Script harus "menumpang" di sesi Chrome yang sudah aktif, bukan membuat sesi/browser baru.

## 10. Kriteria Sukses

- Bot attach ke Chrome existing, membaca seluruh baris tabel dari web Insera.
- Data tertulis ke `copas tket` dengan format identik paste manual (semua kolom).
- Tidak ada duplikat berdasarkan `INCIDENT`.
- Sel kolom **INCIDENT** pada baris yang diproses bot diberi **latar belakang kuning** sebagai penanda "by bot".
- Tombol Start/Stop berfungsi mengontrol loop.
- Formula filter otomatis spreadsheet tetap menghasilkan tiket bersih yang benar.
- BotTele tetap bisa membaca & memproses hasilnya seperti biasa.

## 11. Open Questions (jika belum terjawab, isi saat implementasi)

1. Nama/URL kredensial & SHEET_ID dikonfirmasi dari config BotTele (sudah dipakai sana).
2. Cara user menjalankan Chrome dengan remote debugging port (perlu dokumentasi setup).
3. Interval default berapa menit (awal disarankan 5 menit, menyesuaikan BotTele).
4. Pemetaan urutan kolom hasil baca HTML → kolom `copas tket` (perlu divalidasi saat tes).
