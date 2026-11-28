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
    series: null,
    seriesJikryu: null,
    payTable: 'table3',
    rank: '7',
    rankDate: '2018-03-01',
    step: 12,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-11-25',
    overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    priorService: null,
    ...over,
  };
  const data = newUserData(profile, defaultSettings(R), '2026-11-25T01:00:00.000Z', '2026-11-25');
  data.leave.records.push({
    id: 'a1',
    date: '2026-03-03',
    hours: 8,
    kind: 'day',
    memo: '',
    pool: 'annual',
  });
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
          // 연가보상비 어림(#33)도 일수만 있고 금액은 없다
          const comp = v.leaveComp as {
            kind: string;
            mid?: { amount: number | null };
            end?: { total: number | null; net: number | null };
            total?: number | null;
          } | null;
          if (comp?.kind === 'year') {
            expect(comp.mid?.amount === null || comp.mid?.amount === 0, iso).toBe(true);
            expect(comp.end?.total, iso).toBeNull();
            expect(comp.end?.net, iso).toBeNull();
          }
          if (comp?.kind === 'retire') expect(comp.total, iso).toBeNull();
          expect(v.bonuses, iso).toEqual([]);
          expect(v.payOff, iso).not.toBeNull();
        }
        // 생애 봉급(#30): 지금까지 번 봉급은 지갑 창의 누적 봉급과 같은 값이다
        const life = v.lifetime as { earned: number; total: number; remaining: number } | null;
        const cum = v.cumulative as { total: number } | null;
        if (life !== null) {
          expect(life.earned, iso).toBe(cum?.total);
          expect(life.earned + life.remaining, iso).toBe(life.total);
        }
        // 봉급이 꺼져 있으면 금액은 없다. 정년을 계산하지 못하면 끝나는 날이 없어 금액도 횟수도 없다
        if (v.salary === null) expect(life, iso).toBeNull();
        if (v.retireDate === null) {
          expect(v.lifeEnd, iso).toMatchObject({ date: null, basis: 'none', planHeld: false });
          expect(life, iso).toBeNull();
          expect(v.lifePaydays, iso).toBeNull();
          expect(v.lifeDiligenceLeft, iso).toBeNull();
          expect(v.lifeNewYears, iso).toBeNull();
        } else {
          expect(v.lifeEnd, iso).toMatchObject({ date: v.retireDate, basis: 'retirement' });
          expect(v.lifeAsOf, iso).toBe(v.serviceDay);
          expect(v.lifePaydays, iso).not.toBeNull();
        }
        // 저장된 퇴직 예정 달이 없으므로 본문을 줄여 가리는 일은 없다
        expect(v.lifeMasked, iso).toBe(false);
        expect(view.retirePlanMonth, iso).toBeNull();
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
    expect(view.leaveComp).toBeNull();
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
  it('경찰 계급을 모르면 정년은 입력 필요(계급을 골라 주세요), 다음 승급은 payOff(입력한 날로 보이지 않는다)', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({ track: 'police', payTable: null, rank: null });
    expect(view.retire).toBeNull();
    expect(view.retirementOff).toEqual({ status: 'input', reason: '계급을 골라 주세요.' });
    expect(view.noRaiseReason).toBe('payOff');
    expect(view.payOff?.reason).toBe('계급을 골라 주세요.');
    expect(view.manualRaiseOverdue).toBe(false);
  });
});

