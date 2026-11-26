/**
 * 구버전 데이터 변환.
 *
 * 버전 내역
 * - v1: 초기 설계안. 브리프의 입력 항목(닉네임·생년월일·임용일·직급·호봉·다음 승급일)을
 *       한 층에 펼쳐 두고, 연가는 일/반일/시간 단위로 기록했다.
 * - v2: 현 직급 임용일과 예외 보정, 시간 단위 연가 장부, 설정·업적·캐릭터·출근 도장을
 *       묶음별로 나눈 형식.
 * - v3: 호봉을 확인한 날(profile.stepAsOf)을 더했다. 다음 승급일이 1년보다 멀 때
 *       (휴직·승급제한) 지금 호봉이 한 단계 낮게 계산되던 문제를 고치기 위해서다.
 *
 * 새 버전을 만들 때: schema.ts의 SCHEMA_VERSION을 올리고 MIGRATIONS에 (이전 버전) → (다음 버전)
 * 변환을 추가한다. 변환은 순서대로 이어서 적용된다.
 * 변환은 값을 조용히 버리거나 고치지 않는다. 옮길 수 없는 값은 그대로 넘겨 검증 단계가
 * 이유와 함께 거부하게 한다(사용자가 무엇이 빠졌는지 모른 채 불러오는 일이 없게).
 */
import { addDays, isValidYmd, todayYmd, type Ymd } from '../calc/date.ts';
import { APP_ID, SCHEMA_VERSION, type Settings } from './schema.ts';

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface MigrationContext {
  /** 구버전에 없던 설정의 기본값 */
  defaultSettings: Settings;
  /** 파일을 내보낸 시각(ISO). 없으면 변환 시각 */
  exportedAt: string;
}

type Migration = (data: Dict, ctx: MigrationContext) => Dict;

function dateOfIso(iso: string): Ymd {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '1970-01-01' : todayYmd(date);
}

/** v1 → v2 */
function v1ToV2(data: Dict, ctx: MigrationContext): Dict {
  const exportedDay = dateOfIso(ctx.exportedAt);
  const records: Dict[] = [];
  if (Array.isArray(data.leave)) {
    data.leave.forEach((item: unknown, index: number) => {
      const id = `v1-${index + 1}`;
      // 형식이 틀린 행도 그대로 넘긴다. 검증이 "연가 기록 N번째 항목"으로 알려 준다.
      if (!isDict(item)) {
        records.push({ id, date: null, hours: null, kind: null, memo: '' });
        return;
      }
      if (item.unit === 'half') {
        records.push({ id, date: item.date, hours: 4, kind: 'am', memo: '' });
      } else if (item.unit === 'hour') {
        records.push({ id, date: item.date, hours: item.amount, kind: 'hours', memo: '' });
      } else {
        records.push({ id, date: item.date, hours: 8, kind: 'day', memo: '' });
      }
    });
  }
  const grantOverrideHours: Dict = {};
  if (isDict(data.leaveGrantDays)) {
    for (const [year, days] of Object.entries(data.leaveGrantDays)) {
      if (typeof days === 'number' && Number.isFinite(days))
        grantOverrideHours[year] = Math.round(days * 8);
    }
  }
  const achievements: Dict = {};
  if (Array.isArray(data.badges)) {
    for (const id of data.badges) {
      if (typeof id === 'string') achievements[id] = { at: exportedDay };
    }
  }
  const theme =
    data.theme === 'light' || data.theme === 'dark' ? data.theme : ctx.defaultSettings.theme;
  const createdAt = typeof data.createdAt === 'string' ? data.createdAt : ctx.exportedAt;
  return {
    profile: {
      nickname: data.nickname,
      birthDate: data.birthDate,
      hireDate: data.hireDate,
      grade: data.grade,
      // v1에는 현 직급 임용일이 없었다. 승진 이력을 모르므로 최초 임용일로 둔다.
      gradeDate: data.hireDate,
      step: data.step,
      nextStepDate: data.nextStepDate,
      overrides: { longServiceDate: null, seniorDate: null },
    },
    settings: { ...ctx.defaultSettings, theme },
    leave: { records, grantOverrideHours },
    achievements,
    character: { seenForms: [], lastGrade: data.grade, lastStep: data.step },
    visits: { days: [], lastVisit: null },
    meta: {
      createdAt,
      updatedAt: ctx.exportedAt,
      lastBackupAt: ctx.exportedAt,
      changesSinceBackup: 0,
    },
  };
}

