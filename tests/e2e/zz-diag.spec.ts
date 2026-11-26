// 임시 진단: 같은 글꼴을 형식별(woff2·woff·ttf, 작은/전체, glyf 변환 유무)로 FontFace 에 넣어 브라우저가 해독하는지 본다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { APP_URL, ROOT } from './helpers.ts';

const DIR = join(ROOT, 'tests', 'e2e', 'zz-fonts');
const FILES: [string, string][] = [
  ['orig-subset.woff2', join(ROOT, 'src', 'assets', 'fonts', 'Galmuri14.subset.woff2')],
  ['orig-subset11.woff2', join(ROOT, 'src', 'assets', 'fonts', 'Galmuri11.subset.woff2')],
  ...readdirSync(DIR).map((n): [string, string] => [n, join(DIR, n)]),
];

test('diag font formats', async ({ page, browserName }) => {
  await page.goto(APP_URL);
  const results: Record<string, string> = {};
  for (const [name, file] of FILES) {
    const b64 = readFileSync(file).toString('base64');
    results[name] = await page.evaluate(
      async ({ b64, name }) => {
        try {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          const face = new FontFace('Diag-' + name.replace(/\W/g, ''), bytes.buffer);
          await face.load();
          return face.status;
        } catch (e) {
          return String(e).slice(0, 60);
        }
      },
      { b64, name },
    );
  }
  console.log('DIAG4 ' + JSON.stringify({ browser: browserName, ...results }));
});
