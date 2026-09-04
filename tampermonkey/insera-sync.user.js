// ==UserScript==
// @name         BotInsera - Sync Tiket Insera ke Google Sheets
// @namespace    http://tampermonkey.net/
// @version      1.4.0
// @description  Baca seluruh baris tabel ALL TICKET LIST Insera lalu kirim otomatis ke Google Apps Script (tab copas tket).
// @author       diana
// @match        *://*oss-incident.telkom.co.id/*
// @match        *://*.telkom.co.id/*
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @connect      oss-incident.telkom.co.id
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  console.log("[BotInsera] Script DIMULAI. URL:", location.href);

  // ============ KONFIGURASI (ISI SESUAI PUNYA KAMU) ============
  // URL Web App hasil deploy Apps Script (doPost)
  var USERS_URL = "https://script.google.com/macros/s/AKfycbxKUwAcglCKqsyyJAc78rC9DviJJtSZ3AHpZACZ-fC23bS6iBJOTpk7H7_7cj3e92LHPQ/exec";
  // Token sama dengan ACCESS_TOKEN di code.gs
  var ACCESS_TOKEN = "#Ez6KQZpzEYYXSeYWyZAGA7N";
  // Indeks kolom No INCIDENT (0-based). KINI TIDAK DIPAKAI UNTUK BACA:
  // kolom INCIDENT dideteksi otomatis dari data (pola INCxxx...).
  // Nilai ini hanya cadangan/fallback.
  var COL_INCIDENT = 0;
  // Auto-sync otomatis tiap N detik (halaman ALL TICKET LIST harus tetap terbuka).
  // 0 = nonaktifkan auto-sync (hanya manual via tombol).
  var AUTO_SYNC_DETIK = 60;
  // Auto-refresh halaman tiap N detik (untuk munculkan tiket baru).
  var AUTO_REFRESH_DETIK = 60;
  // ============================================================

  var PAKAI_GM = (typeof GM_xmlhttpRequest !== "undefined");

  // State toggle disimpan di localStorage agar persist saat auto-refresh reload.
  var AUTO_KEY = "binsera_auto_aktif";
  var REFRESH_KEY = "binsera_auto_refresh_aktif";

  var autoAktif = localStorage.getItem(AUTO_KEY) === null
    ? true
    : localStorage.getItem(AUTO_KEY) === "1";
  var autoTimer = null;         // handle setInterval auto-sync
  var autoRefreshAktif = localStorage.getItem(REFRESH_KEY) === null
    ? true
    : localStorage.getItem(REFRESH_KEY) === "1";
  var autoRefreshTimer = null;  // handle setInterval auto-refresh

  function log(msg) {
    console.log("[BotInsera]", msg);
  }

  // Notifikasi toast (tanpa popup) yang otomatis hilang setelah durasi (ms).
  // durasi default = 3000 ms (3 detik).
  function toast(pesan, durasi) {
    durasi = durasi || 3000;
    var lama = document.getElementById("binsera-toast");
    if (lama && lama.parentNode) lama.parentNode.removeChild(lama);

    var el = document.createElement("div");
    el.id = "binsera-toast";
    el.textContent = pesan;
    el.style.cssText =
      "position:fixed;bottom:110px;right:20px;z-index:999999;background:#263238;color:#fff;" +
      "padding:12px 16px;border-radius:8px;font-size:13px;font-weight:bold;max-width:360px;" +
      "white-space:pre-wrap;box-shadow:0 4px 12px rgba(0,0,0,.35);" +
      "opacity:0;transition:opacity .25s ease;font-family:inherit;";
    document.body.appendChild(el);
    el.offsetHeight; // paksa reflow agar transisi opacity berjalan
    el.style.opacity = "1";
    setTimeout(function () {
      el.style.opacity = "0";
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, durasi);
  }

  function buatTombol() {
    if (document.getElementById("binsera-btn")) return;

    if (!document.body) {
      setTimeout(buatTombol, 200);
      return;
    }

    var btn = document.createElement("button");
    btn.id = "binsera-btn";
    btn.textContent = "🔄 Sync ke Sheets";
    btn.style.cssText = TOMBOL_BASE + "bottom:20px;background:#1565c0;";
    btn.addEventListener("click", function () { syncSekarang(false); });
    document.body.appendChild(btn);
    console.log("[BotInsera] Tombol Sync dipasang.");

    buatToggleAuto();
    buatToggleAutoRefresh();
  }

  // Shared style agar semua tombol sama besar persis
  var TOMBOL_BASE =
    "position:fixed;right:20px;z-index:99998;padding:0 24px;height:44px;display:flex;" +
    "align-items:center;justify-content:center;" +
    "color:#fff;border:none;border-radius:8px;cursor:pointer;" +
    "font-size:14px;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,.25);" +
    "width:170px;box-sizing:border-box;text-align:center;" +
    "opacity:1;background:#1565c0;";

  function buatToggleAuto() {
    if (document.getElementById("binsera-auto-btn")) return;
    if (!document.body) { setTimeout(buatToggleAuto, 200); return; }

    var a = document.createElement("button");
    a.id = "binsera-auto-btn";
    a.style.cssText = TOMBOL_BASE + "bottom:68px;";
    updateTeksAuto(a);
    a.addEventListener("click", toggleAuto);
    document.body.appendChild(a);
  }

  function updateTeksAuto(el) {
    el.textContent = autoAktif
      ? "⏱ Auto Sync: ON"
      : "⏱ Auto Sync: OFF";
    el.style.background = autoAktif ? "#2e7d32" : "#c62828";
  }

  function toggleAuto() {
    autoAktif = !autoAktif;
    localStorage.setItem(AUTO_KEY, autoAktif ? "1" : "0");
    if (autoAktif) {
      mulaiAuto();
      log("Auto-sync DIAKTIFKAN (interval " + AUTO_SYNC_DETIK + " detik).");
    } else {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      log("Auto-sync DIMATIKAN.");
    }
    var a = document.getElementById("binsera-auto-btn");
    if (a) updateTeksAuto(a);
  }

  function mulaiAuto() {
    if (!AUTO_SYNC_DETIK || AUTO_SYNC_DETIK <= 0) {
      log("Auto-sync tidak aktif (AUTO_SYNC_DETIK = 0).");
      return;
    }
    if (autoTimer) return;
    autoTimer = setInterval(function () {
      if (!autoAktif) return;
      if (location.href.indexOf("allTicketList") === -1) {
        log("Lewati auto-sync: halaman bukan ALL TICKET LIST.");
        return;
      }
      var btn = document.getElementById("binsera-btn");
      if (btn && btn.disabled) return;
      log("Auto-sync (interval " + AUTO_SYNC_DETIK + " detik) dijalankan...");
      syncSekarang(true);
    }, AUTO_SYNC_DETIK * 1000);
    log("Auto-sync aktif: setiap " + AUTO_SYNC_DETIK + " detik.");
  }

  // ---- Auto-Refresh ----
  function buatToggleAutoRefresh() {
    if (document.getElementById("binsera-refresh-btn")) return;
    if (!document.body) { setTimeout(buatToggleAutoRefresh, 200); return; }

    var r = document.createElement("button");
    r.id = "binsera-refresh-btn";
    r.style.cssText = TOMBOL_BASE + "bottom:116px;";
    updateTeksRefresh(r);
    r.addEventListener("click", toggleAutoRefresh);
    document.body.appendChild(r);
  }

  function updateTeksRefresh(el) {
    el.textContent = autoRefreshAktif
      ? "🔁 Auto Refresh: ON"
      : "🔁 Auto Refresh: OFF";
    el.style.background = autoRefreshAktif ? "#2e7d32" : "#c62828";
  }

  function toggleAutoRefresh() {
    autoRefreshAktif = !autoRefreshAktif;
    localStorage.setItem(REFRESH_KEY, autoRefreshAktif ? "1" : "0");
    if (autoRefreshAktif) {
      mulaiAutoRefresh();
      log("Auto-refresh DIAKTIFKAN (interval " + AUTO_REFRESH_DETIK + " detik).");
    } else {
      if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
      log("Auto-refresh DIMATIKAN.");
    }
    var r = document.getElementById("binsera-refresh-btn");
    if (r) updateTeksRefresh(r);
  }

  function mulaiAutoRefresh() {
    if (!AUTO_REFRESH_DETIK || AUTO_REFRESH_DETIK <= 0) return;
    if (autoRefreshTimer) return;
    autoRefreshTimer = setInterval(function () {
      if (!autoRefreshAktif) return;
      if (location.href.indexOf("allTicketList") === -1) {
        log("Lewati auto-refresh: halaman bukan ALL TICKET LIST.");
        return;
      }
      log("Auto-refresh halaman (interval " + AUTO_REFRESH_DETIK + " detik)...");
      location.reload();
    }, AUTO_REFRESH_DETIK * 1000);
    log("Auto-refresh aktif: setiap " + AUTO_REFRESH_DETIK + " detik.");
  }

  // Mencari dokumen yang berisi tabel. Mendukung tabel di dalam iframe (same-origin).
  function cariDokumenTabel() {
    if (document.querySelector("table tbody tr td")) return document;
    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      try {
        var fdoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
        if (fdoc && fdoc.querySelector("table tbody tr td")) {
          return fdoc;
        }
      } catch (e) {
        // cross-origin, lewati
      }
    }
    return null;
  }

  // Deteksi indeks kolom INCIDENT secara otomatis dari data baris.
  // Mencari kolom pertama yang nilainya cocok pola nomor tiket (mis. INC52618xxx).
  function deteksiKolomIncident(rows) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      for (var c = 0; c < row.length; c++) {
        var val = String(row[c]).trim();
        if (/^INC[-_\s]?[0-9A-Za-z]+$/i.test(val)) {
          return c;
        }
      }
    }
    return -1;
  }

  // Membaca seluruh baris tabel dari DOM (persis seperti copy manual).
  // Strategi: ambil daftar indeks kolom yang TAMPAK dari <thead> (buang kolom
  // checkbox dan kolom hidden/column-hidden), lalu ambil <td> dengan indeks itu
  // saja. Ini lebih akurat daripada sekadar skip checkbox.
  function bacaSemuaBaris() {
    var doc = cariDokumenTabel();
    var out = [];
    if (!doc) {
      console.log("[BotInsera] Tabel TIDAK ditemukan (di dokumen utama maupun iframe).");
      return { rows: out, colIncident: -1 };
    }

    var container = doc.querySelector("table");
    var thead = container.querySelector("thead tr");
    var indexTerlihat = null; // null = pakai fallback (skip td checkbox)
    if (thead) {
      var ths = thead.querySelectorAll("th");
      indexTerlihat = [];
      ths.forEach(function (th, i) {
        var kelas = (th.className || "") + " " + (th.getAttribute("class") || "");
        var isCheckbox = /select_checkbox/i.test(kelas) || !!th.querySelector('input[type="checkbox"]');
        var isParentId = /column_C_PARENT_ID/i.test(kelas);
        if (isCheckbox || isParentId) return; // buang kolom checkbox & C_PARENT_ID
        // Kolom aksi (row_action) dan lainnya yang bukan kolom data tidak punya class
        // "column_header" → jangan ikut terbaca.
        if (!/column_header/i.test(kelas)) return;
        // Catatan: kolom hidden yang DIBUTUHKAN tetap dibaca, mis. c_street_address
        // (kolom ALAMAT, posisi terakhir di sheet). Setara hasil paste manual (81 kolom).
        indexTerlihat.push(i);
      });
      console.log("[BotInsera] Indeks kolom terbaca (dari <th>):", indexTerlihat);
    }

    var rows = container.querySelectorAll("tbody tr");
    if (rows.length === 0) {
      rows = container.querySelectorAll("tr");
    }
    console.log("[BotInsera] Ditemukan " + rows.length + " baris <tr>.");

    rows.forEach(function (tr) {
      if (tr.querySelector("th")) return; // skip baris header (jika tanpa tbody)
      var tds = tr.querySelectorAll("td");
      var vals = [];
      tds.forEach(function (td, i) {
        if (indexTerlihat) {
          if (indexTerlihat.indexOf(i) !== -1) vals.push(td.innerText.trim());
        } else if (!td.querySelector('input[type="checkbox"]')) {
          vals.push(td.innerText.trim());
        }
      });
      var adaData = vals.some(function (v) { return v !== ""; });
      if (adaData) out.push(vals);
    });

    var colIncident = deteksiKolomIncident(out);
    if (out.length > 0) {
      console.log("[BotInsera] Jumlah kolom per baris:", out[0].length);
    }
    console.log("[BotInsera] Kolom INCIDENT terdeteksi di indeks:", colIncident);
    return { rows: out, colIncident: colIncident };
  }

  // ---- PAGINATION (fetch background) ----
  // Halaman Insera memakai ICEfaces + full-page reload via URL query (?-p=N).
  // Klik "next" biasa akan memuat ulang halaman, jadi di sini kita TIDAK menggeser
  // halaman yang dibuka user. Sebagai gantinya kita baca halaman aktif dari DOM,
  // lalu FETCH halaman 2..N di background, parse tabelnya, gabungkan, dan kirim sekali.
  //
  // Struktur yang dikonfirmasi dari HTML asli:
  //   - Tabel data   : <table id="datalistInboxAllticketV2"> (table pertama di body)
  //   - Pagination   : <span class="pagelinks"> ... <a href="?...-p=N..." title="Go to page N">N</a>
  //   - no iframe    : tabel & pagination ada di dokumen utama.

  // Baca total jumlah item & ukuran halaman dari <span class="pagebanner">.
  // Contoh: "118 items found, displaying 1 to 100." → totalItems=118.
  // Mengembalikan {totalItems:int, pageSize:int}.
  function bacaPersebaranHalaman() {
    var banner = document.querySelector("span.pagebanner");
    var teks = banner ? banner.textContent || "" : "";
    var totalMatch = /(\d+)\s+items?\s+found/i.exec(teks);
    var totalItems = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    // Ukuran halaman: dari URL aktif (param d-...-ps=) atau dari "displaying X to Y".
    var pageSize = 0;
    var mPs = /(?:d-\d+-ps|ps)=(\d+)/i.exec(location.search);
    if (mPs) pageSize = parseInt(mPs[1], 10);
    if (!pageSize) {
      var disp = /displaying\s+(\d+)\s+to\s+(\d+)/i.exec(teks);
      if (disp) pageSize = parseInt(disp[2], 10) - parseInt(disp[1], 10) + 1;
    }
    if (!pageSize) pageSize = 100;
    return { totalItems: totalItems, pageSize: pageSize };
  }

  // Set/ganti query parameter pada URL (menghapus param lama lalu menambah yang baru).
  function setQueryParam(url, key, val) {
    var u = new URL(url, location.href);
    // hapus semua param yang berakhiran dengan ":<key>" (gaya ICEfaces) atau tepat <key>
    var keysToRemove = [];
    u.searchParams.forEach(function (v, k) {
      var base = k.indexOf(":") >= 0 ? k.slice(k.lastIndexOf(":") + 1) : k;
      if (base === key) keysToRemove.push(k);
    });
    keysToRemove.forEach(function (k) { u.searchParams.delete(k); });
    u.searchParams.set("d-5564009-" + key, String(val));
    return u.href;
  }

  // Bangun URL untuk halaman ke-n (1 = pertama) dari URL aktif.
  function urlHalaman(n, pageSize) {
    var base = location.href;
    var url = setQueryParam(base, "p", n);
    url = setQueryParam(url, "ps", pageSize);
    return url;
  }

  // Parse string HTML hasil fetch, ambil tabel data (id datalistInboxAllticketV2),
  // lalu ekstrak baris <tr>/<td> dengan logika yang sama seperti bacaSemuaBaris().
  function ekstrakBarisDariHTML(html) {
    var docParsed = new DOMParser().parseFromString(html, "text/html");
    var container = docParsed.getElementById("datalistInboxAllticketV2");
    if (!container) {
      // fallback: table pertama yang punya thead
      var tabs = docParsed.querySelectorAll("table");
      for (var t = 0; t < tabs.length; t++) {
        if (tabs[t].querySelector("thead") && !/datepicker/i.test(tabs[t].className || "")) {
          container = tabs[t];
          break;
        }
      }
    }
    if (!container) return [];

    // Tentukan indeks kolom yang TAMPAK (sama seperti bacaSemuaBaris).
    var thead = container.querySelector("thead tr");
    var indexTerlihat = null;
    if (thead) {
      indexTerlihat = [];
      var ths = thead.querySelectorAll("th");
      ths.forEach(function (th, i) {
        var kelas = (th.className || "") + " " + (th.getAttribute("class") || "");
        var isCheckbox = /select_checkbox/i.test(kelas) || !!th.querySelector('input[type="checkbox"]');
        var isParentId = /column_C_PARENT_ID/i.test(kelas);
        if (isCheckbox || isParentId) return;
        if (!/column_header/i.test(kelas)) return;
        indexTerlihat.push(i);
      });
    }

    var out = [];
    var rows = container.querySelectorAll("tbody tr");
    if (rows.length === 0) rows = container.querySelectorAll("tr");
    rows.forEach(function (tr) {
      if (tr.querySelector("th")) return;
      var tds = tr.querySelectorAll("td");
      var vals = [];
      tds.forEach(function (td, i) {
        if (indexTerlihat) {
          if (indexTerlihat.indexOf(i) !== -1) vals.push(td.textContent.trim());
        } else if (!td.querySelector('input[type="checkbox"]')) {
          vals.push(td.textContent.trim());
        }
      });
      if (vals.some(function (v) { return v !== ""; })) out.push(vals);
    });
    return out;
  }

  // Fetch satu halaman (GET) dan ekstrak barisnya. Mengembalikan Promise<array baris>.
  // Prioritas: GM_xmlhttpRequest (melewati CORS & membawa cookie session userscript),
  // fallback ke fetch native (same-origin).
  function fetchHalaman(url) {
    var full = new URL(url, window.location.href).href;
    return new Promise(function (resolve) {
      function selesaiBerhasil(html) {
        resolve({ ok: true, rows: ekstrakBarisDariHTML(html), url: full });
      }
      function selesaiGagal(err) {
        resolve({ ok: false, rows: [], url: full, err: err });
      }

      if (typeof GM_xmlhttpRequest !== "undefined") {
        GM_xmlhttpRequest({
          method: "GET",
          url: full,
          onload: function (r) {
            if (r.status >= 200 && r.status < 300) {
              selesaiBerhasil(r.responseText);
            } else {
              selesaiGagal("HTTP " + r.status);
            }
          },
          onerror: function (r) { selesaiGagal("onerror: " + (r && r.error)); },
          ontimeout: function () { selesaiGagal("timeout"); },
          timeout: 30000,
        });
      } else {
        fetch(full, { credentials: "same-origin" })
          .then(function (r) { return r.text(); })
          .then(function (html) { selesaiBerhasil(html); })
          .catch(function (e) { selesaiGagal(String(e)); });
      }
    });
  }

  // Baca SEMUA halaman (aktif + fetch halaman 2..N), gabungkan, kembalikan.
  // Mengembalikan {rows:[...], colIncident:n, halamanTerbaca:m}.
  async function bacaSemuaHalaman() {
    // 1. Halaman aktif dari DOM.
    var hasilAktif = bacaSemuaBaris();
    var gabungan = [].concat(hasilAktif.rows || []);
    var kolomInc = hasilAktif.colIncident;

    // 2. Baca total halaman dari pagebanner ("N items found") lalu fetch halaman 2..N.
    var pb = bacaPersebaranHalaman();
    var totalHalaman = 1;
    if (pb.totalItems > 0) {
      totalHalaman = Math.ceil(pb.totalItems / pb.pageSize);
    } else {
      // pagebanner tidak terbaca. Kalau baris di halaman aktif lebih sedikit dari
      // ukuran halaman, pasti tidak ada halaman berikutnya (data < 1 halaman penuh).
      // Dengan begitu `lengkap` bisa true dan baris yang tak ada di Insera bisa dihapus.
      var barisAktif = (hasilAktif.rows && hasilAktif.rows.length) || 0;
      if (barisAktif < pb.pageSize) {
        totalHalaman = 1;
      } else {
        // fallback: cek link pagination (title "Go to page N").
        var pageLinks = document.querySelectorAll('a[title^="Go to page"]');
        var totalDariLink = 0;
        pageLinks.forEach(function (a) {
          var m = /Go to page (\d+)/.exec(a.getAttribute("title") || "");
          if (m) totalDariLink = Math.max(totalDariLink, parseInt(m[1], 10));
        });
        if (totalDariLink > 0) totalHalaman = totalDariLink;
      }
    }
    var halamanTerbaca = 1;

    if (totalHalaman > 1) {
      log("Ditemukan " + totalHalaman + " halaman (total " + pb.totalItems +
          " item, " + pb.pageSize + "/hal). Baca sisa via fetch background...");
      // fetch sekuensial (bukan paralel) agar tidak membebani server & anti-duplikat rapi.
      for (var h = 2; h <= totalHalaman; h++) {
        var urlH = urlHalaman(h, pb.pageSize);
        var res = await fetchHalaman(urlH);
        if (!res.ok) {
          log("Fetch halaman " + h + " gagal: " + res.err);
          continue;
        }
        halamanTerbaca++;
        // tambahkan hanya baris yang INCIDENT-nya belum ada di gabungan (anti-duplikat).
        var incSet = {};
        gabungan.forEach(function (r) {
          if (r && r[0]) incSet[String(r[0]).trim()] = true;
        });
        res.rows.forEach(function (r) {
          var k = r[0] ? String(r[0]).trim() : "";
          if (k && !incSet[k]) { gabungan.push(r); incSet[k] = true; }
        });
      }
    } else {
      log("Total item " + pb.totalItems + " (pagebanner). Hanya 1 halaman / tidak ada pagination.");
    }

    // Tentukan "lengkap" secara konservatif:
    // Aturan utama: kalau baris unik yang terbaca KURANG dari ukuran 1 halaman penuh,
    // berarti tidak ada halaman berikutnya → data lengkap (apapun totalItems yang tampil).
    // Ini mencegah pagebanner/pagination yang menampilkan angka basi menjadikan lengkap=false.
    var barisUnik = gabungan.length;
    var lengkap = false;
    if (pb.pageSize > 0 && barisUnik < pb.pageSize) {
      lengkap = true;
    } else if (pb.totalItems > 0) {
      lengkap = (barisUnik >= pb.totalItems);
    } else {
      lengkap = (halamanTerbaca >= totalHalaman);
    }
    log("lengkap hasil hitung=" + lengkap + " (barisUnik=" + barisUnik +
        " pageSize=" + pb.pageSize + " totalItems=" + pb.totalItems + ")");

    if (halamanTerbaca > 1) {
      console.log("[BotInsera] Selesai baca " + halamanTerbaca + " halaman, total " + gabungan.length + " baris.");
    }
    return { rows: gabungan, colIncident: kolomInc, halamanTerbaca: halamanTerbaca, totalHalaman: totalHalaman, lengkap: lengkap };
  }

  function kirimKeAppsScript(rows, colIncident, lengkap, onSelesai) {
    var payload = JSON.stringify({
      token: ACCESS_TOKEN,
      rows: rows,
      colIncident: colIncident >= 0 ? colIncident : COL_INCIDENT,
      lengkap: !!lengkap,
    });

    var selesai = function (res, err) {
      if (err) {
        onSelesai("Gagal kirim: " + err, false);
        return;
      }
      onSelesai(res, true);
    };

    if (PAKAI_GM) {
      GM_xmlhttpRequest({
        method: "POST",
        url: USERS_URL,
        data: payload,
        headers: { "Content-Type": "application/json" },
        onload: function (r) {
          var body = r.responseText;
          // CORS: respon Apps Script kadang terbungkus <pre> / perlu baca body
          try {
            var parsed = JSON.parse(body);
            selesai(parsed, null);
          } catch (errPars) {
            // Coba bersihkan dari tag <pre>...<body>...
            var cleaned = body.replace(/^[\s\S]*?<body[^>]*>/, "").replace(/<\/body>[\s\S]*$/, "").trim();
            try {
              var parsed2 = JSON.parse(cleaned);
              selesai(parsed2, null);
            } catch (e2) {
              selesai(body, "Respon tidak ter-parse: " + body.slice(0, 200));
            }
          }
        },
        onerror: function () {
          selesai(null, "Network/onerror");
        },
      });
    } else {
      fetch(USERS_URL, { method: "POST", body: payload, headers: { "Content-Type": "application/json" } })
        .then(function (r) { return r.text(); })
        .then(function (text) {
          try {
            selesai(JSON.parse(text), null);
          } catch (e) {
            selesai(text, "Fetch respon tidak ter-parse.");
          }
        })
        .catch(function (e) { selesai(null, String(e)); });
    }
  }

  // Menunggu sampai tabel benar-benar ter-render (berisi minimal satu baris data)
  // sebelum dibaca. Penting PASCА reload: Insera butuh waktu mengisi tabel (AJAX),
  // dan membaca lebih awal sama saja dengan data kosong/duplikat → ke-hapus tertunda.
  // Dipakai oleh tombol "🔄 Sync" (jalan sekali) dan Auto-Sync (yang sama, interval tetap).
  function tungguTabelSiap(maksDetik, onSiap, onGagal) {
    var max = (maksDetik || 20) * 10; // tiap 100ms
    var n = 0;
    var cek = function () {
      var r = bacaSemuaBaris();
      if (r.rows && r.rows.length > 0) {
        onSiap();
        return;
      }
      n++;
      if (n >= max) {
        onGagal();
        return;
      }
      setTimeout(cek, 100);
    };
    cek();
  }

  function syncSekarang(otomatis) {
    var btn = document.getElementById("binsera-btn");
    btn.textContent = "⏳ Sync...";
    btn.disabled = true;

    if (!otomatis) {
      toast("Memulai sinkronisasi...\nMenunggu tabel dimuat...", 1500);
    }

    // Diagnosa struktur tabel untuk memudahkan kita memperbaiki
    var detailStruktur = debugStruktur();

    // Baca dengan retry: data bisa di-load dinamis (AJAX/lazy). Coba beberapa kali .
    // Sekarang baca SEMUA halaman pagination (page 1, 2, dst) lewat bacaSemuaHalaman().
    var percobaan = 0;
    var barisTerbaca = 0;
    var kolomIncidentTerpakai = -1;
    var kolomPerBaris = 0;
    var halamanTerbaca = 0;

    // Pastikan tabel sudah render sebelum membaca (terutama setelah Auto Refresh),
    // supaya data yang dikirim ke sheet lengkap & akurat.
    tungguTabelSiap(20, mulaiBaca, gagalSiap);

    function gagalSiap() {
      if (otomatis) {
        log("Auto-sync: tabel belum berisi data sampai batas waktu (mungkin loading lama).");
      } else {
        toast("Tabel belum berisi data (halaman masih loading?).\nCoba lagi beberapa saat lagi.", 4000);
      }
      btn.textContent = "🔄 Sync ke Sheets";
      btn.disabled = false;
    }

    function mulaiBaca() {
      bacaDanLanjut();
    }

    function bacaDanLanjut() {
      bacaSemuaHalaman().then(function (hasil) {
        var rows = hasil.rows;
        barisTerbaca = rows.length;
        kolomIncidentTerpakai = hasil.colIncident;
        halamanTerbaca = hasil.halamanTerbaca || 1;
        if (rows.length > 0) {
          kolomPerBaris = rows[0].length;
          log("Baca " + rows.length + " baris (semua halaman), kolom INCIDENT di indeks " +
              hasil.colIncident + ", jml kolom/baris " + kolomPerBaris);
          if (!otomatis) {
            toast("✓ Tabel ter-baca: " + rows.length + " baris.\nMengirim ke spreadsheet...", 2000);
          }
          // "lengkap" = semua halaman pagination berhasil dibaca (tidak ada fetch gagal).
          // Kalau belum lengkap, backend DILARANG menghapus data lama (pengaman).
          var lengkap = (hasil.lengkap !== undefined)
            ? hasil.lengkap
            : (hasil.halamanTerbaca >= (hasil.totalHalaman || 1));
          log("lengkap=" + lengkap + " halamanTerbaca=" + hasil.halamanTerbaca +
              " totalHalaman=" + (hasil.totalHalaman || 1) +
              " colIncident=" + hasil.colIncident);
          kirimKeAppsScript(rows, hasil.colIncident, lengkap, selesaiKlik);
          return;
        }
        percobaan++;
        if (percobaan < 5) {
          if (!otomatis) {
            toast("Menunggu tabel dimuat... (" + percobaan + "/5)", 1000);
          }
          log("Belum ada baris, coba lagi (" + percobaan + "/5)...");
          setTimeout(bacaDanLanjut, 600);
        } else {
          if (otomatis) {
            log("Auto-sync: tidak ada baris data terbaca (mungkin halaman belum siap).");
          } else {
            toast("Tidak ada baris data terbaca.\n\nHASIL DIAGNOSA:\n" + detailStruktur +
                  "\n\nSampaikan isi ini ke opencode.", 6000);
          }
          btn.textContent = "🔄 Sync ke Sheets";
          btn.disabled = false;
        }
      }).catch(function (e) {
        log("Error baca halaman: " + e);
        btn.textContent = "🔄 Sync ke Sheets";
        btn.disabled = false;
        if (!otomatis) toast("Gagal baca halaman: " + e, 4000);
      });
    }
    // `tungguTabelSiap` di atas yang memicu mulaiBaca() → bacaDanLanjut(),
    // jadi tidak perlu dipanggil manual di sini (menghindari double-run saat tabel belum siap).

    function selesaiKlik(res, ok) {
      if (!ok) {
        if (otomatis) {
          log("Auto-sync GAGAL: " + res);
        } else {
          toast("Gagal: " + res, 4000);
        }
      } else if (res && res.ok) {
        var peringatan = "";
        if (kolomIncidentTerpakai === -1) {
          peringatan =
            "\n\n⚠️ PERINGATAN: pola kolom INCIDENT (-1) TIDAK ditemukan di data.\n" +
            "Fallback ke indeks 0. Periksa keselarasan kolom dan sampaikan ke opencode: " +
            JSON.stringify(res).slice(0, 100);
        }
        var ringkas =
          "Baru: " + (res.baru || 0) +
          " | Update: " + (res.update || 0) +
          " | Hapus: " + (res.hapus || 0) +
          " | Kolom INCIDENT: " + kolomIncidentTerpakai +
          " | Kolom/baris: " + kolomPerBaris;
        if (otomatis) {
          log("Auto-sync SELESAI: " + ringkas);
        } else {
          toast(
            "Sinkron selesai!\nBaris dibaca: " + barisTerbaca +
            "\nHalaman: " + halamanTerbaca +
            "\nKolom/baris: " + kolomPerBaris + " (harus 81)" +
            "\nPosisi kolom INCIDENT (0 = kolom pertama): " + kolomIncidentTerpakai +
            "\nBaru (ditambahkan): " + (res.baru || 0) +
            "\nUpdate (disamakan dgn Insera): " + (res.update || 0) +
            "\nHapus otomatis (tak ada di Insera): " + (res.hapus || 0) +
            "\nTotal terproses: " + ((res.baru || 0) + (res.update || 0)) + peringatan
          );
        }
      } else if (res && res.error === "TOKEN_SALAH") {
        if (otomatis) {
          log("Auto-sync GAGAL: TOKEN_SALAH. Cocokkan ACCESS_TOKEN di userscript & code.gs.");
        } else {
          toast("Token salah! Cocokkan ACCESS_TOKEN di userscript & code.gs", 5000);
        }
      } else {
        if (otomatis) {
          log("Auto-sync respon tidak dikenal: " + JSON.stringify(res).slice(0, 200));
        } else {
          toast("Respon tidak dikenal: " + JSON.stringify(res).slice(0, 200), 4000);
        }
      }
      btn.textContent = "🔄 Sync ke Sheets";
      btn.disabled = false;
    }
  }

  // ============ UTIL DEBUG ============
  // Mengembalikan string hasil diagnosa (dipakai untuk alert & console).
  function debugStruktur() {
    var L = [];
    var iframes = document.querySelectorAll("iframe");
    L.push("iframe: " + iframes.length);
    var tables = document.querySelectorAll("table");
    L.push("table (utama): " + tables.length);
    if (tables.length > 0) {
      var t = tables[0];
      L.push("tbody: " + !!t.querySelector("tbody"));
      L.push("tr: " + t.querySelectorAll("tr").length);
      var tr = t.querySelector("tr");
      if (tr) {
        L.push("td baris1: " + tr.querySelectorAll("td").length);
      }
    }
    iframes.forEach(function (f, i) {
      try {
        var fdoc = f.contentDocument || f.contentWindow.document;
        var ft = fdoc ? fdoc.querySelectorAll("table").length : -1;
        var fr = fdoc ? (fdoc.querySelectorAll("table tr").length) : 0;
        L.push("iframe#" + i + ": table=" + ft + " tr=" + fr + " src=" + f.src.slice(0, 80));
      } catch (e) {
        L.push("iframe#" + i + ": CROSS-ORIGIN (tidak bisa diakses)");
      }
    });
    var msg = L.join("\n");
    console.log("[BotInsera] DEBUG:\n" + msg);
    return msg;
  }
  // ====================================

  // Pasang tombol setelah halaman siap, dengan retry jika body belum tersedia,
  // dan observer untuk halaman single-page (SPA) yang render ulang konten.
  function pasang() {
    buatTombol();
    if (document.getElementById("binsera-btn")) {
      mulaiAuto();
      if (autoRefreshAktif) mulaiAutoRefresh();
      return null;
    }
    var kali = 0;
    var timer = setInterval(function () {
      buatTombol();
      kali++;
      if (document.getElementById("binsera-btn") || kali > 50) {
        if (document.getElementById("binsera-btn")) {
          mulaiAuto();
          if (autoRefreshAktif) mulaiAutoRefresh();
        }
        clearInterval(timer);
      }
    }, 300);
    return timer;
  }

  if (!document.body) {
    document.addEventListener("DOMContentLoaded", pasang);
  } else {
    pasang();
  }

  // Untuk SPA: pastikan tombol tetap ada walau konten di-render ulang
  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("binsera-btn")) {
      pasang();
    }
  });
})();
