/** 호봉이의 한마디: 날짜와 상황으로 정해지는 한 줄(같은 조건이면 늘 같은 문장) */
import raw from '../../data/lines.json';
import { dayOfWeek, type Ymd } from './calc/date.ts';
import type { MoodId } from './character/look.ts';

export type LineCategory = keyof typeof raw.lines;

export const LINES: Record<LineCategory, string[]> = raw.lines;

export interface LineContext {
  today: Ymd;
  nickname: string;
  mood: MoodId;
  phase: 'off' | 'before' | 'working' | 'lunch' | 'after';
  /** 현지 시각의 시(0~23) */
  hour: number;
  isPayday: boolean;
  /** 내일이 평일 공휴일인지 */
  holidayTomorrow: boolean;
  /** 오늘이 승급일인지 */
  stepDay: boolean;
  /** 다음 승급까지 남은 일수(없으면 null) */
  daysToStep: number | null;
  /** 오늘이 임용 N주년이면 N */
  anniversaryYears: number | null;
}

/** 문자열 → 0 이상의 정수(FNV-1a). 날짜 시드용 */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fill(template: string, ctx: LineContext, n: number | null): string {
  return template.replaceAll('{nick}', ctx.nickname).replaceAll('{n}', n === null ? '' : String(n));
}

function pick(pool: readonly string[], seed: string): string {
  return pool[hashString(seed) % pool.length] as string;
}

/** 상황에 맞는 문장 묶음과, 그 묶음을 고른 이유(시드에 쓴다) */
export function categoriesFor(ctx: LineContext): {
  categories: LineCategory[];
  slot: string;
  n: number | null;
} {
  if (ctx.stepDay) return { categories: ['stepDay'], slot: 'day', n: null };
  if (ctx.anniversaryYears !== null)
    return { categories: ['anniversary'], slot: 'day', n: ctx.anniversaryYears };
  if (ctx.mood === 'vacation') return { categories: ['vacation'], slot: 'day', n: null };
  if (ctx.mood === 'sleep') return { categories: ['night'], slot: 'night', n: null };
  if (ctx.phase === 'off') return { categories: ['restDay'], slot: 'day', n: null };
  if (ctx.isPayday && ctx.phase !== 'after')
    return { categories: ['payday'], slot: 'day', n: null };
  // 지친 모습일 때도 기본 문장과 섞어, 같은 몇 문장만 되풀이하지 않는다.
  if (ctx.mood === 'tired') return { categories: ['tired', 'default'], slot: 'day', n: null };
  if (ctx.phase === 'after') return { categories: ['afterWork'], slot: 'after', n: null };
  if (ctx.phase === 'lunch') return { categories: ['lunch'], slot: 'lunch', n: null };

  // 평범한 근무일: 시간대·요일·계절 문장을 기본 문장과 섞는다.
  const categories: LineCategory[] = ['default'];
  const month = Number(ctx.today.slice(5, 7));
  const dow = dayOfWeek(ctx.today);
  const morning = ctx.phase === 'before' || ctx.hour < 11;
  if (ctx.holidayTomorrow) categories.push('beforeHoliday');
  else if (dow === 1 && morning) categories.push('monday');
  else if (dow === 5 && !morning) categories.push('friday');
  categories.push(morning ? 'morning' : 'afternoon');
  if (month === 12) categories.push('yearEnd');
  if (month === 1) categories.push('newYear', 'bonusMonth');
  if (month === 7) categories.push('bonusMonth');
  if (month === 9 || month === 10) categories.push('busySeason');
  if (ctx.daysToStep !== null && ctx.daysToStep > 0 && ctx.daysToStep <= 30) {
    return {
      categories: [...categories, 'stepSoon'],
      slot: morning ? 'am' : 'pm',
      n: ctx.daysToStep,
    };
  }
  return { categories, slot: morning ? 'am' : 'pm', n: null };
}

/** 오늘의 한마디 */
export function lineFor(ctx: LineContext): string {
  const { categories, slot, n } = categoriesFor(ctx);
  // 특별한 날의 문장(요일·연휴 전날)이 있으면 그쪽을 먼저 쓴다.
  const special = categories.find((c) => c === 'beforeHoliday' || c === 'monday' || c === 'friday');
  const seed = `${ctx.today}|${slot}`;
  if (special) return fill(pick(LINES[special], seed), ctx, n);
  const pool = categories.flatMap((c) =>
    // {n}이 들어가는 문장은 숫자가 있을 때만 쓴다.
    LINES[c].filter((line) => n !== null || !line.includes('{n}')),
  );
  return fill(pick(pool.length > 0 ? pool : LINES.default, seed), ctx, n);
}

export function welcomeLine(nickname: string): string {
  return (LINES.welcome[0] as string).replaceAll('{nick}', nickname);
}
