// ==UserScript==
// @name         BotInsera - Sync Tiket Insera ke Google Sheets
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @description  Baca seluruh baris tabel ALL TICKET LIST Insera lalu kirim otomatis ke Google Apps Script (tab copas tket). One-cycle: sync selesai -> countdown -> reload -> sync lagi.
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

  // ============ KONFIGURASI ============
  var USERS_URL = "https://script.google.com/macros/s/AKfycbxKUwAcglCKqsyyJAc78rC9DviJJtSZ3AHpZACZ-fC23bS6iBJOTpk7H7_7cj3e92LHPQ/exec";
  var ACCESS_TOKEN = "#Ez6KQZpzEYYXSeYWyZAGA7N";
  // Indeks kolom No INCIDENT (0-based). Cadangan/fallback; dideteksi otomatis dari data.
  var COL_INCIDENT = 0;
  // Jeda (detik) dari SELESAI sync sampai RELOAD berikutnya. Timernya mulai
  // dihitung setelah sync selesai & notif muncul (design one-cycle).
  var JEDA_SYNC_KE_RELOAD_DETIK = 45;
  // ============================================================

  var PAKAI_GM = (typeof GM_xmlhttpRequest !== "undefined");

  // State persist (localStorage) biar lolos reload.
  var AUTO_KEY = "binsera_auto_aktif";
  // Deadline reload berikutnya (epoch ms), persist melewati reload.
  var NEXT_KEY = "binsera_next_reload_at";

  var autoAktif = localStorage.getItem(AUTO_KEY) === null
    ? true
    : localStorage.getItem(AUTO_KEY) === "1";

  var autoBtn = null;        // tombol tunggal "Auto"
  var btnKlik = null;        // tombol manual "Sync ke Sheets"
  var reloadTimer = null;    // handle timeout reload berikutnya
  var countdownTimer = null; // handle per-detik update teks tombol Auto
  var nextReloadAt = 0;      // target epoch ms
  var lagiSync = false;

  function log(msg) {
    console.log("[BotInsera]", msg);
  }

  // Toast notifikasi (default 5000 ms = 5 detik).
  function toast(pesan, durasi) {
    durasi = durasi || 5000;
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
    el.offsetHeight;
    el.style.opacity = "1";
    setTimeout(function () {
      el.style.opacity = "0";
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }, durasi);
  }

  // Shared style tombol
  var TOMBOL_BASE =
    "position:fixed;right:20px;z-index:99998;padding:0 24px;height:44px;display:flex;" +
    "align-items:center;justify-content:center;" +
    "color:#fff;border:none;border-radius:8px;cursor:pointer;" +
    "font-size:14px;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,.25);" +
    "width:190px;box-sizing:border-box;text-align:center;" +
    "opacity:1;background:#1565c0;";

  function buatTombol() {
    if (!document.body) { setTimeout(buatTombol, 200); return; }

    // Tombol manual Sync (inti) — dipasang duluan sebagai acuan.
    if (!document.getElementById("binsera-btn")) {
      btnKlik = document.createElement("button");
      btnKlik.id = "binsera-btn";
      btnKlik.textContent = "🔄 Sync ke Sheets";
      btnKlik.style.cssText = TOMBOL_BASE + "bottom:20px;background:#1565c0;";
      btnKlik.addEventListener("click", function () { syncSekarang(false); });
      document.body.appendChild(btnKlik);
      console.log("[BotInsera] Tombol Sync dipasang.");
    }

    // Tombol tunggal Auto (one-cycle: reload+sync).
    if (!document.getElementById("binsera-auto-btn")) {
      autoBtn = document.createElement("button");
      autoBtn.id = "binsera-auto-btn";
      autoBtn.style.cssText = TOMBOL_BASE + "bottom:68px;";
      updateTeksAuto();
      autoBtn.addEventListener("click", toggleAuto);
      document.body.appendChild(autoBtn);
    }
  }

  function updateTeksAuto() {
    if (!autoBtn) { autoBtn = document.getElementById("binsera-auto-btn"); }
    if (!autoBtn) return;
    if (!autoAktif) {
      autoBtn.textContent = "▶ Auto: OFF";
    } else if (lagiSync) {
      autoBtn.textContent = "⏳ Syncing...";
    } else if (nextReloadAt > Date.now()) {
      var sisa = Math.ceil((nextReloadAt - Date.now()) / 1000);
      autoBtn.textContent = "⏱ Auto: ON · " + sisa + "s";
    } else {
      autoBtn.textContent = "⏱ Auto: ON";
    }
    autoBtn.style.background = autoAktif ? "#2e7d32" : "#c62828";
  }

  function toggleAuto() {
    autoAktif = !autoAktif;
    localStorage.setItem(AUTO_KEY, autoAktif ? "1" : "0");
    if (autoAktif) {
      log("Auto DIAKTIFKAN (one-cycle, jeda " + JEDA_SYNC_KE_RELOAD_DETIK + " detik).");
    } else {
      log("Auto DIMATIKAN.");
    }
    mulaiSemua();
  }

  // Mulai countdown teks tombol Auto (1 detik).
  function mulaiCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(updateTeksAuto, 1000);
  }

  // Jadwalkan reload berikutnya JEDA detik dari sekarang (one-cycle).
  // Dipanggil SETELAH sync selesai. Deadline disimpan di localStorage.
  function skedulReloadBerikutnya() {
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
    nextReloadAt = Date.now() + JEDA_SYNC_KE_RELOAD_DETIK * 1000;
    localStorage.setItem(NEXT_KEY, String(nextReloadAt));

    reloadTimer = setTimeout(function tundaReload() {
      if (!autoAktif) return;
      if (btnKlik && btnKlik.disabled) {
        // sync sedang jalan — jangan potong; ulur 10 detik.
        reloadTimer = setTimeout(tundaReload, 10000);
        return;
      }
      localStorage.removeItem(NEXT_KEY);
      toast("🔄 Memuat ulang halaman...\nSinkronisasi berjalan saat halaman siap.", 5000);
      log("Auto: reload dijalankan (jeda " + JEDA_SYNC_KE_RELOAD_DETIK + " detik).");
      location.reload();
    }, JEDA_SYNC_KE_RELOAD_DETIK * 1000);
  }

  // Scheduler utama.
  function mulaiSemua() {
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
    mulaiCountdown();

    var storedNext = parseInt(localStorage.getItem(NEXT_KEY) || "0", 10);

    if (!autoAktif) {
      nextReloadAt = 0;
      localStorage.removeItem(NEXT_KEY);
      updateTeksAuto();
      return;
    }

    if (storedNext > Date.now()) {
      // Ada deadline tersimpan (mis. user baru saja ON): lanjutkan seperti biasa.
      nextReloadAt = storedNext;
      setTimeout(function () {
        if (!autoAktif) return;
        localStorage.removeItem(NEXT_KEY);
        location.reload();
      }, nextReloadAt - Date.now());
    } else {
      // First load / meneruskan siklus setelah reload: langsung sync data baru,
      // lalu jadwalkan reload berikutnya setelah sync selesai.
      nextReloadAt = 0;
      updateTeksAuto();
      syncSekarang(true);
    }
    updateTeksAuto();
  }

  // ============ BACA DARI DOM ============

  function cariDokumenTabel() {
    if (document.querySelector("table tbody tr td")) return document;
    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      try {
        var fdoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
        if (fdoc && fdoc.querySelector("table tbody tr td")) {
          return fdoc;
        }
      } catch (e) { /* cross-origin */ }
    }
    return null;
  }

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

  // Tentukan indeks kolom yang tampak dari <th> (buang checkbox & C_PARENT_ID).
  function indeksTerlihat(theader) {
    var idx = [];
    var ths = theader.querySelectorAll("th");
    ths.forEach(function (th, i) {
      var kelas = (th.className || "") + " " + (th.getAttribute("class") || "");
      var isCheckbox = /select_checkbox/i.test(kelas) || !!th.querySelector('input[type="checkbox"]');
      var isParentId = /column_C_PARENT_ID/i.test(kelas);
      if (isCheckbox || isParentId) return;
      if (!/column_header/i.test(kelas)) return;
      idx.push(i);
    });
    return idx;
  }

  // Agar konsisten antar halaman, filter baris yang INC-nya kosong (bukan tiket).
  // Titik INCIDENT ditentukan dari deteksi pertama.
  function filterBarisINC(rows, kunciCol) {
    return rows.filter(function (r) {
      var k = (r && kunciCol !== undefined && r[kunciCol] !== undefined)
        ? String(r[kunciCol]).trim() : "";
      return k !== ""; // buang baris yang INC kosong (data aneh di bawah tabel)
    });
  }

  // Baca semua baris dari DOM + deteksi kolom INCIDENT.
  function bacaSemuaBaris() {
    var doc = cariDokumenTabel();
    var out = [];
    if (!doc) {
      console.log("[BotInsera] Tabel TIDAK ditemukan.");
      return { rows: out, colIncident: -1 };
    }
    var container = doc.querySelector("table");
    var thead = container.querySelector("thead tr");
    var indexTerlihat = null;
    if (thead) indexTerlihat = indeksTerlihat(thead);

    var rows = container.querySelectorAll("tbody tr");
    if (rows.length === 0) rows = container.querySelectorAll("tr");
    console.log("[BotInsera] Ditemukan " + rows.length + " baris <tr>.");

    rows.forEach(function (tr) {
      if (tr.querySelector("th")) return;
      var tds = tr.querySelectorAll("td");
      var vals = [];
      tds.forEach(function (td, i) {
        if (indexTerlihat) {
          if (indexTerlihat.indexOf(i) !== -1) vals.push(td.innerText.trim());
        } else if (!td.querySelector('input[type="checkbox"]')) {
          vals.push(td.innerText.trim());
        }
      });
      if (vals.some(function (v) { return v !== ""; })) out.push(vals);
    });

    var colIncident = deteksiKolomIncident(out);
    // Buang baris INC kosong (minimalisir ketidakseragaman di sheet).
    if (colIncident >= 0) out = filterBarisINC(out, colIncident);
    console.log("[BotInsera] Kolom INCIDENT di indeks " + colIncident + ", baris valid " + out.length);
    return { rows: out, colIncident: colIncident };
  }

  function cekTabelAda() {
    var doc = cariDokumenTabel();
    if (!doc) return false;
    var t = doc.querySelector("table");
    if (!t) return false;
    var trs = t.querySelectorAll("tbody tr");
    if (trs.length === 0) trs = t.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      var tds = trs[i].querySelectorAll("td");
      for (var j = 0; j < tds.length; j++) {
        if (tds[j].innerText.trim() !== "") return true;
      }
    }
    return false;
  }

  // ============ PAGINATION ============

  function bacaPersebaranHalaman() {
    var banner = document.querySelector("span.pagebanner");
    var teks = banner ? banner.textContent || "" : "";
    var totalMatch = /(\d+)\s+items?\s+found/i.exec(teks);
    var totalItems = totalMatch ? parseInt(totalMatch[1], 10) : 0;
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

  function setQueryParam(url, key, val) {
    var u = new URL(url, location.href);
    var keysToRemove = [];
    u.searchParams.forEach(function (v, k) {
      var base = k.indexOf(":") >= 0 ? k.slice(k.lastIndexOf(":") + 1) : k;
      if (base === key) keysToRemove.push(k);
    });
    keysToRemove.forEach(function (k) { u.searchParams.delete(k); });
    u.searchParams.set("d-5564009-" + key, String(val));
    return u.href;
  }

  function urlHalaman(n, pageSize) {
    var url = setQueryParam(location.href, "p", n);
    return setQueryParam(url, "ps", pageSize);
  }

  function ekstrakBarisDariHTML(html, kunciCol) {
    var docParsed = new DOMParser().parseFromString(html, "text/html");
    var container = docParsed.getElementById("datalistInboxAllticketV2");
    if (!container) {
      var tabs = docParsed.querySelectorAll("table");
      for (var t = 0; t < tabs.length; t++) {
        if (tabs[t].querySelector("thead") && !/datepicker/i.test(tabs[t].className || "")) {
          container = tabs[t];
          break;
        }
      }
    }
    if (!container) return [];
    var indexTerlihat = null;
    var thead = container.querySelector("thead tr");
    if (thead) indexTerlihat = indeksTerlihat(thead);

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
    if (kunciCol >= 0) out = filterBarisINC(out, kunciCol);
    return out;
  }

  function fetchHalaman(url) {
    var full = new URL(url, window.location.href).href;
    return new Promise(function (resolve) {
      function ok(html) { resolve({ ok: true, rows: [], url: full, html: html }); }
      function gagal(err) { resolve({ ok: false, rows: [], url: full, err: err }); }
      if (typeof GM_xmlhttpRequest !== "undefined") {
        GM_xmlhttpRequest({
          method: "GET",
          url: full,
          onload: function (r) {
            if (r.status >= 200 && r.status < 300) ok(r.responseText);
            else gagal("HTTP " + r.status);
          },
          onerror: function (r) { gagal("onerror: " + (r && r.error)); },
          ontimeout: function () { gagal("timeout"); },
          timeout: 30000,
        });
      } else {
        fetch(full, { credentials: "same-origin" })
          .then(function (r) { return r.text(); })
          .then(function (html) { ok(html); })
          .catch(function (e) { gagal(String(e)); });
      }
    });
  }

  function fetchParalel(urls, kon) {
    kon = kon || 4;
    var hasil = new Array(urls.length);
    var idx = 0, aktif = 0;
    return new Promise(function (resolve) {
      function cek() { if (idx >= urls.length && aktif === 0) resolve(hasil); }
      function mulai() {
        while (idx < urls.length && aktif < kon) {
          (function (i) {
            aktif++;
            fetchHalaman(urls[i]).then(function (res) { hasil[i] = res; aktif--; mulai(); cek(); });
          })(idx);
          idx++;
        }
        cek();
      }
      mulai();
    });
  }

  async function bacaSemuaHalaman() {
    var hasilAktif = bacaSemuaBaris();
    var gabungan = [].concat(hasilAktif.rows || []);
    var kolomInc = hasilAktif.colIncident;

    var pb = bacaPersebaranHalaman();
    var totalHalaman = 1;
    if (pb.totalItems > 0) {
      totalHalaman = Math.ceil(pb.totalItems / pb.pageSize);
    } else {
      var barisAktif = (hasilAktif.rows && hasilAktif.rows.length) || 0;
      if (barisAktif < pb.pageSize) {
        totalHalaman = 1;
      } else {
        var pageLinks = document.querySelectorAll('a[title^="Go to page"]');
        var totalDariLink = 0;
        pageLinks.forEach(function (a) {
          var m = /Go to page (\d+)/.exec(a.getAttribute("title") || "");
          if (m) totalDariLink = Math.max(totalDariLink, parseInt(m[1], 10));
        });
        if (totalDariLink > 0) totalHalaman = totalDariLink;
      }
    }

    var hasilFetch = [];
    var halamanTerbaca = 1;
    var kunciKolom = (kolomInc >= 0) ? kolomInc : 0;

    if (totalHalaman > 1) {
      log("Ditemukan " + totalHalaman + " halaman (total " + pb.totalItems +
          " item, " + pb.pageSize + "/hal). Baca sisa via fetch paralel...");
      var daftar = [];
      for (var h = 2; h <= totalHalaman; h++) daftar.push(urlHalaman(h, pb.pageSize));
      hasilFetch = await fetchParalel(daftar, 4);
    } else {
      log("Total item " + pb.totalItems + ". Hanya 1 halaman.");
    }

    var incSet = {};
    gabungan.forEach(function (r) {
      if (r && r[kunciKolom] !== undefined && String(r[kunciKolom]).trim() !== "") {
        incSet[String(r[kunciKolom]).trim()] = true;
      }
    });

    for (var x = 0; x < hasilFetch.length; x++) {
      var res = hasilFetch[x];
      if (!res || !res.ok) { log("Fetch halaman " + (x + 2) + " gagal: " + (res && res.err)); continue; }
      halamanTerbaca++;
      var rowsPage = ekstrakBarisDariHTML(res.html, kunciKolom);
      rowsPage.forEach(function (r) {
        var k = (r && r[kunciKolom] !== undefined) ? String(r[kunciKolom]).trim() : "";
        if (k && !incSet[k]) { gabungan.push(r); incSet[k] = true; }
      });
    }
    if (halamanTerbaca > 1) {
      log("Selesai baca " + halamanTerbaca + " halaman, total " + gabungan.length + " baris.");
    }

    var barisUnik = gabungan.length;
    var lengkap = false;
    var semuaHalamanTerbaca = (halamanTerbaca >= totalHalaman);
    if (pb.pageSize > 0 && barisUnik < pb.pageSize) {
      lengkap = true;
    } else if (pb.totalItems > 0 && barisUnik >= pb.totalItems) {
      lengkap = true;
    } else if (semuaHalamanTerbaca) {
      lengkap = true;
    }
    log("lengkap hasil hitung=" + lengkap +
        " (barisUnik=" + barisUnik + " pageSize=" + pb.pageSize +
        " totalItems=" + pb.totalItems + " totalHalaman=" + totalHalaman +
        " halamanTerbaca=" + halamanTerbaca + ")");

    return {
      rows: gabungan,
      colIncident: kolomInc,
      totalHalaman: totalHalaman,
      halamanTerbaca: halamanTerbaca,
      lengkap: lengkap
    };
  }

  // ============ KIRIM KE APPS SCRIPT ============

  function kirimKeAppsScript(rows, colIncident, lengkap, onSelesai) {
    var payload = JSON.stringify({
      token: ACCESS_TOKEN,
      rows: rows,
      colIncident: colIncident >= 0 ? colIncident : COL_INCIDENT,
      lengkap: !!lengkap,
    });
    var selesai = function (res, err) {
      if (err) { onSelesai("Gagal kirim: " + err, false); return; }
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
          try { selesai(JSON.parse(body), null); }
          catch (e1) {
            var cleaned = body.replace(/^[\s\S]*?<body[^>]*>/, "").replace(/<\/body>[\s\S]*$/, "").trim();
            try { selesai(JSON.parse(cleaned), null); }
            catch (e2) { selesai(body, "Respon tidak ter-parse: " + body.slice(0, 200)); }
          }
        },
        onerror: function () { selesai(null, "Network/onerror"); },
      });
    } else {
      fetch(USERS_URL, { method: "POST", body: payload, headers: { "Content-Type": "application/json" } })
        .then(function (r) { return r.text(); })
        .then(function (text) {
          try { selesai(JSON.parse(text), null); }
          catch (e) { selesai(text, "Fetch respon tidak ter-parse."); }
        })
        .catch(function (e) { selesai(null, String(e)); });
    }
  }

  function tungguTabelSiap(maksDetik, onSiap, onGagal) {
    var max = (maksDetik || 20) * 10;
    var n = 0;
    var cek = function () {
      if (cekTabelAda()) { onSiap(); return; }
      n++;
      if (n >= max) { onGagal(); return; }
      setTimeout(cek, 100);
    };
    cek();
  }

  function syncSekarang(otomatis) {
    if (btnKlik) { btnKlik.textContent = "⏳ Sync..."; btnKlik.disabled = true; }
    lagiSync = true;
    updateTeksAuto();

    var detailStruktur = debugStruktur();
    var percobaan = 0;
    var barisTerbaca = 0;
    var kolomIncidentTerpakai = -1;
    var kolomPerBaris = 0;
    var totalHalaman = 1;

    if (!otomatis) {
      toast("Memulai sinkronisasi...\nMenunggu tabel dimuat...", 5000);
    }

    tungguTabelSiap(20, mulaiBaca, gagalSiap);

    function akhiriSync() {
      lagiSync = false;
      if (btnKlik) { btnKlik.textContent = "🔄 Sync ke Sheets"; btnKlik.disabled = false; }
      updateTeksAuto();
      // One-cycle: setelah sync selesai, jadwalkan reload berikutnya (hanya mode auto).
      if (autoAktif && otomatis) skedulReloadBerikutnya();
    }

    function gagalSiap() {
      if (otomatis) log("Auto: tabel belum berisi data sampai batas waktu.");
      else toast("Tabel belum berisi data (halaman masih loading?).\nCoba lagi nanti.", 5000);
      akhiriSync();
    }

    function mulaiBaca() { bacaDanLanjut(); }

    function bacaDanLanjut() {
      bacaSemuaHalaman().then(function (hasil) {
        var rows = hasil.rows;
        barisTerbaca = rows.length;
        kolomIncidentTerpakai = hasil.colIncident;
        totalHalaman = hasil.totalHalaman || 1;
        if (rows.length > 0) {
          kolomPerBaris = rows[0].length;
          toast("✓ Tabel ter-baca: " + rows.length + " baris.\nMengirim ke spreadsheet...", 5000);
          var lengkap = (hasil.lengkap !== undefined) ? hasil.lengkap : (hasil.totalHalaman <= 1);
          log("lengkap=" + lengkap + " totalHalaman=" + totalHalaman + " colIncident=" + hasil.colIncident);
          kirimKeAppsScript(rows, hasil.colIncident, lengkap, selesaiKlik);
          return;
        }
        percobaan++;
        if (percobaan < 5) {
          toast("Menunggu tabel dimuat... (" + percobaan + "/5)", 5000);
          setTimeout(bacaDanLanjut, 600);
        } else {
          if (otomatis) log("Auto: tidak ada baris data terbaca.");
          else toast("Tidak ada baris data terbaca.\n\nHASIL DIAGNOSA:\n" + detailStruktur, 6000);
          akhiriSync();
        }
      }).catch(function (e) {
        log("Error baca halaman: " + e);
        if (!otomatis) toast("Gagal baca halaman: " + e, 5000);
        akhiriSync();
      });
    }

    function selesaiKlik(res, ok) {
      if (!ok) {
        toast("Gagal: " + res, 5000);
        log("Auto-sync GAGAL: " + res);
      } else if (res && res.ok) {
        var peringatan = (kolomIncidentTerpakai === -1)
          ? "\n\n⚠️ Pola kolom INCIDENT (-1) tidak ditemukan. Fallback ke indeks 0."
          : "";
        var ringkas = "Baru: " + (res.baru || 0) +
          " | Update: " + (res.update || 0) +
          " | Hapus: " + (res.hapus || 0);
        log("Auto-sync SELESAI: " + ringkas);

        toast("✓ Sinkron selesai!\n" +
          "Baris dibaca: " + barisTerbaca +
          "\nHalaman: " + totalHalaman +
          "\nBaru (hijau): " + (res.baru || 0) +
          "\nUpdate (kuning): " + (res.update || 0) +
          "\nHapus otomatis: " + (res.hapus || 0) +
          "\nKolom/baris: " + kolomPerBaris + " (ideal 81)" + peringatan, 5000);
      } else if (res && res.error === "TOKEN_SALAH") {
        toast("Token salah! Cocokkan ACCESS_TOKEN di userscript & code.gs", 5000);
      } else {
        toast("Respon tidak dikenal: " + JSON.stringify(res).slice(0, 200), 5000);
      }
      akhiriSync();
    }
  }

  // ============ UTIL DEBUG ============

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
      if (tr) L.push("td baris1: " + tr.querySelectorAll("td").length);
    }
    iframes.forEach(function (f, i) {
      try {
        var fdoc = f.contentDocument || f.contentWindow.document;
        var ft = fdoc ? fdoc.querySelectorAll("table").length : -1;
        var fr = fdoc ? (fdoc.querySelectorAll("table tr").length) : 0;
        L.push("iframe#" + i + ": table=" + ft + " tr=" + fr + " src=" + f.src.slice(0, 80));
      } catch (e) { L.push("iframe#" + i + ": CROSS-ORIGIN"); }
    });
    var msg = L.join("\n");
    console.log("[BotInsera] DEBUG:\n" + msg);
    return msg;
  }

  // ============ PASANG ============

  function pasang() {
    buatTombol();
    if (document.getElementById("binsera-btn") && document.getElementById("binsera-auto-btn")) {
      mulaiSemua();
      return null;
    }
    var kali = 0;
    var timer = setInterval(function () {
      buatTombol();
      kali++;
      if ((document.getElementById("binsera-btn") && document.getElementById("binsera-auto-btn")) || kali > 50) {
        if (document.getElementById("binsera-btn")) mulaiSemua();
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

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("binsera-btn")) pasang();
  });
})();