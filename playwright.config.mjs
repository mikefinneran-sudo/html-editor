export default {
  testDir: 'tests',
  testMatch: /.*\.spec\.mjs/,
  timeout: 30000,
  workers: 1,
  use: { browserName: 'chromium', headless: true, hasTouch: true, viewport: { width: 1400, height: 900 } },
};
