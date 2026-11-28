/**
 * 직종(#20) 화면 문구 도우미. 계산은 하지 않고 resolveCareer 결과(CareerRules)를 글로 옮긴다.
 * - 꺼진 항목('준비 중'·'해당 없음'·'다른 기준')의 이름·사유를 화면마다 같은 말로 쓰게 한다.
 * - 직종·봉급표 이름(꼬리말·설정·불러오기 요약).
 * 조사는 josa()·withRo() 로 붙인다(직종 이름 뒤에 고정 조사 금지 — copy.test).
 */
import { defaultSel, resolveCareer, type CareerRules } from '../rules/career.ts';
import {
  isAvailable,
  TRACK_IDS,
  type Rules,
  type SeriesScope,
  type Avail,
  type FeatureKey,
  type PayTableId,
  type TrackId,
  type TrackRules,
  type Unavailable,
  type UnavailableStatus,
} from '../rules/types.ts';
import {
  foundExactly,
  otherScope,
  SERIES_TABLE_NAME,
  type SeriesFind,
  type SeriesHit,
} from '../character/series.ts';
import { josa } from './format.ts';

/** 꺼진 항목의 상태 이름(색이 아니라 글자로 구별한다) */
export const OFF_STATUS_LABEL: Record<UnavailableStatus, string> = {
  pending: '준비 중',
  none: '해당 없음',
  external: '다른 기준',
  input: '입력 필요',
};

/** 화면에 쓰는 항목 이름 */
export const FEATURE_LABEL: Record<FeatureKey | 'pay', string> = {
  pay: '봉급',
  stepRaise: '정기승급',
  promotionStep: '승진 시 호봉',
  retirement: '정년',
  probation: '시보',
  minService: '승진소요최저연수',
  longService: '근속승진',
  seniorTreatment: '대우공무원',
  leaveAnnual: '연가 일수',
  leaveAdvance: '연가 미리 쓰기',
  leaveCompensation: '연가보상비',
  leaveLongService: '장기재직휴가',
  leaveSaving: '연가 저축',
  diligence: '정근수당',
  holidayBonus: '명절휴가비',
  seniorAllowance: '대우공무원수당',
  positionAllowance: '직급보조비',
};

/** 항목의 해석 결과(CareerRules 안의 자리) */
export function featureValue(c: CareerRules, key: FeatureKey | 'pay'): Avail<object> {
  switch (key) {
    case 'pay':
      return c.pay;
    case 'leaveAnnual':
      return c.leave.annual;
    case 'leaveAdvance':
      return c.leave.advance;
    case 'leaveCompensation':
      return c.leave.compensation;
    case 'leaveLongService':
      return c.leave.longService;
    case 'leaveSaving':
      return c.leave.saving;
    case 'diligence':
      return c.allowances.diligence;
    case 'holidayBonus':
      return c.allowances.holidayBonus;
    case 'seniorAllowance':
      return c.allowances.seniorTreatment;
    case 'positionAllowance':
      return c.allowances.position;
    default:
      return c[key];
  }
}

export interface OffFeature {
  key: FeatureKey | 'pay';
  label: string;
  status: UnavailableStatus;
  statusLabel: string;
  reason: string;
}

/** 화면 순서(봉급 → 승급·승진 → 정년 → 연가 → 수당) */
const FEATURE_ORDER: readonly (FeatureKey | 'pay')[] = [
  'pay',
  'stepRaise',
  'promotionStep',
  'minService',
  'longService',
  'seniorTreatment',
  'retirement',
  'probation',
  'leaveAnnual',
  'leaveAdvance',
  'leaveCompensation',
  'leaveLongService',
  'leaveSaving',
  'diligence',
  'holidayBonus',
  'seniorAllowance',
  'positionAllowance',
];

/** 이 직종에서 꺼진 항목(상태를 고르면 그 상태만) */
export function offFeatures(c: CareerRules, only?: UnavailableStatus): OffFeature[] {
  const out: OffFeature[] = [];
  for (const key of FEATURE_ORDER) {
    const value = featureValue(c, key);
    if (isAvailable(value)) continue;
    const off = value as unknown as Unavailable;
    if (only && off.status !== only) continue;
    out.push({
      key,
      label: FEATURE_LABEL[key],
      status: off.status,
      statusLabel: OFF_STATUS_LABEL[off.status],
      reason: off.reason,
    });
  }
  return out;
}

/** '준비 중: 사유' 한 줄 */
export function offText(off: Unavailable): string {
  return off.reason
    ? `${OFF_STATUS_LABEL[off.status]}: ${off.reason}`
    : OFF_STATUS_LABEL[off.status];
}

