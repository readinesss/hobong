import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, type Page } from '@playwright/test';
import type { UserData } from '../../src/lib/store/schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const APP_URL = pathToFileURL(join(ROOT, 'dist', 'index.html')).href;

/** 테스트의 "지금": 2026-11-25(수) 10:30, 한국 시각 */
export const NOW = '2026-11-25T10:30:00+09:00';

export interface OpenOptions {
  time?: string;
  hash?: string;
  /** localStorage에 미리 넣어 둘 저장본(겉봉 JSON 문자열) */
  seed?: string;
}

/** 시계를 고정하고 앱을 연다 */
export async function openApp(page: Page, options: OpenOptions = {}): Promise<void> {
  await page.clock.install({ time: new Date(options.time ?? NOW) });
  await page.goto(`${APP_URL}${options.hash ? `#${options.hash}` : ''}`);
  if (options.seed !== undefined) {
    // 저장본은 페이지 스크립트로 넣고 다시 연다(사용자의 브라우저가 쓰는 것과 같은 길).
    // init 스크립트(addInitScript)로 file:// localStorage 에 넣은 값은 Chromium 에서
    // 새로 고침 뒤 사라질 때가 있다(빈 페이지로 재현: 15번 중 5번). 페이지 스크립트로 쓴 값은 그렇지 않다.
    await page.evaluate((value) => window.localStorage.setItem('hobong.data', value), options.seed);
    await page.reload();
  }
  await tick(page);
}

/** 고정한 시계를 앞으로 돌려 타이머(시계·토스트·연출)를 진행시킨다 */
export async function tick(page: Page, ms = 1200): Promise<void> {
  await page.clock.runFor(ms);
}

export interface SeedProfile {
  nickname?: string;
  birthDate?: string;
  hireDate?: string;
  grade?: number;
  gradeDate?: string;
  step?: number;
  nextStepDate?: string;
  stepAsOf?: string;
}

/** 현재 형식(v2)의 저장본을 만든다 */
export function makeSeed(profile: SeedProfile = {}, extra: Record<string, unknown> = {}): string {
  const p = {
    nickname: '김주무관',
    birthDate: '1996-04-12',
    hireDate: '2022-09-01',
    grade: 9,
    gradeDate: profile.hireDate ?? '2022-09-01',
    step: 5,
    nextStepDate: '2027-01-01',
    stepAsOf: '2026-11-24',
    ...profile,
  };
  const data = {
    profile: { ...p, overrides: { longServiceDate: null, seniorDate: null } },
    settings: {
      payday: 25,
      work: { start: '09:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
      theme: 'light',
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
    leave: { records: [], grantOverrideHours: {} },
    achievements: {},
    character: { seenForms: [], lastGrade: p.grade, lastStep: p.step },
    visits: { days: ['2026-11-24', '2026-11-25'], lastVisit: '2026-11-24' },
    meta: {
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
      lastBackupAt: null,
      changesSinceBackup: 0,
    },
    ...extra,
  };
  return JSON.stringify({
    app: 'hobong',
    schemaVersion: 3,
    appVersion: '0.1.0',
    exportedAt: '2026-11-24T00:00:00.000Z',
    data,
  });
}

export function fixture(name: string): string {
  return readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');
}

/** 저장된 사용자 데이터(겉봉 안의 data) */
export async function storedData(page: Page): Promise<UserData | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('hobong.data');
    return raw ? ((JSON.parse(raw) as { data: UserData }).data ?? null) : null;
  });
}

/** 세 칸 날짜 입력에 값을 넣는다(연도 칸에 8자리를 넣으면 한 번에 채워진다) */
export async function fillDate(page: Page, label: string, ymd: string): Promise<void> {
  await page.getByLabel(`${label} 연도`).fill(ymd.replaceAll('-', ''));
}

/** 처음 화면에서 내 정보를 넣고 대시보드까지 간다 */
export async function onboard(page: Page): Promise<void> {
  await page.getByRole('button', { name: '새로 시작' }).click();
  await page.getByLabel('닉네임').fill('김주무관');
  await fillDate(page, '생년월일', '1996-04-12');
  await fillDate(page, '임용일', '2024-03-04');
  await page.getByLabel('현재 직급').selectOption('9');
  await page.getByLabel('현재 호봉', { exact: true }).fill('3');
  await fillDate(page, '다음 승급일', '2027-03-01');
  await page.getByRole('button', { name: '알 깨우기' }).click();
  await tick(page, 6000);
  await page.getByRole('button', { name: '시작하기' }).click();
  await tick(page);
  await expect(page.getByRole('heading', { name: '상태창' })).toBeVisible();
}

/**
 * 복사 버튼을 누를 수 있게 한다. 클립보드 권한 부여는 Chromium 만 받으므로(Firefox·WebKit 은
 * 'Unknown permission' 오류), 다른 엔진에서는 쓰기가 늘 성공하는 클립보드로 바꿔 끼운다.
 * 앱의 '복사한 뒤' 동작을 보려는 것이지 브라우저 클립보드를 시험하려는 것이 아니다.
 */
export async function allowClipboard(page: Page, browserName: string): Promise<void> {
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    return;
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
    // 안전하지 않은 문맥으로 보는 엔진에서는 앱이 예전 방식(execCommand)으로 복사하므로 그쪽도 성공으로 둔다
    document.execCommand = () => true;
  });
}

/** 콘솔 오류·페이지 오류를 모은다 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}
