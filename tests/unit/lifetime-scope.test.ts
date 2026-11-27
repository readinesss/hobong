/**
 * 퇴직 예정 달(#30, 저장 형식 v6 의 plan.retireMonth)은 '생애 봉급' 창에서만 쓴다.
 *
 * - 카드·결산 카드·탭 제목·공유 문구에는 어떤 경우에도 담지 않는다(카드는 앱 밖으로 나간다).
 * - 정년 D-day·연가·보너스·일정은 정년퇴직일 그대로다(정년은 법이 정한 사실, 퇴직 예정은 가정).
 *
 * 값이 같은지는 view-tracks.test.ts 가 보고(정한 달이 있어도 다른 view 값이 그대로), 여기서는 코드가
 * 그 값을 읽는 곳 자체를 묶어 둔다: 허용한 파일 밖에서 정한 달이나 그에 따른 값을 읽으면 실패한다.
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

/**
 * 정한 달, 그리고 정한 달을 따라 달라지는 값(끝나는 날·금액·횟수)을 읽는 표현.
 * 규정 데이터의 정년 구간에도 retireMonth 라는 칸이 있어(퇴직하는 달 6·12), 저장본의 칸은 plan 과 함께 찾는다.
 */
const PLAN_READ =
  /retirePlanMonth|plan\??\.retireMonth|PlanState|setRetirePlan|\bdata\.plan\b|\bd\.plan\b|\.lifeEnd\b|\.lifeMasked\b|\.lifePaydays\b|\.lifetime\b|\.lifeAsOf\b|\.lifeTimeRatio\b|\.lifeNewYears\b|\.lifeDiligenceLeft\b|resolveLifetimeEnd|lifetimeSalary|lifetime-copy/;

/** 정한 달을 다뤄도 되는 곳: 저장(형식·변환·검사·동작), 계산, view 의 '생애 봉급' 구역, 그 창과 문구 */
const ALLOWED = new Set([
  'src/lib/store/schema.ts',
  'src/lib/store/defaults.ts',
  'src/lib/store/migrate.ts',
  'src/lib/store/validate.ts',
  'src/lib/app/state.svelte.ts',
  'src/lib/app/view.svelte.ts',
  'src/lib/app/lifetime-copy.ts',
  'src/lib/calc/lifetime.ts',
  'src/lib/calc/salary.ts',
  'src/screens/home/LifetimeWindow.svelte',
]);

describe('퇴직 예정 달은 생애 봉급 창 밖으로 나가지 않는다', () => {
  it('허용한 파일 밖에서는 정한 달도, 그에 따른 값도 읽지 않는다', () => {
    const readers = sources.filter((f) => PLAN_READ.test(f.text)).map((f) => f.path);
    expect(readers.filter((p) => !ALLOWED.has(p))).toEqual([]);
    // 검사 자체가 헛돌지 않게: 창과 view 는 실제로 걸린다
    expect(readers).toContain('src/screens/home/LifetimeWindow.svelte');
    expect(readers).toContain('src/lib/app/view.svelte.ts');
  });

  it('카드·결산 카드·탭 제목·공유 문구를 만드는 파일은 정한 달을 모른다', () => {
    const outward = [
      'src/lib/card/render.ts',
      'src/lib/card/recap.ts',
      'src/screens/CardMaker.svelte',
      'src/screens/card/RecapOptions.svelte',
      'src/lib/app/share.ts',
      'src/screens/share/ShareNote.svelte',
      // 탭 제목(document.title)
      'src/App.svelte',
      'src/screens/Welcome.svelte',
      'src/screens/onboarding/Talk.svelte',
    ];
    for (const path of outward) {
      const file = sources.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(file?.text ?? '', path).not.toMatch(PLAN_READ);
      expect(file?.text ?? '', path).not.toMatch(/퇴직 예정|정한 달/);
    }
    // 탭 제목을 쓰는 곳은 위 세 파일뿐이다(새로 생기면 이 목록에 더해 같은 검사를 받게 한다)
    const titled = sources.filter((f) => f.text.includes('document.title')).map((f) => f.path);
    expect(titled.sort()).toEqual([
      'src/App.svelte',
      'src/screens/Welcome.svelte',
      'src/screens/onboarding/Talk.svelte',
    ]);
  });

  it("view 안에서도 '생애 봉급' 구역만 정한 달을 읽는다(정년 D-day·연가·보너스·일정은 정년퇴직일 그대로)", () => {
    const text = sources.find((f) => f.path === 'src/lib/app/view.svelte.ts')?.text ?? '';
    const start = text.indexOf('// ── 생애 봉급(#30)');
    const end = text.indexOf('// ── 쉬는 날');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const outside = text.slice(0, start) + text.slice(end);
    expect(outside).not.toMatch(/this\.(retirePlanMonth|life[A-Z]\w*|lifetime)\b|data\.plan\b/);
    // 구역 안에서 저장된 달을 읽는 곳은 한 군데다
    expect(text.slice(start, end).match(/this\.data\.plan\.retireMonth/g)).toHaveLength(1);
  });

  it('상태(state)에서 정한 달을 바꾸는 곳은 setRetirePlan 하나다', () => {
    const text = sources.find((f) => f.path === 'src/lib/app/state.svelte.ts')?.text ?? '';
    expect(text.match(/\.plan\.retireMonth\s*=[^=]/g)).toHaveLength(1);
    expect(text.match(/\bplan\b/g)?.length ?? 0).toBeLessThanOrEqual(6);
  });
});
