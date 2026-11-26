/**
 * 사용자 데이터 검증.
 * 불러온 파일·저장소의 값은 믿지 않는다. 형식이 맞는 것만 받아 새 객체로 옮겨 담고,
 * 틀린 곳은 사람이 읽을 수 있는 이유와 함께 거부한다(기존 데이터는 건드리지 않는다).
 */
import { josa } from '../app/format.ts';
import { addDays, addMonthsClamped, isValidYmd, maxYmd, parseHm, type Ymd } from '../calc/date.ts';
import { checkWorkHours } from '../calc/today.ts';
import { TRACK_IDS, type PayTableId, type RankKey, type TrackId } from '../rules/types.ts';
import {
  GENERAL_PAY_TABLES,
  GENERAL_RANKS,
  LIMITS,
  RANK_KEY_RE,
  type CardSettings,
  type GeneralPayTableId,
  type Grade,
  type LeaveKind,
  type LeaveRecord,
  type Profile,
  type Settings,
  type UserData,
} from './schema.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 제어 문자와 글자 방향 조작 문자를 지운다(표시 깨짐 방지).
// 이모지를 잇는 U+200C·U+200D 는 남긴다(🧑‍💻 같은 결합 이모지가 낱개로 쪼개지지 않게).
/* eslint-disable no-control-regex -- 제어 문자를 지우려고 일부러 찾는다 */
const UNSAFE_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
/* eslint-enable no-control-regex */

interface SegmenterLike {
  segment(text: string): Iterable<{ segment: string }>;
}
type SegmenterCtor = new (locale: string, options: { granularity: 'grapheme' }) => SegmenterLike;

/** 사람이 한 글자로 보는 단위(글자 묶음)로 나눈다. 지원하지 않는 브라우저에서는 코드포인트 단위 */
export function graphemes(text: string): string[] {
  // Intl.Segmenter 는 빌드 대상(Chrome 88·Safari 14.1·Firefox 78) 일부에 없어 있을 때만 쓴다.
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof Segmenter === 'function') {
    return Array.from(
      new Segmenter('ko', { granularity: 'grapheme' }).segment(text),
      (s) => s.segment,
    );
  }
  return [...text];
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return graphemes(value.replace(UNSAFE_CHARS, '').trim()).slice(0, max).join('');
}

/** v3 까지의 직급(1~9 정수). v1·v2·v3 변환에서만 쓴다 */
export function isGrade(value: unknown): value is Grade {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9;
}

export function isTrackId(value: unknown): value is TrackId {
  return typeof value === 'string' && (TRACK_IDS as readonly string[]).includes(value);
}

/** 저장본의 계급 키 형식(숫자·한글 1~8자) 또는 null. 어느 사다리의 키인지는 따지지 않는다 */
function isRankKeyOrNull(value: unknown): value is RankKey | null {
  return value === null || (typeof value === 'string' && RANK_KEY_RE.test(value));
}

/** 그 직종에 맞는 봉급표 값인지: 일반직은 별표 3·4·8 중 하나, 그 밖은 null */
function payTableFits(track: TrackId, value: unknown): value is GeneralPayTableId | null {
  if (track === 'general') {
    return typeof value === 'string' && (GENERAL_PAY_TABLES as readonly string[]).includes(value);
  }
  return value === null;
}

/**
 * 저장본의 계급 검사(형식만). 키가 있어야 하고, 값은 계급 키 형식의 문자열 또는 null.
 * 직종과 짝짓지 않는다 — 직종에 사다리가 있는지는 규정 데이터가 정하므로, 데이터가 늘어도
 * 멀쩡한 저장본을 거부하지 않게. 하나만 예외: 일반직의 계급 키는 '1'~'9'(코드 상수)다.
 */
function rankFits(track: TrackId | null, value: unknown): boolean {
  if (!isRankKeyOrNull(value)) return false;
  if (track === 'general' && typeof value === 'string') return GENERAL_RANKS.includes(value);
  return true;
}

const ISO_INSTANT_RE = /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** 앱이 쓰는 형식(2026-11-25T01:30:00.000Z)의 시각인지. 연도는 날짜 계산이 받는 범위 안이어야 한다 */
export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_INSTANT_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= 1950 && year <= 2150 && Number.isFinite(Date.parse(value));
}

