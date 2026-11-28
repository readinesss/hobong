/**
 * 연가보상비 어림(#33 묶음 1) — 기대값은 설계 검산(proto/leave-bank.ts, 78개 확인)과 업무지침 예시 금액에서 왔다.
 * 금액은 일수까지 곱한 뒤 10원 미만을 버린다. 어떤 단가(원 단위 89,821원도, 1일분 89,820원도)를 곱하지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { rulesFor } from '../../src/lib/rules/index.ts';
import { resolveCareer } from '../../src/lib/rules/career.ts';
import { isAvailable, type TrackId } from '../../src/lib/rules/types.ts';
import {
  bonusLeaveHint,
  compensableDays,
  compensationAmount,
  compensationYear,
  leftoverDays,
  overCapUnsavedDays,
  prorateDays,
  savingsAvailableOn,
  savingsFrom,
  savingsLedger,
  yearEndSplit,
  type YearEndInput,
  type CompensationYearInput,
  type CompYear,
  type CompRetire,
} from '../../src/lib/calc/leave-bank.ts';
import { midConditionText } from '../../src/lib/app/leave-comp-copy.ts';
import type { PayProfile } from '../../src/lib/calc/salary.ts';
import type { LeaveData, LeaveRecord, SavingsEntry } from '../../src/lib/store/schema.ts';
import { summarizeLeave } from '../../src/lib/calc/leave.ts';

const R = rulesFor(2026);
const L = R.leave;
const career = (track: TrackId, rank: string | null) =>
  resolveCareer(R, { track, payTable: track === 'general' ? 'table3' : null, rank });

/** 업무지침 예시의 사람: 2026. 6. 30. 7급 10호봉 → 8. 1. 승급 → 12. 31. 7급 11호봉, 재직 6년 이상(21일) */
const person = (over: Partial<PayProfile> = {}): PayProfile => ({
  track: 'general',
  payTable: 'table3',
  rank: '7',
  hireDate: '2016-03-02',
  step: 10,
  nextStepDate: '2026-08-01',
  stepAsOf: '2026-01-01',
  ...over,
});

let seq = 0;
/** date 부터 근무일을 따지지 않고 하루씩 n일 기록(장부 계산은 요일을 보지 않는다) */
function days(from: string, n: number, pool: LeaveRecord['pool'] = 'annual'): LeaveRecord[] {
  const out: LeaveRecord[] = [];
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  for (let i = 0; i < n; i += 1) {
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    seq += 1;
    out.push({ id: `r${seq}`, date, hours: 8, kind: 'day', memo: '', pool });
  }
  return out;
}
const ledger = (records: LeaveRecord[], grant?: number): LeaveData => ({
  records,
  grantOverrideHours: grant === undefined ? {} : { '2026': grant * 8 },
  savings: [],
  years: {},
});
const run = (over: Partial<CompensationYearInput>) =>
  compensationYear({
    rules: rulesFor,
    profile: person(),
    leave: ledger([]),
    year: 2026,
    today: '2026-12-31',
    ...over,
  });
const asYear = (v: ReturnType<typeof run>): CompYear => {
  if (v?.kind !== 'year') throw new Error(`kind ${v?.kind}`);
  return v;
};
const asRetire = (v: ReturnType<typeof run>): CompRetire => {
  if (v?.kind !== 'retire') throw new Error(`kind ${v?.kind}`);
  return v;
};