/**
 * v2 → v3: 호봉을 확인한 날을 채운다.
 * 언제 넣은 값인지 알 수 없으므로 마지막으로 고친 날로 본다. 그날이 다음 승급일 이후라면
 * (승급일이 지나도 저장값은 그대로 두므로) 다음 승급일 전날로 둔다. 이 값은 v2의 계산과 같다.
 */
function v2ToV3(data: Dict, ctx: MigrationContext): Dict {
  const profile = data.profile;
  if (!isDict(profile) || !isValidYmd(profile.nextStepDate)) return data;
  if (isValidYmd(profile.stepAsOf)) return data;
  const meta = isDict(data.meta) ? data.meta : {};
  const updated = dateOfIso(typeof meta.updatedAt === 'string' ? meta.updatedAt : ctx.exportedAt);
  const dayBefore = addDays(profile.nextStepDate, -1);
  const stepAsOf = updated < profile.nextStepDate ? updated : dayBefore;
  return { ...data, profile: { ...profile, stepAsOf } };
}

/** 키 = 변환 전 버전 */
const MIGRATIONS: Record<number, Migration> = {
  1: v1ToV2,
  2: v2ToV3,
};

export type MigrateResult =
  | { ok: true; data: unknown; fromVersion: number; migrated: boolean }
  /** code 'newer': 이 앱보다 새 버전에서 만든 데이터라 읽지 않았다(손상이 아니다) */
  | { ok: false; reason: string; code?: 'newer' };

/**
 * 겉봉(envelope)을 확인하고 data를 현재 버전 형식으로 바꾼다.
 * 결과 data는 아직 검증 전이므로 validateUserData를 거쳐야 한다.
 */
export function migrateEnvelope(
  envelope: unknown,
  defaults: Settings,
  nowIso: string,
): MigrateResult {
  if (!isDict(envelope)) return { ok: false, reason: '호봉 데이터 파일이 아니에요.' };
  if (envelope.app !== APP_ID) return { ok: false, reason: '호봉 데이터 파일이 아니에요.' };
  const version = envelope.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: '데이터 버전 정보가 없거나 틀렸어요.' };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'newer',
      reason: `이 파일은 더 새 버전의 호봉 앱에서 만든 거예요(파일 버전 ${version}, 지금 앱이 읽는 버전 ${SCHEMA_VERSION}). 새 hobong.html을 받아 열거나, 온라인이라면 새로 고침한 뒤 다시 불러와 주세요.`,
    };
  }
  if (!isDict(envelope.data)) return { ok: false, reason: '파일 안에 데이터가 없어요.' };

  const exportedAt =
    typeof envelope.exportedAt === 'string' && !Number.isNaN(Date.parse(envelope.exportedAt))
      ? envelope.exportedAt
      : nowIso;
  let data: Dict = envelope.data;
  for (let v = version; v < SCHEMA_VERSION; v += 1) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, reason: `버전 ${v} 데이터를 바꾸는 방법을 몰라요.` };
    try {
      data = step(data, { defaultSettings: defaults, exportedAt });
    } catch {
      return {
        ok: false,
        reason: `버전 ${v} 데이터를 바꾸지 못했어요. 파일이 손상됐을 수 있어요.`,
      };
    }
  }
  return { ok: true, data, fromVersion: version, migrated: version !== SCHEMA_VERSION };
}