/**
 * 꺼진 항목을 문장으로: '봉급 계산은 준비 중이에요. 사유' / 입력이 모자라면 '계급을 골라 주세요. 그러면 봉급을 계산해요.'
 * 해당 없음·다른 기준은 '봉급: 해당 없음. 사유'.
 */
export function offSentence(label: string, off: Unavailable): string {
  const reason = off.reason ? ` ${off.reason}` : '';
  if (off.status === 'pending') return `${label} 계산은 준비 중이에요.${reason}`;
  if (off.status === 'input') return `${off.reason} 그러면 ${josa(label, '을', '를')} 계산해요.`;
  return `${label}: ${OFF_STATUS_LABEL[off.status]}.${reason}`;
}

/** 직종 고르기 옆 글자(색만으로 구별하지 않는다) */
export function trackStatusText(track: Pick<TrackRules, 'status'>): string {
  return track.status === 'partial' ? '일부 준비 중' : track.status === 'pending' ? '준비 중' : '';
}

/** 직종 칩 글자: '해양경찰 (일부 준비 중)' */
export function trackChipLabel(track: Pick<TrackRules, 'label' | 'status'>): string {
  const status = trackStatusText(track);
  return status ? `${track.label} (${status})` : track.label;
}

/** 일반직이 고르는 봉급표의 화면 이름 */
export const GENERAL_PAY_TABLE_LABEL: Partial<Record<PayTableId, string>> = {
  table3: '일반직(별표 3)',
  table4: '공안업무 등(별표 4)',
  table8: '우정직군(별표 8)',
};

/** 설정 '봉급표' 줄: '별표 4(공안업무 등)' */
export const PAY_TABLE_SHORT: Partial<Record<PayTableId, string>> = {
  table4: '별표 4(공안업무 등)',
  table8: '별표 8(우정직군)',
};

/**
 * 꼬리말의 '○○ 기준' 앞부분: 적용 대상 + 직종 이름. 직종 이름이 적용 대상의 앞말로 시작하면(지방공무원 + '지방 일반직')
 * 같은 말을 두 번 쓰지 않게 직종 이름만: '국가공무원 일반직' / '지방 일반직'
 */
export function footerTarget(target: string, name: string): string {
  const head = name.split(/\s/)[0] ?? '';
  return head !== '' && target.startsWith(head) ? name : `${target} ${name}`;
}

/** 꼬리말·안내의 직종 이름: '일반직' / '일반직(별표 4)' / '경찰' */
export function trackNameOf(c: Pick<CareerRules, 'sel' | 'track' | 'payTableId'>): string {
  if (c.track.payTables.length > 1 && c.payTableId && c.payTableId !== c.track.payTables[0]) {
    const annex = c.payTableId.replace('table', '별표 ');
    return `${c.track.label}(${annex})`;
  }
  return c.track.label;
}

/** 카드에 계급 이름을 넣는 기본값(Q2): 일반직 사다리(1~9급)만 켬. 경찰·소방·우정·외무는 직종을 드러낸다 */
export function defaultShowRank(c: Pick<CareerRules, 'ladderId'>): boolean {
  return c.ladderId === 'general';
}

/**
 * 항목(FeatureKey) 하나가 통째로 꺼진 것은 아니지만 그 안의 일부를 원문으로 확인하지 못해 '준비 중'인 것.
 * 직종 id 가 아니라 해석 결과의 표시로 정한다: 반일 연가 단위 없음(leave.units.halfDayHours null),
 * 연초 재직기간으로 센 연가 일수(tenureBasis 'year-start' — 연도 중 늘어나는 날을 확인하지 못함)
 */
export function partialPendingLabels(c: CareerRules): string[] {
  const out: string[] = [];
  if (c.leave.units.halfDayHours === null) out.push('반일 연가');
  if (isAvailable(c.leave.annual) && c.leave.annual.tenureBasis === 'year-start')
    out.push('연도 중 늘어나는 연가 일수');
  return out;
}

/** 준비 중 직종 안내 띠: '외무는 일부만 계산해요. 준비 중: 정년, 승진소요최저연수 …' */
export function pendingTrackText(c: CareerRules): string | null {
  if (c.track.status === 'ready') return null;
  const pending = [...offFeatures(c, 'pending').map((f) => f.label), ...partialPendingLabels(c)];
  if (pending.length === 0) return null;
  // 봉급부터 준비 중인 직종(군무원·그 밖의 특정직): 열여섯 항목을 늘어놓지 않고 쓸 수 있는 것을 말한다
  if (c.track.status === 'pending' && !isAvailable(c.pay))
    return `${josa(c.track.label, '은', '는')} 봉급·정년·연가 일수 등을 아직 계산하지 않아요. 재직기간·연가 장부·근무시간은 쓸 수 있어요.`;
  const external = offFeatures(c, 'external').map((f) => f.label);
  const tail = external.length > 0 ? ` 다른 기준: ${external.join(', ')}.` : '';
  return `${josa(c.track.label, '은', '는')} 일부만 계산해요. 준비 중: ${pending.join(', ')}.${tail}`;
}

