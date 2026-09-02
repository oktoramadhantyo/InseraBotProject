/**
 * BotInsera - Google Apps Script Web App
 * ======================================
 * Bagian BACK-END (server) yang menerima data tiket dari userscript Tampermonkey
 * lalu menulis/update ke tab `copas tket` di spreadsheet ini.
 *
 * CARA DEPLOY:
 * 1. Buka spreadsheet target (yang punya tab `copas tket`).
 * 2. Menu: Extensions -> Apps Script
 * 3. Tempel seluruh isi file ini ke editor, lalu Save.
 * 4. Deploy -> New deployment -> pilih type "Web app".
 * 5. Execute as: Me (akun kamu)
 *    Who has access: Anyone (dibatasi token di bawah)
 * 6. Salin URL Web App. Isi ke bagian USERS_URL di userscript.
 * 7. Set ACCESS_TOKEN bebas (password bersama antara script & userscript).
 *
 * SETUP ACCESS TOKEN:
 * - Edit variabel ACCESS_TOKEN di bawah ini, isi dengan string password rahasia.
 * - Isi token yang SAMA di userscript (constant ACCESS_TOKEN).
 */

// ============ KONFIGURASI ============
// Password bersama antara Apps Script & userscript (ganti dengan milik sendiri!)
var ACCESS_TOKEN = "#Ez6KQZpzEYYXSeYWyZAGA7N";

// Nama tab tujuan (default: copas tket)
var TAB_TUJUAN = "copas tket";

// ============ WARNA INTERVAL ============
// Penanda batch tiket BARU: warnanya berputar tiap kali ada batch baru ditulis
// (hijau muda → merah muda → biru muda → kuning muda → balik lagi ke hijau).
// Dipilih warna MUDA (pastel) agar teks hitam tetap terbaca jelas.
var WARNA_SIKLUS = ["#C8E6C9", "#FFCDD2", "#BBDEFB", "#FFF59D"];
var PROP_WARNA_IDX = "botinsera_warna_idx";

// Memutar warna siklus ke warna berikutnya dan mengembalikan kode hex-nya.
// Index tersimpan di Script Properties sehingga lanjut walau tab di-refresh.
function warnaIntervalBerikutnya() {
  var props = PropertiesService.getScriptProperties();
  var idx = parseInt(props.getProperty(PROP_WARNA_IDX), 10);
  if (isNaN(idx)) idx = -1;
  idx = (idx + 1) % WARNA_SIKLUS.length;
  props.setProperty(PROP_WARNA_IDX, String(idx));
  return WARNA_SIKLUS[idx];
}

// ============ HANDLER ============

/**
 * Endpoint utama (Web App).
 * Menerima POST JSON: {"token": "...", "rows": [ [...], [...] ], "colIncident": 0}
 *   - rows: list baris; tiap baris list nilai kolom sesuai urutan di halaman Insera.
 *   - colIncident: indeks (0-based) kolom No INCIDENT (default 0).
 * Perilaku: tiket yang SUDAH ADA (by INCIDENT) dilewatkan; hanya tiket BARU yang
 * ditambahkan di baris kosong pertama setelah data terakhir (tidak mengganggu row lama).
 * Mengembalikan JSON statistik {baru, update(=0), lewat, total}.
 */
