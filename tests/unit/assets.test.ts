/**
 * 그림 자산 검증.
 * - 캐릭터 규칙(data/character.json)과 화면 코드가 찾는 스프라이트·아이콘이 모두 그려져 있는지
 * - 합성기가 기대하는 앵커·프레임·색 규칙을 지키는지
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { characterRules as C } from '../../src/lib/character/rules.ts';
import {
  buildSpriteIndex,
  parseSprites,
  TRANSPARENT,
  type Sprite,
} from '../../src/lib/character/sprite-format.ts';

const ROOT = process.cwd();
const SPRITE_DIR = join(ROOT, 'src/assets/sprites');
const sprites = buildSpriteIndex(
  readdirSync(SPRITE_DIR)
    .filter((name) => name.endsWith('.txt'))
    .sort()
    .map((name) => parseSprites(readFileSync(join(SPRITE_DIR, name), 'utf8'), name)),
);

function need(name: string): Sprite {
  const sprite = sprites.get(name);
  expect(sprite, `스프라이트 '${name}' 가 그려져 있어야 한다`).toBeDefined();
  return sprite as Sprite;
}

function colorsOf(sprite: Sprite): Set<number> {
  const out = new Set<number>();
  for (const frame of sprite.frames) for (const c of frame) if (c !== TRANSPARENT) out.add(c);
  return out;
}

/** 소스 파일을 훑어 글자 그대로 쓰인 이름을 모은다 */
function literalsIn(dir: string, pattern: RegExp, out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) literalsIn(full, pattern, out);
    else if (/\.(ts|svelte|json)$/.test(entry.name)) {
      for (const m of readFileSync(full, 'utf8').matchAll(pattern)) out.add(m[0]);
    }
  }
  return out;
}

describe('캐릭터 스프라이트', () => {
  const ANCHORS = ['eyes', 'head', 'neck', 'handL', 'handR', 'crown', 'ground'];

  it('형태마다 48×48 몸통과 앵커 일곱 개가 있다', () => {
    for (const form of C.forms) {
      const body = need(form.body);
      expect([body.w, body.h], form.body).toEqual([C.canvas.w, C.canvas.h]);
      for (const anchor of ANCHORS) {
        const point = body.anchors[anchor];
        expect(point, `${form.body} 의 ${anchor} 앵커`).toBeDefined();
        const [x, y] = point as readonly [number, number];
        expect(x >= 0 && x < body.w && y >= 0 && y < body.h, `${form.body}.${anchor}`).toBe(true);
      }
    }
  });

  it('규칙 파일이 가리키는 소품·효과·눈·그림자·알이 모두 있다', () => {
    const names = new Set<string>([C.shadow, C.eyes.default, C.eyes.blink, C.egg]);
    for (const form of C.forms) if (form.shadow) names.add(form.shadow);
    for (const item of C.items) names.add(item.sprite);
    for (const effect of C.effects) names.add(effect.sprite);
    for (const mood of Object.values(C.moods)) {
      names.add(mood.eyes);
      mood.items.forEach((n) => names.add(n));
      mood.fx.forEach((n) => names.add(n));
    }
    for (const name of names) need(name);
  });

  it('눈은 눈 자리에, 소품은 붙을 자리에 붙는다', () => {
    for (const name of [...sprites.keys()].filter((n) => n.startsWith('eyes-'))) {
      expect(need(name).attach, name).toBe('eyes');
    }
    const bodyAnchors = new Set(ANCHORS);
    for (const [name, sprite] of sprites) {
      if (!name.startsWith('item-') && !name.startsWith('fx-') && name !== 'shadow') continue;
      if (sprite.attach !== null) expect(bodyAnchors.has(sprite.attach), name).toBe(true);
    }
    expect(need(C.shadow).attach).toBe('ground');
    for (const form of C.forms) if (form.shadow) expect(need(form.shadow).attach).toBe('ground');
  });

  it('몸통 그림은 x1~46 안에 있다(카드 무대 테두리에 붙지 않게)', () => {
    for (const form of C.forms) {
      const body = need(form.body);
      for (const frame of body.frames) {
        for (let y = 0; y < body.h; y += 1) {
          expect(frame[y * body.w], `${form.body} (0,${y})`).toBe(TRANSPARENT);
          expect(frame[y * body.w + body.w - 1], `${form.body} (${body.w - 1},${y})`).toBe(
            TRANSPARENT,
          );
        }
      }
    }
  });

  it('효과는 두 프레임, 알은 네 프레임이다', () => {
    for (const name of ['fx-sparkle', 'fx-confetti', 'fx-sweat', 'fx-zzz', 'fx-coin']) {
      expect(need(name).frames.length, name).toBe(2);
    }
    expect(need(C.egg).frames.length).toBe(4);
  });

  it('색을 바꿔 쓰는 소품은 약속한 색만 쓴다', () => {
    // 목걸이 줄(9)과 넥타이(2·1)는 호봉 구간마다 다른 색으로 치환한다.
    expect(colorsOf(need('item-lanyard')).has(9)).toBe(true);
    const tie = colorsOf(need('item-tie'));
    expect([...tie].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    for (const item of C.items) {
      const used = colorsOf(need(item.sprite));
      for (const tint of item.tints ?? []) {
        for (const from of Object.keys(tint.remap)) {
          expect(used.has(Number(from)), `${item.sprite} 에 색 ${from} 이 있어야 치환된다`).toBe(
            true,
          );
        }
      }
    }
  });
});

describe('아이콘', () => {
  const icons = [...sprites.entries()].filter(([name]) => name.startsWith('icon-'));

  it('모두 16×16 한 프레임이다', () => {
    expect(icons.length).toBeGreaterThan(40);
    for (const [name, sprite] of icons) {
      expect([sprite.w, sprite.h, sprite.frames.length], name).toEqual([16, 16, 1]);
    }
  });

  it('화면과 데이터가 쓰는 아이콘이 모두 그려져 있다', () => {
    const used = literalsIn(join(ROOT, 'src'), /\bicon-[a-z][a-z0-9-]*\b/g);
    literalsIn(join(ROOT, 'data'), /\bicon-[a-z][a-z0-9-]*\b/g, used);
    used.delete('icon-missing'); // 아이콘을 못 찾았을 때 쓰는 빈 칸의 CSS 클래스 이름
    expect(used.size).toBeGreaterThan(30);
    for (const name of used) need(name);
  });
});
