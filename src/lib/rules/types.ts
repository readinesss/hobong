/**
 * 규정 데이터(data/<연도>.json)의 형식.
 * 값은 코드에 두지 않는다. 법령이 바뀌면 데이터 파일만 고친다.
 */

export type GradeKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** 직종(닫힌 목록). 저장 형식 검증이 규정 데이터에 기대지 않도록 코드에 둔다 */
export type TrackId =
  | 'general'
  | 'police'
  | 'coastGuard'
  | 'fire'
  | 'teacher'
  | 'foreign'
  | 'militaryCivil'
  | 'otherSpecial';
export const TRACK_IDS: readonly TrackId[] = [
  'general',
  'police',
  'coastGuard',
  'fire',
  'teacher',
  'foreign',
  'militaryCivil',
  'otherSpecial',
];
/** 봉급표(공무원보수규정 별표). table3 은 기본 구역 salary 에 있다 */
export type PayTableId = 'table3' | 'table4' | 'table8' | 'table10' | 'table11';
export const PAY_TABLE_IDS: readonly PayTableId[] = [
  'table3',
  'table4',
  'table8',
  'table10',
  'table11',
];
/** 기본 구역(salary)이 아닌, payTables 구역에 있는 봉급표 */
export type ExtraPayTableId = Exclude<PayTableId, 'table3'>;
export const EXTRA_PAY_TABLE_IDS: readonly ExtraPayTableId[] = [
  'table4',
  'table8',
  'table10',
  'table11',
];
export type LadderId = 'general' | 'postal' | 'police' | 'fire' | 'teacher' | 'foreign';
/** 계급 사다리 안의 계급 키. 일반직 '9'~'1', 경찰 '순경' 등 */
export type RankKey = string;

/** 항목마다 붙는 근거 */
export interface SourceRef {
  /** laws 레지스트리의 키 */
  law: string;
  /** 조항·별표 */
  article: string;
  /** 해당 조항·별표의 최종 개정일(YYYY-MM-DD) */
  revised?: string;
  /** docs/sources/<연도>/ 아래 발췌본 파일 이름 */
  snapshot?: string;
  /** 해석, 반영하지 않은 예외 등 */
  note?: string;
  /** 함께 근거가 되는 다른 법령·예규(예: 규정의 조항을 예규가 구체화한 경우) */
  also?: { law: string; article: string; snapshot?: string }[];
}

export interface LawInfo {
  name: string;
  /** 확인한 법령(버전)의 시행일 */
  effective: string;
  /** 공포번호·공포일 */
  promulgation: string;
  url: string;
}

/** 정년에 이른 달 → 퇴직일 */
export interface RetirementPeriod {
  fromMonth: number;
  toMonth: number;
  retireMonth: number;
  /** 'last' = 그 달 말일(교원 2월 말일) */
  retireDay: number | 'last';
  /** 정년에 이른 해 기준 몇 해 뒤인지(교원 9~12월 → 다음 해 2월). 없으면 0 */
  yearOffset?: 0 | 1;
}

export interface RetirementRules {
  age: number;
  periods: RetirementPeriod[];
  /** 계급정년(경찰·소방). 현 계급 임용일부터 N년 */
  rankLimit?: { yearsByRank: Partial<Record<RankKey, number>>; source: SourceRef };
  source: SourceRef;
}

/** monthsByGrade 의 키는 계급 사다리의 계급 키(일반직 '9'~'1', 경찰 '순경' 등) */
export interface ProbationRules {
  monthsByGrade: Partial<Record<RankKey, number>>;
  source: SourceRef;
}

export interface SalaryRules {
  currency: 'KRW';
  period: 'month';
  /** 직급 → 호봉(1부터)별 월 봉급 */
  table: Record<GradeKey, number[]>;
  source: SourceRef;
}

export interface StepRaiseRules {
  periodMonths: number;
  dayOfMonth: number;
  source: SourceRef;
}

export interface PromotionStepRules {
  subtract: number;
  minStep: number;
  /** 승진 후 계급에 그 호봉이 없으면 그 계급의 최고호봉으로 한다(별표 28 비고 1) */
  capAtMaxStep: boolean;
  source: SourceRef;
}

