/** 승진소요최저연수, 근속승진, 대우공무원 (공무원임용령 제31조·제35조의4·제35조의5, 임용규칙 제19조·제21조) */
import { addDays, onOrNextDayOfMonth, periodCompleteDate, yearOf, type Ymd } from './date.ts';
import type { RulesProvider } from './calendar.ts';
import { floorRate } from './money.ts';
import { gradeKey, maxStepOf, monthlySalary, salaryOn, type PayProfile } from './salary.ts';
import type { PromotionRules, PromotionStepRules } from '../rules/types.ts';
import type { Grade, Profile } from '../store/schema.ts';

export function higherGrade(grade: Grade): Grade | null {
  return grade > 1 ? ((grade - 1) as Grade) : null;
}

/** 승진소요최저연수를 채우는 날. 규정에 없는 직급이면 null */
export function minServiceDate(rules: PromotionRules, grade: Grade, gradeDate: Ymd): Ymd | null {
  const months = rules.minService.monthsByGrade[gradeKey(grade)];
  return months === undefined ? null : periodCompleteDate(gradeDate, months);
}

export interface LongServiceInfo {
  /** 근속승진 대상 직급(9·8·7급)인지 */
  applicable: boolean;
  targetGrade: Grade | null;
  requiredMonths: number | null;
  /** 규정으로 계산한 요건 충족일 */
  autoDate: Ymd | null;
  /** 화면에 쓰는 날짜(직접 입력값 우선) */
  date: Ymd | null;
  overridden: boolean;
  /** 요건 충족 5일 전부터 심사 가능 */
  reviewFrom: Ymd | null;
  /** 6급으로의 근속승진 인원 제한 안내 */
  quotaNote: string | null;
}

export function longServiceInfo(
  rules: PromotionRules,
  profile: Pick<Profile, 'grade' | 'gradeDate' | 'overrides'>,
): LongServiceInfo {
  const months = rules.longService.monthsByGrade[gradeKey(profile.grade)];
  if (months === undefined) {
    return {
      applicable: false,
      targetGrade: null,
      requiredMonths: null,
      autoDate: null,
      date: null,
      overridden: false,
      reviewFrom: null,
      quotaNote: null,
    };
  }
  const autoDate = periodCompleteDate(profile.gradeDate, months);
  const override = profile.overrides.longServiceDate;
  const date = override ?? autoDate;
  const targetGrade = higherGrade(profile.grade);
  return {
    applicable: true,
    targetGrade,
    requiredMonths: months,
    autoDate,
    date,
    overridden: override !== null,
    reviewFrom: addDays(date, -rules.longService.reviewLeadDays),
    quotaNote: targetGrade === 6 ? rules.longService.quotaNote : null,
  };
}

export interface SeniorInfo {
  applicable: boolean;
  requiredMonths: number | null;
  /** 근무기간 요건을 채우는 날 */
  qualifyDate: Ymd | null;
  /** 규정으로 계산한 발령 예정일(요건 충족 뒤 처음 오는 1일) */
  autoDate: Ymd | null;
  date: Ymd | null;
  overridden: boolean;
}

export function seniorTreatmentInfo(
  rules: PromotionRules,
  profile: Pick<Profile, 'grade' | 'gradeDate' | 'overrides'>,
): SeniorInfo {
  const months = rules.seniorTreatment.monthsByGrade[gradeKey(profile.grade)];
  if (months === undefined) {
    return {
      applicable: false,
      requiredMonths: null,
      qualifyDate: null,
      autoDate: null,
      date: null,
      overridden: false,
    };
  }
  const qualifyDate = periodCompleteDate(profile.gradeDate, months);
  const autoDate = onOrNextDayOfMonth(qualifyDate, rules.seniorTreatment.appointDayOfMonth);
  const override = profile.overrides.seniorDate;
  return {
    applicable: true,
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
  fromGrade: Grade;
  toGrade: Grade;
  fromStep: number;
  toStep: number;
  fromAmount: number;
  toAmount: number;
  diff: number;
  /** 그 해 봉급표가 확정돼 있는지 */
  confirmed: boolean;
}

/**
 * date에 한 직급 승진한다면의 호봉과 봉급(그 해 봉급표 기준).
 * 잔여기간 12개월 이상일 때의 선(先)승급(보수규정 제11조제5항)은 반영하지 않는다.
 */
export function promotionPreview(
  rules: RulesProvider,
  profile: PayProfile,
  date: Ymd,
): PromotionPreview | null {
  const toGrade = higherGrade(profile.grade);
  if (toGrade === null) return null;
  const r = rules(yearOf(date));
  const before = salaryOn(rules, profile, date);
  const toStep = promotedStep(r.promotionStep, before.step, maxStepOf(r.salary, toGrade));
  const toAmount = monthlySalary(r.salary, toGrade, toStep);
  return {
    date,
    fromGrade: profile.grade,
    toGrade,
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
 * 봉급과 합친 금액이 상위 직급 승진 시 봉급을 넘으면 그 차액만 지급한다.
 */
export function seniorAllowance(rules: RulesProvider, profile: PayProfile, date: Ymd): number {
  const r = rules(yearOf(date));
  const now = salaryOn(rules, profile, date);
  const byRate = floorRate(now.amount, r.allowances.seniorTreatment.rate);
  const preview = promotionPreview(rules, profile, date);
  if (!preview) return byRate;
  return Math.max(0, Math.min(byRate, preview.toAmount - now.amount));
}
