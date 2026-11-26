/**
 * 직종 해석(resolveCareer, #20 설계서 §4.3·§8.1).
 * 실제 규정 데이터(data/2026.json, 2027.json)를 쓴다. 기대 금액은 발췌본(docs/sources/2026)의 칸이다.
 */
import { describe, expect, it } from 'vitest';
import { rulesFor } from '../../src/lib/rules/index.ts';
import {
  DEFAULT_PENDING_REASON,
  RANK_MISSING_REASON,
  RANK_NOT_IN_LADDER_REASON,
  defaultSel,
  rankLabel,
  rankSlug,
  rankStepLabel,
  resolveCareer,
  selectableRanks,
  type CareerRules,
  type CareerSel,
  type PayInfo,
} from '../../src/lib/rules/career.ts';
import {
  FEATURE_KEYS,
  TRACK_IDS,
  isAvailable,
  type Avail,
  type PayTableId,
  type RetirementRules,
  type Rules,
  type TrackId,
} from '../../src/lib/rules/types.ts';
import { retirementInfo } from '../../src/lib/calc/retirement.ts';

const R = rulesFor(2026);
const R27 = rulesFor(2027);

function on<T extends object>(v: Avail<T>): T {
  if (!isAvailable(v)) throw new Error(`꺼진 항목: ${v.status} ${v.reason}`);
  return v;
}
const pay = (c: CareerRules): PayInfo => on(c.pay);
const sel = (
  track: TrackId,
  rank: string | null,
  payTable: PayTableId | null = null,
): CareerSel => ({
  track,
  payTable,
  rank,
});

/** 모든 직종 × 고를 수 있는 봉급표 × 고를 수 있는 계급(+계급 없음) */
function allSelections(rules: Rules): CareerSel[] {
  const out: CareerSel[] = [];
  for (const track of TRACK_IDS) {
    const tables: (PayTableId | null)[] =
      track === 'general' ? rules.tracks.items.general.payTables : [null];
    for (const payTable of tables) {
      const ranks = selectableRanks(rules, track, payTable);
      for (const r of ranks) out.push({ track, payTable, rank: r.key });
      out.push({ track, payTable, rank: null });
    }
  }
  return out;
}

describe('모든 조합이 예외 없이 해석된다', () => {
  it.each([2026, 2027])('%i년', (year) => {
    const rules = rulesFor(year);
    const all = allSelections(rules);
    expect(all.length).toBeGreaterThan(50);
    for (const s of all) {
      const c = resolveCareer(rules, s);
      expect(c.track.label.length).toBeGreaterThan(0);
      for (const f of [
        c.pay,
        c.stepRaise,
        c.promotionStep,
        c.retirement,
        c.probation,
        c.minService,
        c.longService,
        c.seniorTreatment,
        c.leave.annual,
        c.leave.advance,
        c.leave.compensation,
        c.leave.longService,
        c.allowances.diligence,
        c.allowances.diligenceExtra,
        c.allowances.holidayBonus,
        c.allowances.seniorTreatment,
        c.allowances.position,
      ]) {
        expect(f).toBeTruthy();
        if (!isAvailable(f as object)) {
          const off = f as { status: string; reason: string };
          // input: 계급을 고르지 않았거나 목록에 없음(조합에 그런 선택도 들어 있다)
          expect(['pending', 'none', 'external', 'input']).toContain(off.status);
        }
      }
      if (isAvailable(c.pay)) {
        expect(c.pay.row.length).toBeGreaterThanOrEqual(23);
        expect(c.rank?.payColumn).toBe(c.pay.column);
      }
    }
  });

  it('같은 규정·같은 선택이면 같은 객체(화면이 자주 불러도 다시 계산하지 않는다)', () => {
    const a = resolveCareer(R, sel('police', '경위'));
    expect(resolveCareer(R, sel('police', '경위'))).toBe(a);
    expect(resolveCareer(R27, sel('police', '경위'))).not.toBe(a);
  });
});

