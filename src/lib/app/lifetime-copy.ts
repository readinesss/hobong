/**
 * '생애 봉급' 창(#30)의 문구와 화면 표기. 계산은 하지 않고 계산 결과(숫자·낱말)를 문장으로 옮긴다.
 *
 * 지키는 것(tests 의 lifetime·copy 검사가 본다):
 * - 금액은 봉급만의 추정이다. 받는 돈 전체를 뜻하는 이름을 붙이지 않고 '생애 봉급(추정)'이라고 부른다.
 * - 봉급표가 언제 몇 번 바뀌는지는 말하지 않는다(원문에서 확인한 것은 '규정이 개정되면 바뀐다'뿐이다).
 *   달력의 사실("해가 n번 바뀌어요")만 말한다.
 * - 계급정년 뒤의 근무 조건을 단정하지 않는다. 예외는 규정 데이터의 설명(retirement.rankLimit.source.note)을 그대로 보인다.
 * - 조사는 josa()·withRo() 로 고른다.
 */
import type { Ymd } from '../calc/date.ts';
import {
  YEAR_MONTH_RE,
  monthEndOf,
  type RetirePlanIssue,
  type YearMonth,
} from '../calc/lifetime.ts';
import { LIMITS } from '../store/schema.ts';
import { formatLongDate, formatNumber, formatWonShort, josa, withRo } from './format.ts';

export const LIFETIME_TITLE = '생애 봉급';
export const LIFETIME_TOTAL_LABEL = '생애 봉급(추정)';
export const LIFETIME_EARNED_LABEL = '지금까지 번 봉급';
export const LIFETIME_REMAINING_LABEL = '앞으로 벌 봉급';
export const LIFETIME_BAR_LABEL = '생애 봉급(추정) 가운데 지금까지 번 만큼';
export const LIFETIME_DETAILS_SUMMARY = '어떻게 셈했나요';
/** 금액 가리기 중에 저장된 퇴직 예정 달이 있을 때 본문 대신 보이는 한 줄(달·횟수·막대를 함께 가린다) */
export const LIFETIME_MASKED = '금액 가리기 중이라 퇴직 예정 달과 그에 따른 숫자를 가렸어요.';
/** 금액 가리기 중에 저장된 퇴직 예정 달을 쓸 수 없을 때 덧붙이는 말(달도, 지났는지·뒤인지도 말하지 않는다) */
export const LIFETIME_MASKED_ISSUE = '정해 둔 퇴직 예정 달을 확인해 주세요.';

// ── 퇴직 예정 달 정하기 ──
export const PLAN_LABEL = '퇴직 예정 달';
/** 폼을 여는 버튼: 정한 달이 없을 때 / 있을 때 */
export const PLAN_OPEN = '퇴직 예정 달 정하기';
export const PLAN_EDIT = '퇴직 예정 달 고치기';
export const PLAN_SUBMIT = '정하기';
export const PLAN_CLOSE = '닫기';
/** 첫 줄 옆 꼬리표(정한 달 기준으로 셈한 숫자임을 글자로 밝힌다) */
export const PLAN_TAG = '정한 달';
/** 쓸 수 없게 된 정한 달을 지우는 버튼 */
export const PLAN_DISCARD = '정한 달 지우기';
/** 끝나는 날이 없을 때(정년을 계산하지 못함) 정하기를 권하는 말 */
export const PLAN_OFFER = '퇴직 예정 달을 정하면 그 달 말일까지로 셈해 드려요.';
/** 계급정년이 기본일 때 연령정년 퇴직일까지로 보는 길 */
export const PLAN_RANK_LIMIT_OFFER = '그날까지로 보고 싶으면 퇴직 예정 달을 정해 보세요.';
/** 날짜가 아니라 달을 받는 까닭(공무원보수규정 제22조·제24조: 달 가운데 그만둔 달의 봉급은 조건에 따라 갈린다) */
export const PLAN_WHY_MONTH =
  '날짜가 아니라 달로 받아요. 달 가운데 그만두면 그 달 봉급이 조건에 따라 전액이거나 날짜만큼이라(공무원보수규정 제22조·제24조), 날짜로는 틀린 숫자가 나올 수 있어요.';
