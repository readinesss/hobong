/**
 * 정근수당(1·7월)과 명절휴가비(설날·추석) — 공무원수당규정 제7조·별표 2, 제18조의3.
 * 봉급표 기준 추정치다. 징계·휴직 등에 따른 감액과 지급 제외는 반영하지 않는다.
 */
import {
  addDays,
  addMonthsClamped,
  completedMonths,
  completedYears,
  diffDays,
  formatYmd,
  periodCompleteDate,
  yearOf,
  type Ymd,
} from './date.ts';
import type { Calendar, RulesProvider } from './calendar.ts';
import { floorRate } from './money.ts';
import { salaryOn, type PayProfile } from './salary.ts';
import type { AllowanceRules } from '../rules/types.ts';

export interface BonusEvent {
  kind: 'diligence' | 'holiday';
  title: string;
  /** 정근수당: 지급일(보수지급일) / 명절휴가비: 지급기준일(명절 당일) */
  date: Ymd;
  dateNote: string;
  amount: number;
  /** 지급률(0.5 = 50%) */
  rate: number;
  /** 기준이 되는 월봉급액과 그때의 호봉 */
  baseSalary: number;
  step: number;
  /** 신규 임용자의 기간 비례(정근수당) */
  proration: { months: number; of: number } | null;
  /** 근무연수(정근수당) */
  years: number | null;
  /** 기준일이 속한 해의 봉급표가 확정돼 있는지 */
  salaryConfirmed: boolean;
  /** date가 속한 해의 공휴일이 반영돼 있는지(아니면 지급일이 공휴일과 겹칠 수 있다) */
  holidaysKnown: boolean;
}

export function diligenceRate(tiers: AllowanceRules['diligence']['tiers'], years: number): number {
  for (const tier of tiers) {
    if (tier.underYears === null || years < tier.underYears) return tier.rate;
  }
  return 0;
}

/**
 * 정근수당을 받을 자격이 있는지: 지급대상기간 중 봉급이 지급된 기간이 minMonthsToQualify 이상.
 * (제7조제1항 "지급대상기간 중 1개월 이상 봉급이 지급된 공무원". 15일을 1개월로 치는 것은
 *  제2항의 지급액 계산 규정이라 자격 판정에는 쓰지 않는다. 업무지침으로는 확인하지 못한 해석이다.)
 */
export function diligenceQualifies(
  rules: AllowanceRules['diligence'],
  hireDate: Ymd,
  basisDate: Ymd,
): boolean {
  if (hireDate >= basisDate) return false;
  const periodStart = addMonthsClamped(basisDate, -rules.periodMonths);
  if (hireDate <= periodStart) return true;
  return completedMonths(hireDate, basisDate) >= rules.minMonthsToQualify;
}

/** 지급대상기간(기준일 직전 6개월) 중 근무한 개월 수. 15일 이상은 1개월 */
export function diligencePeriodMonths(
  rules: AllowanceRules['diligence'],
  hireDate: Ymd,
  basisDate: Ymd,
): number {
  const periodStart = addMonthsClamped(basisDate, -rules.periodMonths);
  if (hireDate <= periodStart) return rules.periodMonths;
  if (hireDate >= basisDate) return 0;
  let months = completedMonths(hireDate, basisDate);
  const rest = diffDays(periodCompleteDate(hireDate, months), basisDate);
  if (rest >= rules.minDaysForMonth) months += 1;
  return Math.min(rules.periodMonths, months);
}

/**
 * year년 month월(1 또는 7)에 받는 정근수당. 대상이 아니면 null.
 * until(정년퇴직일)이 기준일(그 달 1일)보다 앞이면 그날 공무원 신분이 아니므로 대상이 아니다.
 */