describe('compensationAmount: 일수까지 곱한 뒤 10원 미만 버림(국고금 관리법 제47조제1항)', () => {
  it('업무지침 예시 금액 6개', () => {
    expect(compensationAmount(L, 3_133_300, 5)).toBe(449_100);
    expect(compensationAmount(L, 3_233_400, 6)).toBe(556_140);
    expect(compensationAmount(L, 3_233_400, 3)).toBe(278_070);
    expect(compensationAmount(L, 4_649_400, 5)).toBe(666_410);
    expect((compensationAmount(L, 3_233_400, 6) ?? 0) - 449_100).toBe(107_040);
    expect((compensationAmount(L, 3_233_400, 3) ?? 0) - 449_100).toBe(-171_030);
  });
  it('원 단위 단가 × 일수가 아니다(89,821 × 5 = 449,105)', () => {
    expect(Math.floor((3_133_300 * 860) / 30_000) * 5).toBe(449_105);
    expect(compensationAmount(L, 3_133_300, 5)).not.toBe(449_105);
  });
  it('1일분 지급액: 7급 10호봉 89,820 · 9급 1호봉 61,140 · 3,331,900원 95,510', () => {
    expect(compensationAmount(L, 3_133_300, 1)).toBe(89_820);
    expect(compensationAmount(L, R.salary.table['9'][0] as number, 1)).toBe(61_140);
    expect(compensationAmount(L, 3_331_900, 1)).toBe(95_510);
  });
  it('16일 1,437,140원(89,820 × 16 = 1,437,120 도, 89,821 × 16 = 1,437,136 도 아님)', () => {
    expect(compensationAmount(L, 3_133_300, 16)).toBe(1_437_140);
  });
  it('1~20일 모두: 1일분 × n 은 8~15일 10원, 16~20일 20원 모자란다(화면에 단가 × 일수를 두지 않는 까닭)', () => {
    const one = compensationAmount(L, 3_133_300, 1) as number;
    const gaps = Array.from(
      { length: 20 },
      (_, i) => (compensationAmount(L, 3_133_300, i + 1) as number) - one * (i + 1),
    );
    expect(gaps).toEqual([0, 0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10, 20, 20, 20, 20, 20]);
  });
  it('0일 이하는 0, 보상비가 없거나(교원) 준비 중인 직종은 null', () => {
    expect(compensationAmount(L, 3_133_300, 0)).toBe(0);
    expect(compensationAmount(career('teacher', '교원').leave, 3_000_000, 5)).toBeNull();
    expect(compensationAmount(career('otherSpecial', null).leave, 3_000_000, 5)).toBeNull();
    expect(compensationAmount(career('militaryCivil', null).leave, 3_000_000, 5)).toBeNull();
  });
  it('경찰·소방·지방 일반직은 국가와 같은 셈(같은 비율·같은 끝수)', () => {
    for (const [t, r] of [
      ['police', '경위'],
      ['fire', '소방위'],
      ['localGeneral', '7'],
    ] as const)
      expect(compensationAmount(career(t, r).leave, 3_133_300, 5), t).toBe(449_100);
  });
});

describe('compensableDays: 방법 ①, 20일 이내, 끝자리 시간은 보상하지 않음', () => {
  it('21 − 15 = 6, 남은 25일도 20, 4일 3시간은 4, 미리 써서 음수면 0', () => {
    expect(compensableDays(L.compensation, 168, 120, 8)).toBe(6);
    expect(compensableDays(L.compensation, 200, 0, 8)).toBe(20);
    expect(compensableDays(L.compensation, 120, 85, 8)).toBe(4);
    expect(compensableDays(L.compensation, 168, 200, 8)).toBe(0);
  });
});

