/**
 * 올해 결산·1년 달력 계산 검증. 실제 규정 데이터(data/2026.json, data/2027.json)를 쓴다.
 */
import { describe, expect, it } from 'vitest';
import type { AchievementView } from '../achievements.ts';
import { rulesFor } from '../rules/index.ts';
import type { LeaveRecord, Profile } from '../store/schema.ts';
import { Calendar } from './calendar.ts';
import { addDays } from './date.ts';
import { dayLeaveKind } from './leave.ts';
import {
  monthSummaries,
  raisesBetween,
  recapLeaveText,
  recapStepText,
  yearGrid,
  yearRecap,
  type RecapInput,
} from './recap.ts';
import { maxStepOf, yearToDateSalary } from './salary.ts';
import { stepOn } from './step.ts';

const cal = new Calendar(rulesFor);
const MAX9 = maxStepOf(rulesFor(2026).salary.table['9']);

const profile: Profile = {
  nickname: '호봉이',
  birthDate: '1996-04-12',
  hireDate: '2022-09-01',
  track: 'general',
  series: null,
  seriesJikryu: null,
  payTable: 'table3',
  rank: '9',
  rankDate: '2022-09-01',
  step: 5,
  nextStepDate: '2027-01-01',
  stepAsOf: '2026-11-24',
  overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
  priorService: null,
};

let seq = 0;
function rec(date: string, kind: LeaveRecord['kind'], hours: number): LeaveRecord {
  seq += 1;
  return { id: `r${seq}`, date, kind, hours, memo: '' } as LeaveRecord;
}

function badge(id: string, at: string | null): AchievementView {
  return {
    id,
    title: id,
    desc: '',
    icon: 'icon-medal',
    tier: 'bronze',
    group: 'career',
    at,
    hint: null,
  };
}

function input(over: Partial<RecapInput> = {}): RecapInput {
  return {
    today: '2026-11-25',
    profile,
    retireDate: '2056-12-31',
    maxStep: MAX9,
    periodMonths: 12,
    cal,
    rules: rulesFor,
    records: [],
    hoursPerDay: 8,
    visits: [],
    badges: [],
    ...over,
  };
}

describe('dayLeaveKind: 하루 연가 모양(홈의 오늘 연가·업적 달력이 같은 표를 쓴다)', () => {
  const cases: [string, Pick<LeaveRecord, 'kind' | 'hours'>[], ReturnType<typeof dayLeaveKind>][] =
    [
      ['기록 없음', [], null],
      ['하루', [{ kind: 'day', hours: 8 }], 'full'],
      [
        '오전+오후 반일 합 8시간',
        [
          { kind: 'am', hours: 4 },
          { kind: 'pm', hours: 4 },
        ],
        'full',
      ],
      ['오전 반일 하나', [{ kind: 'am', hours: 4 }], 'am'],
      ['오후 반일 하나', [{ kind: 'pm', hours: 4 }], 'pm'],
      ['시간 연가 2시간', [{ kind: 'hours', hours: 2 }], 'hours'],
      [
        '오전 반일+2시간',
        [
          { kind: 'am', hours: 4 },
          { kind: 'hours', hours: 2 },
        ],
        'hours',
      ],
      ['8시간 시간 연가', [{ kind: 'hours', hours: 8 }], 'full'],
    ];
  for (const [name, records, expected] of cases) {
    it(name, () => expect(dayLeaveKind(records, 8)).toBe(expected));
  }
});

