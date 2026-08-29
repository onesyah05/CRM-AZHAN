# AGENTS.md — Azhan CRM

Dokumen ini mengatur cara coding agent dan developer bekerja di dalam folder `crm_azhan`. Aturan berlaku untuk seluruh file dan subfolder di bawah direktori ini.

## 1. Misi

Bangun CRM WhatsApp multi-brand yang:

- menyatukan conversation, contact, lead, pipeline Kanban, dan aktivitas sales;
- menggunakan Baileys melalui adapter terisolasi;
- memakai ERP Azhan sebagai sumber kebenaran untuk auth, brand, jadwal, jamaah, dan booking;
- mengubah Deal menjadi booking ERP berjenis Book Seat, DP, atau Lunas secara idempotent;
- aman terhadap kebocoran lintas tenant, kehilangan pesan, dan duplikasi booking;
- mengikuti UX dan acceptance criteria dalam `PRD.md`.

## 2. Urutan Sumber Kebenaran

Sebelum mengubah kode, baca sumber berikut dalam urutan ini:

1. Instruksi sistem/developer/user yang aktif.
2. `AGENTS.md` ini.
3. `PRD.md` pada folder ini.
4. Kontrak aktual di `../erp-azhan/cmd/api/main.go` dan model/handler pada `../erp-azhan/internal`.
5. Screenshot referensi pada folder ini untuk memahami pola informasi, bukan untuk menyalin merek atau aset Pancake.
6. Dokumentasi resmi library/framework yang digunakan.

Jika PRD berbeda dengan perilaku API aktual, jangan mengarang endpoint atau payload. Verifikasi kode ERP, dokumentasikan perbedaan, lalu pilih salah satu:

- sesuaikan adapter CRM dengan API aktual; atau
- bila perubahan ERP memang diperlukan, buat perubahan eksplisit beserta migration, test, dan dokumentasinya.

Jangan mengubah `erp-azhan` atau aplikasi dashboard hanya karena nyaman. Perubahan lintas proyek harus benar-benar dibutuhkan oleh acceptance criteria.

## 3. Scope dan Boundary

### CRM memiliki

- WhatsApp session dan connection state.
- Contact CRM dan relasi ke jamaah ERP.
- Conversation dan message.
- Pipeline, stage, lead, tag, assignment, note, follow-up, dan activity.
- Deal conversion state, idempotency, retry, dan reconciliation.
- Dashboard/analytics CRM.

### ERP memiliki

- Admin authentication dan token.
- Brand/tenant.
- Jadwal/paket dan harga.
- Jamaah.
- Booking/order.
- Pembayaran, dokumen, inventory, dan operasional pasca-booking.

CRM tidak boleh menduplikasi seluruh model ERP. Simpan hanya external ID dan snapshot minimum yang diperlukan untuk UX, audit, atau recovery.

## 4. Arsitektur Target

Gunakan monorepo npm yang sederhana:

```text
crm_azhan/
├── apps/
│   ├── web/                 # React + Vite + TypeScript
│   ├── api/                 # Node.js + TypeScript HTTP/BFF API
│   └── worker/              # Baileys connection dan event processing
├── packages/
│   ├── contracts/           # Schema/type API dan event bersama
│   ├── database/            # Migration, query/repository, tenant helpers
│   ├── whatsapp/            # Baileys adapter dan auth store interface
│   └── ui/                  # Token dan reusable UI bila diperlukan
├── docs/                    # ADR, runbook, dan dokumentasi tambahan
├── PRD.md
└── AGENTS.md
```

Untuk MVP lokal, API dan worker boleh berjalan dalam satu process jika boundary modulnya tetap jelas. Production harus memungkinkan worker dipisah tanpa menulis ulang domain logic.

### Stack default

