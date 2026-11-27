/**
 * 생애 봉급(#30)의 날짜 계산: 끝나는 날 정하기, 월급날·정근수당 횟수, 해가 바뀌는 횟수.
 * 금액(봉급 합계)은 salary.ts 의 lifetimeSalary 가 맡는다(지갑 창의 누적 봉급과 같은 코드 경로).
 *
 * 금액과 횟수는 세는 기준이 다르다. 금액은 날짜만큼 번 것(오늘까지 일할), 횟수는 월급날이 지났는지다.
 * 그래서 이번 달 월급날이 지난 마지막 달에는 '앞으로 벌 봉급'이 남았는데 남은 월급날은 0번일 수 있다.
 */
import { diligenceQualifies } from './bonus.ts';
import type { Calendar } from './calendar.ts';
import { daysInMonth, formatYmd, minYmd, parseYmd, yearOf, type Ymd } from './date.ts';
import type { EffectiveRetirement } from './retirement.ts';
import { isAvailable, type AllowanceRules, type Avail } from '../rules/types.ts';

/** 'YYYY-MM' */
export type YearMonth = string;
export const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** '2028-02' → '2028-02-29'(그 달 말일) */
export function monthEndOf(month: YearMonth): Ymd {
  if (!YEAR_MONTH_RE.test(month)) throw new Error(`연·월 형식이 아닙니다: ${month}`);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return formatYmd({ y, m, d: daysInMonth(y, m) });
}

/** '2026-11-27' → '2026-11' */
export function monthOfYmd(date: Ymd): YearMonth {
  return date.slice(0, 7);
}

export interface PaydayCounts {
  /** 임용일 ≤ 월급날 ≤ asOf 인 월급날의 수(오늘이 월급날이면 오늘 것도 받은 쪽) */
  received: number;
  /** asOf < 월급날 ≤ 끝나는 날 이고 임용일 ≤ 월급날 인 월급날의 수(끝나는 달까지만 훑는다) */
  left: number;
  /** received + left */
  total: number;
  /** 오늘 날짜의 월급날이 received 에 들어 있다("오늘이 {received}번째 월급날이에요"의 조건) */
  todayCounted: boolean;
}

/**
 * 받은·남은 월급날 횟수. 월급날은 cal.payday(연, 월, 지급일) — 토요일·공휴일이면 그 전날(보수규정 제20조제2항).
 *
 * - 끝나는 달의 월급날은 센다(끝나는 날이 말일이라 월급날은 그 이전이다).
 * - 끝난 다음 달의 지급일이 공휴일 때문에 끝나는 달로 당겨져도(지급일 1일 + 1월 1일 → 12월 31일) 세지 않는다.
 *   달을 끝나는 달까지만 훑기 때문이다.
 * - 임용일이 오늘보다 뒤인 저장본(기기 시계가 뒤로 간 경우)에서도 임용 전 월급날을 세지 않는다.
 * - todayCounted 는 '다음 월급날이 오늘인가'(view.isPayday)와 다르다. 지급일 1~3일인 사람이 끝나는 날 당일을 맞으면
 *   다음 달분이 당겨진 것을 오늘의 월급날로 보지만, 그 지급일은 끝나는 달 밖이라 세지 않는다.
 */
export function paydayCounts(
  cal: Calendar,
  payday: number,
  hireDate: Ymd,
  today: Ymd,
  end: Ymd,
): PaydayCounts {
  const index = (d: Ymd) => {
    const { y, m } = parseYmd(d);
    return y * 12 + (m - 1);
  };
  const at = (i: number) => cal.payday(Math.floor(i / 12), (i % 12) + 1, payday);
  const asOf = minYmd(today, end);
  const last = index(end);
  let received = 0;
  let left = 0;
  let todayCounted = false;
  // 다음 달 지급일이 이번 달로 당겨지는 경우(1~3일 지급 + 공휴일)까지 보려고 asOf 의 다음 달까지 훑되, 끝나는 달은 넘지 않는다
  for (let i = index(hireDate); i <= Math.min(index(asOf) + 1, last); i += 1) {
    const p = at(i);
    if (p >= hireDate && p <= asOf) {
      received += 1;
      if (p === today) todayCounted = true;
    }
  }
  // 임용일이 오늘보다 뒤인 저장본에서도 임용 전 월급날을 세지 않게 임용한 달부터 훑고 p >= hireDate 를 건다
  for (let i = Math.max(index(asOf), index(hireDate)); i <= last; i += 1) {
    const p = at(i);
    if (p > asOf && p >= hireDate && p <= end) left += 1;
  }
  return { received, left, total: received + left, todayCounted };
}

/**
 * 월급날 횟수에 공휴일이 반영돼 있는지: asOf 가 속한 해와 그 다음 달 1일이 속한 해의 공휴일 데이터가 둘 다 있어야 한다.
 * 앞날의 횟수는 '이번 달 월급날이 지났는지'와 '다음 달 지급일이 이번 달로 당겨졌는지'(12월이면 다음 해 1월 1일)로만 달라진다.
 */
export function paydayHolidaysKnown(cal: Calendar, asOf: Ymd): boolean {
  const { y, m } = parseYmd(asOf);
  const nextMonthYear = m === 12 ? y + 1 : y;
  return cal.hasHolidayData(y) && cal.hasHolidayData(nextMonthYear);
}

/**
 * today 뒤에 지급일이 오고 기준일(지급 달 1일)에 재직 중인 정근수당의 횟수.
 * 판정은 bonus.ts 의 diligenceBonus 와 같다(공무원수당 등에 관한 규정 제7조제1항: 1월 1일·7월 1일 현재
 * 공무원의 신분을 보유하고 봉급이 지급되는 사람). 6월 30일 퇴직이면 그해 7월분은 없다.
 * 징계·휴직에 따른 지급 제외(제7조제2항)는 반영하지 않는다.
 */
