/**
 * 계산 로직 검증. 실제 규정 데이터(data/2026.json, data/2027.json)를 쓴다.
 * 기대값은 법령 원문(docs/sources/2026)을 손으로 따라 계산한 것이다.
 */
import { describe, expect, it } from 'vitest';
import { rulesFor } from '../rules/index.ts';
import { Calendar } from './calendar.ts';
import { careerProgress, retirementInfo } from './retirement.ts';
import {
  dateReachedStep,
  isRaiseDay,
  nextRaiseDate,
  prevRaiseDate,
  raiseIndexOn,
  stepOn,
  stretchPeriods,
} from './step.ts';
import {
  cumulativeSalary,
  maxStepOf,
  monthFraction,
  monthlySalary,
  nextStepRaise,
  salaryOn,
  yearToDateSalary,
  type PayProfile,
} from './salary.ts';
import {
  advanceLimitDays,
  annualLeaveDays,
  checkNewLeave,
  compensationPerDay,
  firstYearMonths,
  serviceMonthsInYear,
  formatLeaveHours,
  grantTimeline,
  summarizeLeave,
  workdaysInRange,
} from './leave.ts';
import {
  longServiceInfo,
  minServiceDate,
  promotedStep,
  promotionPreview,
  seniorAllowance,
  seniorTreatmentInfo,
} from './promotion.ts';
import {
  checkWorkHours,
  earnings,
  formatDuration,
  formatDurationKo,
  toSchedule,
  todayStatus,
  workMinutesPerDay,
  workedSecondsAt,
} from './today.ts';
import {
  diligenceBonus,
  diligencePeriodMonths,
  diligenceQualifies,
  diligenceRate,
  missingHolidayYearForBonuses,
  upcomingBonuses,
} from './bonus.ts';
import { floorRate } from './money.ts';
import {
  buildMilestones,
  longLeaveNotices,
  longLeaveWindow,
  pastMilestones,
  upcomingMilestones,
} from './milestones.ts';
import { findBridges } from './bridge.ts';
import type { LeaveData, LeaveRecord, Profile } from '../store/schema.ts';
import { careerOf } from './career-profile.ts';
import { resolveCareer } from '../rules/career.ts';
import { isAvailable, type Avail } from '../rules/types.ts';

/** 켜져 있어야 하는 계산 결과(꺼져 있으면 테스트 실패) */
function availableOf<T extends object>(value: Avail<T>): T {
  if (!isAvailable(value)) throw new Error(`꺼져 있음: ${value.status} ${value.reason}`);
  return value;
}

const R = rulesFor(2026);
const cal = new Calendar(rulesFor);

function profile(over: Partial<Profile> = {}): Profile {
  return {
    nickname: '호봉이',
    birthDate: '1995-05-20',
    hireDate: '2020-01-01',
    track: 'general',
    series: null,
    payTable: 'table3',
    rank: '9',
    rankDate: '2020-01-01',
    step: 7,
    nextStepDate: '2027-01-01',
    stepAsOf: '2026-11-25',
    overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    ...over,
  };
}

describe('정년 (국가공무원법 제74조)', () => {
  const cases: [string, string, string][] = [
    ['1966-06-30', '2026-06-30', '2026-06-30'],
    ['1966-07-01', '2026-07-01', '2026-12-31'],
    ['1967-01-01', '2027-01-01', '2027-06-30'],
    ['1966-12-31', '2026-12-31', '2026-12-31'],
    ['1968-02-29', '2028-02-29', '2028-06-30'],
    ['1990-03-15', '2050-03-15', '2050-06-30'],
    ['1985-09-09', '2045-09-09', '2045-12-31'],
  ];
  it.each(cases)('%s생 → 정년에 이른 날 %s, 퇴직 %s', (birth, reach, retire) => {
    expect(retirementInfo(R.retirement, birth)).toEqual({ reachDate: reach, retireDate: retire });
  });

  it('재직 일수와 남은 일수', () => {
    const p = careerProgress('2020-01-01', '2050-06-30', '2020-01-01');
    expect(p.daysServed).toBe(1);
    expect(p.ratio).toBe(0);
    const q = careerProgress('2020-01-01', '2050-06-30', '2026-11-25');
    expect(q.daysServed).toBe(2521);
    expect(q.daysLeft).toBe(8618);
    expect(q.totalDays).toBe(2521 + 8618);
    expect(q.ratio).toBeCloseTo(2520 / 11139, 10);
    expect(careerProgress('2020-01-01', '2050-06-30', '2050-06-30').daysLeft).toBe(0);
    const done = careerProgress('2020-01-01', '2050-06-30', '2050-07-01');
    expect(done.retired).toBe(true);
    expect(done.ratio).toBe(1);
  });

  it('하루 중 지난 만큼 소수점이 움직인다', () => {
    const a = careerProgress('2020-01-01', '2050-06-30', '2026-11-25', 0);
    const b = careerProgress('2020-01-01', '2050-06-30', '2026-11-25', 0.5);
    expect(b.ratio).toBeGreaterThan(a.ratio);
    expect(b.ratio - a.ratio).toBeCloseTo(0.5 / 11139, 12);
  });
});

