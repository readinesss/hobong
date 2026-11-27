/**
 * 알 그림과 연출 무대의 계산(character/egg.ts, fx/stage.ts, fx/evolve.ts).
 * - 금 단계 겹그림이 지금 알 그림 위에 제대로 놓이는지(알을 다시 그리면 여기서 걸린다)
 * - 깨어난 순간의 그림이 egg-hatch 넷째 프레임과 이어지고, 고른 몸 색을 따르는지
 * - 진화 장면이 한 방향으로만 나아가는지(번갈아 깜빡이지 않는다)
 */
import { describe, expect, it } from 'vitest';
import { eggPose, hatchedPose, lidPose } from '../../src/lib/character/egg.ts';
import { resolveCustom } from '../../src/lib/character/look.ts';
import { characterRules as C } from '../../src/lib/character/rules.ts';
import { getSprite } from '../../src/lib/character/sprites.ts';
import { TRANSPARENT } from '../../src/lib/character/sprite-format.ts';
import { defaultLook } from '../../src/lib/store/defaults.ts';
import {
  DISSOLVE_STEPS,
  dissolveOrder,
  drawEvolve,
  rimOf,
  silhouetteColor,
  stepped,
} from '../../src/lib/fx/evolve.ts';
import { blit, clearStage, createStage, dim, disc, put, sprite } from '../../src/lib/fx/stage.ts';

const W = 48;
const at = (pixels: Uint8Array, x: number, y: number) => pixels[y * W + x] as number;
const egg = getSprite(C.egg);
const count = (pixels: Uint8Array, color?: number) =>
  pixels.reduce(
    (n, v) => n + (color === undefined ? (v !== TRANSPARENT ? 1 : 0) : v === color ? 1 : 0),
    0,
  );