/** 두 직종(지금 a, 바꿀 수 있는 b)의 차이 — 직렬 고르기의 '다른 표' 안내 상자가 쓴다. 직종 이름으로 가르지 않는다 */
export interface CareerDiff {
  /** 봉급표가 같은지 */
  samePayTable: boolean;
  /** 월급날 선택지가 다르면 b 의 기본일과 선택지, 같으면 null */
  payday: { defaultDay: number; options: { day: number; orgs: string }[] } | null;
  /** b 에서 꺼진(준비 중·다른 기준·해당 없음) 항목 중 a 에서는 켜진 것. 반일 연가 같은 일부 준비 중도 넣는다 */
  off: { label: string; status: UnavailableStatus }[];
}

export function careerDiff(a: CareerRules, b: CareerRules): CareerDiff {
  const days = (c: CareerRules) =>
    c.payday.options
      .map((o) => o.day)
      .sort((x, y) => x - y)
      .join(',');
  const off: CareerDiff['off'] = offFeatures(b)
    .filter((f) => f.status !== 'input' && isAvailable(featureValue(a, f.key)))
    .map((f) => ({ label: f.label, status: f.status }));
  const already = new Set(partialPendingLabels(a));
  for (const label of partialPendingLabels(b))
    if (!already.has(label)) off.push({ label, status: 'pending' });
  return {
    samePayTable: a.payTableId !== null && a.payTableId === b.payTableId,
    payday:
      days(a) === days(b) && a.payday.defaultDay === b.payday.defaultDay
        ? null
        : { defaultDay: b.payday.defaultDay, options: b.payday.options },
    off,
  };
}

/** 월급날 선택지의 짧은 기관 이름: 기관 글자 끝의 괄호 속('교육감이 … 공무원(교육청·학교)' → '교육청·학교'). 없으면 null */
export function paydayShortOrg(orgs: string): string | null {
  return /\(([^()]+)\)$/.exec(orgs)?.[1] ?? null;
}

/**
 * 월급날 단추의 글자. 기본이 아닌 날에 짧은 기관 이름이 있으면 앞에 붙인다: '20일' / '교육청·학교 17일'.
 * 별표 30 의 네 행처럼 짧은 이름이 없으면 '17일' 그대로
 */
export function paydayChipLabel(option: { day: number; orgs: string }, defaultDay: number): string {
  const short = option.day === defaultDay ? null : paydayShortOrg(option.orgs);
  return short ? `${short} ${option.day}일` : `${option.day}일`;
}

/** 기본이 아닌 선택지 가운데 짧은 기관 이름이 있는 것이 있는지(대화형 첫 입력이 도움말을 바꾼다) */
export function paydayHasShortOrgs(
  defaultDay: number,
  options: readonly { day: number; orgs: string }[],
): boolean {
  return options.some((o) => o.day !== defaultDay && paydayShortOrg(o.orgs) !== null);
}

/**
 * 월급날 선택지의 짧은 설명: '기본 20일(교육청·학교는 17일)' / '기본 25일(10·17·20일도 고를 수 있어요)'.
 * 기관 글 끝의 괄호(짧은 이름)가 있으면 그것을 쓴다: '교육감이 임용권을 가지는 공무원(교육청·학교)' → '교육청·학교'
 */
export function paydayChoiceText(
  defaultDay: number,
  options: readonly { day: number; orgs: string }[],
): string {
  const named: string[] = [];
  const plain: number[] = [];
  for (const o of options) {
    if (o.day === defaultDay) continue;
    const short = paydayShortOrg(o.orgs);
    if (short) named.push(`${josa(short, '은', '는')} ${o.day}일`);
    else plain.push(o.day);
  }
  if (plain.length > 0) named.push(`${plain.join('·')}일도 고를 수 있어요`);
  return `기본 ${defaultDay}일${named.length > 0 ? `(${named.join(', ')})` : ''}`;
}

/** 이름 여럿을 'ㄱ, ㄴ 외 n개'로(많으면 앞의 max 개만) */
function someOf(names: string[], max: number): string {
  const head = names.slice(0, max).join(', ');
  return names.length > max ? `${head} 외 ${names.length - max}개` : head;
}

