# Multi-device WhatsApp per brand

CRM mendukung beberapa nomor WhatsApp dalam satu brand. Setiap nomor adalah sesi Baileys terpisah dengan QR, auth state terenkripsi, status koneksi, lease worker, dan riwayat sinkronisasi sendiri.

## Operasional admin

1. Buka **Pengaturan → Perangkat WhatsApp**.
2. Tambahkan perangkat dan beri nama, misalnya `Sales Jakarta`.
3. Pilih perangkat, tampilkan QR, lalu tautkan dari WhatsApp ponsel.
4. Pilih akun CS yang boleh menangani perangkat dan simpan penugasan.
5. Logout atau reconnect hanya memengaruhi perangkat yang dipilih.

Percakapan baru menyimpan perangkat penerima. Pesan keluar dikirim melalui perangkat yang menerima percakapan tersebut, sehingga nomor tidak tertukar. Manager dapat melihat semua perangkat; CS hanya melihat percakapan dari perangkat yang ditugaskan kepadanya atau lead yang memang ditugaskan kepadanya.

## Migrasi

Migration `008_whatsapp_multi_device.sql` forward-only. Baris sesi lama dipertahankan sebagai `WhatsApp Utama`, percakapan dan pesan lama dihubungkan ke sesi utama, dan outbox lama tetap diproses melalui sesi tersebut. Jalankan `npm run db:migrate` sebelum merestart API.

## Batasan dan keamanan

- Auth state dan Signal keys tidak pernah dikirim ke browser atau dicatat pada log.
- Satu socket hanya boleh dimiliki satu worker melalui lease per sesi.
- Assignment selalu divalidasi terhadap user aktif pada brand yang sama.
- Grup, broadcast, newsletter, dan bulk messaging tetap diabaikan.
- Untuk production gunakan `WA_AUTH_DRIVER=database` dengan encryption key yang dikelola secret manager.
