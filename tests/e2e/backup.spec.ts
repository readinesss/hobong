import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fixture, makeSeed, openApp, storedData, tick } from './helpers.ts';

const SEED = makeSeed(
  { nickname: '백업이', hireDate: '2020-01-01', grade: 8, gradeDate: '2024-07-01', step: 6 },
  {
    leave: {
      records: [
        { id: 'a1', date: '2026-03-03', hours: 8, kind: 'day', memo: '가족 여행' },
        { id: 'a2', date: '2026-08-10', hours: 2, kind: 'hours', memo: '' },
      ],
      grantOverrideHours: { '2026': 184 },
    },
  },
);

/**
 * 임시 파일을 만든다. 테스트 결과 폴더는 이름에 한글이 들어가는데, POSIX 로캘의 자동화 브라우저는
 * 그런 경로의 파일을 파일 선택 창에 넘기지 못하므로 ASCII 경로를 쓴다.
 */
function tempFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hobong-e2e-')), name);
  writeFileSync(path, content);
  return path;
}

async function download(page: Page): Promise<{ path: string; name: string; text: string }> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '데이터 내려받기' }).click(),
  ]);
  const text = readFileSync(await file.path(), 'utf8');
  return { path: tempFile(file.suggestedFilename(), text), name: file.suggestedFilename(), text };
}

async function importFile(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog').getByRole('button', { name: '파일 고르기' }).click();
  await (await chooser).setFiles(path);
}

