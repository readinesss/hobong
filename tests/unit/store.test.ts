/* eslint-disable @typescript-eslint/no-explicit-any -- 일부러 틀린 데이터를 손으로 만든다 */
/**
 * 저장·불러오기 검증.
 * - 내보내기 → 초기화 → 불러오기 후 상태가 완전히 같은지
 * - 구버전(v1) 파일이 현재 형식으로 변환되는지
 * - 형식이 다르거나 손상된 파일은 기존 데이터를 건드리지 않고 거부하는지
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { careerLookup, rulesFor } from '../../src/lib/rules/index.ts';
import type { GradeKey } from '../../src/lib/rules/types.ts';
import {
  backupFileName,
  makeEnvelope,
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
  type ParseContext,
} from '../../src/lib/store/backup.ts';
import {
  DEFAULT_LOOK,
  defaultLook,
  defaultSettings,
  newUserData,
} from '../../src/lib/store/defaults.ts';
import { SCHEMA_VERSION, type Profile, type UserData } from '../../src/lib/store/schema.ts';
import {
  clearAll,
  clearCorrupt,
  clearUndo,
  hasCorrupt,
  isNewerData,
  KEYS,
  loadData,
  loadUndo,
  memoryStore,
  openStore,
  readCorrupt,
  saveData,
  saveUndo,
} from '../../src/lib/store/storage.ts';
import {
  checkProfile,
  cleanText,
  graphemes,
  isIsoInstant,
  validateUserData,
} from '../../src/lib/store/validate.ts';
import { nextRaiseDate, stepOn } from '../../src/lib/calc/step.ts';
import { buildMilestones } from '../../src/lib/calc/milestones.ts';
import { salaryOn } from '../../src/lib/calc/salary.ts';

const TODAY = '2026-11-25';
const NOW = '2026-11-25T01:00:00.000Z';
const R = rulesFor(2026);
const ctx: ParseContext = {
  today: TODAY,
  ...careerLookup(R),
  defaultSettings: defaultSettings(R),
  nowIso: NOW,
};

function sampleProfile(over: Partial<Profile> = {}): Profile {
  return {
    nickname: '호봉이',
    birthDate: '1995-05-20',
    hireDate: '2020-01-01',
    track: 'general',
    series: null,
    payTable: 'table3',
    rank: '8',
    rankDate: '2024-07-01',
    step: 6,
    nextStepDate: '2027-01-01',
    stepAsOf: '2026-11-25',
    overrides: { longServiceDate: null, seniorDate: '2028-08-01', rankLimitDate: null },
    ...over,
  };
}

function sampleData(): UserData {
  const data = newUserData(sampleProfile(), defaultSettings(R), NOW, TODAY);
  data.settings = {
    ...data.settings,
    payday: 20,
    theme: 'dark',
    hideAmounts: true,
    tabTitle: 'countdown',
    work: { start: '08:30', end: '17:30', lunchStart: '11:30', lunchEnd: '12:30' },
    card: {
      ratio: 'portrait',
      showSalary: true,
      showRetirement: false,
      showTenure: true,
      showBadges: false,
      showRank: true,
      showSeries: false,
    },
  };
  data.leave = {
    records: [
      { id: 'a1', date: '2026-03-03', hours: 8, kind: 'day', memo: '가족 여행' },
      { id: 'a2', date: '2026-03-04', hours: 4, kind: 'am', memo: '' },
      { id: 'a3', date: '2026-08-10', hours: 2, kind: 'hours', memo: '병원' },
    ],
    grantOverrideHours: { '2026': 184 },
  };
  data.achievements = { hire: { at: '2020-01-01' }, 'first-leave': { at: '2026-03-03' } };
  data.character = {
    seenForms: ['egg', 'chick'],
    lastRank: '8',
    lastStep: 6,
    lastForm: null,
    look: defaultLook(),
  };
  data.visits = { days: ['2026-11-23', '2026-11-24', '2026-11-25'], lastVisit: '2026-11-24' };
  data.meta = {
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: NOW,
    lastBackupAt: null,
    changesSinceBackup: 7,
  };
  return data;
}

/** v4 데이터가 v5 로 바뀔 때 더해지는 것(지금과 같은 모습·동작의 기본값). 나머지는 그대로다 */
function asV5(v4: any): any {
  const d = defaultSettings(R);
  return {
    ...v4,
    profile: { ...v4.profile, series: null },
    settings: {
      ...v4.settings,
      card: { ...v4.settings.card, showSeries: false },
      identity: d.identity,
      haptics: d.haptics,
      sound: d.sound,
      pointer: d.pointer,
      sparkles: d.sparkles,
    },
    character: { ...v4.character, look: defaultLook() },
  };
}

describe('내보내기 → 초기화 → 불러오기', () => {
  it('왕복해도 상태가 완전히 같다', () => {
    const data = sampleData();
    const text = serializeBackup(makeEnvelope(data, '0.1.0', NOW));
    const parsed = parseBackup(text, ctx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data).toEqual(data);
    expect(parsed.migrated).toBe(false);
    expect(parsed.fromVersion).toBe(SCHEMA_VERSION);
    expect(parsed.exportedAt).toBe(NOW);
    expect(parsed.appVersion).toBe('0.1.0');
    // 한 번 더 내보내도 글자 하나 다르지 않다
    expect(serializeBackup(makeEnvelope(parsed.data, '0.1.0', NOW))).toBe(text);
  });

  it('저장소를 지우고 파일에서 되살릴 수 있다', () => {
    const store = memoryStore();
    const data = sampleData();
    expect(saveData(store, data, '0.1.0', NOW)).toBe(true);
    const file = serializeBackup(makeEnvelope(data, '0.1.0', NOW));
    clearAll(store);
    expect(loadData(store, ctx)).toEqual({ status: 'empty' });
    const parsed = parseBackup(file, ctx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    saveData(store, parsed.data, '0.1.0', NOW);
    expect(loadData(store, ctx)).toEqual({
      status: 'ok',
      data,
      migrated: false,
      fromVersion: SCHEMA_VERSION,
      restored: false,
    });
  });

  it('파일에는 파생 값이 없다(입력값과 기록만 담는다)', () => {
    const env = JSON.parse(serializeBackup(makeEnvelope(sampleData(), '0.1.0', NOW)));
    expect(Object.keys(env)).toEqual(['app', 'schemaVersion', 'appVersion', 'exportedAt', 'data']);
    expect(Object.keys(env.data).sort()).toEqual(
      ['achievements', 'character', 'leave', 'meta', 'profile', 'settings', 'visits'].sort(),
    );
    const text = JSON.stringify(env);
    for (const derived of ['salary', 'retire', 'remaining', 'daysLeft', 'amount']) {
      expect(text.toLowerCase()).not.toContain(`"${derived.toLowerCase()}`);
    }
  });

  it('파일 이름', () => {
    expect(backupFileName('2026-11-25')).toBe('hobong-backup-20261125.json');
  });
});

describe('구버전(v1) 파일 변환', () => {
  const text = readFileSync(join(process.cwd(), 'tests/fixtures/backup-v1.json'), 'utf8');
  it('현재 형식으로 바뀌어 열린다', () => {
    const parsed = parseBackup(text, ctx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migrated).toBe(true);
    expect(parsed.fromVersion).toBe(1);
    expect(parsed.data.profile).toEqual({
      nickname: '김주무관',
      birthDate: '1996-04-12',
      hireDate: '2022-09-01',
      track: 'general',
      series: null,
      payTable: 'table3',
      rank: '9',
      rankDate: '2022-09-01',
      step: 4,
      nextStepDate: '2026-09-01',
      // 확인한 날은 알 수 없으므로 파일을 내보낸 날로 채운다
      stepAsOf: '2026-06-15',
      overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    });
    expect(parsed.data.leave.records).toEqual([
      { id: 'v1-1', date: '2026-01-02', hours: 8, kind: 'day', memo: '' },
      { id: 'v1-2', date: '2026-03-13', hours: 4, kind: 'am', memo: '' },
      { id: 'v1-3', date: '2026-05-04', hours: 2, kind: 'hours', memo: '' },
    ]);
    expect(parsed.data.leave.grantOverrideHours).toEqual({ '2026': 128 });
    expect(parsed.data.achievements).toEqual({
      hire: { at: '2026-06-15' },
      probation: { at: '2026-06-15' },
    });
    expect(parsed.data.settings).toEqual({ ...defaultSettings(R), theme: 'dark' });
    expect(parsed.data.character).toEqual({
      seenForms: [],
      lastRank: '9',
      lastStep: 4,
      lastForm: null,
      look: defaultLook(),
    });
    expect(parsed.data.meta.createdAt).toBe('2026-02-01T00:00:00.000Z');
  });
  it('변환한 결과를 다시 내보내면 현재 버전 파일이 된다', () => {
    const parsed = parseBackup(text, ctx);
    if (!parsed.ok) throw new Error('변환 실패');
    const again = parseBackup(serializeBackup(makeEnvelope(parsed.data, '0.1.0', NOW)), ctx);
    expect(again.ok && again.migrated).toBe(false);
    expect(again.ok && again.data).toEqual(parsed.data);
  });
  it('v2 파일: 호봉을 확인한 날을 채워 넣는다', () => {
    const v2 = readFileSync(join(process.cwd(), 'tests/fixtures/backup-v2.json'), 'utf8');
    const parsed = parseBackup(v2, ctx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fromVersion).toBe(2);
    expect(parsed.migrated).toBe(true);
    // 마지막으로 고친 날(2026-11-24)이 다음 승급일(2027-12-01)보다 앞이므로 그날로 둔다.
    expect(parsed.data.profile.stepAsOf).toBe('2026-11-24');
    // 나머지는 그대로다
    const before = JSON.parse(v2).data;
    const { grade: _g, gradeDate, overrides, ...profileRest } = before.profile;
    const { lastGrade: _lg, ...characterRest } = before.character;
    expect({ ...parsed.data, profile: { ...parsed.data.profile, stepAsOf: undefined } }).toEqual(
      // v4 이름으로 바뀐 것과 v5 에 더해진 것 말고는 그대로다
      asV5({
        ...before,
        profile: {
          ...profileRest,
          track: 'general',
          payTable: 'table3',
          rank: '9',
          rankDate: gradeDate,
          overrides: { ...overrides, rankLimitDate: null },
          stepAsOf: undefined,
        },
        settings: { ...before.settings, card: { ...before.settings.card, showRank: true } },
        character: { ...characterRest, lastRank: '9', lastForm: null },
      }),
    );
    // 다음 승급일이 1년보다 멀어도 지금 호봉은 넣은 값 그대로다(v2에서는 4호봉으로 내려갔다).
    expect(stepOn(parsed.data.profile, TODAY, 31)).toBe(5);
    expect(nextRaiseDate(parsed.data.profile, TODAY, 31)).toBe('2027-12-01');
  });
  it('v2 파일: 다음 승급일이 이미 지났으면 그 전날을 확인한 날로 둔다(계산은 v2와 같다)', () => {
    const v2 = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fixtures/backup-v2.json'), 'utf8'),
    );
    v2.data.profile.nextStepDate = '2026-07-01';
    const parsed = parseBackup(JSON.stringify(v2), ctx);
    expect(parsed.ok && parsed.data.profile.stepAsOf).toBe('2026-06-30');
    if (!parsed.ok) return;
    expect(stepOn(parsed.data.profile, TODAY, 31)).toBe(6);
    expect(stepOn(parsed.data.profile, '2026-06-30', 31)).toBe(5);
    expect(stepOn(parsed.data.profile, '2025-06-30', 31)).toBe(4);
  });
  it('저장소에 남아 있던 구버전 데이터도 같은 길로 변환된다', () => {
    const store = memoryStore();
    store.setItem(KEYS.data, text);
    const loaded = loadData(store, ctx);
    expect(loaded.status).toBe('ok');
    expect(loaded.status === 'ok' && loaded.migrated).toBe(true);
  });
});

