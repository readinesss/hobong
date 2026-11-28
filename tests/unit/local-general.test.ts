/**
 * 지방 일반직(#31 묶음 2): 직종 해석·월급날·연가(연초 재직기간 기준, 반일 준비 중)·근속승진 명부 이름.
 * 숫자는 설계 검산(scratchpad r5/local/proto: examples.out.md·review_fixes.out.md)에서 실제로 계산한 값이다.
 * 원문과의 대조는 rules-data.test.ts 의 '지방 발췌본과 대조' 묶음이 본다.
 */
import { describe, expect, it } from 'vitest';
import { rulesFor } from '../../src/lib/rules/index.ts';
import { defaultSel, resolveCareer, selectableRanks } from '../../src/lib/rules/career.ts';
import {
  FEATURE_KEYS,
  isAvailable,
  type Avail,
  type FeatureKey,
} from '../../src/lib/rules/types.ts';
import { Calendar } from '../../src/lib/calc/calendar.ts';
import {
  annualLeaveDays,
  checkNewLeave,
  compensationPerDay,
  grantTimeline,
  hoursOfKind,
  HALF_DAY_PENDING_MESSAGE,
  pendingGrantChange,
  summarizeLeave,
} from '../../src/lib/calc/leave.ts';
import { buildMilestones } from '../../src/lib/calc/milestones.ts';
import { longServiceInfo } from '../../src/lib/calc/promotion.ts';
import type { CareerProfile } from '../../src/lib/calc/career-profile.ts';
import type { LeaveData, LeaveRecord } from '../../src/lib/store/schema.ts';

const R = rulesFor(2026);
const cal = new Calendar(rulesFor);
const local = (rank: string | null = '9') =>
  resolveCareer(R, { track: 'localGeneral', payTable: null, rank });
const general = (rank: string | null = '9') =>
  resolveCareer(R, { track: 'general', payTable: 'table3', rank });
function on<T extends object>(v: Avail<T>): T {
  if (!isAvailable(v)) throw new Error(`꺼진 항목: ${v.status} ${v.reason}`);
  return v;
}
const emptyLeave = (): LeaveData => ({
  records: [],
  grantOverrideHours: {},
  savings: [],
  years: {},
});

