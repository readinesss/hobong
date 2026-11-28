/**
 * #38 직렬 찾기를 사람 말로: 넓게 찾기(R0 → R1 꾸밈말 떼기·줄임말 → R2 조각), 찾기 사전(data/series.json finder),
 * 직종 말(trackWordNote), 직접 적은 이름(isOwnSeriesName·seriesNameOf·ownNameChoice).
 * 지금 찾기(searchSeries)의 기대는 tests/unit/series-search.test.ts 에 그대로 있다(바꾸지 않는다).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { otherTableNote, trackWordNote } from '../../src/lib/app/track.ts';
import {
  findSeries,
  foundExactly,
  groupsOf,
  hitText,
  inAnyTable,
  isOwnSeriesName,
  ownNameChoice,
  ownNameOf,
  searchSeries,
  seriesByKey,
  seriesData,
  seriesFinder,
  seriesLabel,
  seriesNameOf,
  seriesWord,
  stripModifiers,
  themeOfSeries,
  type SeriesHit,
  type SeriesScope,
} from '../../src/lib/character/series.ts';
import { resolveCareer } from '../../src/lib/rules/career.ts';
import { rulesFor } from '../../src/lib/rules/index.ts';
import { TRACK_IDS } from '../../src/lib/rules/types.ts';
import { SERIES_KEY_RE } from '../../src/lib/store/schema.ts';

const R = rulesFor(2026);
const general = resolveCareer(R, { track: 'general', payTable: 'table3', rank: '9' });
const local = resolveCareer(R, { track: 'localGeneral', payTable: null, rank: '9' });

const short = (h: SeriesHit) => `${h.scope === 'local' ? '지방' : '국가'} ${hitText(h)}`;
const found = (q: string, scope: SeriesScope = 'national') => {
  const f = findSeries(q, scope);
  return { how: f.how, used: f.used, hits: f.hits.map(short) };
};

describe('넓게 찾기(findSeries)', () => {
  it('R0: 표에 있는 이름은 지금 찾기(searchSeries other)와 같은 결과로 그대로 찾는다', () => {
    for (const q of [
      '교육행정',
      '간호',
      '산림',
      '과학',
      '지방세',
      '인사조직',
      '운전',
      ' 교육 행정 ',
    ])
      for (const scope of ['national', 'local'] as const) {
        const f = findSeries(q, scope);
        expect(f.how, `${q}/${scope}`).toBe('as-is');
        expect(f.hits, `${q}/${scope}`).toEqual(searchSeries(q, scope, { other: true }));
      }
    // '직'으로 끝나도 표에 있는 이름(인사조직)은 떼지 않는다. '지방'으로 시작해도 표의 이름(지방세)은 떼지 않는다
    expect(found('인사조직')).toEqual({
      how: 'as-is',
      used: '인사조직',
      hits: ['국가 행정 · 인사조직 직류'],
    });
    expect(found('지방세', 'local').hits).toEqual(['지방 세무 · 지방세 직류']);
  });

  it('두 표의 모든 직렬·직류 이름(158개)은 그대로 자기 자신을 이름 같음(rank 0·1)으로 찾는다', () => {
    const names = new Map<string, SeriesScope>();
    for (const scope of ['national', 'local'] as const)
      for (const g of groupsOf(scope))
        for (const s of g.series)
          for (const n of [s.name, ...s.jikryu]) if (!names.has(n)) names.set(n, scope);
    expect(names.size).toBe(158);
    for (const [name, scope] of names) {
      const f = findSeries(name, scope);
      expect(f.how, name).toBe('as-is');
      expect(foundExactly(f), name).toBe(true);
      expect(
        f.hits.some(
          (h) => h.scope === scope && h.rank <= 1 && (h.series === name || h.jikryu === name),
        ),
        name,
      ).toBe(true);
    }
  });

  it('R1 꾸밈말 떼기: 앞의 국가직·지방직·국가·지방·N급, 뒤의 공무원·직렬·직류·직군·직', () => {
    expect(found('세무직')).toEqual({ how: 'strip', used: '세무', hits: ['국가 세무'] });
    expect(found('교육행정직')).toEqual({
      how: 'strip',
      used: '교육행정',
      hits: ['국가 행정 · 교육행정 직류', '지방 교육행정'],
    });
    expect(found('지방직 교육행정', 'local').used).toBe('교육행정');
    expect(found('지방직 교육행정', 'local').hits[0]).toBe('지방 교육행정');
    expect(found('9급 사회복지직 공무원')).toEqual({
      how: 'strip',
      used: '사회복지',
      hits: ['국가 사회복지'],
    });
    expect(found('국가직 간호직렬').used).toBe('간호');
    expect(stripModifiers('7급세무직공무원')).toBe('세무');
    expect(stripModifiers('지방세')).toBe('지방세');
    // 표의 이름이면 거기서 멈춘다('인사조직'의 끝 '직'을 떼지 않는다)
    expect(stripModifiers('인사조직')).toBe('인사조직');
    // 2자보다 짧아지는 것은 떼지 않는다
    expect(stripModifiers('지방직')).toBe('지방');
    expect(stripModifiers('공무원')).toBe('공무원');
    // 급수는 뒤에도 붙는다
    expect(found('교정직 9급')).toEqual({ how: 'strip', used: '교정', hits: ['국가 교정'] });
    expect(found('행정9급').used).toBe('행정');
  });

  it('꾸밈말을 떼도 표의 이름은 깎지 않는다: 지금 글자가 표의 이름이면 멈추고, 앞·뒤·짧은 앞 꾸밈말을 모두 해 본다', () => {
    expect(found('인사조직 공무원')).toEqual({
      how: 'strip',
      used: '인사조직',
      hits: ['국가 행정 · 인사조직 직류'],
    });
    expect(found('9급 인사조직').used).toBe('인사조직');
    expect(stripModifiers('7급인사조직직공무원')).toBe('인사조직');
    // 지방 표의 '지방세': '지방'을 먼저 떼면 '세직'이 된다
    expect(found('지방세직', 'local')).toEqual({
      how: 'strip',
      used: '지방세',
      hits: ['지방 세무 · 지방세 직류'],
    });
    expect(found('지방세 공무원', 'local').used).toBe('지방세');
    expect(found('7급 지방세직 공무원', 'local').hits[0]).toBe('지방 세무 · 지방세 직류');
    // 국가 표에서는 다른 표 안내로(꾸밈말을 떼어 '지방세'로 찾는다)
    expect(found('지방세직')).toEqual({
      how: 'strip',
      used: '지방세',
      hits: ['지방 세무 · 지방세 직류'],
    });
    // '지방직'을 떼면 '직업상담'의 '직'까지 먹는다 → '지방'만 뗀다
    expect(found('지방 직업상담')).toEqual({
      how: 'strip',
      used: '직업상담',
      hits: ['국가 직업상담'],
    });
    expect(found('지방직 직업상담', 'local').used).toBe('직업상담');
    // 어느 길로도 표의 이름에 닿지 않으면 가장 많이 뗀 글자
    expect(stripModifiers('9급경찰행정직공무원')).toBe('경찰행정');
  });

  it('두 표의 모든 직렬·직류 이름(158개)에 꾸밈말 9가지를 붙여도 그 이름을 이름 같음(rank 0·1)으로 찾는다', () => {
    const mods = [
      (x: string) => `${x}직`,
      (x: string) => `${x}직렬`,
      (x: string) => `${x}직류`,
      (x: string) => `${x} 공무원`,
      (x: string) => `9급 ${x}`,
      (x: string) => `지방직 ${x}`,
      (x: string) => `국가직 ${x}직`,
      (x: string) => `7급 ${x}직 공무원`,
      (x: string) => `지방 ${x}`,
      (x: string) => `${x}직 9급`,
    ];
    let n = 0;
    const bad: string[] = [];
    for (const scope of ['national', 'local'] as const)
      for (const g of groupsOf(scope))
        for (const s of g.series)
          for (const name of new Set([s.name, ...s.jikryu]))
            for (const mod of mods) {
              const q = mod(name);
              n += 1;
              const f = findSeries(q, scope);
              const ok =
                f.how !== 'piece' &&
                f.hits.some(
                  (h) =>
                    h.scope === scope &&
                    h.series === s.name &&
                    h.rank <= 1 &&
                    (name === s.name || h.jikryu === name),
                );
              if (!ok) bad.push(`${scope} '${q}' how=${f.how} used=${f.used}`);
            }
    expect(n).toBeGreaterThan(2500);
    expect(bad).toEqual([]);
  });

  it("R1' 줄임말: 사전(finder.short)의 셋만, 꾸밈말을 뗀 뒤에도", () => {
    expect(seriesFinder.short.map((s) => s.say)).toEqual(['교행', '일행', '사복']);
    const f = findSeries('교행', 'national');
    expect(f).toMatchObject({
      how: 'short',
      used: '교육행정',
      short: { say: '교행', means: '교육행정' },
    });
    expect(f.hits.map(short)).toEqual(['국가 행정 · 교육행정 직류', '지방 교육행정']);
    expect(found('교행직', 'local')).toEqual({
      how: 'short',
      used: '교육행정',
      hits: ['지방 교육행정', '국가 행정 · 교육행정 직류'],
    });
    expect(found('일행').hits[0]).toBe('국가 행정 · 일반행정 직류');
    expect(found('사복').hits).toEqual(['국가 사회복지']);
    // 사전에 없는 줄임말은 풀지 않는다
    expect(found('보행').how).toBe('none');
  });

  it("R2 조각: 찾는 글자 안의 지금 표 이름을 짐작으로 권한다('경찰행정' → 행정)", () => {
    const f = findSeries('경찰행정', 'national');
    expect(f.how).toBe('piece');
    expect(f.hits.map(short)).toEqual(['국가 행정']);
    expect(f.hits[0]).toMatchObject({ piece: '행정', by: 'series', rank: 4 });
    expect(foundExactly(f)).toBe(false);
    expect(found('경찰행정', 'local').hits).toEqual(['지방 행정']);
    expect(found('경찰행정직').how).toBe('piece');
    // 한 직렬은 한 번만, 가장 긴 조각으로
    expect(found('경찰일반행정').hits).toEqual(['국가 행정 · 일반행정 직류']);
    // 같은 길이면 직렬 이름이 직류보다 먼저('운전'은 직렬이자 공업 직렬의 직류)
    expect(found('보건운전').hits).toEqual(['국가 보건', '국가 운전', '국가 공업 · 운전 직류']);
    // 긴 이름 먼저 → 원문 표 순서, 6개까지
    const many = findSeries('간호보건환경통계사서세무관세', 'national');
    expect(many.how).toBe('piece');
    expect(many.hits).toHaveLength(6);
    expect(many.hits.map((h) => h.piece)).toEqual(['보건', '간호', '환경', '세무', '관세', '통계']);
    // 다른 표에 있으면 조각 찾기를 하지 않는다(다른 표 안내가 답이다)
    expect(found('보건진료직')).toEqual({
      how: 'strip',
      used: '보건진료',
      hits: ['지방 보건진료'],
    });
  });

  it('못 찾음과 이상한 글자: 죽지 않고 빈 결과', () => {
    for (const q of [
      '',
      ' ',
      '   ',
      '가',
      '😀',
      '😀😀😀',
      '<b>행</b>',
      '\n\t',
      'x'.repeat(41),
      '가'.repeat(200),
    ]) {
      const f = findSeries(q, 'national');
      expect(['none', 'piece', 'as-is'], q).toContain(f.how);
    }
    expect(found('').how).toBe('none');
    expect(found('법원사무')).toEqual({ how: 'none', used: '법원사무', hits: [] });
    expect(found('😀').hits).toEqual([]);
  });

  it('흔히 부르는 이름(finder.common): 꾸밈말을 뗀 글자가 say 와 같을 때만 설명을 낸다', () => {
    expect(findSeries('경찰행정', 'national').common).toMatch(
      /^흔히 경찰청·경찰서에서 일하는 일반직/,
    );
    expect(findSeries('경찰 행정직', 'local').common).not.toBeNull();
    expect(findSeries('경찰', 'national').common).toBeNull();
    expect(findSeries('경찰행정학', 'national').common).toBeNull();
  });

  it('옛 이름(aliases)으로 맞으면 목록 글자에 옛 이름을 함께 보인다', () => {
    const alias = {
      scope: 'national',
      group: '행정',
      series: '형사법무',
      theme: 'folder',
      by: 'series',
      jikryu: null,
      rank: 0,
      order: 1,
      alias: '검찰',
    } as const;
    // '옛 이름'이라 하지 않는다: 형사법무는 검찰·마약수사를 합친 것(부칙 제4조)이라 이름만 바뀐 것이 아니다
    expect(hitText(alias)).toBe('형사법무 (예전 검찰 직렬)');
    // 지금 데이터의 옛 이름은 모두 SERIES_KEY_RE 를 지키고, 옛 이름으로 찾으면 그 옛 이름이 결과에 담긴다
    for (const g of seriesData.groups)
      for (const s of g.series)
        for (const a of s.aliases ?? []) {
          expect(SERIES_KEY_RE.test(a), a).toBe(true);
          const hit = searchSeries(a, g.scope).find((h) => h.series === s.name);
          expect(hit?.alias, a).toBe(a);
        }
    expect(found('검찰').hits).toEqual(['국가 형사법무 (예전 검찰 직렬)']);
    expect(found('마약수사직').hits).toEqual(['국가 형사법무 (예전 마약수사 직렬)']);
    expect(found('철도공안').hits).toEqual(['국가 철도경찰 (예전 철도공안 직렬)']);
    // 옛 이름으로 저장된 값은 지금 이름으로 보이고, 직접 적은 이름이 아니다
    expect(seriesNameOf('검찰', 'national')).toBe('형사법무');
    expect(isOwnSeriesName('마약수사')).toBe(false);
    expect(themeOfSeries('철도공안', 'national')).toBe('folder');
  });

  it("옛 이름은 같음(rank 0)과 2자 이상의 앞부분(rank 2)으로만 맞는다 — '사무'·'공안'·'수사'·'검'에 끼어들지 않는다", () => {
    expect(found('사무').hits).toEqual(['국가 사무운영']);
    expect(found('사무', 'local').hits).toEqual(['지방 사무운영']);
    expect(found('공안').how).toBe('none');
    expect(found('공안직').how).toBe('none');
    expect(found('수사').how).toBe('none');
    expect(findSeries('검', 'national').hits.some((h) => h.alias !== undefined)).toBe(false);
    const drug = findSeries('마약', 'national').hits;
    expect(drug.map(short)).toEqual(['국가 형사법무 (예전 마약수사 직렬)']);
    expect(drug[0]).toMatchObject({ alias: '마약수사', rank: 2 });
    // 다른 표 안내도 옛 이름을 밝힌다(왜 그 직렬이 나왔는지 알게)
    const other = findSeries('검찰', 'local').hits.filter((h) => h.scope === 'national');
    expect(otherTableNote(R, local, 'local', other)?.title).toBe(
      '국가공무원 직렬표에 있어요: 형사법무 직렬(예전 검찰 직렬, 행정 직군).',
    );
    // '검찰'은 옛 이름 '검찰'과 같다(rank 0) — '검찰사무'의 앞부분보다 강하다
    expect(findSeries('검찰', 'national').hits[0]).toMatchObject({ alias: '검찰', rank: 0 });
  });
});

describe('옛 이름(aliases)은 공무원임용령 개정문·부칙 원문 발췌본으로 확인한 것만', () => {
  const ROOT = process.cwd();
  const snap = (name: string) => readFileSync(join(ROOT, 'docs/sources/2026', name), 'utf8');

  it('옛 이름 목록은 원문으로 확인한 넷뿐이다(직류 단위의 옛 이름·겹치는 이름은 넣지 않는다 — TODO T50)', () => {
    const all = seriesData.groups.flatMap((g) =>
      g.series.flatMap((s) => (s.aliases ?? []).map((a) => `${g.scope}:${s.name}←${a}`)),
    );
    expect(all).toEqual([
      'national:형사법무←검찰',
      'national:형사법무←마약수사',
      'national:형사법무←검찰사무',
      'national:철도경찰←철도공안',
    ]);
  });

  it('형사법무 ← 검찰·마약수사: 대통령령 제36728호 제22조(별표 1)와 부칙 제4조', () => {
    const t = snap('appointment-decree-rename-36728-hyeongsabeommu.txt');
    expect(t).toContain('[대통령령 제36728호, 2026. 9. 29., 타법개정]');
    expect(t).toContain(
      '별표 1의 행정직군의 보호 직렬란 다음에 형사법무 직렬란을 다음과 같이 신설하고, 검찰 직렬란 및 마약수사 직렬란을 각각 삭제한다.',
    );
    expect(t).toContain(
      '종전의 「공무원임용령」 별표 1에 따른 검찰직렬과 마약수사직렬의 5급 이하 공무원은 이 영 시행일에 같은 표의 개정규정에 따른 형사법무직렬의 해당 직급으로 임용된 것으로 본다.',
    );
    // 지금 표(별표 1 발췌본)에는 형사법무가 있고 검찰·마약수사는 없다
    const table = snap('appointment-decree-table1-grades.txt');
    expect(table).toContain('형사법무');
    expect(table).not.toMatch(/검찰|마약수사/);
  });

  it('검찰사무 → 검찰: 대통령령 제24124호 개정문(별표 1 검찰사무직렬란을 검찰로)', () => {
    const t = snap('appointment-decree-rename-24124-geomchal.txt');
    expect(t).toContain('[대통령령 제24124호, 2012. 9. 28., 일부개정]');
    expect(t).toContain('별표 1 행정직군의 검찰사무직렬란을 다음과 같이 한다.');
    expect(t).toMatch(/\[그림 판독\] 검찰 \| 검찰 \|/);
  });

  it('철도경찰 ← 철도공안: 대통령령 제25000호 부칙 제7조', () => {
    const t = snap('appointment-decree-rename-25000-cheoldogyeongchal.txt');
    expect(t).toContain('[대통령령 제25000호, 2013. 12. 16., 일부개정]');
    expect(t).toContain(
      '종전의 별표 1 중 행정직군 철도공안직렬의 5급 이하 공무원은 이 영 시행일에 별표 1의 개정규정에 따른 행정직군 철도경찰직렬의 해당 직급의 공무원으로 임용된 것으로 본다.',
    );
    expect(snap('appointment-decree-table1-grades.txt')).toContain('철도경찰');
  });
});

describe('직종 말(trackWordNote) — 다른 직종이 따로 있다고 알린다', () => {
  const note = (q: string, career = general, scope: SeriesScope = 'national') =>
    trackWordNote(R, career, findSeries(q, scope));

  it("'경찰행정' → 경찰. 직종을 저절로 바꾸지 않고, label 뒤에 '공무원'을 붙이지 않는다", () => {
    expect(note('경찰행정')).toEqual({
      labels: ['경찰'],
      text: '직종에 경찰이 따로 있어요. 해당하면 직종을 바꿔 주세요. 그 직종은 직렬을 고르지 않아요.',
    });
    expect(note('교원')?.text).toBe(
      '직종에 교원이 따로 있어요. 해당하면 직종을 바꿔 주세요. 그 직종은 직렬을 고르지 않아요.',
    );
    expect(note('소방행정')?.text).toMatch(/^직종에 소방이 따로/);
    for (const q of ['경찰행정', '교원', '소방', '외무', '군무원'])
      expect(note(q)?.text, q).not.toContain('공무원이면');
  });

  it("결과가 있어도 보인다('경찰' → 철도경찰이 나와도). 지금 표에서 이름이 같게 찾으면 숨긴다", () => {
    expect(findSeries('경찰', 'national').hits.map(short)).toEqual(['국가 철도경찰']);
    expect(note('경찰')?.labels).toEqual(['경찰']);
    expect(note('철도경찰')).toBeNull();
    expect(note('행정')).toBeNull();
    expect(note('')).toBeNull();
  });

  it("겹치면 긴 이름만('해양경찰행정' → 해양경찰). 둘이 따로 들면 둘 다", () => {
    expect(note('해양경찰행정')?.labels).toEqual(['해양경찰']);
    expect(note('경찰소방')?.labels).toEqual(['경찰', '소방']);
    expect(note('경찰소방')?.text).toMatch(/^직종에 경찰·소방이 따로/);
  });

  it('지금 직종과 직렬 표가 있는 직종(일반직·지방 일반직)은 뺀다', () => {
    expect(note('일반직')).toBeNull();
    expect(note('지방일반직', local, 'local')).toBeNull();
    expect(note('지방일반직')).toBeNull();
    const police = resolveCareer(R, { track: 'police', payTable: null, rank: '순경' });
    expect(trackWordNote(R, police, findSeries('경찰행정', 'national'))).toBeNull();
    expect(note('경찰행정', local, 'local')?.labels).toEqual(['경찰']);
  });
});

describe('직접 적은 이름 — 두 표 어디에도 없는 이름(저장 형식은 그대로)', () => {
  it('두 표에 없음 / 다른 표에만 있음 / 직류 이름 / 직군 이름 / 형식·길이', () => {
    expect(isOwnSeriesName('경찰행정')).toBe(true);
    expect(isOwnSeriesName('법원사무')).toBe(true);
    expect(isOwnSeriesName('법원 사무')).toBe(true);
    expect(isOwnSeriesName('없는직렬')).toBe(true);
    // 다른 표에만 있는 이름은 직접 적은 이름이 아니다(숨기고 짝을 권한다)
    expect(isOwnSeriesName('교육행정')).toBe(false);
    expect(isOwnSeriesName('보건진료')).toBe(false);
    expect(isOwnSeriesName('관세')).toBe(false);
    expect(isOwnSeriesName('일반행정')).toBe(false);
    expect(isOwnSeriesName('과학기술')).toBe(false);
    expect(isOwnSeriesName('교육 행정')).toBe(false);
    expect(isOwnSeriesName(null)).toBe(false);
    expect(isOwnSeriesName('가'.repeat(12))).toBe(true);
    expect(isOwnSeriesName('가'.repeat(13))).toBe(false);
    expect(isOwnSeriesName('경찰행정!')).toBe(false);
    // 옛 이름(aliases)은 표의 이름이다
    for (const g of seriesData.groups)
      for (const s of g.series)
        for (const a of s.aliases ?? []) expect(isOwnSeriesName(a), a).toBe(false);
    expect(inAnyTable('교육 행정')).toBe(true);
  });

  it("seriesNameOf·seriesLabel: 직접 적은 이름은 그대로(직류 없이), 직렬 표가 없는 직종에서는 null. '직렬'을 붙이지 않는다", () => {
    expect(seriesNameOf('경찰행정', 'national')).toBe('경찰행정');
    expect(seriesNameOf('경찰행정', 'local')).toBe('경찰행정');
    expect(seriesNameOf('경찰행정', null)).toBeNull();
    expect(seriesNameOf('교육행정', 'national')).toBeNull();
    expect(seriesNameOf('교육행정', 'local')).toBe('교육행정');
    expect(seriesNameOf('가'.repeat(13), 'national')).toBeNull();
    expect(seriesLabel({ series: '경찰행정', seriesJikryu: '교육행정' }, 'national')).toBe(
      '경찰행정',
    );
    expect(seriesWord('경찰행정')).toBe('경찰행정');
    expect(seriesWord('행정')).toBe('행정 직렬');
    // 소품 테마가 없다: 'auto' 는 직렬을 고르지 않았을 때와 같다
    expect(themeOfSeries('경찰행정', 'national')).toBeNull();
    expect(seriesByKey('경찰행정', 'national')).toBeNull();
  });

  it('[그대로 쓰기]: 형식에 맞고 12자 이하이고 두 표에 없을 때. 지금 표에서 이름이 같게 찾으면 보이지 않는다', () => {
    const choice = (q: string, scope: SeriesScope = 'national') =>
      ownNameChoice(q, findSeries(q, scope));
    expect(ownNameOf('  법원   사무 ')).toBe('법원 사무');
    expect(choice('경찰행정')).toEqual({ name: '경찰행정', ok: true });
    expect(choice('  법원   사무 ')).toEqual({ name: '법원 사무', ok: true });
    expect(choice('경찰')).toEqual({ name: '경찰', ok: true });
    expect(choice('가'.repeat(12))).toEqual({ name: '가'.repeat(12), ok: true });
    expect(choice('가'.repeat(13))?.ok).toBe(false);
    expect(choice('경찰행정!')?.ok).toBe(false);
    expect(choice('😀')?.ok).toBe(false);
    expect(choice('')).toBeNull();
    expect(choice('   ')).toBeNull();
    // 표에 있는 이름·같게 찾은 이름·다른 표의 이름·줄임말로 같게 찾은 이름은 그대로 쓰지 않는다
    for (const q of ['행정', '교육행정', '세무직', '보건진료', '지방세', '교행', '과학기술'])
      expect(choice(q), q).toBeNull();
    expect(choice('교육행정', 'local')).toBeNull();
    expect(choice('보건진료직')).toBeNull();
    expect(choice('경찰행정직')).toEqual({ name: '경찰행정직', ok: true });
    // 2자보다 짧은 글자는 권하지 않는다
    expect(choice('겨')).toBeNull();
    expect(choice(' 가 ')).toBeNull();
  });

  it('[그대로 쓰기]는 직종 말이 알린 직종 이름뿐인 글자(직종 이름 ± 한 글자)를 권하지 않는다', () => {
    const withTrack = (q: string) => {
      const f = findSeries(q, 'national');
      return ownNameChoice(q, f, trackWordNote(R, general, f)?.labels ?? []);
    };
    for (const q of [
      '경찰',
      '경찰청',
      '경찰서',
      '교원',
      '소방',
      '9급 소방 공무원',
      '9급 경찰 공무원',
      '해양경찰청',
      '경찰소방',
    ])
      expect(withTrack(q), q).toBeNull();
    expect(withTrack('경찰행정')).toEqual({ name: '경찰행정', ok: true });
    expect(withTrack('소방행정')).toEqual({ name: '소방행정', ok: true });
    expect(withTrack('법원사무')).toEqual({ name: '법원사무', ok: true });
  });
});

describe('찾기 사전(data/series.json finder)의 규칙', () => {
  const allSays = [
    ...seriesFinder.short.map((s) => s.say),
    ...seriesFinder.common.flatMap((c) => c.say),
  ];

  it('schema 3. say 는 두 표 어디에도 없고, means 는 어느 표엔가 있는 직렬·직류 이름이다', () => {
    expect(seriesData.schema).toBe(3);
    expect(allSays.length).toBeGreaterThan(0);
    for (const say of allSays) {
      expect(inAnyTable(say), say).toBe(false);
      expect(searchSeries(say, 'national', { other: true }), say).toEqual([]);
    }
    const names = new Set(
      seriesData.groups.flatMap((g) => g.series.flatMap((s) => [s.name, ...s.jikryu])),
    );
    for (const s of seriesFinder.short) expect(names.has(s.means), s.means).toBe(true);
    expect(new Set(allSays).size).toBe(allSays.length);
  });

  it('모든 글자는 SERIES_KEY_RE 형식이고, 꾸밈말을 떼도 그대로다(사전 키가 R1 뒤의 글자와 맞게)', () => {
    for (const say of allSays) {
      expect(SERIES_KEY_RE.test(say), say).toBe(true);
      expect(stripModifiers(say), say).toBe(say);
    }
    for (const s of seriesFinder.short) expect(SERIES_KEY_RE.test(s.means), s.means).toBe(true);
  });

  it("흔히 부르는 이름의 설명은 해요체이고 조사를 뭉뚱그리지 않는다. 지금은 '경찰행정' 하나", () => {
    expect(seriesFinder.common.map((c) => c.say)).toEqual([['경찰행정']]);
    for (const c of seriesFinder.common) {
      expect(c.text).not.toMatch(/니다([.!?\s]|$)/);
      expect(c.text).not.toMatch(/\((은|는|이|가|을|를|과|와|으로)\)/);
      expect(c.text).toMatch(/요\.$/);
      expect(c.text.length).toBeLessThan(120);
    }
  });
});

describe('파일 묶음: 찾기 사전은 찾기에서만 읽고, 화면 코드는 직종 id 로 가르지 않는다', () => {
  const ROOT = process.cwd();
  function files(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'assets') out.push(...files(path));
      } else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) out.push(path);
    }
    return out;
  }
  const sources = files(join(ROOT, 'src')).map((path) => ({
    path: relative(ROOT, path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }));
  const FINDER = /finder|findSeries|seriesFinder|stripModifiers|ownNameChoice|trackWordNote/;

  it('카드·결산 카드·공유 문구를 만드는 파일은 찾기 사전·넓게 찾기를 읽지 않는다', () => {
    for (const path of [
      'src/lib/card/render.ts',
      'src/lib/card/recap.ts',
      'src/screens/CardMaker.svelte',
      'src/screens/card/RecapOptions.svelte',
      'src/lib/app/share.ts',
      'src/screens/share/ShareNote.svelte',
    ]) {
      const file = sources.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(file?.text ?? '', path).not.toMatch(FINDER);
    }
    // 검사가 헛돌지 않는다: 찾는 화면과 찾기 코드는 읽는다
    const readers = sources.filter((f) => FINDER.test(f.text)).map((f) => f.path);
    expect(readers).toContain('src/lib/character/series.ts');
    expect(readers).toContain('src/screens/profile/SeriesPicker.svelte');
  });

  it('직렬 고르기 화면·찾기 코드·직종 말 도우미에 직종 id 문자열이 없다', () => {
    const ids = new RegExp(`['"\`](${TRACK_IDS.join('|')})['"\`]`);
    for (const path of ['src/screens/profile/SeriesPicker.svelte', 'src/lib/character/series.ts'])
      expect(sources.find((f) => f.path === path)?.text ?? '', path).not.toMatch(ids);
    expect(trackWordNote.toString()).not.toMatch(ids);
    expect(trackWordNote.toString()).toContain('seriesScope');
  });
});
