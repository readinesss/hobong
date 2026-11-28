/**
 * 다른 탭(또는 다른 hobong.html 사본)이 저장본을 바꾼 뒤, 이 탭이 그 사실을 모른 채 저장하면 덮어쓰는 문제(#26).
 *
 * storage 이벤트는 같은 탭의 쓰기에는 오지 않고, WebKit 의 file:// 에서는 다른 탭의 쓰기에도 오지 않을 때가 있다
 * (docs/PLAN.md 부록 C). 그래서 여기서는 이벤트 없이 저장소만 바깥에서 바꾼 뒤, 이 탭의 자동 저장(방문 기록·업적·
 * 도감·승급 확인)과 사용자 저장(연가·내 정보·설정·정한 달·첫 입력·되돌리기·지우기)이 저장소를 그대로 두는지 본다.
 * 반대로 이 탭 스스로 쓴 뒤·저장본 변환·복구·불러오기·초기화·저장소가 막힌 경우에는 정상 저장이 막히지 않아야 한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newAppStore, type AppStoreType as AppStore } from '../../src/lib/app/state.svelte.ts';
import { rulesFor } from '../../src/lib/rules/index.ts';
import { makeEnvelope, serializeBackup } from '../../src/lib/store/backup.ts';
import { defaultSettings, newUserData } from '../../src/lib/store/defaults.ts';
import type { Profile, UserData } from '../../src/lib/store/schema.ts';
import { KEYS, type KeyValueStore } from '../../src/lib/store/storage.ts';

const ROOT = process.cwd();
const R = rulesFor(2026);
const NOW = '2026-11-25T03:00:00.000Z';
const TODAY = '2026-11-25';

function profileOf(nickname: string, over: Partial<Profile> = {}): Profile {
  return {
    nickname,
    birthDate: '1990-04-12',
    hireDate: '2020-03-02',
    track: 'general',
    series: null,
    seriesJikryu: null,
    payTable: 'table3',
    rank: '8',
    rankDate: '2023-03-01',
    step: 5,
    nextStepDate: '2027-03-01',
    stepAsOf: TODAY,
    overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    priorService: null,
    ...over,
  };
}

function dataOf(nickname: string, over: Partial<Profile> = {}): UserData {
  const data = newUserData(profileOf(nickname, over), defaultSettings(R), NOW, TODAY);
  data.visits = { days: ['2026-11-24', TODAY], lastVisit: '2026-11-24' };
  return data;
}

function envelopeOf(data: UserData): string {
  return serializeBackup(makeEnvelope(data, '0.1.0', NOW));
}

interface FakeStorage extends KeyValueStore {
  map: Map<string, string>;
  /** true 면 쓰기가 실패한다(용량 초과) */
  full: boolean;
}

function fakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  const storage: FakeStorage = {
    map,
    full: false,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      if (storage.full) throw new DOMException('full', 'QuotaExceededError');
      map.set(key, String(value));
    },
    removeItem: (key) => void map.delete(key),
  };
  return storage;
}

/** 브라우저 탭 하나를 흉내 낸다(이 탭이 받는 이벤트는 직접 보낸다). 저장소는 탭끼리 함께 쓴다 */
function openTab(storage: KeyValueStore | (() => KeyValueStore)): {
  tab: AppStore;
  fire: (type: string) => void;
} {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const on = (type: string, fn: (event: unknown) => void) =>
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const win = {
    get localStorage() {
      return typeof storage === 'function' ? storage() : storage;
    },
    addEventListener: on,
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: on });
  const tab = newAppStore();
  tab.init();
  return {
    tab,
    fire: (type) => listeners.get(type)?.forEach((fn) => fn({ key: KEYS.data })),
  };
}

/** 저장된 데이터(겉봉 안) */
function stored(storage: FakeStorage): UserData | null {
  const raw = storage.map.get(KEYS.data);
  return raw ? (JSON.parse(raw) as { data: UserData }).data : null;
}

