/**
 * 승진소요최저연수, 근속승진, 대우공무원, 승진 시 호봉.
 * 일반직은 공무원임용령 제31조·제35조의4·제35조의5와 임용규칙 제19조·제21조, 다른 직종은 그 직종의 규정
 * (어느 규정인지는 resolveCareer 가 정한다. 여기서는 직종을 가르지 않는다).
 */
import { addDays, onOrNextDayOfMonth, periodCompleteDate, yearOf, type Ymd } from './date.ts';
import type { RulesProvider } from './calendar.ts';
import { careerOf, type CareerProfile } from './career-profile.ts';
import { floorRate } from './money.ts';
import { maxStepOf, monthlySalary, salaryOn, type PayProfile } from './salary.ts';
import { resolveCareer, type CareerRules } from '../rules/career.ts';
import {
  isAvailable,
  type Avail,
  type LadderRank,
  type PromotionStepRules,
  type RankKey,
} from '../rules/types.ts';

/** 계급 기준 규정에서 지금 계급의 개월 수(계급을 모르면 undefined) */
function monthsFor(
  monthsByGrade: Partial<Record<RankKey, number>>,
  c: CareerRules,
): number | undefined {
  return c.rank ? monthsByGrade[c.rank.key] : undefined;
}

/**
 * 승진소요최저연수를 채우는 날. 규정이 꺼져 있거나(준비 중·해당 없음), 지금 계급의 값이 없거나,
 * 바로 위 계급이 없으면 null.
 */
export function minServiceDate(c: CareerRules, rankDate: Ymd): Ymd | null {
  if (!isAvailable(c.minService) || c.nextRank === null) return null;
  const months = monthsFor(c.minService.monthsByGrade, c);
  return months === undefined ? null : periodCompleteDate(rankDate, months);
}

/** 승진소요최저연수 개월 수(화면 문구용). 위 minServiceDate 가 null 이면 null */
export function minServiceMonths(c: CareerRules): number | null {
  if (!isAvailable(c.minService) || c.nextRank === null) return null;
  return monthsFor(c.minService.monthsByGrade, c) ?? null;
}

export interface LongServiceInfo {
  /** 근속승진 대상 계급(일반직 9·8·7급, 경찰 순경~경위 등)인지 */
  applicable: boolean;
  /** 근속승진하면 오르는 계급 */
  targetRank: LadderRank | null;
  requiredMonths: number | null;
  /** 규정으로 계산한 요건 충족일 */
  autoDate: Ymd | null;
  /** 화면에 쓰는 날짜(직접 입력값 우선) */
  date: Ymd | null;
  overridden: boolean;
  /** 요건 충족 N일 전부터 심사 가능(그런 규정이 없으면 null) */
  reviewFrom: Ymd | null;
  /** 인원 제한이 걸리는 목표 계급(일반직 6급, 경찰 경감, 소방 소방경)으로의 근속승진 안내 */
  quotaNote: string | null;
}

const NOT_LONG_SERVICE: LongServiceInfo = {
  applicable: false,
  targetRank: null,
  requiredMonths: null,
  autoDate: null,
  date: null,
  overridden: false,
  reviewFrom: null,
  quotaNote: null,
};

/** 근속승진 요건. 규정이 꺼진 직종은 그 상태(pending·none)를 그대로 돌려준다 */
export function longServiceInfo(
  c: CareerRules,
  profile: Pick<CareerProfile, 'rankDate' | 'overrides'>,
): Avail<LongServiceInfo> {
  const rule = c.longService;
  if (!isAvailable(rule)) return rule;
  const months = monthsFor(rule.monthsByGrade, c);
  if (months === undefined || c.nextRank === null) return NOT_LONG_SERVICE;
  const autoDate = periodCompleteDate(profile.rankDate, months);
  const override = profile.overrides.longServiceDate;
  const date = override ?? autoDate;
  const targetRank = c.nextRank;
  return {
    applicable: true,
    targetRank,
    requiredMonths: months,
    autoDate,
    date,
    overridden: override !== null,
    reviewFrom: rule.reviewLeadDays === null ? null : addDays(date, -rule.reviewLeadDays),
    quotaNote: targetRank.key === rule.quotaTo ? rule.quotaNote : null,
  };
}

export interface SeniorInfo {
  applicable: boolean;
  /** 대우받는 계급(바로 위 계급) */
  targetRank: LadderRank | null;
  requiredMonths: number | null;
  /** 근무기간 요건을 채우는 날 */
  qualifyDate: Ymd | null;
  /** 규정으로 계산한 발령 예정일(요건 충족 뒤 처음 오는 1일) */
  autoDate: Ymd | null;
  date: Ymd | null;
  overridden: boolean;
}

const NOT_SENIOR: SeniorInfo = {
  applicable: false,
  targetRank: null,
  requiredMonths: null,
  qualifyDate: null,
  autoDate: null,
  date: null,
  overridden: false,
};

