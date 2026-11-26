/**
 * 직종 해석(#20) — 직종·봉급표·계급에 따라 "이 사람에게 적용할 규정"을 고르는 유일한 자리(순수 함수).
 *
 * 규정 데이터의 열한 개 기본 구역은 일반직 값이다. 다른 직종은 tracks 구역에서
 * 1. 덮어쓰기 값이 있으면 그것을(값이 { status } 이면 그 항목은 꺼진다),
 * 2. 없고 applies 에 적용 근거가 있으면 기본 구역(일반직 값)을,
 * 3. 둘 다 없으면 일반직은 기본 구역, 그 밖의 직종은 자동으로 "준비 중(pending)"을 쓴다.
 * 3번 덕분에 데이터를 빠뜨려도 틀린 숫자 대신 "준비 중"이 뜬다.
 *
 * 계산 함수는 직종을 가르지 않고 이 결과(CareerRules)만 본다.
 */
import { RulesError } from './resolve.ts';
import {
  isAvailable,
  type AllowanceRules,
  type Avail,
  type CareerOverrides,
  type DiligenceRules,
  type FeatureKey,
  type Ladder,
  type LadderId,
  type LadderRank,
  type LeaveRules,
  type PayTableId,
  type PaydayRules,
  type PositionAllowanceRules,
  type ProbationRules,
  type PromotionRules,
  type PromotionStepRules,
  type RankKey,
  type RetirementRules,
  type Rules,
  type SourceRef,
  type StepRaiseRules,
  type TrackId,
  type TrackRules,
  type Unavailable,
} from './types.ts';

/** 사용자가 고른 직종·봉급표·계급 */
export interface CareerSel {
  track: TrackId;
  /** 일반직만 쓴다(table3·table4·table8). 그 밖의 직종은 null(직종이 봉급표를 정한다) */
  payTable: PayTableId | null;
  /** 계급 사다리의 키. 사다리가 없는 직종은 null */
  rank: RankKey | null;
}

export interface PayInfo {
  tableId: PayTableId;
  /** '별표 10' */
  annex: string;
  /** 봉급표 열의 키 */
  column: string;
  /** 1호봉부터의 월 봉급 */
  row: number[];
  /** 이 표를 가져온 연도 파일 */
  tableYear: number;
  /** 그 해 표로 확정돼 있는지(아니면 이전 연도 표) */
  confirmed: boolean;
  source: SourceRef;
}

export type CareerSourceKey = FeatureKey | 'pay' | 'ladder' | 'track' | 'rankLimit' | 'leaveScreen';

export interface CareerRules {
  sel: CareerSel;
  track: TrackRules;
  /** 실제로 쓰는 봉급표(일반직은 sel.payTable, 그 밖은 track.payTables[0]). 고를 수 없는 표면 null */
  payTableId: PayTableId | null;
  ladderId: LadderId | null;
  ladder: Ladder | null;
  rank: LadderRank | null;
  /** ladder.ranks 안의 위치(없으면 -1) */
  rankIndex: number;
  /** 바로 위 계급(selectable 여부와 무관) */
  nextRank: LadderRank | null;
  /** 사다리가 있는데 저장된 계급이 없거나(null) 사다리에 없다 */
  rankUnknown: boolean;
  /** 'missing' → "계급을 골라 주세요." / 'notInLadder' → "계급을 다시 골라 주세요." */
  rankProblem: 'missing' | 'notInLadder' | null;
  pay: Avail<PayInfo>;
  stepRaise: Avail<StepRaiseRules>;
  promotionStep: Avail<PromotionStepRules>;
  retirement: Avail<RetirementRules>;
  probation: Avail<ProbationRules>;
  minService: Avail<PromotionRules['minService']>;
  longService: Avail<PromotionRules['longService']>;
  seniorTreatment: Avail<PromotionRules['seniorTreatment']>;
  leave: {
    annual: Avail<LeaveRules['annual']>;
    advance: Avail<LeaveRules['advance']>;
    compensation: Avail<LeaveRules['compensation']>;
    longService: Avail<LeaveRules['longService']>;
    /** 늘 기본값(8시간·4시간) */
    units: LeaveRules['units'];
    /** 임용 연도 계산. annual 을 따라간다(annual 이 꺼지면 함께 꺼진 것으로 본다) */
    firstYear: LeaveRules['firstYear'];
  };
  allowances: {
    diligence: Avail<AllowanceRules['diligence']>;
    diligenceExtra: Avail<AllowanceRules['diligenceExtra']>;
    holidayBonus: Avail<AllowanceRules['holidayBonus']>;
    seniorTreatment: Avail<AllowanceRules['seniorTreatment']>;
    position: Avail<PositionAllowanceRules>;
    meal: AllowanceRules['meal'];
  };
  payday: { defaultDay: number; note: string; options: PaydayRules['options'] };
  /** 이 직종에서 쓰는 근거(근거 법령 화면용): 봉급표·사다리·덮어쓰기·적용 근거 */
  sources: { feature: CareerSourceKey; source: SourceRef }[];
}