export interface PaydayRules {
  options: { day: number; orgs: string }[];
  defaultDay: number;
  shift: 'previous-day-if-saturday-or-holiday';
  source: SourceRef;
}

export interface WorkHoursRules {
  start: string;
  end: string;
  lunchStart: string;
  lunchEnd: string;
  weeklyHours: number;
  source: SourceRef;
}

export interface MonthTier {
  fromMonths: number;
  /** null이면 상한 없음 */
  toMonths: number | null;
  days: number;
  label?: string;
}

export interface YearTier {
  fromYears: number;
  toYears: number | null;
  days: number;
}

/** 장기재직휴가 구간 */
export interface LongLeaveTier extends YearTier {
  /** 이 구간의 휴가가 생긴 날(조항 시행일). 그 전에는 없던 휴가다 */
  effective: string;
  /**
   * 부칙의 사용 특례: 시행 당시 재직기간이 fromYears 이상(이 구간 상한 미만)이던 사람은
   * 구간 상한을 넘겨도 until 까지 쓸 수 있다.
   */
  grace?: { fromYears: number; until: string };
}

export interface LeaveRules {
  annual: { tiers: MonthTier[]; tenureBasis: 'day-before-use'; source: SourceRef };
  units: { hoursPerDay: number; halfDayHours: number; source: SourceRef };
  firstYear: { minDaysForMonth: number; rounding: 'half-up'; source: SourceRef };
  advance: { tiers: MonthTier[]; source: SourceRef };
  compensation: { rate: number; divisor: number; maxDays: number; source: SourceRef };
  longService: { tiers: LongLeaveTier[]; source: SourceRef };
}

/** monthsByGrade 의 키는 계급 사다리의 계급 키(일반직 '9'~'1', 경찰 '순경' 등) */
export interface PromotionRules {
  minService: { monthsByGrade: Partial<Record<RankKey, number>>; source: SourceRef };
  longService: {
    monthsByGrade: Partial<Record<RankKey, number>>;
    /** null 이면 '기간 도달 전 심사' 규정이 없다(경찰) */
    reviewLeadDays: number | null;
    /** 인원 제한이 걸리는 목표 계급(일반직 '6', 경찰 '경감', 소방 '소방경') */
    quotaTo: RankKey | null;
    quotaNote: string;
    source: SourceRef;
  };
  seniorTreatment: {
    monthsByGrade: Partial<Record<RankKey, number>>;
    appointDayOfMonth: number;
    source: SourceRef;
  };
}

export interface PositionAllowanceRules {
  amountByGrade: Partial<Record<RankKey, number>>;
  source: SourceRef;
}

export interface AllowanceRules {
  seniorTreatment: { rate: number; source: SourceRef };
  diligence: {
    payMonths: number[];
    periodMonths: number;
    /** 지급대상기간 중 봉급이 지급된 기간이 이 개월 수 이상이어야 받는다 */
    minMonthsToQualify: number;
    minDaysForMonth: number;
    /** underYears가 null이면 그 이상 전부 */
    tiers: { underYears: number | null; rate: number }[];
    source: SourceRef;
  };
  diligenceExtra: {
    tiers: { underYears: number | null; amount: number }[];
    additional: { fromYears: number; toYears: number | null; amount: number }[];
    source: SourceRef;
  };
  holidayBonus: { rate: number; basisTags: string[]; source: SourceRef };
  meal: { amount: number; source: SourceRef };
  position: PositionAllowanceRules;
}

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** 명절휴가비 기준일 등 계산에 쓰는 표지 */
  tag?: string;
}

export interface HolidayRules {
  items: Holiday[];
  source: SourceRef;
}

/** 공무원보수규정 별표 4·8·10·11 봉급표 하나 */
export interface PayTableRules {
  /** '별표 10' */
  annex: string;
  title: string;
  /** 원문 열 순서 */
  columns: { key: string; label: string }[];
  /** 열 키 → 호봉(1부터)별 월 봉급 */
  table: Record<string, number[]>;
  source: SourceRef;
}
export interface PayTablesSection {
  items: Partial<Record<ExtraPayTableId, PayTableRules>>;
}

