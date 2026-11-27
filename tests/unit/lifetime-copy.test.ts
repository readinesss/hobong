/**
 * '생애 봉급' 창의 문구(#30) — src/lib/app/lifetime-copy.ts.
 * 숫자·낱말을 받아 문장을 만드는 함수들이 상태마다 맞는 말을 하는지 본다(설계서 §5·§6).
 */
import { describe, expect, it } from 'vitest';
import {
  LIFETIME_MASKED,
  LIFETIME_MASKED_ISSUE,
  PLAN_OFFER,
  PLAN_RANK_LIMIT_OFFER,
  PLAN_STORAGE_NOTE,
  PLAN_WHY_MONTH,
  assumptions,
  beyondRankLimitNote,
  checkRetirePlan,
  formatYearMonth,
  headline,
  hobongLine,
  notice,
  paydayLine,
  pendingTableNote,
  planAnnouncement,
  planIssueNote,
  planPreview,
  planResetLabel,
  planScopeNote,
  raiseLine,
  rankLimitNote,
  sameMonthNote,
  shownPercent,
  spanYearsMonths,
  spokenSummary,
  spokenSummaryMasked,
  type AssumptionInput,
  type RetirePlanCheck,
} from '../../src/lib/app/lifetime-copy.ts';
import { resolveLifetimeEnd } from '../../src/lib/calc/lifetime.ts';
import type { EffectiveRetirement } from '../../src/lib/calc/retirement.ts';

const baseHow: AssumptionInput = {
  lifetime: { tableYear: 2026, maxStep: 31, stepAtEnd: 31 },
  noun: '직급',
  periodMonths: 12,
  basis: 'retirement',
  retired: false,
  newYears: 22,
  payday: 25,
  diligenceMonths: [1, 7],
  holidayBonus: true,
  longServiceAddOn: false,
  retireBasis: '국가공무원법 제74조제1항·제4항',
};
const titles = (a: AssumptionInput) => assumptions(a).map((x) => x.title);
const textOf = (a: AssumptionInput, title: string) =>
  assumptions(a).find((x) => x.title === title)?.text ?? '';

describe('첫 줄과 낭독 요약', () => {
  it('정년 기준·계급정년·정년 뒤·정한 달', () => {
    expect(
      headline({ basis: 'retirement', date: '2048-12-31', cause: 'age', retired: false }),
    ).toBe('정년퇴직일(2048년 12월 31일)까지 다닌다면');
    expect(
      headline({ basis: 'retirement', date: '2034-06-30', cause: 'rankLimit', retired: false }),
    ).toBe('계급정년 퇴직일(2034년 6월 30일)까지 다닌다면');
    expect(headline({ basis: 'retirement', date: '2026-06-30', cause: 'age', retired: true })).toBe(
      '정년퇴직일(2026년 6월 30일)까지',
    );
    expect(headline({ basis: 'plan', date: '2030-03-31', cause: 'age', retired: false })).toBe(
      '2030년 3월까지 다닌다면',
    );
    expect(formatYearMonth('2043-07-01')).toBe('2043년 7월');
    expect(formatYearMonth('2030-03')).toBe('2030년 3월');
    expect(spanYearsMonths({ years: 3, months: 4, days: 4 })).toBe('3년 4개월');
    expect(spanYearsMonths({ years: 0, months: 0, days: 3 })).toBe('3일');
  });
  it('낭독 요약: 금액을 보일 때와 가릴 때', () => {
    const head = '정년퇴직일(2048년 12월 31일)까지 다닌다면';
    const percent = shownPercent({ ratio: 0.2926, earned: 457_731_450, remaining: 1 });
    expect(spokenSummary(head, 1_564_335_000, 457_731_450, percent)).toBe(
      `${head} 봉급만 셈한 생애 봉급 추정 합계는 약 15억 6,433만 원이고, 지금까지 약 4억 5,773만 원, 29%를 벌었어요.`,
    );
    const masked = spokenSummaryMasked(head, percent);
    expect(masked).toBe(`${head} 봉급만 셈한 생애 봉급의 29%를 벌었어요. 금액은 가려져 있어요.`);
    expect(masked).not.toMatch(/\d억|만 원/);
    const tiny = shownPercent({ ratio: 0.0001, earned: 68_806, remaining: 1 });
    expect(spokenSummaryMasked(head, tiny)).toContain('1% 미만을 벌었어요');
  });
  it('계급정년 안내는 사실만 말한다', () => {
    expect(rankLimitNote('2040-12-31')).toBe(
      '승진하면 퇴직일도 금액도 달라질 수 있어요. 연령정년 퇴직일은 2040년 12월 31일이에요.',
    );
  });
});

