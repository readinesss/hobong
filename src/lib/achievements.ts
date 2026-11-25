/**
 * 업적 뱃지.
 * - 날짜·상태로 정해지는 업적(일정, 호봉)은 저장하지 않고 매번 다시 계산한다.
 * - 한 번 얻으면 남는 업적(행동, 연도별 연가, 출근 도장)은 사용자 데이터에 달성일과 함께 남긴다.
 */
import { addDays, diffDays, formatKorean, todayYmd, yearOf, type Ymd } from './calc/date.ts';
import type { Calendar } from './calc/calendar.ts';
import type { LeaveSummary } from './calc/leave.ts';
import type { Milestone } from './calc/milestones.ts';
import { raiseDate, type StepAnchor } from './calc/step.ts';
import type { LeaveRecord, UserData } from './store/schema.ts';

export type Tier = 'bronze' | 'silver' | 'gold';
export type AchievementGroup = 'career' | 'growth' | 'leave' | 'habit';

export interface AchievementView {
  id: string;
  title: string;
  desc: string;
  icon: string;
  tier: Tier;
  group: AchievementGroup;
  /** 달성일. 아직이면 null */
  at: Ymd | null;
  /** 아직 못 얻은 업적의 조건 안내 */
  hint: string | null;
}

/** 일정에서 오는 뱃지의 이름·등급(없으면 일정 제목을 그대로 쓴다) */
const MILESTONE_BADGES: Record<string, { title: string; tier: Tier }> = {
  hire: { title: '첫 출근', tier: 'bronze' },
  probation: { title: '시보 졸업', tier: 'bronze' },
  'anniv-1': { title: '첫 돌', tier: 'bronze' },
  'anniv-3': { title: '삼 년 차', tier: 'bronze' },
  'anniv-5': { title: '다섯 해', tier: 'silver' },
  'anniv-10': { title: '강산이 변했다', tier: 'silver' },
  'anniv-15': { title: '열다섯 해', tier: 'gold' },
  'anniv-20': { title: '스무 해', tier: 'gold' },
  'anniv-25': { title: '스물다섯 해', tier: 'gold' },
  'anniv-30': { title: '서른 해 한길', tier: 'gold' },
  'anniv-35': { title: '서른다섯 해', tier: 'gold' },
  'days-100': { title: '백일', tier: 'bronze' },
  'days-1000': { title: '천 일의 출근', tier: 'bronze' },
  'days-3000': { title: '삼천 일', tier: 'silver' },
  'days-5000': { title: '오천 일', tier: 'silver' },
  'days-10000': { title: '만 일의 출근', tier: 'gold' },
  'leave-21': { title: '쉼표 스물하나', tier: 'silver' },
  'long-leave-5': { title: '장기재직휴가 3일', tier: 'bronze' },
  'long-leave-10': { title: '장기재직휴가 5일', tier: 'silver' },
  'long-leave-20': { title: '장기재직휴가 7일', tier: 'gold' },
  'retire-half': { title: '반환점', tier: 'gold' },
};

const STEP_BADGES: readonly { step: number; title: string; tier: Tier }[] = [
  { step: 5, title: '다섯 번째 깃', tier: 'bronze' },
  { step: 10, title: '열 번째 깃', tier: 'silver' },
  { step: 20, title: '스무 번째 깃', tier: 'gold' },
  { step: 30, title: '서른 번째 깃', tier: 'gold' },
];

const VISIT_BADGES: readonly { count: number; tier: Tier }[] = [
  { count: 7, tier: 'bronze' },
  { count: 30, tier: 'silver' },
  { count: 100, tier: 'gold' },
  { count: 365, tier: 'gold' },
];

/** 행동으로 얻는 업적(앱이 직접 부여) */
export const EVENT_BADGES = {
  'evt-card': {
    title: '첫 명함',
    desc: '호봉이 카드를 만들었다.',
    icon: 'icon-camera',
    tier: 'bronze',
  },
  'evt-night': {
    title: '야근 모드',
    desc: '어두운 화면을 켰다. 오늘도 수고 많으셨습니다.',
    icon: 'icon-moon',
    tier: 'bronze',
  },
} as const satisfies Record<string, { title: string; desc: string; icon: string; tier: Tier }>;

export type EventBadgeId = keyof typeof EVENT_BADGES;

export interface AchievementInput {
  today: Ymd;
  data: UserData;
  milestones: readonly Milestone[];
  /** 오늘 기준 호봉 */
  currentStep: number;
  anchor: StepAnchor;
  leave: LeaveSummary;
  cal: Calendar;
}

function groupOfMilestone(m: Milestone): AchievementGroup {
  return m.kind === 'leave' ? 'leave' : 'career';
}

