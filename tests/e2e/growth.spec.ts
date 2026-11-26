import { expect, test } from '@playwright/test';
import { fillDate, makeSeed, openApp, storedData, tick } from './helpers.ts';

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
    expect(data?.character).toMatchObject({ lastGrade: 9, lastStep: 6 });

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
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByLabel('닉네임').fill('김주무관');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2022-09-01');
    await page.getByLabel('현재 직급').selectOption('9');
    await page.getByLabel('현재 호봉', { exact: true }).fill('5');
    // 휴직으로 승급이 밀렸다: 13개월 뒤
    await fillDate(page, '다음 승급일', '2027-12-01');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await tick(page, 6000);
    await page.getByRole('button', { name: '시작하기' }).click();
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

  test('최고호봉이면 다음 승급일 대신 최고호봉이 된 날을 묻는다', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
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
    await expect(page.getByRole('alert').filter({ hasText: '최고호봉이 된 날' })).toBeVisible();
    await fillDate(page, '최고호봉이 된 날', '2024-03-01');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await tick(page, 6000);
    await page.getByRole('button', { name: '시작하기' }).click();
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
    // 11/26~12/10의 근무일: 11일
    await expect(dialog).toContainText('+11일');
    await dialog.getByRole('button', { name: '확인' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const data = await storedData(page);
    expect(data?.visits.days).toEqual(['2026-11-24', '2026-11-25', '2026-12-10']);
    // 방문 기록은 "백업 이후 변경"으로 세지 않는다
    expect(data?.meta.changesSinceBackup).toBe(0);
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
    await expect(page).toHaveTitle('호봉 — 공무원 상태창');
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
