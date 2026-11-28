import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { makeSeed, makeSeedV7, openApp, PACKAGE_OPEN, storedData, tick } from './helpers.ts';

/** v7 저장본에 저축연가 통장·연가 정리 값을 넣는다(검토 반영 e2e) */
function seedV7Leave(leave: { savings?: unknown[]; years?: object; grant?: number }): string {
  const env = JSON.parse(makeSeedV7()) as {
    data: { leave: { savings: unknown[]; years: object; grantOverrideHours: object } };
  };
  env.data.leave.savings = leave.savings ?? [];
  env.data.leave.years = leave.years ?? {};
  if (leave.grant !== undefined) env.data.leave.grantOverrideHours = { '2026': leave.grant * 8 };
  return JSON.stringify(env);
}

/** makeSeed 의 설정(금액 가리기만 바꿔 넣는다) */
const SETTINGS = {
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
};

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

    // 자동 값(16일)보다 크게 고쳤으므로 연가보상비 어림 창에도 같은 이름의 버튼(띠)이 있다 — 맨 위 창의 버튼을 누른다
    await page.locator('#leave-summary').getByRole('button', { name: '부여 일수 고치기' }).click();
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

  test('연가보상비 어림(#33): 6월·12월 기준 합계, 1일 단가 없음, 도움말에 저축·이월을 더하라는 말 없음', async ({
    page,
  }) => {
    const main = page.locator('#main');
    const comp = page.locator('#leave-comp');
    await expect(main).not.toContainText('1일 단가');
    await expect(main).not.toContainText('저축·이월');
    await expect(page.locator('#leave-summary')).toContainText('저축연가는 더하지 않아요');
    // 9급 5호봉(2026년 봉급표 2,226,100원) · 재직 3년 이상: 6월 30일에 16일 남음 → 5일분
    await expect(comp).toContainText('6월 30일 기준');
    await expect(comp).toContainText('5일분 약 319,070원');
    await expect(comp).toContainText('12월 31일 기준');
    await expect(comp).toContainText('최대로 보면');
    await expect(comp).toContainText('봉급표 기준 추정치');
    // 보상 일수를 1일로 줄이면 6월분보다 작아 돌려낸다(환수)
    const days = comp.getByRole('textbox', { name: '보상받을 일수' });
    await days.fill('1');
    await days.blur();
    await expect(comp.locator('#leave-comp-end-sum')).toContainText('1일분 약 63,810원');
    await expect(comp.locator('#leave-comp-end-sum')).toContainText('돌려내요(환수)');
    // 상반기를 받지 않았다고 고르면 6월분을 빼지 않는다
    await comp.getByRole('radio', { name: '받지 않았어요' }).click();
    await expect(comp.locator('#leave-comp-end-sum')).toContainText('12월에 약 63,810원');
    await expect(comp.locator('#leave-comp-end-sum')).not.toContainText('환수');
    // 고른 값은 그 해 연가 정리 값으로 저장된다(#33 묶음 2)
    await expect
      .poll(async () => (await storedData(page))?.leave.years)
      .toEqual({ '2026': { unpaidDays: null, capDays: null, midYear: 'none', compDays: 1 } });
    await page.reload();
    await tick(page);
    await expect(page.locator('#leave-comp-end-sum')).toContainText('12월에 약 63,810원');
  });

  test('연가보상비 어림: 부여 일수를 자동 값보다 크게 고친 해에는 띠가 붙고, 띠의 버튼으로 고칠 수 있다', async ({
    page,
  }) => {
    await expect(page.locator('#leave-comp-override')).toHaveCount(0);
    await page.locator('#leave-summary').getByRole('button', { name: '부여 일수 고치기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).not.toContainText('저축·이월');
    await expect(dialog).toContainText('저축연가는 더하지 않아요');
    await dialog.getByLabel('일', { exact: true }).fill('21');
    await dialog.getByRole('button', { name: '저장' }).click();
    const band = page.locator('#leave-comp-override');
    await expect(band).toContainText('저축연가를 더해 두셨다면 어림이 실제보다 커요');
    await band.getByRole('button', { name: '부여 일수 고치기' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '자동 계산으로 되돌리기' }).click();
    await expect(band).toHaveCount(0);
  });

  test('연가보상비 어림: 금액 가리기 중에는 금액과 환수라는 말이 보이지 않는다', async ({
    page,
  }) => {
    await openApp(page, {
      seed: makeSeed({}, { settings: { ...SETTINGS, hideAmounts: true } }),
      hash: 'leave',
    });
    const comp = page.locator('#leave-comp');
    const days = comp.getByRole('textbox', { name: '보상받을 일수' });
    await days.fill('1');
    await days.blur();
    await expect(comp).toContainText('12월 정산');
    const html = await comp.innerHTML();
    expect(html).not.toMatch(/\d{1,3}(,\d{3})+원/);
    expect(html).not.toContain('환수');
    // 일수와 조건은 보인다
    await expect(comp).toContainText('5일분');
    await expect(comp).toContainText('그날 남은 연가 16일');
  });

  test('저축연가 통장(#33): 처음 잔액을 넣고 저축연가에서 1일 쓰면 통장만 줄고 올해 연가는 그대로', async ({
    page,
  }) => {
    const savings = page.locator('#leave-savings');
    const summary = page.locator('#leave-summary');
    await expect(savings).toContainText('인사시스템에 나온 저축연가가 있으면 넣어 두세요');
    // 저축연가가 없으면 '저축연가' 칩을 고를 수 없다
    await expect(page.getByRole('radio', { name: '저축연가' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await savings.getByRole('button', { name: '처음 잔액 넣기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('일', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: '3일 넣기' }).click();
    await expect(savings.locator('#leave-savings-available')).toHaveText('3일');
    await expect(savings).toContainText('2025년까지 모아 둔 연가(처음 넣음)');

    await page.getByRole('radio', { name: '저축연가' }).click();
    await expect(page.locator('#leave-pool-hint')).toContainText('저축연가 3일 중에서 써요');
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    await expect(page.getByText('연가를 저축연가에서 기록했어요')).toBeVisible();
    // 기록한 뒤에는 칩이 올해 연가로 돌아간다(다음 기록이 모르고 저축연가에서 나가지 않게)
    await expect(page.getByRole('radio', { name: '올해 연가' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(savings.locator('#leave-savings-available')).toHaveText('2일');
    await expect(summary).toContainText('17일');
    await expect(summary.locator('#leave-saved-used')).toContainText('1일');
    await expect(page.locator('#leave-records')).toContainText('저축');
    const data = await storedData(page);
    expect(data?.leave.records).toMatchObject([{ date: '2026-11-25', pool: 'saved' }]);
    expect(data?.leave.savings).toMatchObject([
      { kind: 'opening', year: 2025, month: null, hours: 24 },
    ]);
    // 기록을 올해 연가로 바꾸면 통장이 돌아오고 올해 연가가 준다
    await page.getByRole('button', { name: /기록을 올해 연가로 바꾸기/ }).click();
    await expect(savings.locator('#leave-savings-available')).toHaveText('3일');
    await expect(summary).toContainText('16일');
  });

  test('시간외근무 저축은 다음 달 1일부터 쓸 수 있다', async ({ page }) => {
    const savings = page.locator('#leave-savings');
    await savings.getByRole('button', { name: '시간외근무 저축 넣기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('같은 달 안에 쓴 시간은 넣지 않아요');
    await dialog.getByRole('textbox', { name: '다음 달로 넘긴 시간' }).fill('6');
    await dialog.getByRole('button', { name: '6시간 넣기' }).click();
    await expect(savings).toContainText('2026년 11월 시간외근무 저축');
    await expect(savings).toContainText('2026년 12월 1일부터 쓸 수 있어요');
    await expect(savings.locator('#leave-savings-available')).toHaveText('0일');
    expect((await storedData(page))?.leave.savings).toMatchObject([
      { kind: 'overtime', year: 2026, month: '2026-11', hours: 6 },
    ]);
  });

  test('연말 정리(#33): 보상 일수를 줄이고 저축을 고르면 통장에 넣고, 내년 1월 1일부터 쓸 수 있다', async ({
    page,
  }) => {
    await page.locator('#leave-comp').getByRole('button', { name: '연말 정리' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('12월 31일에 남는 연가');
    await expect(dialog).toContainText('보상 또는 저축할 수 있는 날');
    const comp = dialog.getByRole('textbox', { name: '보상', exact: true });
    await comp.fill('15');
    await comp.blur();
    const save = dialog.getByRole('textbox', { name: '저축', exact: true });
    await save.fill('2');
    await save.blur();
    await expect(dialog.locator('#year-end-left')).toHaveText('고르지 않은 날 0일');
    await expect(dialog.locator('#year-end-sum')).toContainText('보상 15일(넣은 값)');
    await dialog.getByRole('button', { name: '저축 2일을 통장에 넣기' }).click();
    // 알림은 닫기 전의 해·저축으로 만든다(검토 반영: 'null년'이 되지 않게)
    await expect(
      page.getByText('2026년 정리를 저장했어요. 저축 2일은 2027년 1월 1일부터 쓸 수 있어요.'),
    ).toBeVisible();
    const savings = page.locator('#leave-savings');
    await expect(savings).toContainText('2026년 말 저축');
    await expect(savings).toContainText('2027년 1월 1일부터 쓸 수 있어요');
    const data = await storedData(page);
    expect(data?.leave.years['2026']).toEqual({
      unpaidDays: null,
      capDays: null,
      midYear: null,
      compDays: 15,
    });
    expect(data?.leave.savings).toMatchObject([{ kind: 'carry', year: 2026, hours: 16 }]);
    // 어림 창도 넣은 보상 일수로 셈한다
    await expect(
      page.locator('#leave-comp').getByRole('textbox', { name: '보상받을 일수' }),
    ).toHaveValue('15');
    // 결산(업적 화면의 출근 도장)에 한 줄
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '업적' })
      .click();
    await expect(page.locator('#visits-leave-settled')).toHaveText(
      '2026년 연가 정리: 저축 2일 · 보상 15일(넣은 값)',
    );
  });

  test('연말 정리(검토 반영): 저축을 먼저 늘리면 보상이 저절로 줄고, 정리 뒤 어림 창의 최대는 저축을 뺀 날이다', async ({
    page,
  }) => {
    await page.locator('#leave-comp').getByRole('button', { name: '연말 정리' }).click();
    const dialog = page.getByRole('dialog');
    // 열자마자 경고를 읽지 않고, 초점은 첫 입력칸(보상하지 않는 일수)에 있다
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByLabel('보상하지 않는 일수(권장 연가·사용 촉진)')).toBeFocused();
    await expect(dialog.locator('#year-end-sum')).toContainText('보상 17일(최대로 보면)');
    await expect(dialog.getByRole('button', { name: '저축 늘리기' })).toBeEnabled();
    const save = dialog.getByRole('textbox', { name: '저축', exact: true });
    await save.fill('6');
    await save.blur();
    await expect(save).toHaveValue('6');
    await expect(dialog.getByRole('textbox', { name: '보상', exact: true })).toHaveValue('11');
    await expect(dialog.locator('#year-end-auto-cut')).toHaveText(
      '저축을 늘려 보상을 17일에서 11일로 줄였어요.',
    );
    await dialog.getByRole('button', { name: '저축 6일을 통장에 넣기' }).click();
    const comp = page.locator('#leave-comp');
    await expect(comp.locator('#leave-comp-carry')).toHaveText(
      '연말 정리에서 저축 6일을 골라 보상은 11일까지예요.',
    );
    // 최대로 올려도 정리한 해의 값이 사라지지 않고, 남은 17일을 넘겨 셈하지 않는다
    const days = comp.getByRole('textbox', { name: '보상받을 일수' });
    await days.fill('17');
    await days.blur();
    await expect(days).toHaveValue('11');
    await expect(comp.locator('#leave-comp-end-sum')).toContainText('11일분');
    // 보상 일수를 고르지 않았으니 '최대로'(저축을 뺀 11일)로 두고, 저축은 그대로다
    const data = await storedData(page);
    expect(data?.leave.years['2026']?.compDays ?? null).toBeNull();
    expect(data?.leave.savings).toMatchObject([{ kind: 'carry', year: 2026, hours: 48 }]);
    // 1일 줄이면 그 값을 넣은 값으로 저장한다
    await comp.getByRole('button', { name: '보상받을 일수 줄이기' }).click();
    await expect.poll(async () => (await storedData(page))?.leave.years['2026']?.compDays).toBe(10);
  });

  test('연말 정리(검토 반영): 다시 열어 건드리지 않고 저장하면 넣어 둔 저축(일·시간)과 보상 일수(최대로)가 그대로다', async ({
    page,
  }) => {
    await openApp(page, {
      seed: seedV7Leave({
        savings: [{ id: 'c1', kind: 'carry', year: 2026, month: null, hours: 20, memo: '' }],
      }),
      hash: 'leave',
    });
    await page.locator('#leave-comp').getByRole('button', { name: '연말 정리' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('#year-end-sum')).toContainText('(최대로 보면)');
    await dialog.getByRole('button', { name: '저축 2일 4시간을 통장에 넣기' }).click();
    await expect(page.getByText(/2026년 정리를 저장했어요\. 저축 2일 4시간은/)).toBeVisible();
    const data = await storedData(page);
    expect(data?.leave.savings).toMatchObject([{ id: 'c1', hours: 20 }]);
    expect(data?.leave.years['2026']?.compDays ?? null).toBeNull();
  });

  test('부여 일수 띠(검토 반영): 닫을 수 있고, 통장에 넣기는 늘린 날을 미리 채운다', async ({
    page,
  }) => {
    await page.locator('#leave-summary').getByRole('button', { name: '부여 일수 고치기' }).click();
    const grant = page.getByRole('dialog');
    await grant.getByLabel('일', { exact: true }).fill('20');
    await grant.getByRole('button', { name: '저장' }).click();
    const band = page.locator('#leave-savings-override');
    await expect(band).toContainText('가산 연가만 더했다면 그대로 두세요');
    await expect(band).toContainText('[저축연가로]를 눌러 바꿔 주세요');
    await band.getByRole('button', { name: '통장에 넣기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('일', { exact: true })).toHaveValue('3');
    await expect(dialog.getByLabel('메모 선택')).toHaveValue('부여 일수에서 옮김');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: '취소' }).click();
    await page.getByRole('button', { name: '저축연가 옮기기 안내 닫기' }).click();
    await expect(band).toHaveCount(0);
    await page.getByRole('button', { name: '부여 일수 안내 닫기' }).click();
    await expect(page.locator('#leave-comp-override')).toHaveCount(0);
  });

  test('저축연가 넣기(검토 반영): 열자마자 경고가 없고, 범위 밖 달이면 닫히지 않고 까닭을 보인다', async ({
    page,
  }) => {
    const savings = page.locator('#leave-savings');
    await savings.getByRole('button', { name: '처음 잔액 넣기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '0일 넣기' })).toBeDisabled();
    await dialog.getByRole('button', { name: '취소' }).click();
    await savings.getByRole('button', { name: '시간외근무 저축 넣기' }).click();
    const year = page.getByRole('dialog').getByRole('textbox', { name: '저축한 달 연도' });
    await year.fill('1900');
    await year.blur();
    await expect(page.getByRole('dialog')).toContainText('임용 전의 달은 넣을 수 없어요');
    await expect(page.getByRole('dialog').getByRole('button', { name: '1일 넣기' })).toBeDisabled();
  });

  test('기록 목록의 [저축연가로]는 그날 쓸 수 있는 저축연가가 있을 때만 보인다', async ({
    page,
  }) => {
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    const records = page.locator('#leave-records');
    await expect(records.getByRole('button', { name: /저축연가로 바꾸기/ })).toHaveCount(0);
    await page.locator('#leave-savings').getByRole('button', { name: '처음 잔액 넣기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('일', { exact: true }).fill('1');
    await dialog.getByRole('button', { name: '1일 넣기' }).click();
    await expect(records.getByRole('button', { name: /저축연가로 바꾸기/ })).toHaveCount(1);
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

test.describe('홈·지갑 연결(#33 묶음 3)', () => {
  test('지갑에 연가보상비(어림) 한 줄이 따로 붙고, 다가오는 보너스 3개는 그대로다', async ({
    page,
  }) => {
    await openApp(page, { seed: makeSeed() });
    const wallet = page.locator('#wallet');
    await expect(wallet.locator('.bonus li')).toHaveCount(3);
    const line = wallet.locator('#wallet-leave-comp');
    await expect(line).toContainText('연가보상비(어림)');
    await expect(line).toContainText('12월 31일 기준');
    await expect(line).toContainText('12월 중');
    await expect(line).toContainText(/약 [\d,]+원/);
    // 다가오는 일정에는 넣지 않는다
    await expect(page.locator('#upcoming')).not.toContainText('연가보상비');
  });

  test('금액 가리기 중에는 지갑의 연가보상비 줄에도 금액이 없다', async ({ page }) => {
    await openApp(page, { seed: makeSeed({}, { settings: { ...SETTINGS, hideAmounts: true } }) });
    const html = await page.locator('#wallet-leave-comp').innerHTML();
    expect(html).not.toMatch(/\d{1,3}(,\d{3})+원/);
  });

  test('12월에 정리하지 않았으면 홈 연가 창에서 연말 정리를 권하고, 누르면 대화상자가 열린다', async ({
    page,
  }) => {
    await openApp(page, { seed: makeSeed(), time: '2026-12-03T10:30:00+09:00' });
    // 오랜만에 열어 뜨는 '다시 만나서 반가워요'를 닫는다
    await page.getByRole('dialog').getByRole('button', { name: '확인' }).click();
    const mini = page.locator('#leave-mini');
    await mini.getByRole('button', { name: '2026년 연말 정리 해 보기' }).click();
    await expect(page.getByRole('dialog', { name: '2026년 연가 정리' })).toBeVisible();
  });

  test('통장에 넣은 것이 있으면 홈 연가 창에 저축연가 한 줄', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'leave' });
    await page.locator('#leave-savings').getByRole('button', { name: '처음 잔액 넣기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('일', { exact: true }).fill('2');
    await dialog.getByRole('button', { name: '2일 넣기' }).click();
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '홈' })
      .click();
    await expect(page.locator('#leave-mini-saved')).toContainText('저축연가');
    await expect(page.locator('#leave-mini-saved')).toContainText('2일');
  });
});

test.describe('저축연가 기록·통장의 끝단(#33 검토 반영)', () => {
  test('저축 규정이 없는 직종(교원)에 저축연가 기록이 남아 있으면 한 줄로 알리고 [올해 연가로]로 바꿀 수 있다', async ({
    page,
  }) => {
    const env = JSON.parse(
      makeSeedV7({ track: 'teacher', payTable: null, rank: '교원', step: 12 }),
    ) as { data: { leave: { records: unknown[] } } };
    env.data.leave.records = [
      { id: 's1', date: '2026-11-02', hours: 8, kind: 'day', memo: '', pool: 'saved' },
    ];
    await openApp(page, { seed: JSON.stringify(env), hash: 'leave' });
    const orphan = page.locator('#leave-saved-orphan');
    await expect(orphan).toContainText('이 직종은 저축연가 통장을 쓰지 않아요');
    await expect(orphan).toContainText('[올해 연가로]');
    await expect(page.locator('#leave-savings')).toHaveCount(0);
    await page
      .locator('#leave-records')
      .getByRole('button', { name: /올해 연가로 바꾸기/ })
      .click();
    await expect(orphan).toHaveCount(0);
  });

  test('불러오기 미리보기에 저축연가 통장 줄 수를 보인다(지금 통장을 바꾼다는 것)', async ({
    page,
  }) => {
    await openApp(page, {
      seed: seedV7Leave({
        savings: [{ id: 'o1', kind: 'opening', year: 2025, month: null, hours: 16, memo: '' }],
      }),
      hash: 'settings',
    });
    const path = join(mkdtempSync(join(tmpdir(), 'hobong-e2e-')), 'old.json');
    writeFileSync(path, makeSeed({ nickname: '예전파일' }));
    await page.getByRole('button', { name: PACKAGE_OPEN }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog').getByRole('button', { name: '파일 고르기' }).click();
    await (await chooser).setFiles(path);
    await expect(page.getByRole('dialog').locator('#import-savings')).toHaveText(
      /저축연가 통장\s*0줄 \(지금 1줄 대신\)/,
    );
  });
});
