/**
 * 직종별 계산(#20 묶음 3) — 설계서 §5.3 경계 사례 표를 그대로 옮긴다(입력 → 기대값 → 근거 조항).
 * 근거 파일·줄은 docs/sources/2026/ 발췌본 기준이다. 실제 규정 데이터(data/2026.json)를 쓴다.
 */
import { describe, expect, it } from 'vitest';
import { rulesFor } from '../rules/index.ts';
import { resolveCareer, type CareerSel } from '../rules/career.ts';
import { isAvailable, type Avail, type TrackId } from '../rules/types.ts';
import { Calendar } from './calendar.ts';
import { careerOf, careerStepOn, type CareerProfile } from './career-profile.ts';
import { addDays, diffDays } from './date.ts';
import { upcomingBonuses } from './bonus.ts';
import { advanceLimitDays, annualLeaveDays, summarizeLeave } from './leave.ts';
import { compensationAmount } from './leave-bank.ts';
import { buildMilestones } from './milestones.ts';
import {
  longServiceInfo,
  minServiceDate,
  promotionPreview,
  seniorAllowance,
  seniorTreatmentInfo,
} from './promotion.ts';
import {
  effectiveRetirement,
  rankLimitInfo,
  retirementInfo,
  retirePeriodText,
} from './retirement.ts';
import {
  cumulativeSalary,
  monthlySalary,
  nextStepRaise,
  salaryOn,
  yearToDateSalary,
} from './salary.ts';

const R = rulesFor(2026);
const TODAY = '2026-11-25';
const cal = new Calendar(rulesFor);

function availableOf<T extends object>(value: Avail<T>): T {
  if (!isAvailable(value)) throw new Error(`꺼져 있음: ${value.status} ${value.reason}`);
  return value;
}

const career = (track: TrackId, rank: string | null, payTable: CareerSel['payTable'] = null) =>
  resolveCareer(R, { track, payTable, rank });

/** 오늘(TODAY) 그 호봉인 프로필(다음 승급일은 2027-01-01) */
function person(over: Partial<CareerProfile> & Pick<CareerProfile, 'track'>): CareerProfile {
  return {
    payTable: over.track === 'general' ? 'table3' : null,
    rank: null,
    hireDate: '2010-03-02',
    rankDate: '2010-03-02',
    birthDate: '1985-05-20',
    step: 10,
    nextStepDate: '2027-01-01',
    stepAsOf: TODAY,
    overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    ...over,
  };
}

const policeRetirement = availableOf(career('police', '경정').retirement);
const fireRetirement = availableOf(career('fire', '소방령').retirement);
const teacherRetirement = availableOf(career('teacher', '교원').retirement);

describe('§5.3 교원 정년(62세, 교육공무원법 제47조 — education-officials-act.txt:36-37)', () => {
  // [생년월일, 정년에 이른 날, 퇴직일, 확인하는 것]
  const cases: [string, string, string, string][] = [
    // 법제처 12-0189 그 사안(interpretation-retirement-age.txt:12-13)
    ['1964-03-01', '2026-03-01', '2026-08-31', '3월 1일생 → 8월 31일'],
    ['1964-02-28', '2026-02-28', '2026-02-28', '2월생 → 같은 해 2월 말일(yearOffset 0)'],
    // 해석 갈림 §11.1-2: 윤일생이 평년에 62세 → 3월 1일로 본다
    ['1964-02-29', '2026-03-01', '2026-08-31', '윤일생이 평년에 62세 → 3월 1일'],
    ['1964-08-31', '2026-08-31', '2026-08-31', '8월 끝 경계'],
    ['1964-09-01', '2026-09-01', '2027-02-28', '9월 → 다음 해 2월 말일'],
    ['1964-12-31', '2026-12-31', '2027-02-28', '12월 → 다음 해'],
    ['1965-01-01', '2027-01-01', '2027-02-28', '1월 → 같은 해 2월 말일(다음 해 아님)'],
    ['1966-01-15', '2028-01-15', '2028-02-29', '2월 말일이 윤년 29일'],
    ['1966-09-15', '2028-09-15', '2029-02-28', '다음 해가 평년'],
  ];
  it.each(cases)('%s생 → 이른 날 %s, 퇴직 %s (%s)', (birth, reach, retire) => {
    expect(retirementInfo(teacherRetirement, birth)).toEqual({
      reachDate: reach,
      retireDate: retire,
    });
    // 직종 해석을 거친 실효 정년도 같다(교원은 계급정년이 없다)
    const eff = availableOf(
      effectiveRetirement(
        career('teacher', '교원'),
        person({ track: 'teacher', birthDate: birth }),
      ),
    );
    expect(eff).toMatchObject({ retireDate: retire, cause: 'age', rankLimit: null, ageYears: 62 });
  });
});

