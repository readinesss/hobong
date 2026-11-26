/**
 * 화면이 쓰는 계산값 모음(view.svelte.ts)이 모든 직종 저장본에서 예외 없이 계산되는지(#20 묶음 3).
 *
 * 묶음 2 는 계산이 일반직 별표 3 만 받아 다른 직종 데이터를 열지 않게 막아 두었다. 그 보호를 걷어 낸 뒤
 * 화면이 멈추는 경로가 남지 않게, 직종 × 봉급표 × 계급(고를 수 없는 계급·계급 없음·사다리에 없는 계급 포함)
 * 시드로 view 의 모든 값을 실제로 읽어 본다. 확인하지 못한 항목은 숫자 대신 null·'준비 중'이어야 한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { app } from '../../src/lib/app/state.svelte.ts';
import { clock } from '../../src/lib/app/clock.svelte.ts';
import { view } from '../../src/lib/app/view.svelte.ts';
import { resolveCareer, rulesFor, type TrackId } from '../../src/lib/rules/index.ts';
import { parseBackup } from '../../src/lib/store/backup.ts';
import { defaultSettings, newUserData } from '../../src/lib/store/defaults.ts';
import type { Profile, UserData } from '../../src/lib/store/schema.ts';

const R = rulesFor(2026);

function seed(over: Partial<Profile>): UserData {
  const profile: Profile = {
    nickname: '호봉이',
    birthDate: '1968-04-10',
    hireDate: '2005-03-02',
    track: 'general',
    payTable: 'table3',
    rank: '7',
    rankDate: '2018-03-01',
    step: 12,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-11-25',
    overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    ...over,
  };
  const data = newUserData(profile, defaultSettings(R), '2026-11-25T01:00:00.000Z', '2026-11-25');
  data.leave.records.push({ id: 'a1', date: '2026-03-03', hours: 8, kind: 'day', memo: '' });
  return data;
}

/** view 의 값(getter)을 모두 읽는다. 하나라도 예외가 나면 그 이름과 함께 실패 */
function readAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const proto = Object.getPrototypeOf(view) as object;
  for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
    if (!desc.get) continue;
    try {
      out[name] = (view as unknown as Record<string, unknown>)[name];
    } catch (error) {
      // 어느 값에서 났는지 붙여 그대로 다시 던진다
      if (error instanceof Error) error.message = `view.${name}: ${error.message}`;
      throw error;
    }
  }
  out.since = view.since('2026-10-01');
  return out;
}

function at(iso: string) {
  clock.now = new Date(iso);
}

const sels: Partial<Profile>[] = [];
for (const [track, t] of Object.entries(R.tracks.items) as [
  TrackId,
  (typeof R.tracks.items)['general'],
][]) {
  for (const payTable of track === 'general' ? t.payTables : [null]) {
    const ladderId = resolveCareer(R, { track, payTable, rank: null }).ladderId;
    const ranks = ladderId ? R.tracks.ladders[ladderId].ranks.map((r) => r.key) : [];
    for (const rank of [...ranks, null, '없는계급'])
      sels.push({ track, payTable: payTable as Profile['payTable'], rank });
  }
}

describe('모든 직종 시드로 view 의 모든 값을 읽어도 예외가 없다', () => {
  afterAll(() => {
    app.data = null;
  });
  it('조합 수', () => {
    // 일반직(별표 3·4·8) + 경찰·해양경찰·소방(11계급) + 교원 + 외무 + 군무원·그 밖
    expect(sels.length).toBeGreaterThan(60);
  });
  it.each(sels.map((s) => [`${s.track}/${String(s.payTable)}/${String(s.rank)}`, s] as const))(
    '%s',
    (_, sel) => {
      for (const iso of [
        '2026-11-25T10:00:00+09:00',
        '2027-01-04T09:30:00+09:00',
        '2027-07-01T15:00:00+09:00',
        // 연령정년(1968-04-10생 → 2028-06-30, 교원 2030-08-31)이 지난 뒤
        '2031-03-03T10:00:00+09:00',
      ]) {
        at(iso);
        app.data = seed(sel);
        const v = readAll();
        // 봉급이 꺼져 있으면 돈 숫자는 모두 없다(0원 같은 틀린 숫자를 만들지 않는다)
        if (v.salary === null) {
          expect(v.earn, iso).toBeNull();
          expect(v.cumulative, iso).toBeNull();
          expect(v.yearToDate, iso).toBeNull();
          expect(v.leaveDayPrice, iso).toBeNull();
          expect(v.bonuses, iso).toEqual([]);
          expect(v.payOff, iso).not.toBeNull();
        }
      }
    },
  );
});

