/**
 * 호봉이 꾸미기(#17)·직렬 소품(#16)의 그림 규칙.
 * - 영역 판정(몸·볏·깃·발·몸 아래·얼굴 가면)이 새 몸통에서 바르게 나뉘는지(형태별 칸 수 고정)
 * - 기본 모습(DEFAULT_LOOK)이 꾸미기를 들이기 전(커밋 6a9abf1)과 픽셀 단위로 같은지
 * - 색 짝(목 소품 ≠ 몸 바탕, '알아서' 깃 ≠ 몸 색), 모르는 id → 기본값, 슬롯 숨김, 손 소품 고르기
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compose, type Layer } from '../../src/lib/character/compose.ts';
import { poseOf } from '../../src/lib/character/draw.ts';
import {
  holdsOwnProp,
  resolveCustom,
  resolveLook,
  resolveProp,
  tintAt,
  trackPropOf,
  type MoodId,
} from '../../src/lib/character/look.ts';
import {
  chainRemap,
  faceRole,
  isPlainPaint,
  recolorBody,
  REGION,
  regionCounts,
  regionsOf,
  skinSprite,
  type BodyPaint,
} from '../../src/lib/character/regions.ts';
import { characterRules as C } from '../../src/lib/character/rules.ts';
import {
  findSeries,
  propOwnerOf,
  seriesData,
  seriesLabel,
  themeOfSeries,
} from '../../src/lib/character/series.ts';
import { TRANSPARENT, type Sprite } from '../../src/lib/character/sprite-format.ts';
import { getSprite } from '../../src/lib/character/sprites.ts';
import { TRACK_IDS } from '../../src/lib/rules/types.ts';
import { DEFAULT_LOOK, defaultLook } from '../../src/lib/store/defaults.ts';
import type { CharacterLook } from '../../src/lib/store/schema.ts';

const MOODS = Object.keys(C.moods) as MoodId[];
const sprite = (name: string): Sprite => {
  const s = getSprite(name);
  if (!s) throw new Error(`스프라이트 없음: ${name}`);
  return s;
};
const bodyOf = (formId: string) => sprite(C.forms.find((f) => f.id === formId)?.body ?? '');
type LookOver = Partial<Omit<CharacterLook, 'deco'>> & { deco?: Partial<CharacterLook['deco']> };
const look = (over: LookOver = {}): CharacterLook => ({
  ...defaultLook(),
  ...over,
  deco: { ...DEFAULT_LOOK.deco, ...over.deco },
});
const partNames = (l: ReturnType<typeof resolveLook>) => l.parts.map((p) => p.sprite);

describe('영역 판정(새 몸통)', () => {
  it('형태별 영역 칸 수가 고정돼 있다(몸통을 다시 그리면 미리보기로 다시 확인할 것)', () => {
    const counts = Object.fromEntries(C.forms.map((f) => [f.id, regionCounts(sprite(f.body))]));
    const pick = (c: Record<string, number>) => ({
      BODY: c.BODY,
      SKIN: c.SKIN,
      CREST: c.CREST,
      PLUME: c.PLUME,
      FEET: c.FEET,
      BELOW: c.BELOW,
      BEAK: c.BEAK,
      CHEEK: c.CHEEK,
    });
    expect(Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, pick(v)]))).toEqual({
      egg: { BODY: 252, SKIN: 0, CREST: 0, PLUME: 16, FEET: 0, BELOW: 126, BEAK: 6, CHEEK: 4 },
      chick: { BODY: 416, SKIN: 13, CREST: 0, PLUME: 0, FEET: 12, BELOW: 0, BEAK: 6, CHEEK: 4 },
      fledgling: {
        BODY: 487,
        SKIN: 0,
        CREST: 14,
        PLUME: 96,
        FEET: 12,
        BELOW: 0,
        BEAK: 6,
        CHEEK: 4,
      },
      bird: { BODY: 522, SKIN: 0, CREST: 22, PLUME: 172, FEET: 14, BELOW: 0, BEAK: 6, CHEEK: 4 },
      phoenix: {
        BODY: 514,
        SKIN: 0,
        CREST: 22,
        PLUME: 204,
        FEET: 8,
        BELOW: 110,
        BEAK: 6,
        CHEEK: 4,
      },
    });
  });

  it('발: 몸 아래 줄보다 아래의 3·4 는 모두 발이다(새 몸통의 긴 다리 윗부분이 깃으로 잡히지 않는다)', () => {
    for (const form of C.forms) {
      const body = sprite(form.body);
      const reg = regionsOf(body);
      const px = body.frames[0] as Uint8Array;
      let bottom = -1;
      reg.forEach((r, i) => {
        if (r === REGION.BODY || r === REGION.BEAK || r === REGION.CHEEK)
          bottom = Math.max(bottom, Math.floor(i / body.w));
      });
      for (let i = 0; i < px.length; i += 1) {
        const v = px[i] as number;
        const y = Math.floor(i / body.w);
        if (y > bottom && (v === 3 || v === 4)) expect(reg[i], `${form.id} ${i}`).toBe(REGION.FEET);
        if (reg[i] === REGION.FEET) expect(y > bottom && (v === 3 || v === 4)).toBe(true);
        // 깃·볏·몸 아래에는 몸 색(3·4)이 없다(새 몸통 규칙)
        if (reg[i] === REGION.PLUME || reg[i] === REGION.CREST || reg[i] === REGION.BELOW)
          expect(v === 3 || v === 4, `${form.id} ${i % body.w},${y}`).toBe(false);
      }
    }
    // 날봉이 다리 네 줄(y39~42)의 주황 칸이 모두 발이다(예전 규칙 'ground−2 줄부터'는 y43 부터만 발이었다)
    const bird = bodyOf('bird');
    const reg = regionsOf(bird);
    for (let y = 39; y <= 42; y += 1) {
      for (const x of [21, 27]) expect(reg[y * bird.w + x], `bird ${x},${y}`).toBe(REGION.FEET);
    }
  });

  it('얼굴 가면: 다섯 몸통 모두 부리 6칸·볼 4칸이 eyes 앵커 기준 같은 자리의 3 이다', () => {
    for (const form of C.forms) {
      const body = sprite(form.body);
      const reg = regionsOf(body);
      const [ex, ey] = body.anchors.eyes as readonly [number, number];
      reg.forEach((r, i) => {
        if (r !== REGION.BEAK && r !== REGION.CHEEK) return;
        expect(body.frames[0]?.[i]).toBe(3);
        expect(faceRole((i % body.w) - ex, Math.floor(i / body.w) - ey)).toBe(
          r === REGION.BEAK ? 'beak' : 'cheek',
        );
      });
    }
  });

  it('외곽선이 닫혀 있다: 몸 영역은 투명 칸과 맞닿지 않는다', () => {
    for (const form of C.forms) {
      const body = sprite(form.body);
      const reg = regionsOf(body);
      const px = body.frames[0] as Uint8Array;
      reg.forEach((r, i) => {
        if (r !== REGION.BODY) return;
        const x = i % body.w;
        for (const j of [i - 1, i + 1, i - body.w, i + body.w]) {
          if (j < 0 || j >= px.length || Math.abs((j % body.w) - x) > 1) continue;
          expect(px[j], `${form.id} 몸 칸 ${i} 옆`).not.toBe(TRANSPARENT);
        }
      });
    }
  });
});

describe('기본 모습은 꾸미기를 들이기 전과 픽셀 단위로 같다', () => {
  /** 꾸미기 전(커밋 6a9abf1)의 poseOf: 원본 몸통 + 눈 + 부품을 그대로 합성 */
  function legacyPose(l: ReturnType<typeof resolveLook>, tick: number) {
    const body = sprite(l.form.body);
    const bob = tick % 4 >= 2 ? 1 : 0;
    const blink = l.canBlink && tick % 20 === 19;
    const layers: Layer[] = [{ sprite: body }];
    layers.push({ sprite: sprite(blink ? C.eyes.blink : l.eyes) });
    for (const part of l.parts) {
      layers.push({
        sprite: sprite(part.sprite),
        remap: part.remap,
        frame: part.animated ? Math.floor(tick / 2) : 0,
      });
    }
    return compose(layers, { w: 48, h: 48, body, bodyDy: bob });
  }

  it('모든 형태 × 호봉 0~32 × 기분 × 박자: 커밋 6a9abf1 의 합성 결과와 같다(지문)', () => {
    const h = createHash('sha256');
    for (const form of C.forms) {
      for (let step = 0; step <= 32; step += 1) {
        for (const mood of MOODS) {
          for (const tick of [0, 2, 19]) {
            const l = resolveLook(C, form.id, step, mood, DEFAULT_LOOK);
            const pose = poseOf(l, { tick });
            if (!pose) throw new Error('몸통 없음');
            h.update(`${form.id}|${step}|${mood}|${tick}:`);
            h.update(pose.pixels);
            expect(pose.pixels).toEqual(legacyPose(l, tick).pixels);
          }
        }
      }
    }
    // 꾸미기를 들이기 전 앱(poseOf(resolveLook(rules, form, step, mood)))으로 만든 지문
    expect(h.digest('hex')).toBe(
      'dd5537ba538c141f04ac8c9fd461513ad3f5eec501ab750228a95c1e6328aeef',
    );
  });

  it('일반직·직렬 없음이면 소품 auto 도 예전과 같다(9호봉부터 결재판), 인자를 생략한 것과 같다', () => {
    for (const step of [1, 8, 9, 20]) {
      const a = resolveLook(C, 'bird', step, 'work');
      const b = resolveLook(C, 'bird', step, 'work', defaultLook(), {
        track: 'general',
        theme: null,
      });
      expect(b.parts).toEqual(a.parts);
      expect(partNames(a).includes('item-folder')).toBe(step >= 9);
      expect(isPlainPaint(a.paint)).toBe(true);
    }
  });

  it('어느 직종이든(직렬이 남아 있어도) 기본 꾸미기의 합성 결과는 일반직 기본 모습과 같다(v4 → v5 그대로)', () => {
    for (const track of TRACK_IDS) {
      for (const series of [null, '간호']) {
        const owner = propOwnerOf({ track, series: track === 'general' ? null : series });
        for (const form of C.forms) {
          for (const step of [0, 3, 8, 9, 20, 32]) {
            for (const mood of MOODS) {
              const l = resolveLook(C, form.id, step, mood, DEFAULT_LOOK, owner);
              const base = resolveLook(C, form.id, step, mood, DEFAULT_LOOK);
              expect(l.parts, `${track} ${form.id} ${step} ${mood}`).toEqual(base.parts);
              expect(poseOf(l, { tick: 0 })?.pixels).toEqual(poseOf(base, { tick: 0 })?.pixels);
            }
          }
        }
      }
    }
  });

  it('영역 칠하기를 실제로 거쳐도(치환이 제자리면) 원본과 같다', () => {
    const identity: BodyPaint = {
      body: { 4: 4, 3: 3 },
      crest: { 2: 2 },
      plume: { 9: 9, 2: 2 },
      beak: 3,
      cheek: 3,
      chest: 12,
    };
    for (const form of C.forms) {
      const body = sprite(form.body);
      const out = recolorBody(body, identity);
      expect(out).not.toBe(body);
      expect(out.frames).toEqual(body.frames);
      expect(out.anchors).toBe(body.anchors);
    }
  });
});