/** pendingReason 이 없는 직종에서 자동으로 꺼진 항목의 사유 */
export const DEFAULT_PENDING_REASON = '원문을 확인한 뒤 넣을게요.';
export const RANK_MISSING_REASON = '계급을 골라 주세요.';
export const RANK_NOT_IN_LADDER_REASON = '계급을 다시 골라 주세요.';
export const PAY_TABLE_NOT_ALLOWED_REASON = '봉급표를 다시 골라 주세요.';

const OVERRIDE_KEYS: readonly (keyof CareerOverrides)[] = [
  'ladder',
  'stepRaise',
  'promotionStep',
  'retirement',
  'probation',
  'minService',
  'longService',
  'seniorTreatment',
  'leaveAnnual',
  'leaveAdvance',
  'leaveCompensation',
  'leaveLongService',
  'diligence',
  'holidayBonus',
  'seniorAllowance',
  'positionAllowance',
];

/** 기본 구역(일반직 값)에서 항목 값 */
function baseValue(rules: Rules, feature: FeatureKey): object {
  switch (feature) {
    case 'stepRaise':
      return rules.stepRaise;
    case 'promotionStep':
      return rules.promotionStep;
    case 'retirement':
      return rules.retirement;
    case 'probation':
      return rules.probation;
    case 'minService':
      return rules.promotion.minService;
    case 'longService':
      return rules.promotion.longService;
    case 'seniorTreatment':
      return rules.promotion.seniorTreatment;
    case 'leaveAnnual':
      return rules.leave.annual;
    case 'leaveAdvance':
      return rules.leave.advance;
    case 'leaveCompensation':
      return rules.leave.compensation;
    case 'leaveLongService':
      return rules.leave.longService;
    case 'diligence':
      return {
        diligence: rules.allowances.diligence,
        extra: rules.allowances.diligenceExtra,
      } satisfies DiligenceRules;
    case 'holidayBonus':
      return rules.allowances.holidayBonus;
    case 'seniorAllowance':
      return rules.allowances.seniorTreatment;
    case 'positionAllowance':
      return rules.allowances.position;
  }
}

/** 값 안의 근거들(diligence 는 두 개) */
function ownSources(value: object): SourceRef[] {
  const v = value as {
    source?: SourceRef;
    diligence?: { source: SourceRef };
    extra?: { source: SourceRef };
  };
  if (v.source) return [v.source];
  return [v.diligence?.source, v.extra?.source].filter((s): s is SourceRef => s !== undefined);
}

/** 직종 + 봉급표별 덮어쓰기(얕은 병합) */
function overridesOf(track: TrackRules, payTableId: PayTableId | null): CareerOverrides {
  const o: Record<string, unknown> = {};
  for (const key of OVERRIDE_KEYS) {
    if (key in track) o[key] = track[key];
  }
  const byTable = payTableId ? track.byPayTable?.[payTableId] : undefined;
  return { ...(o as CareerOverrides), ...byTable };
}

function payTableOf(sel: CareerSel, track: TrackRules): PayTableId | null {
  if (sel.track === 'general') {
    const id = sel.payTable ?? track.payTables[0] ?? null;
    return id !== null && track.payTables.includes(id) ? id : null;
  }
  return track.payTables[0] ?? null;
}

const cache = new WeakMap<Rules, Map<string, CareerRules>>();

/** 직종·봉급표·계급에 적용할 규정. 같은 Rules·같은 선택이면 같은 객체를 돌려준다 */
export function resolveCareer(rules: Rules, sel: CareerSel): CareerRules {
  let byRules = cache.get(rules);
  if (!byRules) {
    byRules = new Map();
    cache.set(rules, byRules);
  }
  const key = JSON.stringify([sel.track, sel.payTable, sel.rank]);
  let career = byRules.get(key);
  if (!career) {
    career = build(rules, { track: sel.track, payTable: sel.payTable, rank: sel.rank });
    byRules.set(key, career);
  }
  return career;
}

