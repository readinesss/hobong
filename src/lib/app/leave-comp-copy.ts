/**
 * 연가보상비 어림 창(#33 묶음 1)의 문장. 계산은 하지 않고 compensationYear 결과를 글로 옮긴다.
 * - 금액은 이 문장에 넣지 않는다(화면이 Money 부품으로 붙이고, 금액 가리기를 따른다).
 * - '1일 단가'라는 말은 쓰지 않는다. 금액은 늘 일수까지 곱한 합계다(leave-bank.ts).
 */
import { formatMonthDay, type Ymd } from '../calc/date.ts';
import { formatLeaveHours } from '../calc/leave.ts';
import type { MidYearInfo } from '../calc/leave-bank.ts';

/** '6월 30일'(요일 없이) */
export function dayText(date: Ymd): string {
  return formatMonthDay(date, false);
}

/**
 * 6월 30일 기준의 조건 문장.
 * 지난 날: '그날 남은 연가 11일 · 10일 이상이라 받을 수 있는 조건이에요'
 * 오지 않은 날: '6월 30일까지 예정 기록을 넣은 대로라면 그날 남은 연가 12일이에요. 10일 이상이라 …'
 * 조건을 채우지 못하면 근거(cite)를 붙인다.
 */
export function midConditionText(mid: MidYearInfo, hoursPerDay: number, cite: string): string {
  const day = dayText(mid.date);
  if (mid.beforeHire) return `${day}에는 아직 임용 전이라 ${day} 기준은 없어요.`;
  const left = formatLeaveHours(mid.remainingHours, hoursPerDay);
  const need = formatLeaveHours(mid.minRemainingHours, hoursPerDay);
  const verdict = mid.eligible
    ? `${need} 이상이라 받을 수 있는 조건이에요.`
    : `${need} 이상이어야 받을 수 있어요(${cite}).`;
  if (mid.upcoming)
    return `${day}까지 예정 기록을 넣은 대로라면 그날 남은 연가는 ${left}이에요. ${verdict}`;
  return `그날 남은 연가 ${left} · ${verdict}`;
}