describe('yearRecap', () => {
  it('보통: 1월 1일부터 오늘까지, 근무일과 번 봉급이 지갑과 같다', () => {
    const r = yearRecap(input());
    expect(r.status).toBe('active');
    expect(r.year).toBe(2026);
    expect(r.from).toBe('2026-01-01');
    expect(r.to).toBe('2026-11-25');
    expect(r.hiredThisYear).toBe(false);
    expect(r.retiredThisYear).toBe(false);
    expect(r.workdays).toBe(cal.workdaysBetween('2026-01-01', '2026-11-26'));
    expect(r.workdays).toBeGreaterThan(200);
    expect(r.holidaysKnown).toBe(true);
    expect(r.earned).toBe(yearToDateSalary(rulesFor, profile, '2026-11-25'));
    expect(r.earned).toBeGreaterThan(0);
    expect(r.salaryTableYear).toBe(2026);
    // 다음 승급이 2027-01-01이라 2026-01-01에 4→5호봉
    expect(r.raises).toEqual([{ date: '2026-01-01', from: 4, to: 5 }]);
    expect(r.stepFrom).toBe(4);
    expect(r.stepTo).toBe(5);
    expect(recapStepText(r)).toBe('4→5호봉');
  });

  it('그 해 임용: 임용일부터 세고, 임용 전 날짜의 방문·연가는 세지 않는다', () => {
    const hired: Profile = {
      ...profile,
      hireDate: '2026-03-04',
      rankDate: '2026-03-04',
      step: 1,
      nextStepDate: '2027-03-01',
      stepAsOf: '2026-03-04',
    };
    const r = yearRecap(
      input({
        profile: hired,
        visits: ['2026-02-01', '2026-03-04', '2026-03-05'],
        records: [rec('2026-02-02', 'day', 8), rec('2026-03-05', 'am', 4)],
      }),
    );
    expect(r.from).toBe('2026-03-04');
    expect(r.hiredThisYear).toBe(true);
    expect(r.visits).toBe(2);
    expect(r.leave.usedHours).toBe(4);
    expect(r.leave.halfDays).toBe(1);
    expect(r.workdays).toBe(cal.workdaysBetween('2026-03-04', '2026-11-26'));
    expect(r.earned).toBe(yearToDateSalary(rulesFor, hired, '2026-11-25'));
    expect(r.raises).toEqual([]);
    expect(recapStepText(r)).toBeNull();
  });

  it('정년퇴직하는 해: 정년퇴직일까지만 센다', () => {
    const r = yearRecap(
      input({
        retireDate: '2026-06-30',
        visits: ['2026-06-30', '2026-07-01', '2026-11-25'],
        records: [rec('2026-06-29', 'day', 8), rec('2026-07-02', 'day', 8)],
      }),
    );
    expect(r.to).toBe('2026-06-30');
    // 결산을 낸 날은 오늘(카드의 기간 글은 이 달로 적어 정년퇴직일을 드러내지 않는다)
    expect(r.asOf).toBe('2026-11-25');
    expect(r.retiredThisYear).toBe(true);
    expect(r.workdays).toBe(cal.workdaysBetween('2026-01-01', '2026-07-01'));
    expect(r.visits).toBe(1);
    expect(r.leave.usedHours).toBe(8);
    expect(r.leave.plannedHours).toBe(0);
    expect(r.earned).toBe(yearToDateSalary(rulesFor, profile, '2026-06-30'));
    expect(r.earned).toBeLessThan(yearToDateSalary(rulesFor, profile, '2026-11-25') ?? 0);
  });

  it('지난해 정년퇴직: 결산이 없고 달력 칸은 모두 바깥이다', () => {
    const r = yearRecap(input({ retireDate: '2025-12-31', visits: ['2026-11-25'] }));
    expect(r.status).toBe('none');
    expect(r.earned).toBe(0);
    expect(r.workdays).toBe(0);
    expect(r.visits).toBe(0);
    expect(r.raises).toEqual([]);
    const grid = yearGrid(2026, input({ retireDate: '2025-12-31', visits: ['2026-11-25'] }));
    expect(grid.every((d) => d.outside)).toBe(true);
    expect(grid.some((d) => d.visited)).toBe(false);
  });

  it('승급 경계: 1월 1일·12월 31일·오늘 당일은 넣고, 내일은 뺀다', () => {
    const at = (nextStepDate: string, today = '2026-11-25') =>
      yearRecap(input({ today, profile: { ...profile, nextStepDate, stepAsOf: '2026-01-01' } }));
    expect(at('2027-01-01').raises.map((r) => r.date)).toEqual(['2026-01-01']);
    expect(at('2026-12-31', '2026-12-31').raises.map((r) => r.date)).toEqual(['2026-12-31']);
    expect(at('2026-11-25').raises.map((r) => r.date)).toEqual(['2026-11-25']);
    expect(at('2026-11-26').raises).toEqual([]);
    // 오늘이 승급일이면 어제의 호봉에서 오늘의 호봉으로(5호봉을 확인한 기준점이라 5→6)
    const today = at('2026-11-25');
    expect(today.stepFrom).toBe(5);
    expect(today.stepTo).toBe(6);
  });

  it('최고호봉이면 승급이 없다', () => {
    // 2025년부터 최고호봉에 머물러 있다(올해 1월 1일에도 오르지 않는다)
    const r = yearRecap(input({ profile: { ...profile, step: MAX9, stepAsOf: '2025-01-01' } }));
    expect(r.raises).toEqual([]);
    expect(r.stepFrom).toBe(MAX9);
    expect(r.stepTo).toBe(MAX9);
  });

  it('승급이 미뤄진 기준점(stepAsOf)에서도 호봉이 stepOn 과 같다', () => {
    // 휴직으로 다음 승급일이 1년보다 멀다: 2025-06-01에 확인한 5호봉이 2027-03-01 전날까지
    const stretched: Profile = { ...profile, nextStepDate: '2027-03-01', stepAsOf: '2025-06-01' };
    const r = yearRecap(input({ profile: stretched }));
    expect(r.raises).toEqual([]);
    expect(r.stepFrom).toBe(stepOn(stretched, '2026-01-01', MAX9));
    expect(r.stepTo).toBe(stepOn(stretched, '2026-11-25', MAX9));
    expect(r.stepTo).toBe(5);
  });

  it('연가 분류: 하루·반일·시간, 예정은 따로 센다', () => {
    const r = yearRecap(
      input({
        records: [
          rec('2025-12-30', 'day', 8),
          rec('2026-02-02', 'day', 8),
          rec('2026-03-03', 'am', 4),
          rec('2026-03-03', 'pm', 4),
          rec('2026-04-01', 'am', 4),
          rec('2026-05-06', 'hours', 2),
          rec('2026-12-01', 'day', 8),
        ],
      }),
    );
    expect(r.leave.usedHours).toBe(22);
    expect(r.leave.plannedHours).toBe(8);
    expect(r.leave.fullDays).toBe(2);
    expect(r.leave.halfDays).toBe(1);
    expect(r.leave.hourDays).toBe(1);
    expect(recapLeaveText(r)).toBe('2일 6시간');
  });

  it('배지는 올해 1월 1일부터 결산 끝날까지 얻은 것만', () => {
    const r = yearRecap(
      input({
        badges: [
          badge('old', '2025-12-31'),
          badge('jan', '2026-01-01'),
          badge('today', '2026-11-25'),
          badge('future', '2026-11-26'),
          badge('locked', null),
        ],
      }),
    );
    expect(r.badges.map((b) => b.id)).toEqual(['jan', 'today']);
  });

  it('방문은 같은 날을 한 번만 센다', () => {
    const r = yearRecap(
      input({ visits: ['2026-11-24', '2026-11-24', '2026-11-25', '2026-11-26'] }),
    );
    expect(r.visits).toBe(2);
  });

  it('공휴일 데이터가 없는 해(2028)는 주말만 뺀 근무일이라고 알린다', () => {
    const r = yearRecap(
      input({
        today: '2028-03-02',
        profile: { ...profile, nextStepDate: '2029-01-01', stepAsOf: '2028-01-01' },
      }),
    );
    expect(r.holidaysKnown).toBe(false);
    expect(r.workdays).toBe(cal.workdaysBetween('2028-01-01', '2028-03-03'));
    // 봉급표가 없는 해는 가장 가까운 이전 연도 표로 계산한다
    expect(r.salaryTableYear).toBeLessThan(2028);
  });
});

