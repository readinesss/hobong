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
}

export function diligenceRate(tiers: AllowanceRules['diligence']['tiers'], years: number): number {
  for (const tier of tiers) {
    if (tier.underYears === null || years < tier.underYears) return tier.rate;
  }
  return 0;
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

/** year년 month월(1 또는 7)에 받는 정근수당. 대상이 아니면 null */
export function diligenceBonus(
  rules: RulesProvider,
  cal: Calendar,
  profile: PayProfile,
  payday: number,
  year: number,
  month: number,
): BonusEvent | null {
  const r = rules(year);
  const d = r.allowances.diligence;
  if (!d.payMonths.includes(month)) return null;
  const basisDate = formatYmd({ y: year, m: month, d: 1 });
  if (profile.hireDate > basisDate) return null;
  const months = diligencePeriodMonths(d, profile.hireDate, basisDate);
  if (months < 1) return null;
  const years = completedYears(profile.hireDate, basisDate);
  const rate = diligenceRate(d.tiers, years);
  const point = salaryOn(rules, profile, basisDate);
  return {
    kind: 'diligence',
    title: '정근수당',
    date: cal.payday(year, month, payday),
    dateNote: `${month}월 보수 지급일`,
    amount: Math.floor((point.amount * rate * months) / d.periodMonths),
    rate,
    baseSalary: point.amount,
    step: point.step,
    proration: months < d.periodMonths ? { months, of: d.periodMonths } : null,
    years,
    salaryConfirmed: point.confirmed,
  };
}

/** basisDate(설날·추석 당일) 기준 명절휴가비 */
export function holidayBonus(
  rules: RulesProvider,
  profile: PayProfile,
  basisDate: Ymd,
  name: string,
): BonusEvent | null {
  if (profile.hireDate > basisDate) return null;
  const r = rules(yearOf(basisDate));
  const rate = r.allowances.holidayBonus.rate;
  const point = salaryOn(rules, profile, basisDate);
  return {
    kind: 'holiday',
    title: `명절휴가비(${name})`,
    date: basisDate,
    dateNote: `${name} 전후 15일 안에서 기관이 정하는 날`,
    amount: Math.floor(point.amount * rate),
    rate,
    baseSalary: point.amount,
    step: point.step,
    proration: null,
    years: null,
    salaryConfirmed: point.confirmed,
  };
}

/** today 이후(당일 포함)에 다가오는 보너스를 날짜순으로 count개 */
export function upcomingBonuses(
  rules: RulesProvider,
  cal: Calendar,
  profile: PayProfile,
  payday: number,
  today: Ymd,
  count = 3,
): BonusEvent[] {
  const events: BonusEvent[] = [];
  const year = yearOf(today);
  for (const y of [year, year + 1]) {
    for (const month of rules(y).allowances.diligence.payMonths) {
      const event = diligenceBonus(rules, cal, profile, payday, y, month);
      if (event && event.date >= today) events.push(event);
    }
  }
  const tags = rules(year).allowances.holidayBonus.basisTags;
  let from = today;
  for (let i = 0; i < 3; i += 1) {
    const next = cal.nextTaggedHoliday(from, tags);
    if (!next) break;
    const event = holidayBonus(rules, profile, next.date, next.name);
    if (event) events.push(event);
    from = addDays(next.date, 1);
  }
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, count);
}
