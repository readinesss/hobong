/**
 * #38 직렬 찾기를 사람 말로: '경찰행정'처럼 법령의 직렬표에 없는 이름, 꾸밈말('세무직')·줄임말('교행'),
 * 직종 말(경찰이 따로 있어요), 직접 적은 이름([그대로 쓰기] — 저장 형식은 그대로).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  closeDialogs,
  collectErrors,
  fillDate,
  makeSeedV7,
  openApp,
  PACKAGE_OPEN,
  storedData,
  tick,
} from './helpers.ts';

const COMMON = '흔히 경찰청·경찰서에서 일하는 일반직 공무원을 이렇게 불러요.';
const TRACK =
  '직종에 경찰이 따로 있어요. 해당하면 직종을 바꿔 주세요. 그 직종은 직렬을 고르지 않아요.';

async function openEditor(page: Page) {
  await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
  const dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
  return {
    dialog,
    find: dialog.getByRole('searchbox', { name: '직렬·직류 찾기' }),
    select: dialog.getByLabel('직렬', { exact: true }),
  };
}

async function settings(page: Page, seed = makeSeedV7()) {
  await openApp(page, { seed, hash: 'settings' });
  await tick(page, 3000);
  await closeDialogs(page);
}

function tempFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hobong-e2e-')), name);
  writeFileSync(path, content);
  return path;
}

test.describe('직렬 찾기를 사람 말로(#38)', () => {
  test("'경찰행정': 설명 · '행정' 권함 · 직종 '경찰' 안내 · 그대로 쓰기 → 행정을 골라 저장하면 다시 열어도 그대로", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await settings(page);
    const first = await openEditor(page);
    const { dialog, find, select } = first;
    await find.fill('경찰행정');
    // 상태 줄은 짧게: 표에 없는 이름이고, 이름에 든 글자로 무엇을 찾았는지(짐작), 직종이 따로 있다
    await expect(dialog.locator('#pf-series-found')).toHaveText(
      "'경찰행정'은 직렬표에 없는 이름이에요. 이름에 든 글자로 '행정'을 찾았어요. 직종에 경찰이 따로 있어요.",
    );
    // 안내 상자는 하나: 흔히 부르는 이름 → 직종 말 → [직종 고르기로 가기]
    const box = dialog.locator('#pf-series-other');
    await expect(box).toHaveCount(1);
    await expect(box.locator('#pf-series-common')).toContainText(COMMON);
    await expect(box.locator('#pf-series-track')).toHaveText(TRACK);
    await expect(box.getByRole('button', { name: '직종 고르기로 가기' })).toBeVisible();
    // 그대로 쓰기는 목록 아래. 개인정보 안내가 단추 앞에 있고 단추의 설명으로 이어진다
    const own = dialog.locator('#pf-series-own');
    const ownButton = own.getByRole('button', { name: "'경찰행정' 그대로 쓰기" });
    await expect(ownButton).toBeVisible();
    await expect(ownButton).toHaveAccessibleDescription(
      '직접 적은 이름은 고치지 않고 그대로 보여요. 이름이나 기관처럼 나를 알아볼 수 있는 말은 넣지 마세요.',
    );
    const below = await own.evaluate(
      (el) =>
        !!(
          el.compareDocumentPosition(document.getElementById('pf-series') as Node) &
          Node.DOCUMENT_POSITION_PRECEDING
        ),
    );
    expect(below).toBe(true);
    // 찾는 칸의 설명은 짧게(상태 줄·흔히 부르는 이름·직종 말 — 그대로 쓰기와 개인정보 안내는 잇지 않는다)
    await expect(find).toHaveAccessibleDescription(/흔히 경찰청·경찰서에서/);
    await expect(find).not.toHaveAccessibleDescription(/그대로 쓰기|나를 알아볼/);
    // 목록: 이름에 든 '행정'
    await expect(select.locator('optgroup')).toHaveCount(1);
    await expect(select.locator('option', { hasText: /^행정$/ })).toHaveCount(1);
    // 짐작은 Enter 로 저절로 고르지 않는다
    await find.press('Enter');
    await expect(select).toBeFocused();
    await expect(select).toHaveValue('');
    await select.selectOption('행정');
    await expect(dialog.locator('#pf-series-found')).toHaveText('행정을 골랐어요.');
    // 직종은 저절로 바뀌지 않는다
    await expect(dialog.locator('#pf-track [role="radio"][aria-checked="true"]')).toHaveText(
      /^일반직/,
    );
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    expect((await storedData(page))?.profile).toMatchObject({
      track: 'general',
      series: '행정',
      seriesJikryu: null,
    });
    await expect(page.locator('#set-series')).toHaveText(/행정$/);
    await page.reload();
    await tick(page, 3000);
    await closeDialogs(page);
    const again = await openEditor(page);
    await expect(again.select.locator('option:checked')).toHaveText('행정');
    expect(errors).toEqual([]);
  });

  test("'경찰행정' 그대로 쓰기 → 홈에 '직렬' 없이 · 새로 고침 뒤 그대로 · 카드에 켰을 때만 · 패키지 왕복", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await settings(page);
    const editing = await openEditor(page);
    let { dialog, select } = editing;
    await editing.find.fill('  경찰행정 ');
    await dialog.getByRole('button', { name: "'경찰행정' 그대로 쓰기" }).click();
    await expect(select).toBeFocused();
    await expect(select.locator('option:checked')).toHaveText('경찰행정 (직접 적은 이름)');
    await expect(dialog.locator('#pf-series-found')).toHaveText('경찰행정을 골랐어요.');
    await expect(dialog.locator('#pf-series-own')).toHaveText('지금 이 이름을 그대로 쓰고 있어요.');
    await expect(dialog.locator('#pf-series-hint')).toContainText('정해진 소품이 없어요');
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    // 저장 형식은 그대로: 직렬 칸에 그 글자, 직류 없음
    expect((await storedData(page))?.profile).toMatchObject({
      series: '경찰행정',
      seriesJikryu: null,
    });
    await expect(page.locator('#set-series')).toContainText('경찰행정 (직접 적은 이름)');

    // 홈 상태창: '직렬'을 붙이지 않는다
    await page.goto(page.url().replace(/#.*$/, '#home'));
    await tick(page, 3000);
    await closeDialogs(page);
    await expect(page.locator('#status-series')).toHaveText('경찰행정');
    await page.reload();
    await tick(page, 3000);
    await closeDialogs(page);
    await expect(page.locator('#status-series')).toHaveText('경찰행정');

    // 카드: 기본으로 넣지 않고, 켜면 '직렬' 없이 그 글자
    await page.goto(page.url().replace(/#.*$/, '#card'));
    await tick(page, 3000);
    await closeDialogs(page);
    const text = page.locator('#card-text pre');
    await expect(text).not.toContainText('경찰행정');
    await page.locator('#card-show-series').getByRole('checkbox').check();
    await expect(text).toContainText('경찰행정');
    await expect(text).not.toContainText('경찰행정 직렬');

    // 임용정보 패키지: 내려받고, 다른 직렬로 바꾼 뒤 불러오면 다시 그 글자
    await page.goto(page.url().replace(/#.*$/, '#settings'));
    await tick(page, 3000);
    await closeDialogs(page);
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '패키지 내려받기' }).click(),
    ]);
    const saved = readFileSync(await file.path(), 'utf8');
    expect(JSON.parse(saved).data.profile.series).toBe('경찰행정');
    ({ dialog, select } = await openEditor(page));
    await select.selectOption('간호');
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    expect((await storedData(page))?.profile.series).toBe('간호');
    await page.getByRole('button', { name: PACKAGE_OPEN }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog').getByRole('button', { name: '파일 고르기' }).click();
    await (await chooser).setFiles(tempFile('series.json', saved));
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /불러오기$/ })
      .click();
    await tick(page, 6000);
    await closeDialogs(page);
    expect((await storedData(page))?.profile.series).toBe('경찰행정');
    await expect(page.locator('#set-series')).toContainText('경찰행정 (직접 적은 이름)');
    expect(errors).toEqual([]);
  });

  test("'세무직' → 세무, '교행' → 교육행정(줄임말), 형식에 맞지 않으면 까닭 한 줄", async ({
    page,
  }) => {
    await settings(page);
    const { dialog, find, select } = await openEditor(page);
    const status = dialog.locator('#pf-series-found');
    await find.fill('세무직');
    await expect(status).toHaveText("'세무'로 찾았어요. 1개 있어요.");
    // 이름이 같게 찾았으니 그대로 쓰기·직종 말은 보이지 않는다
    await expect(dialog.locator('#pf-series-other')).toHaveCount(0);
    await find.press('Enter');
    await expect(select).toHaveValue('세무');

    await find.fill('교행');
    await expect(status).toHaveText("줄임말 '교행'을 '교육행정'으로 풀어 찾았어요. 1개 있어요.");
    await expect(select.locator('option', { hasText: '행정 · 교육행정 직류' })).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: /그대로 쓰기$/ })).toHaveCount(0);

    for (const q of ['가나다라마바사아자차카타파', '경찰행정!']) {
      await find.fill(q);
      await expect(dialog.locator('#pf-series-own')).toHaveText(
        '직접 적는 이름은 한글·영문·숫자로 12자까지 쓸 수 있어요.',
      );
      await expect(dialog.getByRole('button', { name: /그대로 쓰기$/ })).toHaveCount(0);
    }
    // 두 표 밖의 직렬(법원 등)은 '직렬표에 없는 이름'이라고만 말하고 그대로 쓰기를 권한다
    await find.fill('법원사무');
    await expect(status).toHaveText(
      "'법원사무'는 직렬표에 없는 이름이에요. 목록 아래에서 그대로 쓸 수 있어요.",
    );
    await expect(dialog.getByRole('button', { name: "'법원사무' 그대로 쓰기" })).toBeVisible();
  });

  test("말을 거는 첫 입력: '경찰행정' → [직종 고르기로 가기] → 직종 질문, 돌아오면 찾는 글자가 남아 있다", async ({
    page,
  }) => {
    const next = () => page.getByRole('button', { name: '다음', exact: true });
    const bubble = page.locator('#welcome-talk .bubble');
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('김주무관');
    await next().click();
    await fillDate(page, '생년월일', '1996-04-12');
    await next().click();
    await fillDate(page, '임용일', '2024-03-04');
    await next().click();
    await expect(bubble).toContainText('어떤 직종이에요?');
    await next().click();
    await expect(bubble).toContainText('어느 봉급표를 쓰세요?');
    await next().click();
    await expect(bubble).toContainText('직렬도 골라 볼까요?');
    const find = page.getByRole('searchbox', { name: '직렬·직류 찾기' });
    await find.fill('경찰행정');
    await expect(page.locator('#tk-series-track')).toHaveText(TRACK);
    await expect(page.locator('#tk-series-common')).toContainText(COMMON);
    await page.getByRole('button', { name: '직종 고르기로 가기' }).click();
    await expect(bubble).toContainText('어떤 직종이에요?');
    // 직종은 저절로 바뀌지 않았다
    await expect(page.getByRole('radio', { name: '일반직', exact: true })).toBeChecked();
    await next().click();
    await expect(bubble).toContainText('어느 봉급표를 쓰세요?');
    await next().click();
    await expect(bubble).toContainText('직렬도 골라 볼까요?');
    await expect(find).toHaveValue('경찰행정');
    // 그대로 쓰면 직렬 값만 채워진다(질문은 [다음]을 눌러야 넘어간다)
    await page.getByRole('button', { name: "'경찰행정' 그대로 쓰기" }).click();
    await expect(page.getByLabel('직렬', { exact: true })).toHaveValue('경찰행정');
  });

  test('키보드만으로: 조각을 골라 저장하고, 그대로 쓰기를 눌러 저장한다', async ({ page }) => {
    await settings(page);
    let { dialog, find, select } = await openEditor(page);
    await find.focus();
    await page.keyboard.type('경찰행정');
    // Enter 는 고르지 않고 목록으로 옮긴다 → 화살표로 '행정'
    await page.keyboard.press('Enter');
    await expect(select).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(select).toHaveValue('행정');
    const save = dialog.getByRole('button', { name: '저장' });
    await save.focus();
    await page.keyboard.press('Enter');
    await tick(page);
    expect((await storedData(page))?.profile.series).toBe('행정');

    ({ dialog, find, select } = await openEditor(page));
    await find.focus();
    await page.keyboard.type('경찰행정');
    // 잠깐 쉬면 찾는다
    await expect(dialog.locator('#pf-series-found')).toContainText('직렬표에 없는 이름이에요');
    // 찾는 칸 다음 Tab: 안내 상자의 [직종 고르기로 가기] → 목록 → [그대로 쓰기](목록 아래)
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: '직종 고르기로 가기' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: "'경찰행정' 그대로 쓰기" })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(select).toBeFocused();
    await expect(select).toHaveValue('경찰행정');
    await dialog.getByRole('button', { name: '저장' }).focus();
    await page.keyboard.press('Enter');
    await tick(page);
    expect((await storedData(page))?.profile.series).toBe('경찰행정');
  });

  test("옛 이름은 같거나 앞부분일 때만: '공안'·'수사'·'사무'에 끼어들지 않고, 앞부분으로 맞은 것('마약')은 Enter 로 고르지 않는다", async ({
    page,
  }) => {
    await settings(page);
    const { dialog, find, select } = await openEditor(page);
    const status = dialog.locator('#pf-series-found');
    for (const q of ['공안', '공안직', '수사']) {
      await find.fill(q);
      await expect(status).toContainText('직렬표에 없는 이름이에요');
      await expect(select.locator('option', { hasText: /형사법무|철도경찰/ })).toHaveCount(0);
      await find.press('Enter');
      await expect(select).toHaveValue('');
      await find.focus();
    }
    await find.fill('사무');
    await expect(status).toHaveText('1개 찾았어요. 아래 목록에서 골라 주세요.');
    await expect(select.locator('option', { hasText: '사무운영' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: '형사법무' })).toHaveCount(0);
    // 옛 이름의 앞부분: 목록에는 보이되(예전 ○○ 직렬) Enter 로 저절로 고르지 않는다
    await find.fill('마약');
    await expect(
      select.locator('option', { hasText: '형사법무 (예전 마약수사 직렬)' }),
    ).toHaveCount(1);
    await find.press('Enter');
    await expect(select).toHaveValue('');
    // 같으면 고른다
    await find.fill('철도공안');
    await expect(
      select.locator('option', { hasText: '철도경찰 (예전 철도공안 직렬)' }),
    ).toHaveCount(1);
    await find.press('Enter');
    await expect(select).toHaveValue('철도경찰');
  });

  test("직종 말이 보일 때('경찰'·'교원'·'경찰청'·'9급 소방 공무원'): Enter 로 고르지 않고 그대로 쓰기를 권하지 않는다", async ({
    page,
  }) => {
    await settings(page);
    const { dialog, find, select } = await openEditor(page);
    const status = dialog.locator('#pf-series-found');
    await find.fill('경찰');
    await expect(status).toHaveText(
      '1개 찾았어요. 아래 목록에서 골라 주세요. 직종에 경찰이 따로 있어요.',
    );
    await expect(dialog.locator('#pf-series-track')).toHaveText(TRACK);
    await expect(dialog.locator('#pf-series-own')).toHaveCount(0);
    await find.press('Enter');
    await expect(select).toBeFocused();
    await expect(select).toHaveValue('');
    for (const [q, label] of [
      ['교원', '교원'],
      ['경찰청', '경찰'],
      ['9급 소방 공무원', '소방'],
    ] as const) {
      await find.fill(q);
      await expect(dialog.locator('#pf-series-track')).toContainText(`직종에 ${label}`);
      await expect(dialog.locator('#pf-series-own')).toHaveCount(0);
    }
    // 직종 이름 밖의 글자가 남으면 그대로 쓰기를 권한다
    await find.fill('경찰행정');
    await expect(dialog.getByRole('button', { name: "'경찰행정' 그대로 쓰기" })).toBeVisible();
  });

  test("꾸밈말을 떼도 표의 이름은 깎지 않는다: '인사조직 공무원'·'지방세직'(지방)·'지방 직업상담'·'교정직 9급'", async ({
    page,
  }) => {
    await settings(page);
    const { dialog, find, select } = await openEditor(page);
    const status = () => dialog.locator('#pf-series-found');
    await find.fill('인사조직 공무원');
    await expect(status()).toHaveText("'인사조직'으로 찾았어요. 1개 있어요.");
    await expect(select.locator('option', { hasText: '행정 · 인사조직 직류' })).toHaveCount(1);
    await expect(dialog.locator('#pf-series-own')).toHaveCount(0);
    await find.fill('교정직 9급');
    await expect(status()).toHaveText("'교정'으로 찾았어요. 1개 있어요.");
    await find.press('Enter');
    await expect(select).toHaveValue('교정');

    // 지방 일반직(지방 표): '지방'을 먼저 떼면 '세직'이 되던 것
    await dialog.getByRole('radio', { name: '지방 일반직 (일부 준비 중)', exact: true }).click();
    await find.fill('지방세직');
    await expect(status()).toHaveText("'지방세'로 찾았어요. 1개 있어요.");
    await expect(select.locator('option', { hasText: '세무 · 지방세 직류' })).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: /그대로 쓰기$/ })).toHaveCount(0);
    // '지방직'을 떼면 '업상담'이 되던 것. 직업상담은 국가 표에만 있어 다른 표 안내로 간다
    await find.fill('지방 직업상담');
    await expect(status()).toHaveText("'직업상담'으로 찾았어요. 국가공무원 직렬표에 1개 있어요.");
    await expect(dialog.locator('#pf-series-table')).toContainText('직업상담 직렬');
  });

  test('한글을 조합하는 동안과 끝 글자가 자모일 때는 찾지 않는다(상태 줄이 친 글자를 되풀이하지 않는다)', async ({
    page,
  }) => {
    await settings(page);
    const { dialog, find } = await openEditor(page);
    const status = dialog.locator('#pf-series-found');
    await find.fill('경찰행정');
    await expect(status).toContainText("'경찰행정'은");
    // 끝 글자가 자모: 앞의 결과를 그대로 둔다
    for (const q of ['경찰행ㅈ', 'ㄱ', '경ㅊ']) {
      await find.fill(q);
      await page.waitForTimeout(600);
      await expect(status).toContainText("'경찰행정'은");
      await expect(dialog.locator('#pf-series-own')).not.toContainText('12자까지');
    }
    // 조합 중(compositionstart ~ compositionend)에는 바꾸지 않고, 끝나면 찾는다
    await find.evaluate((el: HTMLInputElement) => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.value = '법원사';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    await page.waitForTimeout(600);
    await expect(status).toContainText("'경찰행정'은");
    await find.evaluate((el: HTMLInputElement) => {
      el.value = '법원사무';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '무' }));
    });
    await expect(status).toHaveText(
      "'법원사무'는 직렬표에 없는 이름이에요. 목록 아래에서 그대로 쓸 수 있어요.",
    );
    // 한 글자는 그대로 쓰기를 권하지 않는다
    await find.fill('겨');
    await expect(status).toContainText("'겨'는");
    await expect(dialog.locator('#pf-series-own')).toHaveCount(0);
  });

  test('360px: 안내 상자와 단추가 넘치지 않고, 단추는 44px 이상이다. 12자 이름도 홈·카드에서 넘치지 않는다', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await settings(page);
    const { dialog, find } = await openEditor(page);
    await find.fill('해양경찰행정공무원');
    for (const id of ['#pf-series-other', '#pf-series-own']) {
      const box = dialog.locator(id);
      await expect(box).toBeVisible();
      const fits = await box.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { right: r.right, scroll: el.scrollWidth, client: el.clientWidth };
      });
      expect(fits.right, id).toBeLessThanOrEqual(360);
      expect(fits.scroll, id).toBeLessThanOrEqual(fits.client);
    }
    // 안내 상자가 목록을 멀리 밀어내지 않는다(그대로 쓰기와 개인정보 안내는 목록 아래)
    const gap = await dialog.evaluate(() => {
      const find = document.getElementById('pf-series-find')?.getBoundingClientRect();
      const list = document.getElementById('pf-series')?.getBoundingClientRect();
      return find && list ? list.top - find.bottom : Infinity;
    });
    expect(gap).toBeLessThan(330);
    for (const name of ['직종 고르기로 가기', "'해양경찰행정공무원' 그대로 쓰기"]) {
      // 작은 단추는 누르는 영역(::after)이 테두리까지 넓다(responsive.spec 의 smallTargets 와 같은 셈)
      const b = await dialog.getByRole('button', { name }).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el, '::after');
        const v = [s.top, s.right, s.bottom, s.left].map((x) => parseFloat(x) || 0);
        const reach = s.position === 'absolute' ? -Math.min(...v) : 0;
        return { h: r.height + 2 * reach, w: r.width + 2 * reach, right: r.right };
      });
      expect(b.h, name).toBeGreaterThanOrEqual(43.5);
      expect(b.w, name).toBeGreaterThanOrEqual(43.5);
      expect(b.right, name).toBeLessThanOrEqual(360);
    }
    await page.keyboard.press('Escape');

    // 12자 직접 적은 이름
    const long = '가나다라마바사아자차카타';
    await settings(page, makeSeedV7({}, { series: long, showSeries: true }));
    await page.goto(page.url().replace(/#.*$/, '#home'));
    await tick(page, 3000);
    await closeDialogs(page);
    const line = page.locator('#status-series');
    await expect(line).toHaveText(long);
    const home = await line.evaluate((el) => ({
      right: el.getBoundingClientRect().right,
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(home.right).toBeLessThanOrEqual(360);
    expect(home.scroll).toBeLessThanOrEqual(home.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    await page.goto(page.url().replace(/#.*$/, '#card'));
    await tick(page, 3000);
    await closeDialogs(page);
    await expect(page.locator('#card-text pre')).toContainText(long);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
  });
});
