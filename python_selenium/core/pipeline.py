# -*- coding: utf-8 -*-
"""Pipeline utama: scrape data dari Insera -> rapikan -> tulis ke Google Sheets."""

from selenium.webdriver.remote.webdriver import WebDriver

from scraper import navigasi, reader
from writer import google_sheet


def baca_header(driver: WebDriver) -> list[str]:
    """Membaca header kolom dari tabel di halaman Insera."""
    return reader.ambil_header(driver)


def baca_semua_data(driver: WebDriver) -> list[list[str]]:
    """Membaca seluruh baris (termasuk lintas halaman pagination)."""
    # navigasi.perbesar_item_per_halaman(driver)  # opsional, aktifkan setelah validasi
    return navigasi.baca_semua_halaman(driver)


def sync_ke_sheet(driver: WebDriver, update_yang_ada: bool = False) -> dict:
    """Membaca seluruh tabel lalu menulis ke tab `copas tket`.

    Mengembalikan statistik: {'terbaca': n, 'baru': n, 'update': n, 'total': n}.
    """
    baris = baca_semua_data(driver)
    stat = {"terbaca": len(baris), "baru": 0, "update": 0, "total": 0}
    if baris:
        hasil = google_sheet.tulis_tiket(baris, update_yang_ada=update_yang_ada)
        stat.update(hasil)
    return stat
