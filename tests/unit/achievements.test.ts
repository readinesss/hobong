import { describe, expect, it } from 'vitest';
import { rulesFor } from '../../src/lib/rules/index.ts';
import { Calendar } from '../../src/lib/calc/calendar.ts';
import { addDays } from '../../src/lib/calc/date.ts';
import { summarizeLeave } from '../../src/lib/calc/leave.ts';
import { buildMilestones } from '../../src/lib/calc/milestones.ts';
import { maxStepOf } from '../../src/lib/calc/salary.ts';
import { stepOn } from '../../src/lib/calc/step.ts';
import {
  achievementViews,
  evaluateAchievements,
  freshAchievements,
  fullDayLeaveDates,
  isStickyId,
  longRestEnd,
  type AchievementInput,
} from '../../src/lib/achievements.ts';
import {
  categoriesFor,
  hashString,
  lineFor,
  LINES,
  welcomeLine,
  type LineContext,
} from '../../src/lib/lines.ts';
import { defaultSettings, newUserData } from '../../src/lib/store/defaults.ts';
import type { LeaveRecord, UserData } from '../../src/lib/store/schema.ts';

const cal = new Calendar(rulesFor);
const R = rulesFor(2026);
const TODAY = '2026-11-25';

function makeData(): UserData {
  return newUserData(
    {
      nickname: '호봉이',
      birthDate: '1995-05-20',
      hireDate: '2020-01-01',
      grade: 9,
      gradeDate: '2020-01-01',
      step: 7,
      nextStepDate: '2027-01-01',
      stepAsOf: '2026-11-25',
      overrides: { longServiceDate: null, seniorDate: null },
    },
    { ...defaultSettings(R), payday: 25 },
    '2026-11-25T00:00:00.000Z',
    TODAY,
  );
}

function inputOf(data: UserData, today = TODAY): AchievementInput {
  return {
    today,
    data,
    milestones: buildMilestones(rulesFor, data.profile, today),
    currentStep: stepOn(data.profile, today, maxStepOf(R.salary, data.profile.grade)),
    anchor: data.profile,
    leave: summarizeLeave(R.leave, data.profile.hireDate, data.leave, today),
    cal,
  };
}

const rec = (date: string, hours = 8, kind: LeaveRecord['kind'] = 'day'): LeaveRecord => ({
  id: `${date}-${kind}`,
  date,
  hours,
  kind,
  memo: '',
});

describe('연속 휴식 계산', () => {
  it('정확히 닷새(금 연가 + 주말 + 월·화 연가)면 받는다: 배지 설명도 "이상"이다', () => {
    expect(
      longRestEnd(cal, [rec('2026-11-06'), rec('2026-11-09'), rec('2026-11-10')], 8, TODAY),
    ).toBe('2026-11-10');
    expect(longRestEnd(cal, [rec('2026-11-06'), rec('2026-11-09')], 8, TODAY)).toBeNull();
    const views = achievementViews(inputOf(makeData()), {});
    const desc = views.find((v) => v.id === 'long-rest')?.desc ?? '';
    expect(desc).toContain('닷새 이상');
    expect(desc).not.toContain('넘게');
  });
  it('연속 근무일 연가가 수천 건이어도 빠르게 끝난다', () => {
    const records: LeaveRecord[] = [];
    let d = '2000-01-03';
    while (records.length < 5000) {
      if (cal.isWorkday(d)) records.push(rec(d));
      d = addDays(d, 1);
    }
    const started = performance.now();
    expect(longRestEnd(cal, records, 8, '2026-11-25')).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(2000);
  });
  it('날짜 범위 끝의 연가에서도 예외가 나지 않는다', () => {
    expect(() =>
      longRestEnd(cal, [rec('1930-01-02'), rec('2150-12-30')], 8, '2026-11-25'),
    ).not.toThrow();
  });
});

