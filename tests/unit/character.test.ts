import { describe, expect, it } from 'vitest';
import { characterRules as C } from '../../src/lib/character/rules.ts';
import { decideGrowth } from '../../src/lib/character/growth.ts';
import type { Ladder, LadderId } from '../../src/lib/rules/types.ts';
import {
  decideMood,
  formById,
  formFor,
  formIdFor,
  tenureStage,
  itemsAt,
  nextUnlock,
  resolveLook,
  unlockList,
  type MoodInput,
} from '../../src/lib/character/look.ts';
import { compose, toRgba, type Layer } from '../../src/lib/character/compose.ts';
import {
  buildSpriteIndex,
  parseSprites,
  SpriteFormatError,
  TRANSPARENT,
} from '../../src/lib/character/sprite-format.ts';
import { rulesFor } from '../../src/lib/rules/index.ts';

describe('스프라이트 형식', () => {
  const text = `
# 주석
@name body
@anchor eyes 2 1
@anchor head 2 0
.00.
0440
0440
.00.
@name dot
@origin 0 0
@attach eyes
@layer 10
0
@frame
c
`;
  const [body, dot] = parseSprites(text, 'test');
  it('파싱', () => {
    expect(body).toMatchObject({
      name: 'body',
      w: 4,
      h: 4,
      origin: [0, 0],
      attach: null,
      layer: 0,
    });
    expect(body?.anchors).toEqual({ eyes: [2, 1], head: [2, 0] });
    expect(body?.frames).toHaveLength(1);
    expect(Array.from(body?.frames[0] ?? []).slice(0, 4)).toEqual([TRANSPARENT, 0, 0, TRANSPARENT]);
    expect(dot).toMatchObject({ name: 'dot', w: 1, h: 1, attach: 'eyes', layer: 10 });
    expect(dot?.frames).toHaveLength(2);
    expect(dot?.frames[1]?.[0]).toBe(12);
  });
  it('형식 오류는 위치와 함께 알린다', () => {
    expect(() => parseSprites('00\n')).toThrow(SpriteFormatError);
    expect(() => parseSprites('@name a\n00\n0\n')).toThrow(/너비/);
    expect(() => parseSprites('@name a\n0g\n')).toThrow(/알 수 없는 픽셀 문자/);
    expect(() => parseSprites('@name a\n@what 1\n00\n')).toThrow(/알 수 없는 지시어/);
    expect(() => parseSprites('@name a\n')).toThrow(/픽셀 행이 없습니다/);
    expect(() => parseSprites('@name a\n00\n@frame\n00\n00\n')).toThrow(/행 수/);
    expect(() => parseSprites('@name a\n@origin x 1\n00\n')).toThrow(/정수/);
    expect(() =>
      buildSpriteIndex([parseSprites('@name a\n0\n'), parseSprites('@name a\n0\n')]),
    ).toThrow(/중복/);
  });
  it('합성: 앵커·기준점·레이어·치환·몸통 이동', () => {
    if (!body || !dot) throw new Error('fixture');
    const layers: Layer[] = [{ sprite: dot, frame: 1, remap: { 12: 2 } }, { sprite: body }];
    const out = compose(layers, { w: 4, h: 4, body });
    // 점은 몸통보다 나중에(layer 10) 그려져 (2,1)을 덮는다
    expect(out.pixels[1 * 4 + 2]).toBe(2);
    expect(out.pixels[1 * 4 + 1]).toBe(4);
    const moved = compose(layers, { w: 4, h: 4, body, bodyDy: 1 });
    expect(moved.pixels[2 * 4 + 2]).toBe(2);
    expect(moved.pixels[0]).toBe(TRANSPARENT);
    const rgba = toRgba(out, C.palette);
    expect(Array.from(rgba.slice((1 * 4 + 2) * 4, (1 * 4 + 2) * 4 + 4))).toEqual([
      0xb1, 0x3e, 0x53, 255,
    ]);
    expect(rgba[3]).toBe(0);
    expect(() => compose([{ sprite: { ...dot, attach: 'nose' } }], { w: 4, h: 4, body })).toThrow(
      /앵커/,
    );
  });
});

