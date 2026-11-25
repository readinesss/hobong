/**
 * 사용자 데이터 검증.
 * 불러온 파일·저장소의 값은 믿지 않는다. 형식이 맞는 것만 받아 새 객체로 옮겨 담고,
 * 틀린 곳은 사람이 읽을 수 있는 이유와 함께 거부한다(기존 데이터는 건드리지 않는다).
 */
import { addDays, addMonthsClamped, isValidYmd, maxYmd, parseHm, type Ymd } from '../calc/date.ts';
import { checkWorkHours } from '../calc/today.ts';
import {
  LIMITS,
  type CardSettings,
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

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9;
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

export interface ProfileContext {
  today: Ymd;
  /** 직급별 최고 호봉 */
  maxStep: (grade: Grade) => number;
  /**
   * 입력 폼에서만 쓰는 추가 검사. 저장된 값에는 쓰지 않는다(시간이 지나면 승급일은 과거가 된다).
   * - future: 다음 승급일은 오늘보다 뒤여야 한다
   * - reached: 최고호봉이 된 날이므로 오늘이거나 오늘보다 앞이어야 한다
   */
  raiseDateRule?: 'future' | 'reached';
  /**
   * true 면 이 브라우저에 저장돼 있던 값을 읽는 중이다. 형식·순서만 보고, "오늘"에 따라
   * 달라지는 검사(오늘보다 뒤인 날짜, 너무 먼 승급일, 최고호봉)는 하지 않는다.
   * (PC 시계를 고치거나 규정 데이터가 바뀌어도 멀쩡한 저장본을 손상으로 보지 않게)
   */
  stored?: boolean;
}

export type ProfileField =
  | 'nickname'
  | 'birthDate'
  | 'hireDate'
  | 'grade'
  | 'gradeDate'
  | 'step'
  | 'nextStepDate'
  | 'stepAsOf'
  | 'longServiceDate'
  | 'seniorDate';

export type ProfileErrors = Partial<Record<ProfileField, string>>;

/** 입력 폼과 불러오기에서 함께 쓰는 프로필 검사. 문제가 없으면 빈 객체 */
export function checkProfile(raw: unknown, ctx: ProfileContext): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!isDict(raw)) return { nickname: '내 정보가 없습니다.' };
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
    errors.birthDate = '생년월일을 다시 확인해 주세요.';

  const hire = raw.hireDate;
  if (!isValidYmd(hire)) errors.hireDate = '임용일을 넣어 주세요.';
  else if (semantic && hire > today)
    errors.hireDate = '임용일은 오늘이거나 오늘보다 앞이어야 해요.';
  else if (isValidYmd(birth) && hire < addMonthsClamped(birth, LIMITS.minHireAge * 12)) {
    errors.hireDate = '임용일이 생년월일에 비해 너무 일러요.';
  }

  const grade = raw.grade;
  if (!isGrade(grade)) errors.grade = '직급을 골라 주세요.';

  const gradeDate = raw.gradeDate;
  if (!isValidYmd(gradeDate)) errors.gradeDate = '현 직급 임용일을 넣어 주세요.';
  else if (semantic && gradeDate > today)
    errors.gradeDate = '현 직급 임용일은 오늘이거나 오늘보다 앞이어야 해요.';
  else if (isValidYmd(hire) && gradeDate < hire)
    errors.gradeDate = '현 직급 임용일이 최초 임용일보다 앞이에요.';

  const step = raw.step;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > 99)
    errors.step = '호봉을 넣어 주세요.';
  else if (semantic && isGrade(grade) && step > ctx.maxStep(grade)) {
    errors.step = `${grade}급은 ${ctx.maxStep(grade)}호봉까지 있어요.`;
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
    errors.nextStepDate = '다음 승급일이 너무 먼 미래예요.';
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
      else if (isValidYmd(gradeDate) && v < gradeDate)
        errors[key] = '현 직급 임용일보다 뒤여야 해요.';
    }
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
    grade: raw.grade as Grade,
    gradeDate: raw.gradeDate as Ymd,
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
    },
  };
}