describe('성장 연출 기준(app.checkGrowth)', () => {
  it('lastForm null(새 사용자·v3 변환): 연출 없이 지금 형태로 채운다', () => {
    at('2026-11-25T10:00:00+09:00');
    const data = seed({ step: 12, nextStepDate: '2027-03-01' });
    data.character = {
      ...data.character,
      seenForms: [],
      lastRank: '7',
      lastStep: 12,
      lastForm: null,
    };
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
    data.character = {
      ...data.character,
      seenForms: [],
      lastRank: '교원',
      lastStep: 9,
      lastForm: 'egg',
    };
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

describe('내 정보 고치기 뒤 안내 띠(app.trackChange)', () => {
  it('일반직 안에서 봉급표만 바꿔도(별표 3 → 8) 카드 계급 이름이 바뀌면 띠로 알린다(월급날은 묻지 않는다)', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({});
    expect(app.data.settings.card.showRank).toBe(true);
    app.trackChange = null;
    app.updateProfile({ ...view.profile, payTable: 'table8', rank: '7' });
    expect(app.data?.settings.card.showRank).toBe(false);
    expect(app.trackChange).toMatchObject({
      trackLabel: '일반직(별표 8)',
      paydayDefault: null,
      cardShowRank: false,
    });
    // 되돌리면 다시 켜고 그 사실도 알린다
    app.updateProfile({ ...view.profile, payTable: 'table3', rank: '7' });
    expect(app.data?.settings.card.showRank).toBe(true);
    expect(app.trackChange).toMatchObject({ trackLabel: '일반직', cardShowRank: true });
  });
  it('경찰 25일은 별표 30에 따로 적혀 있지 않은 기본값이라 권하지 않고(paydayFirm false), 교원 17일은 권한다', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({});
    app.data.settings.payday = 20;
    app.updateProfile({ ...view.profile, track: 'police', payTable: null, rank: '경위' });
    expect(app.trackChange).toMatchObject({ paydayDefault: 25, paydayFirm: false });
    app.updateProfile({ ...view.profile, track: 'teacher', payTable: null, rank: '교원' });
    expect(app.trackChange).toMatchObject({ paydayDefault: 17, paydayFirm: true });
  });
});

describe('연가 일수가 준비 중인 직종(needsManualGrant)', () => {
  it('부여 0을 계산값처럼 쓰지 않는다: 직접 넣기 전에는 needsManualGrant, 넣으면 남은 연가를 센다', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({ track: 'otherSpecial', payTable: null, rank: null });
    expect(view.leave).toMatchObject({ needsManualGrant: true, grantedHours: 0, usedHours: 8 });
    app.setGrantOverride(2026, 21 * 8);
    expect(view.leave).toMatchObject({ needsManualGrant: false, remainingHours: 20 * 8 });
  });
});

describe('내 정보 점검: 계급을 고르지 않은 저장본', () => {
  it("'이 계급은 고를 수 없어요'가 아니라 사다리 이름으로 골라 달라고 한다", () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed({ track: 'police', payTable: null, rank: null });
    expect(view.profileIssueMap.rank).toBe('계급을 골라 주세요.');
    app.data = seed({ track: 'foreign', payTable: null, rank: null });
    expect(view.profileIssueMap.rank).toBe('직무등급을 골라 주세요.');
    expect(view.payOff).toEqual({ status: 'input', reason: '직무등급을 골라 주세요.' });
  });
});

