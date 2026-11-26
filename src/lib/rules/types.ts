/**
 * 규정 데이터(data/<연도>.json)의 형식.
 * 값은 코드에 두지 않는다. 법령이 바뀌면 데이터 파일만 고친다.
 */

export type GradeKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

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

export interface RetirementRules {
  age: number;
  /** 정년에 이른 달 → 퇴직일 */
  periods: { fromMonth: number; toMonth: number; retireMonth: number; retireDay: number }[];
  source: SourceRef;
}

export interface ProbationRules {
  monthsByGrade: Partial<Record<GradeKey, number>>;
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

export interface PromotionRules {
  minService: { monthsByGrade: Partial<Record<GradeKey, number>>; source: SourceRef };
  longService: {
    monthsByGrade: Partial<Record<GradeKey, number>>;
    reviewLeadDays: number;
    quotaNote: string;
    source: SourceRef;
  };
  seniorTreatment: {
    monthsByGrade: Partial<Record<GradeKey, number>>;
    appointDayOfMonth: number;
    source: SourceRef;
  };
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
  position: { amountByGrade: Partial<Record<GradeKey, number>>; source: SourceRef };
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

/** 연도 파일에 들어갈 수 있는 규정 항목 */
export interface RuleSections {
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

export type SectionKey = keyof RuleSections;

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
  pending?: SectionKey[];
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
    sectionYear: Record<SectionKey, number>;
    /** 해당 연도 파일이 없어 이전 연도 파일을 통째로 쓰는 중인지 */
    fallback: boolean;
    /** 해당 연도 파일이 있다면 그 상태 */
    status: 'verified' | 'partial';
    verifiedAt: string;
    notes: string[];
  };
}
