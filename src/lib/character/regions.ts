/**
 * 몸통 영역 판정과 꾸미기 색 바꾸기(순수 함수, 설계 rendering §2~§3).
 *
 * 색 번호 3·4 는 몸 바탕·그늘이지만 발·볏 하이라이트·금빛 깃에도 쓰인다. 그래서 팔레트 전체를 바꾸지 않고
 * 몸통 그림을 영역으로 나눠 영역마다 다른 치환을 한다.
 *
 * 영역(regionsOf)
 * - 몸(BODY): eyes 앵커에서 외곽선(0)을 넘지 않고 번지는 칸(head 앵커 줄보다 위로는 번지지 않는다)
 * - 덧살(SKIN): 그 밖의 3·4 칸 중 몸 아래 줄보다 위에 있는 것 — 솜봉이 머리 위 솜털, 날개손 끝처럼
 *   외곽선 너머의 몸 색 조각. 몸 색을 따른다.
 * - 발(FEET): 몸의 맨 아래 줄보다 아래에 있는 3·4 칸. 새 몸통의 긴 다리(날봉이 4행)까지 발로 잡는다
 *   (예전 규칙 'ground−2 줄부터'는 다리 윗부분을 깃으로 잡았다). 몸 색을 따르지 않는다(주황 발).
 * - 볏(CREST): head 앵커 줄보다 위의 3·4 아닌 칸
 * - 깃(PLUME): 몸 아래 줄까지의 3·4 아닌 칸(날개)
 * - 몸 아래(BELOW): 몸 아래 줄보다 아래의 3·4 아닌 칸(봉황 꼬리, 알 껍데기). 깃 색을 따르되 붉은 테(2)는 남긴다.
 * - 부리(BEAK)·볼(CHEEK): 몸 안의 3 중 얼굴 가면 자리(eyes 앵커 기준). 몸 색을 따르지 않는다(정체성: 주황 부리·볼).
 * - 외곽선(OUTLINE)
 *
 * 영역 판정은 몸통 외곽선이 닫혀 있다는 가정에 기댄다. 몸통을 다시 그리면 형태별 영역 픽셀 수 테스트가 깨지므로
 * 미리보기로 다시 확인한다(tests/unit/character-custom.test.ts).
 */
import { TRANSPARENT, type Sprite } from './sprite-format.ts';

export const REGION = {
  NONE: 0,
  BODY: 1,
  CREST: 2,
  PLUME: 3,
  FEET: 4,
  BELOW: 5,
  BEAK: 6,
  CHEEK: 7,
  SKIN: 8,
  OUTLINE: 9,
} as const;
export type RegionCode = (typeof REGION)[keyof typeof REGION];

/** 몸 바탕(4)·그늘(3) */
const BASE = 4;
const SHADE = 3;
/** 봉황 꼬리 붉은 테·뿌리(몸 아래 영역에서는 깃 색을 바꿔도 남긴다) */
const RED_RIM = 2;

/**
 * 얼굴 가면: eyes 앵커(ex, ey) 기준 부리·볼 자리. 다섯 몸통은 얼굴 픽셀이 같다(char-bodies.txt 머리말).
 * - 부리: dy=3 · dx=-2..1, dy=4 · dx=-1..0
 * - 볼:   dy=3 · dx=-8,-7,+6,+7 (볼 터치 장식 deco-cheek-blush 와 같은 자리)
 */
export function faceRole(dx: number, dy: number): 'beak' | 'cheek' | null {
  if (dy === 3 && dx >= -2 && dx <= 1) return 'beak';
  if (dy === 4 && (dx === -1 || dx === 0)) return 'beak';
  if (dy === 3 && (dx === -8 || dx === -7 || dx === 6 || dx === 7)) return 'cheek';
  return null;
}

const regionCache = new WeakMap<Sprite, Uint8Array>();