describe('§5.3 경찰·소방 연령정년(60세, 경찰공무원법 제30조제1항제1호·제5항 — police-officials-act.txt:33·44, 소방 fire-officials-act.txt:36·47)', () => {
  const cases: [string, string, string][] = [
    ['1966-06-30', '2026-06-30', '2026-06-30'],
    ['1966-07-01', '2026-07-01', '2026-12-31'],
    ['1968-02-29', '2028-02-29', '2028-06-30'],
  ];
  it.each(cases)('%s생 → 이른 날 %s, 퇴직 %s', (birth, reach, retire) => {
    expect(retirementInfo(policeRetirement, birth)).toEqual({
      reachDate: reach,
      retireDate: retire,
    });
    expect(retirementInfo(fireRetirement, birth)).toEqual({ reachDate: reach, retireDate: retire });
  });
});

describe('§5.3 계급정년(경찰공무원법 제30조제1항제2호·제5항 — :34-38·44 / 소방공무원법 제25조 — :37-41·47)', () => {
  // [계급, 현 계급 임용일, N년, 이른 날(기념일), 퇴직일, 1/1·7/1 주의(6개월 차이)]
  // '이른 날'은 기념일로 본다(§11.1-1, Q1). 다른 해석(만료일 = 전날)이면 첫째·셋째 줄이 6개월 당겨진다.
  const cases: [string, string, number, string, string, boolean][] = [
    ['경정', '2015-01-01', 14, '2029-01-01', '2029-06-30', true], // 다른 해석: 2028-12-31
    ['경정', '2014-12-31', 14, '2028-12-31', '2028-12-31', false], // 해석과 무관
    ['경정', '2015-07-01', 14, '2029-07-01', '2029-12-31', true], // 다른 해석: 2029-06-30
    ['경정', '2015-06-30', 14, '2029-06-30', '2029-06-30', false],
    ['총경', '2016-02-29', 11, '2027-03-01', '2027-06-30', false], // 윤일
    ['치안감', '2020-03-01', 4, '2024-03-01', '2024-06-30', false],
    ['경무관', '2020-01-31', 6, '2026-01-31', '2026-06-30', false],
  ];
  it.each(cases)(
    '%s %s 승진 → %i년 → 이른 날 %s, 퇴직 %s',
    (rank, date, years, reach, retire, boundary) => {
      expect(rankLimitInfo(policeRetirement, rank, date)).toEqual({
        years,
        reachDate: reach,
        retireDate: retire,
        overridden: false,
        boundary,
      });
    },
  );
  it('소방도 같은 연수(소방령 14년·소방정 11년·소방준감 6년·소방감 4년)', () => {
    expect(rankLimitInfo(fireRetirement, '소방령', '2015-01-01')?.retireDate).toBe('2029-06-30');
    expect(rankLimitInfo(fireRetirement, '소방정', '2016-02-29')?.retireDate).toBe('2027-06-30');
  });
  it('경정, 1970-05-10생, 2018-03-01 승진: 연령(2030-05-10 → 2030-06-30)이 계급(2032-03-01)보다 먼저 → cause age', () => {
    const p = person({
      track: 'police',
      rank: '경정',
      birthDate: '1970-05-10',
      rankDate: '2018-03-01',
    });
    const eff = availableOf(effectiveRetirement(career('police', '경정'), p));
    expect(eff.rankLimit?.reachDate).toBe('2032-03-01');
    expect(eff.age.reachDate).toBe('2030-05-10');
    expect(eff).toMatchObject({ retireDate: '2030-06-30', cause: 'age' });
  });
  it('경감(계급정년 없음): 연령만, rankLimit null', () => {
    const p = person({ track: 'police', rank: '경감', birthDate: '1970-05-10' });
    expect(rankLimitInfo(policeRetirement, '경감', p.rankDate)).toBeNull();
    const eff = availableOf(effectiveRetirement(career('police', '경감'), p));
    expect(eff).toMatchObject({ rankLimit: null, cause: 'age', retireDate: '2030-06-30' });
  });
  it('경정, 직접 고친 날 2033-02-01 → 퇴직 2033-06-30, overridden', () => {
    expect(rankLimitInfo(policeRetirement, '경정', '2015-01-01', '2033-02-01')).toEqual({
      years: 14,
      reachDate: '2033-02-01',
      retireDate: '2033-06-30',
      overridden: true,
      boundary: false,
    });
    const p = person({
      track: 'police',
      rank: '경정',
      birthDate: '1975-03-10',
      rankDate: '2015-01-01',
      overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: '2033-02-01' },
    });
    expect(availableOf(effectiveRetirement(career('police', '경정'), p))).toMatchObject({
      retireDate: '2033-06-30',
      cause: 'rankLimit',
    });
  });
  // 경찰공무원법 제30조제2항 "강등(경감으로 강등된 경우를 포함한다)…강등되기 전 계급 중 가장 높은 계급의
  // 계급정년" (police-officials-act.txt:39-41), 소방공무원법 제25조제3항 "소방경으로 강등된 경우를 포함한다"
  // (fire-officials-act.txt:43-45). 계급정년이 없는 계급이어도 직접 넣은 '계급정년에 이르는 날'을 쓴다.
  it('강등된 경감: 계급정년이 없는 계급이어도 직접 넣은 날 2020-01-01 → 2020-06-30, cause rankLimit', () => {
    expect(rankLimitInfo(policeRetirement, '경감', '2015-01-01', '2020-01-01')).toEqual({
      years: null,
      reachDate: '2020-01-01',
      retireDate: '2020-06-30',
      overridden: true,
      boundary: false,
    });
    const p = person({
      track: 'police',
      rank: '경감',
      birthDate: '1975-03-10',
      rankDate: '2015-01-01',
      overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: '2020-01-01' },
    });
    expect(availableOf(effectiveRetirement(career('police', '경감'), p))).toMatchObject({
      retireDate: '2020-06-30',
      cause: 'rankLimit',
      rankLimit: { years: null, overridden: true },
    });
    const retire = buildMilestones(rulesFor, { ...p, hireDate: '1998-03-02' }, '2019-01-02').find(
      (m) => m.id === 'retire',
    );
    expect(retire).toMatchObject({ date: '2020-06-30', title: '계급정년 퇴직' });
    expect(retire?.detail).toBe('직접 넣은 계급정년에 이르는 날로 퇴직해요.');
  });
  it('강등된 소방경: 직접 넣은 날 2027-08-15 → 2027-12-31', () => {
    const p = person({
      track: 'fire',
      rank: '소방경',
      birthDate: '1975-03-10',
      rankDate: '2015-01-01',
      overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: '2027-08-15' },
    });
    expect(availableOf(effectiveRetirement(career('fire', '소방경'), p))).toMatchObject({
      retireDate: '2027-12-31',
      cause: 'rankLimit',
    });
  });
  it('계급정년 규정이 없는 직종(일반직·교원)은 직접 넣은 날이 있어도 연령정년만', () => {
    const overrides = { longServiceDate: null, seniorDate: null, rankLimitDate: '2020-01-01' };
    const general = person({ track: 'general', rank: '6', birthDate: '1975-03-10', overrides });
    expect(
      availableOf(effectiveRetirement(career('general', '6', 'table3'), general)),
    ).toMatchObject({ retireDate: '2035-06-30', cause: 'age', rankLimit: null });
    const teacher = person({ track: 'teacher', rank: '교원', birthDate: '1975-03-10', overrides });
    expect(availableOf(effectiveRetirement(career('teacher', '교원'), teacher))).toMatchObject({
      retireDate: '2037-08-31',
      cause: 'age',
      rankLimit: null,
    });
  });
});

