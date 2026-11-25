/**
 * 호봉 추이. 사용자가 넣은 "현재 호봉"과 "다음 정기승급일"을 기준점으로,
 * 승급기간(1년)마다 한 호봉씩 오른다고 본다(공무원보수규정 제13조).
 * 휴직·승급제한 같은 예외는 사용자가 다음 승급일을 직접 고쳐서 반영한다.
 *
 * 다음 승급일이 승급기간보다 멀리 있을 수 있다(휴직·승급제한으로 미뤄진 경우).
 * 그때는 "호봉을 확인한 날(stepAsOf)부터 다음 승급일 전날까지"가 통째로 지금 호봉이다.
 * 지금 호봉이 시작된 날은 다음 승급일에서 승급기간 단위로 거슬러 올라가
 * 확인한 날 이전에 처음 닿는 날로 어림하고, 그보다 과거는 다시 한 해에 한 호봉씩 내려간다.
 */
import { addMonthsClamped, parseYmd, type Ymd } from './date.ts';

export interface StepAnchor {
  /** stepAsOf 부터 nextStepDate 전날까지 적용되는 호봉 */
  step: number;
  /** 다음 정기승급일 */
  nextStepDate: Ymd;
  /**
   * 이 호봉을 확인(입력)한 날. 없으면 다음 승급일 직전 한 승급기간만 이 호봉이라고 본다.
   * 다음 승급일이 승급기간보다 멀 때 지금 호봉을 낮춰 계산하지 않기 위해 쓴다.
   */
  stepAsOf?: Ymd | undefined;
}

/**
 * 지금 호봉이 승급기간보다 얼마나 길게 이어지는지(승급기간 단위, 0 = 보통의 경우).
 * 다음 승급일에서 승급기간씩 거슬러 올라가 stepAsOf 이전에 처음 닿을 때까지의 횟수 - 1.
 */
export function stretchPeriods(anchor: StepAnchor, periodMonths = 12): number {
  const asOf = anchor.stepAsOf;
  if (!asOf || asOf >= anchor.nextStepDate) return 0;
  let n = 1;
  // 입력 검증이 다음 승급일을 몇 해 안으로 묶지만, 손상된 값에서도 멈추도록 상한을 둔다.
  while (n < 100 && addMonthsClamped(anchor.nextStepDate, -periodMonths * n) > asOf) n += 1;
  return n - 1;
}

/**
 * 기준점에서 i번째 승급일(0 = nextStepDate, 음수는 과거로 거슬러 올라감).
 * -1 은 지금 호봉이 시작된 날이다.
 */
export function raiseDate(anchor: StepAnchor, index: number, periodMonths = 12): Ymd {
  const shift = index < 0 ? stretchPeriods(anchor, periodMonths) : 0;
  return addMonthsClamped(anchor.nextStepDate, periodMonths * (index - shift));
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

/** 기준점대로라면 step 호봉이 된 날(기준점의 호봉보다 낮거나 같은 호봉이면 과거 날짜) */
export function dateReachedStep(anchor: StepAnchor, step: number, periodMonths = 12): Ymd {
  return raiseDate(anchor, step - anchor.step - 1, periodMonths);
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