describe('몸 색·볏·깃 칠하기', () => {
  it('치환 값은 모두 팔레트 0~15 이고, 볏·깃 치환은 몸 색(3·4)을 건드리지 않는다', () => {
    const all = [
      ...C.custom.bodies.map((b) => ({ id: b.id, remap: b.remap })),
      ...C.custom.crests,
      ...C.custom.plumes,
      ...C.custom.bodies.flatMap((b) =>
        Object.entries({ ...b.itemRemap, ...b.decoRemap }).map(([id, remap]) => ({ id, remap })),
      ),
    ];
    for (const { id, remap } of all) {
      for (const [from, to] of Object.entries(remap)) {
        expect(Number(from) >= 0 && Number(from) <= 15 && Number.isInteger(Number(from)), id).toBe(
          true,
        );
        expect(to >= 0 && to <= 15 && Number.isInteger(to), id).toBe(true);
      }
    }
    for (const p of [...C.custom.crests, ...C.custom.plumes]) {
      expect(Object.keys(p.remap), p.id).not.toContain('3');
      expect(Object.keys(p.remap), p.id).not.toContain('4');
    }
    for (const b of C.custom.bodies) {
      expect(
        Object.keys(b.remap).every((k) => k === '3' || k === '4'),
        b.id,
      ).toBe(true);
      expect(
        C.custom.plumes.some((p) => p.id === b.autoPlume && p.id !== 'auto'),
        b.id,
      ).toBe(true);
    }
  });

  it('id 는 겹치지 않고, 기본값(DEFAULT_LOOK)이 목록에 있다', () => {
    for (const list of [C.custom.bodies, C.custom.crests, C.custom.plumes, C.custom.props]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    }
    for (const slot of ['pin', 'chest', 'cheek'] as const) {
      const ids = C.custom.decos.filter((d) => d.slot === slot).map((d) => d.id);
      expect(new Set(ids).size, slot).toBe(ids.length);
    }
    expect(C.custom.bodies.map((b) => b.id)).toContain(DEFAULT_LOOK.body);
    expect(C.custom.crests.map((b) => b.id)).toContain(DEFAULT_LOOK.crest);
    expect(C.custom.plumes.map((b) => b.id)).toContain(DEFAULT_LOOK.plume);
    // 견본에 이름 글자를 붙인다(색만으로 구별하지 않는다)
    for (const x of [
      ...C.custom.bodies,
      ...C.custom.crests,
      ...C.custom.plumes,
      ...C.custom.decos,
      ...C.custom.props,
    ]) {
      expect(x.name.trim().length, x.id).toBeGreaterThan(0);
    }
  });

  it('몸 색은 몸·덧살에만: 발·볏·깃·몸 아래·외곽선은 그대로, 부리·볼은 face, 흰 가슴털은 chest 를 따른다', () => {
    for (const b of C.custom.bodies) {
      for (const form of C.forms) {
        const body = sprite(form.body);
        const l = resolveLook(C, form.id, 1, 'work', look({ body: b.id, plume: 'five' }));
        const out = recolorBody(body, l.paint);
        const reg = regionsOf(body);
        const src = body.frames[0] as Uint8Array;
        const dst = out.frames[0] as Uint8Array;
        for (let i = 0; i < src.length; i += 1) {
          const v = src[i] as number;
          const r = reg[i];
          const where = `${b.id} ${form.id} ${i % 48},${Math.floor(i / 48)}`;
          if (r === REGION.BODY && v === 12 && b.chest !== undefined)
            expect(dst[i], where).toBe(b.chest);
          else if (r === REGION.BODY || r === REGION.SKIN)
            expect(dst[i], where).toBe(b.remap[v] ?? v);
          else if (r === REGION.BEAK) expect(dst[i], where).toBe(b.face?.beak ?? v);
          else if (r === REGION.CHEEK) expect(dst[i], where).toBe(b.face?.cheek ?? v);
          else expect(dst[i], where).toBe(v);
        }
      }
    }
  });

  it('볏 색은 볏에만, 깃 색은 깃·몸 아래에만 — 봉황 꼬리의 붉은 테(2)는 어느 깃 색에서도 남는다', () => {
    const phoenix = bodyOf('phoenix');
    const reg = regionsOf(phoenix);
    const src = phoenix.frames[0] as Uint8Array;
    for (const plume of C.custom.plumes) {
      for (const crest of C.custom.crests) {
        const l = resolveLook(C, 'phoenix', 1, 'work', look({ plume: plume.id, crest: crest.id }));
        const dst = recolorBody(phoenix, l.paint).frames[0] as Uint8Array;
        for (let i = 0; i < src.length; i += 1) {
          const v = src[i] as number;
          const r = reg[i];
          if (r === REGION.CREST) expect(dst[i]).toBe(crest.remap[v] ?? v);
          else if (r === REGION.PLUME) expect(dst[i]).toBe(l.custom.plume.remap[v] ?? v);
          else if (r === REGION.BELOW)
            expect(dst[i]).toBe(v === 2 ? 2 : (l.custom.plume.remap[v] ?? v));
          else expect(dst[i]).toBe(v);
        }
      }
    }
  });

  it("'알아서' 깃은 날봉이·봉황 깃에 몸 바탕·그늘과 같은 색을 남기지 않는다", () => {
    for (const b of C.custom.bodies) {
      const base = b.remap['4'] ?? 4;
      const shade = b.remap['3'] ?? 3;
      for (const formId of ['bird', 'phoenix']) {
        const body = bodyOf(formId);
        const l = resolveLook(C, formId, 1, 'work', look({ body: b.id, plume: 'auto' }));
        expect(l.custom.plumeAuto).toBe(true);
        expect(l.custom.plume.id).toBe(b.autoPlume);
        const dst = recolorBody(body, l.paint).frames[0] as Uint8Array;
        const reg = regionsOf(body);
        const used = new Set<number>();
        reg.forEach((r, i) => {
          if (r === REGION.PLUME) used.add(dst[i] as number);
        });
        expect(used.has(base), `${b.id} ${formId} 깃에 몸 바탕 ${base}`).toBe(false);
        expect(used.has(shade), `${b.id} ${formId} 깃에 몸 그늘 ${shade}`).toBe(false);
      }
    }
  });

  it('목 소품(공무원증 줄·넥타이)의 주색은 몸 바탕색과 다르다(몸 색별 보정 itemRemap 포함)', () => {
    const neckItems = C.items.filter((i) => i.slot === 'neck');
    expect(neckItems.map((i) => i.sprite).sort()).toEqual(['item-lanyard', 'item-tie']);
    /** 주색: 공무원증은 줄(9), 넥타이는 면(2) */
    const main: Record<string, number> = { 'item-lanyard': 9, 'item-tie': 2 };
    for (const b of C.custom.bodies) {
      const base = b.remap['4'] ?? 4;
      for (const item of neckItems) {
        for (const step of [item.minStep, ...(item.tints ?? []).map((t) => t.minStep)]) {
          const l = resolveLook(C, 'bird', step, 'work', look({ body: b.id }));
          const part = l.parts.find((p) => p.sprite === item.sprite);
          expect(part, `${b.id} ${item.id} ${step}`).toBeDefined();
          const color = main[item.sprite] as number;
          const shown = part?.remap?.[color] ?? color;
          expect(shown, `${b.id} ${item.id} ${step}호봉 ${tintAt(item, step)?.name}`).not.toBe(
            base,
          );
        }
      }
    }
    // 그늘과 같아 묻히던 줄은 그 몸에서만 바꾼다: 바다 파랑 줄 9→8, 새싹 초록 줄 6→7
    const lanyard = (body: string, step: number) =>
      resolveLook(C, 'chick', step, 'work', look({ body })).parts.find(
        (p) => p.sprite === 'item-lanyard',
      )?.remap;
    expect(lanyard('sea', 1)).toEqual({ 9: 8 });
    // 바다 몸의 파랑 넥타이(18호봉, 9)는 그늘 9와 같아 남색(8, 그늘 f)으로
    const tie = (body: string, step: number) =>
      resolveLook(C, 'chick', step, 'work', look({ body })).parts.find(
        (p) => p.sprite === 'item-tie',
      )?.remap;
    expect(tie('sea', 18)).toMatchObject({ 2: 8, 1: 15 });
    // 빨강 넥타이(12호봉)는 그대로(그림의 2·1 은 바뀌지 않는다)
    expect(tie('sea', 12)?.[2]).toBeUndefined();
    expect(tie('sky', 18)).toEqual({ 2: 9, 1: 8 });
    // 틴트(9→6) 다음에 보정(6→7): 줄은 청록 7. 그림에 원래 6 이 있었다면 그것도 7 이 된다
    expect(lanyard('sprout', 4)).toEqual({ 6: 7, 9: 7 });
    expect(lanyard('sunny', 4)).toEqual({ 9: 6 });
    expect(lanyard('sunny', 1)).toBeUndefined();
  });

  it('장식 보정(decoRemap)과 틴트 잇기', () => {
    const star = resolveLook(C, 'bird', 1, 'work', look({ deco: { pin: 'star', chest: 'star' } }));
    expect(star.parts.find((p) => p.sprite === 'deco-pin-star')?.remap).toEqual({ 4: 12, 3: 13 });
    const sky = resolveLook(C, 'bird', 1, 'work', look({ body: 'sky', deco: { pin: 'star' } }));
    expect(sky.parts.find((p) => p.sprite === 'deco-pin-star')?.remap).toBeUndefined();
    expect(chainRemap({ 9: 6 }, { 6: 7 })).toEqual({ 6: 7, 9: 7 });
    expect(chainRemap(undefined, { 6: 7 })).toEqual({ 6: 7 });
    expect(chainRemap({ 9: 6 }, undefined)).toEqual({ 9: 6 });
    expect(chainRemap({}, {})).toBeUndefined();
    // 2→9→2 는 제자리라 빠지고, 원래 9 였던 칸은 보정으로 2 가 된다
    expect(chainRemap({ 2: 9 }, { 9: 2 })).toEqual({ 9: 2 });
  });

  it('@skin 손 소품: 쥔 날개 끝(2×2)만 몸 색을 따르고 소품 그림의 4·3 은 그대로다', () => {
    const chalk = sprite('track-chalkboard');
    const sea = { 4: 10, 3: 9 };
    const out = skinSprite(chalk, sea);
    const src = chalk.frames[0] as Uint8Array;
    const dst = out.frames[0] as Uint8Array;
    let changed = 0;
    for (let i = 0; i < src.length; i += 1) if (src[i] !== dst[i]) changed += 1;
    expect(changed).toBe(4);
    expect(skinSprite(chalk, {})).toBe(chalk);
    expect(skinSprite(sprite('item-mug'), sea)).toBe(sprite('item-mug'));
    // 합성 결과: 바다 몸이 결재판을 쥔 날개 끝은 하늘색(a)
    const pose = poseOf(resolveLook(C, 'bird', 9, 'work', look({ body: 'sea' })));
    const [hx, hy] = bodyOf('bird').anchors.handL as readonly [number, number];
    const x = hx + 1;
    expect(pose?.pixels[hy * 48 + x]).toBe(10);
  });
});