describe('계급정년이 있는 직종에서 계급을 모르면(rankProblem) 정년을 만들지 않는다', () => {
  // 경찰 rank null·'경위급'(사다리에 없음): 계급정년이 6년 넘게 앞설 수 있어 연령정년만으로 날짜를 만들지 않는다.
  const base = {
    birthDate: '1975-03-10',
    rankDate: '2015-01-01',
    hireDate: '2000-03-02',
  };
  it.each([
    ['police', null, '계급을 골라 주세요.'],
    ['police', '경위급', '계급을 다시 골라 주세요.'],
    ['fire', null, '계급을 골라 주세요.'],
    ['coastGuard', '7', '계급을 다시 골라 주세요.'],
  ] as const)('%s / %s → 입력 필요(%s), 정년·정기승급 일정 없음', (track, rank, reason) => {
    const p = person({ track, rank, ...base });
    expect(effectiveRetirement(career(track, rank), p)).toEqual({ status: 'input', reason });
    const ms = buildMilestones(rulesFor, p, TODAY);
    expect(ms.filter((m) => m.kind === 'retire')).toEqual([]);
    // 최고호봉을 몰라 정기승급 일정도 넣지 않는다(상한 99 로 '32호봉' 같은 일정을 만들지 않는다)
    expect(ms.filter((m) => m.id.startsWith('step-'))).toEqual([]);
  });
  it('계급을 몰라도 계급정년에 이르는 날을 직접 넣었으면 그날로 계산', () => {
    const p = person({
      track: 'police',
      rank: null,
      ...base,
      overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: '2029-01-01' },
    });
    expect(availableOf(effectiveRetirement(career('police', null), p))).toMatchObject({
      retireDate: '2029-06-30',
      cause: 'rankLimit',
    });
  });
  it('계급정년이 없는 직종(일반직 rank null)은 연령정년 그대로', () => {
    const p = person({ track: 'general', rank: null, ...base });
    expect(availableOf(effectiveRetirement(career('general', null, 'table3'), p))).toMatchObject({
      retireDate: '2035-06-30',
    });
  });
});

