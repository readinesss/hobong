// 빌드 후처리: (1) 단일 HTML인지 검증 (2) 외부 참조가 없는지 검증
// (3) 인라인 스크립트 해시 기반 CSP 주입 — 브라우저 수준에서 외부 통신을 차단한다.
// (4) 파일 머리에 출처·오픈소스 고지 주석 (5) 내려받기용 사본(hobong.html) 생성
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_URL } from '../src/lib/config.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const DIST = new URL('../dist/', import.meta.url).pathname;
const INDEX = join(DIST, 'index.html');

function fail(message) {
  console.error(`\n[postbuild] 실패: ${message}\n`);
  process.exit(1);
}

function listFiles(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

let html = readFileSync(INDEX, 'utf8');

// (1) 단일 파일 검증: dist에는 index.html(과 이전 실행이 만든 사본)만 있어야 한다.
const extra = listFiles(DIST).filter((f) => f !== 'index.html' && f !== 'hobong.html');
if (extra.length > 0) fail(`dist에 index.html 외의 파일이 있습니다: ${extra.join(', ')}`);

// (2) 외부 참조 검증
// 마크업: 리소스를 불러오는 속성이 없어야 한다(인라인 data: 는 허용).
const markup = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
const markupPatterns = [
  /<script\b[^>]*\bsrc\s*=/i,
  /<link\b[^>]*\bhref\s*=/i,
  /<(?:img|audio|video|source|iframe|embed|object)\b[^>]*\b(?:src|data)\s*=\s*["']?(?!data:|blob:)/i,
];
for (const re of markupPatterns) {
  const m = html.match(re);
  if (m) fail(`외부 리소스 참조가 남아 있습니다: ${m[0].slice(0, 120)}`);
}
if (/<script\b[^>]*\bsrc\s*=/i.test(markup)) fail('외부 스크립트 태그가 있습니다.');

// 스타일: url()은 data: 만, @import 는 금지.
for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
  const css = m[1];
  const badUrl = css.match(/url\(\s*["']?(?!data:|#)[^)"']{0,80}/i);
  if (badUrl) fail(`스타일에 외부 url()이 있습니다: ${badUrl[0]}`);
  if (/@import\b/i.test(css)) fail('스타일에 @import 가 있습니다.');
}

// 스크립트: 네트워크로 나가는 API를 쓰지 않아야 한다(CSP가 막지만 코드에도 없어야 한다).
// 하위 리소스 요청은 CSP가 막지만, 다른 페이지로 이동하거나 새 창을 여는 것은 CSP(메타 태그)로
// 막을 수 없으므로 여기서 막는다. 식별자 자체가 나오지 않아야 통과한다(fetch?.() 같은 우회 표기 포함).
const forbiddenApis = [
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /\bimportScripts\b/,
  /\bserviceWorker\s*\.\s*register\b/,
  /\bRTCPeerConnection\b/,
  /\bWebTransport\b/,
  /\bnew\s+(?:Shared)?Worker\b/,
  /(?<![\w.$])import\s*\(/,
  /\bwindow\s*\.\s*open\s*\(/,
  /(?<![\w.$])open\s*\(/,
  /\blocation\s*\.\s*(?:assign|replace)\s*\(/,
  /\blocation\s*(?:\.\s*href\s*)?=(?!=)/,
  /\.ping\s*=/,
  /\b_blank\b/,
];
for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  for (const re of forbiddenApis) {
    const hit = m[1].match(re);
    if (hit) fail(`스크립트에 네트워크 API 사용이 있습니다: ${hit[0]}`);
  }
}

// (3) CSP 주입
const scriptHashes = [];
for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  const body = m[1];
  if (!body.trim()) continue;
  scriptHashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
}
if (scriptHashes.length === 0) fail('인라인 스크립트를 찾지 못했습니다.');

const csp = [
  "default-src 'none'",
  `script-src ${scriptHashes.join(' ')}`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
  fail('CSP 메타 태그가 이미 있습니다. 빌드 산출물이 중복 처리되었습니다.');
}
const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
const charsetRe = /<meta\s+charset=["']?utf-8["']?\s*\/?>/i;
if (!charsetRe.test(html)) fail('<meta charset> 태그를 찾지 못했습니다.');
html = html.replace(charsetRe, (tag) => `${tag}\n    ${cspTag}`);

// (4) 파일 머리에 출처와 오픈소스 고지를 남긴다(파일 하나만 돌아다녀도 무엇인지 알 수 있게).
const doctypeRe = /^\s*<!doctype html>/i;
if (!doctypeRe.test(html)) fail('<!doctype html> 로 시작하지 않습니다.');
const banner = [
  '<!--',
  `  호봉 (hobong) v${pkg.version}`,
  '  공무원 호봉·월급·승급·연가·정년을 확인하는 픽셀아트 웹사이트.',
  '  이 파일 하나로 동작합니다. 서버가 없고, 외부로 아무것도 보내지 않습니다(아래 CSP로 차단).',
  `  소스와 규정 데이터: ${REPO_URL}`,
  '  포함된 오픈소스: Svelte (MIT), Galmuri 글꼴 (SIL OFL 1.1).',
  '  라이선스 전문은 화면의 [설정 > 호봉에 대하여 > 오픈소스 고지]에 있습니다.',
  '-->',
].join('\n');
html = html.replace(doctypeRe, (doctype) => `${doctype.trim()}\n${banner}`);

writeFileSync(INDEX, html);
// (5) 내려받기용 사본
copyFileSync(INDEX, join(DIST, 'hobong.html'));

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(
  `[postbuild] 단일 HTML 확인 완료: dist/index.html (${kb} kB), CSP 적용, hobong.html 사본 생성`,
);
