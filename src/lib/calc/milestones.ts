/**
 * 공직 생활의 일정(퀘스트 로그).
 * 지나간 일정은 업적이 되고, 다가오는 일정은 "다음 도착점"이 된다.
 * 모두 입력값과 규정 데이터에서 다시 계산할 수 있으므로 저장하지 않는다.
 */
import {
  addDays,
  addMonthsClamped,
  diffDays,
  formatKorean,
  periodCompleteDate,
  yearOf,
  type Ymd,
} from './date.ts';
import type { RulesProvider } from './calendar.ts';
import { careerMaxStep, careerOf, type CareerProfile } from './career-profile.ts';
import { tierDays } from './leave.ts';
import {
  longServiceInfo,
  minServiceDate,
  minServiceMonths,
  seniorTreatmentInfo,
} from './promotion.ts';
import { effectiveRetirement } from './retirement.ts';
import { nextRaiseDate, stepOn } from './step.ts';
import { withRo } from '../app/format.ts';
import { rankSlug } from '../rules/career.ts';
import { GENERAL_RANKS } from '../store/schema.ts';
import { isAvailable, type LongLeaveTier } from '../rules/types.ts';

export type MilestoneKind = 'career' | 'leave' | 'pay' | 'promotion' | 'retire';

export interface Milestone {
  id: string;
  date: Ymd;
  title: string;
  detail: string;
  /** 아이콘 스프라이트 이름 */
  icon: string;
  kind: MilestoneKind;
  /** 지나가면 업적 배지가 되는 일정 */
  badge: boolean;
}

const BADGE_ANNIVERSARIES = new Set([1, 3, 5, 10, 15, 20, 25, 30, 35]);
const DAY_MARKS: readonly { days: number; badge: boolean }[] = [
  { days: 100, badge: true },
  { days: 500, badge: false },
  { days: 1000, badge: true },
  { days: 2000, badge: false },
  { days: 3000, badge: true },
  { days: 5000, badge: true },
  { days: 7000, badge: false },
  { days: 10000, badge: true },
];
const RETIRE_COUNTDOWNS: readonly { days: number; label: string }[] = [
  { days: 3650, label: '3,650일(약 10년)' },
  { days: 1000, label: '1,000일' },
  { days: 365, label: '365일' },
  { days: 100, label: '100일' },
];

export interface LongLeaveWindow {
  /** 재직기간이 이 구간에 든 날 */
  reached: Ymd;
  /** 실제로 쓸 수 있게 된 날(조항 시행일보다 앞설 수 없다) */
  from: Ymd;
  /** 쓸 수 있는 마지막 날. 상한이 없는 구간이면 null */
  until: Ymd | null;
  /** 부칙 특례로 기한이 늘었는지 */
  graced: boolean;
}

/**
 * 장기재직휴가를 쓸 수 있는 기간(복무규정 제20조제18항과 부칙).
 * 구간 상한에 닿기 전에 조항이 시행되지 않았고 특례에도 해당하지 않으면 null(가진 적 없는 휴가).
 */
export function longLeaveWindow(tier: LongLeaveTier, hireDate: Ymd): LongLeaveWindow | null {
  const reached = periodCompleteDate(hireDate, tier.fromYears * 12);
  const from = reached > tier.effective ? reached : tier.effective;
  if (tier.toYears === null) return { reached, from, until: null, graced: false };
  // 상한 연수가 되는 날의 전날까지가 이 구간이다.
  const top = periodCompleteDate(hireDate, tier.toYears * 12);
  let until = addDays(top, -1);
  let graced = false;
  if (tier.grace) {
    // 시행 당시 재직기간이 grace.fromYears 이상, 구간 상한 미만이던 사람
    const graceFrom = periodCompleteDate(hireDate, tier.grace.fromYears * 12);
    if (graceFrom <= tier.effective && tier.effective < top && tier.grace.until > until) {
      until = tier.grace.until;
      graced = true;
    }
  }
  return from <= until ? { reached, from, until, graced } : null;
}

/** 연가 장부에 알리는 장기재직휴가 한 구간 */
export interface LongLeaveNotice {
  /** 구간 시작 연수(규정 데이터 값 그대로) */
  fromYears: number;
  /** 상한 연수. 상한이 없는 구간이면 null */
  toYears: number | null;
  days: number;
  /** open: 지금 쓸 수 있다, soon: 1년 안에 생긴다 */
  status: 'open' | 'soon';
  /** 쓸 수 있게 되는(된) 날 */
  from: Ymd;
  /** 쓸 수 있는 마지막 날(정년퇴직일을 넘지 않는다) */
  lastDay: Ymd;
  /** 마지막 날이 정년퇴직일로 정해졌는지(상한 없는 구간 포함) */
  byRetirement: boolean;
  /** 부칙 특례로 기한이 늘었는지 */
  graced: boolean;
  /** 재직기간이 구간에 든 뒤에 조항이 생겨, 쓸 수 있게 된 날이 시행일인지 */
  startsAtEffective: boolean;
  /** 이 구간의 휴가가 생긴 날(조항 시행일) */
  effective: Ymd;
}