/** 내 정보 검사가 규정 데이터에 묻는 것(입력 폼·파일 불러오기에서만 쓴다) */
export interface CareerLookup {
  /** 그 직종·봉급표·계급의 최고호봉. 봉급표가 없으면(준비 중) null — 이때는 LIMITS.maxStepAny 까지 받는다 */
  maxStep: (sel: CareerPick) => number | null;
  /** 오류 문구에 쓰는 이름('7급', '경위'). 계급 이름이 없으면 봉급표 이름('교원 봉급표') */
  rankLabel: (sel: CareerPick) => string;
  /** 그 해 규칙의 사다리에서 고를 수 있는 계급 키(낮은 계급부터). 사다리가 없으면 [] */
  selectableRanks: (track: TrackId, payTable: PayTableId | null) => readonly RankKey[];
  /** 그 사다리의 이름('직급'·'계급'·'직무등급'). 사다리가 없거나 이름이 없으면(교원) null */
  rankNoun?: (track: TrackId, payTable: PayTableId | null) => string | null;
}

/** 직종·봉급표·계급 선택(규정 쪽 CareerSel 과 같은 모양) */
export interface CareerPick {
  track: TrackId;
  payTable: PayTableId | null;
  rank: RankKey | null;
}

export interface ProfileContext extends CareerLookup {
  today: Ymd;
  /**
   * 입력 폼에서만 쓰는 추가 검사. 저장된 값에는 쓰지 않는다(시간이 지나면 승급일은 과거가 된다).
   * - future: 다음 승급일은 오늘보다 뒤여야 한다
   * - reached: 최고호봉이 된 날이므로 오늘이거나 오늘보다 앞이어야 한다
   */
  raiseDateRule?: 'future' | 'reached';
  /**
   * true 면 이 브라우저에 저장돼 있던 값을 읽는 중이다. 형식·순서만 보고, "오늘"에 따라
   * 달라지는 검사(오늘보다 뒤인 날짜, 너무 먼 승급일, 최고호봉)와 규정 데이터에 기대는 검사
   * (사다리에서 고를 수 있는 계급인지)는 하지 않는다.
   * (PC 시계를 고치거나 규정 데이터가 바뀌어도 멀쩡한 저장본을 손상으로 보지 않게)
   */
  stored?: boolean;
}

export type ProfileField =
  | 'nickname'
  | 'birthDate'
  | 'hireDate'
  | 'track'
  | 'payTable'
  | 'rank'
  | 'rankDate'
  | 'step'
  | 'nextStepDate'
  | 'stepAsOf'
  | 'longServiceDate'
  | 'seniorDate'
  | 'rankLimitDate';

export type ProfileErrors = Partial<Record<ProfileField, string>>;