export interface LadderRank {
  key: RankKey;
  label: string;
  /** 이 계급이 쓰는 봉급표 열의 키. null 이면 봉급표에 열이 없다 */
  payColumn: string | null;
  /** false 면 사용자가 고를 수 없다(봉급표 열 없음 등) */
  selectable?: boolean;
  /** true 면 화면에 계급 이름을 쓰지 않는다(교원) */
  hideLabel?: boolean;
  note?: string;
}
/** 계급 사다리: 낮은 계급 → 높은 계급 */
export interface Ladder {
  noun: '직급' | '계급' | '직무등급' | null;
  ranks: LadderRank[];
  source: SourceRef;
}

/** 꺼진 항목: pending(원문 미확인) · none(그 직종에 해당 없음) · external(조례 등 다른 규정) */
export type UnavailableStatus = 'pending' | 'none' | 'external';
export interface Unavailable {
  status: UnavailableStatus;
  reason: string;
}
export type Avail<T> = T | Unavailable;
export function isAvailable<T extends object>(v: Avail<T>): v is T {
  return !('status' in v && typeof (v as { status?: unknown }).status === 'string');
}

/** 직종별로 덮어쓰거나 끌 수 있는 규정 항목 */
export type FeatureKey =
  | 'stepRaise'
  | 'promotionStep'
  | 'retirement'
  | 'probation'
  | 'minService'
  | 'longService'
  | 'seniorTreatment'
  | 'leaveAnnual'
  | 'leaveAdvance'
  | 'leaveCompensation'
  | 'leaveLongService'
  | 'diligence'
  | 'holidayBonus'
  | 'seniorAllowance'
  | 'positionAllowance';
export const FEATURE_KEYS: readonly FeatureKey[] = [
  'stepRaise',
  'promotionStep',
  'retirement',
  'probation',
  'minService',
  'longService',
  'seniorTreatment',
  'leaveAnnual',
  'leaveAdvance',
  'leaveCompensation',
  'leaveLongService',
  'diligence',
  'holidayBonus',
  'seniorAllowance',
  'positionAllowance',
];

export interface DiligenceRules {
  diligence: AllowanceRules['diligence'];
  extra: AllowanceRules['diligenceExtra'];
}

export interface CareerOverrides {
  ladder?: LadderId | null;
  stepRaise?: Avail<StepRaiseRules>;
  promotionStep?: Avail<PromotionStepRules>;
  retirement?: Avail<RetirementRules>;
  probation?: Avail<ProbationRules>;
  minService?: Avail<PromotionRules['minService']>;
  longService?: Avail<PromotionRules['longService']>;
  seniorTreatment?: Avail<PromotionRules['seniorTreatment']>;
  leaveAnnual?: Avail<LeaveRules['annual']>;
  leaveAdvance?: Avail<LeaveRules['advance']>;
  leaveCompensation?: Avail<LeaveRules['compensation']>;
  leaveLongService?: Avail<LeaveRules['longService']>;
  diligence?: Avail<DiligenceRules>;
  holidayBonus?: Avail<AllowanceRules['holidayBonus']>;
  seniorAllowance?: Avail<AllowanceRules['seniorTreatment']>;
  positionAllowance?: Avail<PositionAllowanceRules>;
}

/** 연가 화면 문구(교원: 나이스, 저축·이월 없음). 없으면 기본(e-사람 등, 저축·이월 있음) */
export interface LeaveScreenRules {
  recordSystem: string;
  savingCarryOver: boolean;
  source: SourceRef;
}

