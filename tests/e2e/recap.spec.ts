import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { makeSeed, openApp, tick } from './helpers.ts';

/** PNG 머리에서 가로·세로를 읽는다 */
function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function savePng(page: Page): Promise<{ name: string; buffer: Buffer }> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PNG로 저장' }).click(),
  ]);
  return { name: file.suggestedFilename(), buffer: readFileSync(await file.path()) };
}

/** 연가 기록(하루·오전 반일·예정) 과 11월의 출근 도장을 넣은 저장본 */
function recapSeed(settings: Record<string, unknown> = {}): string {
  const base = JSON.parse(makeSeed()) as { data: Record<string, unknown> };
  const data = base.data as {
    settings: Record<string, unknown>;
    leave: { records: unknown[] };
    visits: { days: string[]; lastVisit: string };
  };
  data.settings = { ...data.settings, ...settings };
  data.leave.records = [
    { id: 'a', date: '2026-03-03', kind: 'day', hours: 8, memo: '' },
    { id: 'b', date: '2026-11-20', kind: 'am', hours: 4, memo: '' },
    { id: 'c', date: '2026-12-01', kind: 'day', hours: 8, memo: '' },
  ];
  data.visits = {
    days: ['2026-11-02', '2026-11-03', '2026-11-24', '2026-11-25'],
    lastVisit: '2026-11-24',
  };
  return JSON.stringify(base);
}

const tabs = (page: Page) => page.getByRole('navigation', { name: '화면 이동' });