/** 다른 탭이 이 탭 모르게(이벤트 없이) 데이터를 바꿔 저장한다 */
function otherTabWrites(storage: FakeStorage, mutate: (data: UserData) => void): string {
  const data = stored(storage);
  if (!data) throw new Error('저장본이 없다');
  mutate(data);
  const raw = envelopeOf(data);
  storage.map.set(KEYS.data, raw);
  return raw;
}

const toastTexts = (tab: AppStore) => tab.toasts.map((t) => t.text).join('\n');
const DISCARDED = /다른 탭.*방금 한 것은 저장하지 않았어요/;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function seeded(nickname = '김주무관', over: Partial<Profile> = {}): FakeStorage {
  const storage = fakeStorage();
  storage.map.set(KEYS.data, envelopeOf(dataOf(nickname, over)));
  return storage;
}

describe('자동 저장은 다른 탭이 바꾼 저장본을 덮어쓰지 않고 조용히 따라간다', () => {
  it('자정의 방문 기록(CI WebKit 에서 테스트 데이터가 사라진 순서)', () => {
    const storage = seeded('예전 탭');
    const { tab } = openTab(storage);
    expect(tab.data?.profile.nickname).toBe('예전 탭');
    const theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '새 저장본'));
    // 이 탭의 시계가 다음 날로 넘어가 방문을 기록한다
    vi.setSystemTime(new Date('2026-11-26T03:00:00.000Z'));
    tab.recordVisit('2026-11-26');
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    // 이 탭은 저장소의 값을 따라간다(알리지 않는다)
    expect(tab.data?.profile.nickname).toBe('새 저장본');
    expect(toastTexts(tab)).toBe('');
    expect(tab.saveFailed).toBe(false);
    expect(tab.staleNotice).toBeNull();
    // 따라간 뒤의 자동 저장은 그 값 위에 쓴다(화면의 effect 가 다시 부르는 것과 같다)
    tab.recordVisit('2026-11-26');
    expect(stored(storage)?.profile.nickname).toBe('새 저장본');
    expect(stored(storage)?.visits.days).toContain('2026-11-26');
  });

  it('버린 방문 기록이 옛 데이터로 센 복귀 정산을 남기지 않는다', () => {
    const storage = seeded('예전 탭');
    const { tab } = openTab(storage);
    otherTabWrites(storage, (d) => {
      d.visits = { days: ['2026-11-24', TODAY, '2026-12-07'], lastVisit: TODAY };
    });
    vi.setSystemTime(new Date('2026-12-07T03:00:00.000Z'));
    tab.recordVisit('2026-12-07');
    expect(tab.welcomeBack).toBeNull();
    expect(stored(storage)?.visits.days).toEqual(['2026-11-24', TODAY, '2026-12-07']);
  });

  it('업적·도감·승급 확인', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    const theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭'));
    expect(tab.recordAchievements({ 'evt-night': { at: TODAY } })).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);

    const again = otherTabWrites(storage, (d) => (d.profile.step = 6));
    tab.markFormSeen('form-x');
    expect(storage.map.get(KEYS.data)).toBe(again);
    expect(tab.data?.profile.step).toBe(6);

    const third = otherTabWrites(storage, (d) => (d.profile.step = 7));
    tab.acknowledgeGrowth('8', 99, 'form-y');
    expect(storage.map.get(KEYS.data)).toBe(third);
    expect(toastTexts(tab)).toBe('');
  });

  it('행동 배지는 따라간 값 위에 다시 준다(버리지 않는다)', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭'));
    expect(tab.grantEvent('evt-card')).toBe(true);
    expect(stored(storage)?.profile.nickname).toBe('다른 탭');
    expect(stored(storage)?.achievements['evt-card']).toEqual({ at: TODAY });
    // 다른 탭이 이미 준 배지면 새로 얻은 것이 아니다
    otherTabWrites(storage, (d) => (d.achievements['evt-night'] = { at: '2026-11-20' }));
    expect(tab.grantEvent('evt-night')).toBe(false);
    expect(stored(storage)?.achievements['evt-night']).toEqual({ at: '2026-11-20' });
  });
});