/** 입력 폼과 불러오기에서 함께 쓰는 프로필 검사. 문제가 없으면 빈 객체 */
export function checkProfile(raw: unknown, ctx: ProfileContext): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!isDict(raw)) return { nickname: '내 정보가 없어요.' };
  const { today } = ctx;

  const semantic = !ctx.stored;
  const nickname = cleanText(raw.nickname, LIMITS.nicknameMax + 1);
  if (nickname.length === 0) errors.nickname = '닉네임을 넣어 주세요.';
  else if (graphemes(nickname).length > LIMITS.nicknameMax) {
    errors.nickname = `닉네임은 ${LIMITS.nicknameMax}자까지 넣을 수 있어요.`;
  }

  const birth = raw.birthDate;
  if (!isValidYmd(birth)) errors.birthDate = '생년월일을 넣어 주세요.';
  else if (semantic && birth > today) errors.birthDate = '생년월일이 오늘보다 뒤예요.';
  else if (Number(birth.slice(0, 4)) < LIMITS.minBirthYear)
    errors.birthDate = `생년은 ${LIMITS.minBirthYear}년 이후로 넣어 주세요.`;

  const hire = raw.hireDate;
  if (!isValidYmd(hire)) errors.hireDate = '임용일을 넣어 주세요.';
  else if (semantic && hire > today)
    errors.hireDate = '임용일은 오늘이거나 오늘보다 앞이어야 해요.';
  else if (isValidYmd(birth) && hire < addMonthsClamped(birth, LIMITS.minHireAge * 12)) {
    errors.hireDate = '임용일이 생년월일에 비해 너무 일러요.';
  }

  const track = isTrackId(raw.track) ? raw.track : null;
  if (!track) errors.track = '직종을 골라 주세요.';
  const payTable = raw.payTable;
  const payTableOk = track !== null && payTableFits(track, payTable);
  if (track && !payTableOk) errors.payTable = '봉급표를 다시 골라 주세요.';

  const rank = raw.rank;
  // 키가 없으면(undefined) 거부한다. v3 의 손상된 grade 는 변환이 rank 를 만들지 않아 여기서 걸린다.
  const rankOk = 'rank' in raw && rankFits(track, rank);
  if (!rankOk) errors.rank = '직급을 골라 주세요.';
  // 입력 폼·파일: 그 해 규칙의 사다리에서 고를 수 있는 계급이어야 한다(사다리가 없으면 null)
  const choices = semantic && track && payTableOk ? ctx.selectableRanks(track, payTable) : null;
  if (choices && rankOk) {
    const fits = choices.length === 0 ? rank === null : choices.includes(rank as RankKey);
    // 고른 적이 없으면(null) '고를 수 없다'가 아니라 사다리 이름으로 골라 달라고 한다
    const noun =
      rank === null && track && choices.length > 0
        ? (ctx.rankNoun?.(track, payTable as PayTableId | null) ?? null)
        : null;
    if (!fits)
      errors.rank = noun ? `${josa(noun, '을', '를')} 골라 주세요.` : '이 계급은 고를 수 없어요.';
  }
  const sel: CareerPick | null =
    track && payTableOk && rankOk && !errors.rank
      ? { track, payTable, rank: rank as RankKey | null }
      : null;

  const rankDate = raw.rankDate;
  if (!isValidYmd(rankDate)) errors.rankDate = '현 직급 임용일을 넣어 주세요.';
  else if (semantic && rankDate > today)
    errors.rankDate = '현 직급 임용일은 오늘이거나 오늘보다 앞이어야 해요.';
  else if (isValidYmd(hire) && rankDate < hire)
    errors.rankDate = '현 직급 임용일이 최초 임용일보다 앞이에요.';
  // 승진할 계급이 없는 직종(교원은 계급 하나, 그 밖의 특정직 등은 사다리 없음)은 현 직급 임용일을
  // 따로 받지 않는다(폼이 임용일로 맞춰 넣는다)
  else if (choices && choices.length <= 1 && isValidYmd(hire) && rankDate !== hire)
    errors.rankDate = '이 직종은 현 직급 임용일이 최초 임용일과 같아야 해요.';

  const step = raw.step;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > LIMITS.maxStepAny)
    errors.step = '호봉을 넣어 주세요.';
  else if (semantic && sel) {
    const max = ctx.maxStep(sel);
    if (max !== null && step > max)
      errors.step = `${josa(ctx.rankLabel(sel), '은', '는')} ${max}호봉까지 있어요.`;
  }

  const next = raw.nextStepDate;
  const reached = ctx.raiseDateRule === 'reached';
  const nextLabel = reached ? '최고호봉이 된 날' : '다음 승급일';
  if (!isValidYmd(next)) errors.nextStepDate = `${nextLabel}을 넣어 주세요.`;
  else if (isValidYmd(hire) && next <= hire)
    errors.nextStepDate = `${nextLabel}이 임용일보다 뒤여야 해요.`;
  else if (reached && next > today)
    errors.nextStepDate =
      '최고호봉이 된 날은 오늘이거나 오늘보다 앞이어야 해요. 아직 오르기 전이라면 호봉을 한 단계 낮춰 주세요.';
  else if (ctx.raiseDateRule === 'future' && next <= today)
    errors.nextStepDate = '다음 승급일은 오늘보다 뒤여야 해요. 이미 올랐다면 호봉을 올려 주세요.';
  else if (semantic && next > addMonthsClamped(today, LIMITS.maxNextStepYears * 12)) {
    errors.nextStepDate = `다음 승급일은 오늘부터 ${LIMITS.maxNextStepYears}년 안의 날짜로 넣어 주세요.`;
  }

  const asOf = raw.stepAsOf;
  if (asOf !== undefined && asOf !== null) {
    if (!isValidYmd(asOf)) errors.stepAsOf = '호봉을 확인한 날의 형식이 틀렸어요.';
    else if (semantic && isValidYmd(hire) && asOf < hire)
      errors.stepAsOf = '호봉을 확인한 날이 임용일보다 앞이에요.';
  }

  const overrides = raw.overrides;
  if (overrides !== undefined && !isDict(overrides))
    errors.longServiceDate = '예외 보정 값의 형식이 틀렸어요.';
  if (isDict(overrides)) {
    for (const key of ['longServiceDate', 'seniorDate'] as const) {
      const v = overrides[key];
      if (v === null || v === undefined || v === '') continue;
      if (!isValidYmd(v)) errors[key] = '날짜를 다시 확인해 주세요.';
      else if (isValidYmd(rankDate) && v < rankDate)
        errors[key] = '현 직급 임용일보다 뒤여야 해요.';
    }
    // 계급정년 날짜(직접 고침)는 형식만 본다. 승진 뒤처럼 현 직급 임용일보다 이른 값이 남아 있어도,
    // 계급정년이 없는 계급에 있어도 지우거나 거부하지 않고 보존한다(설계 §6.3, 계산은 retirement.ts rankLimitInfo).
    const limit = overrides.rankLimitDate;
    if (limit !== null && limit !== undefined && limit !== '' && !isValidYmd(limit))
      errors.rankLimitDate = '날짜를 다시 확인해 주세요.';
  }
  return errors;
}