describe('정년 구간 규칙 글(retirePeriodText, 규정 데이터 periods 에서)', () => {
  it('일반직·경찰: 1~6월 → 6월 30일, 7~12월 → 12월 31일', () => {
    const general = availableOf(career('general', '7', 'table3').retirement);
    expect(retirePeriodText(general)).toBe('1~6월이면 6월 30일, 7~12월이면 12월 31일');
    expect(retirePeriodText(policeRetirement)).toBe('1~6월이면 6월 30일, 7~12월이면 12월 31일');
  });
  it('교원: 3~8월 → 8월 31일, 9~12월 → 다음 해 2월 말일, 1~2월 → 2월 말일(교육공무원법 제47조제2항)', () => {
    expect(retirePeriodText(teacherRetirement)).toBe(
      '3~8월이면 그해 8월 31일, 9~12월이면 다음 해 2월 말일, 1~2월이면 그해 2월 말일',
    );
  });
});

describe('§5.3 정년 일정 id(§5.6, 계급정년 계열을 따로 두지 않는다)', () => {
  const idsOf = (p: CareerProfile) => buildMilestones(rulesFor, p, TODAY);
  const rankLimitIds = (ms: { id: string }[]) => ms.filter((m) => m.id.startsWith('rank-limit'));

  it('경정 2015-01-01 승진, 1975-03-10생(연령정년 2035-06-30): 정년 계열이 계급정년 날(2029-06-30)로', () => {
    const p = person({
      track: 'police',
      rank: '경정',
      hireDate: '1998-03-02',
      rankDate: '2015-01-01',
      birthDate: '1975-03-10',
    });
    expect(availableOf(effectiveRetirement(career('police', '경정'), p)).age.retireDate).toBe(
      '2035-06-30',
    );
    const ms = idsOf(p);
    const byId = new Map(ms.map((m) => [m.id, m]));
    expect(byId.get('retire')).toMatchObject({ date: '2029-06-30', title: '계급정년 퇴직' });
    expect(byId.get('retire')?.detail).toContain('계급정년(경정 14년)');
    expect(byId.get('retire-d365')?.date).toBe('2028-06-30');
    expect(byId.get('retire-d100')?.date).toBe(addDays('2029-06-30', -100));
    expect(byId.get('retire-d1000')?.date).toBe(addDays('2029-06-30', -1000));
    expect(byId.get('retire-d3650')?.date).toBe(addDays('2029-06-30', -3650));
    const total = diffDays('1998-03-02', '2029-06-30');
    expect(byId.get('retire-half')?.date).toBe(addDays('1998-03-02', Math.ceil(total / 2)));
    expect(rankLimitIds(ms)).toEqual([]);
    // 정년 뒤의 일정은 없다
    expect(ms.every((m) => m.date <= '2029-06-30')).toBe(true);
  });
  it('경정, 1970-05-10생, 2018-03-01 승진(연령이 먼저): retire 2030-06-30 "정년퇴직"', () => {
    const ms = idsOf(
      person({ track: 'police', rank: '경정', birthDate: '1970-05-10', rankDate: '2018-03-01' }),
    );
    expect(ms.find((m) => m.id === 'retire')).toMatchObject({
      date: '2030-06-30',
      title: '정년퇴직',
    });
    expect(rankLimitIds(ms)).toEqual([]);
  });
  it('경감(계급정년 없음): 일반직과 같은 id·날짜', () => {
    const birth = '1980-08-15';
    const police = idsOf(person({ track: 'police', rank: '경감', birthDate: birth }));
    const general = idsOf(person({ track: 'general', rank: '6', birthDate: birth }));
    const retireOf = (ms: typeof police) =>
      ms.filter((m) => m.kind === 'retire').map((m) => [m.id, m.date, m.title]);
    expect(retireOf(police)).toEqual(retireOf(general));
    expect(rankLimitIds(police)).toEqual([]);
  });
  it('같은 날짜·같은 kind "retire" 일정이 두 개 이상 생기지 않는다', () => {
    for (const p of [
      person({ track: 'police', rank: '경정', rankDate: '2015-01-01', birthDate: '1975-03-10' }),
      person({ track: 'police', rank: '경정', rankDate: '2018-03-01', birthDate: '1970-05-10' }),
      person({ track: 'fire', rank: '소방령', rankDate: '2015-07-01', birthDate: '1980-01-01' }),
      person({ track: 'police', rank: '경감', birthDate: '1980-08-15' }),
      person({ track: 'teacher', rank: '교원', birthDate: '1966-09-15' }),
    ]) {
      const keys = buildMilestones(rulesFor, p, TODAY)
        .filter((m) => m.kind === 'retire')
        .map((m) => m.date);
      expect(new Set(keys).size, `${p.track} ${p.rank}`).toBe(keys.length);
    }
  });
});

