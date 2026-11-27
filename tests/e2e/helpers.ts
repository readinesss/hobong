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
  /**
   * 연 뒤 시계를 돌릴 시간(ms). 기본 1200(토스트·첫 계산이 자리 잡게).
   * 열자마자 시작하는 연출의 첫 장면을 보려면 짧게 준다.
   */
  settle?: number;
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
  await tick(page, options.settle);
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

/**
 * v3 형식의 저장본을 만든다. 앱이 열 때 v4 로 바꾸므로(직종·봉급표·계급 키) 예전 사용자의 회귀 경로를
 * 함께 지난다(#20 설계서 §8.2). 넣는 값은 v3 이름(grade·gradeDate)을 쓰고, 저장된 값을 읽어 비교할 때는
 * v4 이름(rank·rankDate)을 쓴다.
 */
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

/** 임용정보 패키지를 여는 버튼: 첫 화면은 '패키지로 이어하기', 설정은 '패키지 불러오기' */
export const PACKAGE_OPEN = /^패키지(로 이어하기| 불러오기)$/;

/**
 * 첫 화면에서 '새로 시작' → '한 번에 쓰기'(한 화면 폼)로 간다.
 * 처음에는 말을 거는 방식이 열리므로 '한 번에 쓰기'를 누르고, 한 번 고른 뒤에는(이 기기에 기억) 폼이 바로 열린다.
 */
export async function startForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: '새로 시작' }).click();
  const form = page.getByRole('heading', { level: 1, name: '내 정보 넣기' });
  if (!(await form.isVisible())) await page.getByRole('button', { name: '한 번에 쓰기' }).click();
  await expect(form).toBeVisible();
}

/**
 * '알 깨우기'를 누르고 제자리 부화 연출을 건너뛰어 홈까지 간다.
 * 홈 창들의 차례 등장과 임용정보 패키지 안내, 미뤄 둔 새 배지 알림이 다 나올 때까지 시계를 돌린다.
 */
export async function wakeEgg(page: Page): Promise<void> {
  await page.getByRole('button', { name: '알 깨우기' }).click();
  await page.getByRole('button', { name: '건너뛰기' }).click();
  await page.getByRole('button', { name: '바로 시작하기' }).click();
  // 차례 등장(약 1.4초) → 패키지 안내 → 새 배지 알림(등장 끝 + 1.5초)까지
  await tick(page, 3500);
}

/** 처음 화면에서 내 정보를 넣고 대시보드까지 간다(한 번에 쓰기 → 알 깨우기 → 건너뛰기) */
export async function onboard(page: Page): Promise<void> {
  await startForm(page);
  await page.getByLabel('닉네임').fill('김주무관');
  await fillDate(page, '생년월일', '1996-04-12');
  await fillDate(page, '임용일', '2024-03-04');
  await page.getByLabel('현재 직급').selectOption('9');
  await page.getByLabel('현재 호봉', { exact: true }).fill('3');
  await fillDate(page, '다음 승급일', '2027-03-01');
  await wakeEgg(page);
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

export interface SeedProfileV4 extends Omit<SeedProfile, 'grade' | 'gradeDate'> {
  track?: string;
  payTable?: string | null;
  rank?: string | null;
  rankDate?: string;
}

/** 지금 형식(v4)의 저장본을 만든다. makeSeed 의 v3 저장본을 앱이 바꾼 결과와 같은 모양이다 */
export function makeSeedV4(
  profile: SeedProfileV4 = {},
  extra: Record<string, unknown> = {},
): string {
  const p = {
    nickname: '김주무관',
    birthDate: '1996-04-12',
    hireDate: '2022-09-01',
    track: 'general',
    payTable: 'table3',
    rank: '9',
    rankDate: profile.hireDate ?? '2022-09-01',
    step: 5,
    nextStepDate: '2027-01-01',
    stepAsOf: '2026-11-24',
    ...profile,
  };
  const v3 = JSON.parse(makeSeed()) as {
    data: Record<string, unknown> & {
      settings: Record<string, unknown> & { card: Record<string, unknown> };
    };
  };
  const data = {
    ...v3.data,
    profile: { ...p, overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null } },
    settings: { ...v3.data.settings, card: { ...v3.data.settings.card, showRank: true } },
    character: { seenForms: [], lastRank: p.rank, lastStep: p.step, lastForm: null },
    ...extra,
  };
  return JSON.stringify({
    app: 'hobong',
    schemaVersion: 4,
    appVersion: '0.1.0',
    exportedAt: '2026-11-24T00:00:00.000Z',
    data,
  });
}

