/**
 * 일반직(별표 3) 계산 결과 고정(회귀) — #20 설계서 §8.3.
 *
 * 직종 확대(#20) 묶음 2~4 가 저장 형식·계산 함수·화면을 바꾸는 동안 일반직 결과가 한 글자도
 * 바뀌지 않았는지 본다. 기대값(tests/fixtures/golden-general.json)은 묶음 0 에서 **그때의 코드로**
 * 떠 둔 것이다. 계산 함수의 서명·필드 이름이 바뀌면 `snapshot()` 안에서만 맞춰 주고(예: grade → rank
 * 문자열), 기대값 파일은 고치지 않는다. 기대값을 다시 떠야 한다면 그것은 일반직 동작이 바뀐다는 뜻이다.
 *
 * 다시 뜨기(일반직 동작을 일부러 바꿨을 때만): GOLDEN_UPDATE=1 npx vitest run tests/unit/golden-general.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rulesFor } from '../../src/lib/rules/index.ts';
import { Calendar } from '../../src/lib/calc/calendar.ts';
import { upcomingBonuses } from '../../src/lib/calc/bonus.ts';
import { annualLeaveDays } from '../../src/lib/calc/leave.ts';
import { buildMilestones } from '../../src/lib/calc/milestones.ts';
import {
  longServiceInfo,
  minServiceDate,
  promotionPreview,
  seniorAllowance,
  seniorTreatmentInfo,
} from '../../src/lib/calc/promotion.ts';
import { retirementInfo } from '../../src/lib/calc/retirement.ts';
import {
  cumulativeSalary,
  nextStepRaise,
  salaryOn,
  yearToDateSalary,
} from '../../src/lib/calc/salary.ts';
import type { Profile } from '../../src/lib/store/schema.ts';

const FIXTURE = join(process.cwd(), 'tests/fixtures/golden-general.json');
const DATES = ['2026-11-26', '2027-01-01', '2027-07-01'] as const;
/** 월급날. 시드에 따로 없으면 25일. 지급일이 주말·공휴일이라 당겨지는 조합이 다르도록 10일·20일 시드를 둔다 */
const PAYDAY: Record<string, number> = { 'g1-top': 20, 'g4-mid': 10 };
const paydayOf = (id: string) => PAYDAY[id] ?? 25;

const base = { nickname: '호봉이', overrides: { longServiceDate: null, seniorDate: null } };

/** 일반직 시드: 9급 신규, 7급 중간(승진 이력 있음/없음), 6급 근속승진 대상 밖, 5급 최고호봉 근처, 날짜 직접 입력,
 * 4급(승진소요최저연수 36개월의 마지막 직급·월급날 10일), 3급(다음 직급은 있으나 승진소요최저연수 값 없음),
 * 1급(다음 직급 없음·승진 이력 있음·월급날 20일) */
const SEEDS: Record<string, Profile> = {
  'g9-new': {
    ...base,
    birthDate: '2001-03-14',
    hireDate: '2026-03-02',
    grade: 9,
    gradeDate: '2026-03-02',
    step: 1,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-03-02',
  },
  'g9-long': {
    ...base,
    birthDate: '1990-08-31',
    hireDate: '2021-07-15',
    grade: 9,
    gradeDate: '2021-07-15',
    step: 6,
    nextStepDate: '2027-07-01',
    stepAsOf: '2026-11-26',
  },
  'g7-promoted': {
    ...base,
    birthDate: '1988-02-29',
    hireDate: '2013-01-02',
    grade: 7,
    gradeDate: '2019-12-31',
    step: 12,
    nextStepDate: '2027-01-01',
    stepAsOf: '2026-11-26',
  },
  'g7-direct': {
    ...base,
    birthDate: '1993-11-05',
    hireDate: '2018-09-03',
    grade: 7,
    gradeDate: '2018-09-03',
    step: 9,
    nextStepDate: '2027-09-01',
    stepAsOf: '2026-11-26',
  },
  'g6-overrides': {
    ...base,
    birthDate: '1979-05-20',
    hireDate: '2005-04-01',
    grade: 6,
    gradeDate: '2022-01-01',
    step: 19,
    nextStepDate: '2027-04-01',
    stepAsOf: '2026-11-26',
    overrides: { longServiceDate: '2030-01-01', seniorDate: '2026-12-01' },
  },
  'g8-overrides': {
    ...base,
    birthDate: '1985-01-10',
    hireDate: '2015-06-01',
    grade: 8,
    gradeDate: '2019-06-01',
    step: 10,
    nextStepDate: '2027-06-01',
    stepAsOf: '2026-11-26',
    overrides: { longServiceDate: '2026-12-10', seniorDate: null },
  },
  'g5-near-max': {
    ...base,
    birthDate: '1967-07-01',
    hireDate: '1994-03-01',
    grade: 5,
    gradeDate: '2016-07-01',
    step: 29,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-11-26',
  },
  'g4-mid': {
    ...base,
    birthDate: '1975-12-03',
    hireDate: '2001-02-01',
    grade: 4,
    gradeDate: '2021-07-01',
    step: 20,
    nextStepDate: '2027-02-01',
    stepAsOf: '2026-11-26',
  },
  'g3-nomin': {
    ...base,
    birthDate: '1972-06-30',
    hireDate: '1998-09-01',
    grade: 3,
    gradeDate: '2023-07-01',
    step: 18,
    nextStepDate: '2027-09-01',
    stepAsOf: '2026-11-26',
  },
  'g1-top': {
    ...base,
    birthDate: '1968-10-15',
    hireDate: '1995-03-01',
    grade: 1,
    gradeDate: '2024-01-01',
    step: 21,
    nextStepDate: '2027-03-01',
    stepAsOf: '2026-11-26',
  },
};

