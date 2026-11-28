import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectErrors, makeSeedV5, openApp, PACKAGE_OPEN, storedData, tick } from './helpers.ts';

/** 7급 14호봉 일반직(깃봉이: 볏이 보이는 형태) */
const SEED = makeSeedV5({ rank: '7', step: 14, hireDate: '2012-03-02', rankDate: '2020-07-01' });

async function go(page: Page, label: string): Promise<void> {
  await page
    .getByRole('navigation', { name: '화면 이동' })
    .getByRole('link', { name: label })
    .click();
  await tick(page, 800);
}

/** 캔버스 그림의 지문(그림이 바뀌었는지 비교한다) */
async function picture(canvas: Locator): Promise<string> {
  return canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
}

async function openEditor(page: Page): Promise<Locator> {
  await page.locator('#set-look').getByRole('button', { name: '꾸미기' }).click();
  const dialog = page.getByRole('dialog', { name: '호봉이 꾸미기' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function tempFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hobong-e2e-')), name);
  writeFileSync(path, content);
  return path;
}

async function importText(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: PACKAGE_OPEN }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog').getByRole('button', { name: '파일 고르기' }).click();
  await (await chooser).setFiles(tempFile('look.json', text));
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /불러오기$/ })
    .click();
  await tick(page, 6000);
}

