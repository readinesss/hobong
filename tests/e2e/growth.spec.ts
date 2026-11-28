import { expect, test, type Page } from '@playwright/test';
import {
  fillDate,
  makeSeed,
  makeSeedV4,
  makeSeedV5,
  openApp,
  startForm,
  storedData,
  tick,
  wakeEgg,
  APP_URL,
  NOW,
} from './helpers.ts';

/**
 * 저장본을 넣고, 시계를 세운 채(page.clock.pauseAt) 다시 연다. 연출의 단계 시각을 tick 으로만 흘려 본다
 * (openApp 의 시계는 세우지 않아 실제 시간과 함께 흐른다 — 0.2초 간격의 단계를 보는 단언이 부하에서 흔들린다).
 */
async function openPaused(page: Page, seed: string, time: string): Promise<void> {
  const at = Date.parse(time);
  await page.clock.install({ time: new Date(at - 60_000) });
  await page.goto(APP_URL);
  await page.evaluate((value) => window.localStorage.setItem('hobong.data', value), seed);
  await page.clock.pauseAt(new Date(at));
  await page.reload();
}

test.describe('승급과 시간의 흐름', () => {
  test('승급일이 지나면 호봉이 오르고 승급 연출이 한 번 나온다', async ({ page }) => {
    // 저장된 기준: 5호봉, 다음 승급일 2027-01-01. 2027-01-04(월)에 연다.
    await openApp(page, { seed: makeSeed(), time: '2027-01-04T09:30:00+09:00' });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('승급했어요');
    await expect(dialog).toContainText('9급 6호봉');
    await expect(dialog).toContainText('안경'); // 6호봉에 열리는 소품
    await expect(dialog).toContainText('5호봉에서 6호봉으로 올랐어요. 깃이 하나 더 자랐어요.');
    await dialog.getByRole('button', { name: '확인' }).click();
    await tick(page);

    await expect(page.locator('#status')).toContainText('9급 6호봉');
    // 2027년 봉급표는 아직 없으므로 2026년 표로 계산하고 그 사실을 알린다
    await expect(page.locator('#wallet')).toContainText('2,264,600원');
    await expect(page.locator('#wallet')).toContainText(
      '2027년 봉급표가 아직 반영되지 않아 2026년 표로 계산했어요',
    );
    // 저장된 입력값은 그대로이고(파생 값은 저장하지 않는다) 연출을 본 기록만 남는다
    const data = await storedData(page);
    expect(data?.profile).toMatchObject({ step: 5, nextStepDate: '2027-01-01' });
    expect(data?.character).toMatchObject({ lastRank: '9', lastStep: 6 });

    await page.reload();
    await tick(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('오래 열지 않아 두 호봉을 한 번에 넘으면 자란 깃의 수를 그대로 말한다', async ({ page }) => {
    // 5호봉, 다음 승급일 2027-01-01 → 2028-01-04(화)에는 7호봉
    await openApp(page, { seed: makeSeed(), time: '2028-01-04T09:30:00+09:00' });
    const dialog = page.getByRole('dialog').filter({ hasText: '승급했어요' });
    await expect(dialog).toContainText('9급 7호봉');
    await expect(dialog).toContainText('5호봉에서 7호봉으로 올랐어요. 깃이 2개 더 자랐어요.');
  });

  test('미뤄진 승급일(1년보다 먼 날)을 넣어도 지금 호봉은 넣은 값 그대로다', async ({ page }) => {
    await openApp(page);
    await startForm(page);
    await page.getByLabel('닉네임').fill('김주무관');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2022-09-01');
    await page.getByLabel('현재 직급').selectOption('9');
    await page.getByLabel('현재 호봉', { exact: true }).fill('5');
    // 휴직으로 승급이 밀렸다: 13개월 뒤
    await fillDate(page, '다음 승급일', '2027-12-01');
    await wakeEgg(page);
    await tick(page);

    await expect(page.locator('#status')).toContainText('9급 5호봉');
    await expect(page.locator('#wallet')).toContainText('2,226,100원');
    await expect(page.locator('#growth')).toContainText('2027. 12. 1.');
    expect((await storedData(page))?.profile).toMatchObject({
      step: 5,
      nextStepDate: '2027-12-01',
      stepAsOf: '2026-11-25',
    });

    // 한 해가 지나도 승급일 전까지는 5호봉이다
    await page.clock.setFixedTime(new Date('2027-11-29T10:00:00+09:00'));
    await page.reload();
    await tick(page, 3000);
    const back = page.getByRole('dialog');
    if ((await back.count()) > 0) await back.getByRole('button', { name: '확인' }).click();
    await tick(page);
    await expect(page.locator('#status')).toContainText('9급 5호봉');
  });

  test('내 정보를 열어 그대로 저장하면 호봉 기준점이 바뀌지 않는다', async ({ page }) => {
    // 저장된 기준: 5호봉, 다음 승급 2027-01-01. 2027-03-10에 열면 6호봉으로 보인다.
    await openApp(page, { seed: makeSeed(), hash: 'settings', time: '2027-03-10T10:00:00+09:00' });
    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i += 1) {
      await page.getByRole('dialog').getByRole('button').last().click();
      await tick(page);
    }
    const before = (await storedData(page))?.profile;
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const form = page.getByRole('dialog');
    await expect(form.getByLabel('현재 호봉', { exact: true })).toHaveValue('6');
    await expect(form.getByLabel('다음 승급일 연도')).toHaveValue('2028');
    await form.getByLabel('닉네임').fill('새이름');
    await form.getByRole('button', { name: '저장' }).click();
    await tick(page);
    const after = (await storedData(page))?.profile;
    expect(after).toEqual({ ...before, nickname: '새이름' });
  });

  test('계급정년 날짜(화면에 칸 없음)가 승진일보다 일러도 내 정보를 고쳐 저장할 수 있고, 그 값은 남는다', async ({
    page,
  }) => {
    const seed = JSON.parse(
      makeSeedV4({ hireDate: '2015-03-02', rank: '7', rankDate: '2021-07-01', step: 9 }),
    );
    seed.data.profile.overrides.rankLimitDate = '2024-01-01';
    await openApp(page, { seed: JSON.stringify(seed), hash: 'settings' });
    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i += 1) {
      await page.getByRole('dialog').getByRole('button').last().click();
      await tick(page);
    }
    // 저장본은 손상으로 옮겨지지 않았다
    expect(await page.evaluate(() => localStorage.getItem('hobong.corrupt'))).toBeNull();
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const form = page.getByRole('dialog');
    await fillDate(page, '현 직급 임용일(승진일)', '2025-07-01');
    await form.getByRole('button', { name: '저장' }).click();
    await tick(page);
    await expect(form).toHaveCount(0);
    const after = (await storedData(page))?.profile;
    expect(after?.rankDate).toBe('2025-07-01');
    expect(after?.overrides.rankLimitDate).toBe('2024-01-01');
  });

  test('최고호봉이면 다음 승급일 대신 최고호봉이 된 날을 묻는다', async ({ page }) => {
    await openApp(page);
    await startForm(page);
    await page.getByLabel('닉네임').fill('왕고참');
    await fillDate(page, '생년월일', '1968-03-02');
    await fillDate(page, '임용일', '1993-03-02');
    await page.getByLabel('현재 직급').selectOption('9');
    await page.getByLabel('현재 호봉', { exact: true }).fill('31');
    await expect(page.getByLabel('최고호봉이 된 날 연도')).toBeVisible();
    await expect(page.getByLabel('다음 승급일 연도')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /모르겠어요/ })).toHaveCount(0);
    // 앞날은 받지 않는다
    await fillDate(page, '최고호봉이 된 날', '2027-03-01');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await expect(page.locator('#pf-next-error')).toContainText('최고호봉이 된 날');
    await expect(page.getByRole('alert')).toContainText('고칠 곳이 1군데');
    await fillDate(page, '최고호봉이 된 날', '2024-03-01');
    await wakeEgg(page);
    await tick(page);
    await expect(page.locator('#status')).toContainText('9급 31호봉');
    // "30호봉이 2024-03-01 전날까지"로 저장된다 → 그날부터 31호봉
    expect((await storedData(page))?.profile).toMatchObject({
      step: 30,
      nextStepDate: '2024-03-01',
    });
  });

  test('정년퇴직일 뒤의 승급·보너스는 보여주지 않고, 퇴직 뒤에는 숫자가 멈춘다', async ({
    page,
  }) => {
    // 1966-11-30생 → 2026-12-31 정년퇴직. 다음 승급 예정일(2027-03-01)은 그 뒤다.
    const seed = makeSeed({
      nickname: '고참',
      birthDate: '1966-11-30',
      hireDate: '1993-03-02',
      gradeDate: '1993-03-02',
      step: 29,
      nextStepDate: '2027-03-01',
    });
    await openApp(page, { seed });
    await expect(page.locator('#status')).toContainText('9급 29호봉');
    await expect(page.locator('#growth')).toContainText('정년퇴직일 전에 남은 정기승급이 없어요');
    // 2027년 1월 정근수당·설 명절휴가비는 기준일에 재직 중이 아니므로 나오지 않는다
    await expect(page.locator('#wallet')).not.toContainText('정근수당');
    await expect(page.locator('#wallet')).not.toContainText('명절휴가비');

    await page.clock.setFixedTime(new Date('2027-02-01T10:00:00+09:00'));
    await page.reload();
    await tick(page, 3000);
    // 두 달 만에 열었으므로 복귀 정산 창이 뜬다. 뜰 때까지 기다렸다가 닫는다.
    const back = page.getByRole('dialog');
    await expect(back).toContainText('만이에요');
    await back.getByRole('button', { name: '확인' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('정년퇴직일(2026. 12. 31.)이 지났어요')).toBeVisible();
    // 퇴직 뒤에도 호봉이 오르거나 번 돈이 쌓이지 않는다
    await expect(page.locator('#status')).toContainText('9급 29호봉');
    await expect(page.locator('#today')).toContainText('0원');
  });

  test('오랜만에 열면 그사이의 일을 정산해 보여준다', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), time: '2026-12-10T09:30:00+09:00' });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('15일 만이에요');
    // 마지막 방문 다음 날부터 어제까지(11/26~12/9)의 근무일: 10일(오늘은 넣지 않는다)
    await expect(dialog).toContainText('+10일');
    await dialog.getByRole('button', { name: '확인' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const data = await storedData(page);
    expect(data?.visits.days).toEqual(['2026-11-24', '2026-11-25', '2026-12-10']);
    // 방문 기록은 "백업 이후 변경"으로 세지 않는다
    expect(data?.meta.changesSinceBackup).toBe(0);
  });

  test('주말만 지나고 월요일에 열면 "다시 만나서 반가워요"를 띄우지 않는다', async ({ page }) => {
    const seed = makeSeed(
      {},
      { visits: { days: ['2026-11-26', '2026-11-27'], lastVisit: '2026-11-26' } },
    );
    await openApp(page, { seed, time: '2026-11-30T09:30:00+09:00' });
    await tick(page, 2000);
    await expect(page.getByText('다시 만나서 반가워요')).toHaveCount(0);
    expect((await storedData(page))?.visits.days).toContain('2026-11-30');
  });

  test('반차인 날은 그 반나절에만 연가 중이고, 오늘 창과 호봉이가 같은 말을 한다', async ({
    page,
  }) => {
    const seed = makeSeed(
      {},
      {
        leave: {
          records: [{ id: 'pm1', date: '2026-11-25', hours: 4, kind: 'pm', memo: '' }],
          grantOverrideHours: {},
        },
      },
    );
    // 오전: 근무 중, 오후 반차까지 남은 시간
    await openApp(page, { seed, time: '2026-11-25T10:30:00+09:00' });
    const today = page.locator('#today');
    await expect(today).toContainText('오후 반차');
    // 오후 반차인 날의 퇴근은 반차가 시작하는 14시다(10:30 → 3시간 30분)
    await expect(today).toContainText(/퇴근까지\s*3:(29|30):/);
    await expect(page.locator('#status')).not.toContainText('연가 중');
    // 오후: 연가 중
    await openApp(page, { seed, time: '2026-11-25T15:00:00+09:00' });
    await expect(today).toContainText('연가 중');
    await expect(page.locator('#status')).toContainText('연가 중');
  });

  test('출근 전에는 퇴근 카운트다운 대신 출근 시각을 보여 준다', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), time: '2026-11-25T08:00:00+09:00' });
    await expect(page.locator('#today')).toContainText('9시 출근');
    await expect(page.locator('#today')).not.toContainText('퇴근까지');
  });

  test('"오늘 번 돈"이 초 단위로 오르고, 금액 가리기가 한 번에 모두 가린다', async ({ page }) => {
    await openApp(page, { seed: makeSeed() });
    const earn = page.locator('#today .earn');
    const read = async () => Number((await earn.innerText()).replace(/[^\d]/g, ''));
    const first = await read();
    await tick(page, 5000);
    const second = await read();
    // 9급 5호봉 2,226,100원 ÷ 21일 ÷ 8시간 ≒ 초당 3.68원
    expect(second - first).toBeGreaterThanOrEqual(14);
    expect(second - first).toBeLessThanOrEqual(23);

    const hide = page.locator('#today').getByRole('button', { name: '금액 가리기' });
    await expect(hide).toHaveAttribute('aria-pressed', 'false');
    await hide.click();
    // 눌러도 이름은 같고 눌림 상태만 바뀐다
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator('#wallet').getByRole('img', { name: '금액 가려짐' }).first(),
    ).toBeVisible();
    await expect(page.locator('#today')).not.toContainText('2,226,100');
    await expect(page.locator('#wallet')).not.toContainText('2,226,100원');
    await expect(page.locator('#wallet')).toContainText('●●●,●●●원');
    await expect(page.locator('#growth')).not.toContainText('+38,500원');
    expect((await storedData(page))?.settings.hideAmounts).toBe(true);
  });

  test('쉬는 날에는 번 돈이 쌓이지 않고 쉬는 날이라고 알려준다', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), time: '2026-12-25T11:00:00+09:00' });
    // 오랜만에 여는 것이므로 복귀 정산이 먼저 뜬다
    await page.getByRole('dialog').getByRole('button', { name: '확인' }).click();
    await expect(page.locator('#today')).toContainText('쉬는 날 (기독탄신일)');
    await expect(page.locator('#today .earn')).toContainText('0원');
  });

  test('연가를 쓴 날에는 휴가 복장, 월급날에는 월급날 표정', async ({ page }) => {
    const seed = JSON.parse(makeSeed());
    seed.data.leave.records = [{ id: 'v1', date: '2026-11-26', hours: 8, kind: 'day', memo: '' }];
    await openApp(page, { seed: JSON.stringify(seed), time: '2026-11-26T10:00:00+09:00' });
    await expect(page.locator('#status')).toContainText('연가 중');
    await expect(page.locator('#today')).toContainText('연가 중');
    // 하루 연가인 날에는 퇴근 카운트다운과 근무 진행률을 보이지 않는다
    await expect(page.locator('#today')).toContainText('푹 쉬세요');
    await expect(page.locator('#today')).not.toContainText('퇴근까지');
    await expect(
      page.locator('#today').getByRole('progressbar', { name: '오늘 근무 진행률' }),
    ).toHaveCount(0);
  });

  test('봉급표가 확정되지 않은 해의 인상액에는 어느 해 표로 셈했는지 붙인다', async ({ page }) => {
    // 다음 승급일 2027-01-01: 2027년 봉급표는 아직 없다
    await openApp(page, { seed: makeSeed() });
    await expect(page.locator('#growth')).toContainText('+38,500원(2026년 봉급표 기준)');
  });

  test('같은 해 안의 승급이면 꼬리표를 붙이지 않는다', async ({ page }) => {
    await openApp(page, { seed: makeSeed({ nextStepDate: '2026-12-01' }) });
    await expect(page.locator('#growth')).toContainText('+38,500원');
    await expect(page.locator('#growth')).not.toContainText('년 봉급표 기준)');
  });

  test('반일 연가인 날에는 퇴근 카운트다운이 그대로 있다', async ({ page }) => {
    const seed = JSON.parse(makeSeed());
    seed.data.leave.records = [{ id: 'v1', date: '2026-11-26', hours: 4, kind: 'pm', memo: '' }];
    await openApp(page, { seed: JSON.stringify(seed), time: '2026-11-26T10:00:00+09:00' });
    await expect(page.locator('#today')).toContainText('퇴근까지');
    await expect(page.locator('#today')).not.toContainText('푹 쉬세요');
  });

  test('탭 제목에 퇴근까지 남은 시간을 띄울 수 있다(기본은 꺼짐)', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    // 꺼져 있으면 보고 있는 화면 이름이 제목이 된다
    await expect(page).toHaveTitle('설정 · 호봉');
    const tabs = page.getByRole('navigation', { name: '화면 이동' });
    await tabs.getByRole('link', { name: '연가' }).click();
    await expect(page).toHaveTitle('연가 장부 · 호봉');
    await tabs.getByRole('link', { name: '설정' }).click();
    await page.getByLabel(/탭 제목에 퇴근까지 남은 시간/).check();
    await tick(page);
    await expect(page).toHaveTitle(/^퇴근까지 7:\d\d · 호봉$/);
  });

  test('야근 모드를 켜면 어두운 화면이 되고 배지를 받는다', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('radio', { name: '야근 모드' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await storedData(page))?.achievements['evt-night']).toEqual({ at: '2026-11-25' });
  });
});

