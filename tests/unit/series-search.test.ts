/**
 * #31 묶음 1·3: 직렬·직류 찾기(searchSeries)와 고르기 규칙, 다른 표 안내(careerDiff·otherTableNote),
 * 지방 일반직을 고르는 화면이 직종 id 로 가르지 않는지.
 * 찾기 기대값은 설계 시제품(scratchpad r5/local/proto/search.mjs → search.out.txt)을 실제로 돌린 결과와 같다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  careerDiff,
  careerDiffText,
  footerTarget,
  otherTableNote,
  paydayChipLabel,
  paydayChoiceText,
  paydayHasShortOrgs,
  pendingTrackText,
} from '../../src/lib/app/track.ts';
import {
  counterpartOf,
  hitText,
  inTable,
  jikryuOf,
  searchSeries,
  type SeriesHit,
} from '../../src/lib/character/series.ts';
import { questionsFor } from '../../src/lib/onboarding/questions.ts';
import { resolveCareer } from '../../src/lib/rules/career.ts';
import { rulesFor } from '../../src/lib/rules/index.ts';
import { TRACK_IDS } from '../../src/lib/rules/types.ts';

const R = rulesFor(2026);
const general = resolveCareer(R, { track: 'general', payTable: 'table3', rank: '9' });
const local = resolveCareer(R, { track: 'localGeneral', payTable: null, rank: '9' });

const short = (h: SeriesHit) => `${h.scope === 'local' ? '지방' : '국가'} r${h.rank} ${hitText(h)}`;
const find = (q: string, scope: 'national' | 'local') =>
  searchSeries(q, scope, { other: true }).map(short);

describe('직렬·직류 찾기(searchSeries)', () => {
  it("'교육행정': 국가 표에서는 행정 · 교육행정 직류, 지방 표에서는 교육행정 직렬", () => {
    expect(find('교육행정', 'national')).toEqual([
      '국가 r1 행정 · 교육행정 직류',
      '지방 r0 교육행정',
    ]);
    expect(find('교육행정', 'local')).toEqual(['지방 r0 교육행정', '국가 r1 행정 · 교육행정 직류']);
    const [hit] = searchSeries('교육행정', 'national');
    expect(hit).toMatchObject({ series: '행정', by: 'jikryu', jikryu: '교육행정', group: '행정' });
  });

  it('공백은 지우고 찾는다. 빈 글자는 빈 결과', () => {
    expect(find(' 교육 행정 ', 'national')).toEqual(find('교육행정', 'national'));
    expect(searchSeries('', 'national')).toEqual([]);
    expect(searchSeries('   ', 'local', { other: true })).toEqual([]);
  });

  it('한 직렬은 한 번만(가장 강한 맞음으로), 같은 세기면 원문 순서', () => {
    // 녹지 직렬의 직류 산림자원·산림보호·산림이용이 모두 맞아도 한 번, 원문 순서상 첫 직류로
    expect(find('산림', 'local')).toEqual([
      '지방 r3 녹지 · 산림자원 직류',
      '국가 r2 산림보호운영',
      '국가 r3 임업 · 산림조경 직류',
    ]);
  });

  it('직렬과 같은 이름의 직류는 직렬로 본다(직류로 다시 내지 않는다)', () => {
    // 사서 직렬의 직류 '사서'는 다시 내지 않는다(사무운영 직렬의 '사서운영' 직류는 다른 직렬이라 따로 맞는다)
    expect(searchSeries('사서', 'national').map((h) => [h.series, h.by, h.rank])).toEqual([
      ['사서', 'series', 0],
      ['사무운영', 'jikryu', 3],
    ]);
    expect(searchSeries('간호', 'national').map(hitText)).toEqual(['간호', '간호조무']);
  });

  it('같은 이름 다른 직군·두 직렬에 있는 직류·지금 표에 없는 이름', () => {
    // 두 표에 같은 이름으로 있는 것(직렬, 직렬 · 직류)은 다른 표 결과로 내지 않는다(다른 표에만 있는 이름만)
    expect(find('전산', 'national')).toEqual(['국가 r0 전산', '국가 r3 사무운영 · 전산운영 직류']);
    expect(searchSeries('전산', 'local')[0]?.group).toBe('행정');
    expect(find('운전', 'national')).toEqual([
      '국가 r0 운전',
      '국가 r1 공업 · 운전 직류',
      '지방 r5 공업 · 기계운전 직류',
    ]);
    for (const q of ['세무', '조리', '공업', '사서', '행정'])
      for (const scope of ['national', 'local'] as const)
        expect(
          find(q, scope).filter(
            (h) => h.endsWith(` ${q}`) && !h.startsWith(scope === 'local' ? '지방' : '국가'),
          ),
          `${q}/${scope}`,
        ).toEqual([]);
    expect(find('지방세', 'national')).toEqual(['지방 r1 세무 · 지방세 직류']);
    expect(find('보건진료', 'national')).toEqual(['지방 r0 보건진료']);
    expect(find('노동', 'national')).toEqual([
      '국가 r5 행정 · 고용노동 직류',
      '지방 r1 행정 · 노동 직류',
    ]);
    expect(find('회계', 'national')).toEqual([
      '국가 r1 행정 · 회계 직류',
      '지방 r3 사무운영 · 회계처리운영 직류',
    ]);
  });

  it('직군 이름으로도 찾는다(가장 약한 맞음). 줄임말은 원문 이름이 아니라 찾지 않는다', () => {
    const science = searchSeries('과학', 'national', { other: true });
    expect(science.filter((h) => h.scope === 'national')).toHaveLength(23);
    // 지방 과학기술 직군 22개 가운데 국가 표에 없는 이름은 셋뿐이다
    expect(science.filter((h) => h.scope === 'local').map(hitText)).toEqual([
      '녹지',
      '보건진료',
      '시설관리',
    ]);
    expect(science.every((h) => h.by === 'group' && h.rank === 6)).toBe(true);
    expect(searchSeries('교행', 'national', { other: true })).toEqual([]);
  });

  it('other 를 켜지 않으면 지금 표만', () => {
    expect(searchSeries('지방세', 'national')).toEqual([]);
    expect(searchSeries('교육행정', 'national')).toHaveLength(1);
  });
});

describe('고른 직류(jikryuOf)', () => {
  it('그 직렬의 직류만 받는다. 직렬과 같은 이름·짝이 안 맞음·목록에 없음·다른 표는 null', () => {
    expect(jikryuOf('행정', '교육행정', 'national')).toBe('교육행정');
    expect(jikryuOf('행정', null, 'national')).toBeNull();
    expect(jikryuOf('간호', '간호', 'national')).toBeNull();
    expect(jikryuOf('교육행정', '교육행정', 'local')).toBeNull();
    expect(jikryuOf('세무', '교육행정', 'national')).toBeNull();
    expect(jikryuOf('행정', '교육행정', 'local')).toBeNull();
    expect(jikryuOf(null, '교육행정', 'national')).toBeNull();
    expect(jikryuOf('행정', '교육행정', null)).toBeNull();
  });
});

describe('직종을 바꿔 직렬 표가 달라졌을 때의 짝(counterpartOf) — 권하기만 하고 바꾸지 않는다', () => {
  it("국가 '행정 · 교육행정 직류' → 지방에는 교육행정 직렬이 따로 있다", () => {
    expect(counterpartOf('행정', '교육행정', 'local')).toEqual({
      series: '교육행정',
      jikryu: null,
    });
    // 국가 표 안에서는 짝이 맞아 권할 것이 없다
    expect(counterpartOf('행정', '교육행정', 'national')).toBeNull();
  });
  it("지방 '교육행정' 직렬 → 국가에서는 행정 직렬의 교육행정 직류", () => {
    expect(counterpartOf('교육행정', null, 'national')).toEqual({
      series: '행정',
      jikryu: '교육행정',
    });
    expect(counterpartOf('교육행정', null, 'local')).toBeNull();
  });
  it('직류가 없거나 두 표에 같이 있는 이름, 고르지 않음은 null', () => {
    expect(counterpartOf('세무', null, 'local')).toBeNull();
    expect(counterpartOf('행정', null, 'local')).toBeNull();
    expect(counterpartOf(null, '교육행정', 'local')).toBeNull();
    // 지방 표에 없는 직류이고 같은 이름의 직렬도 없다(고용노동)
    expect(counterpartOf('행정', '고용노동', 'local')).toBeNull();
  });
  it('inTable: 직렬은 이름이, 직류는 그 직렬의 직류가 이 표에도 있어야 한다', () => {
    const hit = (series: string, jikryu: string | null) =>
      ({ series, jikryu, by: jikryu ? 'jikryu' : 'series' }) as const;
    expect(inTable(hit('세무', null), 'local')).toBe(true);
    expect(inTable(hit('교육행정', null), 'national')).toBe(false);
    expect(inTable(hit('행정', '교육행정'), 'local')).toBe(false);
    expect(inTable(hit('행정', '교육행정'), 'national')).toBe(true);
  });
});

describe('월급날 단추·꼬리말 글자', () => {
  it("기관에 따라 갈리는 날은 짧은 기관 이름을 단추에: '20일' / '교육청·학교 17일'. 별표 30 네 행은 날짜만", () => {
    expect(local.payday.options.map((o) => paydayChipLabel(o, 20))).toEqual([
      '20일',
      '교육청·학교 17일',
    ]);
    expect(general.payday.options.map((o) => paydayChipLabel(o, 25))).toEqual([
      '10일',
      '17일',
      '20일',
      '25일',
    ]);
    expect(paydayHasShortOrgs(20, local.payday.options)).toBe(true);
    expect(paydayHasShortOrgs(25, general.payday.options)).toBe(false);
  });
  it("꼬리말: '국가공무원 일반직' / '지방 일반직'(같은 말을 두 번 쓰지 않는다)", () => {
    expect(footerTarget('국가공무원', '일반직')).toBe('국가공무원 일반직');
    expect(footerTarget('국가공무원', '일반직(별표 4)')).toBe('국가공무원 일반직(별표 4)');
    expect(footerTarget('지방공무원', '지방 일반직')).toBe('지방 일반직');
    expect(footerTarget('국가공무원', '경찰')).toBe('국가공무원 경찰');
  });
});

describe('다른 표 안내(careerDiff·otherTableNote) — 직종 이름이 아니라 해석 결과로 만든다', () => {
  it('국가 일반직 → 지방 일반직: 봉급표는 같고, 월급날과 준비 중·다른 기준 항목이 다르다', () => {
    const diff = careerDiff(general, local);
    expect(diff.samePayTable).toBe(true);
    expect(diff.payday?.defaultDay).toBe(20);
    expect(diff.payday?.options.map((o) => o.day)).toEqual([20, 17]);
    expect(diff.off).toEqual([
      { label: '대우공무원', status: 'pending' },
      { label: '장기재직휴가', status: 'external' },
      { label: '반일 연가', status: 'pending' },
      { label: '연도 중 늘어나는 연가 일수', status: 'pending' },
    ]);
    expect(careerDiffText(diff)).toBe(
      '봉급표는 같아요. 달라지는 것: 월급날 기본 20일(교육청·학교는 17일) · 준비 중: 대우공무원, 반일 연가 외 1개 · 다른 기준: 장기재직휴가.',
    );
  });

  it('지방 일반직 → 국가 일반직: 국가 쪽에서 꺼진 항목이 없으면 월급날만 다르다', () => {
    expect(careerDiffText(careerDiff(local, general))).toBe(
      '봉급표는 같아요. 달라지는 것: 월급날 기본 25일(10·17·20일도 고를 수 있어요).',
    );
    // 공안 등(별표 4)을 고른 국가 일반직이면 봉급표가 다르다고 말하지 않는다
    const table4 = resolveCareer(R, { track: 'general', payTable: 'table4', rank: '9' });
    expect(careerDiffText(careerDiff(table4, local))).not.toContain('봉급표는 같아요');
  });

  it('안내 상자 글: 제목(다른 표의 이름) · 누구면 어느 직종을 고르는지 · 차이 줄', () => {
    const hits = searchSeries('교육행정', 'national', { other: true }).filter(
      (h) => h.scope === 'local',
    );
    expect(otherTableNote(R, general, 'national', hits)).toEqual({
      title: '지방공무원 직렬표에 있어요: 교육행정 직렬(행정 직군).',
      who: '시·도 교육청·학교나 시·도·시군구에서 일하는 지방공무원이면 직종에서 지방 일반직을 골라 주세요.',
      diff: '봉급표는 같아요. 달라지는 것: 월급날 기본 20일(교육청·학교는 17일) · 준비 중: 대우공무원, 반일 연가 외 1개 · 다른 기준: 장기재직휴가.',
    });
    const back = searchSeries('관세', 'local', { other: true });
    expect(otherTableNote(R, local, 'local', back)?.title).toBe(
      '국가공무원 직렬표에 있어요: 관세 직렬(행정 직군).',
    );
    expect(otherTableNote(R, local, 'local', back)?.who).toBe(
      '국가공무원이면 직종에서 일반직을 골라 주세요.',
    );
    const tax = searchSeries('지방세', 'national', { other: true });
    expect(otherTableNote(R, general, 'national', tax)?.title).toBe(
      '지방공무원 직렬표에 있어요: 세무 직렬의 지방세 직류(행정 직군).',
    );
    // 많으면 넷까지 이름을 보이고 '외 n개'
    const many = searchSeries('행정', 'local', { other: true }).filter(
      (h) => h.scope === 'national',
    );
    expect(many).toHaveLength(9);
    expect(otherTableNote(R, local, 'local', many)?.title).toMatch(/ 외 5개\.$/);
    expect(otherTableNote(R, general, 'national', [])).toBeNull();
  });

  it('월급날 설명: 기관 글 끝 괄호의 짧은 이름을 쓰고, 없으면 날짜만', () => {
    expect(paydayChoiceText(20, local.payday.options)).toBe('기본 20일(교육청·학교는 17일)');
    expect(paydayChoiceText(25, general.payday.options)).toBe(
      '기본 25일(10·17·20일도 고를 수 있어요)',
    );
  });

  it('지방 일반직의 안내 띠는 준비 중 항목과 일부 준비 중(반일·연도 중 늘어나는 날), 다른 기준을 함께 말한다', () => {
    expect(pendingTrackText(local)).toBe(
      '지방 일반직은 일부만 계산해요. 준비 중: 대우공무원, 반일 연가, 연도 중 늘어나는 연가 일수. 다른 기준: 장기재직휴가.',
    );
    expect(pendingTrackText(general)).toBeNull();
  });
});

describe('첫 입력 질문 차례: 직종 데이터의 표시로 정한다', () => {
  it('지방 일반직은 봉급표를 묻지 않고 직렬은 묻는다', () => {
    const t = R.tracks.items.localGeneral;
    const list = questionsFor({
      askPayTable: t.payTables.length > 1,
      askSeries: t.seriesScope !== undefined,
      askRank: true,
      series: null,
      hasProp: false,
    });
    expect(list).not.toContain('payTable');
    expect(list).toContain('series');
  });

  it('직렬을 고르는 직종은 일반직·지방 일반직뿐이고, 봉급표를 고르는 직종은 일반직뿐이다', () => {
    expect(TRACK_IDS.filter((id) => R.tracks.items[id].seriesScope)).toEqual([
      'general',
      'localGeneral',
    ]);
    expect(R.tracks.items.general.seriesScope).toBe('national');
    expect(R.tracks.items.localGeneral.seriesScope).toBe('local');
    expect(TRACK_IDS.filter((id) => R.tracks.items[id].payTables.length > 1)).toEqual(['general']);
  });
});

describe('화면 코드는 지방 일반직을 직종 id 로 가르지 않는다', () => {
  const ROOT = process.cwd();
  function files(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...files(path));
      else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) out.push(path);
    }
    return out;
  }

  it("src/screens·App.svelte·src/lib/app 에 'localGeneral' 문자열이 없다", () => {
    const list = [
      ...files(join(ROOT, 'src/screens')),
      ...files(join(ROOT, 'src/lib/app')),
      ...files(join(ROOT, 'src/lib/character')),
      ...files(join(ROOT, 'src/lib/onboarding')),
      join(ROOT, 'src/App.svelte'),
    ];
    expect(list.length).toBeGreaterThan(20);
    for (const path of list)
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toContain('localGeneral');
  });

  it('화면·문구 코드에 보수·수당·복무 규정의 조문을 손으로 적지 않는다(직종 해석 결과의 근거에서 읽는다)', () => {
    const list = [
      ...files(join(ROOT, 'src/screens')),
      ...files(join(ROOT, 'src/lib/app')),
      join(ROOT, 'src/App.svelte'),
    ];
    // 주석(// · /* * · <!-- )은 빼고 본다
    const code = (text: string) =>
      text
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*\*|<!--)/.test(l))
        .join('\n');
    for (const path of list)
      expect(code(readFileSync(path, 'utf8')), relative(ROOT, path)).not.toMatch(
        /(보수규정|수당규정|복무규정|수당 등에 관한 규정) ?제\d/,
      );
  });

  it('월급날 선택지·연가 단위를 화면이 연도 규정(국가 별표 30·국가 연가 단위)에서 직접 읽지 않는다', () => {
    const list = [...files(join(ROOT, 'src/screens')), join(ROOT, 'src/App.svelte')];
    for (const path of [
      ...list,
      join(ROOT, 'src/lib/app/draft.svelte.ts'),
      join(ROOT, 'src/lib/app/view.svelte.ts'),
    ]) {
      const text = readFileSync(path, 'utf8');
      expect(text, relative(ROOT, path)).not.toMatch(/\brules\.(payday\.options|leave\.units)/);
    }
  });
});