describe('늘 보이는 고지', () => {
  it('봉급만의 합계·받는 돈이 아님·퇴직급여 미포함·임용일부터를 늘 말한다', () => {
    for (const noun of ['직급', '계급', '직무등급', '']) {
      const text = notice(noun, 2026);
      for (const phrase of [
        '임용일부터 퇴직 때까지',
        '2026년 봉급표 그대로',
        '봉급만의 합계예요',
        '실제로 받는 돈이 아니에요',
        '수당·세금·기여금·퇴직급여(연금·퇴직수당)는 들어 있지 않고',
      ])
        expect(text, noun).toContain(phrase);
    }
  });
  it('계급 낱말의 조사를 받침에 맞춘다. 계급 이름이 없는 봉급표는 계급·승진을 말하지 않는다', () => {
    expect(notice('직급', 2026)).toContain('지금 직급과 2026년');
    expect(notice('계급', 2026)).toContain('지금 계급과 2026년');
    expect(notice('직급', 2026)).toContain('봉급 인상과 승진도 넣지 않았어요.');
    const teacher = notice('', 2026);
    // ('퇴직급여'에 '직급'이 들어 있어 낱말 경계로 본다)
    expect(teacher).not.toMatch(/지금 |계급|승진|직급[과와이가]/);
    expect(teacher).toContain('봉급 인상도 넣지 않았어요.');
    expect(pendingTableNote(2027, 2026)).toBe(
      '2027년 봉급표가 아직 반영되지 않아 2026년 표로 셈했어요.',
    );
  });
});

describe('횟수 줄', () => {
  it('월급날: 보통 / 오늘이 월급날 / 마지막 달(월급날 지남) / 정년 뒤', () => {
    expect(paydayLine({ received: 161, left: 265, todayCounted: false }, false)).toEqual({
      label: '남은 월급날',
      value: '265번',
      aside: '지금까지 161번',
    });
    expect(paydayLine({ received: 51, left: 355, todayCounted: true }, false).aside).toBe(
      '오늘이 51번째 월급날이에요',
    );
    expect(paydayLine({ received: 161, left: 0, todayCounted: false }, false)).toEqual({
      label: '남은 월급날',
      value: '없음',
      aside: '이번 달 월급날은 지났어요',
    });
    expect(paydayLine({ received: 1, left: 415, todayCounted: true }, false).aside).toBe(
      '오늘이 첫 월급날이에요',
    );
    expect(paydayLine({ received: 426, left: 0, todayCounted: true }, false).aside).toBe(
      '오늘이 426번째 월급날이에요',
    );
    expect(paydayLine({ received: 434, left: 0, todayCounted: false }, true)).toEqual({
      label: '받은 월급날',
      value: '434번',
      aside: '',
    });
    expect(paydayLine({ received: 1200, left: 1000, todayCounted: false }, false).value).toBe(
      '1,000번',
    );
  });
  it('정기승급: 최고호봉 도달 달 / 퇴직 때 호봉 / 지금 최고호봉 / 퇴직 전 승급 없음', () => {
    const base = { stepNow: 14, stepAtEnd: 31, maxStep: 31 };
    expect(raiseLine({ ...base, raisesLeft: 17, maxStepDate: '2043-07-01' })).toEqual({
      label: '남은 정기승급',
      value: '17번',
      aside: '2043년 7월에 최고호봉',
    });
    expect(raiseLine({ ...base, stepAtEnd: 17, raisesLeft: 3, maxStepDate: null }).aside).toBe(
      '퇴직 때 17호봉',
    );
    expect(
      raiseLine({ stepNow: 31, stepAtEnd: 31, maxStep: 31, raisesLeft: 0, maxStepDate: null }),
    ).toMatchObject({ value: '없음', aside: '지금 최고호봉이에요' });
    expect(
      raiseLine({ stepNow: 14, stepAtEnd: 14, maxStep: 31, raisesLeft: 0, maxStepDate: null }),
    ).toMatchObject({ value: '없음', aside: '퇴직 전 승급 없음' });
  });
});