/** 하루를 통째로 쉰 연가 날짜 */
export function fullDayLeaveDates(records: readonly LeaveRecord[], hoursPerDay: number): Set<Ymd> {
  const hours = new Map<Ymd, number>();
  for (const r of records) hours.set(r.date, (hours.get(r.date) ?? 0) + r.hours);
  return new Set([...hours].filter(([, h]) => h >= hoursPerDay).map(([d]) => d));
}

/** 연가를 붙여 minDays일 이상 이어 쉰 적이 있으면 그 마지막 날(오늘까지 끝난 것만) */
export function longRestEnd(
  cal: Calendar,
  records: readonly LeaveRecord[],
  hoursPerDay: number,
  today: Ymd,
  minDays = 5,
): Ymd | null {
  const leaveDays = fullDayLeaveDates(records, hoursPerDay);
  const isOff = (d: Ymd) => leaveDays.has(d) || !cal.isWorkday(d);
  let best: Ymd | null = null;
  for (const day of [...leaveDays].sort()) {
    let start = day;
    while (isOff(addDays(start, -1))) start = addDays(start, -1);
    let end = day;
    let length = diffDays(start, day) + 1;
    while (isOff(addDays(end, 1)) && length < 60) {
      end = addDays(end, 1);
      length += 1;
    }
    if (length >= minDays && end <= today && (best === null || end < best)) best = end;
  }
  return best;
}

/**
 * 지금 얻은 것으로 볼 업적(id → 달성일).
 * stored에 있던 "남는 업적"은 그대로 두고, 다시 계산하는 업적은 현재 입력값으로 새로 정한다.
 */
export function evaluateAchievements(input: AchievementInput): Record<string, { at: Ymd }> {
  const { today, data, milestones, currentStep, anchor, leave, cal } = input;
  const out: Record<string, { at: Ymd }> = {};

  // 1) 다시 계산하는 업적: 지나간 일정
  for (const m of milestones) {
    if (m.badge && m.date <= today) out[m.id] = { at: m.date };
  }
  // 호봉
  for (const badge of STEP_BADGES) {
    if (currentStep >= badge.step) {
      const reached = raiseDate(anchor, badge.step - anchor.step - 1);
      out[`step-${badge.step}`] = { at: reached <= today ? reached : today };
    }
  }
  // 첫 연가
  const taken = data.leave.records
    .filter((r) => r.date <= today)
    .map((r) => r.date)
    .sort();
  if (taken[0]) out['leave-first'] = { at: taken[0] };

  // 2) 한 번 얻으면 남는 업적
  const sticky = (id: string, at: Ymd | null) => {
    const stored = data.achievements[id];
    if (stored) out[id] = stored;
    else if (at !== null) out[id] = { at };
  };
  for (const [id, value] of Object.entries(data.achievements)) {
    if (isStickyId(id)) out[id] = value;
  }
  const year = yearOf(today);
  const takenHours = leave.usedHours - leave.plannedHours;
  if (leave.grantedHours > 0) {
    sticky(`leave-half-${year}`, takenHours * 2 >= leave.grantedHours ? today : null);
    sticky(`leave-full-${year}`, takenHours >= leave.grantedHours ? today : null);
  }
  sticky('long-rest', longRestEnd(cal, data.leave.records, leave.hoursPerDay, today));
  for (const badge of VISIT_BADGES) {
    const day = data.visits.days[badge.count - 1];
    sticky(`visit-${badge.count}`, day ?? null);
  }
  sticky(
    'evt-payday',
    cal.payday(year, Number(today.slice(5, 7)), data.settings.payday) === today ? today : null,
  );
  sticky('evt-backup', data.meta.lastBackupAt ? todayYmd(new Date(data.meta.lastBackupAt)) : null);
  return out;
}

export function isStickyId(id: string): boolean {
  return (
    id.startsWith('evt-') ||
    id.startsWith('visit-') ||
    id.startsWith('leave-half-') ||
    id.startsWith('leave-full-') ||
    id === 'long-rest'
  );
}

/** 새로 얻은 업적 id(저장된 것에 없던 것) */
export function freshAchievements(
  stored: Record<string, { at: Ymd }>,
  earned: Record<string, { at: Ymd }>,
): string[] {
  return Object.keys(earned).filter((id) => !(id in stored));
}