export function toProfile(raw: Dict): Profile {
  const overrides = isDict(raw.overrides) ? raw.overrides : {};
  const pick = (v: unknown): Ymd | null => (isValidYmd(v) ? v : null);
  return {
    nickname: cleanText(raw.nickname, LIMITS.nicknameMax),
    birthDate: raw.birthDate as Ymd,
    hireDate: raw.hireDate as Ymd,
    track: raw.track as TrackId,
    payTable: raw.payTable as GeneralPayTableId | null,
    rank: raw.rank as RankKey | null,
    rankDate: raw.rankDate as Ymd,
    step: raw.step as number,
    nextStepDate: raw.nextStepDate as Ymd,
    // 없으면 "다음 승급일 직전 한 해만 이 호봉"으로 보는 것과 같은 값을 넣는다.
    // 임용일보다 앞이면 임용일로 올린다(지나간 호봉 추정이 임용 전까지 늘어나지 않게).
    stepAsOf: maxYmd(
      isValidYmd(raw.stepAsOf) ? raw.stepAsOf : addDays(raw.nextStepDate as Ymd, -1),
      raw.hireDate as Ymd,
    ),
    overrides: {
      longServiceDate: pick(overrides.longServiceDate),
      seniorDate: pick(overrides.seniorDate),
      rankLimitDate: pick(overrides.rankLimitDate),
    },
  };
}

function checkSettings(raw: unknown, errors: string[], semantic: boolean): Settings | null {
  if (!isDict(raw)) {
    errors.push('설정 값이 없어요.');
    return null;
  }
  const before = errors.length;
  const payday = raw.payday;
  if (typeof payday !== 'number' || !Number.isInteger(payday) || payday < 1 || payday > 31) {
    errors.push('설정: 월급날(보수 지급일)은 1~31 사이의 수여야 해요.');
  }
  const work = raw.work;
  const times: Record<string, string> = {};
  if (!isDict(work)) errors.push('설정: 근무시간 값이 없어요.');
  else {
    for (const key of ['start', 'end', 'lunchStart', 'lunchEnd'] as const) {
      const v = work[key];
      if (typeof v !== 'string' || parseHm(v) === null)
        errors.push(`설정: 근무시간(${WORK_LABELS[key]}) 값이 시:분 형식이 아니에요.`);
      else times[key] = v;
    }
    if (semantic && Object.keys(times).length === 4) {
      const problem = checkWorkHours({
        start: times.start as string,
        end: times.end as string,
        lunchStart: times.lunchStart as string,
        lunchEnd: times.lunchEnd as string,
      });
      if (problem) errors.push(`설정: 근무시간 — ${problem}`);
    }
  }
  if (raw.theme !== 'auto' && raw.theme !== 'light' && raw.theme !== 'dark') {
    errors.push('설정: 화면 테마 값이 틀렸어요.');
  }
  if (typeof raw.reduceMotion !== 'boolean') errors.push('설정: 움직임 줄이기 값이 틀렸어요.');
  if (typeof raw.hideAmounts !== 'boolean') errors.push('설정: 금액 가리기 값이 틀렸어요.');
  if (raw.tabTitle !== 'default' && raw.tabTitle !== 'countdown')
    errors.push('설정: 탭 제목 값이 틀렸어요.');
  const card = raw.card;
  let cardOut: CardSettings | null = null;
  if (!isDict(card)) errors.push('설정: 카드 설정이 없어요.');
  else if (
    (card.ratio !== 'square' && card.ratio !== 'portrait') ||
    typeof card.showSalary !== 'boolean' ||
    typeof card.showRetirement !== 'boolean' ||
    typeof card.showTenure !== 'boolean' ||
    typeof card.showBadges !== 'boolean' ||
    typeof card.showRank !== 'boolean'
  ) {
    errors.push('설정: 카드 설정 값이 틀렸어요.');
  } else {
    cardOut = {
      ratio: card.ratio,
      showSalary: card.showSalary,
      showRetirement: card.showRetirement,
      showTenure: card.showTenure,
      showBadges: card.showBadges,
      showRank: card.showRank,
    };
  }
  if (errors.length > before || !cardOut) return null;
  return {
    payday: payday as number,
    work: {
      start: times.start as string,
      end: times.end as string,
      lunchStart: times.lunchStart as string,
      lunchEnd: times.lunchEnd as string,
    },
    theme: raw.theme as Settings['theme'],
    reduceMotion: raw.reduceMotion as boolean,
    hideAmounts: raw.hideAmounts as boolean,
    tabTitle: raw.tabTitle as Settings['tabTitle'],
    card: cardOut,
  };
}

