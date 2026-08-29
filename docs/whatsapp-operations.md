# Operasional WhatsApp Baileys

## Development

Atur `DEMO_MODE=false`. Untuk eksperimen lokal saja, `WA_AUTH_DRIVER=filesystem` dapat memakai `WA_AUTH_PATH=.data/wa-auth`. Buka **Pengaturan → Koneksi WhatsApp**, tampilkan QR, lalu pindai melalui menu Perangkat Tertaut pada WhatsApp.

Adapter hanya memproses chat personal. Group, status, dan newsletter diabaikan. Broadcast massal tidak disediakan.

## Syarat production

- Wajib `WA_AUTH_DRIVER=database`; konfigurasi production menolak filesystem.
- Gunakan encryption key dari secret manager; jangan simpan key bersama ciphertext.
- Kredensial dan Signal keys disimpan sebagai blob AES-256-GCM per `brand_id`.
- Connection lock database memastikan hanya satu worker aktif per akun.
- Message ID memiliki unique key untuk deduplikasi inbound/outbound.
- Outbox persisten memakai claim lock, retry backoff, crash recovery, dan retry manual.
- Media dibatasi 10 MB, divalidasi tipe, disimpan privat, dan dilayani melalui endpoint tenant-scoped.
- Pantau reconnect loop, logout, message failure rate, queue age, dan disk/database usage.

Baileys adalah integrasi WhatsApp Web yang tidak resmi. Perubahan protokol dapat memutus koneksi, sehingga upgrade dependency harus dipin, diuji di staging, dan memiliki rollback.

## Recovery singkat

1. `reconnecting`: tunggu backoff dan periksa konektivitas worker.
2. `logged_out`: minta admin melakukan relink melalui QR; tombol **Keluar & hapus sesi** hanya digunakan setelah konfirmasi.
3. Korupsi auth state: arsipkan data lama secara aman, revoke linked device, lalu scan QR baru.
4. Pesan berstatus `failed`: gunakan tombol retry; ID deterministik mencegah pengiriman ganda setelah ack sudah tersimpan.
