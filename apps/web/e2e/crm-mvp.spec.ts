import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  const api = page.context().request;
  const response = await api.post('http://localhost:9181/api/v1/test/reset');
  expect(response.status()).toBe(204);
  const login = await api.post('http://localhost:9181/api/v1/auth/test');
  expect(login.status()).toBe(200);
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
});

test('dashboard dan inbox fixture dapat digunakan', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await expect(page.getByRole('heading', { name: /Selamat (pagi|siang|sore|malam)/i })).toBeVisible();
  await expect(page.getByText(/WA terhubung/i).first()).toBeVisible();
  const period = page.getByLabel('Periode dashboard');
  await period.selectOption('week');
  await expect(period).toHaveValue('week');

  await page.getByRole('link', { name: /Percakapan/ }).click();
  await expect(page.getByRole('heading', { name: 'Percakapan', exact: true })).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Pesan WhatsApp' });
  await composer.fill('Insyaallah seat masih tersedia, Kak Nadia.');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await expect(page.getByRole('paragraph').filter({ hasText: 'Insyaallah seat masih tersedia, Kak Nadia.' })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('kontak, filter inbox, dan aktivitas dapat digunakan', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Impor kontak' }).click();
  await page.getByLabel('Daftar kontak').fill('Jamaah Baru|081234560099');
  await page.getByRole('button', { name: 'Impor kontak', exact: true }).last().click();
  await expect(page.getByText('1 kontak diproses')).toBeVisible();
  await page.getByRole('button', { name: 'Selesai' }).click();
  await page.getByPlaceholder('Cari nama atau nomor…').fill('Jamaah Baru');
  await expect(page.getByText('Jamaah Baru', { exact: true })).toBeVisible();
  await expect(page.getByText('Kontak tersimpan')).toBeVisible();

  await page.getByPlaceholder('Cari nama atau nomor…').fill('Nadia');
  await expect(page.getByText('Nadia Rahma', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Buka percakapan Nadia Rahma' }).click();
  await expect(page.getByRole('heading', { name: 'Percakapan', exact: true })).toBeVisible();
  await expect(page.getByText('Nadia Rahma').first()).toBeVisible();

  await page.getByRole('button', { name: 'Filter percakapan' }).click();
  await page.getByRole('checkbox', { name: 'Belum dibaca' }).check();
  await expect(page.getByText(/belum dibaca/).first()).toBeVisible();

  await page.goto('/activities');
  await expect(page.getByRole('heading', { name: 'Aktivitas' })).toBeVisible();
  await expect(page.getByText(/aktivitas$/).first()).toBeVisible();
});

test('lead dapat diedit lalu diproses menjadi Book Seat', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Gerakkan lead sampai booking.' })).toBeVisible();

  await page.getByRole('button', { name: /Nadia Rahma/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Detail lead' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit data' }).click();
  const notes = page.getByLabel('Catatan');
  await notes.fill('Siap Book Seat setelah konfirmasi jadwal keluarga.');
  await page.getByRole('button', { name: /Simpan perubahan/ }).click();
  await expect(notes).toBeDisabled();

  await page.getByRole('button', { name: 'Proses Deal' }).click();
  await expect(page.getByRole('dialog', { name: 'Proses Deal' })).toBeVisible();
  await page.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect(page.getByText('Jenis komitmen', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Book Seat/ }).check();
  await page.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect(page.getByText('Periksa sebelum memproses')).toBeVisible();
  await page.getByRole('button', { name: 'Buat booking & Deal' }).click();
  await expect(page.getByRole('heading', { name: 'Deal berhasil diproses' })).toBeVisible();
  await expect(page.getByText(/^#\d+$/)).toBeVisible();
  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(page.getByText('Nadia Rahma').first()).toBeVisible();
});

test('admin dapat mengatur distribusi dan melihat leaderboard CS', async ({ page }) => {
  await page.getByRole('link', { name: /Tim CS/ }).click();
  await expect(page.getByRole('heading', { name: 'Tim CS dan distribusi lead' })).toBeVisible();
  await expect(page.getByText('100% / 100%')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Leaderboard performa CS' })).toBeVisible();

  await page.getByRole('spinbutton', { name: 'Persentase Aulia %' }).fill('45');
  await page.getByRole('spinbutton', { name: 'Persentase Fikri %' }).fill('25');
  await page.getByRole('button', { name: 'Simpan pembagian' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Persentase Aulia %' })).toHaveValue('45');
  await expect(page.getByRole('spinbutton', { name: 'Persentase Fikri %' })).toHaveValue('25');
});

test('alur utama mobile tidak memiliki pelanggaran aksesibilitas blocker atau critical', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: /Selamat (pagi|siang|sore|malam)/i })).toBeVisible();
  const dashboardAudit = await new AxeBuilder({ page }).include('main').analyze();
  expect(dashboardAudit.violations.filter((violation) => ['critical', 'blocker'].includes(violation.impact ?? ''))).toEqual([]);
  const dashboardOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(dashboardOverflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Buka navigasi' }).click();
  await page.getByRole('link', { name: /Percakapan/ }).click();
  await expect(page.getByRole('textbox', { name: 'Pesan WhatsApp' })).toBeVisible();
  const inboxAudit = await new AxeBuilder({ page }).include('main').analyze();
  expect(inboxAudit.violations.filter((violation) => ['critical', 'blocker'].includes(violation.impact ?? ''))).toEqual([]);
  const inboxOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(inboxOverflow).toBeLessThanOrEqual(1);
});

test('layout utama tetap rapi pada breakpoint target', async ({ page }) => {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);

    for (const path of ['/', '/conversations', '/pipeline', '/team']) {
      await page.goto(path);
      await page.locator('main').waitFor();
      const horizontalPageScroll = await page.evaluate(() => {
        window.scrollTo({ left: 10_000 });
        const currentScroll = window.scrollX;
        window.scrollTo({ left: 0 });
        return currentScroll;
      });
      expect(horizontalPageScroll, `${path} dapat menggeser halaman pada lebar ${viewport.width}px`).toBeLessThanOrEqual(1);
    }
  }
});