describe('호봉 추이 (보수규정 제13조)', () => {
  const anchor = { step: 5, nextStepDate: '2027-03-01' };
  it('승급일을 지날 때마다 한 호봉씩 오른다', () => {
    expect(stepOn(anchor, '2026-11-25', 31)).toBe(5);
    expect(stepOn(anchor, '2027-02-28', 31)).toBe(5);
    expect(stepOn(anchor, '2027-03-01', 31)).toBe(6);
    expect(stepOn(anchor, '2028-02-29', 31)).toBe(6);
    expect(stepOn(anchor, '2028-03-01', 31)).toBe(7);
  });
  it('과거로 거슬러 올라가면 한 호봉씩 내려가고 1호봉에서 멈춘다', () => {
    expect(stepOn(anchor, '2026-03-01', 31)).toBe(5);
    expect(stepOn(anchor, '2026-02-28', 31)).toBe(4);
    expect(stepOn(anchor, '2023-03-01', 31)).toBe(2);
    expect(stepOn(anchor, '2022-03-01', 31)).toBe(1);
    expect(stepOn(anchor, '2010-01-01', 31)).toBe(1);
  });
  it('최고호봉을 넘지 않는다', () => {
    const top = { step: 30, nextStepDate: '2027-03-01' };
    expect(stepOn(top, '2027-03-01', 31)).toBe(31);
    expect(stepOn(top, '2035-03-01', 31)).toBe(31);
    expect(nextRaiseDate(top, '2026-11-25', 31)).toBe('2027-03-01');
    expect(nextRaiseDate(top, '2027-03-01', 31)).toBeNull();
  });
  it('다음·이전 승급일', () => {
    expect(nextRaiseDate(anchor, '2026-11-25', 31)).toBe('2027-03-01');
    expect(nextRaiseDate(anchor, '2027-03-01', 31)).toBe('2028-03-01');
    expect(prevRaiseDate(anchor, '2026-11-25')).toBe('2026-03-01');
    expect(raiseIndexOn(anchor, '2026-11-25')).toBe(-1);
    expect(raiseIndexOn(anchor, '2027-03-01')).toBe(0);
  });
  it('승급일 당일 판정', () => {
    expect(isRaiseDay(anchor, '2027-03-01', 31)).toBe(true);
    expect(isRaiseDay(anchor, '2027-03-02', 31)).toBe(false);
    expect(isRaiseDay(anchor, '2026-03-01', 31)).toBe(true);
    // 1호봉으로 내려가는 구간보다 앞은 실제 승급일이 아니다.
    expect(isRaiseDay(anchor, '2022-03-01', 31)).toBe(false);
    expect(isRaiseDay({ step: 31, nextStepDate: '2027-03-01' }, '2027-03-01', 31)).toBe(false);
  });

  describe('다음 승급일이 1년보다 멀 때(휴직·승급제한으로 미뤄진 경우)', () => {
    // 2026-11-25에 "지금 5호봉, 다음 승급 2027-12-01"이라고 넣었다.
    const late = { step: 5, nextStepDate: '2027-12-01', stepAsOf: '2026-11-25' };
    it('확인한 날부터 다음 승급일 전날까지 넣은 호봉 그대로다', () => {
      expect(stepOn(late, '2026-11-25', 31)).toBe(5);
      expect(stepOn(late, '2026-12-01', 31)).toBe(5);
      expect(stepOn(late, '2027-11-30', 31)).toBe(5);
      expect(stepOn(late, '2027-12-01', 31)).toBe(6);
      expect(stepOn(late, '2028-12-01', 31)).toBe(7);
      expect(nextRaiseDate(late, '2026-11-25', 31)).toBe('2027-12-01');
      expect(nextRaiseDate(late, '2027-12-01', 31)).toBe('2028-12-01');
    });
    it('지금 호봉이 시작된 날은 다음 승급일에서 한 해씩 거슬러 확인한 날 이전에 닿는 날로 본다', () => {
      expect(stretchPeriods(late)).toBe(1);
      expect(prevRaiseDate(late, '2026-11-25')).toBe('2025-12-01');
      expect(stepOn(late, '2025-12-01', 31)).toBe(5);
      expect(stepOn(late, '2025-11-30', 31)).toBe(4);
      expect(stepOn(late, '2024-11-30', 31)).toBe(3);
      expect(dateReachedStep(late, 5)).toBe('2025-12-01');
      expect(dateReachedStep(late, 6)).toBe('2027-12-01');
      expect(dateReachedStep(late, 4)).toBe('2024-12-01');
    });
    it('몇 해가 밀려도 같다', () => {
      const far = { step: 5, nextStepDate: '2029-01-01', stepAsOf: '2026-11-25' };
      expect(stretchPeriods(far)).toBe(2);
      expect(stepOn(far, '2026-11-25', 31)).toBe(5);
      expect(stepOn(far, '2028-12-31', 31)).toBe(5);
      expect(nextRaiseDate(far, '2026-11-25', 31)).toBe('2029-01-01');
      expect(prevRaiseDate(far, '2026-11-25')).toBe('2026-01-01');
      expect(stepOn(far, '2025-12-31', 31)).toBe(4);
    });
    it('1호봉도 다음 승급일에 2호봉이 된다', () => {
      const first = { step: 1, nextStepDate: '2028-04-01', stepAsOf: '2026-11-25' };
      expect(stepOn(first, '2026-11-25', 31)).toBe(1);
      expect(nextRaiseDate(first, '2026-11-25', 31)).toBe('2028-04-01');
      expect(isRaiseDay(first, '2028-04-01', 31)).toBe(true);
      expect(isRaiseDay(first, '2027-04-01', 31)).toBe(false);
    });
    it('다음 승급일이 1년 안이면 확인한 날이 있어도 예전과 같다', () => {
      const normal = { ...anchor, stepAsOf: '2026-11-25' };
      expect(stretchPeriods(normal)).toBe(0);
      for (const d of ['2022-03-01', '2026-02-28', '2026-03-01', '2026-11-25', '2027-03-01']) {
        expect(stepOn(normal, d, 31)).toBe(stepOn(anchor, d, 31));
      }
      // 확인한 날이 다음 승급일 이후(오래된 기준점)여도 늘어나지 않는다
      expect(stretchPeriods({ ...anchor, stepAsOf: '2028-01-01' })).toBe(0);
    });
    it('봉급·누적 봉급도 넣은 호봉을 따른다', () => {
      const p = profile({ step: 5, nextStepDate: '2027-12-01', stepAsOf: '2026-11-25' });
      expect(salaryOn(rulesFor, p, '2026-11-25')).toMatchObject({ step: 5, amount: 2_226_100 });
      const raise = nextStepRaise(rulesFor, p, '2026-11-25');
      expect(raise).toMatchObject({ date: '2027-12-01', fromStep: 5, toStep: 6 });
      // 무작위로 뒤져도 날짜가 뒤로 갈수록 호봉이 내려가지 않는다
      let prev = 0;
      for (let y = 2020; y <= 2030; y += 1) {
        for (const md of ['01-01', '06-30', '11-30', '12-01']) {
          const s = stepOn(p, `${y}-${md}`, 31);
          expect(s).toBeGreaterThanOrEqual(prev);
          prev = s;
        }
      }
    });
  });
});

describe('봉급 (보수규정 별표 3)', () => {
  it('봉급표 조회', () => {
    expect(monthlySalary(R.salary.table['9'], 1)).toBe(2_133_000);
    expect(monthlySalary(R.salary.table['9'], 31)).toBe(3_731_100);
    expect(monthlySalary(R.salary.table['7'], 12)).toBe(3_331_900);
    expect(monthlySalary(R.salary.table['6'], 32)).toBe(4_967_800);
    expect(monthlySalary(R.salary.table['1'], 23)).toBe(8_001_400);
    expect(maxStepOf(R.salary.table['9'])).toBe(31);
    expect(maxStepOf(R.salary.table['6'])).toBe(32);
    expect(maxStepOf(R.salary.table['1'])).toBe(23);
  });
  it('표 범위를 벗어난 호봉은 가장 가까운 값', () => {
    expect(monthlySalary(R.salary.table['9'], 0)).toBe(2_133_000);
    expect(monthlySalary(R.salary.table['9'], 99)).toBe(3_731_100);
  });

  const pay: PayProfile = {
    track: 'general',
    payTable: 'table3',
    rank: '9',
    hireDate: '2024-01-01',
    step: 3,
    nextStepDate: '2027-01-01',
  };
  it('날짜별 호봉과 봉급', () => {
    const now = salaryOn(rulesFor, pay, '2026-11-25');
    expect(now).toMatchObject({ step: 3, amount: 2_168_000, tableYear: 2026, confirmed: true });
    const next = salaryOn(rulesFor, pay, '2027-01-01');
    // 2027년 봉급표는 아직 없어 2026년 표로 계산하고 그 사실을 알린다.
    expect(next).toMatchObject({ step: 4, amount: 2_194_000, tableYear: 2026, confirmed: false });
  });
  it('다음 정기승급으로 오르는 봉급', () => {
    expect(nextStepRaise(rulesFor, pay, '2026-11-25')).toEqual({
      date: '2027-01-01',
      fromStep: 3,
      toStep: 4,
      fromAmount: 2_168_000,
      toAmount: 2_194_000,
      diff: 26_000,
      confirmed: false,
    });
    const top: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '1995-01-01',
      step: 31,
      nextStepDate: '2027-01-01',
    };
    expect(nextStepRaise(rulesFor, top, '2026-11-25')).toBeNull();
  });

  it('monthFraction: 달마다 그 달의 일수로 나눈다', () => {
    expect(monthFraction('2026-01-01', '2026-03-31')).toBe(3);
    expect(monthFraction('2026-03-16', '2026-03-31')).toBeCloseTo(16 / 31, 12);
    expect(monthFraction('2026-02-15', '2026-03-10')).toBeCloseTo(14 / 28 + 10 / 31, 12);
    expect(monthFraction('2026-03-10', '2026-03-09')).toBe(0);
  });
  it('지금까지 번 봉급(추정)', () => {
    const fresh: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2026-01-01',
      step: 1,
      nextStepDate: '2027-01-01',
    };
    expect(cumulativeSalary(rulesFor, fresh, '2026-03-31')?.total).toBe(3 * 2_133_000);
    const mid: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2026-03-16',
      step: 1,
      nextStepDate: '2027-03-01',
    };
    expect(cumulativeSalary(rulesFor, mid, '2026-03-31')?.total).toBe(
      Math.floor((2_133_000 * 16) / 31),
    );
    const raised: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2025-01-01',
      step: 2,
      nextStepDate: '2027-01-01',
    };
    // 2025년은 1호봉, 2026년은 2호봉(모두 2026년 봉급표로 환산)
    expect(cumulativeSalary(rulesFor, raised, '2026-02-28')?.total).toBe(
      12 * 2_133_000 + 2 * 2_147_600,
    );
    expect(yearToDateSalary(rulesFor, raised, '2026-02-28')).toBe(2 * 2_147_600);
    expect(cumulativeSalary(rulesFor, fresh, '2025-12-31')?.total).toBe(0);
  });
  it('올해 임용자의 올해 번 봉급은 임용일부터 센다', () => {
    const mid: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2026-03-16',
      step: 1,
      nextStepDate: '2027-03-01',
    };
    expect(yearToDateSalary(rulesFor, mid, '2026-04-30')).toBe(
      Math.floor((2_133_000 * 16) / 31 + 2_133_000),
    );
  });
});

