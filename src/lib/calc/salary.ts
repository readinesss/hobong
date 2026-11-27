/** 봉급표 조회, 다음 인상, 지금까지 번 봉급(추정) */
import {
  addDays,
  daysInMonth,
  formatYmd,
  maxYmd,
  minYmd,
  parseYmd,
  yearOf,
  type Ymd,
} from './date.ts';
import type { RulesProvider } from './calendar.ts';
import { careerOf, careerStepOn, type CareerKey } from './career-profile.ts';
import {
  dateReachedStep,
  nextRaiseDate,
  raiseDate,
  raiseIndexOn,
  stepOn,
  type StepAnchor,
} from './step.ts';
import type { CareerRules, PayInfo } from '../rules/career.ts';
import { isAvailable, type RankKey } from '../rules/types.ts';

/** 봉급표 한 열(1호봉부터)의 최고호봉 */
export function maxStepOf(row: readonly number[]): number {
  return row.length;
}

/** 봉급표 한 열의 월 봉급. 호봉이 표 범위를 벗어나면 가장 가까운 값을 쓴다 */
export function monthlySalary(row: readonly number[], step: number): number {
  const index = Math.min(row.length, Math.max(1, Math.floor(step))) - 1;
  return row[index] as number;
}

export interface SalaryPoint {
  date: Ymd;
  /** 계급 키(교원 '교원', 사다리 없는 직종은 null) */
  rank: RankKey | null;
  step: number;
  amount: number;
  /** '별표 3' 등 */
  annex: string;
  /** 금액을 가져온 봉급표의 연도 */
  tableYear: number;
  /** date가 속한 해의 봉급표가 확정돼 있는지(아니면 이전 연도 표) */
  confirmed: boolean;
  atMaxStep: boolean;
}

/** 봉급 계산에 쓰는 프로필: 직종·봉급표·계급과 호봉 기준점, 임용일 */
export interface PayProfile extends StepAnchor, CareerKey {
  hireDate: Ymd;
}

/** 그 해 규정에서 봉급표가 켜져 있으면 그 정보 */
function payOf(c: CareerRules): PayInfo | null {
  return isAvailable(c.pay) ? c.pay : null;
}

/**
 * date 시점의 호봉과 봉급(그 해 규정 기준).
 * 그 해 봉급이 꺼져 있으면(준비 중·계급 없음 등) 숫자를 만들지 않고 null.
 */
export function salaryOn(rules: RulesProvider, profile: PayProfile, date: Ymd): SalaryPoint | null {
  const c = careerOf(rules, profile, yearOf(date));
  const pay = payOf(c);
  if (!pay) return null;
  const max = maxStepOf(pay.row);
  const step = careerStepOn(c, profile, date);
  return {
    date,
    rank: c.rank ? c.rank.key : null,
    step,
    amount: monthlySalary(pay.row, step),
    annex: pay.annex,
    tableYear: pay.tableYear,
    confirmed: pay.confirmed,
    atMaxStep: step >= max,
  };
}

export interface RaiseInfo {
  date: Ymd;
  fromStep: number;
  toStep: number;
  fromAmount: number;
  toAmount: number;
  diff: number;
  /** 승급일이 속한 해의 봉급표가 확정돼 있는지 */
  confirmed: boolean;
}

/** 다음 정기승급(호봉 승급)으로 오르는 봉급. 최고 호봉이거나 봉급·정기승급이 꺼져 있으면 null */
export function nextStepRaise(
  rules: RulesProvider,
  profile: PayProfile,
  today: Ymd,
): RaiseInfo | null {
  const c = careerOf(rules, profile, yearOf(today));
  const pay = payOf(c);
  if (!pay || !isAvailable(c.stepRaise)) return null;
  const now = salaryOn(rules, profile, today);
  if (!now) return null;
  const date = nextRaiseDate(profile, today, maxStepOf(pay.row), c.stepRaise.periodMonths);
  if (!date) return null;
  const after = salaryOn(rules, profile, date);
  if (!after) return null;
  // 같은 봉급표 안에서의 차이를 보여준다(연도가 바뀌어도 인상률은 알 수 없으므로).
  const same = payOf(careerOf(rules, profile, now.tableYear));
  if (!same) return null;
  const fromAmount = monthlySalary(same.row, now.step);
  const toAmount = monthlySalary(same.row, after.step);
  return {
    date,
    fromStep: now.step,
    toStep: after.step,
    fromAmount,
    toAmount,
    diff: toAmount - fromAmount,
    confirmed: after.confirmed,
  };
}

