# -*- coding: utf-8 -*-
"""Navigasi, filter, dan penanganan pagination pada halaman ALL TICKET LIST.

Catatan: beberapa selector umum didaftarkan di sini. Karena halaman nyata
belum divisualkan, selector ini bisa disesuaikan saat tes lapangan.
"""

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


def pindah_ke_tab_insera(driver: WebDriver) -> None:
    """Berpindah ke tab Chrome yang berisi halaman Insera bila ada."""
    for handle in driver.window_handles:
        driver.switch_to.window(handle)
        if "oss-incident" in driver.current_url:
            return


def cek_daftar_baris_lebih_dari_tampil(total_label: str) -> bool:
    """Helper untuk membaca teks pagination (misal '150 items found, displaying 1 to 100')."""
    return False


def perbesar_item_per_halaman(driver: WebDriver, maks_target: int = 100) -> None:
    """Menaikkan dropdown jumlah item per halaman (default '100') ke nilai maksimal.

    Ini bersifat opsional & best-effort. Jika dropdown tidak ditemukan, dilewati
    (pagination tetap dikerjakan oleh fungsi `baca_semua_halaman`).
    """
    try:
        # Selector umum di banyak tabel (mis. class p-paginator atau combobox).
        # Disesuaikan saat tes karena struktur halaman nyata belum dilihat.
        selectors = [
            ".ui-paginator-rpp-options",
            "select.ui-paginator-rpp-options",
            "select[aria-label*='rows']",
        ]
        for sel in selectors:
            try:
                combo = driver.find_element(By.CSS_SELECTOR, sel)
                options = combo.find_elements(By.TAG_NAME, "option")
                if options:
                    # pilih option dengan nilai terbesar
                    best = max(
                        options,
                        key=lambda o: _nilai_option(o.get_attribute("value")),
                    )
                    best.click()
                    return
            except Exception:
                continue
    except Exception:
        pass


def _nilai_option(v: str) -> int:
    try:
        return int(v)
    except Exception:
        return 0


def baca_semua_halaman(driver: WebDriver, max_halaman: int = 50):
    """Membaca semua halaman pagination sampai tidak ada tombol 'next'.

    Mengembalikan list baris gabungan seluruh halaman.

    Catatan: penanganan tombol 'next' dipandu lewat DOM. Structure tombol
    Next akan divalidasi saat tes nyata; di sini disediakan logika generik.
    """
    from .reader import ambil_semua_baris

    semua: list[list[str]] = []
    for _ in range(max_halaman):
        baris = ambil_semua_baris(driver)
        if baris:
            semua.extend(baris)
        if not _ada_tombol_next(driver):
            break
        klik_next(driver)
    return semua


def _ada_tombol_next(driver: WebDriver) -> bool:
    """Mendeteksi keberadaan tombol 'next' pagination (best-effort)."""
    xpath_seleksi = [
        "//a[contains(@class,'ui-paginator-next')]",
        "//span[contains(@class,'ui-paginator-next')]",
        "//a[text()='Next']",
        "//a[text()='>']",
    ]
    for xp in xpath_seleksi:
        try:
            el = driver.find_element(By.XPATH, xp)
            if el.is_enabled():
                return True
        except Exception:
            continue
    return False


def klik_next(driver: WebDriver) -> None:
    xpath_seleksi = [
        "//a[contains(@class,'ui-paginator-next')]",
        "//span[contains(@class,'ui-paginator-next')]",
        "//a[text()='Next']",
        "//a[text()='>']",
    ]
    for xp in xpath_seleksi:
        try:
            el = driver.find_element(By.XPATH, xp)
            if el.is_enabled():
                el.click()
                WebDriverWait(driver, 10).until(
                    EC.staleness_of(el)
                )
                return
        except Exception:
            continue
