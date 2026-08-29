import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:9181',
    ...(process.env.CI ? {} : { channel: 'msedge' }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-edge', use: { ...devices['Desktop Edge'] } },
  ],
  webServer: [
    {
      command: 'npm --prefix ../api run start',
      url: 'http://localhost:9181/health',
      reuseExistingServer: false,
      timeout: 45_000,
      env: { ...process.env, API_PORT: '9181', TEST_FIXTURES: 'true', START_SERVER: 'true', NODE_ENV: 'test', WEB_DIST_PATH: '../web/dist' },
    },
  ],
});