/** 정한 달이 어디에 남는지: 이 브라우저와 내려받는 임용정보 패키지(암호를 걸지 않으면 그대로 읽힌다) */
export const PLAN_STORAGE_NOTE =
  '정한 달은 이 브라우저에 저장되고, 임용정보 패키지를 내려받으면 그 파일에도 그대로 실려요(패키지에 암호를 걸면 가려져요). 카드에는 들어가지 않아요.';
/** 이 창에서만 쓴다는 것(정년 D-day·연가·보너스·일정은 정년퇴직일 그대로). 정년을 계산하지 못하는 직종은 앞 문장만 */
export function planScopeNote(hasRetirement: boolean): string {
  return hasRetirement
    ? "정한 달은 이 창의 셈에만 써요. '정년까지의 길'과 연가·보너스·일정은 정년퇴직일 그대로예요."
    : '정한 달은 이 창의 셈에만 써요.';
}

/** 정한 달을 되돌리는 버튼. 정년을 계산하지 못하는 직종은 돌아갈 '정년까지'가 없다 */
export function planResetLabel(hasRetirement: boolean): string {
  return hasRetirement ? '정년까지로 되돌리기' : PLAN_DISCARD;
}

/** 폼의 둘째 줄: 친 값이 맞는 달이면 그 달 말일을 바로 보여 준다 */
export function planPreview(month: YearMonth | ''): string {
  return month && YEAR_MONTH_RE.test(month)
    ? `그 달 말일(${formatLongDate(monthEndOf(month))})까지 다니는 것으로 셈해요.`
    : '그 달 말일까지 다니는 것으로 셈해요.';
}

export interface RetirePlanCheck {
  /** 고를 수 있는 가장 이른 달(이번 달) */
  minMonth: YearMonth;
  /** 연령정년 퇴직일(정년 규정이 꺼진 직종은 null — 확인한 상한이 없다) */
  ageRetireDate: Ymd | null;
  /** 계급정년이 있는 직종인지(상한이 '연령정년 퇴직일'임을 밝힌다) */
  hasRankLimit: boolean;
  /** 임용일(임용일이 앞날로 저장된 드문 경우에만 걸린다) */
  hireDate: Ymd;
}

/**
 * 퇴직 예정 달 입력 검사(폼에서만 쓴다 — 오늘·규정에 기대는 검사는 저장본에 하지 않는다).
 * 문제가 없으면 null. 정년퇴직일과 같은 달, 계급정년 뒤(연령정년 이내)의 달은 오류가 아니다(그대로 저장한다).
 */
export function checkRetirePlan(month: string, c: RetirePlanCheck): string | null {
  if (!YEAR_MONTH_RE.test(month)) return '연도와 달을 넣어 주세요.';
  if (month < c.minMonth) return `이번 달(${formatYearMonth(c.minMonth)})부터 고를 수 있어요.`;
  const end = monthEndOf(month);
  if (c.ageRetireDate !== null && end > c.ageRetireDate) {
    const name = c.hasRankLimit ? '연령정년 퇴직일' : '정년퇴직일';
    return `${name}이 ${formatLongDate(c.ageRetireDate)}이라 ${formatYearMonth(c.ageRetireDate)}까지만 고를 수 있어요.`;
  }
  if (Number(month.slice(0, 4)) > LIMITS.maxLeaveYear)
    return `${LIMITS.maxLeaveYear}년까지만 고를 수 있어요.`;
  if (end < c.hireDate)
    return `임용일(${formatLongDate(c.hireDate)})이 있는 달부터 고를 수 있어요.`;
  return null;
}