describe('불러오기 전 검증: 틀린 파일은 거부한다', () => {
  const good = () => JSON.parse(serializeBackup(makeEnvelope(sampleData(), '0.1.0', NOW)));
  const reason = (value: unknown): string => {
    const r = parseBackup(typeof value === 'string' ? value : JSON.stringify(value), ctx);
    return r.ok ? 'OK' : [r.reason, ...r.details].join(' | ');
  };

  it('빈 파일·깨진 JSON·다른 파일', () => {
    expect(reason('')).toContain('비어 있어요');
    expect(reason('   ')).toContain('비어 있어요');
    expect(reason('{"app":"hobong","schemaVersion":2,"data":{')).toContain('손상');
    expect(reason('<html></html>')).toContain('손상');
    expect(reason([])).toContain('호봉 데이터 파일이 아니에요');
    expect(reason({ app: 'other', schemaVersion: 2, data: {} })).toContain(
      '호봉 데이터 파일이 아니에요',
    );
    expect(reason('null')).toContain('호봉 데이터 파일이 아니에요');
    expect(reason('x'.repeat(MAX_BACKUP_BYTES + 1))).toContain('너무 커요');
    expect(reason('{')).toContain('백업 데이터 형식(JSON)이 아니에요');
    // 저장소·붙여넣기에서 읽은 경우에도 맞는 말: '파일'이라고 단정하지 않는다
    expect(reason('{')).toContain('데이터를 읽지 못했어요');
    expect(reason('{')).not.toContain('파일');
  });
  it('세부 사유에 내부 키 이름을 쓰지 않는다', () => {
    const env = good();
    env.data.settings.work.lunchStart = '25:00';
    const text = reason(env);
    expect(text).toContain('점심');
    expect(text).not.toContain('lunchStart');
    expect(reason({ ...good(), schemaVersion: '2' })).not.toContain('schemaVersion');
  });
  it('버전 정보', () => {
    expect(reason({ ...good(), schemaVersion: 99 })).toContain('더 새 버전');
    expect(reason({ ...good(), schemaVersion: '2' })).toContain('버전 정보');
    expect(reason({ ...good(), schemaVersion: 0 })).toContain('버전 정보');
    expect(reason({ app: 'hobong', schemaVersion: 2 })).toContain('데이터가 없어요');
  });
  it('BOM이 붙은 파일은 그대로 읽는다', () => {
    expect(reason(`\ufeff${JSON.stringify(good())}`)).toBe('OK');
  });
  it('내 정보가 틀린 파일', () => {
    const cases: [(env: ReturnType<typeof good>) => void, string][] = [
      [(e) => (e.data.profile.birthDate = '1995-02-30'), '생년월일'],
      [(e) => (e.data.profile.hireDate = '2030-01-01'), '임용일'],
      [(e) => (e.data.profile.rank = '10'), '직급'],
      [(e) => (e.data.profile.step = 40), '31호봉까지'],
      [(e) => (e.data.profile.step = 1.5), '호봉'],
      [(e) => (e.data.profile.nickname = ''), '닉네임'],
      [(e) => (e.data.profile.rankDate = '2019-01-01'), '현 직급 임용일'],
      [(e) => (e.data.profile.nextStepDate = '2019-01-01'), '다음 승급일'],
      [(e) => (e.data.profile.overrides.seniorDate = 'soon'), '날짜를 다시 확인'],
      [(e) => delete e.data.profile, '내 정보'],
    ];
    for (const [mutate, expected] of cases) {
      const env = good();
      mutate(env);
      expect(reason(env)).toContain(expected);
    }
  });
  it('설정·연가·기록이 틀린 파일', () => {
    const cases: [(env: ReturnType<typeof good>) => void, string][] = [
      [(e) => (e.data.settings.payday = 32), '보수 지급일'],
      [(e) => (e.data.settings.work.start = '아침'), '근무시간'],
      [(e) => (e.data.settings.theme = 'pink'), '테마'],
      [(e) => (e.data.settings.card.ratio = 'wide'), '카드'],
      [(e) => delete e.data.settings, '설정 값이 없어요'],
      [(e) => (e.data.leave.records[0].date = '2026-02-31'), '연가 기록 1번째'],
      [(e) => (e.data.leave.records[1].hours = 0), '연가 기록 2번째'],
      [(e) => (e.data.leave.records[1].id = 'a1'), '연가 기록 2번째'],
      [(e) => (e.data.leave.records[0].kind = 'sick'), '연가 기록 1번째'],
      [(e) => (e.data.leave.records = 'none'), '연가 장부'],
      [(e) => (e.data.leave.grantOverrideHours = { '26': 8 }), '부여일수'],
      [(e) => (e.data.achievements = []), '업적'],
      [(e) => (e.data.achievements = { 'bad id!': { at: '2026-01-01' } }), '업적'],
      [(e) => (e.data.character.lastRank = 7), '캐릭터'],
      [(e) => (e.data.visits.days = ['2026-13-01']), '출근 도장'],
      [(e) => (e.data.meta.updatedAt = 'yesterday'), '기록 시각'],
    ];
    for (const [mutate, expected] of cases) {
      const env = good();
      mutate(env);
      expect(reason(env)).toContain(expected);
    }
  });
  it('알 수 없는 속성은 버리고, 문자열은 다듬는다', () => {
    const env = good();
    env.data.extra = { evil: true };
    env.data.profile.__proto__ = { polluted: true };
    env.data.profile.nickname = '  호\u0000봉\u202e이  ';
    env.data.leave.records[0].memo = `${'가'.repeat(60)}<script>`;
    const parsed = parseBackup(JSON.stringify(env), ctx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.profile.nickname).toBe('호봉이');
    expect(parsed.data.leave.records[0]?.memo).toBe('가'.repeat(40));
    expect('extra' in parsed.data).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('기존 데이터는 거부 뒤에도 그대로다', () => {
    const store = memoryStore();
    const data = sampleData();
    saveData(store, data, '0.1.0', NOW);
    const before = store.getItem(KEYS.data);
    expect(parseBackup('{"app":"hobong"', ctx).ok).toBe(false);
    expect(store.getItem(KEYS.data)).toBe(before);
    expect(loadData(store, ctx)).toEqual({
      status: 'ok',
      data,
      migrated: false,
      fromVersion: SCHEMA_VERSION,
      restored: false,
    });
  });
});

describe('되돌리기와 손상된 저장본', () => {
  it('덮어쓰기 직전 상태를 보관했다가 되돌린다', () => {
    const store = memoryStore();
    const before = sampleData();
    saveData(store, before, '0.1.0', NOW);
    const incoming = sampleData();
    incoming.profile = sampleProfile({
      nickname: '새사람',
      rank: '7',
      rankDate: '2025-01-01',
      step: 3,
    });
    // 불러오기: 직전 상태 보관 → 덮어쓰기
    expect(saveUndo(store, before, '0.1.0', NOW)).toBe(true);
    saveData(store, incoming, '0.1.0', NOW);
    const now = loadData(store, ctx);
    expect(now.status === 'ok' && now.data.profile.nickname).toBe('새사람');
    // 되돌리기
    const undo = loadUndo(store, ctx);
    expect(undo?.data).toEqual(before);
    expect(undo?.savedAt).toBe(NOW);
    saveData(store, undo?.data as UserData, '0.1.0', NOW);
    clearUndo(store);
    expect(loadData(store, ctx)).toEqual({
      status: 'ok',
      data: before,
      migrated: false,
      fromVersion: SCHEMA_VERSION,
      restored: false,
    });
    expect(loadUndo(store, ctx)).toBeNull();
  });
  it('읽지 못한 저장본은 버리지 않고 따로 옮겨 둔다', () => {
    const store = memoryStore();
    store.setItem(KEYS.data, '{"app":"hobong","schemaVersion":2,"data":{"profile":');
    const loaded = loadData(store, ctx);
    expect(loaded.status).toBe('corrupt');
    expect(hasCorrupt(store)).toBe(true);
    expect(readCorrupt(store)[0]).toContain('"profile":');
    expect(store.getItem(KEYS.data)).toBeNull();
    expect(loadData(store, ctx)).toEqual({ status: 'empty' });
    clearAll(store);
    expect(hasCorrupt(store)).toBe(false);
  });
  it('localStorage가 막혀 있으면 메모리에만 저장한다', () => {
    const blocked = openStore(() => {
      throw new Error('SecurityError');
    });
    expect(blocked.persistent).toBe(false);
    expect(saveData(blocked.store, sampleData(), '0.1.0', NOW)).toBe(true);
    expect(loadData(blocked.store, ctx).status).toBe('ok');

    const quota = openStore(() => ({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    }));
    // 쓰기만 막혔고 읽을 수는 있으면, 기존 데이터를 보여 줄 수 있게 그 저장소를 쓴다(쓰기 불가로 표시).
    expect(quota).toMatchObject({ persistent: true, writable: false });
    const unreadable = openStore(() => ({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => undefined,
    }));
    expect(unreadable).toMatchObject({ persistent: false, writable: true });
    expect(openStore(() => undefined).persistent).toBe(false);
    expect(openStore(() => memoryStore()).persistent).toBe(true);
  });
  it('저장에 실패하면 false를 돌려준다', () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(saveData(failing, sampleData(), '0.1.0', NOW)).toBe(false);
  });
});

describe('저장본을 지키는 규칙', () => {
  const sv = SCHEMA_VERSION;
  const envelopeText = (version: number, data: unknown = sampleData()) =>
    JSON.stringify({
      app: 'hobong',
      schemaVersion: version,
      appVersion: '9.9.9',
      exportedAt: NOW,
      data,
    });

  it('더 새로운 버전의 저장본은 손상으로 보지 않고 그대로 둔다', () => {
    const store = memoryStore();
    const newer = envelopeText(sv + 1);
    store.setItem(KEYS.data, newer);
    const loaded = loadData(store, ctx);
    expect(loaded.status).toBe('newer');
    expect(store.getItem(KEYS.data)).toBe(newer);
    expect(hasCorrupt(store)).toBe(false);
    expect(isNewerData(store, ctx)).toBe(true);
    // 다시 열어도 같다
    expect(loadData(store, ctx).status).toBe('newer');
    expect(store.getItem(KEYS.data)).toBe(newer);
  });

  it('다른 탭이 쓴 값을 읽을 때(readOnly)는 읽지 못해도 아무것도 옮기거나 지우지 않는다', () => {
    const store = memoryStore();
    store.setItem(KEYS.data, '{"broken":');
    expect(loadData(store, ctx, { readOnly: true })).toMatchObject({
      status: 'corrupt',
      kept: false,
    });
    expect(store.getItem(KEYS.data)).toBe('{"broken":');
    expect(hasCorrupt(store)).toBe(false);
  });

  it('읽지 못한 저장본이 거듭 생겨도 처음 보관본은 덮어쓰지 않는다', () => {
    const store = memoryStore();
    store.setItem(KEYS.data, 'first-broken-'.repeat(20));
    loadData(store, ctx);
    store.setItem(KEYS.data, 'x');
    loadData(store, ctx);
    expect(readCorrupt(store)).toEqual(['first-broken-'.repeat(20), 'x']);
    clearCorrupt(store);
    expect(hasCorrupt(store)).toBe(false);
  });

  it('보관에 실패하면 원래 저장본을 지우지 않는다', () => {
    const inner = memoryStore();
    const store = {
      getItem: (k: string) => inner.getItem(k),
      setItem: (k: string, v: string) => {
        if (k.startsWith(KEYS.corrupt)) throw new Error('QuotaExceededError');
        inner.setItem(k, v);
      },
      removeItem: (k: string) => inner.removeItem(k),
    };
    store.setItem(KEYS.data, '{"broken":');
    expect(loadData(store, ctx)).toMatchObject({ status: 'corrupt', kept: false });
    expect(store.getItem(KEYS.data)).toBe('{"broken":');
  });

  it('예전 사본이 옮겨 버린 저장본이 지금 읽히면 되살린다', () => {
    const store = memoryStore();
    const good = serializeBackup(makeEnvelope(sampleData(), '0.1.0', NOW));
    store.setItem(KEYS.corrupt, good);
    const loaded = loadData(store, ctx);
    expect(loaded).toMatchObject({ status: 'ok', restored: true });
    expect(store.getItem(KEYS.data)).toBe(good);
    expect(hasCorrupt(store)).toBe(false);
  });

  it('저장본은 "오늘"에 따라 달라지는 검사를 하지 않는다(시계가 뒤로 가도 손상이 아니다)', () => {
    const store = memoryStore();
    const data = sampleData();
    data.profile = sampleProfile({ hireDate: TODAY, rankDate: TODAY, nextStepDate: '2031-11-25' });
    saveData(store, data, '0.1.0', NOW);
    const yesterday = { ...ctx, today: '2026-11-24', stored: true };
    expect(loadData(store, yesterday).status).toBe('ok');
    expect(store.getItem(KEYS.data)).not.toBeNull();
    // 같은 내용을 파일로 불러오면(어제 날짜 기준) 여전히 거부한다
    const text = store.getItem(KEYS.data) as string;
    expect(parseBackup(text, { ...ctx, today: '2026-11-24' }).ok).toBe(false);
  });
});

describe('불러오기 검증을 좁힌다', () => {
  const withData = (patch: (d: Record<string, any>) => void) => {
    const data = JSON.parse(JSON.stringify(sampleData())) as Record<string, any>;
    patch(data);
    return JSON.stringify({
      app: 'hobong',
      schemaVersion: SCHEMA_VERSION,
      appVersion: '0.1.0',
      exportedAt: NOW,
      data,
    });
  };
  const rejects = (patch: (d: Record<string, any>) => void) =>
    expect(parseBackup(withData(patch), ctx).ok).toBe(false);
  const accepts = (patch: (d: Record<string, any>) => void) =>
    expect(parseBackup(withData(patch), ctx).ok).toBe(true);

  it('기록 시각은 앱이 쓰는 형식과 범위만 받는다', () => {
    for (const bad of [
      '2300-01-01T00:00:00.000Z',
      '1800-06-01T00:00:00Z',
      '+275760-09-13T00:00:00.000Z',
      '1',
      '2026',
      '(<img src=x>) 2020',
    ])
      rejects((d) => (d.meta.lastBackupAt = bad));
    rejects((d) => (d.meta.createdAt = '2026'));
    accepts((d) => (d.meta.lastBackupAt = '2026-11-25T01:30:01.788Z'));
    accepts((d) => (d.meta.lastBackupAt = '2026-11-25T10:30:00+09:00'));
    expect(isIsoInstant('2026-11-25T01:30:01.788Z')).toBe(true);
  });

  it('연가 기록은 종류와 시간이 맞고, 날짜가 계산할 수 있는 범위여야 한다', () => {
    const rec = (over: Record<string, unknown>) => ({
      id: 'z1',
      date: '2026-03-03',
      hours: 8,
      kind: 'day',
      memo: '',
      ...over,
    });
    rejects((d) => d.leave.records.push(rec({ date: '1900-01-01' })));
    rejects((d) => d.leave.records.push(rec({ date: '2200-12-31' })));
    rejects((d) => d.leave.records.push(rec({ hours: 24, kind: 'hours' })));
    rejects((d) => d.leave.records.push(rec({ hours: 3, kind: 'day' })));
    rejects((d) => d.leave.records.push(rec({ hours: 8, kind: 'am' })));
    accepts((d) => d.leave.records.push(rec({})));
    accepts((d) =>
      d.leave.records.push(
        rec({ id: 'z2', hours: 4, kind: 'am' }),
        rec({ id: 'z3', hours: 4, kind: 'pm' }),
      ),
    );
    accepts((d) => d.leave.records.push(rec({ hours: 2, kind: 'hours' })));
  });

  it('근무시간은 앞뒤가 맞아야 한다(불러오기)', () => {
    rejects(
      (d) =>
        (d.settings.work = {
          start: '18:00',
          end: '09:00',
          lunchStart: '12:00',
          lunchEnd: '13:00',
        }),
    );
    rejects(
      (d) =>
        (d.settings.work = {
          start: '09:00',
          end: '09:00',
          lunchStart: '09:00',
          lunchEnd: '09:00',
        }),
    );
  });

  it('업적 id 는 앱이 만드는 꼴만, 개수도 제한한다', () => {
    rejects((d) => (d.achievements = JSON.parse('{"__proto__": {"at": "2026-01-01"}}')));
    rejects((d) => (d.achievements = { constructor: { at: '2026-01-01' } }));
    rejects((d) => (d.achievements = { toString: { at: '2026-01-01' } }));
    rejects((d) => {
      d.achievements = {};
      for (let i = 0; i < 1001; i += 1) d.achievements[`visit-${i}`] = { at: '2026-01-01' };
    });
    accepts(
      (d) =>
        (d.achievements = {
          'evt-card': { at: '2026-01-01' },
          'leave-half-2026': { at: '2026-05-01' },
        }),
    );
  });

  it('호봉을 확인한 날은 임용일보다 앞설 수 없다', () => {
    rejects((d) => (d.profile.stepAsOf = '1900-01-01'));
    accepts((d) => (d.profile.stepAsOf = '2026-11-20'));
    // 저장본에서는 임용일로 올려 읽는다
    const text = withData((d) => (d.profile.stepAsOf = '1990-01-01'));
    const stored = parseBackup(text, { ...ctx, stored: true });
    expect(stored.ok && stored.data.profile.stepAsOf).toBe(sampleProfile().hireDate);
  });

  it('결합 이모지는 쪼개지 않고, 보이지 않는 조작 문자는 지운다', () => {
    expect(cleanText('🧑‍💻주무관', 12)).toBe('🧑‍💻주무관');
    expect(cleanText('a\u200bb\u202ec', 12)).toBe('abc');
    expect(graphemes('🧑‍💻가').length).toBe(2);
  });

  it('v1 변환은 틀린 연가 행을 숨기지 않고 거부한다', () => {
    const v1 = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fixtures/backup-v1.json'), 'utf8'),
    );
    v1.data.leave.push({ date: '2026-02-30', unit: 'day' });
    const parsed = parseBackup(JSON.stringify(v1), ctx);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.details.join(' ')).toContain('연가 기록 4번째');
  });
});

