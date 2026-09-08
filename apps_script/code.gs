/**
 * BotInsera - Google Apps Script Web App
 * ======================================
 * Bagian BACK-END (server) yang menerima data tiket dari userscript Tampermonkey
 * lalu menulis/update ke tab `copas tket` di spreadsheet ini.
 *
 * v2.1 - Diselaraskan dengan Tampermonkey v1.6.0 (one-cycle)
 * - Warna 2 macam: HIJAU (baris baru) & KUNING (baris lama/update)
 * - Hapus SEMUA baris INC kosong (bukan tiket Insera) saat lengkap=true
 * - Dedupe INC dobel + hapus baris tak ada di Insera saat lengkap=true
 * - Hapus baris per-chunk kontigu (lebih cepat)
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

// ============ WARNA (2 macam) ============
// HIJAU  = baris BARU (belum pernah ada di sheet / INC baru masuk sync ini).
// KUNING = baris LAMA (sudah ada di sheet; terbawa / ter-update dari sync lalu).
// Tidak perlu rotasi index & Script Properties — cukup 2 kondisi tetap.
var WARNA_BARU  = "#4CAF50"; // hijau (baru)
var WARNA_LAMA  = "#FFF59D"; // kuning lembut (lama, lebih visible)

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
    console.log("[BotInsera] doPost: rows=" + (rows && rows.length) +
                " colIncident=" + colIncident + " lengkap=" + lengkap);

    if (rows.length === 0) {
      out.ok = true;
      out.baru = 0; out.update = 0; out.lewat = 0; out.total = 0;
      return ContentService.createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Warna: HIJAU = baru, KUNING = lama. Bedanya ditentukan tulisTiket.
    var warnaBaru = WARNA_BARU;
    var warnaLama = WARNA_LAMA;
    console.log("[BotInsera] Warna: baru=" + warnaBaru + " lama=" + warnaLama);

    var stat = tulisTiket(rows, colIncident, lengkap, warnaBaru, warnaLama);
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
 * - Tiket SUDAH ADA (by INCIDENT) → di-UPDATE di baris yang sama, sel INCIDENT = KUNING.
 * - Tiket BELUM ADA → di-append, sel INCIDENT = HIJAU.
 * - Saat lengkap: hapus SEMUA baris INC kosong + dedupe dobel INC + hapus baris tak ada di Insera.
 * - Semua baris valid yang tersisa setelahnya = KUNING (lama).
 */
