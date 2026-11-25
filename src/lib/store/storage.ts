/**
 * 브라우저 저장소 접근. 입력값은 localStorage에만 둔다(서버 없음).
 * 저장소가 막힌 환경(사생활 보호 창, 정책 제한)에서는 메모리에만 두고 그 사실을 알린다.
 */
import { makeEnvelope, parseBackup, serializeBackup, type ParseContext } from './backup.ts';
import type { UserData } from './schema.ts';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEYS = {
  /** 현재 데이터(겉봉 포함) */
  data: 'hobong.data',
  /** 불러오기로 덮어쓰기 직전의 데이터(되돌리기용) */
  undo: 'hobong.undo',
  /** 읽지 못한 저장본(지우지 않고 따로 둔다) */
  corrupt: 'hobong.corrupt',
} as const;

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export interface OpenedStore {
  store: KeyValueStore;
  /** 브라우저를 닫아도 남는 저장소인지 */
  persistent: boolean;
}

/** localStorage를 쓸 수 있으면 쓰고, 안 되면 메모리 저장소로 대신한다 */
export function openStore(getLocalStorage: () => KeyValueStore | undefined): OpenedStore {
  try {
    const ls = getLocalStorage();
    if (ls) {
      const probe = 'hobong.probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return { store: ls, persistent: true };
    }
  } catch {
    // 접근이 막혀 있으면 아래 메모리 저장소로
  }
  return { store: memoryStore(), persistent: false };
}

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: UserData; migrated: boolean }
  | { status: 'corrupt'; reason: string };

function read(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(store: KeyValueStore, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // 지우지 못해도 동작에는 지장이 없다
  }
}

export function loadData(store: KeyValueStore, ctx: ParseContext): LoadResult {
  const raw = read(store, KEYS.data);
  if (raw === null || raw.trim() === '') return { status: 'empty' };
  const parsed = parseBackup(raw, ctx);
  if (!parsed.ok) {
    // 읽지 못한 저장본은 버리지 않고 옮겨 둔다.
    write(store, KEYS.corrupt, raw);
    remove(store, KEYS.data);
    return { status: 'corrupt', reason: parsed.reason };
  }
  return { status: 'ok', data: parsed.data, migrated: parsed.migrated };
}

export function saveData(
  store: KeyValueStore,
  data: UserData,
  appVersion: string,
  nowIso: string,
): boolean {
  return write(store, KEYS.data, serializeBackup(makeEnvelope(data, appVersion, nowIso)));
}

export interface UndoSnapshot {
  data: UserData;
  /** 보관한 시각 */
  savedAt: string | null;
}

/** 덮어쓰기 직전 상태를 보관한다 */
export function saveUndo(
  store: KeyValueStore,
  data: UserData,
  appVersion: string,
  nowIso: string,
): boolean {
  return write(store, KEYS.undo, serializeBackup(makeEnvelope(data, appVersion, nowIso)));
}

export function loadUndo(store: KeyValueStore, ctx: ParseContext): UndoSnapshot | null {
  const raw = read(store, KEYS.undo);
  if (raw === null) return null;
  const parsed = parseBackup(raw, ctx);
  return parsed.ok ? { data: parsed.data, savedAt: parsed.exportedAt } : null;
}

export function clearUndo(store: KeyValueStore): void {
  remove(store, KEYS.undo);
}

export function hasCorrupt(store: KeyValueStore): boolean {
  return read(store, KEYS.corrupt) !== null;
}

export function readCorrupt(store: KeyValueStore): string | null {
  return read(store, KEYS.corrupt);
}

/** 모든 데이터를 지운다(초기화) */
export function clearAll(store: KeyValueStore): void {
  remove(store, KEYS.data);
  remove(store, KEYS.undo);
  remove(store, KEYS.corrupt);
}
