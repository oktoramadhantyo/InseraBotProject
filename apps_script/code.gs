/**
 * BotInsera - Google Apps Script Web App
 * ======================================
 * Bagian BACK-END (server) yang menerima data tiket dari userscript Tampermonkey
 * lalu menulis/update ke tab `copas tket` di spreadsheet ini.
 *
 * v2.4 - Rebuild blok kiri REPORT JAKUT / REPORT JAKBAR / FFG (nilai statis) dari copas tket;
 *        FFG flag via READ-ONLY 'DATA PS' kolom M; tabel kanan & DATA PS tidak disentuh.
 *        v2.4.1 - Auto-rebuild (onEdit) ketika copas tket di-edit manual, tanpa tombol.
 *        v2.4.2 - Fix deteksi kolom INCIDENT (ambil kejadian PERTAMA di header) + blok bisa
 *                 muncul walau sheet pernah dibersihkan (lastRow kecil/baris kosong).
 * v2.3 - Sort WORKZONE (STO) A-Z di copas tket + rebuild blok data MONITORING TTR (A-G)
 * v2.2 - Fix hapus baris utuh (deleteRows) — sebelumnya cuma kolom INC yang terhapus
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

// Tab MONITORING TTR (blok data utama) — diisi ulang otomatis oleh script (nilai statis).
var TAB_TTR = "MONITORING TTR";
var TTR_START_ROW = 3;    // baris pertama blok data TTR (baris 1 = judul, baris 2 = header).
var TTR_MAKS_BARIS = 200; // batas aman agar tidak menyentuh blok REPORTING di bagian bawah.
var COL_WORKZONE_DEFAULT = 9; // index kolom WORKZONE (0-based) di baris data copas tket; fallback.

// Pemetaan kolom data copas tket (index 0-based) ke kolom blok data TTR (1-based, kolom A=1).
// A=STO(colSto) B=NO TIKET(colIncident) C=INET GANGGUAN(SERVICE NO=30) D=CUSTOMER TYPE(24)
// E=REPORT DATE(REPORTED DATE=3) F=MANJA(BOOKING DATE=17) G=TYPE TIKET(SERVICE TYPE=7)
var TTR_SRC_INET_GANGGUAN = 30;
var TTR_SRC_CUSTOMER_TYPE = 24;
var TTR_SRC_REPORT_DATE   = 3;
var TTR_SRC_MANJA         = 17;
var TTR_SRC_TYPE_TIKET    = 7;

// Blok kiri tab laporan (REPORT JAKUT / REPORT JAKBAR / FFG) — ikut di-rebuild dari copas tket
// setiap sync (nilai statis, sort WORKZONE A-Z), tepat seperti blok data MONITORING TTR.
// Tabel kanan (FILTER kewitel dsb.) & tab DATA PS TIDAK disentuh (DATA PS hanya dibaca untuk FFG).
// Setiap cfg:
//   tab         = nama tab sheet.
//   startRow    = baris pertama data blok kiri (JAKUT/JAKBAR = 3, FFG = 2).
//   maxBaris    = batas aman agar tidak menimpa blok report di bawahnya.
//   kolomNoTiket= kolom (1-based) tempat NO TIKET, utk deteksi awal/akhir blok.
//   rumusDurasi = opsional; {col, dateCol, nowRef} utk menulis ulang rumus DURASI (I = $L$1).
//   pemetaan    = urutan kolom blok kiri (1 kolom = 1 entri):
//                 <angka> = index kolom sumber di copas tket (0-based).
//                 -1      = kolom STO (WORKZONE, = colSto dinamis dari request).
//                 -2      = kolom NO TIKET (INCIDENT, = colIncident dinamis).
//                 "FFG"   = keterangan FFG: SERVICE NO ada di 'DATA PS' kolom M -> "FFG", else "Not FFG".
//                 "DURASI"= sel diisi rumus DURASI (pakai kolom dari cfg.rumusDurasi).
var BLOK_REPORT = [
  {
    tab: "REPORT JAKUT",
    startRow: 3,
    maxBaris: 200,
    kolomNoTiket: 3, // C = NO TIKET
    rumusDurasi: { col: 9, dateCol: "F", nowRef: "L$1" }, // I DURASI, hitung dari F (REPORT DATE) vs L1=NOW()
    // A=WITEL(8) B=STO(-1) C=NO TIKET(-2) D=INET GANGGUAN(30) E=CUSTOMER TYPE(24)
    // F=REPORT DATE(3) G=MANJA(17) H=TYPE TIKET(7) I=DURASI
    pemetaan: [8, -1, -2, 30, 24, 3, 17, 7, "DURASI"]
  },
  {
    tab: "REPORT JAKBAR",
    startRow: 3,
    maxBaris: 200,
    kolomNoTiket: 3,
    rumusDurasi: { col: 9, dateCol: "F", nowRef: "L$1" },
    pemetaan: [8, -1, -2, 30, 24, 3, 17, 7, "DURASI"]
  },
  {
    tab: "FFG",
    startRow: 2,
    maxBaris: 200,
    kolomNoTiket: 2, // B = INCIDENT
    // A=STO(-1) B=INCIDENT(-2) C=SERVICE NO(30) D=FFG(flagging) E=REPORT DATE(3)
    pemetaan: [-1, -2, 30, "FFG", 3]
  }
];

// ============ WARNA (2 macam) ============
// HIJAU  = baris BARU (belum pernah ada di sheet / INC baru masuk sync ini).
// KUNING = baris LAMA (sudah ada di sheet; terbawa / ter-update dari sync lalu).
// Tidak perlu rotasi index & Script Properties — cukup 2 kondisi tetap.
var WARNA_BARU  = "#4CAF50"; // hijau (baru)
var WARNA_LAMA  = "#FFF59D"; // kuning lembut (lama, lebih visible)

// ============ HANDLER ============

/**
 * Endpoint utama (Web App).
 * Menerima POST JSON dari Tampermonkey:
 *   {"token": "...", "rows": [[...], ...], "colIncident": 0, "colSto": 9, "lengkap": true/false}
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
    var colSto = (body.colSto !== undefined && body.colSto >= 0) ? body.colSto : COL_WORKZONE_DEFAULT;
    var lengkap = !!body.lengkap;
    console.log("[BotInsera] doPost: rows=" + (rows && rows.length) +
                " colIncident=" + colIncident + " colSto=" + colSto + " lengkap=" + lengkap);

    if (rows.length === 0) {
      out.ok = true;
      out.baru = 0; out.update = 0; out.lewat = 0; out.total = 0; out.ttr = 0; out.report = 0;
      return ContentService.createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Warna: HIJAU = baru, KUNING = lama. Bedanya ditentukan tulisTiket.
    var warnaBaru = WARNA_BARU;
    var warnaLama = WARNA_LAMA;
    console.log("[BotInsera] Warna: baru=" + warnaBaru + " lama=" + warnaLama);

    var stat = tulisTiket(rows, colIncident, colSto, lengkap, warnaBaru, warnaLama);
    out.ok = true;
    out.baru = stat.baru;
    out.update = stat.update;
    out.lewat = stat.lewat;
    out.hapus = stat.hapus || 0;
    out.ttr = stat.ttr || 0;
    out.report = stat.report || 0;
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
  // Diagnostik: tampilkan nama spreadsheet target biar tahu URL ini ngarah ke mana.
  var nama = "";
  try { nama = SpreadsheetApp.getActiveSpreadsheet().getName(); } catch (err) { /* ignore */ }
  return ContentService
    .createTextOutput("BotInsera Apps Script OK" + (nama ? " | spreadsheet: " + nama : ""))
    .setMimeType(ContentService.MimeType.TEXT);
}