describe('캐릭터 규칙 (data/character.json)', () => {
  it('팔레트는 16색', () => {
    expect(C.palette).toHaveLength(16);
    for (const color of C.palette) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(C.canvas).toEqual({ w: 48, h: 48 });
  });
  it('모든 직급에 형태가 하나씩 있다', () => {
    for (let g = 1; g <= 9; g += 1) {
      expect(C.forms.filter((f) => f.grades.includes(g))).toHaveLength(1);
    }
    expect(formFor(C, '9').id).toBe('egg');
    expect(formFor(C, '8').id).toBe('chick');
    expect(formFor(C, '7').id).toBe('fledgling');
    expect(formFor(C, '6').id).toBe('bird');
    expect(formFor(C, '5').id).toBe('phoenix');
    expect(formFor(C, '1').id).toBe('phoenix');
  });
  it('치환 색은 팔레트 범위 안이다', () => {
    for (const item of C.items) {
      for (const tint of item.tints ?? []) {
        for (const [from, to] of Object.entries(tint.remap)) {
          expect(Number(from)).toBeGreaterThanOrEqual(0);
          expect(Number(from)).toBeLessThan(16);
          expect(to).toBeGreaterThanOrEqual(0);
          expect(to).toBeLessThan(16);
        }
      }
    }
  });
  it('넥타이 색은 몸통 바탕색(팔레트 3·4)과 겹치지 않아 가슴 위에서 보인다', () => {
    // 몸통 바탕 #ffcd75(4)·줄무늬 #ef7d57(3) 위에 그려지므로, 넥타이 면(2)·무늬(1)가 그 색이면 묻힌다
    const BODY = [3, 4];
    const tie = C.items.find((i) => i.id === 'tie');
    expect(tie?.tints?.length).toBeGreaterThan(0);
    for (const tint of tie?.tints ?? []) {
      const face = tint.remap['2'] ?? 2;
      expect(BODY, `${tint.name}의 면 색`).not.toContain(face);
      // 무늬가 몸통 색이면 넥타이에 구멍이 난 것처럼 보인다
      const mark = tint.remap['1'] ?? 1;
      expect(BODY, `${tint.name}의 무늬 색`).not.toContain(mark);
    }
  });
  it('1호봉부터 무언가를 걸치고, 호봉이 오르면 소품이 바뀐다', () => {
    expect(itemsAt(C, 1).map((i) => i.id)).toEqual(['lanyard']);
    expect(
      itemsAt(C, 3)
        .map((i) => i.id)
        .sort(),
    ).toEqual(['lanyard', 'mug']);
    expect(
      itemsAt(C, 12)
        .map((i) => i.id)
        .sort(),
    ).toEqual(['folder', 'glasses', 'mug', 'tie']);
    expect(
      itemsAt(C, 16)
        .map((i) => i.id)
        .sort(),
    ).toEqual(['folder', 'glasses', 'stamp', 'tie']);
    expect(
      itemsAt(C, 31)
        .map((i) => i.id)
        .sort(),
    ).toEqual(['crest', 'folder', 'glasses', 'stamp', 'tie']);
  });
  it('열리는 순서와 다음에 열릴 것', () => {
    const list = unlockList(C);
    expect(list.map((u) => u.step)).toEqual([...list.map((u) => u.step)].sort((a, b) => a - b));
    expect(list[0]).toMatchObject({ step: 1, name: '공무원증' });
    expect(nextUnlock(C, 1)).toMatchObject({ step: 3, name: '머그컵' });
    expect(nextUnlock(C, 3)).toMatchObject({ step: 4, name: '초록 줄' });
    expect(nextUnlock(C, 31)).toBeNull();
    // 손 소품을 들면 왼손 호봉 소품(결재판)은 약속하지 않는다
    expect(nextUnlock(C, 8)).toMatchObject({ step: 9, name: '결재판', slot: 'handL' });
    expect(nextUnlock(C, 8, true)).toMatchObject({ step: 12 });
    expect(unlockList(C, true).some((u) => u.slot === 'handL')).toBe(false);
    expect(unlockList(C, true)).toHaveLength(list.length - 1);
  });
});

