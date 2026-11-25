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

/** hobong-backup-YYYYMMDD.json */
export function backupFileName(today: Ymd): string {
  return `hobong-backup-${today.replace(/-/g, '')}.json`;
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
  | { ok: false; reason: string; details: string[] };

/** 백업 파일 내용(문자열)을 읽어 현재 버전의 사용자 데이터로 만든다 */
export function parseBackup(text: string, ctx: ParseContext): ParseResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, reason: '파일이 비어 있습니다.', details: [] };
  }
  if (text.length > MAX_BACKUP_BYTES) {
    return { ok: false, reason: '파일이 너무 큽니다. 호봉 백업 파일이 맞는지 확인해 주세요.', details: [] };
  }
  let parsed: unknown;
  try {
    // 파일 앞의 BOM은 무시한다(메모장으로 다시 저장한 경우).
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return {
      ok: false,
      reason: '파일을 읽을 수 없습니다. 내용이 잘렸거나 손상된 것 같습니다.',
      details: ['JSON 형식이 아닙니다.'],
    };
  }
  const migrated = migrateEnvelope(parsed, ctx.defaultSettings, ctx.nowIso);
  if (!migrated.ok) return { ok: false, reason: migrated.reason, details: [] };
  const checked = validateUserData(migrated.data, ctx);
  if (!checked.ok) {
    return {
      ok: false,
      reason: '파일 내용 중 형식이 맞지 않는 곳이 있어 불러오지 않았습니다.',
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