/** 정하거나 되돌린 뒤 알리는 말(aria-live). 금액 가리기 중에는 달을 빼고 말한다 */
export function planAnnouncement(
  month: YearMonth | null,
  o: { masked: boolean; hasRetirement: boolean },
): string {
  if (month === null) return o.hasRetirement ? '정년까지로 되돌렸어요.' : '정한 달을 지웠어요.';
  return o.masked
    ? '퇴직 예정 달을 정했어요.'
    : `퇴직 예정 달을 ${formatYearMonth(month)}로 정했어요.`;
}

/**
 * 저장된 정한 달을 쓰지 못할 때의 안내(저장본은 그대로 두고 고치거나 지우기를 권한다).
 * fallback 은 대신 무엇으로 셈했는지: 정년퇴직일까지로 셈했으면 true.
 */
export function planIssueNote(i: {
  issue: RetirePlanIssue;
  month: YearMonth;
  ageRetireDate: Ymd | null;
  hasRankLimit: boolean;
  hireDate: Ymd;
  fallback: boolean;
}): string {
  const held = `정해 둔 퇴직 예정 달(${formatYearMonth(i.month)})이`;
  const tail = i.fallback ? ' 지금은 정년까지로 셈했어요.' : '';
  if (i.issue === 'past') return `${held} 지났어요.${tail}`;
  if (i.issue === 'beforeHire')
    return `${held} 임용일(${formatLongDate(i.hireDate)})보다 앞이에요.${tail}`;
  const name = i.hasRankLimit ? '연령정년 퇴직일' : '정년퇴직일';
  return i.ageRetireDate === null
    ? `${held} 정년퇴직일보다 뒤예요.${tail}`
    : `${held} ${name}(${formatLongDate(i.ageRetireDate)})보다 뒤예요.${tail}`;
}

/**
 * 정한 달이 계급정년 퇴직일보다 뒤일 때(연령정년 이내). 사실만 말하고 근무 조건을 단정하지 않는다 —
 * 계급정년 뒤에도 근무하는 길은 승진만이 아니다(계급정년 연장 등). 자세한 예외는 화면이 규정 데이터의 설명을 그대로 보인다.
 * noun 은 계급 낱말('계급'), money 는 금액을 보이고 있는지.
 */
export function beyondRankLimitNote(rankLimitDate: Ymd, noun: string, money: boolean): string {
  return (
    `계급정년 퇴직일(${formatLongDate(rankLimitDate)})보다 뒤예요. 승진하거나 계급정년에 이르는 날이 달라지면 퇴직일이 달라질 수 있어요.` +
    (money ? ` 금액은 지금 ${noun || '계급'} 그대로 셈했어요.` : '')
  );
}

/** 정한 달이 기본 정년퇴직일과 같은 달일 때(정년 기준 그대로 셈한다. 저장된 값은 지우지 않는다) */
export function sameMonthNote(month: YearMonth, cause: 'age' | 'rankLimit' | null): string {
  const name = cause === 'rankLimit' ? '계급정년 퇴직일' : '정년퇴직일';
  return `정한 달(${formatYearMonth(month)})이 ${name}과 같은 달이에요.`;
}

/** 공휴일 데이터가 없는 해가 걸려 월급날 횟수가 한 번 달라질 수 있을 때 */
export const PAYDAY_HOLIDAY_GAP = '공휴일 반영 전이라 하루 이틀 차이로 한 번 달라질 수 있어요.';

const MAN = 10_000;

/**
 * 화면에 보이는 '앞으로 벌 봉급': 보이는 총액(만 원 미만 버림) − 보이는 '지금까지'(만 원 미만 버림). 늘 만 원의 배수다.
 * 세 금액을 따로 버리면 보이는 '지금까지 + 앞으로'가 보이는 총액보다 1만 원 작은 날이 대부분이라, 화면 표기만 이렇게 한다
 * (계산 값 remaining 은 원 단위 그대로 둔다). 실제 remaining 과의 차이는 늘 1만 원 미만이다.
 */