describe('모르는 꾸미기 id 는 기본값으로 그린다(저장본은 그대로)', () => {
  it('몸·볏·깃·장식·소품이 모두 목록 밖이면 기본 모습과 같다', () => {
    const unknown = look({
      body: 'aurora',
      crest: 'rainbow-2',
      plume: 'galaxy',
      deco: { pin: 'snowflake', chest: 'moon-badge', cheek: false },
      prop: 'trumpet',
    });
    for (const form of C.forms) {
      for (const step of [1, 9, 20]) {
        const a = resolveLook(C, form.id, step, 'work', unknown);
        const b = resolveLook(C, form.id, step, 'work', DEFAULT_LOOK);
        expect(a.parts).toEqual(b.parts);
        expect(poseOf(a)?.pixels).toEqual(poseOf(b)?.pixels);
        expect(a.custom.body.id).toBe('sunny');
        expect(a.custom.crest.id).toBe('red');
        expect(a.custom.plumeAuto).toBe(true);
        expect(a.custom.pin).toBeNull();
        expect(a.custom.prop).toBeNull();
      }
    }
    // 고른 값 자체는 건드리지 않는다
    expect(unknown.body).toBe('aurora');
  });

  it('목록의 id 는 그 값으로 풀린다(이름도 함께)', () => {
    const r = resolveCustom(
      C,
      look({
        body: 'sky',
        crest: 'blue',
        plume: 'moon',
        deco: { pin: 'flower', chest: 'tiger', cheek: true },
      }),
    );
    expect(r.custom.body.name).toBe('하늘');
    expect(r.custom.crest.name).toBe('파랑');
    expect(r.custom.plume.name).toBe('달빛 깃');
    expect(r.custom.plumeAuto).toBe(false);
    expect(r.custom.pin?.sprite).toBe('deco-pin-flower');
    expect(r.custom.chest?.sprite).toBe('deco-badge-tiger');
    expect(r.custom.cheek?.sprite).toBe('deco-cheek-blush');
  });
});

