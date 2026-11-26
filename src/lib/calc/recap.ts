/**
 * 올해 결산과 1년 달력. 화면·카드가 같은 숫자를 쓰도록 한곳에서 센다(DOM·Svelte 의존 없음).
 *
 * - 결산은 그 해 1월 1일(올해 임용이면 임용일)부터 오늘(정년퇴직일이 먼저면 그날)까지만 센다.
 * - 연가는 연가 장부의 기록 그대로다. 오늘 뒤의 기록은 '예정'으로 따로 센다.
 * - 출근 도장은 이 브라우저에서 앱을 연 날이다(출근 여부가 아니다).
 * - 승급은 지금 직급과 기준점(현재 호봉·다음 승급일)에서 거꾸로 셈한 추정이다(직급 이력은 저장하지 않는다).
 * - 정기승급을 계산하지 않는 직종(periodMonths null)은 승급을 세지 않고 입력한 호봉 그대로다.
 * - 정년을 계산하지 않는 직종(retireDate null)은 끝이 없다고 보고, 봉급이 없으면 번 봉급은 null 이다.
 */
import type { AchievementView, Tier } from '../achievements.ts';
import type { Calendar, RulesProvider } from './calendar.ts';
import { addDays, daysInMonth, formatYmd, maxYmd, minYmd, yearOf, type Ymd } from './date.ts';
import { dayLeaveKind, formatLeaveHours, recordsOfYear, type DayLeave } from './leave.ts';
import { careerOf } from './career-profile.ts';
import { yearToDateSalary } from './salary.ts';
import { isRaiseDay, raiseDate, raiseIndexOn, stepOn, type StepAnchor } from './step.ts';
import { isAvailable } from '../rules/types.ts';
import type { LeaveRecord, Profile } from '../store/schema.ts';

export interface RecapBadge {
  id: string;
  title: string;
  icon: string;
  tier: Tier;
  at: Ymd;
}

export interface RecapRaise {
  date: Ymd;
  from: number;
  to: number;
}

export interface RecapLeave {
  /** 결산 기간(오늘까지)에 쓴 시간 */
  usedHours: number;
  /** 오늘 뒤 그 해 안의 예정 시간(결산 숫자에는 넣지 않는다) */
  plannedHours: number;
  /** 하루를 통째로 쉰 날 */
  fullDays: number;
  /** 반일 하나만 쓴 날 */
  halfDays: number;
  /** 그 밖에 시간 연가를 쓴 날 */
  hourDays: number;
  hoursPerDay: number;
}

export interface YearRecap {
  year: number;
  /** 'none': 올해 재직한 날이 없다(지난해 이전에 정년퇴직했거나 아직 임용 전) */
  status: 'none' | 'active';
  /** max(1월 1일, 임용일) */
  from: Ymd;
  /** min(오늘, 정년퇴직일) */
  to: Ymd;
  /** 결산을 낸 날(오늘). 카드의 기간 글('11월까지')은 이 달로 적는다(정년퇴직일을 드러내지 않게) */
  asOf: Ymd;
  hiredThisYear: boolean;
  /** 정년퇴직일이 올해이고 오늘 이전·당일 */
  retiredThisYear: boolean;
  /** from~to 의 근무일(토·일·공휴일 제외, 연가 날도 근무일로 센다) */
  workdays: number;
  /** 그 해 공휴일 데이터가 있는지(없으면 근무일은 주말만 뺀 값) */
  holidaysKnown: boolean;
  leave: RecapLeave;
  /** 결산 기간에 들른 날(출근 도장) */
  visits: number;
  stepFrom: number;
  stepTo: number;
  raises: RecapRaise[];
  /** 결산 기간에 얻은 배지 */
  badges: RecapBadge[];
  /** 올해 번 봉급 추정(지갑의 '올해 번 봉급'과 같은 계산). 'none'이면 0, 봉급을 계산하지 않는 직종은 null */
  earned: number | null;
  /** 계산에 쓴 봉급표 연도(그 해 봉급표가 아직 없으면 이전 연도). 봉급을 계산하지 않는 직종은 null */
  salaryTableYear: number | null;
}

