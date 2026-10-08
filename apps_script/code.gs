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
 *        v2.4.3 - Fix hitung ulang kapasitas blok setelah seed sehingga data benar-benar ditulis.
 *        v2.4.4 - Penanda VERSI di doPost log & doGet untuk memastikan versi deployment yang jalan.
 * v2.8 - Kolom I (TICKET ID GAMAS) di MONITORING TTR & LAPORAN WA diisi dari copas tket
 *        kolom M (deteksi dari header, fallback index 12); kosong -> "-".
 *        Kolom manual J (STATUS GAMAS) / K (STATUS) / L (HASIL UKUR) TIDAK diedit tapi
 *        IKUT DIPINDAH per NO TIKET saat baris di-sort ulang (re-key). Guard: bila J-L
 *        berisi formula COUNTIFS (blok rekap lama), J-L dilewati & hanya I yang ditulis.
 *        Rumus DURASI kini ADAPTIF (pola & sel NOW() dideteksi dari rumus H yang ada,
 *        mis. K$1 / $O$1) supaya aman terhadap penyisipan kolom oleh mentor.
 * v2.7 - Blok LAPORAN WA: tab baru berkonsep SAMA dengan MONITORING TTR (A-G statis +
 *        rumus DURASI H) ikut di-rebuild tiap sync & auto-rebuild. Kolom I (NO WA) berumus
 *        dari sheet lain -> TIDAK disentuh. Logika TTR direfaktor jadi generik
 *        (_kumpulDanTulisBlokMonitoring/_tulisBlokMonitoring) dipakai untuk kedua tab.
 * v2.6 - Auto-rebuild ANDAL untuk paste MANUAL: installable onChange + waktu berkala
 *        (jaring pengaman) + guard anti-dobel dari tulisan doPost (bot). Jalankan SEKALI
 *        menu 'BotInsera' > "⚡ Pasang Auto-Rebuild" (fungsi pasangTrigger) -> paste manual
 *        di tab 'copas tket' / edit 'DATA PS' otomatis me-rebuild MONITORING TTR +
 *        REPORT JAKUT + REPORT JAKBAR + FFG tanpa klik rebuild manual lagi.
 * v2.5 - GUARD anti-hapus: bila INC yang diterima turun drastis saat lengkap=true, hapus/rewrite
 *        ditunda (data lama dipertahankan); monitoring lengkap+kapasitas via tab LOG SYNC (kolom
 *        GUARD/TRUNCATED/PENYEBAB/DURASI) yang dipangkas otomatis (LOG_MAKS_BARIS); truncation,
 *        guard & alasan dilaporkan ke userscript (toast + popup Gap/Penyebab); doPost mengembalikan
 *        jmlLama (jumlah INC lama) untuk popup guard; tulisTiket memakai kumpulDanTulis* yang
 *        mengembalikan {count, truncated}; onEdit debounce 5 dtk + pantau tab 'DATA PS'
 *        (ffgOnly rebuild REPORT/FFG); menu 'BotInsera' (Rebuild
 *        Semua + Cek Konsistensi); rumus DURASI kolom H ditulis batch (setFormulas kontigu).
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
 * 8. (PENTING untuk paste MANUAL) Setelah deploy, buka spreadsheet lalu klik
 *    menu 'BotInsera' > "⚡ Pasang Auto-Rebuild" (atau jalankan fungsi pasangTrigger
 *    di editor) dan ikuti Authorize. Ini memasang trigger onChange + berkala sehingga
 *    paste manual di tab 'copas tket' / edit 'DATA PS' otomatis me-rebuild TTR + REPORT/FFG.
 */

// ============ KONFIGURASI ============
var ACCESS_TOKEN = "#Ez6KQZpzEYYXSeYWyZAGA7N";
var VERSI = "v2.8.0"; // penanda versi: dipakai di log & doGet biar tahu kode mana yang jalan.
var TAB_TUJUAN = "copas tket";

// Tab MONITORING TTR (blok data utama) — diisi ulang otomatis oleh script (nilai statis).
var TAB_TTR = "MONITORING TTR";
var TTR_START_ROW = 3;    // baris pertama blok data TTR (baris 1 = judul, baris 2 = header).
var TTR_MAKS_BARIS = 1000000; // praktis tanpa batas; aman karena ekspansi tetap dicek ruang kosong (cekKosongBlok).

// Tab LAPORAN WA — konsep SAMA seperti MONITORING TTR: A=STO B=NO TIKET C=INET GANGGUAN
// D=CUSTOMER TYPE E=REPORT DATE F=MANJA G=TYPE TIKET, H=rumus DURASI, I=TICKET ID GAMAS,
// J=STATUS GAMAS K=STATUS L=HASIL UKUR (J-L manual, hanya ikut dipindah per NO TIKET).
// Kolom M ke kanan (mis. NO WA berumus) TIDAK disentuh script.
var TAB_WA = "LAPORAN WA";
var WA_START_ROW = 3;
var WA_MAKS_BARIS = 1000000;

// Daftar blok monitoring yang direbuild dari copas tket (nilai statis + rumus DURASI H).
// Urutan = urutan pengerjaan. cfg.tab tidak ada di spreadsheet -> dilewati (log saja).
var CFG_TTR = { tab: TAB_TTR, startRow: TTR_START_ROW, maksBaris: TTR_MAKS_BARIS, label: "MONITORING TTR" };
var CFG_WA  = { tab: TAB_WA,  startRow: WA_START_ROW,  maksBaris: WA_MAKS_BARIS,  label: "LAPORAN WA" };
var CFG_BLOK_MONITORING = [CFG_TTR, CFG_WA];

// ============ LOG RIWAYAT SYNC & GUARD ANTI-HAPUS ============
var TAB_LOG = "LOG SYNC"; // tab riwayat tiap sync (auto-dibuat bila belum ada).
var LOG_MAKS_BARIS = 10;  // LOG SYNC dipangkas otomatis: sisakan N baris terbaru (baris 1 = header).
// lengkap=true tapi jumlah INC diterima < GUARD_BATAS_PENYUSUTAN x jumlah lama
// -> langkah HAPUS + rewrite DITUNDA (data baru tetap ditulis), ditandai di log.
var GUARD_BATAS_PENYUSUTAN = 0.6;
var COL_WORKZONE_DEFAULT = 9; // index kolom WORKZONE (0-based) di baris data copas tket; fallback.

// ============ TRIGGER AUTO-REBUILD (AGAR PASTE MANUAL TIDAK PERLU KLIK REBUILD) ============
// Instal SEKALI via menu 'BotInsera' > "⚡ Pasang Auto-Rebuild" (fungsi pasangTrigger):
//  - onChange (installable): terpacu OLEH perubahan apa pun (termasuk paste) -> rebuild langsung.
//  - berkala (time-based):   jaring pengaman tiap JEDA_TRIGGER_BERKALA_MENIT menit,
//                            rebuild hanya bila data di copas tket / DATA PS berubah.
// Guard: tulisan yang dilakukan SCRIPT SENDIRI (doPost bot / rebuild) tidak men-dobel-rebuild;
// hanya edit MANUAL (atau pastikan perubahan) yang memicu. Simple onEdit tetap dipertahankan
// sebagai jalur instan, semua jalur melewati kunci yang sama.
var KUNCI_AUTO_REBUILD = "botinsera_last_auto_rebuild";
var JENDELA_ABSORB_REBUILD_MS = 10000; // event beruntun (paste besar / onEdit+onChange) -> hanya 1 rebuild
var KUNCI_SCRIPT_WRITE = "botinsera_script_write";
var JENDELA_SKIP_SCRIPT_WRITE_MS = 10 * 60 * 1000; // 10 menit: abaikan event hasil tulisan script (doPost)
var JEDA_TRIGGER_BERKALA_MENIT = 5;               // frekuensi jaring pengaman berkala