describe('compensationYear: 6월 30일·12월 31일 기준(업무지침 예시)', () => {
  it('21일, 6월까지 10일·12월까지 15일 → 6월 5일분 449,100원, 12월 6일분 556,140원 − 449,100원 = 107,040원', () => {
    const c = asYear(run({ leave: ledger([...days('2026-03-02', 10), ...days('2026-09-01', 5)]) }));
    expect(c.mid).toMatchObject({ remainingHours: 88, eligible: true, days: 5, amount: 449_100 });
    expect(c.mid.salary?.amount).toBe(3_133_300);
    expect(c.end).toMatchObject({ maxDays: 6, chosenDays: 6, usedMax: true, total: 556_140 });
    expect(c.end.salary?.amount).toBe(3_233_400);
    expect(c.end).toMatchObject({ midPaid: 449_100, net: 107_040 });
    expect(c.end.overrideAboveAuto).toBe(false);
  });
  it('23일(직접 고침), 20일 사용 → 3일분 278,070원 − 449,100원 = 171,030원 환수', () => {
    const c = asYear(
      run({ leave: ledger([...days('2026-03-02', 10), ...days('2026-09-01', 10)], 23) }),
    );
    expect(c.end).toMatchObject({ maxDays: 3, total: 278_070, net: -171_030 });
    // 직접 고친 값(23일) > 자동 값(21일): 저축연가를 더해 두었을 수 있다는 띠
    expect(c.end.overrideAboveAuto).toBe(true);
  });
  it('보상 일수를 4로 고르면 370,760원 − 449,100원 = 78,340원 환수, 받지 않았어요면 6월분을 빼지 않는다', () => {
    const leave = ledger([...days('2026-03-02', 10), ...days('2026-09-01', 5)]);
    const four = asYear(run({ leave, plan: { compDays: 4 } }));
    expect(four.end).toMatchObject({ chosenDays: 4, usedMax: false, total: 370_760, net: -78_340 });
    const none = asYear(run({ leave, plan: { midYear: 'none' } }));
    expect(none.end).toMatchObject({ midPaid: 0, net: 556_140 });
    const paid = asYear(run({ leave, plan: { midYear: 'paid' } }));
    expect(paid.end.midPaid).toBe(449_100);
    // 고른 일수가 최대보다 크면 최대로 자른다
    expect(asYear(run({ leave, plan: { compDays: 15 } })).end).toMatchObject({
      chosenDays: 6,
      clamped: true,
    });
    // 기관 한도(묶음 2의 capDays)가 있으면 그 안에서
    expect(asYear(run({ leave, plan: { capDays: 4 } })).end.maxDays).toBe(4);
  });
  it('6월 30일 남은 정확히 80시간이면 5일분, 79시간이면 없음(받지 않았으니 12월에 빼지 않는다)', () => {
    const exact = asYear(run({ leave: ledger(days('2026-02-02', 11)) }));
    expect(exact.mid).toMatchObject({ remainingHours: 80, eligible: true, days: 5 });
    const short = ledger([
      ...days('2026-02-02', 11),
      { ...days('2026-03-02', 1)[0]!, hours: 1, kind: 'hours' },
    ]);
    const s = asYear(run({ leave: short }));
    expect(s.mid).toMatchObject({ remainingHours: 79, eligible: false, days: 0, amount: 0 });
    expect(s.end.midPaid).toBe(0);
    expect(midConditionText(s.mid, 8, '공무원수당 등에 관한 규정 제18조의5')).toBe(
      '그날 남은 연가 9일 7시간 · 10일 이상이어야 받을 수 있어요(공무원수당 등에 관한 규정 제18조의5).',
    );
  });
  it('6월 30일이 아직 오지 않았으면 예정 기록까지 넣어 판정한다(upcoming)', () => {
    const c = asYear(run({ today: '2026-03-10', leave: ledger(days('2026-05-04', 12)) }));
    expect(c.mid).toMatchObject({ upcoming: true, remainingHours: 72, eligible: false });
    expect(midConditionText(c.mid, 8, '근거')).toContain(
      '예정 기록을 넣은 대로라면 그날 남은 연가는 9일이에요',
    );
    // 7월 1일 뒤의 기록은 6월 30일 판정에 들어가지 않는다
    const later = asYear(run({ today: '2026-03-10', leave: ledger(days('2026-07-06', 12)) }));
    expect(later.mid.eligible).toBe(true);
  });
  it('저축연가에서 쓴 기록(pool saved)은 올해 연가 사용에서 뺀다', () => {
    const c = asYear(run({ leave: ledger(days('2026-03-02', 15, 'saved')) }));
    expect(c.end.maxDays).toBe(20);
  });
  it('2023-08-01 임용: 6월 30일 부여 15일, 12월 31일 부여 16일(재직기간이 연도 중 바뀐다)', () => {
    const c = asYear(run({ profile: person({ hireDate: '2023-08-01' }) }));
    expect(c.mid.grantedHours).toBe(15 * 8);
    expect(c.end.grantedHours).toBe(16 * 8);
  });
  it('직접 고친 부여가 자동 값과 같거나 작으면 띠가 없다. 그 값은 6월 30일에도 쓴다', () => {
    const c = asYear(run({ leave: ledger([], 21) }));
    expect(c.end.overrideAboveAuto).toBe(false);
    const small = asYear(run({ leave: ledger([], 12) }));
    expect(small.mid.grantedHours).toBe(96);
    expect(small.end.overrideAboveAuto).toBe(false);
  });
  it('남은 시간이 음수(미리 사용)면 보상 0일', () => {
    const c = asYear(run({ leave: ledger(days('2026-01-05', 25)) }));
    expect(c.end).toMatchObject({ remainingHours: -32, maxDays: 0, chosenDays: 0, total: 0 });
    expect(c.end.net).toBe(0); // 6월 30일에도 남은 연가가 없어 6월분도 없다
  });
  it('6월 30일 뒤 임용: 6월 30일 기준은 없다', () => {
    const c = asYear(run({ profile: person({ hireDate: '2026-08-03', step: 1 }) }));
    expect(c.mid).toMatchObject({ beforeHire: true, eligible: false, amount: 0 });
    expect(c.end.midPaid).toBe(0);
  });
});