describe('생애 봉급 창 값(#30)', () => {
  afterAll(() => {
    app.data = null;
  });
  /** 설계서 §7.1 의 P7: 7급 14호봉, 1988-11-25생, 임용 2013-07-01, 다음 승급 2027-07-01 */
  const p7: Partial<Profile> = {
    birthDate: '1988-11-25',
    hireDate: '2013-07-01',
    rank: '7',
    rankDate: '2019-01-01',
    step: 14,
    nextStepDate: '2027-07-01',
    stepAsOf: '2026-11-01',
  };

  it('U1: 7급 14호봉, 오늘 2026-11-27 — 정년까지의 금액과 횟수', () => {
    at('2026-11-27T10:00:00+09:00');
    app.data = seed(p7);
    expect(view.lifeEnd).toMatchObject({
      basis: 'retirement',
      date: '2048-12-31',
      planMonth: null,
      planHeld: false,
      planIssue: null,
      minMonth: '2026-11',
      maxMonth: '2048-12',
    });
    expect(view.lifeAgeRetireDate).toBe('2048-12-31');
    expect(view.lifeAsOf).toBe('2026-11-27');
    expect(view.lifetime).toMatchObject({
      total: 1_564_335_000,
      earned: 457_731_450,
      remaining: 1_106_603_550,
      raisesLeft: 17,
      maxStepDate: '2043-07-01',
      tableYear: 2026,
    });
    expect(view.lifetime?.earned).toBe(view.cumulative?.total);
    expect(view.lifePaydays).toEqual({ received: 161, left: 265, total: 426, todayCounted: false });
    expect(view.lifeDiligenceLeft).toBe(44);
    expect(view.lifeNewYears).toBe(22);
    // 정년 기준이면 한마디의 기간 %는 정년 창의 값(careerRatio)을 쓴다
    expect(view.lifeTimeRatio).toBeNull();
    expect(Math.floor(view.careerRatio * 100)).toBe(37);
    expect(view.lifePaydayHolidaysKnown).toBe(true);
  });

  it('금액 가리기를 켜도 저장된 퇴직 예정 달이 없으면 본문을 줄이지 않는다', () => {
    at('2026-11-27T10:00:00+09:00');
    const data = seed(p7);
    data.settings.hideAmounts = true;
    app.data = data;
    expect(view.lifeMasked).toBe(false);
    expect(view.lifePaydays?.left).toBe(265);
  });

  it('U31: 오늘이 월급날이면 todayCounted, 정년 뒤에는 아니다', () => {
    at('2026-11-25T10:00:00+09:00');
    app.data = seed(p7);
    expect(view.lifePaydays).toMatchObject({ received: 161, left: 265, todayCounted: true });
    expect(view.isPayday).toBe(true);
    // 지급일 1일, 2026-12-31: 2027년 1월분이 1월 1일(공휴일) 때문에 오늘로 당겨졌다 → 163번째 월급날
    at('2026-12-31T10:00:00+09:00');
    const first = seed(p7);
    first.settings.payday = 1;
    app.data = first;
    expect(view.isPayday).toBe(true);
    expect(view.lifePaydays).toMatchObject({ received: 163, left: 263, todayCounted: true });
    // 같은 날이 정년퇴직일(1966-08-15생 → 2026-12-31)이면: '다음 월급날이 오늘'(isPayday)이지만
    // 그 지급일은 끝나는 달 밖(2027년 1월분)이라 세지 않는다
    const last = seed({ birthDate: '1966-08-15', hireDate: '1990-05-10', rank: '6', step: 32 });
    last.settings.payday = 1;
    app.data = last;
    expect(view.retireDate).toBe('2026-12-31');
    expect(view.isPayday).toBe(true);
    expect(view.lifePaydays).toMatchObject({ left: 0, todayCounted: false });
    expect(view.lifePaydays?.received).toBe(view.lifePaydays?.total);
  });

  it('U32: 공휴일 데이터가 없는 해가 걸리면 알린다(오늘의 해와 다음 달 1일의 해)', () => {
    app.data = seed(p7);
    const known = (iso: string) => {
      at(iso);
      return view.lifePaydayHolidaysKnown;
    };
    expect(known('2026-12-15T10:00:00+09:00')).toBe(true);
    expect(known('2027-11-30T10:00:00+09:00')).toBe(true);
    expect(known('2027-12-01T10:00:00+09:00')).toBe(false);
    expect(known('2028-01-01T10:00:00+09:00')).toBe(false);
  });

  it('U27: 올해 봉급표 미반영(2027년 1월)에도 2026년 표로 같은 총액', () => {
    at('2027-01-05T10:00:00+09:00');
    app.data = seed(p7);
    expect(view.salaryPending).toBe(true);
    expect(view.lifetime).toMatchObject({ tableYear: 2026, total: 1_564_335_000 });
    expect(view.lifeNewYears).toBe(21);
  });

  it('U13·U14: 정년퇴직일이 지나면 그날에서 멈춘다', () => {
    at('2026-11-27T10:00:00+09:00');
    app.data = seed({
      birthDate: '1966-03-10',
      hireDate: '1990-05-10',
      rank: '6',
      rankDate: '2010-01-01',
      step: 32,
      nextStepDate: '2026-12-01',
      stepAsOf: '2026-06-01',
    });
    expect(view.retired).toBe(true);
    expect(view.lifeEnd).toMatchObject({ basis: 'retirement', date: '2026-06-30' });
    expect(view.lifeAsOf).toBe('2026-06-30');
    expect(view.lifetime).toMatchObject({ remaining: 0, ratio: 1 });
    expect(view.lifetime?.earned).toBe(view.cumulative?.total);
    expect(view.lifePaydays).toEqual({ received: 434, left: 0, total: 434, todayCounted: false });
    expect(view.lifeDiligenceLeft).toBe(0);
  });

  it('U19: 계급정년이 먼저 오는 경정 — 끝나는 날은 계급정년 퇴직일, 상한은 연령정년 퇴직일의 달', () => {
    at('2026-11-27T10:00:00+09:00');
    app.data = seed({
      track: 'police',
      payTable: null,
      rank: '경정',
      birthDate: '1980-08-15',
      hireDate: '2005-04-01',
      rankDate: '2020-03-01',
      step: 22,
      nextStepDate: '2027-04-01',
      stepAsOf: '2026-11-01',
    });
    expect(view.retire?.cause).toBe('rankLimit');
    expect(view.lifeEnd).toMatchObject({ date: '2034-06-30', maxMonth: '2040-12' });
    expect(view.lifetime?.remaining).toBe(516_452_270);
    expect(view.lifePaydays?.left).toBe(91);
    expect(view.lifeDiligenceLeft).toBe(15);
  });

  it("U23: 계급을 안 고른 경찰 — 정년 '입력 필요'라 숫자가 없지만 상한(연령정년)은 안다", () => {
    at('2026-11-27T10:00:00+09:00');
    app.data = seed({ track: 'police', payTable: null, rank: null, birthDate: '1980-08-15' });
    expect(view.retirementOff?.status).toBe('input');
    expect(view.lifeAgeRetireDate).toBe('2040-12-31');
    expect(view.lifeEnd).toMatchObject({ date: null, basis: 'none', maxMonth: '2040-12' });
    expect(view.lifetime).toBeNull();
    expect(view.lifePaydays).toBeNull();
  });

  it("U21·U22: 정년 '준비 중'(외무·군무원) — 끝나는 날이 없어 금액도 횟수도 없다", () => {
    at('2026-11-27T10:00:00+09:00');
    for (const track of ['foreign', 'militaryCivil'] as const) {
      app.data = seed({ track, payTable: null, rank: track === 'foreign' ? '3' : null });
      expect(view.retirementOff?.status, track).toBe('pending');
      expect(view.lifeEnd, track).toMatchObject({ date: null, basis: 'none', maxMonth: null });
      expect(view.lifetime, track).toBeNull();
      expect(view.lifePaydays, track).toBeNull();
      expect(view.lifeDiligenceLeft, track).toBeNull();
      expect(view.lifeNewYears, track).toBeNull();
    }
  });
});

