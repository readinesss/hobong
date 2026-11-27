/**
 * #30 '생애 봉급' 창(묶음 1: 정년 기준) — 설계서 §7.5 의 E1~E3, E8(정년 기준 부분), E9, E11.
 * 고정 시각은 2026-11-25(수) 10:30 — 25일이라 기본 시드(월급날 25일)에게는 월급날이다.
 * 반응형(E10)은 responsive.spec.ts, 외부 요청 0건(E12)은 offline.spec.ts 가 홈 화면째로 본다.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  closeDialogs,
  collectErrors,
  makeSeedV5,
  openApp,
  storedData,
  tick,
  type SeedProfileV4,
} from './helpers.ts';

async function openSeed(page: Page, profile: SeedProfileV4 = {}, time?: string): Promise<Locator> {
  await openApp(page, { seed: makeSeedV5(profile), ...(time ? { time } : {}) });
  await tick(page, 2500);
  await closeDialogs(page);
  return page.locator('#lifetime');
}

/** '약 12억 3,576만 원' → 123576(만 원) */
function toMan(text: string): number {
  const m = /약\s*(?:(\d+)억)?\s*(?:([\d,]+)만)?\s*원/.exec(text);
  if (!m) throw new Error(`금액을 읽지 못했습니다: ${text}`);
  return Number(m[1] ?? 0) * 10_000 + Number((m[2] ?? '0').replaceAll(',', ''));
}

const TEACHER: SeedProfileV4 = {
  track: 'teacher',
  payTable: null,
  rank: '교원',
  birthDate: '1985-05-20',
  hireDate: '2010-03-01',
  rankDate: '2010-03-01',
  step: 25,
  nextStepDate: '2027-03-01',
};
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