describe('compensationYear: 정년퇴직하는 해(수당규정 제18조의5제2항·제4항)', () => {
  it('6월 30일 정년(6년 이상): 연가 11일, 보상은 10일까지, 퇴직일 전날(6/29) 봉급 — 5급 15호봉 1,332,820원', () => {
    const c = asRetire(
      run({
        profile: person({
          rank: '5',
          step: 15,
          nextStepDate: '2027-01-01',
          hireDate: '1995-03-02',
        }),
        retireDate: '2026-06-30',
        today: '2026-03-10',
      }),
    );
    expect(c).toMatchObject({
      grantedHours: 88,
      maxDays: 10,
      chosenDays: 10,
      salaryDate: '2026-06-29',
    });
    expect(c.salary?.amount).toBe(4_649_400);
    expect(c.total).toBe(1_332_820);
  });
  it('12월 31일 정년: 6월 줄은 있고(하반기 퇴직 — 상반기 예외대상일 수 있음), 12월 줄은 퇴직일 전날(12/30) 봉급', () => {
    const c = asYear(run({ retireDate: '2026-12-31', today: '2026-11-25' }));
    expect(c.end).toMatchObject({
      retiringSecondHalf: true,
      retireDate: '2026-12-31',
      salaryDate: '2026-12-30',
    });
    expect(c.end.salary?.amount).toBe(3_233_400);
    expect(c.mid.date).toBe('2026-06-30');
  });
  it('그 해 1월 1일 전에 퇴직했거나 그 해 뒤에 임용되면 null', () => {
    expect(run({ retireDate: '2025-12-31' })).toBeNull();
    expect(run({ profile: person({ hireDate: '2027-03-02' }) })).toBeNull();
  });
});

describe('compensationYear: 직종', () => {
  it('교원(해당 없음)·준비 중 직종은 null', () => {
    expect(run({ profile: person({ track: 'teacher', payTable: null, rank: '교원' }) })).toBeNull();
    expect(run({ profile: person({ track: 'foreign', payTable: null, rank: null }) })).toBeNull();
  });
  it('봉급을 계산하지 못하면(계급을 고르지 않음) 일수만 있고 금액은 없다', () => {
    const c = asYear(run({ profile: person({ track: 'police', payTable: null, rank: null }) }));
    expect(c.end.maxDays).toBe(20);
    expect(c.end.total).toBeNull();
    expect(c.end.net).toBeNull();
  });
  it('규정 데이터: 6월 30일 기준·퇴직 상한·끝수가 계산의 입력이다', () => {
    expect(L.compensation).toMatchObject({
      roundTo: 10,
      maxDays: 20,
      midYear: { month: 6, day: 30, minRemainingDays: 10, days: 5, optional: true },
      retire: { beforeJulyMaxDays: 10 },
    });
    const lg = career('localGeneral', '7').leave;
    expect(isAvailable(lg.compensation)).toBe(true);
  });
});

// ── 묶음 2: 저축연가 통장·연말 정리(기대값은 proto [3]·[4]·[7]·[8]·[9]) ──────────────
const SAVING = (() => {
  const v = L.saving;
  if (!isAvailable(v)) throw new Error('연가 저축이 꺼져 있다');
  return v;
})();
const H = 8;
const d = (n: number) => n * H;
const lot = (
  id: string,
  kind: SavingsEntry['kind'],
  year: number,
  hours: number,
  month: string | null = null,
): SavingsEntry => ({
  id,
  kind,
  year,
  month,
  hours,
  memo: '',
});
const use = (id: string, date: string, hours: number): LeaveRecord => ({
  id,
  date,
  hours,
  kind: hours === 8 ? 'day' : 'hours',
  memo: '',
  pool: 'saved',
});
/** proto [7]: 처음 잔액 3일(2024)·2025년 말 저축 5일 3시간·2026년 3월 시간외근무 저축 8시간 */
const DEPOSITS = [
  lot('o', 'opening', 2024, d(3)),
  lot('c25', 'carry', 2025, d(5) + 3),
  lot('ot', 'overtime', 2026, 8, '2026-03'),
];