describe('슬롯 충돌 규칙', () => {
  const decorated = look({ deco: { pin: 'flower', chest: 'star', cheek: true }, prop: 'compass' });
  const has = (mood: MoodId, name: string) =>
    partNames(resolveLook(C, 'bird', 20, mood, decorated)).includes(name);

  it('기분이 목(neck)을 숨기면 가슴 배지도, 왼손(handL)을 숨기면 소품도 숨는다', () => {
    for (const mood of MOODS) {
      const hide = new Set(C.moods[mood].hide);
      expect(has(mood, 'deco-badge-star'), mood).toBe(!hide.has('neck'));
      expect(has(mood, 'series-compass'), mood).toBe(!hide.has('handL'));
      // 머리핀은 모자를 쓰는 기분(머리 'head' 를 숨김: 휴가·잠·축하)에 숨고, 볼 터치는 늘 보인다
      expect(has(mood, 'deco-pin-flower'), mood).toBe(!hide.has('head'));
      expect(has(mood, 'deco-cheek-blush'), mood).toBe(true);
    }
    expect(has('vacation', 'deco-badge-star')).toBe(false);
    expect(has('lunch', 'series-compass')).toBe(false);
    expect(has('vacation', 'deco-pin-flower')).toBe(false);
    expect(has('sleep', 'deco-pin-flower')).toBe(false);
    expect(has('work', 'deco-pin-flower')).toBe(true);
  });

  it('왼손에는 하나만 든다: 소품을 정하면 호봉 소품(결재판)은 들지 않고, 들지 않기면 비운다', () => {
    const at20 = (prop: string) => partNames(resolveLook(C, 'bird', 20, 'work', look({ prop })));
    expect(at20('auto')).toContain('item-folder');
    expect(at20('compass')).toContain('series-compass');
    expect(at20('compass')).not.toContain('item-folder');
    expect(at20('none')).not.toContain('item-folder');
    expect(
      at20('none').filter((n) => getSprite(n)?.attach === 'handL'),
      '들지 않기',
    ).toEqual([]);
    for (const prop of C.custom.props.map((p) => p.id)) {
      const handL = at20(prop).filter((n) => getSprite(n)?.attach === 'handL');
      expect(handL, prop).toHaveLength(1);
    }
  });

  it('장식은 효과 자리(머리 오른쪽 위)와 볏 상자를 쓰지 않고, 금빛 깃은 볏 상자를 덮는다', () => {
    for (const deco of C.custom.decos) {
      const s = sprite(deco.sprite);
      for (const form of C.forms) {
        const body = sprite(form.body);
        const [ax, ay] = body.anchors[s.attach ?? ''] as readonly [number, number];
        const x0 = ax - s.origin[0];
        const y0 = ay - s.origin[1];
        const headY = (body.anchors.head as readonly [number, number])[1];
        s.frames[0]?.forEach((v, i) => {
          if (v === TRANSPARENT) return;
          const x = x0 + (i % s.w);
          const y = y0 + Math.floor(i / s.w);
          const where = `${deco.sprite} ${form.id} ${x},${y}`;
          expect(x >= 33 && x <= 46 && y < headY && y >= headY - 14, where).toBe(false);
          expect(x >= 19 && x <= 28 && y < headY && y >= headY - 5, where).toBe(false);
        });
      }
    }
    const crest = C.items.find((i) => i.id === 'crest');
    expect(crest?.slot).toBe('head');
    expect(partNames(resolveLook(C, 'phoenix', 20, 'work', look({ crest: 'blue' })))).toContain(
      'item-crest-gold',
    );
  });

  it('wearing 에는 손에 든 소품 이름이 들어가고 직렬 이름은 들어가지 않는다', () => {
    const l = resolveLook(
      C,
      'bird',
      20,
      'work',
      DEFAULT_LOOK,
      propOwnerOf({
        track: 'general',
        series: '간호',
      }),
    );
    const names = l.wearing.map((w) => w.name);
    expect(names).toContain('청진기');
    expect(names).not.toContain('결재판');
    expect(names.join(' ')).not.toContain('간호');
  });
});