describe('퇴직 예정 달(#30 묶음 2, 저장 형식 v6)', () => {
  afterAll(() => {
    app.data = null;
  });
  const T = '2026-11-27T10:00:00+09:00';
  /** 설계서 §7.1 의 P7: 7급 14호봉, 정년퇴직일 2048-12-31 */
  const p7: Partial<Profile> = {
    birthDate: '1988-11-25',
    hireDate: '2013-07-01',
    rank: '7',
    rankDate: '2019-01-01',
    step: 14,
    nextStepDate: '2027-07-01',
    stepAsOf: '2026-11-01',
  };
  const pk: Partial<Profile> = {
    track: 'police',
    payTable: null,
    rank: '경정',
    birthDate: '1980-08-15',
    hireDate: '2005-04-01',
    rankDate: '2020-03-01',
    step: 22,
    nextStepDate: '2027-04-01',
    stepAsOf: '2026-11-01',
  };
  const withPlan = (over: Partial<Profile>, month: string | null): UserData => {
    const data = seed(over);
    data.plan.retireMonth = month;
    return data;
  };

  it('U5: 정한 달 2030-03 — 그 달 말일까지의 금액과 횟수', () => {
    at(T);
    app.data = withPlan(p7, '2030-03');
    expect(view.retirePlanMonth).toBe('2030-03');
    expect(view.lifeEnd).toMatchObject({
      basis: 'plan',
      date: '2030-03-31',
      planMonth: '2030-03',
      planHeld: true,
      planIssue: null,
      beyondRankLimit: false,
    });
    expect(view.lifeAsOf).toBe('2026-11-27');
    expect(view.lifetime).toMatchObject({
      total: 603_873_300,
      earned: 457_731_450,
      remaining: 146_141_850,
      raisesLeft: 3,
      stepAtEnd: 17,
      maxStepDate: null,
    });
    expect(view.lifetime?.earned).toBe(view.cumulative?.total);
    expect(view.lifePaydays).toMatchObject({ received: 161, left: 40 });
    expect(view.lifeDiligenceLeft).toBe(7);
    expect(view.lifeNewYears).toBe(4);
    // 한마디의 기간 %는 정한 달까지로 센다(정년 창의 37% 와 다른 수)
    expect(Math.floor((view.lifeTimeRatio ?? 0) * 100)).toBe(80);
    // 견줘 보일 정년 기준 합계는 정한 달이 없을 때의 lifetime.total 과 같다
    const withPlanTotal = view.lifeRetirementTotal;
    app.data = seed(p7);
    expect(view.lifeRetirementTotal).toBeNull();
    expect(withPlanTotal).toBe(view.lifetime?.total);
  });

  it('정한 달은 이 창에서만 쓴다: 정년 D-day·재직 진행률·연가·보너스·일정·누적 봉급은 그대로다', () => {
    at(T);
    app.data = seed(p7);
    const before = readAll();
    app.data = withPlan(p7, '2030-03');
    const after = readAll();
    const lifeKeys = Object.keys(after).filter((k) => k.startsWith('life') || k === 'lifetime');
    expect(lifeKeys.sort()).toEqual(
      [
        'lifeAgeRetireDate',
        'lifeAsOf',
        'lifeDiligenceLeft',
        'lifeEnd',
        'lifeMasked',
        'lifeNewYears',
        'lifePaydayHolidaysKnown',
        'lifePaydays',
        'lifeRetirementTotal',
        'lifeTimeRatio',
        'lifetime',
      ].sort(),
    );
    // 저장본 자체(data.plan)를 담은 값은 그 칸만 빼고 견준다(업적 판정의 입력 등)
    const text = (value: unknown) =>
      JSON.stringify(value, (k, v: unknown) => (k === 'plan' ? undefined : v));
    for (const key of Object.keys(after)) {
      if (lifeKeys.includes(key) || key === 'retirePlanMonth') continue;
      expect(text(after[key]), key).toBe(text(before[key]));
    }
    expect(view.retireDate).toBe('2048-12-31');
    expect(after.retirePlanMonth).toBe('2030-03');
  });

  it('U4·U10: 이번 달을 정하면 이번 달 말일까지 — 말일에는 남은 것이 없다', () => {
    at(T);
    app.data = withPlan(p7, '2026-11');
    expect(view.lifeEnd).toMatchObject({ basis: 'plan', date: '2026-11-30' });
    expect(view.lifetime).toMatchObject({ remaining: 351_450, total: 458_082_900, raisesLeft: 0 });
    expect(view.lifePaydays?.left).toBe(0);
    expect(view.lifeDiligenceLeft).toBe(0);
    at('2026-11-30T10:00:00+09:00');
    expect(view.lifeEnd).toMatchObject({ basis: 'plan', date: '2026-11-30' });
    expect(view.lifetime).toMatchObject({ remaining: 0, ratio: 1 });
    // 달이 넘어가면 지난 달이 된다: 저장본은 그대로 두고 정년 기준으로 셈한다
    at('2026-12-01T10:00:00+09:00');
    expect(view.retirePlanMonth).toBe('2026-11');
    expect(view.lifeEnd).toMatchObject({
      basis: 'retirement',
      date: '2048-12-31',
      planIssue: 'past',
      planHeld: true,
    });
  });

  it('U6~U8: 쓸 수 없는 정한 달은 정년 기준으로 셈하고 까닭을 알린다. 정년과 같은 달은 정년 기준 그대로', () => {
    at(T);
    for (const [month, issue] of [
      ['2026-10', 'past'],
      ['2049-01', 'afterLimit'],
      ['2048-12', null],
    ] as const) {
      app.data = withPlan(p7, month);
      expect(view.lifeEnd, month).toMatchObject({
        basis: 'retirement',
        date: '2048-12-31',
        planMonth: null,
        planHeld: true,
        planIssue: issue,
      });
      expect(view.lifetime?.total, month).toBe(1_564_335_000);
      expect(view.lifePaydays?.left, month).toBe(265);
      // 저장된 값은 건드리지 않는다
      expect(view.data.plan.retireMonth, month).toBe(month);
    }
  });

  it('U34: 금액 가리기 + 저장된 정한 달이면 본문을 줄인다(쓸 수 없는 달·정년과 같은 달 포함). 정년이 지난 사람은 아니다', () => {
    at(T);
    for (const month of ['2030-03', '2026-10', '2049-01', '2048-12']) {
      const data = withPlan(p7, month);
      data.settings.hideAmounts = true;
      app.data = data;
      expect(view.lifeMasked, month).toBe(true);
      data.settings.hideAmounts = false;
      app.data = { ...data };
      expect(view.lifeMasked, month).toBe(false);
    }
    const retired = withPlan(
      { birthDate: '1966-03-10', hireDate: '1990-05-10', rank: '6', step: 32 },
      '2027-03',
    );
    retired.settings.hideAmounts = true;
    app.data = retired;
    expect(view.retired).toBe(true);
    expect(view.lifeEnd).toMatchObject({ basis: 'retirement', planHeld: false, planIssue: null });
    expect(view.lifeMasked).toBe(false);
  });

  it('U19b: 계급정년 뒤(연령정년 이내)를 정할 수 있고, 연령정년 뒤는 쓸 수 없다', () => {
    at(T);
    app.data = withPlan(pk, '2036-12');
    expect(view.retireDate).toBe('2034-06-30');
    expect(view.lifeEnd).toMatchObject({
      basis: 'plan',
      date: '2036-12-31',
      beyondRankLimit: true,
      maxMonth: '2040-12',
    });
    expect(view.lifePaydays?.left).toBe(121);
    app.data = withPlan(pk, '2040-12');
    expect(view.lifeEnd).toMatchObject({ basis: 'plan', beyondRankLimit: true });
    expect(view.lifePaydays?.left).toBe(169);
    app.data = withPlan(pk, '2041-01');
    expect(view.lifeEnd).toMatchObject({
      basis: 'retirement',
      date: '2034-06-30',
      planIssue: 'afterLimit',
    });
    expect(view.lifetime?.remaining).toBe(516_452_270);
    // 계급정년 퇴직일과 같은 달은 정년 기준 그대로다
    app.data = withPlan(pk, '2034-06');
    expect(view.lifeEnd).toMatchObject({ basis: 'retirement', planHeld: true, planIssue: null });
  });

  it('U23: 계급을 안 고른 경찰 — 정한 달이 있으면 월급날 횟수만, 연령정년 뒤면 끝나는 날이 없다', () => {
    at(T);
    const noRank = { ...pk, rank: null };
    app.data = withPlan(noRank, '2030-06');
    expect(view.retirementOff?.status).toBe('input');
    expect(view.lifeEnd).toMatchObject({
      basis: 'plan',
      date: '2030-06-30',
      beyondRankLimit: false,
      maxMonth: '2040-12',
    });
    expect(view.lifetime).toBeNull();
    expect(view.lifePaydays?.left).toBe(43);
    app.data = withPlan(noRank, '2041-01');
    expect(view.lifeEnd).toMatchObject({ basis: 'none', date: null, planIssue: 'afterLimit' });
    expect(view.lifePaydays).toBeNull();
  });

  it("U21·U22: 정년 '준비 중' 직종은 정한 달이 있어야 끝나는 날이 생긴다(상한은 만들지 않는다)", () => {
    at(T);
    const base = { hireDate: '2018-02-01', rankDate: '2018-02-01', nextStepDate: '2027-02-01' };
    app.data = withPlan(
      { ...base, track: 'foreign', payTable: null, rank: '3', step: 9 },
      '2040-06',
    );
    expect(view.retirementOff?.status).toBe('pending');
    expect(view.lifeEnd).toMatchObject({ basis: 'plan', date: '2040-06-30', maxMonth: null });
    expect(view.lifetime).toMatchObject({ stepNow: 9, stepAtEnd: 23, raisesLeft: 14 });
    expect(view.lifePaydays).toMatchObject({ received: 106, left: 163 });
    expect(view.lifeDiligenceLeft).toBe(27);
    // 군무원: 봉급도 준비 중이라 금액은 없고 월급날 횟수만(지급일 10일)
    const military = withPlan(
      { ...base, track: 'militaryCivil', payTable: null, rank: null, step: 9 },
      '2040-06',
    );
    military.settings.payday = 10;
    app.data = military;
    expect(view.lifetime).toBeNull();
    expect(view.lifePaydays).toMatchObject({ received: 106, left: 163 });
    expect(view.lifeDiligenceLeft).toBeNull();
  });

  it('모든 직종 시드 × 정한 달 여럿: 읽을 때 예외가 없고 금액은 지갑 창과 같다', () => {
    for (const sel of sels) {
      for (const month of ['2026-10', '2026-11', '2030-03', '2040-12', '2099-01']) {
        at(T);
        const data = withPlan(sel, month);
        data.character.lastRank = sel.rank ?? null;
        app.data = data;
        const v = readAll();
        const life = v.lifetime as { earned: number; total: number; remaining: number } | null;
        const cum = v.cumulative as { total: number } | null;
        const label = `${sel.track} ${sel.payTable} ${sel.rank} ${month}`;
        if (life !== null) {
          expect(life.earned, label).toBe(cum?.total);
          expect(life.earned + life.remaining, label).toBe(life.total);
        }
        expect((v.lifeEnd as { planHeld: boolean }).planHeld, label).toBe(!view.retired);
      }
    }
  });
});