const rules = (year: number) => rulesFor(year);
const cal = new Calendar(rules);

/** 지금 코드의 서명으로 부른 결과. 서명이 바뀌면 이 함수 안에서만 맞춘다 */
function snapshot(id: string, p: Profile) {
  const r = rulesFor(2026);
  const retire = retirementInfo(r.retirement, p.birthDate);
  const byDate = Object.fromEntries(
    DATES.map((date) => {
      const rd = rulesFor(Number(date.slice(0, 4)));
      return [
        date,
        {
          salaryOn: salaryOn(rules, p, date),
          nextStepRaise: nextStepRaise(rules, p, date),
          cumulativeSalary: cumulativeSalary(rules, p, date),
          yearToDateSalary: yearToDateSalary(rules, p, date),
          promotionPreview: promotionPreview(rules, p, date),
          seniorAllowance: seniorAllowance(rules, p, date),
          annualLeaveDays: annualLeaveDays(rd.leave, p.hireDate, date, retire.retireDate),
          upcomingBonuses: upcomingBonuses(rules, cal, p, paydayOf(id), date, 6, retire.retireDate),
          milestones: buildMilestones(rules, p, date).map((m) => ({
            id: m.id,
            date: m.date,
            title: m.title,
            detail: m.detail,
            kind: m.kind,
            badge: m.badge,
          })),
        },
      ];
    }),
  );
  return {
    retirementInfo: retire,
    minServiceDate: minServiceDate(r.promotion, p.grade, p.gradeDate),
    longServiceInfo: longServiceInfo(r.promotion, p),
    seniorTreatmentInfo: seniorTreatmentInfo(r.promotion, p),
    byDate,
  };
}

function actual() {
  return Object.fromEntries(Object.entries(SEEDS).map(([id, p]) => [id, snapshot(id, p)]));
}

describe('일반직 결과 고정(golden-general)', () => {
  const now = JSON.parse(JSON.stringify(actual())) as Record<string, unknown>;
  if (process.env.GOLDEN_UPDATE === '1')
    writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`);

  it('기대값 파일이 있다', () => {
    expect(existsSync(FIXTURE)).toBe(true);
  });
  const expected = existsSync(FIXTURE)
    ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>)
    : {};

  it('시드 목록이 기대값과 같다', () => {
    expect(Object.keys(now).sort()).toEqual(Object.keys(expected).sort());
  });
  it.each(Object.keys(SEEDS))('%s: 봉급·승급·승진·정년·연가·보너스·일정이 그대로다', (id) => {
    expect(now[id]).toEqual(expected[id]);
  });
  it('기대값이 비어 있지 않다(일정·보너스가 실제로 계산됐다)', () => {
    const g7 = expected['g7-promoted'] as {
      byDate: Record<string, { milestones: unknown[]; upcomingBonuses: unknown[] }>;
    };
    expect(g7.byDate['2026-11-26']?.milestones.length).toBeGreaterThan(20);
    expect(g7.byDate['2026-11-26']?.upcomingBonuses.length).toBeGreaterThan(0);
  });
  it('1급은 다음 직급이 없고, 3급은 승진소요최저연수 값이 없으며, 4급은 있다(묶음 3 의 nextRank·minServiceDate 경로)', () => {
    type G = { minServiceDate: unknown; byDate: Record<string, { promotionPreview: unknown }> };
    const top = expected['g1-top'] as G;
    const g3 = expected['g3-nomin'] as G;
    const g4 = expected['g4-mid'] as G;
    expect(top.byDate['2026-11-26']?.promotionPreview).toBeNull();
    expect(top.minServiceDate).toBeNull();
    expect(g3.byDate['2026-11-26']?.promotionPreview).not.toBeNull();
    expect(g3.minServiceDate).toBeNull();
    expect(typeof g4.minServiceDate).toBe('string');
  });
});