function build(rules: Rules, sel: CareerSel): CareerRules {
  const track = rules.tracks.items[sel.track];
  if (!track) throw new RulesError(`규정에 '${sel.track}' 직종이 없습니다`);
  const pending: Unavailable = {
    status: 'pending',
    reason: track.pendingReason ?? DEFAULT_PENDING_REASON,
  };
  const sources: CareerRules['sources'] = [];
  if (track.source) sources.push({ feature: 'track', source: track.source });

  // 1. 봉급표
  const payTableId = payTableOf(sel, track);
  const payTableAllowed = !(sel.track === 'general' && payTableId === null);

  // 2. 덮어쓰기
  const o = overridesOf(track, payTableId);

  // 3. 계급 사다리
  const ladderId = o.ladder ?? null;
  const ladder = ladderId ? (rules.tracks.ladders[ladderId] ?? null) : null;
  if (ladderId && !ladder) throw new RulesError(`규정에 '${ladderId}' 계급 사다리가 없습니다`);
  let rank: LadderRank | null = null;
  let rankIndex = -1;
  let rankProblem: CareerRules['rankProblem'] = null;
  if (ladder) {
    sources.push({ feature: 'ladder', source: ladder.source });
    if (sel.rank === null) rankProblem = 'missing';
    else {
      rankIndex = ladder.ranks.findIndex((r) => r.key === sel.rank);
      if (rankIndex < 0) rankProblem = 'notInLadder';
      else rank = ladder.ranks[rankIndex] ?? null;
    }
  }
  // 사다리가 없는데 계급이 저장돼 있으면(데이터에서 사다리가 빠진 경우) 무시한다(오류 아님).
  const nextRank = ladder && rankIndex >= 0 ? (ladder.ranks[rankIndex + 1] ?? null) : null;

  // 4. 항목별 해석
  const feature = <T extends object>(f: FeatureKey): Avail<T> => {
    const own = o[f] as Avail<T> | undefined;
    if (own !== undefined) {
      if (isAvailable(own))
        for (const s of ownSources(own)) sources.push({ feature: f, source: s });
      return own;
    }
    const applies = track.applies?.[f];
    if (sel.track === 'general' || applies) {
      const value = baseValue(rules, f) as T;
      if (applies) sources.push({ feature: f, source: applies });
      else for (const s of ownSources(value)) sources.push({ feature: f, source: s });
      return value;
    }
    return pending;
  };
  const stepRaise = feature<StepRaiseRules>('stepRaise');
  const promotionStep = feature<PromotionStepRules>('promotionStep');
  const retirement = feature<RetirementRules>('retirement');
  if (isAvailable(retirement) && retirement.rankLimit) {
    sources.push({ feature: 'rankLimit', source: retirement.rankLimit.source });
  }
  const probation = feature<ProbationRules>('probation');
  const minService = feature<PromotionRules['minService']>('minService');
  const longService = feature<PromotionRules['longService']>('longService');
  const seniorTreatment = feature<PromotionRules['seniorTreatment']>('seniorTreatment');
  const annual = feature<LeaveRules['annual']>('leaveAnnual');
  const advance = feature<LeaveRules['advance']>('leaveAdvance');
  const compensation = feature<LeaveRules['compensation']>('leaveCompensation');
  const leaveLong = feature<LeaveRules['longService']>('leaveLongService');
  const diligence = feature<DiligenceRules>('diligence');
  const holidayBonus = feature<AllowanceRules['holidayBonus']>('holidayBonus');
  const seniorAllowance = feature<AllowanceRules['seniorTreatment']>('seniorAllowance');
  const position = feature<PositionAllowanceRules>('positionAllowance');
  if (track.leaveScreen) sources.push({ feature: 'leaveScreen', source: track.leaveScreen.source });

  // 5. 봉급
  let pay: Avail<PayInfo>;
  if (!payTableAllowed) pay = { status: 'pending', reason: PAY_TABLE_NOT_ALLOWED_REASON };
  else if (payTableId === null || !ladder) pay = pending;
  else if (rankProblem !== null) {
    pay = {
      status: 'pending',
      reason: rankProblem === 'missing' ? RANK_MISSING_REASON : RANK_NOT_IN_LADDER_REASON,
    };
  } else if (!rank || rank.payColumn === null) {
    pay = { status: 'none', reason: rank?.note ?? '' };
  } else {
    const column = rank.payColumn;
    const table = payTableId === 'table3' ? null : rules.payTables.items[payTableId];
    if (payTableId !== 'table3' && !table) {
      throw new RulesError(`규정의 payTables 에 '${payTableId}' 봉급표가 없습니다`);
    }
    const row = table ? table.table[column] : rules.salary.table[column as '9'];
    if (!row) throw new RulesError(`${payTableId} 봉급표에 '${column}' 열이 없습니다`);
    const source = table ? table.source : rules.salary.source;
    const tableYear = rules.meta.payTableYear[payTableId];
    pay = {
      tableId: payTableId,
      annex: table ? table.annex : '별표 3',
      column,
      row,
      tableYear,
      confirmed: tableYear === rules.year,
      source,
    };
    sources.push({ feature: 'pay', source });
  }

  const diligenceOff: Unavailable | null = isAvailable(diligence) ? null : diligence;
  return {
    sel,
    track,
    payTableId,
    ladderId,
    ladder,
    rank,
    rankIndex,
    nextRank,
    rankUnknown: rankProblem !== null,
    rankProblem,
    pay,
    stepRaise,
    promotionStep,
    retirement,
    probation,
    minService,
    longService,
    seniorTreatment,
    leave: {
      annual,
      advance,
      compensation,
      longService: leaveLong,
      units: rules.leave.units,
      firstYear: rules.leave.firstYear,
    },
    allowances: {
      diligence: diligenceOff ?? (diligence as DiligenceRules).diligence,
      diligenceExtra: diligenceOff ?? (diligence as DiligenceRules).extra,
      holidayBonus,
      seniorTreatment: seniorAllowance,
      position,
      meal: rules.allowances.meal,
    },
    payday: {
      defaultDay: track.payday.defaultDay,
      note: track.payday.note,
      options: rules.payday.options,
    },
    sources,
  };
}