describe('사용자 저장은 버리고, 무엇이 일어났는지와 다시 하면 된다는 것을 알린다', () => {
  it('퇴직 예정 달(setRetirePlan, docs/PLAN.md 부록 I39)', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    const theirs = otherTabWrites(storage, (d) => (d.plan.retireMonth = '2040-12'));
    expect(tab.setRetirePlan('2035-06')).toBe('discarded');
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.plan.retireMonth).toBe('2040-12');
    expect(toastTexts(tab)).toMatch(DISCARDED);
    expect(toastTexts(tab)).toContain('다시 해 주세요');
    expect(tab.saveFailed).toBe(false);
    // 다시 하면 바뀐 저장본 위에 저장된다
    expect(tab.setRetirePlan('2035-06')).toBe('saved');
    expect(stored(storage)?.plan.retireMonth).toBe('2035-06');
  });

  it('정한 달이 이 탭의 값과 같아도, 저장소가 바뀌었으면 저장됐다고 하지 않는다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    expect(tab.setRetirePlan('2035-06')).toBe('saved');
    const theirs = otherTabWrites(storage, (d) => (d.plan.retireMonth = null));
    expect(tab.setRetirePlan('2035-06')).toBe('discarded');
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.plan.retireMonth).toBeNull();
  });

  it('연가 기록·지우기·되살리기·부여 시간', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    const record = tab.data?.leave.records[0];
    if (!record) throw new Error('기록이 없다');

    let theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭 1'));
    expect(tab.addLeave([{ date: '2026-11-19', kind: 'day', hours: 8 }])).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.leave.records.map((r) => r.date)).toEqual(['2026-11-20']);

    theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭 2'));
    expect(tab.removeLeave(record.id)).toBeNull();
    expect(storage.map.get(KEYS.data)).toBe(theirs);

    // 되살리기는 알림의 [되돌리기]로만 할 수 있어(눌리면 사라진다) 버리지 않고 따라간 값 위에 한 번 더 한다.
    // id 가 없을 때만 넣는 기록이라 다른 탭의 변경은 남는다
    expect(tab.removeLeave(record.id)).not.toBeNull();
    otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭 3'));
    const before = tab.toasts.length;
    expect(tab.restoreLeave(record)).toBe(true);
    expect(stored(storage)?.profile.nickname).toBe('다른 탭 3');
    expect(stored(storage)?.leave.records.map((r) => r.id)).toEqual([record.id]);
    expect(tab.toasts.length).toBe(before);

    theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭 4'));
    expect(tab.setGrantOverride(2026, 120)).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.toasts.filter((t) => DISCARDED.test(t.text)).length).toBeGreaterThan(0);
  });

  it('여러 날 한꺼번에 넣은 연가 되돌리기: 한 번의 쓰기라 일부만 지워지지 않는다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    expect(
      tab.addLeave([
        { date: '2026-11-18', kind: 'day', hours: 8 },
        { date: '2026-11-19', kind: 'day', hours: 8 },
        { date: '2026-11-20', kind: 'day', hours: 8 },
      ]),
    ).toBe(true);
    const ids = tab.data?.leave.records.map((r) => r.id) ?? [];
    expect(ids).toHaveLength(3);

    // 그 사이 다른 탭이 바꿨으면 하나도 지우지 않고(통째로 버림) 알린다
    const theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭'));
    expect(tab.removeLeaves(ids)).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.leave.records).toHaveLength(3);
    expect(toastTexts(tab)).toMatch(DISCARDED);

    // 다시 누르면 셋 다 지워지고 다른 탭의 변경은 남는다
    expect(tab.removeLeaves(ids)).toBe(true);
    expect(stored(storage)?.leave.records).toHaveLength(0);
    expect(stored(storage)?.profile.nickname).toBe('다른 탭');
    // 지울 것이 없으면 쓰지 않는다
    expect(tab.removeLeaves(ids)).toBe(false);
  });

  it('내 정보 고치기: 승진 연출·직종 안내를 띄우지 않는다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    const theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭'));
    const promoted = profileOf('승진한 나', { rank: '7', rankDate: '2026-11-01', track: 'police' });
    expect(tab.updateProfile(promoted, { celebrate: true })).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.profile.nickname).toBe('다른 탭');
    expect(tab.celebration).toBeNull();
    expect(tab.trackChange).toBeNull();
    expect(toastTexts(tab)).toMatch(DISCARDED);
  });

  it('설정·꾸미기', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    let theirs = otherTabWrites(storage, (d) => (d.settings.payday = 10));
    expect(tab.updateSettings({ hideAmounts: true }, false)).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.settings.hideAmounts).toBe(false);
    expect(tab.data?.settings.payday).toBe(10);

    const look = tab.data?.character.look;
    if (!look) throw new Error('모습이 없다');
    theirs = otherTabWrites(storage, (d) => (d.settings.payday = 17));
    expect(tab.updateLook({ ...look, body: 'mint' })).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
  });

  it('불러오기 되돌리기: 다른 탭이 그 뒤 바꾼 데이터를 보관본으로 덮지 않는다', () => {
    const storage = seeded('처음');
    const { tab } = openTab(storage);
    expect(tab.importData(dataOf('불러온 것'))).toBe('replaced');
    const theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭이 고침'));
    expect(tab.undoImport()).toBe('discarded');
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.undoSavedAt).not.toBeNull();
    expect(toastTexts(tab)).toMatch(DISCARDED);
    // 알고 나서 다시 누르면 되돌린다
    expect(tab.undoImport()).toBe('undone');
    expect(stored(storage)?.profile.nickname).toBe('처음');
  });

  it('모두 지우기: 다른 탭이 바꾼 데이터를 지우지 않는다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    const theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭'));
    expect(tab.reset()).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.profile.nickname).toBe('다른 탭');
    expect(toastTexts(tab)).toMatch(DISCARDED);
    expect(tab.reset()).toBe(true);
    expect(storage.map.has(KEYS.data)).toBe(false);
  });

  it('첫 입력: 그 사이 다른 탭이 먼저 내 정보를 넣었으면 그 데이터를 불러오고 알을 깨우지 않는다', () => {
    const storage = fakeStorage();
    const { tab } = openTab(storage);
    expect(tab.data).toBeNull();
    const theirs = envelopeOf(dataOf('다른 탭에서 먼저'));
    storage.map.set(KEYS.data, theirs);
    expect(tab.createProfile(profileOf('이 탭'), undefined, undefined, { hatch: true })).toBe(
      false,
    );
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.profile.nickname).toBe('다른 탭에서 먼저');
    expect(tab.hatching).toBe(false);
    expect(toastTexts(tab)).toContain(
      "먼저 내 정보를 넣어서 그 데이터(닉네임 '다른 탭에서 먼저')를 불러왔어요",
    );
  });
});