/** 몸통 첫 프레임의 영역 지도(칸마다 REGION 값). 몸통마다 한 번만 계산한다 */
export function regionsOf(body: Sprite): Uint8Array {
  const cached = regionCache.get(body);
  if (cached) return cached;
  const { w, h } = body;
  const px = body.frames[0] as Uint8Array;
  const reg = new Uint8Array(w * h);
  const eyes = body.anchors.eyes;
  const head = body.anchors.head;
  if (!eyes || !head) throw new Error(`몸통 '${body.name}'에 eyes·head 앵커가 없습니다`);
  const [ex, ey] = eyes;
  const headY = head[1];

  // 1) 몸: eyes 앵커에서 번지기
  let bottom = -1;
  const stack: number[] = [ey * w + ex];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (reg[i] !== REGION.NONE) continue;
    const v = px[i] as number;
    const y = Math.floor(i / w);
    if (v === TRANSPARENT || v === 0 || y < headY) continue;
    reg[i] = REGION.BODY;
    if (y > bottom) bottom = y;
    const x = i % w;
    if (x + 1 < w) stack.push(i + 1);
    if (x > 0) stack.push(i - 1);
    if (y + 1 < h) stack.push(i + w);
    if (y > 0) stack.push(i - w);
  }

  // 2) 나머지 칸
  for (let i = 0; i < px.length; i += 1) {
    if (reg[i] !== REGION.NONE) continue;
    const v = px[i] as number;
    if (v === TRANSPARENT) continue;
    const y = Math.floor(i / w);
    const skinColor = v === BASE || v === SHADE;
    if (v === 0) reg[i] = REGION.OUTLINE;
    else if (y > bottom) reg[i] = skinColor ? REGION.FEET : REGION.BELOW;
    else if (skinColor) reg[i] = REGION.SKIN;
    else reg[i] = y < headY ? REGION.CREST : REGION.PLUME;
  }

  // 3) 얼굴 가면(몸 안의 그늘 3)
  for (let i = 0; i < px.length; i += 1) {
    if (reg[i] !== REGION.BODY || px[i] !== SHADE) continue;
    const role = faceRole((i % w) - ex, Math.floor(i / w) - ey);
    if (role) reg[i] = role === 'beak' ? REGION.BEAK : REGION.CHEEK;
  }
  regionCache.set(body, reg);
  return reg;
}

/** 영역별 칸 수(테스트·미리보기용) */
export function regionCounts(body: Sprite): Record<keyof typeof REGION, number> {
  const reg = regionsOf(body);
  const out = Object.fromEntries(Object.keys(REGION).map((k) => [k, 0])) as Record<
    keyof typeof REGION,
    number
  >;
  const names = Object.keys(REGION) as (keyof typeof REGION)[];
  for (const r of reg) {
    const name = names.find((n) => REGION[n] === r);
    if (name) out[name] += 1;
  }
  return out;
}

export type Remap = Readonly<Record<number, number>>;

/** 몸통에 칠할 색(look.ts resolveLook 이 꾸미기 규칙에서 만든다) */
export interface BodyPaint {
  /** 몸 바탕·그늘 치환(몸·덧살 영역) */
  body: Remap;
  crest: Remap;
  plume: Remap;
  /** 부리·볼 색. null 이면 그림 그대로(3) */
  beak: number | null;
  cheek: number | null;
  /** 몸 영역의 흰 가슴털(c) 색. null 이면 그림 그대로(흰 몸에서 가슴털이 묻히지 않게) */
  chest: number | null;
}

/** 날봉이·봉황의 흰 가슴털 색 */
const CHEST = 12;

export const PLAIN_PAINT: BodyPaint = Object.freeze({
  body: Object.freeze({}),
  crest: Object.freeze({}),
  plume: Object.freeze({}),
  beak: null,
  cheek: null,
  chest: null,
});

const isEmpty = (r: Remap) => Object.keys(r).length === 0;

/** 그림을 하나도 바꾸지 않는 칠인지(기본 모습) */
export function isPlainPaint(paint: BodyPaint): boolean {
  return (
    isEmpty(paint.body) &&
    isEmpty(paint.crest) &&
    isEmpty(paint.plume) &&
    paint.beak === null &&
    paint.cheek === null &&
    paint.chest === null
  );
}

function paintKey(paint: BodyPaint): string {
  const r = (m: Remap) =>
    Object.entries(m)
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
  return `${r(paint.body)}|${r(paint.crest)}|${r(paint.plume)}|${paint.beak}|${paint.cheek}|${paint.chest}`;
}