test.describe('생애 봉급 창', () => {
  test('E1 기본 시드: 금액 셋이 더해서 맞고, 횟수와 고지가 나온다', async ({ page }) => {
    const errors = collectErrors(page);
    const win = await openSeed(page);
    await expect(win.getByRole('heading', { name: '생애 봉급' })).toBeVisible();
    await expect(win.locator('#lifetime-head')).toHaveText(
      '정년퇴직일(2056년 6월 30일)까지 다닌다면',
    );
    await expect(win.locator('#lifetime-total')).toHaveText('약 12억 3,576만 원');
    await expect(win.locator('#lifetime-earned')).toHaveText('약 1억 1,076만 원');
    // 만 원 단위 뺄셈(123,576 − 11,076). 세 값을 따로 버리면 2,499만이 되어 합이 1만 원 모자란다
    await expect(win.locator('#lifetime-remaining')).toHaveText('약 11억 2,500만 원');
    const total = toMan(await win.locator('#lifetime-total').innerText());
    const earned = toMan(await win.locator('#lifetime-earned').innerText());
    const remaining = toMan(await win.locator('#lifetime-remaining').innerText());
    expect(earned + remaining).toBe(total);

    const bar = win.getByRole('progressbar', { name: '생애 봉급(추정) 가운데 지금까지 번 만큼' });
    await expect(bar).toHaveAttribute('aria-valuetext', '8%');
    await expect(bar).toHaveAttribute('aria-valuenow', '8');
    await expect(win.locator('#lifetime-percent')).toHaveText('8%');

    await expect(win.locator('#lifetime-paydays')).toContainText('355번');
    await expect(win.locator('#lifetime-paydays')).toContainText('오늘이 51번째 월급날이에요');
    await expect(win.locator('#lifetime-raises')).toContainText('26번');
    await expect(win.locator('#lifetime-raises')).toContainText('2052년 1월에 최고호봉');
    await expect(win.locator('#lifetime-diligence')).toHaveText('59번');
    // 말하는 이 이름표는 쌍점으로 문장과 나눈다
    await expect(win.locator('#lifetime-line')).toHaveText(
      '호봉이: 기간은 12% 지났는데 봉급은 8% 받았어요. 승급할수록 뒤쪽 달이 더 두둑해요.',
    );

    const notice = win.locator('#lifetime-notice');
    await expect(notice).toContainText('봉급만의 합계예요');
    await expect(notice).toContainText('실제로 받는 돈이 아니에요');
    await expect(notice).toContainText('퇴직급여(연금·퇴직수당)');
    await expect(notice).toContainText('임용일부터 퇴직 때까지 지금 직급과 2026년 봉급표');
    // 낭독 요약은 창(영역)의 설명이다. 본문에서 첫 줄·금액을 두 번 읽지 않게 숨겨 둔다
    await expect(win.locator('#lifetime-summary')).toHaveText(
      '정년퇴직일(2056년 6월 30일)까지 다닌다면 봉급만 셈한 생애 봉급 추정 합계는 약 12억 3,576만 원이고, 지금까지 약 1억 1,076만 원, 8%를 벌었어요.',
    );
    await expect(win).toHaveAttribute('aria-describedby', 'lifetime-summary');
    await expect(win.locator('#lifetime-summary')).toBeHidden();
    // 정년 기준이면 견줘 볼 줄이 없다
    await expect(win.locator('#lifetime-compare')).toHaveCount(0);
    // 받는 돈 전체처럼 읽히는 이름을 쓰지 않는다
    await expect(win).not.toContainText(/소득|연봉|수입/);
    // 예전(v5) 저장본은 열 때 v6 으로 올라가고, 퇴직 예정 달은 없음(정년까지)이다
    expect((await storedData(page))?.plan).toEqual({ retireMonth: null });
    await expect(win.locator('#lifetime-plan-tag')).toHaveCount(0);
    await expect(win.getByRole('button', { name: '퇴직 예정 달 정하기' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('E1 창의 자리: 정년까지의 길 바로 아래', async ({ page }) => {
    await openSeed(page);
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main .win')]
        .map((el) => ({ id: el.id, box: el.getBoundingClientRect() }))
        .sort((a, b) => a.box.left - b.box.left || a.box.top - b.box.top)
        .map((w) => w.id),
    );
    expect(ids.indexOf('lifetime')).toBe(ids.indexOf('career') + 1);
  });

  test('E2 지갑 창의 "지금까지 번 봉급"과 같은 글자다', async ({ page }) => {
    const win = await openSeed(page);
    const wallet = page
      .locator('#wallet .kv')
      .filter({ hasText: '지금까지 번 봉급' })
      .locator('dd');
    const mine = win.locator('.kv').filter({ hasText: '지금까지 번 봉급' }).locator('dd');
    expect(await mine.innerText()).toBe(await wallet.innerText());
    // 정년퇴직일이 지난 사람도 같다(둘 다 정년퇴직일에서 멈춘다)
    await openSeed(page, {
      birthDate: '1966-03-10',
      hireDate: '1990-05-10',
      rank: '6',
      step: 32,
      nextStepDate: '2026-12-01',
    });
    expect(await mine.innerText()).toBe(await wallet.innerText());
    expect(await mine.innerText()).toBe('약 16억 1,965만 원');
  });

  test('E3 금액 가리기: 금액 셋만 가리고 막대·횟수·한마디는 보인다', async ({ page }) => {
    const win = await openSeed(page);
    await page.locator('#today').getByRole('button', { name: '금액 가리기' }).click();
    await tick(page);
    expect((await storedData(page))?.settings.hideAmounts).toBe(true);
    await expect(win.getByRole('img', { name: '금액 가려짐' })).toHaveCount(3);
    await expect(win).not.toContainText(/\d억|\d만 원/);
    await expect(win.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '8%');
    await expect(win.locator('#lifetime-paydays')).toContainText('355번');
    await expect(win.locator('#lifetime-raises')).toContainText('26번');
    await expect(win.locator('#lifetime-diligence')).toHaveText('59번');
    await expect(win.locator('#lifetime-line')).toBeVisible();
    await expect(win.locator('#lifetime-head')).toContainText('2056년 6월 30일');
    await expect(win.locator('#lifetime-summary')).toHaveText(
      '정년퇴직일(2056년 6월 30일)까지 다닌다면 봉급만 셈한 생애 봉급의 8%를 벌었어요. 금액은 가려져 있어요.',
    );
    // 저장된 퇴직 예정 달이 없으므로 본문을 한 줄로 줄이지 않는다
    await expect(win.locator('#lifetime-masked')).toHaveCount(0);
  });

  test('자세한 가정: 접혀 있다가 열면 가정·근거가 나온다(확정으로 말하지 않는 것들)', async ({
    page,
  }) => {
    const win = await openSeed(page);
    const how = win.locator('#lifetime-how');
    await expect(how).not.toHaveAttribute('open', '');
    await how.locator('summary').click();
    await expect(how).toHaveAttribute('open', '');
    await expect(how).toContainText('퇴직까지 해가 30번 바뀌어요');
    await expect(how).toContainText('봉급표는 공무원보수규정이 개정되면 바뀌고');
    await expect(how).toContainText('최고호봉 31호봉까지');
    await expect(how).toContainText('정년퇴직일 당일까지 봉급을 셌어요');
    await expect(how).toContainText('5년 이상 근속하고 그 달에 15일 이상 근무했는지에 따라');
    await expect(how).toContainText('월급날(25일)이 그대로라고 보고 셌어요');
    await expect(how).toContainText(
      '1월 1일·7월 1일에 재직 중이고 그 앞 6개월 가운데 1개월 이상 봉급을 받은 것만 셌어요',
    );
    await expect(how).toContainText('국가공무원법 제74조');
    // 근속가봉 금액이 원문에 없는 봉급표(별표 3)에는 근속가봉을 말하지 않는다
    await expect(how).not.toContainText('근속가봉');
    await expect(win).not.toContainText(/해마다|새 봉급표가|승진해야|백업/);
  });

  test('올해 봉급표가 아직 없으면(2027년 1월) 이전 연도 표로 셈했다고 알린다', async ({ page }) => {
    const win = await openSeed(page, {}, '2027-01-05T10:30:00+09:00');
    await expect(win.locator('#lifetime-total')).toHaveText('약 12억 3,576만 원');
    await expect(win.locator('#lifetime-pending')).toHaveText(
      '2027년 봉급표가 아직 반영되지 않아 2026년 표로 셈했어요.',
    );
    await expect(win.locator('#lifetime-paydays')).toContainText('354번');
    await expect(win.locator('#lifetime-paydays')).toContainText('지금까지 52번');
  });
});

test.describe('생애 봉급 창: 직종·상태별(E8·E9)', () => {
  test('교원: 8월 31일 퇴직, 계급을 말하지 않는 고지, 근속가봉은 넣지 않았다고 밝힌다', async ({
    page,
  }) => {
    const win = await openSeed(page, TEACHER);
    await expect(win.locator('#lifetime-head')).toHaveText(
      '정년퇴직일(2047년 8월 31일)까지 다닌다면',
    );
    await expect(win.locator('#lifetime-raises')).toContainText('15번');
    await expect(win.locator('#lifetime-raises')).toContainText('2041년 3월에 최고호봉');
    const notice = win.locator('#lifetime-notice');
    await expect(notice).toContainText('임용일부터 퇴직 때까지 2026년 봉급표 그대로');
    await expect(notice).toContainText('봉급 인상도 넣지 않았어요.');
    await expect(notice).not.toContainText('승진');
    await win.locator('#lifetime-how summary').click();
    await expect(win.locator('#lifetime-how')).toContainText(
      '최고호봉 뒤에 붙을 수 있는 근속가봉(공무원보수규정 제30조의2)은 넣지 않았어요.',
    );
    await expect(win.locator('#lifetime-how')).toContainText('교육공무원법 제47조');
  });

  test('경정: 계급정년 퇴직일이 끝나는 날, 승진하면 달라질 수 있다고만 말한다', async ({
    page,
  }) => {
    const win = await openSeed(page, POLICE);
    await expect(win.locator('#lifetime-head')).toHaveText(
      '계급정년 퇴직일(2034년 6월 30일)까지 다닌다면',
    );
    await expect(win.locator('#lifetime-rank-limit')).toHaveText(
      '승진하면 퇴직일도 금액도 달라질 수 있어요. 연령정년 퇴직일은 2040년 12월 31일이에요. 그날까지로 보고 싶으면 퇴직 예정 달을 정해 보세요.',
    );
    await expect(win.locator('#lifetime-total')).toHaveText('약 16억 5,620만 원');
    await expect(win.locator('#lifetime-paydays')).toContainText('91번');
    await expect(win.locator('#lifetime-diligence')).toHaveText('15번');
    await expect(win.locator('#lifetime-notice')).toContainText('지금 계급과 2026년 봉급표');
    await win.locator('#lifetime-how summary').click();
    const how = win.locator('#lifetime-how');
    // 퇴직 전 최고호봉(30호봉)에 닿지만 별표 10 에는 근속가봉 금액이 원문에 없다
    await expect(win.locator('#lifetime-raises')).toContainText('2034년 4월에 최고호봉');
    await expect(how).not.toContainText('근속가봉');
    await expect(how).toContainText('경찰공무원법 제30조제1항제2호');
    await expect(win).not.toContainText('승진해야');
    await expect(win.getByRole('button', { name: '퇴직 예정 달 정하기' })).toBeVisible();
  });

  test("정년이 '입력 필요'·'준비 중'이면 숫자가 하나도 나오지 않는다", async ({ page }) => {
    for (const [profile, label, reason] of [
      [{ ...POLICE, rank: null }, '입력 필요', '계급을 골라 주세요.'],
      [
        { ...POLICE, track: 'foreign', rank: '3', rankDate: '2005-04-01', step: 9 },
        '준비 중',
        '외무공무원법',
      ],
      [{ ...POLICE, track: 'militaryCivil', rank: null }, '준비 중', '군무원인사법'],
      [{ ...POLICE, track: 'otherSpecial', rank: null }, '준비 중', ''],
    ] as const) {
      const win = await openSeed(page, profile);
      const off = win.locator('#lifetime-off');
      await expect(off, profile.track).toBeVisible();
      await expect(off.locator('.off-note').first(), profile.track).toContainText(label);
      if (reason) await expect(off, profile.track).toContainText(reason);
      expect(await win.innerText(), profile.track).not.toMatch(/\d/);
      await expect(win.getByRole('progressbar'), profile.track).toHaveCount(0);
      await expect(win.locator('#lifetime-how'), profile.track).toHaveCount(0);
      // 끝나는 날을 정할 길은 있다: 퇴직 예정 달을 정하면 그 달 말일까지로 셈한다
      await expect(off, profile.track).toContainText(
        '퇴직 예정 달을 정하면 그 달 말일까지로 셈해 드려요.',
      );
      await expect(win.getByRole('button'), profile.track).toHaveText(['퇴직 예정 달 정하기']);
    }
  });

  test('최고호봉: 남은 정기승급이 없다고 쓰고, 한마디는 사실만 말한다', async ({ page }) => {
    const win = await openSeed(page, {
      birthDate: '1970-03-10',
      hireDate: '1994-05-10',
      rank: '6',
      rankDate: '2010-01-01',
      step: 32,
      nextStepDate: '2027-05-01',
    });
    await expect(win.locator('#lifetime-raises')).toContainText('없음');
    await expect(win.locator('#lifetime-raises')).toContainText('지금 최고호봉이에요');
    await expect(win.locator('#lifetime-line')).toContainText('지났는데 봉급은');
    await expect(win.locator('#lifetime-line')).not.toContainText('승급할수록');
  });

  test('올해 임용: 번 돈이 1%가 안 되면 "1% 미만", 첫 월급날 전이면 그렇게 말한다', async ({
    page,
  }) => {
    const win = await openSeed(page, {
      birthDate: '2001-03-14',
      hireDate: '2026-11-16',
      rank: '9',
      rankDate: '2026-11-16',
      step: 1,
      nextStepDate: '2027-12-01',
    });
    await expect(win.locator('#lifetime-percent')).toHaveText('1% 미만');
    await expect(win.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1% 미만');
    await expect(win.locator('#lifetime-paydays')).toContainText('오늘이 첫 월급날이에요');
    await expect(win.locator('#lifetime-line')).toHaveCount(0);
    // 임용일이 그 달 월급날(25일) 뒤면 그 달 월급날은 세지 않는다
    const late = await openSeed(
      page,
      {
        birthDate: '2001-03-14',
        hireDate: '2026-11-26',
        rank: '9',
        rankDate: '2026-11-26',
        step: 1,
        nextStepDate: '2027-12-01',
        stepAsOf: '2026-11-26',
      },
      '2026-11-27T10:30:00+09:00',
    );
    // 받은 월급날이 없으면 '(지금까지 0번)' 대신 다가오는 첫 월급날(12월 25일이 공휴일이라 24일)
    await expect(late.locator('#lifetime-paydays')).toContainText('첫 월급날 12월 24일');
    await expect(late.locator('#lifetime-paydays')).not.toContainText('0번');
    await expect(late.locator('#lifetime-line')).toContainText('첫 월급날이 다가오고 있어요.');
  });

  test('E9 정년퇴직일이 지남: 막대 100%, 받은 월급날, 남은 줄 없음', async ({ page }) => {
    const errors = collectErrors(page);
    const win = await openSeed(page, {
      birthDate: '1966-03-10',
      hireDate: '1990-05-10',
      rank: '6',
      rankDate: '2010-01-01',
      step: 32,
      nextStepDate: '2026-12-01',
    });
    await expect(win.locator('#lifetime-head')).toHaveText('정년퇴직일(2026년 6월 30일)까지');
    await expect(win.locator('#lifetime-total')).toHaveText('약 16억 1,965만 원');
    const bar = win.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', '100');
    await expect(bar).toHaveAttribute('aria-valuetext', '100%');
    await expect(win.locator('#lifetime-counts')).toContainText('받은 월급날');
    await expect(win.locator('#lifetime-paydays')).toHaveText('434번');
    // 앞날에 관한 줄·말이 없다(접어 둔 자세한 가정까지)
    await expect(win).not.toContainText(/남은|앞으로/);
    await expect(win.locator('#lifetime-line')).toContainText(
      '마지막 월급날까지 다 받았어요. 오래 애쓰셨어요.',
    );
    await expect(win.getByRole('button')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('생애 봉급 창: 접근성(E11)', () => {
  test('막대의 역할·이름표, 창 제목과 영역 이름', async ({ page }) => {
    const win = await openSeed(page);
    await expect(page.getByRole('region', { name: '생애 봉급' })).toBeVisible();
    const bar = win.getByRole('progressbar', { name: '생애 봉급(추정) 가운데 지금까지 번 만큼' });
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');
    // 보이는 % 글자는 낭독에서 빼고(막대가 같은 값을 읽는다), 금액 줄은 이름·값 짝(dl)이다
    await expect(win.locator('#lifetime-percent')).toHaveAttribute('aria-hidden', 'true');
    await expect(win.locator('#lifetime-money dl dt')).toHaveText([
      '지금까지 번 봉급',
      '앞으로 벌 봉급',
    ]);
  });

  test('키보드만으로 자세한 가정을 열고 닫는다', async ({ page }) => {
    const win = await openSeed(page);
    const summary = win.locator('#lifetime-how summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(win.locator('#lifetime-how')).toHaveAttribute('open', '');
    await expect(win.locator('#lifetime-how dl')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(win.locator('#lifetime-how')).not.toHaveAttribute('open', '');
    // 누르는 영역은 44px 이상
    const box = await summary.boundingBox();
    expect(box && box.height >= 44).toBe(true);
  });
});