describe("손 소품 'auto': 직렬(일반직)·호봉 소품", () => {
  const prop = (over: Parameters<typeof resolveProp>[2], value = 'auto') =>
    resolveProp(C, value, over);
  const held = (step: number, owner: Parameters<typeof resolveLook>[5], value = 'auto') =>
    partNames(resolveLook(C, 'chick', step, 'work', look({ prop: value }), owner)).filter(
      (n) => getSprite(n)?.attach === 'handL',
    );

  it('일반직은 고른 직렬의 테마 소품을 1호봉부터 든다. 고르지 않았거나 모르는 직렬이면 호봉 소품', () => {
    expect(held(1, propOwnerOf({ track: 'general', series: '간호' }))).toEqual([
      'series-stethoscope',
    ]);
    expect(held(1, propOwnerOf({ track: 'general', series: '세무' }))).toEqual([
      'series-calculator',
    ]);
    // 행정 테마는 기존 결재판이다(1호봉부터)
    expect(held(1, propOwnerOf({ track: 'general', series: '행정' }))).toEqual(['item-folder']);
    expect(held(1, propOwnerOf({ track: 'general', series: null }))).toEqual([]);
    expect(held(9, propOwnerOf({ track: 'general', series: null }))).toEqual(['item-folder']);
    expect(held(9, propOwnerOf({ track: 'general', series: '없어진직렬' }))).toEqual([
      'item-folder',
    ]);
  });

  it("특정직의 'auto' 는 호봉 소품이다(직종 소품은 직접 고를 때만). 직렬이 남아 있어도 쓰지 않는다", () => {
    // 직종은 꼭 고르는 계산 값이라, 기본 모습이 직종을 드러내지 않고 v4 저장본과 같은 모습이 되게(부록 F)
    const own: Record<string, string | null> = {
      police: 'flashlight',
      coastGuard: 'lifering',
      fire: 'extinguisher',
      teacher: 'chalkboard',
      foreign: 'globe',
      militaryCivil: 'radio',
      otherSpecial: null,
    };
    for (const track of TRACK_IDS.filter((t) => t !== 'general')) {
      const owner = propOwnerOf({ track, series: '간호' });
      expect(owner.theme, track).toBeNull();
      expect(held(1, owner), track).toEqual([]);
      expect(held(9, owner), track).toEqual(['item-folder']);
      expect(trackPropOf(C, track)?.id ?? null, track).toBe(own[track]);
      const id = own[track];
      if (id) expect(held(1, owner, id), track).toEqual([`track-${id}`]);
    }
    expect(trackPropOf(C, 'general')).toBeNull();
  });

  it('모르는 소품 id 는 호봉 소품으로 그린다(직렬 테마 소품으로 바꾸지 않는다)', () => {
    const nurse = propOwnerOf({ track: 'general', series: '간호' });
    expect(prop(nurse, 'shovel')).toBe('step');
    expect(held(1, nurse, 'shovel')).toEqual([]);
    expect(held(9, nurse, 'shovel')).toEqual(['item-folder']);
    expect(holdsOwnProp(C, { prop: 'shovel' }, nurse)).toBe(false);
    expect(holdsOwnProp(C, { prop: 'auto' }, nurse)).toBe(true);
    expect(holdsOwnProp(C, { prop: 'auto' }, { track: 'police' })).toBe(false);
    expect(holdsOwnProp(C, { prop: 'none' }, {})).toBe(true);
  });

  it("'none' 은 비우고, 고른 소품은 직종·직렬과 상관없이 그 소품을 든다", () => {
    const police = propOwnerOf({ track: 'police', series: null });
    expect(held(20, police, 'none')).toEqual([]);
    expect(held(20, police, 'umbrella')).toEqual(['series-umbrella']);
    expect(held(1, {}, 'globe')).toEqual(['track-globe']);
    expect(prop({ track: 'fire' }, 'none')).toBeNull();
    expect(prop({ track: 'general', theme: null })).toBe('step');
    expect(prop({})).toBe('step');
  });

  it('직렬 소품도 몸 색 보정(itemRemap)과 @skin 날개 끝을 받는다', () => {
    const l = resolveLook(C, 'bird', 1, 'work', look({ body: 'sea' }), {
      track: 'general',
      theme: 'laptop',
    });
    expect(partNames(l)).toContain('series-laptop');
    expect(sprite('series-laptop').skin).toBe(true);
  });
});