describe('§5.3 근속승진 요건일(경찰공무원법 제16조제1항 :24-28, 소방공무원법 제15조제1항 :25-29)', () => {
  // [경찰 계급, 소방 계급, 현 계급 임용일, 기간(개월), 요건일, 소방 심사 가능일(5일 전)]
  const cases: [string, string, string, number, string, string][] = [
    ['순경', '소방사', '2020-01-31', 48, '2024-01-31', '2024-01-26'],
    ['순경', '소방사', '2020-02-29', 48, '2024-02-29', '2024-02-24'],
    // 2026년 2월 31일이 없어 다음 날
    ['경사', '소방장', '2019-08-31', 78, '2026-03-01', '2026-02-24'],
    ['경사', '소방장', '2020-01-31', 78, '2026-07-31', '2026-07-26'],
    ['경장', '소방교', '2018-03-01', 60, '2023-03-01', '2023-02-24'],
    ['경위', '소방위', '2017-01-01', 96, '2025-01-01', '2024-12-27'],
  ];
  it.each(cases)('%s(%s) %s 임용 → %i개월 → %s', (police, fire, rankDate, months, date, review) => {
    const p = person({ track: 'police', rank: police, rankDate });
    const info = availableOf(longServiceInfo(career('police', police), p));
    expect(info).toMatchObject({
      applicable: true,
      requiredMonths: months,
      autoDate: date,
      date,
      reviewFrom: null, // 경찰은 '기간 도달 전 심사' 규정이 없다(§11.1-10)
    });
    const f = availableOf(
      longServiceInfo(career('fire', fire), person({ track: 'fire', rank: fire, rankDate })),
    );
    // 소방 승진임용 규정 제6조의2(5일 전부터 심사, fire-promotion-rule.txt:66)
    expect(f).toMatchObject({ requiredMonths: months, date, reviewFrom: review });
  });
  it('경감 → 근속승진 대상 아님(applicable false)', () => {
    const p = person({ track: 'police', rank: '경감' });
    expect(availableOf(longServiceInfo(career('police', '경감'), p)).applicable).toBe(false);
  });
  it('경위 → 목표 경감: 50% 안내(quotaNote). 소방위 → 소방경도', () => {
    const police = availableOf(
      longServiceInfo(career('police', '경위'), person({ track: 'police', rank: '경위' })),
    );
    expect(police.targetRank?.key).toBe('경감');
    expect(police.quotaNote).toContain('50%');
    const fire = availableOf(
      longServiceInfo(career('fire', '소방위'), person({ track: 'fire', rank: '소방위' })),
    );
    expect(fire.targetRank?.key).toBe('소방경');
    expect(fire.quotaNote).toContain('50%');
    // 경사 → 경위 는 인원 제한이 없다
    const sergeant = availableOf(
      longServiceInfo(career('police', '경사'), person({ track: 'police', rank: '경사' })),
    );
    expect(sergeant.quotaNote).toBeNull();
  });
});

describe('§5.3 대우공무원(경찰 시행규칙 제35조·제36조 :6-8·12, 소방 시행규칙 제36조·제37조 :6-8·12)', () => {
  // [직종, 계급, 현 계급 임용일, 기간(개월), 요건 충족일, 발령 예정일(그 뒤 첫 1일)]
  const cases: [TrackId, string, string, number, string, string][] = [
    ['police', '경위', '2020-01-01', 48, '2024-01-01', '2024-01-01'],
    ['police', '경위', '2020-01-02', 48, '2024-01-02', '2024-02-01'],
    ['police', '경정', '2018-05-31', 84, '2025-05-31', '2025-06-01'],
    ['fire', '소방위', '2020-02-29', 48, '2024-02-29', '2024-03-01'],
  ];
  it.each(cases)(
    '%s %s %s → %i개월 → %s, 발령 %s',
    (track, rank, rankDate, months, qualify, date) => {
      const p = person({ track, rank, rankDate });
      expect(availableOf(seniorTreatmentInfo(career(track, rank), p))).toMatchObject({
        applicable: true,
        requiredMonths: months,
        qualifyDate: qualify,
        autoDate: date,
        date,
      });
    },
  );
  it('경무관 → 대상 아님(applicable false)', () => {
    const p = person({ track: 'police', rank: '경무관' });
    expect(availableOf(seniorTreatmentInfo(career('police', '경무관'), p)).applicable).toBe(false);
  });
  it('해양경찰 경위 → 준비 중(Unavailable pending, 숫자 없음)', () => {
    const p = person({ track: 'coastGuard', rank: '경위' });
    const info = seniorTreatmentInfo(career('coastGuard', '경위'), p);
    expect(isAvailable(info)).toBe(false);
    expect(info).toMatchObject({ status: 'pending' });
  });
});

describe('§5.3 승진소요최저(근무)연수', () => {
  // [직종, 봉급표, 계급, 현 계급 임용일, 날짜]
  const cases: [TrackId, CareerSel['payTable'], string, string, string | null][] = [
    ['police', null, '순경', '2025-03-31', '2026-03-31'], // 1년(경찰공무원 승진임용 규정 제5조제1항)
    ['police', null, '경감', '2025-02-28', '2027-02-28'], // 2년
    ['police', null, '총경', '2024-02-29', '2027-03-01'], // 3년, 2027-02-29 가 없어 다음 날
    ['general', 'table8', '3', '2024-08-31', '2026-03-01'], // 우정3급 1년 6개월(임용령 제31조제1항제2호)
    ['police', null, '치안감', '2020-03-01', null], // 규정 없음
  ];
  it.each(cases)('%s %s %s %s → %s', (track, payTable, rank, rankDate, date) => {
    expect(minServiceDate(career(track, rank, payTable), rankDate)).toBe(date);
  });
});