export interface CumulativeSalary {
  /** 추정 합계(원, 원 미만 버림) */
  total: number;
  /** 계산에 쓴 봉급표 연도 */
  tableYear: number;
  from: Ymd;
  to: Ymd;
}

/** from~to(양끝 포함)의 봉급 합계를 주어진 봉급표 하나로 계산한다 */
function sumSalary(
  row: readonly number[],
  periodMonths: number,
  profile: PayProfile,
  from: Ymd,
  to: Ymd,
): number {
  if (to < from) return 0;
  const max = maxStepOf(row);
  let total = 0;
  // 승급 구간 [raiseDate(k), raiseDate(k+1)) 을 차례로 돌며, 구간 안에서는 달 단위로 일할계산한다.
  const lastK = raiseIndexOn(profile, to, periodMonths);
  for (let k = raiseIndexOn(profile, from, periodMonths); k <= lastK; k += 1) {
    const segStart = maxYmd(raiseDate(profile, k, periodMonths), from);
    const segEnd = minYmd(addDays(raiseDate(profile, k + 1, periodMonths), -1), to);
    if (segEnd < segStart) continue;
    const step = Math.min(max, Math.max(1, profile.step + k + 1));
    total += monthlySalary(row, step) * monthFraction(segStart, segEnd);
  }
  return total;
}

/** 누적 봉급 계산에 쓰는 그 해 봉급표 열과 정기승급 기간. 봉급·정기승급이 꺼져 있으면 null */
function sumBasis(rules: RulesProvider, profile: PayProfile, today: Ymd) {
  const c = careerOf(rules, profile, yearOf(today));
  const pay = payOf(c);
  if (!pay || !isAvailable(c.stepRaise)) return null;
  return { pay, periodMonths: c.stepRaise.periodMonths };
}

/**
 * 임용일부터 today까지의 봉급 합계 추정. 봉급표나 정기승급이 꺼진 직종은 null.
 *
 * 가정: 현재 직급과 현재(today가 속한 해) 봉급표를 과거에도 그대로 적용하고,
 * 호봉만 승급일마다 한 호봉씩 거슬러 내려간다(1호봉 아래로는 내려가지 않는다).
 * 과거 봉급표, 승진 전 직급, 휴직·감액 기간은 반영하지 않는다.
 * 월 중 임용·월 중 승급은 그 달의 일수로 일할계산한다(보수규정 제22조).
 */
export function cumulativeSalary(
  rules: RulesProvider,
  profile: PayProfile,
  today: Ymd,
): CumulativeSalary | null {
  const basis = sumBasis(rules, profile, today);
  if (!basis) return null;
  const total = sumSalary(basis.pay.row, basis.periodMonths, profile, profile.hireDate, today);
  return {
    total: Math.floor(total),
    tableYear: basis.pay.tableYear,
    from: profile.hireDate,
    to: today,
  };
}

/** 올해 1월 1일(올해 임용됐으면 임용일)부터 today까지 번 봉급 추정. 봉급표나 정기승급이 꺼진 직종은 null */
export function yearToDateSalary(
  rules: RulesProvider,
  profile: PayProfile,
  today: Ymd,
): number | null {
  const basis = sumBasis(rules, profile, today);
  if (!basis) return null;
  const start = maxYmd(formatYmd({ y: yearOf(today), m: 1, d: 1 }), profile.hireDate);
  return Math.floor(sumSalary(basis.pay.row, basis.periodMonths, profile, start, today));
}

