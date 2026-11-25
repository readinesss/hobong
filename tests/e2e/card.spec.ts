import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { makeSeed, openApp, storedData, tick } from './helpers.ts';

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

test.describe('캐릭터 카드', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'card' });
    await tick(page, 2000);
  });

  test('정사각형·세로형 PNG로 저장된다', async ({ page }) => {
    const square = await savePng(page);
    expect(square.name).toBe('hobong-card-20261125.png');
    expect(pngSize(square.buffer)).toEqual({ width: 1080, height: 1080 });
    expect(square.buffer.length).toBeGreaterThan(5_000);

    await page.getByRole('radio', { name: '세로형' }).click();
    const portrait = await savePng(page);
    expect(pngSize(portrait.buffer)).toEqual({ width: 1080, height: 1620 });
    // 첫 카드를 만들면 뱃지를 받는다
    expect((await storedData(page))?.achievements['evt-card']).toEqual({ at: '2026-11-25' });
  });

  test('금액·정년은 기본으로 꺼져 있고 켠 것만 들어간다', async ({ page }) => {
    await expect(page.getByLabel(/월 봉급/)).not.toBeChecked();
    await expect(page.getByLabel(/정년 D-day/)).not.toBeChecked();
    await expect(page.getByLabel('뱃지')).toBeChecked();
    const text = page.locator('#card-text pre');
    await expect(text).toContainText('9급 5호봉');
    await expect(text).not.toContainText('원');
    await expect(text).not.toContainText('정년');

    await page.getByLabel(/정년 D-day/).check();
    await expect(text).toContainText('정년 D-');
    // 글자 카드에는 금액을 켜도 넣지 않는다
    await page.getByLabel(/월 봉급/).check();
    await expect(text).not.toContainText('2,226,100');
    expect((await storedData(page))?.settings.card).toMatchObject({
      showSalary: true,
      showRetirement: true,
    });
  });

  test('글자 카드에 진행 막대와 서비스 주소가 들어간다', async ({ page }) => {
    const text = await page.locator('#card-text pre').innerText();
    expect(text).toContain('[호봉] 김주무관');
    expect(text).toMatch(/다음 승급 [■□]{10} \d+% \(D-37\)/);
    expect(text).toContain('readinesss.github.io/hobong');
    // 재직기간은 연·월까지만(일수까지 적으면 카드 날짜로 임용일이 역산된다)
    expect(text).toMatch(/재직 \d+년( \d+개월)?/);
    expect(text).not.toContain('일째');
  });

  test('이미지 복사가 안 되는 환경에서는 버튼을 숨기고 저장만 제공한다', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'ClipboardItem', { value: undefined, configurable: true });
    });
    await page.reload();
    await tick(page, 2000);
    await expect(page.getByRole('button', { name: '이미지 복사' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'PNG로 저장' })).toBeVisible();
    await expect(page.getByText('이미지 복사를 쓸 수 없어 저장만 제공해요')).toBeVisible();
  });

  test('저장이 막히면 이미지로 열어 길게 눌러 저장할 수 있다', async ({ page }) => {
    await page.getByRole('button', { name: /이미지로 열기/ }).click();
    const image = page.getByRole('dialog').getByRole('img', { name: '호봉이 카드' });
    await expect(image).toBeVisible();
    const src = await image.getAttribute('src');
    expect(src).toMatch(/^blob:/);
  });
});
