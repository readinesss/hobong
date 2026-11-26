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
import { nextRaiseDate, raiseDate, raiseIndexOn, stepOn, type StepAnchor } from './step.ts';
import type { GradeKey, PayTableId, RankKey, Rules, SalaryRules, TrackId } from '../rules/types.ts';
import { GENERAL_RANKS, type Grade } from '../store/schema.ts';

/**
 * 일반직 계급 키('1'~'9')를 별표 3 의 열 키로. 계산은 아직 기본 구역(별표 3)만 쓰므로 일반직 계급만 받는다
 * (직종별 계산은 resolveCareer 의 봉급표로 바뀐다 — #20 묶음 3). 그 밖의 값이면 예외.
 */
export function gradeKey(rank: RankKey | null): GradeKey {
  if (rank === null || !GENERAL_RANKS.includes(rank))
    throw new Error(`일반직 계급이 아니라 별표 3 으로 계산할 수 없습니다: ${String(rank)}`);
  return rank as GradeKey;
}

/**
 * 이 버전의 계산이 받는 선택인지: 일반직·별표 3·1~9급만. 저장 형식(v4)은 그 밖의 직종·봉급표·계급(null 포함)도
 * 받지만, 직종별 계산(#20 묶음 3)이 들어오기 전에는 그런 값을 별표 3 으로 계산하면 틀린 숫자가 되거나 예외가 난다.
 * 그래서 저장본·되돌리기 보관본·파일 불러오기의 입구(storage.ts·app.inspect)에서 이 검사로 막고,
 * 계산 입구(salaryOn)에서도 한 번 더 확인한다. 묶음 3 에서 resolveCareer 로 바꾸며 없앤다.
 */
export function calculableHere(sel: {
  track: TrackId;
  payTable: PayTableId | null;
  rank: RankKey | null;
}): boolean {
  return (
    sel.track === 'general' &&
    sel.payTable === 'table3' &&
    sel.rank !== null &&
    GENERAL_RANKS.includes(sel.rank)
  );
}

/**
 * 계산 입구에서 부른다. 직종·봉급표를 보지 않는 gradeKey 가 외무 직무등급('1'~'6')이나
 * 일반직 별표 4·8 을 별표 3 으로 조용히 계산하지 않게, 틀린 숫자 대신 예외를 던진다.
 */
export function assertCalculable(sel: Parameters<typeof calculableHere>[0]): void {
  if (!calculableHere(sel))
    throw new Error(
      `이 버전은 일반직 별표 3 만 계산합니다: ${sel.track}/${String(sel.payTable)}/${String(sel.rank)}`,
    );
}

/** 일반직 계급 키의 직급 수(7급 → 7). 한 직급 위·시보 대상(6급 이하) 같은 비교에 쓴다 */
export function gradeOf(rank: RankKey | null): Grade {
  return Number(gradeKey(rank)) as Grade;
}

export function maxStepOf(salary: SalaryRules, rank: RankKey | null): number {
  return salary.table[gradeKey(rank)].length;
}

/** 봉급표의 월 봉급. 호봉이 표 범위를 벗어나면 가장 가까운 값을 쓴다 */
export function monthlySalary(salary: SalaryRules, rank: RankKey | null, step: number): number {
  const row = salary.table[gradeKey(rank)];
  const index = Math.min(row.length, Math.max(1, Math.floor(step))) - 1;
  return row[index] as number;
}

export interface SalaryPoint {
  date: Ymd;
  rank: RankKey;
  step: number;
  amount: number;
  /** 금액을 가져온 봉급표의 연도 */
  tableYear: number;
  /** date가 속한 해의 봉급표가 확정돼 있는지(아니면 이전 연도 표) */
  confirmed: boolean;
  atMaxStep: boolean;
}

export interface PayProfile extends StepAnchor {
  /** 계산할 수 있는 선택인지 확인하는 데만 쓴다(calculableHere) */
  track: TrackId;
  payTable: PayTableId | null;
  rank: RankKey | null;
  hireDate: Ymd;
}

/** date 시점의 호봉과 봉급(그 해 규정 기준) */
export function salaryOn(rules: RulesProvider, profile: PayProfile, date: Ymd): SalaryPoint {
  assertCalculable(profile);
  const r = rules(yearOf(date));
  const max = maxStepOf(r.salary, profile.rank);
  const step = stepOn(profile, date, max, r.stepRaise.periodMonths);
  return {
    date,
    rank: gradeKey(profile.rank),
    step,
    amount: monthlySalary(r.salary, profile.rank, step),
    tableYear: r.meta.sectionYear.salary,
    confirmed: r.meta.sectionYear.salary === r.year,
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

/** 다음 정기승급(호봉 승급)으로 오르는 봉급. 최고 호봉이면 null */
export function nextStepRaise(
  rules: RulesProvider,
  profile: PayProfile,
  today: Ymd,
): RaiseInfo | null {
  const now = salaryOn(rules, profile, today);
  const r = rules(yearOf(today));
  const date = nextRaiseDate(
    profile,
    today,
    maxStepOf(r.salary, profile.rank),
    r.stepRaise.periodMonths,
  );
  if (!date) return null;
  const after = salaryOn(rules, profile, date);
  // 같은 봉급표 안에서의 차이를 보여준다(연도가 바뀌어도 인상률은 알 수 없으므로).
  const sameTable = rules(now.tableYear).salary;
  const fromAmount = monthlySalary(sameTable, profile.rank, now.step);
  const toAmount = monthlySalary(sameTable, profile.rank, after.step);
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
  table: SalaryRules,
  periodMonths: number,
  profile: PayProfile,
  from: Ymd,
  to: Ymd,
): number {
  if (to < from) return 0;
  const max = maxStepOf(table, profile.rank);
  let total = 0;
  // 승급 구간 [raiseDate(k), raiseDate(k+1)) 을 차례로 돌며, 구간 안에서는 달 단위로 일할계산한다.
  const lastK = raiseIndexOn(profile, to, periodMonths);
  for (let k = raiseIndexOn(profile, from, periodMonths); k <= lastK; k += 1) {
    const segStart = maxYmd(raiseDate(profile, k, periodMonths), from);
    const segEnd = minYmd(addDays(raiseDate(profile, k + 1, periodMonths), -1), to);
    if (segEnd < segStart) continue;
    const step = Math.min(max, Math.max(1, profile.step + k + 1));
    total += monthlySalary(table, profile.rank, step) * monthFraction(segStart, segEnd);
  }
  return total;
}

/**
 * 임용일부터 today까지의 봉급 합계 추정.
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
): CumulativeSalary {
  const r = rules(yearOf(today));
  const total = sumSalary(r.salary, r.stepRaise.periodMonths, profile, profile.hireDate, today);
  return {
    total: Math.floor(total),
    tableYear: r.meta.sectionYear.salary,
    from: profile.hireDate,
    to: today,
  };
}

/** 올해 1월 1일(올해 임용됐으면 임용일)부터 today까지 번 봉급 추정 */
export function yearToDateSalary(rules: RulesProvider, profile: PayProfile, today: Ymd): number {
  const r = rules(yearOf(today));
  const start = maxYmd(formatYmd({ y: yearOf(today), m: 1, d: 1 }), profile.hireDate);
  return Math.floor(sumSalary(r.salary, r.stepRaise.periodMonths, profile, start, today));
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

export function isSalaryPending(rules: Rules): boolean {
  return rules.meta.sectionYear.salary !== rules.year;
}