/** 연출을 움직임 그대로 보는 저장본(기본 저장본은 움직임 줄이기가 켜져 있다) */
function moving(seed: string): string {
  const env = JSON.parse(seed) as { data: { settings: { reduceMotion: boolean } } };
  env.data.settings.reduceMotion = false;
  return JSON.stringify(env);
}

/** 설정에서 내 정보를 고쳐 8급 → 7급 승진(승진일 2026-07-01)을 넣는다 */
async function promote(page: Page): Promise<void> {
  await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
  const form = page.getByRole('dialog', { name: '내 정보 고치기' });
  await form.getByLabel('현재 직급').selectOption('7');
  await fillDate(page, '현 직급 임용일(승진일)', '2026-07-01');
}

const EIGHT = { hireDate: '2019-03-04', rank: '8', rankDate: '2022-07-01', step: 6 };

test.describe('승급·승진 연출', () => {
  test('승급 연출: 건너뛰기가 첫 포커스이고, 끝 장면 전에는 닫히지 않으며, 결과는 한 번만 읽힌다', async ({
    page,
  }) => {
    // 연출의 첫 장면(숫자판이 구르기 전)을 보려고 연 뒤 시계를 조금만 돌린다
    await openApp(page, {
      seed: moving(makeSeed()),
      time: '2027-01-04T09:30:00+09:00',
      settle: 100,
    });
    const dialog = page.getByRole('dialog', { name: '승급했어요' });
    const skip = dialog.getByRole('button', { name: '건너뛰기' });
    await expect(skip).toBeFocused();
    // 연출 중: 닫기 버튼도 결과 글도 없다(숫자판·꼬리표는 장식)
    await expect(dialog.getByRole('button', { name: '닫기' })).toHaveCount(0);
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await expect(dialog.locator('.over')).toHaveAttribute('aria-hidden', 'true');
    await expect(dialog.locator('.over')).toContainText('5호봉');
    // 시간이 흐르면 숫자판이 6으로 구른다
    await tick(page, 1000);
    await expect(dialog.locator('.over')).toContainText('6호봉');
    // 예전의 무대 배경 깜빡임은 없다
    await expect(dialog.locator('.stage.flash')).toHaveCount(0);
    // 대화상자 뒤의 상태창은 아직 오르기 전 호봉이다(결과를 연출보다 먼저 보이지 않는다)
    await expect(page.locator('#status .level')).toContainText('9급 5호봉');
    await expect(page.locator('#status .pips i.on')).toHaveCount(5);
    // 연출이 떠 있는 동안에는 알림(새 배지 등)을 띄우지 않는다
    await expect(page.locator('.toast')).toHaveCount(0);
    await skip.click();
    const result = dialog.getByRole('status');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('9급 6호봉');
    // 끝 장면에 닿으면 뒤의 상태창도 새 호봉으로 바뀐다
    await expect(page.locator('#status .level')).toContainText('9급 6호봉');
    await expect(page.locator('#status .pips i.on')).toHaveCount(6);
    // 연출을 본 뒤의 결과는 새로 생긴 알림 영역이 한 번 읽는다([확인]에 같은 설명을 또 달지 않는다)
    await expect(dialog.getByRole('button', { name: '확인' })).not.toHaveAttribute(
      'aria-describedby',
    );
    await expect(result).toContainText('5호봉에서 6호봉으로 올랐어요. 깃이 하나 더 자랐어요.');
    await expect(result).toContainText('안경');
    // 새 소품이 생겼으니 전 → 후 그림 두 장. 같은 형태라 뒤 그림의 이름에 새 소품을 붙여 가른다
    const pair = dialog.locator('#celebration-pair');
    await expect(pair.getByRole('img')).toHaveCount(2);
    await expect(pair.getByRole('img', { name: '전: 알봉이', exact: true })).toBeVisible();
    await expect(pair.getByRole('img', { name: '후: 알봉이, 새로 생김: 안경' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '확인' })).toBeFocused();
    await dialog.getByRole('button', { name: '확인' }).click();
    // 연출 창은 닫힌다(오랜만에 열었으므로 이어서 '다시 만나서 반가워요'가 뜬다)
    await expect(dialog).toHaveCount(0);
    expect((await storedData(page))?.character).toMatchObject({ lastRank: '9', lastStep: 6 });
  });

  test("새 소품이 생기는 승급: '깃 +1' 꼬리표가 '새로 생김' 꼬리표와 함께 남는다", async ({
    page,
  }) => {
    // 6호봉에 안경이 생긴다. 시간표(1호봉·새 소품): 깃 닿음 1220ms → 비춤 1420~2420ms → 색종이
    await openPaused(page, moving(makeSeed()), '2027-01-04T09:30:00+09:00');
    const dialog = page.getByRole('dialog', { name: '승급했어요' });
    await expect(dialog).toBeVisible();
    const over = dialog.locator('.over');
    await tick(page, 1300);
    await expect(over.locator('.tag')).toHaveText(['깃 +1']);
    // 비춤 단계: '깃 +1'은 그대로이고 그 아래에 '새로 생김'이 붙는다
    await tick(page, 400);
    await expect(over.locator('.tag')).toHaveText(['깃 +1', '새로 생김: 안경']);
    await tick(page, 700);
    await expect(over.locator('.tag')).toHaveText(['깃 +1', '새로 생김: 안경']);
    await dialog.getByRole('button', { name: '건너뛰기' }).click();
    await expect(dialog.locator('.over')).toHaveCount(0);
  });

  test('같은 형태에서 새 소품 없이 오르면 정지 그림은 장식이고, 바뀐 것은 글이 전한다', async ({
    page,
  }) => {
    // 6호봉 → 7호봉(새 소품 없음). 움직임 줄이기(기본 저장본)라 끝 장면과 정지 그림이 바로 뜬다
    await openApp(page, {
      seed: makeSeed({ step: 6 }),
      time: '2027-01-04T09:30:00+09:00',
    });
    const dialog = page.getByRole('dialog', { name: '승급했어요' });
    const pair = dialog.locator('#celebration-pair');
    await expect(pair).toBeVisible();
    await expect(pair).toHaveAttribute('aria-hidden', 'true');
    await expect(pair.getByRole('img')).toHaveCount(0);
    await expect(dialog.locator('#celebration-result')).toContainText(
      '6호봉에서 7호봉으로 올랐어요. 깃이 하나 더 자랐어요.',
    );
  });

  test("열었더니 이미 올라 있으면(다른 기기·패키지로 7급이 된 저장본) '호봉이가 자랐어요'가 뜨고 닫힌다", async ({
    page,
  }) => {
    // 마지막으로 본 것은 8급 솜봉이. 저장본의 계급은 이미 7급(깃봉이)
    const env = JSON.parse(moving(makeSeedV4({ ...EIGHT, rank: '7', rankDate: '2026-07-01' }))) as {
      data: { character: Record<string, unknown> };
    };
    env.data.character = { seenForms: ['chick'], lastRank: '8', lastStep: 6, lastForm: 'chick' };
    await openPaused(page, JSON.stringify(env), NOW);
    const dialog = page.getByRole('dialog', { name: '호봉이가 자랐어요' });
    const skip = dialog.getByRole('button', { name: '건너뛰기' });
    await expect(skip).toBeFocused();
    await expect(dialog.getByRole('status')).toHaveCount(0);
    // 이름판은 옛 형태 이름에서 시작한다
    await expect(dialog.locator('.over')).toContainText('솜봉이');
    // 진화 장면(3.3초)을 지나 스스로 끝 장면에 이른다
    await tick(page, 4000);
    const result = dialog.getByRole('status');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('솜봉이에서 깃봉이로 자랐어요.');
    const pair = dialog.locator('#celebration-pair');
    await expect(pair.getByRole('img', { name: '전: 솜봉이' })).toBeVisible();
    await expect(pair.getByRole('img', { name: '후: 깃봉이' })).toBeVisible();
    const ok = dialog.getByRole('button', { name: '확인' });
    await expect(ok).toBeFocused();
    await ok.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await storedData(page))?.character).toMatchObject({
      lastRank: '7',
      lastStep: 6,
      lastForm: 'fledgling',
    });
    // 다시 열어도 또 뜨지 않는다
    await page.reload();
    await tick(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('연출은 끝까지 두면 스스로 끝 장면에 이르고, Esc 로도 건너뛴다', async ({ page }) => {
    await openApp(page, { seed: moving(makeSeed()), time: '2027-01-04T09:30:00+09:00' });
    const dialog = page.getByRole('dialog', { name: '승급했어요' });
    await expect(dialog.getByRole('button', { name: '건너뛰기' })).toBeVisible();
    await tick(page, 4000);
    await expect(dialog.getByRole('status')).toContainText('9급 6호봉');
    await dialog.getByRole('button', { name: '확인' }).click();

    // 다시 열어(다음 해) Esc 로 건너뛴다. 끝 장면에서 한 번 더 누르면 닫힌다
    await page.clock.setFixedTime(new Date('2028-01-04T09:30:00+09:00'));
    await page.reload();
    await tick(page);
    const again = page.getByRole('dialog', { name: '승급했어요' });
    await expect(again.getByRole('button', { name: '건너뛰기' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(again.getByRole('status')).toContainText('9급 7호봉');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '승급했어요' })).toHaveCount(0);
  });

  test("내 정보에서 승진을 넣으면 '승진했어요' 스위치가 나오고, 저장하면 진화 연출이 뜬다", async ({
    page,
  }) => {
    await openApp(page, { seed: moving(makeSeedV4(EIGHT)), hash: 'settings' });
    await promote(page);
    const form = page.getByRole('dialog', { name: '내 정보 고치기' });
    const toggle = form.getByRole('checkbox', { name: '승진했어요 (축하 연출 보기)' });
    await expect(toggle).toBeChecked();
    await form.getByRole('button', { name: '저장' }).click();

    const dialog = page.getByRole('dialog', { name: '승진했어요' });
    const skip = dialog.getByRole('button', { name: '건너뛰기' });
    await expect(skip).toBeFocused();
    // 이름판: 옛 계급 이름(공개 설정이 켜져 있다)
    await expect(dialog.locator('.over')).toContainText('8급');
    await expect(dialog.getByRole('status')).toHaveCount(0);
    // 진화 장면을 지나 끝 장면으로(3.3초)
    await tick(page, 1500);
    await expect(skip).toBeVisible();
    await tick(page, 2500);
    const result = dialog.getByRole('status');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('7급이 되었어요. 축하해요!');
    await expect(result).toContainText('솜봉이에서 깃봉이로 자랐어요.');
    const pair = dialog.locator('#celebration-pair');
    await expect(pair.getByRole('img', { name: '전: 솜봉이' })).toBeVisible();
    await expect(pair.getByRole('img', { name: '후: 깃봉이' })).toBeVisible();
    await dialog.getByRole('button', { name: '확인' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const data = await storedData(page);
    expect(data?.profile).toMatchObject({ rank: '7', rankDate: '2026-07-01' });
    expect(data?.character).toMatchObject({ lastRank: '7', lastForm: 'fledgling' });
    // 새로 고쳐도 다시 뜨지 않는다
    await page.reload();
    await tick(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('승진 연출을 건너뛰면 바로 끝 장면이다', async ({ page }) => {
    await openApp(page, { seed: moving(makeSeedV4(EIGHT)), hash: 'settings' });
    await promote(page);
    await page
      .getByRole('dialog', { name: '내 정보 고치기' })
      .getByRole('button', { name: '저장' })
      .click();
    const dialog = page.getByRole('dialog', { name: '승진했어요' });
    // '내 정보를 고쳤어요' 알림은 연출 위에 겹치지 않게 미뤘다가, 연출을 닫은 뒤에 띄운다
    await expect(dialog.getByRole('button', { name: '건너뛰기' })).toBeFocused();
    await expect(page.locator('.toast')).toHaveCount(0);
    await dialog.getByRole('button', { name: '건너뛰기' }).click();
    await expect(dialog.getByRole('status')).toContainText('7급이 되었어요');
    await expect(dialog.getByRole('button', { name: '확인' })).toBeFocused();
    await expect(page.locator('.toast')).toHaveCount(0);
    await dialog.getByRole('button', { name: '확인' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.toast').filter({ hasText: '내 정보를 고쳤어요.' })).toBeVisible();
  });

  test('움직임 줄이기면 연출 없이 전 → 후 정지 그림 두 장과 글만 보인다', async ({ page }) => {
    // 기본 저장본은 움직임 줄이기가 켜져 있다
    await openApp(page, { seed: makeSeedV4(EIGHT), hash: 'settings' });
    await promote(page);
    await page
      .getByRole('dialog', { name: '내 정보 고치기' })
      .getByRole('button', { name: '저장' })
      .click();
    const dialog = page.getByRole('dialog', { name: '승진했어요' });
    await expect(dialog.getByRole('button', { name: '건너뛰기' })).toHaveCount(0);
    await expect(dialog.locator('.over')).toHaveCount(0);
    const result = dialog.locator('#celebration-result');
    await expect(result).toContainText('7급이 되었어요. 축하해요!');
    await expect(dialog.locator('#celebration-pair').getByRole('img')).toHaveCount(2);
    // 끝 장면이 처음부터 떠 있으면 알림 영역이어도 저절로 읽히지 않는다: 포커스가 가는 [확인]의 설명으로 한 번 읽힌다
    // (알림 영역과 겹쳐 두 번 읽지 않게 role=status 는 두지 않는다)
    const ok = dialog.getByRole('button', { name: '확인' });
    await expect(ok).toBeFocused();
    await expect(ok).toHaveAccessibleDescription(/7급 6호봉.*7급이 되었어요\. 축하해요!/);
    await expect(dialog.getByRole('status')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '확인' })).toBeFocused();
  });

  test("'승진했어요'를 끄거나 승진일을 그대로 두면 조용히 고친다(틀린 값 바로잡기)", async ({
    page,
  }) => {
    await openApp(page, { seed: makeSeedV4(EIGHT), hash: 'settings' });
    // 승진일은 그대로, 계급만 고친다: 스위치가 나오지 않는다
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    let form = page.getByRole('dialog', { name: '내 정보 고치기' });
    await form.getByLabel('현재 직급').selectOption('7');
    await expect(form.locator('#pf-promote')).toHaveCount(0);
    await form.getByRole('button', { name: '저장' }).click();
    await tick(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await storedData(page))?.profile.rank).toBe('7');

    // 계급이 오르고 승진일도 바뀌었지만 스위치를 끈다
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    form = page.getByRole('dialog', { name: '내 정보 고치기' });
    await form.getByLabel('현재 직급').selectOption('6');
    await fillDate(page, '현 직급 임용일(승진일)', '2026-09-01');
    await form.getByRole('checkbox', { name: '승진했어요 (축하 연출 보기)' }).uncheck();
    await form.getByRole('button', { name: '저장' }).click();
    await tick(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await storedData(page))?.character).toMatchObject({ lastRank: '6', lastForm: 'bird' });
  });

  test('홈에 직렬·계급 이름 보이기를 껐으면 승진 연출에도 계급 이름을 쓰지 않는다', async ({
    page,
  }) => {
    // 공개 설정은 v5 저장본에 있다(v4 저장본은 열 때 기본값 '켬'으로 채워진다)
    const seed = moving(makeSeedV5(EIGHT, { showSeriesHome: false }));
    await openApp(page, { seed, hash: 'settings' });
    await promote(page);
    await page
      .getByRole('dialog', { name: '내 정보 고치기' })
      .getByRole('button', { name: '저장' })
      .click();
    const dialog = page.getByRole('dialog', { name: '승진했어요' });
    // 이름판은 형태 이름
    await expect(dialog.locator('.over')).toContainText('솜봉이');
    await expect(dialog.locator('.over')).not.toContainText('급');
    await dialog.getByRole('button', { name: '건너뛰기' }).click();
    const result = dialog.getByRole('status');
    await expect(result).toContainText('승진을 축하해요!');
    await expect(result).toContainText('솜봉이에서 깃봉이로 자랐어요.');
    await expect(result).not.toContainText('7급');
    await expect(result).not.toContainText('8급');
  });
});