describe('지방 일반직: 직종 해석', () => {
  it('9급: 별표 3 9급 봉급, 월급날 20·17일, 대우공무원 준비 중, 장기재직휴가 다른 기준, 심사 시작일 없음', () => {
    const c = local('9');
    const p = on(c.pay);
    expect(p.tableId).toBe('table3');
    expect(p.annex).toBe('별표 3');
    // 지방공무원 보수규정 제4조제3항이 별표 3 을 준용한다 — 국가 봉급표 행 그 자체를 쓴다
    expect(p.row).toBe(R.salary.table['9']);
    expect(p.row[0]).toBe(2_133_000);
    expect(c.ladderId).toBe('general');
    expect(c.payday.defaultDay).toBe(20);
    expect(c.payday.options.map((o) => o.day)).toEqual([20, 17]);
    expect(c.seniorTreatment).toMatchObject({ status: 'pending' });
    expect(c.leave.longService).toMatchObject({ status: 'external' });
    const long = on(c.longService);
    expect(long.reviewLeadDays).toBeNull();
    expect(long.rosterName).toBe('승진후보자 명부');
    expect(long.quotaNote).toContain('직렬별 인원의 50%');
    expect(c.leave.units).toMatchObject({ hoursPerDay: 8, halfDayHours: null });
    expect(on(c.leave.annual).tenureBasis).toBe('year-start');
    expect(c.track.seriesScope).toBe('local');
    expect(c.track.status).toBe('partial');
  });

  it('연도 중 임용 계산은 지방 근거(복무규정 제7조의2)로, 셈법은 국가와 같다. 근거 목록에 나온다', () => {
    const c = local();
    expect(c.leave.firstYear).toMatchObject({ minDaysForMonth: 15, rounding: 'half-up' });
    expect(c.leave.firstYear.source.law).toBe('localService');
    expect(c.sources.filter((s) => s.feature === 'leaveFirstYear')).toHaveLength(1);
    // 국가 직종은 기본 구역 그대로(근거 목록에 따로 나오지 않는다)
    expect(general().leave.firstYear).toBe(R.leave.firstYear);
    expect(general().sources.some((s) => s.feature === 'leaveFirstYear')).toBe(false);
  });

  it('국가 일반직은 지금과 같다: 별표 30 네 행, 8시간·4시간, 사용 직전일 기준, 심사 5일 전, 명부 이름', () => {
    const c = general('9');
    expect(c.payday.options).toBe(R.payday.options);
    expect(c.payday.options.map((o) => o.day)).toEqual([10, 17, 20, 25]);
    expect(c.payday.defaultDay).toBe(25);
    expect(c.leave.units).toBe(R.leave.units);
    expect(c.leave.units).toMatchObject({ hoursPerDay: 8, halfDayHours: 4 });
    expect(on(c.leave.annual).tenureBasis).toBe('day-before-use');
    expect(on(c.longService)).toMatchObject({ reviewLeadDays: 5, rosterName: '승진후보자명부' });
    expect(c.track.seriesScope).toBe('national');
    // 근거 목록에 월급날·연가 단위의 직종 근거가 새로 끼지 않는다(국가는 공통 규정에서 보인다)
    expect(c.sources.filter((s) => s.feature === 'payday' || s.feature === 'leaveUnits')).toEqual(
      [],
    );
  });

  it('모든 항목(FEATURE_KEYS 전부)을 덮어쓰기나 꺼짐으로 밝혀 둔다(국가 값을 근거 없이 쓰지 않는다)', () => {
    const t = R.tracks.items.localGeneral as unknown as Record<FeatureKey, unknown> & {
      applies?: object;
    };
    for (const f of FEATURE_KEYS) expect(t[f], f).toBeDefined();
    // 덮어쓰기 값은 지방 조문을 근거로 든다 — 국가 조문을 '적용하는 조문'으로 내지 않는다(applies 를 쓰지 않음)
    expect(t.applies).toBeUndefined();
    const c = local('7');
    for (const s of c.sources.filter((x) => x.feature !== 'ladder' && x.feature !== 'pay'))
      expect(s.source.law, `${s.feature}`).toMatch(/^local/);
    expect(c.sources.some((s) => s.base)).toBe(false);
  });

  it('직종을 처음 고를 때 9급, 봉급표는 고르지 않는다(null). 고를 수 있는 계급은 1~9급', () => {
    expect(defaultSel(R, 'localGeneral')).toEqual({
      track: 'localGeneral',
      payTable: null,
      rank: '9',
    });
    expect(selectableRanks(R, 'localGeneral', null).map((r) => r.key)).toEqual(
      selectableRanks(R, 'general', 'table3').map((r) => r.key),
    );
  });

  it('2027년(2026년 값을 이어 쓰는 해)에도 같게 해석된다', () => {
    const c = resolveCareer(rulesFor(2027), { track: 'localGeneral', payTable: null, rank: '9' });
    expect(on(c.pay)).toMatchObject({ tableYear: 2026, confirmed: false });
    expect(c.payday.options.map((o) => o.day)).toEqual([20, 17]);
  });
});