// Diagnostik manual: Run di editor Apps Script, lalu View > Logs.
// Dipakai untuk melihat isi/formula sel yang sedang bermasalah (E/H TTR).
function debugTTR() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("SPREADSHEET: " + ss.getName());
  var ws = ss.getSheetByName("MONITORING TTR");
  if (!ws) { Logger.log("TAB MONITORING TTR TIDAK DITEMUKAN"); return; }
  Logger.log("lastRow=" + ws.getLastRow());
  var b3 = ws.getRange("B3");
  var e3 = ws.getRange("E3");
  var h3 = ws.getRange("H3");
  Logger.log("B3 formula=[" + b3.getFormula() + "] value=[" + b3.getValues()[0][0] + "]");
  Logger.log("E3 formula=[" + e3.getFormula() + "] value=[" + e3.getValues()[0][0] + "]");
  Logger.log("H3 formula=[" + h3.getFormula() + "] value=[" + h3.getValues()[0][0] + "]");
  Logger.log("E5 formula=[" + ws.getRange("E5").getFormula() + "] value=[" + ws.getRange("E5").getValues()[0][0] + "]");
  Logger.log("K1 formula=[" + ws.getRange("K1").getFormula() + "] value=[" + ws.getRange("K1").getValues()[0][0] + "]");
  dumpCodes("H3 formula", h3.getFormula());
  dumpCodes("K1 formula", ws.getRange("K1").getFormula());
}