const WORK_LABELS = {
  start: '출근',
  end: '퇴근',
  lunchStart: '점심 시작',
  lunchEnd: '점심 끝',
} as const;

const LEAVE_KINDS: readonly LeaveKind[] = ['day', 'am', 'pm', 'hours'];

/** 연가 종류와 시간이 맞는지(1일 = 8시간, 반일 = 4시간, 시간 연가 = 1~8시간) */
function leaveHoursFit(kind: LeaveKind, hours: number): boolean {
  if (kind === 'day') return hours === LIMITS.leaveHoursPerDay;
  if (kind === 'am' || kind === 'pm') return hours === LIMITS.leaveHalfDayHours;
  return hours >= 1 && hours <= LIMITS.leaveHoursPerDay;
}

/** 연가 날짜가 날짜 계산이 안전하게 다루는 범위 안인지 */
function leaveDateInRange(date: Ymd): boolean {
  const year = Number(date.slice(0, 4));
  return year >= LIMITS.minLeaveYear && year <= LIMITS.maxLeaveYear;
}
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
/** 업적 id: 소문자·숫자·붙임표(앱이 만드는 모든 id 가 이 꼴이다) */
const ACHIEVEMENT_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

function checkLeave(raw: unknown, errors: string[]): UserData['leave'] | null {
  if (!isDict(raw) || !Array.isArray(raw.records) || !isDict(raw.grantOverrideHours)) {
    errors.push('연가 장부의 형식이 틀렸어요.');
    return null;
  }
  if (raw.records.length > LIMITS.maxLeaveRecords) {
    errors.push(`연가 기록이 너무 많아요(${raw.records.length}건).`);
    return null;
  }
  const records: LeaveRecord[] = [];
  const ids = new Set<string>();
  let bad = 0;
  raw.records.forEach((item: unknown, index: number) => {
    if (
      !isDict(item) ||
      typeof item.id !== 'string' ||
      !ID_RE.test(item.id) ||
      ids.has(item.id) ||
      !isValidYmd(item.date) ||
      !leaveDateInRange(item.date) ||
      typeof item.hours !== 'number' ||
      !Number.isInteger(item.hours) ||
      !LEAVE_KINDS.includes(item.kind as LeaveKind) ||
      !leaveHoursFit(item.kind as LeaveKind, item.hours)
    ) {
      bad += 1;
      if (bad <= 3) errors.push(`연가 기록 ${index + 1}번째 항목의 형식이 틀렸어요.`);
      return;
    }
    ids.add(item.id);
    records.push({
      id: item.id,
      date: item.date,
      hours: item.hours,
      kind: item.kind as LeaveKind,
      memo: cleanText(item.memo, LIMITS.memoMax),
    });
  });
  if (bad > 3) errors.push(`그 밖에 연가 기록 ${bad - 3}건의 형식이 틀렸어요.`);

  const grantOverrideHours: Record<string, number> = {};
  for (const [year, hours] of Object.entries(raw.grantOverrideHours)) {
    if (
      !/^\d{4}$/.test(year) ||
      typeof hours !== 'number' ||
      !Number.isInteger(hours) ||
      hours < 0 ||
      hours > 8 * 100
    ) {
      errors.push(`연가 부여일수 수정값(${year})이 틀렸어요.`);
      bad += 1;
      continue;
    }
    grantOverrideHours[year] = hours;
  }
  if (bad > 0) return null;
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return { records, grantOverrideHours };
}

