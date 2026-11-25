/**
 * 저장·불러오기 검증.
 * - 내보내기 → 초기화 → 불러오기 후 상태가 완전히 같은지
 * - 구버전(v1) 파일이 현재 형식으로 변환되는지
 * - 형식이 다르거나 손상된 파일은 기존 데이터를 건드리지 않고 거부하는지
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rulesFor } from '../../src/lib/rules/index.ts';
import { maxStepOf } from '../../src/lib/calc/salary.ts';
import {
  backupFileName,
  makeEnvelope,
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
  type ParseContext,
} from '../../src/lib/store/backup.ts';
import { defaultSettings, newUserData } from '../../src/lib/store/defaults.ts';
import { SCHEMA_VERSION, type Grade, type Profile, type UserData } from '../../src/lib/store/schema.ts';
import {
  clearAll,
  clearUndo,
  hasCorrupt,
  KEYS,
  loadData,
  loadUndo,
  memoryStore,
  openStore,
  readCorrupt,
  saveData,
  saveUndo,
} from '../../src/lib/store/storage.ts';
import { checkProfile, cleanText, validateUserData } from '../../src/lib/store/validate.ts';

const TODAY = '2026-11-25';
const NOW = '2026-11-25T01:00:00.000Z';
const R = rulesFor(2026);
const ctx: ParseContext = {
  today: TODAY,
  maxStep: (grade: Grade) => maxStepOf(R.salary, grade),
  defaultSettings: defaultSettings(R),
  nowIso: NOW,
};

function sampleProfile(over: Partial<Profile> = {}): Profile {
  return {
    nickname: '호봉이',
    birthDate: '1995-05-20',
    hireDate: '2020-01-01',
    grade: 8,
    gradeDate: '2024-07-01',
    step: 6,
    nextStepDate: '2027-01-01',
    overrides: { longServiceDate: null, seniorDate: '2028-08-01' },
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
    card: { ratio: 'portrait', showSalary: true, showRetirement: false, showTenure: true, showBadges: false },
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
  data.character = { seenForms: ['egg', 'chick'], lastGrade: 8, lastStep: 6 };
  data.visits = { days: ['2026-11-23', '2026-11-24', '2026-11-25'], lastVisit: '2026-11-24' };
  data.meta = { createdAt: '2026-01-05T00:00:00.000Z', updatedAt: NOW, lastBackupAt: null, changesSinceBackup: 7 };
  return data;
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
    expect(loadData(store, ctx)).toEqual({ status: 'ok', data, migrated: false });
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
      grade: 9,
      gradeDate: '2022-09-01',
      step: 4,
      nextStepDate: '2026-09-01',
      overrides: { longServiceDate: null, seniorDate: null },
    });
    expect(parsed.data.leave.records).toEqual([
      { id: 'v1-1', date: '2026-01-02', hours: 8, kind: 'day', memo: '' },
      { id: 'v1-2', date: '2026-03-13', hours: 4, kind: 'am', memo: '' },
      { id: 'v1-3', date: '2026-05-04', hours: 2, kind: 'hours', memo: '' },
    ]);
    expect(parsed.data.leave.grantOverrideHours).toEqual({ '2026': 128 });
    expect(parsed.data.achievements).toEqual({ hire: { at: '2026-06-15' }, probation: { at: '2026-06-15' } });
    expect(parsed.data.settings).toEqual({ ...defaultSettings(R), theme: 'dark' });
    expect(parsed.data.character).toEqual({ seenForms: [], lastGrade: 9, lastStep: 4 });
    expect(parsed.data.meta.createdAt).toBe('2026-02-01T00:00:00.000Z');
  });
  it('변환한 결과를 다시 내보내면 현재 버전 파일이 된다', () => {
    const parsed = parseBackup(text, ctx);
    if (!parsed.ok) throw new Error('변환 실패');
    const again = parseBackup(serializeBackup(makeEnvelope(parsed.data, '0.1.0', NOW)), ctx);
    expect(again.ok && again.migrated).toBe(false);
    expect(again.ok && again.data).toEqual(parsed.data);
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
    expect(reason('')).toContain('비어 있습니다');
    expect(reason('   ')).toContain('비어 있습니다');
    expect(reason('{"app":"hobong","schemaVersion":2,"data":{')).toContain('손상');
    expect(reason('<html></html>')).toContain('손상');
    expect(reason([])).toContain('호봉 데이터 파일이 아닙니다');
    expect(reason({ app: 'other', schemaVersion: 2, data: {} })).toContain('호봉 데이터 파일이 아닙니다');
    expect(reason('null')).toContain('호봉 데이터 파일이 아닙니다');
    expect(reason('x'.repeat(MAX_BACKUP_BYTES + 1))).toContain('너무 큽니다');
  });
  it('버전 정보', () => {
    expect(reason({ ...good(), schemaVersion: 99 })).toContain('더 새로운 버전');
    expect(reason({ ...good(), schemaVersion: '2' })).toContain('버전 정보');
    expect(reason({ ...good(), schemaVersion: 0 })).toContain('버전 정보');
    expect(reason({ app: 'hobong', schemaVersion: 2 })).toContain('데이터가 없습니다');
  });
  it('BOM이 붙은 파일은 그대로 읽는다', () => {
    expect(reason(`﻿${JSON.stringify(good())}`)).toBe('OK');
  });
  it('내 정보가 틀린 파일', () => {
    const cases: [(env: ReturnType<typeof good>) => void, string][] = [
      [(e) => (e.data.profile.birthDate = '1995-02-30'), '생년월일'],
      [(e) => (e.data.profile.hireDate = '2030-01-01'), '임용일'],
      [(e) => (e.data.profile.grade = 10), '직급'],
      [(e) => (e.data.profile.step = 40), '31호봉까지'],
      [(e) => (e.data.profile.step = 1.5), '호봉'],
      [(e) => (e.data.profile.nickname = ''), '닉네임'],
      [(e) => (e.data.profile.gradeDate = '2019-01-01'), '현 직급 임용일'],
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
      [(e) => delete e.data.settings, '설정 값이 없습니다'],
      [(e) => (e.data.leave.records[0].date = '2026-02-31'), '연가 기록 1번째'],
      [(e) => (e.data.leave.records[1].hours = 0), '연가 기록 2번째'],
      [(e) => (e.data.leave.records[1].id = 'a1'), '연가 기록 2번째'],
      [(e) => (e.data.leave.records[0].kind = 'sick'), '연가 기록 1번째'],
      [(e) => (e.data.leave.records = 'none'), '연가 장부'],
      [(e) => (e.data.leave.grantOverrideHours = { '26': 8 }), '부여일수'],
      [(e) => (e.data.achievements = []), '업적'],
      [(e) => (e.data.achievements = { 'bad id!': { at: '2026-01-01' } }), '업적'],
      [(e) => (e.data.character.lastGrade = 0), '캐릭터'],
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
    env.data.profile.nickname = '  호\u0000봉‮이  ';
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
    expect(loadData(store, ctx)).toEqual({ status: 'ok', data, migrated: false });
  });
});

describe('되돌리기와 손상된 저장본', () => {
  it('덮어쓰기 직전 상태를 보관했다가 되돌린다', () => {
    const store = memoryStore();
    const before = sampleData();
    saveData(store, before, '0.1.0', NOW);
    const incoming = sampleData();
    incoming.profile = sampleProfile({ nickname: '새사람', grade: 7, gradeDate: '2025-01-01', step: 3 });
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
    expect(loadData(store, ctx)).toEqual({ status: 'ok', data: before, migrated: false });
    expect(loadUndo(store, ctx)).toBeNull();
  });
  it('읽지 못한 저장본은 버리지 않고 따로 옮겨 둔다', () => {
    const store = memoryStore();
    store.setItem(KEYS.data, '{"app":"hobong","schemaVersion":2,"data":{"profile":');
    const loaded = loadData(store, ctx);
    expect(loaded.status).toBe('corrupt');
    expect(hasCorrupt(store)).toBe(true);
    expect(readCorrupt(store)).toContain('"profile":');
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
    expect(quota.persistent).toBe(false);
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

describe('입력 폼 검사', () => {
  const base = sampleProfile();
  it('올바른 입력은 오류가 없다', () => {
    expect(checkProfile(base, ctx)).toEqual({});
    expect(checkProfile({ ...base, gradeDate: base.hireDate, grade: 9 }, ctx)).toEqual({});
    expect(checkProfile({ ...base, hireDate: TODAY, gradeDate: TODAY, nextStepDate: '2027-11-01' }, ctx)).toEqual({});
  });
  it('항목별 오류', () => {
    expect(checkProfile({ ...base, nickname: '   ' }, ctx).nickname).toBeDefined();
    expect(checkProfile({ ...base, nickname: '가'.repeat(13) }, ctx).nickname).toContain('12자');
    expect(checkProfile({ ...base, birthDate: '2030-01-01' }, ctx).birthDate).toBeDefined();
    expect(checkProfile({ ...base, birthDate: '1900-01-01' }, ctx).birthDate).toBeDefined();
    expect(checkProfile({ ...base, birthDate: '2010-01-01' }, ctx).hireDate).toContain('너무 일러요');
    expect(checkProfile({ ...base, hireDate: '2026-11-26' }, ctx).hireDate).toBeDefined();
    expect(checkProfile({ ...base, grade: 9, step: 32 }, ctx).step).toContain('31호봉');
    expect(checkProfile({ ...base, grade: 6, step: 32 }, ctx).step).toBeUndefined();
    expect(checkProfile({ ...base, nextStepDate: '2040-01-01' }, ctx).nextStepDate).toContain('너무 먼');
    expect(checkProfile({ ...base, overrides: { longServiceDate: '2020-01-01', seniorDate: null } }, ctx).longServiceDate).toBeDefined();
    expect(checkProfile(null, ctx).nickname).toBeDefined();
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
