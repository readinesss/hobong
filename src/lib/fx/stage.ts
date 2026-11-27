/**
 * 연출 무대의 픽셀 판(DOM 없는 계산). 무대 캔버스(src/lib/ui/StageCanvas.svelte)가 이 판을 정수 배율로 옮겨 그린다.
 *
 * - 좌표는 스프라이트 픽셀(정수). 판은 RGBA 바이트라 캐릭터 합성 결과(팔레트 인덱스)와 입자·빛·어둠 덮기를
 *   한 장에 겹칠 수 있다. 반 픽셀·흐림은 없다(받은 좌표는 내림한다).
 * - 색은 팔레트 인덱스로 받는다(무대에는 팔레트 밖의 색이 없다).
 * - 넓은 면의 밝기를 바꾸는 것(어둠 덮기·실루엣 섞기)은 alpha·t 로 서서히 바꾼다. 시간표가 300ms 이상으로 민다(scenes.ts).
 */
import { TRANSPARENT, type Sprite } from '../character/sprite-format.ts';
import { drawField, type Field } from './particles.ts';

export interface Stage {
  readonly w: number;
  readonly h: number;
  /** RGBA, 왼쪽 위부터 */
  readonly data: Uint8ClampedArray;
  /** 팔레트 인덱스 → [r, g, b] */
  readonly colors: readonly (readonly [number, number, number])[];
}

export function parseColors(palette: readonly string[]): [number, number, number][] {
  return palette.map((hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
}

export function createStage(w: number, h: number, palette: readonly string[]): Stage {
  const width = Math.max(1, Math.floor(w));
  const height = Math.max(1, Math.floor(h));
  return {
    w: width,
    h: height,
    data: new Uint8ClampedArray(width * height * 4),
    colors: parseColors(palette),
  };
}

export function clearStage(stage: Stage): void {
  stage.data.fill(0);
}

/** 한 칸을 칠한다(위에 겹쳐 그리기). alpha 0~1 */
export function put(stage: Stage, x: number, y: number, color: number, alpha = 1): void {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= stage.w || py >= stage.h) return;
  const rgb = stage.colors[color];
  if (!rgb || alpha <= 0) return;
  const i = (py * stage.w + px) * 4;
  const d = stage.data;
  if (alpha >= 1) {
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
    d[i + 3] = 255;
    return;
  }
  const below = (d[i + 3] as number) / 255;
  const out = alpha + below * (1 - alpha);
  d[i] = (rgb[0] * alpha + (d[i] as number) * below * (1 - alpha)) / out;
  d[i + 1] = (rgb[1] * alpha + (d[i + 1] as number) * below * (1 - alpha)) / out;
  d[i + 2] = (rgb[2] * alpha + (d[i + 2] as number) * below * (1 - alpha)) / out;
  d[i + 3] = out * 255;
}

export function rect(
  stage: Stage,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha = 1,
): void {
  for (let yy = 0; yy < h; yy += 1) {
    for (let xx = 0; xx < w; xx += 1) put(stage, x + xx, y + yy, color, alpha);
  }
}

export interface BlitOptions {
  alpha?: number;
  /** 팔레트 인덱스 치환 */
  remap?: Readonly<Record<number, number>>;
  /** 칸마다 색을 바꾸거나(-1 이면 그리지 않는다) 그대로 둔다. remap 뒤에 부른다 */
  map?: (color: number, x: number, y: number) => number;
  /** 모든 칸을 이 색 쪽으로 t(0~1)만큼 섞는다(실루엣으로 서서히) */
  mix?: { color: number; t: number };
}

/** 팔레트 인덱스 그림(합성 결과)을 (dx, dy)에 그린다 */
export function blit(
  stage: Stage,
  comp: { w: number; h: number; pixels: Uint8Array },
  dx: number,
  dy: number,
  options: BlitOptions = {},
): void {
  const alpha = options.alpha ?? 1;
  const mixTo = options.mix ? stage.colors[options.mix.color] : undefined;
  const t = options.mix ? Math.max(0, Math.min(1, options.mix.t)) : 0;
  for (let y = 0; y < comp.h; y += 1) {
    const ty = Math.floor(dy) + y;
    if (ty < 0 || ty >= stage.h) continue;
    for (let x = 0; x < comp.w; x += 1) {
      let v = comp.pixels[y * comp.w + x] as number;
      if (v === TRANSPARENT) continue;
      v = options.remap?.[v] ?? v;
      if (options.map) {
        v = options.map(v, x, y);
        if (v < 0) continue;
      }
      const tx = Math.floor(dx) + x;
      if (tx < 0 || tx >= stage.w) continue;
      if (mixTo && t > 0) {
        const rgb = stage.colors[v];
        if (!rgb) continue;
        const i = (ty * stage.w + tx) * 4;
        const d = stage.data;
        d[i] = rgb[0] + (mixTo[0] - rgb[0]) * t;
        d[i + 1] = rgb[1] + (mixTo[1] - rgb[1]) * t;
        d[i + 2] = rgb[2] + (mixTo[2] - rgb[2]) * t;
        d[i + 3] = 255;
      } else put(stage, tx, ty, v, alpha);
    }
  }
}

export interface SpriteOptions {
  frame?: number;
  remap?: Readonly<Record<number, number>>;
  alpha?: number;
  /** 좌우로 뒤집는다(기준점도 함께) */
  flipX?: boolean;
}

/** 스프라이트의 기준점(origin)을 (x, y)에 두고 그린다 */
export function sprite(
  stage: Stage,
  s: Sprite,
  x: number,
  y: number,
  options: SpriteOptions = {},
): void {
  const frame = s.frames[(options.frame ?? 0) % s.frames.length] as Uint8Array;
  const x0 = Math.floor(x) - (options.flipX ? s.w - 1 - s.origin[0] : s.origin[0]);
  const y0 = Math.floor(y) - s.origin[1];
  for (let yy = 0; yy < s.h; yy += 1) {
    for (let xx = 0; xx < s.w; xx += 1) {
      const v = frame[yy * s.w + (options.flipX ? s.w - 1 - xx : xx)] as number;
      if (v === TRANSPARENT) continue;
      put(stage, x0 + xx, y0 + yy, options.remap?.[v] ?? v, options.alpha ?? 1);
    }
  }
}

/** 칸이 반지름 r 인 픽셀 원 안인지(가운데 칸 포함) */
function inside(dx: number, dy: number, r: number): boolean {
  return dx * dx + dy * dy <= r * r + r * 0.5;
}

/** 채운 픽셀 원(알 뒤의 둥근 빛) */
export function disc(
  stage: Stage,
  cx: number,
  cy: number,
  r: number,
  color: number,
  alpha = 1,
): void {
  const radius = Math.max(0, Math.floor(r));
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (inside(dx, dy, radius)) put(stage, cx + dx, cy + dy, color, alpha);
    }
  }
}

