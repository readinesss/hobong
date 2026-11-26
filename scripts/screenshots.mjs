// README에 넣는 화면 캡처를 다시 만든다(docs/screenshots/).
// 빌드한 단일 HTML을 file:// 로 열고, 시계와 예시 데이터를 고정해 늘 같은 그림이 나오게 한다.
//
//   npm run build && npm run screenshots
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = pathToFileURL(join(ROOT, 'dist', 'index.html')).href;
const OUT = join(ROOT, 'docs', 'screenshots');
// 목요일 오전: 근무 중인 평범한 날
const NOW = '2026-11-26T10:30:00+09:00';

/** 예시 사용자(실제 인물이 아니다) */
function seed(profile, { theme = 'light' } = {}) {
  const data = {
    profile: { ...profile, overrides: { longServiceDate: null, seniorDate: null } },
    settings: {
      payday: 25,
      work: { start: '09:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
      theme,
      reduceMotion: true,
      hideAmounts: false,
      tabTitle: 'default',
      card: {
        ratio: 'square',
        showSalary: false,
        showRetirement: false,
        showTenure: true,
        showBadges: true,
      },
    },
    leave: {
      records: [
        { id: 'a1', date: '2026-01-02', hours: 8, kind: 'day', memo: '새해 연휴' },
        { id: 'a2', date: '2026-03-13', hours: 4, kind: 'pm', memo: '' },
        { id: 'a3', date: '2026-05-04', hours: 8, kind: 'day', memo: '징검다리' },
        { id: 'a4', date: '2026-08-10', hours: 8, kind: 'day', memo: '여름휴가' },
        { id: 'a5', date: '2026-08-11', hours: 8, kind: 'day', memo: '여름휴가' },
        { id: 'a6', date: '2026-08-12', hours: 8, kind: 'day', memo: '여름휴가' },
        { id: 'a7', date: '2026-10-08', hours: 2, kind: 'hours', memo: '은행 업무' },
        { id: 'a8', date: '2026-12-24', hours: 8, kind: 'day', memo: '' },
      ],
      grantOverrideHours: {},
    },
    achievements: {},
    character: { seenForms: [], lastGrade: profile.grade, lastStep: profile.step },
    visits: {
      days: ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25'],
      lastVisit: '2026-11-25',
    },
    meta: {
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-25T00:00:00.000Z',
      lastBackupAt: '2026-11-25T00:00:00.000Z',
      changesSinceBackup: 0,
    },
  };
  return JSON.stringify({
    app: 'hobong',
    schemaVersion: 3,
    appVersion: '0.1.0',
    exportedAt: '2026-11-25T00:00:00.000Z',
    data,
  });
}

const NINE = {
  nickname: '호봉이집사',
  birthDate: '1996-04-12',
  hireDate: '2022-09-01',
  grade: 9,
  gradeDate: '2022-09-01',
  step: 5,
  nextStepDate: '2027-01-01',
  stepAsOf: '2026-11-25',
};
const SEVEN = {
  nickname: '점심산책',
  birthDate: '1988-11-25',
  hireDate: '2013-07-01',
  grade: 7,
  gradeDate: '2019-01-01',
  step: 14,
  nextStepDate: '2027-07-01',
  stepAsOf: '2026-11-25',
};

const SHOTS = [
  { name: 'home-mobile', width: 390, height: 844, mobile: true, hash: 'home', profile: NINE },
  { name: 'leave-mobile', width: 390, height: 844, mobile: true, hash: 'leave', profile: NINE },
  { name: 'card-mobile', width: 390, height: 844, mobile: true, hash: 'card', profile: SEVEN },
  {
    name: 'home-dark',
    width: 390,
    height: 844,
    mobile: true,
    hash: 'home',
    profile: SEVEN,
    theme: 'dark',
  },
  { name: 'home-desktop', width: 1280, height: 800, mobile: false, hash: 'home', profile: SEVEN },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      // 모바일은 2배로 찍어 README에서 줄여 보여도 도트가 뭉개지지 않게 한다.
      deviceScaleFactor: shot.mobile ? 2 : 1,
      isMobile: shot.mobile,
      hasTouch: shot.mobile,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(NOW) });
    await page.addInitScript(
      (value) => window.localStorage.setItem('hobong.data', value),
      seed(shot.profile, { theme: shot.theme }),
    );
    await page.goto(`${APP_URL}#${shot.hash}`);
    await page.clock.runFor(1500);
    // 처음 받은 배지 알림은 닫고 찍는다
    const close = page.getByRole('button', { name: '알림 닫기' });
    while ((await close.count()) > 0) {
      await close.first().click();
      await page.clock.runFor(400);
    }
    await page.clock.runFor(1500);
    const file = join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`저장: docs/screenshots/${shot.name}.png`);
    await context.close();
  }
} finally {
  await browser.close();
}
