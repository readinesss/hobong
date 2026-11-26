/**
 * 정년퇴직일 계산. 일반직은 국가공무원법 제74조, 경찰·소방은 연령정년과 계급정년 중 먼저 오는 날,
 * 교원은 교육공무원법 제47조(어느 규정인지는 resolveCareer 가 정한다).
 */
import {
  daysInMonth,
  diffDays,
  formatYmd,
  parseYmd,
  periodCompleteDate,
  type Ymd,
} from './date.ts';
import type { CareerProfile } from './career-profile.ts';
import { rankProblemOff, type CareerRules } from '../rules/career.ts';
import { isAvailable, type Avail, type RankKey, type RetirementRules } from '../rules/types.ts';

export interface RetirementInfo {
  /** 정년에 이른 날: 정년 나이가 되는 출생일 */
  reachDate: Ymd;
  /** 당연퇴직일 */
  retireDate: Ymd;
}

/** 정년(연령·계급)에 이른 날 → 당연퇴직일(구간 규칙은 규정 데이터 periods) */
export function retireDateFor(rules: RetirementRules, reachDate: Ymd): Ymd {
  const { y, m } = parseYmd(reachDate);
  const period = rules.periods.find((p) => m >= p.fromMonth && m <= p.toMonth);
  if (!period) throw new Error(`정년 규정에 ${m}월에 해당하는 구간이 없습니다`);
  // 교원(교육공무원법 제47조제2항): 9~12월이면 다음 해 2월 말일
  const year = y + (period.yearOffset ?? 0);
  const day =
    period.retireDay === 'last' ? daysInMonth(year, period.retireMonth) : period.retireDay;
  return formatYmd({ y: year, m: period.retireMonth, d: day });
}

export function retirementInfo(rules: RetirementRules, birthDate: Ymd): RetirementInfo {
  // 2월 29일생이 평년에 정년에 이르는 드문 경우는 기간 계산 원칙대로 3월 1일로 본다.
  // 일반직·경찰·소방은 어느 쪽이든 1~6월이라 퇴직일이 같다. 교원은 6개월 달라진다(설계 §11.1-2).
  const reachDate = periodCompleteDate(birthDate, rules.age * 12);
  return { reachDate, retireDate: retireDateFor(rules, reachDate) };
}

export interface RankLimitInfo {
  /**
   * 지금 계급의 계급정년(년). 계급정년이 없는 계급(경감·소방경 등)인데 '계급정년에 이르는 날'을
   * 직접 넣은 경우(강등 — 경찰공무원법 제30조제2항, 소방공무원법 제25조제3항)는 null
   */
  years: number | null;
  /** 계급정년에 이른 날: 현 계급 임용일의 N년 기념일(직접 넣은 날이 있으면 그날) */
  reachDate: Ymd;
  /** 당연퇴직일 */
  retireDate: Ymd;
  overridden: boolean;
  /**
   * 현 계급 임용일이 1월 1일·7월 1일이라 '이른 날'을 기념일로 보느냐 그 전날로 보느냐에 따라
   * 퇴직일이 6개월 달라지는 경우(설계 §11.1-1, Q1). 화면이 주의 문구를 띄운다.
   */
  boundary: boolean;
}

/**
 * 계급정년(경찰공무원법 제30조제1항제2호, 소방공무원법 제25조제1항제2호).
 * '이른 날'은 현 계급 임용일의 N년 기념일로 본다(연령정년의 '정년 나이가 되는 출생일'과 같은 방식).
 * override(직접 넣은 '계급정년에 이르는 날')가 있으면 그것을 이른 날로 쓴다. 지금 계급에 계급정년이
 * 없어도(강등된 경감·소방경 — 경찰공무원법 제30조제2항 "경감으로 강등된 경우를 포함한다",
 * 소방공무원법 제25조제3항) 직접 넣은 날은 쓴다. 정년 규정에 계급정년이 없는 직종(일반직·교원)은 늘 null.
 */
export function rankLimitInfo(
  rules: RetirementRules,
  rank: RankKey | null,
  rankDate: Ymd,
  override: Ymd | null = null,
): RankLimitInfo | null {
  if (!rules.rankLimit) return null;
  const years = (rank === null ? undefined : rules.rankLimit.yearsByRank[rank]) ?? null;
  if (override !== null) {
    return {
      years,
      reachDate: override,
      retireDate: retireDateFor(rules, override),
      overridden: true,
      boundary: false,
    };
  }
  if (!years) return null;
  const reachDate = periodCompleteDate(rankDate, years * 12);
  // 기념일이 퇴직 구간의 첫날(경찰·소방 1월 1일·7월 1일)이면, 그 전날로 보는 해석에서는 앞 구간이 된다.
  const { m, d } = parseYmd(rankDate);
  return {
    years,
    reachDate,
    retireDate: retireDateFor(rules, reachDate),
    overridden: false,
    boundary: d === 1 && rules.periods.some((p) => p.fromMonth === m),
  };
}