describe('§5.3 봉급·호봉(대조 겸 회귀)', () => {
  const pointOf = (track: TrackId, rank: string, step: number, payTable: CareerSel['payTable']) =>
    salaryOn(rulesFor, person({ track, rank, step, payTable }), TODAY);
  it('경위 1호봉(별표 10) 2,507,700 (pay-reg-table10-police-fire.txt:11, 7번째 열)', () => {
    expect(pointOf('police', '경위', 1, null)).toMatchObject({
      amount: 2_507_700,
      annex: '별표 10',
      step: 1,
    });
  });
  it('경감 32호봉 5,372,500 (:42) · 경위 최고 31호봉', () => {
    expect(pointOf('police', '경감', 32, null)?.amount).toBe(5_372_500);
    expect(pointOf('police', '경위', 40, null)).toMatchObject({ step: 31, atMaxStep: true });
  });
  it('교원 40호봉 6,205,700 (pay-reg-table11-teachers.txt:30)', () => {
    expect(pointOf('teacher', '교원', 40, null)).toMatchObject({
      amount: 6_205_700,
      annex: '별표 11',
    });
  });
  it('공안 7급 1호봉 2,472,100 (pay-reg-table4-public-safety.txt:12)', () => {
    expect(pointOf('general', '7', 1, 'table4')).toMatchObject({
      amount: 2_472_100,
      annex: '별표 4',
    });
  });
  it('우정1급 24호봉 6,201,400 (pay-reg-table8-postal.txt:35)', () => {
    expect(pointOf('general', '1', 24, 'table8')).toMatchObject({
      amount: 6_201_400,
      annex: '별표 8',
    });
  });
  it('외무 3등급 5호봉 = 별표 3 7급 5호봉 2,567,100 (pay-reg-table3-salary.txt:12-14)', () => {
    expect(pointOf('foreign', '3', 5, null)).toMatchObject({ amount: 2_567_100, annex: '별표 3' });
    expect(monthlySalary(R.salary.table['7'], 5)).toBe(2_567_100);
  });
  it('경정 20호봉 → 총경 승진 미리보기: 별표 28 → 19호봉, 총경 19호봉 5,893,300', () => {
    const preview = promotionPreview(
      rulesFor,
      person({ track: 'police', rank: '경정', step: 20 }),
      TODAY,
    );
    expect(preview).toMatchObject({
      fromRank: { key: '경정' },
      toRank: { key: '총경' },
      fromStep: 20,
      toStep: 19,
      toAmount: 5_893_300,
    });
  });
  it('치안정감 → 다음 계급(치안총감): 봉급표 열이 없어 toAmount null과 사유', () => {
    const preview = promotionPreview(
      rulesFor,
      person({ track: 'police', rank: '치안정감', step: 10 }),
      TODAY,
    );
    expect(preview).toMatchObject({
      toRank: { key: '치안총감' },
      toStep: null,
      toAmount: null,
      diff: null,
      toUnavailableReason: '별표 10 봉급표에 이 계급의 열이 없어요.',
    });
    // 승진 시 봉급을 모르면 대우공무원수당은 비율대로(상한 비교 생략)
    const p = person({ track: 'police', rank: '치안정감', step: 10 });
    const amount = salaryOn(rulesFor, p, TODAY)?.amount ?? 0;
    const rate = availableOf(career('police', '치안정감').allowances.seniorTreatment).rate;
    expect(seniorAllowance(rulesFor, p, TODAY)).toBe(Math.floor(amount * rate));
  });
  it('일반직 7급(별표 3)은 기존과 같다: 7급 12호봉 3,331,900', () => {
    expect(pointOf('general', '7', 12, 'table3')).toMatchObject({
      amount: 3_331_900,
      annex: '별표 3',
    });
  });
});

describe('§5.4 승급을 계산하지 않는 직종(그 밖의 특정직·군무원)', () => {
  const other = person({ track: 'otherSpecial', step: 12, nextStepDate: '2027-03-01' });
  it('호봉은 입력한 값 그대로(승급일이 지나도 자동으로 올리지 않는다), 봉급·누적 봉급은 숫자 없음', () => {
    const c = careerOf(rulesFor, other, 2027);
    expect(careerStepOn(c, other, '2027-06-01')).toBe(12);
    expect(salaryOn(rulesFor, other, TODAY)).toBeNull();
    expect(nextStepRaise(rulesFor, other, TODAY)).toBeNull();
    expect(cumulativeSalary(rulesFor, other, TODAY)).toBeNull();
    expect(yearToDateSalary(rulesFor, other, TODAY)).toBeNull();
    expect(promotionPreview(rulesFor, other, TODAY)).toBeNull();
    expect(seniorAllowance(rulesFor, other, TODAY)).toBeNull();
  });
  it('일정에는 입력한 다음 승급일만(“다음 승급일(입력한 날)”), 정년 계열은 없다(정년 준비 중)', () => {
    const ms = buildMilestones(rulesFor, other, TODAY);
    const step = ms.filter((m) => m.id.startsWith('step-'));
    expect(step).toEqual([
      expect.objectContaining({ id: 'step-2027-03-01', title: '다음 승급일(입력한 날)' }),
    ]);
    expect(ms.filter((m) => m.kind === 'retire')).toEqual([]);
    expect(ms.filter((m) => m.kind === 'promotion')).toEqual([]);
    expect(ms.some((m) => m.id.startsWith('leave-') || m.id.startsWith('diligence-'))).toBe(false);
    // 정년이 없으니 임용 45주년까지
    expect(ms.filter((m) => m.id.startsWith('anniv-'))).toHaveLength(45);
  });
  it('군무원도 같다(봉급 T1 준비 중)', () => {
    const p = person({ track: 'militaryCivil', step: 7 });
    expect(salaryOn(rulesFor, p, TODAY)).toBeNull();
    expect(careerStepOn(careerOf(rulesFor, p, 2026), p, '2030-01-01')).toBe(7);
  });
});