describe('손 소품 테두리 빛(propHalo): 날개·꼬리 위에서 묻히지 않게', () => {
  it('고른 손 소품에는 테두리 빛을 주고, 호봉 소품과 같은 그림(결재판)에는 주지 않는다', () => {
    const halo = (prop: string) =>
      resolveLook(C, 'phoenix', 10, 'work', look({ prop })).parts.find(
        (p) => getSprite(p.sprite)?.attach === 'handL',
      )?.halo;
    expect(C.custom.propHalo).toBe(12);
    expect(halo('extinguisher')).toBe(12);
    expect(halo('umbrella')).toBe(12);
    expect(halo('folder')).toBeUndefined();
    expect(halo('auto')).toBeUndefined();
  });

  it('테두리 빛은 소품 둘레 1칸 중 이미 그려진 칸에만 칠한다(빈 배경은 그대로)', () => {
    const base: Sprite = {
      name: 'base',
      w: 5,
      h: 3,
      origin: [0, 0],
      attach: null,
      layer: 0,
      anchors: {},
      skin: false,
      frames: [Uint8Array.from([4, 4, 4, 4, 4, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255])],
    };
    const dot: Sprite = {
      ...base,
      name: 'dot',
      w: 1,
      h: 1,
      origin: [-2, -1],
      layer: 1,
      frames: [Uint8Array.from([2])],
    };
    const out = compose([{ sprite: base }, { sprite: dot, halo: 12 }], { w: 5, h: 3, body: base });
    // 위(바탕 4)는 빛, 양옆·아래(빈 칸)는 그대로
    expect(Array.from(out.pixels)).toEqual([
      4, 4, 12, 4, 4, 255, 255, 2, 255, 255, 255, 255, 255, 255, 255,
    ]);
  });
});