/** 차이 줄: '봉급표는 같아요. 달라지는 것: 월급날 기본 20일(교육청·학교는 17일) · 준비 중: 대우공무원, 반일 연가 외 1개' */
export function careerDiffText(diff: CareerDiff): string {
  const changes: string[] = [];
  if (diff.payday)
    changes.push(`월급날 ${paydayChoiceText(diff.payday.defaultDay, diff.payday.options)}`);
  for (const status of ['pending', 'external', 'none'] as const) {
    const names = diff.off.filter((f) => f.status === status).map((f) => f.label);
    if (names.length > 0) changes.push(`${OFF_STATUS_LABEL[status]}: ${someOf(names, 2)}`);
  }
  const same = diff.samePayTable ? '봉급표는 같아요.' : '';
  const what = changes.length > 0 ? `달라지는 것: ${changes.join(' · ')}.` : '';
  return [same, what].filter(Boolean).join(' ');
}

/** 직렬 표마다 그 표를 쓰는 사람(안내 상자의 둘째 줄) */
const SCOPE_WHO: Record<SeriesScope, string> = {
  national: '국가공무원',
  local: '시·도 교육청·학교나 시·도·시군구에서 일하는 지방공무원',
};

/**
 * 직렬 고르기에서 지금 직종의 표에 없고 다른 표에만 있는 이름을 찾았을 때의 안내 상자 글.
 * 다른 표를 쓰는 직종은 데이터(seriesScope)에서 찾는다. 그런 직종이 없으면 null
 */
export function otherTableNote(
  rules: Rules,
  career: CareerRules,
  scope: SeriesScope,
  hits: readonly SeriesHit[],
): { title: string; who: string; diff: string } | null {
  const other = otherScope(scope);
  const id = TRACK_IDS.find((t) => rules.tracks.items[t].seriesScope === other);
  if (!id || hits.length === 0) return null;
  const b = resolveCareer(rules, defaultSel(rules, id));
  // 옛 이름으로 맞았으면 그 이름을 밝힌다(왜 그 직렬이 나왔는지 알게 — 목록의 hitText 와 같은 '예전 ○○ 직렬')
  const names = hits.map((h) =>
    h.by === 'jikryu'
      ? `${h.series} 직렬의 ${h.jikryu} 직류(${h.group} 직군)`
      : `${h.series} 직렬(${h.alias ? `예전 ${h.alias} 직렬, ` : ''}${h.group} 직군)`,
  );
  return {
    title: `${SERIES_TABLE_NAME[other]}에 있어요: ${someOf(names, 4)}.`,
    who: `${josa(SCOPE_WHO[other], '이면', '면')} 직종에서 ${josa(b.track.label, '을', '를')} 골라 주세요.`,
    diff: careerDiffText(careerDiff(career, b)),
  };
}

/**
 * 직렬 찾기의 직종 말(#38): 찾는 글자(공백을 지운 것)에 다른 직종의 이름(규정 데이터 tracks.items[*].label,
 * 공백을 지운 2자 이상)이 들어 있으면 그 직종이 따로 있다고 알린다('경찰행정' → 경찰). 직종을 저절로 바꾸지 않는다.
 * - 지금 직종과 직렬 표가 있는 직종(seriesScope — 다른 표 안내가 맡는다)은 뺀다. 겹치면 긴 이름만('해양경찰행정' → 해양경찰).
 * - 지금 표에서 이름이 같게 찾았으면(foundExactly) 보이지 않는다. 그 밖에는 결과가 있어도 보인다('경찰' → 철도경찰).
 * 직종 id 로 가르지 않는다(이름과 seriesScope 만 본다). label 뒤에 '공무원'을 기계적으로 붙이지 않는다('교원 공무원')
 */
export function trackWordNote(
  rules: Rules,
  career: CareerRules,
  find: SeriesFind,
): { labels: string[]; text: string } | null {
  if (find.needle === '' || foundExactly(find)) return null;
  const words = TRACK_IDS.map((id) => rules.tracks.items[id])
    .filter((t) => t.seriesScope === undefined && t.label !== career.track.label)
    .map((t) => ({ label: t.label, word: t.label.replace(/\s+/g, '') }))
    .filter((t) => t.word.length >= 2 && find.needle.includes(t.word));
  const labels = words
    .filter(
      (t) =>
        !words.some((o) => o !== t && o.word.length > t.word.length && o.word.includes(t.word)),
    )
    .map((t) => t.label);
  if (labels.length === 0) return null;
  const names = labels.join('·');
  return {
    labels,
    text: `직종에 ${josa(names, '이', '가')} 따로 있어요. 해당하면 직종을 바꿔 주세요. 그 직종은 직렬을 고르지 않아요.`,
  };
}

/** 직종별 월급날 기본값 안내: '교원 월급날 기본값은 17일이에요.' */
export function paydayDefaultText(trackLabel: string, day: number): string {
  return `${trackLabel} 월급날 기본값은 ${day}일이에요.`;
}

export type { TrackId };
