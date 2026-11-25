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
  if (options.seed !== undefined) {
    await page.addInitScript((value) => {
      // 새로 고침해도 테스트가 바꾼 내용이 남도록, 비어 있을 때만 넣는다.
      if (window.localStorage.getItem('hobong.data') === null && !window.sessionStorage.getItem('seeded')) {
        window.localStorage.setItem('hobong.data', value);
        window.sessionStorage.setItem('seeded', '1');
      }
    }, options.seed);
  }
  await page.goto(`${APP_URL}${options.hash ? `#${options.hash}` : ''}`);
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
      card: { ratio: 'square', showSalary: false, showRetirement: false, showTenure: true, showBadges: true },
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
  return JSON.stringify({ app: 'hobong', schemaVersion: 2, appVersion: '0.1.0', exportedAt: '2026-11-24T00:00:00.000Z', data });
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

/** 콘솔 오류·페이지 오류를 모은다 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}
