import { describe, expect, it } from 'vitest';
import { characterRules as C } from '../../src/lib/character/rules.ts';
import {
  decideMood,
  formFor,
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
import type { Grade } from '../../src/lib/store/schema.ts';

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
    expect(formFor(C, 9).id).toBe('egg');
    expect(formFor(C, 8).id).toBe('chick');
    expect(formFor(C, 7).id).toBe('fledgling');
    expect(formFor(C, 6).id).toBe('bird');
    expect(formFor(C, 5).id).toBe('phoenix');
    expect(formFor(C, 1).id).toBe('phoenix');
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
  });
});

describe('모습 정하기', () => {
  it('근무 중: 그림자 + 호봉 소품', () => {
    const look = resolveLook(C, 8 as Grade, 5, 'work');
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
    const look = resolveLook(C, 7 as Grade, 20, 'vacation');
    expect(look.parts.map((p) => p.sprite)).toEqual([
      'shadow',
      'item-sunglasses',
      'item-strawhat',
      'item-lei',
    ]);
    expect(look.canBlink).toBe(false);
    expect(look.moodLabel).toBe('연가 중');
  });
  it('지친 모습·봉급날·축하', () => {
    expect(resolveLook(C, 9 as Grade, 1, 'tired').parts.map((p) => p.sprite)).toEqual([
      'shadow',
      'item-lanyard',
      'fx-sweat',
    ]);
    expect(resolveLook(C, 9 as Grade, 1, 'tired').eyes).toBe('eyes-tired');
    expect(resolveLook(C, 9 as Grade, 1, 'payday').parts.at(-1)).toEqual({
      sprite: 'fx-coin',
      animated: true,
    });
    const party = resolveLook(C, 6 as Grade, 22, 'celebrate');
    expect(party.parts.map((p) => p.sprite)).toContain('item-partyhat');
    expect(party.parts.map((p) => p.sprite)).not.toContain('item-crest-gold');
  });
  it('높은 호봉의 반짝이', () => {
    expect(resolveLook(C, 6 as Grade, 28, 'work').parts.map((p) => p.sprite)).toContain(
      'fx-sparkle',
    );
    expect(resolveLook(C, 6 as Grade, 27, 'work').parts.map((p) => p.sprite)).not.toContain(
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
    expect(decideMood(C, { ...base, leaveHoursToday: 4, daysSinceLeave: 200 })).toBe('vacation');
    expect(decideMood(C, { ...base, leaveHoursToday: 2 })).toBe('work');
    expect(decideMood(C, { ...base, celebrating: true, leaveHoursToday: 8, isPayday: true })).toBe(
      'celebrate',
    );
  });
});
