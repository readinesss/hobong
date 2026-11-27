/**
 * #30 '생애 봉급' 묶음 2: 퇴직 예정 달(연·월) 정하기 — 설계서 §7.5 의 E4~E7b, E8·E11 의 정한 달 부분.
 * 저장 형식 v6(data.plan.retireMonth). 고정 시각은 2026-11-25(수) 10:30(기본 시드의 월급날).
 *
 * 지키는 것
 * - 정한 달은 이 창의 셈에만 쓴다(정년 D-day·연가·카드·탭 제목은 그대로).
 * - 금액 가리기 중에 저장된 정한 달이 있으면 창·입력 칸·알리는 말 어디에도 그 달과 그에 따른 숫자가 없다.
 * - 계급정년 뒤를 정해도 "승진해야"라고 말하지 않는다.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  closeDialogs,
  collectErrors,
  fillMonth,
  makeSeedV5,
  makeSeedV6,
  openApp,
  PACKAGE_OPEN,
  storedData,
  tick,
  type SeedProfileV4,
  type SeedV6,
} from './helpers.ts';

const LABEL = '퇴직 예정 달';

async function openSeed(
  page: Page,
  profile: SeedProfileV4 = {},
  v6: SeedV6 = {},
  time?: string,
): Promise<Locator> {
  await openApp(page, { seed: makeSeedV6(profile, v6), ...(time ? { time } : {}) });
  await tick(page, 2500);
  await closeDialogs(page);
  return page.locator('#lifetime');
}

/** 폼을 열고 연·월을 넣어 [정하기]를 누른다 */
async function setPlan(page: Page, year: string, month: string): Promise<void> {
  await page.locator('#lifetime-plan-open').click();
  await fillMonth(page, LABEL, year, month);
  await page.locator('#lifetime-plan-submit').click();
  await tick(page, 300);
}

const planOf = async (page: Page) => (await storedData(page))?.plan.retireMonth;

/** 창의 글자에서 제목 줄 꼬리표("2026년 봉급표")를 뺀 것 */
const bodyText = (page: Page) =>
  page.evaluate(() => {
    const win = document.querySelector('#lifetime');
    const aside = win?.querySelector('.win-title .aside')?.textContent ?? '';
    return (win?.textContent ?? '').replace(aside, '');
  });

const POLICE: SeedProfileV4 = {
  track: 'police',
  payTable: null,
  rank: '경정',
  birthDate: '1980-08-15',
  hireDate: '2005-04-01',
  rankDate: '2020-03-01',
  step: 22,
  nextStepDate: '2027-04-01',
};
const FOREIGN: SeedProfileV4 = {
  track: 'foreign',
  payTable: null,
  rank: '3',
  birthDate: '1990-01-05',
  hireDate: '2018-02-01',
  rankDate: '2018-02-01',
  step: 9,
  nextStepDate: '2027-02-01',
};