describe('저축연가 통장: 먼저 저축한 것부터, 쓰기 시작하는 날(예규 (6)(가)·(10)(라))', () => {
  it('연말 저축·처음 잔액은 다음 해 1월 1일, 시간외근무 저축은 다음 달 1일(12월이면 다음 해 1월 1일)부터', () => {
    expect(savingsFrom(SAVING, lot('a', 'carry', 2025, 8))).toBe('2026-01-01');
    expect(savingsFrom(SAVING, lot('a', 'opening', 2024, 8))).toBe('2025-01-01');
    expect(savingsFrom(SAVING, lot('a', 'overtime', 2026, 8, '2026-03'))).toBe('2026-04-01');
    expect(savingsFrom(SAVING, lot('a', 'overtime', 2026, 8, '2026-12'))).toBe('2027-01-01');
  });
  it('proto [7]: 2/10 4일, 4/6 2일을 쓰면 묶음별 남은 시간 [0, 19, 8], 11/27 쓸 수 있는 것 3일 3시간', () => {
    const records = [use('u1', '2026-02-10', d(4)), use('u2', '2026-04-06', d(2))];
    const r = savingsLedger(SAVING, DEPOSITS, records, '2026-11-27');
    expect(r.lots.map((l) => [l.entry.id, l.leftHours])).toEqual([
      ['o', 0],
      ['c25', 19],
      ['ot', 8],
    ]);
    expect(r.availableHours).toBe(27);
    expect(r.pendingHours).toBe(0);
    expect(r.shortages).toEqual([]);
    expect(r.usedHours).toBe(d(6));
  });
  it('3/31 에는 쓸 수 있는 것 4일 3시간(3월 전환분은 4월 1일부터 1일 더), 4/1 에는 5일 3시간', () => {
    const records = [use('u1', '2026-02-10', d(4))];
    const m31 = savingsLedger(SAVING, DEPOSITS, records, '2026-03-31');
    expect(m31.availableHours).toBe(d(4) + 3);
    expect([m31.pendingHours, m31.nextFrom]).toEqual([8, '2026-04-01']);
    expect(savingsLedger(SAVING, DEPOSITS, records, '2026-04-01').availableHours).toBe(d(5) + 3);
  });
  it('3월 전환분은 3월 20일에 쓸 수 없다 → 9일 사용은 모자람(지우지 않고 알린다)', () => {
    const r = savingsLedger(SAVING, DEPOSITS, [use('u', '2026-03-20', d(9))], '2026-11-27');
    expect(r.shortages).toHaveLength(1);
    expect(r.shortages[0]).toMatchObject({ recordId: 'u', date: '2026-03-20' });
  });
  it('2026년 말 저축은 2026년에 쓸 수 없다', () => {
    const r = savingsLedger(
      SAVING,
      [lot('c26', 'carry', 2026, d(5))],
      [use('u', '2026-12-30', 8)],
      '2026-12-31',
    );
    expect(r.shortages).toHaveLength(1);
    expect(r.pendingHours).toBe(d(5));
    expect(r.nextFrom).toBe('2027-01-01');
  });
  it('예정 기록은 plannedHours 로 따로, 새 기록에 쓸 수 있는 양에서는 미리 뺀다', () => {
    const records = [use('u1', '2026-12-10', d(2))];
    const r = savingsLedger(SAVING, DEPOSITS, records, '2026-11-27');
    expect(r.plannedHours).toBe(d(2));
    expect(r.availableHours).toBe(d(9) + 3);
    expect(savingsAvailableOn(SAVING, DEPOSITS, records, '2026-11-27')).toBe(d(7) + 3);
  });
  it('쓰기 시작하는 날·순서를 원문으로 확인하지 못한 직종(지방 일반직)은 날짜로 막지 않고 합계만 본다', () => {
    const local = resolveCareer(R, { track: 'localGeneral', payTable: null, rank: '9' }).leave
      .saving;
    if (!isAvailable(local)) throw new Error('지방 일반직 저축이 꺼져 있다');
    const r = savingsLedger(
      local,
      [lot('c26', 'carry', 2026, d(2))],
      [use('u', '2026-03-02', 8)],
      '2026-11-27',
    );
    expect(r.datesKnown).toBe(false);
    expect(r.lots[0]?.from).toBeNull();
    expect(r.shortages).toEqual([]);
    expect(r.availableHours).toBe(8);
  });
});

