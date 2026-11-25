/**
 * 징검다리 찾기: 공휴일과 주말 사이에 낀 평일에 연가를 붙이면 며칠을 이어 쉴 수 있는지.
 */
import { addDays, yearOf, type Ymd } from './date.ts';
import type { Calendar } from './calendar.ts';

export interface BridgeSuggestion {
  /** 연가를 쓸 평일(1~2일) */
  leaveDates: Ymd[];
  /** 이어 쉬는 기간(양끝 포함) */
  from: Ymd;
  to: Ymd;
  totalDays: number;
  /** 걸쳐 있는 평일 공휴일 이름 */
  holidayNames: string[];
  /** 이미 연가로 기록해 둔 징검다리인지 */
  alreadyTaken: boolean;
}

interface Block {
  from: Ymd;
  to: Ymd;
  days: number;
  holidays: string[];
}

/**
 * today 다음 날부터 horizonDays 안에서 징검다리를 찾는다.
 * fullDayLeave: 이미 하루 연가로 기록한 날(해당 징검다리에 "등록됨" 표시를 하기 위함).
 */
export function findBridges(
  cal: Calendar,
  today: Ymd,
  fullDayLeave: ReadonlySet<Ymd>,
  horizonDays = 240,
  maxLeaveDays = 2,
): BridgeSuggestion[] {
  const start = addDays(today, 1);
  const isOff = (d: Ymd) => !cal.isWorkday(d);

  // 쉬는 날 덩어리와 그 사이 평일 구간을 차례로 모은다.
  const blocks: Block[] = [];
  const gaps: Ymd[][] = [];
  let cur = start;
  // 시작이 쉬는 날 한가운데면 덩어리의 처음까지 거슬러 올라간다(오늘이 포함돼도 된다).
  while (isOff(addDays(cur, -1)) && cur > addDays(today, -10)) cur = addDays(cur, -1);
  const end = addDays(today, horizonDays);
  let gap: Ymd[] = [];
  while (cur <= end) {
    if (!cal.hasHolidayData(yearOf(cur))) break;
    if (isOff(cur)) {
      const block: Block = { from: cur, to: cur, days: 0, holidays: [] };
      while (isOff(cur) && block.days < 30) {
        const name = cal.holidayName(cur);
        if (name !== null && !cal.isWeekend(cur)) block.holidays.push(name);
        block.to = cur;
        block.days += 1;
        cur = addDays(cur, 1);
      }
      if (blocks.length > 0) gaps.push(gap);
      blocks.push(block);
      gap = [];
    } else {
      gap.push(cur);
      cur = addDays(cur, 1);
    }
  }

  const out: BridgeSuggestion[] = [];
  for (let i = 0; i + 1 < blocks.length; i += 1) {
    const a = blocks[i] as Block;
    const b = blocks[i + 1] as Block;
    const between = gaps[i] as Ymd[];
    if (between.length < 1 || between.length > maxLeaveDays) continue;
    if ((between[0] as Ymd) <= today) continue;
    const holidayNames = [...a.holidays, ...b.holidays];
    if (holidayNames.length === 0) continue;
    out.push({
      leaveDates: between,
      from: a.from,
      to: b.to,
      totalDays: a.days + between.length + b.days,
      holidayNames: [...new Set(holidayNames)],
      alreadyTaken: between.every((d) => fullDayLeave.has(d)),
    });
  }
  return out;
}
