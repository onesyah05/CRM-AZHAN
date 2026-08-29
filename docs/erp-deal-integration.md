# Kontrak Integrasi Deal dengan ERP

## Aturan utama

CRM tidak boleh menetapkan tahap `Deal` sebelum ERP mengembalikan booking yang valid. Proses harus idempotent berdasarkan kombinasi `brand_id`, `lead_id`, dan `idempotency_key`.

Alur target:

1. Validasi ulang jadwal dan sisa seat di ERP.
2. Upsert data jamaah berdasarkan brand dan nomor telepon yang sudah dinormalisasi.
3. Buat booking ERP.
4. Terapkan komitmen Book Seat, DP, atau Lunas secara atomik.
5. Simpan seluruh ID ERP pada konversi CRM.
6. Baru pindahkan lead ke `Deal` dan tulis activity log.

## Endpoint ERP pendukung

Gateway memakai login/refresh, brand context, daftar brand, daftar jadwal, dan endpoint Deal atomik. ERP menyimpan idempotency key, mengunci jadwal saat mengurangi seat, mencatat payment DP/Lunas, serta melepaskan Book Seat yang kedaluwarsa.

## Endpoint yang digunakan

```http
POST /api/admin/crm/deals
Authorization: Bearer <erp-access-token>
Idempotency-Key: <uuid>
Content-Type: application/json
```

Contoh payload:

```json
{
  "brand_id": 1,
  "external_lead_id": "lead-uuid",
  "jamaah": {
    "nama": "Nadia Rahma",
    "telepon": "+628123456789",
    "email": "nadia@example.com",
    "kota": "Bekasi"
  },
  "booking": {
    "schedule_id": 101,
    "room_type": "Quad",
    "pax": 2
  },
  "commitment": {
    "type": "book_seat",
    "seat_hold_expires_at": "2026-08-31T10:00:00+07:00"
  }
}
```

Untuk `dp` atau `lunas`, objek `commitment` membawa `amount`, `method`, dan `paid_at`.

Respons berhasil minimal:

```json
{
  "jamaah_id": 1201,
  "booking_id": 9011,
  "payment_id": null,
  "booking_status": "book_seat",
  "seat_blocked": true,
  "seat_hold_expires_at": "2026-08-31T10:00:00+07:00"
}
```

ERP menyimpan idempotency key dan mengembalikan respons yang sama pada retry. Konflik seat menggunakan `409` dengan kode `SEAT_UNAVAILABLE`.

## Rekonsiliasi dan recovery

- Simpan status konversi `pending`, `erp_completed`, `completed`, atau `failed`.
- Jika ERP berhasil tetapi update CRM gagal, retry harus membaca hasil berdasarkan idempotency key, bukan membuat booking baru.
- Job rekonsiliasi mencari konversi `erp_completed` dan menyelesaikan perubahan lead/activity.
- Expiry Book Seat dijalankan ERP sebagai sumber kebenaran; CRM menerima webhook atau melakukan polling terjadwal lalu mengubah substatus menjadi `book_seat_expired`.
- Jangan menurunkan status Deal hanya karena webhook terlambat. Catat perubahan substatus dan tampilkan tindakan follow-up.

CRM menyinkronkan payment `source=crm` dari `GET /api/admin/bookings/{id}/payments` ketika lead DP dibuka/daftar lead dimuat. Status ERP dipetakan ke `dp_pending`, `dp_confirmed`, atau `dp_rejected`, dicatat sebagai aktivitas/audit, dan dapat dipicu ulang dari detail lead tanpa membuat payment baru.
