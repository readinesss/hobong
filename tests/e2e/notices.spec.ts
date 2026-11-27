import { expect, test, type Page } from '@playwright/test';
import {
  fillDate,
  makeSeed,
  onboard,
  openApp,
  startForm,
  storedData,
  tick,
  wakeEgg,
} from './helpers.ts';

/**
 * 안내 띠 닫기(#15): 알리기만 하는 띠(정년 이후·공휴일 데이터 없음·내 정보 점검)는 닫을 수 있고
 * 그 탭에서만 기억한다. 데이터를 지키는 띠(다른 탭·저장 막힘·저장 실패)는 닫을 수 없다.
 */

/** 1960-03-01생 → 2020-06-30 정년퇴직(정년이 지난 사람) */
const RETIRED = makeSeed({
  nickname: '고참',
  birthDate: '1960-03-01',
  hireDate: '1985-03-01',
  gradeDate: '1985-03-01',
  step: 29,
  nextStepDate: '2021-01-01',
  stepAsOf: '2020-06-30',
});

/** 2028년(공휴일 데이터 없음)에 여는 날. 복귀 정산 창이 뜨지 않게 어제 들렀다고 둔다 */
const IN_2028 = '2028-01-05T10:00:00+09:00';
const visitedYesterday2028 = { visits: { days: ['2028-01-04'], lastVisit: '2028-01-04' } };
/** 2028년에 여는 보통의 사람(승급 축하 창이 뜨지 않게 호봉을 그날 기준으로 둔다) */
const SEED_2028 = makeSeed(
  { step: 7, nextStepDate: '2029-01-01', stepAsOf: '2028-01-04' },
  visitedYesterday2028,
);

const closeButtons = (page: Page) => page.getByRole('button', { name: /안내 닫기$/ });
const storageKeys = (page: Page) =>
  page.evaluate(() => Object.keys(window.localStorage).sort((a, b) => a.localeCompare(b)));