describe('다른 탭이 지웠을 때·읽지 못할 값으로 바꿨을 때', () => {
  it('지웠으면(저장소가 비었으면) 사용자 저장을 버리고 첫 화면으로 간다. 지웠다고 알린다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    storage.map.delete(KEYS.data);
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(false);
    expect(storage.map.has(KEYS.data)).toBe(false);
    expect(tab.data).toBeNull();
    expect(toastTexts(tab)).toContain('데이터를 모두 지워서');
  });

  it('지웠으면 자동 저장은 조용히 첫 화면으로 간다. 연출·복귀 정산도 거둔다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    tab.checkGrowth('8', 9, 'form-x');
    storage.map.delete(KEYS.data);
    vi.setSystemTime(new Date('2026-12-07T03:00:00.000Z'));
    tab.recordVisit('2026-12-07');
    expect(storage.map.has(KEYS.data)).toBe(false);
    expect(tab.data).toBeNull();
    expect(tab.welcomeBack).toBeNull();
    expect(tab.celebration).toBeNull();
    expect(toastTexts(tab)).toBe('');
    // 비어 있으면 첫 입력은 그대로 된다(지킬 데이터가 없다)
    expect(tab.createProfile(profileOf('새로'))).toBe(true);
    expect(stored(storage)?.profile.nickname).toBe('새로');
  });

  it('읽지 못할 값이면 건드리지 않고, 이 탭은 더는 쓰지 않는다(새로 고치라는 띠)', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    storage.map.set(KEYS.data, '{"app":"hobong", 깨짐');
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    expect(storage.map.get(KEYS.data)).toBe('{"app":"hobong", 깨짐');
    expect(tab.staleNotice).toContain('읽지 못했어요');
    expect(tab.saveFailed).toBe(true);
    // '다시 해 주세요'는 하지 않는다(다시 해도 저장되지 않는다)
    expect(toastTexts(tab)).not.toMatch(DISCARDED);
    // 자동 저장도, 지우기도 하지 않는다
    tab.recordVisit('2026-11-26');
    expect(tab.reset()).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe('{"app":"hobong", 깨짐');
    expect(storage.map.has(KEYS.corrupt)).toBe(false);
  });

  it('더 새 버전의 저장본이면 건드리지 않는다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    const newer = storage.map.get(KEYS.data)?.replace('"schemaVersion": 7', '"schemaVersion": 99');
    if (!newer?.includes('"schemaVersion": 99')) throw new Error('버전을 바꾸지 못했다');
    storage.map.set(KEYS.data, newer);
    tab.markFormSeen('form-z');
    expect(storage.map.get(KEYS.data)).toBe(newer);
    expect(tab.staleNotice).toContain('새 버전');
  });
});