// Cetak kode karakter (decimal) tiap huruf string s.
// Kutip ASCII = 34; kutip melengkung kiri/kanan = 8220/8221; spasi non-break = 160.
function dumpCodes(label, s) {
  if (!s) { Logger.log(label + ": (kosong)"); return; }
  var out = [];
  for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  Logger.log(label + " charcodes=[" + out.join(",") + "]");
}

// ============ LOGIKA TULIS ============

/**
 * Menulis tiket ke tab tujuan, hindari duplikat by INCIDENT.
 *
 * Perilaku:
 * - Tiket SUDAH ADA (by INCIDENT) → di-UPDATE di baris yang sama, sel INCIDENT = KUNING.
 * - Tiket BELUM ADA → di-append, sel INCIDENT = HIJAU (di-sort WORKZONE A-Z bila tidak lengkap).
 * - Saat lengkap: hapus SEMUA baris INC kosong + dedupe dobel INC + hapus baris tak ada di Insera.
 *   Semua baris valid kemudian di-SORT ulang by WORKZONE (A-Z), tie-break INCIDENT (A-Z),
 *   ditulis ulang sekaligus beserta recolor, lalu blok data MONITORING TTR (A-G) di-rebuild.
 */
function tulisTiket(rowsBaru, colIncident, colSto, lengkap, warnaBaru, warnaLama) {
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
    // Bila data belum tentu lengkap: sort dulu baris baru by WORKZONE biar awal yang rapi.
    if (!lengkap) sortRows(barisBaru, colSto, colIncident);
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

    // (5b) SORT ulang seluruh baris valid by WORKZONE (A-Z) + tie-break INCIDENT (A-Z),
    //      lalu tulis ulang sekali pakai setValues (baris LAMA + BARU ikut rapi).
    // (5c) RECOLOR kolom INCIDENT:
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
    if (histRows > 0) {
      var curDataAll = ws.getRange(2, 1, histRows, histCol).getValues();
      var finalRows = [];
      for (var cf = 0; cf < curDataAll.length; cf++) {
        if (val(curDataAll[cf], colIncident) === "") continue;
        finalRows.push(curDataAll[cf]);
      }
      sortRows(finalRows, colSto, colIncident);

      var sortedMatrix = [];
      for (var sm = 0; sm < finalRows.length; sm++) {
        var linha = finalRows[sm].slice();
        while (linha.length < histCol) linha.push("");
        sortedMatrix.push(linha.slice(0, histCol));
      }
      if (sortedMatrix.length > 0) {
        ws.getRange(2, 1, sortedMatrix.length, histCol).setValues(sortedMatrix);

        var warnaMatrix = [];
        for (var crm = 0; crm < sortedMatrix.length; crm++) {
          var cellInc = val(sortedMatrix[crm], colIncident).toUpperCase();
          var warnaSel = null;
          if (cellInc !== "" && incDiInsera[cellInc]) {
            warnaSel = incBaruIni[cellInc] ? warnaBaru : warnaLama;
          }
          warnaMatrix.push([warnaSel]);
        }
        if (histCol > colIncident) {
          ws.getRange(2, colIncident + 1, sortedMatrix.length, 1).setBackgrounds(warnaMatrix);
        }
      }
    }
  }
  // Bila tidak lengkap: JANGAN hapus & JANGAN sort ulang seluruh sheet (safety — data belum tentu lengkap).

  // (6) Rebuild MONITORING TTR dari data copas tket terkini (selalu di-sort WORKZONE A-Z).
  stat.ttr = kumpulDanTulisTTR(ws, colIncident, colSto);

  // (7) Rebuild blok kiri REPORT JAKUT / REPORT JAKBAR / FFG (nilai statis, READ-ONLY thd DATA PS).
  stat.report = kumpulDanTulisReport(ws, colIncident, colSto);

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
    ws.deleteRows(chunks[c].start, chunks[c].count);
  }
}

// ============ HELPERS (BUAT SORT & MONITORING TTR) ============