export interface RecapInput {
  today: Ymd;
  profile: Profile;
  /** 정년퇴직일. 정년을 계산하지 않는 직종은 null(끝이 없다고 본다) */
  retireDate: Ymd | null;
  maxStep: number;
  /** 정기승급 기간. 정기승급을 계산하지 않는 직종은 null(호봉이 그대로다) */
  periodMonths: number | null;
  cal: Calendar;
  rules: RulesProvider;
  records: readonly LeaveRecord[];
  hoursPerDay: number;
  visits: readonly Ymd[];
  badges: readonly AchievementView[];
}

/** 손상된 기준점에서도 멈추도록 한 해에 세는 승급의 상한 */
const MAX_RAISES_PER_YEAR = 12;

const jan1Of = (year: number): Ymd => formatYmd({ y: year, m: 1, d: 1 });
const dec31Of = (year: number): Ymd => formatYmd({ y: year, m: 12, d: 31 });
/** 정년이 없을 때의 끝(어떤 날짜보다도 뒤). 문자열 비교에만 쓰고 날짜로 풀지 않는다 */
const NO_END: Ymd = '9999-12-31';

/** date 현재 호봉. 정기승급을 계산하지 않으면 입력한 호봉 그대로 */
function stepAt(anchor: StepAnchor, date: Ymd, maxStep: number, periodMonths: number | null) {
  if (periodMonths === null) return Math.min(maxStep, Math.max(1, Math.floor(anchor.step)));
  return stepOn(anchor, date, maxStep, periodMonths);
}

/** from~to(양끝 포함) 사이에 실제로 호봉이 오르는 날 */
export function raisesBetween(
  profile: Profile,
  from: Ymd,
  to: Ymd,
  maxStep: number,
  periodMonths: number | null,
): RecapRaise[] {
  if (to < from || periodMonths === null) return [];
  const out: RecapRaise[] = [];
  let k = raiseIndexOn(profile, from, periodMonths);
  if (raiseDate(profile, k, periodMonths) < from) k += 1;
  for (let i = 0; i < MAX_RAISES_PER_YEAR; i += 1, k += 1) {
    const date = raiseDate(profile, k, periodMonths);
    if (date > to) break;
    if (!isRaiseDay(profile, date, maxStep, periodMonths)) continue;
    out.push({
      date,
      from: stepOn(profile, addDays(date, -1), maxStep, periodMonths),
      to: stepOn(profile, date, maxStep, periodMonths),
    });
  }
  return out;
}