export function shownRemaining(total: number, earned: number): number {
  return Math.floor(total / MAN) * MAN - Math.floor(earned / MAN) * MAN;
}

export interface ShownPercent {
  /** 막대 옆에 보이는 글자: '29%' 또는 '1% 미만' */
  text: string;
  /** 정수 %(0~100). '1% 미만'이면 0 */
  value: number;
  /** 번 돈은 있는데 1%가 안 됨 */
  under1: boolean;
  /** Progress 에 넘길 값(0~1). 부품이 반올림해 만드는 aria-valuenow 가 보이는 글자와 같게 */
  bar: number;
}

/** 진행률 표기: 내림한 정수 %. 남은 금액이 있는데 100이 되면 99, 번 돈이 있는데 0이면 '1% 미만' */
export function shownPercent(l: {
  ratio: number;
  earned: number;
  remaining: number;
}): ShownPercent {
  let value = Math.min(100, Math.max(0, Math.floor(l.ratio * 100)));
  if (l.remaining > 0 && value >= 100) value = 99;
  const under1 = value === 0 && l.earned > 0;
  return {
    text: under1 ? '1% 미만' : `${value}%`,
    value,
    under1,
    // '1% 미만'이면 막대에 한 칸은 채우되(조금이라도 진행) 낭독 값은 0으로 남긴다
    bar: under1 ? 0.004 : value / 100,
  };
}

/** '2043-07-01'·'2043-07' → '2043년 7월' */
export function formatYearMonth(value: Ymd | YearMonth): string {
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  return `${y}년 ${m}월`;
}

/** 끝나는 날까지 남은 기간을 연·개월로('3년 4개월'). 한 달이 안 되면 날수로 */
export function spanYearsMonths(span: { years: number; months: number; days: number }): string {
  const parts: string[] = [];
  if (span.years > 0) parts.push(`${span.years}년`);
  if (span.months > 0) parts.push(`${span.months}개월`);
  return parts.length > 0 ? parts.join(' ') : `${span.days}일`;
}

export interface HeadlineInput {
  basis: 'retirement' | 'plan';
  /** 끝나는 날(정년퇴직일 또는 정한 달의 말일) */
  date: Ymd;
  /** 정년퇴직일이 무엇 때문인지(정년 기준일 때) */
  cause: 'age' | 'rankLimit' | null;
  /** 정년퇴직일이 지났는지 */
  retired: boolean;
}

/** 창의 첫 줄(무엇을 끝으로 보고 셈했는지). 낭독 요약의 '기준 글'로도 쓴다 */
export function headline(h: HeadlineInput): string {
  if (h.basis === 'plan') return `${formatYearMonth(h.date)}까지 다닌다면`;
  const name = h.cause === 'rankLimit' ? '계급정년 퇴직일' : '정년퇴직일';
  return `${name}(${formatLongDate(h.date)})까지${h.retired ? '' : ' 다닌다면'}`;
}

/** 계급정년이 기본일 때의 안내(사실만: 승진하면 달라질 수 있다, 연령정년 퇴직일은 언제다) */
export function rankLimitNote(ageRetireDate: Ymd): string {
  return `승진하면 퇴직일도 금액도 달라질 수 있어요. 연령정년 퇴직일은 ${formatLongDate(ageRetireDate)}이에요.`;
}

/**
 * 늘 보이는 고지 한 줄. noun 은 계급 낱말('직급'·'계급'·'직무등급'), 계급 이름이 없는 봉급표(교원)는 ''.
 */
