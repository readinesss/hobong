// 임시 진단: 브라우저마다 다른 탭의 localStorage 변경이 이 탭에 전해지는지(값·storage 이벤트) 본다.
// 결과는 DIAG 로 시작하는 한 줄 JSON 으로 찍는다. 실패하지 않는다.
import { test } from '@playwright/test';
import { APP_URL, NOW, makeSeed } from './helpers.ts';

const SEED = makeSeed();
const NEWER = JSON.stringify({ ...JSON.parse(SEED), schemaVersion: 99 });

type Variant = { name: string; clock: boolean; seed: 'page' | 'init' | 'none'; reload: boolean };
const VARIANTS: Variant[] = [
  { name: 'page-noreload', clock: true, seed: 'page', reload: false },
  { name: 'page-reload', clock: true, seed: 'page', reload: true },
  { name: 'init-noreload', clock: true, seed: 'init', reload: false },
  { name: 'none-reload', clock: true, seed: 'none', reload: true },
  { name: 'page-reload-noclock', clock: false, seed: 'page', reload: true },
];

for (const v of VARIANTS) {
  test(`diag ${v.name}`, async ({ page, context, browserName }) => {
    if (v.clock) await page.clock.install({ time: new Date(NOW) });
    if (v.seed === 'init') {
      await page.addInitScript((value) => {
        if (localStorage.getItem('hobong.data') === null)
          localStorage.setItem('hobong.data', value);
      }, SEED);
    }
    await page.goto(APP_URL);
    if (v.seed === 'page')
      await page.evaluate((value) => localStorage.setItem('hobong.data', value), SEED);
    if (v.reload) await page.reload();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const w = window as unknown as { __ev: string[] };
      w.__ev = [];
      window.addEventListener('storage', (e) => w.__ev.push(String(e.key)));
    });
    const other = await context.newPage();
    await other.goto(APP_URL);
    await other.waitForTimeout(500);
    const otherSawSeed = await other.evaluate(() =>
      (localStorage.getItem('hobong.data') ?? 'null').slice(0, 40),
    );
    await other.evaluate((value) => localStorage.setItem('hobong.data', value), NEWER);
    await page.waitForTimeout(1500);
    const pageView = await page.evaluate(() => ({
      events: (window as unknown as { __ev: string[] }).__ev,
      value: (localStorage.getItem('hobong.data') ?? 'null').includes('"schemaVersion":99')
        ? 'newer'
        : 'old-or-null',
      stale: !!document.querySelector('#notice-stale'),
    }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(300);
    const afterFocus = await page.evaluate(() => !!document.querySelector('#notice-stale'));
    console.log(
      'DIAG ' +
        JSON.stringify({
          browser: browserName,
          variant: v.name,
          otherSawSeed: otherSawSeed !== 'null',
          ...pageView,
          afterFocus,
        }),
    );
    await other.close();
  });
}