describe('거짓 경보 없음: 이 탭 혼자 쓰면 저장이 막히지 않는다', () => {
  it('이어서 여러 번 저장한다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    for (let i = 0; i < 3; i += 1) {
      expect(tab.addLeave([{ date: `2026-11-1${i}`, kind: 'day', hours: 8 }])).toBe(true);
      expect(tab.updateSettings({ payday: 10 + i })).toBe(true);
    }
    expect(tab.setRetirePlan('2035-06')).toBe('saved');
    expect(stored(storage)?.leave.records).toHaveLength(3);
    expect(stored(storage)?.settings.payday).toBe(12);
    expect(toastTexts(tab)).toBe('');
  });

  it.each(['backup-v1.json', 'backup-v3.json', 'backup-v5.json', 'backup-v6.json'])(
    '예전 형식(%s)을 바꿔 열며 다시 저장한 직후',
    (name) => {
      const storage = fakeStorage();
      storage.map.set(KEYS.data, readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8'));
      const { tab } = openTab(storage);
      expect(tab.data).not.toBeNull();
      const env = JSON.parse(storage.map.get(KEYS.data) ?? '{}') as { schemaVersion: number };
      expect(env.schemaVersion).toBe(7);
      expect(tab.updateSettings({ payday: 11 })).toBe(true);
      tab.recordVisit('2026-11-26');
      expect(stored(storage)?.settings.payday).toBe(11);
      expect(tab.staleNotice).toBeNull();
      expect(toastTexts(tab)).not.toMatch(DISCARDED);
    },
  );

  it('따로 옮겨 둔 저장본을 되살린 직후', () => {
    const storage = fakeStorage();
    storage.map.set(KEYS.corrupt, envelopeOf(dataOf('되살림')));
    const { tab } = openTab(storage);
    expect(tab.data?.profile.nickname).toBe('되살림');
    expect(storage.map.has(KEYS.data)).toBe(true);
    expect(tab.updateSettings({ payday: 11 })).toBe(true);
    expect(stored(storage)?.settings.payday).toBe(11);
    expect(tab.staleNotice).toBeNull();
    expect(toastTexts(tab)).not.toMatch(DISCARDED);
  });

  it('불러오기·되돌리기·모두 지우기·첫 입력 뒤', () => {
    const storage = seeded('처음');
    const { tab } = openTab(storage);
    expect(tab.importData(dataOf('불러온 것'))).toBe('replaced');
    expect(tab.updateSettings({ payday: 11 })).toBe(true);
    expect(tab.undoImport()).toBe('undone');
    expect(tab.updateSettings({ payday: 12 })).toBe(true);
    expect(stored(storage)?.profile.nickname).toBe('처음');
    expect(tab.reset()).toBe(true);
    expect(tab.createProfile(profileOf('다시'))).toBe(true);
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    expect(stored(storage)?.leave.records).toHaveLength(1);
    expect(tab.importData(dataOf('또 불러옴'))).toBe('replaced');
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    expect(stored(storage)?.profile.nickname).toBe('또 불러옴');
    expect(toastTexts(tab)).not.toMatch(DISCARDED);
  });

  it('불러오기는 다른 탭이 바꾼 값을 먼저 따라가 그것을 되돌리기 보관본으로 둔다', () => {
    const storage = seeded('처음');
    const { tab } = openTab(storage);
    otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭'));
    expect(tab.importData(dataOf('불러온 것'))).toBe('replaced');
    expect(stored(storage)?.profile.nickname).toBe('불러온 것');
    expect(tab.undoImport()).toBe('undone');
    expect(stored(storage)?.profile.nickname).toBe('다른 탭');
  });

  it('저장소가 막힌 브라우저(사생활 보호 창): 메모리에 두고 계속 저장한다', () => {
    const { tab } = openTab(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(tab.persistent).toBe(false);
    expect(tab.createProfile(profileOf('메모리'))).toBe(true);
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    expect(tab.setRetirePlan('2035-06')).toBe('saved');
    expect(tab.saveFailed).toBe(false);
    expect(tab.staleNotice).toBeNull();
  });

  it('용량이 가득 찬 저장소: 쓰지 못했다고만 알리고 다른 탭 탓으로 보지 않는다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    storage.full = true;
    expect(tab.setRetirePlan('2035-06')).toBe('unsaved');
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    expect(tab.saveFailed).toBe(true);
    expect(tab.staleNotice).toBeNull();
    expect(tab.data?.plan.retireMonth).toBe('2035-06');
    // 공간이 나면 이어서 저장한다
    storage.full = false;
    expect(tab.updateSettings({ payday: 11 })).toBe(true);
    expect(stored(storage)?.plan.retireMonth).toBe('2035-06');
    expect(tab.saveFailed).toBe(false);
  });

  it('storage 이벤트·포커스로 먼저 따라갔으면 그 뒤의 저장은 막히지 않는다', () => {
    const storage = seeded();
    const { tab, fire } = openTab(storage);
    otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭 1'));
    fire('storage');
    expect(tab.data?.profile.nickname).toBe('다른 탭 1');
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭 2'));
    fire('focus');
    expect(tab.setRetirePlan('2035-06')).toBe('saved');
    expect(stored(storage)?.profile.nickname).toBe('다른 탭 2');
    expect(stored(storage)?.leave.records).toHaveLength(1);
    expect(toastTexts(tab)).not.toMatch(DISCARDED);
  });
});