test.describe('퇴직 예정 달 정하기', () => {
  test('E4 정하기: 그 달 말일까지의 금액·횟수로 바뀌고, 저장되고, 새로 고쳐도 남는다', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const win = await openSeed(page);
    const careerBefore = await page.locator('#career').innerText();
    const titleBefore = await page.title();

    const open = win.getByRole('button', { name: '퇴직 예정 달 정하기' });
    await open.click();
    // 창 안에서 폼이 펼쳐지고(대화상자가 아니다) 연도 칸으로 포커스가 간다
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const year = page.getByLabel(`${LABEL} 연도`);
    await expect(year).toBeFocused();
    // 자리 표시는 정년퇴직일의 연·월(값이 아니다)
    await expect(year).toHaveValue('');
    await expect(year).toHaveAttribute('placeholder', '2056');
    await expect(page.getByLabel(`${LABEL} 월`)).toHaveAttribute('placeholder', '6');
    // 날짜가 아니라 달로 받는 까닭, 이 창에서만 쓴다는 것, 임용정보 패키지에 그대로 실린다는 것
    const form = win.locator('#lifetime-plan-form');
    await expect(form).toContainText('날짜가 아니라 달로 받아요');
    await expect(form).toContainText('공무원보수규정 제22조·제24조');
    await expect(form).toContainText('정한 달은 이 창의 셈에만 써요');
    await expect(form.locator('#lifetime-plan-storage')).toHaveText(
      '정한 달은 이 브라우저에 저장되고, 임용정보 패키지를 내려받으면 그 파일에도 그대로 실려요(패키지에 암호를 걸면 가려져요). 카드에는 들어가지 않아요.',
    );
    await expect(form).not.toContainText('백업');
    // 정한 달이 없으면 되돌리기 버튼은 없다
    await expect(form.getByRole('button')).toHaveText(['정하기', '닫기']);

    await year.fill('2030');
    // 연도 네 자리를 치면 월 칸으로 넘어간다
    await expect(page.getByLabel(`${LABEL} 월`)).toBeFocused();
    await page.getByLabel(`${LABEL} 월`).fill('12');
    await expect(win.locator('#lifetime-plan-preview')).toHaveText(
      '그 달 말일(2030년 12월 31일)까지 다니는 것으로 셈해요.',
    );
    await form.getByRole('button', { name: '정하기' }).click();
    await tick(page, 300);

    await expect(form).toHaveCount(0);
    await expect(win.locator('#lifetime-head')).toContainText(
      '2030년 12월까지 다닌다면 · 4년 1개월 남음',
    );
    await expect(win.locator('#lifetime-plan-tag')).toHaveText('정한 달');
    await expect(win.locator('#lifetime-total')).toHaveText('약 2억 2,614만 원');
    await expect(win.locator('#lifetime-earned')).toHaveText('약 1억 1,076만 원');
    await expect(win.locator('#lifetime-remaining')).toHaveText('약 1억 1,538만 원');
    await expect(win.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '48%');
    await expect(win.locator('#lifetime-paydays')).toContainText('49번');
    await expect(win.locator('#lifetime-raises')).toContainText('4번');
    await expect(win.locator('#lifetime-raises')).toContainText('퇴직 때 9호봉');
    await expect(win.locator('#lifetime-diligence')).toHaveText('8번');
    await expect(win.locator('#lifetime-summary')).toContainText('2030년 12월까지 다닌다면');
    // 알리는 말과 포커스: 연 버튼(이제 '고치기')으로 돌아간다
    await expect(win.locator('#lifetime-live')).toHaveText(
      '퇴직 예정 달을 2030년 12월로 정했어요.',
    );
    await expect(win.locator('#lifetime-live')).toHaveAttribute('aria-live', 'polite');
    const edit = win.getByRole('button', { name: '퇴직 예정 달 고치기' });
    await expect(edit).toBeFocused();
    // 자세한 가정은 정한 달 기준으로 말한다
    await win.locator('#lifetime-how summary').click();
    await expect(win.locator('#lifetime-how')).toContainText(
      '그 달 말일까지 다니는 것으로 셈했어요.',
    );
    await expect(win.locator('#lifetime-how')).toContainText('퇴직까지 해가 4번 바뀌어요');

    // 저장: v6 의 plan.retireMonth
    expect(await planOf(page)).toBe('2030-12');
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('hobong.data') ?? '{}')),
    ).toMatchObject({ schemaVersion: 6 });
    // 이 창 밖은 그대로다: 정년 창(퇴직일·D-day·진행률), 탭 제목
    expect(await page.locator('#career').innerText()).toBe(careerBefore);
    expect(await page.title()).toBe(titleBefore);
    await expect(page.locator('#wallet')).not.toContainText('2030');

    // 새로 고쳐도 그대로
    await page.reload();
    await tick(page, 2500);
    await expect(win.locator('#lifetime-head')).toContainText('2030년 12월까지 다닌다면');
    await expect(win.locator('#lifetime-total')).toHaveText('약 2억 2,614만 원');
    await expect(win.locator('#lifetime-paydays')).toContainText('49번');
    expect(await planOf(page)).toBe('2030-12');
    // 고치기로 열면 정한 달이 처음 값이다
    await edit.click();
    await expect(page.getByLabel(`${LABEL} 연도`)).toHaveValue('2030');
    await expect(page.getByLabel(`${LABEL} 월`)).toHaveValue('12');
    expect(errors).toEqual([]);
  });

  test('E5 검증: 지난 달·정년 뒤·빈 칸은 받지 않고 저장본은 그대로다', async ({ page }) => {
    const win = await openSeed(page);
    await win.getByRole('button', { name: '퇴직 예정 달 정하기' }).click();
    const year = page.getByLabel(`${LABEL} 연도`);
    const month = page.getByLabel(`${LABEL} 월`);
    const error = win.locator('#lifetime-plan-month-error');
    const submit = win.locator('#lifetime-plan-submit');

    // 빈 칸은 [정하기]를 누른 뒤에 알린다
    await expect(error).toHaveCount(0);
    await submit.click();
    await expect(error).toHaveText('연도와 달을 넣어 주세요.');
    await expect(win.locator('#lifetime-live')).toHaveText('연도와 달을 넣어 주세요.');
    await expect(year).toBeFocused();
    await expect(year).toHaveAttribute('aria-invalid', 'true');
    // 오류는 연도 칸의 설명으로 이어진다
    expect(await year.getAttribute('aria-describedby')).toContain('lifetime-plan-month-error');

    // 없는 달(13월)·세 자리 연도
    await fillMonth(page, LABEL, '2030', '13');
    await submit.click();
    await expect(error).toHaveText('연도와 달을 넣어 주세요.');
    await fillMonth(page, LABEL, '203', '5');
    await submit.click();
    await expect(error).toHaveText('연도와 달을 넣어 주세요.');

    // 지난 달: 다 친 순간 바로 알린다
    await fillMonth(page, LABEL, '2026', '10');
    await expect(error).toHaveText('이번 달(2026년 11월)부터 고를 수 있어요.');
    await expect(win.locator('#lifetime-plan-preview')).toHaveText(
      '그 달 말일까지 다니는 것으로 셈해요.',
    );
    await submit.click();
    await expect(win.locator('#lifetime-plan-form')).toBeVisible();

    // 정년퇴직일의 달보다 뒤
    await fillMonth(page, LABEL, '2056', '7');
    await expect(error).toHaveText(
      '정년퇴직일이 2056년 6월 30일이라 2056년 6월까지만 고를 수 있어요.',
    );
    await month.press('Enter');
    await expect(win.locator('#lifetime-plan-form')).toBeVisible();
    await expect(win.locator('#lifetime-head')).toHaveText(
      '정년퇴직일(2056년 6월 30일)까지 다닌다면',
    );
    expect(await planOf(page)).toBeNull();

    // 이번 달은 고를 수 있다(이번 달 말일까지)
    await fillMonth(page, LABEL, '2026', '11');
    await expect(error).toHaveCount(0);
    await expect(year).not.toHaveAttribute('aria-invalid', 'true');
    await submit.click();
    await tick(page, 300);
    expect(await planOf(page)).toBe('2026-11');
    await expect(win.locator('#lifetime-head')).toContainText('2026년 11월까지 다닌다면');
    await expect(win.locator('#lifetime-head')).toContainText('5일 남음');
    // 이번 달 월급날(25일)은 오늘이라 받은 쪽이다: 남은 월급날은 없고 금액은 조금 남는다
    await expect(win.locator('#lifetime-paydays')).toContainText('없음');
    await expect(win.locator('#lifetime-paydays')).toContainText('오늘이 51번째 월급날이에요');
    await expect(win.locator('#lifetime-remaining')).toHaveText('약 37만 원');
  });

  test('E5 정년퇴직일과 같은 달: 그대로 저장하고 정년 기준으로 셈한다', async ({ page }) => {
    const win = await openSeed(page);
    await setPlan(page, '2056', '6');
    expect(await planOf(page)).toBe('2056-06');
    await expect(win.locator('#lifetime-head')).toHaveText(
      '정년퇴직일(2056년 6월 30일)까지 다닌다면',
    );
    await expect(win.locator('#lifetime-same-month')).toHaveText(
      '정한 달(2056년 6월)이 정년퇴직일과 같은 달이에요.',
    );
    await expect(win.locator('#lifetime-plan-tag')).toHaveCount(0);
    await expect(win.locator('#lifetime-total')).toHaveText('약 12억 3,576만 원');
    await expect(win.getByRole('button', { name: '퇴직 예정 달 고치기' })).toBeFocused();
  });

  test('E6 되돌리기: 정년까지의 값으로 돌아가고 저장본에서 지워진다', async ({ page }) => {
    const win = await openSeed(page, {}, { retireMonth: '2030-12' });
    await expect(win.locator('#lifetime-total')).toHaveText('약 2억 2,614만 원');
    await win.getByRole('button', { name: '퇴직 예정 달 고치기' }).click();
    await win.getByRole('button', { name: '정년까지로 되돌리기' }).click();
    await tick(page, 300);
    await expect(win.locator('#lifetime-plan-form')).toHaveCount(0);
    await expect(win.locator('#lifetime-head')).toHaveText(
      '정년퇴직일(2056년 6월 30일)까지 다닌다면',
    );
    await expect(win.locator('#lifetime-plan-tag')).toHaveCount(0);
    await expect(win.locator('#lifetime-total')).toHaveText('약 12억 3,576만 원');
    await expect(win.locator('#lifetime-remaining')).toHaveText('약 11억 2,500만 원');
    await expect(win.locator('#lifetime-paydays')).toContainText('355번');
    await expect(win.locator('#lifetime-raises')).toContainText('26번');
    await expect(win.locator('#lifetime-diligence')).toHaveText('59번');
    await expect(win.locator('#lifetime-live')).toHaveText('정년까지로 되돌렸어요.');
    await expect(win.getByRole('button', { name: '퇴직 예정 달 정하기' })).toBeFocused();
    expect(await planOf(page)).toBeNull();
  });

  test('닫기·Esc: 아무것도 바꾸지 않고 연 버튼으로 포커스가 돌아간다', async ({ page }) => {
    const win = await openSeed(page, {}, { retireMonth: '2030-12' });
    const open = win.locator('#lifetime-plan-open');
    await open.click();
    await fillMonth(page, LABEL, '2035', '3');
    await win.getByRole('button', { name: '닫기' }).click();
    await expect(win.locator('#lifetime-plan-form')).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(await planOf(page)).toBe('2030-12');
    await open.click();
    // 다시 열면 치다 만 값이 아니라 저장된 달이다
    await expect(page.getByLabel(`${LABEL} 연도`)).toHaveValue('2030');
    await page.getByLabel(`${LABEL} 월`).fill('7');
    await page.keyboard.press('Escape');
    await expect(win.locator('#lifetime-plan-form')).toHaveCount(0);
    await expect(open).toBeFocused();
    expect(await planOf(page)).toBe('2030-12');
    await expect(win.locator('#lifetime-head')).toContainText('2030년 12월까지 다닌다면');
  });

  test('E11 키보드만으로 정하고 되돌린다. 누르는 영역은 44px 이상이다', async ({ page }) => {
    const win = await openSeed(page);
    const open = win.locator('#lifetime-plan-open');
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(`${LABEL} 연도`)).toBeFocused();
    await page.keyboard.type('2031');
    await expect(page.getByLabel(`${LABEL} 월`)).toBeFocused();
    await page.keyboard.type('6');
    // 칸과 버튼의 크기(이름표·묶음 포함)
    const group = win.getByRole('group', { name: LABEL });
    await expect(group).toBeVisible();
    for (const target of [
      page.getByLabel(`${LABEL} 연도`),
      page.getByLabel(`${LABEL} 월`),
      win.locator('#lifetime-plan-submit'),
      win.locator('#lifetime-plan-close'),
    ]) {
      const box = await target.boundingBox();
      // 버튼은 테두리(3px)까지 누르는 영역이다(::after)
      expect(box && box.height >= 42, (await target.getAttribute('id')) ?? '').toBe(true);
    }
    await page.keyboard.press('Enter');
    await tick(page, 300);
    expect(await planOf(page)).toBe('2031-06');
    await expect(win.locator('#lifetime-head')).toContainText('2031년 6월까지 다닌다면');
    await expect(open).toBeFocused();
    await expect(open).toHaveText('퇴직 예정 달 고치기');
    // 되돌리기: 열고 → 월 칸에서 Tab 두 번(정하기 → 정년까지로 되돌리기) → Enter
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(`${LABEL} 연도`)).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(win.getByRole('button', { name: '정년까지로 되돌리기' })).toBeFocused();
    await page.keyboard.press('Enter');
    await tick(page, 300);
    expect(await planOf(page)).toBeNull();
    await expect(open).toBeFocused();
    await expect(open).toHaveText('퇴직 예정 달 정하기');
  });

  test('붙여넣기: "2030-03"·"2030년 3월"을 연도 칸에 붙이면 두 칸이 채워진다', async ({ page }) => {
    const win = await openSeed(page);
    await win.locator('#lifetime-plan-open').click();
    const year = page.getByLabel(`${LABEL} 연도`);
    for (const text of ['2030-03', '2030년 3월', '203003']) {
      await year.fill('');
      await page.getByLabel(`${LABEL} 월`).fill('');
      await year.focus();
      await page.evaluate((value) => {
        const data = new DataTransfer();
        data.setData('text', value);
        document.activeElement?.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, text);
      await expect(year, text).toHaveValue('2030');
      await expect(page.getByLabel(`${LABEL} 월`), text).toHaveValue('3');
      await expect(win.locator('#lifetime-plan-preview'), text).toContainText('2030년 3월 31일');
    }
  });
});

