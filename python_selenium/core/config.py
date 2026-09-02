# -*- coding: utf-8 -*-
"""Konfigurasi pusat BotInsera (dibaca dari .env dengan fallback default)."""

import os

from dotenv import load_dotenv

load_dotenv()

# ==================== KONFIGURASI BOT ====================
DEBUG_PORT = int(os.getenv("DEBUG_PORT", "9222"))

# URL halaman ALL TICKET LIST Insera (default kosong → diisi lewat .env bila perlu)
INSERA_URL = os.getenv(
    "INSERA_URL",
    "oss-incident.telkom.co.id/jw/web/userview/ticketIncidentService/"
    "ticketIncidentService/_/allTicketList",
)

INTERVAL_MENIT = int(os.getenv("INTERVAL_MENIT", "5"))

# ==================== KONFIGURASI GOOGLE SHEET ====================
# Default mengikuti project BotTele (kredensial & sheet yang sama).
SHEET_ID = os.getenv(
    "SHEET_ID", "1dXZpM8aqtalwxSImF4H34Q9_zwtIuGB7cGzpZx0_2VA"
)
CREDENTIAL_FILE = os.getenv(
    "CREDENTIAL_FILE", "modern-triumph-506502-u0-2b11a7b4943a.json"
)
TAB_TUJUAN = os.getenv("TAB_TUJUAN", "copas tket")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# ==================== SELECTOR HANYA REFERENSI ====================
# Selector ini perlu divalidasi langsung di halaman nyata saat tes.
# Disimpan terpusat biar gampang disesuaikan.
SELECTOR_TABEL = "table"          # tabel utama (disesuaikan saat tes)
SELECTOR_BARIS = "tbody tr"       # baris data di dalam tabel