describe('일반직(별표 3)은 기본 구역 그대로', () => {
  it('7급: 봉급표·모든 항목이 기본 구역과 같은 객체', () => {
    const c = resolveCareer(R, sel('general', '7', 'table3'));
    expect(c.payTableId).toBe('table3');
    expect(c.ladderId).toBe('general');
    expect(pay(c)).toMatchObject({ tableId: 'table3', annex: '별표 3', column: '7' });
    expect(pay(c).row).toBe(R.salary.table['7']);
    expect(c.retirement).toBe(R.retirement);
    expect(c.probation).toBe(R.probation);
    expect(c.minService).toBe(R.promotion.minService);
    expect(c.longService).toBe(R.promotion.longService);
    expect(c.seniorTreatment).toBe(R.promotion.seniorTreatment);
    expect(c.leave.annual).toBe(R.leave.annual);
    expect(c.leave.advance).toBe(R.leave.advance);
    expect(c.leave.compensation).toBe(R.leave.compensation);
    expect(c.leave.longService).toBe(R.leave.longService);
    expect(c.allowances.diligence).toBe(R.allowances.diligence);
    expect(c.allowances.diligenceExtra).toBe(R.allowances.diligenceExtra);
    expect(c.allowances.position).toBe(R.allowances.position);
    expect(c.nextRank?.key).toBe('6');
    expect(c.rankUnknown).toBe(false);
    expect(c.payday.defaultDay).toBe(25);
    expect(rankStepLabel(c, 12)).toBe('7급 12호봉');
    expect(rankSlug(c)).toBe('7');
  });
  it('payTable 을 비워 두면 별표 3', () => {
    expect(resolveCareer(R, sel('general', '9', null)).payTableId).toBe('table3');
  });
  it('1급은 다음 직급이 없다', () => {
    expect(resolveCareer(R, sel('general', '1', 'table3')).nextRank).toBeNull();
  });
  it('일반직이 고를 수 없는 봉급표(별표 10)는 봉급을 끈다(별표 3 으로 바꾸지 않는다)', () => {
    const c = resolveCareer(R, sel('general', '7', 'table10'));
    expect(c.payTableId).toBeNull();
    expect(c.pay).toMatchObject({ status: 'pending' });
  });
});

describe('일반직 + 별표 4·8', () => {
  it('별표 4 공안 7급 1호봉 2,472,100원, 나머지 규정은 일반직과 같다', () => {
    const c = resolveCareer(R, sel('general', '7', 'table4'));
    expect(pay(c)).toMatchObject({ tableId: 'table4', annex: '별표 4', column: '7' });
    expect(pay(c).row[0]).toBe(2_472_100);
    expect(c.minService).toBe(R.promotion.minService);
    expect(c.longService).toBe(R.promotion.longService);
  });
  it('별표 8 우정: 사다리 postal, 승진소요 우정 값, 근속승진·시보 준비 중', () => {
    const c = resolveCareer(R, sel('general', '1', 'table8'));
    expect(c.ladderId).toBe('postal');
    expect(rankLabel(c)).toBe('우정1급');
    expect(pay(c).row[23]).toBe(6_201_400);
    const c3 = resolveCareer(R, sel('general', '3', 'table8'));
    expect(on(c3.minService).monthsByGrade['3']).toBe(18);
    expect(c3.longService).toMatchObject({ status: 'pending' });
    expect(c3.probation).toMatchObject({ status: 'pending' });
    expect(on(c3.seniorTreatment).monthsByGrade['3']).toBe(48);
    expect(on(c3.allowances.position).amountByGrade['3']).toBe(185_000);
    // 덮어쓰지 않은 항목은 일반직 값
    expect(c3.leave.annual).toBe(R.leave.annual);
    expect(c3.allowances.seniorTreatment).toBe(R.allowances.seniorTreatment);
    expect(rankSlug(c3)).toBe('postal6');
  });
});