test.describe('안내 띠 닫기', () => {
  test('정년 안내를 닫으면 사라지고, 본문으로 포커스가 가며, 저장소는 그대로다', async ({
    page,
  }) => {
    await openApp(page, { seed: RETIRED });
    const banner = page.locator('#notice-retired');
    await expect(banner).toContainText('정년퇴직일(2020. 6. 30.)이 지났어요');
    const close = page.getByRole('button', { name: '정년 안내 닫기' });
    await expect(close).toBeVisible();
    await expect(close).toHaveAttribute('title', '정년 안내 닫기');
    const before = await storedData(page);
    const keysBefore = await storageKeys(page);

    await close.click();
    await expect(banner).toHaveCount(0);
    await expect(page.locator('#main')).toBeFocused();
    await tick(page);
    expect(await storedData(page)).toEqual(before);
    expect(await storageKeys(page)).toEqual(keysBefore);

    // 다른 화면에 다녀와도 이 탭에서는 닫힌 채다
    const nav = page.getByRole('navigation', { name: '화면 이동' });
    await nav.getByRole('link', { name: '연가' }).click();
    await expect(page.locator('#notice-retired')).toHaveCount(0);
    await nav.getByRole('link', { name: '홈' }).click();
    await expect(page.locator('#notice-retired')).toHaveCount(0);

    // 새로 고치면 다시 보인다(메모리에만 기억)
    await page.reload();
    await tick(page);
    await expect(page.locator('#notice-retired')).toBeVisible();
  });

  test('띠가 여럿이면 하나를 닫은 뒤 남은 띠의 닫기 버튼으로 포커스가 간다', async ({ page }) => {
    await openApp(page, {
      seed: makeSeed(
        {
          nickname: '고참',
          birthDate: '1960-03-01',
          hireDate: '1985-03-01',
          gradeDate: '1985-03-01',
          step: 29,
          nextStepDate: '2021-01-01',
          stepAsOf: '2020-06-30',
        },
        visitedYesterday2028,
      ),
      time: IN_2028,
    });
    await expect(page.locator('#notice-retired')).toBeVisible();
    await expect(page.locator('#notice-holidays')).toContainText(
      '2028년 공휴일 데이터가 아직 없어',
    );
    await page.getByRole('button', { name: '정년 안내 닫기' }).click();
    await expect(page.locator('#notice-retired')).toHaveCount(0);
    const holidays = page.getByRole('button', { name: '공휴일 안내 닫기' });
    await expect(holidays).toBeFocused();
    // 키보드(Enter)로도 닫는다. 남은 띠가 없으면 본문으로
    await page.keyboard.press('Enter');
    await expect(page.locator('#notice-holidays')).toHaveCount(0);
    await expect(page.locator('#main')).toBeFocused();
    await expect(closeButtons(page)).toHaveCount(0);
  });

  test('공휴일 안내는 Tab 으로 닫기 버튼에 가서 Enter 로 닫는다', async ({ page }) => {
    await openApp(page, { seed: SEED_2028, time: IN_2028 });
    const close = page.getByRole('button', { name: '공휴일 안내 닫기' });
    await expect(close).toBeVisible();
    // 본문 처음에서 Tab 한 번이면 첫 띠의 닫기 버튼이다
    await page.locator('#main').focus();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#notice-holidays')).toHaveCount(0);
    await expect(page.locator('#main')).toBeFocused();
  });

  test('내 정보 점검 안내도 닫을 수 있고, 고치기 버튼은 그대로 동작한다', async ({ page }) => {
    // 현 직급 임용일이 오늘(2026-11-25)보다 뒤 → 확인이 필요한 값
    const seed = makeSeed({ gradeDate: '2026-12-01' });
    await openApp(page, { seed });
    const banner = page.locator('#notice-profile');
    await expect(banner).toContainText('현 직급 임용일');
    await banner.getByRole('button', { name: '내 정보 고치기' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: '내 정보 점검 안내 닫기' }).click();
    await expect(page.locator('#notice-profile')).toHaveCount(0);
    await expect(page.locator('#main')).toBeFocused();
  });

  test('데이터를 지키는 띠: 저장 공간이 막히면 닫기 버튼이 없다', async ({ page }) => {
    await openApp(page, { seed: makeSeed() });
    // 쓰기만 막힌 저장소(가득 찬 경우와 같다): 읽기는 되고 setItem 은 실패한다
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('full', 'QuotaExceededError');
      };
    });
    await page.reload();
    await tick(page);
    await expect(page.getByText('저장 공간이 가득 찼거나 쓰기가 막혀')).toBeVisible();
    await expect(page.getByRole('button', { name: /닫기/ })).toHaveCount(0);
  });

  test('데이터를 지키는 띠: 저장에 실패하면 닫기 버튼이 없다', async ({ page }) => {
    await openApp(page, { seed: makeSeed() });
    // 확인용 키는 쓰이고 데이터 키만 실패한다 → 열 때는 괜찮고 바꾼 뒤 저장이 실패한다
    await page.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (key === 'hobong.data') throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    await page.reload();
    await tick(page);
    await page.getByRole('button', { name: '금액 가리기' }).click();
    await tick(page);
    await expect(page.getByText('방금 바꾼 내용을 저장하지 못했어요')).toBeVisible();
    await expect(page.getByRole('button', { name: /닫기/ })).toHaveCount(0);
  });

  test('데이터를 지키는 띠: 저장이 되지 않는 브라우저에서는 닫기 버튼이 없다', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    await openApp(page);
    await onboard(page);
    await expect(page.getByText('이 브라우저에서는 저장이 되지 않아요')).toBeVisible();
    await expect(page.getByRole('button', { name: /닫기/ })).toHaveCount(0);
  });

  test('데이터를 지키는 띠: 다른 탭이 더 새 버전으로 저장하면 닫기 버튼이 없다', async ({
    page,
    context,
  }) => {
    const seed = makeSeed();
    await openApp(page, { seed });
    await tick(page, 3000);
    const other = await context.newPage();
    await other.goto(page.url());
    const newer = JSON.stringify({ ...JSON.parse(seed), schemaVersion: 99 });
    await other.evaluate((value) => localStorage.setItem('hobong.data', value), newer);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('hobong.data'))).toBe(newer);
    await page.getByRole('button', { name: '금액 가리기' }).click();
    await tick(page);
    await expect(page.locator('#notice-stale')).toBeVisible();
    await expect(page.getByRole('button', { name: /닫기/ })).toHaveCount(0);
    await other.close();
  });

  test('모두 지우고 다시 시작하면 닫았던 안내가 다시 보인다(같은 탭)', async ({ page }) => {
    await openApp(page, { seed: SEED_2028, time: IN_2028 });
    await page.getByRole('button', { name: '공휴일 안내 닫기' }).click();
    await expect(page.locator('#notice-holidays')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '설정' })
      .click();
    await page.getByRole('button', { name: '모두 지우고 처음부터' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '모두 지우기' }).click();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeVisible();
    // 2028년 기준으로 내 정보를 다시 넣는다(다음 승급일은 오늘 뒤)
    await startForm(page);
    await page.getByLabel('닉네임').fill('김주무관');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2024-03-04');
    await page.getByLabel('현재 직급').selectOption('9');
    await page.getByLabel('현재 호봉', { exact: true }).fill('4');
    await fillDate(page, '다음 승급일', '2028-03-01');
    await wakeEgg(page);
    await tick(page);
    await expect(page.locator('#notice-holidays')).toBeVisible();
  });
});
