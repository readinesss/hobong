import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { APP_URL, collectErrors, makeSeed, onboard, openApp, ROOT, tick } from './helpers.ts';

const TABS = ['홈', '연가', '업적', '카드', '설정'];

test.describe('서버 없음 · 외부 요청 0건', () => {
  test('file:// 로 연 단일 HTML이 문서 자신 말고는 아무것도 요청하지 않는다', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const errors = collectErrors(page);

    await openApp(page);
    await onboard(page);
    for (const tab of TABS) {
      await page
        .getByRole('navigation', { name: '화면 이동' })
        .getByRole('link', { name: tab })
        .click();
      await tick(page, 1500);
    }
    // 연가 기록, 카드 그리기까지 해 본다
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '연가' })
      .click();
    await page.locator('#leave-entry').getByRole('button', { name: '오전 반일' }).click();
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '카드' })
      .click();
    await tick(page, 1500);

    const external = requests.filter(
      (url) => !url.startsWith('data:') && !url.startsWith('blob:') && url !== APP_URL,
    );
    expect(external).toEqual([]);
    // 문서 자신은 많아야 한 번(Firefox는 file:// 문서 요청을 이 이벤트로 알리지 않는다).
    expect(requests.filter((url) => url === APP_URL).length).toBeLessThanOrEqual(1);

    // 브라우저가 직접 남긴 기록으로도 확인한다: 페이지가 불러온 리소스가 하나도 없어야 한다.
    const loaded = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('data:') && !name.startsWith('blob:')),
    );
    expect(loaded).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('쓰는 동안 다른 페이지로 이동하거나 새 창을 열지 않는다', async ({ page }) => {
    const popups: string[] = [];
    page.on('popup', (popup) => popups.push(popup.url()));
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url().split('#')[0] ?? '');
    });
    await openApp(page, { seed: makeSeed() });
    for (const tab of TABS) {
      await page
        .getByRole('navigation', { name: '화면 이동' })
        .getByRole('link', { name: tab })
        .click();
      await tick(page, 800);
    }
    // 카드 저장·데이터 내려받기도 해 본다(내려받기는 이동이 아니다)
    const nav = page.getByRole('navigation', { name: '화면 이동' });
    await nav.getByRole('link', { name: '카드' }).click();
    await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'PNG로 저장' }).click(),
    ]);
    await nav.getByRole('link', { name: '설정' }).click();
    await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '패키지 내려받기' }).click(),
    ]);
    await tick(page, 800);
    expect(popups).toEqual([]);
    expect(new Set(navigations)).toEqual(new Set([APP_URL]));
  });

  test('다른 페이지 안(iframe)에서는 열리지 않는다', async ({ page }) => {
    const host = join(mkdtempSync(join(tmpdir(), 'hobong-frame-')), 'host.html');
    writeFileSync(
      host,
      `<!doctype html><iframe src="${APP_URL}#settings" width="600" height="400"></iframe>`,
    );
    await page.goto(pathToFileURL(host).href);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByText('다른 페이지 안에서는 열리지 않아요')).toBeVisible();
    await expect(frame.getByRole('button', { name: '모두 지우고 처음부터' })).toHaveCount(0);
  });

  test('빌드 결과는 파일 하나이고, 외부 통신을 막는 보안 정책(CSP)이 들어 있다', async ({
    page,
  }) => {
    const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
    const csp =
      /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('font-src data:');
    expect(csp).toContain('img-src data: blob:');
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // 외부에서 불러오는 스크립트·스타일·글꼴이 없다
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/@import/i);

    // 정책이 실제로 적용돼 있어, 페이지가 통신을 시도해도 막힌다
    await openApp(page, { seed: makeSeed() });
    const blocked = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/');
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);
    const imageBlocked = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(false);
          img.onerror = () => resolve(true);
          img.src = 'https://example.com/pixel.png';
        }),
    );
    expect(imageBlocked).toBe(true);
  });

  test('파일 하나에 출처와 오픈소스 고지가 함께 들어 있다', async ({ page }) => {
    const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
    expect(html.slice(0, 600)).toContain('https://github.com/readinesss/hobong');
    expect(html).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(html).toContain('Svelte Contributors');

    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    const about = page.locator('#set-about');
    await expect(about.locator('#set-licenses')).toHaveCount(0);
    await about.getByRole('button', { name: '오픈소스 고지', exact: true }).click();
    await expect(about.locator('#set-licenses')).toContainText('SIL OPEN FONT LICENSE');
    await expect(about.locator('#set-licenses')).toContainText('MIT License');
  });

  test('글꼴이 번들에 들어 있어 픽셀 폰트로 그려진다', async ({ page }) => {
    await openApp(page, { seed: makeSeed() });
    // 글꼴 API(document.fonts)의 상태는 브라우저마다 다르게 보고된다(WebKit 은 새로 고친 뒤 check 가
    // false 이고 load 가 실패하지만 글자는 픽셀 폰트로 그린다). 그래서 실제로 그려진 글자 폭으로 본다:
    // 글꼴이 없으면 'Galmuri14', serif 는 serif 와 폭이 같아진다.
    const sample = '호봉 공무원 9급 iiiWWW 0123456789 · D-365';
    const differs = () =>
      page.evaluate((text) => {
        const width = (family: string, size: number) => {
          const span = document.createElement('span');
          span.textContent = text;
          span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:${size}px;font-family:${family}`;
          document.body.append(span);
          const w = span.getBoundingClientRect().width;
          span.remove();
          return w;
        };
        return (
          width("'Galmuri14', serif", 15) !== width('serif', 15) &&
          width("'Galmuri11', serif", 12) !== width('serif', 12)
        );
      }, sample);
    await expect.poll(differs).toBe(true);
    const style = await page.evaluate(() => ({
      family: getComputedStyle(document.body).fontFamily,
      size: getComputedStyle(document.body).fontSize,
    }));
    expect(style.family).toContain('Galmuri14');
    expect(style.size).toBe('15px');
  });

  test('입력값은 localStorage에만 남는다', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    const storage = await page.evaluate(() => ({
      keys: Object.keys(window.localStorage).sort(),
      prefs: window.localStorage.getItem('hobong.prefs'),
      cookies: document.cookie,
      session: Object.keys(window.sessionStorage),
    }));
    // 입력값은 hobong.data 한곳에만 있다. hobong.prefs 는 이 기기의 편의 값(고른 입력 방식·패키지 안내 상태)뿐이고
    // 입력값은 하나도 들어가지 않는다(정해진 두 낱말만 — 닉네임·날짜·직종 같은 글자가 없다)
    expect(storage.keys).toEqual(['hobong.data', 'hobong.prefs']);
    expect(JSON.parse(storage.prefs ?? '{}')).toEqual({
      onboardMode: 'form',
      packageGuide: 'pending',
    });
    expect(storage.cookies).toBe('');
    expect(storage.session).toEqual([]);
  });
});
