/**
 * 일반직 직렬·직류 목록(data/series.json schema 3)과 직렬 → 호봉이 소품 테마.
 * - 국가(scope 'national'): 공무원임용령 별표 1·2. 지방(scope 'local'): 지방공무원 임용령 별표 1.
 * - 어느 표를 쓰는지는 직종 데이터의 seriesScope 가 정한다(화면은 직종 id 로 가르지 않는다).
 *
 * 직렬은 소속을 짐작하게 할 수 있다. 여기서는 이름을 찾아 주기만 하고, 어디에 보일지는 사용자 설정
 * (settings.identity.showSeriesHome·settings.card.showSeries)을 본 화면이 정한다. 직류는 직렬보다 좁은 정보라
 * 카드·결산 카드·공유 문구·소품 계산에 쓰지 않는다(seriesNameOf·propOwnerOf 는 직류를 받지 않는다).
 * 저장본의 직렬 키는 원문 직렬 이름이다. 목록에 없는 키(데이터가 바뀜·다른 표의 이름)는 지우지 않고 '없음'처럼 다룬다.
 * 다만 국가·지방 두 표 어디에도 없는 이름은 사용자가 직접 적은 이름으로 보고 그대로 보인다(#38, '직렬'을 붙이지 않는다).
 * 넓게 찾기(findSeries, #38): 원문 이름으로 찾기(R0) → 꾸밈말 떼기·줄임말(R1) → 이름에 든 조각(R2, 짐작).
 */
import raw from '../../../data/series.json';
import { SERIES_KEY_RE } from '../store/schema.ts';
import type { SeriesScope, TrackId } from '../rules/types.ts';
import type { PropOwner } from './look.ts';

export type { SeriesScope };

export interface SeriesEntry {
  /** 원문 직렬 이름(저장본의 키) */
  name: string;
  /** 호봉이 소품 테마(data/character.json custom.props 의 id) */
  theme: string;
  /** 원문 표의 직류(표 순서). 직렬과 같은 이름의 단일 직류도 표 그대로 담는다 */
  jikryu: string[];
  /** 예전 원문 이름(이름이 바뀌어도 예전 저장본이 맞게) */
  aliases?: string[];
}

export interface SeriesGroup {
  /** 원문 직군 이름(국가·지방에 같은 이름이 있다 — '행정'·'과학기술'·'관리운영') */
  name: string;
  scope: SeriesScope;
  /** sources 의 키 */
  source: string;
  series: SeriesEntry[];
}

/**
 * 찾기 사전(schema 3). 법령의 이름이 아닌 말을 원문 이름으로 이어 주기만 한다(저장 키가 아니다).
 * short: 줄임말 → 원문 직렬·직류 이름. common: 흔히 부르는 이름과 그 설명(안내 상자에 보인다)
 */
export interface SeriesFinder {
  notes: string[];
  short: { say: string; means: string }[];
  common: { say: string[]; text: string }[];
}

export interface SeriesData {
  schema: 3;
  notes: string[];
  sources: Record<
    string,
    {
      law: string;
      annex: string;
      title: string;
      revised: string;
      effective: string;
      promulgation: string;
      snapshot: string;
    }
  >;
  checkedAt: string;
  finder: SeriesFinder;
  groups: SeriesGroup[];
}

export const seriesData = raw as unknown as SeriesData;

export const SERIES_SCOPES: readonly SeriesScope[] = ['national', 'local'];

/** 표 이름(안내 문구) */
export const SERIES_TABLE_NAME: Record<SeriesScope, string> = {
  national: '국가공무원 직렬표',
  local: '지방공무원 직렬표',
};

/** 다른 표 */
export function otherScope(scope: SeriesScope): SeriesScope {
  return scope === 'national' ? 'local' : 'national';
}

type Found = { entry: SeriesEntry; group: SeriesGroup };

/** (scope, 이름) 색인. 국가·지방에 같은 이름의 직렬이 38개라 이름 하나로 키를 삼으면 덮인다 */
const index = new Map<SeriesScope, Map<string, Found>>(SERIES_SCOPES.map((s) => [s, new Map()]));
for (const group of seriesData.groups) {
  const byName = index.get(group.scope);
  if (!byName) continue;
  for (const entry of group.series) {
    byName.set(entry.name, { entry, group });
    for (const alias of entry.aliases ?? []) byName.set(alias, { entry, group });
  }
}