describe('summarizeLeave: 저축연가 기록은 올해 연가에서 빼고 쉰 날(월별·오늘)에는 센다', () => {
  it('usedHours 는 올해 연가만, usedSavedHours·byMonth·todayHours 는 따로·둘 다', () => {
    const records = [
      ...days('2026-02-02', 2),
      use('s1', '2026-03-04', 8),
      use('s2', '2026-11-25', 4),
    ];
    const s = summarizeLeave(L, '2016-03-02', ledger(records), '2026-11-25');
    expect(s.usedHours).toBe(d(2));
    expect(s.usedSavedHours).toBe(12);
    expect(s.remainingHours).toBe(d(21) - d(2));
    expect(s.byMonth[2]).toBe(8);
    expect(s.todayHours).toBe(4);
    expect(s.lastUseDate).toBe('2026-11-25');
  });
});

const split = (over: Partial<YearEndInput>) =>
  yearEndSplit({
    grantedHours: d(21),
    usedAnnualHours: 0,
    hoursPerDay: H,
    unpaidDays: 0,
    capDays: null,
    maxDays: 20,
    retiringThisYear: false,
    autoCarryUnderDay: true,
    ...over,
  });

describe('연말 정리: 소멸·보상·저축 나누기(예규 (6)(가)·(9)(라), proto [4]·[9])', () => {
  it('미보상 권장 13, 20일 중 10일 사용 → 보상·저축 7, 소멸 3', () => {
    const r = split({ grantedHours: d(20), usedAnnualHours: d(10), unpaidDays: 13 });
    expect([r.poolDays, r.lapseUnpaidDays]).toEqual([7, 3]);
  });
  it('21 − 13 = 8, 촉진 포함 15 → 5, 12 → 8', () => {
    expect(split({ unpaidDays: 13 }).poolDays).toBe(8);
    expect(split({ grantedHours: d(20), usedAnnualHours: d(10), unpaidDays: 15 }).poolDays).toBe(5);
    expect(split({ grantedHours: d(20), usedAnnualHours: d(10), unpaidDays: 12 }).poolDays).toBe(8);
  });
  it('예규 사례 1·2·3: (8, 7)·(9, 6)·(6, 4) — 권장 연가 비례는 반올림(12 × 9/12 = 9, 10 × 9/12 = 7.5 → 8, 12 × 6/12 = 6)', () => {
    expect([
      prorateDays(23, 9),
      prorateDays(12, 9),
      prorateDays(10, 9),
      prorateDays(23, 6),
      prorateDays(12, 6),
    ]).toEqual([17, 9, 8, 12, 6]);
    const c1 = split({ grantedHours: d(17), usedAnnualHours: d(2), unpaidDays: 9 });
    const c2 = split({ grantedHours: d(17), usedAnnualHours: d(2), unpaidDays: 8 });
    const c3 = split({ grantedHours: d(12), usedAnnualHours: d(2), unpaidDays: 6 });
    expect([c1.poolDays, c1.lapseUnpaidDays]).toEqual([8, 7]);
    expect([c2.poolDays, c2.lapseUnpaidDays]).toEqual([9, 6]);
    expect([c3.poolDays, c3.lapseUnpaidDays]).toEqual([6, 4]);
  });
  it('끝자리: 15일 중 10일 5시간 사용 → 자동 저축 3시간·나눌 날 4일. 퇴직하는 해·모르는 직종은 0', () => {
    const r = split({ grantedHours: d(15), usedAnnualHours: d(10) + 5 });
    expect([r.autoSaveHours, r.poolDays]).toEqual([3, 4]);
    expect(
      split({ grantedHours: d(15), usedAnnualHours: d(10) + 5, retiringThisYear: true })
        .autoSaveHours,
    ).toBe(0);
    const unknown = split({
      grantedHours: d(15),
      usedAnnualHours: d(10) + 5,
      autoCarryUnderDay: null,
    });
    expect([unknown.autoSaveHours, unknown.autoSaveUnknown]).toEqual([0, true]);
  });
  it('기관 한도 15 → 보상 최대 15, 25를 넣어도 20, 미보상 모름은 표시', () => {
    expect(split({ capDays: 15 }).maxCompDays).toBe(15);
    expect(split({ capDays: 25 }).maxCompDays).toBe(20);
    expect(split({ unpaidDays: null, usedAnnualHours: d(5) }).unknownUnpaid).toBe(true);
  });
  it('남은 시간이 음수(미리 사용)면 나누지 않고 넘겨 쓴 시간만', () => {
    const r = split({ grantedHours: d(15), usedAnnualHours: d(17) });
    expect([r.poolDays, r.overUsedHours, r.autoSaveHours]).toEqual([0, d(2), 0]);
  });
  it('proto [9]: 미보상 권장 10, 21일 중 8일 사용 → 소멸 2·나눌 11. 보상 4·저축 2면 고르지 않은 날 0', () => {
    const t = split({ usedAnnualHours: d(8), unpaidDays: 10 });
    expect([t.lapseUnpaidDays, t.poolDays]).toEqual([2, 11]);
    const six = split({ usedAnnualHours: d(15) });
    expect(leftoverDays(six, 4, 2)).toBe(0);
    expect(leftoverDays(six, 4, 1)).toBe(1);
  });
});

