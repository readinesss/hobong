/**
 * 연가 계산 (국가공무원 복무규정 제15조~제17조, 복무·징계 예규 제8장).
 * 장부는 시간 단위(1일 = 8시간)로 다뤄 반일·시간 연가의 소수 오차를 없앤다.
 */
import {
  addDays,
  completedMonths,
  diffDays,
  formatYmd,
  periodCompleteDate,
  yearOf,
  type Ymd,
} from './date.ts';
import type { Calendar } from './calendar.ts';
import { floorRate } from './money.ts';
import type { LeaveRules, MonthTier } from '../rules/types.ts';
import type { LeaveData, LeaveKind, LeaveRecord } from '../store/schema.ts';

export function tierDays(tiers: readonly MonthTier[], months: number): number {
  for (const tier of tiers) {
    if (months >= tier.fromMonths && (tier.toMonths === null || months < tier.toMonths)) {
      return tier.days;
    }
  }
  return 0;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * year년에 실제 근무하는 개월 수(복무규정 제17조제2항: 연도 중 임용되거나 퇴직하는 경우).
 * 임용한 해는 임용일부터, 퇴직하는 해는 퇴직일까지 역(曆)에 따라 세고,
 * 남는 날이 minDaysForMonth일 이상이면 1개월로 친다.
 */
export function serviceMonthsInYear(
  hireDate: Ymd,
  year: number,
  minDaysForMonth: number,
  retireDate?: Ymd,
): number {
  const jan1 = formatYmd({ y: year, m: 1, d: 1 });
  const nextJan1 = formatYmd({ y: year + 1, m: 1, d: 1 });
  const start = hireDate > jan1 ? hireDate : jan1;
  const afterRetire = retireDate !== undefined ? addDays(retireDate, 1) : nextJan1;
  const end = afterRetire < nextJan1 ? afterRetire : nextJan1;
  if (end <= start) return 0;
  let months = completedMonths(start, end);
  const rest = diffDays(periodCompleteDate(start, months), end);
  if (rest >= minDaysForMonth) months += 1;
  return Math.min(12, months);
}

/** 임용한 해에 실제 근무한 개월 수 */
export function firstYearMonths(hireDate: Ymd, minDaysForMonth: number): number {
  return serviceMonthsInYear(hireDate, yearOf(hireDate), minDaysForMonth);
}

/**
 * on 날짜에 쓸 수 있는, 그 해의 연가 일수(자동 계산).
 * - 재직기간은 사용 직전일 기준이라 on 당일에 구간이 바뀌면 바뀐 일수를 쓴다.
 * - 임용한 해와 정년퇴직하는 해에는 근무 개월 수만큼만(반올림) 부여된다.
 * - 가산(유사경력 3일, 성실근무 1~2일)·저축연가·공제는 반영하지 않는다.
 */
export function annualLeaveDays(
  rules: LeaveRules,
  hireDate: Ymd,
  on: Ymd,
  retireDate?: Ymd,
): number {
  if (on < hireDate) return 0;
  if (retireDate !== undefined && on > retireDate) return 0;
  const base = tierDays(rules.annual.tiers, completedMonths(hireDate, on));
  if (base === 0) return 0;
  const worked = serviceMonthsInYear(
    hireDate,
    yearOf(on),
    rules.firstYear.minDaysForMonth,
    retireDate,
  );
  if (worked < 12) return roundHalfUp((base * worked) / 12);
  return base;
}

export interface GrantStep {
  /** 이 날부터 */
  from: Ymd;
  /** 그 해 연가 일수가 이만큼이 된다 */
  days: number;
}

/** 한 해 동안 연가 일수가 바뀌는 시점들(1월 1일 값 포함, 변화가 있을 때만) */
export function grantTimeline(
  rules: LeaveRules,
  hireDate: Ymd,
  year: number,
  retireDate?: Ymd,
): GrantStep[] {
  const jan1 = formatYmd({ y: year, m: 1, d: 1 });
  const dec31 = formatYmd({ y: year, m: 12, d: 31 });
  const candidates = new Set<Ymd>([jan1]);
  for (const tier of rules.annual.tiers) {
    const date = periodCompleteDate(hireDate, tier.fromMonths);
    if (date >= jan1 && date <= dec31) candidates.add(date);
  }
  const steps: GrantStep[] = [];
  for (const date of [...candidates].sort()) {
    const days = annualLeaveDays(rules, hireDate, date, retireDate);
    const last = steps[steps.length - 1];
    if (!last || last.days !== days) steps.push({ from: date, days });
  }
  return steps;
}

export interface LeaveSummary {
  year: number;
  hoursPerDay: number;
  /** 재직기간으로 계산한 오늘 기준 부여 시간 */
  autoHours: number;
  /** 실제 적용하는 부여 시간(직접 수정값 우선) */
  grantedHours: number;
  overridden: boolean;
  /** 올해 안에 부여 일수가 늘어나는 다음 시점(자동 계산일 때만) */
  nextChange: { date: Ymd; hours: number } | null;
  /** 올해 기록 전체(예정 포함) */
  usedHours: number;
  /** 그중 오늘 이후 날짜(예정) */
  plannedHours: number;
  remainingHours: number;
  /** 사용률 0~1(부여가 0이면 0) */
  rate: number;
  /** 월별 사용 시간(1월~12월) */
  byMonth: number[];
  /** 오늘까지의 마지막 사용일 */
  lastUseDate: Ymd | null;
  /** 마지막 사용일(없으면 임용일)부터 지난 일수 */
  daysSinceLastUse: number;
  /** 오늘 연가를 쓴 시간 */
  todayHours: number;
}

export function recordsOfYear(records: readonly LeaveRecord[], year: number): LeaveRecord[] {
  const prefix = `${year}-`;
  return records.filter((r) => r.date.startsWith(prefix));
}

export function summarizeLeave(
  rules: LeaveRules,
  hireDate: Ymd,
  leave: LeaveData,
  today: Ymd,
  retireDate?: Ymd,
): LeaveSummary {
  const year = yearOf(today);
  const hoursPerDay = rules.units.hoursPerDay;
  const autoHours = annualLeaveDays(rules, hireDate, today, retireDate) * hoursPerDay;
  const override = leave.grantOverrideHours[String(year)];
  const overridden = typeof override === 'number';
  const grantedHours = overridden ? override : autoHours;

  let nextChange: LeaveSummary['nextChange'] = null;
  if (!overridden) {
    const upcoming = grantTimeline(rules, hireDate, year, retireDate).find((s) => s.from > today);
    if (upcoming && upcoming.days * hoursPerDay !== autoHours) {
      nextChange = { date: upcoming.from, hours: upcoming.days * hoursPerDay };
    }
  }

  const byMonth = new Array<number>(12).fill(0);
  let usedHours = 0;
  let plannedHours = 0;
  let todayHours = 0;
  for (const record of recordsOfYear(leave.records, year)) {
    usedHours += record.hours;
    const month = Number(record.date.slice(5, 7));
    byMonth[month - 1] = (byMonth[month - 1] as number) + record.hours;
    if (record.date > today) plannedHours += record.hours;
    if (record.date === today) todayHours += record.hours;
  }

  let lastUseDate: Ymd | null = null;
  for (const record of leave.records) {
    if (record.date <= today && (lastUseDate === null || record.date > lastUseDate)) {
      lastUseDate = record.date;
    }
  }

  return {
    year,
    hoursPerDay,
    autoHours,
    grantedHours,
    overridden,
    nextChange,
    usedHours,
    plannedHours,
    remainingHours: grantedHours - usedHours,
    rate: grantedHours > 0 ? usedHours / grantedHours : 0,
    byMonth,
    lastUseDate,
    daysSinceLastUse: Math.max(0, diffDays(lastUseDate ?? hireDate, today)),
    todayHours,
  };
}

/** 96 → '12일', 100 → '12일 4시간', 4 → '4시간', 0 → '0일', -10 → '-1일 2시간' */
export function formatLeaveHours(hours: number, hoursPerDay = 8): string {
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const days = Math.floor(abs / hoursPerDay);
  const rest = abs % hoursPerDay;
  if (days === 0 && rest > 0) return `${sign}${rest}시간`;
  if (rest === 0) return `${sign}${days}일`;
  return `${sign}${days}일 ${rest}시간`;
}

export function kindLabel(kind: LeaveKind, hours: number): string {
  switch (kind) {
    case 'day':
      return '1일';
    case 'am':
      return '오전 반일';
    case 'pm':
      return '오후 반일';
    default:
      return `${hours}시간`;
  }
}

export function hoursOfKind(rules: LeaveRules, kind: LeaveKind, hours: number): number {
  if (kind === 'day') return rules.units.hoursPerDay;
  if (kind === 'am' || kind === 'pm') return rules.units.halfDayHours;
  return hours;
}

export interface NewLeave {
  date: Ymd;
  kind: LeaveKind;
  /** kind가 'hours'일 때만 쓰인다 */
  hours: number;
}

/** 새 기록을 넣을 수 있는지 검사한다. 문제가 없으면 null, 있으면 이유 */
export function checkNewLeave(
  rules: LeaveRules,
  cal: Calendar,
  records: readonly LeaveRecord[],
  hireDate: Ymd,
  entry: NewLeave,
): string | null {
  const perDay = rules.units.hoursPerDay;
  const hours = hoursOfKind(rules, entry.kind, entry.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > perDay) {
    return `시간 연가는 1시간부터 ${perDay}시간까지 넣을 수 있어요.`;
  }
  if (entry.date < hireDate) return '임용일보다 앞선 날짜예요.';
  if (!cal.isWorkday(entry.date)) {
    const name = cal.holidayName(entry.date);
    return name
      ? `${name}은(는) 공휴일이라 연가를 쓰지 않아도 되는 날이에요.`
      : '토요일·일요일은 연가를 쓰지 않아도 되는 날이에요.';
  }
  const sameDay = records.filter((r) => r.date === entry.date);
  if (entry.kind !== 'hours' && sameDay.some((r) => r.kind === entry.kind)) {
    return '같은 날에 같은 종류의 연가가 이미 있어요.';
  }
  const total = sameDay.reduce((sum, r) => sum + r.hours, 0) + hours;
  if (total > perDay)
    return `하루에 ${perDay}시간을 넘길 수 없어요. (이미 ${total - hours}시간 기록됨)`;
  return null;
}

/** from~to(양끝 포함) 사이의 근무일만 골라낸다(여러 날 연가 입력용) */
export function workdaysInRange(cal: Calendar, from: Ymd, to: Ymd, limit = 62): Ymd[] {
  const out: Ymd[] = [];
  for (let cur = from; cur <= to && out.length < limit; cur = addDays(cur, 1)) {
    if (cal.isWorkday(cur)) out.push(cur);
  }
  return out;
}

/** 연가보상비 1일 단가(원 미만 버림): 월봉급액 × 86% ÷ 30 (수당규정 제18조의5) */
export function compensationPerDay(rules: LeaveRules, monthlySalary: number): number {
  const { rate, divisor } = rules.compensation;
  return floorRate(monthlySalary, rate, 1, divisor);
}

/** 다음 재직기간 연가를 미리 쓸 수 있는 최대 일수(복무규정 제16조제6항) */
export function advanceLimitDays(rules: LeaveRules, hireDate: Ymd, on: Ymd): number {
  return tierDays(rules.advance.tiers, completedMonths(hireDate, on));
}
