/** 꾸미기 화면이 쓰는 순수 함수(src/lib/character/customize.ts) */
import { describe, expect, it } from 'vitest';
import {
  cryptoInt,
  lookChangeText,
  lookName,
  paintShownFrom,
  plumeClashes,
  randomLook,
  sameLook,
} from '../../src/lib/character/customize.ts';
import { resolveCustom, resolveLook } from '../../src/lib/character/look.ts';
import { characterRules as C } from '../../src/lib/character/rules.ts';
import { DEFAULT_LOOK, defaultLook } from '../../src/lib/store/defaults.ts';
import type { CharacterLook } from '../../src/lib/store/schema.ts';

const look = (patch: Partial<CharacterLook> = {}): CharacterLook => ({
  ...defaultLook(),
  ...patch,
});

describe('어느 형태부터 색이 보이나', () => {
  it('볏은 깃봉이부터, 깃 색은 날봉이부터(그림에서 센다)', () => {
    const shown = paintShownFrom(C);
    expect(shown.crest?.id).toBe('fledgling');
    expect(shown.plume?.id).toBe('bird');
  });
});

describe('미리보기 낭독 이름', () => {
  it('보이지 않는 볏·깃 색은 말하지 않는다', () => {
    const name = (form: string, l = look()) => lookName(C, resolveLook(C, form, 0, 'work', l));
    expect(name('egg')).toBe('햇살 몸 알봉이');
    expect(name('chick', look({ body: 'sky', crest: 'blue' }))).toBe('하늘 몸 솜봉이');
    expect(name('fledgling', look({ body: 'sky', crest: 'blue' }))).toBe(
      '하늘 몸, 파랑 볏을 한 깃봉이',
    );
    expect(name('bird')).toBe('햇살 몸, 빨강 볏, 오색 깃을 한 날봉이');
    expect(name('phoenix', look({ plume: 'forest' }))).toBe('햇살 몸, 빨강 볏, 숲 깃을 한 봉황');
  });

  it('장식과 손 소품(소품 이름만, 직렬 이름은 말하지 않는다)', () => {
    const l = look({
      body: 'sky',
      crest: 'blue',
      deco: { pin: 'flower', chest: null, cheek: false },
    });
    expect(lookName(C, resolveLook(C, 'fledgling', 0, 'work', l))).toBe(
      '하늘 몸, 파랑 볏, 꽃핀을 단 깃봉이',
    );
    const withProp = resolveLook(C, 'fledgling', 3, 'work', look(), {
      track: 'general',
      theme: 'stethoscope',
    });
    expect(lookName(C, withProp)).toBe('햇살 몸, 빨강 볏, 청진기를 든 깃봉이');
    // 호봉 소품(9호봉부터 결재판)을 들고 있으면 그것도 말한다
    expect(lookName(C, resolveLook(C, 'bird', 9, 'work', look()))).toBe(
      '햇살 몸, 빨강 볏, 오색 깃, 결재판을 든 날봉이',
    );
    // 점심(왼손을 내려놓음)에는 말하지 않는다
    expect(lookName(C, resolveLook(C, 'bird', 9, 'lunch', look()))).toBe(
      '햇살 몸, 빨강 볏, 오색 깃을 한 날봉이',
    );
    const all = look({ deco: { pin: 'star', chest: 'tiger', cheek: true }, prop: 'book' });
    expect(lookName(C, resolveLook(C, 'chick', 0, 'work', all))).toBe(
      '햇살 몸, 별핀·호랑이 배지·볼 터치를 단, 책을 든 솜봉이',
    );
  });

  it('모르는 id 는 실제로 그린 기본값으로 말한다', () => {
    const l = look({ body: 'galaxy', deco: { pin: 'crown-2', chest: null, cheek: true } });
    expect(lookName(C, resolveLook(C, 'fledgling', 0, 'work', l))).toBe(
      '햇살 몸, 빨강 볏, 볼 터치를 단 깃봉이',
    );
  });
});

describe("'아무거나'", () => {
  it('바뀐 내용을 해요체 한 문장으로 알린다(조사 포함)', () => {
    const text = (l: CharacterLook) => lookChangeText(resolveCustom(C, l).custom);
    expect(text(look({ body: 'sunset', crest: 'purple', plume: 'forest' }))).toBe(
      '노을 몸, 보라 볏, 숲 깃으로 바꿨어요.',
    );
    expect(
      text(look({ body: 'sea', plume: 'auto', deco: { pin: 'ribbon', chest: null, cheek: true } })),
    ).toBe('바다 몸, 빨강 볏, 알아서 고른 노을 깃, 리본핀, 볼 터치로 바꿨어요.');
  });

  it('손 소품은 그대로 두고, 목록 안의 값만 고르고, 지금과 같은 조합은 다시 뽑는다', () => {
    const ids = {
      body: C.custom.bodies.map((b) => b.id),
      crest: C.custom.crests.map((b) => b.id),
      plume: C.custom.plumes.map((b) => b.id),
      pin: [null, ...C.custom.decos.filter((d) => d.slot === 'pin').map((d) => d.id)],
      chest: [null, ...C.custom.decos.filter((d) => d.slot === 'chest').map((d) => d.id)],
    };
    for (let i = 0; i < 200; i += 1) {
      const current = look({ prop: i % 2 ? 'compass' : 'auto' });
      const next = randomLook(C, current);
      expect(next.prop).toBe(current.prop);
      expect(sameLook(next, current)).toBe(false);
      expect(ids.body).toContain(next.body);
      expect(ids.crest).toContain(next.crest);
      expect(ids.plume).toContain(next.plume);
      expect(ids.pin).toContain(next.deco.pin);
      expect(ids.chest).toContain(next.deco.chest);
    }
    // 첫 뽑기가 지금과 같으면(모두 0번) 다시 뽑는다
    let calls = 0;
    const zeroThenOne = (n: number) => (calls++ < 6 ? 0 : Math.min(1, n - 1));
    const same = randomLook(
      C,
      { ...defaultLook(), body: ids.body[0] as string, crest: ids.crest[0] as string },
      zeroThenOne,
    );
    expect(calls).toBeGreaterThan(6);
    expect(same.body).toBe(ids.body[1]);
  });

  it('깃은 몸 색과 겹치는 짝(날개가 몸에 묻힘)을 뽑지 않는다', () => {
    // 검수에서 본 충돌 짝
    for (const [body, plume] of [
      ['sea', 'blue'],
      ['sunset', 'sunset'],
      ['sprout', 'forest'],
      ['cloud', 'moon'],
      ['sky', 'five'],
      ['sky', 'blue'],
    ] as const) {
      expect(plumeClashes(C, body, plume), `${body}+${plume}`).toBe(true);
    }
    for (const b of C.custom.bodies) {
      expect(plumeClashes(C, b.id, 'auto')).toBe(false);
      expect(plumeClashes(C, b.id, b.autoPlume), `${b.id} 알아서`).toBe(false);
    }
    for (let i = 0; i < 300; i += 1) {
      const next = randomLook(C, look());
      expect(plumeClashes(C, next.body, next.plume), `${next.body}+${next.plume}`).toBe(false);
    }
  });

  it('crypto 로 고른 정수는 범위 안이다', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) {
      const v = cryptoInt(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
    expect(cryptoInt(0)).toBe(0);
  });

  it('기본 모습 비교', () => {
    expect(sameLook(defaultLook(), DEFAULT_LOOK)).toBe(true);
    expect(sameLook(defaultLook(), look({ deco: { pin: null, chest: null, cheek: true } }))).toBe(
      false,
    );
  });
});
