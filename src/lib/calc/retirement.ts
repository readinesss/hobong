/** 정년퇴직일 계산 (국가공무원법 제74조) */
import {
  daysInMonth,
  diffDays,
  formatYmd,
  parseYmd,
  periodCompleteDate,
  type Ymd,
} from './date.ts';
import type { RetirementRules } from '../rules/types.ts';

export interface RetirementInfo {
  /** 정년에 이른 날: 정년 나이가 되는 출생일 */
  reachDate: Ymd;
  /** 당연퇴직일 */
  retireDate: Ymd;
}

export function retirementInfo(rules: RetirementRules, birthDate: Ymd): RetirementInfo {
  // 2월 29일생이 평년에 정년에 이르는 드문 경우는 기간 계산 원칙대로 3월 1일로 본다.
  // 어느 쪽이든 1~6월이라 퇴직일은 같다.
  const reachDate = periodCompleteDate(birthDate, rules.age * 12);
  const { y, m } = parseYmd(reachDate);
  const period = rules.periods.find((p) => m >= p.fromMonth && m <= p.toMonth);
  if (!period) throw new Error(`정년 규정에 ${m}월에 해당하는 구간이 없습니다`);
  // 교원(교육공무원법 제47조제2항): 9~12월이면 다음 해 2월 말일
  const year = y + (period.yearOffset ?? 0);
  const day =
    period.retireDay === 'last' ? daysInMonth(year, period.retireMonth) : period.retireDay;
  return { reachDate, retireDate: formatYmd({ y: year, m: period.retireMonth, d: day }) };
}

export interface CareerProgress {
  /** 임용일을 1일째로 센 재직 일수 */
  daysServed: number;
  /** 오늘부터 퇴직일까지 남은 일수(퇴직일 당일이면 0) */
  daysLeft: number;
  /** 임용일~퇴직일 전체 일수 */
  totalDays: number;
  /** 0~1 */
  ratio: number;
  retired: boolean;
}

/**
 * 임용부터 정년까지의 진행 정도.
 * fractionOfToday(0~1)를 주면 오늘 하루가 지난 만큼을 더해 소수점 아래가 움직이게 한다.
 */
export function careerProgress(
  hireDate: Ymd,
  retireDate: Ymd,
  today: Ymd,
  fractionOfToday = 0,
): CareerProgress {
  const totalDays = Math.max(1, diffDays(hireDate, retireDate) + 1);
  const elapsed = diffDays(hireDate, today);
  const daysServed = Math.max(0, elapsed + 1);
  const daysLeft = Math.max(0, diffDays(today, retireDate));
  const retired = today > retireDate;
  const ratio = Math.min(1, Math.max(0, (elapsed + fractionOfToday) / totalDays));
  return {
    daysServed: Math.min(daysServed, totalDays),
    daysLeft,
    totalDays,
    ratio: retired ? 1 : ratio,
    retired,
  };
}
