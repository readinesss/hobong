/**
 * 공휴일·근무일·보수 지급일 계산.
 * 공휴일 목록은 연도별 규정 데이터에서 온다(일요일은 목록에 없고 요일로 판단).
 */
import { addDays, dayOfWeek, daysInMonth, formatYmd, parseYmd, yearOf, type Ymd } from './date.ts';
import type { Holiday, Rules } from '../rules/types.ts';

export type RulesProvider = (year: number) => Rules;

export interface NamedDay {
  date: Ymd;
  name: string;
}

export class Calendar {
  readonly #rules: RulesProvider;
  readonly #holidayCache = new Map<number, Map<Ymd, Holiday>>();

  constructor(rules: RulesProvider) {
    this.#rules = rules;
  }

  #holidaysOf(year: number): Map<Ymd, Holiday> {
    let map = this.#holidayCache.get(year);
    if (!map) {
      map = new Map();
      for (const item of this.#rules(year).holidays.items) {
        if (yearOf(item.date) === year) map.set(item.date, item);
      }
      this.#holidayCache.set(year, map);
    }
    return map;
  }

  /** 그 해의 공휴일 데이터가 들어 있는지(없으면 주말만 쉬는 날로 계산된다) */
  hasHolidayData(year: number): boolean {
    return this.#holidaysOf(year).size > 0;
  }

  holidaysOf(year: number): Holiday[] {
    return [...this.#holidaysOf(year).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /** 공휴일 이름(일요일 제외). 공휴일이 아니면 null */
  holidayName(date: Ymd): string | null {
    return this.#holidaysOf(yearOf(date)).get(date)?.name ?? null;
  }

  holidayTag(date: Ymd): string | null {
    return this.#holidaysOf(yearOf(date)).get(date)?.tag ?? null;
  }

  isWeekend(date: Ymd): boolean {
    const dow = dayOfWeek(date);
    return dow === 0 || dow === 6;
  }

  /** 관공서 공휴일(일요일 포함) */
  isHoliday(date: Ymd): boolean {
    return dayOfWeek(date) === 0 || this.holidayName(date) !== null;
  }

  /** 근무일: 토요일·일요일·공휴일이 아닌 날 */
  isWorkday(date: Ymd): boolean {
    return !this.isWeekend(date) && this.holidayName(date) === null;
  }

  workdaysInMonth(year: number, month: number): number {
    let count = 0;
    for (let d = 1; d <= daysInMonth(year, month); d += 1) {
      if (this.isWorkday(formatYmd({ y: year, m: month, d }))) count += 1;
    }
    return count;
  }

  /** from(포함)부터 to(제외)까지의 근무일 수 */
  workdaysBetween(from: Ymd, to: Ymd): number {
    let count = 0;
    for (let cur = from; cur < to; cur = addDays(cur, 1)) {
      if (this.isWorkday(cur)) count += 1;
    }
    return count;
  }

  /** from(포함) 이후 처음 오는 평일 공휴일. 데이터가 없는 해에 닿으면 null */
  nextWeekdayHoliday(from: Ymd, maxDays = 400): NamedDay | null {
    let cur = from;
    for (let i = 0; i < maxDays; i += 1) {
      if (!this.hasHolidayData(yearOf(cur))) return null;
      const name = this.holidayName(cur);
      if (name !== null && !this.isWeekend(cur)) return { date: cur, name };
      cur = addDays(cur, 1);
    }
    return null;
  }

  /** tag가 붙은 공휴일 중 from(포함) 이후 처음 오는 날(설날·추석 당일 등) */
  nextTaggedHoliday(
    from: Ymd,
    tags: readonly string[],
    maxYears = 2,
  ): (NamedDay & { tag: string }) | null {
    const startYear = yearOf(from);
    for (let year = startYear; year <= startYear + maxYears; year += 1) {
      for (const item of this.holidaysOf(year)) {
        if (item.tag && tags.includes(item.tag) && item.date >= from) {
          return { date: item.date, name: item.name, tag: item.tag };
        }
      }
    }
    return null;
  }

  /**
   * 그 달의 보수 지급일. 지급일이 토요일이거나 공휴일이면 그 전날(공무원보수규정 제20조제2항).
   * 전날도 토요일·공휴일이면 계속 앞당긴다. 지급일이 그 달에 없으면 말일로 본다.
   */
  payday(year: number, month: number, day: number): Ymd {
    let cur = formatYmd({ y: year, m: month, d: Math.min(day, daysInMonth(year, month)) });
    while (dayOfWeek(cur) === 6 || this.isHoliday(cur)) cur = addDays(cur, -1);
    return cur;
  }

  /** from(포함) 이후 처음 오는 보수 지급일 */
  nextPayday(from: Ymd, day: number): Ymd {
    const { y, m } = parseYmd(from);
    for (let i = 0; i < 3; i += 1) {
      const index = y * 12 + (m - 1) + i;
      const candidate = this.payday(Math.floor(index / 12), (index % 12) + 1, day);
      if (candidate >= from) return candidate;
    }
    throw new Error('보수 지급일을 찾지 못했습니다');
  }

  /** date(포함)에서 시작해 이어지는 쉬는 날(주말·공휴일)의 수. date가 근무일이면 0 */
  restRunFrom(date: Ymd, limit = 30): number {
    let n = 0;
    let cur = date;
    while (n < limit && !this.isWorkday(cur)) {
      n += 1;
      cur = addDays(cur, 1);
    }
    return n;
  }
}