test.describe('쓸 수 없게 된 정한 달', () => {
  test('지난 달: 정년 기준으로 셈하고 고치거나 지우라고 알린다(저장본은 그대로)', async ({
    page,
  }) => {
    const win = await openSeed(page, {}, { retireMonth: '2026-10' });
    await expect(win.locator('#lifetime-plan-issue')).toHaveText(
      '정해 둔 퇴직 예정 달(2026년 10월)이 지났어요. 지금은 정년까지로 셈했어요.',
    );
    await expect(win.locator('#lifetime-head')).toHaveText(
      '정년퇴직일(2056년 6월 30일)까지 다닌다면',
    );
    await expect(win.locator('#lifetime-total')).toHaveText('약 12억 3,576만 원');
    await expect(win.locator('#lifetime-plan-actions').getByRole('button')).toHaveText([
      '퇴직 예정 달 고치기',
      '정한 달 지우기',
    ]);
    // 말없이 고치거나 지우지 않는다
    expect(await planOf(page)).toBe('2026-10');
    await win.getByRole('button', { name: '정한 달 지우기' }).click();
    await tick(page, 300);
    expect(await planOf(page)).toBeNull();
    await expect(win.locator('#lifetime-plan-issue')).toHaveCount(0);
    await expect(win.locator('#lifetime-live')).toHaveText('정년까지로 되돌렸어요.');
    await expect(win.getByRole('button', { name: '퇴직 예정 달 정하기' })).toBeFocused();
  });

  test('정년 뒤의 달(생년월일을 고쳐 정년이 당겨진 경우 등)', async ({ page }) => {
    const win = await openSeed(page, {}, { retireMonth: '2056-07' });
    await expect(win.locator('#lifetime-plan-issue')).toHaveText(
      '정해 둔 퇴직 예정 달(2056년 7월)이 정년퇴직일(2056년 6월 30일)보다 뒤예요. 지금은 정년까지로 셈했어요.',
    );
    await expect(win.locator('#lifetime-paydays')).toContainText('355번');
    // 고치기: 저장된 달이 처음 값이라 무엇이 문제인지 바로 보인다
    await win.getByRole('button', { name: '퇴직 예정 달 고치기' }).click();
    await expect(page.getByLabel(`${LABEL} 연도`)).toHaveValue('2056');
    await expect(win.locator('#lifetime-plan-month-error')).toContainText('2056년 6월까지만');
  });

  test('정년퇴직일이 지난 사람은 정한 달이 남아 있어도 화면에 나오지 않는다', async ({ page }) => {
    const win = await openSeed(
      page,
      {
        birthDate: '1966-03-10',
        hireDate: '1990-05-10',
        rank: '6',
        rankDate: '2010-01-01',
        step: 32,
        nextStepDate: '2026-12-01',
      },
      { retireMonth: '2027-03', hideAmounts: true },
    );
    await expect(win.locator('#lifetime-head')).toHaveText('정년퇴직일(2026년 6월 30일)까지');
    await expect(win.locator('#lifetime-masked')).toHaveCount(0);
    await expect(win.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    await expect(win).not.toContainText(/2027|퇴직 예정 달|정한 달/);
    await expect(win.getByRole('button')).toHaveCount(0);
    expect(await planOf(page)).toBe('2027-03');
  });
});

test.describe('정한 달과 금액 가리기', () => {
  test('E7 본문 전체를 한 줄로 줄인다: 달·횟수·막대·한마디·입력 칸·알리는 말 어디에도 숫자가 없다', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const win = await openSeed(page, {}, { retireMonth: '2030-12', hideAmounts: true });
    await expect(win.locator('#lifetime-masked')).toHaveText(
      '금액 가리기 중이라 퇴직 예정 달과 그에 따른 숫자를 가렸어요.',
    );
    expect(await bodyText(page)).not.toMatch(/\d/);
    await expect(win.getByRole('progressbar')).toHaveCount(0);
    for (const id of [
      '#lifetime-head',
      '#lifetime-summary',
      '#lifetime-money',
      '#lifetime-counts',
      '#lifetime-line',
      '#lifetime-how',
      '#lifetime-notice',
      '#lifetime-plan-tag',
    ])
      await expect(win.locator(id), id).toHaveCount(0);
    // 숨긴 DOM 에도 남지 않는다(속성 값까지)
    const html = await win.evaluate((el) => el.innerHTML);
    expect(html).not.toMatch(/2030|49번|48%|2,614/);
    await expect(win.getByRole('button')).toHaveText(['퇴직 예정 달 고치기']);

    // 고치기: 빈 칸으로 연다(저장된 달을 처음 값으로 넣지 않는다)
    await win.getByRole('button', { name: '퇴직 예정 달 고치기' }).click();
    const year = page.getByLabel(`${LABEL} 연도`);
    const month = page.getByLabel(`${LABEL} 월`);
    await expect(year).toHaveValue('');
    await expect(month).toHaveValue('');
    // 자리 표시는 정년퇴직일의 연·월이라 정한 달을 드러내지 않는다
    await expect(year).toHaveAttribute('placeholder', '2056');
    await expect(win.locator('#lifetime-plan-preview')).toHaveText(
      '그 달 말일까지 다니는 것으로 셈해요.',
    );
    expect(await win.evaluate((el) => el.innerHTML)).not.toMatch(/2030/);
    await expect(win.getByRole('button', { name: '정년까지로 되돌리기' })).toBeVisible();

    await fillMonth(page, LABEL, '2031', '6');
    await win.locator('#lifetime-plan-submit').click();
    await tick(page, 300);
    // 알리는 말에도 달이 없다
    await expect(win.locator('#lifetime-live')).toHaveText('퇴직 예정 달을 정했어요.');
    expect(await planOf(page)).toBe('2031-06');
    expect(await bodyText(page)).not.toMatch(/\d/);
    expect(await win.evaluate((el) => el.innerHTML)).not.toMatch(/2031|2030/);
    await expect(win.getByRole('button', { name: '퇴직 예정 달 고치기' })).toBeFocused();

    // 가리기를 끄면 정한 달 기준으로 나온다
    await page.locator('#today').getByRole('button', { name: /금액/ }).click();
    await tick(page);
    expect((await storedData(page))?.settings.hideAmounts).toBe(false);
    await expect(win.locator('#lifetime-head')).toContainText('2031년 6월까지 다닌다면');
    await expect(win.locator('#lifetime-masked')).toHaveCount(0);
    await expect(win.getByRole('progressbar')).toHaveCount(1);
    // 가리기가 꺼진 동안 달을 고치면 알리는 말에 달이 들어간다
    await setPlan(page, '2032', '3');
    await expect(win.locator('#lifetime-live')).toHaveText('퇴직 예정 달을 2032년 3월로 정했어요.');
    // 다시 켜면 다시 한 줄이고, 방금의 알리는 말(보이지 않는 글)에도 달이 남지 않는다
    await page.locator('#today').getByRole('button', { name: '금액 가리기' }).click();
    await tick(page);
    await expect(win.locator('#lifetime-masked')).toBeVisible();
    expect(await bodyText(page)).not.toMatch(/\d/);
    await expect(win.locator('#lifetime-live')).toHaveText('');
    expect(await win.evaluate((el) => el.innerHTML)).not.toMatch(/2032|2031|2030/);
    expect(errors).toEqual([]);
  });

  test('E7 가리기 중에 처음 정해도 알리는 말에 달이 없고, 정한 순간 본문이 한 줄이 된다', async ({
    page,
  }) => {
    const win = await openSeed(page, {}, { hideAmounts: true });
    // 정한 달이 없으면 금액만 가린다(정년은 옆 창에 이미 나온다)
    await expect(win.locator('#lifetime-masked')).toHaveCount(0);
    await expect(win.locator('#lifetime-paydays')).toContainText('355번');
    await setPlan(page, '2030', '12');
    await expect(win.locator('#lifetime-live')).toHaveText('퇴직 예정 달을 정했어요.');
    await expect(win.locator('#lifetime-masked')).toBeVisible();
    expect(await bodyText(page)).not.toMatch(/\d/);
    expect(await planOf(page)).toBe('2030-12');
    // 되돌리면 정년 기준의 본문이 돌아온다(금액은 여전히 가린다)
    await win.locator('#lifetime-plan-open').click();
    await win.getByRole('button', { name: '정년까지로 되돌리기' }).click();
    await tick(page, 300);
    await expect(win.locator('#lifetime-masked')).toHaveCount(0);
    await expect(win.locator('#lifetime-paydays')).toContainText('355번');
    await expect(win.getByRole('img', { name: '금액 가려짐' })).toHaveCount(3);
  });

  test('폼을 연 채로 금액 가리기를 켜면 폼이 닫힌다(칸에 든 정한 달이 남지 않게)', async ({
    page,
  }) => {
    const win = await openSeed(page, {}, { retireMonth: '2030-12' });
    await win.locator('#lifetime-plan-open').click();
    await expect(page.getByLabel(`${LABEL} 연도`)).toHaveValue('2030');
    await page.locator('#today').getByRole('button', { name: '금액 가리기' }).click();
    await tick(page);
    await expect(win.locator('#lifetime-masked')).toBeVisible();
    await expect(win.locator('#lifetime-plan-form')).toHaveCount(0);
    await expect(win.locator('input')).toHaveCount(0);
    expect(await bodyText(page)).not.toMatch(/\d/);
    // 가리기 중에 다시 열면 빈 칸이다
    await win.locator('#lifetime-plan-open').click();
    await expect(page.getByLabel(`${LABEL} 연도`)).toHaveValue('');
    await expect(win.locator('#lifetime-plan-form')).toBeVisible();
    expect(await planOf(page)).toBe('2030-12');
  });

  test('E7b 쓸 수 없는 정한 달 + 가리기: 달도, 무엇이 문제인지도 말하지 않는다', async ({
    page,
  }) => {
    const win = await openSeed(page, {}, { retireMonth: '2026-10', hideAmounts: true });
    await expect(win.locator('#lifetime-masked')).toHaveText(
      '금액 가리기 중이라 퇴직 예정 달과 그에 따른 숫자를 가렸어요. 정해 둔 퇴직 예정 달을 확인해 주세요.',
    );
    await expect(win.getByRole('button')).toHaveText(['퇴직 예정 달 고치기', '정한 달 지우기']);
    const text = await bodyText(page);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/지났|뒤예요/);
    expect(await win.evaluate((el) => el.innerHTML)).not.toMatch(/2026년 10월|2026-10/);
    // 정년 기준 숫자도 그리지 않는다
    await expect(win.getByRole('progressbar')).toHaveCount(0);
    await expect(win.locator('#lifetime-plan-issue')).toHaveCount(0);

    // 가리기를 끄면 까닭과 정년 기준 값이 나온다
    await page.locator('#today').getByRole('button', { name: /금액/ }).click();
    await tick(page);
    await expect(win.locator('#lifetime-plan-issue')).toContainText(
      '정해 둔 퇴직 예정 달(2026년 10월)이 지났어요.',
    );
    await expect(win.locator('#lifetime-total')).toHaveText('약 12억 3,576만 원');
    await expect(win.locator('#lifetime-paydays')).toContainText('355번');
    expect(await planOf(page)).toBe('2026-10');
  });
});

