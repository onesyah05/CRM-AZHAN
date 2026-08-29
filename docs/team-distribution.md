# Tim CS dan Distribusi Lead

## Peran dan sumber data

- Akun login tetap bersumber dari tabel `admin_users` ERP. Kolom `role` bernilai `admin` atau `cs`; akun lama otomatis menjadi `admin`.
- Admin CRM hanya dapat membuat, mengubah, menonaktifkan, dan mereset password CS pada brand aktifnya.
- CRM menyimpan snapshot minimum akun CS dan state distribusi. Password dan autentikasi tetap dimiliki ERP.
- Manager melihat semua data dalam brand. CS hanya dapat membaca atau mengubah lead, percakapan, pesan, dashboard, dan aktivitas yang memiliki `assignee_erp_user_id` sama dengan identitas login.

## Algoritma rotasi

Satu siklus berisi tepat 100 assignment. Persentase seluruh CS aktif wajib bilangan bulat 1–100 dan totalnya wajib tepat 100.

Pemilihan dimulai dari cursor terakhir dan mengunjungi CS menurut `rotation_position`. Setiap CS mendapat maksimal satu lead per putaran. CS yang kuotanya sudah habis dilewati, sedangkan CS lain terus mendapat giliran sampai seluruh 100 slot habis. Untuk kuota 10/40/30/20, enam lead pertama adalah CS1, CS2, CS3, CS4, CS1, CS2; setelah 100 assignment total akhirnya 10, 40, 30, dan 20.

Assignment dilakukan dalam transaksi yang sama dengan pembuatan contact, conversation, dan lead inbound. Row state distribusi serta anggota tim dikunci agar dua pesan yang datang bersamaan tidak memakai slot yang sama. Bila belum ada pembagian 100% yang valid, lead tetap dibuat tanpa PIC agar pesan tidak hilang.

Mengubah pembagian memulai siklus baru dan mengosongkan pemakaian slot. Lead lama tidak dipindahkan. Menonaktifkan CS juga mengosongkan kuota aktif miliknya; admin harus menyimpan kembali pembagian yang totalnya 100% sebelum rotasi otomatis berlanjut.

## Endpoint CRM

- `GET /api/v1/team`
- `POST /api/v1/team`
- `PUT /api/v1/team/:id`
- `PUT /api/v1/team/:id/password`
- `PUT /api/v1/team/distribution`
- `GET /api/v1/team/performance?period=today|week|month|all`

Semua endpoint tim memerlukan session Manager/Super Admin dan brand context tervalidasi. Endpoint CRM berkomunikasi dengan akun ERP melalui `ErpGateway`; browser tidak memanggil ERP langsung.

## Migrasi dan recovery

- ERP: `036_crm_user_roles.sql` menambah `display_name`, `role`, dan `is_active` tanpa menghapus akun lama.
- CRM: `006_team_distribution.sql` menambah `crm_team_members`, `crm_distribution_state`, dan indeks assignee lead.
- Migrasi bersifat forward-only. Sebelum deployment produksi, ambil backup kedua database. Jika deployment aplikasi perlu dibatalkan, jalankan versi aplikasi sebelumnya dan pertahankan tabel/kolom baru karena bersifat kompatibel-aditif. Penghapusan schema hanya boleh dilakukan lewat change terpisah setelah backup diverifikasi dan data tidak lagi dipakai.

## Verifikasi

Unit test memeriksa urutan round-robin dan perilaku skip saat kuota habis. Integration test membuat 100 lead pada database test terisolasi dan memverifikasi hitungan akhir 10/40/30/20. E2E fixture memeriksa halaman Tim CS, total 100%, perubahan pembagian, dan leaderboard.