describe('직종 저장본 픽스처', () => {
  const stored = () => ({ ...app.context(new Date('2026-11-25T10:00:00+09:00'), true) });
  const open = (name: string) => {
    const parsed = parseBackup(
      readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8'),
      stored(),
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    at('2026-11-25T10:00:00+09:00');
    app.data = parsed.data;
    return readAll();
  };
  it('경찰: 별표 10 으로 계산하고, 계급 이름·정년이 나온다', () => {
    const v = open('backup-v4-police.json');
    expect(v.salary).toMatchObject({ annex: '별표 10' });
    expect(view.rankStepLabel).toMatch(/^경\S* \d+호봉$/);
    expect(view.retire?.age).toBe(60);
    expect(view.milestones.length).toBeGreaterThan(20);
  });
  it('교원: 별표 11, 계급 이름 없음, 정년 62세, 연가보상비 없음', () => {
    open('backup-v4-teacher.json');
    expect(view.salary).toMatchObject({ annex: '별표 11' });
    expect(view.rankStepLabel).toMatch(/^\d+호봉$/);
    expect(view.retire?.age).toBe(62);
    expect(view.leaveDayPrice).toBeNull();
    expect(view.leaveCompensationOff?.status).toBe('none');
    expect(view.longService.applicable).toBe(false);
    expect(view.longServiceOff?.status).toBe('none');
  });
  it('그 밖의 특정직: 봉급·정년·승급은 준비 중(숫자 없음), 호봉은 입력한 값', () => {
    open('backup-v4-other.json');
    expect(view.salary).toBeNull();
    expect(view.payOff?.status).toBe('pending');
    expect(view.retire).toBeNull();
    expect(view.retirementOff?.status).toBe('pending');
    expect(view.career).toBeNull();
    expect(view.nextRaise).toBeNull();
    expect(view.noRaiseReason).toBe('manual');
    expect(view.maxStep).toBeNull();
    expect(view.step).toBe(app.data?.profile.step);
    expect(view.leave.needsManualGrant).toBe(true);
  });
});

describe('정년 창 값(view.retire)', () => {
  it('경찰 계급정년이 먼저여도 reachDate 는 연령정년의 60세 생일, 계급정년은 rankLimit 에 따로', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({
      track: 'police',
      payTable: null,
      rank: '경정',
      rankDate: '2015-01-01',
      birthDate: '1975-03-10',
    });
    expect(view.retire).toMatchObject({
      reachDate: '2035-03-10',
      retireDate: '2029-06-30',
      age: 60,
      cause: 'rankLimit',
      rankLimit: { reachDate: '2029-01-01', years: 14 },
      periodText: '1~6월이면 6월 30일, 7~12월이면 12월 31일',
    });
    expect(view.retire?.basis).toMatch(/^경찰공무원법 제30조/);
  });
  it('교원: 교육공무원법 제47조의 구간 규칙(국가공무원법 제74조 문구가 아님)', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({ track: 'teacher', payTable: null, rank: '교원', birthDate: '1966-09-15' });
    expect(view.retire).toMatchObject({
      reachDate: '2028-09-15',
      retireDate: '2029-02-28',
      age: 62,
      cause: 'age',
    });
    expect(view.retire?.periodText).toContain('9~12월이면 다음 해 2월 말일');
    expect(view.retire?.basis).toBe('교육공무원법 제47조');
  });
  it('일반직: 국가공무원법 제74조', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({});
    expect(view.retire?.basis).toMatch(/^국가공무원법 제74조/);
  });
  it('경찰 계급을 모르면 정년은 준비 중(계급을 골라 주세요), 다음 승급은 payOff(입력한 날로 보이지 않는다)', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({ track: 'police', payTable: null, rank: null });
    expect(view.retire).toBeNull();
    expect(view.retirementOff).toEqual({ status: 'pending', reason: '계급을 골라 주세요.' });
    expect(view.noRaiseReason).toBe('payOff');
    expect(view.payOff?.reason).toBe('계급을 골라 주세요.');
    expect(view.manualRaiseOverdue).toBe(false);
  });
});