describe('연가 (복무규정 제15조~제17조)', () => {
  const L = R.leave;
  it('예규 사례: 8월 1일 임용자', () => {
    expect(annualLeaveDays(L, '2018-08-01', '2018-08-31')).toBe(0);
    // 9월 1일자로 11일 × 5개월/12개월 = 4.58 → 5일
    expect(annualLeaveDays(L, '2018-08-01', '2018-09-01')).toBe(5);
    expect(annualLeaveDays(L, '2018-08-01', '2018-12-31')).toBe(5);
    // 해가 바뀌면 그 재직기간의 일수가 새로 생긴다
    expect(annualLeaveDays(L, '2018-08-01', '2019-01-01')).toBe(11);
    expect(annualLeaveDays(L, '2018-08-01', '2019-07-31')).toBe(11);
    // 재직 1년이 되는 8월 1일자로 늘어난다(현행 표: 1년 이상 3년 미만 15일)
    expect(annualLeaveDays(L, '2018-08-01', '2019-08-01')).toBe(15);
  });
  it('재직기간별 일수(현행 표)', () => {
    const hire = '2018-08-01';
    expect(annualLeaveDays(L, hire, '2021-07-31')).toBe(15);
    expect(annualLeaveDays(L, hire, '2021-08-01')).toBe(16);
    expect(annualLeaveDays(L, hire, '2022-08-01')).toBe(17);
    expect(annualLeaveDays(L, hire, '2023-08-01')).toBe(20);
    expect(annualLeaveDays(L, hire, '2024-07-31')).toBe(20);
    expect(annualLeaveDays(L, hire, '2024-08-01')).toBe(21);
    expect(annualLeaveDays(L, hire, '2040-01-01')).toBe(21);
  });
  it('1월 1일 임용자는 임용한 해에도 12개월을 채운다', () => {
    expect(annualLeaveDays(L, '2026-01-01', '2026-01-31')).toBe(0);
    expect(annualLeaveDays(L, '2026-01-01', '2026-02-01')).toBe(11);
    expect(annualLeaveDays(L, '2026-01-01', '2027-01-01')).toBe(15);
  });
  it('임용한 해의 근무 개월 수: 15일 이상은 1개월', () => {
    expect(firstYearMonths('2026-08-01', 15)).toBe(5);
    expect(firstYearMonths('2026-08-17', 15)).toBe(5);
    expect(firstYearMonths('2026-08-18', 15)).toBe(4);
    expect(firstYearMonths('2026-08-20', 15)).toBe(4);
    expect(firstYearMonths('2026-01-01', 15)).toBe(12);
    expect(firstYearMonths('2026-12-10', 15)).toBe(1);
    expect(firstYearMonths('2026-12-20', 15)).toBe(0);
    expect(annualLeaveDays(L, '2026-08-20', '2026-09-20')).toBe(4); // 11 × 4/12 = 3.67 → 4
    expect(annualLeaveDays(L, '2026-12-10', '2026-12-31')).toBe(0);
    expect(annualLeaveDays(L, '2026-12-10', '2027-01-10')).toBe(11);
  });
  it('임용일 전에는 0', () => {
    expect(annualLeaveDays(L, '2026-08-01', '2026-07-31')).toBe(0);
  });
  it('한 해 동안 일수가 바뀌는 시점', () => {
    expect(grantTimeline(L, '2018-08-01', 2019)).toEqual([
      { from: '2019-01-01', days: 11 },
      { from: '2019-08-01', days: 15 },
    ]);
    expect(grantTimeline(L, '2018-08-01', 2018)).toEqual([
      { from: '2018-01-01', days: 0 },
      { from: '2018-09-01', days: 5 },
    ]);
    expect(grantTimeline(L, '2010-03-02', 2026)).toEqual([{ from: '2026-01-01', days: 21 }]);
  });

  const rec = (date: string, hours: number, kind: LeaveRecord['kind'] = 'day'): LeaveRecord => ({
    id: `${date}-${kind}-${hours}`,
    date,
    hours,
    kind,
    memo: '',
  });
  it('장부 요약', () => {
    const leave: LeaveData = {
      records: [
        rec('2025-12-30', 8),
        rec('2026-03-03', 8),
        rec('2026-03-04', 4, 'am'),
        rec('2026-08-10', 2, 'hours'),
        rec('2026-11-25', 4, 'pm'),
        rec('2026-12-24', 8),
      ],
      grantOverrideHours: {},
    };
    const s = summarizeLeave(L, '2018-08-01', leave, '2026-11-25');
    expect(s.year).toBe(2026);
    expect(s.autoHours).toBe(21 * 8);
    expect(s.grantedHours).toBe(168);
    expect(s.overridden).toBe(false);
    expect(s.usedHours).toBe(26);
    expect(s.plannedHours).toBe(8);
    expect(s.remainingHours).toBe(142);
    expect(s.byMonth[2]).toBe(12);
    expect(s.byMonth[7]).toBe(2);
    expect(s.byMonth[10]).toBe(4);
    expect(s.byMonth[11]).toBe(8);
    expect(s.lastUseDate).toBe('2026-11-25');
    expect(s.daysSinceLastUse).toBe(0);
    expect(s.todayHours).toBe(4);
    expect(s.nextChange).toBeNull();
    expect(s.rate).toBeCloseTo(26 / 168, 12);
  });
  it('마지막 사용일부터 지난 일수를 센다(오늘 이후 예정은 빼고)', () => {
    const s = summarizeLeave(
      L,
      '2022-09-01',
      { records: [rec('2026-08-01', 8), rec('2026-12-01', 8)], grantOverrideHours: {} },
      '2026-11-25',
    );
    expect(s.lastUseDate).toBe('2026-08-01');
    expect(s.daysSinceLastUse).toBe(116);
  });
  it('직접 수정한 부여 시간이 우선한다', () => {
    const leave: LeaveData = { records: [], grantOverrideHours: { '2026': 184 } };
    const s = summarizeLeave(L, '2018-08-01', leave, '2026-11-25');
    expect(s.grantedHours).toBe(184);
    expect(s.overridden).toBe(true);
    expect(s.autoHours).toBe(168);
  });
  it('올해 안에 늘어나는 시점을 알려준다', () => {
    const s = summarizeLeave(
      L,
      '2025-12-01',
      { records: [], grantOverrideHours: {} },
      '2026-11-25',
    );
    expect(s.grantedHours).toBe(11 * 8);
    expect(s.nextChange).toEqual({ date: '2026-12-01', hours: 15 * 8 });
    // 기록이 한 건도 없으면 '못 쉬었다'고 보지 않는다(임용일부터 세지 않는다).
    expect(s.lastUseDate).toBeNull();
    expect(s.daysSinceLastUse).toBeNull();
  });

  it('시간 표기', () => {
    expect(formatLeaveHours(96)).toBe('12일');
    expect(formatLeaveHours(100)).toBe('12일 4시간');
    expect(formatLeaveHours(4)).toBe('4시간');
    expect(formatLeaveHours(0)).toBe('0일');
    expect(formatLeaveHours(-10)).toBe('-1일 2시간');
  });

  it('새 기록 검사', () => {
    const records = [rec('2026-11-24', 4, 'am')];
    const ok = (e: Parameters<typeof checkNewLeave>[4]) =>
      checkNewLeave(L, cal, records, '2020-01-01', e);
    expect(ok({ date: '2026-11-25', kind: 'day', hours: 0 })).toBeNull();
    expect(ok({ date: '2026-11-24', kind: 'pm', hours: 0 })).toBeNull();
    expect(ok({ date: '2026-11-24', kind: 'am', hours: 0 })).toContain('같은 종류');
    expect(ok({ date: '2026-11-24', kind: 'day', hours: 0 })).toContain('8시간을 넘길 수 없어요');
    expect(ok({ date: '2026-11-24', kind: 'hours', hours: 5 })).toContain('넘길 수 없어요');
    expect(ok({ date: '2026-11-24', kind: 'hours', hours: 4 })).toBeNull();
    expect(ok({ date: '2026-11-28', kind: 'day', hours: 0 })).toContain('토요일');
    expect(ok({ date: '2026-12-25', kind: 'day', hours: 0 })).toContain('기독탄신일');
    // 조사를 '은(는)'으로 뭉뚱그리지 않는다
    expect(ok({ date: '2026-12-25', kind: 'day', hours: 0 })).toBe(
      '이날은 공휴일(기독탄신일)이라 연가를 쓰지 않아도 되는 날이에요.',
    );
    expect(ok({ date: '2026-11-28', kind: 'day', hours: 0 })).toBe(
      '이날은 토요일이라 연가를 쓰지 않아도 되는 날이에요.',
    );
    expect(ok({ date: '2019-12-31', kind: 'day', hours: 0 })).toContain('임용일');
    expect(ok({ date: '2026-11-25', kind: 'hours', hours: 0 })).toContain('1시간부터');
    expect(ok({ date: '2026-11-25', kind: 'hours', hours: 9 })).toContain('1시간부터');
    expect(ok({ date: '2026-11-25', kind: 'hours', hours: 1.5 })).toContain('1시간부터');
  });
  it('여러 날 입력은 근무일만 고른다', () => {
    expect(workdaysInRange(cal, '2026-12-23', '2026-12-29')).toEqual([
      '2026-12-23',
      '2026-12-24',
      '2026-12-28',
      '2026-12-29',
    ]);
  });
  it('연가보상비 1일 단가와 미리 쓰기 한도', () => {
    expect(compensationPerDay(L, 2_133_000)).toBe(61_146);
    expect(compensationPerDay(L, 3_331_900)).toBe(95_514);
    expect(advanceLimitDays(L, '2026-03-01', '2026-11-25')).toBe(5);
    expect(advanceLimitDays(L, '2024-03-01', '2026-11-25')).toBe(7);
    expect(advanceLimitDays(L, '2015-03-01', '2026-11-25')).toBe(10);
  });
});

