/**
 * 연가보상비 어림(#33 묶음 1) — 공무원수당 등에 관한 규정 제18조의5, 국가공무원 복무규정 제16조제5항,
 * 공무원보수 등의 업무지침 제7장 Ⅶ. 3. 연가보상비, 국고금 관리법 제47조제1항.
 *
 * - 금액은 늘 일수까지 곱한 뒤 한 번 버린다: floor(floor(월봉급 × 86% × 일수 ÷ 30) ÷ 10) × 10.
 *   어떤 단가(원 단위 89,821원도, 1일분 지급액 89,820원도)를 먼저 버리고 일수를 곱하지 않는다 — 업무지침 예시
 *   (3,133,300원 × 86% × 1/30 × 5 = 449,100원)와 어긋난다. 그래서 '1일 단가'는 만들지 않는다.
 * - 장부의 시간은 정수 시간(1일 = units.hoursPerDay). 계산 함수는 직종을 가르지 않고 resolveCareer 결과만 본다.
 * - 저장하는 값은 없다. 상반기 지급 여부·보상 일수는 화면이 넘기는 plan(묶음 2부터는 저장된 그 해 값)으로 받는다.
 */
import { addDays, formatYmd, yearOf, type Ymd } from './date.ts';
import type { RulesProvider } from './calendar.ts';
import { careerOf } from './career-profile.ts';
import { annualLeaveDays, type LeaveRulesLike } from './leave.ts';
import { floorRate } from './money.ts';
import { salaryOn, type PayProfile, type SalaryPoint } from './salary.ts';
import { isAvailable, type LeaveCompensationRules, type LeaveSavingRules } from '../rules/types.ts';
import type { LeaveData, LeaveRecord, LeaveYearPlan, SavingsEntry } from '../store/schema.ts';

/**
 * 연가보상비 금액: 월봉급액 × rate × days ÷ divisor 를 원 미만 버린 뒤 roundTo 원 미만 버림.
 * 보상비가 없거나(교원) 준비 중인 직종은 null. 일수가 0 이하면 0.
 */
export function compensationAmount(
  rules: Pick<LeaveRulesLike, 'compensation'>,
  monthly: number,
  days: number,
): number | null {
  if (!isAvailable(rules.compensation)) return null;
  if (days <= 0) return 0;
  const { rate, divisor, roundTo } = rules.compensation;
  const won = floorRate(monthly, rate, days, divisor);
  return Math.floor(won / roundTo) * roundTo;
}

/**
 * 연가보상일수(업무지침 다.5) 방법 ①): 산정된 연가일수 − 사용한 연가일수, maxDays(20일) 이내.
 * 8시간 미만의 끝자리는 보상하지 않는다(일 단위). 남은 시간이 0 이하(미리 쓴 연가 등)면 0.
 */
export function compensableDays(
  rule: Pick<LeaveCompensationRules, 'maxDays'>,
  grantedHours: number,
  usedHours: number,
  hoursPerDay: number,
): number {
  const days = Math.floor((grantedHours - usedHours) / hoursPerDay);
  return Math.max(0, Math.min(rule.maxDays, days));
}

/** 화면(묶음 1) 또는 저장된 그 해 값(묶음 2, leave.years[Y])에서 받는 사용자의 선택 */
export type CompPlan = Partial<LeaveYearPlan>;

/** 한 기준일의 연가 장부(부여 − 그날까지 올해 연가에서 쓴 시간) */
export interface CompLedger {
  grantedHours: number;
  usedHours: number;
  remainingHours: number;
}

