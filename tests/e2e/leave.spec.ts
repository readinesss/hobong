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

  test('참고용 장부임을 밝힌다', async ({ page }) => {
    await expect(
      page.getByText('공식 인사시스템(e-사람 등)의 기록이 기준이며 이 장부는 참고용이에요.'),
    ).toBeVisible();
  });
});

test.describe('연가 장부(쉬는 날에 열었을 때)', () => {
  test('오늘이 토요일이면 "가까운 근무일로" 버튼이 다음 근무일을 고른다', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'leave', time: '2026-11-28T10:00:00+09:00' });
    // 사흘 만에 여는 것이므로 복귀 정산이 먼저 뜬다(마지막으로 들른 날은 연도까지)
    const back = page.getByRole('dialog');
    await expect(back).toContainText('2026. 11. 25.');
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
