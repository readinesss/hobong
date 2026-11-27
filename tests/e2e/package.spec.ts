/**
 * 임용정보 패키지 안내(#19)와 '로그인·정보 저장은 준비 중' 한마디·호봉 알리기(#26).
 * 패키지는 지금의 백업 파일이다(내려받기·불러오기·암호의 검증은 backup.spec·backup-lock.spec).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  allowClipboard,
  makeSeed,
  makeSeedV5,
  onboard,
  openApp,
  PACKAGE_OPEN,
  storedData,
  tick,
} from './helpers.ts';

function tempFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hobong-e2e-')), name);
  writeFileSync(path, content);
  return path;
}

const guide = (page: Page) => page.locator('#package-guide');
const prefsOf = (page: Page) =>
  page.evaluate(() => JSON.parse(window.localStorage.getItem('hobong.prefs') ?? '{}'));

/** 공유 시트가 없는 브라우저로 둔다(주소 복사로 간다) */
const noShareSheet = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });

test.describe('임용정보 패키지 안내', () => {
  test('부화 뒤 상태창 안(호봉이 무대 바로 아래)에 안내가 나오고, 받으면 기록하고 다시 나오지 않는다', async ({
    page,
  }) => {
    await openApp(page);
    await onboard(page);
    await expect(guide(page)).toBeVisible();
    await expect(guide(page)).toContainText('이삿짐을 싸 둘까요?');
    await expect(guide(page)).toContainText('임용정보 패키지');
    // 실제 절차(파일 고르기 → 확인 → 암호)와 맞지 않는 숫자('3초 만에')를 말하지 않는다
    await expect(guide(page)).toContainText('다음엔 질문 없이 바로 시작해요');
    await expect(guide(page)).not.toContainText('3초');
    // 대화상자가 아니라 상태창 안의 한마디다: 호봉이 무대 바로 아래, 스크롤 없이 첫 화면에 보인다
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#status #package-guide')).toHaveCount(1);
    const stage = await page.locator('#status .stage').boundingBox();
    const card = await guide(page).boundingBox();
    expect(stage && card && card.y >= stage.y + stage.height - 1).toBe(true);
    await expect(guide(page)).toBeInViewport({ ratio: 1 });
    // 줄인 안내: 한 문장과 버튼. 암호·주의는 [자세히]에, 공유 권유는 받은 뒤에만
    await expect(guide(page).getByRole('checkbox', { name: '암호 걸기' })).toHaveCount(0);
    await expect(guide(page).getByRole('button', { name: '호봉 알리기' })).toHaveCount(0);
    expect((await storedData(page))?.meta.lastBackupAt).toBeNull();

    const [file] = await Promise.all([
      page.waitForEvent('download'),
      guide(page).getByRole('button', { name: '패키지 받기' }).click(),
    ]);
    expect(file.suggestedFilename()).toBe('hobong-package-20261125.json');
    const text = readFileSync(await file.path(), 'utf8');
    expect(JSON.parse(text).data.profile.nickname).toBe('김주무관');
    // 받은 것으로 기록한다
    const data = await storedData(page);
    expect(data?.meta.lastBackupAt).not.toBeNull();
    expect(data?.meta.changesSinceBackup).toBe(0);
    expect(data?.achievements['evt-backup']).toEqual({ at: '2026-11-25' });
    expect(await prefsOf(page)).toMatchObject({ packageGuide: 'done' });
    // 그 자리에서 '챙겼어요'로 바뀌고 포커스는 제목으로 간다(허공에 뜨지 않는다)
    await expect(guide(page)).toContainText('챙겼어요');
    await expect(page.locator('#package-guide-title')).toBeFocused();
    await expect(page.locator('#package-guide-title')).toHaveText('챙겼어요!');
    // 알림 영역은 파일 안내 한 줄뿐이다(위트·공유·버튼은 밖에 있고, 같은 말을 알림으로 또 띄우지 않는다)
    const said = guide(page).locator('[role="status"]');
    await expect(said).toHaveCount(1);
    await expect(said).toContainText('hobong-package-20261125.json');
    await expect(said).not.toContainText('호봉 알리기');
    await expect(said.getByRole('button')).toHaveCount(0);
    await expect(page.locator('.toast').filter({ hasText: 'hobong-package' })).toHaveCount(0);
    // 공유 권유는 받은 뒤에 나온다
    await expect(guide(page).getByRole('button', { name: '호봉 알리기' })).toBeVisible();
    await expect(guide(page)).toContainText(/준비 중|부화 전/);
    // 권유는 위트와 이어 읽힌다(이삿짐 → 이삿짐을 다 쌌으면 …). 주소만 전한다고 함께 적는다
    await expect(guide(page)).toContainText('이 파일이 호봉이의 이삿짐이에요');
    await expect(guide(page)).toContainText('이삿짐을 다 쌌으면 옆자리 알도 깨워 주세요.');
    await expect(guide(page)).toContainText('사이트 주소만 전해요');
    await guide(page).getByRole('button', { name: '닫기' }).click();
    await expect(guide(page)).toHaveCount(0);
    await expect(page.locator('#main')).toBeFocused();

    await page.reload();
    await tick(page, 2500);
    await expect(page.locator('#status')).toBeVisible();
    await expect(guide(page)).toHaveCount(0);
  });

  test('"나중에"를 누르면 다시 묻지 않는다(새로 고쳐도)', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await guide(page).getByRole('button', { name: '나중에' }).click();
    await expect(guide(page)).toHaveCount(0);
    await expect(
      page.locator('.toast').filter({ hasText: "설정의 '임용정보 패키지'" }),
    ).toBeVisible();
    expect(await prefsOf(page)).toMatchObject({ packageGuide: 'later' });
    expect((await storedData(page))?.meta.lastBackupAt).toBeNull();
    await page.reload();
    await tick(page, 2500);
    await expect(page.locator('#status')).toBeVisible();
    await expect(guide(page)).toHaveCount(0);
  });

  test('아직 고르지 않았으면 새로 고친 뒤에도 안내가 남아 있다', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await page.reload();
    await tick(page);
    await expect(guide(page)).toBeVisible();
  });

  test('암호를 걸어 받을 수 있다(1차의 암호 대화상자를 그대로 쓴다)', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    const more = guide(page).getByRole('button', { name: '자세히' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(guide(page)).toContainText('공용 PC나 공유 폴더에는 두지 말아 주세요');
    await guide(page).getByRole('checkbox', { name: '암호 걸기' }).check();
    await guide(page).getByRole('button', { name: '패키지 받기' }).click();
    const dialog = page.getByRole('dialog', { name: '암호 걸어 내려받기' });
    await dialog.getByLabel('암호', { exact: true }).fill('correct horse 1234');
    await dialog.getByLabel('암호 확인').fill('correct horse 1234');
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '암호 걸고 내려받기' }).click(),
    ]);
    expect(file.suggestedFilename()).toBe('hobong-package-20261125-locked.json');
    const text = readFileSync(await file.path(), 'utf8');
    expect(text).not.toContain('김주무관');
    expect(JSON.parse(text).format).toBe('hobong-encrypted');
    await expect(guide(page)).toContainText('챙겼어요');
    // 암호 대화상자를 거친 길도 포커스는 안내의 제목으로 간다
    await expect(page.locator('#package-guide-title')).toBeFocused();
    await expect(guide(page).locator('[role="status"]')).toContainText(
      '암호를 잊으면 되살릴 수 없어요.',
    );
    expect((await storedData(page))?.meta.lastBackupAt).not.toBeNull();
  });

  test('예전부터 쓰던 사람에게는 안내 창을 띄우지 않는다', async ({ page }) => {
    await openApp(page, { seed: makeSeed() });
    await tick(page, 2500);
    await expect(page.locator('#status')).toBeVisible();
    await expect(guide(page)).toHaveCount(0);
    expect(await prefsOf(page)).toEqual({});
  });

  test('안내의 [자세히] 안 [호봉이 꾸미기]는 설정의 꾸미기 창을 바로 연다', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await guide(page).getByRole('button', { name: '자세히' }).click();
    await guide(page).getByRole('button', { name: '호봉이 꾸미기' }).click();
    await expect(page.getByRole('dialog', { name: '호봉이 꾸미기' })).toBeVisible();
    await expect(page).toHaveTitle('설정 · 호봉');
  });
});