describe('지방 일반직: 월급날(지방공무원 보수규정 제19조)', () => {
  it('17일 선택지는 국가 별표 30 의 "교육부 및 그 소속 기관" 행과 같은 날이다', () => {
    const edu = R.payday.options.find((o) => o.orgs.startsWith('교육부 및 그 소속 기관'));
    expect(edu?.day).toBe(17);
    expect(local().payday.options[1]?.day).toBe(edu?.day);
  });
  it('토요일·공휴일이면 전날: 2026년 20일 기준 6/19·9/18·12/18, 17일 기준 1/16', () => {
    expect(cal.payday(2026, 6, 20)).toBe('2026-06-19');
    expect(cal.payday(2026, 9, 20)).toBe('2026-09-18');
    expect(cal.payday(2026, 12, 20)).toBe('2026-12-18');
    expect(cal.payday(2026, 1, 17)).toBe('2026-01-16');
    // 20일 기준으로 당겨지는 달은 세 번, 17일 기준은 여섯 번(설계 검산과 같다)
    const shifted = (day: number) =>
      Array.from({ length: 12 }, (_, i) => cal.payday(2026, i + 1, day)).filter(
        (d) => Number(d.slice(8)) !== day,
      );
    expect(shifted(20)).toEqual(['2026-06-19', '2026-09-18', '2026-12-18']);
    expect(shifted(17)).toEqual([
      '2026-01-16',
      '2026-02-13',
      '2026-05-15',
      '2026-07-16',
      '2026-08-14',
      '2026-10-16',
    ]);
  });
});

describe('지방 일반직: 연가 일수는 연초 재직기간 기준(tenureBasis year-start)', () => {
  const L = () => local().leave;
  const G = () => general().leave;
  it('임용 2021-03-10: 2026년 17일, 3월 10일은 준비 중(국가 기준이면 그날부터 20일)', () => {
    expect(annualLeaveDays(L(), '2021-03-10', '2026-01-05')).toBe(17);
    expect(annualLeaveDays(L(), '2021-03-10', '2026-11-27')).toBe(17);
    expect(grantTimeline(L(), '2021-03-10', 2026)).toEqual([{ from: '2026-01-01', days: 17 }]);
    expect(pendingGrantChange(L(), '2021-03-10', 2026)).toBe('2026-03-10');
    const s = summarizeLeave(L(), '2021-03-10', emptyLeave(), '2026-01-05');
    expect(s.autoHours).toBe(17 * 8);
    expect(s.nextChange).toBeNull();
    expect(s.pendingChange).toEqual({ date: '2026-03-10' });
    // 같은 입력의 국가 일반직은 3/10 부터 20일
    const g = summarizeLeave(G(), '2021-03-10', emptyLeave(), '2026-01-05');
    expect(g.nextChange).toEqual({ date: '2026-03-10', hours: 20 * 8 });
    expect(g.pendingChange).toBeNull();
    expect(annualLeaveDays(G(), '2021-03-10', '2026-03-10')).toBe(20);
  });
  it('설계 검산의 다른 예: 2023-07-01 → 15일(7/1 준비 중), 2025-02-03 → 11일(2/3 준비 중), 2019-01-01 → 21일', () => {
    const cases: [string, number, string | null][] = [
      ['2023-07-01', 15, '2026-07-01'],
      ['2025-02-03', 11, '2026-02-03'],
      ['2019-01-01', 21, null],
      ['2020-01-01', 21, null],
    ];
    for (const [hire, days, pending] of cases) {
      expect(annualLeaveDays(L(), hire, '2026-12-31'), hire).toBe(days);
      expect(pendingGrantChange(L(), hire, 2026), hire).toBe(pending);
    }
  });
  it('임용한 해: 2026-03-09 → 4월 9일부터 9일(11일 × 10/12), 그 전에는 0, 바뀌는 날 없음', () => {
    expect(annualLeaveDays(L(), '2026-03-09', '2026-04-08')).toBe(0);
    expect(annualLeaveDays(L(), '2026-03-09', '2026-05-01')).toBe(9);
    expect(grantTimeline(L(), '2026-03-09', 2026)).toEqual([
      { from: '2026-01-01', days: 0 },
      { from: '2026-04-09', days: 9 },
    ]);
    expect(pendingGrantChange(L(), '2026-03-09', 2026)).toBeNull();
    // 4월 9일 전이면 그날 9일이 된다는 것은 숫자를 안다(첫 일수) — 다음 변화로 알린다
    const s = summarizeLeave(L(), '2026-03-09', emptyLeave(), '2026-03-20');
    expect(s.nextChange).toEqual({ date: '2026-04-09', hours: 72 });
    expect(s.pendingChange).toBeNull();
    expect(annualLeaveDays(L(), '2026-12-20', '2026-12-31')).toBe(0);
  });
  it('부여 일수를 직접 고치면 준비 중 알림도 없다(국가의 다음 변화와 같은 규칙)', () => {
    const leave = { ...emptyLeave(), grantOverrideHours: { '2026': 160 } };
    const s = summarizeLeave(L(), '2021-03-10', leave, '2026-01-05');
    expect(s).toMatchObject({ grantedHours: 160, overridden: true, pendingChange: null });
  });
  it('연가보상비 하루 61,146원(9급 1호봉, 국가와 같은 비율·같은 표)', () => {
    expect(compensationPerDay(L(), 2_133_000)).toBe(61_146);
    expect(compensationPerDay(L(), 2_133_000)).toBe(compensationPerDay(G(), 2_133_000));
  });
});