describe('경찰', () => {
  it('경위: 별표 10 경위·소방위 열, 모든 항목이 켜져 있다(시보만 준비 중)', () => {
    const c = resolveCareer(R, sel('police', '경위'));
    expect(c.payTableId).toBe('table10');
    expect(pay(c)).toMatchObject({ annex: '별표 10', column: '경위·소방위', confirmed: true });
    expect(pay(c).row[0]).toBe(2_507_700);
    expect(pay(c).row).toHaveLength(31);
    for (const f of [
      c.stepRaise,
      c.promotionStep,
      c.retirement,
      c.minService,
      c.longService,
      c.seniorTreatment,
      c.leave.annual,
      c.leave.advance,
      c.leave.compensation,
      c.leave.longService,
      c.allowances.diligence,
      c.allowances.holidayBonus,
      c.allowances.seniorTreatment,
      c.allowances.position,
    ])
      expect(isAvailable(f as object)).toBe(true);
    expect(c.probation).toMatchObject({ status: 'pending' });
    expect(c.leave.annual).toBe(R.leave.annual);
    expect(on(c.minService).monthsByGrade['경위']).toBe(12);
    expect(on(c.longService)).toMatchObject({ reviewLeadDays: null, quotaTo: '경감' });
    expect(on(c.allowances.position).amountByGrade['경위']).toBe(185_000);
    expect(c.nextRank?.key).toBe('경감');
    expect(rankStepLabel(c, 3)).toBe('경위 3호봉');
    expect(rankSlug(c)).toBe('police3');
    expect(rankSlug(c, c.nextRank)).toBe('police4');
    expect(
      c.sources.some((s) => s.feature === 'leaveAnnual' && s.source.law === 'policeService'),
    ).toBe(true);
    expect(c.sources.some((s) => s.feature === 'rankLimit')).toBe(true);
  });
  it('경감 32호봉 5,372,500원, 총경 19호봉 5,893,300원', () => {
    expect(pay(resolveCareer(R, sel('police', '경감'))).row[31]).toBe(5_372_500);
    expect(pay(resolveCareer(R, sel('police', '총경'))).row[18]).toBe(5_893_300);
  });
  it('치안정감의 다음 계급(치안총감)은 봉급표 열이 없고 고를 수 없다', () => {
    const c = resolveCareer(R, sel('police', '치안정감'));
    expect(c.nextRank).toMatchObject({ key: '치안총감', payColumn: null, selectable: false });
    expect(c.nextRank?.note).toBe('별표 10 봉급표에 이 계급의 열이 없어요.');
    expect(selectableRanks(R, 'police', null).map((r) => r.key)).not.toContain('치안총감');
    // 저장본에 치안총감이 들어 있어도 예외 없이 "해당 없음"
    expect(resolveCareer(R, sel('police', '치안총감')).pay).toMatchObject({ status: 'none' });
  });
  it('계급정년은 경정·총경·경무관·치안감에만', () => {
    const r = on(resolveCareer(R, sel('police', '경정')).retirement) as RetirementRules;
    expect(r.rankLimit?.yearsByRank).toEqual({ 경정: 14, 총경: 11, 경무관: 6, 치안감: 4 });
    expect(r.age).toBe(60);
  });
});