export interface MidYearInfo extends CompLedger {
  /** 'YYYY-06-30' */
  date: Ymd;
  /** 그날이 아직 오지 않았다(그날까지의 예정 기록을 넣은 대로 셈했다) */
  upcoming: boolean;
  /** 그날 아직 임용 전이다(6월 30일 기준이 없다) */
  beforeHire: boolean;
  /** 받을 수 있는 남은 시간의 하한(minRemainingDays × 하루 시간) */
  minRemainingHours: number;
  /** 그날 남은 연가가 하한 이상이다(받을 수 있는 조건. 기관이 하지 않을 수도 있다) */
  eligible: boolean;
  /** eligible 이면 규정의 일수(5), 아니면 0 */
  days: number;
  /** 규정의 일수(5) — '받았어요'를 골랐을 때 뺄 몫의 일수 */
  ruleDays: number;
  salary: SalaryPoint | null;
  /** days 일분 금액. 봉급이 꺼져 있으면 null */
  amount: number | null;
}

export interface YearEndInfo extends CompLedger {
  /** 'YYYY-12-31'(정년퇴직일이 7월 1일~12월 30일이면 그날) */
  date: Ymd;
  /** 봉급을 보는 날: 12월 31일, 그 해 퇴직하면 퇴직일 전날(수당규정 제18조의5제2항 — 12월 31일 퇴직도 12월 30일) */
  salaryDate: Ymd;
  /** 그 해 직접 고친 부여 시간이 자동 계산 값보다 크다(저축연가를 부여에 더해 두었을 수 있다 — 어림이 실제보다 클 수 있다) */
  overrideAboveAuto: boolean;
  /** 7월 1일~12월 31일에 정년퇴직한다(기관이 상반기 보상에서 뺄 수 있다 — 업무지침 가.4) ④) */
  retiringSecondHalf: boolean;
  /** 7월 1일~12월 31일 중의 정년퇴직일(없으면 null) */
  retireDate: Ymd | null;
  /** 보상받을 수 있는 최대 일수: min(남은 일수, 규정 상한 20, 넣은 기관 한도, 부여 − 보상하지 않는 일수) − 저축한 날 */
  maxDays: number;
  /** 그 해 말 저축(carry) 칸이 가져간 날(일 단위, 8시간 미만 끝자리는 빼고). 보상 상한에서 뺐다 */
  carryDays: number;
  /** 셈에 쓴 일수(plan.compDays 가 없으면 maxDays — '최대로 보면') */
  chosenDays: number;
  /** plan.compDays 를 고르지 않아 최대로 셈했다 */
  usedMax: boolean;
  /** plan.compDays 가 maxDays 보다 커서 잘랐다 */
  clamped: boolean;
  salary: SalaryPoint | null;
  /** chosenDays 일분 금액(봉급이 꺼져 있으면 null) */
  total: number | null;
  /** 6월 30일 기준으로 받았다고 본 금액: '받지 않았어요' 0, '받았어요' 규정 일수분, 모르면 조건을 채울 때 그 금액 */
  midPaid: number | null;
  /** total − midPaid. 음수면 돌려낸다(환수 — 업무지침 다.1)나) *) */
  net: number | null;
}

export interface CompYear {
  kind: 'year';
  year: number;
  hoursPerDay: number;
  rule: LeaveCompensationRules;
  mid: MidYearInfo;
  end: YearEndInfo;
}

/** 6월 30일 이전에 정년퇴직하는 해(수당규정 제18조의5제4항제1호): 퇴직일 전날 봉급 × … × 보상일수(10일 이내) */
export interface CompRetire extends CompLedger {
  kind: 'retire';
  year: number;
  hoursPerDay: number;
  rule: LeaveCompensationRules;
  retireDate: Ymd;
  salaryDate: Ymd;
  overrideAboveAuto: boolean;
  /** min(남은 일수, 20, 퇴직 상한 10, 넣은 기관 한도) − 저축한 날 */
  maxDays: number;
  carryDays: number;
  chosenDays: number;
  usedMax: boolean;
  clamped: boolean;
  salary: SalaryPoint | null;
  total: number | null;
}

/** 연가 일수를 계산하지 않는 직종에서 올해 부여 일수를 아직 넣지 않았다(셀 수 없다) */
export interface CompNeedsGrant {
  kind: 'needsGrant';
  year: number;
  rule: LeaveCompensationRules;
}