/** 대우공무원 요건. 규정이 꺼진 직종은 그 상태(pending·none)를 그대로 돌려준다 */
export function seniorTreatmentInfo(
  c: CareerRules,
  profile: Pick<CareerProfile, 'rankDate' | 'overrides'>,
): Avail<SeniorInfo> {
  const rule = c.seniorTreatment;
  if (!isAvailable(rule)) return rule;
  const months = monthsFor(rule.monthsByGrade, c);
  if (months === undefined) return NOT_SENIOR;
  const qualifyDate = periodCompleteDate(profile.rankDate, months);
  const autoDate = onOrNextDayOfMonth(qualifyDate, rule.appointDayOfMonth);
  const override = profile.overrides.seniorDate;
  return {
    applicable: true,
    targetRank: c.nextRank,
    requiredMonths: months,
    qualifyDate,
    autoDate,
    date: override ?? autoDate,
    overridden: override !== null,
  };
}

/**
 * 승진 후 호봉(보수규정 별표 28 가목): 1호봉은 1호봉, 그 밖에는 한 호봉을 뺀다.
 * 승진 후 계급에 그 호봉이 없으면 그 계급의 최고호봉으로 한다(같은 표 비고 1).
 * maxStep 에 승진 후 계급의 최고호봉을 넘기면 그 상한까지 적용한다.
 */
export function promotedStep(rule: PromotionStepRules, step: number, maxStep?: number): number {
  const raw = Math.max(rule.minStep, step - rule.subtract);
  return maxStep !== undefined && rule.capAtMaxStep ? Math.min(maxStep, raw) : raw;
}

export interface PromotionPreview {
  date: Ymd;
  fromRank: LadderRank;
  toRank: LadderRank;
  fromStep: number;
  /** 승진 후 계급의 봉급표 열이 없으면(치안정감 → 치안총감) null */
  toStep: number | null;
  fromAmount: number;
  toAmount: number | null;
  diff: number | null;
  /** toAmount 가 null 인 까닭 */
  toUnavailableReason?: string;
  /** 그 해 봉급표가 확정돼 있는지 */
  confirmed: boolean;
}

/**
 * date에 한 계급 승진한다면의 호봉과 봉급(그 해 봉급표 기준).
 * 다음 계급이 없거나, 승진 시 호봉 규정·봉급이 꺼져 있으면 null.
 * 잔여기간 12개월 이상일 때의 선(先)승급(보수규정 제11조제5항)은 반영하지 않는다.
 */
export function promotionPreview(
  rules: RulesProvider,
  profile: PayProfile,
  date: Ymd,
): PromotionPreview | null {
  const r = rules(yearOf(date));
  const c = careerOf(rules, profile, yearOf(date));
  const fromRank = c.rank;
  const toRank = c.nextRank;
  if (!fromRank || !toRank || !isAvailable(c.promotionStep)) return null;
  const before = salaryOn(rules, profile, date);
  if (!before) return null;
  const toPay = resolveCareer(r, { ...c.sel, rank: toRank.key }).pay;
  if (!isAvailable(toPay)) {
    return {
      date,
      fromRank,
      toRank,
      fromStep: before.step,
      toStep: null,
      fromAmount: before.amount,
      toAmount: null,
      diff: null,
      toUnavailableReason: toPay.reason,
      confirmed: before.confirmed,
    };
  }
  const toStep = promotedStep(c.promotionStep, before.step, maxStepOf(toPay.row));
  const toAmount = monthlySalary(toPay.row, toStep);
  return {
    date,
    fromRank,
    toRank,
    fromStep: before.step,
    toStep,
    fromAmount: before.amount,
    toAmount,
    diff: toAmount - before.amount,
    confirmed: before.confirmed,
  };
}

/**
 * 대우공무원수당 월액 추정(수당규정 제6조의2제1항): 월봉급액의 4.1%.
 * 봉급과 합친 금액이 상위 계급 승진 시 봉급을 넘으면 그 차액만 지급한다.
 * 수당이 꺼진 직종이나 봉급이 없으면 null. 승진 시 봉급을 알 수 없으면 상한 비교 없이 비율대로.
 */
export function seniorAllowance(
  rules: RulesProvider,
  profile: PayProfile,
  date: Ymd,
): number | null {
  const c = careerOf(rules, profile, yearOf(date));
  const rule = c.allowances.seniorTreatment;
  if (!isAvailable(rule)) return null;
  const now = salaryOn(rules, profile, date);
  if (!now) return null;
  const byRate = floorRate(now.amount, rule.rate);
  const preview = promotionPreview(rules, profile, date);
  if (!preview || preview.toAmount === null) return byRate;
  return Math.max(0, Math.min(byRate, preview.toAmount - now.amount));
}
