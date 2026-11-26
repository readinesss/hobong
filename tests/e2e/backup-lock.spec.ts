/**
 * 백업 파일에 암호 걸기(#13).
 * 암호로 내려받기 → 초기화 → 암호로 불러오기, 틀린 암호, 글자로 보기·붙여넣기, WebCrypto 가 없는 브라우저.
 * 암호는 저장소·주소·알림 어디에도 남지 않아야 한다.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { encryptBackup } from '../../src/lib/store/crypto.ts';
import { makeSeed, openApp, storedData, tick } from './helpers.ts';

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
const PASSWORD = 'hobong-pass-1';

/** ASCII 경로의 임시 파일(backup.spec.ts 와 같은 까닭) */
function tempFile(name: string, content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hobong-e2e-')), name);
  writeFileSync(path, content);
  return path;
}

async function importFile(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog').getByRole('button', { name: '파일 고르기' }).click();
  await (await chooser).setFiles(path);
}

/** '암호 걸기'를 켜고 '데이터 내려받기'로 암호 파일을 받는다 */
async function lockedDownload(page: Page): Promise<{ path: string; name: string; text: string }> {
  await page.getByRole('checkbox', { name: /암호 걸기/ }).check();
  await page.getByRole('button', { name: '데이터 내려받기' }).click();
  const dialog = page.getByRole('dialog', { name: '암호 걸어 내려받기' });
  await expect(dialog.getByLabel('암호', { exact: true })).toBeFocused();
  await dialog.getByLabel('암호', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('암호 확인').fill(PASSWORD);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '암호 걸고 내려받기' }).click(),
  ]);
  await expect(dialog).toHaveCount(0);
  const text = readFileSync(await file.path(), 'utf8');
  return { path: tempFile(file.suggestedFilename(), text), name: file.suggestedFilename(), text };
}

/**
 * 이 엔진이 file:// 에서 WebCrypto 를 주는지. 주지 않는 엔진에서는 암호 기능을 숨기는 것이 맞는 동작이라
 * (마지막 테스트가 그 화면을 본다) 암호를 거는 테스트는 건너뛴다. Chromium·Firefox·WebKit 은 모두 준다.
 */
async function requireWebCrypto(page: Page): Promise<void> {
  const has = await page.evaluate(() => !!window.crypto?.subtle);
  test.skip(!has, '이 엔진은 file:// 에서 WebCrypto 를 주지 않는다');
}

/** 암호가 이 페이지의 저장소·주소에 남지 않았는지 */
async function expectNoPasswordLeft(page: Page): Promise<void> {
  const leaked = await page.evaluate((secret) => {
    const values: string[] = [location.href, document.title];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? '';
      values.push(key, localStorage.getItem(key) ?? '');
    }
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i) ?? '';
      values.push(key, sessionStorage.getItem(key) ?? '');
    }
    // 화면에 남은 입력란 값(닫힌 대화상자의 입력란은 사라져야 한다)
    for (const input of Array.from(document.querySelectorAll('input'))) values.push(input.value);
    return values.some((v) => v.includes(secret));
  }, PASSWORD);
  expect(leaked).toBe(false);
}