describe('호봉이의 한마디', () => {
  const p = (value: number) =>
    shownPercent({ ratio: (value + 0.5) / 100, earned: 1, remaining: 1 });
  const base = {
    retired: false,
    basis: 'retirement' as const,
    paydays: { received: 161, left: 265 },
    timePercent: 37,
    moneyPercent: p(29),
    raisesLeft: 17,
  };
  it('위에서부터 먼저 맞는 것 하나', () => {
    expect(hobongLine({ ...base, retired: true })).toBe(
      '마지막 월급날까지 다 받았어요. 오래 애쓰셨어요.',
    );
    expect(hobongLine({ ...base, paydays: { received: 400, left: 12 } })).toBe(
      '월급날이 12번 남았어요. 한 번 한 번이 아쉬워요.',
    );
    expect(hobongLine({ ...base, paydays: { received: 0, left: 415 } })).toBe(
      '첫 월급날이 다가오고 있어요.',
    );
    expect(hobongLine(base)).toBe(
      '기간은 37% 지났는데 봉급은 29% 받았어요. 호봉이 오를수록 뒤쪽 달이 더 두둑해요.',
    );
  });
  it('더 오를 호봉이 없으면 사실만 말한다', () => {
    expect(hobongLine({ ...base, timePercent: 95, moneyPercent: p(92), raisesLeft: 0 })).toBe(
      '기간은 95% 지났는데 봉급은 92% 받았어요.',
    );
  });
  it('차이가 3 미만이거나 %를 셀 수 없으면 말하지 않는다', () => {
    expect(hobongLine({ ...base, timePercent: 31 })).toBeNull();
    expect(hobongLine({ ...base, timePercent: 32 })).not.toBeNull();
    expect(hobongLine({ ...base, moneyPercent: null })).toBeNull();
    expect(hobongLine({ ...base, timePercent: null })).toBeNull();
    // 봉급이 꺼진 직종에서 남은 월급날이 13번 이상이면 할 말이 없다
    expect(hobongLine({ ...base, paydays: { received: 106, left: 13 }, moneyPercent: null })).toBe(
      null,
    );
    const tiny = shownPercent({ ratio: 0.001, earned: 100_000, remaining: 1 });
    expect(hobongLine({ ...base, paydays: { received: 1, left: 400 }, moneyPercent: tiny })).toBe(
      null,
    );
  });
  it('한마디에는 금액이 없다', () => {
    for (const line of [
      hobongLine(base),
      hobongLine({ ...base, retired: true }),
      hobongLine({ ...base, paydays: { received: 400, left: 3 } }),
      hobongLine({ ...base, basis: 'plan' }),
    ])
      expect(line).not.toMatch(/원|억|만 /);
  });
});

