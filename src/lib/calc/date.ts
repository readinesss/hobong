/**
 * 날짜 계산의 바탕. 날짜는 시간대가 없는 'YYYY-MM-DD' 문자열(Ymd)로 다룬다.
 *
 * 내부 연산은 UTC 자정 기준 일수로 하므로 서머타임·시간대에 흔들리지 않는다.
 * "오늘"만 사용자의 현지 달력 날짜에서 가져온다(todayYmd).
 */

export type Ymd = string;

export interface DateParts {
  y: number;
  /** 1~12 */
  m: number;
  d: number;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export function isValidYmd(value: unknown): value is Ymd {
  if (typeof value !== 'string') return false;
  const match = YMD_RE.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function parseYmd(value: Ymd): DateParts {
  const match = YMD_RE.exec(value);
  if (!match || !isValidYmd(value)) throw new RangeError(`잘못된 날짜: ${String(value)}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatYmd(parts: DateParts): Ymd {
  return `${pad(parts.y, 4)}-${pad(parts.m)}-${pad(parts.d)}`;
}

export function ymd(y: number, m: number, d: number): Ymd {
  const value = formatYmd({ y, m, d });
  if (!isValidYmd(value)) throw new RangeError(`잘못된 날짜: ${value}`);
  return value;
}

/** 1970-01-01부터의 일수 */
export function toEpochDay(value: Ymd): number {
  const { y, m, d } = parseYmd(value);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromEpochDay(day: number): Ymd {
  const date = new Date(day * MS_PER_DAY);
  return formatYmd({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
}

export function addDays(value: Ymd, days: number): Ymd {
  return fromEpochDay(toEpochDay(value) + days);
}

/** to - from (일). to가 뒤면 양수 */
export function diffDays(from: Ymd, to: Ymd): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** 0=일요일 … 6=토요일 */
export function dayOfWeek(value: Ymd): number {
  return (((toEpochDay(value) + 4) % 7) + 7) % 7;
}

export function compareYmd(a: Ymd, b: Ymd): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minYmd(a: Ymd, b: Ymd): Ymd {
  return a <= b ? a : b;
}

export function maxYmd(a: Ymd, b: Ymd): Ymd {
  return a >= b ? a : b;
}

export function yearOf(value: Ymd): number {
  return parseYmd(value).y;
}

/** 사용자의 현지 달력 기준 오늘 */
export function todayYmd(now: Date): Ymd {
  return formatYmd({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

/** 현지 자정을 가리키는 Date(카운트다운 계산용) */
export function localMidnight(value: Ymd): Date {
  const { y, m, d } = parseYmd(value);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * 달을 더하고, 해당일이 없으면 그 달 말일로 맞춘다(1월 31일 + 1개월 = 2월 말일).
 * 달력 이동·승급일 반복처럼 "같은 날짜"가 필요한 곳에 쓴다.
 */
export function addMonthsClamped(value: Ymd, months: number): Ymd {
  const { y, m, d } = parseYmd(value);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  return formatYmd({ y: ty, m: tm, d: Math.min(d, daysInMonth(ty, tm)) });
}

/**
 * 기산일(start)부터 months개월의 기간이 "지난 다음 날"을 구한다.
 * 즉 "재직 N개월 이상"이 처음으로 참이 되는 날이다.
 *
 * 민법 제160조: 기간은 최후의 월에서 기산일에 해당한 날의 전일로 만료하고,
 * 해당일이 없으면 그 월의 말일로 만료한다. 따라서 해당일이 있으면 그 해당일,
 * 없으면 다음 달 1일이 된다(예: 1월 31일 임용 → 1개월 이상은 3월 1일부터,
 * 2월 29일 임용 → 평년의 1년 이상은 3월 1일부터).
 */
export function periodCompleteDate(start: Ymd, months: number): Ymd {
  const { y, m, d } = parseYmd(start);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  if (d <= daysInMonth(ty, tm)) return formatYmd({ y: ty, m: tm, d });
  const next = index + 1;
  return formatYmd({ y: Math.floor(next / 12), m: (next % 12) + 1, d: 1 });
}

/**
 * start부터 on의 전날까지 채운 온전한 개월 수.
 * (on 당일을 기준으로 "재직 N개월 이상"인 가장 큰 N. start가 on보다 뒤면 0)
 */
export function completedMonths(start: Ymd, on: Ymd): number {
  if (on <= start) return 0;
  const a = parseYmd(start);
  const b = parseYmd(on);
  let n = (b.y - a.y) * 12 + (b.m - a.m);
  if (n < 0) return 0;
  // 추정값 주변만 확인하면 된다.
  while (n > 0 && periodCompleteDate(start, n) > on) n -= 1;
  while (periodCompleteDate(start, n + 1) <= on) n += 1;
  return n;
}

export function completedYears(start: Ymd, on: Ymd): number {
  return Math.floor(completedMonths(start, on) / 12);
}

export interface Span {
  years: number;
  months: number;
  days: number;
}

/** start부터 on의 전날까지의 기간을 연·월·일로(역에 따른 계산) */
export function spanBetween(start: Ymd, on: Ymd): Span {
  if (on <= start) return { years: 0, months: 0, days: 0 };
  const total = completedMonths(start, on);
  const anchor = periodCompleteDate(start, total);
  return {
    years: Math.floor(total / 12),
    months: total % 12,
    days: diffDays(anchor, on),
  };
}

/** 그 달 1일 */
export function startOfMonth(value: Ymd): Ymd {
  const { y, m } = parseYmd(value);
  return formatYmd({ y, m, d: 1 });
}

/** 그 달 말일 */
export function endOfMonth(value: Ymd): Ymd {
  const { y, m } = parseYmd(value);
  return formatYmd({ y, m, d: daysInMonth(y, m) });
}

/** value가 d일이면 그대로, 아니면 그 뒤 처음 오는 d일(다음 달 1일 발령 계산용) */
export function onOrNextDayOfMonth(value: Ymd, dayOfMonth: number): Ymd {
  const { y, m, d } = parseYmd(value);
  if (d === dayOfMonth) return value;
  if (d < dayOfMonth && dayOfMonth <= daysInMonth(y, m)) return formatYmd({ y, m, d: dayOfMonth });
  const index = y * 12 + m; // 다음 달
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  return formatYmd({ y: ty, m: tm, d: Math.min(dayOfMonth, daysInMonth(ty, tm)) });
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function weekdayName(value: Ymd): string {
  return WEEKDAYS[dayOfWeek(value)] as string;
}

/** 2026. 11. 25. (수) */
export function formatKorean(value: Ymd, withWeekday = true): string {
  const { y, m, d } = parseYmd(value);
  return `${y}. ${m}. ${d}.${withWeekday ? ` (${weekdayName(value)})` : ''}`;
}

/** 11월 25일 (수) */
export function formatMonthDay(value: Ymd, withWeekday = true): string {
  const { m, d } = parseYmd(value);
  return `${m}월 ${d}일${withWeekday ? ` (${weekdayName(value)})` : ''}`;
}

/** 'HH:MM' → 자정부터의 분. 형식이 틀리면 null */
export function parseHm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function formatHm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