describe('입력 폼 검사', () => {
  const base = sampleProfile();
  it('올바른 입력은 오류가 없다', () => {
    expect(checkProfile(base, ctx)).toEqual({});
    expect(checkProfile({ ...base, rankDate: base.hireDate, rank: '9' }, ctx)).toEqual({});
    expect(
      checkProfile({ ...base, hireDate: TODAY, rankDate: TODAY, nextStepDate: '2027-11-01' }, ctx),
    ).toEqual({});
  });
  it('항목별 오류', () => {
    expect(checkProfile({ ...base, nickname: '   ' }, ctx).nickname).toBeDefined();
    expect(checkProfile({ ...base, nickname: '가'.repeat(13) }, ctx).nickname).toContain('12자');
    expect(checkProfile({ ...base, birthDate: '2030-01-01' }, ctx).birthDate).toBeDefined();
    expect(checkProfile({ ...base, birthDate: '1900-01-01' }, ctx).birthDate).toBeDefined();
    // 기준을 말해 준다
    expect(checkProfile({ ...base, birthDate: '1929-12-31' }, ctx).birthDate).toContain('1930');
    expect(checkProfile({ ...base, birthDate: '2010-01-01' }, ctx).hireDate).toContain(
      '너무 일러요',
    );
    expect(checkProfile({ ...base, hireDate: '2026-11-26' }, ctx).hireDate).toBeDefined();
    expect(checkProfile({ ...base, rank: '9', step: 32 }, ctx).step).toBe(
      '9급은 31호봉까지 있어요.',
    );
    expect(checkProfile({ ...base, rank: '6', step: 32 }, ctx).step).toBeUndefined();
    expect(checkProfile({ ...base, nextStepDate: '2040-01-01' }, ctx).nextStepDate).toContain(
      '5년 안',
    );
    expect(
      checkProfile(
        {
          ...base,
          overrides: { longServiceDate: '2020-01-01', seniorDate: null, rankLimitDate: null },
        },
        ctx,
      ).longServiceDate,
    ).toBeDefined();
    expect(checkProfile(null, ctx).nickname).toBeDefined();
    expect(checkProfile({ ...base, stepAsOf: '2026-13-01' }, ctx).stepAsOf).toBeDefined();
    expect(checkProfile({ ...base, stepAsOf: undefined }, ctx)).toEqual({});
  });
  it('입력 폼에서만: 다음 승급일은 앞날, 최고호봉이 된 날은 지난날', () => {
    const future = { ...ctx, raiseDateRule: 'future' as const };
    expect(checkProfile({ ...base, nextStepDate: '2026-11-26' }, future)).toEqual({});
    expect(checkProfile({ ...base, nextStepDate: TODAY }, future).nextStepDate).toContain(
      '오늘보다 뒤',
    );
    // 저장된 값에는 이 검사를 하지 않는다(승급일이 지나도 저장값은 그대로다)
    expect(checkProfile({ ...base, nextStepDate: '2026-01-01' }, ctx)).toEqual({});

    const reached = { ...ctx, raiseDateRule: 'reached' as const };
    expect(checkProfile({ ...base, nextStepDate: '2025-01-01' }, reached)).toEqual({});
    expect(checkProfile({ ...base, nextStepDate: TODAY }, reached)).toEqual({});
    expect(checkProfile({ ...base, nextStepDate: '2027-01-01' }, reached).nextStepDate).toContain(
      '최고호봉이 된 날',
    );
    expect(checkProfile({ ...base, nextStepDate: '' }, reached).nextStepDate).toContain(
      '최고호봉이 된 날',
    );
  });
  it('문자열 다듬기', () => {
    expect(cleanText('  안녕\n하세요\t ', 10)).toBe('안녕하세요');
    expect(cleanText('😀😀😀', 2)).toBe('😀😀');
    expect(cleanText(123, 5)).toBe('');
  });
  it('검증 함수는 원본 객체를 그대로 돌려주지 않는다', () => {
    const data = sampleData();
    const result = validateUserData(JSON.parse(JSON.stringify(data)), ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(data);
      expect(result.value).not.toBe(data);
    }
  });
});