export type CompensationYear = CompYear | CompRetire | CompNeedsGrant;

export interface CompensationYearInput {
  rules: RulesProvider;
  profile: PayProfile;
  leave: LeaveData;
  year: number;
  today: Ymd;
  /** 정년퇴직일(정년을 계산하지 않는 직종은 undefined) */
  retireDate?: Ymd;
  plan?: CompPlan | null;
  /**
   * 그 해 말 저축(carry) 칸이 가져간 날을 보상 상한에서 빼지 않는다(연말 정리 대화상자가 저축을 다시 정할 때).
   * 빼지 않으면 같은 남은 연가에서 보상과 저축을 겹쳐 셈하게 된다.
   */
  excludeCarry?: boolean;
}

/** 올해 연가에서 쓴 기록(저축연가에서 쓴 기록은 빼고) 중 year 년 1월 1일 ~ until 의 시간 */
function usedAnnualHours(records: readonly LeaveRecord[], year: number, until: Ymd): number {
  const from = formatYmd({ y: year, m: 1, d: 1 });
  let sum = 0;
  for (const r of records) {
    if (r.pool === 'saved') continue;
    if (r.date >= from && r.date <= until) sum += r.hours;
  }
  return sum;
}

/**
 * year 년의 연가보상비 어림. 보상비가 없거나(교원) 준비 중인 직종, 그 해에 재직하지 않으면 null.
 * - 6월 30일 이전 정년퇴직하는 해: kind 'retire' 하나.
 * - 연가 일수를 계산하지 않는 직종이고 그 해 부여를 넣지 않았으면: kind 'needsGrant'.
 * - 그 밖: 6월 30일 기준(mid)과 12월 31일 기준(end).
 * 부여는 그 해 직접 고친 값이 있으면 그 값(한 해 하나뿐이라 6월 30일에도 같은 값), 없으면 그날의 자동 계산.
 */
