/**
 * 공직 생활의 일정(퀘스트 로그).
 * 지나간 일정은 업적이 되고, 다가오는 일정은 "다음 도착점"이 된다.
 * 모두 입력값과 규정 데이터에서 다시 계산할 수 있으므로 저장하지 않는다.
 */
import {
  addDays,
  addMonthsClamped,
  diffDays,
  periodCompleteDate,
  yearOf,
  type Ymd,
} from './date.ts';
import type { RulesProvider } from './calendar.ts';
import { tierDays } from './leave.ts';
import { longServiceInfo, minServiceDate, seniorTreatmentInfo } from './promotion.ts';
import { retirementInfo } from './retirement.ts';
import { gradeKey, maxStepOf } from './salary.ts';
import { nextRaiseDate, stepOn } from './step.ts';
import type { Profile } from '../store/schema.ts';

export type MilestoneKind = 'career' | 'leave' | 'pay' | 'promotion' | 'retire';

export interface Milestone {
  id: string;
  date: Ymd;
  title: string;
  detail: string;
  /** 아이콘 스프라이트 이름 */
  icon: string;
  kind: MilestoneKind;
  /** 지나가면 업적 뱃지가 되는 일정 */
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

/** 임용일부터 정년퇴직일까지의 모든 일정(날짜순) */
export function buildMilestones(rules: RulesProvider, profile: Profile, today: Ymd): Milestone[] {
  const r = rules(yearOf(today));
  const { hireDate, gradeDate, grade } = profile;
  const retire = retirementInfo(r.retirement, profile.birthDate).retireDate;
  const out: Milestone[] = [];
  const push = (m: Milestone) => {
    if (m.date >= hireDate && m.date <= retire) out.push(m);
  };

  push({
    id: 'hire',
    date: hireDate,
    title: '첫 출근',
    detail: '임용장을 받은 날. 호봉이가 알에서 깨어났다.',
    icon: 'icon-egg',
    kind: 'career',
    badge: true,
  });

  // 시보 해제: 6급 이하로 재직 중이면 임용 당시에도 6급 이하였으므로 6개월로 본다.
  // 5급 이상은 임용 당시 계급을 알 수 없어 넣지 않는다.
  const probationMonths = r.probation.monthsByGrade[gradeKey(grade)];
  if (probationMonths !== undefined && grade >= 6) {
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
  const leaveTiers = r.leave.annual.tiers;
  leaveTiers.forEach((tier, i) => {
    if (tier.fromMonths < 12) return;
    const before = tierDays(leaveTiers, tier.fromMonths - 1);
    const isLast = i === leaveTiers.length - 1;
    push({
      id: `leave-${tier.days}`,
      date: periodCompleteDate(hireDate, tier.fromMonths),
      title: `연가 ${tier.days}일`,
      detail: `재직 ${yearsLabel(tier.fromMonths)}. 한 해 연가가 ${before}일에서 ${tier.days}일로 늘어난다.`,
      icon: 'icon-palm',
      kind: 'leave',
      badge: isLast,
    });
  });

  // 정근수당 지급률이 오르는 날
  const dTiers = r.allowances.diligence.tiers;
  dTiers.forEach((tier, i) => {
    const next = dTiers[i + 1];
    if (tier.underYears === null || !next) return;
    push({
      id: `diligence-${tier.underYears}`,
      date: periodCompleteDate(hireDate, tier.underYears * 12),
      title: `정근수당 ${percent(next.rate)}`,
      detail: `근무연수 ${tier.underYears}년. 지급률이 ${percent(tier.rate)}에서 ${percent(next.rate)}로 오른다(다음 1·7월 지급분부터).`,
      icon: 'icon-gift',
      kind: 'pay',
      badge: false,
    });
  });

  // 장기재직휴가
  for (const tier of r.leave.longService.tiers) {
    push({
      id: `long-leave-${tier.fromYears}`,
      date: periodCompleteDate(hireDate, tier.fromYears * 12),
      title: `장기재직휴가 ${tier.days}일`,
      detail: `재직 ${tier.fromYears}년. ${tier.toYears ? `${tier.toYears}년이 되기 전까지` : '재직 중'} 한 번 쓸 수 있는 ${tier.days}일 휴가가 생긴다.`,
      icon: 'icon-plane',
      kind: 'leave',
      badge: true,
    });
  }

  // 현 직급 기준 일정
  const minDate = minServiceDate(r.promotion, grade, gradeDate);
  const minMonths = r.promotion.minService.monthsByGrade[gradeKey(grade)];
  if (minDate && minMonths !== undefined && grade > 1) {
    push({
      id: `min-service-${grade}`,
      date: minDate,
      title: '승진소요최저연수 충족',
      detail: `${grade}급으로 ${yearsLabel(minMonths)} 재직. ${grade - 1}급 승진 심사 대상이 될 수 있는 최소 기간을 채운다.`,
      icon: 'icon-stairs',
      kind: 'promotion',
      badge: false,
    });
  }
  const senior = seniorTreatmentInfo(r.promotion, profile);
  if (senior.applicable && senior.date && senior.requiredMonths !== null) {
    push({
      id: `senior-${grade}`,
      date: senior.date,
      title: `${grade - 1}급 대우공무원 요건`,
      detail: senior.overridden
        ? '직접 입력한 선발 예정일.'
        : `${grade}급으로 ${yearsLabel(senior.requiredMonths)} 근무. 요건을 채운 뒤 처음 오는 1일에 선발될 수 있다(근무실적 요건 별도).`,
      icon: 'icon-medal',
      kind: 'promotion',
      badge: false,
    });
  }
  const longService = longServiceInfo(r.promotion, profile);
  if (longService.applicable && longService.date && longService.requiredMonths !== null) {
    push({
      id: `long-service-${grade}`,
      date: longService.date,
      title: `${grade - 1}급 근속승진 요건`,
      detail: longService.overridden
        ? '직접 입력한 요건 충족일.'
        : `${grade}급으로 ${yearsLabel(longService.requiredMonths)} 재직. 근속승진 기간을 채운다(승진후보자명부 등재 등 요건 별도).`,
      icon: 'icon-stairs',
      kind: 'promotion',
      badge: false,
    });
  }

  // 다음 정기승급
  const maxStep = maxStepOf(r.salary, grade);
  const nextRaise = nextRaiseDate(profile, today, maxStep, r.stepRaise.periodMonths);
  if (nextRaise) {
    const to = stepOn(profile, nextRaise, maxStep, r.stepRaise.periodMonths);
    push({
      id: `step-${nextRaise}`,
      date: nextRaise,
      title: `정기승급 ${to}호봉`,
      detail: `${to - 1}호봉에서 ${to}호봉으로. 호봉이의 깃이 하나 더 자란다.`,
      icon: 'icon-arrow-up',
      kind: 'pay',
      badge: false,
    });
  }

  // 근속 N주년
  for (let n = 1; n <= 45; n += 1) {
    const date = addMonthsClamped(hireDate, n * 12);
    if (date > retire) break;
    push({
      id: `anniv-${n}`,
      date,
      title: `임용 ${n}주년`,
      detail: n === 10 ? '강산이 한 번 변했다.' : `공직 ${n}년. 수고 많으셨습니다.`,
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
      detail: `출근 도장이 ${mark.days.toLocaleString('ko-KR')}번째 날에 닿는다.`,
      icon: 'icon-calendar',
      kind: 'career',
      badge: mark.badge,
    });
  }

  // 정년까지
  const total = diffDays(hireDate, retire);
  if (total > 0) {
    push({
      id: 'retire-half',
      date: addDays(hireDate, Math.ceil(total / 2)),
      title: '반환점',
      detail: '임용부터 정년까지의 길, 절반을 지난다.',
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
      detail: '봉황이 되어 날아오를 날이 가까워진다.',
      icon: 'icon-hourglass',
      kind: 'retire',
      badge: false,
    });
  }
  push({
    id: 'retire',
    date: retire,
    title: '정년퇴직',
    detail: '긴 길의 끝. 호봉이가 봉황이 되어 날아오른다.',
    icon: 'icon-flag',
    kind: 'retire',
    badge: false,
  });

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
