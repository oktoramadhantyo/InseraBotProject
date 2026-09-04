/**
 * BotInsera - Google Apps Script Web App
 * ======================================
 * Bagian BACK-END (server) yang menerima data tiket dari userscript Tampermonkey
 * lalu menulis/update ke tab `copas tket` di spreadsheet ini.
 *
 * v2.0 - Diselaraskan dengan Tampermonkey v1.4.0
 * - Siklus warna berbasis WAKTU (60 detik), bukan per-batch
 * - Warna per-sync hanya SATU (tidak ganda)
 * - Cleanup warna cell kosong setelah data terhapus
 * - Yellow diganti ke #FFF9C4 (lebih visible)
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
 */

// ============ KONFIGURASI ============
var ACCESS_TOKEN = "#Ez6KQZpzEYYXSeYWyZAGA7N";
var TAB_TUJUAN = "copas tket";

// ============ WARNA INTERVAL (TIME-BASED) ============
// 4 warna pastel berputar tiap 60 detik (bukan per-batch).
// Dipanggil SEKALI per sync, bukan dua kali.
var WARNA_SIKLUS = ["#C8E6C9", "#FFCDD2", "#BBDEFB", "#FFF9C4"];
var PROP_WARNA_IDX = "botinsera_warna_idx";
var PROP_WARNA_TIME = "botinsera_warna_time";
var WARNA_INTERVAL_DETIK = 60;

/**
 * Mengembalikan warna siklus berdasarkan WAKTU (60 detik sekali ganti).
 * - Simpan timestamp terakhir pergantian warna di Script Properties.
 * - Kalau sudah lewat 60 detik, naikkan index & update timestamp.
 * - Kalau belum, pakai warna yang sama.
 * Dipanggil SEKALI per doPost (bukan per update/baru).
 */
function warnaBerdasarkanWaktu() {
  var props = PropertiesService.getScriptProperties();
  var idx = parseInt(props.getProperty(PROP_WARNA_IDX), 10);
  var lastTime = parseInt(props.getProperty(PROP_WARNA_TIME), 10);

  if (isNaN(idx)) idx = 0;
  if (isNaN(lastTime)) lastTime = 0;

  var now = Math.floor(Date.now() / 1000);
  if (now - lastTime >= WARNA_INTERVAL_DETIK) {
    idx = (idx + 1) % WARNA_SIKLUS.length;
    props.setProperty(PROP_WARNA_IDX, String(idx));
    props.setProperty(PROP_WARNA_TIME, String(now));
  }

  return WARNA_SIKLUS[idx];
}

// ============ HANDLER ============

/**
 * Endpoint utama (Web App).
 * Menerima POST JSON dari Tampermonkey v1.4.0:
 *   {"token": "...", "rows": [[...], ...], "colIncident": 0, "lengkap": true/false}
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
    var lengkap = !!body.lengkap;

    if (rows.length === 0) {
      out.ok = true;
      out.baru = 0; out.update = 0; out.lewat = 0; out.total = 0;
      return ContentService.createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Ambil warna SEKALI berdasarkan waktu (60 detik interval)
    var warnaBatch = warnaBerdasarkanWaktu();

    var stat = tulisTiket(rows, colIncident, lengkap, warnaBatch);
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

function doGet() {
  return ContentService.createTextOutput("BotInsera Apps Script OK")
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============ LOGIKA TULIS ============

/**
 * Menulis tiket ke tab tujuan, hindari duplikat by INCIDENT.
 *
 * Perilaku:
 * - Tiket SUDAH ADA (by INCIDENT) → di-UPDATE di baris yang sama.
 * - Tiket BELUM ADA → di-append di baris kosong pertama.
 * - Sel INCIDENT diberi warna (1 warna per sync, time-based 60 detik).
 * - Baris terhapus → background color di-cleanup.
 */