export function notice(noun: string, tableYear: number): string {
  const tail =
    '실제로 받는 돈이 아니에요 — 수당·세금·기여금·퇴직급여(연금·퇴직수당)는 들어 있지 않고,';
  return noun
    ? `임용일부터 퇴직 때까지 지금 ${josa(noun, '과', '와')} ${tableYear}년 봉급표 그대로라고 보고 셈한 봉급만의 합계예요. ${tail} 봉급 인상과 승진도 넣지 않았어요.`
    : `임용일부터 퇴직 때까지 ${tableYear}년 봉급표 그대로라고 보고 셈한 봉급만의 합계예요. ${tail} 봉급 인상도 넣지 않았어요.`;
}

/** 올해 봉급표가 아직 반영되지 않았을 때 한 줄 더 */
export function pendingTableNote(year: number, tableYear: number): string {
  return `${year}년 봉급표가 아직 반영되지 않아 ${tableYear}년 표로 셈했어요.`;
}

/** 금액을 보일 때의 낭독 요약 */
export function spokenSummary(
  head: string,
  total: number,
  earned: number,
  percent: ShownPercent,
): string {
  return `${head} 봉급만 셈한 생애 봉급 추정 합계는 약 ${formatWonShort(total)}이고, 지금까지 약 ${formatWonShort(earned)}, ${percent.text}${percent.under1 ? '을' : '를'} 벌었어요.`;
}

/** 금액 가리기 중(저장된 퇴직 예정 달은 없음)의 낭독 요약 */
export function spokenSummaryMasked(head: string, percent: ShownPercent): string {
  return `${head} 봉급만 셈한 생애 봉급의 ${percent.text}${percent.under1 ? '을' : '를'} 벌었어요. 금액은 가려져 있어요.`;
}

export interface CountLine {
  label: string;
  value: string;
  /** 괄호 안의 덧말(없으면 '') */
  aside: string;
}

/** 월급날 줄. 오늘이 월급날인지는 view.isPayday 가 아니라 paydayCounts 의 todayCounted 로 건다 */
export function paydayLine(
  p: { received: number; left: number; todayCounted: boolean },
  retired: boolean,
): CountLine {
  if (retired) return { label: '받은 월급날', value: `${formatNumber(p.received)}번`, aside: '' };
  const today = !p.todayCounted
    ? ''
    : p.received === 1
      ? '오늘이 첫 월급날이에요'
      : `오늘이 ${formatNumber(p.received)}번째 월급날이에요`;
  if (p.left === 0)
    // 금액(오늘까지 번 날 기준)과 횟수(월급날 기준)의 차이가 이 줄에서 풀린다
    return { label: '남은 월급날', value: '없음', aside: today || '이번 달 월급날은 지났어요' };
  return {
    label: '남은 월급날',
    value: `${formatNumber(p.left)}번`,
    aside: today || `지금까지 ${formatNumber(p.received)}번`,
  };
}

/** 정기승급 줄 */
export function raiseLine(l: {
  raisesLeft: number;
  stepNow: number;
  stepAtEnd: number;
  maxStep: number;
  maxStepDate: Ymd | null;
}): CountLine {
  const label = '남은 정기승급';
  if (l.raisesLeft === 0) {
    return l.stepNow >= l.maxStep
      ? { label, value: '없음', aside: '지금 최고호봉이에요' }
      : { label, value: '없음', aside: '퇴직 전 승급 없음' };
  }
  return {
    label,
    value: `${formatNumber(l.raisesLeft)}번`,
    aside: l.maxStepDate
      ? `${formatYearMonth(l.maxStepDate)}에 최고호봉`
      : `퇴직 때 ${l.stepAtEnd}호봉`,
  };
}

export interface HobongLineInput {
  /** 정년퇴직일이 지남 */
  retired: boolean;
  basis: 'retirement' | 'plan';
  /** 월급날 횟수(끝나는 날이 없으면 null) */
  paydays: { received: number; left: number } | null;
  /** 기간 %(내림한 정수). 정년 기준이면 '정년까지의 길' 창의 낭독값과 같은 값 */
  timePercent: number | null;
  /** 막대 옆에 보이는 봉급 %(없으면 null) */
  moneyPercent: ShownPercent | null;
  /** 끝나는 날까지 남은 정기승급(모르면 null). 0이면 '호봉이 오를수록'이라고 잇지 않는다 */
  raisesLeft: number | null;
}