/** 표마다 직군 목록(원문 순서) */
export function groupsOf(scope: SeriesScope): SeriesGroup[] {
  return seriesData.groups.filter((g) => g.scope === scope);
}

/** 저장 키의 항목. 고르지 않았거나(null), 그 표에 없으면 null */
export function seriesByKey(key: string | null, scope: SeriesScope | null): Found | null {
  if (key === null || scope === null) return null;
  return index.get(scope)?.get(key) ?? null;
}

/** 직렬의 소품 테마. 고르지 않았거나 그 표에 없으면 null */
export function themeOfSeries(key: string | null, scope: SeriesScope | null): string | null {
  return seriesByKey(key, scope)?.entry.theme ?? null;
}

/**
 * 저장된 직류가 그 직렬의 직류이면 그 이름. 직렬과 같은 이름(단일 직류)이거나, 목록에 없거나, 짝이 맞지 않으면 null
 * (저장값은 지우지 않는다 — 보이지만 않는다)
 */
export function jikryuOf(
  series: string | null,
  jikryu: string | null,
  scope: SeriesScope | null,
): string | null {
  if (jikryu === null) return null;
  const found = seriesByKey(series, scope);
  if (!found || jikryu === found.entry.name) return null;
  return found.entry.jikryu.includes(jikryu) ? jikryu : null;
}

/** 두 표의 모든 이름(직군·직렬·직류·옛 이름). 이 안에 없는 이름이 '직접 적은 이름'이다 */
const tableNames = new Set<string>();
for (const group of seriesData.groups) {
  tableNames.add(group.name);
  for (const entry of group.series)
    for (const name of [entry.name, ...entry.jikryu, ...(entry.aliases ?? [])])
      tableNames.add(name);
}

/** 이름(공백을 지운 글자)이 국가·지방 두 표 어디엔가(직군·직렬·직류·옛 이름) 있는지 */
export function inAnyTable(name: string): boolean {
  return tableNames.has(name) || tableNames.has(seriesNeedle(name));
}

/** 직접 적은 이름의 최대 글자 수(홈 상태창·카드에서 넘치지 않게) */
export const OWN_NAME_MAX = 12;

/**
 * 저장된 직렬 키가 '직접 적은 이름'인지: 두 표 어디에도 없고(옛 이름 포함) 형식(SERIES_KEY_RE)과 길이(12자)를 지킨다.
 * 다른 표에만 있는 이름(지방 '교육행정'을 일반직에서)은 직접 적은 이름이 아니다(숨기고 짝을 권한다). 새 칸을 저장하지 않는다
 */
export function isOwnSeriesName(series: string | null): series is string {
  return (
    series !== null &&
    series.length <= OWN_NAME_MAX &&
    SERIES_KEY_RE.test(series) &&
    !inAnyTable(series)
  );
}

/**
 * 화면에 보일 직렬 이름(직류 없이 — 카드·소품). 고르지 않았거나 그 표에 없으면 null.
 * 직접 적은 이름이면 그 글자 그대로(직렬 표가 없는 직종 — scope null — 에서는 null)
 */
export function seriesNameOf(series: string | null, scope: SeriesScope | null): string | null {
  if (series === null || scope === null) return null;
  const found = seriesByKey(series, scope);
  if (found) return found.entry.name;
  return isOwnSeriesName(series) ? series : null;
}

/**
 * 홈·카드의 직렬 글자: 표의 이름은 '행정 직렬', 직접 적은 이름은 '직렬'을 붙이지 않고 그대로('경찰행정').
 * 법령에 없는 이름이 법령의 직렬처럼 보이지 않게 한다
 */
export function seriesWord(name: string): string {
  return isOwnSeriesName(name) ? name : `${name} 직렬`;
}

/** 직렬 · 직류 글자: '행정 · 교육행정 직류' / '행정' */
export function seriesText(series: string, jikryu: string | null): string {
  return jikryu ? `${series} · ${jikryu} 직류` : series;
}

/**
 * 이 브라우저 안의 화면(내 정보·설정·첫 입력·홈)에 보일 이름. '행정 · 교육행정 직류' / '행정'.
 * 직종에 직렬 표가 없거나(scope null), 고르지 않았거나, 그 표에 없으면 null. 카드·공유에는 seriesNameOf 를 쓴다
 */