describe('지방 일반직: 반일 연가는 준비 중(하루 = 8시간은 원문)', () => {
  const rec = (date: string, kind: LeaveRecord['kind'], hours: number): LeaveRecord => ({
    id: `${date}-${kind}`,
    date,
    hours,
    kind,
    memo: '',
    pool: 'annual',
  });
  it('새 반일 기록은 받지 않고 시간 연가로 적게 한다. 하루·시간 연가는 그대로', () => {
    const u = local().leave;
    for (const kind of ['am', 'pm'] as const) {
      expect(checkNewLeave(u, cal, [], '2021-03-10', { date: '2026-11-26', kind, hours: 0 })).toBe(
        HALF_DAY_PENDING_MESSAGE,
      );
      expect(hoursOfKind(u, kind, 4)).toBe(0);
    }
    expect(HALF_DAY_PENDING_MESSAGE).toBe('반일 연가는 준비 중이에요. 시간 연가로 적어 주세요.');
    expect(
      checkNewLeave(u, cal, [], '2021-03-10', { date: '2026-11-26', kind: 'hours', hours: 4 }),
    ).toBeNull();
    expect(
      checkNewLeave(u, cal, [], '2021-03-10', { date: '2026-11-26', kind: 'day', hours: 0 }),
    ).toBeNull();
    expect(hoursOfKind(u, 'day', 0)).toBe(8);
    // 국가 일반직은 지금처럼 4시간
    const g = general().leave;
    expect(
      checkNewLeave(g, cal, [], '2021-03-10', { date: '2026-11-26', kind: 'am', hours: 0 }),
    ).toBeNull();
    expect(hoursOfKind(g, 'am', 0)).toBe(4);
  });
  it('직종을 바꾸기 전에 적은 반일 기록은 저장된 시간(4시간)으로 그대로 센다', () => {
    const leave = {
      ...emptyLeave(),
      records: [rec('2026-03-04', 'am', 4), rec('2026-03-05', 'day', 8)],
    };
    const s = summarizeLeave(local().leave, '2021-03-10', leave, '2026-11-27');
    expect(s.usedHours).toBe(12);
    expect(s.byMonth[2]).toBe(12);
  });
});

