/**
 * 저장 형식 v7 의 새 칸(직류 profile.seriesJikryu, 임용 전 군 복무 profile.priorService, 저축연가 통장
 * leave.savings, 연가 정리 값 leave.years)은 앱 밖으로 나가는 글·그림에 담지 않는다(#31·#33·#34 공통 약속).
 *
 * 카드·결산 카드·공유 문구·탭 제목을 만드는 파일이 이 칸을 읽으면 실패한다(lifetime-scope.test.ts 와 같은 방식).
 * 이 칸들은 이 브라우저의 저장본과 사용자가 내려받는 임용정보 패키지에만 있다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function sourceFiles(dir = join(ROOT, 'src')): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'assets') out.push(...sourceFiles(path));
    } else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

const sources = sourceFiles().map((path) => ({
  path: relative(ROOT, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

/** v7 의 새 칸(과 그 형식)을 읽는 표현 */
const V7_READ =
  /seriesJikryu|priorService|PriorService|\.savings\b|SavingsEntry|leave\.years\b|\.years\[|LeaveYearPlan|jikryu/i;

/** 카드·결산 카드·공유 문구를 만드는 파일(파일 전체가 밖으로 나가는 글·그림을 만든다) */
const OUTWARD = [
  'src/lib/card/render.ts',
  'src/lib/card/recap.ts',
  'src/screens/CardMaker.svelte',
  'src/screens/card/RecapOptions.svelte',
  'src/lib/app/share.ts',
  'src/screens/share/ShareNote.svelte',
];

describe('v7 의 새 칸은 카드·결산 카드·공유 문구·탭 제목에 나가지 않는다', () => {
  it('카드·결산 카드·공유 문구를 만드는 파일은 새 칸을 읽지 않는다', () => {
    for (const path of OUTWARD) {
      const file = sources.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(file?.text ?? '', path).not.toMatch(V7_READ);
      expect(file?.text ?? '', path).not.toMatch(/직류|군 복무|저축연가/);
    }
  });

  it('탭 제목(document.title)을 정하는 문장은 새 칸을 읽지 않는다', () => {
    // 첫 입력(Talk·Welcome)은 직류를 고르는 화면이기도 해서 파일 전체가 아니라 제목을 정하는 문장만 본다
    const titled = sources.filter((f) => f.text.includes('document.title'));
    expect(titled.map((f) => f.path).sort()).toEqual([
      'src/App.svelte',
      'src/screens/Welcome.svelte',
      'src/screens/onboarding/Talk.svelte',
    ]);
    for (const file of titled) {
      const statements = file.text.split('\n').filter((l) => l.includes('document.title'));
      expect(statements.length, file.path).toBeGreaterThan(0);
      for (const line of statements) {
        expect(line, file.path).not.toMatch(V7_READ);
        expect(line, file.path).not.toMatch(/직류|군 복무|저축연가|series/i);
      }
    }
  });

  it('검사가 헛돌지 않는다: 저장 형식 파일은 새 칸을 읽는다', () => {
    const readers = sources.filter((f) => V7_READ.test(f.text)).map((f) => f.path);
    for (const path of [
      'src/lib/store/schema.ts',
      'src/lib/store/migrate.ts',
      'src/lib/store/validate.ts',
    ])
      expect(readers, path).toContain(path);
  });
});