describe('자세한 가정', () => {
  it('일반직(정근수당 줄을 보일 때): 아홉 항목', () => {
    expect(titles(baseHow)).toEqual([
      '봉급표',
      '직급·호봉',
      '빠진 것',
      '휴직·징계·승급 제한',
      '달 가운데 임용·승급',
      '퇴직하는 달',
      '월급날 횟수',
      '정근수당 횟수',
      '근거',
    ]);
    expect(textOf(baseHow, '봉급표')).toBe(
      '2026년 봉급표 한 장을 임용일부터 퇴직일까지 그대로 썼어요. 그래서 지난 날도 앞날도 실제 금액과 달라요. 봉급표는 공무원보수규정이 개정되면 바뀌고, 그때 이 창의 숫자가 한꺼번에 달라져요. 퇴직까지 해가 22번 바뀌어요.',
    );
    expect(textOf(baseHow, '직급·호봉')).toBe(
      '지금 직급이 그대로라고 보고 정기승급(1년에 한 호봉, 최고호봉 31호봉까지)만 넣었어요. 지난 날도 지금 직급으로 거슬러 셈했어요. 승진하면 직급과 호봉이 다시 정해져요.',
    );
    expect(textOf(baseHow, '퇴직하는 달')).toContain('정년퇴직일 당일까지 봉급을 셌어요.');
    expect(textOf(baseHow, '퇴직하는 달')).toContain('공무원보수규정 제22조·제24조');
    expect(textOf(baseHow, '월급날 횟수')).toContain('월급날(25일)이 그대로라고 보고 셌어요.');
    expect(textOf(baseHow, '정근수당 횟수')).toBe(
      '1월 1일·7월 1일에 재직 중인 것만 셌어요(공무원수당 등에 관한 규정 제7조). 징계·휴직으로 받지 못하는 경우는 넣지 않았어요.',
    );
    expect(textOf(baseHow, '근거')).toBe(
      '공무원보수규정 제13조(정기승급)·제20조(보수 지급일)·제22조(보수 계산)·제24조, 공무원수당 등에 관한 규정 제7조, 국가공무원법 제74조제1항·제4항.',
    );
  });
  it('해가 바뀌지 않으면 그 문장을 뺀다. 정한 달 기준이면 그 달 말일까지로 말한다', () => {
    expect(textOf({ ...baseHow, newYears: 0 }, '봉급표')).not.toContain('해가');
    expect(textOf({ ...baseHow, basis: 'plan' }, '퇴직하는 달')).toContain(
      '그 달 말일까지 다니는 것으로 셈했어요.',
    );
  });
  it('계급 낱말의 조사, 계급 이름이 없는 봉급표', () => {
    expect(textOf({ ...baseHow, noun: '계급' }, '계급·호봉')).toContain('지금 계급이 그대로');
    expect(textOf({ ...baseHow, noun: '계급' }, '계급·호봉')).toContain('지금 계급으로 거슬러');
    expect(textOf({ ...baseHow, noun: '직무등급' }, '직무등급·호봉')).toContain(
      '승진하면 직무등급과 호봉이',
    );
    const teacher = {
      ...baseHow,
      noun: '',
      lifetime: { tableYear: 2026, maxStep: 40, stepAtEnd: 40 },
    };
    expect(textOf(teacher, '호봉')).toBe(
      '정기승급(1년에 한 호봉, 최고호봉 40호봉까지)만 넣었어요.',
    );
    expect(titles(teacher)).not.toContain('직급·호봉');
  });
  it('근속가봉은 금액이 원문에 있는 봉급표이고 퇴직 때 최고호봉일 때만 밝힌다', () => {
    expect(titles(baseHow)).not.toContain('근속가봉');
    const table11 = { ...baseHow, noun: '', longServiceAddOn: true };
    expect(textOf(table11, '근속가봉')).toBe(
      '최고호봉 뒤에 붙을 수 있는 근속가봉(공무원보수규정 제30조의2)은 넣지 않았어요.',
    );
    expect(
      titles({ ...table11, lifetime: { tableYear: 2026, maxStep: 40, stepAtEnd: 39 } }),
    ).not.toContain('근속가봉');
  });
  it('정년퇴직일이 지났으면 앞날에 관한 말을 뺀다', () => {
    const done = { ...baseHow, retired: true, newYears: 0, diligenceMonths: null };
    expect(textOf(done, '월급날 횟수')).toBe(
      '월급날(25일)이 그대로라고 보고 셌어요. 임용한 달은 임용일이 그 달 월급날보다 뒤면 세지 않았어요. 지난 해의 공휴일은 반영하지 못해 임용한 달은 한 번 다를 수 있어요.',
    );
    for (const a of assumptions(done)) expect(a.text, a.title).not.toMatch(/앞으로|남은/);
  });
  it('봉급이 꺼진 직종: 금액에 관한 항목 없이 월급날 횟수와 근거만', () => {
    const off = {
      ...baseHow,
      lifetime: null,
      diligenceMonths: null,
      holidayBonus: false,
      retireBasis: '',
    };
    expect(titles(off)).toEqual(['월급날 횟수', '근거']);
    expect(textOf(off, '월급날 횟수')).not.toMatch(/금액|명절휴가비/);
    expect(textOf(off, '근거')).toBe('공무원보수규정 제20조(보수 지급일).');
  });
});

