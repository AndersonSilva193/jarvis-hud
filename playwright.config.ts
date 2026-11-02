import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4200', channel: 'chrome', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm.cmd start -- --host 127.0.0.1 --port 4200', url: 'http://127.0.0.1:4200', reuseExistingServer: true, timeout: 60_000 },
});