describe('알의 금 단계 그림', () => {
  it('S0 은 온전한 알(egg-hatch 첫 프레임) 그대로다', () => {
    const pose = eggPose({ stage: 0, peek: 0 });
    expect(pose && egg).toBeTruthy();
    expect(Array.from(pose!.pixels)).toEqual(Array.from(egg!.frames[0] as Uint8Array));
  });

  it('금 겹그림은 알 껍데기 안쪽(흰 칸) 위에만 놓인다', () => {
    const crack = getSprite('egg-crack');
    expect(crack?.frames.length).toBe(2);
    for (const [frame, eggFrame] of [
      [0, 0],
      [1, 1],
    ] as const) {
      const base = egg!.frames[eggFrame] as Uint8Array;
      const px = crack!.frames[frame] as Uint8Array;
      for (let y = 0; y < crack!.h; y += 1) {
        for (let x = 0; x < crack!.w; x += 1) {
          if (px[y * crack!.w + x] === TRANSPARENT) continue;
          const tx = x - crack!.origin[0];
          const ty = y - crack!.origin[1];
          // 흰 껍데기(c) 위다: 외곽선·줄무늬·알 밖이 아니다
          expect(at(base, tx, ty), `crack${frame} (${tx},${ty})`).toBe(12);
        }
      }
    }
  });

  it('단계가 오를수록 금(먹색 칸)이 늘고, S3 부터 틈새 빛이 보인다', () => {
    const ink = [0, 1, 2, 3].map((stage) => count(eggPose({ stage })!.pixels, 0));
    expect(ink[1]).toBeGreaterThan(ink[0] as number);
    expect(ink[2]).toBeGreaterThan(ink[1] as number);
    expect(ink[3]).toBeGreaterThan(ink[2] as number);
    expect(count(eggPose({ stage: 2 })!.pixels, 4)).toBe(0);
    expect(count(eggPose({ stage: 3 })!.pixels, 4)).toBeGreaterThan(0);
    expect(count(eggPose({ stage: 4 })!.pixels, 4)).toBeGreaterThan(20);
  });

  it('내다보는 눈: S0 에는 없고, S1~S3 은 왼쪽 어깨의 구멍, S4 는 틈 사이 얼굴이다. 알 밖으로 나가지 않는다', () => {
    expect(Array.from(eggPose({ stage: 0, peek: 0 })!.pixels)).toEqual(
      Array.from(eggPose({ stage: 0 })!.pixels),
    );
    for (const stage of [1, 2, 3, 4]) {
      const plain = eggPose({ stage })!.pixels;
      for (const frame of [0, 1, 2]) {
        const peek = eggPose({ stage, peek: frame })!.pixels;
        let changed = 0;
        for (let i = 0; i < peek.length; i += 1) {
          if (peek[i] === plain[i]) continue;
          changed += 1;
          // 바뀐 칸은 원래 알 그림 안이다(허공에 그리지 않는다)
          expect(plain[i], `S${stage} peek${frame} @${i}`).not.toBe(TRANSPARENT);
        }
        expect(changed, `S${stage} peek${frame}`).toBeGreaterThan(3);
      }
    }
  });

  it('틈새 빛은 고른 몸 색을 따른다(하늘 몸이면 노랑 대신 물빛)', () => {
    const { paint } = resolveCustom(C, { ...defaultLook(), body: 'sky' });
    const pose = eggPose({ stage: 4, peek: 0, paint })!;
    expect(count(pose.pixels, 4)).toBe(0);
    expect(count(pose.pixels, 11)).toBeGreaterThan(20);
    // 껍데기 줄무늬(3)는 그대로다
    expect(count(pose.pixels, 3)).toBe(count(eggPose({ stage: 4, peek: 0 })!.pixels, 3));
  });

  it('빛 테두리는 그림 밖 1px·2px 고리이고 바닥 아래로 번지지 않는다. 밝은 무대는 주황 한 색', () => {
    const plain = eggPose({ stage: 4 })!.pixels;
    const thin = eggPose({ stage: 4, glow: 1 })!.pixels;
    const thick = eggPose({ stage: 4, glow: 2 })!.pixels;
    const added = (a: Uint8Array) => a.reduce((n, v, i) => n + (v !== plain[i] ? 1 : 0), 0);
    expect(added(thin)).toBeGreaterThan(40);
    expect(added(thick)).toBeGreaterThan(added(thin));
    for (let i = 0; i < plain.length; i += 1) {
      if (thick[i] === plain[i]) continue;
      expect(plain[i]).toBe(TRANSPARENT);
      expect(Math.floor(i / W)).toBeLessThan(44);
    }
    const light = eggPose({ stage: 4, glow: 2, lightStage: true })!.pixels;
    expect(light.some((v, i) => v !== plain[i] && v !== 3)).toBe(false);
  });

  it('움찔은 알을 한 줄 누르고(꼭대기가 한 줄 내려온다), 몸짓은 그림을 통째로 옮긴다', () => {
    const top = (pixels: Uint8Array) => Math.floor(pixels.findIndex((v) => v !== TRANSPARENT) / W);
    const plain = eggPose({ stage: 2 })!.pixels;
    expect(top(eggPose({ stage: 2, squash: true })!.pixels)).toBe(top(plain) + 1);
    const moved = eggPose({ stage: 2, dx: 1, dy: -2 })!.pixels;
    expect(top(moved)).toBe(top(plain) - 2);
    expect(count(moved)).toBe(count(plain));
  });
});

