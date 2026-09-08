**Fungsi (Function) dalam Google Apps Script**.

Dropdown tersebut berisi daftar fungsi atau blok kode (`function`) yang sudah kamu buat di dalam file *script* tersebut. Menu itu berfungsi untuk memilih fungsi spesifik yang mau kamu jalankan (uji coba) atau debug secara manual dengan mengklik tombol *Run* di sebelah kanannya.

Berikut adalah konteks fungsi-fungsi yang terlihat di gambar:

* **`warnaBerdasarkanWaktu`**: Fungsi untuk memberikan atau mengubah warna sel (misalnya di Google Sheets) secara otomatis berdasarkan kondisi waktu tertentu.
* **`doPost` & `doGet**`: Fungsi bawaan khusus (web app handler) yang otomatis terpanggil ketika script kamu di-deploy sebagai Web App untuk menangani permintaan HTTP POST (mengirim data) atau GET (mengambil data). Biasanya dipakai kalau script kamu terhubung dengan form eksternal atau aplikasi lain.
* **`tulisTiket`**: Fungsi khusus untuk memasukkan atau menulis data tiket (mirip seperti tabel data pelanggan dan tiket dari spreadsheet yang kamu bahas sebelumnya).
* **`hapusRentangCepat`**: Fungsi untuk menghapus isi atau format pada rentang sel (`range`) tertentu di Google Sheets dengan cepat.