// Cek apakah area range (row, col, numRows, numCols) di sheets kosong SEMUA.
// true = boleh ditimpa/diperluas; false = ada isi lain di sana (berbahaya).
function cekKosongBlok(ws, row, col, numRows, numCols) {
  if (numRows <= 0 || numCols <= 0) return true;
  var nilai = ws.getRange(row, col, numRows, numCols).getValues();
  for (var i = 0; i < nilai.length; i++) {
    for (var j = 0; j < nilai[i].length; j++) {
      var v = nilai[i][j];
      if (v !== "" && v !== null && String(v).trim() !== "") return false;
    }
  }
  return true;
}

// Ambil nilai bersih (trimmed string) dari sel baris array dengan fallback aman.
// Dipakai untuk kolom teks (A-D, G). Untuk kolom tanggal, pakai valPreserveDate.
function val(row, idx) {
  return (row && idx !== undefined && row.length > idx && row[idx] !== undefined && row[idx] !== null)
    ? String(row[idx]).trim() : "";
}

// Ambil nilai dari sel — JIKA Date object, biarkan sebagai Date (agar rumus Sheets bisa baca).
// Jika bukan Date, kembalikan trimmed string seperti val().
function valPreserveDate(row, idx) {
  if (!row || idx === undefined || row.length <= idx || row[idx] === undefined || row[idx] === null) return "";
  var v = row[idx];
  return (v instanceof Date) ? v : String(v).trim();
}

// Rumus DURASI bawaan kolom H MONITORING TTR (baris ke-n, 1-based).
// Versi tanpa TEXT/[h]; dan PAKAI PEMISAH TITIK-KOMA (;) karena locale
// spreadsheet user = semicolon (terbukti: =SUM(1;2) yang jalan, =SUM(1,2) tidak).
// Apps Script TIDAK otomatis menyesuaikan pemisah kata koma -> titik-koma,
// jadi formula yang ditulis script harus berisi ; persis seperti locale sheet.
// Quotes dibangun via String.fromCharCode(34) agar bebas kutip melengkung.
// Hasil sama: jam bulat + sisa menit (mis. "8 Jam 25 Menit").
function rumusDURASI(row1) {
  // MONITORING TTR: tanggal di kolom E, NOW() di K1.
  return rumusDurasiKolom("E", "K$1", row1);
}

// Rumus DURASI generik: tanggal di kolom `colDate`, acuan NOW() di `refNow` (mis. E/K$1 atau F/L$1).
function rumusDurasiKolom(colDate, refNow, row1) {
  var q = String.fromCharCode(34); // karakter kutip ASCII "
  return "=IF(ISBLANK(" + colDate + row1 + ");" + q + q + ";INT((" + refNow + "-" + colDate + row1 + ")*24)&" + q +
         " Jam " + q + "&MINUTE(" + refNow + "-" + colDate + row1 + ")&" + q + " Menit" + q + ")";
}

// Urutkan array baris by WORKZONE (A-Z, kosong di akhir) lalu INCIDENT (A-Z).
function sortRows(rows, colSto, colIncident) {
  if (!rows) return rows;
  rows.sort(function (a, b) {
    var a1 = val(a, colSto).toUpperCase();
    var b1 = val(b, colSto).toUpperCase();
    var aE = a1 === "", bE = b1 === "";
    if (aE && bE) return 0;
    if (aE) return 1;  // WORKZONE kosong di akhir
    if (bE) return -1;
    if (a1 < b1) return -1;
    if (a1 > b1) return 1;
    var a2 = val(a, colIncident).toUpperCase();
    var b2 = val(b, colIncident).toUpperCase();
    if (a2 < b2) return -1;
    if (a2 > b2) return 1;
    return 0;
  });
  return rows;
}

// Kumpulkan seluruh baris tiket valid dari copas tket, sort WORKZONE A-Z, tulis ke MONITORING TTR.
function kumpulDanTulisTTR(ws, colIncident, colSto) {
  var nilai = ws.getDataRange().getValues();
  var rowsFinal = [];
  for (var i = 1; i < nilai.length; i++) {
    if (val(nilai[i], colIncident) !== "") rowsFinal.push(nilai[i]);
  }
  sortRows(rowsFinal, colSto, colIncident);
  return tulisMonitoringTTR(rowsFinal, colIncident, colSto);
}

