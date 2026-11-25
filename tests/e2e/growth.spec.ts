import { expect, test } from '@playwright/test';
import { makeSeed, openApp, storedData, tick } from './helpers.ts';

test.describe('승급과 시간의 흐름', () => {
  test('승급일이 지나면 호봉이 오르고 승급 연출이 한 번 나온다', async ({ page }) => {
    // 저장된 기준: 5호봉, 다음 승급일 2027-01-01. 2027-01-04(월)에 연다.
    await openApp(page, { seed: makeSeed(), time: '2027-01-04T09:30:00+09:00' });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('승급했어요');
    await expect(dialog).toContainText('9급 6호봉');
    await expect(dialog).toContainText('안경'); // 6호봉에 열리는 소품
    await dialog.getByRole('button', { name: '좋아요' }).click();
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

    await page.getByRole('button', { name: /금액 가리기/ }).click();
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

  test('연가를 쓴 날에는 휴가 복장, 봉급날에는 봉급날 표정', async ({ page }) => {
    const seed = JSON.parse(makeSeed());
    seed.data.leave.records = [{ id: 'v1', date: '2026-11-26', hours: 8, kind: 'day', memo: '' }];
    await openApp(page, { seed: JSON.stringify(seed), time: '2026-11-26T10:00:00+09:00' });
    await expect(page.locator('#status')).toContainText('연가 중');
    await expect(page.locator('#today')).toContainText('연가 중');
  });

  test('탭 제목에 퇴근까지 남은 시간을 띄울 수 있다(기본은 꺼짐)', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    await expect(page).toHaveTitle('호봉 — 공무원 상태창');
    await page.getByLabel(/탭 제목에 퇴근까지 남은 시간/).check();
    await tick(page);
    await expect(page).toHaveTitle(/^퇴근까지 7:\d\d · 호봉$/);
  });

  test('야근 모드를 켜면 어두운 화면이 되고 뱃지를 받는다', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('radio', { name: '야근 모드' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect((await storedData(page))?.achievements['evt-night']).toEqual({ at: '2026-11-25' });
  });
});