describe('해양경찰·소방', () => {
  it('해양경찰: 봉급·정년·근속승진은 계산, 승진소요·대우공무원(수당)은 준비 중, 연가는 계산(T4)', () => {
    const c = resolveCareer(R, sel('coastGuard', '경위'));
    expect(pay(c).column).toBe('경위·소방위');
    expect(c.minService).toMatchObject({ status: 'pending' });
    expect(c.seniorTreatment).toMatchObject({ status: 'pending' });
    expect(c.allowances.seniorTreatment).toMatchObject({ status: 'pending' });
    expect(on(c.longService).monthsByGrade['경위']).toBe(96);
    expect(on(c.longService).quotaTo).toBeNull();
    expect(isAvailable(c.retirement)).toBe(true);
    expect(c.leave.annual).toBe(R.leave.annual);
    expect(c.leave.compensation).toBe(R.leave.compensation);
    // 밝히지 않은 항목(시보)은 자동으로 준비 중 + 직종의 사유
    expect(c.probation).toEqual({
      status: 'pending',
      reason: R.tracks.items.coastGuard.pendingReason,
    });
  });
  it('소방: 소방장 → 소방위, 근속승진 5일 전 심사, 장기재직휴가는 조례(external)', () => {
    const c = resolveCareer(R, sel('fire', '소방장'));
    expect(pay(c).column).toBe('경사·소방장');
    expect(c.nextRank?.key).toBe('소방위');
    expect(on(c.longService)).toMatchObject({ reviewLeadDays: 5, quotaTo: '소방경' });
    expect(on(c.longService).monthsByGrade['소방장']).toBe(78);
    expect(c.leave.longService).toMatchObject({ status: 'external' });
    expect(on(c.allowances.position).amountByGrade['소방장']).toBe(180_000);
    expect(rankSlug(c)).toBe('fire2');
  });
});

describe('교원', () => {
  const c = resolveCareer(R, sel('teacher', '교원'));
  it('봉급: 별표 11 한 열, 계급 이름 없음', () => {
    expect(pay(c)).toMatchObject({ tableId: 'table11', annex: '별표 11', column: '봉급' });
    expect(pay(c).row[39]).toBe(6_205_700);
    expect(rankLabel(c)).toBe('');
    expect(rankStepLabel(c, 12)).toBe('12호봉');
    expect(c.nextRank).toBeNull();
    expect(c.payday.defaultDay).toBe(17);
  });
  it('승진 계열은 해당 없음, 연가보상비 없음, 미리 쓰기는 예규 표, 직급보조비는 다른 기준', () => {
    for (const f of [
      c.promotionStep,
      c.minService,
      c.longService,
      c.seniorTreatment,
      c.allowances.seniorTreatment,
    ])
      expect(f).toMatchObject({ status: 'none' });
    expect(c.leave.compensation).toMatchObject({ status: 'none' });
    expect(on(c.leave.advance).tiers.map((t) => t.days)).toEqual([3, 4, 6, 7, 8, 10]);
    expect(c.leave.annual).toBe(R.leave.annual);
    expect(c.allowances.position).toMatchObject({ status: 'external' });
    expect(c.probation).toMatchObject({ status: 'pending' });
    expect(c.track.leaveScreen?.savingCarryOver).toBe(false);
  });
  it('정년(교육공무원법 제47조): 62세, 3~8월 → 8월 31일, 9~2월 → (다음 해) 2월 말일', () => {
    const r = on(c.retirement);
    const cases: [string, string, string][] = [
      ['1964-03-01', '2026-03-01', '2026-08-31'],
      ['1964-02-28', '2026-02-28', '2026-02-28'],
      ['1964-02-29', '2026-03-01', '2026-08-31'],
      ['1964-08-31', '2026-08-31', '2026-08-31'],
      ['1964-09-01', '2026-09-01', '2027-02-28'],
      ['1964-12-31', '2026-12-31', '2027-02-28'],
      ['1965-01-01', '2027-01-01', '2027-02-28'],
      ['1966-01-15', '2028-01-15', '2028-02-29'],
      ['1966-09-15', '2028-09-15', '2029-02-28'],
    ];
    for (const [birth, reach, retire] of cases) {
      expect(retirementInfo(r, birth), birth).toEqual({ reachDate: reach, retireDate: retire });
    }
  });
});