export function seriesLabel(
  profile: { series: string | null; seriesJikryu: string | null },
  scope: SeriesScope | null,
): string | null {
  const name = seriesNameOf(profile.series, scope);
  if (name === null) return null;
  return seriesText(name, jikryuOf(profile.series, profile.seriesJikryu, scope));
}

export interface SeriesHit {
  scope: SeriesScope;
  group: string;
  series: string;
  theme: string;
  /** 무엇이 맞았는지 */
  by: 'series' | 'jikryu' | 'group';
  /** by 'jikryu' 일 때 맞은 직류 */
  jikryu: string | null;
  /**
   * 맞음의 세기(작을수록 강함): 직렬 이름 같음 0 < 직류 이름 같음 1 < 직렬 이름 앞부분 2 < 직류 앞부분 3
   * < 직렬 이름 안 4 < 직류 안 5 < 직군 이름 6. 옛 이름(aliases)은 같음 0·앞부분(2자 이상) 2 로만 맞는다
   */
  rank: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 원문 표 순서(같은 scope 안에서) */
  order: number;
  /** 옛 이름(aliases)으로 맞았으면 그 옛 이름 */
  alias?: string;
  /** 조각 찾기(R2)로 맞았으면 찾는 글자 안에서 찾은 표의 이름 */
  piece?: string;
}

/** 찾는 글자: 공백을 모두 지운다(원문 이름에는 공백이 없다 — '교육 행정'도 찾게) */
export function seriesNeedle(query: string): string {
  return query.replace(/\s+/g, '');
}

function hitsIn(q: string, scope: SeriesScope): SeriesHit[] {
  const out: SeriesHit[] = [];
  let order = 0;
  for (const g of groupsOf(scope)) {
    for (const s of g.series) {
      order += 1;
      // 한 직렬은 한 번만 낸다(가장 강한 맞음으로)
      let best: Pick<SeriesHit, 'rank' | 'by' | 'jikryu' | 'alias'> | null = null;
      const consider = (
        rank: SeriesHit['rank'],
        by: SeriesHit['by'],
        jikryu: string | null,
        alias?: string,
      ) => {
        if (best === null || rank < best.rank)
          best = alias === undefined ? { rank, by, jikryu } : { rank, by, jikryu, alias };
      };
      if (s.name === q) consider(0, 'series', null);
      else if (s.name.startsWith(q)) consider(2, 'series', null);
      else if (s.name.includes(q)) consider(4, 'series', null);
      // 옛 이름은 같음과 2자 이상의 앞부분으로만 맞는다(안에 든 글자로 맞추면 '사무'·'공안'·'수사'에 지금은 없는 이름이 끼어든다)
      for (const alias of s.aliases ?? []) {
        if (alias === q) consider(0, 'series', null, alias);
        else if (q.length >= 2 && alias.startsWith(q)) consider(2, 'series', null, alias);
      }
      for (const j of s.jikryu) {
        // 직렬과 같은 이름의 직류는 직렬로 이미 본다
        if (j === s.name) continue;
        if (j === q) consider(1, 'jikryu', j);
        else if (j.startsWith(q)) consider(3, 'jikryu', j);
        else if (j.includes(q)) consider(5, 'jikryu', j);
      }
      if (best === null && g.name.includes(q)) consider(6, 'group', null);
      if (best !== null) {
        const b: Pick<SeriesHit, 'rank' | 'by' | 'jikryu' | 'alias'> = best;
        out.push({ scope, group: g.name, series: s.name, theme: s.theme, order, ...b });
      }
    }
  }
  return out;
}

/**
 * 찾은 것(직렬, 또는 직렬 · 직류)이 scope 표에도 같은 이름으로 있는지.
 * 국가·지방에 같은 이름의 직렬이 38개라, 다른 표의 결과 가운데 이 표에도 있는 것은 '다른 표에만 있는 이름'이 아니다
 */
export function inTable(
  hit: Pick<SeriesHit, 'series' | 'by' | 'jikryu'>,
  scope: SeriesScope,
): boolean {
  const found = seriesByKey(hit.series, scope);
  if (!found) return false;
  return hit.by !== 'jikryu' || (hit.jikryu !== null && found.entry.jikryu.includes(hit.jikryu));
}

/**
 * 직렬·직류·직군 이름으로 찾기. 빈 글자(공백만 포함)는 빈 결과.
 * 정렬: 지금 표 먼저 → 맞음의 세기 → 지금 이름 먼저(옛 이름은 뒤) → 원문 표 순서. other 를 켜면 다른 표에만 있는 결과(inTable 이 아닌 것)를 뒤에 붙인다
 */
