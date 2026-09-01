# Runbook koneksi WhatsApp

## Menghubungkan nomor

1. Masuk sebagai admin Travel pada brand yang sesuai.
2. Buka **Pengaturan → Koneksi WhatsApp**.
3. Pilih **Tampilkan QR**, lalu pindai dari menu **Perangkat tertaut** pada WhatsApp.
4. Pastikan status berubah menjadi `connected` sebelum mengirim pesan.

Pada pairing baru, gateway memakai profil WhatsApp Desktop dan meminta sinkronisasi histori penuh. WhatsApp tetap menentukan jumlah serta rentang histori yang dikirim; chat lama akan muncul bertahap selama event sinkronisasi diterima.

Kontak histori disimpan ke direktori CRM brand aktif. Identitas `@lid` dipetakan dahulu ke nomor WhatsApp asli. Status/story, broadcast, grup, newsletter, serta LID yang belum memiliki pasangan nomor tidak dimasukkan ke inbox.

QR dan kredensial tidak boleh disalin ke log, tiket, atau repository. Sesi production disimpan terenkripsi di database dan dibatasi satu sesi per brand.

## Reconnect

Gateway melakukan reconnect dengan exponential backoff dan hanya mempertahankan satu timer serta satu socket per brand. Tombol **Coba lagi sekarang** membatalkan waktu tunggu reconnect dan memulai percobaan segera.

Saat worker/API hidup kembali, sesi database yang masih memiliki auth terenkripsi dipulihkan otomatis. Lease lama tetap dihormati dan akan dicoba ulang setelah kedaluwarsa.

Jika worker sebelumnya berhenti mendadak, lease database dapat bertahan maksimal 45 detik. Kondisi ini ditampilkan sebagai `reconnecting` dan dicoba ulang otomatis; pengguna tidak menerima error internal.

Event penutupan dari socket lama diabaikan bila socket baru sudah mengambil alih. Hal ini mencegah koneksi baru ikut terhapus akibat event yang datang terlambat.

Pengiriman pesan tidak memaksakan UUID internal CRM sebagai ID WhatsApp. ID native yang diterbitkan Baileys disimpan setelah pengiriman sukses agar delivery receipt dapat dicocokkan dan perangkat tidak menolak format ID buatan aplikasi.

## Impor kontak massal

Admin Travel dapat membuka **Kontak → Impor kontak**. Gunakan satu kontak per baris dengan format `nama|nomorhp`, misalnya `Ahmad Fauzi|081234567890`. Nomor dinormalisasi ke E.164, duplikat pada brand yang sama diperbarui, dan maksimal 1.000 baris diproses dalam satu permintaan.

## Pemeriksaan gangguan

- Pastikan `/health` melaporkan database, ERP, dan outbox sehat.
- Periksa log terstruktur `whatsapp_reconnect_scheduled`, `whatsapp_connect_failed`, dan `whatsapp_lock_release_failed` berdasarkan `brandId`.
- Log hanya memuat kode status dan nama error; jangan mencatat QR, auth state, nomor lengkap, atau isi pesan.
- Bila status tetap `reconnecting`, pilih **Coba lagi sekarang**. Restart worker menjadi langkah terakhir setelah memastikan tidak ada worker lain yang memegang lease sesi.

## Logout perangkat

Gunakan **Keluar & hapus sesi** hanya jika perangkat memang harus dilepas. Tindakan ini melakukan logout WhatsApp dan membutuhkan pemindaian QR baru.

Ketika WhatsApp sendiri mengirim status `logged_out`, gateway menunggu penulisan auth yang sedang berjalan lalu menghapus kredensial terenkripsi yang sudah tidak valid. Percobaan koneksi berikutnya dimulai dari auth kosong agar QR baru dapat diterbitkan dan tidak kembali memakai sesi yang telah ditolak.
