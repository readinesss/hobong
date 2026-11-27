/**
 * 부품 스프라이트를 한 장의 캔버스(팔레트 인덱스 배열)로 합성한다.
 * DOM에 의존하지 않는 순수 함수라 브라우저·테스트·미리보기 스크립트가 함께 쓴다.
 */
import { TRANSPARENT, type Point, type Sprite } from './sprite-format.ts';

export interface Layer {
  sprite: Sprite;
  /** 사용할 프레임(범위를 넘으면 나머지 연산) */
  frame?: number;
  /** 팔레트 인덱스 치환(예: 목걸이 줄 색) */
  remap?: Readonly<Record<number, number>>;
  /** 추가 이동(대기 애니메이션의 1px 흔들림 등) */
  dx?: number;
  dy?: number;
  /**
   * 테두리 빛(팔레트 인덱스). 그림 바깥 1px(상하좌우) 중 이미 무언가 그려진 칸에만 이 색을 먼저 칠한다.
   * 손 소품이 날개·꼬리 위에 겹쳐 같은 색 계열에 묻히지 않게 한다(빈 배경에는 칠하지 않는다).
   */
  halo?: number;
}

export interface Composition {
  w: number;
  h: number;
  pixels: Uint8Array;
}

export interface ComposeOptions {
  w: number;
  h: number;
  /** 몸통 스프라이트: 다른 부품이 참조할 앵커를 제공한다 */
  body: Sprite;
  /** 몸통 자체의 이동(앵커도 함께 움직인다) */
  bodyDx?: number;
  bodyDy?: number;
}

export function anchorOf(body: Sprite, name: string | null): Point {
  if (name === null) return [0, 0];
  const anchor = body.anchors[name];
  if (!anchor) throw new Error(`몸통 '${body.name}'에 앵커 '${name}'가 없습니다`);
  return anchor;
}

function haloAround(target: Composition, layer: Layer, frame: Uint8Array, x0: number, y0: number) {
  const { sprite } = layer;
  const color = layer.halo as number;
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < sprite.w && y < sprite.h && frame[y * sprite.w + x] !== TRANSPARENT;
  for (let y = -1; y <= sprite.h; y += 1) {
    const ty = y0 + y;
    if (ty < 0 || ty >= target.h) continue;
    for (let x = -1; x <= sprite.w; x += 1) {
      const tx = x0 + x;
      if (tx < 0 || tx >= target.w || opaque(x, y)) continue;
      if (!opaque(x - 1, y) && !opaque(x + 1, y) && !opaque(x, y - 1) && !opaque(x, y + 1))
        continue;
      const i = ty * target.w + tx;
      if (target.pixels[i] !== TRANSPARENT) target.pixels[i] = color;
    }
  }
}

function blit(target: Composition, layer: Layer, x0: number, y0: number): void {
  const { sprite, remap } = layer;
  const frame = sprite.frames[(layer.frame ?? 0) % sprite.frames.length] as Uint8Array;
  if (layer.halo !== undefined) haloAround(target, layer, frame, x0, y0);
  for (let y = 0; y < sprite.h; y += 1) {
    const ty = y0 + y;
    if (ty < 0 || ty >= target.h) continue;
    for (let x = 0; x < sprite.w; x += 1) {
      const tx = x0 + x;
      if (tx < 0 || tx >= target.w) continue;
      const v = frame[y * sprite.w + x] as number;
      if (v === TRANSPARENT) continue;
      target.pixels[ty * target.w + tx] = remap?.[v] ?? v;
    }
  }
}

/** layer 값 순으로 그린다(같으면 입력 순서 유지). 몸통은 layers에 포함해서 넘긴다. */
export function compose(layers: readonly Layer[], options: ComposeOptions): Composition {
  const out: Composition = {
    w: options.w,
    h: options.h,
    pixels: new Uint8Array(options.w * options.h).fill(TRANSPARENT),
  };
  const bodyDx = options.bodyDx ?? 0;
  const bodyDy = options.bodyDy ?? 0;
  const ordered = layers
    .map((layer, i) => ({ layer, i }))
    .sort((a, b) => a.layer.sprite.layer - b.layer.sprite.layer || a.i - b.i);

  for (const { layer } of ordered) {
    const { sprite } = layer;
    const [ax, ay] = anchorOf(options.body, sprite.attach);
    // 몸통과 몸통에 붙는 부품은 몸통 이동을 함께 따른다. 붙지 않는 부품(배경 효과)은 고정.
    const follows = sprite === options.body || sprite.attach !== null;
    const x0 = ax - sprite.origin[0] + (layer.dx ?? 0) + (follows ? bodyDx : 0);
    const y0 = ay - sprite.origin[1] + (layer.dy ?? 0) + (follows ? bodyDy : 0);
    blit(out, layer, x0, y0);
  }
  return out;
}

/** 팔레트 인덱스 배열을 RGBA 바이트로 바꾼다. */
export function toRgba(comp: Composition, palette: readonly string[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(comp.w * comp.h * 4);
  const table = palette.map((hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  });
  for (let i = 0; i < comp.pixels.length; i += 1) {
    const v = comp.pixels[i] as number;
    if (v === TRANSPARENT) continue;
    const color = table[v];
    if (!color) continue;
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
