# Azhan CRM UI Design System

## Arah desain

CRM memakai bahasa visual yang sama dengan Dashboard ERP: workspace operasional yang bersih, tenang, dan padat informasi tanpa terasa sesak. Warna utama mengikuti brand aktif dan hanya dipakai sebagai accent, fokus, serta aksi utama. Warna success, warning, dan danger tetap semantik dan tidak mengikuti warna brand.

## Fondasi

- Canvas menggunakan abu-abu biru sangat muda; surface utama tetap putih.
- Spacing mengikuti kelipatan 4 px dengan page gutter responsif 16–36 px.
- Radius: 8 px untuk kontrol kecil, 10–14 px untuk input/button, dan 18 px untuk panel utama.
- Shadow dibatasi pada tiga tingkat: card, floating panel, dan dialog.
- Heading memakai tracking rapat untuk hierarki; body menggunakan ukuran minimum yang tetap terbaca pada dashboard padat.
- Tipografi memakai DM Sans yang dipaketkan lokal dengan `font-family: DM Sans, sans-serif` dan `font-style: normal`.
- Semua warna tenant menggunakan `--color-brand` dan `--color-brand-foreground` agar kontras teks tetap aman.

## Komponen dan pola

- `AppShell`: sidebar desktop 252 px, topbar sticky, pencarian global dengan `Ctrl+K`, drawer navigasi pada tablet/mobile.
- `PageHeader`: satu judul utama, deskripsi operasional, dan aksi primer maksimal satu grup.
- `Panel`: surface standar untuk tabel, konfigurasi, analytics, dan form.
- Form control memiliki tinggi minimum 44 px, focus ring terlihat, serta error yang menetap di dekat konteksnya.
- Loading menggunakan indikator dan skeleton; empty/error state menjelaskan kondisi serta tindakan berikutnya.
- Tabel memakai header kontras rendah, row hover, numeric alignment konsisten, dan horizontal scroll pada layar kecil.
- Pipeline mempertahankan horizontal Kanban dengan card berhierarki: identitas, paket, nilai, tag, usia, lalu aksi alternatif keyboard.
- Inbox memakai tiga panel pada desktop dan progressive screen navigation pada mobile.

## Responsive

- Di atas 1280 px: seluruh konteks desktop, termasuk profil lead inbox.
- 901–1280 px: profil inbox disembunyikan dan metrics menyesuaikan grid.
- 641–900 px: sidebar menjadi drawer dan layout utama satu kolom.
- Maksimal 640 px: gutter 16 px, control/action full-width bila diperlukan, tabel dan Kanban dapat digeser horizontal.

## Aksesibilitas

- Target WCAG 2.2 AA dan ukuran target sentuh minimum 44 px pada kontrol utama.
- Semua icon-only button wajib memiliki accessible name.
- Status tidak disampaikan dengan warna saja; selalu disertai teks.
- Keyboard focus menggunakan ring dari warna brand dengan kontras yang tetap terlihat.
- Animasi dinonaktifkan melalui `prefers-reduced-motion`.
- Mobile navigation, dialog, alternative stage selector, dan composer dapat dipakai dengan keyboard.

## Validasi

Perubahan visual harus melewati typecheck, lint, build, Playwright critical flow, axe blocker/critical audit, serta pemeriksaan overflow pada viewport minimum 375 px. Visual QA minimum dilakukan pada login, dashboard, inbox, pipeline, kontak, aktivitas, Tim CS, dan pengaturan WhatsApp.