test.describe('호봉이 꾸미기(#17·#16)', () => {
  test('고른 모습이 홈·도감·카드에 반영되고, 새로 고쳐도 남는다', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page, { seed: SEED, hash: 'home' });
    const home = page.locator('#status canvas');
    const homeBefore = await picture(home);
    await expect(page.locator('#status [role="img"]').first()).toHaveAttribute(
      'aria-label',
      /햇살 몸, 빨강 볏, 결재판을 든 깃봉이/,
    );
    await go(page, '카드');
    await tick(page, 1500);
    const cardBefore = await picture(page.locator('#card-preview canvas'));

    await go(page, '설정');
    const dialog = await openEditor(page);
    // 기본 모습: 햇살·빨강·알아서·장식 없음·직렬 따라
    await expect(dialog.getByRole('radio', { name: '햇살' })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /^알아서/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /^직렬 따라/ })).toBeChecked();
    await dialog.getByRole('radio', { name: '하늘' }).check();
    await dialog.getByRole('radio', { name: '파랑' }).check();
    await dialog.getByRole('radio', { name: '꽃핀' }).check();
    await dialog.getByRole('radio', { name: '볼 터치' }).check();
    await dialog.getByRole('radio', { name: '청진기' }).check();
    // 고르는 동안 미리보기 이름이 바뀌고, 저장은 '바꾸기'를 눌러야 한다
    await expect(dialog.locator('[role="img"]').first()).toHaveAttribute(
      'aria-label',
      '하늘 몸, 파랑 볏, 꽃핀·볼 터치를 단, 청진기를 든 깃봉이',
    );
    expect((await storedData(page))?.character.look.body).toBe('sunny');
    await dialog.getByRole('button', { name: '바꾸기' }).click();
    await expect(page.getByText('호봉이 모습을 바꿨어요.')).toBeVisible();
    const look = {
      body: 'sky',
      crest: 'blue',
      plume: 'auto',
      deco: { pin: 'flower', chest: null, cheek: true },
      prop: 'stethoscope',
    };
    expect((await storedData(page))?.character.look).toEqual(look);
    await expect(page.locator('#set-look [role="img"]')).toHaveAttribute(
      'aria-label',
      /^하늘 몸, 파랑 볏/,
    );

    await go(page, '홈');
    expect(await picture(home)).not.toBe(homeBefore);
    await expect(page.locator('#status [role="img"]').first()).toHaveAttribute(
      'aria-label',
      /하늘 몸, 파랑 볏, 꽃핀·볼 터치를 단, 청진기를 든 깃봉이/,
    );
    await expect(page.locator('#status')).toContainText('청진기');
    await go(page, '카드');
    await tick(page, 1500);
    expect(await picture(page.locator('#card-preview canvas'))).not.toBe(cardBefore);

    // 새로 고쳐도 그대로
    await page.reload();
    await tick(page);
    expect((await storedData(page))?.character.look).toEqual(look);
    await go(page, '설정');
    await expect(page.locator('#set-look [role="img"]')).toHaveAttribute(
      'aria-label',
      /^하늘 몸, 파랑 볏/,
    );
    expect(errors).toEqual([]);
  });

  test("'아무거나'는 소품을 그대로 두고, '기본으로'는 기본 모습으로 되돌린다", async ({ page }) => {
    await openApp(page, {
      seed: makeSeedV5(
        { rank: '7', step: 14 },
        {
          look: { body: 'sea', prop: 'compass', deco: { pin: 'leaf', chest: null, cheek: false } },
        },
      ),
      hash: 'settings',
    });
    const dialog = await openEditor(page);
    const status = dialog.getByRole('status').filter({ hasText: /바꿨어요|되돌렸어요/ });
    for (let i = 0; i < 3; i += 1) {
      await dialog.getByRole('button', { name: '아무거나' }).click();
      await expect(status).toContainText('바꿨어요.');
      await expect(dialog.getByRole('radio', { name: '나침반' })).toBeChecked();
    }
    await dialog.getByRole('button', { name: '바꾸기' }).click();
    const random = (await storedData(page))?.character.look;
    expect(random?.prop).toBe('compass');
    expect(random).not.toEqual({
      body: 'sea',
      crest: 'red',
      plume: 'auto',
      deco: { pin: 'leaf', chest: null, cheek: false },
      prop: 'compass',
    });

    const again = await openEditor(page);
    await again.getByRole('button', { name: '기본으로' }).click();
    await expect(again.getByRole('status').filter({ hasText: '되돌렸어요' })).toBeVisible();
    await expect(again.getByRole('radio', { name: '햇살' })).toBeChecked();
    await expect(again.getByRole('radio', { name: /^직렬 따라/ })).toBeChecked();
    // 취소하면 저장하지 않는다
    await again.getByRole('button', { name: '취소' }).click();
    expect((await storedData(page))?.character.look).toEqual(random);
    const third = await openEditor(page);
    await third.getByRole('button', { name: '기본으로' }).click();
    await third.getByRole('button', { name: '바꾸기' }).click();
    expect((await storedData(page))?.character.look).toEqual({
      body: 'sunny',
      crest: 'red',
      plume: 'auto',
      deco: { pin: null, chest: null, cheek: false },
      prop: 'auto',
    });
  });

  test('키보드만으로 열고, 방향키로 고르고, 바꾸기로 저장한다', async ({ page }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await page.locator('#set-look').getByRole('button', { name: '꾸미기' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '호봉이 꾸미기' });
    await expect(dialog).toBeVisible();
    const active = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement | null;
        return {
          name: el?.name ?? '',
          value: el?.value ?? '',
          text: el?.textContent?.trim() ?? '',
        };
      });
    // 몸 색 묶음까지 Tab(묶음마다 정지점 하나)
    for (let i = 0; i < 12 && (await active()).name !== 'look-body'; i += 1) {
      await page.keyboard.press('Tab');
    }
    expect(await active()).toMatchObject({ name: 'look-body', value: 'sunny' });
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radio', { name: '백호' })).toBeChecked();
    // 다음 Tab 은 같은 묶음의 다른 견본이 아니라 볏 색 묶음으로 간다
    await page.keyboard.press('Tab');
    expect(await active()).toMatchObject({ name: 'look-crest', value: 'red' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('radio', { name: '초록' })).toBeChecked();
    for (let i = 0; i < 20 && (await active()).text !== '바꾸기'; i += 1) {
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Enter');
    await tick(page);
    expect((await storedData(page))?.character.look).toMatchObject({
      body: 'baekho',
      crest: 'green',
    });
    // 닫은 뒤 포커스는 연 버튼으로 돌아온다
    await expect(page.locator('#set-look').getByRole('button', { name: '꾸미기' })).toBeFocused();
  });

  test('직렬은 선택이고, 홈에는 공개 설정대로, 카드에는 기본으로 넣지 않는다', async ({ page }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await expect(page.locator('#set-series')).toContainText('고르지 않음');
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
    const select = dialog.getByLabel('직렬', { exact: true });
    await expect(select).toHaveValue('');
    // 글자로 찾기: 간호·간호조무
    await dialog.getByLabel('직렬·직류 찾기').fill('간호');
    await expect(dialog.locator('#pf-series-found')).toHaveText(/2개 찾았어요/);
    await expect(select.locator('option')).toHaveCount(3);
    await dialog.getByLabel('직렬·직류 찾기').fill('');
    await expect(select.locator('optgroup')).toHaveCount(4);
    await select.selectOption('간호');
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    expect((await storedData(page))?.profile.series).toBe('간호');
    await expect(page.locator('#set-series')).toContainText('간호');

    // 홈: 직렬 이름과 계급 이름, 직렬 소품(청진기)
    await go(page, '홈');
    await expect(page.locator('#status-series')).toHaveText('간호 직렬');
    await expect(page.locator('#status .level')).toContainText('7급 14호봉');
    await expect(page.locator('#status')).toContainText('청진기');

    // 카드: 기본으로 직렬 없음, 켜면 들어간다
    await go(page, '카드');
    const text = page.locator('#card-text pre');
    const series = page.getByRole('checkbox', { name: '직렬 이름 넣기' });
    await expect(series).not.toBeChecked();
    await expect(text).not.toContainText('간호');
    await series.check();
    await expect(text).toContainText('간호 직렬');
    expect((await storedData(page))?.settings.card.showSeries).toBe(true);
    await series.uncheck();

    // 홈 공개를 끄면 직렬 이름과 계급 이름이 빠진다(소품은 그대로)
    await go(page, '설정');
    const home = page.getByRole('checkbox', { name: '홈에 직렬·계급 이름 보이기' });
    await expect(home).toBeChecked();
    await expect(page.locator('#set-identity-home-hint')).toContainText('소품으로 직렬이 짐작될');
    await home.uncheck();
    expect((await storedData(page))?.settings.identity.showSeriesHome).toBe(false);
    await go(page, '홈');
    await expect(page.locator('#status-series')).toHaveCount(0);
    await expect(page.locator('#status .level')).toHaveText('14호봉');
    await expect(page.locator('#status')).not.toContainText('7급');
    await expect(page.locator('#status')).toContainText('청진기');
  });

  test('홈 공개를 끄면 승급·승진·정년 설명과 지갑에서도 계급 이름·봉급표 번호가 빠진다', async ({
    page,
  }) => {
    // 우정직(별표 8): 계급 이름이 곧 직군이다
    await openApp(page, {
      seed: makeSeedV5(
        { payTable: 'table8', rank: '7', step: 10, hireDate: '2012-03-02', rankDate: '2020-07-01' },
        { showSeriesHome: false },
      ),
      hash: 'home',
    });
    const main = page.locator('main');
    await expect(page.locator('#status .level')).toHaveText('10호봉');
    for (const word of ['우정', '별표 8', '7급', '6급']) await expect(main).not.toContainText(word);
    await expect(page.locator('#growth')).toContainText('지금 직급으로');

    // 경찰: 경위·경감 같은 계급 이름이 홈 어디에도 없다
    await openApp(page, {
      seed: makeSeedV5(
        {
          track: 'police',
          payTable: null,
          rank: '경위',
          step: 8,
          birthDate: '1990-03-08',
          hireDate: '2015-03-02',
          rankDate: '2021-07-01',
        },
        { showSeriesHome: false },
      ),
      hash: 'home',
    });
    await expect(page.locator('#status .level')).toHaveText('8호봉');
    for (const word of ['경위', '경감', '경정']) await expect(main).not.toContainText(word);
    // 켜면 다시 보인다
    await go(page, '설정');
    await page.getByRole('checkbox', { name: '홈에 직렬·계급 이름 보이기' }).check();
    await go(page, '홈');
    await expect(page.locator('#status .level')).toContainText('경위 8호봉');
    await expect(page.locator('#growth')).toContainText('경감');
  });

  test('특정직의 기본 소품은 호봉 소품이고(직종 소품은 직접 고를 때만), 들지 않을 결재판은 약속하지 않는다', async ({
    page,
  }) => {
    const police = makeSeedV5({
      track: 'police',
      payTable: null,
      rank: '경위',
      step: 8,
      birthDate: '1990-03-08',
      hireDate: '2015-03-02',
      rankDate: '2021-07-01',
    });
    await openApp(page, { seed: police, hash: 'home' });
    const status = page.locator('#status');
    await expect(status).not.toContainText('손전등');
    await expect(status).toContainText('새 소품 "결재판"');
    await go(page, '카드');
    await expect(page.locator('#card-prop-hint')).toHaveCount(0);

    // 손전등을 직접 고르면 들고, 9호봉 결재판은 약속하지 않으며, 카드에 소품 안내가 뜬다
    await go(page, '설정');
    const dialog = await openEditor(page);
    await expect(dialog.getByRole('radio', { name: /호봉 따라/ })).toBeChecked();
    await expect(dialog.getByRole('radio', { name: /손전등/ })).toHaveAccessibleName(/내 직종/);
    await dialog.getByRole('radio', { name: /손전등/ }).check();
    await dialog.getByRole('button', { name: '바꾸기' }).click();
    await go(page, '홈');
    await expect(status).toContainText('손전등');
    await expect(status).not.toContainText('결재판');
    await go(page, '카드');
    await expect(page.locator('#card-prop-hint')).toContainText('손전등을 들고 있어요');
  });

  test('바뀐 것 없이 바꾸기를 누르면 저장하지 않는다(백업 뒤 바뀐 횟수가 그대로)', async ({
    page,
  }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    const before = (await storedData(page))?.meta.changesSinceBackup;
    const dialog = await openEditor(page);
    await dialog.getByRole('radio', { name: '보라' }).check();
    await dialog.getByRole('radio', { name: '빨강' }).check();
    await dialog.getByRole('button', { name: '바꾸기' }).click();
    await expect(page.getByText('바뀐 것이 없어요.')).toBeVisible();
    expect((await storedData(page))?.meta.changesSinceBackup).toBe(before);
  });

  test('일반직이 아니면 직렬 칸이 없고, 남은 직렬은 사용자가 지울지 고른다', async ({ page }) => {
    await openApp(page, {
      seed: makeSeedV5({ rank: '7', step: 14 }, { series: '간호' }),
      hash: 'settings',
    });
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
    await expect(dialog.getByLabel('직렬', { exact: true })).toHaveValue('간호');
    await dialog.getByRole('radio', { name: '경찰', exact: true }).click();
    await expect(dialog.getByLabel('직렬', { exact: true })).toHaveCount(0);
    await expect(dialog.locator('#pf-series-kept')).toContainText('간호');
    await dialog.getByRole('radio', { name: '일반직', exact: true }).click();
    await expect(dialog.getByLabel('직렬', { exact: true })).toHaveValue('간호');
    await dialog.getByRole('radio', { name: '경찰', exact: true }).click();
    await dialog.getByRole('button', { name: '직렬 지우기' }).click();
    await expect(dialog.locator('#pf-series-kept')).toHaveCount(0);
  });

  test('백업을 내려받고 다시 불러와도 꾸미기와 직렬이 그대로다', async ({ page }) => {
    const look = {
      body: 'sunset',
      crest: 'purple',
      plume: 'moon',
      deco: { pin: 'ribbon', chest: 'tiger', cheek: true },
      prop: 'none',
    };
    await openApp(page, {
      seed: makeSeedV5({ rank: '7', step: 14 }, { series: '전산', look }),
      hash: 'settings',
    });
    await tick(page, 6000);
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '패키지 내려받기' }).click(),
    ]);
    const text = readFileSync(await file.path(), 'utf8');
    const envelope = JSON.parse(text);
    expect(envelope.schemaVersion).toBe(7);
    expect(envelope.data.character.look).toEqual(look);
    expect(envelope.data.profile.series).toBe('전산');

    await page.getByRole('button', { name: '모두 지우고 처음부터' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '모두 지우기' }).click();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeVisible();
    await importText(page, text);
    const stored = await storedData(page);
    expect(stored?.character.look).toEqual(look);
    expect(stored?.profile.series).toBe('전산');
    expect(stored).toEqual(envelope.data);
  });

  test('모르는 꾸미기 id 가 든 백업도 거부하지 않고, 고르지 않은 칸은 그대로 둔다', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openApp(page, { seed: SEED, hash: 'settings' });
    await tick(page, 6000);
    const future = JSON.parse(
      makeSeedV5(
        { rank: '7', step: 14, nickname: '새버전' },
        {
          series: '없는직렬',
          look: {
            body: 'galaxy',
            crest: 'rainbow',
            plume: 'aurora',
            deco: { pin: 'crown-2', chest: 'medal-gold', cheek: true },
            prop: 'robot-arm',
          },
        },
      ),
    );
    await importText(page, JSON.stringify(future));
    const stored = await storedData(page);
    expect(stored?.profile.nickname).toBe('새버전');
    expect(stored?.character.look).toEqual(future.data.character.look);
    expect(stored?.profile.series).toBe('없는직렬');
    await expect(page.locator('#set-series')).toContainText('목록에 없음');

    // 그릴 때만 기본값으로: 햇살 몸, 장식 없이 볼 터치만
    await expect(page.locator('#set-look [role="img"]')).toHaveAttribute(
      'aria-label',
      '햇살 몸, 빨강 볏, 볼 터치를 단, 결재판을 든 깃봉이',
    );
    const dialog = await openEditor(page);
    await expect(dialog.locator('#look-unknown')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: '햇살' })).not.toBeChecked();
    await dialog.getByRole('radio', { name: '보라' }).check();
    await dialog.getByRole('button', { name: '바꾸기' }).click();
    // 고른 칸(볏)만 바뀌고 나머지 모르는 값은 그대로
    expect((await storedData(page))?.character.look).toEqual({
      ...future.data.character.look,
      crest: 'purple',
    });
    expect(errors).toEqual([]);
  });
});
