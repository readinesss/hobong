/**
 * 생애 봉급(#30) 계산 — 설계서 §7.1 의 경계 사례(U 번호)와 §7.2 의 불변식.
 *
 * 기대값은 2026년 봉급표(별표 3·10·11)로 손으로 셈한 식이다(식은 각 테스트 옆에 적었다).
 * 쓰는 봉급: 7급 14~17호봉 3,514,500 · 3,599,900 · 3,680,600 · 3,758,100, 7급 31호봉 4,496,500,
 * 7급 1~30호봉 합 105,630,500(1~13호봉 합 36,709,200), 5급 29·30호봉 5,579,500 · 5,617,200,
 * 9급 1호봉 2,133,000, 경정 22·30호봉 5,451,700 · 5,846,900(23~29호봉 합 39,713,300),
 * 교원 25·40호봉 4,129,400 · 6,205,700(26~39호봉 합 72,574,700).
 *
 * 퇴직 예정 달(정한 달)은 묶음 2 에서 저장된다. 여기서는 함수에 직접 넘겨 본다.
 */
import { describe, expect, it } from 'vitest';
import { hobongLine, shownPercent, shownRemaining } from '../app/lifetime-copy.ts';
import { rulesFor } from '../rules/index.ts';
import { isAvailable } from '../rules/types.ts';
import { diligenceBonus } from './bonus.ts';
import { Calendar } from './calendar.ts';
import { careerOf, careerStepOn, type CareerProfile } from './career-profile.ts';
import {
  addDays,
  addMonthsClamped,
  daysInMonth,
  formatYmd,
  minYmd,
  parseYmd,
  yearOf,
  type Ymd,
} from './date.ts';
import {
  YEAR_MONTH_RE,
  diligenceLeft,
  monthEndOf,
  monthOfYmd,
  newYearsLeft,
  paydayCounts,
  paydayHolidaysKnown,
  resolveLifetimeEnd,
  type LifetimeEnd,
  type PaydayCounts,
} from './lifetime.ts';
import { careerProgress, effectiveRetirement, retirementInfo } from './retirement.ts';
import { cumulativeSalary, lifetimeSalary, monthlySalary, type LifetimeSalary } from './salary.ts';

const cal = new Calendar(rulesFor);
const T = '2026-11-27';

const base = {
  overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
} as const;
const general = (o: Omit<CareerProfile, 'track' | 'payTable' | 'overrides'>): CareerProfile => ({
  ...base,
  track: 'general',
  payTable: 'table3',
  ...o,
});

/** 설계서 §7.1 의 프로필 */
const P = {
  P7: general({
    birthDate: '1988-11-25',
    hireDate: '2013-07-01',
    rank: '7',
    rankDate: '2019-01-01',
    step: 14,
    nextStepDate: '2027-07-01',
    stepAsOf: '2026-11-01',
  }),
  P5: general({
    birthDate: '1967-02-10',
    hireDate: '1993-04-01',
    rank: '5',
    rankDate: '2012-01-01',
    step: 29,
    nextStepDate: '2027-04-01',
    stepAsOf: '2026-11-01',
  }),
  P6R: general({
    birthDate: '1966-03-10',
    hireDate: '1990-05-10',
    rank: '6',
    rankDate: '2010-01-01',
    step: 32,
    nextStepDate: '2026-12-01',
    stepAsOf: '2026-06-01',
  }),
  /** e2e 기본 시드 */
  P9: general({
    birthDate: '1996-04-12',
    hireDate: '2022-09-01',
    rank: '9',
    rankDate: '2022-09-01',
    step: 5,
    nextStepDate: '2027-01-01',
    stepAsOf: '2026-11-24',
  }),
  /** 임용일이 그 달 월급날 뒤 */
  P9L: general({
    birthDate: '2001-03-14',
    hireDate: '2026-03-27',
    rank: '9',
    rankDate: '2026-03-27',
    step: 1,
    nextStepDate: '2027-04-01',
    stepAsOf: '2026-03-27',
  }),
  P9D1: general({
    birthDate: '2001-03-14',
    hireDate: '2026-12-01',
    rank: '9',
    rankDate: '2026-12-01',
    step: 1,
    nextStepDate: '2027-12-01',
    stepAsOf: '2026-12-01',
  }),
  PT8: {
    ...base,
    track: 'teacher',
    payTable: null,
    rank: '교원',
    birthDate: '1985-05-20',
    hireDate: '2010-03-01',
    rankDate: '2010-03-01',
    step: 25,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-11-01',
  },
  PT2: {
    ...base,
    track: 'teacher',
    payTable: null,
    rank: '교원',
    birthDate: '1985-10-20',
    hireDate: '2010-03-01',
    rankDate: '2010-03-01',
    step: 25,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-11-01',
  },
  PK: {
    ...base,
    track: 'police',
    payTable: null,
    rank: '경정',
    birthDate: '1980-08-15',
    hireDate: '2005-04-01',
    rankDate: '2020-03-01',
    step: 22,
    nextStepDate: '2027-04-01',
    stepAsOf: '2026-11-01',
  },
  PF: {
    ...base,
    track: 'foreign',
    payTable: null,
    rank: '3',
    birthDate: '1990-01-05',
    hireDate: '2018-02-01',
    rankDate: '2018-02-01',
    step: 9,
    nextStepDate: '2027-02-01',
    stepAsOf: '2026-11-01',
  },
  PM: {
    ...base,
    track: 'militaryCivil',
    payTable: null,
    rank: null,
    birthDate: '1990-01-05',
    hireDate: '2018-02-01',
    rankDate: '2018-02-01',
    step: 9,
    nextStepDate: '2027-02-01',
    stepAsOf: '2026-11-01',
  },
} satisfies Record<string, CareerProfile>;