describe('업적', () => {
  it('경력을 인정받아 높은 호봉에서 시작해도 배지 날짜가 임용일보다 앞서지 않는다', () => {
    const data = makeData();
    // 2026-03-02 임용인데 7호봉에서 시작했다: 5호봉이 된 날을 거슬러 계산하면 2024년이 된다
    data.profile = {
      ...data.profile,
      hireDate: '2026-03-02',
      gradeDate: '2026-03-02',
      step: 7,
      nextStepDate: '2027-03-01',
      stepAsOf: TODAY,
    };
    const earned = evaluateAchievements(inputOf(data));
    expect(earned['step-5']).toEqual({ at: '2026-03-02' });
  });
  it('장기재직휴가 배지의 이름은 규정 데이터의 일수에서 온다', () => {
    const data = makeData();
    data.profile = { ...data.profile, hireDate: '2016-09-01', gradeDate: '2016-09-01' };
    const views = achievementViews(inputOf(data), evaluateAchievements(inputOf(data)));
    const days = R.leave.longService.tiers[0]?.days;
    expect(views.find((v) => v.id === 'long-leave-5')?.title).toBe(`장기재직휴가 ${days}일`);
  });
  it('입력하자마자 지나간 일정이 배지가 된다', () => {
    const earned = evaluateAchievements(inputOf(makeData()));
    expect(earned.hire).toEqual({ at: '2020-01-01' });
    expect(earned.probation).toEqual({ at: '2020-07-01' });
    expect(earned['anniv-5']).toEqual({ at: '2025-01-01' });
    expect(earned['days-1000']).toEqual({ at: '2022-09-26' });
    expect(earned['anniv-10']).toBeUndefined();
    // 2020-01-01 임용, 7호봉 → 7호봉이 2026-01-01부터이므로 5호봉이 된 날은 2024-01-01(승급일을 거슬러 계산)
    expect(earned['step-5']).toEqual({ at: '2024-01-01' });
    expect(earned['step-10']).toBeUndefined();
    // 오늘(11월 25일)은 25일 지급 기관의 월급날
    expect(earned['evt-payday']).toEqual({ at: TODAY });
    expect(earned['leave-first']).toBeUndefined();
  });

  it('연가 업적: 첫 연가, 절반, 완주', () => {
    const data = makeData();
    data.leave.grantOverrideHours = { '2026': 32 };
    data.leave.records = [rec('2026-03-03'), rec('2026-03-04'), rec('2026-12-24')];
    const half = evaluateAchievements(inputOf(data));
    expect(half['leave-first']).toEqual({ at: '2026-03-03' });
    expect(half['leave-half-2026']).toEqual({ at: TODAY });
    expect(half['leave-full-2026']).toBeUndefined(); // 예정(12/24)은 아직 쓴 게 아니다
    data.leave.records.push(rec('2026-11-24'), rec('2026-11-25'));
    expect(evaluateAchievements(inputOf(data))['leave-full-2026']).toEqual({ at: TODAY });
  });

  it('한 번 얻은 업적은 조건이 사라져도 남고, 다시 계산하는 업적은 입력값을 따른다', () => {
    const data = makeData();
    data.achievements = {
      'leave-half-2025': { at: '2025-08-01' },
      'evt-card': { at: '2026-05-05' },
      'anniv-30': { at: '2050-01-01' },
    };
    const earned = evaluateAchievements(inputOf(data));
    expect(earned['leave-half-2025']).toEqual({ at: '2025-08-01' });
    expect(earned['evt-card']).toEqual({ at: '2026-05-05' });
    expect(earned['anniv-30']).toBeUndefined();
    expect(isStickyId('evt-night')).toBe(true);
    expect(isStickyId('visit-7')).toBe(true);
    expect(isStickyId('anniv-5')).toBe(false);
    expect(isStickyId('step-5')).toBe(false);
  });

  it('출근 도장과 백업', () => {
    const data = makeData();
    data.visits.days = [
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ];
    data.meta.lastBackupAt = '2026-11-20T03:00:00.000Z';
    const earned = evaluateAchievements(inputOf(data));
    expect(earned['visit-7']).toEqual({ at: '2026-11-25' });
    expect(earned['visit-30']).toBeUndefined();
    expect(earned['evt-backup']?.at).toMatch(/^2026-11-(19|20)$/);
  });

  it('새로 얻은 업적만 골라낸다', () => {
    const data = makeData();
    const earned = evaluateAchievements(inputOf(data));
    const fresh = freshAchievements(data.achievements, earned);
    expect(fresh).toContain('hire');
    data.achievements = earned;
    expect(freshAchievements(data.achievements, evaluateAchievements(inputOf(data)))).toEqual([]);
  });

  it('연가를 붙여 길게 쉰 날', () => {
    // 2026-12-24(목) 연가 + 12/25(금, 기독탄신일) + 주말 = 4일 → 12/28(월)도 쉬면 5일
    expect(longRestEnd(cal, [rec('2026-12-24')], 8, '2027-01-10')).toBeNull();
    expect(longRestEnd(cal, [rec('2026-12-24'), rec('2026-12-28')], 8, '2027-01-10')).toBe(
      '2026-12-28',
    );
    // 아직 끝나지 않은 휴식은 세지 않는다
    expect(longRestEnd(cal, [rec('2026-12-24'), rec('2026-12-28')], 8, '2026-12-26')).toBeNull();
    // 반일은 하루를 쉰 것이 아니다
    expect(
      longRestEnd(cal, [rec('2026-12-24'), rec('2026-12-28', 4, 'am')], 8, '2027-01-10'),
    ).toBeNull();
    expect([
      ...fullDayLeaveDates([rec('2026-03-03', 4, 'am'), rec('2026-03-03', 4, 'pm')], 8),
    ]).toEqual(['2026-03-03']);
  });

  it('화면 목록: 얻은 것이 먼저, 아직인 것은 조건과 함께', () => {
    const data = makeData();
    const input = inputOf(data);
    const earned = evaluateAchievements(input);
    const views = achievementViews(input, earned);
    const firstLocked = views.findIndex((v) => v.at === null);
    expect(firstLocked).toBeGreaterThan(0);
    expect(views.slice(0, firstLocked).every((v) => v.at !== null)).toBe(true);
    expect(views.slice(firstLocked).every((v) => v.at === null && v.hint !== null)).toBe(true);
    const ids = views.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(views.find((v) => v.id === 'anniv-10')).toMatchObject({
      title: '강산이 변했다',
      hint: '2030. 1. 1. 예정',
    });
    expect(views.find((v) => v.id === 'hire')).toMatchObject({
      title: '첫 출근',
      at: '2020-01-01',
      hint: null,
    });
    for (const v of views) {
      expect(v.title.length).toBeGreaterThan(0);
      expect(v.icon).toMatch(/^icon-/);
    }
  });
});

