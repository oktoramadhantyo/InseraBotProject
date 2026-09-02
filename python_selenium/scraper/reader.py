# -*- coding: utf-8 -*-
"""Membaca seluruh baris tabel ALL TICKET LIST dari elemen HTML (<tr>/<td>).

Tidak memakai tombol bawaan Insera; membaca langsung dari DOM tabel.
"""

from selenium.webdriver.remote.webdriver import WebDriver

from core.config import SELECTOR_BARIS


def ambil_header(driver: WebDriver) -> list[str]:
    """Mengambil nama kolom dari baris header tabel (thead/tr pertama yang terlihat)."""
    js = """
    var rows = document.querySelectorAll('table tr');
    for (var i=0; i<rows.length; i++){
      var ths = rows[i].querySelectorAll('th, td[scope]');
      if (ths.length > 1){
        var cols = [];
        ths.forEach(function(th){
          cols.push(th.innerText.trim());
        });
        return cols;
      }
      var cellTexts = rows[i].querySelectorAll('th');
      if (cellTexts.length > 1){
        return Array.from(cellTexts).map(function(th){return th.innerText.trim();});
      }
    }
    return [];
    """
    return driver.execute_script(js)


def ambil_semua_baris(driver: WebDriver) -> list[list[str]]:
    """Mengambil isi semua baris <tr> pada tabel, setiap <td> diambil per kolom.

    Mengembalikan list baris; setiap baris adalah list nilai kolom (urutan = tampilan).
    Baris yang tidak punya data (semua kosong) dilewati.
    """
    js = """
    var out = [];
    var rows = document.querySelectorAll('tbody tr');
    rows.forEach(function(tr){
      var tds = tr.querySelectorAll('td');
      var vals = [];
      tds.forEach(function(td){ vals.push(td.innerText.trim()); });
      // Hanya sertakan baris yang punya setidaknya satu nilai
      if (vals.some(function(v){ return v !== ''; })){
        out.push(vals);
      }
    });
    return out;
    """
    return driver.execute_script(js)


def jumlah_baris(driver: WebDriver) -> int:
    """Jumlah baris data yang tampil saat ini di tabel."""
    js = (
        "var rows=document.querySelectorAll('tbody tr');"
        "var n=0;"
        "rows.forEach(function(tr){var tds=tr.querySelectorAll('td');"
        "  var has=false;tds.forEach(function(td){if(td.innerText.trim()!=='')has=true;});"
        "  if(has)n++;"
        "});"
        "return n;"
    )
    return int(driver.execute_script(js))
