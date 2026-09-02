# -*- coding: utf-8 -*-
"""Injeksi tombol custom Start/Stop ke halaman ALL TICKET LIST Insera.

Tombol ini hanya mengontrol STATE (mulai/berhenti) proses sync antar spreadsheet.
Loop Python membaca state ini lewat element tambahan yang disisipkan ke halaman.
Tidak memakai tombol bawaan Insera ("Copy All Tickets" / "Download CSV").
"""

from selenium.webdriver.remote.webdriver import WebDriver

# State container & styling langsung disuntikkan sebagai elemen HTML
_JAVASCRIPT_INJECT = """
(function(){
  if (window.__binsera_installed__) { return; }
  window.__binsera_installed__ = true;

  var state = document.createElement('div');
  state.id = 'binsera-state';
  state.setAttribute('data-state', 'stop');
  state.style.display = 'none';
  document.body.appendChild(state);

  var box = document.createElement('div');
  box.id = 'binsera-box';
  box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;'
    + 'background:#fff;border:1px solid #ccc;border-radius:8px;padding:10px;'
    + 'box-shadow:0 2px 8px rgba(0,0,0,.25);font-family:sans-serif;';

  var lbl = document.createElement('div');
  lbl.style.cssText = 'font-weight:bold;margin-bottom:6px;font-size:12px;';
  lbl.textContent = 'BotInsera Sync';

  var status = document.createElement('span');
  status.id = 'binsera-status';
  status.textContent = 'STATUS: STOP';
  status.style.cssText = 'display:block;margin-bottom:6px;color:#d33;font-weight:bold;font-size:12px;';

  var tgl = document.createElement('div');
  tgl.id = 'binsera-last';
  tgl.textContent = 'Sync terakhir: -';
  tgl.style.cssText = 'display:block;font-size:11px;color:#666;margin-bottom:6px;';

  var start = document.createElement('button');
  start.id = 'binsera-start';
  start.textContent = '▶ Start';
  start.style.cssText = 'padding:6px 12px;margin-right:4px;cursor:pointer;border:none;border-radius:4px;background:#2e7d32;color:#fff;';

  var stop = document.createElement('button');
  stop.id = 'binsera-stop';
  stop.textContent = '■ Stop';
  stop.style.cssText = 'padding:6px 12px;cursor:pointer;border:none;border-radius:4px;background:#c62828;color:#fff;';

  var el = document.getElementById('binsera-status');

  start.addEventListener('click', function(){
    state.setAttribute('data-state', 'start');
    if(el){ el.textContent = 'STATUS: START'; el.style.color = '#2e7d32'; }
  });
  stop.addEventListener('click', function(){
    state.setAttribute('data-state', 'stop');
    if(el){ el.textContent = 'STATUS: STOP'; el.style.color = '#d33'; }
  });

  box.appendChild(lbl);
  box.appendChild(status);
  box.appendChild(tgl);
  box.appendChild(start);
  box.appendChild(stop);
  document.body.appendChild(box);
})();
"""


def inject_ke_halaman(driver: WebDriver) -> None:
    """Menyuntikkan tombol Start/Stop ke halaman yang sedang aktif."""
    driver.execute_script(_JAVASCRIPT_INJECT)


def baca_state(driver: WebDriver) -> str:
    """Mengembalikan state aktif: 'start' atau 'stop'.

    Jika tombol belum terpasang (halaman baru), injeksi ulang.
    """
    ada = driver.execute_script(
        "return !!document.getElementById('binsera-state');"
    )
    if not ada:
        inject_ke_halaman(driver)
    return driver.execute_script(
        "var s=document.getElementById('binsera-state');"
        "return s ? s.getAttribute('data-state') : 'stop';"
    )


def set_done(driver: WebDriver, waktu: str) -> None:
    """Memperbarui keterangan 'Sync terakhir' di kotak tombol."""
    driver.execute_script(
        "var t=document.getElementById('binsera-last');"
        "if(t){t.textContent='Sync terakhir: '+arguments[0];}",
        waktu,
    )