interface Run {
  end: LifetimeEnd;
  asOf: Ymd | null;
  life: LifetimeSalary | null;
  pay: PaydayCounts | null;
  /** 정근수당 규정이 꺼져 있거나 끝나는 날이 없으면 null */
  diligence: number | null;
  newYears: number | null;
  cause: 'age' | 'rankLimit' | null;
}

/** view.svelte.ts 의 '생애 봉급' 구역과 같은 순서로 셈한다 */
function run(
  p: CareerProfile,
  today: Ymd,
  opt: { payday?: number; plan?: string | null } = {},
): Run {
  const payday = opt.payday ?? 25;
  const c = careerOf(rulesFor, p, yearOf(today));
  const retirement = effectiveRetirement(c, p);
  const ageRetireDate = isAvailable(c.retirement)
    ? retirementInfo(c.retirement, p.birthDate).retireDate
    : null;
  const end = resolveLifetimeEnd({
    today,
    hireDate: p.hireDate,
    retirement,
    ageRetireDate,
    planMonth: opt.plan ?? null,
  });
  const cause = isAvailable(retirement) ? retirement.cause : null;
  if (end.date === null)
    return { end, asOf: null, life: null, pay: null, diligence: null, newYears: null, cause };
  const asOf = minYmd(today, end.date);
  const d = c.allowances.diligence;
  return {
    end,
    asOf,
    life: lifetimeSalary(rulesFor, p, asOf, end.date),
    pay: paydayCounts(cal, payday, p.hireDate, today, end.date),
    diligence: isAvailable(d) ? diligenceLeft(cal, d, payday, p.hireDate, asOf, end.date) : null,
    newYears: newYearsLeft(asOf, end.date),
    cause,
  };
}

function on<T>(value: T | null): T {
  if (value === null) throw new Error('값이 없습니다');
  return value;
}