describe('yearGrid', () => {
  it('2026은 365칸, 윤년 2028은 2월 29일이 있는 366칸', () => {
    expect(yearGrid(2026, input())).toHaveLength(365);
    const leap = yearGrid(2028, input({ today: '2028-03-02' }));
    expect(leap).toHaveLength(366);
    expect(leap.some((d) => d.date === '2028-02-29')).toBe(true);
    expect(leap.filter((d) => d.holiday !== null)).toEqual([]);
  });

  it('방문·연가·공휴일·승급일·오늘을 칸마다 구분한다', () => {
    const grid = yearGrid(
      2026,
      input({
        visits: ['2026-11-24', '2026-11-25'],
        records: [
          rec('2026-11-20', 'day', 8),
          rec('2026-11-23', 'am', 4),
          rec('2026-11-24', 'pm', 4),
          rec('2026-11-30', 'hours', 2),
        ],
      }),
    );
    const day = (date: string) => grid.find((d) => d.date === date)!;
    expect(day('2026-11-20').leave).toBe('full');
    expect(day('2026-11-23').leave).toBe('am');
    expect(day('2026-11-24')).toMatchObject({ leave: 'pm', visited: true, planned: false });
    expect(day('2026-11-25')).toMatchObject({ today: true, visited: true, future: false });
    expect(day('2026-11-30')).toMatchObject({ leave: 'hours', hours: 2, planned: true });
    expect(day('2026-11-26').future).toBe(true);
    expect(day('2026-01-01').holiday).toBe('1월 1일');
    expect(day('2026-01-01').raise).toBe(true);
    expect(day('2026-01-03').weekend).toBe(true);
    expect(grid.filter((d) => d.raise)).toHaveLength(1);
  });

  it('임용 전·정년퇴직일 뒤는 바깥이고 방문·연가를 그리지 않는다', () => {
    const grid = yearGrid(
      2026,
      input({
        profile: { ...profile, hireDate: '2026-03-04' },
        retireDate: '2026-10-31',
        visits: ['2026-03-03', '2026-11-02'],
        records: [rec('2026-03-03', 'day', 8)],
      }),
    );
    const day = (date: string) => grid.find((d) => d.date === date)!;
    expect(day('2026-03-03')).toMatchObject({ outside: true, visited: false, leave: null });
    expect(day('2026-03-04').outside).toBe(false);
    expect(day('2026-10-31').outside).toBe(false);
    expect(day('2026-11-02')).toMatchObject({ outside: true, visited: false });
    // 앱 안 달력의 출근 도장은 재직 기간과 상관없이 연 날 그대로 남는다
    expect(day('2026-03-03').opened).toBe(true);
    expect(day('2026-11-02').opened).toBe(true);
    expect(day('2026-03-04').opened).toBe(false);
    expect(monthSummaries(grid, 8)[10]!.visits).toBe(1);
  });

  it('달마다 글로 보기 요약', () => {
    const grid = yearGrid(
      2026,
      input({
        visits: ['2026-11-24', '2026-11-25'],
        records: [rec('2026-11-20', 'day', 8), rec('2026-11-23', 'am', 4)],
      }),
    );
    const months = monthSummaries(grid, 8);
    expect(months).toHaveLength(12);
    const nov = months[10]!;
    expect(nov.visits).toBe(2);
    expect(nov.leaveText).toBe('연가 1일 4시간(20일, 23일 오전)');
    expect(months[0]!.raise).toBe('2026-01-01');
    expect(months[0]!.holidays).toContain('1월 1일');
    expect(months[1]!.leaveText).toBe('');
  });

  it('승급일을 하루씩 옮겨도 그 해 안에서만 잡힌다', () => {
    const list = raisesBetween(profile, '2026-01-02', '2026-12-31', MAX9, 12);
    expect(list).toEqual([]);
    expect(raisesBetween(profile, addDays('2026-01-01', 0), '2026-01-01', MAX9, 12)).toHaveLength(
      1,
    );
  });
});