test.describe('데이터 내려받기·불러오기', () => {
  test('내려받기 → 초기화 → 불러오기 뒤 상태가 완전히 같다', async ({ page }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    // 업적 등 자동 기록이 끝난 뒤의 상태를 기준으로 삼는다
    await tick(page, 6000);

    const file = await download(page);
    expect(file.name).toBe('hobong-backup-20261125.json');
    const envelope = JSON.parse(file.text);
    expect(envelope).toMatchObject({ app: 'hobong', schemaVersion: 3, appVersion: '0.1.0' });
    expect(typeof envelope.exportedAt).toBe('string');
    await expect(page.getByText('급여·인사 정보가 들어 있으니')).toBeVisible();
    // 브라우저는 저장이 끝났는지 알려 주지 않으므로 단정하지 않고 확인을 부탁한다
    await expect(page.getByText('파일이 생겼는지 확인해 주세요')).toBeVisible();
    // 내려받은 뒤에는 "마지막 내려받기"가 기록되고, 파일에도 같은 기록이 들어 있다
    const afterExport = await storedData(page);
    expect(afterExport?.meta.lastBackupAt).toBe(envelope.exportedAt);
    expect(afterExport?.meta.changesSinceBackup).toBe(0);
    expect(envelope.data.meta).toMatchObject({
      lastBackupAt: envelope.exportedAt,
      changesSinceBackup: 0,
    });
    expect(envelope.data.achievements['evt-backup']).toEqual({ at: '2026-11-25' });
    expect(afterExport).toEqual(envelope.data);

    // 초기화
    await page.getByRole('button', { name: '모두 지우고 처음부터' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '모두 지우기' }).click();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeVisible();
    expect(await storedData(page)).toBeNull();

    // 불러오기
    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    await importFile(page, file.path);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('백업이');
    await expect(dialog).toContainText('8급 6호봉');
    await expect(dialog).toContainText('2건');
    await dialog.getByRole('button', { name: '불러오기', exact: true }).click();
    // 비어 있던 곳에 불러왔으므로 되돌릴 것이 없다(알림은 몇 초 뒤 사라지므로 바로 본다)
    await expect(page.getByText('다시 만나서 반가워요')).toBeVisible();
    await expect(page.getByText('되돌릴 수 있어요')).toHaveCount(0);
    await tick(page, 6000);

    await expect(page.locator('#status')).toContainText('8급 6호봉');
    // 파일에 담긴 상태와 저장된 상태가 한 글자도 다르지 않다
    expect(await storedData(page)).toEqual(envelope.data);
    expect(await page.evaluate(() => localStorage.getItem('hobong.undo'))).toBeNull();
    // 되살린 뒤에도 백업 알림이 뜨지 않고, 설정에 마지막 내려받기 시각이 보인다
    await expect(page.getByText('아직 데이터를 내려받은 적이 없어요.')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '설정' })
      .click();
    await expect(page.locator('#set-data')).not.toContainText('아직 없음');
  });

  test('모두 지우기 전에 내려받았다면, 파일이 저장된 것을 확인해야 지울 수 있다', async ({
    page,
  }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await tick(page, 3000);
    await page.getByRole('button', { name: '모두 지우고 처음부터' }).click();
    const dialog = page.getByRole('dialog');
    // 내려받지 않고 바로 지우는 길은 그대로 열려 있다
    await expect(dialog.getByRole('button', { name: '모두 지우기' })).toBeEnabled();
    await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '먼저 내려받기' }).click(),
    ]);
    await expect(dialog.getByRole('button', { name: '모두 지우기' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: '백업 파일이 저장된 것을 확인했어요' }).check();
    await expect(dialog.getByRole('button', { name: '모두 지우기' })).toBeEnabled();
  });

  test('손상된 파일·다른 파일은 거부하고 기존 데이터를 건드리지 않는다', async ({ page }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await tick(page, 6000);
    const before = await storedData(page);

    const broken = tempFile('broken.json', SEED.slice(0, 200));
    const other = tempFile('other.json', JSON.stringify({ hello: 'world' }));
    const newer = tempFile(
      'newer.json',
      JSON.stringify({ ...JSON.parse(SEED), schemaVersion: 99 }),
    );

    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    const dialog = page.getByRole('dialog');

    await importFile(page, broken);
    await expect(dialog.getByRole('alert')).toContainText('손상');
    await expect(dialog.getByRole('alert')).toContainText('지금 데이터는 그대로예요');

    await importFile(page, other);
    await expect(dialog.getByRole('alert')).toContainText('호봉 데이터 파일이 아닙니다');

    await importFile(page, newer);
    await expect(dialog.getByRole('alert')).toContainText('더 새로운 버전');

    expect(await storedData(page)).toEqual(before);
  });

  test('더 새 버전에서 저장한 데이터는 건드리지 않고, 새 버전으로 열어 달라고만 한다', async ({
    page,
  }) => {
    const newer = JSON.stringify({ ...JSON.parse(SEED), schemaVersion: 99 });
    await openApp(page, { seed: newer });
    await expect(page.locator('#welcome-newer')).toContainText('더 새 버전의 호봉');
    await expect(page.getByRole('button', { name: '새로 시작' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '데이터 불러오기' })).toHaveCount(0);
    await page.reload();
    await tick(page);
    expect(await page.evaluate(() => localStorage.getItem('hobong.data'))).toBe(newer);
    expect(await page.evaluate(() => localStorage.getItem('hobong.corrupt'))).toBeNull();
  });

  test('다른 탭이 더 새 버전으로 저장하면 이 탭은 더는 쓰지 않는다', async ({ page, context }) => {
    await openApp(page, { seed: SEED });
    await tick(page, 3000);
    const other = await context.newPage();
    await other.goto(page.url());
    const newer = JSON.stringify({ ...JSON.parse(SEED), schemaVersion: 99 });
    await other.evaluate((value) => localStorage.setItem('hobong.data', value), newer);
    await expect(page.locator('#notice-stale')).toContainText('새 버전');
    // 이 탭에서 무언가 바꿔도 저장소의 새 데이터를 덮어쓰지 않는다
    await page.getByRole('button', { name: '금액 가리기' }).click();
    await tick(page);
    expect(await page.evaluate(() => localStorage.getItem('hobong.data'))).toBe(newer);
    await other.close();
  });

  test('읽지 못한 저장본은 따로 두고, 새로 고쳐도 내려받을 수 있게 안내한다', async ({ page }) => {
    const broken = SEED.slice(0, 300);
    await openApp(page, { seed: broken });
    const notice = page.locator('#welcome-corrupt');
    await expect(notice).toContainText('따로 옮겨 두었어요');
    await page.reload();
    await tick(page);
    await expect(notice).toContainText('따로 옮겨 두었어요');
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      notice.getByRole('button', { name: '읽지 못한 데이터 내려받기' }).click(),
    ]);
    expect(file.suggestedFilename()).toBe('hobong-unreadable-20261125.json');
    expect(readFileSync(await file.path(), 'utf8')).toBe(broken);
    await notice.getByRole('button', { name: '따로 둔 데이터 지우기' }).click();
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('hobong.corrupt'))).toBeNull();
  });

  test('구버전(v1) 파일은 자동으로 변환해 불러온다', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    await importFile(page, tempFile('backup-v1.json', fixture('backup-v1.json')));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('예전 형식(버전 1)');
    await dialog.getByRole('button', { name: '불러오기', exact: true }).click();
    await tick(page, 6000);
    // v1의 다음 승급일(2026-09-01)이 지났으므로 오늘 기준으로는 5호봉이다
    await expect(page.locator('#status')).toContainText('9급 5호봉');
    const data = await storedData(page);
    expect(data?.profile).toMatchObject({ nickname: '김주무관', gradeDate: '2022-09-01', step: 4 });
    expect(data?.leave.records).toHaveLength(3);
    expect(data?.leave.grantOverrideHours).toEqual({ '2026': 128 });
    expect(JSON.parse(fixture('backup-v1.json')).schemaVersion).toBe(1);
  });

  test('기존 데이터가 있으면 확인을 받고, 덮어쓴 뒤에도 되돌릴 수 있다', async ({ page }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await tick(page, 6000);
    const before = await storedData(page);

    const incoming = tempFile('incoming.json', makeSeed({ nickname: '새사람', grade: 7, step: 3 }));

    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    await importFile(page, incoming);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('지금 이 브라우저에 있는 데이터는 불러온 내용으로 바뀌어요');
    await dialog.getByRole('button', { name: '덮어쓰고 불러오기' }).click();
    await tick(page, 6000);
    expect((await storedData(page))?.profile.nickname).toBe('새사람');

    // 되돌리기
    await page.getByRole('button', { name: '불러오기 전으로 되돌리기' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '되돌리기' }).click();
    await tick(page, 6000);
    expect(await storedData(page)).toEqual(before);
    await expect(page.getByRole('button', { name: '불러오기 전으로 되돌리기' })).toHaveCount(0);
  });

  test('첫 화면에 파일을 끌어다 놓아 불러올 수 있다', async ({ page }) => {
    await openApp(page);
    const data = await page.evaluateHandle((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'hobong-backup-20261124.json', { type: 'application/json' }));
      return dt;
    }, SEED);
    await page.dispatchEvent('main.welcome', 'drop', { dataTransfer: data });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('백업이');
    await dialog.getByRole('button', { name: '불러오기', exact: true }).click();
    await tick(page, 6000);
    await expect(page.locator('#status')).toContainText('8급 6호봉');
  });

  test('파일 저장이 막힌 환경을 위해 글자로 보고 붙여넣을 수 있다', async ({ page }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await tick(page, 6000);
    await page.getByRole('button', { name: /글자로 보기/ }).click();
    const text = await page.getByRole('dialog').locator('textarea').inputValue();
    expect(JSON.parse(text).data.profile.nickname).toBe('백업이');
    await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click();

    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /글자로 붙여넣기/ }).click();
    await dialog.locator('textarea').fill(text);
    await dialog.getByRole('button', { name: '확인하기' }).click();
    await expect(dialog).toContainText('8급 6호봉');
  });

  test('변경이 쌓이면 백업을 권한다', async ({ page }) => {
    const seed = JSON.parse(SEED);
    seed.data.meta.changesSinceBackup = 9;
    await openApp(page, { seed: JSON.stringify(seed) });
    await expect(page.getByText('아직 데이터를 내려받은 적이 없어요.')).toBeVisible();
    await page.getByRole('button', { name: '나중에' }).click();
    await expect(page.getByText('아직 데이터를 내려받은 적이 없어요.')).toHaveCount(0);
  });
});