export function searchSeries(
  query: string,
  scope: SeriesScope,
  opts: { other?: boolean } = {},
): SeriesHit[] {
  const q = seriesNeedle(query);
  if (q === '') return [];
  // 같은 세기면 지금 이름으로 맞은 것을 옛 이름으로 맞은 것보다 앞에 둔다
  const sort = (hits: SeriesHit[]) =>
    hits.sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(a.alias !== undefined) - Number(b.alias !== undefined) ||
        a.order - b.order,
    );
  const mine = sort(hitsIn(q, scope));
  if (!opts.other) return mine;
  const other = sort(hitsIn(q, otherScope(scope))).filter((h) => !inTable(h, scope));
  return [...mine, ...other];
}

/**
 * 직종을 바꿔 직렬 표가 달라졌을 때, 저장된 (직렬, 직류)가 지금 표에서는 다른 모양으로 있는지.
 * - 직류가 지금 표에서는 따로 있는 직렬이다: 국가 '행정 · 교육행정 직류' → 지방 '교육행정' 직렬
 * - 직렬이 지금 표에는 없고 한 직렬의 직류로만 있다: 지방 '교육행정' 직렬 → 국가 '행정 · 교육행정 직류'
 * 그 짝을 돌려준다(화면이 한 줄 안내와 고르기 단추로 권한다 — 저절로 바꾸지 않는다). 없으면 null
 */
export function counterpartOf(
  series: string | null,
  jikryu: string | null,
  scope: SeriesScope,
): { series: string; jikryu: string | null } | null {
  if (series === null) return null;
  const found = seriesByKey(series, scope);
  if (found) {
    if (jikryu === null || jikryu === found.entry.name || found.entry.jikryu.includes(jikryu))
      return null;
    const own = seriesByKey(jikryu, scope);
    return own ? { series: own.entry.name, jikryu: null } : null;
  }
  const owners = groupsOf(scope)
    .flatMap((g) => g.series)
    .filter((s) => s.name !== series && s.jikryu.includes(series));
  return owners.length === 1 && owners[0] ? { series: owners[0].name, jikryu: series } : null;
}

/**
 * 찾은 것의 화면 글자: '행정 · 교육행정 직류' / '행정'. 옛 이름으로 찾았으면 '형사법무 (예전 검찰 직렬)'.
 * '옛 이름'이라 하지 않는다: 형사법무는 검찰·마약수사 두 직렬을 합친 것이라(부칙 제4조) 이름만 바뀐 것이 아니다
 */
export function hitText(hit: Pick<SeriesHit, 'series' | 'jikryu' | 'by' | 'alias'>): string {
  const text = seriesText(hit.series, hit.by === 'jikryu' ? hit.jikryu : null);
  return hit.alias ? `${text} (예전 ${hit.alias} 직렬)` : text;
}

/** 찾기 사전 */
export const seriesFinder: SeriesFinder = seriesData.finder;

/** 찾는 글자의 앞뒤에 붙는 꾸밈말(R1). 긴 것 먼저. 급수(9급)는 앞에도 뒤에도 붙는다('9급 행정'·'교정직 9급') */
const LEADS = ['국가직', '지방직', '국가', '지방'] as const;
const TAILS = ['공무원', '직렬', '직류', '직군', '직'] as const;
const GRADE_LEAD = /^\d+급/;
const GRADE_TAIL = /\d+급$/;

/** 꾸밈말을 한 번 떼어 볼 수 있는 모든 글자(남는 글자가 2자 이상인 것만) */
function stripOnce(q: string): string[] {
  const out: string[] = [];
  const gradeLead = GRADE_LEAD.exec(q)?.[0];
  if (gradeLead) out.push(q.slice(gradeLead.length));
  for (const lead of LEADS) if (q.startsWith(lead)) out.push(q.slice(lead.length));
  const gradeTail = GRADE_TAIL.exec(q)?.[0];
  if (gradeTail) out.push(q.slice(0, q.length - gradeTail.length));
  for (const tail of TAILS) if (q.endsWith(tail)) out.push(q.slice(0, q.length - tail.length));
  return out.filter((rest) => rest.length >= 2);
}