test.describe('백업 파일 암호', () => {
  test('암호로 내려받기 → 초기화 → 암호로 불러오기 뒤 상태가 같다(틀린 암호는 다시 묻는다)', async ({
    page,
  }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await requireWebCrypto(page);
    await tick(page, 6000);

    // 기본은 지금처럼 암호 없이 내려받는다
    await expect(page.getByRole('checkbox', { name: /암호 걸기/ })).not.toBeChecked();

    const file = await lockedDownload(page);
    expect(file.name).toBe('hobong-backup-20261125-locked.json');
    expect(file.text).not.toContain('백업이');
    expect(file.text).not.toContain('가족 여행');
    expect(file.text).not.toContain(PASSWORD);
    const container = JSON.parse(file.text);
    expect(container).toMatchObject({
      app: 'hobong',
      format: 'hobong-encrypted',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 },
      cipher: { name: 'AES-GCM' },
    });

    // 알림에는 암호 없이 파일 이름과 주의만 적는다
    const toast = page.locator('.toasts');
    await expect(toast).toContainText('암호를 걸어 내려받기를 시작했어요');
    await expect(toast).toContainText('hobong-backup-20261125-locked.json');
    await expect(toast).not.toContainText(PASSWORD);
    await expectNoPasswordLeft(page);

    // 암호 파일로 내려받아도 "마지막 내려받기"가 기록된다
    const afterExport = await storedData(page);
    expect(afterExport?.meta.changesSinceBackup).toBe(0);
    expect(afterExport?.meta.lastBackupAt).not.toBeNull();

    // 초기화
    await page.getByRole('button', { name: '모두 지우고 처음부터' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '모두 지우기' }).click();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeVisible();
    expect(await storedData(page)).toBeNull();

    // 첫 화면에서 불러오기 → 암호를 묻는다
    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    await importFile(page, file.path);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('암호가 걸린 백업이에요');
    await expect(dialog).toContainText('hobong-backup-20261125-locked.json');
    const pw = dialog.getByLabel('암호', { exact: true });
    await expect(pw).toHaveAttribute('type', 'password');
    await expect(pw).toBeFocused();
    await expect(dialog.getByRole('button', { name: '열기' })).toBeDisabled();

    // 틀린 암호: 아무것도 바뀌지 않고, 입력란을 비워 다시 묻는다
    await pw.fill('hobong-pass-2');
    await dialog.getByRole('button', { name: '열기' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('암호가 틀렸거나 파일이 손상됐어요');
    await expect(alert).toContainText('지금 데이터는 그대로예요');
    await expect(pw).toHaveValue('');
    await expect(pw).toHaveAttribute('aria-invalid', 'true');
    await expect(pw).toBeFocused();
    expect(await storedData(page)).toBeNull();

    // 맞는 암호(Enter 로 연다) → 지금의 확인 화면으로 이어진다
    await pw.fill(PASSWORD);
    await pw.press('Enter');
    await expect(dialog).toContainText('이 파일을 불러올까요?');
    await expect(dialog).toContainText('백업이');
    await expect(dialog).toContainText('8급 6호봉');
    await expect(dialog).toContainText('2건');
    await dialog.getByRole('button', { name: '불러오기', exact: true }).click();
    await expect(page.getByText('다시 만나서 반가워요')).toBeVisible();
    await tick(page, 6000);
    await expect(page.locator('#status')).toContainText('8급 6호봉');
    expect(await storedData(page)).toEqual(afterExport);
    await expectNoPasswordLeft(page);
  });

  test('데이터가 있을 때 틀린 암호를 넣어도 지금 데이터는 바뀌지 않는다', async ({ page }) => {
    const other = makeSeed({ nickname: '다른이', grade: 7, step: 3 });
    const plain = JSON.stringify({ ...JSON.parse(other), exportedAt: '2026-11-20T00:00:00.000Z' });
    const sealed = await encryptBackup(`${plain}\n`, PASSWORD);
    if (!sealed.ok) throw new Error(sealed.code);
    const path = tempFile('incoming-locked.json', sealed.text);

    await openApp(page, { seed: SEED, hash: 'settings' });
    await requireWebCrypto(page);
    await tick(page, 6000);
    const before = await storedData(page);

    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    await importFile(page, path);
    const dialog = page.getByRole('dialog');
    const pw = dialog.getByLabel('암호', { exact: true });
    await pw.fill('틀린암호12345');
    await pw.press('Enter');
    await expect(dialog.getByRole('alert')).toContainText('암호가 틀렸거나 파일이 손상됐어요');
    await tick(page, 3000);
    expect(await storedData(page)).toEqual(before);

    // 다른 파일을 고르면 처음 화면으로 돌아간다
    await dialog.getByRole('button', { name: '다른 파일' }).click();
    await expect(dialog.getByRole('button', { name: '파일 고르기' })).toBeVisible();
    await expect(dialog.getByLabel('암호', { exact: true })).toHaveCount(0);

    // 맞는 암호로 열면 덮어쓰기 경고가 있는 지금의 확인 화면이 나온다
    await importFile(page, path);
    await dialog.getByLabel('암호', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: '열기' }).click();
    await expect(dialog).toContainText('다른이');
    await expect(dialog).toContainText('지금 이 브라우저에 있는 데이터는 불러온 내용으로 바뀌어요');
    await dialog.getByRole('button', { name: '다른 파일' }).click();
    await dialog.getByRole('button', { name: '닫기' }).click();
    expect(await storedData(page)).toEqual(before);
  });

  test('두 암호가 다르거나 8자보다 짧으면 걸지 않고, 닫으면 입력란이 빈다', async ({ page }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await requireWebCrypto(page);
    await tick(page, 3000);
    await page.getByRole('checkbox', { name: /암호 걸기/ }).check();
    await page.getByRole('button', { name: '데이터 내려받기' }).click();
    const dialog = page.getByRole('dialog', { name: '암호 걸어 내려받기' });
    await expect(dialog).toContainText('잊으면 아무도(호봉도) 이 파일을 되살릴 수 없어요');
    const pw1 = dialog.getByLabel('암호', { exact: true });
    const pw2 = dialog.getByLabel('암호 확인');
    await expect(pw1).toHaveAttribute('type', 'password');
    await expect(pw2).toHaveAttribute('type', 'password');

    let downloads = 0;
    page.on('download', () => (downloads += 1));

    await pw1.fill('hobong-pass-1');
    await pw2.fill('hobong-pass-2');
    await dialog.getByRole('button', { name: '암호 걸고 내려받기' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('두 암호가 서로 달라요.');
    await expect(pw1).toHaveValue('');
    await expect(pw2).toHaveValue('');
    await expect(pw1).toBeFocused();

    await pw1.fill('short1');
    await pw2.fill('short1');
    await pw2.press('Enter');
    await expect(dialog.getByRole('alert')).toHaveText('암호를 8자 이상 넣어 주세요.');

    // 입력하다 닫으면 남지 않는다
    await pw1.fill(PASSWORD);
    await pw2.fill(PASSWORD);
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toHaveCount(0);
    await expectNoPasswordLeft(page);
    await page.getByRole('button', { name: '데이터 내려받기' }).click();
    await expect(pw1).toHaveValue('');
    await expect(pw2).toHaveValue('');
    await page.keyboard.press('Escape');
    expect(downloads).toBe(0);

    // 모두 지우기 안의 '먼저 내려받기'는 암호 없이 내려받는다고 적어 둔다
    await page.getByRole('button', { name: '모두 지우고 처음부터' }).click();
    await expect(page.locator('#reset-plain-note')).toContainText('여기서는 암호 없이 내려받아요');
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('dialog').getByRole('button', { name: '먼저 내려받기' }).click(),
    ]);
    expect(file.suggestedFilename()).toBe('hobong-backup-20261125.json');
  });

  test('글자로 보기(암호)를 불러오기에 붙여넣고 암호를 넣으면 열린다', async ({ page }) => {
    await openApp(page, { seed: SEED, hash: 'settings' });
    await requireWebCrypto(page);
    await tick(page, 6000);
    await page.getByRole('checkbox', { name: /암호 걸기/ }).check();
    await page.getByRole('button', { name: /글자로 보기/ }).click();
    const lockDialog = page.getByRole('dialog', { name: '암호 걸어 글자로 보기' });
    await lockDialog.getByLabel('암호', { exact: true }).fill(PASSWORD);
    await lockDialog.getByLabel('암호 확인').fill(PASSWORD);
    await lockDialog.getByRole('button', { name: '암호 걸고 글자로 보기' }).click();

    const textDialog = page.getByRole('dialog', { name: '백업 내용(글자)' });
    await expect(textDialog).toContainText('암호가 걸린 내용이에요');
    const text = await textDialog.locator('textarea').inputValue();
    expect(JSON.parse(text).format).toBe('hobong-encrypted');
    expect(text).not.toContain('백업이');
    await textDialog.getByRole('button', { name: '닫기' }).click();
    await expectNoPasswordLeft(page);
    const before = await storedData(page);

    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: '파일을 고를 수 없나요? 글자로 붙여넣기', exact: true })
      .click();
    await dialog.locator('textarea').fill(text);
    await dialog.getByRole('button', { name: '확인하기' }).click();
    await expect(dialog).toContainText('암호가 걸린 백업이에요');
    await expect(dialog).toContainText('붙여넣은 글자');
    await dialog.getByLabel('암호', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: '열기' }).click();
    await expect(dialog).toContainText('8급 6호봉');
    await expect(dialog).toContainText('백업이');
    expect(await storedData(page)).toEqual(before);
  });

  test('암호 파일을 첫 화면에 끌어다 놓아도 암호를 묻는다', async ({ page }) => {
    const sealed = await encryptBackup(`${SEED}\n`, PASSWORD);
    if (!sealed.ok) throw new Error(sealed.code);
    await openApp(page);
    await requireWebCrypto(page);
    const data = await page.evaluateHandle((text) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([text], 'hobong-backup-20261124-locked.json', { type: 'application/json' }),
      );
      return dt;
    }, sealed.text);
    await page.dispatchEvent('main.welcome', 'drop', { dataTransfer: data });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('암호가 걸린 백업이에요');
    await dialog.getByLabel('암호', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: '열기' }).click();
    await dialog.getByRole('button', { name: '불러오기', exact: true }).click();
    await tick(page, 6000);
    await expect(page.locator('#status')).toContainText('8급 6호봉');
  });

  test('형식이 틀린 암호 파일은 암호를 묻기 전에 거른다', async ({ page }) => {
    const sealed = await encryptBackup(`${SEED}\n`, PASSWORD);
    if (!sealed.ok) throw new Error(sealed.code);
    const c = JSON.parse(sealed.text);
    const weak = tempFile(
      'weak.json',
      JSON.stringify({ ...c, kdf: { ...c.kdf, iterations: 1000 } }),
    );
    const newer = tempFile('newer.json', JSON.stringify({ ...c, version: 2 }));
    const broken = tempFile('broken.json', JSON.stringify({ ...c, cipher: { name: 'AES-GCM' } }));

    await openApp(page, { seed: SEED, hash: 'settings' });
    await requireWebCrypto(page);
    await tick(page, 3000);
    const before = await storedData(page);
    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    const dialog = page.getByRole('dialog');

    await importFile(page, weak);
    await expect(dialog.getByRole('alert')).toContainText('설정 값이 허용 범위를 벗어나');
    await importFile(page, newer);
    await expect(dialog.getByRole('alert')).toContainText('더 새 버전의 호봉에서 만든 암호 파일');
    await importFile(page, broken);
    await expect(dialog.getByRole('alert')).toContainText('암호 파일의 형식이 맞지 않아요');
    await expect(dialog.getByLabel('암호', { exact: true })).toHaveCount(0);
    expect(await storedData(page)).toEqual(before);
  });

  test('WebCrypto 를 쓸 수 없는 브라우저에서는 선택지를 숨기고 까닭을 알린다', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, 'subtle', {
        configurable: true,
        get: () => undefined,
      });
    });
    const sealed = await encryptBackup(`${SEED}\n`, PASSWORD);
    if (!sealed.ok) throw new Error(sealed.code);
    const path = tempFile('locked.json', sealed.text);

    await openApp(page, { seed: SEED, hash: 'settings' });
    await tick(page, 3000);
    expect(await page.evaluate(() => typeof window.crypto.subtle)).toBe('undefined');
    await expect(page.getByRole('checkbox', { name: /암호 걸기/ })).toHaveCount(0);
    await expect(page.locator('#set-lock-unavailable')).toContainText(
      '암호 기능(WebCrypto)을 쓸 수 없어',
    );
    // 암호 없는 내려받기는 그대로 된다
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '데이터 내려받기' }).click(),
    ]);
    expect(file.suggestedFilename()).toBe('hobong-backup-20261125.json');

    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    await importFile(page, path);
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      '이 브라우저에서는 암호가 걸린 파일을 열 수 없어요',
    );
  });
});