function tulisTiket(rowsBaru, colIncident, lengkap, warnaBaru, warnaLama) {
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

  // (3) UPDATE baris yang sudah ada (posisi tetap, isi disamakan Insera) + warna KUNING.
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
        // Warnai sel INCIDENT baris UPDATE = KUNING (karena sudah lewat 1 interval).
        ws.getRange(blokMulai, colIncident + 1, blok.length, 1).setBackground(warnaLama);
        blok = [];
        blokMulai = pasangan[p].row;
      }
      blok.push(pasangan[p].data);
    }
    if (blok.length > 0) {
      ws.getRange(blokMulai, 1, blok.length, lebarUpdate).setValues(blok);
      ws.getRange(blokMulai, colIncident + 1, blok.length, 1).setBackground(warnaLama);
    }
  }

  // (4) Tambah baris BARU di bawah data terakhir + warna HIJAU.
  if (barisBaru.length > 0) {
    var lastRow = Math.max(ws.getLastRow(), 1);
    var firstEmpty = lastRow + 1;
    var nCols = 0;
    for (var b = 0; b < barisBaru.length; b++) {
      if (barisBaru[b].length > nCols) nCols = barisBaru[b].length;
    }
    var targetRange = ws.getRange(firstEmpty, 1, barisBaru.length, Math.max(nCols, 1));
    targetRange.setValues(barisBaru);

    // Warnai sel INCIDENT baris BARU = HIJAU.
    ws.getRange(firstEmpty, colIncident + 1, barisBaru.length, 1).setBackground(warnaBaru);
  }

  // (5) Bila lengkap: bersihkan baris INC kosong + dedupe dobel + hapus tak-ada-di-Insera.
  if (lengkap) {
    // Set INC yang ADA di Insera (update + baru).
    var incDiInsera = {};
    Object.keys(barisUpdate).forEach(function (k) { incDiInsera[k] = true; });
    for (var b2 = 0; b2 < barisBaru.length; b2++) {
      var incb = barisBaru[b2] && barisBaru[b2][colIncident] !== undefined
        ? String(barisBaru[b2][colIncident]).trim().toUpperCase() : "";
      if (incb !== "") incDiInsera[incb] = true;
    }

    // (5a) Deteksi duplikat INC di sheet (baris > pertama) + baris INC kosong.
    var terlihat = {};
    var rowsHapus = [];
    for (var li = 0; li < rowsLama.length; li++) {
      var rl = rowsLama[li];
      var incLama = (rl && rl[colIncident] !== undefined) ? String(rl[colIncident]).trim().toUpperCase() : "";
      // Baris INC KOSONG = bukan tiket Insera → selalu hapus (minimalisir data aneh).
      if (incLama === "") {
        rowsHapus.push(li + 2);
        continue;
      }
      // Duplikat INC (sudah pernah tampil) → hapus sisanya.
      if (terlihat[incLama]) {
        rowsHapus.push(li + 2);
        continue;
      }
      terlihat[incLama] = true;
      // INC tidak ada di Insera → hapus.
      if (!incDiInsera[incLama]) {
        rowsHapus.push(li + 2);
      }
    }
    console.log("[BotInsera] lengkap=" + lengkap +
                " rowsLama=" + rowsLama.length +
                " incDiInsera=" + Object.keys(incDiInsera).length +
                " rowsHapus(kosong+dupd+beda)=" + rowsHapus.length);

    hapusRentangCepat(ws, rowsHapus);
    stat.hapus = rowsHapus.length;

    // (5b) RECOLOR kolom INCIDENT:
    //      - Baris BARU (INC yang ditambahkan sync INI) = HIJAU (tetap).
    //      - Baris LAMA yang ada di Insera (update/terbawa) = KUNING.
    //      - Selain itu (tak ada di Insera) = bersihkan (null).
    var incBaruIni = {};
    for (var nb = 0; nb < barisBaru.length; nb++) {
      var incN = barisBaru[nb] && barisBaru[nb][colIncident] !== undefined
        ? String(barisBaru[nb][colIncident]).trim().toUpperCase() : "";
      if (incN !== "") incBaruIni[incN] = true;
    }
    var histRows = Math.max(ws.getLastRow() - 1, 0); // data row 2..last
    var histCol = Math.max(ws.getLastColumn(), 1);
    if (histRows > 0 && histCol > colIncident) {
      var curData = ws.getRange(2, 1, histRows, histCol).getValues();
      var warnaMatrix = [];
      for (var cr = 0; cr < curData.length; cr++) {
        var cellInc = (curData[cr][colIncident] !== undefined) ? String(curData[cr][colIncident]).trim().toUpperCase() : "";
        var warnaSel = null;
        if (cellInc !== "" && incDiInsera[cellInc]) {
          warnaSel = incBaruIni[cellInc] ? warnaBaru : warnaLama;
        }
        warnaMatrix.push([warnaSel]);
      }
      ws.getRange(2, colIncident + 1, histRows, 1).setBackgrounds(warnaMatrix);
    }
  }
  // Bila tidak lengkap: JANGAN hapus & JANGAN recolor (safety — data belum tentu lengkap).

  stat.total = stat.baru + stat.update;
  return stat;
}

/**
 * Hapus daftar baris (1-based) secara cepat: kelompokkan baris berurutan menjadi
 * satu panggilan `deleteRow` per-chunk kontigu, urut terbalik biar index tidak geser.
 */
function hapusRentangCepat(ws, rowsHapus) {
  if (!rowsHapus || rowsHapus.length === 0) return;
  var unik = rowsHapus.slice().sort(function (a, b) { return a - b; });
  var chunks = []; // tiap chunk = {start, start}
  var s = unik[0], prev = unik[0];
  for (var i = 1; i < unik.length; i++) {
    if (unik[i] === prev + 1) { prev = unik[i]; continue; }
    chunks.push({ start: s, count: prev - s + 1 });
    s = unik[i]; prev = unik[i];
  }
  chunks.push({ start: s, count: prev - s + 1 });
  // Hapus dari bawah ke atas (index tidak geser).
  for (var c = chunks.length - 1; c >= 0; c--) {
    ws.getRange(chunks[c].start, 1, chunks[c].count).deleteCells(SpreadsheetApp.Dimension.ROWS);
  }
}