describe('퇴직 예정 달: 폼 검사(U28)', () => {
  /** P7(7급, 정년 2048-12-31), 오늘 2026-11-27 */
  const p7: RetirePlanCheck = {
    minMonth: '2026-11',
    ageRetireDate: '2048-12-31',
    hasRankLimit: false,
    hireDate: '2013-07-01',
  };
  /** PK(경정, 계급정년 2034-06-30, 연령정년 2040-12-31) */
  const pk: RetirePlanCheck = { ...p7, ageRetireDate: '2040-12-31', hasRankLimit: true };
  /** 정년 규정이 꺼진 직종(외무 등): 확인한 상한이 없다 */
  const off: RetirePlanCheck = { ...p7, ageRetireDate: null };

  it('비었거나 형식이 틀리면 연도와 달을 넣어 달라고 한다', () => {
    for (const bad of ['', '2030', '2030-3', '2030-13', '2030-00', '203-01', '2030-03-15', 'abc'])
      expect(checkRetirePlan(bad, p7), bad).toBe('연도와 달을 넣어 주세요.');
  });
  it('이번 달보다 앞이면 이번 달부터라고 알린다. 이번 달은 고를 수 있다', () => {
    expect(checkRetirePlan('2026-10', p7)).toBe('이번 달(2026년 11월)부터 고를 수 있어요.');
    expect(checkRetirePlan('1999-01', p7)).toBe('이번 달(2026년 11월)부터 고를 수 있어요.');
    expect(checkRetirePlan('2026-11', p7)).toBeNull();
  });
  it('연령정년 퇴직일의 달보다 뒤면 그 달까지만이라고 알린다(계급정년이 있는 직종은 연령정년이라고 밝힌다)', () => {
    expect(checkRetirePlan('2049-01', p7)).toBe(
      '정년퇴직일이 2048년 12월 31일이라 2048년 12월까지만 고를 수 있어요.',
    );
    expect(checkRetirePlan('2041-01', pk)).toBe(
      '연령정년 퇴직일이 2040년 12월 31일이라 2040년 12월까지만 고를 수 있어요.',
    );
    // 교원의 2월 말일(윤년) 정년: 그 달은 되고 다음 달은 안 된다
    const teacher = { ...p7, ageRetireDate: '2048-02-29' };
    expect(checkRetirePlan('2048-02', teacher)).toBeNull();
    expect(checkRetirePlan('2048-03', teacher)).toBe(
      '정년퇴직일이 2048년 2월 29일이라 2048년 2월까지만 고를 수 있어요.',
    );
  });
  it('정년퇴직일과 같은 달·계급정년 뒤(연령정년 이내)는 오류가 아니다(그대로 저장한다)', () => {
    expect(checkRetirePlan('2048-12', p7)).toBeNull();
    expect(checkRetirePlan('2034-06', pk)).toBeNull();
    expect(checkRetirePlan('2036-12', pk)).toBeNull();
    expect(checkRetirePlan('2040-12', pk)).toBeNull();
  });
  it('정년 규정이 꺼진 직종은 나이 상한을 만들지 않고 날짜 계산이 다루는 해(2150년)까지만 본다', () => {
    expect(checkRetirePlan('2099-12', off)).toBeNull();
    expect(checkRetirePlan('2150-12', off)).toBeNull();
    expect(checkRetirePlan('2151-01', off)).toBe('2150년까지만 고를 수 있어요.');
  });
  it('임용일이 앞날로 저장된 드문 경우: 임용일이 있는 달부터', () => {
    const future = { ...p7, hireDate: '2027-03-02' };
    expect(checkRetirePlan('2026-12', future)).toBe(
      '임용일(2027년 3월 2일)이 있는 달부터 고를 수 있어요.',
    );
    expect(checkRetirePlan('2027-03', future)).toBeNull();
  });
  it('폼이 받은 달은 계산에서도 쓸 수 있는 달이다(폼 검사와 resolveLifetimeEnd 의 범위가 같다)', () => {
    // PK: 계급정년 퇴직일 2034-06-30, 연령정년 퇴직일 2040-12-31
    const retirement: EffectiveRetirement = {
      age: { reachDate: '2040-08-15', retireDate: '2040-12-31' },
      ageYears: 60,
      rankLimit: {
        years: 14,
        reachDate: '2034-03-01',
        retireDate: '2034-06-30',
        overridden: false,
        boundary: true,
      },
      retireDate: '2034-06-30',
      cause: 'rankLimit',
    };
    for (let y = 2026; y <= 2042; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const month = `${y}-${String(m).padStart(2, '0')}`;
        const end = resolveLifetimeEnd({
          today: '2026-11-27',
          hireDate: '2005-04-01',
          retirement,
          ageRetireDate: '2040-12-31',
          planMonth: month,
        });
        const ok = checkRetirePlan(month, { ...pk, hireDate: '2005-04-01' }) === null;
        expect(end.planIssue === null, month).toBe(ok);
        expect(end.planHeld, month).toBe(true);
      }
    }
  });
});