/**
 * 꾸밈말 떼기: 앞의 국가직·지방직·국가·지방·N급, 뒤의 공무원·직렬·직류·직군·직·N급을 뗀다. 공백을 지운 글자(seriesNeedle)를 받는다.
 * - 지금 글자가 두 표의 이름(직군·직렬·직류·옛 이름)이면 거기서 멈춘다: '인사조직 공무원' → 인사조직(끝의 '직'을 떼지 않는다).
 * - 앞을 뗄지 뒤를 뗄지, '지방직'을 뗄지 '지방'만 뗄지를 모두 해 보고, 가장 적게 떼어 표의 이름에 닿는 것을 쓴다:
 *   '지방세직' → 지방세('지방'을 먼저 떼면 '세직'이 된다), '지방 직업상담' → 직업상담('지방직'을 떼면 '업상담'이 된다).
 * - 어느 길로도 표의 이름에 닿지 않으면 가장 많이 뗀 글자('9급 경찰행정직' → 경찰행정). 남는 글자가 2자보다 짧아지는 것은 떼지 않는다
 */
export function stripModifiers(needle: string): string {
  if (tableNames.has(needle)) return needle;
  const seen = new Set([needle]);
  let level = [needle];
  let most = needle;
  while (level.length > 0) {
    const next: string[] = [];
    for (const q of level)
      for (const rest of stripOnce(q)) {
        if (seen.has(rest)) continue;
        seen.add(rest);
        if (tableNames.has(rest)) return rest;
        if (rest.length < most.length) most = rest;
        next.push(rest);
      }
    level = next;
  }
  return most;
}

/** 조각 찾기(R2)로 권하는 최대 수 */
const PIECE_MAX = 6;

/**
 * 조각 찾기(R2): 찾는 글자 안에 들어 있는 지금 표의 직렬·직류 이름(2자 이상, 찾는 글자보다 짧은 것).
 * 한 직렬은 한 번만(가장 긴 조각으로). 긴 이름 먼저 → 직렬 이름 먼저(직류는 뒤) → 원문 표 순서, 6개까지. 옛 이름·직군 이름은 보지 않는다
 */
function piecesIn(q: string, scope: SeriesScope): SeriesHit[] {
  const out: SeriesHit[] = [];
  let order = 0;
  for (const g of groupsOf(scope)) {
    for (const s of g.series) {
      order += 1;
      let piece: string | null = null;
      for (const name of [s.name, ...s.jikryu]) {
        if (name.length < 2 || name.length >= q.length || !q.includes(name)) continue;
        if (piece === null || name.length > piece.length) piece = name;
      }
      if (piece === null) continue;
      const bySeries = piece === s.name;
      out.push({
        scope,
        group: g.name,
        series: s.name,
        theme: s.theme,
        by: bySeries ? 'series' : 'jikryu',
        jikryu: bySeries ? null : piece,
        rank: bySeries ? 4 : 5,
        order,
        piece,
      });
    }
  }
  // 같은 길이면 직렬 이름으로 맞은 것을 직류보다 앞에 둔다(R0 의 직렬 같음 0 < 직류 같음 1 과 같게 — '보건운전' → 운전 직렬 먼저)
  return out
    .sort(
      (a, b) =>
        (b.piece?.length ?? 0) - (a.piece?.length ?? 0) || a.rank - b.rank || a.order - b.order,
    )
    .slice(0, PIECE_MAX);
}

/** 넓게 찾기로 어떻게 찾았는지: 그대로 · 꾸밈말을 떼고 · 줄임말을 풀고 · 이름에 든 조각으로(짐작) · 못 찾음 */
export type SeriesFindHow = 'as-is' | 'strip' | 'short' | 'piece' | 'none';

export interface SeriesFind {
  scope: SeriesScope;
  /** 찾는 글자(공백을 지운 것) */
  needle: string;
  /** 꾸밈말을 뗀 글자(뗄 것이 없으면 needle) */
  base: string;
  how: SeriesFindHow;
  /** 실제로 찾은 글자(as-is: needle, strip·piece·none: base, short: 원문 이름) */
  used: string;
  /** 줄임말로 찾았으면 그 줄임말과 원문 이름 */
  short: { say: string; means: string } | null;
  /** 흔히 부르는 이름이면 그 설명(finder.common) */
  common: string | null;
  /** 지금 표 먼저, 다른 표에만 있는 것은 뒤에(searchSeries other 와 같은 순서). 조각 찾기는 지금 표만 */
  hits: SeriesHit[];
}