describe('승진 (임용령 제31조·제35조의4·제35조의5)', () => {
  const general = (rank: string) =>
    resolveCareer(R, { track: 'general', payTable: 'table3', rank });
  const lsOf = (p: Profile) => availableOf(longServiceInfo(careerOf(rulesFor, p, 2026), p));
  const stOf = (p: Profile) => availableOf(seniorTreatmentInfo(careerOf(rulesFor, p, 2026), p));
  it('승진소요최저연수', () => {
    expect(minServiceDate(general('9'), '2024-03-01')).toBe('2025-03-01');
    expect(minServiceDate(general('7'), '2024-03-01')).toBe('2025-03-01');
    expect(minServiceDate(general('6'), '2024-03-01')).toBe('2026-03-01');
    expect(minServiceDate(general('5'), '2024-03-01')).toBe('2027-03-01');
    expect(minServiceDate(general('3'), '2024-03-01')).toBeNull();
  });
  it('근속승진 기간: 9급 5년 6개월, 8급 7년, 7급 11년', () => {
    const nine = lsOf(profile({ rank: '9', rankDate: '2021-04-15' }));
    expect(nine).toMatchObject({
      applicable: true,
      targetRank: { key: '8', label: '8급' },
      requiredMonths: 66,
      autoDate: '2026-10-15',
      date: '2026-10-15',
      overridden: false,
      reviewFrom: '2026-10-10',
      quotaNote: null,
    });
    expect(lsOf(profile({ rank: '8', rankDate: '2020-01-01' })).date).toBe('2027-01-01');
    const seven = lsOf(profile({ rank: '7', rankDate: '2016-07-01' }));
    expect(seven.date).toBe('2027-07-01');
    expect(seven.quotaNote).toContain('50%');
    expect(lsOf(profile({ rank: '6' })).applicable).toBe(false);
  });
  it('직접 입력한 날짜가 우선한다', () => {
    const info = lsOf(
      profile({
        rank: '9',
        rankDate: '2021-04-15',
        overrides: { longServiceDate: '2027-04-15', seniorDate: null, rankLimitDate: null },
      }),
    );
    expect(info).toMatchObject({ autoDate: '2026-10-15', date: '2027-04-15', overridden: true });
  });
  it('대우공무원: 9~6급 4년, 5·4급 7년, 다음 달 1일 발령', () => {
    expect(stOf(profile({ rank: '9', rankDate: '2022-11-15' }))).toMatchObject({
      applicable: true,
      requiredMonths: 48,
      qualifyDate: '2026-11-15',
      autoDate: '2026-12-01',
      date: '2026-12-01',
    });
    expect(stOf(profile({ rank: '6', rankDate: '2022-12-01' })).date).toBe('2026-12-01');
    expect(stOf(profile({ rank: '5', rankDate: '2020-01-02' })).date).toBe('2027-02-01');
    expect(stOf(profile({ rank: '3' })).applicable).toBe(false);
  });
  it('승진 후 호봉(별표 28)과 봉급 미리보기', () => {
    expect(promotedStep(R.promotionStep, 1)).toBe(1);
    expect(promotedStep(R.promotionStep, 2)).toBe(1);
    expect(promotedStep(R.promotionStep, 12)).toBe(11);
    const pay: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2020-01-01',
      step: 6,
      nextStepDate: '2027-01-01',
    };
    expect(promotionPreview(rulesFor, pay, '2026-11-25')).toEqual({
      date: '2026-11-25',
      fromRank: { key: '9', label: '9급', payColumn: '9' },
      toRank: { key: '8', label: '8급', payColumn: '8' },
      fromStep: 6,
      toStep: 5,
      fromAmount: 2_264_600,
      toAmount: 2_331_700,
      diff: 67_100,
      confirmed: true,
    });
    expect(promotionPreview(rulesFor, { ...pay, rank: '1' }, '2026-11-25')).toBeNull();
  });
  it('대우공무원수당: 4.1%, 승진 시 봉급과의 차액을 넘지 않는다', () => {
    const pay: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2020-01-01',
      step: 6,
      nextStepDate: '2027-01-01',
    };
    // 2,264,600 × 4.1% = 92,848 이지만 8급 5호봉과의 차액 67,100원이 한도
    expect(seniorAllowance(rulesFor, pay, '2026-11-25')).toBe(67_100);
    const six: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '6',
      hireDate: '2005-01-01',
      step: 20,
      nextStepDate: '2027-01-01',
    };
    // 4,379,600 × 4.1% = 179,563 < 5급 19호봉과의 차액(5,006,300 - 4,379,600)
    expect(seniorAllowance(rulesFor, six, '2026-11-25')).toBe(179_563);
  });
});