/** 사다리 계급 이름. 계급이 없거나 hideLabel 이면 '' */
export function rankLabel(c: CareerRules): string {
  return c.rank && !c.rank.hideLabel ? c.rank.label : '';
}

/** '경위 12호봉' / '12호봉'(교원) / '7급 12호봉' */
export function rankStepLabel(c: CareerRules, step: number): string {
  const label = rankLabel(c);
  return label ? `${label} ${step}호봉` : `${step}호봉`;
}

/** 일정 id 등에 쓰는 ASCII 조각: 일반직은 키 그대로('7'), 그 밖은 `${ladderId}${index}`('police3') */
export function rankSlug(c: CareerRules, rank: LadderRank | null = c.rank): string {
  if (!rank || !c.ladder || !c.ladderId) return '';
  if (c.ladderId === 'general') return rank.key;
  const index = c.ladder.ranks.findIndex((r) => r.key === rank.key);
  return index < 0 ? '' : `${c.ladderId}${index}`;
}

function ladderOf(rules: Rules, track: TrackId, payTable: PayTableId | null): Ladder | null {
  const t = rules.tracks.items[track];
  if (!t) return null;
  const id = overridesOf(t, payTableOf({ track, payTable, rank: null }, t)).ladder ?? null;
  return id ? (rules.tracks.ladders[id] ?? null) : null;
}

/** 사용자가 고를 수 있는 계급(낮은 계급부터). 사다리가 없으면 [] */
export function selectableRanks(
  rules: Rules,
  track: TrackId,
  payTable: PayTableId | null,
): LadderRank[] {
  return (ladderOf(rules, track, payTable)?.ranks ?? []).filter((r) => r.selectable !== false);
}

/** 직종을 처음 고를 때의 기본 선택: 일반직 table3·'9', 경찰 '순경', 교원 '교원', 준비 중 직종 null */
export function defaultSel(rules: Rules, track: TrackId): CareerSel {
  const t = rules.tracks.items[track];
  const payTable = track === 'general' ? (t?.payTables[0] ?? 'table3') : null;
  const first = selectableRanks(rules, track, payTable)[0];
  return { track, payTable, rank: first ? first.key : null };
}

/**
 * 내 정보 검사(store/validate.ts 의 CareerLookup)에 넘기는 규정 조회. 그 해 규칙의 사다리·봉급표로 답한다.
 * 입력 폼·파일 불러오기에서만 쓰인다(저장본 검사는 규정 데이터에 기대지 않는다).
 */
export function careerLookup(rules: Rules): {
  maxStep: (sel: CareerSel) => number | null;
  rankLabel: (sel: CareerSel) => string;
  selectableRanks: (track: TrackId, payTable: PayTableId | null) => readonly RankKey[];
} {
  return {
    maxStep: (sel) => {
      const pay = resolveCareer(rules, sel).pay;
      return isAvailable(pay) ? pay.row.length : null;
    },
    rankLabel: (sel) => {
      const c = resolveCareer(rules, sel);
      return rankLabel(c) || `${c.track.label} 봉급표`;
    },
    selectableRanks: (track, payTable) => selectableRanks(rules, track, payTable).map((r) => r.key),
  };
}
