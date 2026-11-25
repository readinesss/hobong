import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * 브라우저 검증. 빌드한 단일 HTML(dist/index.html)을 file:// 로 직접 연다.
 * 업무망에서 쓰는 방식 그대로이며, 서버 없이도 모든 기능이 동작해야 한다.
 *
 *   npm run build && npm run test:e2e
 *
 * 기본은 Chromium만 돈다. 다른 엔진은 E2E_BROWSERS 로 고른다(CI에서 사용).
 *   E2E_BROWSERS=firefox npm run test:e2e
 *   E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e
 */
const engines = new Set(
  (process.env.E2E_BROWSERS ?? 'chromium')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

const wide = { width: 1280, height: 900 };
// 계산·저장 로직은 화면 폭과 무관하므로 모바일에서는 화면·조작 검증만 돈다.
const mobileOnly = /(responsive|onboarding|leave)\.spec\.ts/;

const projects: Project[] = [];
if (engines.has('chromium')) {
  projects.push(
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: wide } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 760 } },
      testMatch: mobileOnly,
    },
  );
}
if (engines.has('firefox')) {
  projects.push({ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: wide } });
}
if (engines.has('webkit')) {
  projects.push(
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: wide } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] }, testMatch: mobileOnly },
  );
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects,
});