export function diligenceLeft(
  cal: Calendar,
  rule: AllowanceRules['diligence'],
  payday: number,
  hireDate: Ymd,
  today: Ymd,
  end: Ymd,
): number {
  let n = 0;
  for (let y = yearOf(today); y <= yearOf(end); y += 1) {
    for (const m of rule.payMonths) {
      const basis = formatYmd({ y, m, d: 1 });
      if (basis > end || hireDate > basis) continue;
      if (!diligenceQualifies(rule, hireDate, basis)) continue;
      if (cal.payday(y, m, payday) > today) n += 1;
    }
  }
  return n;
}

/**
 * asOf 뒤 ~ end 사이의 1월 1일 수(해가 바뀌는 횟수). 달력의 사실이다.
 * '새 봉급표가 나오는 횟수'가 아니다 — 봉급표가 해마다 개정된다는 규정은 원문에서 확인하지 못했다.
 */
export function newYearsLeft(asOf: Ymd, end: Ymd): number {
  return Math.max(0, yearOf(end) - yearOf(asOf));
}

export type RetirePlanIssue = 'past' | 'afterLimit' | 'beforeHire';

export interface LifetimeEnd {
  /** 계산의 끝나는 날. 정년을 계산하지 못하는데 쓸 수 있는 정한 달도 없으면 null */
  date: Ymd | null;
  basis: 'retirement' | 'plan' | 'none';
  /** 계산에 쓴 정한 달(basis 'plan' 일 때만) */
  planMonth: YearMonth | null;
  /**
   * 저장된 정한 달이 있고 화면이 그것을 다룬다(분기 3~7). 분기 1(정년퇴직일이 지남)·2(정한 달 없음)는 false.
   * 금액 가리기의 조건이다: basis 가 아니라 이것으로 가린다 — planIssue 나 '정년과 같은 달'(분기 6)도 정한 달을 드러낼 수 있다
   */
  planHeld: boolean;
  /** 저장된 정한 달이 있는데 쓰지 못한 까닭(화면이 고쳐 달라고 한다). 저장본은 건드리지 않는다 */
  planIssue: RetirePlanIssue | null;
  /** 정한 달이 계급정년 퇴직일보다 뒤(연령정년 이내) */
  beyondRankLimit: boolean;
  /** 고를 수 있는 범위: 이번 달 ~ 연령정년 퇴직일의 달(정년 규정이 꺼진 직종은 null = 확인한 상한 없음) */
  minMonth: YearMonth;
  maxMonth: YearMonth | null;
}

/**
 * 생애 봉급의 끝나는 날을 정한다. 기본은 정년퇴직일(연령·계급정년 중 이른 날), 정한 달이 있으면 그 달 말일.
 * 위에서부터 먼저 맞는 것:
 * 1. 정년퇴직일이 지남 → 정년퇴직일(정한 달은 보지 않는다)
 * 2. 정한 달 없음 → 정년퇴직일 / 정년을 계산하지 못하면 'none'
 * 3. 정한 달의 말일 < 오늘 → 'past' + 기본값
 * 4. 정한 달의 말일 < 임용일 → 'beforeHire' + 기본값
 * 5. 정한 달의 말일 > 연령정년 퇴직일 → 'afterLimit' + 기본값
 * 6. 정한 달의 말일 = 기본 정년퇴직일 → 정년 기준(저장된 값은 그대로 둔다)
 * 7. 그 밖 → 정한 달의 말일
 */
export function resolveLifetimeEnd(input: {
  today: Ymd;
  hireDate: Ymd;
  retirement: Avail<EffectiveRetirement>;
  /**
   * 연령정년 퇴직일. 정년 규정이 켜져 있으면 계급을 몰라도 셈할 수 있다
   * (retirement 가 계산되면 retirement.age.retireDate 와 같은 날). 정년 규정이 꺼진 직종은 null
   */
  ageRetireDate: Ymd | null;
  planMonth: YearMonth | null;
}): LifetimeEnd {
  const { today, hireDate, retirement, ageRetireDate, planMonth } = input;
  const def = isAvailable(retirement) ? retirement.retireDate : null;
  const minMonth = monthOfYmd(today);
  const maxMonth = ageRetireDate === null ? null : monthOfYmd(ageRetireDate);
  const fallback = (planIssue: RetirePlanIssue | null, planHeld: boolean): LifetimeEnd => ({
    date: def,
    basis: def === null ? 'none' : 'retirement',
    planMonth: null,
    planHeld,
    planIssue,
    beyondRankLimit: false,
    minMonth,
    maxMonth,
  });
  if (def !== null && today > def) return fallback(null, false);
  // 형식이 틀린 값은 저장본 검사가 거르지만, 여기까지 와도 화면이 멈추지 않게 '정한 달 없음'으로 본다
  if (planMonth === null || !YEAR_MONTH_RE.test(planMonth)) return fallback(null, false);
  const end = monthEndOf(planMonth);
  if (end < today) return fallback('past', true);
  if (end < hireDate) return fallback('beforeHire', true);
  if (ageRetireDate !== null && end > ageRetireDate) return fallback('afterLimit', true);
  if (def !== null && end === def) return fallback(null, true);
  return {
    date: end,
    basis: 'plan',
    planMonth,
    planHeld: true,
    planIssue: null,
    beyondRankLimit: def !== null && end > def,
    minMonth,
    maxMonth,
  };
}