export interface EffectiveRetirement {
  /** 연령정년 */
  age: RetirementInfo;
  /** 정년 나이(세) */
  ageYears: number;
  /** 계급정년(없는 계급이면 null) */
  rankLimit: RankLimitInfo | null;
  /** 실제로 먼저 오는 당연퇴직일 */
  retireDate: Ymd;
  /** 그날이 무엇 때문인지(같은 날이면 'age') */
  cause: 'age' | 'rankLimit';
}

/**
 * 연령정년과 계급정년 중 먼저 오는 퇴직일. 정년 규정이 꺼진 직종은 그 상태를 그대로 돌려준다.
 * 계급정년이 있는 직종(경찰·소방·해양경찰)에서 계급을 모르면(저장본 rank 가 없거나 사다리에 없음)
 * 계급정년이 앞설 수 있어 연령정년만으로 날짜를 만들지 않는다('계급을 골라 주세요').
 * 단, '계급정년에 이르는 날'을 직접 넣었으면 그날로 계산한다.
 */
export function effectiveRetirement(
  c: CareerRules,
  p: Pick<CareerProfile, 'birthDate' | 'rankDate' | 'overrides'>,
): Avail<EffectiveRetirement> {
  const rules = c.retirement;
  if (!isAvailable(rules)) return rules;
  const override = p.overrides.rankLimitDate;
  if (rules.rankLimit && c.rankProblem !== null && override === null) {
    return rankProblemOff(c.rankProblem, c.ladder?.noun);
  }
  const age = retirementInfo(rules, p.birthDate);
  const rankLimit = rankLimitInfo(rules, c.rank ? c.rank.key : null, p.rankDate, override);
  const byRank = rankLimit !== null && rankLimit.retireDate < age.retireDate;
  return {
    age,
    ageYears: rules.age,
    rankLimit,
    retireDate: byRank ? rankLimit.retireDate : age.retireDate,
    cause: byRank ? 'rankLimit' : 'age',
  };
}

/** 정년 구간 규칙을 글로 만든다('1~6월이면 6월 30일, 7~12월이면 12월 31일'). 규정 데이터 periods 에서 읽는다 */
export function retirePeriodText(rules: RetirementRules): string {
  const months = (from: number, to: number) => (from === to ? `${from}월` : `${from}~${to}월`);
  // 다음 해로 넘어가는 구간이 있으면(교원 9~12월) 같은 해 구간에 '그해'를 붙여 앞 구절에 끌려 읽히지 않게 한다
  const crossesYear = rules.periods.some((p) => (p.yearOffset ?? 0) !== 0);
  return rules.periods
    .map((p) => {
      const offset = p.yearOffset ?? 0;
      const year =
        offset === 1 ? '다음 해 ' : offset === 0 ? (crossesYear ? '그해 ' : '') : `${offset}년 뒤 `;
      const day =
        p.retireDay === 'last'
          ? p.retireMonth === 2
            ? '말일'
            : `${daysInMonth(2001, p.retireMonth)}일`
          : `${p.retireDay}일`;
      return `${months(p.fromMonth, p.toMonth)}이면 ${year}${p.retireMonth}월 ${day}`;
    })
    .join(', ');
}

/**
 * 재직 중의 값(호봉·형태·봉급)을 계산하는 날. 정년퇴직일이 지나면 그날에서 멈춘다
 * (화면과 성장 기록이 같은 날을 쓰게 한다).
 */
export function serviceDayOf(retire: Avail<EffectiveRetirement>, today: Ymd): Ymd {
  return isAvailable(retire) && today > retire.retireDate ? retire.retireDate : today;
}

export interface CareerProgress {
  /** 임용일을 1일째로 센 재직 일수 */
  daysServed: number;
  /** 오늘부터 퇴직일까지 남은 일수(퇴직일 당일이면 0) */
  daysLeft: number;
  /** 임용일~퇴직일 전체 일수 */
  totalDays: number;
  /** 0~1 */
  ratio: number;
  retired: boolean;
}

/**
 * 임용부터 정년까지의 진행 정도.
 * fractionOfToday(0~1)를 주면 오늘 하루가 지난 만큼을 더해 소수점 아래가 움직이게 한다.
 */
export function careerProgress(
  hireDate: Ymd,
  retireDate: Ymd,
  today: Ymd,
  fractionOfToday = 0,
): CareerProgress {
  const totalDays = Math.max(1, diffDays(hireDate, retireDate) + 1);
  const elapsed = diffDays(hireDate, today);
  const daysServed = Math.max(0, elapsed + 1);
  const daysLeft = Math.max(0, diffDays(today, retireDate));
  const retired = today > retireDate;
  const ratio = Math.min(1, Math.max(0, (elapsed + fractionOfToday) / totalDays));
  return {
    daysServed: Math.min(daysServed, totalDays),
    daysLeft,
    totalDays,
    ratio: retired ? 1 : ratio,
    retired,
  };
}