/**
 * Tulis ulang blok data utama MONITORING TTR (kolom A-G, nilai statis).
 * Hanya menyentuh kolom A-G → kolom H (DURASI), K1=NOW(), count block (I,K-Q),
 * dan blok REPORTING di bawah TIDAK diubah. Tidak insert/delete baris.
 */
function tulisMonitoringTTR(rowsData, colIncident, colSto) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(TAB_TTR);
  if (!ws) {
    console.log("[BotInsera] Tab '" + TAB_TTR + "' tidak ditemukan, skip rebuild TTR.");
    return 0;
  }

  // Batas blok data: mulai TTR_START_ROW, turun selama kolom B (NO TIKET) diawali "INC".
  // Deteksi pakai DUA sumber: (1) nilai sel (sudah menjadi nilai statis) atau
  // (2) RUMUSNYA SENDIRI `='copas tket'!Axx` (masih rumus lama, evaluasinya boleh kosong).
  // Ini membuat rebuild tetap jalan walau rumus lama belum pernah bernilai/tergeser.
  var lastRowT = ws.getLastRow();
  var scanRows = Math.min(TTR_MAKS_BARIS + TTR_START_ROW - 1, lastRowT) - TTR_START_ROW + 1;
  if (scanRows <= 0) { scanRows = 0; }
  var blokAkhir = TTR_START_ROW - 1;
  var adaBlok = false;
  if (scanRows > 0) {
    var colBVal = ws.getRange(TTR_START_ROW, 2, scanRows, 1).getValues();
    var colBFrm = ws.getRange(TTR_START_ROW, 2, scanRows, 1).getFormulas();
    var scanMasuk = false;
    for (var c0 = 0; c0 < scanRows; c0++) {
      var v0 = colBVal[c0][0];
      var f0 = colBFrm[c0][0] || "";
      var inBlok = (v0 && /^INC/i.test(String(v0))) || /copas tket!A\d+/i.test(f0);
      if (inBlok) {
        blokAkhir = TTR_START_ROW + c0;
        adaBlok = true;
        scanMasuk = true;
      } else if (scanMasuk) {
        break; // sudah lewat blok (menuju report block)
      }
      // sebelum blok mulai: tetap lanjut scan (blok boleh mulai lebih turun dari row 3)
    }
  }
  var kapasitas = Math.max(blokAkhir - TTR_START_ROW + 1, 0);
  var count = Math.min(rowsData.length, kapasitas);

  // Bila blok TIDAK terdeteksi padahal ada data tiket: cek area A-G dari TTR_START_ROW
  // ke bawah sudah kosong semua (mis. blok pernah dibersihkan / lastRow kecil). Kalau
  // kosong, jadikan batas blok = sebesar kebutuhan baris (dibatasi TTR_MAKS_BARIS) —
  // TANPA batas lastRow, supaya data tetap muncul walau sheet cuma berisi header.
  if (!adaBlok && rowsData.length > 0) {
    var targetAwal = TTR_START_ROW + Math.min(rowsData.length, TTR_MAKS_BARIS) - 1;
    if (cekKosongBlok(ws, TTR_START_ROW, 1, targetAwal - TTR_START_ROW + 1, 7)) {
      blokAkhir = targetAwal;
      adaBlok = true;
    } else if (scanRows > 0) {
      blokAkhir = TTR_START_ROW + scanRows - 1; // area terisi lain -> batasi di scan area
    } else {
      console.log("[BotInsera] TTR: blok tak terdeteksi & area A-G baris " +
                  TTR_START_ROW + "-" + targetAwal + " berisi data lain, skip rebuild.");
      return 0;
    }
  }

  // EKSPANSI BLOK: data tiket bisa lebih banyak dari blok saat ini (blok mengecil
  // karena pernah ditulis kosong saat data sedang sedikit). Perluas blok ke bawah
  // SELAMA kolom A-G area tujuannya masih kosong (report block hidup di kolom K+,
  // kolom A-G di bawah blok umumnya kosong). Dibatasi TTR_MAKS_BARIS.
  if (rowsData.length > kapasitas) {
    var targetBawah = Math.min(TTR_START_ROW + rowsData.length - 1,
                               TTR_MAKS_BARIS + TTR_START_ROW - 1);
    var perluas = targetBawah - blokAkhir;
    if (perluas > 0) {
      if (cekKosongBlok(ws, blokAkhir + 1, 1, perluas, 7)) {
        blokAkhir = targetBawah;
        kapasitas = blokAkhir - TTR_START_ROW + 1;
        adaBlok = true;
      } else {
        console.log("[BotInsera] TTR: tak bisa perluas blok, kolom A-G baris " +
                    (blokAkhir + 1) + "-" + targetBawah + " terisi non-kosong.");
      }
    }
  }
  count = Math.min(rowsData.length, kapasitas);

  if (blokAkhir < TTR_START_ROW) {
    console.log("[BotInsera] TTR: blok data tidak terdeteksi, skip rebuild.");
    return 0;
  }

  var barisTulis = [];
  for (var i = 0; i < kapasitas; i++) {
    var row = (i < count) ? rowsData[i] : null;
    if (!row) { barisTulis.push(["", "", "", "", "", "", ""]); continue; }
    barisTulis.push([
      val(row, colSto),                       // A = STO (WORKZONE)
      val(row, colIncident),                  // B = NO TIKET (INCIDENT)
      val(row, TTR_SRC_INET_GANGGUAN),        // C = INET GANGGUAN (SERVICE NO)
      val(row, TTR_SRC_CUSTOMER_TYPE),        // D = CUSTOMER TYPE
      valPreserveDate(row, TTR_SRC_REPORT_DATE), // E = REPORT DATE (biar Date, bukan teks)
      valPreserveDate(row, TTR_SRC_MANJA),    // F = MANJA (BOOKING DATE)
      val(row, TTR_SRC_TYPE_TIKET)            // G = TYPE TIKET (SERVICE TYPE)
    ]);
  }
  if (barisTulis.length > 0) {
    ws.getRange(TTR_START_ROW, 1, barisTulis.length, 7).setValues(barisTulis);
  }

  // Pastikan rumus DURASI (kolom H) ada & valid di tiap baris data.
  // Tulis ulang apabila: H kosong, ATAU nilai H-nya error (mis. #ERROR!/#VALUE!
  // akibat kutip melengkung dari paste sebelumnya). Nilai huruf/angka normal dibiarkan.
  var hRestore = 0;
  if (kapasitas > 0) {
    var hFormulas = ws.getRange(TTR_START_ROW, 8, kapasitas, 1).getFormulas();
    var hValues = ws.getRange(TTR_START_ROW, 8, kapasitas, 1).getValues();
    for (var hi = 0; hi < kapasitas; hi++) {
      var fNow = hFormulas[hi][0] || "";
      var vNow = hValues[hi][0];
      var checkVal = (typeof vNow === "string") ? vNow
        : (vNow && typeof vNow.getMessage === "function") ? vNow.getMessage() : "";
      var isError = checkVal.charAt(0) === "#";
      if (fNow === "" || isError) {
        ws.getRange(TTR_START_ROW + hi, 8).setFormula(rumusDURASI(TTR_START_ROW + hi));
        hRestore++;
      }
    }
  }
  console.log("[BotInsera] TTR di-update: data=" + count + " baris (kapasitas blok " + kapasitas +
              ", scanRows=" + scanRows + ", rentang " + TTR_START_ROW + "-" + blokAkhir +
              ", H restored=" + hRestore + ")");
  return count;
}

