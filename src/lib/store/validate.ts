/**
 * 사용자 데이터 검증.
 * 불러온 파일·저장소의 값은 믿지 않는다. 형식이 맞는 것만 받아 새 객체로 옮겨 담고,
 * 틀린 곳은 사람이 읽을 수 있는 이유와 함께 거부한다(기존 데이터는 건드리지 않는다).
 */
import { addMonthsClamped, isValidYmd, parseHm, type Ymd } from '../calc/date.ts';
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
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return [...value.replace(UNSAFE_CHARS, '').trim()].slice(0, max).join('');
}

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9;
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

export interface ProfileContext {
  today: Ymd;
  /** 직급별 최고 호봉 */
  maxStep: (grade: Grade) => number;
}

export type ProfileField =
  | 'nickname'
  | 'birthDate'
  | 'hireDate'
  | 'grade'
  | 'gradeDate'
  | 'step'
  | 'nextStepDate'
  | 'longServiceDate'
  | 'seniorDate';

export type ProfileErrors = Partial<Record<ProfileField, string>>;

/** 입력 폼과 불러오기에서 함께 쓰는 프로필 검사. 문제가 없으면 빈 객체 */
export function checkProfile(raw: unknown, ctx: ProfileContext): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!isDict(raw)) return { nickname: '내 정보가 없습니다.' };
  const { today } = ctx;

  const nickname = cleanText(raw.nickname, LIMITS.nicknameMax + 1);
  if (nickname.length === 0) errors.nickname = '닉네임을 넣어 주세요.';
  else if ([...nickname].length > LIMITS.nicknameMax) {
    errors.nickname = `닉네임은 ${LIMITS.nicknameMax}자까지 넣을 수 있어요.`;
  }

  const birth = raw.birthDate;
  if (!isValidYmd(birth)) errors.birthDate = '생년월일을 넣어 주세요.';
  else if (birth > today) errors.birthDate = '생년월일이 오늘보다 뒤예요.';
  else if (Number(birth.slice(0, 4)) < LIMITS.minBirthYear) errors.birthDate = '생년월일을 다시 확인해 주세요.';

  const hire = raw.hireDate;
  if (!isValidYmd(hire)) errors.hireDate = '임용일을 넣어 주세요.';
  else if (hire > today) errors.hireDate = '임용일은 오늘이거나 오늘보다 앞이어야 해요.';
  else if (isValidYmd(birth) && hire < addMonthsClamped(birth, LIMITS.minHireAge * 12)) {
    errors.hireDate = '임용일이 생년월일에 비해 너무 일러요.';
  }

  const grade = raw.grade;
  if (!isGrade(grade)) errors.grade = '직급을 골라 주세요.';

  const gradeDate = raw.gradeDate;
  if (!isValidYmd(gradeDate)) errors.gradeDate = '현 직급 임용일을 넣어 주세요.';
  else if (gradeDate > today) errors.gradeDate = '현 직급 임용일은 오늘이거나 오늘보다 앞이어야 해요.';
  else if (isValidYmd(hire) && gradeDate < hire) errors.gradeDate = '현 직급 임용일이 최초 임용일보다 앞이에요.';

  const step = raw.step;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1) errors.step = '호봉을 넣어 주세요.';
  else if (isGrade(grade) && step > ctx.maxStep(grade)) {
    errors.step = `${grade}급은 ${ctx.maxStep(grade)}호봉까지 있어요.`;
  }

  const next = raw.nextStepDate;
  if (!isValidYmd(next)) errors.nextStepDate = '다음 승급일을 넣어 주세요.';
  else if (isValidYmd(hire) && next <= hire) errors.nextStepDate = '다음 승급일이 임용일보다 뒤여야 해요.';
  else if (next > addMonthsClamped(today, LIMITS.maxNextStepYears * 12)) {
    errors.nextStepDate = '다음 승급일이 너무 먼 미래예요.';
  }

  const overrides = raw.overrides;
  if (overrides !== undefined && !isDict(overrides)) errors.longServiceDate = '예외 보정 값의 형식이 틀렸어요.';
  if (isDict(overrides)) {
    for (const key of ['longServiceDate', 'seniorDate'] as const) {
      const v = overrides[key];
      if (v === null || v === undefined || v === '') continue;
      if (!isValidYmd(v)) errors[key] = '날짜를 다시 확인해 주세요.';
      else if (isValidYmd(gradeDate) && v < gradeDate) errors[key] = '현 직급 임용일보다 뒤여야 해요.';
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
    overrides: { longServiceDate: pick(overrides.longServiceDate), seniorDate: pick(overrides.seniorDate) },
  };
}

function checkSettings(raw: unknown, errors: string[]): Settings | null {
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
      if (typeof v !== 'string' || parseHm(v) === null) errors.push(`설정: 근무시간(${key}) 형식이 틀렸습니다.`);
      else times[key] = v;
    }
  }
  if (raw.theme !== 'auto' && raw.theme !== 'light' && raw.theme !== 'dark') {
    errors.push('설정: 화면 테마 값이 틀렸습니다.');
  }
  if (typeof raw.reduceMotion !== 'boolean') errors.push('설정: 움직임 줄이기 값이 틀렸습니다.');
  if (typeof raw.hideAmounts !== 'boolean') errors.push('설정: 금액 가리기 값이 틀렸습니다.');
  if (raw.tabTitle !== 'default' && raw.tabTitle !== 'countdown') errors.push('설정: 탭 제목 값이 틀렸습니다.');
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

const LEAVE_KINDS: readonly LeaveKind[] = ['day', 'am', 'pm', 'hours'];
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

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
      typeof item.hours !== 'number' ||
      !Number.isInteger(item.hours) ||
      item.hours < 1 ||
      item.hours > 24 ||
      !LEAVE_KINDS.includes(item.kind as LeaveKind)
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
    if (!/^\d{4}$/.test(year) || typeof hours !== 'number' || !Number.isInteger(hours) || hours < 0 || hours > 8 * 100) {
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
  const settings = checkSettings(raw.settings, errors);
  const leave = checkLeave(raw.leave, errors);

  const achievements: UserData['achievements'] = {};
  if (!isDict(raw.achievements)) errors.push('업적 기록의 형식이 틀렸습니다.');
  else {
    for (const [id, value] of Object.entries(raw.achievements)) {
      if (!ID_RE.test(id) || !isDict(value) || !isValidYmd(value.at)) {
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
    value: { profile: toProfile(raw.profile as Dict), settings, leave, achievements, character, visits, meta },
  };
}
