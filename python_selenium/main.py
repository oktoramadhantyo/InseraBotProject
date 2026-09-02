# -*- coding: utf-8 -*-
"""Entry point BotInsera.

Cara pakai:
  python main.py            -> attach ke Chrome ASCII & jalankan loop (cek Start/Stop)
  python main.py --sekali   -> jalankan satu siklus sync lalu keluar (untuk test)
  python main.py --cek      -> attach, inject tombol, lalu cek state & keluar

Syarat: Chrome harus berjalan dengan flag remote debugging port:
  chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\\chrome-debug"
"""

import argparse
import sys

from scraper.browser import buat_driver, tutup
from core.scheduler import jalankan_loop
from core.config import INSERA_URL, INTERVAL_MENIT


def main() -> None:
    parser = argparse.ArgumentParser(description="BotInsera - sync tiket Insera ke Sheets")
    parser.add_argument("--sekali", action="store_true",
                        help="Jalankan satu siklus sync lalu keluar (untuk test)")
    parser.add_argument("--cek", action="store_true",
                        help="Attach, inject tombol, cek state lalu keluar")
    parser.add_argument("--interval", type=int, default=INTERVAL_MENIT,
                        help="Interval loop dalam menit (default dari config)")
    args = parser.parse_args()

    driver = None
    try:
        print("[BotInsera] Menyambung ke Chrome pada port debug...")
        driver = buat_driver()
        print(f"[BotInsera] Terhubung. URL aktif: {driver.current_url}")

        if args.cek:
            from scraper import injector
            injector.inject_ke_halaman(driver)
            from core.config import DEBUG_PORT
            print(f"[BotInsera] Tombol Start/Stop di-inject. "
                  f"State saat ini: {injector.baca_state(driver)}")
            return

        jalankan_loop(driver, interval_menit=args.interval, sekali=args.sekali)
    except Exception as e:
        print(f"[BotInsera] Gagal memulai: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if driver is not None:
            tutup(driver)


if __name__ == "__main__":
    main()
