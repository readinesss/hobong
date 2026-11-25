/**
 * 오늘의 근무 진행, 퇴근까지 남은 시간, "오늘 번 돈".
 *
 * 금액 모형: 월 봉급을 그 달의 근무일과 하루 근무시간(점심 제외)에 고르게 나눠,
 * 근무시간 동안에만 쌓이는 것으로 본다. 봉급표 기준 추정치이며 실수령액과 다르다.
 */
import { parseHm, todayYmd, parseYmd, formatYmd, type Ymd } from './date.ts';
import type { Calendar } from './calendar.ts';
import type { WorkHoursRules } from '../rules/types.ts';
import type { WorkHours } from '../store/schema.ts';

/** 자정부터의 분 */
export interface WorkSchedule {
  start: number;
  end: number;
  lunchStart: number;
  lunchEnd: number;
}

/** 근무시간 설정이 올바른지. 문제가 없으면 null */
export function checkWorkHours(work: WorkHours): string | null {
  const start = parseHm(work.start);
  const end = parseHm(work.end);
  const lunchStart = parseHm(work.lunchStart);
  const lunchEnd = parseHm(work.lunchEnd);
  if (start === null || end === null || lunchStart === null || lunchEnd === null) {
    return '시각은 09:00 같은 형식으로 넣어 주세요.';
  }
  if (end <= start) return '퇴근 시각은 출근 시각보다 뒤여야 해요.';
  if (lunchEnd < lunchStart) return '점심 끝 시각은 시작 시각보다 뒤여야 해요.';
  const schedule = { start, end, lunchStart, lunchEnd };
  if (workMinutesPerDay(schedule) <= 0) return '근무시간이 0분이에요. 시각을 다시 확인해 주세요.';
  return null;
}

function scheduleOf(work: WorkHours | WorkHoursRules): WorkSchedule | null {
  const start = parseHm(work.start);
  const end = parseHm(work.end);
  const lunchStart = parseHm(work.lunchStart);
  const lunchEnd = parseHm(work.lunchEnd);
  if (start === null || end === null || lunchStart === null || lunchEnd === null) return null;
  if (end <= start || lunchEnd < lunchStart) return null;
  return { start, end, lunchStart, lunchEnd };
}

/** 사용자 설정을 쓰되, 잘못돼 있으면 규정의 기본 근무시간으로 대신한다 */
export function toSchedule(work: WorkHours, fallback: WorkHoursRules): WorkSchedule {
  const own = scheduleOf(work);
  if (own && workMinutesPerDay(own) > 0) return own;
  return scheduleOf(fallback) ?? { start: 540, end: 1080, lunchStart: 720, lunchEnd: 780 };
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function workMinutesPerDay(s: WorkSchedule): number {
  return s.end - s.start - overlap(s.start, s.end, s.lunchStart, s.lunchEnd);
}

/** 하루 중 secondOfDay(0~86400)까지 근무한 초(점심시간 제외) */
export function workedSecondsAt(s: WorkSchedule, secondOfDay: number): number {
  const start = s.start * 60;
  const end = s.end * 60;
  const lunchStart = s.lunchStart * 60;
  const lunchEnd = s.lunchEnd * 60;
  const t = Math.min(Math.max(secondOfDay, start), end);
  return t - start - overlap(start, t, lunchStart, lunchEnd);
}

export type DayPhase = 'off' | 'before' | 'working' | 'lunch' | 'after';

export interface TodayStatus {
  date: Ymd;
  workday: boolean;
  weekend: boolean;
  holidayName: string | null;
  phase: DayPhase;
  workedSeconds: number;
  totalSeconds: number;
  /** 오늘 근무 진행률 0~1(쉬는 날은 0) */
  progress: number;
  /** 출근까지 남은 초(출근 전에만) */
  secondsToStart: number | null;
  /** 퇴근까지 남은 초(근무일의 퇴근 전에만) */
  secondsToEnd: number | null;
  /** 하루 중 지난 비율 0~1(정년 진행률의 소수점용) */
  dayFraction: number;
}

export function secondOfDay(now: Date): number {
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
}

export function todayStatus(cal: Calendar, schedule: WorkSchedule, now: Date): TodayStatus {
  const date = todayYmd(now);
  const sec = secondOfDay(now);
  const workday = cal.isWorkday(date);
  const totalSeconds = workMinutesPerDay(schedule) * 60;
  const base = {
    date,
    workday,
    weekend: cal.isWeekend(date),
    holidayName: cal.holidayName(date),
    totalSeconds,
    dayFraction: sec / 86_400,
  };
  if (!workday) {
    return { ...base, phase: 'off', workedSeconds: 0, progress: 0, secondsToStart: null, secondsToEnd: null };
  }
  const start = schedule.start * 60;
  const end = schedule.end * 60;
  const worked = workedSecondsAt(schedule, sec);
  let phase: DayPhase;
  if (sec < start) phase = 'before';
  else if (sec >= end) phase = 'after';
  else if (sec >= schedule.lunchStart * 60 && sec < schedule.lunchEnd * 60) phase = 'lunch';
  else phase = 'working';
  return {
    ...base,
    phase,
    workedSeconds: worked,
    progress: totalSeconds > 0 ? worked / totalSeconds : 0,
    secondsToStart: phase === 'before' ? start - sec : null,
    secondsToEnd: phase === 'after' ? null : end - sec,
  };
}

export interface Earnings {
  /** 근무 1초당 금액 */
  perSecond: number;
  /** 근무일 하루치 */
  perDay: number;
  /** 오늘 지금까지 */
  today: number;
  /** 이번 달 지금까지 */
  month: number;
  /** 이번 달 근무일 수 */
  workdays: number;
  /** 이번 달에 오늘 전까지 지나간 근무일 수 */
  workdaysDone: number;
}

export function earnings(
  monthlySalary: number,
  cal: Calendar,
  schedule: WorkSchedule,
  now: Date,
): Earnings {
  const date = todayYmd(now);
  const { y, m, d } = parseYmd(date);
  const workdays = cal.workdaysInMonth(y, m);
  const secondsPerDay = workMinutesPerDay(schedule) * 60;
  const perDay = workdays > 0 ? monthlySalary / workdays : 0;
  const perSecond = secondsPerDay > 0 ? perDay / secondsPerDay : 0;
  const workdaysDone = d > 1 ? cal.workdaysBetween(formatYmd({ y, m, d: 1 }), date) : 0;
  const today = cal.isWorkday(date) ? perSecond * workedSecondsAt(schedule, secondOfDay(now)) : 0;
  return { perSecond, perDay, today, month: perDay * workdaysDone + today, workdays, workdaysDone };
}

/** 3725 → '1:02:05', 59 → '0:00:59' */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** 3725 → '1시간 2분', 59 → '1분 미만', 600 → '10분' */
export function formatDurationKo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return '1분 미만';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