describe('깨어난 순간', () => {
  it('뚜껑 + 알봉이 몸통 + 뜬 눈 = egg-hatch 넷째 프레임(픽셀 단위로 같다)', () => {
    const lid = lidPose()!;
    const body = hatchedPose()!;
    const frame = egg!.frames[3] as Uint8Array;
    const merged = new Uint8Array(frame.length).fill(TRANSPARENT);
    for (let i = 0; i < merged.length; i += 1) {
      const v = body.pixels[i] as number;
      merged[i] = v !== TRANSPARENT ? v : (lid.pixels[i] as number);
    }
    expect(Array.from(merged)).toEqual(Array.from(frame));
  });

  it('뚜껑은 알봉이 머리 위쪽에만 있고, 알봉이 몸통과 겹치지 않는다', () => {
    const lid = lidPose()!;
    const body = hatchedPose()!;
    const head = egg!.anchors.head?.[1] ?? 0;
    expect(head).toBe(getSprite('body-egg')!.anchors.head?.[1]);
    for (let i = 0; i < lid.pixels.length; i += 1) {
      if (lid.pixels[i] === TRANSPARENT) continue;
      expect(Math.floor(i / W)).toBeLessThan(head);
      expect(body.pixels[i]).toBe(TRANSPARENT);
    }
  });

  it('깨어난 알봉이는 고른 몸 색을 따르고, 껍데기와 부리는 그대로다', () => {
    const { paint } = resolveCustom(C, { ...defaultLook(), body: 'sea' });
    const plain = hatchedPose()!;
    const sea = hatchedPose({ paint })!;
    expect(count(sea.pixels, 4)).toBe(0);
    expect(count(sea.pixels, 10)).toBeGreaterThan(100);
    // 흰 껍데기(c)와 외곽선은 그대로
    expect(count(sea.pixels, 12)).toBe(count(plain.pixels, 12));
    expect(count(sea.pixels, 0)).toBe(count(plain.pixels, 0));
  });
});

describe('연출 무대(픽셀 판)', () => {
  const palette = C.palette;
  it('좌표는 내림한 정수 칸에만 그리고, 판 밖은 무시한다', () => {
    const stage = createStage(8, 6, palette);
    put(stage, 2.9, 1.2, 4);
    put(stage, -1, 0, 4);
    put(stage, 8, 0, 4);
    const filled = [];
    for (let i = 0; i < 8 * 6; i += 1) if (stage.data[i * 4 + 3]) filled.push(i);
    expect(filled).toEqual([1 * 8 + 2]);
    expect(Array.from(stage.data.slice(filled[0]! * 4, filled[0]! * 4 + 4))).toEqual([
      255, 205, 117, 255,
    ]);
    clearStage(stage);
    expect(stage.data.some((v) => v !== 0)).toBe(false);
  });

  it('어둠 덮기는 구멍(픽셀 원) 안을 건드리지 않는다', () => {
    const stage = createStage(40, 40, palette);
    dim(stage, 0, 0.4, { cx: 20, cy: 20, r: 10 });
    expect(stage.data[(20 * 40 + 20) * 4 + 3]).toBe(0);
    expect(stage.data[(20 * 40 + 29) * 4 + 3]).toBe(0);
    expect(stage.data[(20 * 40 + 32) * 4 + 3]).toBe(102);
    expect(stage.data[3]).toBe(102);
  });

  it('둥근 빛은 좌우·위아래가 같고, 스프라이트는 기준점을 그 자리에 둔다(뒤집어도)', () => {
    const stage = createStage(41, 41, palette);
    disc(stage, 20, 20, 8, 4, 0.5);
    for (let y = 0; y < 41; y += 1)
      for (let x = 0; x < 41; x += 1) {
        const a = stage.data[(y * 41 + x) * 4 + 3];
        expect(a).toBe(stage.data[(y * 41 + (40 - x)) * 4 + 3]);
        expect(a).toBe(stage.data[((40 - y) * 41 + x) * 4 + 3]);
      }
    const arrow = getSprite('fxc-spot-arrow')!;
    clearStage(stage);
    sprite(stage, arrow, 20, 20);
    // 화살표 끝점(기준점)이 (20,20)에 온다
    expect(stage.data[(20 * 41 + 20) * 4 + 3]).toBe(255);
    expect(stage.data[(21 * 41 + 20) * 4 + 3]).toBe(0);
    const knock = getSprite('fxc-knock-side')!;
    clearStage(stage);
    sprite(stage, knock, 20, 20, { flipX: true });
    // 뒤집으면 기준점 왼쪽으로만 그려진다
    for (let y = 0; y < 41; y += 1)
      for (let x = 20; x < 41; x += 1) expect(stage.data[(y * 41 + x) * 4 + 3]).toBe(0);
  });
});