describe('대화상자를 연 뒤 먼저 따라갔을 때(storage 이벤트·포커스, 부록 J13)', () => {
  it('내 정보 고치기: 연 때의 세대로 저장하면 옛 폼으로 덮지 않고 버린다', () => {
    const storage = seeded('처음이름');
    const { tab, fire } = openTab(storage);
    const base = tab.dataGeneration;
    const form = profileOf('처음이름', { series: null });
    const theirs = otherTabWrites(storage, (d) => (d.profile.nickname = 'B가바꾼이름'));
    fire('storage');
    expect(tab.data?.profile.nickname).toBe('B가바꾼이름');
    expect(tab.dataGeneration).toBe(base + 1);
    expect(tab.updateProfile(form, { base })).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(toastTexts(tab)).toMatch(DISCARDED);
    // 다시 열면(지금 세대) 저장된다
    expect(tab.updateProfile(form, { base: tab.dataGeneration })).toBe(true);
    expect(stored(storage)?.profile.nickname).toBe('처음이름');
  });

  it('포커스로 따라간 뒤의 꾸미기·부여 일수·정한 달도 버린다', () => {
    const storage = seeded();
    const { tab, fire } = openTab(storage);
    const base = tab.dataGeneration;
    const look = tab.data?.character.look;
    if (!look) throw new Error('모습이 없다');
    const theirs = otherTabWrites(storage, (d) => (d.plan.retireMonth = '2040-01'));
    fire('focus');
    expect(tab.updateLook({ ...look, body: 'blue' }, base)).toBe(false);
    expect(tab.setGrantOverride(2026, 120, base)).toBe(false);
    expect(tab.setRetirePlan('2035-06', base)).toBe('discarded');
    expect(storage.map.get(KEYS.data)).toBe(theirs);
    expect(tab.data?.plan.retireMonth).toBe('2040-01');
    // 같은 값을 다시 골라도 그 사이 따라갔으면 정했다고 하지 않는다
    expect(tab.setRetirePlan('2040-01', base)).toBe('discarded');
    expect(tab.setRetirePlan('2035-06', tab.dataGeneration)).toBe('saved');
  });

  it('저장 순간에 처음 알게 돼도 같은 세대로 견준다(세대 없이 부르는 곳은 예전처럼)', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    const base = tab.dataGeneration;
    const theirs = otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭'));
    expect(tab.setGrantOverride(2026, 120, base)).toBe(false);
    expect(storage.map.get(KEYS.data)).toBe(theirs);
  });

  it('이 탭이 쓴 것·되돌리기 보관본만 바뀐 이벤트로는 세대가 오르지 않는다', () => {
    const storage = seeded();
    const { tab, fire } = openTab(storage);
    const base = tab.dataGeneration;
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    expect(tab.updateSettings({ payday: 11 })).toBe(true);
    fire('storage');
    fire('focus');
    expect(tab.dataGeneration).toBe(base);
    expect(tab.setGrantOverride(2026, 120, base)).toBe(true);
    expect(tab.importData(dataOf('불러온 것'))).toBe('replaced');
    expect(tab.dataGeneration).toBe(base);
  });
});