describe('퇴직 예정 달: 안내 문구', () => {
  it('폼의 둘째 줄은 맞는 달이면 그 달 말일을 보여 준다', () => {
    expect(planPreview('2030-03')).toBe('그 달 말일(2030년 3월 31일)까지 다니는 것으로 셈해요.');
    expect(planPreview('2028-02')).toBe('그 달 말일(2028년 2월 29일)까지 다니는 것으로 셈해요.');
    expect(planPreview('')).toBe('그 달 말일까지 다니는 것으로 셈해요.');
    expect(planPreview('2030-13')).toBe('그 달 말일까지 다니는 것으로 셈해요.');
  });
  it('정하거나 되돌린 뒤 알리는 말: 금액 가리기 중에는 달을 뺀다', () => {
    const shown = { masked: false, hasRetirement: true };
    expect(planAnnouncement('2030-03', shown)).toBe('퇴직 예정 달을 2030년 3월로 정했어요.');
    expect(planAnnouncement('2031-06', { ...shown, masked: true })).toBe(
      '퇴직 예정 달을 정했어요.',
    );
    expect(planAnnouncement('2031-06', { ...shown, masked: true })).not.toMatch(/\d/);
    expect(planAnnouncement(null, shown)).toBe('정년까지로 되돌렸어요.');
    expect(planAnnouncement(null, { masked: true, hasRetirement: false })).toBe(
      '정한 달을 지웠어요.',
    );
  });
  it('되돌리는 버튼: 정년을 계산하지 못하는 직종은 돌아갈 정년이 없다', () => {
    expect(planResetLabel(true)).toBe('정년까지로 되돌리기');
    expect(planResetLabel(false)).toBe('정한 달 지우기');
    expect(planScopeNote(true)).toContain('정년퇴직일 그대로예요');
    expect(planScopeNote(false)).toBe('정한 달은 이 창의 셈에만 써요.');
  });
  it('쓸 수 없게 된 정한 달: 지남 / 정년 뒤(계급정년이 있는 직종은 연령정년) / 임용 전', () => {
    const base = {
      month: '2027-03',
      ageRetireDate: '2048-12-31',
      hasRankLimit: false,
      hireDate: '2013-07-01',
      fallback: true,
    };
    expect(planIssueNote({ ...base, issue: 'past' })).toBe(
      '정해 둔 퇴직 예정 달(2027년 3월)이 지났어요. 지금은 정년까지로 셈했어요.',
    );
    expect(planIssueNote({ ...base, issue: 'afterLimit', month: '2049-01' })).toBe(
      '정해 둔 퇴직 예정 달(2049년 1월)이 정년퇴직일(2048년 12월 31일)보다 뒤예요. 지금은 정년까지로 셈했어요.',
    );
    expect(
      planIssueNote({
        ...base,
        issue: 'afterLimit',
        month: '2041-01',
        ageRetireDate: '2040-12-31',
        hasRankLimit: true,
        fallback: false,
      }),
    ).toBe('정해 둔 퇴직 예정 달(2041년 1월)이 연령정년 퇴직일(2040년 12월 31일)보다 뒤예요.');
    expect(
      planIssueNote({ ...base, issue: 'beforeHire', month: '2026-12', hireDate: '2027-03-02' }),
    ).toBe(
      '정해 둔 퇴직 예정 달(2026년 12월)이 임용일(2027년 3월 2일)보다 앞이에요. 지금은 정년까지로 셈했어요.',
    );
    // 정년을 계산하지 못하는 직종: 대신 셈한 것이 없으므로 뒷말을 붙이지 않는다
    expect(planIssueNote({ ...base, issue: 'past', month: '2026-10', fallback: false })).toBe(
      '정해 둔 퇴직 예정 달(2026년 10월)이 지났어요.',
    );
  });
  it('금액 가리기 중의 한 줄에는 달도, 무엇이 문제인지도 없다', () => {
    for (const text of [LIFETIME_MASKED, LIFETIME_MASKED_ISSUE]) {
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/지났|뒤예요|앞이에요/);
    }
    expect(LIFETIME_MASKED_ISSUE).toBe('정해 둔 퇴직 예정 달을 확인해 주세요.');
  });
  it('계급정년 뒤를 정했을 때: 사실만 말하고 근무 조건을 단정하지 않는다', () => {
    const text = beyondRankLimitNote('2034-06-30', '계급', true);
    expect(text).toBe(
      '계급정년 퇴직일(2034년 6월 30일)보다 뒤예요. 승진하거나 계급정년에 이르는 날이 달라지면 퇴직일이 달라질 수 있어요. 금액은 지금 계급 그대로 셈했어요.',
    );
    expect(text).not.toMatch(/승진해야|해야 다닐|다닐 수 없/);
    // 금액을 보이지 않을 때는 금액 문장을 뺀다
    expect(beyondRankLimitNote('2034-06-30', '계급', false)).not.toContain('금액');
  });
  it('정한 달이 정년퇴직일(또는 계급정년 퇴직일)과 같은 달', () => {
    expect(sameMonthNote('2048-12', 'age')).toBe(
      '정한 달(2048년 12월)이 정년퇴직일과 같은 달이에요.',
    );
    expect(sameMonthNote('2034-06', 'rankLimit')).toBe(
      '정한 달(2034년 6월)이 계급정년 퇴직일과 같은 달이에요.',
    );
  });
  it('폼 아래 안내: 달로 받는 까닭(조문)과 패키지에 그대로 실린다는 것(암호를 걸면 가려진다)', () => {
    expect(PLAN_WHY_MONTH).toContain('날짜가 아니라 달');
    expect(PLAN_WHY_MONTH).toContain('공무원보수규정 제22조·제24조');
    expect(PLAN_STORAGE_NOTE).toContain('임용정보 패키지');
    expect(PLAN_STORAGE_NOTE).toContain('그대로 실려요');
    expect(PLAN_STORAGE_NOTE).toContain('암호');
    expect(PLAN_STORAGE_NOTE).toContain('카드에는 들어가지 않아요');
    // 패키지 안내("공유 폴더에는 두지 말아 주세요")와 어긋나게 두는 것을 전제로 말하지 않는다
    expect(PLAN_STORAGE_NOTE).not.toMatch(/함께 쓰는|공유 폴더에 둘/);
    expect(PLAN_OFFER).toContain('퇴직 예정 달을 정하면');
    expect(PLAN_RANK_LIMIT_OFFER).toContain('퇴직 예정 달을 정해 보세요');
  });
});