describe('외무·군무원·그 밖의 특정직', () => {
  it('외무 3등급: 별표 3 의 7급 열(5호봉 2,567,100원), 승급만 계산하고 나머지는 준비 중', () => {
    const c = resolveCareer(R, sel('foreign', '3'));
    expect(pay(c)).toMatchObject({ tableId: 'table3', column: '7' });
    expect(pay(c).row[4]).toBe(2_567_100);
    expect(c.stepRaise).toBe(R.stepRaise);
    expect(c.retirement).toMatchObject({ status: 'pending' });
    expect(c.promotionStep).toMatchObject({ status: 'pending' });
    expect(rankLabel(c)).toBe('3등급');
    expect(rankSlug(c)).toBe('foreign2');
  });
  it.each(['militaryCivil', 'otherSpecial'] as const)('%s: 봉급·승급부터 준비 중', (track) => {
    const c = resolveCareer(R, sel(track, null));
    expect(c.ladder).toBeNull();
    expect(c.rankUnknown).toBe(false);
    expect(c.pay).toMatchObject({ status: 'pending' });
    expect(c.stepRaise).toMatchObject({ status: 'pending' });
    // CareerRules 의 이름(leave.annual, allowances.position 등)으로 직접 적는다. FEATURE_KEYS 이름으로
    // 찾으면 leaveAnnual·diligence 등은 undefined 라 건너뛰어 일반직 값이 새어도 모른다.
    const features: Record<string, unknown> = {
      promotionStep: c.promotionStep,
      retirement: c.retirement,
      probation: c.probation,
      minService: c.minService,
      longService: c.longService,
      seniorTreatment: c.seniorTreatment,
      'leave.annual': c.leave.annual,
      'leave.advance': c.leave.advance,
      'leave.compensation': c.leave.compensation,
      'leave.longService': c.leave.longService,
      'allowances.diligence': c.allowances.diligence,
      'allowances.diligenceExtra': c.allowances.diligenceExtra,
      'allowances.holidayBonus': c.allowances.holidayBonus,
      'allowances.seniorTreatment': c.allowances.seniorTreatment,
      'allowances.position': c.allowances.position,
    };
    for (const [name, v] of Object.entries(features))
      expect(v, name).toMatchObject({ status: 'pending' });
    // 위 목록이 FEATURE_KEYS 를 모두 덮는지: stepRaise 는 위에서 따로 보고(+1),
    // allowances.diligenceExtra 는 FEATURE_KEYS 에 따로 없이 diligence 를 따른다(-1)
    expect(Object.keys(features).length).toBe(FEATURE_KEYS.length);
    expect(selectableRanks(R, track, null)).toEqual([]);
  });
  it('군무원 월급날 기본 10일', () => {
    expect(resolveCareer(R, sel('militaryCivil', null)).payday.defaultDay).toBe(10);
  });
  it('사다리가 없는 직종에 계급이 저장돼 있어도 무시한다(오류 아님)', () => {
    const c = resolveCareer(R, sel('militaryCivil', '군무원1급'));
    expect(c.rank).toBeNull();
    expect(c.rankUnknown).toBe(false);
  });
});

describe('계급이 없거나 사다리에 없을 때', () => {
  it('사다리가 있는데 계급이 null → 계급을 골라 주세요', () => {
    const c = resolveCareer(R, sel('police', null));
    expect(c).toMatchObject({
      rankUnknown: true,
      rankProblem: 'missing',
      rank: null,
      nextRank: null,
    });
    expect(c.pay).toEqual({ status: 'input', reason: RANK_MISSING_REASON });
  });
  it('사다리에 없는 계급 → 계급을 다시 골라 주세요(계급 기준 값은 찾지 못한다)', () => {
    const c = resolveCareer(R, sel('general', '경위', 'table3'));
    expect(c).toMatchObject({ rankUnknown: true, rankProblem: 'notInLadder' });
    // 사유는 사다리 이름을 따른다(일반직은 '직급')
    expect(c.pay).toEqual({ status: 'input', reason: '직급을 다시 골라 주세요.' });
    expect(resolveCareer(R, sel('police', '7')).pay).toEqual({
      status: 'input',
      reason: RANK_NOT_IN_LADDER_REASON,
    });
    expect(resolveCareer(R, sel('foreign', null)).pay).toEqual({
      status: 'input',
      reason: '직무등급을 골라 주세요.',
    });
    expect(on(c.minService).monthsByGrade['경위']).toBeUndefined();
    const t = resolveCareer(R, sel('teacher', '9'));
    expect(t.rankProblem).toBe('notInLadder');
  });
});

