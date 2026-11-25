/**
 * 호봉 추이. 사용자가 넣은 "현재 호봉"과 "다음 정기승급일"을 기준점으로,
 * 승급기간(1년)마다 한 호봉씩 오른다고 본다(공무원보수규정 제13조).
 * 휴직·승급제한 같은 예외는 사용자가 다음 승급일을 직접 고쳐서 반영한다.
 */
import { addMonthsClamped, parseYmd, type Ymd } from './date.ts';

export interface StepAnchor {
  /** nextStepDate 전날까지 적용되는 호봉 */
  step: number;
  /** 다음 정기승급일 */
  nextStepDate: Ymd;
}

/** 기준점에서 i번째 승급일(0 = nextStepDate, 음수는 과거로 거슬러 올라감) */
export function raiseDate(anchor: StepAnchor, index: number, periodMonths = 12): Ymd {
  return addMonthsClamped(anchor.nextStepDate, periodMonths * index);
}

/** raiseDate(k) <= date < raiseDate(k+1) 인 k. 기준 승급일 전이면 음수 */
export function raiseIndexOn(anchor: StepAnchor, date: Ymd, periodMonths = 12): number {
  const a = parseYmd(anchor.nextStepDate);
  const b = parseYmd(date);
  let k = Math.floor(((b.y - a.y) * 12 + (b.m - a.m)) / periodMonths);
  while (raiseDate(anchor, k, periodMonths) > date) k -= 1;
  while (raiseDate(anchor, k + 1, periodMonths) <= date) k += 1;
  return k;
}

/** date 현재 호봉(1 이상 maxStep 이하) */
export function stepOn(anchor: StepAnchor, date: Ymd, maxStep: number, periodMonths = 12): number {
  const raw = anchor.step + raiseIndexOn(anchor, date, periodMonths) + 1;
  return Math.min(maxStep, Math.max(1, raw));
}

/** date보다 뒤에 오는 첫 승급일. 이미 최고 호봉이면 null */
export function nextRaiseDate(
  anchor: StepAnchor,
  date: Ymd,
  maxStep: number,
  periodMonths = 12,
): Ymd | null {
  if (stepOn(anchor, date, maxStep, periodMonths) >= maxStep) return null;
  return raiseDate(anchor, raiseIndexOn(anchor, date, periodMonths) + 1, periodMonths);
}

/** date 이전(당일 포함)의 가장 가까운 승급일 */
export function prevRaiseDate(anchor: StepAnchor, date: Ymd, periodMonths = 12): Ymd {
  return raiseDate(anchor, raiseIndexOn(anchor, date, periodMonths), periodMonths);
}

/** date가 승급일이고 실제로 호봉이 오르는 날인지 */
export function isRaiseDay(
  anchor: StepAnchor,
  date: Ymd,
  maxStep: number,
  periodMonths = 12,
): boolean {
  const k = raiseIndexOn(anchor, date, periodMonths);
  if (raiseDate(anchor, k, periodMonths) !== date) return false;
  const raw = anchor.step + k + 1;
  return raw >= 2 && raw <= maxStep;
}