/** 픽셀 원의 테두리(두께 thick 칸). 퍼지는 빛 고리 */
export function ring(
  stage: Stage,
  cx: number,
  cy: number,
  r: number,
  color: number,
  thick = 1,
  alpha = 1,
): void {
  const radius = Math.max(0, Math.floor(r));
  const inner = Math.max(0, radius - Math.max(1, Math.floor(thick)));
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (inside(dx, dy, radius) && !inside(dx, dy, inner))
        put(stage, cx + dx, cy + dy, color, alpha);
    }
  }
}

/** 선(Bresenham). 빛줄기 */
export function line(
  stage: Stage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number,
  alpha = 1,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 4096; guard += 1) {
    put(stage, x, y, color, alpha);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** 가운데에서 뻗는 빛줄기 count 가닥(turn 라디안만큼 돌린다). 안쪽 반지름 r0 ~ 바깥 r1 */
export function rays(
  stage: Stage,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  count: number,
  turn: number,
  color: number,
  alpha = 1,
): void {
  for (let i = 0; i < count; i += 1) {
    const a = turn + (i / count) * Math.PI * 2;
    line(
      stage,
      cx + Math.cos(a) * r0,
      cy + Math.sin(a) * r0,
      cx + Math.cos(a) * r1,
      cy + Math.sin(a) * r1,
      color,
      alpha,
    );
  }
}

/**
 * 판 전체를 color 로 alpha 만큼 덮되, 구멍(픽셀 원) 안은 그대로 둔다(새 소품 비춤).
 * 이미 그려진 그림 위에 부른다.
 */
export function dim(
  stage: Stage,
  color: number,
  alpha: number,
  hole?: { cx: number; cy: number; r: number },
): void {
  if (alpha <= 0) return;
  for (let y = 0; y < stage.h; y += 1) {
    for (let x = 0; x < stage.w; x += 1) {
      if (hole && inside(x - Math.floor(hole.cx), y - Math.floor(hole.cy), hole.r)) continue;
      put(stage, x, y, color, alpha);
    }
  }
}

/**
 * 입자 밭을 판에 그린다. 입자 좌표는 캐릭터 48칸 기준이므로 (ox, oy)만큼 옮긴다.
 * 색 네모의 색은 팔레트 인덱스 한 글자('4'·'a'), 스프라이트는 find 로 찾는다(기준점이 입자 자리에 온다).
 */
export function drawParticles(
  stage: Stage,
  field: Field,
  ox: number,
  oy: number,
  find: (name: string) => Sprite | null,
  remap?: Readonly<Record<number, number>>,
): void {
  drawField(field, {
    rect(x, y, w, h, color) {
      const index = parseInt(color, 16);
      if (Number.isInteger(index)) rect(stage, ox + x, oy + y, w, h, index);
    },
    sprite(name, frame, x, y) {
      const s = find(name);
      if (s) sprite(stage, s, ox + x, oy + y, { frame, remap });
    },
  });
}
