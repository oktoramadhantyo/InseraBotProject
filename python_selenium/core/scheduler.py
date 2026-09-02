# -*- coding: utf-8 -*-
"""Scheduler: loop otomatis yang mengecek state Start/Stop di halaman Insera.

- Berjalan terus selama bot aktif.
- Setiap interval mengecek tombol (Start/Stop) yang di-inject ke halaman.
- Jika state 'start'   -> jalankan pipeline (scrape + tulis ke sheet).
- Jika state 'stop'    -> lewati, tunggu interval berikutnya.
"""

import time
from datetime import datetime

from scraper import injector
from core.config import INTERVAL_MENIT
from core.pipeline import sync_ke_sheet


def _waktu_sekarang() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def jalankan_loop(driver, interval_menit: int = INTERVAL_MENIT, sekali: bool = False) -> None:
    """Menjalankan loop utama.

    driver         : instance selenium ter-attach ke Chrome.
    interval_menit : jeda antar pengecekan (default dari config).
    sekali         : bila True, hanya jalankan satu siklus lalu berhenti (debug).
    """
    print(f"[BotInsera] Loop dimulai. Interval: {interval_menit} menit.")
    injector.inject_ke_halaman(driver)
    injector.set_done(driver, "-")

    while True:
        try:
            state = injector.baca_state(driver)
        except Exception as e:
            print(f"[BotInsera] Gagal membaca state: {e}")
            state = "stop"

        if state == "start":
            print(f"[BotInsera] {_waktu_sekarang()} - START: memulai sync...")
            try:
                stat = sync_ke_sheet(driver)
                print(
                    f"[BotInsera] Sinkron selesai: terbaca={stat.get('terbaca')}, "
                    f"baru={stat.get('baru')}, update={stat.get('update')}."
                )
                injector.set_done(driver, _waktu_sekarang())
            except Exception as e:
                print(f"[BotInsera] ERROR saat sync: {e}")
                injector.set_done(driver, f"ERROR: {e}")
        else:
            print(f"[BotInsera] {_waktu_sekarang()} - STOP: menunggu...")

        if sekali:
            print("[BotInsera] Mode sekali: selesai.")
            break

        time.sleep(interval_menit * 60)