describe('성장 연출 기준(app.checkGrowth)', () => {
  it('lastForm null(새 사용자·v3 변환): 연출 없이 지금 형태로 채운다', () => {
    at('2026-11-25T10:00:00+09:00');
    const data = seed({ step: 12, nextStepDate: '2027-03-01' });
    data.character = { seenForms: [], lastRank: '7', lastStep: 12, lastForm: null };
    app.data = data;
    app.celebration = null;
    app.checkGrowth(view.profile.rank, view.step, view.formId);
    expect(app.celebration).toBeNull();
    expect(app.data?.character).toMatchObject({
      lastRank: '7',
      lastStep: 12,
      lastForm: 'fledgling',
    });
  });
  it('교원은 재직 연수로 형태가 오르면 성장 연출, 형태 이름과 계급 없는 호봉 글', () => {
    at('2026-11-25T10:00:00+09:00');
    const data = seed({
      track: 'teacher',
      payTable: null,
      rank: '교원',
      hireDate: '2024-11-25',
      rankDate: '2024-11-25',
      step: 9,
    });
    data.character = { seenForms: [], lastRank: '교원', lastStep: 9, lastForm: 'egg' };
    app.data = data;
    app.celebration = null;
    expect(view.formId).toBe('chick');
    app.checkGrowth(view.profile.rank, view.step, view.formId);
    expect(app.celebration).toMatchObject({
      kind: 'grow',
      fromForm: 'egg',
      toForm: 'chick',
      toLabel: '9호봉',
    });
    app.acknowledgeGrowth('교원', 9, 'chick');
    expect(app.celebration).toBeNull();
    expect(app.data?.character.lastForm).toBe('chick');
  });
  it('정년이 지난 뒤 내 정보를 저장해도 형태·호봉은 화면과 같은 날(정년퇴직일) 기준으로 기록', () => {
    // 1968-04-10생 교원 → 2030-04-10 에 62세, 2030-08-31 퇴직. 2010-09-01 임용이면 퇴직일엔 재직 20년 전,
    // 오늘(2031-03-03)은 20년이 넘는다 — 오늘 기준으로 세면 형태가 한 단계 더 높게 기록된다.
    // 상태(app)는 시스템 시계(new Date())로, 화면(view)은 clock 으로 오늘을 센다. 둘을 같은 때로 맞춘다.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-03-03T10:00:00+09:00'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    at('2031-03-03T10:00:00+09:00');
    const data = seed({
      track: 'teacher',
      payTable: null,
      rank: '교원',
      hireDate: '2010-09-01',
      rankDate: '2010-09-01',
      step: 9,
    });
    app.data = data;
    app.celebration = null;
    expect(view.retired).toBe(true);
    app.updateProfile({ ...view.profile });
    expect(app.data?.character).toMatchObject({ lastStep: view.step, lastForm: view.formId });
    const before = { ...app.data?.character };
    app.checkGrowth(view.profile.rank, view.step, view.formId);
    expect(app.celebration).toBeNull();
    expect(app.data?.character).toEqual(before);
  });
});