export function compensationYear(input: CompensationYearInput): CompensationYear | null {
  const { rules, profile, leave, year, today, retireDate } = input;
  const plan = input.plan ?? {};
  const career = careerOf(rules, profile, year);
  const lr = career.leave;
  if (!isAvailable(lr.compensation)) return null;
  const rule = lr.compensation;
  const jan1 = formatYmd({ y: year, m: 1, d: 1 });
  const dec31 = formatYmd({ y: year, m: 12, d: 31 });
  if (profile.hireDate > dec31) return null;
  if (retireDate !== undefined && retireDate < jan1) return null;

  const hpd = lr.units.hoursPerDay;
  const override = leave.grantOverrideHours[String(year)];
  const overridden = typeof override === 'number';
  if (!overridden && !isAvailable(lr.annual)) return { kind: 'needsGrant', year, rule };

  const autoHours = (on: Ymd) => annualLeaveDays(lr, profile.hireDate, on, retireDate) * hpd;
  const grantOn = (on: Ymd) => (overridden ? override : autoHours(on));
  const ledger = (on: Ymd): CompLedger => {
    const grantedHours = grantOn(on);
    const usedHours = usedAnnualHours(leave.records, year, on);
    return { grantedHours, usedHours, remainingHours: grantedHours - usedHours };
  };
  const retiringThisYear = retireDate !== undefined && yearOf(retireDate) === year;
  const lastDay = retiringThisYear ? (retireDate as Ymd) : dec31;
  const overrideAboveAuto = overridden && isAvailable(lr.annual) && override > autoHours(lastDay);
  const cap = Math.min(rule.maxDays, plan.capDays ?? rule.maxDays);
  /** 보상하지 않는 일수(넣었을 때)를 뺀, 보상 또는 저축할 수 있는 날의 상한(예규 (6)가) */
  const unpaidCap = (book: CompLedger) =>
    Math.max(0, Math.floor(book.grantedHours / hpd) - (plan.unpaidDays ?? 0));
  const choose = (max: number) => {
    const want = plan.compDays ?? null;
    const chosenDays = want === null ? max : Math.max(0, Math.min(max, want));
    return { chosenDays, usedMax: want === null, clamped: want !== null && want > max };
  };
  const amountOn = (salary: SalaryPoint | null, days: number) =>
    salary ? compensationAmount(lr, salary.amount, days) : null;
  /** 그 해 말 저축으로 옮긴 날(연말 정리 값). 같은 남은 연가를 보상과 저축에 겹쳐 셈하지 않는다 */
  const carryDays = input.excludeCarry
    ? 0
    : Math.floor(
        leave.savings
          .filter((s) => s.kind === 'carry' && s.year === year)
          .reduce((sum, s) => sum + s.hours, 0) / hpd,
      );
  const lessCarry = (n: number) => Math.max(0, n - carryDays);

  const midDate = formatYmd({ y: year, m: rule.midYear.month, d: rule.midYear.day });
  if (retiringThisYear && (retireDate as Ymd) <= midDate) {
    const r = retireDate as Ymd;
    const book = ledger(r);
    const maxDays = Math.min(
      lessCarry(Math.floor(book.remainingHours / hpd)),
      rule.maxDays,
      rule.retire.beforeJulyMaxDays,
      cap,
      lessCarry(unpaidCap(book)),
    );
    const salaryDate = addDays(r, -1);
    const salary = salaryOn(rules, profile, salaryDate);
    const pick = choose(maxDays);
    return {
      kind: 'retire',
      year,
      hoursPerDay: hpd,
      rule,
      retireDate: r,
      salaryDate,
      overrideAboveAuto,
      ...book,
      maxDays: Math.max(0, maxDays),
      carryDays,
      ...pick,
      salary,
      total: amountOn(salary, pick.chosenDays),
    };
  }

  // 6월 30일 기준(제18조의5제3항제1호). 그날은 그 해를 다 근무한다고 보고 부여를 센다 — 7월 1일 이후 퇴직하는 사람도
  // 6월 30일에는 한 해 연가로 판정하고, 퇴직 때 줄어든 연가로 다시 셈해 넘게 받은 몫을 환수한다(업무지침 [451쪽] 8. 31. 명예퇴직 예시)
  const midGranted = overridden ? override : annualLeaveDays(lr, profile.hireDate, midDate) * hpd;
  const midUsed = usedAnnualHours(leave.records, year, midDate);
  const midBook: CompLedger = {
    grantedHours: midGranted,
    usedHours: midUsed,
    remainingHours: midGranted - midUsed,
  };
  const minRemainingHours = rule.midYear.minRemainingDays * hpd;
  const beforeHire = profile.hireDate > midDate;
  const eligible = !beforeHire && midBook.remainingHours >= minRemainingHours;
  const midDays = eligible ? rule.midYear.days : 0;
  const midSalary = beforeHire ? null : salaryOn(rules, profile, midDate);
  const mid: MidYearInfo = {
    date: midDate,
    upcoming: today < midDate,
    beforeHire,
    ...midBook,
    minRemainingHours,
    eligible,
    days: midDays,
    ruleDays: rule.midYear.days,
    salary: midSalary,
    amount: beforeHire ? 0 : amountOn(midSalary, midDays),
  };

  // 12월 31일 기준(제3항제2호) — 7월 1일 이후 12월 31일 전 퇴직이면 퇴직일까지(제4항제2호)
  const endDate = lastDay;
  const endBook = ledger(endDate);
  const salaryDate = retiringThisYear ? addDays(endDate, -1) : endDate;
  const endSalary = salaryOn(rules, profile, salaryDate);
  const maxDays = Math.min(
    lessCarry(Math.floor(endBook.remainingHours / hpd)),
    rule.maxDays,
    cap,
    lessCarry(unpaidCap(endBook)),
  );
  const pick = choose(maxDays);
  const total = amountOn(endSalary, pick.chosenDays);
  let midPaid: number | null;
  if (plan.midYear === 'none' || beforeHire) midPaid = 0;
  else if (plan.midYear === 'paid') midPaid = amountOn(midSalary, rule.midYear.days);
  else midPaid = eligible ? mid.amount : 0;
  const end: YearEndInfo = {
    date: endDate,
    salaryDate,
    overrideAboveAuto,
    retiringSecondHalf: retiringThisYear,
    retireDate: retiringThisYear ? endDate : null,
    ...endBook,
    maxDays: Math.max(0, maxDays),
    carryDays,
    ...pick,
    salary: endSalary,
    total,
    midPaid,
    net: total === null || midPaid === null ? null : total - midPaid,
  };
  return { kind: 'year', year, hoursPerDay: hpd, rule, mid, end };
}