describe('공휴일·근무일·지급일', () => {
  it('2026년 공휴일(노동절·제헌절 포함)', () => {
    expect(cal.holidayName('2026-12-25')).toBe('기독탄신일');
    expect(cal.isWorkday('2026-05-01')).toBe(false);
    expect(cal.isWorkday('2026-07-17')).toBe(false);
    expect(cal.isWorkday('2026-06-03')).toBe(false);
    expect(cal.isWorkday('2026-03-02')).toBe(false);
    expect(cal.isWorkday('2026-11-25')).toBe(true);
    expect(cal.isHoliday('2026-11-29')).toBe(true); // 일요일
    expect(cal.holidayName('2026-11-29')).toBeNull();
    expect(cal.isHoliday('2026-11-28')).toBe(false); // 토요일은 공휴일이 아니다
    expect(cal.isWorkday('2026-11-28')).toBe(false);
  });
  it('2027년 공휴일(대체공휴일)', () => {
    for (const d of [
      '2027-02-09',
      '2027-05-03',
      '2027-07-19',
      '2027-08-16',
      '2027-10-04',
      '2027-10-11',
      '2027-12-27',
    ]) {
      expect(cal.holidayName(d)).toContain('대체공휴일');
    }
    expect(cal.holidayTag('2027-02-07')).toBe('seollal');
    expect(cal.holidayTag('2027-09-15')).toBe('chuseok');
  });
  it('월별 근무일 수', () => {
    expect(cal.workdaysInMonth(2026, 11)).toBe(21);
    expect(cal.workdaysInMonth(2026, 12)).toBe(22);
    expect(cal.workdaysInMonth(2026, 2)).toBe(17); // 설 연휴 3일
    expect(cal.workdaysInMonth(2026, 5)).toBe(18); // 노동절, 어린이날, 대체공휴일
    expect(cal.workdaysBetween('2026-11-01', '2026-11-25')).toBe(17);
  });
  it('보수 지급일: 토요일·공휴일이면 그 전날', () => {
    expect(cal.payday(2026, 11, 25)).toBe('2026-11-25');
    expect(cal.payday(2026, 12, 25)).toBe('2026-12-24');
    expect(cal.payday(2026, 10, 25)).toBe('2026-10-23'); // 일요일 → 토요일 → 금요일
    expect(cal.payday(2026, 9, 25)).toBe('2026-09-23'); // 추석 연휴
    expect(cal.payday(2026, 6, 20)).toBe('2026-06-19'); // 토요일
    expect(cal.payday(2026, 2, 17)).toBe('2026-02-13'); // 설 연휴와 주말
    expect(cal.payday(2027, 2, 31)).toBe('2027-02-26'); // 그 달에 없는 날은 말일(일요일 → 금요일)
  });
  it('다음 지급일·다음 공휴일', () => {
    expect(cal.nextPayday('2026-11-25', 25)).toBe('2026-11-25');
    expect(cal.nextPayday('2026-11-26', 25)).toBe('2026-12-24');
    expect(cal.nextPayday('2026-12-25', 25)).toBe('2027-01-25');
    expect(cal.nextWeekdayHoliday('2026-11-25')).toEqual({
      date: '2026-12-25',
      name: '기독탄신일',
    });
    expect(cal.nextWeekdayHoliday('2026-12-26')).toEqual({ date: '2027-01-01', name: '1월 1일' });
    expect(cal.nextTaggedHoliday('2026-11-25', ['seollal', 'chuseok'])).toEqual({
      date: '2027-02-07',
      name: '설날',
      tag: 'seollal',
    });
  });
  it('공휴일 데이터가 없는 해는 주말만 쉬는 날로 보고, 다음 공휴일은 알 수 없다', () => {
    expect(cal.hasHolidayData(2028)).toBe(false);
    expect(cal.isWorkday('2028-03-01')).toBe(true);
    expect(cal.nextWeekdayHoliday('2027-12-28')).toBeNull();
  });
  it('이어지는 쉬는 날 수', () => {
    expect(cal.restRunFrom('2026-12-25')).toBe(3);
    expect(cal.restRunFrom('2026-11-25')).toBe(0);
    expect(cal.restRunFrom('2027-02-06')).toBe(4);
  });
});

describe('오늘의 근무와 번 돈', () => {
  const schedule = toSchedule(
    { start: '09:00', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' },
    R.workHours,
  );
  it('근무시간', () => {
    expect(workMinutesPerDay(schedule)).toBe(480);
    expect(workedSecondsAt(schedule, 8 * 3600)).toBe(0);
    expect(workedSecondsAt(schedule, 10 * 3600)).toBe(3600);
    expect(workedSecondsAt(schedule, 12.5 * 3600)).toBe(3 * 3600);
    expect(workedSecondsAt(schedule, 13 * 3600)).toBe(3 * 3600);
    expect(workedSecondsAt(schedule, 15 * 3600)).toBe(5 * 3600);
    expect(workedSecondsAt(schedule, 19 * 3600)).toBe(8 * 3600);
  });
  it('잘못된 설정은 규정의 기본 근무시간으로 대신한다', () => {
    const broken = toSchedule(
      { start: '18:00', end: '09:00', lunchStart: 'x', lunchEnd: '13:00' },
      R.workHours,
    );
    expect(broken).toEqual({ start: 540, end: 1080, lunchStart: 720, lunchEnd: 780 });
    expect(
      checkWorkHours({ start: '18:00', end: '09:00', lunchStart: '12:00', lunchEnd: '13:00' }),
    ).toContain('퇴근');
    expect(
      checkWorkHours({ start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '12:00' }),
    ).toContain('점심');
    expect(
      checkWorkHours({ start: '9시', end: '18:00', lunchStart: '12:00', lunchEnd: '13:00' }),
    ).toContain('형식');
    expect(
      checkWorkHours({ start: '12:00', end: '13:00', lunchStart: '12:00', lunchEnd: '13:00' }),
    ).toContain('0분');
    expect(
      checkWorkHours({ start: '08:00', end: '17:00', lunchStart: '11:30', lunchEnd: '12:30' }),
    ).toBeNull();
  });
  it('점심시간이 근무시간 밖이면 빼지 않는다', () => {
    const s = toSchedule(
      { start: '13:00', end: '17:00', lunchStart: '12:00', lunchEnd: '13:00' },
      R.workHours,
    );
    expect(workMinutesPerDay(s)).toBe(240);
  });
  it('하루의 단계', () => {
    const at = (h: number, m = 0) => todayStatus(cal, schedule, new Date(2026, 10, 25, h, m, 0));
    expect(at(8).phase).toBe('before');
    expect(at(8).secondsToStart).toBe(3600);
    expect(at(10).phase).toBe('working');
    expect(at(10).secondsToEnd).toBe(8 * 3600);
    expect(at(10).progress).toBeCloseTo(1 / 8, 12);
    expect(at(12, 30).phase).toBe('lunch');
    expect(at(17, 59).phase).toBe('working');
    expect(at(18).phase).toBe('after');
    expect(at(18).secondsToEnd).toBeNull();
    expect(at(18).progress).toBe(1);
    const sat = todayStatus(cal, schedule, new Date(2026, 10, 28, 10, 0, 0));
    expect(sat).toMatchObject({ phase: 'off', workday: false, weekend: true, progress: 0 });
    const xmas = todayStatus(cal, schedule, new Date(2026, 11, 25, 10, 0, 0));
    expect(xmas).toMatchObject({ phase: 'off', holidayName: '기독탄신일', weekend: false });
  });
  it('오늘·이번 달 번 돈', () => {
    const e = earnings(2_100_000, cal, schedule, new Date(2026, 10, 25, 13, 0, 0));
    expect(e.workdays).toBe(21);
    expect(e.workdaysDone).toBe(17);
    expect(e.perDay).toBeCloseTo(100_000, 6);
    expect(e.perSecond).toBeCloseTo(100_000 / 28_800, 9);
    expect(e.today).toBeCloseTo(37_500, 6);
    expect(e.month).toBeCloseTo(1_737_500, 6);
    const rest = earnings(2_100_000, cal, schedule, new Date(2026, 10, 28, 13, 0, 0));
    expect(rest.today).toBe(0);
    expect(rest.month).toBeCloseTo(2_000_000, 6);
    const first = earnings(2_100_000, cal, schedule, new Date(2026, 10, 1, 13, 0, 0));
    expect(first.workdaysDone).toBe(0);
    expect(first.month).toBe(0);
  });
  it('시간 표기', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(59)).toBe('0:00:59');
    expect(formatDuration(-5)).toBe('0:00:00');
    expect(formatDurationKo(3725)).toBe('1시간 2분');
    expect(formatDurationKo(600)).toBe('10분');
    expect(formatDurationKo(7200)).toBe('2시간');
    expect(formatDurationKo(30)).toBe('1분 미만');
  });
});