/**
 * 호봉이의 한마디(한 줄). 같은 상태면 늘 같은 문장이고, 맞는 것이 없으면 null.
 * 금액은 들어가지 않는다(금액 가리기 중에도 정년 기준이면 보인다).
 */
export function hobongLine(i: HobongLineInput): string | null {
  if (i.retired) return '마지막 월급날까지 다 받았어요. 오래 애쓰셨어요.';
  if (i.paydays && i.paydays.left >= 1 && i.paydays.left <= 12)
    return `월급날이 ${i.paydays.left}번 남았어요. 한 번 한 번이 아쉬워요.`;
  if (i.paydays && i.paydays.received === 0) return '첫 월급날이 다가오고 있어요.';
  const t = i.timePercent;
  const m = i.moneyPercent;
  if (t !== null && m !== null && !m.under1 && t - m.value >= 3) {
    const lead = i.basis === 'plan' ? '정한 달까지의 기간은' : '기간은';
    // 더 오를 호봉이 없으면(지금 최고호봉 등) 사실만 말한다
    const tail = i.raisesLeft === 0 ? '' : ' 호봉이 오를수록 뒤쪽 달이 더 두둑해요.';
    return `${lead} ${t}% 지났는데 봉급은 ${m.value}% 받았어요.${tail}`;
  }
  return null;
}

export interface AssumptionInput {
  /** 금액 계산 결과(봉급이 꺼져 있으면 null — 금액에 관한 항목을 뺀다) */
  lifetime: { tableYear: number; maxStep: number; stepAtEnd: number } | null;
  /** 계급 낱말('직급'·'계급'·'직무등급'). 계급 이름이 없는 봉급표(교원)는 '' */
  noun: string;
  /** 정기승급 기간(개월) */
  periodMonths: number | null;
  basis: 'retirement' | 'plan';
  /** 정년퇴직일이 지났는지(앞날에 관한 말을 뺀다) */
  retired: boolean;
  /** 퇴직까지 해가 바뀌는 횟수 */
  newYears: number | null;
  /** 월급날(지급일) */
  payday: number;
  /** 정근수당 횟수를 보이는지와 지급 달(1·7) */
  diligenceMonths: readonly number[] | null;
  /** 명절휴가비 규정이 켜져 있는지(세지 않은 까닭을 밝힌다) */
  holidayBonus: boolean;
  /** 이 봉급표에 근속가봉 금액이 원문에 정해져 있는지(pay.longServiceAddOn !== null) */
  longServiceAddOn: boolean;
  /** 정년 근거('국가공무원법 제74조…'). 정년을 계산하지 않으면 '' */
  retireBasis: string;
}

export interface Assumption {
  title: string;
  text: string;
}