export function yearRecap(input: RecapInput): YearRecap {
  const { today, profile, maxStep, periodMonths, cal, hoursPerDay } = input;
  const retireDate = input.retireDate ?? NO_END;
  const year = yearOf(today);
  const jan1 = jan1Of(year);
  const from = maxYmd(jan1, profile.hireDate);
  const to = minYmd(today, retireDate);
  const active = from <= to;
  const pay = careerOf(input.rules, profile, year).pay;
  const salaryTableYear = isAvailable(pay) ? pay.tableYear : null;
  const holidaysKnown = cal.hasHolidayData(year);

  const leave: RecapLeave = {
    usedHours: 0,
    plannedHours: 0,
    fullDays: 0,
    halfDays: 0,
    hourDays: 0,
    hoursPerDay,
  };
  if (!active) {
    const step = stepAt(profile, to, maxStep, periodMonths);
    return {
      year,
      status: 'none',
      from,
      to,
      asOf: today,
      hiredThisYear: false,
      retiredThisYear: false,
      workdays: 0,
      holidaysKnown,
      leave,
      visits: 0,
      stepFrom: step,
      stepTo: step,
      raises: [],
      badges: [],
      earned: salaryTableYear === null ? null : 0,
      salaryTableYear,
    };
  }

  // 연가: 날짜별로 묶어 하루 모양을 정한다. 임용 전·정년퇴직일 뒤의 기록은 세지 않는다.
  const lastDay = minYmd(dec31Of(year), retireDate);
  const byDate = new Map<Ymd, LeaveRecord[]>();
  for (const record of recordsOfYear(input.records, year)) {
    if (record.date < from || record.date > lastDay) continue;
    if (record.date > to) {
      leave.plannedHours += record.hours;
      continue;
    }
    leave.usedHours += record.hours;
    const list = byDate.get(record.date);
    if (list) list.push(record);
    else byDate.set(record.date, [record]);
  }
  for (const list of byDate.values()) {
    const kind = dayLeaveKind(list, hoursPerDay);
    if (kind === 'full') leave.fullDays += 1;
    else if (kind === 'am' || kind === 'pm') leave.halfDays += 1;
    else if (kind === 'hours') leave.hourDays += 1;
  }

  const visits = new Set(input.visits.filter((d) => d >= from && d <= to)).size;
  const raises = raisesBetween(profile, from, to, maxStep, periodMonths);
  const stepTo = stepAt(profile, to, maxStep, periodMonths);
  const stepFrom = raises[0]?.from ?? stepAt(profile, from, maxStep, periodMonths);
  const badges: RecapBadge[] = [];
  for (const b of input.badges) {
    if (b.at === null || b.at < jan1 || b.at > to) continue;
    badges.push({ id: b.id, title: b.title, icon: b.icon, tier: b.tier, at: b.at });
  }
  badges.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return {
    year,
    status: 'active',
    from,
    to,
    asOf: today,
    hiredThisYear: profile.hireDate >= jan1,
    retiredThisYear:
      input.retireDate !== null && yearOf(retireDate) === year && retireDate <= today,
    workdays: cal.workdaysBetween(from, addDays(to, 1)),
    holidaysKnown,
    leave,
    visits,
    stepFrom,
    stepTo,
    raises,
    badges,
    earned: yearToDateSalary(input.rules, profile, to),
    salaryTableYear,
  };
}

// ── 1년 달력 ─────────────────────────────────────────────────────────

export interface YearDay {
  date: Ymd;
  month: number;
  day: number;
  weekend: boolean;
  /** 공휴일 이름(일요일 제외) */
  holiday: string | null;
  leave: DayLeave;
  /** 그날 연가 시간 */
  hours: number;
  /** 연가가 오늘 뒤(예정) */
  planned: boolean;
  /** 재직 기간 안에 들른 날(결산의 출근 도장과 같은 기준) */
  visited: boolean;
  /** 이 브라우저에서 앱을 연 날(재직 기간과 상관없이. 앱 안 달력은 이것으로 도장을 찍는다) */
  opened: boolean;
  /** 실제로 호봉이 오르는 날. 오늘 뒤면 예정(future 와 함께 본다) */
  raise: boolean;
  today: boolean;
  future: boolean;
  /** 임용 전·정년퇴직일 뒤 */
  outside: boolean;
}

export type GridInput = Omit<RecapInput, 'badges' | 'rules'>;

