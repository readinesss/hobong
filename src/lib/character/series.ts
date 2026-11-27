/**
 * 일반직 직렬 목록(data/series.json, 공무원임용령 별표 1·2)과 직렬 → 호봉이 소품 테마.
 *
 * 직렬은 소속을 짐작하게 할 수 있다. 여기서는 이름을 찾아 주기만 하고, 어디에 보일지는 사용자 설정
 * (settings.identity.showSeriesHome·settings.card.showSeries)을 본 화면이 정한다.
 * 저장본의 직렬 키는 원문 직렬 이름이다. 목록에 없는 키(데이터가 바뀜)는 지우지 않고 '없음'처럼 다룬다.
 */
import raw from '../../../data/series.json';
import type { TrackId } from '../rules/types.ts';
import type { PropOwner } from './look.ts';

export interface SeriesEntry {
  /** 원문 직렬 이름(저장본의 키) */
  name: string;
  /** 호봉이 소품 테마(data/character.json custom.props 의 id) */
  theme: string;
  /** 예전 원문 이름(이름이 바뀌어도 예전 저장본이 맞게) */
  aliases?: string[];
}

export interface SeriesGroup {
  /** 원문 직군 이름 */
  name: string;
  /** sources 의 키 */
  source: string;
  series: SeriesEntry[];
}

export interface SeriesData {
  schema: 1;
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

const index = new Map<string, { entry: SeriesEntry; group: SeriesGroup }>();
for (const group of seriesData.groups) {
  for (const entry of group.series) {
    index.set(entry.name, { entry, group });
    for (const alias of entry.aliases ?? []) index.set(alias, { entry, group });
  }
}

/** 직렬 키의 항목. 고르지 않았거나(null) 목록에 없으면 null */
export function findSeries(key: string | null): { entry: SeriesEntry; group: SeriesGroup } | null {
  return key === null ? null : (index.get(key) ?? null);
}

/** 직렬의 소품 테마. 고르지 않았거나 목록에 없으면 null */
export function themeOfSeries(key: string | null): string | null {
  return findSeries(key)?.entry.theme ?? null;
}

/**
 * 'auto' 소품을 고를 사용자 정보. 직렬은 일반직일 때만 쓴다(특정직의 'auto' 는 호봉 소품 — 직종 소품은 직접 고를 때만).
 * 직렬 이름은 넘기지 않고 테마 id 만 넘긴다(그림 규칙이 직렬 이름을 알 필요가 없게).
 */
export function propOwnerOf(profile: { track: TrackId; series: string | null }): PropOwner {
  return {
    track: profile.track,
    theme: profile.track === 'general' ? themeOfSeries(profile.series) : null,
  };
}

/** 화면에 보일 직렬 이름. 일반직이 아니거나, 고르지 않았거나, 목록에 없으면 null */
export function seriesLabel(profile: { track: TrackId; series: string | null }): string | null {
  if (profile.track !== 'general') return null;
  return findSeries(profile.series)?.entry.name ?? null;
}