describe('생애 봉급: 경계 사례(설계서 §7.1)', () => {
  it('U1 기본: 7급 14호봉, 정년까지', () => {
    const r = run(P.P7, T);
    const l = on(r.life);
    expect(r.end).toMatchObject({ basis: 'retirement', date: '2048-12-31', planHeld: false });
    // 12×(1~13호봉 합) + 14호봉×(4 + 27/30)
    expect(l.earned).toBe(12 * 36_709_200 + 3_514_500 * 4.9);
    expect(l.earned).toBe(457_731_450);
    // 12×(1~30호봉 합) + 66×31호봉
    expect(l.total).toBe(12 * 105_630_500 + 66 * 4_496_500);
    expect(l.total).toBe(1_564_335_000);
    expect(l.remaining).toBe(1_106_603_550);
    expect(Math.floor(l.ratio * 100)).toBe(29);
    expect(l).toMatchObject({
      stepNow: 14,
      stepAtEnd: 31,
      raisesLeft: 17,
      maxStep: 31,
      maxStepDate: '2043-07-01',
      tableYear: 2026,
      from: '2013-07-01',
      asOf: T,
      to: '2048-12-31',
    });
    expect(r.pay).toEqual({ received: 161, left: 265, total: 426, todayCounted: false });
    expect(r.diligence).toBe(44);
    expect(r.newYears).toBe(22);
    // 보이는 값: 15억 6,433만 = 4억 5,773만 + 11억 660만
    expect(shownRemaining(l.total, l.earned)).toBe(1_106_600_000);
  });

  it('U2 오늘이 월급날: 오늘 것은 받은 쪽', () => {
    const r = run(P.P7, '2026-11-25');
    expect(r.pay).toMatchObject({ received: 161, left: 265, todayCounted: true });
    // 이틀치(3,514,500 ÷ 30 = 117,150)가 덜 쌓였다
    expect(on(r.life).earned).toBe(457_731_450 - 2 * 117_150);
  });

  it('U3 월급날 전날', () => {
    expect(run(P.P7, '2026-11-24').pay).toMatchObject({
      received: 160,
      left: 266,
      todayCounted: false,
    });
  });

  it('U4 정한 달 = 이번 달: 금액은 남았는데 남은 월급날은 0번', () => {
    const r = run(P.P7, T, { plan: '2026-11' });
    const l = on(r.life);
    expect(r.end).toMatchObject({ basis: 'plan', date: '2026-11-30', planMonth: '2026-11' });
    expect(l.remaining).toBe((3_514_500 * 3) / 30);
    expect(l.remaining).toBe(351_450);
    expect(l.total).toBe(458_082_900);
    expect(l.raisesLeft).toBe(0);
    expect(r.pay).toMatchObject({ received: 161, left: 0 });
    expect(r.diligence).toBe(0);
  });

  it('U5 정한 달(몇 해 뒤)', () => {
    const r = run(P.P7, T, { plan: '2030-03' });
    const l = on(r.life);
    expect(r.end.date).toBe('2030-03-31');
    expect(l.remaining).toBe(
      351_450 + 3_514_500 * 7 + 3_599_900 * 12 + 3_680_600 * 12 + 3_758_100 * 9,
    );
    expect(l.remaining).toBe(146_141_850);
    expect(l.total).toBe(603_873_300);
    expect(Math.floor(l.ratio * 100)).toBe(75);
    expect(l).toMatchObject({ raisesLeft: 3, stepAtEnd: 17, maxStepDate: null });
    expect(on(r.pay).left).toBe(40);
    expect(r.diligence).toBe(7);
    expect(r.newYears).toBe(4);
    // 6억 387만 = 4억 5,773만 + 1억 4,614만
    expect(shownRemaining(l.total, l.earned)).toBe(146_140_000);
  });

  it('U6 정한 달이 과거: 정년 기준으로 셈하고 고쳐 달라고 한다', () => {
    const r = run(P.P7, T, { plan: '2026-10' });
    expect(r.end).toMatchObject({
      basis: 'retirement',
      date: '2048-12-31',
      planIssue: 'past',
      planHeld: true,
      planMonth: null,
    });
    expect(on(r.life).total).toBe(1_564_335_000);
    expect(on(r.pay).left).toBe(265);
  });

  it('U7 정한 달이 정년 뒤', () => {
    const r = run(P.P7, T, { plan: '2049-01' });
    expect(r.end).toMatchObject({ basis: 'retirement', planIssue: 'afterLimit', planHeld: true });
    expect(on(r.life).total).toBe(1_564_335_000);
  });

  it('U8 정한 달 = 정년퇴직일의 달: 정년 기준(저장된 값은 지우지 않는다)', () => {
    const r = run(P.P7, T, { plan: '2048-12' });
    expect(r.end).toMatchObject({
      basis: 'retirement',
      date: '2048-12-31',
      planIssue: null,
      planHeld: true,
    });
    expect(on(r.life).total).toBe(1_564_335_000);
  });

  it('U9 정년 바로 앞 달', () => {
    const r = run(P.P7, T, { plan: '2048-11' });
    expect(r.end).toMatchObject({ basis: 'plan', date: '2048-11-30', beyondRankLimit: false });
    expect(on(r.life).total).toBe(1_564_335_000 - 4_496_500);
    expect(on(r.pay).left).toBe(264);
    expect(r.diligence).toBe(44);
  });

  it('U10 이번 달 말일에 이번 달을 정함: 남은 것이 없다', () => {
    const r = run(P.P7, '2026-11-30', { plan: '2026-11' });
    expect(r.end.basis).toBe('plan');
    expect(on(r.life)).toMatchObject({ remaining: 0, ratio: 1 });
    expect(on(r.pay).left).toBe(0);
  });

  it('U11 달 가운데 날짜는 받지 않는다(연·월만)', () => {
    expect(monthEndOf('2028-02')).toBe('2028-02-29');
    expect(monthEndOf('2027-02')).toBe('2027-02-28');
    expect(monthEndOf('2030-04')).toBe('2030-04-30');
    expect(monthOfYmd('2026-11-27')).toBe('2026-11');
    for (const bad of ['2030-3', '2030-13', '2030-03-15', '2030-00', '203003'])
      expect(YEAR_MONTH_RE.test(bad), bad).toBe(false);
    expect(() => monthEndOf('2030-13')).toThrow();
    // 형식이 틀린 값이 넘어와도 화면이 멈추지 않는다('정한 달 없음'으로 본다)
    expect(run(P.P7, T, { plan: '2030-13' }).end).toMatchObject({
      basis: 'retirement',
      planHeld: false,
    });
  });

  it('U12 퇴직 전 최고호봉 도달, 6월 30일 퇴직이면 7월 정근수당은 없다', () => {
    const r = run(P.P5, T);
    const l = on(r.life);
    expect(r.end.date).toBe('2027-06-30');
    expect(l.remaining).toBe(5_579_500 * (3 / 30 + 4) + 5_617_200 * 3);
    expect(l.remaining).toBe(39_727_550);
    expect(l).toMatchObject({ raisesLeft: 1, maxStep: 30, maxStepDate: '2027-04-01' });
    expect(on(r.pay).left).toBe(7);
    expect(r.diligence).toBe(1);
    expect(r.newYears).toBe(1);
  });

  it('U13 정년 뒤: 정년퇴직일에서 멈추고 정한 달은 보지 않는다', () => {
    const r = run(P.P6R, T, { plan: '2027-03' });
    expect(r.end).toMatchObject({
      basis: 'retirement',
      date: '2026-06-30',
      planIssue: null,
      planHeld: false,
    });
    expect(r.asOf).toBe('2026-06-30');
    expect(on(r.life)).toMatchObject({ remaining: 0, ratio: 1, raisesLeft: 0 });
    expect(r.pay).toEqual({ received: 434, left: 0, total: 434, todayCounted: false });
    expect(r.diligence).toBe(0);
    expect(r.newYears).toBe(0);
  });

  it('U14 정년퇴직일 당일·다음 날', () => {
    for (const today of ['2048-12-31', '2049-01-01']) {
      const r = run(P.P7, today);
      expect(on(r.life), today).toMatchObject({
        earned: 1_564_335_000,
        total: 1_564_335_000,
        remaining: 0,
        ratio: 1,
      });
      expect(r.pay, today).toMatchObject({ received: 426, left: 0 });
    }
  });

  it('U15 월 중 임용(그 달 월급날 뒤): 임용한 달의 월급날은 세지 않는다', () => {
    const r = run(P.P9L, T);
    // 3월 27~31일(5/31) + 4~10월(7달) + 11월 1~27일(27/30)
    expect(on(r.life).earned).toBe(Math.floor(2_133_000 * (5 / 31 + 7 + 27 / 30)));
    expect(on(r.life).earned).toBe(17_194_732);
    expect(r.end.date).toBe('2061-06-30');
    expect(r.pay).toMatchObject({ received: 8, left: 415 });
    expect(r.diligence).toBe(69);
  });

  it('U16 임용 첫날: 하루치만 벌었고 받은 월급날은 0번', () => {
    const r = run(P.P9D1, '2026-12-01');
    const l = on(r.life);
    expect(l.earned).toBe(Math.floor(2_133_000 / 31));
    expect(l.earned).toBe(68_806);
    expect(r.pay).toMatchObject({ received: 0, left: 415 });
    expect(shownPercent(l)).toMatchObject({ text: '1% 미만', under1: true, value: 0 });
    expect(
      hobongLine({
        retired: false,
        basis: 'retirement',
        paydays: on(r.pay),
        timePercent: 0,
        moneyPercent: shownPercent(l),
        raisesLeft: l.raisesLeft,
      }),
    ).toBe('첫 월급날이 다가오고 있어요.');
  });

  it('U17 교원 8월 31일 퇴직(월급날 17일)', () => {
    const r = run(P.PT8, T, { payday: 17 });
    const l = on(r.life);
    expect(r.end.date).toBe('2047-08-31');
    expect(l.remaining).toBe(4_129_400 * 3.1 + 12 * 72_574_700 + 78 * 6_205_700);
    expect(l.remaining).toBe(1_367_742_140);
    expect(l).toMatchObject({ raisesLeft: 15, maxStep: 40, maxStepDate: '2041-03-01' });
    expect(r.pay).toMatchObject({ received: 201, left: 249 });
    expect(r.diligence).toBe(42);
  });

  it('U18 교원 2월 말일 퇴직(윤년)', () => {
    const r = run(P.PT2, T, { payday: 17 });
    expect(r.end.date).toBe('2048-02-29');
    expect(on(r.life).remaining).toBe(4_129_400 * 3.1 + 12 * 72_574_700 + 84 * 6_205_700);
    expect(on(r.life).remaining).toBe(1_404_976_340);
    expect(on(r.pay).left).toBe(255);
    // 2048년 1월분 포함
    expect(r.diligence).toBe(43);
  });

  it('U19 계급정년이 먼저 오는 경정', () => {
    const r = run(P.PK, T);
    expect(r.cause).toBe('rankLimit');
    expect(r.end).toMatchObject({ basis: 'retirement', date: '2034-06-30', maxMonth: '2040-12' });
    expect(on(r.life).remaining).toBe(5_451_700 * 4.1 + 12 * 39_713_300 + 3 * 5_846_900);
    expect(on(r.life).remaining).toBe(516_452_270);
    expect(on(r.pay).left).toBe(91);
    expect(r.diligence).toBe(15);
  });

  it('U19b 계급정년 뒤(연령정년 이내)를 정할 수 있다', () => {
    const a = run(P.PK, T, { plan: '2036-12' });
    expect(a.end).toMatchObject({ basis: 'plan', beyondRankLimit: true, date: '2036-12-31' });
    expect(on(a.pay).left).toBe(121);
    const b = run(P.PK, T, { plan: '2040-12' });
    expect(b.end).toMatchObject({ basis: 'plan', beyondRankLimit: true });
    expect(on(b.pay).left).toBe(169);
    const c = run(P.PK, T, { plan: '2041-01' });
    expect(c.end).toMatchObject({ basis: 'retirement', planIssue: 'afterLimit', planHeld: true });
    expect(on(c.life).remaining).toBe(516_452_270);
  });

  it("U21 정년 '준비 중'(외무): 정한 달이 없으면 끝나는 날이 없다", () => {
    const none = run(P.PF, T);
    expect(none.end).toMatchObject({ basis: 'none', date: null, maxMonth: null, planHeld: false });
    expect(none.life).toBeNull();
    expect(none.pay).toBeNull();
    const plan = run(P.PF, T, { plan: '2040-06' });
    expect(plan.end).toMatchObject({ basis: 'plan', date: '2040-06-30', beyondRankLimit: false });
    expect(on(plan.life)).toMatchObject({ stepNow: 9, stepAtEnd: 23, raisesLeft: 14 });
    expect(plan.pay).toMatchObject({ received: 106, left: 163 });
    expect(plan.diligence).toBe(27);
  });

  it("U22 봉급 '준비 중'(군무원): 금액은 없고 월급날 횟수만", () => {
    const r = run(P.PM, T, { plan: '2040-06', payday: 10 });
    expect(r.life).toBeNull();
    expect(r.pay).toMatchObject({ received: 106, left: 163 });
    expect(r.diligence).toBeNull();
  });

  it('U23 계급 미입력(경찰): 정년은 입력 필요, 상한은 연령정년 퇴직일', () => {
    const p = { ...P.PK, rank: null };
    const none = run(p, T);
    expect(none.end).toMatchObject({ basis: 'none', date: null, maxMonth: '2040-12' });
    const plan = run(p, T, { plan: '2030-06' });
    expect(plan.end).toMatchObject({ basis: 'plan', beyondRankLimit: false });
    expect(plan.life).toBeNull();
    expect(on(plan.pay).left).toBe(43);
    const late = run(p, T, { plan: '2041-01' });
    expect(late.end).toMatchObject({
      basis: 'none',
      date: null,
      planIssue: 'afterLimit',
      planHeld: true,
    });
  });

  it('U24 연도 파일이 없는 먼 미래: 가장 가까운 이전 연도 표', () => {
    const r = run(P.P7, '2035-05-10');
    expect(on(r.life)).toMatchObject({ tableYear: 2026, total: 1_564_335_000 });
    expect(r.pay).toMatchObject({ received: 262, left: 164 });
    expect(r.diligence).toBe(27);
  });

  it('U25 지급일이 전달로 당겨짐(지급일 1일 + 1월 1일)', () => {
    const at = (today: Ymd) => on(run(P.P7, today, { payday: 1 }).pay);
    expect(at('2026-12-30')).toMatchObject({ received: 162, left: 264 });
    // 2027년 1월분이 12월 31일로 당겨져 그날 받는다
    expect(at('2026-12-31')).toMatchObject({ received: 163, left: 263, todayCounted: true });
    expect(at('2027-01-01')).toMatchObject({ received: 163, left: 263, todayCounted: false });
    for (const d of ['2026-12-30', '2026-12-31', '2027-01-01']) expect(at(d).total).toBe(426);
  });

  it('U26 퇴직 다음 달 지급일이 퇴직 달로 당겨져도 세지 않는다', () => {
    for (const today of ['2048-12-30', '2048-12-31']) {
      const pay = on(run(P.P7, today, { payday: 1 }).pay);
      expect(pay, today).toMatchObject({ received: 426, left: 0, total: 426 });
    }
  });

  it('U27 올해 봉급표 미반영(2027년 1월): 2026년 표 그대로', () => {
    const a = run(P.P7, '2027-01-05');
    expect(on(a.life)).toMatchObject({ tableYear: 2026, total: 1_564_335_000 });
    expect(a.pay).toMatchObject({ received: 162, left: 264 });
    expect(a.diligence).toBe(44);
    // 해가 바뀌는 횟수는 봉급표의 수를 말하지 않는다
    expect(a.newYears).toBe(21);
    const b = run(P.P7, '2027-01-25');
    expect(b.pay).toMatchObject({ received: 163, left: 263, todayCounted: true });
    expect(b.diligence).toBe(43);
  });

  it('U29 화면에 보이는 세 값의 합', () => {
    const shown = (p: CareerProfile, today: Ymd, plan: string | null = null) => {
      const l = on(run(p, today, { plan }).life);
      return shownRemaining(l.total, l.earned);
    };
    // 9급 시드 2026-11-25: 123,576만 − 11,076만(따로 버리면 112,499만)
    const l9 = on(run(P.P9, '2026-11-25').life);
    expect(Math.floor(l9.total / 10_000)).toBe(123_576);
    expect(Math.floor(l9.earned / 10_000)).toBe(11_076);
    expect(Math.floor(l9.remaining / 10_000)).toBe(112_499);
    expect(shown(P.P9, '2026-11-25')).toBe(1_125_000_000);
    expect(shown(P.P7, T)).toBe(1_106_600_000);
    expect(shown(P.P7, T, '2026-11')).toBe(350_000);
    // 실제 145,049원(버리면 14만) — 차이는 1만 원 미만
    expect(on(run(P.P7, '2048-12-30').life).remaining).toBe(145_049);
    expect(shown(P.P7, '2048-12-30')).toBe(150_000);
    expect(shown(P.P7, '2048-12-31')).toBe(0);
    expect(shownRemaining(0, 0)).toBe(0);
  });

  it('U29 날마다: 보이는 지금까지 + 앞으로 = 보이는 총액', () => {
    const MAN = 10_000;
    let n = 0;
    const cases: [CareerProfile, Ymd][] = [
      [P.P9, '2056-06-30'],
      [P.P7, '2048-12-31'],
      [P.PK, '2034-06-30'],
      [P.PT8, '2047-08-31'],
      [P.P7, '2030-03-31'],
      [P.P5, '2027-06-30'],
    ];
    for (const [p, end] of cases) {
      let d = '2026-11-01';
      for (let i = 0; i < 800 && d <= end; i += 1) {
        const l = on(lifetimeSalary(rulesFor, p, d, end));
        const shown = shownRemaining(l.total, l.earned);
        n += 1;
        expect(Math.floor(l.earned / MAN) + shown / MAN, d).toBe(Math.floor(l.total / MAN));
        if (l.remaining > 0) expect(shown, d).toBeGreaterThan(0);
        else expect(shown, d).toBe(0);
        expect(Math.abs(shown - l.remaining), d).toBeLessThan(MAN);
        d = addDays(d, 1);
      }
    }
    expect(n).toBe(4242);
  });

  it('U30 임용일이 오늘보다 뒤인 저장본: 임용 전 월급날을 세지 않고 예외도 없다', () => {
    expect(paydayCounts(cal, 25, '2027-03-02', T, '2048-12-31')).toEqual({
      received: 0,
      left: 262,
      total: 262,
      todayCounted: false,
    });
    const late: CareerProfile = {
      ...P.P9L,
      hireDate: '2027-03-02',
      rankDate: '2027-03-02',
      nextStepDate: '2028-03-01',
      stepAsOf: '2027-03-02',
    };
    const l = on(lifetimeSalary(rulesFor, late, T, '2061-06-30'));
    expect(l.earned).toBe(0);
    expect(l.remaining).toBe(l.total);
    expect(shownPercent(l)).toMatchObject({ text: '0%', under1: false });
  });

  it('U31 오늘이 월급날인지는 todayCounted 로 건다(다음 월급날이 오늘인지와 다르다)', () => {
    const hire = P.P7.hireDate;
    expect(paydayCounts(cal, 25, hire, '2026-11-25', '2048-12-31')).toMatchObject({
      received: 161,
      todayCounted: true,
    });
    // 지급일 1일, 오늘 = 끝 = 2026-12-31: 다음 달분이 오늘로 당겨졌지만 끝나는 달 밖이라 세지 않는다
    expect(cal.nextPayday('2026-12-31', 1)).toBe('2026-12-31');
    expect(paydayCounts(cal, 1, hire, '2026-12-31', '2026-12-31')).toMatchObject({
      received: 162,
      left: 0,
      todayCounted: false,
    });
    expect(paydayCounts(cal, 1, hire, '2048-12-31', '2048-12-31')).toMatchObject({
      received: 426,
      todayCounted: false,
    });
    expect(paydayCounts(cal, 1, hire, '2026-12-31', '2048-12-31')).toMatchObject({
      received: 163,
      left: 263,
      todayCounted: true,
    });
    // 정년 뒤
    expect(paydayCounts(cal, 25, hire, '2049-01-25', '2048-12-31').todayCounted).toBe(false);
  });

  it('U32 공휴일 반영 안내 조건: 오늘의 해와 다음 달 1일의 해', () => {
    expect(paydayHolidaysKnown(cal, '2026-11-27')).toBe(true);
    expect(paydayHolidaysKnown(cal, '2026-12-15')).toBe(true);
    expect(paydayHolidaysKnown(cal, '2027-11-30')).toBe(true);
    expect(paydayHolidaysKnown(cal, '2027-12-01')).toBe(false);
    expect(paydayHolidaysKnown(cal, '2028-01-01')).toBe(false);
  });

  it('U33 근속가봉 안내 대상: 금액이 원문에 있는 봉급표(별표 11)뿐', () => {
    const pay = (p: CareerProfile) => {
      const c = careerOf(rulesFor, p, 2026);
      if (!isAvailable(c.pay)) throw new Error('봉급이 꺼져 있습니다');
      return c.pay;
    };
    expect(pay(P.PT8).longServiceAddOn).toMatchObject({ amount: 81_000, maxCount: 10 });
    expect(pay(P.P7).longServiceAddOn).toBeNull();
    expect(pay(P.PK).longServiceAddOn).toBeNull();
    expect(pay({ ...P.P7, payTable: 'table4' }).longServiceAddOn).toBeNull();
    expect(pay({ ...P.P7, payTable: 'table8' }).longServiceAddOn).toBeNull();
  });

  it('U34 가리기 조건(planHeld)', () => {
    const held = (plan: string | null, p: CareerProfile = P.P7) => run(p, T, { plan }).end.planHeld;
    expect(held(null)).toBe(false);
    expect(held('2030-03')).toBe(true);
    expect(held('2026-10')).toBe(true);
    expect(held('2049-01')).toBe(true);
    expect(held('2048-12')).toBe(true);
    expect(held('2027-03', P.P6R)).toBe(false);
  });

  it('U35 한마디의 %: 정년 기준이면 정년 창의 낭독값과 같은 내림', () => {
    const line = (p: CareerProfile, today: Ymd, plan: string | null = null) => {
      const r = run(p, today, { plan });
      const time = Math.floor(careerProgress(p.hireDate, on(r.end.date), today).ratio * 100);
      const money = shownPercent(on(r.life));
      return {
        time,
        money: money.value,
        text: hobongLine({
          retired: false,
          basis: r.end.basis === 'plan' ? 'plan' : 'retirement',
          paydays: r.pay,
          timePercent: time,
          moneyPercent: money,
          raisesLeft: on(r.life).raisesLeft,
        }),
      };
    };
    expect(line(P.P7, T)).toEqual({
      time: 37,
      money: 29,
      text: '기간은 37% 지났는데 봉급은 29% 받았어요. 호봉이 오를수록 뒤쪽 달이 더 두둑해요.',
    });
    expect(line(P.P7, T, '2030-03')).toEqual({
      time: 80,
      money: 75,
      text: '정한 달까지의 기간은 80% 지났는데 봉급은 75% 받았어요. 호봉이 오를수록 뒤쪽 달이 더 두둑해요.',
    });
    expect(line(P.P9, '2026-11-25')).toMatchObject({ time: 12, money: 8 });
    // 남은 월급날이 1~12번이면 그 문장이 먼저다
    expect(line(P.P5, T).text).toBe('월급날이 7번 남았어요. 한 번 한 번이 아쉬워요.');
  });

  it('진행률 표기: 남은 금액이 있으면 100%라고 쓰지 않는다', () => {
    expect(shownPercent({ ratio: 0.9999, earned: 99, remaining: 1 })).toMatchObject({
      text: '99%',
      bar: 0.99,
    });
    expect(shownPercent({ ratio: 1, earned: 100, remaining: 0 })).toMatchObject({
      text: '100%',
      bar: 1,
    });
    expect(shownPercent({ ratio: 0.2976, earned: 1, remaining: 1 }).text).toBe('29%');
  });
});