test.describe('패키지로 이어하기', () => {
  test('첫 화면에서 패키지를 불러오면 질문도 부화도 없이 이어지고, 꾸미기가 그대로다', async ({
    page,
  }) => {
    const seed = makeSeedV5(
      { nickname: '이어하기', rank: '7', rankDate: '2024-07-01', hireDate: '2015-03-02', step: 9 },
      {
        series: '간호',
        look: { body: 'sky', crest: 'blue', deco: { pin: 'flower', chest: null, cheek: true } },
      },
    );
    await openApp(page);
    await expect(page.getByRole('button', { name: '패키지로 이어하기' })).toBeVisible();
    await expect(
      page.getByText('받아 둔 임용정보 패키지가 있으면 질문 없이 바로 이어져요.'),
    ).toBeVisible();
    await page.getByRole('button', { name: '패키지로 이어하기' }).click();
    const dialog = page.getByRole('dialog', { name: '임용정보 패키지 불러오기' });
    // 예전 이름의 파일도 그대로 불러온다고 알린다
    await expect(dialog.locator('#import-old-name')).toContainText('hobong-backup-');
    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: '파일 고르기' }).click();
    // 예전 이름(hobong-backup-…)의 파일
    await (await chooser).setFiles(tempFile('hobong-backup-20261124.json', seed));
    await expect(dialog).toContainText('이어하기');
    await dialog.getByRole('button', { name: '불러오기', exact: true }).click();

    // 부화 연출 없이 홈: 창들이 차례로 나타나고 상태창 제목에 포커스
    await expect(page.locator('#welcome-hatch')).toHaveCount(0);
    await expect(page.locator('#status')).toBeVisible();
    await expect(page.locator('.dash.entering')).toHaveCount(1);
    await expect(page.locator('#home-arrived')).toHaveText(
      '임용정보 패키지로 이어 왔어요. 홈 화면이에요.',
    );
    await tick(page, 2500);
    await expect(page.locator('.dash.entering')).toHaveCount(0);
    // 꾸민 모습 그대로
    await expect(page.locator('#status').getByRole('img', { name: /하늘 몸.*꽃핀/ })).toBeVisible();
    const data = await storedData(page);
    expect(data?.character.look).toMatchObject({
      body: 'sky',
      crest: 'blue',
      deco: { pin: 'flower', cheek: true },
    });
    expect(data?.profile.series).toBe('간호');
    // 패키지로 이어 온 사람에게는 '패키지 받기' 안내를 띄우지 않는다
    await expect(guide(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe("'준비 중' 한마디와 호봉 알리기", () => {
  test('설정의 임용정보 패키지 창: 로그인은 준비 중이라고만 하고, 알리기는 사이트 주소만 복사한다', async ({
    page,
    browserName,
  }) => {
    await openApp(page, { seed: makeSeed({ nickname: '비밀닉네임' }), hash: 'settings' });
    await allowClipboard(page, browserName);
    await noShareSheet(page);
    const win = page.locator('#set-data');
    await expect(win.getByRole('heading', { name: '임용정보 패키지' })).toBeVisible();
    await expect(win).toContainText('(백업 파일)');
    await expect(win.locator('#set-old-name')).toContainText('hobong-backup-');
    const share = win.locator('#set-share');
    await expect(share).toContainText(/준비 중|부화 전/);
    // 기한·약속을 말하지 않는다
    await expect(share).not.toContainText(/곧|예정|출시|\d{4}년/);
    // 권유는 위트와 짝인 문장이다(설정은 '부화 전' ↔ '부화를 기다리는 동안')
    await expect(share).toContainText('로그인 버튼은 아직 부화 전이에요');
    await expect(share).toContainText('부화를 기다리는 동안 옆자리 알도 하나 깨워 주세요.');
    await share.getByRole('button', { name: '호봉 알리기' }).click();
    await expect(page.locator('.toast').filter({ hasText: '주소를 복사했어요' })).toBeVisible();
    if (browserName === 'chromium') {
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe('https://readinesss.github.io/hobong/');
      expect(copied).not.toContain('비밀닉네임');
    }
  });

  test('공유 시트가 있으면 제목·소개 글·주소만 넘긴다(닉네임·입력값 없음)', async ({ page }) => {
    await openApp(page, { seed: makeSeed({ nickname: '비밀닉네임' }), hash: 'settings' });
    await page.evaluate(() => {
      const w = window as unknown as { shared: unknown[] };
      w.shared = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: unknown) => {
          w.shared.push(data);
        },
      });
    });
    await page.locator('#set-share').getByRole('button', { name: '호봉 알리기' }).click();
    await expect(page.locator('.toast').filter({ hasText: '고마워요' })).toBeVisible();
    const shared = await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared);
    expect(shared).toHaveLength(1);
    const sent = shared[0] as Record<string, string>;
    expect(Object.keys(sent).sort()).toEqual(['text', 'title', 'url']);
    expect(sent.url).toBe('https://readinesss.github.io/hobong/');
    expect(JSON.stringify(sent)).not.toContain('비밀닉네임');
    expect(sent.text).toContain('비공식');
  });

  test('불러오기 창에는 한마디만 있다. 알리기는 권하지 않는다(첫 화면에서도 열려, 아직 써 보기 전이다)', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole('button', { name: PACKAGE_OPEN }).click();
    const dialog = page.getByRole('dialog', { name: '임용정보 패키지 불러오기' });
    await expect(dialog).toContainText(/준비 중|부화 전/);
    await expect(dialog.getByRole('button', { name: '호봉 알리기' })).toHaveCount(0);
    await expect(dialog).not.toContainText('옆자리');
  });

  test('카드 화면에서도 사이트 주소만 알릴 수 있다(카드와 달리 내 정보가 따라가지 않는다)', async ({
    page,
    browserName,
  }) => {
    await openApp(page, { seed: makeSeed({ nickname: '비밀닉네임' }), hash: 'card' });
    await allowClipboard(page, browserName);
    await noShareSheet(page);
    const tell = page.locator('#card-tell');
    await expect(tell).toContainText('카드 대신 사이트 주소만 건넬 수도 있어요.');
    await expect(tell).toContainText('사이트 주소만 전해요');
    // 패키지와 상관없는 자리라 '로그인은 준비 중' 한마디는 두지 않는다
    await expect(tell).not.toContainText(/준비 중|부화 전/);
    await tell.getByRole('button', { name: '호봉 알리기' }).click();
    await expect(page.locator('.toast').filter({ hasText: '주소를 복사했어요' })).toBeVisible();
    if (browserName === 'chromium') {
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe('https://readinesss.github.io/hobong/');
    }
  });
});