describe('직렬 데이터(data/series.json, 공무원임용령 별표 1·2)', () => {
  const all = seriesData.groups.flatMap((g) => g.series.map((s) => ({ ...s, group: g.name })));

  it('별표 1·2 의 일반직 52개 직렬을 네 직군에 원문 순서로 담는다', () => {
    expect(all).toHaveLength(52);
    expect(new Set(all.map((s) => s.name)).size).toBe(52);
    expect(seriesData.groups.map((g) => [g.name, g.series.length])).toEqual([
      ['과학기술', 23],
      ['행정', 14],
      ['관리운영', 14],
      ['우정', 1],
    ]);
  });

  it('직렬 이름은 원문 발췌본에 있는 그대로다(줄바꿈으로 나뉜 이름은 이어지는 두 줄에)', () => {
    for (const s of all) {
      const group = seriesData.groups.find((g) => g.name === s.group);
      const src = seriesData.sources[group?.source ?? ''];
      expect(src, s.name).toBeDefined();
      const text = readFileSync(join(process.cwd(), src?.snapshot ?? ''), 'utf8');
      const lines = text.split('\n');
      const found =
        text.includes(s.name) ||
        [...s.name].some((_, k) => {
          if (k === 0) return false;
          const [a, b] = [s.name.slice(0, k), s.name.slice(k)];
          return lines.some((line, i) => line.includes(a) && (lines[i + 1] ?? '').includes(b));
        });
      expect(found, s.name).toBe(true);
    }
  });

  it('테마는 모두 직렬 소품(custom.props kind series)이고, 직렬 소품은 모두 어느 직렬이 쓴다', () => {
    const seriesProps = C.custom.props.filter((p) => p.kind === 'series').map((p) => p.id);
    for (const s of all) expect(seriesProps, s.name).toContain(s.theme);
    expect(new Set(all.map((s) => s.theme))).toEqual(new Set(seriesProps));
    expect(seriesProps).toHaveLength(12);
  });

  it('특정직 소품은 직종마다 하나, 일반직 소품과 겹치지 않는다', () => {
    const trackProps = C.custom.props.filter((p) => p.kind === 'track');
    const tracks = trackProps.flatMap((p) => p.tracks ?? []);
    expect(new Set(tracks).size).toBe(tracks.length);
    for (const t of tracks) expect(TRACK_IDS).toContain(t);
    expect(tracks).not.toContain('general');
  });

  it('직렬 찾기·이름 보이기', () => {
    expect(findSeries('간호')?.group.name).toBe('과학기술');
    expect(findSeries('사무운영')?.group.name).toBe('관리운영');
    expect(findSeries('우정')?.group.name).toBe('우정');
    expect(findSeries(null)).toBeNull();
    expect(findSeries('없는직렬')).toBeNull();
    expect(themeOfSeries('사서')).toBe('book');
    expect(themeOfSeries(null)).toBeNull();
    expect(seriesLabel({ track: 'general', series: '간호' })).toBe('간호');
    expect(seriesLabel({ track: 'police', series: '간호' })).toBeNull();
    expect(seriesLabel({ track: 'general', series: '없는직렬' })).toBeNull();
    expect(seriesLabel({ track: 'general', series: null })).toBeNull();
  });
});
