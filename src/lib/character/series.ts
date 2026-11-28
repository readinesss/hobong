/**
 * 일반직 직렬·직류 목록(data/series.json schema 2)과 직렬 → 호봉이 소품 테마.
 * - 국가(scope 'national'): 공무원임용령 별표 1·2. 지방(scope 'local'): 지방공무원 임용령 별표 1.
 * - 어느 표를 쓰는지는 직종 데이터의 seriesScope 가 정한다(화면은 직종 id 로 가르지 않는다).
 *
 * 직렬은 소속을 짐작하게 할 수 있다. 여기서는 이름을 찾아 주기만 하고, 어디에 보일지는 사용자 설정
 * (settings.identity.showSeriesHome·settings.card.showSeries)을 본 화면이 정한다. 직류는 직렬보다 좁은 정보라
 * 카드·결산 카드·공유 문구·소품 계산에 쓰지 않는다(seriesNameOf·propOwnerOf 는 직류를 받지 않는다).
 * 저장본의 직렬 키는 원문 직렬 이름이다. 목록에 없는 키(데이터가 바뀜·다른 표의 이름)는 지우지 않고 '없음'처럼 다룬다.
 */
import raw from '../../../data/series.json';
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

export interface SeriesData {
  schema: 2;
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

/** 화면에 보일 직렬 이름(직류 없이 — 카드·소품). 고르지 않았거나 그 표에 없으면 null */
export function seriesNameOf(series: string | null, scope: SeriesScope | null): string | null {
  return seriesByKey(series, scope)?.entry.name ?? null;
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
   * < 직렬 이름 안 4 < 직류 안 5 < 직군 이름 6
   */
  rank: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 원문 표 순서(같은 scope 안에서) */
  order: number;
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
      let best: Pick<SeriesHit, 'rank' | 'by' | 'jikryu'> | null = null;
      const consider = (rank: SeriesHit['rank'], by: SeriesHit['by'], jikryu: string | null) => {
        if (best === null || rank < best.rank) best = { rank, by, jikryu };
      };
      for (const name of [s.name, ...(s.aliases ?? [])]) {
        if (name === q) consider(0, 'series', null);
        else if (name.startsWith(q)) consider(2, 'series', null);
        else if (name.includes(q)) consider(4, 'series', null);
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
        const b: Pick<SeriesHit, 'rank' | 'by' | 'jikryu'> = best;
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
 * 정렬: 지금 표 먼저 → 맞음의 세기 → 원문 표 순서. other 를 켜면 다른 표에만 있는 결과(inTable 이 아닌 것)를 뒤에 붙인다
 */
export function searchSeries(
  query: string,
  scope: SeriesScope,
  opts: { other?: boolean } = {},
): SeriesHit[] {
  const q = seriesNeedle(query);
  if (q === '') return [];
  const sort = (hits: SeriesHit[]) => hits.sort((a, b) => a.rank - b.rank || a.order - b.order);
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

/** 찾은 것의 화면 글자: '행정 · 교육행정 직류' / '행정' */
export function hitText(hit: Pick<SeriesHit, 'series' | 'jikryu' | 'by'>): string {
  return seriesText(hit.series, hit.by === 'jikryu' ? hit.jikryu : null);
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