export function diligenceBonus(
  rules: RulesProvider,
  cal: Calendar,
  profile: PayProfile,
  payday: number,
  year: number,
  month: number,
  until?: Ymd,
): BonusEvent | null {
  const r = rules(year);
  const d = r.allowances.diligence;
  if (!d.payMonths.includes(month)) return null;
  const basisDate = formatYmd({ y: year, m: month, d: 1 });
  if (profile.hireDate > basisDate) return null;
  if (until !== undefined && basisDate > until) return null;
  if (!diligenceQualifies(d, profile.hireDate, basisDate)) return null;
  const months = diligencePeriodMonths(d, profile.hireDate, basisDate);
  if (months < 1) return null;
  const years = completedYears(profile.hireDate, basisDate);
  const rate = diligenceRate(d.tiers, years);
  const point = salaryOn(rules, profile, basisDate);
  const date = cal.payday(year, month, payday);
  return {
    kind: 'diligence',
    title: '정근수당',
    date,
    dateNote: `${month}월 보수 지급일`,
    amount: floorRate(point.amount, rate, months, d.periodMonths),
    rate,
    baseSalary: point.amount,
    step: point.step,
    proration: months < d.periodMonths ? { months, of: d.periodMonths } : null,
    years,
    salaryConfirmed: point.confirmed,
    holidaysKnown: cal.hasHolidayData(yearOf(date)),
  };
}

/** basisDate(설날·추석 당일) 기준 명절휴가비. 기준일에 재직 중이 아니면 null */
export function holidayBonus(
  rules: RulesProvider,
  profile: PayProfile,
  basisDate: Ymd,
  name: string,
  until?: Ymd,
): BonusEvent | null {
  if (profile.hireDate > basisDate) return null;
  if (until !== undefined && basisDate > until) return null;
  const r = rules(yearOf(basisDate));
  const rate = r.allowances.holidayBonus.rate;
  const point = salaryOn(rules, profile, basisDate);
  return {
    kind: 'holiday',
    title: `명절휴가비(${name})`,
    date: basisDate,
    dateNote: `${name} 전후 15일 안에서 기관이 정하는 날`,
    amount: floorRate(point.amount, rate),
    rate,
    baseSalary: point.amount,
    step: point.step,
    proration: null,
    years: null,
    salaryConfirmed: point.confirmed,
    // 명절 날짜 자체가 공휴일 데이터에서 온다
    holidaysKnown: true,
  };
}

/**
 * today 이후(당일 포함)에 다가오는 보너스를 날짜순으로 count개.
 * until(정년퇴직일) 뒤가 기준일인 것은 넣지 않는다.
 */
export function upcomingBonuses(
  rules: RulesProvider,
  cal: Calendar,
  profile: PayProfile,
  payday: number,
  today: Ymd,
  count = 3,
  until?: Ymd,
): BonusEvent[] {
  const events: BonusEvent[] = [];
  const year = yearOf(today);
  for (const y of [year, year + 1]) {
    for (const month of rules(y).allowances.diligence.payMonths) {
      const event = diligenceBonus(rules, cal, profile, payday, y, month, until);
      if (event && event.date >= today) events.push(event);
    }
  }
  const tags = rules(year).allowances.holidayBonus.basisTags;
  let from = today;
  for (let i = 0; i < 3; i += 1) {
    const next = cal.nextTaggedHoliday(from, tags);
    if (!next) break;
    const event = holidayBonus(rules, profile, next.date, next.name, until);
    if (event) events.push(event);
    from = addDays(next.date, 1);
  }
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, count);
}

/**
 * 다가오는 보너스 목록에서 빠졌을 수 있는 해: 명절휴가비는 공휴일 데이터에서 명절 날짜를
 * 읽으므로, 데이터가 없는 해의 설날·추석은 목록에 나오지 않는다. today부터 한 해 안에
 * 그런 해가 있으면 그 연도를 돌려준다(없으면 null).
 */
export function missingHolidayYearForBonuses(cal: Calendar, today: Ymd): number | null {
  const year = yearOf(today);
  if (!cal.hasHolidayData(year)) return year;
  // 하반기에는 다음 해 설날이 다가오는 보너스 범위에 든다.
  const half = formatYmd({ y: year, m: 7, d: 1 });
  if (today >= half && !cal.hasHolidayData(year + 1)) return year + 1;
  return null;
}