/**
 * today 기준으로 지금 쓸 수 있거나 1년 안에 생기는 장기재직휴가(시작일 순).
 * 이미 썼는지는 저장하지 않으므로 알 수 없다. 정년퇴직일 뒤에는 빈 목록이다.
 * retireDate 가 null 이면(정년 규정이 꺼진 직종) 상한 없는 구간은 마지막 날을 몰라 넣지 않는다.
 */
export function longLeaveNotices(
  tiers: readonly LongLeaveTier[],
  hireDate: Ymd,
  today: Ymd,
  retireDate: Ymd | null,
): LongLeaveNotice[] {
  if (retireDate !== null && today > retireDate) return [];
  const horizon = addMonthsClamped(today, 12);
  const out: LongLeaveNotice[] = [];
  for (const tier of tiers) {
    const w = longLeaveWindow(tier, hireDate);
    if (!w) continue;
    // 정년을 계산하지 않는 직종(준비 중)은 상한 없는 구간의 마지막 날을 알 수 없어 넣지 않는다.
    if (retireDate === null && w.until === null) continue;
    const byRetirement = retireDate !== null && (w.until === null || retireDate < w.until);
    const lastDay = byRetirement ? (retireDate as Ymd) : (w.until as Ymd);
    if (lastDay < today || (retireDate !== null && w.from > retireDate) || w.from > horizon)
      continue;
    out.push({
      fromYears: tier.fromYears,
      toYears: tier.toYears,
      days: tier.days,
      status: w.from <= today ? 'open' : 'soon',
      from: w.from,
      lastDay,
      byRetirement,
      graced: w.graced && !byRetirement,
      startsAtEffective: w.from !== w.reached,
      effective: tier.effective as Ymd,
    });
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

function yearsLabel(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (rest === 0) return `${years}년`;
  if (years === 0) return `${rest}개월`;
  return `${years}년 ${rest}개월`;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** 정년이 꺼진 직종(준비 중)에서 일정을 늘어놓는 끝: 임용 45주년까지 */
const MAX_ANNIVERSARY = 45;

/**
 * 임용일부터 정년퇴직일까지의 모든 일정(날짜순).
 * 규정이 꺼진 항목(준비 중·해당 없음)의 일정은 넣지 않는다. 정년이 꺼져 있으면 정년 계열도 없다.
 */
export function buildMilestones(
  rules: RulesProvider,
  profile: CareerProfile,
  today: Ymd,
): Milestone[] {
  const c = careerOf(rules, profile, yearOf(today));
  const { hireDate, rankDate } = profile;
  const rank = c.rank;
  const eff = effectiveRetirement(c, profile);
  const retirement = isAvailable(eff) ? eff : null;
  const retire = retirement ? retirement.retireDate : null;
  const out: Milestone[] = [];
  const push = (m: Milestone) => {
    if (m.date >= hireDate && (retire === null || m.date <= retire)) out.push(m);
  };

  push({
    id: 'hire',
    date: hireDate,
    title: '첫 출근',
    detail: '임용장을 받은 날. 호봉이가 알에서 깨어났어요.',
    icon: 'icon-egg',
    kind: 'career',
    badge: true,
  });

  // 시보 해제: 일반직 6급 이하로 재직 중이면 임용 당시에도 6급 이하였으므로 6개월로 본다.
  // 5급 이상은 임용 당시 계급을 알 수 없어 넣지 않는다. 일반직 사다리가 아니면 넣지 않는다(설계 §5.6).
  const probation = c.probation;
  const generalLevel =
    c.ladderId === 'general' && rank && GENERAL_RANKS.includes(rank.key) ? Number(rank.key) : null;
  const probationMonths =
    isAvailable(probation) && rank ? probation.monthsByGrade[rank.key] : undefined;
  if (probationMonths !== undefined && generalLevel !== null && generalLevel >= 6) {
    push({
      id: 'probation',
      date: periodCompleteDate(hireDate, probationMonths),
      title: '시보 해제',
      detail: `임용 후 ${yearsLabel(probationMonths)}. 정규 공무원이 되는 날.`,
      icon: 'icon-sprout',
      kind: 'career',
      badge: true,
    });
  }

  // 연가 일수가 늘어나는 날
  const annual = c.leave.annual;
  if (isAvailable(annual)) {
    const leaveTiers = annual.tiers;
    leaveTiers.forEach((tier, i) => {
      if (tier.fromMonths < 12) return;
      const before = tierDays(leaveTiers, tier.fromMonths - 1);
      const isLast = i === leaveTiers.length - 1;
      push({
        id: `leave-${tier.days}`,
        date: periodCompleteDate(hireDate, tier.fromMonths),
        title: `연가 ${tier.days}일`,
        detail: `재직 ${yearsLabel(tier.fromMonths)}. 한 해 연가가 ${before}일에서 ${tier.days}일로 늘어나요.`,
        icon: 'icon-palm',
        kind: 'leave',
        badge: isLast,
      });
    });
  }

  // 정근수당 지급률이 오르는 날
  const diligence = c.allowances.diligence;
  if (isAvailable(diligence)) {
    const dTiers = diligence.tiers;
    dTiers.forEach((tier, i) => {
      const next = dTiers[i + 1];
      if (tier.underYears === null || !next) return;
      push({
        id: `diligence-${tier.underYears}`,
        date: periodCompleteDate(hireDate, tier.underYears * 12),
        title: `정근수당 ${percent(next.rate)}`,
        detail: `근무연수 ${tier.underYears}년. 지급률이 ${percent(tier.rate)}에서 ${percent(next.rate)}로 올라요(다음 1·7월 지급분부터).`,
        icon: 'icon-gift',
        kind: 'pay',
        badge: false,
      });
    });
  }

  // 장기재직휴가: 조항이 생긴 날 이후에만, 그 구간에 있는 동안만 있는 휴가다.
  const longLeave = c.leave.longService;
  for (const tier of isAvailable(longLeave) ? longLeave.tiers : []) {
    const window = longLeaveWindow(tier, hireDate);
    if (!window) continue;
    const until = window.until ? `${formatKorean(window.until, false)}까지` : '재직하는 동안';
    const why =
      window.from === window.reached
        ? `재직 ${tier.fromYears}년.`
        : `재직 ${tier.fromYears}년을 넘긴 뒤 이 휴가가 새로 생겼다(${formatKorean(tier.effective, false)} 시행).`;
    push({
      id: `long-leave-${tier.fromYears}`,
      date: window.from,
      title: `장기재직휴가 ${tier.days}일`,
      detail: `${why} ${until} 한 번 쓸 수 있는 ${tier.days}일 휴가${window.graced ? '(부칙 특례로 기한이 늘었어요)' : ''}.`,
      icon: 'icon-plane',
      kind: 'leave',
      badge: true,
    });
  }

  // 현 계급 기준 일정(계급 이름은 사다리의 이름: '7급', '경위', '우정7급'…)
  const slug = rankSlug(c);
  const minDate = minServiceDate(c, rankDate);
  const minMonths = minServiceMonths(c);
  if (rank && c.nextRank && minDate && minMonths !== null) {
    push({
      id: `min-service-${slug}`,
      date: minDate,
      title: '승진소요최저연수 충족',
      detail: `${withRo(rank.label)} ${yearsLabel(minMonths)} 재직. ${c.nextRank.label} 승진 심사 대상이 될 수 있는 최소 기간을 채워요.`,
      icon: 'icon-stairs',
      kind: 'promotion',
      badge: false,
    });
  }
  const senior = seniorTreatmentInfo(c, profile);
  if (
    rank &&
    isAvailable(senior) &&
    senior.applicable &&
    senior.targetRank &&
    senior.date &&
    senior.requiredMonths !== null
  ) {
    push({
      id: `senior-${slug}`,
      date: senior.date,
      title: `${senior.targetRank.label} 대우공무원 요건`,
      detail: senior.overridden
        ? '직접 입력한 선발 예정일.'
        : `${withRo(rank.label)} ${yearsLabel(senior.requiredMonths)} 근무. 요건을 채운 뒤 처음 오는 1일에 선발될 수 있다(근무실적 요건 별도).`,
      icon: 'icon-medal',
      kind: 'promotion',
      badge: false,
    });
  }
  const longService = longServiceInfo(c, profile);
  if (
    rank &&
    isAvailable(longService) &&
    longService.applicable &&
    longService.targetRank &&
    longService.date &&
    longService.requiredMonths !== null
  ) {
    // '할 수 있다' 규정임을 밝히는 문구는 규정 데이터(longService.discretionNote)에서 읽는다.
    const note = isAvailable(c.longService) ? c.longService.discretionNote : undefined;
    const discretion = note ? ` ${note}` : '';
    push({
      id: `long-service-${slug}`,
      date: longService.date,
      title: `${longService.targetRank.label} 근속승진 요건`,
      detail: longService.overridden
        ? '직접 입력한 요건 충족일.'
        : `${withRo(rank.label)} ${yearsLabel(longService.requiredMonths)} 재직. 근속승진 기간을 채워요(승진후보자명부 등재 등 요건 별도).${discretion}`,
      icon: 'icon-stairs',
      kind: 'promotion',
      badge: false,
    });
  }

  // 다음 정기승급. 정기승급을 계산하지 않는 직종은 입력한 다음 승급일만 보여 준다(설계 §5.4).
  // 정기승급은 계산하지만 최고호봉을 모르면(계급을 모름 등, 봉급이 꺼짐) 상한을 알 수 없어 일정을 넣지 않는다.
  const stepRaise = c.stepRaise;
  const knownMax = careerMaxStep(c);
  if (isAvailable(stepRaise) && knownMax !== null) {
    const maxStep = knownMax;
    const nextRaise = nextRaiseDate(profile, today, maxStep, stepRaise.periodMonths);
    if (nextRaise) {
      const to = stepOn(profile, nextRaise, maxStep, stepRaise.periodMonths);
      push({
        id: `step-${nextRaise}`,
        date: nextRaise,
        title: `정기승급 ${to}호봉`,
        detail: `${to - 1}호봉에서 ${to}호봉으로. 호봉이의 깃이 하나 더 자라요.`,
        icon: 'icon-arrow-up',
        kind: 'pay',
        badge: false,
      });
    }
  } else if (!isAvailable(stepRaise) && profile.nextStepDate > today) {
    push({
      id: `step-${profile.nextStepDate}`,
      date: profile.nextStepDate,
      title: '다음 승급일(입력한 날)',
      detail: '내 정보에 넣은 다음 승급일이에요. 승급하면 내 정보에서 호봉을 고쳐 주세요.',
      icon: 'icon-arrow-up',
      kind: 'pay',
      badge: false,
    });
  }

  // 근속 N주년
  for (let n = 1; n <= MAX_ANNIVERSARY; n += 1) {
    const date = addMonthsClamped(hireDate, n * 12);
    if (retire !== null && date > retire) break;
    push({
      id: `anniv-${n}`,
      date,
      title: `임용 ${n}주년`,
      detail: n === 10 ? '강산이 한 번 변했어요.' : `공직 ${n}년을 채우는 날.`,
      icon: 'icon-cake',
      kind: 'career',
      badge: BADGE_ANNIVERSARIES.has(n),
    });
  }

  // 임용 N일째
  for (const mark of DAY_MARKS) {
    push({
      id: `days-${mark.days}`,
      date: addDays(hireDate, mark.days - 1),
      title: `임용 ${mark.days.toLocaleString('ko-KR')}일째`,
      detail: `임용한 지 ${mark.days.toLocaleString('ko-KR')}일째 되는 날.`,
      icon: 'icon-calendar',
      kind: 'career',
      badge: mark.badge,
    });
  }

  // 정년까지(연령정년·계급정년 중 먼저 오는 날. 계급정년 전용 일정은 두지 않는다 — 설계 §5.6)
  if (retirement && retire !== null) {
    const total = diffDays(hireDate, retire);
    if (total > 0) {
      push({
        id: 'retire-half',
        date: addDays(hireDate, Math.ceil(total / 2)),
        title: '반환점',
        detail: '임용부터 정년까지의 길, 절반을 지나요.',
        icon: 'icon-mountain',
        kind: 'retire',
        badge: true,
      });
    }
    for (const mark of RETIRE_COUNTDOWNS) {
      push({
        id: `retire-d${mark.days}`,
        date: addDays(retire, -mark.days),
        title: `정년까지 ${mark.label}`,
        detail: '날아오를 날이 가까워져요.',
        icon: 'icon-hourglass',
        kind: 'retire',
        badge: false,
      });
    }
    const limit = retirement.cause === 'rankLimit' ? retirement.rankLimit : null;
    push({
      id: 'retire',
      date: retire,
      title: limit ? '계급정년 퇴직' : '정년퇴직',
      detail: !limit
        ? '긴 길의 끝. 호봉이가 날개를 펴고 날아올라요.'
        : limit.overridden
          ? '직접 넣은 계급정년에 이르는 날로 퇴직해요.'
          : `계급정년(${rank && limit.years !== null ? `${rank.label} ${limit.years}년` : '현 계급'})으로 퇴직해요. 승진하면 달라져요.`,
      icon: 'icon-flag',
      kind: 'retire',
      badge: false,
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

/** today(포함) 이후의 일정 count개 */
export function upcomingMilestones(
  all: readonly Milestone[],
  today: Ymd,
  count: number,
): Milestone[] {
  return all.filter((m) => m.date >= today).slice(0, count);
}

/** today(포함)까지 지나간 일정 */
export function pastMilestones(all: readonly Milestone[], today: Ymd): Milestone[] {
  return all.filter((m) => m.date <= today);
}