describe('보너스 (수당규정 제7조·별표 2, 제18조의3)', () => {
  const tiers = R.allowances.diligence.tiers;
  it('정근수당 지급률', () => {
    expect(diligenceRate(tiers, 0)).toBe(0.1);
    expect(diligenceRate(tiers, 1)).toBe(0.1);
    expect(diligenceRate(tiers, 2)).toBe(0.2);
    expect(diligenceRate(tiers, 4)).toBe(0.2);
    expect(diligenceRate(tiers, 5)).toBe(0.25);
    expect(diligenceRate(tiers, 6)).toBe(0.3);
    expect(diligenceRate(tiers, 7)).toBe(0.35);
    expect(diligenceRate(tiers, 8)).toBe(0.4);
    expect(diligenceRate(tiers, 9)).toBe(0.45);
    expect(diligenceRate(tiers, 10)).toBe(0.5);
    expect(diligenceRate(tiers, 30)).toBe(0.5);
  });
  it('지급대상기간 근무 개월 수', () => {
    const d = R.allowances.diligence;
    expect(diligencePeriodMonths(d, '2020-01-01', '2027-01-01')).toBe(6);
    expect(diligencePeriodMonths(d, '2026-07-01', '2027-01-01')).toBe(6);
    expect(diligencePeriodMonths(d, '2026-09-01', '2027-01-01')).toBe(4);
    expect(diligencePeriodMonths(d, '2026-09-17', '2027-01-01')).toBe(4); // 3개월 + 15일
    expect(diligencePeriodMonths(d, '2026-09-18', '2027-01-01')).toBe(3);
    expect(diligencePeriodMonths(d, '2026-12-20', '2027-01-01')).toBe(0);
    expect(diligencePeriodMonths(d, '2027-01-01', '2027-01-01')).toBe(0);
  });
  it('정근수당 금액과 지급일', () => {
    const pay: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2020-01-01',
      step: 7,
      nextStepDate: '2027-01-01',
    };
    const jan = diligenceBonus(rulesFor, cal, pay, 25, 2027, 1);
    // 2027-01-01 현재 8호봉(2026년 표 2,367,500), 근무연수 7년 → 35%
    expect(jan).toMatchObject({
      kind: 'diligence',
      date: '2027-01-25',
      rate: 0.35,
      years: 7,
      step: 8,
      baseSalary: 2_367_500,
      amount: Math.floor(2_367_500 * 0.35),
      proration: null,
      salaryConfirmed: false,
    });
    const jul = diligenceBonus(rulesFor, cal, pay, 25, 2027, 7);
    expect(jul?.date).toBe('2027-07-23'); // 25일이 일요일
    expect(diligenceBonus(rulesFor, cal, pay, 25, 2027, 3)).toBeNull();
  });
  it('신규 임용자는 근무한 개월 수만큼', () => {
    const pay: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2026-09-01',
      step: 1,
      nextStepDate: '2027-09-01',
    };
    const jan = diligenceBonus(rulesFor, cal, pay, 25, 2027, 1);
    expect(jan).toMatchObject({ rate: 0.1, years: 0, proration: { months: 4, of: 6 } });
    expect(jan?.amount).toBe(Math.floor((2_133_000 * 0.1 * 4) / 6));
    const late: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2026-12-20',
      step: 1,
      nextStepDate: '2027-12-01',
    };
    expect(diligenceBonus(rulesFor, cal, late, 25, 2027, 1)).toBeNull();
    expect(
      diligenceBonus(rulesFor, cal, { ...late, hireDate: '2027-02-01' }, 25, 2027, 1),
    ).toBeNull();
  });
  it('다가오는 보너스는 날짜순', () => {
    const pay: PayProfile = {
      track: 'general',
      payTable: 'table3',
      rank: '9',
      hireDate: '2020-01-01',
      step: 7,
      nextStepDate: '2027-01-01',
    };
    const list = upcomingBonuses(rulesFor, cal, pay, 25, '2026-11-25', 4);
    expect(list.map((e) => [e.kind, e.date])).toEqual([
      ['diligence', '2027-01-25'],
      ['holiday', '2027-02-07'],
      ['diligence', '2027-07-23'],
      ['holiday', '2027-09-15'],
    ]);
    expect(list[1]).toMatchObject({
      title: '명절휴가비(설날)',
      rate: 0.6,
      amount: Math.floor(2_367_500 * 0.6),
    });
  });
});

describe('일정(퀘스트 로그)', () => {
  const p = profile({
    hireDate: '2024-03-04',
    rankDate: '2024-03-04',
    birthDate: '1998-07-01',
    step: 3,
    nextStepDate: '2027-03-01',
  });
  const all = buildMilestones(rulesFor, p, '2026-11-25');
  const byId = new Map(all.map((m) => [m.id, m]));
  it('날짜순으로 정렬되고 임용일에서 시작해 정년퇴직일에서 끝난다', () => {
    const dates = all.map((m) => m.date);
    expect([...dates].sort()).toEqual(dates);
    expect(all[0]?.id).toBe('hire');
    expect(all[all.length - 1]?.id).toBe('retire');
    expect(byId.get('retire')?.date).toBe('2058-12-31');
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
  });
  it('규정에서 계산한 날짜들', () => {
    expect(byId.get('probation')?.date).toBe('2024-09-04');
    expect(byId.get('leave-15')?.date).toBe('2025-03-04');
    expect(byId.get('leave-16')?.date).toBe('2027-03-04');
    expect(byId.get('leave-21')?.date).toBe('2030-03-04');
    expect(byId.get('diligence-2')?.date).toBe('2026-03-04');
    expect(byId.get('diligence-10')?.title).toBe('정근수당 50%');
    expect(byId.get('long-leave-5')?.date).toBe('2029-03-04');
    expect(byId.get('min-service-9')?.date).toBe('2025-03-04');
    expect(byId.get('senior-9')?.date).toBe('2028-04-01');
    expect(byId.get('long-service-9')?.date).toBe('2029-09-04');
    expect(byId.get('anniv-1')?.date).toBe('2025-03-04');
    expect(byId.get('days-1000')?.date).toBe('2026-11-28');
    expect(byId.get('step-2027-03-01')?.title).toBe('정기승급 4호봉');
  });
  it('다가오는 일정과 지나간 일정', () => {
    const next = upcomingMilestones(all, '2026-11-25', 3).map((m) => m.id);
    expect(next).toEqual(['days-1000', 'step-2027-03-01', 'anniv-3']);
    const past = pastMilestones(all, '2026-11-25').map((m) => m.id);
    expect(past).toContain('hire');
    expect(past).toContain('probation');
    expect(past).not.toContain('days-1000');
  });
  it('5급 이상은 시보 해제 일정을 넣지 않는다', () => {
    const five = buildMilestones(rulesFor, profile({ rank: '5' }), '2026-11-25');
    expect(five.some((m) => m.id === 'probation')).toBe(false);
    expect(five.some((m) => m.id.startsWith('long-service-'))).toBe(false);
    expect(five.some((m) => m.id === 'senior-5')).toBe(true);
  });
});