describe('가산 힌트(예규 (2)(다) 사례 — 보상 한도 15일인 기관, proto [8])', () => {
  const pool = (n: number) => split({ usedAnnualHours: d(21 - n), capDays: 15 });
  it('미사용 16 · 보상 15 → 1(힌트)', () =>
    expect(overCapUnsavedDays(pool(16), 0, 15, 20)).toBe(1));
  it('미사용 15 · 보상 15 → 0(힌트 없음)', () =>
    expect(overCapUnsavedDays(pool(15), 0, 15, 20)).toBe(0));
  it('미사용 17 · 14일만 보상(남긴 3일 안 씀) → 2(힌트)', () =>
    expect(overCapUnsavedDays(pool(17), 0, 15, 20)).toBe(2));
  it('미사용 14 · 13일만 보상(남긴 1일 안 씀) → 0(보상받은 일수는 보지 않는다)', () =>
    expect(overCapUnsavedDays(pool(14), 0, 15, 20)).toBe(0));
  it('미사용 17 · 보상 15 · 남은 2일 모두 저축 → 0', () =>
    expect(overCapUnsavedDays(pool(17), 2, 15, 20)).toBe(0));
  it('한도 비움(20) · 미사용 21 → 1 / 한도 25 넣음 · 미사용 17 → 0(20으로 자름)', () => {
    expect(overCapUnsavedDays(split({}), 0, null, 20)).toBe(1);
    expect(overCapUnsavedDays(pool(17), 0, 25, 20)).toBe(0);
  });
  it('2026-03-02 임용한 해 감춤 / 2026-01-01 임용 보임 / 퇴직하는 해 감춤', () => {
    expect(bonusLeaveHint(2, 2026, '2026-03-02', false)).toBe(false);
    expect(bonusLeaveHint(2, 2026, '2026-01-01', false)).toBe(true);
    expect(bonusLeaveHint(2, 2026, '2010-03-02', true)).toBe(false);
    expect(bonusLeaveHint(0, 2026, '2010-03-02', false)).toBe(false);
  });
  it('규정 데이터: 국가는 판정 근거가 있고(제15조제3항제2호), 지방 일반직은 준비 중(null)', () => {
    expect(SAVING.uncompensatedBonus?.source).toMatchObject({
      law: 'service',
      article: '제15조제3항제2호',
    });
    const local = resolveCareer(R, { track: 'localGeneral', payTable: null, rank: '9' }).leave
      .saving;
    expect(isAvailable(local) ? local.uncompensatedBonus : 'off').toBeNull();
  });
});

describe('compensationYear: 저장된 정리 값(leave.years[Y])', () => {
  it('보상하지 않는 일수를 넣으면 보상 최대가 부여 − 그 일수로 줄어든다', () => {
    const c = asYear(run({ leave: ledger(days('2026-02-02', 8)), plan: { unpaidDays: 10 } }));
    expect(c.end.maxDays).toBe(11);
  });
  it('compDays > capDays 는 거부하지 않고 한도로 자른다(clamped)', () => {
    const c = asYear(
      run({ leave: ledger(days('2026-02-02', 5)), plan: { capDays: 10, compDays: 15 } }),
    );
    expect([c.end.maxDays, c.end.chosenDays, c.end.clamped]).toEqual([10, 10, true]);
  });
});