export interface FillProfile {
  /** 직종 칩의 글자('경찰'·'교원'·'해양경찰 (일부 준비 중)') */
  track?: string;
  /** 일반직 봉급표 칩의 글자('공안업무 등(별표 4)') */
  payTable?: string;
  /** 계급 select 의 값('경정'·'7') */
  rank?: string;
  /** 계급 칸 이름('현재 계급'·'현재 직급'·'현재 직무등급') */
  rankLabel?: string;
  rankDate?: string;
  birthDate?: string;
  hireDate?: string;
  step?: number;
  nextStepDate?: string;
}

/**
 * 첫 화면에서 직종 → (일반직이면) 봉급표 → 계급 순서로 내 정보를 넣고 대시보드까지 간다(#20 §7.1).
 * 계급 칸이 없는 직종(교원·준비 중)은 rank 를 비워 둔다.
 */
export async function onboardTrack(page: Page, p: FillProfile): Promise<void> {
  await startForm(page);
  await page.getByLabel('닉네임').fill('호봉이집사');
  await fillDate(page, '생년월일', p.birthDate ?? '1975-03-10');
  await fillDate(page, '임용일', p.hireDate ?? '2005-03-02');
  if (p.track) await page.getByRole('radio', { name: p.track, exact: true }).click();
  if (p.payTable) await page.getByRole('radio', { name: p.payTable, exact: true }).click();
  if (p.rank) await page.getByLabel(p.rankLabel ?? '현재 계급').selectOption(p.rank);
  if (p.rankDate) {
    await page.getByRole('checkbox', { name: '임용 후 승진한 적이 있어요' }).check();
    const noun = (p.rankLabel ?? '현재 계급').replace('현재 ', '');
    await fillDate(page, `현 ${noun} 임용일(승진일)`, p.rankDate);
  }
  await page.getByLabel('현재 호봉', { exact: true }).fill(String(p.step ?? 10));
  await fillDate(page, '다음 승급일', p.nextStepDate ?? '2027-03-01');
  await wakeEgg(page);
  await expect(page.getByRole('heading', { name: '상태창' })).toBeVisible();
}

/** 열 때 뜨는 연출·복귀 정산 대화상자를 닫는다 */
export async function closeDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i += 1) {
    await page.getByRole('dialog').getByRole('button').last().click();
    await tick(page);
  }
}

export interface SeedV5 {
  series?: string | null;
  look?: Record<string, unknown>;
  showSeriesHome?: boolean;
  showSeries?: boolean;
  theme?: string;
}

/** 지금 형식(v5)의 저장본. makeSeedV4 에 v5 칸(직렬·공개 설정·꾸미기 등)을 기본값으로 더한다 */
export function makeSeedV5(profile: SeedProfileV4 = {}, v5: SeedV5 = {}): string {
  const env = JSON.parse(makeSeedV4(profile)) as {
    schemaVersion: number;
    data: {
      profile: Record<string, unknown>;
      settings: Record<string, unknown> & { card: Record<string, unknown> };
      character: Record<string, unknown>;
    };
  };
  env.schemaVersion = 5;
  const { data } = env;
  data.profile.series = v5.series ?? null;
  data.settings.card = { ...data.settings.card, showSeries: v5.showSeries ?? false };
  data.settings.identity = { showSeriesHome: v5.showSeriesHome ?? true };
  data.settings.haptics = true;
  data.settings.sound = {
    sfx: false,
    bgm: false,
    master: 80,
    sfxVolume: 80,
    bgmVolume: 50,
    bgmTrack: 'auto',
  };
  data.settings.pointer = 'pixel';
  data.settings.sparkles = true;
  if (v5.theme) data.settings.theme = v5.theme;
  data.character.look = {
    body: 'sunny',
    crest: 'red',
    plume: 'auto',
    deco: { pin: null, chest: null, cheek: false },
    prop: 'auto',
    ...v5.look,
  };
  return JSON.stringify(env);
}