describe('§5.5 연가·수당', () => {
  const leaveData = {
    records: [],
    grantOverrideHours: {} as Record<string, number>,
    savings: [],
    years: {},
  };
  it('교원: 연가 일수는 계산, 연가보상비는 없음(null), 미리 쓰기는 교원휴가 예규 표', () => {
    const c = career('teacher', '교원');
    expect(annualLeaveDays(c.leave, '2015-03-01', TODAY)).toBe(
      annualLeaveDays(R.leave, '2015-03-01', TODAY),
    );
    expect(compensationAmount(c.leave, 3_000_000, 1)).toBeNull();
    // 교원휴가에 관한 예규 제5조제6항 표: 6월 미만 3일, 6월 이상 1년 미만 4일(일반직은 1년 미만 5일)
    expect(advanceLimitDays(c.leave, '2026-08-01', TODAY)).toBe(3);
    expect(advanceLimitDays(c.leave, '2026-03-01', TODAY)).toBe(4);
    expect(advanceLimitDays(R.leave, '2026-03-01', TODAY)).toBe(5);
  });
  it('연가 일수가 꺼진 직종: 자동 부여 0, 직접 넣기 안내(needsManualGrant). 넣으면 그 값을 쓴다', () => {
    const c = career('otherSpecial', null);
    expect(annualLeaveDays(c.leave, '2015-03-01', TODAY)).toBe(0);
    const s = summarizeLeave(c.leave, '2015-03-01', leaveData, TODAY);
    expect(s).toMatchObject({ autoHours: 0, grantedHours: 0, needsManualGrant: true });
    const own = summarizeLeave(
      c.leave,
      '2015-03-01',
      { records: [], grantOverrideHours: { '2026': 168 }, savings: [], years: {} },
      TODAY,
    );
    expect(own).toMatchObject({ grantedHours: 168, needsManualGrant: false, overridden: true });
    expect(advanceLimitDays(c.leave, '2015-03-01', TODAY)).toBeNull();
    expect(compensationAmount(c.leave, 3_000_000, 1)).toBeNull();
  });
  it('정근수당·명절휴가비: 경찰·교원은 그 봉급표로, 그 밖의 특정직은 목록에서 빠진다', () => {
    const police = person({ track: 'police', rank: '경위', step: 9 });
    const pb = upcomingBonuses(rulesFor, cal, police, 25, TODAY, 4);
    expect(pb.length).toBeGreaterThan(0);
    const base = salaryOn(rulesFor, police, '2027-01-01')?.amount;
    const jan = pb.find((b) => b.kind === 'diligence');
    expect(jan?.baseSalary).toBe(base);
    const teacher = person({ track: 'teacher', rank: '교원', step: 20 });
    expect(upcomingBonuses(rulesFor, cal, teacher, 17, TODAY, 4).length).toBeGreaterThan(0);
    expect(upcomingBonuses(rulesFor, cal, person({ track: 'otherSpecial' }), 25, TODAY, 4)).toEqual(
      [],
    );
  });
});