/** 그 해의 날마다 한 칸(365·366개). 기록·방문은 미리 묶어 한 번만 돈다 */
export function yearGrid(year: number, input: GridInput): YearDay[] {
  const { today, profile, maxStep, periodMonths, cal, hoursPerDay } = input;
  const retireDate = input.retireDate ?? NO_END;
  const byDate = new Map<Ymd, LeaveRecord[]>();
  for (const record of recordsOfYear(input.records, year)) {
    const list = byDate.get(record.date);
    if (list) list.push(record);
    else byDate.set(record.date, [record]);
  }
  const visits = new Set(input.visits);
  const first = maxYmd(jan1Of(year), profile.hireDate);
  const last = minYmd(dec31Of(year), retireDate);
  const raises = new Set(
    raisesBetween(profile, first, last, maxStep, periodMonths).map((r) => r.date),
  );

  const out: YearDay[] = [];
  for (let m = 1; m <= 12; m += 1) {
    for (let d = 1; d <= daysInMonth(year, m); d += 1) {
      const date = formatYmd({ y: year, m, d });
      const outside = date < profile.hireDate || date > retireDate;
      const records = outside ? undefined : byDate.get(date);
      const leave = records ? dayLeaveKind(records, hoursPerDay) : null;
      out.push({
        date,
        month: m,
        day: d,
        weekend: cal.isWeekend(date),
        holiday: cal.holidayName(date),
        leave,
        hours: records ? records.reduce((sum, r) => sum + r.hours, 0) : 0,
        planned: leave !== null && date > today,
        visited: !outside && visits.has(date),
        opened: visits.has(date),
        raise: raises.has(date),
        today: date === today,
        future: date > today,
        outside,
      });
    }
  }
  return out;
}

export interface MonthSummary {
  month: number;
  /** 그 달에 앱을 연 날(재직 기간과 상관없이) */
  visits: number;
  /** '연가 1일 4시간(3일, 12일 오전, 28일 예정)'. 없으면 '' */
  leaveText: string;
  /** 그 달의 평일·주말 공휴일 이름(같은 이름은 한 번) */
  holidays: string[];
  raise: Ymd | null;
}

function leaveMark(day: YearDay): string {
  const kind =
    day.leave === 'am'
      ? ' 오전'
      : day.leave === 'pm'
        ? ' 오후'
        : day.leave === 'hours'
          ? ` ${day.hours}시간`
          : '';
  return `${day.day}일${kind}${day.planned ? ' 예정' : ''}`;
}

/** 낭독·'달마다 글로 보기'용 달별 요약 */
export function monthSummaries(grid: readonly YearDay[], hoursPerDay: number): MonthSummary[] {
  const out: MonthSummary[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const days = grid.filter((d) => d.month === m);
    const leaveDays = days.filter((d) => d.leave !== null);
    const hours = leaveDays.reduce((sum, d) => sum + d.hours, 0);
    out.push({
      month: m,
      // 앱 안 달력용: 재직 기간 밖에 연 날도 센다(결산 숫자는 yearRecap 의 visits)
      visits: days.filter((d) => d.opened).length,
      leaveText:
        leaveDays.length > 0
          ? `연가 ${formatLeaveHours(hours, hoursPerDay)}(${leaveDays.map(leaveMark).join(', ')})`
          : '',
      holidays: [...new Set(days.flatMap((d) => (d.holiday ? [d.holiday] : [])))],
      raise: days.find((d) => d.raise)?.date ?? null,
    });
  }
  return out;
}

/**
 * 올해 임용했거나 올해 정년퇴직한 결산인지. 이런 결산의 근무일·1년 달력은 재직 기간의 시작·끝을 짐작하게 하므로
 * 카드에서는 기본으로 빼 둔다(사용자가 켜면 넣는다).
 */
export function recapRevealsService(recap: YearRecap): boolean {
  return recap.status === 'active' && (recap.hiredThisYear || recap.retiredThisYear);
}

/** 결산의 연가 한 줄: '12일 4시간'(오늘까지 쓴 것) */
export function recapLeaveText(recap: YearRecap): string {
  return formatLeaveHours(recap.leave.usedHours, recap.leave.hoursPerDay);
}

/** 결산의 승급 한 줄: '4→5호봉'. 올해 오른 적이 없으면 null */
export function recapStepText(recap: YearRecap): string | null {
  return recap.stepTo > recap.stepFrom ? `${recap.stepFrom}→${recap.stepTo}호봉` : null;
}