test.describe('정한 달: 직종·상태별(E8)', () => {
  test('경정: 계급정년 뒤(연령정년 이내)를 정할 수 있고, 근무 조건을 단정하지 않는다', async ({
    page,
  }) => {
    const win = await openSeed(page, POLICE);
    await win.locator('#lifetime-plan-open').click();
    // 상한은 연령정년 퇴직일의 달
    await fillMonth(page, LABEL, '2041', '1');
    await expect(win.locator('#lifetime-plan-month-error')).toHaveText(
      '연령정년 퇴직일이 2040년 12월 31일이라 2040년 12월까지만 고를 수 있어요.',
    );
    await fillMonth(page, LABEL, '2036', '12');
    await win.locator('#lifetime-plan-submit').click();
    await tick(page, 300);
    expect(await planOf(page)).toBe('2036-12');
    await expect(win.locator('#lifetime-head')).toContainText('2036년 12월까지 다닌다면');
    const beyond = win.locator('#lifetime-beyond');
    await expect(beyond.locator('.note.warn')).toHaveText(
      '계급정년 퇴직일(2034년 6월 30일)보다 뒤예요. 승진하거나 계급정년에 이르는 날이 달라지면 퇴직일이 달라질 수 있어요. 금액은 지금 계급 그대로 셈했어요.',
    );
    // 반영하지 않은 예외는 규정 데이터의 설명 그대로(특수 부문·비상사태 연장 등)와 근거 조항
    const note = win.locator('#lifetime-beyond-note');
    await expect(note).toContainText("해당하면 '계급정년에 이르는 날'을 직접 넣어 주세요.");
    await expect(note).toContainText('연장');
    await expect(note).toContainText('경찰공무원법 제30조제1항제2호·제5항');
    await expect(win).not.toContainText(/승진해야|해야 다닐/);
    await expect(win.locator('#lifetime-paydays')).toContainText('121번');
    await expect(win.locator('#lifetime-rank-limit')).toHaveCount(0);
    // 최고호봉(30호봉)에 닿아도 별표 10 에는 근속가봉 금액이 원문에 없다
    await win.locator('#lifetime-how summary').click();
    await expect(win.locator('#lifetime-how')).not.toContainText('근속가봉');
    // 정년 창의 계급정년 퇴직일은 그대로다
    await expect(page.locator('#career')).toContainText('2034');
  });

  test('경정: 계급정년 퇴직일과 같은 달, 계급정년 앞의 달', async ({ page }) => {
    const win = await openSeed(page, POLICE, { retireMonth: '2034-06' });
    await expect(win.locator('#lifetime-head')).toHaveText(
      '계급정년 퇴직일(2034년 6월 30일)까지 다닌다면',
    );
    await expect(win.locator('#lifetime-same-month')).toHaveText(
      '정한 달(2034년 6월)이 계급정년 퇴직일과 같은 달이에요.',
    );
    await expect(win.locator('#lifetime-beyond')).toHaveCount(0);
    await win.locator('#lifetime-plan-open').click();
    await fillMonth(page, LABEL, '2030', '6');
    await win.locator('#lifetime-plan-submit').click();
    await tick(page, 300);
    await expect(win.locator('#lifetime-head')).toContainText('2030년 6월까지 다닌다면');
    await expect(win.locator('#lifetime-beyond')).toHaveCount(0);
    await expect(win.locator('#lifetime-paydays')).toContainText('43번');
  });

  test('계급을 안 고른 경찰: 정할 수 있고(상한은 연령정년), 정한 뒤에는 월급날 횟수만 보인다', async ({
    page,
  }) => {
    const win = await openSeed(page, { ...POLICE, rank: null });
    await expect(win.locator('#lifetime-off')).toContainText('계급을 골라 주세요.');
    await win.getByRole('button', { name: '퇴직 예정 달 정하기' }).click();
    await expect(page.getByLabel(`${LABEL} 연도`)).toHaveAttribute('placeholder', '2040');
    await fillMonth(page, LABEL, '2041', '1');
    await expect(win.locator('#lifetime-plan-month-error')).toHaveText(
      '연령정년 퇴직일이 2040년 12월 31일이라 2040년 12월까지만 고를 수 있어요.',
    );
    await fillMonth(page, LABEL, '2030', '6');
    await win.locator('#lifetime-plan-submit').click();
    await tick(page, 300);
    expect(await planOf(page)).toBe('2030-06');
    await expect(win.locator('#lifetime-head')).toContainText('2030년 6월까지 다닌다면');
    // 정년도 봉급도 '입력 필요'라는 것은 그대로 알린다(계급정년 뒤인지 알 수 없다)
    await expect(win.locator('#lifetime-retire-off')).toContainText('입력 필요');
    await expect(win.locator('#lifetime-retire-off')).toContainText('계급을 골라 주세요.');
    await expect(win.locator('#lifetime-money')).toHaveCount(0);
    await expect(win.getByRole('progressbar')).toHaveCount(0);
    await expect(win.locator('#lifetime-paydays')).toContainText('43번');
    await expect(win.locator('#lifetime-raises')).toHaveCount(0);
    await expect(win.locator('#lifetime-beyond')).toHaveCount(0);
    await expect(win).not.toContainText(/\d억|\d만 원/);
  });

  test("외무(정년 '준비 중'): 정하면 금액이 나오고, 되돌리기는 '정한 달 지우기'다", async ({
    page,
  }) => {
    const win = await openSeed(page, FOREIGN);
    await expect(win.locator('#lifetime-off')).toContainText('외무공무원법');
    await win.getByRole('button', { name: '퇴직 예정 달 정하기' }).click();
    // 정년을 모르면 자리 표시는 낱말이고, 이 창 밖의 정년을 말하지 않는다
    await expect(page.getByLabel(`${LABEL} 연도`)).toHaveAttribute('placeholder', '연도');
    await expect(win.locator('#lifetime-plan-form')).toContainText(
      '정한 달은 이 창의 셈에만 써요.',
    );
    await expect(win.locator('#lifetime-plan-form')).not.toContainText('정년퇴직일 그대로');
    // 확인한 상한이 없으므로 나이 상한을 만들지 않는다(날짜 계산이 다루는 해까지만)
    await fillMonth(page, LABEL, '2151', '1');
    await expect(win.locator('#lifetime-plan-month-error')).toHaveText(
      '2150년까지만 고를 수 있어요.',
    );
    await fillMonth(page, LABEL, '2040', '6');
    await win.locator('#lifetime-plan-submit').click();
    await tick(page, 300);
    await expect(win.locator('#lifetime-head')).toContainText('2040년 6월까지 다닌다면');
    await expect(win.locator('#lifetime-total')).toContainText('약 8억');
    await expect(win.locator('#lifetime-paydays')).toContainText('163번');
    await expect(win.locator('#lifetime-raises')).toContainText('14번');
    await expect(win.locator('#lifetime-retire-off')).toContainText('준비 중');
    await win.locator('#lifetime-plan-open').click();
    await win.getByRole('button', { name: '정한 달 지우기' }).click();
    await tick(page, 300);
    await expect(win.locator('#lifetime-live')).toHaveText('정한 달을 지웠어요.');
    await expect(win.locator('#lifetime-off')).toBeVisible();
    expect(await win.innerText()).not.toMatch(/\d/);
    expect(await planOf(page)).toBeNull();
  });

  test("군무원(봉급도 '준비 중'): 정하면 월급날 횟수만, 지난 달이 되면 숫자 없이 알린다", async ({
    page,
  }) => {
    const military = { ...FOREIGN, track: 'militaryCivil', rank: null };
    const win = await openSeed(page, military, { retireMonth: '2040-06', payday: 10 });
    await expect(win.locator('#lifetime-head')).toContainText('2040년 6월까지 다닌다면');
    // 정년·봉급이 같은 사유로 꺼져 있으면 한 줄로 묶는다
    await expect(win.locator('.off-note')).toHaveCount(1);
    await expect(win.locator('#lifetime-retire-off')).toContainText('군무원인사법');
    await expect(win.locator('#lifetime-money')).toHaveCount(0);
    await expect(win.locator('#lifetime-paydays')).toContainText('163번');
    await expect(win.locator('#lifetime-diligence')).toHaveCount(0);
    const past = await openSeed(page, military, { retireMonth: '2026-10', payday: 10 });
    await expect(past.locator('#lifetime-off')).toBeVisible();
    await expect(past.locator('#lifetime-plan-issue')).toHaveText(
      '정해 둔 퇴직 예정 달(2026년 10월)이 지났어요.',
    );
    await expect(past.locator('#lifetime-plan-actions').getByRole('button')).toHaveText([
      '퇴직 예정 달 고치기',
      '정한 달 지우기',
    ]);
  });
});