// Pemetaan kolom data copas tket (index 0-based) ke kolom blok data TTR (1-based, kolom A=1).
// A=STO(colSto) B=NO TIKET(colIncident) C=INET GANGGUAN(SERVICE NO=30) D=CUSTOMER TYPE(24)
// E=REPORT DATE(REPORTED DATE=3) F=MANJA(BOOKING DATE=17) G=TYPE TIKET(SERVICE TYPE=7)
// I=TICKET ID GAMAS (kolom M copas tket; dideteksi dari header, fallback index di bawah)
var TTR_SRC_INET_GANGGUAN = 30;
var TTR_SRC_CUSTOMER_TYPE = 24;
var TTR_SRC_REPORT_DATE   = 3;
var TTR_SRC_MANJA         = 17;
var TTR_SRC_TYPE_TIKET    = 7;
var TTR_SRC_TICKET_ID_GAMAS = 12; // kolom M 'copas tket' (0-based); fallback bila header tak terbaca

// Blok kiri tab laporan (REPORT JAKUT / REPORT JAKBAR / FFG) — ikut di-rebuild dari copas tket
// setiap sync (nilai statis, sort WORKZONE A-Z), tepat seperti blok data MONITORING TTR.
// Tabel kanan (FILTER kewitel dsb.) & tab DATA PS TIDAK disentuh (DATA PS hanya dibaca untuk FFG).
// Setiap cfg:
//   tab         = nama tab sheet.
//   startRow    = baris pertama data blok kiri (JAKUT/JAKBAR = 3, FFG = 2).
//   maxBaris    = cukup besar (≈ tanpa batas); blok meluas selama kolom blok di bawah masih kosong.
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
    maxBaris: 1000000,
    kolomNoTiket: 3, // C = NO TIKET
    rumusDurasi: { col: 9, dateCol: "F", nowRef: "L$1" }, // I DURASI, hitung dari F (REPORT DATE) vs L1=NOW()
    // A=WITEL(8) B=STO(-1) C=NO TIKET(-2) D=INET GANGGUAN(30) E=CUSTOMER TYPE(24)
    // F=REPORT DATE(3) G=MANJA(17) H=TYPE TIKET(7) I=DURASI
    pemetaan: [8, -1, -2, 30, 24, 3, 17, 7, "DURASI"]
  },
  {
    tab: "REPORT JAKBAR",
    startRow: 3,
    maxBaris: 1000000,
    kolomNoTiket: 3,
    rumusDurasi: { col: 9, dateCol: "F", nowRef: "L$1" },
    pemetaan: [8, -1, -2, 30, 24, 3, 17, 7, "DURASI"]
  },
  {
    tab: "FFG",
    startRow: 2,
    maxBaris: 1000000,
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
  var mulaiTotal = Date.now();
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
    console.log("[BotInsera] doPost " + VERSI + ": rows=" + (rows && rows.length) +
                " colIncident=" + colIncident + " colSto=" + colSto + " lengkap=" + lengkap);

    if (rows.length === 0) {
      out.ok = true;
      out.baru = 0; out.update = 0; out.lewat = 0; out.total = 0; out.ttr = 0; out.report = 0; out.wa = 0;
      return ContentService.createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Warna: HIJAU = baru, KUNING = lama. Bedanya ditentukan tulisTiket.
    var warnaBaru = WARNA_BARU;
    var warnaLama = WARNA_LAMA;

    // Tandai bahwa tulisan berikut berasal dari SCRIPT (bot) -> onChange/onEdit akan
    // melewati event ini (tidak dobel-rebuild; doPost sudah rebuild di dalam _tulisTiket).
    _tandaiScriptTulis();
    var stat = _tulisTiket(rows, colIncident, colSto, lengkap, warnaBaru, warnaLama);
    _bersihkanScriptTulis();
    out.ok = true;
    out.baru = stat.baru;
    out.update = stat.update;
    out.lewat = stat.lewat;
    out.hapus = stat.hapus || 0;
    out.ttr = stat.ttr || 0;
    out.report = stat.report || 0;
    out.wa = stat.wa || 0;
    out.truncated = !!(stat.ttrTruncated || stat.reportTruncated || stat.waTruncated);
    out.guard = !!stat.guard;
    out.jmlLama = stat.jmlLama || 0;
    var alasan = [];
    if (stat.alasan) alasan.push(String(stat.alasan));
    if (stat.ttrTruncated) alasan.push("TRUNCATED: baris MONITORING TTR lebih sedikit dari data (ruang bawah padat)");
    if (stat.waTruncated) alasan.push("TRUNCATED: baris LAPORAN WA lebih sedikit dari data (ruang bawah padat)");
    if (stat.reportTruncated) alasan.push("TRUNCATED: baris REPORT/FFG lebih sedikit dari data (ruang bawah padat)");
    out.alasan = alasan.length > 0 ? alasan.join(" ; ") : "";
    out.durasi_ms = Date.now() - mulaiTotal;
    out.total = stat.baru + stat.update;

    // LOG SYNC: riwayat setiap sync.
    _catatLogSync({
      WAKTU: new Date(),
      VERSI: VERSI,
      ROWS: (rows && rows.length) || 0,
      BARU: stat.baru,
      UPDATE: stat.update,
      LEWAT: stat.lewat,
      HAPUS: stat.hapus || 0,
      TTR: stat.ttr || 0,
      REPORT: stat.report || 0,
      WA: stat.wa || 0,
      LENGKAP: lengkap ? "YA" : "TIDAK",
      DURASI_MS: out.durasi_ms,
      DURASI_REPORT_MS: stat.durasiReportMs || 0,
      PENYEBAB: out.alasan || (stat.guard ? "GUARD aktif (lihat GUARD)" : "OK"),
      GUARD: stat.guard ? "YA" : "",
      TRUNCATED: out.truncated ? "YA" : "",
      COL_INC: colIncident,
      COL_STO: colSto
    });

    return ContentService.createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    out.error = String(err);
    _bersihkanScriptTulis();
    return ContentService.createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  // Diagnostik: tampilkan nama spreadsheet & versi biar tahu URL ini ngarah ke mana.
  var nama = "";
  try { nama = SpreadsheetApp.getActiveSpreadsheet().getName(); } catch (err) { /* ignore */ }
  return ContentService
    .createTextOutput("BotInsera Apps Script (" + VERSI + ") OK" + (nama ? " | spreadsheet: " + nama : ""))
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
  _dumpCodes("H3 formula", h3.getFormula());
  _dumpCodes("K1 formula", ws.getRange("K1").getFormula());
}

// Cetak kode karakter (decimal) tiap huruf string s.
// Kutip ASCII = 34; kutip melengkung kiri/kanan = 8220/8221; spasi non-break = 160.
function _dumpCodes(label, s) {
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
function _tulisTiket(rowsBaru, colIncident, colSto, lengkap, warnaBaru, warnaLama) {
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

  var stat = { baru: 0, update: 0, lewat: 0, hapus: 0, ttr: 0, report: 0, wa: 0,
               ttrTruncated: false, reportTruncated: false, waTruncated: false,
               guard: false, alasan: "", jmlLama: 0, durasiReportMs: 0 };
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

  // Set INC yang diterima dari Insera (update + baru) + hitung GUARD anti-hapus.
  var incDiInsera = {};
  Object.keys(barisUpdate).forEach(function (k) { incDiInsera[k] = true; });
  for (var b9 = 0; b9 < barisBaru.length; b9++) {
    var incb9 = barisBaru[b9] && barisBaru[b9][colIncident] !== undefined
      ? String(barisBaru[b9][colIncident]).trim().toUpperCase() : "";
    if (incb9 !== "") incDiInsera[incb9] = true;
  }
  var jmlIncBaru = Object.keys(incDiInsera).length;
  var jmlInsaLama = Object.keys(peta).length;
  stat.jmlLama = jmlInsaLama;
  var guardAktif = false;
  if (lengkap && jmlInsaLama > 5 && jmlIncBaru < Math.round(jmlInsaLama * GUARD_BATAS_PENYUSUTAN)) {
    guardAktif = true;
    console.log("[BotInsera] GUARD anti-hapus AKTIF: incoming INC=" + jmlIncBaru +
                " << lama=" + jmlInsaLama + ". Hapus/rewrite DITUNDA (data tetap ditulis).");
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
    if (!lengkap) _sortRows(barisBaru, colSto, colIncident);
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
  //     Langkah ini DILEWATI saat GUARD aktif (INC yang diterima turun drastis).
  if (lengkap && !guardAktif) {
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

    _hapusRentangCepat(ws, rowsHapus);
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
        if (_val(curDataAll[cf], colIncident) === "") continue;
        finalRows.push(curDataAll[cf]);
      }
      _sortRows(finalRows, colSto, colIncident);

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
          var cellInc = _val(sortedMatrix[crm], colIncident).toUpperCase();
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

  // (6) Rebuild MONITORING TTR + LAPORAN WA dari data copas tket terkini
  //     (selalu di-sort WORKZONE A-Z; kolom I LAPORAN WA / NO WA tidak disentuh).
  var hasilTTR = _kumpulDanTulisTTR(ws, colIncident, colSto);
  stat.ttr = hasilTTR.count;
  stat.ttrTruncated = hasilTTR.truncated;

  var hasilWA = _kumpulDanTulisWA(ws, colIncident, colSto);
  stat.wa = hasilWA.count;
  stat.waTruncated = hasilWA.truncated;

  // (7) Rebuild blok kiri REPORT JAKUT / REPORT JAKBAR / FFG (nilai statis, READ-ONLY thd DATA PS).
  var mulaiReport = Date.now();
  var hasilReport = _kumpulDanTulisReport(ws, colIncident, colSto);
  stat.durasiReportMs = Date.now() - mulaiReport;
  stat.report = hasilReport.count;
  stat.reportTruncated = hasilReport.truncated;

  stat.guard = guardAktif;
  stat.alasan = guardAktif
    ? "GUARD: INC yang diterima turun drastis (" + jmlIncBaru + " vs lama " + jmlInsaLama + ") — hapus/rewrite ditunda."
    : "";
  stat.total = stat.baru + stat.update;
  return stat;
}

/**
 * Hapus daftar baris (1-based) secara cepat: kelompokkan baris berurutan menjadi
 * satu panggilan `deleteRow` per-chunk kontigu, urut terbalik biar index tidak geser.
 */
function _hapusRentangCepat(ws, rowsHapus) {
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
function _cekKosongBlok(ws, row, col, numRows, numCols) {
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
function _val(row, idx) {
  return (row && idx !== undefined && row.length > idx && row[idx] !== undefined && row[idx] !== null)
    ? String(row[idx]).trim() : "";
}

// Ambil nilai dari sel — JIKA Date object, biarkan sebagai Date (agar rumus Sheets bisa baca).
// Jika bukan Date, kembalikan trimmed string seperti _val().
function _valPreserveDate(row, idx) {
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
function _rumusDURASI(row1) {
  // MONITORING TTR: tanggal di kolom E, NOW() di K1.
  return _rumusDurasiKolom("E", "K$1", row1);
}

// Rumus DURASI generik: tanggal di kolom `colDate`, acuan NOW() di `refNow` (mis. E/K$1 atau F/L$1).
function _rumusDurasiKolom(colDate, refNow, row1) {
  var q = String.fromCharCode(34); // karakter kutip ASCII "
  return "=IF(ISBLANK(" + colDate + row1 + ");" + q + q + ";INT((" + refNow + "-" + colDate + row1 + ")*24)&" + q +
         " Jam " + q + "&MINUTE(" + refNow + "-" + colDate + row1 + ")&" + q + " Menit" + q + ")";
}

// Tulis ulang rumus DURASI kolom H MONITORING TTR secara BATCH (chunk kontigu).
// restoreIdx = array offset (0-based, relatif ttlRowAwal) yang perlu diisi ulang.
// pola = { colDate, refNow } hasil _deteksiPolaDurasi (default E / K$1).
function _setRumusDurasiBatch(ws, ttlRowAwal, restoreIdx, pola) {
  if (!restoreIdx || restoreIdx.length === 0) return 0;
  var colDate = (pola && pola.colDate) ? pola.colDate : "E";
  var refNow = (pola && pola.refNow) ? pola.refNow : "K$1";
  restoreIdx = restoreIdx.slice().sort(function (a, b) { return a - b; });
  var totalTulis = 0;
  var start = restoreIdx[0], prev = restoreIdx[0];
  function flush(endIdx) {
    var blokLen = endIdx - start + 1;
    var matriks = [];
    for (var r = 0; r < blokLen; r++) {
      matriks.push([_rumusDurasiKolom(colDate, refNow, ttlRowAwal + start + r)]);
    }
    ws.getRange(ttlRowAwal + start, 8, blokLen, 1).setFormulas(matriks);
    totalTulis += blokLen;
  }
  for (var i = 1; i < restoreIdx.length; i++) {
    if (restoreIdx[i] === prev + 1) { prev = restoreIdx[i]; continue; }
    flush(prev);
    start = restoreIdx[i]; prev = restoreIdx[i];
  }
  flush(prev);
  return totalTulis;
}

// Cari indeks kolom (0-based) dari nama header pada baris pertama worksheet `ws`.
// return null bila tidak ditemukan (pemanggil pakai fallback).
function _cariKolomHeader(ws, namaHeader) {
  var lastCol = ws.getLastColumn();
  if (!lastCol || lastCol < 1) return null;
  var hdr = ws.getRange(1, 1, 1, lastCol).getValues()[0] || [];
  var target = String(namaHeader || "").trim().toUpperCase();
  for (var i = 0; i < hdr.length; i++) {
    if (String(hdr[i] === undefined || hdr[i] === null ? "" : hdr[i]).trim().toUpperCase() === target) return i;
  }
  return null;
}

// Ambil TICKET ID GAMAS dari baris copas tket (index 0-based, hasil deteksi header).
// Kosong -> "-". Dipakai kolom I MONITORING TTR & LAPORAN WA.
function _gamasDariBaris(row, colGamas) {
  var idx = (colGamas === undefined || colGamas === null) ? TTR_SRC_TICKET_ID_GAMAS : colGamas;
  var v = (row && idx >= 0 && row.length > idx && row[idx] !== undefined && row[idx] !== null)
    ? String(row[idx]).trim() : "";
  return v === "" ? "-" : v;
}

// Deteksi pola rumus DURASI (kolom H) dari sheet tujuan supaya tahu:
//  - kolom tanggal (colDate, mis. "E")
//  - acuan NOW() (refNow, mis. "K$1" ATAU "$O$1" bila mentor menggeser kolom)
// Dipanggil SEBELUM rumus H ditulis ulang; hasilnya dipakai untuk restore H + isi sel NOW.
// Kembalian default { colDate: "E", refNow: "K$1" } bila belum ada rumus H sama sekali.
function _deteksiPolaDurasi(ws, startRow, kapasitas) {
  var pola = { colDate: "E", refNow: "K$1" };
  if (kapasitas > 0) {
    try {
      var f = ws.getRange(startRow, 8, kapasitas, 1).getFormulas();
      for (var i = 0; i < f.length; i++) {
        var s = f[i][0];
        if (typeof s !== "string" || s.charAt(0) !== "=") continue;
        // Bentuk: =IF(ISBLANK(<col><row>);...INT((<ref>-<col><row>)*24)...MINUTE(<ref>-...)...
        var mDate = /ISBLANK\((\$?[A-Z]{1,3}\$?\d+)\)/i.exec(s);
        var mRef = /INT\(\((\$?[A-Z]{1,3}\$?\d+)-/i.exec(s);
        if (mDate && mRef) {
          pola.colDate = mDate[1].replace(/\$/g, "").replace(/\d+$/, "");
          pola.refNow = mRef[1];
          return pola;
        }
      }
    } catch (e) { /* fallback default */ }
  }
  // Fallback: belum ada rumus H (sheet baru) -> cari sel =NOW() di baris 1 (mis. K1/O1)
  // supaya tidak mengisi sel NOW di tempat yang salah saat mentor memindahkannya.
  try {
    var lastCol = Math.max(ws.getLastColumn() || 1, 1);
    var f1 = ws.getRange(1, 1, 1, lastCol).getFormulas()[0] || [];
    for (var c = 0; c < f1.length; c++) {
      var fc = f1[c];
      if (typeof fc === "string" && /NOW\s*\(/i.test(fc)) {
        var huruf = "";
        var n = c + 1;
        while (n > 0) { var r0 = (n - 1) % 26; huruf = String.fromCharCode(65 + r0) + huruf; n = Math.floor((n - 1) / 26); }
        pola.refNow = huruf + "$1";
        return pola;
      }
    }
  } catch (e2) { /* fallback default */ }
  return pola;
}

// Isi sel acuan NOW() (mis. K$1 / $O$1) dengan =NOW() HANYA bila selnya kosong.
// Tidak pernah menimpa sel yang sudah terisi (milik user / sudah diisi script).
function _isiSelNow(ws, refNow) {
  try {
    var m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(String(refNow || "").trim());
    if (!m) return false;
    var col = 0;
    var huruf = m[1].toUpperCase();
    for (var i = 0; i < huruf.length; i++) col = col * 26 + (huruf.charCodeAt(i) - 64);
    var sel = ws.getRange(parseInt(m[2], 10), col, 1, 1);
    var v = sel.getValue();
    if (v === "" || v === null) { sel.setFormula("=NOW()"); return true; }
  } catch (e) { /* ignore */ }
  return false;
}

// Urutkan array baris by WORKZONE (A-Z, kosong di akhir) lalu INCIDENT (A-Z).
function _sortRows(rows, colSto, colIncident) {
  if (!rows) return rows;
  rows.sort(function (a, b) {
    var a1 = _val(a, colSto).toUpperCase();
    var b1 = _val(b, colSto).toUpperCase();
    var aE = a1 === "", bE = b1 === "";
    if (aE && bE) return 0;
    if (aE) return 1;  // WORKZONE kosong di akhir
    if (bE) return -1;
    if (a1 < b1) return -1;
    if (a1 > b1) return 1;
    var a2 = _val(a, colIncident).toUpperCase();
    var b2 = _val(b, colIncident).toUpperCase();
    if (a2 < b2) return -1;
    if (a2 > b2) return 1;
    return 0;
  });
  return rows;
}

// Kumpulkan seluruh baris tiket valid dari copas tket, sort WORKZONE A-Z, tulis ke blok
// monitoring pada cfg.tab (MONITORING TTR / LAPORAN WA).
// Kembalian: { count, truncated } — truncated=true bila baris terbaca tak semuanya muat di blok.
function _kumpulDanTulisBlokMonitoring(ws, colIncident, colSto, cfg) {
  // Tab belum ada -> jangan dianggap truncated (biar userscript tidak retry/peringati
  // terus-menerus hanya karena satu tab belum dibuat).
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.tab)) {
    console.log("[BotInsera] Tab '" + cfg.tab + "' belum ada, rebuild " + cfg.label + " dilewati.");
    return { count: 0, truncated: false };
  }
  var nilai = ws.getDataRange().getValues();
  // Kolom TICKET ID GAMAS di copas tket: deteksi dari header (baris 1), fallback index 12 (kolom M).
  var colGamas = _cariKolomHeader(ws, "TICKET ID GAMAS");
  if (colGamas === null || colGamas === undefined) colGamas = TTR_SRC_TICKET_ID_GAMAS;
  var rowsFinal = [];
  for (var i = 1; i < nilai.length; i++) {
    if (_val(nilai[i], colIncident) !== "") rowsFinal.push(nilai[i]);
  }
  _sortRows(rowsFinal, colSto, colIncident);
  var tulis = _tulisBlokMonitoring(cfg, rowsFinal, colIncident, colSto, colGamas);
  return { count: tulis, truncated: rowsFinal.length > tulis };
}

function _kumpulDanTulisTTR(ws, colIncident, colSto) {
  return _kumpulDanTulisBlokMonitoring(ws, colIncident, colSto, CFG_TTR);
}

function _kumpulDanTulisWA(ws, colIncident, colSto) {
  return _kumpulDanTulisBlokMonitoring(ws, colIncident, colSto, CFG_WA);
}

/**
 * Tulis ulang blok data monitoring pada cfg.tab (MONITORING TTR & LAPORAN WA).
 * Yang disentuh script:
 *   A-G  = nilai statis dari copas tket
 *   H    = rumus DURASI (hanya bila kosong/error; pola & sel NOW() dideteksi dari
 *          rumus H yang sudah ada, default E vs K$1)
 *   I    = TICKET ID GAMAS dari copas tket (kosong -> "-"); dilewati bila header I
 *          bukan "TICKET ID GAMAS" ATAU kolom I berisi formula (mis. NO WA lama)
 *   J-L  = STATUS GAMAS / STATUS / HASIL UKUR: kolom MANUAL — nilai lama dipertahankan
 *          lalu DIPINDAH mengikuti NO TIKET (re-key) saat baris di-sort ulang.
 *          Dilewati bila header J-L bukan nama yang diharapkan ATAU ada formula
 *          (blok rekap COUNTIFS lama) di sana.
 * Kolom M ke kanan (NO WA berumus, blok rekap, REPORTING) TIDAK disentuh.
 * Tidak insert/delete baris.
 */
function _tulisBlokMonitoring(cfg, rowsData, colIncident, colSto, colGamas) {
  if (colGamas === undefined || colGamas === null) colGamas = TTR_SRC_TICKET_ID_GAMAS;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(cfg.tab);
  if (!ws) {
    console.log("[BotInsera] Tab '" + cfg.tab + "' tidak ditemukan, skip rebuild " + cfg.label + ".");
    return 0;
  }
  var startRow = cfg.startRow;
  var maksBaris = cfg.maksBaris;
  var nama = cfg.label;

  // Batas blok data: mulai startRow, turun selama kolom B (NO TIKET) diawali "INC".
  // Deteksi pakai DUA sumber: (1) nilai sel (sudah menjadi nilai statis) atau
  // (2) RUMUSNYA SENDIRI `='copas tket'!Axx` (masih rumus lama, evaluasinya boleh kosong).
  // Ini membuat rebuild tetap jalan walau rumus lama belum pernah bernilai/tergeser.
  var lastRowT = ws.getLastRow();
  var scanRows = Math.min(maksBaris + startRow - 1, lastRowT) - startRow + 1;
  if (scanRows <= 0) { scanRows = 0; }
  var blokAkhir = startRow - 1;
  var adaBlok = false;
  if (scanRows > 0) {
    var colBVal = ws.getRange(startRow, 2, scanRows, 1).getValues();
    var colBFrm = ws.getRange(startRow, 2, scanRows, 1).getFormulas();
    var scanMasuk = false;
    for (var c0 = 0; c0 < scanRows; c0++) {
      var v0 = colBVal[c0][0];
      var f0 = colBFrm[c0][0] || "";
      var inBlok = (v0 && /^INC/i.test(String(v0))) || /copas tket!A\d+/i.test(f0);
      if (inBlok) {
        blokAkhir = startRow + c0;
        adaBlok = true;
        scanMasuk = true;
      } else if (scanMasuk) {
        break; // sudah lewat blok (menuju report block)
      }
      // sebelum blok mulai: tetap lanjut scan (blok boleh mulai lebih turun dari row 3)
    }
  }
  var kapasitas = Math.max(blokAkhir - startRow + 1, 0);
  var count = Math.min(rowsData.length, kapasitas);

  // Bila blok TIDAK terdeteksi padahal ada data tiket: cek area A-L dari startRow
  // ke bawah sudah kosong semua (mis. blok pernah dibersihkan / lastRow kecil). Kalau
  // kosong, jadikan batas blok = sebesar kebutuhan baris (dibatasi maksBaris) —
  // TANPA batas lastRow, supaya data tetap muncul walau sheet cuma berisi header.
  // 12 kolom (A-L): kolom manual J-L IKUT dicek supaya tidak ada nilai manual yang
  // tertimpa saat blok dibuat/diperluas.
  if (!adaBlok && rowsData.length > 0) {
    var targetAwal = startRow + Math.min(rowsData.length, maksBaris) - 1;
    if (_cekKosongBlok(ws, startRow, 1, targetAwal - startRow + 1, 12)) {
      blokAkhir = targetAwal;
      adaBlok = true;
    } else if (scanRows > 0) {
      blokAkhir = startRow + scanRows - 1; // area terisi lain -> batasi di scan area
    } else {
      console.log("[BotInsera] " + nama + ": blok tak terdeteksi & area A-L baris " +
                  startRow + "-" + targetAwal + " berisi data lain, skip rebuild.");
      return 0;
    }
  }
  // Hitung ulang kapasitas SETELAH blokAkhir (mungkin berubah oleh seed blok di atas).
  kapasitas = Math.max(blokAkhir - startRow + 1, 0);

  // EKSPANSI BLOK: data tiket bisa lebih banyak dari blok saat ini (blok mengecil
  // karena pernah ditulis kosong saat data sedang sedikit). Perluas blok ke bawah
  // SELAMA area A-L tujuannya masih kosong (kolom M+ di bawah blok umumnya kosong;
  // kolom manual J-L tidak boleh tertimpa). Dibatasi maksBaris.
  if (rowsData.length > kapasitas) {
    var targetBawah = Math.min(startRow + rowsData.length - 1,
                               maksBaris + startRow - 1);
    var perluas = targetBawah - blokAkhir;
    if (perluas > 0) {
      if (_cekKosongBlok(ws, blokAkhir + 1, 1, perluas, 12)) {
        blokAkhir = targetBawah;
        kapasitas = blokAkhir - startRow + 1;
        adaBlok = true;
      } else {
        console.log("[BotInsera] " + nama + ": tak bisa perluas blok, kolom A-L baris " +
                    (blokAkhir + 1) + "-" + targetBawah + " terisi non-kosong.");
      }
    }
  }
  count = Math.min(rowsData.length, kapasitas);

  if (blokAkhir < startRow) {
    console.log("[BotInsera] " + nama + ": blok data tidak terdeteksi, skip rebuild.");
    return 0;
  }

  // ===== Kolom I (TICKET ID GAMAS) & kolom manual J-L (STATUS GAMAS/STATUS/HASIL UKUR) =====
  // Dibaca SEBELUM A-G ditulis ulang karena kunci re-key-nya = kolom B lama (NO TIKET).
  function _h(vHdr) { return String(vHdr === undefined || vHdr === null ? "" : vHdr).trim(); }
  var hdrIJL = (startRow > 1) ? ws.getRange(startRow - 1, 9, 1, 4).getValues()[0] : [];
  var hdrI = _h(hdrIJL[0]), hdrJ = _h(hdrIJL[1]), hdrK = _h(hdrIJL[2]), hdrL = _h(hdrIJL[3]);
  var adaFormula = function (kolom, lebar) {
    if (kapasitas <= 0) return false;
    var frm = ws.getRange(startRow, kolom, kapasitas, lebar).getFormulas();
    for (var fi = 0; fi < frm.length; fi++) {
      for (var fj = 0; fj < frm[fi].length; fj++) {
        var fs = frm[fi][fj];
        if (typeof fs === "string" && fs !== "" && fs.charAt(0) === "=") return true;
      }
    }
    return false;
  };
  // I: tulis bila header = "TICKET ID GAMAS", ATAU header kosong & kolom I tanpa formula
  // (sheet/layout lama yang belum punya header). Jangan sentuh bila header lain
  // (mis. "NO WA") ATAU kolom I berisi formula (rumus milik user).
  var isiI = /TICKET\s*ID\s*GAMAS/i.test(hdrI) ||
             (hdrI === "" && !adaFormula(9, 1));
  // J-L: hanya bila ketiga header sesuai nama kolom manualnya (deteksi blok rekap lama
  // yang bergeser / layout tak terkonfirmasi -> jangan ditulis).
  var isiJKL = /STATUS\s*GAMAS/i.test(hdrJ) && /^STATUS$/i.test(hdrK) && /HASIL\s*UKUR/i.test(hdrL);
  // Guard: formula di J-L (mis. COUNTIFS blok rekap lama) -> J-L TIDAK ditulis.
  if (isiJKL && adaFormula(10, 3)) {
    isiJKL = false;
    console.log("[BotInsera] " + nama + ": kolom J-L berisi formula (COUNTIFS/rekap?) -> " +
                "penulisan & re-key J-L dilewati (hanya kolom I).");
  }
  var petaManual = {};
  if (isiJKL && kapasitas > 0) {
    var colBOld = ws.getRange(startRow, 2, kapasitas, 1).getValues();
    var jlOld = ws.getRange(startRow, 10, kapasitas, 3).getValues(); // J,K,L
    for (var mi = 0; mi < kapasitas; mi++) {
      var keyManual = _h(colBOld[mi][0]).toUpperCase();
      if (keyManual !== "") {
        petaManual[keyManual] = [
          jlOld[mi][0] === undefined || jlOld[mi][0] === null ? "" : jlOld[mi][0],
          jlOld[mi][1] === undefined || jlOld[mi][1] === null ? "" : jlOld[mi][1],
          jlOld[mi][2] === undefined || jlOld[mi][2] === null ? "" : jlOld[mi][2]
        ];
      }
    }
  }

  var barisTulis = [];
  for (var i = 0; i < kapasitas; i++) {
    var row = (i < count) ? rowsData[i] : null;
    if (!row) { barisTulis.push(["", "", "", "", "", "", ""]); continue; }
    barisTulis.push([
      _val(row, colSto),                       // A = STO (WORKZONE)
      _val(row, colIncident),                  // B = NO TIKET (INCIDENT)
      _val(row, TTR_SRC_INET_GANGGUAN),        // C = INET GANGGUAN (SERVICE NO)
      _val(row, TTR_SRC_CUSTOMER_TYPE),        // D = CUSTOMER TYPE
      _valPreserveDate(row, TTR_SRC_REPORT_DATE), // E = REPORT DATE (biar Date, bukan teks)
      _valPreserveDate(row, TTR_SRC_MANJA),    // F = MANJA (BOOKING DATE)
      _val(row, TTR_SRC_TYPE_TIKET)            // G = TYPE TIKET (SERVICE TYPE)
    ]);
  }
  if (barisTulis.length > 0) {
    ws.getRange(startRow, 1, barisTulis.length, 7).setValues(barisTulis);
  }

  // ===== Tulis kolom I (TICKET ID GAMAS) & re-key kolom manual J-L =====
  var gamasTulis = 0, jlTulis = 0;
  if (isiI && kapasitas > 0) {
    var barisI = [];
    for (var ii = 0; ii < kapasitas; ii++) {
      var rowI = (ii < count) ? rowsData[ii] : null;
      // baris kosong (di luar data) -> kosongkan I; baris data kosong GAMAS -> "-".
      barisI.push([rowI ? _gamasDariBaris(rowI, colGamas) : ""]);
    }
    ws.getRange(startRow, 9, kapasitas, 1).setValues(barisI);
    gamasTulis = count;
  }
  if (isiJKL && kapasitas > 0) {
    // Nilai J-L lama dipindah mengikuti NO TIKET (re-key), bukan mengikuti posisi baris,
    // karena urutan baris berubah tiap sync (sort WORKZONE A-Z).
    var barisJKL = [];
    for (var ij = 0; ij < kapasitas; ij++) {
      var rowJ = (ij < count) ? rowsData[ij] : null;
      var keyJ = rowJ ? _val(rowJ, colIncident).toUpperCase() : "";
      var m = keyJ ? petaManual[keyJ] : null;
      barisJKL.push(m ? [m[0], m[1], m[2]] : ["", "", ""]);
    }
    ws.getRange(startRow, 10, kapasitas, 3).setValues(barisJKL);
    jlTulis = kapasitas;
  }

  // Deteksi pola DURASI dari rumus H yang sudah ada (sebelum restore) supaya tahu
  // kolom tanggal & sel NOW() yang benar (mentor bisa menggeser kolom -> K$1 jadi $O$1).
  var polaDurasi = _deteksiPolaDurasi(ws, startRow, kapasitas);
  // Pastikan sel NOW() acuan rumus DURASI ada — bila kosong, isi =NOW() supaya DURASI
  // tidak negatif/error. Bila sudah terisi (milik user), TIDAK disentuh.
  var nowDiisi = _isiSelNow(ws, polaDurasi.refNow);

  // Pastikan rumus DURASI (kolom H) ada & valid di tiap baris data.
  // Tulis ulang apabila: H kosong, ATAU nilai H-nya error (mis. #ERROR!/#VALUE!
  // akibat kutip melengkung dari paste sebelumnya). Nilai huruf/angka normal dibiarkan.
  // Ditulis pakai setFormulas sekaligus per-chunk kontigu (lebih cepat dari per-sel).
  var hRestore = 0;
  if (kapasitas > 0) {
    var hFormulas = ws.getRange(startRow, 8, kapasitas, 1).getFormulas();
    var hValues = ws.getRange(startRow, 8, kapasitas, 1).getValues();
    var indicesRestore = [];
    for (var hi = 0; hi < kapasitas; hi++) {
      var fNow = hFormulas[hi][0] || "";
      var vNow = hValues[hi][0];
      var checkVal = (typeof vNow === "string") ? vNow
        : (vNow && typeof vNow.getMessage === "function") ? vNow.getMessage() : "";
      var isError = checkVal.charAt(0) === "#";
      if (fNow === "" || isError) indicesRestore.push(hi);
    }
    hRestore = _setRumusDurasiBatch(ws, startRow, indicesRestore, polaDurasi);
  }
  console.log("[BotInsera] " + nama + " di-update: data=" + count + " baris (kapasitas blok " + kapasitas +
              ", scanRows=" + scanRows + ", rentang " + startRow + "-" + blokAkhir +
              ", H restored=" + hRestore + ", GAMAS=" + (isiI ? gamasTulis + " baris" : "dilewati") +
              ", J-L=" + (isiJKL ? "re-key" : "dilewati") +
              (nowDiisi ? ", sel NOW(" + polaDurasi.refNow + ") diisi" : "") + ")");
  return count;
}

// Kompatibilitas: pembacaan lama memakai nama _tulisMonitoringTTR.
function _tulisMonitoringTTR(rowsData, colIncident, colSto) {
  return _tulisBlokMonitoring(CFG_TTR, rowsData, colIncident, colSto);
}

// Baca kolom M 'DATA PS' (1-based: 13) sekali untuk daftar SERVICE NO yang di-flag FFG.
// READ-ONLY: tab DATA PS tidak pernah ditulis/diubah oleh script.
function _bacaSetDataPS() {
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
// Kembalian: { count, truncated } — truncated=true bila baris terbaca tak semuanya muat di blok.
function _kumpulDanTulisReport(ws, colIncident, colSto) {
  var nilai = ws.getDataRange().getValues();
  var rowsFinal = [];
  for (var i = 1; i < nilai.length; i++) {
    if (_val(nilai[i], colIncident) !== "") rowsFinal.push(nilai[i]);
  }
  _sortRows(rowsFinal, colSto, colIncident);

  var setDataPS = _bacaSetDataPS();
  var total = 0;
  for (var b = 0; b < BLOK_REPORT.length; b++) {
    total += _tulisBlokReport(BLOK_REPORT[b], rowsFinal, colIncident, colSto, setDataPS);
  }
  return { count: total, truncated: rowsFinal.length > total };
}

/**
 * Tulis ulang blok kiri satu tab laporan (nilai statis dari copas tket).
 * Tidak insert/delete baris; hanya menulis ulang kolom yang terpetakan di cfg.pemetaan
 * mulai cfg.startRow. Batas atas = cfg.maxBaris. Blok deteksi/disimpulkan dari kolom
 * cfg.kolomNoTiket (nilai "INC..." atau rumus lama `='copas tket'!Axx`).
 */
function _tulisBlokReport(cfg, rowsData, colIncident, colSto, setDataPS) {
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
    if (_cekKosongBlok(ws, start, 1, targetAwal - start + 1, jmlKolom)) {
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
  // Hitung ulang kapasitas SETELAH blokAkhir (mungkin berubah oleh seed blok di atas).
  kapasitas = Math.max(blokAkhir - start + 1, 0);

  if (rowsData.length > kapasitas) {
    var targetBawah = Math.min(start + rowsData.length - 1, cfg.maxBaris + start - 1);
    var perluas = targetBawah - blokAkhir;
    if (perluas > 0) {
      if (_cekKosongBlok(ws, blokAkhir + 1, 1, perluas, jmlKolom)) {
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
        var svc = _val(row, TTR_SRC_INET_GANGGUAN);
        out.push((setDataPS && svc !== "" && setDataPS[svc] === true) ? "FFG" : "Not FFG");
        continue;
      }
      var srcIdx = (pem === -1) ? colSto : (pem === -2) ? colIncident : pem;
      var isDateCol = (srcIdx === TTR_SRC_REPORT_DATE || srcIdx === TTR_SRC_MANJA);
      out.push(isDateCol ? _valPreserveDate(row, srcIdx) : _val(row, srcIdx));
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
      formulas.push([_rumusDurasiKolom(cfg.rumusDurasi.dateCol, cfg.rumusDurasi.nowRef, start + fi)]);
    }
    ws.getRange(start, cfg.rumusDurasi.col, kapasitas, 1).setFormulas(formulas);
    hRestore = kapasitas;
  }
  console.log("[BotInsera] " + cfg.tab + " blok kiri di-rebuild: data=" + count +
              " baris (kapasitas " + kapasitas + ", rentang " + start + "-" + blokAkhir +
              ", DURASI restore=" + hRestore + ")");
  return count;
}

// ============ REBUILD OTOMATIS (PASTE MANUAL DI COPAS TKET / EDIT DATA PS) ============

// Jalur 1: simple trigger onEdit (instan, hanya user-edit yang memicu — bukan script).
function onEdit(e) {
  var range = e ? e.range : null;
  if (!range || !range.getSheet()) return;
  var namaSheet = range.getSheet().getName();
  if (namaSheet !== TAB_TUJUAN && namaSheet !== "DATA PS") return;
  if (range.getRow() < 2) return;
  _autoRebuildGuard(namaSheet === "DATA PS", "AUTO-EDIT");
}

// Jalur 2: installable onChange (dipasang pasangTrigger). Terpacu oleh SEMUA perubahan,
// termasuk paste besar yang kadang tidak memicu onEdit. Dipasang supaya andal tanpa klik.
function autoRebuildOnChange(e) {
  var ss = e && e.source;
  if (!ss) return;
  var namaSheet = "";
  try { namaSheet = ss.getActiveSheet().getName(); } catch (err) { /* ignore */ }
  if (namaSheet !== TAB_TUJUAN && namaSheet !== "DATA PS") return;
  _autoRebuildGuard(namaSheet === "DATA PS", "AUTO-CHANGE");
}

// Jalur 3: trigger berkala (jaring pengaman) — rebuild hanya bila data benar-benar berubah.
function autoRebuildBerkala() {
  var berubahTiket = _sheetBerubahSejakRun(TAB_TUJUAN, "fp_copas_tket");
  var berubahDataPS = _sheetBerubahSejakRun("DATA PS", "fp_data_ps");
  if (berubahTiket || berubahDataPS) {
    try {
      rebuildSemuaInternal(false, "BERKALA");
    } catch (err) {
      console.log("[BotInsera] BERKALA rebuild ERROR: " + err);
      _catatRebuild("BERKALA", 0, 0, String(err), false);
    }
  }
}

// Gerbang bersama semua jalur auto-rebuild: lewati event dari tulisan script sendiri,
// lalu dedup event beruntun (paste besar / onEdit+onChange yang terpacu bersamaan).
function _autoRebuildGuard(ffgOnly, mode) {
  if (_baruSajaScriptTulis()) return;
  if (!_ambilKunciAutorebuild()) return;
  try {
    rebuildSemuaInternal(ffgOnly, mode);
  } catch (err) {
    console.log("[BotInsera] " + mode + " rebuild ERROR: " + err);
    _catatRebuild(mode, 0, 0, String(err), ffgOnly);
  }
}

// Amankan kunci debounce: hanya 1 call terpacu dalam JENDELA_ABSORB_REBUILD_MS.
function _ambilKunciAutorebuild() {
  try {
    var cache = CacheService.getScriptCache();
    var now = Date.now();
    var last = cache.get(KUNCI_AUTO_REBUILD);
    var ok = !(last && (now - parseInt(last, 10)) < JENDELA_ABSORB_REBUILD_MS);
    cache.put(KUNCI_AUTO_REBUILD, String(now), 60);
    return ok;
  } catch (err) {
    return true; // CacheService tak tersedia => tetap rebuild.
  }
}

// Penanda "periode tulisan script" (doPost). onChange/onEdit memakai ini untuk tahu
// bahwa perubahan yang datang saat ini berasal dari bot — bukan edit manual user.
function _tandaiScriptTulis() {
  try {
    CacheService.getScriptCache().put(KUNCI_SCRIPT_WRITE, String(Date.now()), 1200);
  } catch (err) { /* ignore */ }
}

function _bersihkanScriptTulis() {
  try {
    CacheService.getScriptCache().remove(KUNCI_SCRIPT_WRITE);
  } catch (err) { /* ignore */ }
}

function _baruSajaScriptTulis() {
  try {
    var t = CacheService.getScriptCache().get(KUNCI_SCRIPT_WRITE);
    return !!(t && (Date.now() - parseInt(t, 10)) < JENDELA_SKIP_SCRIPT_WRITE_MS);
  } catch (err) {
    return false;
  }
}

// Deteksi pertukaran isi sheet sejak run berkala sebelumnya (versi ringan = fingerprint).
function _sheetBerubahSejakRun(namaTab, propsKey) {
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(namaTab);
  if (!ws) return false;
  try {
    var fp = _fingerprintSheet(ws);
    var props = PropertiesService.getScriptProperties();
    var prev = props.getProperty(propsKey);
    props.setProperty(propsKey, fp);
    return prev === null || prev !== fp;
  } catch (err) {
    return true; // gagal hitung fingerprint => rebuild saja (aman).
  }
}

// Fingerprint isi seluruh sheet (nilai TAMPILAN) jadi string hash pendek.
function _fingerprintSheet(ws) {
  var lastRow = Math.max(ws.getLastRow(), 1);
  var lastCol = Math.max(ws.getLastColumn(), 1);
  if (lastRow <= 1) return "R1C" + lastCol;
  var vals = ws.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var dig = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(vals) + "|" + lastRow + "|" + lastCol
  );
  return dig.map(function (b) { return (b < 0 ? b + 256 : b).toString(16); }).join("");
}

// Deteksi indeks kolom INCIDENT & WORKZONE dari baris header (0-based).
// INCIDENT: ambil kejadian PERTAMA (kolom INCIDENT selalu paling awal / dekat awal header).
function _deteksiKolomKunci(header) {
  var colIncident = -1;
  var colSto = -1;
  var lastCol = header ? header.length : 0;
  for (var i = 0; i < lastCol; i++) {
    var h = String(header[i]).toUpperCase();
    if (colIncident < 0 && /INCIDENT/.test(h)) colIncident = i;
    if (colSto < 0 && /WORKZONE/.test(h)) colSto = i;
  }
  if (colIncident < 0) colIncident = 0;
  if (colSto < 0) colSto = COL_WORKZONE_DEFAULT;
  return { colIncident: colIncident, colSto: colSto };
}

// Baca isi copas tket terkini, deteksi kolom INCIDENT & WORKZONE dari header,
// lalu rebuild MONITORING TTR + blok kiri REPORT JAKUT / JAKBAR / FFG.
// ffgOnly=true (edit di DATA PS) -> hanya rebuild REPORT/FFG (TTR tak tersentuh).
function rebuildSemuaInternal(ffgOnly, mode) {
  ffgOnly = !!ffgOnly;
  mode = mode || "AUTO";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(TAB_TUJUAN);
  if (!ws) return;
  var lastCol = Math.max(ws.getLastColumn(), 1);
  var header = ws.getRange(1, 1, 1, lastCol).getValues()[0];
  var deteksi = _deteksiKolomKunci(header);
  var colIncident = deteksi.colIncident;
  var colSto = deteksi.colSto;
  console.log("[BotInsera] rebuild (" + mode + (ffgOnly ? ", FFG/REPORT only" : "") +
              ") colIncident=" + colIncident + " colSto=" + colSto);

  var hasilTTR = { count: 0, truncated: false };
  var hasilWA = { count: 0, truncated: false };
  if (!ffgOnly) {
    hasilTTR = _kumpulDanTulisTTR(ws, colIncident, colSto);
    hasilWA = _kumpulDanTulisWA(ws, colIncident, colSto);
  }
  var hasilReport = _kumpulDanTulisReport(ws, colIncident, colSto);
  console.log("[BotInsera] rebuild " + mode + " selesai: TTR=" + hasilTTR.count +
              " WA=" + hasilWA.count + " report=" + hasilReport.count +
              (ffgOnly ? " (FFG/REPORT only)" : ""));
  _catatRebuild(mode, hasilTTR.count, hasilReport.count, null, ffgOnly, hasilWA.count);
}

// ============ PASANG TRIGGER AUTO-REBUILD (SEKALI SAJA PER SPREADSHEET) ============

// Pasang trigger onChange (paste manual -> rebuild langsung) + berkala (jaring pengaman).
// IDEMPOTEN: jalankan ulang kapan pun — trigger lama ber-handler sama dihapus dulu.
function pasangTrigger() {
  _hapusTriggerHandler("autoRebuildOnChange");
  _hapusTriggerHandler("autoRebuildBerkala");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var id = ss.getId();
  ScriptApp.newTrigger("autoRebuildOnChange")
    .forSpreadsheet(id)
    .onChange()
    .create();
  ScriptApp.newTrigger("autoRebuildBerkala")
    .timeBased()
    .everyMinutes(JEDA_TRIGGER_BERKALA_MENIT)
    .create();
  _catatRebuild("PASANG-TRIGGER", 0, 0, null, false);
  console.log("[BotInsera] pasangTrigger: onChange + berkala(" +
              JEDA_TRIGGER_BERKALA_MENIT + " menit) terpasang (spreadsheet: " + ss.getName() + ").");
  return "onChange + berkala " + JEDA_TRIGGER_BERKALA_MENIT + " menit";
}

function pasangDariMenu() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (err) { /* tanpa UI */ }
  try {
    var rincian = pasangTrigger();
    if (ui) ui.alert("BotInsera",
        "Trigger terpasang: " + rincian +
        "\n\nAuto-rebuild AKTIF:\n- Paste/ubah manual di 'copas tket' atau 'DATA PS' otomatis me-rebuild MONITORING TTR + LAPORAN WA + REPORT JAKUT + REPORT JAKBAR + FFG.\n- Jaring pengaman berkala " + JEDA_TRIGGER_BERKALA_MENIT + " menit (hanya bila data berubah).\n\nStatus auto-rebuild tercatat di tab 'LOG SYNC'.",
        ui.ButtonSet.OK);
  } catch (err) {
    if (ui) ui.alert("BotInsera", "Pasang trigger GAGAL: " + err, ui.ButtonSet.OK);
  }
}

// Hapus semua trigger dengan nama handler `namaHandler` (hindari dobel saat install ulang).
function _hapusTriggerHandler(namaHandler) {
  var all = ScriptApp.getProjectTriggers();
  for (var i = all.length - 1; i >= 0; i--) {
    if (all[i].getHandlerFunction() === namaHandler) {
      ScriptApp.deleteTrigger(all[i]);
    }
  }
}

// ============ MENU (UNTUK REBUILD MANUAL SEKALI-KLIK) ============

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("BotInsera")
      .addItem("⟳ Rebuild Semua (TTR + WA + REPORT + FFG)", "rebuildDariMenu")
      .addItem("⚡ Pasang Auto-Rebuild (onChange + Berkala)", "pasangDariMenu")
      .addItem("Cek Konsistensi Data", "cekData")
      .addToUi();
  } catch (err) {
    // UI tak tersedia (viewer/read-only) — abaikan.
  }
}

// Trigger dari menu: rebuild penuh & tampilkan hasilnya.
function rebuildDariMenu() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (err) { /* tanpa UI */ }
  try {
    rebuildSemuaInternal(false, "MANUAL");
    if (ui) ui.alert("BotInsera",
        "Rebuild selesai.\nTTR, LAPORAN WA & REPORT/FFG diperbarui dari copas tket.", ui.ButtonSet.OK);
  } catch (err) {
    if (ui) ui.alert("BotInsera", "Rebuild GAGAL: " + err, ui.ButtonSet.OK);
  }
}

// ============ CEK KONSISTENSI DATA ============

// Hitung jumlah INC unik di copas tket vs baris yang muncul di tiap blok,
// deteksi duplikat & baris INC kosong. Hasil ditampilkan (popup) + dicatat di LOG SYNC.
function cekData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (err) { /* tanpa UI */ }
  var ws = ss.getSheetByName(TAB_TUJUAN);
  if (!ws) {
    if (ui) ui.alert("BotInsera", "Tab '" + TAB_TUJUAN + "' tidak ditemukan.", ui.ButtonSet.OK);
    return;
  }
  try {
    var lastCol = Math.max(ws.getLastColumn(), 1);
    var header = ws.getRange(1, 1, 1, lastCol).getValues()[0];
    var deteksi = _deteksiKolomKunci(header);
    var colIncident = deteksi.colIncident;
    var colSto = deteksi.colSto;

    var nilai = ws.getDataRange().getValues();
    var set = {};
    var duplikat = 0;
    var kosong = 0;
    for (var r = 1; r < nilai.length; r++) {
      var incv = _val(nilai[r], colIncident);
      if (incv === "") { kosong++; continue; }
      var kunci = incv.toUpperCase();
      if (set[kunci]) duplikat++; else set[kunci] = true;
    }

    var blokMon = [];
    for (var mx = 0; mx < CFG_BLOK_MONITORING.length; mx++) {
      var cfgM = CFG_BLOK_MONITORING[mx];
      var wsM = ss.getSheetByName(cfgM.tab);
      blokMon.push(cfgM.label + ": " +
        (wsM ? _hitungBarisINC(wsM, 2, cfgM.startRow) : "tab tidak ada"));
    }
    var rincian = [];
    for (var bx = 0; bx < BLOK_REPORT.length; bx++) {
      var cfg = BLOK_REPORT[bx];
      var wsR = ss.getSheetByName(cfg.tab);
      rincian.push(cfg.tab + "=" + _hitungBarisINC(wsR, cfg.kolomNoTiket, cfg.startRow));
    }

    var jml = Object.keys(set).length;
    var pesan =
      "• copas tket (INC unik): " + jml +
      "\n• Baris INC kosong: " + kosong +
      "\n• Duplikat INC: " + duplikat +
      "\n• " + blokMon.join("\n• ") +
      "\n• " + rincian.join("\n• ");

    _catatLogSync({ WAKTU: new Date(), VERSI: VERSI, ROWS: jml,
                   PENYEBAB: "PERIKSA: " + pesan.replace(/\n/g, " | ") });
    console.log("[BotInsera] cekData:\n" + pesan);
    if (ui) ui.alert("BotInsera", pesan, ui.ButtonSet.OK);
  } catch (err) {
    if (ui) ui.alert("BotInsera", "cekData GAGAL: " + err, ui.ButtonSet.OK);
  }
}

// Hitung banyak baris (dari startRow) yang kolom `kol` berisi value diawali "INC".
function _hitungBarisINC(ws, kol, startRow) {
  if (!ws) return 0;
  var lastRow = Math.max(ws.getLastRow() - startRow + 1, 0);
  if (lastRow <= 0) return 0;
  var vals = ws.getRange(startRow, kol, lastRow, 1).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (v && /^INC/i.test(String(v))) n++;
  }
  return n;
}

// ============ LOG SYNC (RIWAYAT TIAP SYNC) ============

// WA = jumlah baris blok LAPORAN WA (v2.7). Kolom WA sengaja diAKHIRKAN (bukan setelah
// REPORT) supaya baris log lama (tulis 17 kolom) tetap selaris dengan header baru.
var KOLOM_LOG = ["WAKTU", "VERSI", "ROWS", "BARU", "UPDATE", "LEWAT", "HAPUS",
                 "TTR", "REPORT", "LENGKAP", "DURASI_MS", "DURASI_REPORT_MS",
                 "PENYEBAB", "GUARD", "TRUNCATED", "COL_INC", "COL_STO", "WA"];

function _siapkanTabLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(TAB_LOG);
  if (!ws) {
    ws = ss.insertSheet(TAB_LOG);
    ws.getRange(1, 1, 1, KOLOM_LOG.length).setValues([KOLOM_LOG]);
    ws.getRange(1, 1, 1, KOLOM_LOG.length).setFontWeight("bold");
    try { ws.setFrozenRows(1); } catch (err) { /* ignore */ }
    return ws;
  }
  // Tab sudah ada: lengkapi header bila KOLOM_LOG bertambah (mis. kolom WA di v2.7).
  // Hanya menulis kolom BARU di sebelah kanan -> baris log lama tidak bergeser.
  try {
    var lastCol = Math.max(ws.getLastColumn(), 1);
    if (lastCol < KOLOM_LOG.length) {
      var tambahan = KOLOM_LOG.slice(lastCol);
      ws.getRange(1, lastCol + 1, 1, tambahan.length).setValues([tambahan]);
      ws.getRange(1, 1, 1, KOLOM_LOG.length).setFontWeight("bold");
    }
  } catch (err) { /* ignore */ }
  return ws;
}

// Tulis satu baris riwayat ke tab LOG SYNC (gagal tidak menggagalkan sync).
function _catatLogSync(entry) {
  try {
    var ws = _siapkanTabLog();
    if (!ws) return;
    var baris = [];
    for (var i = 0; i < KOLOM_LOG.length; i++) {
      var k = KOLOM_LOG[i];
      baris.push(entry && entry[k] !== undefined ? entry[k] : "");
    }
    ws.appendRow(baris);
    // Auto-trim: sisakan LOG_MAKS_BARIS baris terbaru saja (baris 1 = header).
    var jmlRow = ws.getLastRow();
    var hapus = jmlRow - 1 - LOG_MAKS_BARIS;
    if (hapus > 0) {
      ws.deleteRows(2, hapus);
    }
  } catch (err) {
    console.log("[BotInsera] catatLogSync gagal: " + err);
  }
}

// Catat hasil rebuild manual/otomatis (mode = AUTO / AUTO-FFG / MANUAL).
// wa = jumlah baris blok LAPORAN WA (opsional; 0 bila tidak dihitung).
function _catatRebuild(mode, ttr, report, err, ffgOnly, wa) {
  try {
    var pesan = err ? "ERROR: " + err
      : ("REBUILD " + mode + " selesai" + (ffgOnly ? " (FFG/REPORT)" : ""));
    _catatLogSync({
      WAKTU: new Date(),
      VERSI: VERSI + " [" + mode + "]",
      ROWS: 0,
      TTR: ttr || 0,
      REPORT: report || 0,
      WA: wa || 0,
      PENYEBAB: pesan
    });
  } catch (err2) {
    console.log("[BotInsera] catatRebuild gagal: " + err2);
  }
}
