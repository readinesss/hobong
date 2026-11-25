// 빌드 후처리: (1) 단일 HTML인지 검증 (2) 외부 참조가 없는지 검증
// (3) 인라인 스크립트 해시 기반 CSP 주입 — 브라우저 수준에서 외부 통신을 차단한다.
// (4) 내려받기용 사본(hobong.html) 생성
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

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

// (2) 외부 참조 검증: 리소스를 불러오는 속성·구문에 URL이 없어야 한다.
const resourcePatterns = [
  /<script\b[^>]*\bsrc\s*=/i,
  /<link\b[^>]*\bhref\s*=/i,
  /<(?:img|audio|video|source|iframe|embed|object)\b[^>]*\b(?:src|data)\s*=\s*["']?(?!data:|blob:)/i,
  /url\(\s*["']?(?!data:|#)[^)"']/i,
  /@import\b/i,
];
for (const re of resourcePatterns) {
  const m = html.match(re);
  if (m) fail(`외부 리소스 참조가 남아 있습니다: ${m[0].slice(0, 120)}`);
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

writeFileSync(INDEX, html);
// (4) 내려받기용 사본
copyFileSync(INDEX, join(DIST, 'hobong.html'));

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`[postbuild] 단일 HTML 확인 완료: dist/index.html (${kb} kB), CSP 적용, hobong.html 사본 생성`);
