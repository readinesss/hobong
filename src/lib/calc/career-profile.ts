/**
 * 계산 함수가 받는 프로필과, 그 해에 적용할 직종 규정(#20 설계 §5.1).
 *
 * 계산 함수는 직종을 가르지 않는다. 연도마다 resolveCareer 결과(CareerRules)를 받아
 * 꺼진 항목(pending·none·external)이면 숫자를 만들지 않고 null 을 돌려준다.
 */
import type { Ymd } from './date.ts';
import type { RulesProvider } from './calendar.ts';
import { stepOn, type StepAnchor } from './step.ts';
import { resolveCareer, type CareerRules, type CareerSel } from '../rules/career.ts';
import { isAvailable, type PayTableId, type RankKey, type TrackId } from '../rules/types.ts';
import { LIMITS } from '../store/schema.ts';

/** 직종·봉급표·계급(resolveCareer 의 입력) */
export interface CareerKey {
  track: TrackId;
  payTable: PayTableId | null;
  rank: RankKey | null;
}

export interface CareerProfile extends StepAnchor, CareerKey {
  hireDate: Ymd;
  rankDate: Ymd;
  birthDate: Ymd;
  overrides: { longServiceDate: Ymd | null; seniorDate: Ymd | null; rankLimitDate: Ymd | null };
}

export function selOf(p: CareerKey): CareerSel {
  return { track: p.track, payTable: p.payTable, rank: p.rank };
}

/** year 년에 이 사람에게 적용할 규정 */
export function careerOf(rules: RulesProvider, p: CareerKey, year: number): CareerRules {
  return resolveCareer(rules(year), selOf(p));
}

/** 봉급표의 최고호봉. 봉급표가 없으면(준비 중 등) null */
export function careerMaxStep(c: CareerRules): number | null {
  return isAvailable(c.pay) ? c.pay.row.length : null;
}

/** 정기승급을 계산하는지(꺼지면 사용자가 넣은 호봉을 그대로 쓴다 — 설계 §5.4) */
export function raisesAutomatically(c: CareerRules): boolean {
  return isAvailable(c.stepRaise);
}

/** 정기승급 기간(개월). 정기승급이 꺼져 있으면 null */
export function raisePeriodOf(c: CareerRules): number | null {
  return isAvailable(c.stepRaise) ? c.stepRaise.periodMonths : null;
}

/**
 * date 현재 호봉. 정기승급이 꺼진 직종은 저장된 호봉 그대로(자동으로 올리지 않는다),
 * 최고호봉을 모르면 저장본 검사와 같은 상한(LIMITS.maxStepAny)을 쓴다(근거 없는 새 상한을 만들지 않는다).
 */
export function careerStepOn(c: CareerRules, anchor: StepAnchor, date: Ymd): number {
  const max = careerMaxStep(c) ?? LIMITS.maxStepAny;
  if (!isAvailable(c.stepRaise)) return Math.min(max, Math.max(1, Math.floor(anchor.step)));
  return stepOn(anchor, date, max, c.stepRaise.periodMonths);
}

/** 호봉 계산에 쓰는 최고호봉(봉급표가 없으면 LIMITS.maxStepAny) */
export function stepCeiling(c: CareerRules): number {
  return careerMaxStep(c) ?? LIMITS.maxStepAny;
}