// Baca kolom M 'DATA PS' (1-based: 13) sekali untuk daftar SERVICE NO yang di-flag FFG.
// READ-ONLY: tab DATA PS tidak pernah ditulis/diubah oleh script.
function bacaSetDataPS() {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("DATA PS");
  if (!ws) { console.log("[BotInsera] Tab 'DATA PS' tidak ditemukan, FFG flag default ke Not FFG."); return null; }
  var lastRow = ws.getLastRow();
  if (lastRow <= 1) return {};
  var colM = ws.getRange(1, 13, lastRow, 1).getValues();
  var set = {};
  for (var i = 1; i < lastRow; i++) { // lewati header (baris 1)
    var v = colM[i][0];
    if (v !== "" && v !== null) set[String(v).trim()] = true;
  }
  return set;
}

// Kumpulkan seluruh baris tiket valid dari copas tket, sort WORKZONE A-Z,
// lalu rebuild blok kiri semua tab di BLOK_REPORT (nilai statis).
function kumpulDanTulisReport(ws, colIncident, colSto) {
  var nilai = ws.getDataRange().getValues();
  var rowsFinal = [];
  for (var i = 1; i < nilai.length; i++) {
    if (val(nilai[i], colIncident) !== "") rowsFinal.push(nilai[i]);
  }
  sortRows(rowsFinal, colSto, colIncident);

  var setDataPS = bacaSetDataPS();
  var total = 0;
  for (var b = 0; b < BLOK_REPORT.length; b++) {
    total += tulisBlokReport(BLOK_REPORT[b], rowsFinal, colIncident, colSto, setDataPS);
  }
  return total;
}

