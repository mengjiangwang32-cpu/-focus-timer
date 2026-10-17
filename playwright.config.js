import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/desktop', timeout: 45000, expect: { timeout: 8000 },
  fullyParallel: false, workers: 1, reporter: [['list']],
  use: { trace: 'retain-on-failure' }
});
