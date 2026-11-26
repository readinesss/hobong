// 임시 진단: WebKit 에서 번들 글꼴(data: woff2)이 왜 불러와지지 않는지 가린다. 실패하지 않는다.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from '@playwright/test';
import { APP_URL, ROOT } from './helpers.ts';

const probe = async () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const out: Record<string, unknown> = {};
  // CSS 에 선언된 글꼴의 상태(쓰도록 한 번 불러 본 뒤)
  try {
    await document.fonts.load("15px 'Galmuri14'", '호봉');
    out.cssLoad = 'ok';
  } catch (e) {
    out.cssLoad = String(e);
  }
  await sleep(300);
  out.cssFaces = [...(document.fonts as unknown as Iterable<FontFace>)].map(
    (f) => `${f.family}:${f.status}`,
  );
  // CSS 규칙에서 data: URL 을 꺼낸다
  let dataUrl = '';
  for (const sheet of [...document.styleSheets]) {
    for (const rule of [...sheet.cssRules]) {
      if (
        rule instanceof CSSFontFaceRule &&
        rule.style.getPropertyValue('font-family').includes('Galmuri14')
      ) {
        const m = /url\(["']?(data:[^"')]+)/.exec(rule.style.getPropertyValue('src'));
        if (m) dataUrl = m[1] ?? '';
      }
    }
  }
  out.dataUrlHead = dataUrl.slice(0, 40);
  out.dataUrlLength = dataUrl.length;
  // 같은 data: URL 로 FontFace(스크립트) — CSP font-src 가 적용된다
  try {
    const f = new FontFace('DiagUrl', `url(${dataUrl})`);
    await f.load();
    out.scriptUrl = f.status;
  } catch (e) {
    out.scriptUrl = String(e);
  }
  // 같은 바이트를 ArrayBuffer 로 — URL·CSP 를 거치지 않는다(디코딩만 본다)
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    out.bytesHead = [...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' ');
    const f = new FontFace('DiagBytes', bytes.buffer);
    await f.load();
    out.scriptBytes = f.status;
  } catch (e) {
    out.scriptBytes = String(e);
  }
  return out;
};

test('diag font: 원래 파일(CSP 있음)', async ({ page, browserName }) => {
  await page.goto(APP_URL);
  const r = await page.evaluate(probe);
  console.log('DIAG3 ' + JSON.stringify({ browser: browserName, csp: true, ...r }));
});

test('diag font: CSP 를 뺀 사본', async ({ page, browserName }) => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8').replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    '',
  );
  const file = join(mkdtempSync(join(tmpdir(), 'hobong-diag-')), 'nocsp.html');
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  const r = await page.evaluate(probe);
  console.log('DIAG3 ' + JSON.stringify({ browser: browserName, csp: false, ...r }));
});