describe('생애 봉급: 불변식(설계서 §7.2, 시드 고정)', () => {
  // 선형 합동 생성기(시드 고정) — 실패하면 같은 입력으로 다시 볼 수 있다
  let seed = 20261127;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const tracks: (() => Pick<CareerProfile, 'track' | 'payTable' | 'rank'>)[] = [
    () => ({
      track: 'general',
      payTable: (['table3', 'table4', 'table8'] as const)[ri(0, 2)] ?? 'table3',
      rank: String(ri(1, 9)),
    }),
    () => ({ track: 'teacher', payTable: null, rank: '교원' }),
    () => ({
      track: 'police',
      payTable: null,
      rank: ['순경', '경장', '경사', '경위', '경감', '경정', '총경'][ri(0, 6)] ?? '순경',
    }),
    () => ({
      track: 'fire',
      payTable: null,
      rank: ['소방사', '소방교', '소방장', '소방위', '소방경', '소방령'][ri(0, 5)] ?? '소방사',
    }),
  ];

  /**
   * 하루씩 더하는 독립 검산식: 그날 호봉의 월 봉급 ÷ 그 달 일수. 임용일부터 가장 늦은 끝나는 날까지 한 번 훑으며
   * 끝나는 날마다 그때까지의 합을 적어 둔다.
   */
  function oracle(p: CareerProfile, year: number, ends: readonly Ymd[]): Map<Ymd, number> {
    const c = careerOf(rulesFor, p, year);
    if (!isAvailable(c.pay)) throw new Error('봉급이 꺼져 있습니다');
    const out = new Map<Ymd, number>();
    const last = ends.reduce((a, b) => (a > b ? a : b));
    let sum = 0;
    for (let d = p.hireDate; d <= last; d = addDays(d, 1)) {
      const { y, m } = parseYmd(d);
      sum += monthlySalary(c.pay.row, careerStepOn(c, p, d)) / daysInMonth(y, m);
      if (ends.includes(d)) out.set(d, sum);
    }
    return out;
  }

  /** 문장 정의 그대로: 임용 달~끝나는 달의 월급날 집합에서 센다 */
  function brute(payday: number, hire: Ymd, today: Ymd, end: Ymd) {
    const index = (d: Ymd) => parseYmd(d).y * 12 + (parseYmd(d).m - 1);
    const set: Ymd[] = [];
    for (let i = index(hire); i <= index(end); i += 1)
      set.push(cal.payday(Math.floor(i / 12), (i % 12) + 1, payday));
    const asOf = minYmd(today, end);
    const ok = set.filter((p) => p >= hire && p <= end);
    return {
      received: ok.filter((p) => p <= asOf).length,
      left: ok.filter((p) => p > asOf).length,
      todayCounted: ok.includes(today) && today <= asOf,
    };
  }

  it(
    '금액: 임의 프로필 400개 × 끝나는 날(정년 / 이번 달 / 그 사이 달)',
    { timeout: 60_000 },
    () => {
      const MAN = 10_000;
      let n = 0;
      for (let t = 0; t < 400; t += 1) {
        const today = formatYmd({ y: ri(2026, 2034), m: ri(1, 12), d: ri(1, 28) });
        const hire = formatYmd({ y: ri(1990, yearOf(today) - 1), m: ri(1, 12), d: ri(1, 28) });
        const birth = formatYmd({
          y: ri(yearOf(hire) - 40, yearOf(hire) - 19),
          m: ri(1, 12),
          d: ri(1, 28),
        });
        const sel = (tracks[ri(0, tracks.length - 1)] as (typeof tracks)[number])();
        const nextRaw = addMonthsClamped(`${today.slice(0, 7)}-01`, ri(1, 12));
        // 승급 제한이 끝난 다음 날 승급(월 중 승급)을 섞는다
        const next = rnd() < 0.15 ? addDays(nextRaw, ri(1, 20)) : nextRaw;
        const p: CareerProfile = {
          ...base,
          ...sel,
          birthDate: birth,
          hireDate: hire,
          rankDate: hire,
          step: ri(1, 33),
          nextStepDate: next,
          stepAsOf: addDays(today, -ri(0, 400)),
        };
        const c = careerOf(rulesFor, p, yearOf(today));
        if (!isAvailable(c.pay)) continue;
        p.step = Math.min(p.step, c.pay.row.length);
        const ret = effectiveRetirement(c, p);
        if (!isAvailable(ret)) continue;
        const ends = [ret.retireDate];
        if (ret.retireDate > today) {
          ends.push(monthEndOf(monthOfYmd(today)));
          const mid = addMonthsClamped(today, ri(1, 60));
          if (mid < ret.retireDate) ends.push(monthEndOf(monthOfYmd(mid)));
        }
        let prev: { total: number; left: number } | null = null;
        const sums = t % 4 === 0 ? oracle(p, yearOf(today), ends) : null;
        for (const end of ends.sort()) {
          const asOf = minYmd(today, end);
          const l = on(lifetimeSalary(rulesFor, p, asOf, end));
          const tag = JSON.stringify({ p, today, end });
          n += 1;
          // 1. 원 단위 합이 정확히 맞는다
          expect(l.earned + l.remaining, tag).toBe(l.total);
          // 2. 지갑 창의 누적 봉급과 같은 값
          expect(l.earned, tag).toBe(on(cumulativeSalary(rulesFor, p, asOf)).total);
          // 3. 음수가 없다
          expect(l.remaining, tag).toBeGreaterThanOrEqual(0);
          // 4. 하루씩 더한 검산식과 ±1원(시간이 걸려 프로필 넷 중 하나만 본다)
          if (sums)
            expect(
              Math.abs(Math.floor(on(sums.get(end) ?? null)) - l.total),
              tag,
            ).toBeLessThanOrEqual(1);
          // 5. 월급날: 받은 + 남은 = 임용 달~끝나는 달의 월급날 가운데 임용일 이후인 것
          const pc = paydayCounts(cal, 25, p.hireDate, today, end);
          const b = brute(25, p.hireDate, today, end);
          expect(pc.received + pc.left, tag).toBe(b.received + b.left);
          // 3. 끝나는 날이 늦어지면 총액·남은 월급날이 줄지 않는다
          if (prev) {
            expect(l.total, tag).toBeGreaterThanOrEqual(prev.total);
            expect(pc.left, tag).toBeGreaterThanOrEqual(prev.left);
          }
          prev = { total: l.total, left: pc.left };
          // 7. 화면에 보이는 세 값
          const shown = shownRemaining(l.total, l.earned);
          expect(Math.floor(l.earned / MAN) + shown / MAN, tag).toBe(Math.floor(l.total / MAN));
          if (l.remaining > 0) expect(shown, tag).toBeGreaterThan(0);
        }
      }
      expect(n).toBeGreaterThan(700);
    },
  );

  it('월급날: 문장 정의와 대조(임용일이 오늘보다 뒤인 경우 포함)', () => {
    let s = 20261127;
    const r2 = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const ri2 = (a: number, b: number) => a + Math.floor(r2() * (b - a + 1));
    const rd = (y1: number, y2: number) => {
      const y = ri2(y1, y2);
      const m = ri2(1, 12);
      return formatYmd({ y, m, d: ri2(1, daysInMonth(y, m)) });
    };
    let n = 0;
    let lateHire = 0;
    for (let k = 0; k < 6000; k += 1) {
      const hire = rd(2020, 2028);
      const today = rd(2026, 2028);
      const ey = ri2(2026, 2032);
      const em = ri2(1, 12);
      const end = formatYmd({ y: ey, m: em, d: daysInMonth(ey, em) });
      if (end < hire) continue;
      const payday = [1, 2, 3, 10, 17, 20, 25, 28, 31][ri2(0, 8)] as number;
      const a = paydayCounts(cal, payday, hire, today, end);
      const b = brute(payday, hire, today, end);
      const tag = JSON.stringify({ hire, today, end, payday });
      n += 1;
      if (hire > today) lateHire += 1;
      expect({ received: a.received, left: a.left, todayCounted: a.todayCounted }, tag).toEqual(b);
      expect(a.total, tag).toBe(a.received + a.left);
      // 8. todayCounted 가 참이면 오늘이 임용일~끝나는 날 안의 월급날이다
      if (a.todayCounted) {
        expect(today >= hire && today <= end, tag).toBe(true);
        const { y, m } = parseYmd(today);
        const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
        expect(
          [cal.payday(y, m, payday), cal.payday(next.y, next.m, payday)].includes(today),
          tag,
        ).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(5000);
    expect(lateHire).toBeGreaterThan(500);
  });

  it('정근수당: 다가오는 보너스(diligenceBonus)와 같은 판정', () => {
    for (const [p, payday] of [
      [P.P7, 25],
      [P.P5, 25],
      [P.P9L, 25],
      [P.PT2, 17],
      [P.PK, 1],
    ] as const) {
      const r = run(p, T, { payday });
      const end = on(r.end.date);
      let n = 0;
      for (let y = yearOf(T); y <= yearOf(end); y += 1) {
        for (const m of [1, 7]) {
          const event = diligenceBonus(rulesFor, cal, p, payday, y, m, end);
          if (event && event.date > T) n += 1;
        }
      }
      expect(r.diligence, p.birthDate).toBe(n);
    }
  });
});