describe('모습 정하기', () => {
  it('근무 중: 그림자 + 호봉 소품', () => {
    const look = resolveLook(C, formFor(C, '8').id, 5, 'work');
    expect(look.form.id).toBe('chick');
    expect(look.eyes).toBe('eyes-open');
    expect(look.canBlink).toBe(true);
    expect(look.parts.map((p) => p.sprite)).toEqual(['shadow', 'item-lanyard', 'item-mug']);
    expect(look.parts[1]?.remap).toEqual({ 9: 6 });
    expect(look.wearing).toEqual([
      { id: 'lanyard', name: '공무원증', tint: '초록 줄' },
      { id: 'mug', name: '머그컵', tint: null },
    ]);
  });
  it('연가 중: 업무 소품을 내려놓고 휴가 복장', () => {
    const look = resolveLook(C, formFor(C, '7').id, 20, 'vacation');
    expect(look.parts.map((p) => p.sprite)).toEqual([
      'shadow',
      'item-sunglasses',
      'item-strawhat',
      'item-lei',
    ]);
    expect(look.canBlink).toBe(false);
    expect(look.moodLabel).toBe('연가 중');
  });
  it('지친 모습·월급날·축하', () => {
    expect(resolveLook(C, formFor(C, '9').id, 1, 'tired').parts.map((p) => p.sprite)).toEqual([
      'shadow',
      'item-lanyard',
      'fx-sweat',
    ]);
    expect(resolveLook(C, formFor(C, '9').id, 1, 'tired').eyes).toBe('eyes-tired');
    expect(resolveLook(C, formFor(C, '9').id, 1, 'payday').parts.at(-1)).toEqual({
      sprite: 'fx-coin',
      animated: true,
    });
    const party = resolveLook(C, formFor(C, '6').id, 22, 'celebrate');
    expect(party.parts.map((p) => p.sprite)).toContain('item-partyhat');
    expect(party.parts.map((p) => p.sprite)).not.toContain('item-crest-gold');
  });
  it('떠 있는 봉황은 자기 그림자를 쓴다', () => {
    expect(resolveLook(C, formFor(C, '5').id, 20, 'work').parts[0]?.sprite).toBe('shadow-float');
    expect(resolveLook(C, formFor(C, '6').id, 20, 'work').parts[0]?.sprite).toBe('shadow');
  });
  it('높은 호봉의 반짝이', () => {
    expect(resolveLook(C, formFor(C, '6').id, 28, 'work').parts.map((p) => p.sprite)).toContain(
      'fx-sparkle',
    );
    expect(resolveLook(C, formFor(C, '6').id, 27, 'work').parts.map((p) => p.sprite)).not.toContain(
      'fx-sparkle',
    );
  });

  const base: MoodInput = {
    celebrating: false,
    leaveHoursToday: 0,
    halfDayHours: 4,
    isPayday: false,
    hour: 10,
    phase: 'working',
    daysSinceLeave: 10,
    hasLeaveLeft: true,
  };
  it('기분 우선순위', () => {
    expect(decideMood(C, base)).toBe('work');
    expect(decideMood(C, { ...base, phase: 'lunch', hour: 12 })).toBe('lunch');
    expect(decideMood(C, { ...base, phase: 'after', hour: 19 })).toBe('off');
    expect(decideMood(C, { ...base, phase: 'off' })).toBe('off');
    expect(decideMood(C, { ...base, phase: 'after', hour: 23 })).toBe('sleep');
    expect(decideMood(C, { ...base, phase: 'before', hour: 5 })).toBe('sleep');
    expect(decideMood(C, { ...base, phase: 'before', hour: 6 })).toBe('off');
    expect(decideMood(C, { ...base, isPayday: true })).toBe('payday');
    expect(decideMood(C, { ...base, daysSinceLeave: 90 })).toBe('tired');
    expect(decideMood(C, { ...base, daysSinceLeave: 89 })).toBe('work');
    expect(decideMood(C, { ...base, daysSinceLeave: 200, hasLeaveLeft: false })).toBe('work');
    // 연가 기록이 한 건도 없으면 앱은 모른다: 지쳤다고 단정하지 않는다.
    expect(decideMood(C, { ...base, daysSinceLeave: null })).toBe('work');
    expect(decideMood(C, { ...base, leaveHoursToday: 4, daysSinceLeave: 200 })).toBe('vacation');
    expect(decideMood(C, { ...base, leaveHoursToday: 2 })).toBe('work');
    expect(decideMood(C, { ...base, celebrating: true, leaveHoursToday: 8, isPayday: true })).toBe(
      'celebrate',
    );
  });
});