export interface LifetimeSalary {
  /** 임용일~to 의 봉급 합계 추정(원 미만 버림) */
  total: number;
  /** 임용일~asOf. cumulativeSalary(rules, profile, asOf).total 과 같은 값 */
  earned: number;
  /** total - earned (뺄셈으로 정의한다) */
  remaining: number;
  /** earned / total (total 이 0 이면 0) */
  ratio: number;
  tableYear: number;
  from: Ymd;
  asOf: Ymd;
  to: Ymd;
  stepNow: number;
  /** to 의 호봉(최고호봉에서 멈춤) */
  stepAtEnd: number;
  /** stepAtEnd - stepNow */
  raisesLeft: number;
  maxStep: number;
  /** asOf 뒤 to 이전에 최고호봉에 닿으면 그 승급일, 아니면 null(이미 최고호봉이거나 닿지 못함) */
  maxStepDate: Ymd | null;
}

/**
 * 생애 봉급 추정(#30): 임용일부터 end(퇴직일 또는 퇴직 예정 달의 말일, 그날 포함)까지의 봉급 합계와
 * 그 가운데 asOf('재직 중의 오늘' = min(오늘, end))까지 번 만큼. 봉급표나 정기승급이 꺼진 직종은 null.
 *
 * 가정은 cumulativeSalary 와 같다: asOf 가 속한 해의 봉급표 한 장과 지금 직급을 전 기간에 쓰고,
 * 호봉만 승급기간마다 한 호봉씩(최고호봉까지) 움직인다. 과거·앞날의 봉급표, 승진, 휴직·감액은 넣지 않는다.
 *
 * 경계: earned 는 임용일 ≤ 날 ≤ asOf(오늘 하루치 포함), total 은 임용일 ≤ 날 ≤ to.
 * '앞으로'(asOf 다음 날 ~ to)는 따로 더하지 않고 total - earned 로 정의한다. 따로 더해 버림하면
 * floor(a) + floor(b) ≠ floor(a + b) 로 1원이 어긋날 수 있다. 그래서 earned + remaining === total 이 늘 성립한다.
 */
export function lifetimeSalary(
  rules: RulesProvider,
  profile: PayProfile,
  asOf: Ymd,
  end: Ymd,
): LifetimeSalary | null {
  const basis = sumBasis(rules, profile, asOf);
  if (!basis) return null;
  const { pay, periodMonths } = basis;
  // 부르는 쪽이 asOf <= end 로 맞추지만, 어겨도 음수가 나오지 않게
  const to = maxYmd(asOf, end);
  const max = maxStepOf(pay.row);
  const earned = Math.floor(sumSalary(pay.row, periodMonths, profile, profile.hireDate, asOf));
  // asOf === to 일 때 부동소수 오차로 total 이 1원 작아지는 일을 막는다
  const total = Math.max(
    earned,
    Math.floor(sumSalary(pay.row, periodMonths, profile, profile.hireDate, to)),
  );
  const stepNow = stepOn(profile, asOf, max, periodMonths);
  const stepAtEnd = stepOn(profile, to, max, periodMonths);
  const reach = dateReachedStep(profile, max, periodMonths);
  return {
    total,
    earned,
    remaining: total - earned,
    ratio: total > 0 ? earned / total : 0,
    tableYear: pay.tableYear,
    from: profile.hireDate,
    asOf,
    to,
    stepNow,
    stepAtEnd,
    raisesLeft: stepAtEnd - stepNow,
    maxStep: max,
    maxStepDate: stepNow < max && reach <= to ? reach : null,
  };
}

/** start~end(양끝 포함)가 몇 "달치"인지. 각 달은 그 달의 일수로 나눈다 */
export function monthFraction(start: Ymd, end: Ymd): number {
  if (end < start) return 0;
  const a = parseYmd(start);
  const b = parseYmd(end);
  let sum = 0;
  let y = a.y;
  let m = a.m;
  for (;;) {
    const dim = daysInMonth(y, m);
    const first = y === a.y && m === a.m ? a.d : 1;
    const last = y === b.y && m === b.m ? b.d : dim;
    sum += (last - first + 1) / dim;
    if (y === b.y && m === b.m) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return sum;
}

/** 그 해 봉급표가 아직 없어 이전 연도 표로 계산 중인지. 봉급이 꺼져 있으면 false(표시하지 않는다) */
export function isPayPending(c: CareerRules): boolean {
  return isAvailable(c.pay) && !c.pay.confirmed;
}