describe('버린 뒤의 알림·결과', () => {
  it('다시 해서 저장되면 남아 있던 "저장하지 않았어요" 알림을 닫는다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    otherTabWrites(storage, (d) => (d.profile.nickname = '다른 탭'));
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(false);
    expect(toastTexts(tab)).toMatch(DISCARDED);
    expect(tab.addLeave([{ date: '2026-11-20', kind: 'day', hours: 8 }])).toBe(true);
    expect(toastTexts(tab)).not.toMatch(DISCARDED);
  });

  it('다른 탭이 이미 모두 지웠으면 모두 지우기는 지웠다고 한다', () => {
    const storage = seeded();
    const { tab } = openTab(storage);
    storage.map.delete(KEYS.data);
    expect(tab.reset()).toBe(true);
    expect(tab.data).toBeNull();
    expect(toastTexts(tab)).not.toContain('방금 한 것은 저장하지 않았어요');
  });

  it('이 탭이 더 쓰지 않는 상태면 되돌리기는 "없어요"가 아니라 저장할 수 없다고 한다', () => {
    const storage = seeded('처음');
    const { tab } = openTab(storage);
    expect(tab.importData(dataOf('불러온 것'))).toBe('replaced');
    storage.map.set(KEYS.data, '{"app":"hobong", 깨짐');
    expect(tab.undoImport()).toBe('blocked');
    expect(toastTexts(tab)).toContain('지금은 저장할 수 없어요');
    expect(tab.undoImport()).toBe('blocked');
    expect(storage.map.get(KEYS.data)).toBe('{"app":"hobong", 깨짐');
  });
});
