# Runbook Operasional CRM

## Deployment dan migrasi

1. Backup database dan folder media sebelum perubahan schema.
2. Jalankan `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, dan `npm run build`.
3. Terapkan `npm run db:migrate`; migrasi bersifat maju dan dicatat pada tabel versi migrasi.
4. Nyalakan satu instance API terlebih dahulu dan pastikan `GET /health` berstatus `ok`.
5. Jalankan smoke test login, pemilihan brand, inbox, kirim pesan, serta Deal pada staging.
6. Tambah instance lain hanya setelah connection lock dan outbox terlihat stabil.

Jangan rollback schema dengan menghapus kolom saat incident. Rollback aplikasi ke artefak sebelumnya yang masih kompatibel, lalu siapkan migrasi perbaikan maju.

## Backup

Backup harian minimal mencakup:

- seluruh schema CRM, termasuk session terenkripsi, auth state WhatsApp, outbox, audit, dan idempotency Deal;
- `MEDIA_STORAGE_PATH` dengan checksum;
- versi aplikasi dan nomor migrasi;
- secret disimpan terpisah di secret manager, bukan di arsip database.

Contoh backup MySQL dijalankan dari host aman dengan kredensial melalui login-path atau secret injection:

```bash
mysqldump --single-transaction --routines --triggers azhan_crm > azhan_crm.sql
```

Enkripsi arsip, salin ke storage berbeda, terapkan retention, dan uji restore berkala. Backup yang belum pernah direstore belum dianggap tervalidasi.

## Restore

1. Buat database kosong baru; jangan timpa database aktif.
2. Restore dump dan folder media ke lokasi baru.
3. Gunakan encryption key yang sama agar session/auth blob dapat dibaca.
4. Jalankan migrasi untuk mengejar versi aplikasi target.
5. Nyalakan satu API tanpa traffic publik dan periksa `/health` serta `/metrics`.
6. Verifikasi jumlah conversation/message/outbox, satu brand sampel, dan satu replay Deal.
7. Alihkan traffic setelah verifikasi; pertahankan database lama sampai masa observasi selesai.

## Incident recovery

- **Database gagal:** hentikan mutasi, pulihkan database tervalidasi, lalu pastikan outbox tidak mengirim job `sent` ulang.
- **ERP gagal:** CRM menyimpan conversion `requires_retry`; gunakan idempotency key yang sama setelah ERP sehat.
- **Worker mati saat mengirim:** lease outbox kedaluwarsa dan job dapat diklaim ulang. Message ID deterministik dan ack mencegah duplikasi logis.
- **WhatsApp logout:** hubungkan ulang melalui QR. Jangan menyalin auth blob antarbrand.
- **Media hilang:** pulihkan object key dari backup; pesan tetap tersedia dan endpoint media mengembalikan 404 sampai objek kembali.
- **Secret bocor:** rotasi session secret dan encryption key melalui prosedur terencana. Rotasi encryption key memerlukan re-enkripsi auth/session blob atau login/relink ulang.

## Monitoring

Pantau status `/health`, Deal failure/latency, outbox retry/failure, antrean tertua, koneksi WhatsApp per brand, kapasitas database, dan kapasitas media. Log memakai correlation ID dan brand ID tanpa token, QR, auth keys, atau isi pesan sensitif.