// ── 저축연가 통장(#33 묶음 2) ─────────────────────────────────────────────
// 국가공무원 복무규정 제16조의3·제11조제4항, 복무·징계 예규 제8장 4. 가. (6)·(10).
// 계산 규칙은 직종의 규정 데이터(careerRules.leave.saving)에서 읽는다. null 인 칸(그 직종의 원문으로 확인하지 못한 것)은
// 다른 직종의 값으로 대신하지 않는다: 쓰기 시작하는 날을 모르면 날짜로 막지 않고, 순서를 모르면 넣은 차례대로 셈한다.

/** 저축 한 칸을 쓰기 시작하는 날. 그 직종의 원문으로 확인하지 못했으면 null */
export function savingsFrom(
  rule: Pick<LeaveSavingRules, 'availableFrom' | 'overtimeAvailableFrom'>,
  entry: Pick<SavingsEntry, 'kind' | 'year' | 'month'>,
): Ymd | null {
  if (entry.kind === 'overtime') {
    if (rule.overtimeAvailableFrom !== 'nextMonth' || entry.month === null) return null;
    const [y, m] = entry.month.split('-').map(Number) as [number, number];
    return m === 12 ? formatYmd({ y: y + 1, m: 1, d: 1 }) : formatYmd({ y, m: m + 1, d: 1 });
  }
  return rule.availableFrom === 'nextYear' ? formatYmd({ y: entry.year + 1, m: 1, d: 1 }) : null;
}

export interface SavingsLot {
  entry: SavingsEntry;
  /** 쓰기 시작하는 날(모르면 null) */
  from: Ymd | null;
  /** 오늘까지의 저축연가 기록으로 빠진 시간 */
  usedHours: number;
  /** 오늘 기준 남은 시간 */
  leftHours: number;
}

export interface SavingsShortage {
  recordId: string;
  date: Ymd;
  /** 그날 쓸 수 있는 저축연가보다 많이 적은 시간 */
  missingHours: number;
}

export interface SavingsSummary {
  /** 쓰는 차례(쓰기 시작하는 날, 같으면 넣은 해·id) */
  lots: SavingsLot[];
  /** 쓰기 시작하는 날·순서를 원문으로 확인했는지(모르면 날짜로 막지 않고 합계만 본다) */
  datesKnown: boolean;
  /** 넣은 시간의 합 */
  depositedHours: number;
  /** 오늘까지 저축연가에서 쓴 시간 */
  usedHours: number;
  /** 오늘 쓸 수 있는 남은 시간(쓰기 시작하는 날이 지난 것) */
  availableHours: number;
  /** 아직 쓸 수 없는 남은 시간과, 그중 가장 먼저 쓸 수 있게 되는 날 */
  pendingHours: number;
  nextFrom: Ymd | null;
  /** 오늘 뒤의 저축연가 기록(예정) 시간 */
  plannedHours: number;
  /** 모자란 기록(지우거나 고치지 않는다 — 화면이 알린다) */
  shortages: SavingsShortage[];
}

function lotOrder(a: { from: Ymd | null; entry: SavingsEntry }, b: typeof a): number {
  const fa = a.from ?? '';
  const fb = b.from ?? '';
  if (fa !== fb) return fa < fb ? -1 : 1;
  if (a.entry.year !== b.entry.year) return a.entry.year - b.entry.year;
  return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
}

