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
  track: 'general',
  series: null,
  payTable: 'table3',
  rank: '9',
  rankDate: '2022-09-01',
  step: 5,
  nextStepDate: '2027-01-01',
  stepAsOf: '2026-11-25',
  overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
};

describe('표기 통일', () => {
  const sources = sourceFiles().map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const data = ['data/lines.json', 'data/character.json', 'data/site.json', 'data/talk.json'].map(
    (path) => ({ path, text: read(path) }),
  );

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
  it("계급 이름을 숫자 뒤 '급'으로 만들지 않는다('}급' 꼴 0건 — 경찰·교원은 '경위급'·'null급'이 된다)", () => {
    // 계급 이름은 규정 데이터 사다리의 label('7급'·'경위'·'우정7급')을 rankLabel·rankStepLabel 로 쓴다
    for (const { path, text } of sources) expect(text, path).not.toMatch(/\}급|\$\{[^}]*\}급/);
  });
  it('직종·계급 이름 변수 뒤에 조사를 고정하지 않는다(josa·withRo 로 고른다)', () => {
    // '외무은'·'해양경찰는' 같은 오류를 막는다. 받침이 정해진 기존 문구(${SITE_NAME}이 등)는 대상이 아니다
    const fixed = /(rankLabel|trackLabel|rankStepLabel|\.label)\)?\}(은|는|이|가|을|를|으로|로)/;
    for (const { path, text } of sources) expect(text, path).not.toMatch(fixed);
  });
  it('날짜는 formatKorean 으로만 찍는다(0을 채운 2026. 01. 01. 꼴 금지)', () => {
    for (const { path, text } of sources) expect(text, path).not.toContain("replaceAll('-', '. ')");
    expect(formatKorean('2026-10-02', false)).toBe('2026. 10. 2.');
    expect(formatKorean('2027-01-01', false)).toBe('2027. 1. 1.');
  });
});

describe("'생애 봉급' 창(#30)의 낱말", () => {
  const files = ['src/lib/app/lifetime-copy.ts', 'src/screens/home/LifetimeWindow.svelte'].map(
    (path) => ({ path, text: read(path) }),
  );
  it("봉급만 세므로 '소득'·'연봉'·'수입'이라고 부르지 않는다", () => {
    for (const { path, text } of files) expect(text, path).not.toMatch(/소득|연봉|수입/);
    expect(read('src/lib/app/lifetime-copy.ts')).toContain("'생애 봉급(추정)'");
  });
  it('원문에 없는 것을 확정으로 말하지 않는다(계급정년 뒤 근무 조건, 봉급표 개정 횟수)', () => {
    for (const { path, text } of files)
      expect(text, path).not.toMatch(/승진해야|해마다 바뀌|새 봉급표가|해마다 1월/);
  });
  it("파일은 '임용정보 패키지'로 부른다('백업'이라는 낱말을 새로 쓰지 않는다)", () => {
    for (const { path, text } of files) expect(text, path).not.toContain('백업');
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

describe('첫 만남의 대사(data/talk.json)', () => {
  // 말투·금지어·변형 수의 자세한 검사는 tests/unit/onboarding.test.ts 에 있다. 여기서는 화면 문구와 함께 보는 표기를 지킨다
  const talk = JSON.parse(read('data/talk.json')) as Record<string, unknown>;
  const lines: { at: string; text: string }[] = [];
  const walk = (value: unknown, at: string) => {
    if (at === 'notes') return;
    if (typeof value === 'string') lines.push({ at, text: value });
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) walk(v, at ? `${at}.${k}` : k);
  };
  walk(talk, '');

  it("조사를 '은(는)'처럼 뭉뚱그리지 않고, 자리표시자 뒤에 조사를 고정하지 않는다", () => {
    for (const { at, text } of lines) {
      expect(text, at).not.toMatch(/\((은|는|이|가|을|를|과|와|으로)\)/);
      // {nick} 뒤에는 '님'이 온다. {nounEul} 은 코드가 조사를 붙여 넣는다(josa).
      // 긴 날짜({date}: '2027년 4월 1일')는 늘 '일'로 끝나므로 '{date}로'만 받아들인다
      expect(text.replaceAll('{date}로', ''), at).not.toMatch(
        /\{(?!nounEul)[A-Za-z]+\}(은|는|이|가|을|를|과|와|으로|로)(?![가-힣])/,
      );
    }
  });
  it("해요체다(합쇼체 '-습니다·-ㅂ니다'를 섞지 않는다)", () => {
    for (const { at, text } of lines) expect(text, at).not.toMatch(/니다([.!?\s]|$)/);
  });
  it('숫자·날짜·직급·직렬·나이를 품평하지 않는다', () => {
    for (const { at, text } of lines)
      expect(text, at).not.toMatch(/빠르|빨리|젊|벌써|늦|어리|대단|높으시|낮으시/);
  });
  it("파일은 늘 '임용정보 패키지'로 부르고, '백업'은 예전 이름을 잇는 두 곳에만 쓴다", () => {
    const withBackup = lines.filter((l) => l.text.includes('백업')).map((l) => l.at);
    expect(withBackup.sort()).toEqual(['package.intro', 'package.oldName']);
    // 처음 소개하는 글과 첫 화면의 안내는 줄이지 않은 이름을 쓴다
    for (const at of ['package.intro', 'package.welcome', 'package.body[0]'])
      expect(lines.find((l) => l.at === at)?.text, at).toContain('임용정보 패키지');
  });
  it("로그인·정보 저장은 '준비 중'이라고만 말한다(기한을 약속하지 않는다)", () => {
    const wit = lines.filter((l) => l.at.startsWith('wit['));
    expect(wit.length).toBeGreaterThanOrEqual(2);
    for (const { at, text } of wit) {
      expect(text, at).toMatch(/준비 중|부화 전/);
      expect(text, at).not.toMatch(/\d|곧|머지않|올해|내년|출시|예정|약속/);
    }
  });
  it('화면은 첫 만남의 대사를 talk.json 에서만 가져온다(질문 문장을 화면 코드에 적어 두지 않는다)', () => {
    const questions = talk.questions as Record<string, { ask: string }>;
    const screens = sourceFiles().filter((f) => f.endsWith('.svelte'));
    for (const path of screens) {
      const text = readFileSync(path, 'utf8');
      for (const [id, q] of Object.entries(questions))
        if (!q.ask.includes('{')) expect(text, `${path}: ${id}`).not.toContain(q.ask);
    }
  });
});