describe('근속승진 일정의 명부 이름은 규정 데이터의 원문 글자', () => {
  const person = (over: Partial<CareerProfile>): CareerProfile => ({
    track: 'general',
    payTable: 'table3',
    rank: '9',
    birthDate: '1995-05-20',
    hireDate: '2022-03-01',
    rankDate: '2022-03-01',
    step: 5,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-11-27',
    overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    ...over,
  });
  const detail = (p: CareerProfile) =>
    buildMilestones(rulesFor, p, '2026-11-27').find((m) => m.id.startsWith('long-service-'))
      ?.detail ?? '';
  it('국가 승진후보자명부 / 지방 승진후보자 명부 / 소방 명부(지금 문구 그대로)', () => {
    expect(detail(person({}))).toContain('(승진후보자명부 등재 등 요건 별도)');
    const lg = person({ track: 'localGeneral', payTable: null });
    expect(detail(lg)).toContain('(승진후보자 명부 등재 등 요건 별도)');
    expect(detail(person({ track: 'fire', payTable: null, rank: '소방사' }))).toContain(
      '(명부 등재 등 요건 별도)',
    );
    // 근속승진기간 5년 6개월, 기간 도달 전 심사 시작일은 보이지 않는다(지방 영에 조항이 없다)
    const info = longServiceInfo(
      resolveCareer(R, { track: 'localGeneral', payTable: null, rank: '9' }),
      lg,
    );
    expect(isAvailable(info) && info).toMatchObject({
      requiredMonths: 66,
      date: '2027-09-01',
      reviewFrom: null,
    });
  });
});

describe('연가 일수가 늘어나는 일정: 연초 재직기간 기준(year-start)은 늘어나는 날을 사실로 말하지 않는다', () => {
  const person = (over: Partial<CareerProfile>): CareerProfile => ({
    track: 'general',
    payTable: 'table3',
    rank: '8',
    birthDate: '1994-05-20',
    hireDate: '2021-03-10',
    rankDate: '2021-03-10',
    step: 6,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-11-27',
    overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    ...over,
  });
  const leaveOf = (p: CareerProfile) =>
    buildMilestones(rulesFor, p, '2026-11-27').filter(
      (m) => m.kind === 'leave' && /^leave-\d+$/.test(m.id),
    );
  const lg = person({ track: 'localGeneral', payTable: null });

  it('일반직은 그대로: 재직 6년이 되는 날, 20일에서 21일로 늘어나요', () => {
    const m = leaveOf(person({})).find((x) => x.id === 'leave-21');
    expect(m).toMatchObject({
      date: '2027-03-10',
      detail: '재직 6년. 한 해 연가가 20일에서 21일로 늘어나요.',
      badge: true,
    });
  });

  it("지방 일반직: 날짜는 그 구간이 되는 첫 1월 1일, '늘어나요' 없이 재직 N년이 되는 날은 준비 중", () => {
    const all = leaveOf(lg);
    expect(all.map((m) => [m.id, m.date])).toEqual([
      ['leave-15', '2023-01-01'],
      ['leave-16', '2025-01-01'],
      ['leave-17', '2026-01-01'],
      ['leave-20', '2027-01-01'],
      ['leave-21', '2028-01-01'],
    ]);
    for (const m of all) expect(m.detail).not.toContain('늘어나요');
    expect(all.find((m) => m.id === 'leave-21')?.detail).toBe(
      '재직 6년을 넘긴 첫 1월 1일. 연초 재직기간으로 세면 한 해 연가가 20일에서 21일이 돼요. 재직 6년이 되는 2027. 3. 10.부터 늘어나는지는 준비 중이에요.',
    );
    // 그날의 연가 화면 일수와 같다(연초 재직기간으로 센 일수)
    const c = local('8');
    for (const m of all)
      expect(annualLeaveDays(c.leave, lg.hireDate, m.date)).toBe(Number(m.id.slice(6)));
  });

  it('1월 1일에 임용했으면 재직 N년이 되는 날이 곧 1월 1일이다', () => {
    const jan = leaveOf(
      person({
        track: 'localGeneral',
        payTable: null,
        hireDate: '2021-01-01',
        rankDate: '2021-01-01',
      }),
    );
    expect(jan.find((m) => m.id === 'leave-15')).toMatchObject({
      date: '2022-01-01',
      detail: '재직 1년. 연초 재직기간으로 세면 한 해 연가가 11일에서 15일이 돼요.',
    });
    expect(annualLeaveDays(local('8').leave, '2021-01-01', '2022-01-01')).toBe(15);
  });
});