describe('퇴직 예정 달 저장(app.setRetirePlan)', () => {
  afterAll(() => {
    app.data = null;
  });
  it('정하고, 고치고, 지운다. 형식이 틀린 값은 저장하지 않는다', () => {
    at('2026-11-27T10:00:00+09:00');
    app.data = seed({});
    const changes = () => app.data?.meta.changesSinceBackup ?? -1;
    expect(app.data.plan).toEqual({ retireMonth: null });
    // 이 검사에는 저장소가 없어(app.init 을 부르지 않았다) 바꾸기만 하고 'unsaved'를 돌려준다.
    // 저장소에 쓴 경우('saved')와 쓰지 못한 경우의 화면은 e2e(lifetime-plan.spec)가 본다
    expect(app.setRetirePlan('2030-03')).toBe('unsaved');
    expect(app.data.plan.retireMonth).toBe('2030-03');
    // 사용자가 바꾼 것이므로 '마지막 패키지 이후 변경'으로 센다
    expect(changes()).toBe(1);
    expect(app.setRetirePlan('2031-06')).toBe('unsaved');
    expect(app.data.plan.retireMonth).toBe('2031-06');
    expect(changes()).toBe(2);
    // 같은 값이면 아무것도 바꾸지 않는다
    expect(app.setRetirePlan('2031-06')).toBe('saved');
    expect(changes()).toBe(2);
    for (const bad of ['2030-3', '2030-13', '2030-03-15', '', '2151-01'])
      expect(app.setRetirePlan(bad), bad).toBe(false);
    expect(app.data.plan.retireMonth).toBe('2031-06');
    expect(changes()).toBe(2);
    expect(app.setRetirePlan(null)).toBe('unsaved');
    expect(app.data.plan).toEqual({ retireMonth: null });
    expect(changes()).toBe(3);
  });

  it('S5: 내 정보를 고쳐 저장해도(updateProfile) 퇴직 예정 달이 남는다 — 직종·생년월일을 바꿔도 지우지 않는다', () => {
    at('2026-11-27T10:00:00+09:00');
    app.data = seed({});
    app.setRetirePlan('2030-03');
    const profile = { ...view.profile, nickname: '새이름', step: 13 };
    app.updateProfile(profile);
    expect(app.data.profile.nickname).toBe('새이름');
    expect(app.data.plan).toEqual({ retireMonth: '2030-03' });
    // 정년이 당겨져 정한 달이 정년 뒤가 되어도 저장된 값은 그대로다(계산이 걸러 화면이 알린다)
    app.updateProfile({ ...profile, birthDate: '1966-12-10', hireDate: '1995-03-02' });
    expect(view.retireDate).toBe('2026-12-31');
    expect(app.data.plan).toEqual({ retireMonth: '2030-03' });
    expect(view.lifeEnd).toMatchObject({ basis: 'retirement', planIssue: 'afterLimit' });
    app.updateProfile({ ...profile, track: 'teacher', payTable: null, rank: '교원' });
    expect(app.data.plan).toEqual({ retireMonth: '2030-03' });
    // 설정을 바꿔도 남는다
    app.updateSettings({ hideAmounts: true });
    expect(app.data.plan).toEqual({ retireMonth: '2030-03' });
    app.trackChange = null;
  });
});