test.describe('올해 결산과 1년 달력', () => {
  test('업적 탭의 출근 도장 창이 1년 달력이 되고, 달마다 글로 볼 수 있다', async ({ page }) => {
    await openApp(page, { seed: recapSeed(), hash: 'badges' });
    const win = page.locator('#visits');
    await expect(win.getByRole('heading', { name: '출근 도장' })).toBeVisible();
    await expect(win.locator('.aside')).toHaveText('2026년 · 도장 4개');
    const grid = win.getByRole('img');
    await expect(grid).toHaveAttribute('aria-label', /^2026년 달력\. 들른 날 4일, /);
    await expect(grid).toHaveAttribute('aria-label', /연가 1일 4시간\(예정 1일 따로\)/);
    await expect(grid).toHaveAttribute('aria-label', /1월 1일 승급/);
    await expect(grid).toHaveAttribute('aria-label', /오늘 11월 25일/);
    // 한 해 365칸(2026년), 칸마다 날짜 이름
    await expect(grid.locator('i')).toHaveCount(365);
    await expect(grid.locator('i.today')).toHaveAttribute(
      'title',
      /2026\. 11\. 25\. \(수\).*들른 날.*오늘/,
    );
    await expect(grid.locator('i.am')).toHaveAttribute('title', /연가 오전 반일/);

    const details = win.locator('details');
    await expect(details.locator('ul')).toBeHidden();
    await win.getByText('달마다 글로 보기').click();
    const nov = details.locator('li', { hasText: '11월' });
    await expect(nov).toContainText('들른 날 4일');
    await expect(nov).toContainText('연가 4시간(20일 오전)');
    await expect(details.locator('li', { hasText: '3월' })).toContainText('연가 1일(3일)');
    await expect(details.locator('li', { hasText: '12월' })).toContainText('1일 예정');
    await expect(details.locator('li', { hasText: '1월' }).first()).toContainText('1월 1일 승급');
  });

  test('카드 화면에서 올해 결산을 고르면 결산 카드를 PNG로 저장한다', async ({ page }) => {
    await openApp(page, { seed: recapSeed(), hash: 'card' });
    await tick(page, 2000);
    const kinds = page.getByRole('radiogroup', { name: '카드 종류' });
    await expect(kinds.getByRole('radio', { name: '캐릭터 카드' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await kinds.getByRole('radio', { name: '올해 결산' }).click();
    await expect(page.getByRole('heading', { name: '결산 미리보기' })).toBeVisible();
    const preview = page.locator('#card-preview [role="img"]');
    await expect(preview).toHaveAttribute('aria-label', /^올해 결산 카드 미리보기\. 김주무관/);
    await expect(preview).toHaveAttribute('aria-label', /근무일 \d+일/);
    await expect(preview).toHaveAttribute('aria-label', /연가 1일 4시간/);
    await expect(preview).toHaveAttribute('aria-label', /출근 도장 4개/);
    await expect(preview).toHaveAttribute('aria-label', /승급 4→5호봉/);
    await expect(preview).toHaveAttribute('aria-label', /1년 달력/);
    // 금액은 기본으로 꺼져 있다
    await expect(page.getByRole('checkbox', { name: /올해 번 봉급/ })).not.toBeChecked();
    await expect(preview).not.toHaveAttribute('aria-label', /원/);

    const square = await savePng(page);
    expect(square.name).toBe('hobong-recap-2026-20261125.png');
    expect(pngSize(square.buffer)).toEqual({ width: 1080, height: 1080 });
    await page.getByRole('radio', { name: '세로형' }).click();
    const portrait = await savePng(page);
    expect(pngSize(portrait.buffer)).toEqual({ width: 1080, height: 1620 });

    // 글자 카드: 사실만, 금액·하루 단위 날짜 없이
    const text = page.locator('#card-text pre');
    await expect(text).toContainText('[호봉] 김주무관의 2026년 (11월까지)');
    await expect(text).toContainText('출근 도장 4개');
    await expect(text).not.toContainText('원');
    await expect(text).not.toContainText('2026. ');

    // 1년 달력을 끄면 미리보기에서 빠진다
    await page.getByRole('checkbox', { name: /1년 달력/ }).uncheck();
    await expect(preview).not.toHaveAttribute('aria-label', /1년 달력/);
    // 다른 화면에 다녀와도 이 탭에서는 결산을 고른 채로 남는다(저장하지는 않는다)
    await tabs(page).getByRole('link', { name: '홈' }).click();
    await tabs(page).getByRole('link', { name: '카드' }).click();
    await expect(kinds.getByRole('radio', { name: '올해 결산' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const stored = await page.evaluate(() => window.localStorage.getItem('hobong.data') ?? '');
    expect(stored).not.toContain('recap');
  });

  test('결산 금액은 켤 때만 들어가고, 금액 가리기면 미리보기에서 가리고 저장할 때 묻는다', async ({
    page,
  }) => {
    await openApp(page, { seed: recapSeed(), hash: 'card' });
    await page.getByRole('radio', { name: '올해 결산' }).click();
    const preview = page.locator('#card-preview [role="img"]');
    await page.getByRole('checkbox', { name: /올해 번 봉급/ }).check();
    await expect(preview).toHaveAttribute(
      'aria-label',
      /올해 번 봉급\(봉급표 기준 추정\) [\d,]+원/,
    );
    // 글자 카드에는 켜도 넣지 않는다
    await expect(page.locator('#card-text pre')).not.toContainText('원');

    await openApp(page, { seed: recapSeed({ hideAmounts: true }), hash: 'card' });
    await page.getByRole('radio', { name: '올해 결산' }).click();
    await page.getByRole('checkbox', { name: /올해 번 봉급/ }).check();
    await expect(preview).toHaveAttribute(
      'aria-label',
      /올해 번 봉급\(봉급표 기준 추정\) 금액 가림/,
    );
    await expect(preview).not.toHaveAttribute('aria-label', /\d원/);
    await expect(page.locator('#recap-amount-masked')).toBeVisible();
    await page.getByRole('button', { name: 'PNG로 저장' }).click();
    const dialog = page.getByRole('dialog', { name: '금액을 넣을까요?' });
    await expect(dialog).toContainText('올해 번 봉급');
    await expect(dialog).toContainText(/[\d,]+원/);
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toHaveCount(0);
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'PNG로 저장' }).click();
        await page.getByRole('button', { name: '금액 넣어 내보내기' }).click();
      })(),
    ]);
    expect(file.suggestedFilename()).toMatch(/^hobong-recap-2026-\d{8}\.png$/);
  });

  test('지난해 정년퇴직했다면 결산이 없다고 알리고 저장을 막는다', async ({ page }) => {
    // 1965년생은 2025년 말에 정년퇴직했다
    const seed = makeSeed({ birthDate: '1965-03-02', hireDate: '1992-03-02', step: 29 });
    await openApp(page, { seed, hash: 'card' });
    await page.getByRole('radio', { name: '올해 결산' }).click();
    await expect(page.locator('#recap-none')).toHaveText('올해는 재직한 날이 없어 결산이 없어요.');
    await expect(page.getByRole('button', { name: 'PNG로 저장' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '글자로 복사' })).toBeDisabled();
  });

  test('12월에는 홈에서 결산을 조용히 알리고, 누르면 카드 화면의 결산으로 간다', async ({
    page,
  }) => {
    // 11월에는 보이지 않는다
    await openApp(page, { seed: recapSeed() });
    await expect(page.getByRole('heading', { name: '상태창' })).toBeVisible();
    await expect(page.locator('#recap-hint')).toHaveCount(0);

    const seed = JSON.parse(recapSeed()) as { data: { visits: unknown } };
    seed.data.visits = { days: ['2026-11-30', '2026-12-01'], lastVisit: '2026-11-30' };
    await openApp(page, { seed: JSON.stringify(seed), time: '2026-12-02T10:00:00+09:00' });
    const hint = page.locator('#recap-hint');
    await expect(hint).toContainText('2026년 결산이 준비됐어요.');
    // 알림·경고처럼 끼어들지 않는다
    await expect(hint).not.toHaveAttribute('role', /.+/);
    await hint.getByRole('button', { name: '결산 카드 보기' }).click();
    await expect(page.getByRole('link', { name: '카드' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('radio', { name: '올해 결산' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // 닫으면 이 탭에서는 다시 보이지 않고, 포커스는 본문으로 간다
    await tabs(page).getByRole('link', { name: '홈' }).click();
    await page.getByRole('button', { name: '결산 안내 닫기' }).click();
    await expect(page.locator('#recap-hint')).toHaveCount(0);
    await expect(page.locator('#main')).toBeFocused();
    await tabs(page).getByRole('link', { name: '업적' }).click();
    await tabs(page).getByRole('link', { name: '홈' }).click();
    await expect(page.locator('#recap-hint')).toHaveCount(0);
  });

  test('고대비에서도 달력 칸의 테두리와 도장이 보인다', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openApp(page, { seed: recapSeed(), hash: 'badges' });
    const cell = page.locator('#visits [role="img"] i.today');
    const style = await cell.evaluate((el) => {
      const s = getComputedStyle(el);
      const dot = getComputedStyle(el, '::after');
      return { shadow: s.boxShadow, outline: s.outlineStyle, dot: dot.content };
    });
    expect(style.shadow).not.toBe('none');
    expect(style.outline).toBe('solid');
    expect(style.dot).not.toBe('none');
  });
});
