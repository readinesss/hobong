/**
 * 올해 결산 카드: 글자 카드의 문구와, 캔버스 없이(기록용 가짜 ctx) 그리기의 좌표를 검사한다.
 * 실제 픽셀은 종단 테스트(PNG 크기·미리보기 낭독 문구)에서 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rulesFor } from '../rules/index.ts';
import { Calendar } from '../calc/calendar.ts';
import { yearGrid, yearRecap, type RecapInput } from '../calc/recap.ts';
import { maxStepOf } from '../calc/salary.ts';
import { resolveLook } from '../character/look.ts';
import { characterRules } from '../character/rules.ts';
import type { Profile } from '../store/schema.ts';
import {
  calendarSize,
  drawRecapCard,
  recapFacts,
  recapPeriodText,
  recapStepText,
  recapTextCard,
  type RecapCardModel,
} from './recap.ts';
import { CARD_SIZES, type Ctx } from './render.ts';

const cal = new Calendar(rulesFor);
const profile: Profile = {
  nickname: '김주무관',
  birthDate: '1996-04-12',
  hireDate: '2022-09-01',
  grade: 9,
  gradeDate: '2022-09-01',
  step: 5,
  nextStepDate: '2027-01-01',
  stepAsOf: '2026-11-24',
  overrides: { longServiceDate: null, seniorDate: null },
};

function input(over: Partial<RecapInput> = {}): RecapInput {
  return {
    today: '2026-11-25',
    profile,
    retireDate: '2056-12-31',
    maxStep: maxStepOf(rulesFor(2026).salary, 9),
    periodMonths: 12,
    cal,
    rules: rulesFor,
    records: [{ id: 'a', date: '2026-03-03', kind: 'day', hours: 8, memo: '' }],
    hoursPerDay: 8,
    visits: ['2026-11-24', '2026-11-25'],
    badges: [],
    ...over,
  };
}

function model(over: Partial<RecapInput> = {}, extra: Partial<RecapCardModel> = {}) {
  const recap = yearRecap(input(over));
  const m: RecapCardModel = {
    nickname: profile.nickname,
    year: recap.year,
    periodText: recapPeriodText(recap),
    look: resolveLook(characterRules, 9, 5, 'work'),
    formName: '아기 봉황',
    grade: 9,
    step: recap.stepTo,
    stepText: recapStepText(recap),
    facts: recapFacts(recap),
    badges: [],
    salary: null,
    grid: yearGrid(2026, input(over)),
    siteName: '호봉',
    siteTagline: '공무원 상태창',
    siteUrl: 'readinesss.github.io/hobong',
    ...extra,
  };
  return { recap, m };
}

/** fillRect·fillText 만 기록하는 가짜 2D 문맥(글자 폭은 한 글자 12픽셀로 본다) */
function fakeCtx() {
  const rects: { x: number; y: number; w: number; h: number; color: string }[] = [];
  const texts: { value: string; x: number; y: number }[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    save() {},
    restore() {},
    setTransform() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, color: String(this.fillStyle) });
    },
    fillText(value: string, x: number, y: number) {
      texts.push({ value, x, y });
    },
    measureText(value: string) {
      return { width: [...value].length * (this.font.startsWith('15') ? 15 : 12) * 0.8 };
    },
  };
  return { ctx: ctx as unknown as Ctx, rects, texts };
}

describe('결산 카드 문구', () => {
  it('글자 카드에는 금액과 하루 단위 날짜가 없다', () => {
    const { m } = model({}, { salary: '25,123,000원' });
    const text = recapTextCard(m);
    expect(text).toContain('[호봉] 김주무관의 2026년 (11월까지)');
    expect(text).toContain('근무일 ');
    expect(text).toContain('연가 1일');
    expect(text).toContain('출근 도장 2개 · 배지 0개');
    expect(text).toContain('승급 4→5호봉');
    expect(text).toContain('readinesss.github.io/hobong');
    expect(text).not.toContain('원');
    expect(text).not.toMatch(/\d+월 \d+일|\d{4}\. \d+\. \d+\./);
  });

  it('정년퇴직한 해는 정년퇴직일까지라고 적는다', () => {
    const { recap, m } = model({ retireDate: '2026-06-30' });
    expect(recap.retiredThisYear).toBe(true);
    expect(m.periodText).toBe('정년퇴직일까지');
  });

  it('사람을 평가하는 말 없이 사실만 적는다', () => {
    const { m } = model();
    const text = recapTextCard(m);
    for (const word of ['열심히', '성실', '최고', '부지런', '대단', '훌륭']) {
      expect(text).not.toContain(word);
    }
  });
});

describe('결산 카드 그리기', () => {
  // 캐릭터 그림은 보조 캔버스를 쓴다: node 에는 document 가 없으므로 그리지 않는 캔버스로 바꿔 둔다
  beforeAll(() => {
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  for (const ratio of ['square', 'portrait'] as const) {
    it(`${ratio}: 달력·금액이 다 들어가고 좌표가 모두 정수이며 카드 안에 있다`, () => {
      const { m } = model({}, { salary: '25,123,000원' });
      const { ctx, rects, texts } = fakeCtx();
      const omitted = drawRecapCard(ctx, m, ratio, 1);
      expect(omitted).toEqual({ calendar: false, salary: false });
      const size = CARD_SIZES[ratio];
      for (const r of rects) {
        expect([r.x, r.y, r.w, r.h].every(Number.isInteger), JSON.stringify(r)).toBe(true);
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= size.w && r.y + r.h <= size.h).toBe(true);
      }
      expect(texts.some((t) => t.value === '25,123,000원')).toBe(true);
      expect(texts.some((t) => t.value.includes('2026 결산'))).toBe(true);
      // 달력: 들른 날(11월 24·25일) 두 칸이 칸 크기로 그려진다
      const cell = calendarSize(ratio).w === 31 * 4 - 1 ? 3 : 4;
      const visits = rects.filter((r) => r.color === '#b13e53' && r.w === cell && r.h === cell);
      expect(visits).toHaveLength(2);
    });
  }

  it('달력을 끄면 그리지 않는다', () => {
    const { m } = model({}, { grid: null });
    const { ctx, rects } = fakeCtx();
    expect(drawRecapCard(ctx, m, 'square', 1)).toEqual({ calendar: false, salary: false });
    expect(rects.some((r) => r.color === '#b13e53' && r.w === 3)).toBe(false);
  });
});