describe('징검다리', () => {
  it('공휴일 옆 평일을 찾아준다', () => {
    const list = findBridges(cal, '2026-11-25', new Set());
    // 2027-05-04(화): 노동절 대체공휴일(5/3)과 어린이날(5/5) 사이
    const may4 = list.find((b) => b.leaveDates.join() === '2027-05-04');
    expect(may4).toMatchObject({
      from: '2027-05-01',
      to: '2027-05-05',
      totalDays: 5,
      alreadyTaken: false,
    });
    expect(may4?.holidayNames).toEqual(['대체공휴일(노동절)', '어린이날']);
    // 2027-05-06~07(목·금): 어린이날과 주말 사이
    const may6 = list.find((b) => b.leaveDates.join() === '2027-05-06,2027-05-07');
    expect(may6).toMatchObject({ from: '2027-05-05', to: '2027-05-09', totalDays: 5 });
    // 2027-05-14(금): 부처님 오신 날(목) 다음 날
    const may14 = list.find((b) => b.leaveDates.join() === '2027-05-14');
    expect(may14).toMatchObject({ from: '2027-05-13', to: '2027-05-16', totalDays: 4 });
    // 평범한 주말 사이는 제안하지 않는다
    expect(list.every((b) => b.holidayNames.length > 0)).toBe(true);
    expect(list.every((b) => b.leaveDates.length <= 2)).toBe(true);
  });
  it('이미 연가로 기록한 징검다리는 표시만 한다', () => {
    const list = findBridges(cal, '2026-11-25', new Set(['2027-05-04']));
    expect(list.find((b) => b.leaveDates.join() === '2027-05-04')?.alreadyTaken).toBe(true);
  });
  it('지난 날은 제안하지 않는다', () => {
    const list = findBridges(cal, '2027-05-04', new Set());
    expect(list.some((b) => b.leaveDates.includes('2027-05-04'))).toBe(false);
    expect(list.some((b) => b.leaveDates.join() === '2027-05-06,2027-05-07')).toBe(true);
  });
});

