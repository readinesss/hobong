/**
 * 사용자 데이터 형식(현재 버전). localStorage와 백업 파일에 그대로 들어간다.
 *
 * 원칙
 * - 파생 값(남은 일수, 금액, 연가 잔여 등)은 저장하지 않는다. 불러온 뒤 규정 데이터로 다시 계산한다.
 * - 식별 정보는 받지 않는다(닉네임만).
 * - 형식을 바꾸면 SCHEMA_VERSION을 올리고 migrate.ts에 변환을 추가한다.
 */
import type { Ymd } from '../calc/date.ts';
import type { RankKey, TrackId } from '../rules/types.ts';

export const SCHEMA_VERSION = 4;
export const APP_ID = 'hobong';

/** 일반직 직급 수(v3 까지 저장하던 grade, 별표 3 의 열). v4 부터 저장본은 계급 키(rank) 문자열을 쓴다 */
export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * 일반직의 계급 키(국가공무원법의 1~9급, 우정1~9급). 낮은 계급부터.
 * 규정 데이터와 무관한 코드 상수다 — 저장본 검사가 규정 데이터에 기대지 않게(부록 C).
 */
export const GENERAL_RANKS: readonly RankKey[] = ['9', '8', '7', '6', '5', '4', '3', '2', '1'];

/** 일반직이 고르는 봉급표(공무원보수규정 별표 3·4·8). 그 밖의 직종은 직종이 봉급표를 정하므로 저장하지 않는다 */
export type GeneralPayTableId = 'table3' | 'table4' | 'table8';
export const GENERAL_PAY_TABLES: readonly GeneralPayTableId[] = ['table3', 'table4', 'table8'];

/** 저장본의 계급 키 형식(숫자·한글 1~8자). 어느 사다리의 키인지는 저장본 검사에서 따지지 않는다 */
export const RANK_KEY_RE = /^[0-9가-힣]{1,8}$/;

export interface Profile {
  nickname: string;
  birthDate: Ymd;
  /** 최초 임용일 */
  hireDate: Ymd;
  /** 직종. 정년·봉급표·승진·연가보상비를 가르는 계산 키 */
  track: TrackId;
  /** 일반직이 고른 봉급표. 그 밖의 직종은 null */
  payTable: GeneralPayTableId | null;
  /**
   * 계급 사다리의 계급 키(일반직 '9'~'1', 경찰 '순경' 등). 사다리가 없는 직종은 null.
   * v3 까지의 grade(숫자)를 대신한다.
   */
  rank: RankKey | null;
  /** 현 계급(직급) 임용(승진)일. 승진한 적이 없거나 사다리가 없는 직종은 hireDate와 같다 */
  rankDate: Ymd;
  /** stepAsOf 부터 nextStepDate 전날까지 적용되는 호봉 */
  step: number;
  /** 다음 정기승급일 */
  nextStepDate: Ymd;
  /**
   * 이 호봉을 확인(입력)한 날.
   * 다음 승급일이 1년보다 멀어도(휴직·승급제한) 그날까지는 이 호봉으로 계산하기 위해 둔다.
   */
  stepAsOf: Ymd;
  /** 휴직·경력 인정 등 예외 보정: 값이 있으면 계산값 대신 쓴다 */
  overrides: {
    /** 근속승진 요건 충족일 */
    longServiceDate: Ymd | null;
    /** 대우공무원 선발 예정일 */
    seniorDate: Ymd | null;
    /** 계급정년에 이르는 날(직접 고침). 계급정년이 없는 계급이어도 지우지 않는다(계산에 안 쓴다) */
    rankLimitDate: Ymd | null;
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
  /** 카드에 계급 이름 넣기. 경찰·소방·우정 계급 이름은 직종을 드러내므로 일반직 사다리만 기본 켜짐 */
  showRank: boolean;
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
  /** 마지막으로 연출을 본 계급·호봉(승급·승진 연출을 한 번만 보여주기 위함) */
  lastRank: RankKey | null;
  lastStep: number;
  /** 마지막으로 본 형태 id(형태 변화 감지). 모르는 id 도 지우지 않는다(그릴 때 무시) */
  lastForm: string | null;
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
  maxAchievements: 1000,
  /** 연가 날짜가 들어올 수 있는 해(날짜 계산이 앞뒤로 여유 있게 다루는 범위) */
  minLeaveYear: 1930,
  maxLeaveYear: 2150,
  /** 규정 데이터의 leave.units 와 같은 값이다(테스트가 확인한다). 저장 형식 검증은 규정 파일에 기대지 않는다 */
  leaveHoursPerDay: 8,
  leaveHalfDayHours: 4,
  /** 저장본·봉급표 없는 직종의 호봉 상한. 봉급표가 있으면 입력 폼이 그 표의 최고호봉으로 좁힌다 */
  maxStepAny: 99,
} as const;