- Runtime production: Node.js LTS yang didukung dependency.
- Language: TypeScript strict untuk web, API, worker, dan shared package.
- Web: React, Vite, React Router, TanStack Query, Socket.IO client, Lucide.
- Styling: design tokens melalui CSS variables; Tailwind boleh digunakan secara konsisten dengan dashboard ERP.
- API: Express atau Fastify, dipilih sekali dan digunakan konsisten.
- Realtime: Socket.IO atau WebSocket dengan authorization per brand.
- Database: MySQL 8+ dengan migration SQL versioned.
- Validation: Zod atau validator schema tunggal pada boundary input/output.
- WhatsApp: `@whiskeysockets/baileys` di balik `WhatsAppGateway` interface.
- Testing: Vitest, React Testing Library, integration test database/API, dan Playwright untuk critical flow.

Jangan memperkenalkan framework kedua untuk fungsi yang sama. Jangan mengganti stack tanpa ADR yang menjelaskan kebutuhan dan dampaknya.

### Kebijakan versi Baileys

- Mulai dengan versi stabil/legacy yang sudah diuji; pada tanggal dokumen ini kandidat awal adalah `6.7.24`.
- Jangan memakai release candidate pada production tanpa compatibility suite dan persetujuan eksplisit.
- Pin exact version; jangan gunakan `latest`, wildcard, atau dependency dari fork acak.
- Semua import dan event Baileys harus berada di package/adapter WhatsApp.

## 5. Kontrak ERP yang Wajib Dipertahankan

Base URL berasal dari environment `ERP_API_BASE_URL`; jangan hardcode selain contoh dokumentasi.