describe('검토에서 나온 경계 사례', () => {
  it('비율 계산은 부동소수점 오차 없이 원 미만만 버린다', () => {
    // 2,624,400 × 0.35 는 그대로 곱하면 918,539.999… 가 된다
    expect(2_624_400 * 0.35).not.toBe(918_540);
    expect(floorRate(2_624_400, 0.35)).toBe(918_540);
    expect(floorRate(2_720_300, 0.35)).toBe(952_105);
    expect(floorRate(2_682_600, 0.35, 6, 6)).toBe(938_910);
    expect(floorRate(3_514_500, 0.041)).toBe(144_094);
    expect(floorRate(2_226_100, 0.86, 1, 30)).toBe(63_814);
    // 봉급표의 모든 칸 × 정근수당 지급률 × 개월 수가 정수 계산과 같다
    for (const row of Object.values(R.salary.table)) {
      for (const amount of row) {
        for (const tier of R.allowances.diligence.tiers) {
          const pct = Math.round(tier.rate * 100);
          for (let months = 1; months <= 6; months += 1) {
            expect(floorRate(amount, tier.rate, months, 6)).toBe(
              Math.floor((amount * pct * months) / 600),
            );
          }
        }
      }
    }
  });

  it('정근수당: 근무연수 7년(35%)에서도 1원이 빠지지 않는다', () => {
    // 2019-03-01 임용 → 2027-01-01 현재 근무연수 7년
    const p = profile({ hireDate: '2019-03-01', rankDate: '2019-03-01', step: 10 });
    const bonus = diligenceBonus(rulesFor, cal, p, 25, 2027, 1);
    expect(bonus).toMatchObject({ rate: 0.35, years: 7, step: 11, baseSalary: 2_624_400 });
    expect(bonus?.amount).toBe(918_540);
  });

  it('정근수당 자격: 지급대상기간에 실제로 한 달은 채워야 한다', () => {
    const d = R.allowances.diligence;
    expect(diligenceQualifies(d, '2026-12-01', '2027-01-01')).toBe(true);
    expect(diligenceQualifies(d, '2026-12-02', '2027-01-01')).toBe(false);
    expect(diligenceQualifies(d, '2026-12-17', '2027-01-01')).toBe(false);
    expect(diligenceQualifies(d, '2026-07-01', '2027-01-01')).toBe(true);
    expect(diligenceQualifies(d, '2020-01-01', '2027-01-01')).toBe(true);
    expect(diligenceQualifies(d, '2027-01-01', '2027-01-01')).toBe(false);
    const late = profile({
      hireDate: '2026-12-05',
      rankDate: '2026-12-05',
      step: 1,
      nextStepDate: '2028-01-01',
      stepAsOf: '2026-12-05',
    });
    expect(diligenceBonus(rulesFor, cal, late, 25, 2027, 1)).toBeNull();
    const onTime = profile({
      hireDate: '2026-12-01',
      rankDate: '2026-12-01',
      step: 1,
      nextStepDate: '2027-12-01',
      stepAsOf: '2026-12-01',
    });
    expect(diligenceBonus(rulesFor, cal, onTime, 25, 2027, 1)).toMatchObject({
      rate: 0.1,
      proration: { months: 1, of: 6 },
      amount: Math.floor((2_133_000 * 10 * 1) / 600),
    });
  });

  it('정년퇴직일 뒤가 기준일인 보너스는 없다', () => {
    // 1966-11-30생 → 2026-12-31 정년퇴직
    const p = profile({ birthDate: '1966-11-30', hireDate: '1993-03-02', rankDate: '1993-03-02' });
    const retire = retirementInfo(R.retirement, p.birthDate).retireDate;
    expect(retire).toBe('2026-12-31');
    expect(upcomingBonuses(rulesFor, cal, p, 25, '2026-11-25', 3).length).toBeGreaterThan(0);
    expect(upcomingBonuses(rulesFor, cal, p, 25, '2026-11-25', 3, retire)).toEqual([]);
    // 6월 30일 퇴직자는 그 해 설 명절휴가비는 받고 7월 정근수당과 추석은 없다
    const june = upcomingBonuses(rulesFor, cal, p, 25, '2027-01-26', 5, '2027-06-30');
    expect(june.map((b) => b.title)).toEqual(['명절휴가비(설날)']);
  });

  it('정년퇴직하는 해의 연가는 근무하는 개월 수만큼만(복무규정 제17조제2항)', () => {
    const hire = '1992-03-02';
    expect(serviceMonthsInYear(hire, 2027, 15, '2027-06-30')).toBe(6);
    expect(serviceMonthsInYear(hire, 2027, 15, '2027-12-31')).toBe(12);
    expect(serviceMonthsInYear(hire, 2027, 15)).toBe(12);
    expect(annualLeaveDays(R.leave, hire, '2027-03-01')).toBe(21);
    // 21일 × 6/12 = 10.5 → 11일
    expect(annualLeaveDays(R.leave, hire, '2027-03-01', '2027-06-30')).toBe(11);
    expect(annualLeaveDays(R.leave, hire, '2027-03-01', '2027-12-31')).toBe(21);
    // 퇴직 전 해는 그대로, 퇴직 뒤에는 0
    expect(annualLeaveDays(R.leave, hire, '2026-03-01', '2027-06-30')).toBe(21);
    expect(annualLeaveDays(R.leave, hire, '2027-07-01', '2027-06-30')).toBe(0);
    // 임용한 해 계산은 그대로다
    expect(firstYearMonths('2026-08-01', 15)).toBe(5);
    expect(annualLeaveDays(R.leave, '2026-08-01', '2026-10-01')).toBe(
      annualLeaveDays(R.leave, '2026-08-01', '2026-10-01', '2060-12-31'),
    );
  });

  describe('장기재직휴가는 조항이 생긴 뒤, 그 구간에 있는 동안만', () => {
    const [short, mid, long] = R.leave.longService.tiers;
    if (!short || !mid || !long) throw new Error('장기재직휴가 구간이 없습니다');
    it('보통의 경우: 5년이 되는 날부터 10년이 되기 전날까지', () => {
      expect(longLeaveWindow(short, '2022-09-01')).toEqual({
        reached: '2027-09-01',
        from: '2027-09-01',
        until: '2032-08-31',
        graced: false,
      });
    });
    it('이미 5년을 넘긴 사람은 조항 시행일부터', () => {
      // 2026-06-23 당시 재직 7년 5개월(특례 대상 아님)
      expect(longLeaveWindow(short, '2019-01-01')).toEqual({
        reached: '2024-01-01',
        from: '2026-06-23',
        until: '2028-12-31',
        graced: false,
      });
    });
    it('부칙 특례: 시행 당시 8년 이상 10년 미만이면 2년 뒤까지', () => {
      // 2026-06-23 당시 재직 9년 9개월 → 10년(2026-09-01)을 넘겨도 2028-06-23까지
      expect(longLeaveWindow(short, '2016-09-01')).toEqual({
        reached: '2021-09-01',
        from: '2026-06-23',
        until: '2028-06-23',
        graced: true,
      });
      // 2025-07-22 당시 재직 18년 10개월 → 20년(2026-09-01)을 넘겨도 2027-07-22까지
      expect(longLeaveWindow(mid, '2006-09-01')).toEqual({
        reached: '2016-09-01',
        from: '2025-07-22',
        until: '2027-07-22',
        graced: true,
      });
    });
    it('조항이 생기기 전에 구간을 지나간 사람에게는 없던 휴가다', () => {
      expect(longLeaveWindow(short, '2006-09-01')).toBeNull();
      expect(longLeaveWindow(short, '1990-03-01')).toBeNull();
      expect(longLeaveWindow(mid, '1990-03-01')).toBeNull();
      expect(longLeaveWindow(long, '1990-03-01')).toEqual({
        reached: '2010-03-01',
        from: '2025-07-22',
        until: null,
        graced: false,
      });
    });
    it('일정과 배지에도 같은 날짜가 쓰인다', () => {
      const old = buildMilestones(
        rulesFor,
        profile({ birthDate: '1968-03-01', hireDate: '1990-03-01', rankDate: '1990-03-01' }),
        '2026-11-25',
      );
      const ids = old.filter((m) => m.id.startsWith('long-leave')).map((m) => [m.id, m.date]);
      expect(ids).toEqual([['long-leave-20', '2025-07-22']]);
      const graced = buildMilestones(
        rulesFor,
        profile({ birthDate: '1990-03-01', hireDate: '2016-09-01', rankDate: '2016-09-01' }),
        '2026-11-25',
      ).find((m) => m.id === 'long-leave-5');
      expect(graced?.date).toBe('2026-06-23');
      expect(graced?.detail).toContain('2028. 6. 23.');
      expect(graced?.detail).toContain('부칙 특례');
    });
  });

  describe('연가 장부의 장기재직휴가 안내: 지금 쓸 수 있거나 1년 안에 생기는 것만', () => {
    const tiers = R.leave.longService.tiers;
    const [short, mid, long] = tiers;
    if (!short || !mid || !long) throw new Error('장기재직휴가 구간이 없습니다');
    const FAR = '2058-12-31';
    const ids = (list: ReturnType<typeof longLeaveNotices>) =>
      list.map((n) => [n.fromYears, n.status, n.from, n.lastDay]);

    it('5년이 1년 안에 오면 곧 생긴다고 알린다', () => {
      expect(longLeaveNotices(tiers, '2022-09-01', '2026-11-25', FAR)).toEqual([
        {
          fromYears: short.fromYears,
          toYears: short.toYears,
          days: short.days,
          status: 'soon',
          from: '2027-09-01',
          lastDay: '2032-08-31',
          byRetirement: false,
          graced: false,
          startsAtEffective: false,
          effective: short.effective,
        },
      ]);
    });
    it('1년보다 멀면 알리지 않고, 그날이 되면 지금 쓸 수 있다', () => {
      expect(longLeaveNotices(tiers, '2022-09-01', '2026-08-31', FAR)).toEqual([]);
      // 딱 1년 뒤는 1년 안이다
      expect(ids(longLeaveNotices(tiers, '2022-09-01', '2026-09-01', FAR))).toEqual([
        [5, 'soon', '2027-09-01', '2032-08-31'],
      ]);
      expect(ids(longLeaveNotices(tiers, '2022-09-01', '2027-09-01', FAR))).toEqual([
        [5, 'open', '2027-09-01', '2032-08-31'],
      ]);
    });
    it('부칙 특례 구간과 다음 구간을 함께 쓸 수 있으면 둘 다, 시작일 순으로', () => {
      const list = longLeaveNotices(tiers, '2016-09-01', '2026-11-25', FAR);
      expect(ids(list)).toEqual([
        [5, 'open', '2026-06-23', '2028-06-23'],
        [10, 'open', '2026-09-01', '2036-08-31'],
      ]);
      expect(list.map((n) => [n.graced, n.startsAtEffective, n.days])).toEqual([
        [true, true, short.days],
        [false, false, mid.days],
      ]);
    });
    it('구간에 든 뒤 조항이 생겼으면 시행일부터 쓸 수 있다', () => {
      const [n] = longLeaveNotices(tiers, '2019-01-01', '2026-11-25', FAR);
      expect(n).toMatchObject({
        fromYears: 5,
        status: 'open',
        from: short.effective,
        lastDay: '2028-12-31',
        startsAtEffective: true,
        graced: false,
        byRetirement: false,
      });
    });
    it('상한 없는 구간은 정년퇴직일까지', () => {
      const retire = retirementInfo(R.retirement, '1968-03-01').retireDate;
      const list = longLeaveNotices(tiers, '1990-03-01', '2026-11-25', retire);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        fromYears: 20,
        toYears: null,
        days: long.days,
        status: 'open',
        from: long.effective,
        lastDay: retire,
        byRetirement: true,
        startsAtEffective: true,
      });
    });
    it('구간 상한보다 정년이 먼저면 정년퇴직일까지, 정년 뒤에는 없다', () => {
      const list = longLeaveNotices(tiers, '2016-09-01', '2026-11-25', '2027-03-31');
      expect(list.map((n) => [n.fromYears, n.lastDay, n.byRetirement, n.graced])).toEqual([
        [5, '2027-03-31', true, false],
        [10, '2027-03-31', true, false],
      ]);
      expect(longLeaveNotices(tiers, '2016-09-01', '2027-04-01', '2027-03-31')).toEqual([]);
      // 정년퇴직일 당일은 아직 쓸 수 있다
      expect(longLeaveNotices(tiers, '2016-09-01', '2027-03-31', '2027-03-31')).toHaveLength(2);
    });
    it('정년퇴직일보다 늦게 생기는 구간은 알리지 않는다', () => {
      // 5년이 되는 2027-09-01 전에 정년
      expect(longLeaveNotices(tiers, '2022-09-01', '2026-11-25', '2027-06-30')).toEqual([]);
    });
    it('아직 먼 사람에게는 아무것도 없다', () => {
      expect(longLeaveNotices(tiers, '2024-03-04', '2026-11-25', FAR)).toEqual([]);
    });
    it('마지막 날이 오늘이면 들어가고, 지나면 빠진다', () => {
      expect(
        longLeaveNotices(tiers, '2016-09-01', '2028-06-23', FAR).map((n) => n.fromYears),
      ).toEqual([5, 10]);
      expect(
        longLeaveNotices(tiers, '2016-09-01', '2028-06-24', FAR).map((n) => n.fromYears),
      ).toEqual([10]);
    });
  });

  it('다음 해 공휴일이 없으면 그 해의 지급일·명절휴가비는 확정이 아니다', () => {
    const p = profile();
    // 2028년 공휴일 데이터는 아직 없다
    expect(cal.hasHolidayData(2028)).toBe(false);
    expect(diligenceBonus(rulesFor, cal, p, 17, 2028, 7)?.holidaysKnown).toBe(false);
    expect(diligenceBonus(rulesFor, cal, p, 25, 2027, 1)?.holidaysKnown).toBe(true);
    expect(missingHolidayYearForBonuses(cal, '2026-11-25')).toBeNull();
    expect(missingHolidayYearForBonuses(cal, '2027-06-30')).toBeNull();
    expect(missingHolidayYearForBonuses(cal, '2027-07-01')).toBe(2028);
    expect(missingHolidayYearForBonuses(cal, '2028-03-01')).toBe(2028);
  });
});