describe('저장 형식 v4: 직종·봉급표·계급 키', () => {
  const fixture = (name: string) =>
    readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
  const stored = { ...ctx, stored: true };
  /** 현재 버전 겉봉에 data 를 담아 글자로 */
  const envelope = (data: unknown, version = SCHEMA_VERSION) =>
    JSON.stringify({
      app: 'hobong',
      schemaVersion: version,
      appVersion: '0.1.0',
      exportedAt: NOW,
      data,
    });
  /** sampleData 를 JSON 으로 복사해 고친다 */
  const patched = (patch: (d: Record<string, any>) => void) => {
    const data = JSON.parse(JSON.stringify(sampleData())) as Record<string, any>;
    patch(data);
    return data;
  };
  const errorsOf = (r: ReturnType<typeof validateUserData>) => (r.ok ? [] : r.errors).join('\n');

  it('v3 파일: 일반직·별표 3·계급 키로 바뀌고 나머지는 그대로다', () => {
    const text = fixture('backup-v3.json');
    const parsed = parseBackup(text, ctx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fromVersion).toBe(3);
    expect(parsed.migrated).toBe(true);
    const before = JSON.parse(text).data;
    const { grade: _g, gradeDate: _gd, overrides, ...profileRest } = before.profile;
    const { lastGrade: _lg, ...characterRest } = before.character;
    expect(parsed.data).toEqual(
      asV5({
        ...before,
        profile: {
          ...profileRest,
          track: 'general',
          payTable: 'table3',
          rank: '7',
          rankDate: '2021-07-01',
          overrides: { ...overrides, rankLimitDate: null },
        },
        settings: { ...before.settings, card: { ...before.settings.card, showRank: true } },
        character: { ...characterRest, lastRank: '7', lastForm: null },
      }),
    );
    // 다시 내보내면 지금 버전 파일이고, 그 파일은 변환 없이 같은 값으로 열린다
    const again = parseBackup(serializeBackup(makeEnvelope(parsed.data, '0.1.0', NOW)), ctx);
    expect(again.ok && again.migrated).toBe(false);
    expect(again.ok && again.fromVersion).toBe(SCHEMA_VERSION);
    expect(again.ok && again.data).toEqual(parsed.data);
  });

  it('v1·v2 파일도 v4 까지 이어서 바뀐다', () => {
    for (const [name, rank] of [
      ['backup-v1.json', '9'],
      ['backup-v2.json', '9'],
    ] as const) {
      const parsed = parseBackup(fixture(name), ctx);
      expect(parsed.ok, name).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.data.profile, name).toMatchObject({
        track: 'general',
        payTable: 'table3',
        rank,
        rankDate: '2022-09-01',
        overrides: { rankLimitDate: null },
      });
      expect(parsed.data.profile, name).not.toHaveProperty('grade');
      expect(parsed.data.profile, name).not.toHaveProperty('gradeDate');
      expect(parsed.data.character, name).toMatchObject({ lastRank: rank, lastForm: null });
      expect(parsed.data.settings.card.showRank, name).toBe(true);
    }
  });

  it('v3 의 손상된 직급은 계급 키로 옮기지 않아 거부된다(조용히 고치지 않는다)', () => {
    const v3 = () => JSON.parse(fixture('backup-v3.json'));
    for (const bad of ['7', 10, 0, null]) {
      const env = v3();
      env.data.profile.grade = bad;
      const r = parseBackup(JSON.stringify(env), ctx);
      expect(r.ok, String(bad)).toBe(false);
      expect(!r.ok && r.details.join('\n'), String(bad)).toContain('직급을 골라 주세요');
    }
    const noGrade = v3();
    delete noGrade.data.profile.grade;
    expect(parseBackup(JSON.stringify(noGrade), ctx).ok).toBe(false);
    for (const bad of ['7', 10, 0]) {
      const env = v3();
      env.data.character.lastGrade = bad;
      const r = parseBackup(JSON.stringify(env), ctx);
      expect(!r.ok && r.details.join('\n'), String(bad)).toContain('캐릭터');
    }
    // 저장소에 있던 손상된 v3 도 같은 길이다(손상본으로 옮겨 두고 지우지 않는다 — 기존 규칙)
    const env = v3();
    env.data.profile.grade = '7';
    const store = memoryStore();
    store.setItem(KEYS.data, JSON.stringify(env));
    expect(loadData(store, stored).status).toBe('corrupt');
    expect(readCorrupt(store)).toEqual([JSON.stringify(env)]);
  });

  it('v3 저장본에 v4 이름의 키가 섞여 있어도 옮겨 담지 않는다', () => {
    const env = JSON.parse(fixture('backup-v3.json'));
    env.data.profile.rank = '경위';
    env.data.profile.track = 'police';
    env.data.character.lastForm = 'phoenix';
    const r = parseBackup(JSON.stringify(env), ctx);
    expect(r.ok && r.data.profile).toMatchObject({ track: 'general', rank: '7' });
    expect(r.ok && r.data.character.lastForm).toBeNull();
  });

  it('일반직의 계급 키는 1~9 뿐이다(저장본·파일 모두)', () => {
    for (const rank of ['10', '0', '경위', 7, '']) {
      const data = patched((d) => (d.profile.rank = rank));
      expect(validateUserData(data, stored).ok, String(rank)).toBe(false);
      expect(parseBackup(envelope(data), ctx).ok, String(rank)).toBe(false);
    }
    // 키가 없으면 거부
    const missing = patched((d) => delete d.profile.rank);
    expect(errorsOf(validateUserData(missing, stored))).toContain('직급');
    // 형식에 맞지 않는 글자(공백·영문·9자 이상)는 어느 직종이든 거부
    for (const rank of ['경 위', 'abc', '가나다라마바사아자']) {
      const data = patched((d) => {
        d.profile.track = 'police';
        d.profile.payTable = null;
        d.profile.rank = rank;
      });
      expect(validateUserData(data, stored).ok, rank).toBe(false);
    }
  });

  it('저장본은 계급을 직종과 짝짓지 않는다(규정 데이터가 늘어도 거부하지 않게)', () => {
    const cases: [string, string | null][] = [
      ['police', null],
      ['police', '경위'],
      ['militaryCivil', '군무원1급'],
      ['otherSpecial', null],
      ['teacher', '교원'],
    ];
    for (const [track, rank] of cases) {
      const data = patched((d) => {
        d.profile.track = track;
        d.profile.payTable = null;
        d.profile.rank = rank;
        d.character.lastRank = rank;
      });
      expect(errorsOf(validateUserData(data, stored)), `${track} ${rank}`).toBe('');
    }
    // 저장본 검사는 규정 조회를 쓰지 않는다: 조회가 모두 실패하는(사다리·봉급표가 바뀐) 해라도
    // 일반직·경찰·교원·그 밖의 특정직 저장본이 그대로 열린다
    const fail = (): never => {
      throw new Error('저장본 검사가 규정 데이터를 조회했다');
    };
    const noRules: ParseContext = {
      ...stored,
      maxStep: fail,
      rankLabel: fail,
      selectableRanks: fail,
    };
    expect(errorsOf(validateUserData(sampleData(), noRules))).toBe('');
    for (const name of [
      'backup-v4-police.json',
      'backup-v4-teacher.json',
      'backup-v4-other.json',
    ]) {
      const data = asV5(JSON.parse(fixture(name)).data);
      expect(errorsOf(validateUserData(data, noRules)), name).toBe('');
      expect(parseBackup(fixture(name), noRules).ok, name).toBe(true);
    }
    // 파일 불러오기는 그 해 사다리에서 고를 수 있는 계급만 받는다
    const policeNull = patched((d) => {
      d.profile.track = 'police';
      d.profile.payTable = null;
      d.profile.rank = null;
    });
    expect(parseBackup(envelope(policeNull), ctx).ok).toBe(false);
  });

  it('호봉 상한: 저장본은 99 까지 받고, 최고호봉 검사는 입력 폼·파일에서만 한다', () => {
    const sixty = patched((d) => (d.profile.step = 60));
    expect(validateUserData(sixty, stored).ok).toBe(true);
    const r = parseBackup(envelope(sixty), ctx);
    expect(!r.ok && r.details.join('\n')).toContain('8급은 31호봉까지 있어요.');
    const hundred = patched((d) => (d.profile.step = 100));
    expect(validateUserData(hundred, stored).ok).toBe(false);
    const lastStep = patched((d) => (d.character.lastStep = 100));
    expect(validateUserData(lastStep, stored).ok).toBe(false);
  });

  it('경찰·교원·그 밖의 특정직 v4 파일은 v5 기본값만 더해 열리고 왕복한다', () => {
    for (const name of [
      'backup-v4-police.json',
      'backup-v4-teacher.json',
      'backup-v4-other.json',
    ]) {
      const text = fixture(name);
      const parsed = parseBackup(text, ctx);
      expect(parsed.ok ? '' : parsed.details.join('\n'), name).toBe('');
      if (!parsed.ok) continue;
      expect(parsed.migrated, name).toBe(true);
      expect(parsed.data, name).toEqual(asV5(JSON.parse(text).data));
      const again = serializeBackup(makeEnvelope(parsed.data, '0.1.0', NOW));
      expect(parseBackup(again, ctx), name).toMatchObject({ ok: true, data: parsed.data });
    }
  });

  it('직종·봉급표가 틀리면 거부한다', () => {
    const cases: [(d: Record<string, any>) => void, string][] = [
      [(d) => (d.profile.track = 'army'), '직종'],
      [(d) => delete d.profile.track, '직종'],
      [(d) => (d.profile.payTable = null), '봉급표'],
      [(d) => (d.profile.payTable = 'table10'), '봉급표'],
      [(d) => delete d.profile.payTable, '봉급표'],
      [
        (d) => {
          d.profile.track = 'police';
          d.profile.payTable = 'table10';
          d.profile.rank = '경위';
        },
        '봉급표',
      ],
      [
        (d) => {
          d.profile.track = 'teacher';
          d.profile.payTable = 'table3';
          d.profile.rank = '교원';
        },
        '봉급표',
      ],
    ];
    for (const [patch, expected] of cases) {
      const data = patched(patch);
      expect(errorsOf(validateUserData(data, stored))).toContain(expected);
      const r = parseBackup(envelope(data), ctx);
      expect(!r.ok && r.details.join('\n')).toContain(expected);
    }
    // 일반직의 별표 4·8 은 받는다(그 표로 계산한다 — #20 묶음 3)
    for (const payTable of ['table4', 'table8']) {
      expect(
        validateUserData(
          patched((d) => (d.profile.payTable = payTable)),
          stored,
        ).ok,
      ).toBe(true);
    }
  });

  it('입력 폼 검사: 그 해 사다리에서 고를 수 있는 계급만, 교원은 현 직급 임용일 = 임용일', () => {
    const base = sampleProfile();
    const teacher = {
      ...base,
      track: 'teacher' as const,
      payTable: null,
      rank: '교원',
      rankDate: base.hireDate,
    };
    expect(checkProfile(teacher, ctx)).toEqual({});
    expect(checkProfile({ ...teacher, rank: '9' }, ctx).rank).toBe('이 계급은 고를 수 없어요.');
    expect(checkProfile({ ...teacher, rank: null }, ctx).rank).toBe('이 계급은 고를 수 없어요.');
    expect(checkProfile({ ...teacher, rankDate: '2024-07-01' }, ctx).rankDate).toContain(
      '최초 임용일과 같아야',
    );
    // 교원 봉급표는 40호봉까지(계급 이름이 없으면 봉급표 이름으로 말한다)
    expect(checkProfile({ ...teacher, step: 40 }, ctx).step).toBeUndefined();
    expect(checkProfile({ ...teacher, step: 41 }, ctx).step).toBe(
      '교원 봉급표는 40호봉까지 있어요.',
    );
    const police = { ...base, track: 'police' as const, payTable: null, rank: '경위' };
    expect(checkProfile(police, ctx)).toEqual({});
    expect(checkProfile({ ...police, rank: '치안총감' }, ctx).rank).toBe(
      '이 계급은 고를 수 없어요.',
    );
    expect(checkProfile({ ...police, rank: '7' }, ctx).rank).toBe('이 계급은 고를 수 없어요.');
    expect(checkProfile({ ...police, step: 99 }, ctx).step).toMatch(
      /^경위는 \d+호봉까지 있어요\.$/,
    );
    // 일반직에 경찰 계급 이름은 저장본·폼 모두 거부
    expect(checkProfile({ ...base, rank: '경위' }, ctx).rank).toBe('직급을 골라 주세요.');
    expect(checkProfile({ ...base, rank: '경위' }, { ...ctx, stored: true }).rank).toBe(
      '직급을 골라 주세요.',
    );
    // 봉급표가 없는(준비 중) 직종은 99 호봉까지 받는다
    const other = {
      ...base,
      track: 'otherSpecial' as const,
      payTable: null,
      rank: null,
      rankDate: base.hireDate,
    };
    expect(checkProfile({ ...other, step: 99 }, ctx)).toEqual({});
    expect(checkProfile({ ...other, step: 100 }, ctx).step).toBe('호봉을 넣어 주세요.');
  });

  it('모르는 형태 id·계급정년이 없는 계급의 계급정년 고침도 지우지 않는다', () => {
    const data = patched((d) => {
      d.character.lastForm = 'unknown-form';
      d.profile.overrides.rankLimitDate = '2040-01-01';
    });
    const r = validateUserData(data, stored);
    expect(r.ok && r.value.character.lastForm).toBe('unknown-form');
    expect(r.ok && r.value.profile.overrides.rankLimitDate).toBe('2040-01-01');
    const file = parseBackup(envelope(data), ctx);
    expect(file.ok && file.data.profile.overrides.rankLimitDate).toBe('2040-01-01');
    // 형식이 틀린 값은 거부
    for (const [patch, expected] of [
      [(d: Record<string, any>) => (d.character.lastForm = 'bad id!'), '캐릭터'],
      [(d: Record<string, any>) => delete d.character.lastForm, '캐릭터'],
      [(d: Record<string, any>) => delete d.character.lastRank, '캐릭터'],
      [(d: Record<string, any>) => (d.profile.overrides.rankLimitDate = 'soon'), '날짜'],
      [(d: Record<string, any>) => delete d.settings.card.showRank, '카드'],
      [(d: Record<string, any>) => (d.settings.card.showRank = 'yes'), '카드'],
    ] as const) {
      expect(errorsOf(validateUserData(patched(patch), stored))).toContain(expected);
    }
  });

  it('계급정년 날짜는 형식만 본다: 현 직급 임용일보다 일러도 보존한다', () => {
    // 승진 뒤에도 예전 계급의 계급정년 고침이 남아 있을 수 있다(설계 §6.3)
    const data = patched((d) => (d.profile.overrides.rankLimitDate = '2000-01-01'));
    const r = validateUserData(data, stored);
    expect(errorsOf(r)).toBe('');
    expect(r.ok && r.value.profile.overrides.rankLimitDate).toBe('2000-01-01');
    const file = parseBackup(envelope(data), ctx);
    expect(file.ok && file.data.profile.overrides.rankLimitDate).toBe('2000-01-01');
    const store = memoryStore();
    const text = envelope(data);
    store.setItem(KEYS.data, text);
    expect(loadData(store, stored).status).toBe('ok');
    expect(store.getItem(KEYS.data)).toBe(text);
    expect(hasCorrupt(store)).toBe(false);
    // 입력 폼 검사도 막지 않는다(이 칸은 아직 화면에 없다)
    expect(
      checkProfile(
        {
          ...sampleProfile(),
          overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: '2000-01-01' },
        },
        ctx,
      ),
    ).toEqual({});
  });

  it('더 새 버전(v5) 파일·저장본은 읽지 않고 건드리지 않는다', () => {
    const text = envelope(sampleData(), SCHEMA_VERSION + 1);
    expect(parseBackup(text, ctx)).toMatchObject({ ok: false, code: 'newer' });
    const store = memoryStore();
    store.setItem(KEYS.data, text);
    expect(loadData(store, stored).status).toBe('newer');
    expect(store.getItem(KEYS.data)).toBe(text);
    expect(hasCorrupt(store)).toBe(false);
  });
});

