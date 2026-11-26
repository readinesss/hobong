/**
 * 화면 문구 점검(문구·톤 검토에서 나온 지적이 되살아나지 않게).
 * - 표기 통일: 배지·월급날·최고호봉, 조사 '은(는)' 금지, 날짜는 formatKorean 한 가지
 * - 톤: 직급과 무관한 정년 문구, 사실만 말하는 지친 모습 문장
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { busiestMonthText } from '../../src/lib/app/format.ts';
import { formatKorean } from '../../src/lib/calc/date.ts';
import { buildMilestones } from '../../src/lib/calc/milestones.ts';
import { rulesFor } from '../../src/lib/rules/index.ts';
import type { Profile } from '../../src/lib/store/schema.ts';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** src 아래의 화면·로직 파일(스프라이트·테스트 제외) */
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

const profile: Profile = {
  nickname: '호봉이',
  birthDate: '1995-05-20',
  hireDate: '2022-09-01',
  grade: 9,
  gradeDate: '2022-09-01',
  step: 5,
  nextStepDate: '2027-01-01',
  stepAsOf: '2026-11-25',
  overrides: { longServiceDate: null, seniorDate: null },
};

describe('표기 통일', () => {
  const sources = sourceFiles().map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const data = ['data/lines.json', 'data/character.json', 'data/site.json'].map((path) => ({
    path,
    text: read(path),
  }));

  it("'뱃지'가 아니라 표준 표기 '배지'", () => {
    for (const { path, text } of [...sources, ...data]) expect(text, path).not.toContain('뱃지');
  });
  it("같은 날을 '월급날' 하나로 부른다", () => {
    for (const { path, text } of [...sources, ...data]) expect(text, path).not.toContain('봉급날');
  });
  it("화면의 '최고호봉'은 붙여 쓴다", () => {
    for (const { path, text } of sources.filter((f) => /screens|card/.test(f.path)))
      expect(text, path).not.toContain('최고 호봉');
  });
  it("조사를 '은(는)'처럼 뭉뚱그리지 않는다", () => {
    for (const { path, text } of sources) expect(text, path).not.toMatch(/\((는|를|가|과)\)/);
  });
  it('날짜는 formatKorean 으로만 찍는다(0을 채운 2026. 01. 01. 꼴 금지)', () => {
    for (const { path, text } of sources) expect(text, path).not.toContain("replaceAll('-', '. ')");
    expect(formatKorean('2026-10-02', false)).toBe('2026. 10. 2.');
    expect(formatKorean('2027-01-01', false)).toBe('2027. 1. 1.');
  });
});

describe('말투와 띄어쓰기', () => {
  const screens = sourceFiles().filter((f) => f.endsWith('.svelte'));
  it("화면 글은 해요체다(합쇼체 '-습니다·-ㅂ니다'를 섞지 않는다)", () => {
    for (const path of screens)
      expect(read(path.slice(ROOT.length + 1)), path).not.toMatch(/니다[.!?\s<]/);
  });
  it("파일 이름 뒤 조사를 띄어 쓰지 않는다('hobong.html 을')", () => {
    for (const path of sourceFiles())
      expect(read(path.slice(ROOT.length + 1)), path).not.toMatch(
        /hobong\.html (을|를|이|가|은|는)\s/,
      );
  });
  it('공휴일을 고른 안내와 기록 검사가 같은 이름(공휴일)으로 부른다', () => {
    expect(read('src/screens/Leave.svelte')).toContain('이날은 공휴일(${selectedHoliday})이라');
    expect(read('src/lib/calc/leave.ts')).toContain('공휴일(');
  });
});

describe('월별 연가 설명', () => {
  it("한 번도 안 썼으면 '1월'을 찍지 않는다", () => {
    const empty = busiestMonthText(Array(12).fill(0));
    expect(empty).toContain('올해는 아직 쓴 연가가 없어요');
    expect(empty).not.toContain('1월');
  });
  it('가장 많이 쓴 달, 동률이면 앞선 달', () => {
    const months = Array(12).fill(0);
    months[7] = 3;
    expect(busiestMonthText(months)).toContain('8월');
    months[2] = 3;
    expect(busiestMonthText(months)).toContain('3월');
  });
});

describe('일정 설명', () => {
  const list = buildMilestones(rulesFor, profile, '2026-11-25');
  it("임용 N일째는 '출근 도장'(방문 기록)과 섞지 않는다", () => {
    const days100 = list.find((m) => m.id === 'days-100');
    expect(days100?.date).toBe('2022-12-09');
    expect(days100?.detail).not.toContain('출근 도장');
  });
  it('미래의 주년 일정에 과거형 인사말을 붙이지 않는다', () => {
    const anniv5 = list.find((m) => m.id === 'anniv-5');
    expect(anniv5?.detail).not.toContain('셨습니다');
  });
  it('정년 문구는 직급(봉황)과 무관하다', () => {
    for (const m of list.filter((x) => x.kind === 'retire')) expect(m.detail).not.toContain('봉황');
  });
});

describe('캐릭터 문구', () => {
  const character = JSON.parse(read('data/character.json')) as {
    forms: { grades: number[]; blurb: string }[];
    moods: Record<string, { label: string }>;
  };
  const lines = JSON.parse(read('data/lines.json')) as { lines: Record<string, string[]> };

  it('직급을 낮춰 읽히는 형태 설명이 없다', () => {
    for (const form of character.forms) expect(form.blurb).not.toContain('뒤를 봐');
    const seven = character.forms.find((f) => f.grades.includes(7));
    expect(seven?.blurb).not.toContain('첫 깃');
  });
  it('지친 모습은 사실만 말한다(모르는 것을 단정하지 않는다)', () => {
    expect(character.moods.tired?.label).toBe('쉴 때가 됐어요');
    for (const line of lines.lines.tired ?? []) expect(line).not.toContain('못 쉬셨');
  });
  it("틀린 높임 '-실게요'를 쓰지 않는다", () => {
    for (const group of Object.values(lines.lines))
      for (const line of group) expect(line).not.toContain('실게요');
  });
});