Endpoint yang tersedia saat dokumen dibuat:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/admin/my-brand`
- `GET /api/admin/brands` untuk Super Admin
- `GET /api/admin/schedules`
- `GET /api/admin/jamaah`
- `GET /api/admin/jamaah/{id}`
- `POST /api/admin/jamaah`
- `PUT /api/admin/jamaah/{id}`
- `POST /api/admin/bookings`
- `GET /api/admin/bookings/{id}`
- `PUT /api/admin/bookings/{id}/status`
- `DELETE /api/admin/bookings/{id}/seat-block`
- `POST /api/admin/bookings/{booking_id}/payments`
- `PUT /api/admin/payments/{id}/status`

Payload booking aktual:

```ts
type CreateBookingRequest = {
  schedule_id: number;
  jamaah_id: number;
  room_type: 'Quad' | 'Triple' | 'Double';
  total_harga?: number;
};
```

Aturan integrasi:

- Panggilan ERP hanya melalui module `ErpGateway`; komponen UI tidak memanggil ERP langsung.
- Forward correlation ID pada setiap panggilan.
- Gunakan timeout dan klasifikasikan error menjadi validation, unauthorized, forbidden, conflict, unavailable, timeout, dan unknown.
- Jangan retry request create secara buta.
- Jangan mengubah data jamaah ERP yang sudah ada menggunakan field kosong dari lead.
- Jangan membuat status `dp` hanya dengan mengubah status booking dari CRM. DP harus memiliki record payment ERP.
- Endpoint untuk membuat seat block tanpa DP belum tersedia saat dokumen dibuat; implementasikan endpoint ERP eksplisit dan teruji sebelum mengaktifkan Book Seat.
- Response ERP wajib divalidasi sebelum digunakan.
- External ID disimpan sebagai integer/string sesuai kontrak aktual, bukan diasumsikan UUID.

## 6. Auth dan Tenant Isolation

Tenant isolation adalah blocker release, bukan enhancement.

- Validasi access token ERP di server atau melalui trusted ERP auth introspection/gateway.
- Browser production memakai secure HttpOnly session cookie. Jangan meletakkan refresh token pada localStorage.
- `brand_id` admin Travel diambil dari identitas terverifikasi.
- Super Admin memilih brand aktif; server harus memvalidasi bahwa pengguna adalah Super Admin dan brand tersebut ada.
- Jangan percaya `brand_id` dari body, query, atau localStorage tanpa otorisasi server.
- Setiap repository method untuk data tenant menerima `brandId` sebagai parameter wajib.
- Setiap query SELECT/UPDATE/DELETE menyertakan filter `brand_id`, termasuk query berdasarkan primary key.
- Foreign entity seperti stage, contact, lead, session, dan assignee harus diverifikasi berasal dari brand yang sama.
- Socket real-time hanya join room setelah auth dan brand context tervalidasi.
- Ketika brand diganti, leave room sebelumnya dan clear seluruh query cache/data UI brand lama.
- Tulis negative tests: pengguna brand A mencoba membaca dan mengubah ID milik brand B.

Pattern repository yang benar:

```ts
getLeadById(input: { brandId: number; leadId: number }): Promise<Lead | null>
```

Hindari method seperti `getLeadById(leadId)` untuk entity tenant.

## 7. Database dan Migration

- Semua tabel bisnis CRM memakai prefix `crm_` jika berada pada database ERP yang sama.
- Semua tabel tenant memiliki `brand_id BIGINT` dan indeks yang relevan.
- Gunakan foreign key jika lifecycle antartabel jelas.
- Gunakan UTC timestamp dan format database yang konsisten.
- Nomor telepon disimpan dalam bentuk raw terbatas untuk display dan bentuk normalized E.164 untuk matching.
- `wa_message_id` serta `erp_booking_id` memiliki unique constraint yang sesuai scope.
- `crm_deal_conversions.lead_id` harus mencegah lebih dari satu konversi sukses.
- Migration bersifat forward-only, versioned, dan aman dijalankan pada database kosong.
- Perubahan schema harus disertai migration dan test. Jangan melakukan schema mutation otomatis saat request runtime.
- Seed tahap default harus idempotent.
- Jangan menyimpan binary media besar di MySQL; gunakan object/file storage dan simpan metadata/reference.
- Jangan hard-delete message, activity, atau conversion tanpa kebutuhan retention yang disetujui.

## 8. Aturan Baileys dan WhatsApp

Baileys merupakan library tidak resmi. Gunakan secara bertanggung jawab dan jangan membangun fitur spam.

### Boundary wajib

Domain hanya mengenal interface seperti:

```ts
interface WhatsAppGateway {
  connect(sessionId: number): Promise<void>;
  disconnect(sessionId: number, logout?: boolean): Promise<void>;
  sendText(input: SendTextInput): Promise<SendResult>;
  sendMedia(input: SendMediaInput): Promise<SendResult>;
  getStatus(sessionId: number): ConnectionStatus;
}
```

Jangan membiarkan type Baileys menyebar ke route handler, React component, atau domain service.

### Session

- Satu brand memiliki maksimal satu sesi aktif pada MVP.
- Hanya satu worker boleh memiliki socket untuk sebuah sesi. Gunakan lock/lease bila worker lebih dari satu.
- Auth credentials dan Signal keys adalah secret setara private key.
- Jangan pernah commit auth folder, QR, creds, atau key material.
- `useMultiFileAuthState` hanya boleh digunakan untuk development lokal dan harus diarahkan ke folder yang di-ignore.
- Production memakai implementation `AuthenticationState` berbasis encrypted database/secret storage.
- Simpan creds dan Signal key updates sebelum operation dianggap selesai.
- Gunakan reconnect exponential backoff dengan jitter; jangan reconnect setelah explicit logout.
- QR memiliki TTL dan hanya dapat dibaca oleh admin pada brand terkait.

### Message processing

- Abaikan `status@broadcast` dan newsletter pada MVP.
- Grup diabaikan kecuali requirement berubah dan test ditambahkan.
- Gunakan message ID sebagai idempotency key inbound.
- Normalisasi berbagai wrapper message sebelum ekstraksi teks/media.
- Simpan raw payload hanya jika benar-benar dibutuhkan; encrypt/redact dan beri retention pendek.
- Jangan log isi pesan, nomor lengkap, QR, auth state, atau media URL bertanda tangan.
- Outbound message memiliki client-generated idempotency key.
- Status UI tidak boleh menjadi `sent` sebelum gateway mengonfirmasi penerimaan request.
- Media diunduh melalui queue dengan batas ukuran, timeout, dan validasi MIME.

## 9. Conversation dan Lead Rules

- Kontak unik berdasarkan `brand_id + normalized WhatsApp identity`.
- Pesan baru membuat conversation jika belum ada.
- Kontak tanpa lead aktif mendapat satu lead baru pada tahap default.
- Jangan membuat lead baru untuk setiap pesan.
- Unread count berubah secara atomik dan tidak boleh negatif.
- Assignment, tag, dan stage change menulis activity.
- Edit form tidak boleh menimpa perubahan paralel tanpa deteksi versi/`updated_at`.
- Lost wajib memiliki reason.
- Won/Deal hanya boleh ditetapkan melalui `DealConversionService`.
- Jangan menyediakan endpoint generik yang dapat mengubah stage langsung menjadi Deal dan melewati conversion flow.
- Lead Deal wajib memiliki `commitmentType` berupa `book_seat`, `dp`, atau `lunas` dan substatus yang berasal dari state ERP aktual.

## 10. Deal Conversion dan Idempotency

Ini adalah alur transaksi paling kritis.

### State machine

```text
draft -> processing -> completed
                    -> requires_retry -> processing
                    -> failed_permanent