describe('모습이 바뀌는 장면', () => {
  const before = hatchedPose()!;
  const after = eggPose({ stage: 0 })!;
  const order = dissolveOrder(W * W, 5);
  const stage = createStage(W, W, C.palette);
  const shot = (phase: 'silhouette' | 'dissolve' | 'reveal', t: number, color = 12) => {
    clearStage(stage);
    drawEvolve(stage, before, after, 0, 0, phase, t, { color, order });
    return Uint8ClampedArray.from(stage.data);
  };
  const alpha = (data: Uint8ClampedArray, i: number) => data[i * 4 + 3] as number;

  it('섞는 순서는 0~7 이 고르게 있고 시드가 같으면 같다', () => {
    expect(Array.from(dissolveOrder(64, 5))).toEqual(Array.from(dissolveOrder(64, 5)));
    const hist = new Array<number>(DISSOLVE_STEPS).fill(0);
    for (const v of order) hist[v] = (hist[v] as number) + 1;
    for (const n of hist) expect(n).toBe((W * W) / DISSOLVE_STEPS);
    expect(stepped(0, 8)).toBe(0);
    expect(stepped(0.5, 8)).toBe(4);
    expect(stepped(1, 8)).toBe(8);
    expect(stepped(7, 8)).toBe(8);
  });

  it('실루엣은 서서히 한 색이 된다(t=0 은 제 색, t=1 은 실루엣 색)', () => {
    const start = shot('silhouette', 0);
    const end = shot('silhouette', 1);
    clearStage(stage);
    blit(stage, before, 0, 0);
    expect(Array.from(start)).toEqual(Array.from(stage.data));
    for (let i = 0; i < W * W; i += 1) {
      if (before.pixels[i] === TRANSPARENT) expect(alpha(end, i)).toBe(0);
      else expect(Array.from(end.slice(i * 4, i * 4 + 3))).toEqual([244, 244, 244]);
    }
    expect(silhouetteColor(false)).toBe(12);
    // 어두운 무대에서는 넓은 흰 면 대신 밝은 회청
    expect(silhouetteColor(true)).toBe(13);
  });

  it('녹아 바뀜은 한 방향이다: 한 번 바뀐 칸은 되돌아가지 않고, 끝나면 새 실루엣과 같다', () => {
    const frames = Array.from({ length: DISSOLVE_STEPS + 1 }, (_, k) =>
      shot('dissolve', k / DISSOLVE_STEPS),
    );
    for (let i = 0; i < W * W; i += 1) {
      const was = before.pixels[i] !== TRANSPARENT;
      const will = after.pixels[i] !== TRANSPARENT;
      const seen = frames.map((f) => alpha(f, i) > 0);
      expect(seen[0]).toBe(was);
      expect(seen[DISSOLVE_STEPS]).toBe(will);
      // 바뀌는 횟수는 많아야 한 번
      let flips = 0;
      for (let k = 1; k < seen.length; k += 1) if (seen[k] !== seen[k - 1]) flips += 1;
      expect(flips).toBeLessThanOrEqual(1);
    }
  });

  it('색 드러남은 위에서 아래로만 내려오고, 끝나면 새 모습 그대로다', () => {
    const end = shot('reveal', 1);
    clearStage(stage);
    blit(stage, after, 0, 0);
    expect(Array.from(end)).toEqual(Array.from(stage.data));
    const half = shot('reveal', 0.5);
    for (let i = 0; i < W * W; i += 1) {
      if (after.pixels[i] === TRANSPARENT) continue;
      const y = Math.floor(i / W);
      const same = [0, 1, 2].every((c) => half[i * 4 + c] === end[i * 4 + c]);
      if (y < 24) expect(same).toBe(true);
    }
  });

  it('금빛 테는 그림 밖 1px 에만 생긴다', () => {
    const rim = rimOf(before, 4);
    for (let i = 0; i < W * W; i += 1) {
      if (rim.pixels[i] === TRANSPARENT) continue;
      expect(rim.pixels[i]).toBe(4);
      expect(before.pixels[i]).toBe(TRANSPARENT);
    }
    expect(rim.pixels.filter((v) => v === 4).length).toBeGreaterThan(60);
  });
});
