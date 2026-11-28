/**
 * 저축연가 통장·연말 정리(#33 묶음 2)의 문장. 계산은 하지 않고 leave-bank.ts 의 결과를 글로 옮긴다.
 * 저축연가는 '참고용 장부'다 — 공식 기록은 기관 인사시스템이 기준이다(화면이 밝힌다).
 */
import { parseYmd, type Ymd } from '../calc/date.ts';
import { formatLeaveHours } from '../calc/leave.ts';
import type { SavingsShortage } from '../calc/leave-bank.ts';
import type { SavingsEntry } from '../store/schema.ts';
import { dayText } from './leave-comp-copy.ts';

/** '2027년 1월 1일' */
export function fullDayText(date: Ymd): string {
  const { y, m, d } = parseYmd(date);
  return `${y}년 ${m}월 ${d}일`;
}

/** 통장 한 줄의 이름: '2024년까지 모아 둔 연가(처음 넣음)' · '2025년 말 저축' · '2026년 3월 시간외근무 저축' */
export function lotTitle(entry: Pick<SavingsEntry, 'kind' | 'year' | 'month'>): string {
  if (entry.kind === 'opening') return `${entry.year}년까지 모아 둔 연가(처음 넣음)`;
  if (entry.kind === 'carry') return `${entry.year}년 말 저축`;
  const month = entry.month ? Number(entry.month.slice(5, 7)) : 0;
  return `${entry.year}년 ${month}월 시간외근무 저축`;
}

/** 아직 쓸 수 없는 묶음: '2027년 1월 1일부터 쓸 수 있어요' */
export function fromText(from: Ymd): string {
  return `${fullDayText(from)}부터 쓸 수 있어요`;
}

/** 모자란 기록: '3월 20일 기록에 쓸 저축연가가 9시간 모자라요.' */
export function shortageText(s: SavingsShortage, hoursPerDay: number, today: Ymd): string {
  const when = s.date.slice(0, 4) === today.slice(0, 4) ? dayText(s.date) : fullDayText(s.date);
  return `${when} 기록에 쓸 저축연가가 ${formatLeaveHours(s.missingHours, hoursPerDay)} 모자라요.`;
}