function checkSettings(raw: unknown, errors: string[], semantic: boolean): Settings | null {
  if (!isDict(raw)) {
    errors.push('설정 값이 없습니다.');
    return null;
  }
  const before = errors.length;
  const payday = raw.payday;
  if (typeof payday !== 'number' || !Number.isInteger(payday) || payday < 1 || payday > 31) {
    errors.push('설정: 보수 지급일은 1~31 사이의 수여야 합니다.');
  }
  const work = raw.work;
  const times: Record<string, string> = {};
  if (!isDict(work)) errors.push('설정: 근무시간 값이 없습니다.');
  else {
    for (const key of ['start', 'end', 'lunchStart', 'lunchEnd'] as const) {
      const v = work[key];
      if (typeof v !== 'string' || parseHm(v) === null)
        errors.push(`설정: 근무시간(${WORK_LABELS[key]}) 형식이 틀렸습니다.`);
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
    errors.push('설정: 화면 테마 값이 틀렸습니다.');
  }
  if (typeof raw.reduceMotion !== 'boolean') errors.push('설정: 움직임 줄이기 값이 틀렸습니다.');
  if (typeof raw.hideAmounts !== 'boolean') errors.push('설정: 금액 가리기 값이 틀렸습니다.');
  if (raw.tabTitle !== 'default' && raw.tabTitle !== 'countdown')
    errors.push('설정: 탭 제목 값이 틀렸습니다.');
  const card = raw.card;
  let cardOut: CardSettings | null = null;
  if (!isDict(card)) errors.push('설정: 카드 설정이 없습니다.');
  else if (
    (card.ratio !== 'square' && card.ratio !== 'portrait') ||
    typeof card.showSalary !== 'boolean' ||
    typeof card.showRetirement !== 'boolean' ||
    typeof card.showTenure !== 'boolean' ||
    typeof card.showBadges !== 'boolean'
  ) {
    errors.push('설정: 카드 설정 값이 틀렸습니다.');
  } else {
    cardOut = {
      ratio: card.ratio,
      showSalary: card.showSalary,
      showRetirement: card.showRetirement,
      showTenure: card.showTenure,
      showBadges: card.showBadges,
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
    errors.push('연가 장부의 형식이 틀렸습니다.');
    return null;
  }
  if (raw.records.length > LIMITS.maxLeaveRecords) {
    errors.push(`연가 기록이 너무 많습니다(${raw.records.length}건).`);
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
      if (bad <= 3) errors.push(`연가 기록 ${index + 1}번째 항목의 형식이 틀렸습니다.`);
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
  if (bad > 3) errors.push(`그 밖에 연가 기록 ${bad - 3}건의 형식이 틀렸습니다.`);

  const grantOverrideHours: Record<string, number> = {};
  for (const [year, hours] of Object.entries(raw.grantOverrideHours)) {
    if (
      !/^\d{4}$/.test(year) ||
      typeof hours !== 'number' ||
      !Number.isInteger(hours) ||
      hours < 0 ||
      hours > 8 * 100
    ) {
      errors.push(`연가 부여일수 수정값(${year})이 틀렸습니다.`);
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
  if (!isDict(raw)) return { ok: false, errors: ['데이터가 비어 있거나 형식이 다릅니다.'] };

  const profileErrors = checkProfile(raw.profile, ctx);
  for (const message of Object.values(profileErrors)) errors.push(`내 정보: ${message}`);
  const settings = checkSettings(raw.settings, errors, !ctx.stored);
  const leave = checkLeave(raw.leave, errors);

  const achievements: UserData['achievements'] = {};
  if (!isDict(raw.achievements)) errors.push('업적 기록의 형식이 틀렸습니다.');
  else if (Object.keys(raw.achievements).length > LIMITS.maxAchievements) {
    errors.push('업적 기록이 너무 많습니다.');
  } else {
    for (const [id, value] of Object.entries(raw.achievements)) {
      if (
        !ACHIEVEMENT_ID_RE.test(id) ||
        id in Object.prototype ||
        !isDict(value) ||
        !isValidYmd(value.at)
      ) {
        errors.push(`업적 기록(${id.slice(0, 20)})의 형식이 틀렸습니다.`);
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
    !isGrade(ch.lastGrade) ||
    typeof ch.lastStep !== 'number' ||
    !Number.isInteger(ch.lastStep) ||
    ch.lastStep < 1 ||
    ch.lastStep > 99
  ) {
    errors.push('캐릭터 상태의 형식이 틀렸습니다.');
  } else {
    character = {
      seenForms: [...new Set(ch.seenForms as string[])],
      lastGrade: ch.lastGrade,
      lastStep: ch.lastStep,
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
    errors.push('출근 도장 기록의 형식이 틀렸습니다.');
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
    errors.push('기록 시각 정보의 형식이 틀렸습니다.');
  } else {
    meta = {
      createdAt: mt.createdAt,
      updatedAt: mt.updatedAt,
      lastBackupAt: mt.lastBackupAt as string | null,
      changesSinceBackup: mt.changesSinceBackup,
    };
  }

  if (errors.length > 0 || !settings || !leave || !character || !visits || !meta) {
    return { ok: false, errors: errors.length > 0 ? errors : ['데이터 형식이 틀렸습니다.'] };
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