describe('직종별 진화(#20, data/character.json evolution)', () => {
  const R = rulesFor(2026);
  const formIds = new Set(C.forms.map((f) => f.id));
  const order = C.forms.map((f) => f.id);
  const generalForm = (level: number) => formFor(C, String(level)).id;

  it('일반직 사다리가 아닌 모든 사다리의 모든 계급이 형태 하나에 매핑된다(교원은 재직 연수)', () => {
    for (const [id, ladder] of Object.entries(R.tracks.ladders)) {
      if (id === 'general' || id === 'teacher') {
        expect(C.evolution.byRank[id], id).toBeUndefined();
        continue;
      }
      const map = C.evolution.byRank[id] ?? {};
      expect(Object.keys(map).sort(), id).toEqual(ladder.ranks.map((r) => r.key).sort());
      for (const form of Object.values(map)) expect(formIds.has(form), `${id}: ${form}`).toBe(true);
      // 높은 계급일수록 형태가 같거나 더 자란다
      const steps = ladder.ranks.map((r) => order.indexOf(map[r.key] as string));
      for (let i = 1; i < steps.length; i += 1)
        expect(steps[i], `${id} ${ladder.ranks[i]?.key}`).toBeGreaterThanOrEqual(
          steps[i - 1] as number,
        );
    }
    // 일반직 사다리의 모든 계급은 기존 forms[].grades 로 매핑된다
    for (const r of R.tracks.ladders.general.ranks)
      expect(formIds.has(generalForm(Number(r.key)))).toBe(true);
  });

  it('evolution.note 는 화면용이라 법적 표현이 없고, 매핑 근거는 basis 에 있다', () => {
    expect(C.evolution.note).not.toMatch(/상당|별표|제\d+조|임용령|규정/);
    expect(C.evolution.basis).toContain('제3조제5항');
    expect(C.evolution.basis).toContain('별표 15');
  });

  it('재직 연수 단계는 0년부터 오름차순이고 형태 순서를 따른다', () => {
    const t = C.evolution.byTenure;
    expect(t[0]?.fromYears).toBe(0);
    for (let i = 1; i < t.length; i += 1) {
      expect(t[i]?.fromYears).toBeGreaterThan(t[i - 1]?.fromYears as number);
      expect(order.indexOf(t[i]?.form as string)).toBeGreaterThan(
        order.indexOf(t[i - 1]?.form as string),
      );
    }
    for (const step of t) expect(formIds.has(step.form)).toBe(true);
    expect(t.map((s) => s.fromYears)).toEqual([0, 2, 5, 10, 20]);
  });

  it('우정N급은 공무원임용령 제3조제5항의 상당 계급과 같은 몸통이다(T5 확인)', () => {
    const equiv: Record<string, number> = {
      '1': 5,
      '2': 5,
      '3': 6,
      '4': 6,
      '5': 6,
      '6': 6,
      '7': 7,
      '8': 8,
      '9': 9,
    };
    for (const [g, e] of Object.entries(equiv)) {
      expect(C.evolution.byRank.postal?.[g], `우정${g}급`).toBe(generalForm(e));
    }
  });

  it('경찰·소방은 같은 봉급표 열(별표 10)의 짝과 같은 몸통이다', () => {
    const police = R.tracks.ladders.police.ranks;
    const fire = R.tracks.ladders.fire.ranks;
    police.forEach((p, i) => {
      expect(C.evolution.byRank.fire?.[fire[i]?.key as string]).toBe(
        C.evolution.byRank.police?.[p.key],
      );
    });
    // 직급보조비 표(별표 15)의 같은 행: 순경·경장 = 8·9급, 경사 = 7급, 경위·경감 = 6급, 경정 = 5급
    expect(C.evolution.byRank.police?.['경사']).toBe(generalForm(7));
    expect(C.evolution.byRank.police?.['경위']).toBe(generalForm(6));
    expect(C.evolution.byRank.police?.['경감']).toBe(generalForm(6));
    expect(C.evolution.byRank.police?.['경정']).toBe(generalForm(5));
  });
});

