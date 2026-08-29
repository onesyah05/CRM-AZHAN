# Azhan CRM

CRM WhatsApp multi-brand untuk tim travel: inbox, pipeline Kanban, aktivitas, detail lead, dan Deal ERP melalui **Book Seat**, **DP**, atau **Lunas**.

## Yang sudah dapat dicoba

- Dashboard ringkasan lead, unread, Deal, nilai pipeline, dan aktivitas.
- Inbox WhatsApp tiga panel dengan pencarian/filter, teks, gambar, dokumen, delivery status, serta retry pesan gagal.
- Pipeline Kanban dengan drag-and-drop dan pilihan tahap yang ramah keyboard.
- Detail lead, edit data jamaah, paket, kamar, pax, PIC, follow-up, dan catatan.
- Wizard Deal tiga langkah. Lead baru menjadi `Deal` hanya setelah booking ERP berhasil.
- Book Seat, DP, dan Lunas memiliki substatus terpisah serta idempotency key.
- Session Baileys terenkripsi di database, connection lock, outbox persisten, ack, reconnect backoff, dan media privat.
- Login/refresh ERP, pemilihan brand Super Admin, serta Socket.IO yang memakai session browser yang sama.
- Role Admin/CS dari akun ERP: Admin mengelola akun CS, pembagian lead, dan leaderboard; CS hanya melihat lead serta percakapan yang ditugaskan.
- Rotasi lead berbasis kuota 100 slot per brand, dengan perubahan pembagian memulai siklus baru tanpa memindahkan lead lama.
- Isolasi `brand_id`, audit aktivitas, correlation ID, rate limit, cookie HttpOnly, health check, dan metrik operasional.

## Menjalankan CRM

Prasyarat: Node.js 22 atau lebih baru.

```bash
copy .env.example .env
npm install
npm run dev
```

Buka `http://localhost:5180`. API berjalan di `http://localhost:9180`.

## Pemeriksaan kualitas

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

Tes E2E memakai Microsoft Edge yang terpasang di Windows. Tes mencakup kirim balasan, edit lead, dan konversi Book Seat sampai mendapat ID booking.

## Konfigurasi integrasi/production

Atur `ERP_API_BASE_URL`, `DATABASE_URL`, `SESSION_SECRET`, `AUTH_ENCRYPTION_KEY`, `WA_AUTH_DRIVER=database`, dan `VITE_ERP_DASHBOARD_URL`. Gunakan secret acak yang berbeda per environment.

Jalankan migrasi sebelum menyalakan API:

```bash
npm run db:migrate
npm run db:seed
npm run build
npm run start --workspace @azhan-crm/api
```

Endpoint Deal ERP atomik dan aturan recovery dijelaskan di [docs/erp-deal-integration.md](docs/erp-deal-integration.md).

Role, endpoint tim, algoritma distribusi, serta catatan migrasi dijelaskan di [docs/team-distribution.md](docs/team-distribution.md).

Fondasi visual, komponen, breakpoint, dan aturan aksesibilitas CRM dijelaskan di [docs/ui-design-system.md](docs/ui-design-system.md).

Panduan WhatsApp ada di [docs/whatsapp-operations.md](docs/whatsapp-operations.md). Backup, restore, deployment, dan incident recovery ada di [docs/operations-runbook.md](docs/operations-runbook.md).

## Operasional

- `GET /health` memeriksa database, ERP, worker outbox, dan mode WhatsApp.
- `GET /metrics` menampilkan counter Deal/outbox tanpa PII.
- Media disimpan di `MEDIA_STORAGE_PATH` dan hanya dilayani setelah pemeriksaan tenant/session.
- Migrasi `001` sampai `006` harus diterapkan berurutan; runner mencatat versi yang sudah selesai.

## Struktur proyek

```text
apps/api                 Express BFF, ERP gateway, Baileys adapter, Socket.IO
apps/web                 React/Vite UI dan E2E Playwright
packages/contracts       Kontrak TypeScript lintas aplikasi
packages/database        Baseline skema MySQL produksi
.github/workflows        Build, lint, test, integration, E2E, dan audit CI
docs                     Catatan integrasi dan operasional
PRD.md                   Product requirements
AGENTS.md                Aturan implementasi proyek
```