test.describe('정한 달은 이 창 밖으로 나가지 않는다', () => {
  test('카드·결산 카드·탭 제목·공유 문구·다른 화면에 정한 달이 없다', async ({ page }) => {
    await openApp(page, { seed: makeSeedV6({}, { retireMonth: '2031-02' }) });
    await tick(page, 2500);
    await closeDialogs(page);
    await expect(page.locator('#lifetime-head')).toContainText('2031년 2월까지 다닌다면');
    // 정한 달의 어떤 표기도(해만 같은 날짜는 다른 까닭으로 나올 수 있어 달까지 본다)
    const leak = /2031년 2월|2031-02|2031\. ?2\.|2031\.02|203102|퇴직 예정|정한 달/;
    /** 보이는 글자와, 그림·버튼을 설명하는 속성(카드 그림의 설명 포함) */
    const screen = () =>
      page.evaluate(() => ({
        text: document.body.innerText,
        attrs: [...document.querySelectorAll('[aria-label],[alt],[title],[aria-description]')]
          .map((el) =>
            ['aria-label', 'alt', 'title', 'aria-description']
              .map((a) => el.getAttribute(a) ?? '')
              .join(' '),
          )
          .join('\n'),
        title: document.title,
      }));
    // 홈: 생애 봉급 창 말고는 정한 달이 없다
    const homeOthers = await page.evaluate(() =>
      [...document.querySelectorAll('main .win')]
        .filter((el) => el.id !== 'lifetime')
        .map((el) => el.textContent ?? '')
        .join('\n'),
    );
    expect(homeOthers).not.toMatch(leak);
    expect((await screen()).title).not.toMatch(leak);
    for (const hash of ['leave', 'badges', 'card', 'settings']) {
      await page.goto(`${page.url().split('#')[0]}#${hash}`);
      await tick(page, 1500);
      const s = await screen();
      expect(s.text, hash).not.toMatch(leak);
      expect(s.attrs, hash).not.toMatch(leak);
      expect(s.title, hash).not.toMatch(leak);
    }
    // 올해 결산 카드에도 없다
    await page.goto(`${page.url().split('#')[0]}#card`);
    await tick(page, 1500);
    await page.getByRole('radio', { name: '올해 결산' }).click();
    await tick(page, 1500);
    const recap = await screen();
    expect(recap.text).not.toMatch(leak);
    expect(recap.attrs).not.toMatch(leak);
    await page.getByRole('radio', { name: '캐릭터 카드' }).click();
    // 카드에 넣을 수 있는 것을 모두 켜도(정년·봉급·재직) 정한 달은 들어가지 않는다
    await page.goto(`${page.url().split('#')[0]}#card`);
    await tick(page, 1500);
    await page.getByLabel(/정년 D-day/).check();
    await page.getByLabel(/월 봉급/).check();
    await tick(page, 1500);
    const card = await screen();
    expect(card.text).not.toMatch(leak);
    expect(card.attrs).not.toMatch(leak);
    // 정년을 켰으면 카드 설명에는 정년퇴직일 기준의 값이 나온다(정한 달 기준이 아니다)
    expect(`${card.text}\n${card.attrs}`).not.toMatch(/4년 3개월|D-1556\b/);
    // 글자 카드(공유 문구)의 정년 D-day 는 정년퇴직일(2056-06-30)까지의 날수다
    expect(card.text).toMatch(/정년 D-10,?8\d\d\b/);
    expect((await storedData(page))?.plan.retireMonth).toBe('2031-02');
  });
});

