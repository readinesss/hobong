/** 화면 표시용 서식 */
import { diffDays, formatMonthDay, parseYmd, type Ymd } from '../calc/date.ts';

const WON = new Intl.NumberFormat('ko-KR');

/** 2133000 → '2,133,000' */
export function formatNumber(value: number): string {
  return WON.format(Math.round(value));
}

/** 2133000 → '2,133,000원' */
export function formatWon(value: number): string {
  return `${WON.format(Math.floor(value))}원`;
}

/** 금액 가리기용 표시 */
export const MASKED_WON = '●●●,●●●원';

/** 2133000 → '213만 원', 123456789 → '1억 2,345만 원' (큰 금액을 읽기 쉽게) */
export function formatWonShort(value: number): string {
  const man = Math.floor(value / 10_000);
  if (man < 1) return formatWon(value);
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (eok === 0) return `${WON.format(rest)}만 원`;
  return rest === 0 ? `${eok}억 원` : `${eok}억 ${WON.format(rest)}만 원`;
}

/** D-day 표기: 오늘이면 'D-DAY', 미래 'D-12', 과거 'D+3' */
export function formatDday(today: Ymd, target: Ymd): string {
  const diff = diffDays(today, target);
  if (diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${WON.format(diff)}` : `D+${WON.format(-diff)}`;
}

/** 0.31284 → '31.28%' */
export function formatPercent(ratio: number, digits = 0): string {
  return `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(digits)}%`;
}

/** 채워진 칸과 빈 칸으로 그린 글자 막대: ■■■□□ */
export function textBar(ratio: number, cells = 10): string {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * cells);
  return '■'.repeat(filled) + '□'.repeat(cells - filled);
}

/** 7년 3개월 2일 같은 기간 표기(0인 단위는 생략) */
export function formatSpan(span: { years: number; months: number; days: number }): string {
  const parts: string[] = [];
  if (span.years > 0) parts.push(`${span.years}년`);
  if (span.months > 0) parts.push(`${span.months}개월`);
  if (span.days > 0 || parts.length === 0) parts.push(`${span.days}일`);
  return parts.join(' ');
}

/** ISO 시각 → '2026. 11. 25. 10:03' (현지 시각) */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 월별 연가 창의 설명 한 줄. 한 번도 쓰지 않았으면 '1월'을 찍지 않는다.
 * 가장 많이 쓴 달이 여럿이면 모두 말한다: '1월·5월·8월이 가장 많아요(각 1일).'
 */
export function busiestMonthText(byMonth: readonly number[], hoursPerDay = 8): string {
  const max = Math.max(0, ...byMonth);
  if (max === 0) return '단위: 일. 올해는 아직 쓴 연가가 없어요.';
  const months = byMonth.flatMap((h, i) => (h === max ? [`${i + 1}월`] : []));
  const amount = formatDaysAmount(max, hoursPerDay);
  if (months.length === 1) return `단위: 일. 가장 많이 쓴 달은 ${months[0]}이에요(${amount}).`;
  return `단위: 일. ${months.join('·')}이 가장 많아요(각 ${amount}).`;
}

/** 월별 막대 위의 값: 1일 미만은 '2시간', 그 밖은 내림 소수 한 자리 일수('1.5') */
export function formatMonthBarValue(hours: number, hoursPerDay = 8): string {
  if (hours <= 0) return '';
  if (hours < hoursPerDay) return `${hours}시간`;
  if (hours % hoursPerDay === 0) return String(hours / hoursPerDay);
  return String(Math.floor((hours / hoursPerDay) * 10) / 10);
}

/** 시간 → '1일', '2일 4시간', '2시간' */
function formatDaysAmount(hours: number, hoursPerDay: number): string {
  const days = Math.floor(hours / hoursPerDay);
  const rest = hours % hoursPerDay;
  if (days === 0) return `${rest}시간`;
  return rest === 0 ? `${days}일` : `${days}일 ${rest}시간`;
}

/** 2027-09-01 → '2027년 9월 1일' */
export function formatLongDate(value: Ymd): string {
  const { y, m, d } = parseYmd(value);
  return `${y}년 ${m}월 ${d}일`;
}

/** 오늘과 같은 해면 '5월 1일 (토)', 다른 해면 '2027년 5월 1일 (토)' */
export function formatMonthDayMaybeYear(value: Ymd, today: Ymd, withWeekday = true): string {
  const y = parseYmd(value).y;
  const md = formatMonthDay(value, withWeekday);
  return y === parseYmd(today).y ? md : `${y}년 ${md}`;
}

/**
 * 받침에 따라 조사를 고른다: josa('넥타이', '은', '는') → '넥타이는', josa('반짝이', '이', '가') → '반짝이가'.
 * 한글이 아닌 글자로 끝나면 받침 없는 쪽을 쓴다(숫자는 읽는 소리로 본다).
 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.trim().at(-1) ?? '';
  const code = last.charCodeAt(0);
  let hasFinal = false;
  if (code >= 0xac00 && code <= 0xd7a3) hasFinal = (code - 0xac00) % 28 !== 0;
  else if (/[0-9]/.test(last)) hasFinal = '013678'.includes(last);
  return `${word}${hasFinal ? withFinal : withoutFinal}`;
}