function doPost(e) {
  var out = { ok: false };
  try {
    var body = JSON.parse(e.postData.contents);

    // Validasi token
    if (!body.token || body.token !== ACCESS_TOKEN) {
      out.error = "TOKEN_SALAH";
      return ContentService.createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rows = body.rows || [];
    var colIncident = (body.colIncident !== undefined) ? body.colIncident : 0;
    // "lengkap" = semua halaman pagination Insera sudah dibaca user (tidak ada fetch gagal).
    // Kalau false, jangan lakukan penghapusan otomatis agar data valid tidak ikut terhapus.
    var lengkap = !!body.lengkap;

    if (rows.length === 0) {
      out.ok = true;
      out.baru = 0; out.update = 0; out.lewat = 0; out.total = 0;
      return ContentService.createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var stat = tulisTiket(rows, colIncident, lengkap);
    out.ok = true;
    out.baru = stat.baru;
    out.update = stat.update;
    out.lewat = stat.lewat;
    out.hapus = stat.hapus || 0;
    out.total = stat.baru + stat.update;
    return ContentService.createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    out.error = String(err);
    return ContentService.createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Endpoint GET sederhana untuk tes koneksi
function doGet() {
  return ContentService.createTextOutput("BotInsera Apps Script OK")
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============ LOGIKA TULIS ============

/**
 * Menulis tiket ke tab tujuan, hindari duplikat by INCIDENT.
 *
 * Perilaku:
 * - Tiket yang SUDAH ADA (by INCIDENT) di-UPDATE agar sesuai data terbaru Insera
 *   (baris tidak digeser/ditambah baru, tetap di baris semula, hanya isinya disamakan).
 * - Tiket yang BELUM ADA ditambahkan di baris kosong pertama setelah data terakhir.
 * - Sel INCIDENT pada baris yang diproses bot diberi warna SIKLUS
 *   (hijau → merah → biru → kuning, berganti tiap batch baru) sebagai penanda "by bot".
 */
function tulisTiket(rowsBaru, colIncident, lengkap) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(TAB_TUJUAN);

  // (1) DETEKSI DULU: baca seluruh data lama (tanpa header) → peta INCIDENT.
  var nilai = ws.getDataRange().getValues();
  var rowsLama = nilai.slice(1);

  // peta: INCIDENT -> baris index (dalam rowsLama, 0-based).
  var peta = {};
  for (var i = 0; i < rowsLama.length; i++) {
    var r = rowsLama[i];
    if (r && r[colIncident] && String(r[colIncident]).trim() !== "") {
      peta[String(r[colIncident]).trim()] = i;
    }
  }

  var stat = { baru: 0, update: 0, lewat: 0, hapus: 0 };
  var barisBaru = [];          // tiket yang BELUM ada → akan di-append
  var barisUpdate = {};        // tiket yang SUDAH ada → INCIDENT -> row data baru

  // (2) Kelompokkan: baru vs sudah ada (yang sudah ada dicatat untuk di-update).
  for (var j = 0; j < rowsBaru.length; j++) {
    var row = rowsBaru[j];
    if (!row || !Array.isArray(row)) continue;
    if (!row.some(function (v) { return String(v).trim() !== ""; })) continue;

    var inc = row[colIncident] !== undefined ? String(row[colIncident]).trim() : "";
    if (inc === "") continue;

    if (peta[inc] !== undefined) {
      // SUDAH ADA → tandai untuk UPDATE (data terbaru dari Insera).
      barisUpdate[inc] = row;
      stat.update++;
    } else {
      barisBaru.push(row);
      stat.baru++;
    }
  }

  // (3) UPDATE baris yang sudah ada (posisinya tetap, isi disamakan dengan Insera).
  //     Dilakukan SECARA BATCH (semua baris dalam 1-2 panggilan) agar jauh lebih
  //     cepat daripada update per-baris (yang memicu puluhan API call serial).
  var incsUpdate = Object.keys(barisUpdate);
  if (incsUpdate.length > 0) {
    // Banyaknya kolom data terbaru (agar range update tidak terpotong).
    var maxColsUpdate = 0;
    for (var u = 0; u < incsUpdate.length; u++) {
      if (barisUpdate[incsUpdate[u]].length > maxColsUpdate) {
        maxColsUpdate = barisUpdate[incsUpdate[u]].length;
      }
    }
    // Batasi lebar kolom update agar tidak menimpa data/kolom lain di kanan.
    // Nilai = jumlah kolom header yang ada di sheet (maksimal kolom tujuan).
    var jmlKolomSheet = Math.max(ws.getLastColumn(), 1);
    var lebarUpdate = Math.min(maxColsUpdate, jmlKolomSheet);

    // warnanya satu untuk seluruh batch update ini (penanda "by bot").
    var warnaUpdate = warnaIntervalBerikutnya();

    // Urutkan indeks baris sheet menaik agar blok-blok berurutan bisa ditulis kontigu.
    var pasangan = [];
    for (var u2 = 0; u2 < incsUpdate.length; u2++) {
      var inc2 = incsUpdate[u2];
      var barisIndexLama = peta[inc2];            // 0-based di rowsLama
      var rowSheet = barisIndexLama + 2;          // +1 (header) +1 (1-based)
      pasangan.push({ row: rowSheet, data: barisUpdate[inc2].slice(0, lebarUpdate) });
    }
    pasangan.sort(function (a, b) { return a.row - b.row; });

    // Tulis data secara BLOK: hanya baris-baris yang BERURUTAN (tanpa gap) digabung jadi
    // satu range; tiap blok ditulis sekali (setValues) di posisi persis. Dengan begitu
    // TIDAK ada padding kosong di tengah (yang sebelumnya bikin data bergeser & baris
    // tak berdata ikut ketimpa / ke-skip). Baris yang bukan target tidak disentuh.
    var blokMulai = pasangan[0].row;
    var blok = [];
    for (var p = 0; p < pasangan.length; p++) {
      if (blok.length > 0 && pasangan[p].row !== blokMulai + blok.length) {
        // ada gap → tulis blok sebelumnya di posisi persisnya
        ws.getRange(blokMulai, 1, blok.length, lebarUpdate).setValues(blok);
        blok = [];
        blokMulai = pasangan[p].row;
      }
      blok.push(pasangan[p].data);
    }
    if (blok.length > 0) {
      ws.getRange(blokMulai, 1, blok.length, lebarUpdate).setValues(blok);
    }

    // Warna sel INCIDENT pada baris-baris yang di-update (hanya baris target, per blok
    // berurutan). Baris yang bukan target tidak diwarnai & tidak disentuh.
    var barisIncident = pasangan.map(function (e) { return e.row; }); // sudah urut menaik
    var wMulai = barisIncident[0];
    for (var w = 1; w < barisIncident.length; w++) {
      // ada gap kalau baris sekarang tidak persis berurutan dgn baris sebelumnya
      if (barisIncident[w] > barisIncident[w - 1] + 1) {
        ws.getRange(wMulai, colIncident + 1, barisIncident[w - 1] - wMulai + 1, 1)
          .setBackground(warnaUpdate);
        wMulai = barisIncident[w];
      }
    }
    ws.getRange(wMulai, colIncident + 1, barisIncident[barisIncident.length - 1] - wMulai + 1, 1)
      .setBackground(warnaUpdate);
  }

  // (4) Tambahkan baris BARU di baris kosong pertama setelah data terakhir,
  //     sehingga baris yang sudah ada tidak digeser.
  if (barisBaru.length > 0) {
    var lastRow = Math.max(ws.getLastRow(), 1);
    var firstEmpty = lastRow + 1; // baris kosong pertama di bawah data terakhir
    var nCols = 0;
    for (var b = 0; b < barisBaru.length; b++) {
      if (barisBaru[b].length > nCols) nCols = barisBaru[b].length;
    }
    var targetRange = ws.getRange(firstEmpty, 1, barisBaru.length, Math.max(nCols, 1));
    targetRange.setValues(barisBaru);

    // warna SIKLUS pada sel INCIDENT untuk baris baru (penanda "by bot").
    var incCol = colIncident + 1;
    var warnaIncident = warnaIntervalBerikutnya();
    ws.getRange(firstEmpty, incCol, barisBaru.length, 1).setBackground(warnaIncident);
  }

  // (5) BERSIHKAN OTOMATIS: hapus baris lama yang INCIDENT-nya TIDAK ada di data Insera
  //     yang sedang dikirim (artinya tiket itu sudah tidak ada lagi di daftar Insera).
  //     HANYA dijalankan bila "lengkap" === true (semua halaman Insera sudah dibaca).
  //     Kalau belum lengkap (mis. pagination gagal / cuma baca 1 halaman), KEMBALI dicegah
  //     agar data valid yang belum sempat terbaca tidak ikut terhapus permanen.
  //     CATATAN: penghapusan PERMANEN. Jika Insera memakai filter yang menyembunyikan
  //     sebagian tiket, baris2 yang tersembunyi itu juga ikut terhapus di sini.
  if (lengkap) {
    var incDiInsera = {};
    Object.keys(barisUpdate).forEach(function (k) { incDiInsera[k] = true; });
    for (var b2 = 0; b2 < barisBaru.length; b2++) {
      var incb = barisBaru[b2] && barisBaru[b2][colIncident] !== undefined
        ? String(barisBaru[b2][colIncident]).trim() : "";
      if (incb !== "") incDiInsera[incb] = true;
    }
    var rowsHapus = [];
    for (var li = 0; li < rowsLama.length; li++) {
      var rl = rowsLama[li];
      var incLama = (rl && rl[colIncident] !== undefined) ? String(rl[colIncident]).trim() : "";
      if (incLama === "") continue;       // baris kosong: jangan disentuh
      if (incDiInsera[incLama]) continue; // masih ada di Insera → pertahankan
      rowsHapus.push(li + 2);             // baris sheet (1-based)
    }
    // hapus dari bawah ke atas agar index baris tidak bergeser saat menghapus.
    for (var d = rowsHapus.length - 1; d >= 0; d--) {
      ws.deleteRow(rowsHapus[d]);
    }
    stat.hapus = rowsHapus.length;
  }

  stat.total = stat.baru + stat.update;
  return stat;
}