function tulisTiket(rowsBaru, colIncident, lengkap, warnaBatch) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(TAB_TUJUAN);

  // (1) DETEKSI: baca data lama → peta INCIDENT -> index baris.
  var nilai = ws.getDataRange().getValues();
  var rowsLama = nilai.slice(1);

  var peta = {};
  for (var i = 0; i < rowsLama.length; i++) {
    var r = rowsLama[i];
    if (r && r[colIncident] && String(r[colIncident]).trim() !== "") {
      peta[String(r[colIncident]).trim().toUpperCase()] = i;
    }
  }

  var stat = { baru: 0, update: 0, lewat: 0, hapus: 0 };
  var barisBaru = [];
  var barisUpdate = {};

  // (2) Kelompokkan: baru vs sudah ada.
  for (var j = 0; j < rowsBaru.length; j++) {
    var row = rowsBaru[j];
    if (!row || !Array.isArray(row)) continue;
    if (!row.some(function (v) { return String(v).trim() !== ""; })) continue;

    var inc = row[colIncident] !== undefined ? String(row[colIncident]).trim().toUpperCase() : "";
    if (inc === "") continue;

    if (peta[inc] !== undefined) {
      barisUpdate[inc] = row;
      stat.update++;
    } else {
      barisBaru.push(row);
      stat.baru++;
    }
  }

  // (3) UPDATE baris yang sudah ada (posisi tetap, isi disamakan Insera).
  var incsUpdate = Object.keys(barisUpdate);
  if (incsUpdate.length > 0) {
    var maxColsUpdate = 0;
    for (var u = 0; u < incsUpdate.length; u++) {
      if (barisUpdate[incsUpdate[u]].length > maxColsUpdate) {
        maxColsUpdate = barisUpdate[incsUpdate[u]].length;
      }
    }
    var jmlKolomSheet = Math.max(ws.getLastColumn(), 1);
    var lebarUpdate = Math.min(maxColsUpdate, jmlKolomSheet);

    // Urutkan baris menaik.
    var pasangan = [];
    for (var u2 = 0; u2 < incsUpdate.length; u2++) {
      var inc2 = incsUpdate[u2];
      var barisIndexLama = peta[inc2];
      var rowSheet = barisIndexLama + 2;
      pasangan.push({ row: rowSheet, data: barisUpdate[inc2].slice(0, lebarUpdate) });
    }
    pasangan.sort(function (a, b) { return a.row - b.row; });

    // Tulis secara BLOK (berurutan tanpa gap = 1 range, ada gap = blok baru).
    var blokMulai = pasangan[0].row;
    var blok = [];
    for (var p = 0; p < pasangan.length; p++) {
      if (blok.length > 0 && pasangan[p].row !== blokMulai + blok.length) {
        ws.getRange(blokMulai, 1, blok.length, lebarUpdate).setValues(blok);
        blok = [];
        blokMulai = pasangan[p].row;
      }
      blok.push(pasangan[p].data);
    }
    if (blok.length > 0) {
      ws.getRange(blokMulai, 1, blok.length, lebarUpdate).setValues(blok);
    }
  }

  // (4) Tambah baris BARU di bawah data terakhir.
  if (barisBaru.length > 0) {
    var lastRow = Math.max(ws.getLastRow(), 1);
    var firstEmpty = lastRow + 1;
    var nCols = 0;
    for (var b = 0; b < barisBaru.length; b++) {
      if (barisBaru[b].length > nCols) nCols = barisBaru[b].length;
    }
    var targetRange = ws.getRange(firstEmpty, 1, barisBaru.length, Math.max(nCols, 1));
    targetRange.setValues(barisBaru);

    // Warnai sel INCIDENT baris BARU (warna interval sekarang; data lama warna tetap).
    var incCol = colIncident + 1;
    ws.getRange(firstEmpty, incCol, barisBaru.length, 1).setBackground(warnaBatch);
  }

  // (5) HAPUS baris yang sudah tidak ada di Insera (hanya jika "lengkap").
  if (lengkap) {
    var incDiInsera = {};
    Object.keys(barisUpdate).forEach(function (k) { incDiInsera[k] = true; });
    for (var b2 = 0; b2 < barisBaru.length; b2++) {
      var incb = barisBaru[b2] && barisBaru[b2][colIncident] !== undefined
        ? String(barisBaru[b2][colIncident]).trim().toUpperCase() : "";
      if (incb !== "") incDiInsera[incb] = true;
    }
    var rowsHapus = [];
    for (var li = 0; li < rowsLama.length; li++) {
      var rl = rowsLama[li];
      var incLama = (rl && rl[colIncident] !== undefined) ? String(rl[colIncident]).trim().toUpperCase() : "";
      if (incLama === "") continue;
      if (incDiInsera[incLama]) continue;
      rowsHapus.push(li + 2);
    }
    // Hapus dari bawah ke atas agar index tidak bergeser.
    for (var d = rowsHapus.length - 1; d >= 0; d--) {
      ws.deleteRow(rowsHapus[d]);
    }
    stat.hapus = rowsHapus.length;
  }

  // (6) CLEANUP: bersihkan background color di cell kosong (safety net).
  //     Scan semua baris data — kalau cell di kolom INCIDENT kosong, hapus warnanya.
  var lastDataRow = Math.max(ws.getLastRow(), 1);
  var incColIdx = colIncident + 1;
  var allData = ws.getRange(2, 1, Math.max(lastDataRow - 1, 1), Math.max(ws.getLastColumn(), 1)).getValues();
  var emptyRanges = [];
  for (var cl = 0; cl < allData.length; cl++) {
    var cellInc = allData[cl][colIncident];
    if (cellInc === undefined || String(cellInc).trim() === "") {
      emptyRanges.push(cl + 2); // baris sheet (1-based, +1 header)
    }
  }
  // Batch clear background untuk baris-baris kosong (per 100 baris agar tidak timeout).
  for (var er = 0; er < emptyRanges.length; er += 100) {
    var chunk = emptyRanges.slice(er, er + 100);
    for (var ec = 0; ec < chunk.length; ec++) {
      ws.getRange(chunk[ec], incColIdx).setBackground(null);
    }
  }

  stat.total = stat.baru + stat.update;
  return stat;
}
