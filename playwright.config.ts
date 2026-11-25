import { defineConfig, devices } from '@playwright/test';

/**
 * 브라우저 검증. 빌드한 단일 HTML(dist/index.html)을 file:// 로 직접 연다.
 * 업무망에서 쓰는 방식 그대로이며, 서버 없이도 모든 기능이 동작해야 한다.
 *
 *   npm run build && npm run test:e2e
 */
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
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 760 } },
      // 계산·저장 로직은 화면 폭과 무관하므로 모바일에서는 화면·조작 검증만 돈다.
      testMatch: /(responsive|onboarding|leave)\.spec\.ts/,
    },
  ],
});