/**
 * 현재 버전 형식의 사용자 데이터인지 검사하고 새 객체로 옮겨 담는다.
 * 알 수 없는 속성은 버린다.
 */
export function validateUserData(raw: unknown, ctx: ProfileContext): Result<UserData> {
  const errors: string[] = [];
  if (!isDict(raw)) return { ok: false, errors: ['데이터가 비어 있거나 형식이 달라요.'] };

  const profileErrors = checkProfile(raw.profile, ctx);
  for (const message of Object.values(profileErrors)) errors.push(`내 정보: ${message}`);
  const settings = checkSettings(raw.settings, errors, !ctx.stored);
  const leave = checkLeave(raw.leave, errors);

  const achievements: UserData['achievements'] = {};
  if (!isDict(raw.achievements)) errors.push('업적 기록의 형식이 틀렸어요.');
  else if (Object.keys(raw.achievements).length > LIMITS.maxAchievements) {
    errors.push('업적 기록이 너무 많아요.');
  } else {
    for (const [id, value] of Object.entries(raw.achievements)) {
      if (
        !ACHIEVEMENT_ID_RE.test(id) ||
        id in Object.prototype ||
        !isDict(value) ||
        !isValidYmd(value.at)
      ) {
        errors.push(`업적 기록(${id.slice(0, 20)})의 형식이 틀렸어요.`);
        break;
      }
      achievements[id] = { at: value.at };
    }
  }

  let character: UserData['character'] | null = null;
  const ch = raw.character;
  if (
    !isDict(ch) ||
    !Array.isArray(ch.seenForms) ||
    ch.seenForms.length > 50 ||
    !ch.seenForms.every((f: unknown) => typeof f === 'string' && ID_RE.test(f)) ||
    // 마지막으로 본 계급: 키가 있어야 하고 형식만 본다(직종과 짝짓지 않는다)
    !('lastRank' in ch) ||
    !isRankKeyOrNull(ch.lastRank) ||
    typeof ch.lastStep !== 'number' ||
    !Number.isInteger(ch.lastStep) ||
    ch.lastStep < 1 ||
    ch.lastStep > LIMITS.maxStepAny ||
    // 모르는 형태 id 도 지우지 않는다(그릴 때 무시)
    !(ch.lastForm === null || (typeof ch.lastForm === 'string' && ID_RE.test(ch.lastForm)))
  ) {
    errors.push('캐릭터 상태의 형식이 틀렸어요.');
  } else {
    character = {
      seenForms: [...new Set(ch.seenForms as string[])],
      lastRank: ch.lastRank as RankKey | null,
      lastStep: ch.lastStep,
      lastForm: ch.lastForm as string | null,
    };
  }

  let visits: UserData['visits'] | null = null;
  const vs = raw.visits;
  if (
    !isDict(vs) ||
    !Array.isArray(vs.days) ||
    vs.days.length > LIMITS.maxVisitDays ||
    !vs.days.every((d: unknown) => isValidYmd(d)) ||
    !(vs.lastVisit === null || isValidYmd(vs.lastVisit))
  ) {
    errors.push('출근 도장 기록의 형식이 틀렸어요.');
  } else {
    visits = { days: [...new Set(vs.days as Ymd[])].sort(), lastVisit: vs.lastVisit as Ymd | null };
  }

  let meta: UserData['meta'] | null = null;
  const mt = raw.meta;
  if (
    !isDict(mt) ||
    !isIsoInstant(mt.createdAt) ||
    !isIsoInstant(mt.updatedAt) ||
    !(mt.lastBackupAt === null || isIsoInstant(mt.lastBackupAt)) ||
    typeof mt.changesSinceBackup !== 'number' ||
    !Number.isInteger(mt.changesSinceBackup) ||
    mt.changesSinceBackup < 0
  ) {
    errors.push('기록 시각 정보의 형식이 틀렸어요.');
  } else {
    meta = {
      createdAt: mt.createdAt,
      updatedAt: mt.updatedAt,
      lastBackupAt: mt.lastBackupAt as string | null,
      changesSinceBackup: mt.changesSinceBackup,
    };
  }

  if (errors.length > 0 || !settings || !leave || !character || !visits || !meta) {
    return { ok: false, errors: errors.length > 0 ? errors : ['데이터 형식이 틀렸어요.'] };
  }
  return {
    ok: true,
    value: {
      profile: toProfile(raw.profile as Dict),
      settings,
      leave,
      achievements,
      character,
      visits,
      meta,
    },
  };
}