/** 접어 둔 자세한 가정 목록 */
export function assumptions(a: AssumptionInput): Assumption[] {
  const out: Assumption[] = [];
  const l = a.lifetime;
  if (l) {
    out.push({
      title: '봉급표',
      text:
        `${l.tableYear}년 봉급표 한 장을 임용일부터 퇴직일까지 그대로 썼어요. 그래서 지난 날도 앞날도 실제 금액과 달라요. ` +
        '봉급표는 공무원보수규정이 개정되면 바뀌고, 그때 이 창의 숫자가 한꺼번에 달라져요.' +
        (a.newYears !== null && a.newYears > 0 ? ` 퇴직까지 해가 ${a.newYears}번 바뀌어요.` : ''),
    });
    const period =
      a.periodMonths === null || a.periodMonths === 12 ? '1년' : `${a.periodMonths}개월`;
    const raise = `정기승급(${period}에 한 호봉, 최고호봉 ${l.maxStep}호봉까지)만 넣었어요.`;
    out.push(
      a.noun
        ? {
            title: `${a.noun}·호봉`,
            text: `지금 ${josa(a.noun, '이', '가')} 그대로라고 보고 ${raise} 지난 날도 지금 ${withRo(a.noun)} 거슬러 셈했어요. 승진하면 ${josa(a.noun, '과', '와')} 호봉이 다시 정해져요.`,
          }
        : { title: '호봉', text: raise },
    );
    out.push({
      title: '빠진 것',
      text: '수당(정근수당·명절휴가비·가족수당·시간외근무수당 등), 성과상여금, 세금·기여금, 퇴직급여(연금·퇴직수당)는 들어 있지 않아요.',
    });
    out.push({
      title: '휴직·징계·승급 제한',
      text: `넣지 않았어요. 다음 승급일을 직접 고쳤다면 그날부터 ${period}마다 오른다고 봤어요.`,
    });
    out.push({
      title: '달 가운데 임용·승급',
      text: '그 달 날수로 나눠 셈했어요(공무원보수규정 제22조).',
    });
    out.push({
      title: '퇴직하는 달',
      text:
        (a.basis === 'plan'
          ? '그 달 말일까지 다니는 것으로 셈했어요.'
          : '정년퇴직일 당일까지 봉급을 셌어요.') +
        ' 달 가운데 그만두면 5년 이상 근속하고 그 달에 15일 이상 근무했는지에 따라 그 달 봉급이 전액이거나 날짜만큼이에요.' +
        ' 파면·해임 등으로 그만두는 경우는 또 달라요(공무원보수규정 제22조·제24조).',
    });
  }
  out.push({
    title: '월급날 횟수',
    text:
      `월급날(${a.payday}일)이 그대로라고 보고 셌어요.` +
      (a.retired ? '' : ' 주말·공휴일로 날짜가 당겨져도 앞으로의 횟수는 같아요.') +
      ' 임용한 달은 임용일이 그 달 월급날보다 뒤면 세지 않았어요. 지난 해의 공휴일은 반영하지 못해 임용한 달은 한 번 다를 수 있어요.' +
      (l && !a.retired
        ? " 금액은 날짜만큼 번 것으로 셈하고(오늘까지), 횟수는 월급날이 지났는지로 세요. 그래서 월급날이 지난 달에도 '앞으로 벌 봉급'이 조금 남아 있을 수 있어요."
        : '') +
      (a.holidayBonus && !a.retired
        ? ' 명절휴가비는 설날·추석 날짜를 그 해 달력이 나와야 알 수 있어 세지 않았어요.'
        : ''),
  });
  if (a.diligenceMonths) {
    out.push({
      title: '정근수당 횟수',
      text: `${a.diligenceMonths.map((m) => `${m}월 1일`).join('·')}에 재직 중인 것만 셌어요(공무원수당 등에 관한 규정 제7조). 징계·휴직으로 받지 못하는 경우는 넣지 않았어요.`,
    });
  }
  if (l && a.longServiceAddOn && l.stepAtEnd >= l.maxStep) {
    out.push({
      title: '근속가봉',
      text: '최고호봉 뒤에 붙을 수 있는 근속가봉(공무원보수규정 제30조의2)은 넣지 않았어요.',
    });
  }
  const basis = [
    l
      ? '공무원보수규정 제13조(정기승급)·제20조(보수 지급일)·제22조(보수 계산)·제24조'
      : '공무원보수규정 제20조(보수 지급일)',
    a.diligenceMonths ? '공무원수당 등에 관한 규정 제7조' : '',
    a.retireBasis,
  ].filter(Boolean);
  out.push({ title: '근거', text: `${basis.join(', ')}.` });
  return out;
}