/** 저축연가 기록(pool 'saved')을 날짜순으로 묶음에서 뺀다. 그날 쓸 수 있는 묶음 중 먼저 저축한 것부터 */
function drain(
  lots: { from: Ymd | null; left: number }[],
  uses: readonly LeaveRecord[],
  datesKnown: boolean,
): SavingsShortage[] {
  const shortages: SavingsShortage[] = [];
  for (const use of uses) {
    let need = use.hours;
    for (const lot of lots) {
      if (need === 0) break;
      if (lot.left === 0) continue;
      if (datesKnown && lot.from !== null && lot.from > use.date) continue;
      const take = Math.min(lot.left, need);
      lot.left -= take;
      need -= take;
    }
    if (need > 0) shortages.push({ recordId: use.id, date: use.date, missingHours: need });
  }
  return shortages;
}

/**
 * 저축연가 통장. 저축연가 기록을 날짜순으로, 그날 쓸 수 있는(쓰기 시작하는 날이 지난) 묶음 중 먼저 저축한 것부터 뺀다
 * (예규 "최초 저축한 연가일수부터"). 모자라면 shortages 에 넣는다(예정 기록도 셈한다).
 */
export function savingsLedger(
  rule: Pick<LeaveSavingRules, 'availableFrom' | 'overtimeAvailableFrom' | 'order'>,
  savings: readonly SavingsEntry[],
  records: readonly LeaveRecord[],
  today: Ymd,
): SavingsSummary {
  const datesKnown = rule.availableFrom !== null && rule.order !== null;
  const base = savings.map((entry) => ({ entry, from: savingsFrom(rule, entry) })).sort(lotOrder);
  const uses = records
    .filter((r) => r.pool === 'saved')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const past = uses.filter((r) => r.date <= today);
  const all = base.map((l) => ({ from: l.from, left: l.entry.hours }));
  const shortages = drain(all, uses, datesKnown);
  const now = base.map((l) => ({ from: l.from, left: l.entry.hours }));
  drain(now, past, datesKnown);
  const lots: SavingsLot[] = base.map((l, i) => {
    const left = (now[i] as { left: number }).left;
    return { entry: l.entry, from: l.from, usedHours: l.entry.hours - left, leftHours: left };
  });
  let availableHours = 0;
  let pendingHours = 0;
  let nextFrom: Ymd | null = null;
  for (const lot of lots) {
    if (!datesKnown || lot.from === null || lot.from <= today) availableHours += lot.leftHours;
    else {
      pendingHours += lot.leftHours;
      if (lot.leftHours > 0 && (nextFrom === null || lot.from < nextFrom)) nextFrom = lot.from;
    }
  }
  return {
    lots,
    datesKnown,
    depositedHours: savings.reduce((s, e) => s + e.hours, 0),
    usedHours: past.reduce((s, r) => s + r.hours, 0),
    availableHours,
    pendingHours,
    nextFrom,
    plannedHours: uses.filter((r) => r.date > today).reduce((s, r) => s + r.hours, 0),
    shortages,
  };
}

/** date 에 hours 시간짜리 저축연가 기록을 더해도 어느 기록(뒤의 예정 기록 포함)도 모자라지 않는지 */
export function savingsFits(
  rule: Pick<LeaveSavingRules, 'availableFrom' | 'overtimeAvailableFrom' | 'order'>,
  savings: readonly SavingsEntry[],
  records: readonly LeaveRecord[],
  date: Ymd,
  hours: number,
): boolean {
  if (hours <= 0) return true;
  const probe: LeaveRecord = {
    id: 'probe:new',
    date,
    hours,
    kind: 'hours',
    memo: '',
    pool: 'saved',
  };
  return savingsLedger(rule, savings, [...records, probe], date).shortages.length === 0;
}

