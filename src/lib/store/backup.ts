/**
 * 데이터 내려받기·불러오기.
 * 내보낼 때는 파생 값을 넣지 않고, 불러올 때는 변환 → 검증을 모두 통과한 것만 받는다.
 */
import type { Ymd } from '../calc/date.ts';
import { migrateEnvelope } from './migrate.ts';
import { APP_ID, SCHEMA_VERSION, type Envelope, type Settings, type UserData } from './schema.ts';
import { validateUserData, type ProfileContext } from './validate.ts';

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

export function makeEnvelope(data: UserData, appVersion: string, nowIso: string): Envelope {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, appVersion, exportedAt: nowIso, data };
}

export function serializeBackup(envelope: Envelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/** hobong-backup-YYYYMMDD.json, 암호를 걸었으면 hobong-backup-YYYYMMDD-locked.json */
export function backupFileName(today: Ymd, locked = false): string {
  return `hobong-backup-${today.replace(/-/g, '')}${locked ? '-locked' : ''}.json`;
}

export interface ParseContext extends ProfileContext {
  defaultSettings: Settings;
  nowIso: string;
}

export type ParseResult =
  | {
      ok: true;
      data: UserData;
      /** 파일의 원래 버전 */
      fromVersion: number;
      migrated: boolean;
      exportedAt: string | null;
      appVersion: string | null;
    }
  | { ok: false; reason: string; details: string[]; code?: 'newer' | 'encrypted' };

/** 백업 파일 내용(문자열)을 읽어 현재 버전의 사용자 데이터로 만든다 */
export function parseBackup(text: string, ctx: ParseContext): ParseResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, reason: '파일이 비어 있어요.', details: [] };
  }
  if (text.length > MAX_BACKUP_BYTES) {
    return {
      ok: false,
      reason: '파일이 너무 커요. 호봉 백업 파일이 맞는지 확인해 주세요.',
      details: [],
    };
  }
  let parsed: unknown;
  try {
    // 파일 앞의 BOM은 무시한다(메모장으로 다시 저장한 경우).
    parsed = JSON.parse(text.replace(/^\ufeff/, ''));
  } catch {
    return {
      ok: false,
      // 파일·붙여넣은 글자·브라우저 저장소 어디서 읽었든 맞는 말로 쓴다(파일이면 화면이 덧붙인다)
      reason: '데이터를 읽지 못했어요. 내용이 잘렸거나 손상된 것 같아요.',
      details: ['백업 데이터 형식(JSON)이 아니에요.'],
    };
  }
  // 암호가 걸린 백업(crypto.ts)은 불러오기 화면에서 암호를 받아 푼 뒤에 다시 이 함수를 거친다.
  // 어느 길로 들어오든 엉뚱한 '형식이 맞지 않아요'가 되지 않게 먼저 알아본다.
  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as Record<string, unknown>).app === APP_ID &&
    (parsed as Record<string, unknown>).format === 'hobong-encrypted'
  ) {
    return {
      ok: false,
      reason: '암호가 걸린 백업이에요. 불러오기에서 암호를 넣어 열어 주세요.',
      details: [],
      code: 'encrypted',
    };
  }
  const migrated = migrateEnvelope(parsed, ctx.defaultSettings, ctx.nowIso);
  if (!migrated.ok) {
    return migrated.code
      ? { ok: false, reason: migrated.reason, details: [], code: migrated.code }
      : { ok: false, reason: migrated.reason, details: [] };
  }
  const checked = validateUserData(migrated.data, ctx);
  if (!checked.ok) {
    return {
      ok: false,
      reason: '파일 내용 중 형식이 맞지 않는 곳이 있어 불러오지 않았어요.',
      details: checked.errors,
    };
  }
  const env = parsed as Record<string, unknown>;
  return {
    ok: true,
    data: checked.value,
    fromVersion: migrated.fromVersion,
    migrated: migrated.migrated,
    exportedAt: typeof env.exportedAt === 'string' ? env.exportedAt : null,
    appVersion: typeof env.appVersion === 'string' ? env.appVersion : null,
  };
}
