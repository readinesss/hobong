/**
 * 브라우저 저장소 접근. 입력값은 localStorage에만 둔다(서버 없음).
 * 저장소가 막힌 환경(사생활 보호 창, 정책 제한)에서는 메모리에만 두고 그 사실을 알린다.
 *
 * 원칙: 저장된 데이터는 어떤 경우에도 말없이 지우지 않는다.
 * - 더 새로운 버전에서 저장한 데이터는 손상이 아니다. 건드리지 않고 "새 버전으로 열어 달라"고만 한다
 *   (예전 hobong.html 사본이나 열어 둔 옛 탭이 새 데이터를 치워 버리지 않게).
 * - 읽지 못한 데이터는 따로 옮겨 두고, 옮기는 데 성공했을 때만 원래 자리를 비운다.
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
  /** 읽지 못한 저장본(지우지 않고 따로 둔다). 처음 것은 덮어쓰지 않는다 */
  corrupt: 'hobong.corrupt',
  /** 처음 것이 이미 있을 때 그 뒤에 읽지 못한 저장본 */
  corruptLatest: 'hobong.corrupt.2',
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
  /** 쓰기가 되는지(가득 찼거나 정책으로 쓰기만 막힌 경우 false) */
  writable: boolean;
}

/** localStorage를 쓸 수 있으면 쓰고, 안 되면 메모리 저장소로 대신한다 */
export function openStore(getLocalStorage: () => KeyValueStore | undefined): OpenedStore {
  let ls: KeyValueStore | undefined;
  try {
    ls = getLocalStorage();
  } catch {
    ls = undefined;
  }
  if (ls) {
    try {
      const probe = 'hobong.probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return { store: ls, persistent: true, writable: true };
    } catch {
      // 쓰기는 막혔어도 읽을 수 있으면 기존 데이터를 보여 줘야 한다(가득 찬 저장소 등).
      try {
        ls.getItem(KEYS.data);
        return { store: ls, persistent: true, writable: false };
      } catch {
        // 읽기도 막혀 있으면 아래 메모리 저장소로
      }
    }
  }
  return { store: memoryStore(), persistent: false, writable: true };
}

export type LoadResult =
  | { status: 'empty' }
  | {
      status: 'ok';
      data: UserData;
      migrated: boolean;
      /** 저장본이 원래 어느 형식 버전이었는지(바꾸기 전) */
      fromVersion: number;
      /** 예전에 읽지 못해 옮겨 뒀던 저장본을 되살렸는지 */
      restored: boolean;
    }
  /** 더 새로운 버전에서 저장한 데이터. 저장소는 그대로 두었다 */
  | { status: 'newer'; reason: string }
  /** 읽지 못했다. kept 가 true 면 따로 옮겨 두었다 */
  | { status: 'corrupt'; reason: string; kept: boolean };

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

/** 읽지 못한 원문을 따로 둔다. 처음 보관본은 덮어쓰지 않는다. 성공하면 true */
function keepCorrupt(store: KeyValueStore, raw: string): boolean {
  const first = read(store, KEYS.corrupt);
  if (first === null) return write(store, KEYS.corrupt, raw);
  if (first === raw) return true;
  return write(store, KEYS.corruptLatest, raw);
}

export interface LoadOptions {
  /**
   * true 면 읽지 못해도 저장소를 바꾸지 않는다(옮기지도 지우지도 않는다).
   * 다른 탭이 방금 쓴 값을 받았을 때처럼, 이 탭이 판단할 처지가 아닐 때 쓴다.
   */
  readOnly?: boolean;
}

export function loadData(
  store: KeyValueStore,
  ctx: ParseContext,
  options: LoadOptions = {},
): LoadResult {
  const raw = read(store, KEYS.data);
  if (raw === null || raw.trim() === '') {
    if (!options.readOnly) {
      const restored = restoreCorrupt(store, ctx);
      if (restored) return restored;
    }
    return { status: 'empty' };
  }
  const parsed = parseBackup(raw, ctx);
  if (parsed.ok) {
    return {
      status: 'ok',
      data: parsed.data,
      migrated: parsed.migrated,
      fromVersion: parsed.fromVersion,
      restored: false,
    };
  }
  if (parsed.code === 'newer') return { status: 'newer', reason: parsed.reason };
  if (options.readOnly) return { status: 'corrupt', reason: parsed.reason, kept: false };
  // 읽지 못한 저장본은 버리지 않고 옮겨 둔다. 옮기지 못했으면 원래 자리에 그대로 둔다.
  const kept = keepCorrupt(store, raw);
  if (kept) remove(store, KEYS.data);
  return { status: 'corrupt', reason: parsed.reason, kept };
}

/**
 * 데이터가 비어 있고, 예전에 읽지 못해 옮겨 둔 저장본이 지금은 읽힌다면 되살린다.
 * (예전 사본·옛 탭이 새 버전 데이터를 "손상"으로 옮겨 버린 경우를 되돌린다)
 */
function restoreCorrupt(store: KeyValueStore, ctx: ParseContext): LoadResult | null {
  for (const key of [KEYS.corruptLatest, KEYS.corrupt]) {
    const raw = read(store, key);
    if (raw === null) continue;
    const parsed = parseBackup(raw, ctx);
    if (!parsed.ok) continue;
    if (!write(store, KEYS.data, raw)) return null;
    remove(store, key);
    return {
      status: 'ok',
      data: parsed.data,
      migrated: parsed.migrated,
      fromVersion: parsed.fromVersion,
      restored: true,
    };
  }
  return null;
}

export function saveData(
  store: KeyValueStore,
  data: UserData,
  appVersion: string,
  nowIso: string,
): boolean {
  return write(store, KEYS.data, serializeBackup(makeEnvelope(data, appVersion, nowIso)));
}

/** 이 저장소에 있는 데이터를 이 앱이 덮어써도 되는지(더 새 버전의 데이터면 안 된다) */
export function isNewerData(store: KeyValueStore, ctx: ParseContext): boolean {
  const raw = read(store, KEYS.data);
  if (raw === null || raw.trim() === '') return false;
  const parsed = parseBackup(raw, ctx);
  return !parsed.ok && parsed.code === 'newer';
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
  return read(store, KEYS.corrupt) !== null || read(store, KEYS.corruptLatest) !== null;
}

/** 따로 둔 읽지 못한 저장본(처음 것, 나중 것). 없는 것은 빠진다 */
export function readCorrupt(store: KeyValueStore): string[] {
  return [read(store, KEYS.corrupt), read(store, KEYS.corruptLatest)].filter(
    (raw): raw is string => raw !== null,
  );
}

export function clearCorrupt(store: KeyValueStore): void {
  remove(store, KEYS.corrupt);
  remove(store, KEYS.corruptLatest);
}

/** 모든 데이터를 지운다(초기화) */
export function clearAll(store: KeyValueStore): void {
  remove(store, KEYS.data);
  remove(store, KEYS.undo);
  clearCorrupt(store);
}
