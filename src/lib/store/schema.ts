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

export const SCHEMA_VERSION = 5;
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

/**
 * 저장본의 직렬 키 형식. 직렬 키는 data/series.json 의 원문 직렬 이름('행정'·'간호')이다.
 * 저장본 검사는 형식만 본다 — 목록에 없는 직렬(데이터가 바뀜)도 거부하지 않고, 화면에 이름을 보이지 않을 뿐이다.
 * 앞으로 원문 이름에 가운뎃점·띄어쓰기가 들어와도('검찰·마약', '출입국 관리') 같은 v5 의 예전 사본이 백업 전체를
 * 거부하지 않게 미리 받는다(앞뒤 공백·겹친 공백은 받지 않는다). series.json 의 이름·aliases 는 이 형식을 지킨다(테스트).
 */
export const SERIES_KEY_RE = /^(?=.{1,20}$)[0-9A-Za-z가-힣·]+(?: [0-9A-Za-z가-힣·]+)*$/;

/**
 * 꾸미기·소리 목록의 id 형식. 목록은 같은 저장 형식 버전에서도 늘어나므로(새 장식·새 배경음악)
 * 저장본 검사는 이 형식만 보고, 모르는 id 는 거부하지 않고 그대로 둔다(그릴 때만 기본값으로 대신한다).
 * 예전 사본이 새 장식 id 하나 때문에 백업 전체를 거부하지 않게. 그러려면 새 id 도 이 형식을 지켜야 한다
 * (character.json custom 의 모든 id 를 테스트가 본다). 새 칸(예: deco.hat)이나 열거값(pointer 등)을 더하면
 * 예전 사본이 버리거나 거부하므로 저장 형식 버전을 올린다(docs/DATA.md).
 */
export const LOOK_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

export interface Profile {
  nickname: string;
  birthDate: Ymd;
  /** 최초 임용일 */
  hireDate: Ymd;
  /** 직종. 정년·봉급표·승진·연가보상비를 가르는 계산 키 */
  track: TrackId;
  /**
   * 일반직의 직렬(data/series.json 의 원문 이름, 예: '간호'). 고르지 않으면 null(기본).
   * 계산에는 쓰지 않고 호봉이 소품(테마)과, 사용자가 켠 곳의 이름 표시에만 쓴다.
   * 소속을 짐작하게 할 수 있어 이 브라우저(와 사용자가 내려받은 백업 파일)에만 둔다.
   * 일반직이 아니면 쓰지 않는다(값은 지우지 않는다 — 직종을 되돌리면 다시 쓴다).
   */
  series: string | null;
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
  /** 카드에 직렬 이름 넣기. 카드는 앱 밖으로 나가므로 기본 꺼짐 */
  showSeries: boolean;
}

/** 내 정보를 어디에 보일지(본인 화면) */
export interface IdentitySettings {
  /** 홈 상태창에 직렬·계급 이름 보이기. 본인 화면이라 기본 켬. 직렬을 고르지 않았으면 보일 것이 없다 */
  showSeriesHome: boolean;
}

/** 소리(#24). 모두 기본 꺼짐 — 소리가 뜻을 전하는 유일한 수단이 되지 않게 한다 */
export interface SoundSettings {
  /** 효과음 */
  sfx: boolean;
  /** 배경음악 */
  bgm: boolean;
  /** 전체 음량 0~100 */
  master: number;
  sfxVolume: number;
  bgmVolume: number;
  /** 배경음악 곡 id. 'auto' 는 시간·기분에 맞춰 고른다. 모르는 곡 id 는 보존하고 틀 때만 'auto' 로 */
  bgmTrack: string;
}

/** 마우스 포인터: 픽셀 포인터(기본) 또는 기기 기본 포인터(#25) */
export type PointerSetting = 'pixel' | 'system';

/**
 * 호봉이 꾸미기(#17·#16). 값은 data/character.json custom 구역의 id 다.
 * 모르는 id 는 저장본에 그대로 두고 그릴 때만 기본값으로 대신한다(LOOK_ID_RE 참고).
 */
export interface CharacterLook {
  /** 몸 색(custom.bodies). 기본 'sunny'(햇살) */
  body: string;
  /** 볏 색(custom.crests). 기본 'red'. 깃봉이(7급)부터 보인다 */
  crest: string;
  /** 깃 색(custom.plumes). 'auto' 는 몸 색과 겹치지 않는 깃 */
  plume: string;
  deco: {
    /** 머리핀(custom.decos slot 'pin'). 없으면 null */
    pin: string | null;
    /** 가슴 배지(slot 'chest'). 없으면 null */
    chest: string | null;
    /** 볼 터치 */
    cheek: boolean;
  };
  /**
   * 왼손 소품. 'auto' = 고른 직렬(일반직)의 소품, 없거나 특정직이면 호봉 소품(9호봉부터 결재판).
   * 특정직의 직종 소품(손전등 등)은 그 id 를 직접 고를 때만 든다.
   * 'none' = 들지 않음. 그 밖은 custom.props 의 id. 직렬 이름과 따로 저장한다(이름을 숨겨도 소품은 보인다).
   */
  prop: string;
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
  identity: IdentitySettings;
  /** 진동(지원하는 기기에서만 의미가 있다). 움직임 줄이기가 켜져 있으면 울리지 않는다 */
  haptics: boolean;
  sound: SoundSettings;
  pointer: PointerSetting;
  /** 누를 때 반짝이 같은 손맛 연출(#25). 움직임 줄이기가 켜져 있으면 보이지 않는다 */
  sparkles: boolean;
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
  /** 꾸미기 */
  look: CharacterLook;
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
  /** 음량(settings.sound) 범위 */
  maxVolume: 100,
} as const;
