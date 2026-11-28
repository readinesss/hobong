/**
 * 그림 자산 검증.
 * - 캐릭터 규칙(data/character.json)과 화면 코드가 찾는 스프라이트·아이콘이 모두 그려져 있는지
 * - 합성기가 기대하는 앵커·프레임·색 규칙을 지키는지
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { characterRules as C } from '../../src/lib/character/rules.ts';
import { seriesData } from '../../src/lib/character/series.ts';
import { DEFAULT_LOOK } from '../../src/lib/store/defaults.ts';
import { LOOK_ID_RE, SERIES_KEY_RE } from '../../src/lib/store/schema.ts';
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
  const ANCHORS = ['eyes', 'head', 'neck', 'handL', 'handR', 'crown', 'ground', 'chest'];

  it('형태마다 48×48 몸통과 앵커 여덟 개가 있다', () => {
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
    for (const deco of C.custom.decos) names.add(deco.sprite);
    for (const prop of C.custom.props) names.add(prop.sprite);
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

describe('꾸미기 장식·손 소품(#17·#16)', () => {
  const bodies = C.forms.map((f) => need(f.body));
  /** 몸통 위에 놓았을 때 스프라이트 칸이 덮는 몸통 칸들 */
  function over(sprite: Sprite, body: Sprite) {
    const [ax, ay] = body.anchors[sprite.attach ?? ''] as readonly [number, number];
    const x0 = ax - sprite.origin[0];
    const y0 = ay - sprite.origin[1];
    const cells: { v: number; under: number; x: number; y: number }[] = [];
    sprite.frames[0]?.forEach((v, i) => {
      if (v === TRANSPARENT) return;
      const x = x0 + (i % sprite.w);
      const y = y0 + Math.floor(i / sprite.w);
      const inside = x >= 0 && y >= 0 && x < body.w && y < body.h;
      cells.push({ v, x, y, under: inside ? (body.frames[0]?.[y * body.w + x] ?? -1) : -1 });
    });
    return cells;
  }

  it('장식은 정한 자리(핀 head·배지 chest·볼 eyes)에 붙고, 폭이 짝수이며 한 프레임이다', () => {
    const anchorOf = { pin: 'head', chest: 'chest', cheek: 'eyes' } as const;
    for (const deco of C.custom.decos) {
      const s = need(deco.sprite);
      expect(s.attach, deco.sprite).toBe(anchorOf[deco.slot]);
      expect(s.w % 2, deco.sprite).toBe(0);
      expect(s.frames.length, deco.sprite).toBe(1);
      expect(s.skin, deco.sprite).toBe(false);
    }
  });

  it('머리핀은 다섯 몸통 모두 머리 외곽선에 걸치고, 색 칸은 머리 위에 놓인다(리본 날개 끝 1칸만 밖)', () => {
    for (const deco of C.custom.decos.filter((d) => d.slot === 'pin')) {
      const s = need(deco.sprite);
      for (const body of bodies) {
        const cells = over(s, body);
        const where = `${deco.sprite} × ${body.name}`;
        expect(
          cells.some((c) => c.under === 0),
          `${where}: 외곽선에 걸친다`,
        ).toBe(true);
        const floating = cells.filter((c) => c.v !== 0 && c.under === TRANSPARENT);
        expect(floating.length, `${where}: 허공에 뜬 색 칸`).toBeLessThanOrEqual(1);
        // 색 칸 아래는 머리(몸 색 3·4 또는 외곽선)다
        for (const c of cells.filter((c) => c.v !== 0 && c.under !== TRANSPARENT)) {
          expect([0, 3, 4], `${where} ${c.x},${c.y}`).toContain(c.under);
        }
      }
    }
  });

  it('가슴 배지·볼 터치의 색 칸은 다섯 몸통 모두 몸통 위에 놓인다(허공에 뜨지 않는다)', () => {
    for (const deco of C.custom.decos.filter((d) => d.slot !== 'pin')) {
      const s = need(deco.sprite);
      for (const body of bodies) {
        const floating = over(s, body).filter((c) => c.v !== 0 && c.under === TRANSPARENT);
        expect(floating, `${deco.sprite} × ${body.name}`).toEqual([]);
      }
    }
  });

  it('가슴 배지는 볼(눈 아래 3줄)보다 아래, 목걸이 끈·명찰·넥타이와 겹치지 않는 가슴 오른쪽에 붙는다', () => {
    const lanyard = need('item-lanyard');
    const tie = need('item-tie');
    for (const deco of C.custom.decos.filter((d) => d.slot === 'chest')) {
      const s = need(deco.sprite);
      for (const body of bodies) {
        const where = `${deco.sprite} × ${body.name}`;
        const badge = over(s, body);
        const [ex, ey] = body.anchors.eyes as readonly [number, number];
        // 볼 줄(eyes+3)과 그 위에는 색 칸이 없다(볼에 붙인 스티커처럼 읽히지 않게)
        expect(
          badge.filter((c) => c.v !== 0 && c.y <= ey + 3),
          where,
        ).toEqual([]);
        // 몸 가운데(eyes.x)보다 오른쪽
        expect(Math.min(...badge.map((c) => c.x)), where).toBeGreaterThan(ex);
        const taken = new Set(
          [...over(lanyard, body), ...over(tie, body)].map((c) => `${c.x},${c.y}`),
        );
        expect(
          badge.filter((c) => taken.has(`${c.x},${c.y}`)),
          `${where}: 목걸이·넥타이와 겹침`,
        ).toEqual([]);
      }
    }
  });

  it('손 소품은 왼손(handL)·층 25 에 붙고 @skin 이며, 쥔 날개 끝은 기준점 오른쪽 2×2(4·4·4·3)다', () => {
    const handL = [...sprites.values()].filter((s) => s.attach === 'handL');
    expect(handL.map((s) => s.name).sort()).toEqual(C.custom.props.map((p) => p.sprite).sort());
    for (const s of handL) {
      expect(s.skin, s.name).toBe(true);
      expect(s.layer, s.name).toBe(25);
      const [ox, oy] = s.origin;
      const band: number[] = [];
      s.frames[0]?.forEach((v, i) => {
        const x = i % s.w;
        const y = Math.floor(i / s.w);
        if ((v === 3 || v === 4) && x >= ox + 1 && Math.abs(y - oy) <= 2) band.push(v);
      });
      expect(band, s.name).toEqual([4, 4, 4, 3]);
      // 9급 알봉이 handL(x9)에서도 캔버스 밖으로 잘리지 않는다
      for (const body of bodies) {
        for (const c of over(s, body)) {
          expect(c.x >= 0 && c.x < 48 && c.y >= 0 && c.y < 48, `${s.name} × ${body.name}`).toBe(
            true,
          );
        }
      }
    }
    // @skin 은 손 소품에만 쓴다
    for (const s of sprites.values()) if (s.skin) expect(s.attach, s.name).toBe('handL');
  });

  it('소품 그림 이름은 종류를 따른다(직렬 series-·직종 track-, 행정 테마는 기존 item-folder)', () => {
    for (const prop of C.custom.props) {
      const prefix = prop.kind === 'track' ? 'track-' : prop.id === 'folder' ? 'item-' : 'series-';
      expect(prop.sprite, prop.id).toBe(`${prefix}${prop.id}`);
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

describe('저장본에 담기는 id·이름 형식(같은 v5 의 예전 사본이 백업을 거부하지 않게, docs/DATA.md)', () => {
  it('꾸미기·소품의 모든 id 는 LOOK_ID_RE 를 지킨다', () => {
    const ids = [
      ...C.custom.bodies,
      ...C.custom.crests,
      ...C.custom.plumes,
      ...C.custom.decos,
      ...C.custom.props,
    ].map((x) => x.id);
    expect(ids.length).toBeGreaterThan(30);
    for (const id of ids) expect(LOOK_ID_RE.test(id), id).toBe(true);
    expect(LOOK_ID_RE.test(DEFAULT_LOOK.prop)).toBe(true);
    expect(LOOK_ID_RE.test('none')).toBe(true);
  });

  it('직렬 이름·옛 이름·직류 이름은 SERIES_KEY_RE 를 지킨다(가운뎃점·띄어쓰기는 미리 받는다)', () => {
    // 모든 표(국가·지방)와 모든 직류(저장본 profile.seriesJikryu 도 같은 형식이다)
    const names = seriesData.groups.flatMap((g) =>
      g.series.flatMap((s) => [s.name, ...(s.aliases ?? []), ...s.jikryu]),
    );
    expect(names.length).toBeGreaterThanOrEqual(52 + 46 + 231);
    // 목록 항목 값의 구분 글자('직렬|직류', SeriesPicker)는 저장 키 형식에 들 수 없다
    expect(SERIES_KEY_RE.test('행정|교육행정')).toBe(false);
    for (const name of names) expect(SERIES_KEY_RE.test(name), name).toBe(true);
    for (const ok of ['검찰·마약', '출입국 관리', '행정', 'IT'])
      expect(SERIES_KEY_RE.test(ok), ok).toBe(true);
    for (const bad of ['', ' 행정', '행정 ', '출입국  관리', '가'.repeat(21), '행정\n', '<b>'])
      expect(SERIES_KEY_RE.test(bad), JSON.stringify(bad)).toBe(false);
  });
});