describe('형태 고르기(formIdFor, #20 설계 §5.7)', () => {
  const R = rulesFor(2026);
  const today = '2026-11-25';
  const formOf = (ladderId: LadderId | null, rank: string | null, hireDate = '2020-03-02') =>
    formIdFor(C, { ladderId, rank, hireDate, today });

  it('일반직 사다리는 지금과 같다(forms[].grades)', () => {
    for (let g = 1; g <= 9; g += 1)
      expect(formOf('general', String(g))).toBe(formFor(C, String(g)).id);
  });
  it('그 밖의 사다리는 evolution.byRank, 모든 계급이 매핑된다', () => {
    for (const [id, ladder] of Object.entries(R.tracks.ladders) as [LadderId, Ladder][]) {
      if (id === 'general' || id === 'teacher') continue;
      for (const r of ladder.ranks) expect(formOf(id, r.key)).toBe(C.evolution.byRank[id]?.[r.key]);
    }
    expect(formOf('police', '순경')).toBe('egg');
    expect(formOf('police', '경정')).toBe('phoenix');
    // 우정N급(별표 8)은 일반직 N급과 같은 진화 단계(7~9급)
    expect(formOf('postal', '7')).toBe(formOf('general', '7'));
    expect(formOf('postal', '9')).toBe(formOf('general', '9'));
  });
  it('교원·사다리 없는 직종·계급을 모름: 재직 연수(0·2·5·10·20년)', () => {
    // 1년 364일이면 아직 첫해(알), 2년이 되는 날 솜봉이
    expect(formOf('teacher', '교원', '2024-11-26')).toBe('egg');
    expect(formOf('teacher', '교원', '2024-11-25')).toBe('chick');
    expect(formOf('teacher', '교원', '2021-11-26')).toBe('chick');
    expect(formOf('teacher', '교원', '2021-11-25')).toBe('fledgling');
    expect(formOf('teacher', '교원', '2016-11-25')).toBe('bird');
    expect(formOf('teacher', '교원', '2006-11-25')).toBe('phoenix');
    expect(formOf(null, null, '2016-11-25')).toBe('bird');
    expect(formOf('police', null, '2016-11-25')).toBe('bird');
    expect(formOf('police', '없는계급', '2026-11-25')).toBe('egg');
    // 임용 전(오늘보다 뒤 임용일)도 첫해
    expect(formOf(null, null, '2027-03-02')).toBe('egg');
    expect(tenureStage(C, '2024-11-25', today)?.label).toBe('2년');
  });
  it('모르는 형태 id 는 첫 형태로 그린다(손상·옛 데이터)', () => {
    expect(formById(C, 'unknown-form').id).toBe(C.forms[0]?.id);
    expect(resolveLook(C, 'unknown-form', 3, 'work').form.id).toBe('egg');
  });
});

