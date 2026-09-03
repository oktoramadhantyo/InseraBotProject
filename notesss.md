https://github.com/oktoramadhantyo/InseraBotProject

# LIST KERJA HARI INI

## A. Persiapan File (untuk debug pagination esok)
- [ ] 1. Buka halaman Insera (ALL TICKET LIST), login seperti biasa
- [ ] 2. Simpan HTML Page 1:
      F12 → tab Elements → klik kanan tag <html> → Copy → Copy outerHTML
      → paste ke Notepad/VS Code → simpan sebagai page1.html
- [ ] 3. Pindah ke Page 2, simpan HTML Page 2 (langkah sama) → simpan sebagai page2.html
- [ ] 4. Catat URL page 1 & page 2 dari address bar
- [ ] 5. Screenshot Console (F12 → Console) setelah klik "🔄 Sync ke Sheets"
- [ ] 6. Pastikan Tampermonkey script "BotInsera" posisi ON

## B. Verify Apps Script v2.0 (yang barusan di-push)
- [ ] 7. Buka spreadsheet → Extensions → Apps Script
- [ ] 8. Tempel code.gs v2.0 (isi file dari GitHub)
- [ ] 9. Deploy → Manage deployments → Edit → New version → Deploy
      (pastikan URL Web App tetap sama / update di userscript kalau berubah)
- [ ] 10. Cek ACCESS_TOKEN di code.gs sama dengan di userscript

## C. Catatan
- Fix pagination page 2 butuh HTML page1 & page2 (file A.2 & A.3)