// 임시 진단: 새로 고친 뒤 글꼴이 화면·새 요소·캔버스에 실제로 쓰이는지 브라우저별로 본다. 실패하지 않는다.
import { test } from '@playwright/test';
import { APP_URL, NOW, makeSeed } from './helpers.ts';

const SEED = makeSeed();
for (const reload of [false, true]) {
  test(`diag fonts reload=${reload}`, async ({ page, browserName }) => {
    await page.clock.install({ time: new Date(NOW) });
    await page.goto(APP_URL);
    await page.evaluate((value) => localStorage.setItem('hobong.data', value), SEED);
    if (reload) await page.reload();
    else await page.goto(APP_URL + '#home');
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const text = '호봉 공무원 iiiWWW 0123';
      const span = (family: string, hidden: boolean) => {
        const s = document.createElement('span');
        s.textContent = text;
        s.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font-size:15px;font-family:${family};${hidden ? 'visibility:hidden;' : ''}`;
        document.body.append(s);
        const w = s.getBoundingClientRect().width;
        s.remove();
        return w;
      };
      const canvas = (font: string) => {
        const c = document.createElement('canvas').getContext('2d')!;
        c.font = font;
        return c.measureText(text).width;
      };
      const faces = [...(document.fonts as unknown as Iterable<FontFace>)].map(
        (f) => `${f.family}:${f.status}`,
      );
      let loadResult = 'ok';
      try {
        await document.fonts.load("15px 'Galmuri14'", '호봉');
      } catch (e) {
        loadResult = String(e);
      }
      const canvasAfterLoad = canvas("15px 'Galmuri14'") !== canvas('15px serif');
      return {
        faces,
        check: document.fonts.check("15px 'Galmuri14'", '호봉'),
        loadResult,
        hiddenSpanDiffers: span("'Galmuri14', serif", true) !== span('serif', true),
        visibleSpanDiffers: span("'Galmuri14', serif", false) !== span('serif', false),
        canvasDiffers: canvas("15px 'Galmuri14'") !== canvas('15px serif'),
        canvasAfterLoad,
      };
    });
    console.log('DIAG2 ' + JSON.stringify({ browser: browserName, reload, ...r }));
  });
}