describe('성장 연출(decideGrowth, #20 설계 §5.8)', () => {
  const R = rulesFor(2026);
  const general = R.tracks.ladders.general.ranks;
  const mark = <F extends string | null>(rank: string | null, step: number, form: F) => ({
    rank,
    step,
    form,
  });

  it('같은 계급에서 호봉만 오름 → 승급 연출', () => {
    expect(decideGrowth(C, mark('9', 5, 'egg'), mark('9', 6, 'egg'), general)).toEqual({
      kind: 'step',
    });
  });
  it('lastForm 이 null(새 사용자·v3 변환)이면 형태 연출 없이 지금 형태로 기록만', () => {
    expect(decideGrowth(C, mark('9', 5, null), mark('9', 5, 'egg'), general)).toEqual({
      kind: 'record',
    });
    // 호봉이 올랐으면 승급 연출은 한다(형태 변화로는 보지 않는다 — state 가 출발 형태를 지금 형태로 그린다)
    expect(decideGrowth(C, mark('9', 5, null), mark('9', 6, 'egg'), general)).toEqual({
      kind: 'step',
    });
    expect(decideGrowth(C, mark('교원', 10, 'nope'), mark('교원', 11, 'bird'), null)).toEqual({
      kind: 'step',
    });
    // 계급 순서가 오른 성장 연출은 하지 않는다(형태 변화를 그리는 연출이라 출발 형태를 모르면 기록만)
    const police = R.tracks.ladders.police.ranks;
    expect(decideGrowth(C, mark('경정', 3, null), mark('총경', 3, 'phoenix'), police)).toEqual({
      kind: 'record',
    });
  });
  it('형태 순서가 내려가면 호봉·계급이 올라도 연출 없이 기록만(작아지는 연출을 그리지 않는다)', () => {
    // 같은 계급에서 호봉이 오르며 형태가 내려감(교원: 데이터 문턱이 바뀐 경우)
    expect(decideGrowth(C, mark('교원', 9, 'chick'), mark('교원', 10, 'egg'), null)).toEqual({
      kind: 'record',
    });
    // 같은 사다리에서 계급이 오르며 형태가 내려감
    const police = R.tracks.ladders.police.ranks;
    expect(decideGrowth(C, mark('경사', 3, 'fledgling'), mark('경위', 3, 'chick'), police)).toEqual(
      { kind: 'record' },
    );
  });
  it('형태 순서가 오르면(교원: 재직 연수) 성장 연출', () => {
    expect(decideGrowth(C, mark('교원', 9, 'egg'), mark('교원', 9, 'chick'), null)).toEqual({
      kind: 'grow',
    });
    // 호봉과 형태가 같이 오르면 성장 연출로 한 번만
    expect(decideGrowth(C, mark('교원', 9, 'egg'), mark('교원', 10, 'chick'), null)).toEqual({
      kind: 'grow',
    });
  });
  it('같은 사다리에서 계급 순서가 오르면 성장 연출, 내려가면 기록만', () => {
    const police = R.tracks.ladders.police.ranks;
    expect(decideGrowth(C, mark('경정', 3, 'phoenix'), mark('총경', 3, 'phoenix'), police)).toEqual(
      { kind: 'grow' },
    );
    expect(decideGrowth(C, mark('총경', 3, 'phoenix'), mark('경정', 3, 'phoenix'), police)).toEqual(
      { kind: 'record' },
    );
  });
  it('문턱을 올린 가짜 규칙에서 형태가 내려가면 연출 없이 lastForm 만 갱신', () => {
    const raised: typeof C = {
      ...C,
      evolution: {
        ...C.evolution,
        byTenure: C.evolution.byTenure.map((s) => ({ ...s, fromYears: s.fromYears * 2 })),
      },
    };
    // 재직 3년: 지금 규칙으로는 chick(2년~), 문턱을 두 배로 올린 규칙으로는 egg(4년 전)
    const hireDate = '2023-11-25';
    const before = formIdFor(C, {
      ladderId: 'teacher',
      rank: '교원',
      hireDate,
      today: '2026-11-25',
    });
    const after = formIdFor(raised, {
      ladderId: 'teacher',
      rank: '교원',
      hireDate,
      today: '2026-11-25',
    });
    expect([before, after]).toEqual(['chick', 'egg']);
    expect(decideGrowth(raised, mark('교원', 9, before), mark('교원', 9, after), null)).toEqual({
      kind: 'record',
    });
  });
  it('lastForm 이 모르는 id 면 연출 없음, 바뀐 것이 없으면 아무것도 하지 않음', () => {
    expect(decideGrowth(C, mark('9', 5, 'unknown-form'), mark('9', 5, 'egg'), general)).toEqual({
      kind: 'record',
    });
    expect(decideGrowth(C, mark('9', 5, 'egg'), mark('9', 5, 'egg'), general)).toEqual({
      kind: 'none',
    });
    // 직접 고쳐 호봉이 내려간 경우
    expect(decideGrowth(C, mark('9', 7, 'egg'), mark('9', 5, 'egg'), general)).toEqual({
      kind: 'record',
    });
  });
});
