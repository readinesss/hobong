/**
 * 올해 결산 카드: 글자 카드의 문구와, 캔버스 없이(기록용 가짜 ctx) 그리기의 좌표를 검사한다.
 * 실제 픽셀은 종단 테스트(PNG 크기·미리보기 낭독 문구)에서 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rulesFor } from '../rules/index.ts';
import { Calendar } from '../calc/calendar.ts';
import {
  recapRevealsService,
  yearGrid,
  yearRecap,
  type RecapInput,
  type YearDay,
} from '../calc/recap.ts';
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
import { CARD_COLORS, CARD_SIZES, type Ctx } from './render.ts';

const cal = new Calendar(rulesFor);
const profile: Profile = {
  nickname: '김주무관',
  birthDate: '1996-04-12',
  hireDate: '2022-09-01',
  track: 'general',
  payTable: 'table3',
  rank: '9',
  rankDate: '2022-09-01',
  step: 5,
  nextStepDate: '2027-01-01',
  stepAsOf: '2026-11-24',
  overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
};

function input(over: Partial<RecapInput> = {}): RecapInput {
  return {
    today: '2026-11-25',
    profile,
    retireDate: '2056-12-31',
    maxStep: maxStepOf(rulesFor(2026).salary.table['9']),
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
    look: resolveLook(characterRules, '9', 5, 'work'),
    formName: '아기 봉황',
    rank: '9',
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

  it('정년퇴직한 해에도 정년을 적지 않고 오늘의 달까지라고만 적는다(나이를 짐작할 수 없게)', () => {
    const { recap, m } = model({ retireDate: '2026-06-30' });
    expect(recap.retiredThisYear).toBe(true);
    expect(recapRevealsService(recap)).toBe(true);
    // 결산은 정년퇴직일(6월)까지 세지만, 기간 글은 결산을 낸 달(11월)이다
    expect(recap.to).toBe('2026-06-30');
    expect(m.periodText).toBe('11월까지');
    expect(recapTextCard(m)).not.toMatch(/정년|퇴직|6월/);
  });

  it('올해 임용·정년퇴직이면 근무일을 뺄 수 있고, 보통 해는 재직 경계가 드러나지 않는다', () => {
    const hired = yearRecap(input({ profile: { ...profile, hireDate: '2026-03-16' } }));
    expect(recapRevealsService(hired)).toBe(true);
    expect(recapFacts(hired, { workdays: false }).map((f) => f.label)).toEqual([
      '연가',
      '출근 도장',
      '배지',
    ]);
    expect(recapFacts(hired).map((f) => f.label)[0]).toBe('근무일');
    expect(recapRevealsService(yearRecap(input()))).toBe(false);
    // 지난해 정년퇴직(결산 없음)은 해당하지 않는다
    expect(recapRevealsService(yearRecap(input({ retireDate: '2025-12-31' })))).toBe(false);
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
      const cell = calendarSize(ratio).w === 31 * 4 - 1 ? 3 : 5;
      const visits = rects.filter((r) => r.color === '#b13e53' && r.w === cell && r.h === cell);
      expect(visits).toHaveLength(2);
    });
  }

  /** 기록용 ctx 에서 1년 달력 칸마다 그린 것(칸 안의 사각형 좌표·색)을 날짜별 서명으로 모은다 */
  function calendarCells(
    rects: { x: number; y: number; w: number; h: number; color: string }[],
    ratio: 'square' | 'portrait',
    grid: readonly YearDay[],
  ): Map<string, string> {
    const c = ratio === 'square' ? 3 : 5;
    const pitch = c + 1;
    const full = rects.filter((r) => r.w === c && r.h === c);
    const at = (x: number, y: number) => full.some((r) => r.x === x && r.y === y);
    // 1월 1일 칸: 그 칸에서 오른쪽 30칸(1월 31일)과 아래 11줄(12월 1일)에 칸이 있다
    const origin = full.find((r) => at(r.x + 30 * pitch, r.y) && at(r.x, r.y + 11 * pitch));
    expect(origin, '1년 달력을 찾지 못했다').toBeDefined();
    const { x: gx, y: gy } = origin as { x: number; y: number };
    const out = new Map<string, string>();
    for (const d of grid) {
      const cx = gx + (d.day - 1) * pitch;
      const cy = gy + (d.month - 1) * pitch;
      const inCell = rects.filter((r) => r.x >= cx && r.x < cx + c && r.y >= cy && r.y < cy + c);
      out.set(
        d.date,
        inCell.map((r) => `${r.x - cx},${r.y - cy},${r.w},${r.h},${r.color}`).join('|'),
      );
    }
    return out;
  }

  for (const ratio of ['square', 'portrait'] as const) {
    it(`${ratio}: 빈칸 없이 모든 날을 그리고, 올해 임용일 앞뒤 칸이 똑같다`, () => {
      const over = {
        profile: { ...profile, hireDate: '2026-03-16', rankDate: '2026-03-16', step: 1 },
        visits: [],
        records: [],
      };
      const { m } = model(over);
      const { ctx, rects } = fakeCtx();
      drawRecapCard(ctx, m, ratio, 1);
      const cells = calendarCells(rects, ratio, m.grid as YearDay[]);
      for (const [date, sig] of cells) expect(sig, date).not.toBe('');
      // 금(3/13) = 월(3/16) = 화(3/17), 토(3/14) = 토(3/21), 1월 2일(금) = 3월 13일(금)
      expect(cells.get('2026-03-13')).toBe(cells.get('2026-03-16'));
      expect(cells.get('2026-03-16')).toBe(cells.get('2026-03-17'));
      expect(cells.get('2026-03-14')).toBe(cells.get('2026-03-21'));
      expect(cells.get('2026-01-02')).toBe(cells.get('2026-03-13'));
    });

    it(`${ratio}: 올해 정년퇴직일 앞뒤 칸이 똑같다`, () => {
      const { m } = model({ retireDate: '2026-06-30', visits: [], records: [] });
      const { ctx, rects } = fakeCtx();
      drawRecapCard(ctx, m, ratio, 1);
      const cells = calendarCells(rects, ratio, m.grid as YearDay[]);
      // 화(6/30) = 수(7/1) = 화(12/1)
      expect(cells.get('2026-06-30')).toBe(cells.get('2026-07-01'));
      expect(cells.get('2026-07-01')).toBe(cells.get('2026-12-01'));
    });

    it(`${ratio}: 오늘 뒤 칸은 예정 연가·예정 승급을 칠하지 않는다`, () => {
      const records = [
        { id: 'p1', date: '2026-12-21', kind: 'day' as const, hours: 8, memo: '' },
        { id: 'p2', date: '2026-12-22', kind: 'am' as const, hours: 4, memo: '' },
        { id: 'p3', date: '2026-12-23', kind: 'hours' as const, hours: 2, memo: '' },
        { id: 'past', date: '2026-03-03', kind: 'day' as const, hours: 8, memo: '' },
      ];
      // 다음 승급일이 12월 1일(오늘 뒤)
      const over = { records, visits: [], profile: { ...profile, nextStepDate: '2026-12-01' } };
      const { m } = model(over);
      expect(m.grid?.find((d) => d.date === '2026-12-01')?.raise).toBe(true);
      const { ctx, rects } = fakeCtx();
      drawRecapCard(ctx, m, ratio, 1);
      const cells = calendarCells(rects, ratio, m.grid as YearDay[]);
      for (const date of ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-01']) {
        expect(cells.get(date), date).toBe(cells.get('2026-12-18'));
      }
      // 오늘 전의 연가는 칠한다
      expect(cells.get('2026-03-03')).not.toBe(cells.get('2026-03-04'));
    });

    it(`${ratio}: 승급일을 파랗게 칠하면 범례에도 '승급'이 있다`, () => {
      // 1월 1일에 4→5호봉(오늘 전)
      const { m } = model();
      const { ctx, rects, texts } = fakeCtx();
      drawRecapCard(ctx, m, ratio, 1);
      const cells = calendarCells(rects, ratio, m.grid as YearDay[]);
      const blue = (cells.get('2026-01-01') ?? '').includes(CARD_COLORS.BLUE);
      expect(blue).toBe(texts.some((t) => t.value === '승급'));
      // 세로형은 범례에 자리가 넉넉하다
      if (ratio === 'portrait') expect(blue).toBe(true);
    });
  }

  it('달력을 끄면 그리지 않는다', () => {
    const { m } = model({}, { grid: null });
    const { ctx, rects } = fakeCtx();
    expect(drawRecapCard(ctx, m, 'square', 1)).toEqual({ calendar: false, salary: false });
    expect(rects.some((r) => r.color === '#b13e53' && r.w === 3)).toBe(false);
  });
});