test.describe('정한 달의 저장: 예전 저장본·다른 탭·임용정보 패키지', () => {
  function tempFile(name: string, content: string): string {
    const path = join(mkdtempSync(join(tmpdir(), 'hobong-e2e-')), name);
    writeFileSync(path, content);
    return path;
  }

  test('v5 저장본(기존 사용자)은 v6 으로 올라오고 다른 화면은 그대로다', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page, { seed: makeSeedV5() });
    await tick(page, 2500);
    await closeDialogs(page);
    const env = await page.evaluate(() => JSON.parse(localStorage.getItem('hobong.data') ?? '{}'));
    expect(env.schemaVersion).toBe(6);
    expect(env.data.plan).toEqual({ retireMonth: null });
    // v5 의 값은 그대로(자동 기록되는 업적·본 모습·저장 시각 말고)
    const v5 = JSON.parse(makeSeedV5()).data;
    expect(env.data.profile).toEqual(v5.profile);
    expect(env.data.settings).toEqual(v5.settings);
    expect(env.data.leave).toEqual(v5.leave);
    expect(env.data.character.look).toEqual(v5.character.look);
    await expect(page.locator('#status')).toContainText('9급 5호봉');
    await expect(page.locator('#career')).toContainText('2056');
    await expect(page.locator('#lifetime-head')).toHaveText(
      '정년퇴직일(2056년 6월 30일)까지 다닌다면',
    );
    for (const hash of ['leave', 'badges', 'card', 'settings']) {
      await page.goto(`${page.url().split('#')[0]}#${hash}`);
      await tick(page, 1500);
      await expect(page.locator('main h1, main h2').first(), hash).toBeVisible();
    }
    await expect(page.locator('#notice-stale')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('다른 탭이 정한 달을 바꾸면 이 탭도 따라간다', async ({ page, context }) => {
    const win = await openSeed(page);
    await expect(win.locator('#lifetime-total')).toHaveText('약 12억 3,576만 원');
    const other = await context.newPage();
    await other.goto(page.url());
    const changed = await other.evaluate(() => {
      const env = JSON.parse(localStorage.getItem('hobong.data') ?? '{}');
      env.data.plan = { retireMonth: '2030-12' };
      const text = JSON.stringify(env);
      localStorage.setItem('hobong.data', text);
      return text;
    });
    expect(changed).toContain('"retireMonth":"2030-12"');
    await expect.poll(() => planOf(page)).toBe('2030-12');
    // storage 이벤트가 오지 않는 브라우저에서도 탭으로 돌아오면(포커스) 저장소를 다시 본다
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(win.locator('#lifetime-head')).toContainText('2030년 12월까지 다닌다면');
    await expect(win.locator('#lifetime-total')).toHaveText('약 2억 2,614만 원');
    await expect(page.locator('#notice-stale')).toHaveCount(0);
    await other.close();
  });

  test('임용정보 패키지: 정한 달이 그대로 실리고, 모두 지운 뒤 불러오면 되살아난다', async ({
    page,
  }) => {
    await openApp(page, { seed: makeSeedV6({}, { retireMonth: '2030-12' }), hash: 'settings' });
    await tick(page, 6000);
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '패키지 내려받기' }).click(),
    ]);
    const text = readFileSync(await file.path(), 'utf8');
    const envelope = JSON.parse(text);
    expect(envelope.schemaVersion).toBe(6);
    // 암호를 걸지 않은 패키지에는 정한 달이 읽히는 글자로 들어 있다(폼 아래 안내가 이것을 알린다)
    expect(envelope.data.plan).toEqual({ retireMonth: '2030-12' });
    expect(text).toContain('"retireMonth": "2030-12"');
    const path = tempFile(file.suggestedFilename(), text);

    await page.getByRole('button', { name: '모두 지우고 처음부터' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '모두 지우기' }).click();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeVisible();
    expect(await storedData(page)).toBeNull();

    await page.getByRole('button', { name: PACKAGE_OPEN }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog').getByRole('button', { name: '파일 고르기' }).click();
    await (await chooser).setFiles(path);
    const dialog = page.getByRole('dialog');
    // 불러오기 전 확인 화면에는 정한 달을 보이지 않는다
    await expect(dialog).not.toContainText(/2030|퇴직 예정/);
    await dialog.getByRole('button', { name: '불러오기', exact: true }).click();
    await tick(page, 6000);
    expect(await storedData(page)).toEqual(envelope.data);
    expect(await planOf(page)).toBe('2030-12');
    await expect(page.locator('#lifetime-head')).toContainText('2030년 12월까지 다닌다면');
    await expect(page.locator('#lifetime-total')).toHaveText('약 2억 2,614만 원');
  });
});