/** 화면에 보여줄 뱃지 목록: 얻은 것(최근순) → 아직인 것(가까운 순) */
export function achievementViews(
  input: AchievementInput,
  earned: Record<string, { at: Ymd }>,
): AchievementView[] {
  const { today, milestones, leave } = input;
  const views: AchievementView[] = [];
  const year = yearOf(today);
  const at = (id: string) => earned[id]?.at ?? null;

  for (const m of milestones) {
    if (!m.badge) continue;
    const meta = MILESTONE_BADGES[m.id];
    views.push({
      id: m.id,
      title: meta?.title ?? m.title,
      desc: m.detail,
      icon: m.icon,
      tier: meta?.tier ?? 'bronze',
      group: groupOfMilestone(m),
      at: at(m.id),
      hint: at(m.id) ? null : `${formatKorean(m.date, false)} 예정`,
    });
  }
  for (const badge of STEP_BADGES) {
    const id = `step-${badge.step}`;
    views.push({
      id,
      title: badge.title,
      desc: `${badge.step}호봉에 올랐다.`,
      icon: 'icon-feather',
      tier: badge.tier,
      group: 'growth',
      at: at(id),
      hint: at(id) ? null : `${badge.step}호봉이 되면`,
    });
  }
  views.push({
    id: 'leave-first',
    title: '첫 연가',
    desc: '쉬는 것도 일의 일부.',
    icon: 'icon-palm',
    tier: 'bronze',
    group: 'leave',
    at: at('leave-first'),
    hint: at('leave-first') ? null : '연가를 처음 기록하면',
  });
  // 연도별 연가 업적: 올해 것과, 예전에 얻어 둔 것
  const leaveYears = new Set<number>([year]);
  for (const id of Object.keys(earned)) {
    const match = /^leave-(?:half|full)-(\d{4})$/.exec(id);
    if (match) leaveYears.add(Number(match[1]));
  }
  for (const y of [...leaveYears].sort((a, b) => b - a)) {
    const granted = y === year && leave.grantedHours > 0;
    views.push({
      id: `leave-half-${y}`,
      title: `절반의 쉼표 ${y}`,
      desc: `${y}년 연가의 절반을 썼다.`,
      icon: 'icon-palm',
      tier: 'silver',
      group: 'leave',
      at: at(`leave-half-${y}`),
      hint: at(`leave-half-${y}`) ? null : granted ? '올해 연가의 절반을 쓰면' : null,
    });
    views.push({
      id: `leave-full-${y}`,
      title: `연가 완주 ${y}`,
      desc: `${y}년 연가를 모두 썼다. 잘 쉬는 것도 실력.`,
      icon: 'icon-trophy',
      tier: 'gold',
      group: 'leave',
      at: at(`leave-full-${y}`),
      hint: at(`leave-full-${y}`) ? null : granted ? '올해 연가를 모두 쓰면' : null,
    });
  }
  views.push({
    id: 'long-rest',
    title: '긴 숨 고르기',
    desc: '연가를 붙여 닷새 넘게 이어 쉬었다.',
    icon: 'icon-plane',
    tier: 'silver',
    group: 'leave',
    at: at('long-rest'),
    hint: at('long-rest') ? null : '주말·공휴일에 연가를 붙여 5일 이상 쉬면',
  });
  for (const badge of VISIT_BADGES) {
    const id = `visit-${badge.count}`;
    views.push({
      id,
      title: `출근 도장 ${badge.count}개`,
      desc: `호봉이를 ${badge.count}일 들여다봤다.`,
      icon: 'icon-stamp',
      tier: badge.tier,
      group: 'habit',
      at: at(id),
      hint: at(id) ? null : `들른 날이 ${badge.count}일이 되면`,
    });
  }
  views.push({
    id: 'evt-payday',
    title: '봉급날 출석',
    desc: '봉급날에 들렀다.',
    icon: 'icon-coin',
    tier: 'bronze',
    group: 'habit',
    at: at('evt-payday'),
    hint: at('evt-payday') ? null : '봉급날에 들르면',
  });
  views.push({
    id: 'evt-backup',
    title: '꼼꼼한 백업',
    desc: '데이터를 파일로 내려받았다.',
    icon: 'icon-save',
    tier: 'bronze',
    group: 'habit',
    at: at('evt-backup'),
    hint: at('evt-backup') ? null : '데이터를 내려받으면',
  });
  for (const [id, def] of Object.entries(EVENT_BADGES)) {
    views.push({
      id,
      title: def.title,
      desc: def.desc,
      icon: def.icon,
      tier: def.tier,
      group: 'habit',
      at: at(id),
      hint: at(id) ? null : id === 'evt-card' ? '카드를 저장하거나 복사하면' : '어두운 화면을 켜면',
    });
  }

  const earnedViews = views
    .filter((v) => v.at !== null)
    .sort((a, b) => ((a.at as Ymd) < (b.at as Ymd) ? 1 : -1));
  const locked = views.filter((v) => v.at === null && v.hint !== null);
  return [...earnedViews, ...locked];
}
