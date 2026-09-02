# -*- coding: utf-8 -*-
"""Attach ke sesi Chrome yang sudah login Insera via remote debugging port.

Prinsip: TIDAK membuka browser baru dan TIDAK melakukan login.
Hanya menyambung (attach) ke Chrome yang sedang berjalan dengan
flag `--remote-debugging-port=<DEBUG_PORT>`.
"""

from selenium import webdriver
from selenium.webdriver.chrome.options import Options

from core.config import DEBUG_PORT


def buat_driver(port: int = DEBUG_PORT) -> webdriver.Chrome:
    """Menyambung ke Chrome existing yang aktif pada port debugging.

    Mengharuskan Chrome dijalankan dengan:
        chrome.exe --remote-debugging-port=<port> --user-data-dir="<folder-profil>"
    """
    options = Options()
    options.add_experimental_option("debuggerAddress", f"127.0.0.1:{port}")
    driver = webdriver.Chrome(options=options)
    return driver


def halaman_aktif(driver: webdriver.Chrome) -> str:
    """Mengembalikan URL halaman yang sedang aktif di browser."""
    return driver.current_url


def cek_insera_terbuka(driver: webdriver.Chrome, url: str, timeout: int = 15) -> bool:
    """Menunggu sampai halaman ALL TICKET LIST Insera terbuka / sudah login."""
    import time

    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    try:
        # Pindah ke tab dengan URL Insera bila ada
        for handle in driver.window_handles:
            driver.switch_to.window(handle)
            if url.split("/")[0] in driver.current_url:
                break
        WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "body"))
        )
        return True
    except Exception:
        return False


def tutup(driver: webdriver.Chrome) -> None:
    """Menutup koneksi ke browser (tanpa menutup Chrome karena itu milik user)."""
    try:
        driver.quit()
    except Exception:
        pass