describe('자동 안전장치', () => {
  it('덮어쓰기도 적용 근거도 없는 항목은 준비 중(일반직 값이 새지 않는다)', () => {
    const fake: Rules = {
      ...R,
      tracks: {
        ...R.tracks,
        items: {
          ...R.tracks.items,
          police: {
            label: '가짜',
            status: 'ready',
            scope: '',
            payTables: ['table10'],
            ladder: 'police',
            payday: { defaultDay: 25, note: '' },
            applies: { stepRaise: { law: 'pay', article: '제13조' } },
          },
        },
      },
    };
    const c = resolveCareer(fake, sel('police', '경위'));
    expect(c.stepRaise).toBe(R.stepRaise);
    expect(pay(c).row[0]).toBe(2_507_700);
    for (const v of [
      c.retirement,
      c.minService,
      c.leave.annual,
      c.allowances.diligence,
      c.allowances.position,
    ]) {
      expect(v).toEqual({ status: 'pending', reason: DEFAULT_PENDING_REASON });
    }
  });
  it('사다리에서 계급 하나가 빠진 데이터에서도 예외 없이 "다시 골라 주세요"', () => {
    const fake: Rules = {
      ...R,
      tracks: {
        ...R.tracks,
        ladders: {
          ...R.tracks.ladders,
          police: {
            ...R.tracks.ladders.police,
            ranks: R.tracks.ladders.police.ranks.filter((r) => r.key !== '경위'),
          },
        },
      },
    };
    expect(resolveCareer(fake, sel('police', '경위')).rankProblem).toBe('notInLadder');
  });
});

describe('기본 선택·고를 수 있는 계급', () => {
  it('직종별 기본값', () => {
    expect(defaultSel(R, 'general')).toEqual({ track: 'general', payTable: 'table3', rank: '9' });
    expect(defaultSel(R, 'police')).toEqual({ track: 'police', payTable: null, rank: '순경' });
    expect(defaultSel(R, 'fire').rank).toBe('소방사');
    expect(defaultSel(R, 'teacher').rank).toBe('교원');
    expect(defaultSel(R, 'foreign').rank).toBe('1');
    expect(defaultSel(R, 'militaryCivil')).toEqual({
      track: 'militaryCivil',
      payTable: null,
      rank: null,
    });
  });
  it('고를 수 있는 계급: 경찰 10개(치안총감 제외), 우정 9개, 외무 6개', () => {
    expect(selectableRanks(R, 'police', null)).toHaveLength(10);
    expect(selectableRanks(R, 'general', 'table8').map((r) => r.label)[0]).toBe('우정9급');
    expect(selectableRanks(R, 'foreign', null)).toHaveLength(6);
    expect(selectableRanks(R, 'teacher', null)).toHaveLength(1);
  });
});

describe('2027년: 봉급표 확정 전', () => {
  it('직종 봉급표도 2026년 표(확정 전)', () => {
    const c = resolveCareer(R27, sel('police', '경위'));
    expect(pay(c)).toMatchObject({ tableYear: 2026, confirmed: false });
    expect(pay(resolveCareer(R27, sel('general', '7', 'table3')))).toMatchObject({
      tableYear: 2026,
      confirmed: false,
    });
  });
});