const bodyCache = new WeakMap<Sprite, Map<string, Sprite>>();

/**
 * 영역별로 색을 바꾼 몸통. 앵커·크기는 원본 그대로다.
 * 바꿀 것이 없으면(기본 모습) 원본 스프라이트를 그대로 돌려준다 — 기본 모습이 꾸미기 전과 픽셀 단위로 같다.
 */
export function recolorBody(body: Sprite, paint: BodyPaint): Sprite {
  if (isPlainPaint(paint)) return body;
  const key = paintKey(paint);
  let byKey = bodyCache.get(body);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const reg = regionsOf(body);
  const frames = body.frames.map((src) => {
    const px = new Uint8Array(src);
    for (let i = 0; i < px.length; i += 1) {
      const v = src[i] as number;
      if (v === TRANSPARENT) continue;
      switch (reg[i]) {
        case REGION.BODY:
          px[i] = v === CHEST && paint.chest !== null ? paint.chest : (paint.body[v] ?? v);
          break;
        case REGION.SKIN:
          px[i] = paint.body[v] ?? v;
          break;
        case REGION.BEAK:
          px[i] = paint.beak ?? v;
          break;
        case REGION.CHEEK:
          px[i] = paint.cheek ?? v;
          break;
        case REGION.CREST:
          px[i] = paint.crest[v] ?? v;
          break;
        case REGION.PLUME:
          px[i] = paint.plume[v] ?? v;
          break;
        case REGION.BELOW:
          px[i] = v === RED_RIM ? v : (paint.plume[v] ?? v);
          break;
        default:
          break;
      }
    }
    return px;
  });
  const out: Sprite = { ...body, frames };
  if (!byKey) {
    byKey = new Map();
    bodyCache.set(body, byKey);
  }
  byKey.set(key, out);
  return out;
}

/** @skin 소품의 날개 끝 칸인지: 기준점 오른쪽(x ≥ originX+1), 기준점 줄 위아래 2줄 안의 4·3 */
export function isSkinPixel(sprite: Sprite, x: number, y: number, v: number): boolean {
  const [ox, oy] = sprite.origin;
  return (v === BASE || v === SHADE) && x >= ox + 1 && Math.abs(y - oy) <= 2;
}

const skinCache = new WeakMap<Sprite, Map<string, Sprite>>();

/**
 * @skin 손 소품의 날개 끝을 몸 색으로 칠한다. @skin 이 아니거나 몸 색이 기본이면 원본 그대로.
 * 소품 틴트(층의 remap)는 그 뒤에 compose 가 덮어 적용한다.
 */
export function skinSprite(sprite: Sprite, bodyRemap: Remap): Sprite {
  if (!sprite.skin || isEmpty(bodyRemap)) return sprite;
  const key = Object.entries(bodyRemap)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
  let byKey = skinCache.get(sprite);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const frames = sprite.frames.map((src) => {
    const px = new Uint8Array(src);
    for (let y = 0; y < sprite.h; y += 1) {
      for (let x = 0; x < sprite.w; x += 1) {
        const i = y * sprite.w + x;
        const v = src[i] as number;
        if (isSkinPixel(sprite, x, y, v)) px[i] = bodyRemap[v] ?? v;
      }
    }
    return px;
  });
  const out: Sprite = { ...sprite, frames };
  if (!byKey) {
    byKey = new Map();
    skinCache.set(sprite, byKey);
  }
  byKey.set(key, out);
  return out;
}

/**
 * 두 치환을 잇는다: first 를 먼저, 그 결과에 then(보정). 바뀌지 않는 칸은 뺀다.
 * (소품 틴트 → 몸 색별 itemRemap/decoRemap)
 */
export function chainRemap(first: Remap | undefined, then: Remap | undefined): Remap | undefined {
  if (!then || isEmpty(then)) return first && !isEmpty(first) ? first : undefined;
  const out: Record<number, number> = {};
  for (let k = 0; k < 16; k += 1) {
    const t = first?.[k] ?? k;
    const o = then[t] ?? t;
    if (o !== k) out[k] = o;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