export interface TrackRules extends CareerOverrides {
  label: string;
  /** 직종 고르기 옆 표시에만 쓴다. 계산은 항목별 해석 결과만 본다 */
  status: 'ready' | 'partial' | 'pending';
  scope: string;
  /** 고를 수 있는 봉급표(일반직만 여럿). 첫째가 기본 */
  payTables: PayTableId[];
  source?: SourceRef;
  payday: { defaultDay: number; note: string };
  /** 덮어쓰지 않고 기본 구역(일반직 값)을 그대로 쓰는 근거 */
  applies?: Partial<Record<FeatureKey, SourceRef>>;
  byPayTable?: Partial<Record<PayTableId, CareerOverrides>>;
  /** 명시하지 않은 항목이 자동으로 pending 이 될 때 보여 줄 사유 */
  pendingReason?: string;
  workHoursNote?: string;
  leaveNote?: string;
  leaveScreen?: LeaveScreenRules;
  notes?: string[];
}

export interface TracksSection {
  ladders: Record<LadderId, Ladder>;
  items: Record<TrackId, TrackRules>;
}

/** 일반직 기본 구역(열한 개). 근거 법령 화면이 이 순서로 보여 준다 */
export interface BaseRuleSections {
  retirement: RetirementRules;
  probation: ProbationRules;
  salary: SalaryRules;
  stepRaise: StepRaiseRules;
  promotionStep: PromotionStepRules;
  payday: PaydayRules;
  workHours: WorkHoursRules;
  leave: LeaveRules;
  promotion: PromotionRules;
  allowances: AllowanceRules;
  holidays: HolidayRules;
}

/** 직종 확대 구역: 별표 4·8·10·11 봉급표, 직종별 규정·계급 사다리 */
export interface CareerRuleSections {
  payTables: PayTablesSection;
  tracks: TracksSection;
}

/** 연도 파일에 들어갈 수 있는 규정 항목(열세 구역) */
export interface RuleSections extends BaseRuleSections, CareerRuleSections {}

/** 일반직 기본 구역의 키(열한 개) */
export type SectionKey = keyof BaseRuleSections;
/** 직종 확대 구역의 키 */
export type CareerSectionKey = keyof CareerRuleSections;
/** 모든 구역의 키(열세 개) */
export type RuleSectionKey = SectionKey | CareerSectionKey;

export const SECTION_KEYS: readonly SectionKey[] = [
  'retirement',
  'probation',
  'salary',
  'stepRaise',
  'promotionStep',
  'payday',
  'workHours',
  'leave',
  'promotion',
  'allowances',
  'holidays',
];
export const CAREER_SECTION_KEYS: readonly CareerSectionKey[] = ['payTables', 'tracks'];
/** 어느 해든 extends 를 따라가 모두 있어야 하는 구역(열세 개) */
export const RULE_SECTION_KEYS: readonly RuleSectionKey[] = [
  ...SECTION_KEYS,
  ...CAREER_SECTION_KEYS,
];

/** data/<연도>.json 원본 */
export interface RulesFile extends Partial<RuleSections> {
  schema: 1;
  year: number;
  /** 이 연도 파일에 없는 항목을 가져올 연도 */
  extends?: number;
  target: { id: string; label: string };
  /** verified: 모든 항목 확인 / partial: 일부만 확정(나머지는 extends 연도 값) */
  status: 'verified' | 'partial';
  /** 원문 확인일 */
  verifiedAt: string;
  /** 아직 확정되지 않아 이전 연도 값을 쓰는 항목 */
  pending?: RuleSectionKey[];
  notes?: string[];
  laws: Record<string, LawInfo>;
}

/** 한 해에 적용할, 빠진 항목이 없는 규정 */
export interface Rules extends RuleSections {
  /** 이 규정을 적용하려는 연도 */
  year: number;
  target: { id: string; label: string };
  laws: Record<string, LawInfo>;
  meta: {
    /** 각 항목이 실제로 어느 연도 파일에서 왔는지 */
    sectionYear: Record<RuleSectionKey, number>;
    /** 봉급표마다 실제로 어느 연도 파일에서 왔는지(table3 은 sectionYear.salary) */
    payTableYear: Record<PayTableId, number>;
    /** 해당 연도 파일이 없어 이전 연도 파일을 통째로 쓰는 중인지 */
    fallback: boolean;
    /** 해당 연도 파일이 있다면 그 상태 */
    status: 'verified' | 'partial';
    verifiedAt: string;
    notes: string[];
  };
}
