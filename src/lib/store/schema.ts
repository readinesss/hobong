/**
 * 사용자 데이터 형식(현재 버전). localStorage와 백업 파일에 그대로 들어간다.
 *
 * 원칙
 * - 파생 값(남은 일수, 금액, 연가 잔여 등)은 저장하지 않는다. 불러온 뒤 규정 데이터로 다시 계산한다.
 * - 식별 정보는 받지 않는다(닉네임만).
 * - 형식을 바꾸면 SCHEMA_VERSION을 올리고 migrate.ts에 변환을 추가한다.
 */
import type { Ymd } from '../calc/date.ts';

export const SCHEMA_VERSION = 2;
export const APP_ID = 'hobong';

export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const GRADES: readonly Grade[] = [9, 8, 7, 6, 5, 4, 3, 2, 1];

export interface Profile {
  nickname: string;
  birthDate: Ymd;
  /** 최초 임용일 */
  hireDate: Ymd;
  grade: Grade;
  /** 현 직급 임용(승진)일. 승진한 적이 없으면 hireDate와 같다 */
  gradeDate: Ymd;
  /** nextStepDate 전날까지 적용되는 호봉 */
  step: number;
  /** 다음 정기승급일 */
  nextStepDate: Ymd;
  /** 휴직·경력 인정 등 예외 보정: 값이 있으면 계산값 대신 쓴다 */
  overrides: {
    /** 근속승진 요건 충족일 */
    longServiceDate: Ymd | null;
    /** 대우공무원 선발 예정일 */
    seniorDate: Ymd | null;
  };
}

export interface WorkHours {
  /** 'HH:MM' */
  start: string;
  end: string;
  lunchStart: string;
  lunchEnd: string;
}

export type ThemeSetting = 'auto' | 'light' | 'dark';
export type TabTitleSetting = 'default' | 'countdown';
export type CardRatio = 'square' | 'portrait';

export interface CardSettings {
  ratio: CardRatio;
  /** 민감 항목은 기본 꺼짐 */
  showSalary: boolean;
  showRetirement: boolean;
  showTenure: boolean;
  showBadges: boolean;
}

export interface Settings {
  /** 보수 지급일(일) */
  payday: number;
  work: WorkHours;
  theme: ThemeSetting;
  /** true면 OS 설정과 무관하게 움직임을 줄인다 */
  reduceMotion: boolean;
  /** 화면의 금액을 가린다(사무실 모드) */
  hideAmounts: boolean;
  tabTitle: TabTitleSetting;
  card: CardSettings;
}

export type LeaveKind = 'day' | 'am' | 'pm' | 'hours';

export interface LeaveRecord {
  id: string;
  date: Ymd;
  /** 사용 시간(1일 = 8시간, 반일 = 4시간) */
  hours: number;
  kind: LeaveKind;
  memo: string;
}

export interface LeaveData {
  records: LeaveRecord[];
  /** 연도('2026') → 직접 고친 부여 시간. 없으면 재직기간으로 자동 계산 */
  grantOverrideHours: Record<string, number>;
}

export interface CharacterState {
  /** 도감에 등록된 형태 id */
  seenForms: string[];
  /** 마지막으로 연출을 본 직급·호봉(승급·승진 연출을 한 번만 보여주기 위함) */
  lastGrade: Grade;
  lastStep: number;
}

export interface VisitState {
  /** 방문한 날(출근 도장) */
  days: Ymd[];
  /** 직전 방문 날짜(복귀 정산용) */
  lastVisit: Ymd | null;
}

export interface MetaState {
  createdAt: string;
  updatedAt: string;
  /** 마지막으로 백업 파일을 내려받은 시각 */
  lastBackupAt: string | null;
  /** 마지막 백업 이후 바뀐 횟수 */
  changesSinceBackup: number;
}

export interface UserData {
  profile: Profile;
  settings: Settings;
  leave: LeaveData;
  /** 업적 id → 달성일 */
  achievements: Record<string, { at: Ymd }>;
  character: CharacterState;
  visits: VisitState;
  meta: MetaState;
}

/** 백업 파일(그리고 localStorage 저장본)의 겉봉 */
export interface Envelope {
  app: typeof APP_ID;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  data: UserData;
}

export const LIMITS = {
  nicknameMax: 12,
  memoMax: 40,
  maxLeaveRecords: 5000,
  maxVisitDays: 20000,
  minBirthYear: 1930,
  minHireAge: 15,
  maxNextStepYears: 5,
} as const;