```

### Aturan

- Buat `idempotency_key` di server dan kaitkan secara unik ke lead/conversion.
- Lock conversion/lead ketika proses berjalan.
- Jika conversion sudah `completed`, kembalikan hasil yang sama; jangan membuat booking baru.
- Simpan `commitment_type` sebelum side effect pertama: `book_seat`, `dp`, atau `lunas`.
- Jika `erp_jamaah_id` sudah ada, verifikasi akses sebelum digunakan.
- Pencocokan nomor yang ambigu harus dikonfirmasi pengguna; jangan auto-link.
- Setelah jamaah berhasil dibuat, segera persist `erp_jamaah_id` sebelum membuat booking.
- Setelah booking berhasil, segera persist response dan `erp_booking_id`.
- Untuk Book Seat, panggil endpoint seat-block idempotent, simpan expiry, lalu verifikasi `is_seat_blocked=true` sebelum menyelesaikan Deal.
- Untuk DP/Lunas, buat record payment dan simpan `erp_payment_id`. Status payment pending/confirmed/rejected harus terlihat sebagai substatus CRM.
- Jangan menganggap payment pending sebagai DP terkonfirmasi.
- Jangan mengubah booking menjadi `dp` tanpa payment hanya agar seat berkurang.
- Jalur konfirmasi payment ERP saat dokumen dibuat mengurangi seat dan mengubah status, tetapi belum konsisten mengatur `is_seat_blocked=true`; perbaiki dan uji invariannya sebelum integrasi DP dinyatakan selesai.
- Pindahkan lead ke Deal hanya setelah booking dan aksi komitmen yang dipilih berhasil dipersist.
- Timeout setelah request create menghasilkan status unknown/reconciliation, bukan retry langsung.
- Reconciliation mencoba menemukan hasil remote menggunakan ID yang tersimpan atau endpoint pencarian yang valid.
- Catat payload snapshot yang sudah direduksi dan error code, bukan token atau PII berlebihan.
- Aksi UI harus disabled saat request processing dan tetap aman jika pengguna double-click/refresh.

Book Seat memerlukan endpoint ERP `PUT /api/admin/bookings/{id}/seat-block` yang mengunci jadwal, mengurangi seat tepat satu kali, mengatur `is_seat_blocked=true`, dan menyimpan `seat_hold_expires_at`. Scheduled expiry harus melepas hold tepat satu kali jika booking belum DP/Lunas.

Preferred solution adalah endpoint ERP atomik `POST /api/admin/crm/deals` dengan `Idempotency-Key`. Sampai tersedia, orchestration endpoint jamaah, booking, seat-block, dan payment wajib mengikuti state machine di atas.

## 11. API CRM

Gunakan prefix `/api/v1`. Response error konsisten:

```json
{
  "error": {
    "code": "DEAL_BOOKING_FAILED",
    "message": "Booking belum berhasil dibuat. Data jamaah sudah tersimpan.",
    "correlation_id": "...",
    "retryable": true,
    "field_errors": []
  }
}
```

Aturan endpoint:

- Validasi request pada boundary.
- Gunakan status HTTP yang tepat.
- List memakai cursor pagination; jangan mengirim semua pesan tanpa batas.
- Search memiliki batas panjang dan rate limit.
- Mutation mengembalikan entity/result aktual setelah commit.
- Endpoint mutation penting menerima idempotency key atau version precondition.
- Jangan mengekspos raw database error, stack trace, token, atau payload Baileys.
- OpenAPI/schema contract diperbarui bersama perubahan endpoint.

## 12. UI/UX dan Design System

Ikuti `PRD.md` bagian Spesifikasi UI/UX.

### Prinsip implementasi

- Gunakan semantic HTML sebelum ARIA.
- Target WCAG 2.2 AA.
- Semua kontrol memiliki label dan visible focus.
- Ikon tanpa teks memiliki accessible name/tooltip.
- Drag-and-drop Kanban wajib memiliki alternatif menu/keyboard.
- Status tidak boleh dibedakan hanya berdasarkan warna.
- Target sentuh minimum 44×44 px pada mobile.
- Form mempertahankan input ketika save gagal.
- Modal mengelola focus trap dan mengembalikan fokus ke trigger.
- Unsaved changes memunculkan peringatan sebelum navigasi.
- Gunakan skeleton untuk loading struktur, bukan spinner penuh tanpa konteks.
- Empty state menjelaskan kondisi dan tindakan berikutnya.
- Error state menawarkan retry bila aman.
- Optimistic update harus rollback dengan pesan yang jelas saat gagal.

### Token

- Gunakan CSS variables semantic seperti `--color-brand`, `--color-success`, dan `--color-danger`.
- Primary color brand hanya accent, bukan status.
- Jangan hardcode warna brand berulang di komponen.
- Pastikan foreground otomatis tetap kontras jika primary color tenant terlalu terang.
- Gunakan spacing scale 4 px dan radius yang didefinisikan di token.
- Gunakan Lucide; jangan mencampur beberapa icon set.

### Responsive

- Desktop conversation memakai tiga panel.
- Mobile mengubah panel menjadi navigasi layar bertahap, bukan memampatkan tiga panel.
- Kanban boleh scroll horizontal dengan petunjuk visual dan header kolom sticky.
- Uji minimum pada 375 px, 768 px, 1024 px, dan 1440 px.

### Copy

- Gunakan Bahasa Indonesia yang ringkas dan operasional.
- Pakai “Percakapan”, “Pipeline”, “Calon jamaah”, “Proses Deal”, “Paket/Jadwal”, dan “Booking”.
- Gunakan label “Book Seat”, “DP Menunggu Verifikasi”, “DP Terkonfirmasi”, “Lunas”, dan “Book Seat Kedaluwarsa” secara konsisten.
- Hindari jargon teknis seperti JID, socket, atau idempotency pada UI pengguna.
- Destructive action menyebutkan objek dan akibatnya.

## 13. State Frontend

- Server state dikelola oleh TanStack Query atau satu solusi sejenis.
- UI state lokal tetap lokal; jangan masukkan seluruh form ke global store.
- Query key selalu memasukkan `brandId` bila data tenant.
- Brand switch membersihkan cache tenant.
- Event real-time memperbarui/invalidate cache secara terarah.
- Jangan menyimpan full message history di localStorage.
- Jangan menyimpan auth token sensitif pada URL.
- Pagination conversation/message mempertahankan scroll anchor.
- Composer draft boleh disimpan lokal per conversation, tanpa attachment sensitif.

## 14. Logging, Privacy, dan Security

### Dilarang dicatat

- Access token dan refresh token.
- QR WhatsApp.
- Baileys credentials dan Signal keys.
- Password.
- Isi pesan penuh.
- Nomor telepon penuh, NIK, paspor, dan data sensitif lain.
- Signed media URL.

Gunakan redaction terpusat dan structured logging. Identifier operasional boleh di-hash atau dimask. Setiap request memiliki correlation ID.

Tambahkan:

- Helmet/security headers.
- Strict CORS allowlist.
- CSRF protection bila memakai cookie lintas origin.
- Rate limit pada auth, send message, connect QR, upload, search, dan Deal.
- Input/output schema validation.
- MIME sniffing dan size limit untuk upload.
- Dependency audit dan secret scan pada CI.

## 15. Coding Standards

- TypeScript `strict: true`; hindari `any` dan non-null assertion tanpa alasan.
- Domain logic tidak berada di React component atau route handler.
- Gunakan dependency injection sederhana untuk gateway/repository agar mudah diuji.
- Fungsi kecil dengan nama domain yang jelas lebih disukai daripada utilitas generik besar.
- Jangan menelan error. Map error menjadi type/domain code yang eksplisit.
- Jangan membuat abstraction hanya untuk satu baris kecuali menjaga security/tenant boundary.
- Gunakan enum/union terpusat untuk stage system, connection status, message status, dan conversion status.
- Semua tanggal melewati time utility dan disimpan UTC.
- Semua nomor telepon melewati satu normalizer yang diuji.
- Komentar menjelaskan alasan/constraint, bukan mengulang kode.
- Jangan menyalin data dummy PII dari screenshot ke seed/test. Gunakan data sintetis.
- Jangan menambahkan fitur di luar PRD tanpa memperbarui PRD atau ADR.

## 16. Testing Requirements

### Unit

- Phone normalization.
- Message content extraction.
- Tenant scope helper.
- Lead creation rules.
- Stage transition rules.
- Deal conversion state machine.
- Book Seat expiry dan release idempotency.
- Mapping payment pending/confirmed/rejected ke substatus lead.
- ERP error mapping.
- Contrast/brand foreground helper.

### Integration

- Inbound event duplicate menghasilkan satu message.
- Contact/conversation/lead auto-creation atomik.
- Setiap repository menolak/mengosongkan data lintas brand.
- Assignment dan stage change menulis activity.
- Deal success menyimpan jamaah/booking ID dan stage Deal.
- Book Seat success mengurangi seat sekali, menyimpan expiry, dan tidak menciptakan payment palsu.
- Book Seat expiry mengembalikan seat sekali jika belum DP/Lunas.
- DP membuat payment ERP; payment confirmed memperbarui substatus dan seat block.
- Jamaah success + booking failure menghasilkan `requires_retry`.
- Retry tidak membuat jamaah atau booking kedua.
- Realtime room tidak menerima event brand lain.

### E2E critical path

1. Login admin Travel.
2. Melihat status WA atau scan QR pada environment test.
3. Pesan fixture masuk dan muncul di inbox.
4. Balas percakapan.
5. Lengkapi lead dan pindahkan tahap.
6. Pilih jadwal serta Book Seat/DP/Lunas, lalu proses Deal.
7. Verifikasi booking terbentuk pada ERP stub/test server.
8. Refresh dan pastikan tidak ada duplikasi.

### Accessibility

- Automated axe pada halaman utama.
- Keyboard-only untuk conversation, edit lead, Kanban alternative, dan Deal modal.
- Manual focus order, screen reader announcement penting, serta contrast.

Test tidak boleh menghubungi akun WhatsApp atau ERP production. Gunakan gateway fake/stub dan database test terisolasi.

## 17. Quality Gates

Sebelum menandai pekerjaan selesai, jalankan command yang tersedia di root. Package harus menyediakan minimal:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Untuk perubahan database/integrasi:

```bash
npm run test:integration
```

Untuk alur UI kritis:

```bash
npm run test:e2e
```

Jika command belum tersedia pada fase scaffolding, agent yang membuat scaffolding wajib menambahkannya. Jangan mengklaim test lulus jika dependency eksternal tidak berjalan; laporkan tepat apa yang dijalankan dan apa yang tidak.

## 18. Environment dan Secret

Sediakan `.env.example` tanpa secret nyata. Nama environment yang disarankan:

```dotenv
NODE_ENV=development
WEB_PORT=5180
API_PORT=9180
ERP_API_BASE_URL=http://localhost:9090
DATABASE_URL=mysql://user:password@127.0.0.1:3306/azhan_crm
SESSION_SECRET=replace-with-long-random-secret
AUTH_ENCRYPTION_KEY=replace-with-32-byte-key
CORS_ORIGINS=http://localhost:5180
WA_AUTH_DRIVER=filesystem
WA_AUTH_PATH=.data/wa-auth
MEDIA_STORAGE_PATH=.data/media
```

- `.env`, `.data`, auth state, upload/media, log, coverage, dan build output harus masuk `.gitignore`.
- Jangan membaca secret ke output terminal/log kecuali nama variabel tanpa nilainya.
- Production memakai secret manager dan `WA_AUTH_DRIVER=database` atau adapter aman setara.

## 19. Dokumentasi yang Wajib Dijaga

- `README.md`: setup lokal, command, port, dependency, dan troubleshooting.
- `PRD.md`: requirement dan acceptance criteria.
- `docs/architecture.md`: component diagram, deployment, data flow.
- `docs/erp-integration.md`: endpoint, payload, mapping error, deep link.
- `docs/whatsapp-runbook.md`: connect, reconnect, logout, credential recovery.
- `docs/deal-recovery.md`: state conversion dan prosedur partial failure.
- OpenAPI/schema API CRM.
- Migration notes untuk setiap perubahan schema material.

Dokumentasi diperbarui dalam perubahan yang sama dengan behavior terkait.

## 20. Larangan

- Jangan membuat blast/bulk unsolicited messaging.
- Jangan mengotomatiskan pengiriman tanpa consent dan guardrail.
- Jangan menggunakan WhatsApp credential asli dalam test.
- Jangan commit QR/auth state/token/password.
- Jangan bypass tenant filter untuk mempermudah query.
- Jangan membuat booking saat sekadar drag kartu ke Deal tanpa konfirmasi.
- Jangan menyamakan Book Seat dengan DP.
- Jangan menandai DP terkonfirmasi jika payment masih pending/rejected atau tidak ada.
- Jangan membuat seat hold tanpa expiry dan mekanisme release idempotent.
- Jangan retry create booking secara buta setelah timeout.
- Jangan menandai lead Deal sebelum ERP booking berhasil.
- Jangan memanggil database ERP langsung dari UI.
- Jangan mengubah migration lama yang sudah pernah diterapkan; tambah migration baru.
- Jangan menyalin logo, nama, atau aset proprietary dari screenshot Pancake.
- Jangan menyembunyikan error penting hanya dengan toast yang hilang cepat.

## 21. Workflow Agent

Untuk setiap task:

1. Baca bagian PRD dan kontrak ERP yang terkait.
2. Periksa working tree dan pertahankan perubahan pengguna yang tidak terkait.
3. Tuliskan acceptance criteria kecil untuk task.
4. Implementasikan perubahan paling sempit yang memenuhi requirement.
5. Tambahkan/ubah test bersamaan dengan kode.
6. Jalankan quality gates yang relevan.
7. Review tenant isolation, idempotency, privacy, accessibility, serta error/empty/loading state.
8. Perbarui dokumentasi bila kontrak atau behavior berubah.
9. Laporkan file yang berubah, hasil validasi, asumsi, dan risiko tersisa.

Jika task menyentuh Deal, Baileys auth, tenant isolation, atau migration produksi, perlakukan sebagai high-risk dan lakukan review tambahan sebelum selesai.

## 22. Definition of Done untuk Perubahan Kode

Sebuah perubahan selesai hanya jika:

- requirement dan acceptance criteria terkait terpenuhi;
- lint, typecheck, test, dan build yang relevan lulus;
- tenant scope diuji bila menyentuh data;
- error, loading, empty, dan retry state ditangani;
- keyboard dan accessible label diuji untuk perubahan UI;
- tidak ada secret/PII baru dalam kode, fixture, log, atau snapshot;
- migration dan rollback/recovery note tersedia bila schema berubah;
- dokumentasi dan `.env.example` diperbarui bila perlu;
- tidak ada endpoint/payload ERP fiktif;
- hasil akhir dijelaskan secara jujur, termasuk validasi yang belum dapat dijalankan.
