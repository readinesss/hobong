import { expect, test } from '@playwright/test';
import { makeSeed, openApp, storedData, tick } from './helpers.ts';

test.describe('연가 장부', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'leave' });
  });

  test('오늘 1일 연가를 한 번에 기록하고 남은 연가가 줄어든다', async ({ page }) => {
    const summary = page.locator('#leave-summary');
    // 2022-09-01 임용 → 재직 4년 2개월 → 17일
    await expect(summary).toContainText('17일');
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    await expect(summary).toContainText('16일');
    await expect(page.locator('#leave-records')).toContainText('2026. 11. 25. (수)');
    const data = await storedData(page);
    expect(data?.leave.records).toHaveLength(1);
    expect(data?.leave.records[0]).toMatchObject({ date: '2026-11-25', hours: 8, kind: 'day' });
    expect(data?.meta.changesSinceBackup).toBe(1);
  });

  test('반일과 시간 연가는 시간으로 합산된다', async ({ page }) => {
    const entry = page.locator('#leave-entry');
    await entry.getByRole('button', { name: '오전 반일' }).click();
    await expect(page.locator('#leave-summary')).toContainText('16일 4시간');
    await entry.getByRole('button', { name: '2시간 기록' }).click();
    await expect(page.locator('#leave-summary')).toContainText('16일 2시간');
    // 같은 날 8시간을 넘길 수 없다
    await entry.getByRole('button', { name: '1일', exact: true }).click();
    await expect(entry.getByRole('alert')).toContainText('8시간을 넘길 수 없어요');
    expect((await storedData(page))?.leave.records).toHaveLength(2);
  });

  test('되돌리기로 방금 기록을 취소한다', async ({ page }) => {
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    await expect(page.locator('#leave-summary')).toContainText('16일');
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect(page.locator('#leave-summary')).toContainText('17일');
    expect((await storedData(page))?.leave.records).toHaveLength(0);
  });

  test('달력에서 날짜를 고르고, 쉬는 날에는 기록할 수 없다', async ({ page }) => {
    const calendar = page.locator('#leave-calendar');
    await calendar.getByRole('gridcell', { name: /11월 27일/ }).click();
    await expect(page.locator('#leave-entry')).toContainText('11월 27일 (금)');
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    await expect(page.locator('#leave-records')).toContainText('예정');
    // 빗금(예정)은 낭독 문구와 범례에도 적는다
    await expect(calendar.getByRole('gridcell', { name: /11월 27일.*예정/ })).toHaveCount(1);
    await expect(calendar).toContainText('빗금: 예정');
    // 토요일
    await calendar.getByRole('gridcell', { name: /11월 28일/ }).click();
    await expect(page.locator('#leave-entry')).toContainText(
      '이날은 토요일이라 연가를 쓰지 않아도 돼요.',
    );
    await expect(page.locator('#leave-entry')).not.toContainText('(는)');
    await expect(
      page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }),
    ).toBeDisabled();
    // 다음 달 공휴일
    await calendar.getByRole('button', { name: '다음 달' }).click();
    await calendar.getByRole('gridcell', { name: /12월 25일/ }).click();
    await expect(page.locator('#leave-entry')).toContainText('기독탄신일');
    await expect(
      page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }),
    ).toBeDisabled();
  });

  test('기록을 지우고 되살릴 수 있다', async ({ page }) => {
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    await tick(page, 7000);
    await page
      .locator('#leave-records')
      .getByRole('button', { name: /기록 지우기/ })
      .click();
    expect((await storedData(page))?.leave.records).toHaveLength(0);
    await page.getByRole('button', { name: '되돌리기' }).click();
    expect((await storedData(page))?.leave.records).toHaveLength(1);
  });

  test('부여 일수를 직접 고치고 자동 계산으로 되돌린다', async ({ page }) => {
    await page.getByRole('button', { name: '부여 일수 고치기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('일', { exact: true }).fill('19');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.locator('#leave-summary')).toContainText('19일');
    await expect(page.locator('#leave-summary')).toContainText('직접 수정');
    expect((await storedData(page))?.leave.grantOverrideHours).toEqual({ '2026': 152 });

    await page.getByRole('button', { name: '부여 일수 고치기' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '자동 계산으로 되돌리기' }).click();
    await expect(page.locator('#leave-summary')).toContainText('재직기간으로 계산');
    expect((await storedData(page))?.leave.grantOverrideHours).toEqual({});
  });

  test('여러 날을 한꺼번에 넣으면 주말과 공휴일은 빠진다', async ({ page }) => {
    await page.getByRole('button', { name: '여러 날 한꺼번에' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('첫날 연도').fill('20261223');
    await dialog.getByLabel('마지막 날 연도').fill('20261229');
    // 12/23(수), 24(목), 28(월), 29(화) — 25일은 기독탄신일, 26·27일은 주말
    await expect(dialog).toContainText('4일');
    await dialog.getByRole('button', { name: '4일 기록' }).click();
    const dates = (await storedData(page))?.leave.records.map((r: { date: string }) => r.date);
    expect(dates).toEqual(['2026-12-23', '2026-12-24', '2026-12-28', '2026-12-29']);
  });

  test('참고용 장부임을 맨 위 창에서 밝힌다', async ({ page }) => {
    await expect(page.locator('#leave-summary #leave-reference')).toHaveText(
      '참고용 장부예요. 공식 기록은 소속 기관 인사시스템(e-사람 등)이 기준이에요.',
    );
  });

  test('달력 칸은 반일의 오전·오후를 적고, 낭독도 기록 목록과 같은 말로 한다', async ({ page }) => {
    const entry = page.locator('#leave-entry');
    await entry.getByRole('button', { name: '오전 반일' }).click();
    const cell = page.locator('#leave-calendar [data-date="2026-11-25"]');
    await expect(cell).toContainText('오전');
    await expect(cell).toHaveAttribute('aria-label', /연가 오전 반일/);
    await expect(page.locator('#leave-calendar')).toContainText('빨간 숫자·휴: 공휴일');
  });

  test('다른 달로 옮겨도 Tab 으로 날짜 칸에 들어가고, Home·End·PageDown 으로 움직인다', async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, '키보드 조작은 데스크톱에서 확인한다');
    const calendar = page.locator('#leave-calendar');
    await calendar.getByRole('button', { name: '다음 달' }).click();
    await expect(calendar.locator('.day[tabindex="0"]')).toHaveCount(1);
    await expect(calendar.locator('.day[tabindex="0"]')).toHaveAttribute('data-date', '2026-12-01');
    await calendar.locator('.day[tabindex="0"]').focus();
    await page.keyboard.press('End');
    await expect(page.locator('[data-date="2026-12-05"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.locator('[data-date="2026-11-29"]')).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect(page.locator('[data-date="2026-12-29"]')).toBeFocused();
  });

  test('부여보다 많이 쓰면 음수 대신 "초과 사용"으로 적는다', async ({ page }) => {
    await page.getByRole('button', { name: '부여 일수 고치기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('일', { exact: true }).fill('0');
    await dialog.getByRole('button', { name: '저장' }).click();
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    const summary = page.locator('#leave-summary');
    await expect(summary).toContainText('초과 사용');
    await expect(summary).not.toContainText('-1일');
    // 부여가 0 이면 사용률은 셀 수 없다
    await expect(summary).toContainText('–');
  });
});

test.describe('연가 장부(쉬는 날에 열었을 때)', () => {
  test('오늘이 토요일이면 "가까운 근무일로" 버튼이 다음 근무일을 고른다', async ({ page }) => {
    const seed = makeSeed(
      {},
      { visits: { days: ['2026-11-17', '2026-11-18'], lastVisit: '2026-11-17' } },
    );
    await openApp(page, { seed, hash: 'leave', time: '2026-11-28T10:00:00+09:00' });
    // 열흘 만에 여는 것이므로 복귀 정산이 먼저 뜬다(마지막으로 들른 날은 연도까지).
    // 주말·이틀만 비운 것으로는 띄우지 않는다(growth.spec 의 월요일 테스트).
    const back = page.getByRole('dialog');
    await expect(back).toContainText('2026. 11. 18.');
    await back.getByRole('button', { name: '확인' }).click();
    const entry = page.locator('#leave-entry');
    await page
      .locator('#leave-calendar')
      .getByRole('gridcell', { name: /11월 27일/ })
      .click();
    await expect(entry).toContainText('11월 27일 (금)');
    await expect(entry.getByRole('button', { name: '오늘로' })).toHaveCount(0);
    await entry.getByRole('button', { name: '가까운 근무일로' }).click();
    await expect(entry).toContainText('11월 30일 (월)');
  });
});

test.describe('연가 장부의 장기재직휴가 안내(#14)', () => {
  test('지금 쓸 수 있는 장기재직휴가: 일수·기한·부칙 특례·근거, 연가와 따로다', async ({
    page,
  }) => {
    // 2016-09-01 임용: 5년 구간은 부칙 특례로 2028. 6. 23.까지, 10년 구간은 2026. 9. 1.부터
    const seed = makeSeed({ hireDate: '2016-09-01', step: 11 });
    await openApp(page, { seed, hash: 'leave' });
    const win = page.locator('#leave-long');
    await expect(page.getByRole('heading', { name: '장기재직휴가' })).toBeVisible();
    const items = win.getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('3일');
    await expect(items.nth(0)).toContainText('지금 쓸 수 있어요');
    await expect(items.nth(0)).toContainText('2028. 6. 23.까지 한 번 쓸 수 있어요');
    await expect(items.nth(0)).toContainText('부칙 특례');
    await expect(items.nth(1)).toContainText('5일');
    await expect(items.nth(1)).toContainText('2036. 8. 31.까지 한 번 쓸 수 있어요');
    await expect(items.nth(1)).not.toContainText('부칙 특례');
    await expect(win).toContainText('특별휴가');
    await expect(win).toContainText('줄지 않아요');
    await expect(win).toContainText('국가공무원 복무규정 제20조제18항');
    // 연가 계산은 그대로다: 재직 10년 2개월 → 21일 그대로 남는다
    await expect(page.locator('#leave-summary')).toContainText('21일');
    // 연가를 적는 흐름(올해 연가 → 기록하기 → 달력)을 밀어내지 않는다:
    // 기록하기는 올해 연가 바로 밑이고, 창은 달력보다 아래다
    const box = (sel: string) =>
      page.evaluate((q) => {
        const r = document.querySelector(q)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }, sel);
    const summaryBox = await box('#leave-summary');
    const entryBox = await box('#leave-entry');
    expect(entryBox.top - summaryBox.bottom).toBeLessThanOrEqual(24);
    expect((await box('#leave-calendar')).top).toBeLessThan((await box('#leave-long')).top);
    // 좁은 화면에서도 긴 근거 조항이 가로로 넘치지 않는다
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test('1년 안에 생기는 장기재직휴가는 시작일과 함께 미리 알린다', async ({ page }) => {
    // 기본 seed: 2022-09-01 임용 → 5년이 되는 2027. 9. 1.부터
    await openApp(page, { seed: makeSeed(), hash: 'leave' });
    const win = page.locator('#leave-long');
    await expect(win).toContainText('2027. 9. 1.부터');
    await expect(win).toContainText(
      '재직 5년이 되는 2027. 9. 1.부터 2032. 8. 31.까지 한 번 쓸 수 있어요',
    );
    await expect(win).not.toContainText('지금 쓸 수 있어요');
    await expect(page.locator('#leave-summary')).toContainText('17일');
  });

  test('해당하는 장기재직휴가가 없으면 창이 없다', async ({ page }) => {
    await openApp(page, { seed: makeSeed({ hireDate: '2024-03-04' }), hash: 'leave' });
    await expect(page.locator('#leave-summary')).toBeVisible();
    await expect(page.getByRole('heading', { name: '장기재직휴가' })).toHaveCount(0);
    await expect(page.locator('#leave-long')).toHaveCount(0);
  });
});