/**
 * 넓게 찾기(#38). 원문 이름으로 찾기(searchSeries, R0)를 그대로 먼저 하고, 두 표 어디에서도 하나도 못 찾았을 때만
 * R1 꾸밈말 떼기('세무직' → 세무) → R1' 줄임말('교행' → 교육행정) → R2 조각('경찰행정' → 행정, 짐작)을 차례로 해 본다.
 * R2 는 R1 까지 두 표 어디에서도 못 찾았을 때만 한다(다른 표에 있으면 다른 표 안내가 답이다)
 */
export function findSeries(query: string, scope: SeriesScope): SeriesFind {
  const needle = seriesNeedle(query);
  const base = stripModifiers(needle);
  const common = seriesFinder.common.find((c) => c.say.includes(base))?.text ?? null;
  const out = { scope, needle, base, short: null, common };
  if (needle === '') return { ...out, how: 'none', used: needle, hits: [] };
  const asIs = searchSeries(needle, scope, { other: true });
  if (asIs.length > 0) return { ...out, how: 'as-is', used: needle, hits: asIs };
  if (base !== needle && base.length >= 2) {
    const hits = searchSeries(base, scope, { other: true });
    if (hits.length > 0) return { ...out, how: 'strip', used: base, hits };
  }
  const short = seriesFinder.short.find((s) => s.say === base);
  if (short) {
    const hits = searchSeries(short.means, scope, { other: true });
    if (hits.length > 0) return { ...out, short, how: 'short', used: short.means, hits };
  }
  const pieces = piecesIn(base, scope);
  if (pieces.length > 0) return { ...out, how: 'piece', used: base, hits: pieces };
  return { ...out, how: 'none', used: base, hits: [] };
}

/** 지금 표에서 이름이 같게(직렬 이름 같음·직류 이름 같음) 찾았는지. 조각 찾기는 짐작이라 세지 않는다 */
export function foundExactly(find: SeriesFind): boolean {
  return find.how !== 'piece' && find.hits.some((h) => h.scope === find.scope && h.rank <= 1);
}

/** 찾는 칸의 글자를 직접 적은 이름으로: 앞뒤 공백을 떼고 겹친 공백을 하나로 */
export function ownNameOf(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/**
 * [그대로 쓰기]를 보일지. 2자보다 짧음·두 표 어디에서든 이름이 같게 찾음·두 표 어디엔가 있는 이름이면 null(보이지 않는다).
 * trackLabels(직종 말이 알린 다른 직종 이름)를 주면, 꾸밈말을 뗀 글자에서 그 이름을 빼고 2자도 남지 않을 때도 null:
 * '경찰'·'9급 소방 공무원'·'경찰청'은 직종이 답이라 직렬로 적게 권하지 않는다('경찰행정'은 '행정'이 남아 권한다).
 * 형식(한글·영숫자·가운뎃점, 낱말 사이 한 칸)에 맞지 않거나 12자를 넘으면 ok false(까닭 한 줄)
 */
export function ownNameChoice(
  query: string,
  find: SeriesFind,
  trackLabels: readonly string[] = [],
): { name: string; ok: boolean } | null {
  const name = ownNameOf(query);
  // 두 표 어디에서든 이름이 같게 찾았으면(꾸밈말을 뗀 '보건진료직' → 지방 보건진료) 표의 이름·다른 표 안내가 답이다
  const exact = find.how !== 'piece' && find.hits.some((h) => h.rank <= 1);
  if (seriesNeedle(name).length < 2 || exact || inAnyTable(name)) return null;
  let rest = find.base;
  for (const label of trackLabels) rest = rest.replaceAll(seriesNeedle(label), '');
  if (trackLabels.length > 0 && rest.length < 2) return null;
  return { name, ok: name.length <= OWN_NAME_MAX && SERIES_KEY_RE.test(name) };
}

/**
 * 'auto' 소품을 고를 사용자 정보. 직렬 표가 있는 직종(scope)만 직렬 테마를 쓴다
 * (특정직의 'auto' 는 호봉 소품 — 직종 소품은 직접 고를 때만). 직렬 이름·직류는 넘기지 않고 테마 id 만 넘긴다.
 */
export function propOwnerOf(
  profile: { track: TrackId; series: string | null },
  scope: SeriesScope | null,
): PropOwner {
  return {
    track: profile.track,
    bySeries: scope !== null,
    theme: themeOfSeries(profile.series, scope),
  };
}