/**
 * date 에 새 저축연가 기록으로 쓸 수 있는 시간: 그 기록을 더해도 어느 저축연가 기록(그날 뒤의 예정 기록 포함)도
 * 모자라지 않는 가장 큰 시간. 뒤의 예정 기록이 그날 아직 쓸 수 없는 묶음(다음 해 1월 1일부터 쓰는 연말 저축 등)으로
 * 채워질 수 있으면 그 몫은 그날 쓸 수 있는 것으로 센다. 이미 모자란 기록이 있으면 그 기록은 셈에서 뺀다.
 */
export function savingsAvailableOn(
  rule: Pick<LeaveSavingRules, 'availableFrom' | 'overtimeAvailableFrom' | 'order'>,
  savings: readonly SavingsEntry[],
  records: readonly LeaveRecord[],
  date: Ymd,
): number {
  const before = savingsLedger(rule, savings, records, date);
  // 이미 모자란 기록은 새 기록 탓이 아니다 — 빼고 본다
  const short = new Set(before.shortages.map((s) => s.recordId));
  const kept = short.size > 0 ? records.filter((r) => !short.has(r.id)) : records;
  // 위 끝: 그날 쓰기 시작한 칸에 넣은 시간의 합
  let hi = before.lots
    .filter((l) => !before.datesKnown || l.from === null || l.from <= date)
    .reduce((s, l) => s + l.entry.hours, 0);
  let lo = 0;
  // 1시간 단위 이분 탐색(fits 는 hours 에 대해 단조롭다)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (savingsFits(rule, savings, kept, date, mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── 연말 정리(#33 묶음 2) ─────────────────────────────────────────────────
// 복무규정 제16조⑤·제16조의2·제16조의3①, 예규 (6)가·(9)(라). 기관이 정하는 값(보상하지 않는 일수·보상 한도)은 사용자가 넣는다.

export interface YearEndInput {
  /** 그 해 부여(직접 고친 값 우선) */
  grantedHours: number;
  /** 그 해 올해 연가에서 쓴 시간(저축연가에서 쓴 기록은 빼고) */
  usedAnnualHours: number;
  hoursPerDay: number;
  /** 보상하지 않는 일수(권장 연가 미보상·사용 촉진). null = 모름(0으로 셈하고 표시) */
  unpaidDays: number | null;
  /** 기관의 보상 한도. null = 규정 상한(maxDays) */
  capDays: number | null;
  /** 규정 상한(20일) */
  maxDays: number;
  /** 그 해 정년퇴직한다(끝자리 자동 저축 없음 — 예규 (9)(라) ※) */
  retiringThisYear: boolean;
  /** 8시간 미만 끝자리 연가를 저절로 이월·저축하는지(규정 데이터 autoCarryUnderDay. 모르면 null → 셈하지 않음) */
  autoCarryUnderDay: boolean | null;
}

export interface YearEndSplit {
  remainingHours: number;
  /** 부여보다 많이 쓴 시간(저축연가에서 빠지거나 결근으로 볼 수 있다 — 나누지 않는다) */
  overUsedHours: number;
  /** 8시간 미만 끝자리: 저절로 저축(퇴직하는 해·모르는 직종 0) */
  autoSaveHours: number;
  /** 끝자리를 저절로 저축하는지 몰라 셈하지 않았다 */
  autoSaveUnknown: boolean;
  wholeDays: number;
  /** 보상하지 않는 일수 안의 미사용 → 보상도 저축도 안 된다(소멸) */
  lapseUnpaidDays: number;
  /** 보상 또는 저축할 수 있는 날 */
  poolDays: number;
  /** 그중 보상 상한(규정 20일, 넣은 기관 한도) */
  maxCompDays: number;
  /** 넣은 기관 한도(규정 상한보다 크면 규정 상한) */
  capDays: number;
  unknownUnpaid: boolean;
}

export function yearEndSplit(i: YearEndInput): YearEndSplit {
  const remaining = i.grantedHours - i.usedAnnualHours;
  const cap = Math.min(i.maxDays, i.capDays ?? i.maxDays);
  const unknownUnpaid = i.unpaidDays === null;
  const autoSaveUnknown = i.autoCarryUnderDay === null && !i.retiringThisYear;
  if (remaining <= 0) {
    return {
      remainingHours: remaining,
      overUsedHours: Math.max(0, -remaining),
      autoSaveHours: 0,
      autoSaveUnknown,
      wholeDays: 0,
      lapseUnpaidDays: 0,
      poolDays: 0,
      maxCompDays: 0,
      capDays: cap,
      unknownUnpaid,
    };
  }
  const hpd = i.hoursPerDay;
  const wholeDays = Math.floor(remaining / hpd);
  // 끝자리는 '보상하지 않는 일수를 뺀 나머지 연가' 안의 것만 저절로 저축한다(예규 (6)가 "나머지 연가일수 중 8시간 미만의
  // 잔여연가는 자동으로 이월·저축"). 보상하지 않는 일수만큼 쓰지 못했으면 나머지는 부여 − 보상하지 않는 일수다
  const savableHours = Math.max(0, Math.min(remaining, i.grantedHours - (i.unpaidDays ?? 0) * hpd));
  const autoSaveHours = i.retiringThisYear || i.autoCarryUnderDay !== true ? 0 : savableHours % hpd;
  const grantedDays = Math.floor(i.grantedHours / hpd);
  const poolDays = Math.min(wholeDays, Math.max(0, grantedDays - (i.unpaidDays ?? 0)));
  return {
    remainingHours: remaining,
    overUsedHours: 0,
    autoSaveHours,
    autoSaveUnknown,
    wholeDays,
    lapseUnpaidDays: wholeDays - poolDays,
    poolDays,
    maxCompDays: Math.min(poolDays, cap),
    capDays: cap,
    unknownUnpaid,
  };
}

/** 보상도 저축도 고르지 않은 날(화면의 '남는 날'. 가산 판정에는 쓰지 않는다) */
export function leftoverDays(s: YearEndSplit, compDays: number, saveDays: number): number {
  return Math.max(0, s.poolDays - compDays - saveDays);
}

/**
 * 가산 판정(예규 (2)(다)): 한도(넣은 기관 한도, 비우면 규정 20일. 20일보다 크게 넣어도 20)를 넘는 미사용 일수 중
 * 저축하지 않은 날 = max(0, (poolDays − saveDays) − min(capDays ?? maxDays, maxDays)).
 * 보상받은 일수는 보지 않는다 — 한도 안에서 본인이 덜 받고 남긴 날은 가산 대상이 아니다.
 */
export function overCapUnsavedDays(
  s: Pick<YearEndSplit, 'poolDays'>,
  saveDays: number,
  capDays: number | null,
  maxDays: number,
): number {
  const cap = Math.min(capDays ?? maxDays, maxDays);
  return Math.max(0, s.poolDays - saveDays - cap);
}

/** 가산 힌트를 보일지: 한도 넘는 미저축 1일 이상, 퇴직하는 해가 아님, 그 해 1월 2일 이후 임용이 아님(예규 (2)(나)) */
export function bonusLeaveHint(
  over: number,
  year: number,
  hireDate: Ymd,
  retiringThisYear: boolean,
): boolean {
  const hireYear = yearOf(hireDate);
  const hiredMidYear = hireYear === year && hireDate.slice(5) !== '01-01';
  return over >= 1 && !retiringThisYear && !hiredMidYear && hireYear <= year;
}

/**
 * 연도 중 임용·퇴직하는 해의 권장 연가 비례(예규 (5)가): days × months ÷ 12 의 소수점 이하 반올림.
 * 화면은 제안만 한다(기관이 이미 줄여 알렸을 수 있다).
 */
export function prorateDays(days: number, months: number): number {
  return Math.floor((days * months * 2 + 12) / 24);
}