/**
 * Tulis ulang blok kiri satu tab laporan (nilai statis dari copas tket).
 * Tidak insert/delete baris; hanya menulis ulang kolom yang terpetakan di cfg.pemetaan
 * mulai cfg.startRow. Batas atas = cfg.maxBaris. Blok deteksi/disimpulkan dari kolom
 * cfg.kolomNoTiket (nilai "INC..." atau rumus lama `='copas tket'!Axx`).
 */
function tulisBlokReport(cfg, rowsData, colIncident, colSto, setDataPS) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(cfg.tab);
  if (!ws) {
    console.log("[BotInsera] Tab '" + cfg.tab + "' tidak ditemukan, skip rebuild.");
    return 0;
  }
  var start = cfg.startRow;
  var jmlKolom = cfg.pemetaan.length;
  var lastRowT = ws.getLastRow();
  var scanRows = Math.min(cfg.maxBaris + start - 1, lastRowT) - start + 1;
  if (scanRows <= 0) { scanRows = 0; }

  var blokAkhir = start - 1;
  var adaBlok = false;
  if (scanRows > 0) {
    var colNVal = ws.getRange(start, cfg.kolomNoTiket, scanRows, 1).getValues();
    var colNFrm = ws.getRange(start, cfg.kolomNoTiket, scanRows, 1).getFormulas();
    var scanMasuk = false;
    for (var c0 = 0; c0 < scanRows; c0++) {
      var v0 = colNVal[c0][0];
      var f0 = colNFrm[c0][0] || "";
      var inBlok = (v0 && /^INC/i.test(String(v0))) || /copas tket!A\d+/i.test(f0);
      if (inBlok) { blokAkhir = start + c0; adaBlok = true; scanMasuk = true; }
      else if (scanMasuk) { break; }
    }
  }
  var kapasitas = Math.max(blokAkhir - start + 1, 0);
  var count = Math.min(rowsData.length, kapasitas);

  // Bila blok TIDAK terdeteksi padahal ada data tiket: cek area kolom 1..jmlKolom dari
  // start ke bawah sudah kosong semua (blok pernah dibersihkan / lastRow kecil). Kalau
  // kosong, jadikan batas blok = sebesar kebutuhan baris (dibatasi cfg.maxBaris) —
  // TANPA batas lastRow, supaya data tetap muncul walau sheet cuma berisi header.
  if (!adaBlok && rowsData.length > 0) {
    var targetAwal = start + Math.min(rowsData.length, cfg.maxBaris) - 1;
    if (cekKosongBlok(ws, start, 1, targetAwal - start + 1, jmlKolom)) {
      blokAkhir = targetAwal;
      adaBlok = true;
    } else if (scanRows > 0) {
      blokAkhir = start + scanRows - 1; // area terisi lain -> batasi di scan area
    } else {
      console.log("[BotInsera] " + cfg.tab + ": blok tak terdeteksi & area baris " +
                  start + "-" + targetAwal + " berisi data lain, skip rebuild.");
      return 0;
    }
  }

  if (rowsData.length > kapasitas) {
    var targetBawah = Math.min(start + rowsData.length - 1, cfg.maxBaris + start - 1);
    var perluas = targetBawah - blokAkhir;
    if (perluas > 0) {
      if (cekKosongBlok(ws, blokAkhir + 1, 1, perluas, jmlKolom)) {
        blokAkhir = targetBawah;
        kapasitas = blokAkhir - start + 1;
        adaBlok = true;
      }
    }
  }
  count = Math.min(rowsData.length, kapasitas);

  if (blokAkhir < start) {
    console.log("[BotInsera] " + cfg.tab + ": blok kiri tidak terdeteksi, skip rebuild.");
    return 0;
  }

  var barisTulis = [];
  for (var i = 0; i < kapasitas; i++) {
    var row = (i < count) ? rowsData[i] : null;
    var out = [];
    for (var c = 0; c < jmlKolom; c++) {
      var pem = cfg.pemetaan[c];
      if (!row) { out.push(""); continue; }
      if (pem === "DURASI") { out.push(""); continue; }
      if (pem === "FFG") {
        var svc = val(row, TTR_SRC_INET_GANGGUAN);
        out.push((setDataPS && svc !== "" && setDataPS[svc] === true) ? "FFG" : "Not FFG");
        continue;
      }
      var srcIdx = (pem === -1) ? colSto : (pem === -2) ? colIncident : pem;
      var isDateCol = (srcIdx === TTR_SRC_REPORT_DATE || srcIdx === TTR_SRC_MANJA);
      out.push(isDateCol ? valPreserveDate(row, srcIdx) : val(row, srcIdx));
    }
    barisTulis.push(out);
  }
  if (barisTulis.length > 0) {
    ws.getRange(start, 1, barisTulis.length, jmlKolom).setValues(barisTulis);
  }

  // Tulis ulang rumus DURASI (sekali panggil setFormulas) — kolom cfg.rumusDurasi.col.
  var hRestore = 0;
  if (cfg.rumusDurasi && kapasitas > 0) {
    var formulas = [];
    for (var fi = 0; fi < kapasitas; fi++) {
      formulas.push([rumusDurasiKolom(cfg.rumusDurasi.dateCol, cfg.rumusDurasi.nowRef, start + fi)]);
    }
    ws.getRange(start, cfg.rumusDurasi.col, kapasitas, 1).setFormulas(formulas);
    hRestore = kapasitas;
  }
  console.log("[BotInsera] " + cfg.tab + " blok kiri di-rebuild: data=" + count +
              " baris (kapasitas " + kapasitas + ", rentang " + start + "-" + blokAkhir +
              ", DURASI restore=" + hRestore + ")");
  return count;
}