describe('호봉이의 한마디', () => {
  const base: LineContext = {
    today: '2026-11-25',
    nickname: '김주무관',
    mood: 'work',
    phase: 'working',
    hour: 10,
    isPayday: false,
    holidayTomorrow: false,
    stepDay: false,
    daysToStep: 200,
    anniversaryYears: null,
  };
  it('같은 조건이면 같은 문장', () => {
    expect(lineFor(base)).toBe(lineFor({ ...base }));
    expect(hashString('a')).toBe(hashString('a'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
  it('자리표시자가 남지 않는다', () => {
    const days = [
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-12-01',
      '2027-01-04',
      '2027-07-01',
      '2026-10-01',
    ];
    for (const today of days) {
      for (const hour of [8, 10, 15]) {
        for (const daysToStep of [null, 5, 200]) {
          const line = lineFor({
            ...base,
            today,
            hour,
            daysToStep,
            phase: hour < 9 ? 'before' : 'working',
          });
          expect(line).not.toMatch(/[{}]/);
          expect(line.length).toBeGreaterThan(0);
        }
      }
    }
    expect(lineFor({ ...base, anniversaryYears: 7 })).toContain('7');
    expect(welcomeLine('호봉이')).toBe('반가워요, 호봉이님! 호봉이가 깨어났어요.');
  });
  it('상황별 묶음', () => {
    expect(categoriesFor({ ...base, stepDay: true }).categories).toEqual(['stepDay']);
    expect(categoriesFor({ ...base, mood: 'vacation' }).categories).toEqual(['vacation']);
    expect(categoriesFor({ ...base, phase: 'off' }).categories).toEqual(['restDay']);
    expect(categoriesFor({ ...base, isPayday: true }).categories).toEqual(['payday']);
    expect(categoriesFor({ ...base, mood: 'tired' }).categories).toEqual(['tired', 'default']);
    expect(categoriesFor({ ...base, phase: 'after', hour: 19 }).categories).toEqual(['afterWork']);
    expect(categoriesFor({ ...base, phase: 'lunch', hour: 12 }).categories).toEqual(['lunch']);
    expect(categoriesFor({ ...base, mood: 'sleep', phase: 'after', hour: 23 }).categories).toEqual([
      'night',
    ]);
    expect(categoriesFor(base).categories).toEqual(['default', 'morning']);
    expect(categoriesFor({ ...base, today: '2026-11-23', hour: 9 }).categories).toContain('monday');
    expect(categoriesFor({ ...base, today: '2026-11-27', hour: 15 }).categories).toContain(
      'friday',
    );
    expect(categoriesFor({ ...base, today: '2026-12-01' }).categories).toContain('yearEnd');
    expect(categoriesFor({ ...base, today: '2026-10-01' }).categories).toContain('busySeason');
    expect(categoriesFor({ ...base, daysToStep: 10 })).toMatchObject({ n: 10 });
    expect(lineFor({ ...base, today: '2026-12-24', holidayTomorrow: true })).toMatch(/내일은/);
  });
  it('모든 묶음에 문장이 있고 너무 길지 않다', () => {
    for (const [name, lines] of Object.entries(LINES)) {
      expect(lines.length, name).toBeGreaterThan(0);
      for (const line of lines) expect([...line].length, line).toBeLessThanOrEqual(40);
    }
  });
});
