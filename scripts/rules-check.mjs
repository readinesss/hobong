// 규정 데이터(data/<연도>.json)가 낡지 않았는지 점검한다.
//
//   node scripts/rules-check.mjs                 오늘(한국 시각) 기준으로 점검해 사람이 읽을 글로 출력
//   node scripts/rules-check.mjs --date 2027-01-04
//   node scripts/rules-check.mjs --json          월간 점검 워크플로가 읽는 형식
//   node scripts/rules-check.mjs --summary       GitHub Actions 실행 요약에도 남긴다
//   node scripts/rules-check.mjs --strict        지금 계산에 영향이 있는 건(action)이 있으면 실패
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidYmd } from '../src/lib/calc/date.ts';
import { checkFreshness } from '../src/lib/rules/freshness.ts';
import { availableYears, buildRegistry } from '../src/lib/rules/resolve.ts';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

/** 한국 시각의 오늘 */
function todayInSeoul() {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

const dateArg = args.indexOf('--date');
const today = dateArg >= 0 ? args[dateArg + 1] : todayInSeoul();
if (!isValidYmd(today)) {
  console.error(`날짜 형식이 올바르지 않습니다: ${String(today)} (예: 2027-01-04)`);
  process.exit(2);
}

const files = readdirSync(DATA)
  .filter((name) => /^\d{4}\.json$/.test(name))
  .map((name) => JSON.parse(readFileSync(join(DATA, name), 'utf8')));
const registry = buildRegistry(files);
const findings = checkFreshness(registry, today);

if (flag('--json')) {
  console.log(JSON.stringify({ today, years: availableYears(registry), findings }, null, 2));
} else {
  const lines = [];
  lines.push(`규정 데이터 점검 (${today} 기준, 보유 연도: ${availableYears(registry).join(', ')})`);
  if (findings.length === 0) {
    lines.push('  손볼 것이 없습니다.');
  } else {
    for (const f of findings) {
      lines.push(`  [${f.level === 'action' ? '지금' : '예정'}] ${f.title}`);
      lines.push(`      ${f.detail}`);
    }
  }
  console.log(lines.join('\n'));
}

if (flag('--summary') && process.env.GITHUB_STEP_SUMMARY) {
  const md = ['### 규정 데이터', ''];
  md.push(`기준일 ${today} · 보유 연도 ${availableYears(registry).join(', ')}`, '');
  if (findings.length === 0) {
    md.push('손볼 것이 없습니다.');
  } else {
    md.push('| 구분 | 내용 | 설명 |', '| --- | --- | --- |');
    for (const f of findings) {
      md.push(`| ${f.level === 'action' ? '지금' : '예정'} | ${f.title} | ${f.detail} |`);
    }
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`);
}

if (flag('--strict') && findings.some((f) => f.level === 'action')) process.exit(1);
