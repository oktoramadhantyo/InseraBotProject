# -*- coding: utf-8 -*-
"""Menulis data tiket hasil scrape ke Google Spreadsheet (tab `copas tket`).

Strategi:
- Membaca data yang sudah ada, memetakan no INCIDENT (kolom pertama) agar tidak duplikat.
- Data baru yang belum ada ditambahkan (append) ke baris berikutnya di bawah header.
- Format tetap sama dengan hasil copy manual biar formula filter tidak rusak.
"""

import json
import os

import gspread
from google.oauth2.service_account import Credentials

from core.config import CREDENTIAL_FILE, SCOPES, SHEET_ID, TAB_TUJUAN

_kolom_incident = 0  # INCIDENT selalu kolom pertama


def _kolom_ke_huruf(angka: int) -> str:
    """Mengubah nomor kolom (1-based) menjadi huruf spreadsheet (A, B, ..., AA)."""
    hasil = ""
    while angka > 0:
        angka, sisa = divmod(angka - 1, 26)
        hasil = chr(65 + sisa) + hasil
    return hasil


def _buat_client() -> gspread.Client:
    cred_json = os.getenv("GOOGLE_CREDENTIALS")
    if cred_json:
        info = json.loads(cred_json)
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        creds = Credentials.from_service_account_file(CREDENTIAL_FILE, scopes=SCOPES)
    return gspread.authorize(creds)


_KUNING = {"red": 1.0, "green": 0.917, "blue": 0.353}  # kuning


def _warnai_incident(ws, baris_awal: int, baris_akhir: int) -> None:
    """Memberi latar belakang kuning pada sel kolom A (INCIDENT) pada rentang baris."""
    if baris_awal > baris_akhir:
        return
    ws.format(
        f"A{baris_awal}:A{baris_akhir}",
        {"backgroundColor": _KUNING},
    )


def ambil_header_dari_sheet() -> list[str]:
    """Membaca baris header yang ada di tab `copas tket` saat ini."""
    sheet = _buat_client().open_by_key(SHEET_ID)
    ws = sheet.worksheet(TAB_TUJUAN)
    return ws.row_values(1)


def tulis_tiket(baris_baru: list[list[str]], update_yang_ada: bool = False) -> dict:
    """Menulis tiket ke `copas tket` sambil menghindari duplikat by INCIDENT.

    Parameter:
      baris_baru       : list baris (setiap baris list kata/kolom berturut-turut).
      update_yang_ada  : bila True, baris dengan INCIDENT yang sama diperbarui;
                         bila False (default) hanya baris baru yang ditambahkan.

    Mengembalikan dict statistik: {'baru': n, 'update': n, 'total': n}.
    """
    if not baris_baru:
        return {"baru": 0, "update": 0, "total": 0}

    sheet = _buat_client().open_by_key(SHEET_ID)
    ws = sheet.worksheet(TAB_TUJUAN)

    # Baca data yang sudah ada (skip header). Ukur baris terakhir yang berisi data.
    data_lama = ws.get_all_values()
    lama_rows = data_lama[1:] if data_lama else []

    # Baris terakhir di sheet yang benar-benar berisi data (di kolom pertama),
    # dihitung agar append tidak melompati baris kosong paddding di bawah data.
    baris_terakhir_data = len(lama_rows)
    while baris_terakhir_data > 0 and not lama_rows[baris_terakhir_data - 1]:
        baris_terakhir_data -= 1

    peta_lama = {}
    for idx, row in enumerate(lama_rows[:baris_terakhir_data]):
        if row and row[0]:
            peta_lama[str(row[0]).strip()] = idx  # idx 0-based di lama_rows

    stat = {"baru": 0, "update": 0, "total": 0}
    baris_tulis_baru: list[list] = []
    baris_update: dict[int, list] = {}

    for row in baris_baru:
        if not row or not any(str(c).strip() for c in row):
            continue
        inc = str(row[_kolom_incident]).strip() if len(row) > _kolom_incident else ""
        if not inc:
            continue
        if inc in peta_lama:
            if update_yang_ada:
                baris_update[peta_lama[inc]] = row
            continue
        baris_tulis_baru.append(row)
        stat["baru"] += 1

    # Update baris yang sudah ada secara batch (hemat panggilan API).
    if baris_update:
        n_kolom = max((len(r) for r in baris_update.values()), default=1)
        kolom_akhir = _kolom_ke_huruf(n_kolom)
        # susun matrix: posisi baris (urutan menaik) -> data
        urutan = sorted(baris_update.keys())
        start_sheet = urutan[0] + 2
        end_sheet = urutan[-1] + 2
        matrix = []
        for idx_baris in range(urutan[0], urutan[-1] + 1):
            matrix.append(baris_update.get(idx_baris, [""] * n_kolom))
        ws.update(
            f"A{start_sheet}:{kolom_akhir}{end_sheet}",
            matrix,
            value_input_option="USER_ENTERED",
        )
        stat["update"] = len(urutan)
        _warnai_incident(ws, start_sheet, end_sheet)

    # Append baris baru setelah baris data terakhir (baris 1 = header).
    if baris_tulis_baru:
        n_kolom = max((len(r) for r in baris_tulis_baru), default=1)
        kolom_akhir = _kolom_ke_huruf(n_kolom)
        start = baris_terakhir_data + 2  # baris kosong pertama setelah data terakhir
        end_row = start + len(baris_tulis_baru) - 1
        ws.update(
            f"A{start}:{kolom_akhir}{end_row}",
            baris_tulis_baru,
            value_input_option="USER_ENTERED",
        )
        _warnai_incident(ws, start, end_row)

    stat["total"] = stat["baru"] + stat["update"]
    return stat