describe('검토 반영(#33): 저축연가 새 기록·연말 저축과 보상의 겹침·끝자리·하반기 퇴직', () => {
  it('뒤의 예정 기록이 다음 해부터 쓰는 연말 저축으로 채워질 수 있으면 그 몫은 오늘 쓸 수 있다', () => {
    const savings = [lot('a', 'opening', 2025, 16), lot('b', 'carry', 2026, 40)];
    const planned = [use('f1', '2027-02-01', 8)];
    // 2027-02 기록은 2026년 말 저축(2027-01-01부터)으로 채워진다 — 2026-12-01 에 16시간을 쓸 수 있다
    expect(savingsAvailableOn(SAVING, savings, planned, '2026-12-01')).toBe(16);
    const after = [...planned, use('n1', '2026-12-01', 8), use('n2', '2026-12-02', 8)];
    expect(savingsLedger(SAVING, savings, after, '2026-11-28').shortages).toEqual([]);
    // 그날 쓸 수 있는 칸만으로 채워야 하는 예정 기록은 그 몫을 남긴다
    expect(savingsAvailableOn(SAVING, savings, [use('f2', '2026-12-20', 8)], '2026-12-01')).toBe(8);
  });
  it('연말 정리에서 저축한 날(그 해 carry)은 12월 보상 상한에서 뺀다: 남은 10일 2시간 · 저축 6일 2시간 → 최대 4일', () => {
    const records = [...days('2026-02-02', 10), { ...days('2026-09-01', 1)[0]!, hours: 6 }];
    const leave = { ...ledger(records), savings: [lot('c', 'carry', 2026, d(6) + 2)] };
    const c = asYear(run({ leave }));
    expect([c.end.carryDays, c.end.maxDays, c.end.chosenDays]).toEqual([6, 4, 4]);
    // 연말 정리 대화상자는 저축을 다시 정하므로 빼지 않고 본다
    expect(asYear(run({ leave, excludeCarry: true })).end.maxDays).toBe(10);
  });
  it('보상하지 않는 일수를 다 쓰지 못했으면 끝자리는 저절로 저축하지 않는다(예규 (6)가 "나머지 연가일수 중")', () => {
    const base = {
      grantedHours: 160,
      hoursPerDay: 8,
      capDays: null,
      maxDays: 20,
      retiringThisYear: false,
      autoCarryUnderDay: true,
    };
    // 권장 13일 중 12일 3시간만 씀 → 나머지 7일은 통째로 남고, 5시간은 쓰지 못한 권장분이다
    expect(yearEndSplit({ ...base, usedAnnualHours: 12 * 8 + 3, unpaidDays: 13 })).toMatchObject({
      poolDays: 7,
      autoSaveHours: 0,
    });
    // 권장 13일을 넘겨 14일 3시간 썼으면 남은 5일 5시간의 5시간은 나머지 연가의 끝자리다
    expect(yearEndSplit({ ...base, usedAnnualHours: 14 * 8 + 3, unpaidDays: 13 })).toMatchObject({
      poolDays: 5,
      autoSaveHours: 5,
    });
  });
  it('업무지침 예시(8. 31. 명예퇴직, 5급 15호봉): 6월 30일은 21 − 7 = 14일로 5일분 666,410원, 퇴직 때 4일분 533,130원 → 133,280원 환수', () => {
    const c = asYear(
      run({
        profile: person({ rank: '5', step: 15, nextStepDate: '2027-01-01' }),
        leave: ledger([...days('2026-01-05', 7), ...days('2026-08-03', 3)]),
        retireDate: '2026-08-31',
        plan: { midYear: 'paid' },
      }),
    );
    expect([c.mid.eligible, c.mid.remainingHours, c.mid.amount]).toEqual([true, d(14), 666410]);
    expect([c.end.grantedHours, c.end.chosenDays, c.end.total, c.end.net]).toEqual([
      d(14),
      4,
      533130,
      -133280,
    ]);
  });
  it('가산 힌트: 그 해 1월 1일자 임용은 대상, 1월 2일 이후 임용은 아니다(예규 (2)(나))', () => {
    expect(bonusLeaveHint(1, 2026, '2026-01-01', false)).toBe(true);
    expect(bonusLeaveHint(1, 2026, '2026-01-02', false)).toBe(false);
  });
});