// ============ REBUILD OTOMATIS (AUTO KETIKA COPAS TKET DIEDIT) ============

// Auto-rebuild ketika tab 'copas tket' di-EDIT MANUAL oleh user (paste tiket,
// tulis manual, hapus baris dsb.). Perubahan yang dilakukan SCRIPT — termasuk
// dari doPost bot sync — TIDAK memicu onEdit, jadi tidak dobel-rebuild dengan bot.
// Debounce 45 detik (via CacheService) supaya paste besar yang memicu beberapa
// event edit beruntun tidak sampai rebuild berkali-kali.
function onEdit(e) {
  var range = e ? e.range : null;
  if (!range || !range.getSheet()) return;
  if (range.getSheet().getName() !== TAB_TUJUAN) return;
  if (range.getRow() < 2) return;

  try {
    var cache = CacheService.getScriptCache();
    var kunci = "lastAutoRebuild";
    var now = Date.now();
    var last = cache.get(kunci);
    if (last && (now - parseInt(last, 10)) < 45000) return;
    cache.put(kunci, String(now), 55);
  } catch (err) {
    // CacheService tak tersedia => tetap rebuild (tanpa debounce).
  }

  rebuildSemuaInternal();
}

// Baca isi copas tket terkini, deteksi kolom INCIDENT & WORKZONE dari header,
// lalu rebuild MONITORING TTR + blok kiri REPORT JAKUT / JAKBAR / FFG.
function rebuildSemuaInternal() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(TAB_TUJUAN);
  if (!ws) return;
  var lastCol = Math.max(ws.getLastColumn(), 1);
  var header = ws.getRange(1, 1, 1, lastCol).getValues()[0];
  var colIncident = -1;
  var colSto = -1;
  for (var i = 0; i < lastCol; i++) {
    var h = String(header[i]).toUpperCase();
    // Ambil kejadian PERTAMA (kolom INCIDENT selalu paling awal / dekat awal header).
    if (colIncident < 0 && /INCIDENT/.test(h)) colIncident = i;
    if (colSto < 0 && /WORKZONE/.test(h)) colSto = i;
  }
  if (colIncident < 0) colIncident = 0;
  if (colSto < 0) colSto = COL_WORKZONE_DEFAULT;
  console.log("[BotInsera] auto-rebuild (user edit) colIncident=" + colIncident +
              " colSto=" + colSto);
  var ttr = kumpulDanTulisTTR(ws, colIncident, colSto);
  var report = kumpulDanTulisReport(ws, colIncident, colSto);
  console.log("[BotInsera] auto-rebuild selesai: TTR=" + ttr + " report=" + report);
}
