/**
 * 말을 거는 첫 입력: 질문 차례·진행·알 단계(src/lib/onboarding/questions.ts, character/egg.ts)와
 * 대사(data/talk.json)의 말투·금지어·조사·변형 수, 이 기기 편의 값(prefs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrefs } from '../../src/lib/app/prefs.svelte.ts';
import { SHARE_URL } from '../../src/lib/app/share.ts';
import { eggStageFor } from '../../src/lib/character/egg.ts';
import {
  firstProblem,
  isOptional,
  problemsOf,
  progressOf,
  QUESTION_IDS,
  QUESTION_KEYS,
  questionsFor,
  requiredOf,
  uncoveredKeys,
  type QuestionId,
} from '../../src/lib/onboarding/questions.ts';
import { careerLookup, rulesFor } from '../../src/lib/rules/index.ts';
import { checkProfile } from '../../src/lib/store/validate.ts';
import { fillLine, pickLine, TALK } from '../../src/lib/talk.ts';

const general = { track: 'general', askRank: true, series: null, hasProp: false };

describe('질문 차례', () => {
  it('일반직: 닉네임 → 생년월일 → 임용일 → 직종 → 봉급표 → 직렬 → 계급 → 호봉 → 다음 승급일 → 월급날', () => {
    expect(questionsFor(general)).toEqual([
      'nickname',
      'birthDate',
      'hireDate',
      'track',
      'payTable',
      'series',
      'rank',
      'step',
      'nextStepDate',
      'payday',
    ]);
  });

  it('직렬을 골라 소품이 있으면 직렬 바로 뒤에 소품을 묻는다', () => {
    const list = questionsFor({ ...general, series: '간호', hasProp: true });
    expect(list.indexOf('prop')).toBe(list.indexOf('series') + 1);
  });

  it('특정직: 봉급표·직렬은 묻지 않고, 직종 소품이 있으면 직종 뒤에 소품을 묻는다', () => {
    const list = questionsFor({ track: 'police', askRank: true, series: null, hasProp: true });
    expect(list).not.toContain('payTable');
    expect(list).not.toContain('series');
    expect(list.indexOf('prop')).toBe(list.indexOf('track') + 1);
    expect(list.indexOf('rank')).toBe(list.indexOf('prop') + 1);
  });

  it('교원처럼 계급을 고르지 않는 직종은 계급 질문을 건너뛴다', () => {
    const list = questionsFor({ track: 'teacher', askRank: false, series: null, hasProp: true });
    expect(list).not.toContain('rank');
    expect(list).toContain('step');
  });

  it('건너뛸 수 있는 것은 직렬·소품뿐이다(직종은 꼭 고른다)', () => {
    expect(QUESTION_IDS.filter(isOptional)).toEqual(['series', 'prop']);
    expect(isOptional('track')).toBe(false);
  });

  it('필수 칸 수: 일반직 9, 경찰 8, 교원 7', () => {
    expect(requiredOf(questionsFor(general))).toHaveLength(9);
    expect(
      requiredOf(questionsFor({ track: 'police', askRank: true, series: null, hasProp: true })),
    ).toHaveLength(8);
    expect(
      requiredOf(questionsFor({ track: 'teacher', askRank: false, series: null, hasProp: true })),
    ).toHaveLength(7);
  });
});

describe('진행과 검사', () => {
  it('진행은 필수 칸만 세고, 지금 차례에 없는 질문의 답은 세지 않는다', () => {
    const list = questionsFor(general);
    const answered = new Set<QuestionId>(['nickname', 'birthDate', 'series', 'prop']);
    expect(progressOf(list, answered)).toEqual({ total: 9, done: 2, left: 7 });
    // 직종을 경찰로 바꾸면 봉급표 답은 세지 않는다(분모도 바뀐다)
    const police = questionsFor({ track: 'police', askRank: true, series: null, hasProp: false });
    answered.add('payTable');
    answered.add('track');
    expect(progressOf(police, answered)).toEqual({ total: 8, done: 3, left: 5 });
  });

  it('질문들이 checkProfile 의 모든 칸을 맡는다(빈 초안의 오류에 주인 없는 칸이 없다)', () => {
    const rules = rulesFor(2026);
    const errors = checkProfile(
      {
        nickname: '',
        birthDate: '',
        hireDate: '',
        track: 'nope',
        series: null,
        payTable: null,
        rank: null,
        rankDate: '',
        step: 0,
        nextStepDate: '',
        overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
      },
      { today: '2026-11-25', ...careerLookup(rules), raiseDateRule: 'future' },
    );
    expect(Object.keys(errors).length).toBeGreaterThan(3);
    expect(uncoveredKeys(errors).filter((key) => key !== 'stepAsOf')).toEqual([]);
    // 문제가 있는 첫 질문으로 데려간다
    expect(firstProblem(questionsFor(general), errors)).toBe('nickname');
    expect(problemsOf('nickname', errors)).toEqual(['닉네임을 넣어 주세요.']);
  });

  it('모든 질문에 맡은 칸 목록이 있다', () => {
    for (const id of QUESTION_IDS) expect(Array.isArray(QUESTION_KEYS[id]), id).toBe(true);
  });
});

describe('알의 금 단계', () => {
  it('필수 7칸: 0칸 S0 · 1칸 S1 · 3칸 S2 · 5칸 S3 · 7칸 S4', () => {
    expect([0, 1, 3, 5, 7].map((k) => eggStageFor(k, 7))).toEqual([0, 1, 2, 3, 4]);
  });

  it('칸 수가 달라도 줄지 않고, 하나라도 채우면 S1, 다 채워야 S4', () => {
    for (const total of [1, 2, 3, 7, 8, 9, 12]) {
      let last = 0;
      for (let k = 0; k <= total; k += 1) {
        const stage = eggStageFor(k, total);
        expect(stage, `${k}/${total}`).toBeGreaterThanOrEqual(last);
        if (k >= 1) expect(stage).toBeGreaterThanOrEqual(1);
        if (k < total) expect(stage).toBeLessThan(4);
        last = stage;
      }
      expect(eggStageFor(total, total)).toBe(4);
    }
  });
});

describe('대사(data/talk.json)', () => {
  const raw = readFileSync(join(process.cwd(), 'data/talk.json'), 'utf8');
  /** 화면에 나오는 모든 글자(설명 notes 는 뺀다) */
  const strings: string[] = [];
  const walk = (value: unknown, key = '') => {
    if (key === 'notes') return;
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(JSON.parse(raw));

  /** 말하는 문장(질문·맞장구·건너뜀·고쳐 주세요·인사·위트): 해요체로 끝난다 */
  const spoken: string[] = [
    ...TALK.greeting.lines,
    ...TALK.oops,
    ...TALK.wit,
    ...TALK.hatch.greet,
    ...TALK.summary.lines,
    ...TALK.egg.stage,
    ...Object.values(TALK.questions).flatMap((q) => [
      q.ask,
      ...q.ack,
      ...('skip' in q ? q.skip : []),
      ...('ackPending' in q ? q.ackPending : []),
      ...('ackMax' in q ? q.ackMax : []),
      ...('askMax' in q ? [q.askMax] : []),
    ]),
  ];

  it('말하는 문장은 해요체다(문장 끝이 요·요!·요?·요.)', () => {
    for (const line of spoken) {
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        // 괄호 속 덧말('(준비 중)')은 빼고 본다
        expect(sentence.replace(/\([^)]*\)/g, ''), line).toMatch(/(요|님|…)[.!?]*$/);
      }
    }
  });

  it("합쇼체('-습니다')를 섞지 않는다", () => {
    for (const line of strings) expect(line).not.toMatch(/니다[.!?\s]|니다$/);
  });

  it('숫자·날짜·직급·나이를 품평하는 말이 없다', () => {
    const banned = [
      '빠르',
      '빨리',
      '젊',
      '벌써',
      '늦',
      '어리',
      '오래되',
      '높으시',
      '낮으시',
      '대단',
      '많으시',
      '적으시',
      '잘못',
    ];
    for (const line of strings)
      for (const word of banned) expect(line, `${word}: ${line}`).not.toContain(word);
  });

  it("조사를 '은(는)'처럼 뭉뚱그리지 않고, 자리표시자 바로 뒤에 조사를 적지 않는다", () => {
    for (const line of strings) {
      expect(line).not.toMatch(/\((는|를|가|과|으로)\)/);
      // {nick} 뒤에는 '님', {nounEul} 은 조사를 품고 있다. 그 밖의 자리표시자 뒤에 조사가 바로 오면 안 된다
      expect(line, line).not.toMatch(
        /\{(nick|n|max|date|file|url|total|done)\}(은|는|이|가|을|를|과|와)(\s|$)/,
      );
      for (const m of line.matchAll(/\{nick\}(.)/g)) expect(m[1], line).toBe('님');
    }
  });

  it('맞장구·건너뜀·고쳐 주세요·인사·위트는 변형이 둘 이상이다', () => {
    expect(TALK.greeting.lines.length).toBeGreaterThanOrEqual(2);
    expect(TALK.oops.length).toBeGreaterThanOrEqual(2);
    expect(TALK.wit.length).toBeGreaterThanOrEqual(2);
    expect(TALK.hatch.greet.length).toBeGreaterThanOrEqual(2);
    for (const [id, q] of Object.entries(TALK.questions)) {
      expect(q.ack.length, id).toBeGreaterThanOrEqual(2);
      if ('skip' in q) expect(q.skip.length, id).toBeGreaterThanOrEqual(2);
      if ('ackPending' in q) expect(q.ackPending.length, id).toBeGreaterThanOrEqual(2);
      if ('ackMax' in q) expect(q.ackMax.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('모든 질문에 대사가 있고, 닉네임 말고는 입력값을 되풀이하지 않는다', () => {
    for (const id of QUESTION_IDS) {
      const q = TALK.questions[id];
      expect(q.ask.length, id).toBeGreaterThan(3);
      if (id !== 'nickname')
        for (const line of q.ack) expect(line, id).not.toMatch(/\{[A-Za-z]+\}/);
    }
    for (const line of TALK.questions.nickname.ack) expect(line).toContain('{nick}님');
  });

  it("로그인·정보 저장은 '준비 중'이라고만 한다(기한·약속을 말하지 않는다)", () => {
    for (const line of TALK.wit) {
      expect(line).toMatch(/준비 중|부화 전/);
      expect(line).not.toMatch(/\d|곧|머지않|올해|내년|다음 달|출시|예정|약속/);
    }
  });

  it('알리기 글에는 자리표시자가 없다(입력값이 따라가지 않는다). 주소는 사이트 주소뿐이다', () => {
    expect(TALK.share.title).not.toMatch(/\{/);
    expect(TALK.share.text).not.toMatch(/\{/);
    expect(TALK.share.text).toContain('비공식');
    expect(SHARE_URL).toMatch(/^https:\/\/[a-z0-9.-]+\/[a-z0-9/-]*$/);
    expect(SHARE_URL).not.toMatch(/[?#]/);
  });

  it('예전 백업 파일 이름도 불러올 수 있다고 알린다', () => {
    expect(TALK.package.oldName).toContain('hobong-backup-');
    expect(TALK.package.intro).toContain('백업 파일');
  });

  it('fillLine 은 아는 자리표시자만 채우고, pickLine 은 같은 씨앗에 같은 문장을 고른다', () => {
    expect(fillLine('{nick}님, {n}개 {x}', { nick: '호봉', n: 3 })).toBe('호봉님, 3개 {x}');
    expect(pickLine(['a', 'b', 'c'], 4)).toBe('b');
    expect(pickLine(['a', 'b', 'c'], -1)).toBe('c');
    expect(pickLine([], 3)).toBe('');
  });
});

describe('이 기기 편의 값(hobong.prefs)', () => {
  it('아는 값만 읽고, 모르는 값·깨진 글자는 버린다', () => {
    expect(parsePrefs('{"onboardMode":"form","packageGuide":"later"}')).toEqual({
      onboardMode: 'form',
      packageGuide: 'later',
    });
    expect(parsePrefs('{"onboardMode":"x","packageGuide":1,"nickname":"김"}')).toEqual({});
    expect(parsePrefs('[1]')).toEqual({});
    expect(parsePrefs('{')).toEqual({});
    expect(parsePrefs(null)).toEqual({});
  });
});