describe('말투', () => {
  it('해요체이고, 숫자·나이·직급을 품평하지 않는다', () => {
    const issue = {
      month: '2027-03',
      ageRetireDate: '2048-12-31',
      hasRankLimit: true,
      hireDate: '2013-07-01',
      fallback: true,
    };
    const all = [
      notice('직급', 2026),
      notice('', 2026),
      pendingTableNote(2027, 2026),
      rankLimitNote('2040-12-31'),
      LIFETIME_MASKED,
      LIFETIME_MASKED_ISSUE,
      PLAN_OFFER,
      PLAN_RANK_LIMIT_OFFER,
      PLAN_STORAGE_NOTE,
      PLAN_WHY_MONTH,
      planScopeNote(true),
      planPreview('2030-03'),
      planAnnouncement('2030-03', { masked: false, hasRetirement: true }),
      planAnnouncement(null, { masked: false, hasRetirement: true }),
      planIssueNote({ ...issue, issue: 'past' }),
      planIssueNote({ ...issue, issue: 'afterLimit' }),
      planIssueNote({ ...issue, issue: 'beforeHire' }),
      beyondRankLimitNote('2034-06-30', '계급', true),
      sameMonthNote('2048-12', 'age'),
      checkRetirePlan('', { ...issue, minMonth: '2026-11' }) ?? '',
      checkRetirePlan('2026-10', { ...issue, minMonth: '2026-11' }) ?? '',
      checkRetirePlan('2049-01', { ...issue, minMonth: '2026-11' }) ?? '',
      ...assumptions(baseHow).map((a) => a.text),
      ...assumptions({ ...baseHow, basis: 'plan', longServiceAddOn: true }).map((a) => a.text),
      hobongLine({
        retired: false,
        basis: 'retirement',
        paydays: { received: 1, left: 400 },
        timePercent: 37,
        moneyPercent: shownPercent({ ratio: 0.295, earned: 1, remaining: 1 }),
        raisesLeft: 17,
      }) ?? '',
    ];
    for (const text of all) {
      expect(text, text).not.toMatch(/니다([.!?\s]|$)/);
      expect(text, text).not.toMatch(/빠르|빨리|젊|벌써|늦|어리|대단|높으시|낮으시/);
      expect(text, text).not.toMatch(/\((은|는|이|가|을|를|과|와|으로)\)/);
    }
  });
});