describe('직종별 v4 데이터는 열리고, 계산되거나 준비 중으로 보인다(#20 묶음 3)', () => {
  const fixture = (name: string) =>
    readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
  const stored = { ...ctx, stored: true };
  const envelope = (data: unknown) =>
    JSON.stringify({
      app: 'hobong',
      schemaVersion: SCHEMA_VERSION,
      appVersion: '0.1.0',
      exportedAt: NOW,
      data,
    });
  const withProfile = (over: Partial<Profile>) => {
    const data = sampleData();
    data.profile = { ...data.profile, ...over };
    data.character.lastRank = data.profile.rank;
    return data;
  };
  /**
   * 묶음 2 에서는 계산이 일반직 별표 3 만 받아 '더 새 버전'처럼 막아 두던 데이터.
   * 이제는 직종 규정(resolveCareer)으로 계산하거나, 확인하지 못한 항목은 숫자 없이 꺼진 상태로 둔다.
   * pay: 'on' = 봉급을 계산, 'off' = 봉급은 준비 중(숫자 없음)
   */
  const cases: [string, string, 'on' | 'off'][] = [
    ['경찰', fixture('backup-v4-police.json'), 'on'],
    ['교원', fixture('backup-v4-teacher.json'), 'on'],
    ['그 밖의 특정직', fixture('backup-v4-other.json'), 'off'],
    ['외무 1등급', envelope(withProfile({ track: 'foreign', payTable: null, rank: '1' })), 'on'],
    [
      '경찰인데 계급 키 7(사다리에 없음)',
      envelope(withProfile({ track: 'police', payTable: null, rank: '7' })),
      'off',
    ],
    ['일반직 별표 4', envelope(withProfile({ payTable: 'table4' })), 'on'],
    ['일반직 별표 8', envelope(withProfile({ payTable: 'table8', rank: '7' })), 'on'],
    ['일반직 계급 없음', envelope(withProfile({ rank: null })), 'off'],
  ];

  it('저장본으로 열리고(더 새 버전으로 보지 않는다), 옮기지도 않는다', () => {
    for (const [name, text] of cases) {
      const store = memoryStore();
      store.setItem(KEYS.data, text);
      expect(loadData(store, stored).status, name).toBe('ok');
      expect(loadData(store, stored, { readOnly: true }).status, name).toBe('ok');
      expect(isNewerData(store, stored), name).toBe(false);
      expect(hasCorrupt(store), name).toBe(false);
    }
  });

  it('손상본 자리·되돌리기 보관본에 있으면 되살리거나 되돌릴 수 있다', () => {
    const [, police] = cases[0] as [string, string, 'on' | 'off'];
    const store = memoryStore();
    store.setItem(KEYS.corrupt, police);
    expect(loadData(store, stored).status).toBe('ok');
    expect(store.getItem(KEYS.corrupt)).toBeNull();

    const undo = memoryStore();
    undo.setItem(KEYS.undo, police);
    expect(loadUndo(undo, stored)?.data.profile.track).toBe('police');
  });

  it('계산 입구: 봉급을 계산하는 직종은 그 직종 봉급표로, 준비 중이면 숫자 없이(null) — 예외는 없다', () => {
    for (const [name, text, pay] of cases) {
      const parsed = parseBackup(text, stored);
      if (!parsed.ok) throw new Error(`${name}: ${parsed.reason}`);
      const profile = parsed.data.profile;
      const point = salaryOn(rulesFor, profile, TODAY);
      if (pay === 'on') expect(point?.amount, name).toBeGreaterThan(0);
      else expect(point, name).toBeNull();
      expect(() => buildMilestones(rulesFor, profile, TODAY), name).not.toThrow();
    }
    // 일반직 별표 4·8 은 별표 3 숫자가 아니라 그 표의 숫자다
    const base = sampleProfile();
    const t3 = salaryOn(rulesFor, base, TODAY);
    const t4 = salaryOn(rulesFor, { ...base, payTable: 'table4' }, TODAY);
    expect(t4?.annex).toBe('별표 4');
    expect(t4?.amount).not.toBe(t3?.amount);
    expect(salaryOn(rulesFor, { ...base, payTable: 'table8' }, TODAY)?.annex).toBe('별표 8');
  });
});