describe('일정(§5.6): 직종별 이름·id', () => {
  it('경찰 경사: 승진소요·대우·근속승진 일정이 사다리 이름으로, id 는 ASCII', () => {
    const ms = buildMilestones(
      rulesFor,
      person({ track: 'police', rank: '경사', rankDate: '2024-03-04', hireDate: '2016-03-02' }),
      TODAY,
    );
    const min = ms.find((m) => m.id.startsWith('min-service-'));
    expect(min?.id).toBe('min-service-police2');
    expect(min?.detail).toContain('경사로 1년 재직. 경위 승진 심사');
    const senior = ms.find((m) => m.id.startsWith('senior-'));
    expect(senior).toMatchObject({ id: 'senior-police2', title: '경위 대우공무원 요건' });
    const long = ms.find((m) => m.id.startsWith('long-service-'));
    expect(long).toMatchObject({ id: 'long-service-police2', title: '경위 근속승진 요건' });
    expect(long?.detail).toContain("'할 수 있다' 규정");
    for (const m of ms) expect(m.id).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
  });
  it("근속승진 '할 수 있다' 문구는 규정 데이터(discretionNote)에서: 경찰·해양경찰·소방은 붙고 일반직은 없다", () => {
    const longOf = (p: CareerProfile) =>
      buildMilestones(rulesFor, p, TODAY).find((m) => m.id.startsWith('long-service-'));
    const at = { rankDate: '2024-03-04', hireDate: '2016-03-02' };
    for (const [track, rank] of [
      ['police', '경사'],
      ['coastGuard', '경위'],
      ['fire', '소방장'],
    ] as const) {
      const c = career(track, rank);
      expect(isAvailable(c.longService) && c.longService.discretionNote).toBeTruthy();
      expect(longOf(person({ track, rank, ...at }))?.detail).toContain("'할 수 있다' 규정");
    }
    for (const payTable of ['table3', 'table4'] as const) {
      const long = longOf(person({ track: 'general', payTable, rank: '8', ...at }));
      expect(long).toBeDefined();
      expect(long?.detail).not.toContain("'할 수 있다'");
    }
  });
  it('시보 해제는 일반직 사다리의 6급 이하에만(경찰은 시보 준비 중이라 없다)', () => {
    const police = buildMilestones(rulesFor, person({ track: 'police', rank: '순경' }), TODAY);
    expect(police.some((m) => m.id === 'probation')).toBe(false);
    const general = buildMilestones(rulesFor, person({ track: 'general', rank: '9' }), TODAY);
    expect(general.some((m) => m.id === 'probation')).toBe(true);
    const postal = buildMilestones(
      rulesFor,
      person({ track: 'general', payTable: 'table8', rank: '9' }),
      TODAY,
    );
    expect(postal.some((m) => m.id === 'probation')).toBe(false);
  });
  it('교원: 승진 계열 일정 없음, 정년은 교육공무원법(2월 말일·8월 31일)', () => {
    const ms = buildMilestones(
      rulesFor,
      person({ track: 'teacher', rank: '교원', birthDate: '1966-09-15' }),
      TODAY,
    );
    expect(ms.filter((m) => m.kind === 'promotion')).toEqual([]);
    expect(ms.find((m) => m.id === 'retire')?.date).toBe('2029-02-28');
  });
  it('소방: 장기재직휴가는 조례(external)라 일정에 넣지 않는다', () => {
    const fire = buildMilestones(rulesFor, person({ track: 'fire', rank: '소방장' }), TODAY);
    expect(fire.some((m) => m.id.startsWith('long-leave-'))).toBe(false);
    const police = buildMilestones(rulesFor, person({ track: 'police', rank: '경사' }), TODAY);
    expect(police.some((m) => m.id.startsWith('long-leave-'))).toBe(true);
  });
});

describe('모든 직종·봉급표·계급 조합에서 계산 함수가 예외 없이 돈다', () => {
  const sels: CareerSel[] = [];
  for (const year of [2026, 2027]) {
    const rules = rulesFor(year);
    for (const [track, t] of Object.entries(rules.tracks.items) as [
      TrackId,
      typeof R.tracks.items.general,
    ][]) {
      for (const payTable of track === 'general' ? t.payTables : [null]) {
        const ladderId = resolveCareer(rules, { track, payTable, rank: null }).ladderId;
        const ranks = ladderId ? rules.tracks.ladders[ladderId].ranks.map((r) => r.key) : [];
        for (const rank of [...ranks, null, '없는계급'])
          if (!sels.some((s) => s.track === track && s.payTable === payTable && s.rank === rank))
            sels.push({ track, payTable, rank });
      }
    }
  }
  it.each(sels.map((s) => [`${s.track}/${String(s.payTable)}/${String(s.rank)}`, s] as const))(
    '%s',
    (_, sel) => {
      for (const today of ['2026-11-25', '2027-01-04', '2027-07-01']) {
        const p = person({ ...sel, rankDate: '2018-03-01', birthDate: '1968-04-10' });
        expect(() => {
          salaryOn(rulesFor, p, today);
          nextStepRaise(rulesFor, p, today);
          cumulativeSalary(rulesFor, p, today);
          yearToDateSalary(rulesFor, p, today);
          promotionPreview(rulesFor, p, today);
          seniorAllowance(rulesFor, p, today);
          const c = careerOf(rulesFor, p, Number(today.slice(0, 4)));
          minServiceDate(c, p.rankDate);
          longServiceInfo(c, p);
          seniorTreatmentInfo(c, p);
          effectiveRetirement(c, p);
          summarizeLeave(c.leave, p.hireDate, leaveData(), today);
          advanceLimitDays(c.leave, p.hireDate, today);
          upcomingBonuses(rulesFor, cal, p, 25, today, 6);
          buildMilestones(rulesFor, p, today);
        }).not.toThrow();
      }
    },
  );
  function leaveData() {
    return { records: [], grantOverrideHours: {}, savings: [], years: {} };
  }
});