describe('입력 폼 검사의 규정 조회(careerLookup)는 일반직에서 예전과 같다', () => {
  it('별표 3 의 1~9급: 고를 수 있는 계급·최고호봉·오류 문구의 이름', () => {
    for (const year of [2026, 2027]) {
      const rules = rulesFor(year);
      const look = careerLookup(rules);
      expect([...look.selectableRanks('general', 'table3')].sort(), String(year)).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
      ]);
      for (let g = 1; g <= 9; g += 1) {
        const sel = { track: 'general', payTable: 'table3', rank: String(g) } as const;
        expect(look.maxStep(sel), `${year} ${g}급`).toBe(
          rules.salary.table[sel.rank as GradeKey].length,
        );
        expect(look.rankLabel(sel), `${year} ${g}급`).toBe(`${g}급`);
      }
    }
  });
});

describe('저장 형식 v5: 직렬·꾸미기·소리·포인터(고도화 2차)', () => {
  const fixture = (name: string) =>
    readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
  const stored = { ...ctx, stored: true };
  const envelope = (data: unknown, version = SCHEMA_VERSION) =>
    JSON.stringify({
      app: 'hobong',
      schemaVersion: version,
      appVersion: '0.2.0',
      exportedAt: NOW,
      data,
    });
  const patched = (patch: (d: Record<string, any>) => void) => {
    const data = JSON.parse(JSON.stringify(sampleData())) as Record<string, any>;
    patch(data);
    return data;
  };
  const errorsOf = (r: ReturnType<typeof validateUserData>) => (r.ok ? [] : r.errors).join('\n');

  it('새 사용자 기본값: 직렬 없음, 홈 이름 켬·카드 이름 끔, 기본 모습, 진동 켬, 소리 끔, 픽셀 포인터, 반짝이 켬', () => {
    const data = newUserData(sampleProfile({ series: null }), defaultSettings(R), NOW, TODAY);
    expect(data.profile.series).toBeNull();
    expect(data.settings.identity).toEqual({ showSeriesHome: true });
    expect(data.settings.card.showSeries).toBe(false);
    expect(data.settings.haptics).toBe(true);
    expect(data.settings.sound).toEqual({
      sfx: false,
      bgm: false,
      master: 80,
      sfxVolume: 80,
      bgmVolume: 50,
      bgmTrack: 'auto',
    });
    expect(data.settings.pointer).toBe('pixel');
    expect(data.settings.sparkles).toBe(true);
    expect(data.character.look).toEqual({
      body: 'sunny',
      crest: 'red',
      plume: 'auto',
      deco: { pin: null, chest: null, cheek: false },
      prop: 'auto',
    });
    // 기본값은 얼려 두고, 새 데이터는 고칠 수 있는 사본을 받는다
    expect(Object.isFrozen(DEFAULT_LOOK)).toBe(true);
    expect(data.character.look).not.toBe(DEFAULT_LOOK);
    expect(data.character.look.deco).not.toBe(DEFAULT_LOOK.deco);
    expect(validateUserData(data, stored).ok).toBe(true);
  });

  it('첫 입력에서 고른 꾸미기로 시작할 수 있다', () => {
    const look = {
      ...defaultLook(),
      body: 'sea',
      deco: { pin: 'ribbon', chest: null, cheek: true },
    };
    const data = newUserData(sampleProfile(), defaultSettings(R), NOW, TODAY, look);
    expect(data.character.look).toEqual(look);
    expect(data.character.look).not.toBe(look);
  });

  it('v5 파일은 그대로 왕복한다(직렬·꾸미기·소리 설정)', () => {
    const text = fixture('backup-v5.json');
    const parsed = parseBackup(text, ctx);
    expect(parsed.ok ? '' : parsed.details.join('\n')).toBe('');
    if (!parsed.ok) return;
    expect(parsed.migrated).toBe(false);
    expect(parsed.fromVersion).toBe(5);
    expect(parsed.data).toEqual(JSON.parse(text).data);
    expect(serializeBackup(makeEnvelope(parsed.data, '0.2.0', '2026-11-26T09:00:00.000Z'))).toBe(
      `${JSON.stringify(JSON.parse(text), null, 2)}\n`,
    );
  });

  it('v1~v4 파일이 모두 v5 로 열린다(새 칸은 기본값)', () => {
    for (const name of [
      'backup-v1.json',
      'backup-v2.json',
      'backup-v3.json',
      'backup-v4-police.json',
      'backup-v4-teacher.json',
      'backup-v4-other.json',
    ]) {
      const parsed = parseBackup(fixture(name), ctx);
      expect(parsed.ok ? '' : parsed.details.join('\n'), name).toBe('');
      if (!parsed.ok) continue;
      expect(parsed.migrated, name).toBe(true);
      expect(parsed.data.profile.series, name).toBeNull();
      expect(parsed.data.character.look, name).toEqual(defaultLook());
      expect(parsed.data.settings, name).toMatchObject({
        identity: { showSeriesHome: true },
        card: { showSeries: false },
        haptics: true,
        sound: defaultSettings(R).sound,
        pointer: 'pixel',
        sparkles: true,
      });
      // 다시 내보내면 v5 파일이고, 변환 없이 같은 값으로 열린다
      const again = parseBackup(serializeBackup(makeEnvelope(parsed.data, '0.2.0', NOW)), ctx);
      expect(again.ok && again.fromVersion, name).toBe(SCHEMA_VERSION);
      expect(again.ok && again.data, name).toEqual(parsed.data);
      // 저장본 자리에 있어도 같은 길로 열린다
      const store = memoryStore();
      store.setItem(KEYS.data, fixture(name));
      expect(loadData(store, stored).status, name).toBe('ok');
    }
  });

  it('v4 파일에 v5 이름의 키가 섞여 있어도 옮겨 담지 않고 기본값을 둔다', () => {
    const env = JSON.parse(fixture('backup-v4-police.json'));
    env.data.profile.series = '간호';
    env.data.settings.identity = { showSeriesHome: false };
    env.data.settings.card.showSeries = true;
    env.data.settings.sound = { sfx: true };
    env.data.settings.pointer = 'zzz';
    env.data.character.look = { body: 'sea' };
    const parsed = parseBackup(JSON.stringify(env), ctx);
    expect(parsed.ok ? '' : parsed.details.join('\n')).toBe('');
    if (!parsed.ok) return;
    expect(parsed.data.profile.series).toBeNull();
    expect(parsed.data.settings.identity.showSeriesHome).toBe(true);
    expect(parsed.data.settings.card.showSeries).toBe(false);
    expect(parsed.data.settings.sound).toEqual(defaultSettings(R).sound);
    expect(parsed.data.settings.pointer).toBe('pixel');
    expect(parsed.data.character.look).toEqual(defaultLook());
  });

  it('모르는 꾸미기 id·곡 id 는 거부하지 않고 그대로 보존한다(형식만 본다)', () => {
    const data = patched((d) => {
      d.character.look = {
        body: 'aurora',
        crest: 'rainbow-2',
        plume: 'galaxy',
        deco: { pin: 'snowflake', chest: 'moon-badge', cheek: true },
        prop: 'trumpet',
      };
      d.settings.sound.bgmTrack = 'winter-2027';
    });
    for (const c of [ctx, stored]) {
      const r = validateUserData(data, c);
      expect(errorsOf(r)).toBe('');
      if (!r.ok) continue;
      expect(r.value.character.look).toEqual(data.character.look);
      expect(r.value.settings.sound.bgmTrack).toBe('winter-2027');
    }
    // 파일로 내보냈다가 불러와도, 저장본으로 읽어도 남아 있다
    const parsed = parseBackup(envelope(data), ctx);
    expect(parsed.ok && parsed.data.character.look.prop).toBe('trumpet');
    const store = memoryStore();
    store.setItem(KEYS.data, envelope(data));
    const loaded = loadData(store, stored);
    expect(loaded.status === 'ok' && loaded.data.character.look.body).toBe('aurora');
  });

  it('목록에 없는 직렬도 형식이 맞으면 보존하고, 일반직이 아니어도 지우지 않는다', () => {
    for (const [track, payTable, rank, series] of [
      ['general', 'table3', '8', '없어진직렬'],
      ['police', null, '경위', '간호'],
      ['general', 'table3', '8', 'Data'],
    ] as const) {
      const data = patched((d) => {
        d.profile = { ...d.profile, track, payTable, rank, series };
        d.character.lastRank = rank;
      });
      const r = validateUserData(data, stored);
      expect(errorsOf(r), series).toBe('');
      expect(r.ok && r.value.profile.series, series).toBe(series);
    }
  });

  it('형식이 틀린 v5 값은 이유와 함께 거부한다(내부 키 이름은 쓰지 않는다)', () => {
    const cases: [(d: Record<string, any>) => void, string][] = [
      [(d) => delete d.profile.series, '직렬'],
      [(d) => (d.profile.series = ''), '직렬'],
      [(d) => (d.profile.series = '<b>행정</b>'), '직렬'],
      [(d) => (d.profile.series = '가'.repeat(21)), '직렬'],
      [(d) => (d.profile.series = 7), '직렬'],
      [(d) => delete d.settings.identity, '직렬 이름 보이기'],
      [(d) => (d.settings.identity = { showSeriesHome: 'yes' }), '직렬 이름 보이기'],
      [(d) => delete d.settings.card.showSeries, '카드 설정'],
      [(d) => (d.settings.haptics = 1), '진동'],
      [(d) => delete d.settings.sound, '소리'],
      [(d) => (d.settings.sound.master = 101), '소리'],
      [(d) => (d.settings.sound.sfxVolume = -1), '소리'],
      [(d) => (d.settings.sound.bgmVolume = 2.5), '소리'],
      [(d) => (d.settings.sound.bgmTrack = 'Auto Track'), '소리'],
      [(d) => (d.settings.sound.sfx = 'on'), '소리'],
      [(d) => (d.settings.pointer = 'big'), '포인터'],
      [(d) => (d.settings.sparkles = null), '반짝이'],
      [(d) => delete d.character.look, '꾸미기'],
      [(d) => (d.character.look.body = 3), '꾸미기'],
      [(d) => (d.character.look.body = 'Sky'), '꾸미기'],
      [(d) => (d.character.look.crest = ''), '꾸미기'],
      [(d) => (d.character.look.plume = null), '꾸미기'],
      [(d) => (d.character.look.prop = 'x'.repeat(33)), '꾸미기'],
      [(d) => (d.character.look.deco = null), '꾸미기'],
      [(d) => (d.character.look.deco.pin = '꽃'), '꾸미기'],
      [(d) => (d.character.look.deco.chest = 5), '꾸미기'],
      [(d) => (d.character.look.deco.cheek = 'yes'), '꾸미기'],
      [(d) => delete d.character.look.deco.cheek, '꾸미기'],
    ];
    for (const [patch, word] of cases) {
      const data = patched(patch);
      const message = errorsOf(validateUserData(data, stored));
      expect(message, patch.toString()).toContain(word);
      expect(message, patch.toString()).not.toMatch(
        /series|identity|haptics|sound|pointer|sparkles|look|showSeries/,
      );
      // 파일 불러오기도 거부하고, 기존 데이터는 건드리지 않는다
      const store = memoryStore();
      saveData(store, sampleData(), '0.2.0', NOW);
      const before = store.getItem(KEYS.data);
      expect(parseBackup(envelope(data), ctx).ok, patch.toString()).toBe(false);
      expect(store.getItem(KEYS.data)).toBe(before);
    }
  });

  it('검증은 알 수 없는 키를 버리고 꾸미기·소리를 새 객체로 옮겨 담는다', () => {
    const data = patched((d) => {
      d.character.look.extra = 'x';
      d.character.look.deco.extra = 'y';
      d.settings.sound.extra = 1;
      d.settings.identity.extra = true;
    });
    const r = validateUserData(data, stored);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.character.look).toEqual(defaultLook());
    expect(r.value.character.look).not.toBe(data.character.look);
    expect(r.value.settings.sound).toEqual(defaultSettings(R).sound);
    expect(r.value.settings.identity).toEqual({ showSeriesHome: true });
  });

  it('옛 사본 보호: v5 저장본·파일은 v4 앱에게 "더 새 버전"이다 — 이 앱도 v6 은 읽지도 옮기지도 않는다', () => {
    // v4 앱의 규칙(migrate.ts: 파일 버전 > 앱 버전이면 newer)을 그대로 적용하면 v5 는 newer 다
    const v5 = JSON.parse(fixture('backup-v5.json'));
    expect(v5.schemaVersion).toBe(5);
    expect(v5.schemaVersion > 4).toBe(true);
    // 이 앱(v5)이 더 새 파일(v6)을 만나면: 손대지 않고 새 버전으로 열어 달라고만 한다
    const v6 = envelope(v5.data, SCHEMA_VERSION + 1);
    expect(parseBackup(v6, ctx)).toMatchObject({ ok: false, code: 'newer' });
    const store = memoryStore();
    store.setItem(KEYS.data, v6);
    expect(loadData(store, stored).status).toBe('newer');
    expect(isNewerData(store, stored)).toBe(true);
    expect(store.getItem(KEYS.data)).toBe(v6);
    expect(hasCorrupt(store)).toBe(false);
  });
});
