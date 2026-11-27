/**
 * 알 그림(첫 입력의 말을 거는 알·제자리 부화). DOM 을 만지지 않는 계산이다.
 *
 * 금 단계(S0~S4)는 egg-hatch 의 앞 세 프레임과 egg-crack 겹그림 두 장으로 다섯 장면을 만든다.
 * - S0 온전한 알 / S1 작은 금 / S2 금 / S3 금 가지와 틈새 빛 / S4 벌어지기 직전(틈으로 얼굴이 보인다)
 * - 틈새 빛·틈으로 보이는 몸(그림의 4)은 고른 몸 색을 따른다. 껍데기 줄무늬(3)는 그대로다.
 * - 빛 테두리(다 채운 알)는 그림 실루엣을 1px·2px 넓혀 그 자리에서 만든다(알 그림을 고쳐도 낡지 않는다).
 * - 움찔(값을 고쳐야 할 때)은 알을 한 줄 눌러 그린다.
 *
 * 깨어난 순간(hatchedPose)은 egg-hatch 넷째 프레임과 같은 그림을 부품으로 다시 만든다:
 * 뚜껑(넷째 프레임의 머리 위쪽 줄) + 알봉이 몸통(고른 몸 색) + 눈. 기본 모습이면 넷째 프레임과 픽셀 단위로 같다
 * (tests/unit/egg.test.ts). 그래서 부화한 알봉이가 고른 몸 색을 따르고, 끝 장면의 호봉이와 그대로 이어진다.
 */
import { compose, type Composition, type Layer } from './compose.ts';
import { PLAIN_PAINT, recolorBody, type BodyPaint } from './regions.ts';
import { characterRules } from './rules.ts';
import { TRANSPARENT, type Sprite } from './sprite-format.ts';
import { getSprite } from './sprites.ts';

export const EGG_STAGE_MAX = 4;
export type EggStage = 0 | 1 | 2 | 3 | 4;

/** 금 단계마다의 egg-hatch 프레임과 겹그림(egg-crack) 프레임(없으면 null) */
const STAGE_FRAMES: readonly { egg: number; crack: number | null }[] = [
  { egg: 0, crack: null },
  { egg: 0, crack: 0 },
  { egg: 1, crack: null },
  { egg: 1, crack: 1 },
  { egg: 2, crack: null },
];

/** 그림의 몸 바탕색(틈새 빛·틈으로 보이는 몸)과 부리 */
const BODY = 4;
const BEAK = 3;
/** 빛 테두리 색: 안쪽 고리·바깥 고리 */
const GLOW_INNER = 4;
const GLOW_OUTER = 3;
/** 바닥(그림자) 줄. 빛 테두리는 이 줄 아래로 번지지 않는다 */
const GROUND_ROW = 44;
/** 움찔: 이 줄(곧은 옆벽)을 지우고 위쪽을 한 줄 내린다 */
const SQUASH_ROW = 39;

const { w: W, h: H } = characterRules.canvas;

export interface EggPoseOptions {
  stage: number;
  /** 틈으로 내다보는 눈의 프레임(0 뜬 눈·1 깜빡·2 말풍선 쪽). null 이면 그리지 않는다. S0 에서는 그리지 않는다 */
  peek?: number | null;
  /** 빛 테두리 두께(0 없음·1 얇게·2 두껍게) */
  glow?: 0 | 1 | 2;
  /** 밝은 무대에서는 노랑(4)이 묻혀 고리를 주황 한 색으로 그린다 */
  lightStage?: boolean;
  /** 움찔(한 줄 눌린 그림) */
  squash?: boolean;
  /** 몸짓(moves.ts)의 자리 */
  dx?: number;
  dy?: number;
  /** 고른 몸 색(틈새 빛·틈 사이 몸). 기본 모습이면 주지 않는다 */
  paint?: BodyPaint;
}

export function clampStage(stage: number): EggStage {
  return Math.max(0, Math.min(EGG_STAGE_MAX, Math.floor(stage))) as EggStage;
}

function eggSprite(): Sprite | null {
  return getSprite(characterRules.egg);
}

/** 몸 색 치환에서 틈새 빛·부리에 쓸 색만 고른다 */
function gapRemap(paint: BodyPaint | undefined): Record<number, number> | undefined {
  if (!paint) return undefined;
  const out: Record<number, number> = {};
  const body = paint.body[BODY];
  if (body !== undefined) out[BODY] = body;
  if (paint.beak !== null) out[BEAK] = paint.beak;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 그림 둘레를 1px 넓힌 고리(상하좌우 이웃에 그림이 있는 빈 칸)를 color 로 칠한다 */
function ring(pixels: Uint8Array, color: number): void {
  const src = new Uint8Array(pixels);
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && src[y * W + x] !== TRANSPARENT;
  for (let y = 0; y < GROUND_ROW; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (src[y * W + x] !== TRANSPARENT) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) pixels[y * W + x] = color;
    }
  }
}

/** 알을 한 줄 누른다: SQUASH_ROW 를 지우고 그 위를 한 줄씩 내린다 */
function squash(pixels: Uint8Array): void {
  for (let y = SQUASH_ROW; y > 0; y -= 1) {
    pixels.copyWithin(y * W, (y - 1) * W, y * W);
  }
  pixels.fill(TRANSPARENT, 0, W);
}

function shift(comp: Composition, dx: number, dy: number): Composition {
  if (dx === 0 && dy === 0) return comp;
  const out = new Uint8Array(comp.pixels.length).fill(TRANSPARENT);
  for (let y = 0; y < comp.h; y += 1) {
    const ty = y + dy;
    if (ty < 0 || ty >= comp.h) continue;
    for (let x = 0; x < comp.w; x += 1) {
      const tx = x + dx;
      if (tx < 0 || tx >= comp.w) continue;
      out[ty * comp.w + tx] = comp.pixels[y * comp.w + x] as number;
    }
  }
  return { w: comp.w, h: comp.h, pixels: out };
}

/** 금 단계의 알 그림(48×48 팔레트 인덱스). 스프라이트가 없으면 null */
export function eggPose(options: EggPoseOptions): Composition | null {
  const egg = eggSprite();
  if (!egg) return null;
  const stage = clampStage(options.stage);
  const frames = STAGE_FRAMES[stage] as { egg: number; crack: number | null };
  const remap = gapRemap(options.paint);
  const layers: Layer[] = [{ sprite: egg, frame: frames.egg, remap }];
  const crack = frames.crack === null ? null : getSprite('egg-crack');
  if (crack && frames.crack !== null) layers.push({ sprite: crack, frame: frames.crack, remap });
  if (options.peek !== null && options.peek !== undefined && stage >= 1) {
    const peek = getSprite(stage === EGG_STAGE_MAX ? 'fxc-egg-peek' : 'fxc-egg-peek-hole');
    if (peek) layers.push({ sprite: peek, frame: options.peek, remap });
  }
  let comp = compose(layers, { w: W, h: H, body: egg });
  if (options.squash) squash(comp.pixels);
  const glow = options.glow ?? 0;
  if (glow >= 1) {
    // 바깥 고리부터 그리면 안쪽 고리가 그 위에 남는다: 먼저 안쪽을 칠하고, 두꺼울 때 한 번 더 넓힌다
    ring(comp.pixels, options.lightStage ? GLOW_OUTER : GLOW_INNER);
    if (glow >= 2) ring(comp.pixels, GLOW_OUTER);
  }
  comp = shift(comp, options.dx ?? 0, options.dy ?? 0);
  return comp;
}

/** 깨어날 때 튀어 오르는 뚜껑: egg-hatch 넷째 프레임에서 알봉이 머리(head 앵커) 위쪽 줄만 */
export function lidPose(): Composition | null {
  const egg = eggSprite();
  const frame = egg?.frames[3];
  if (!egg || !frame) return null;
  const top = egg.anchors.head?.[1] ?? 22;
  const pixels = new Uint8Array(W * H).fill(TRANSPARENT);
  pixels.set(frame.subarray(0, top * W), 0);
  return { w: W, h: H, pixels };
}

export interface HatchedPoseOptions {
  /** 눈 스프라이트 이름. 기본은 뜬 눈 */
  eyes?: string;
  paint?: BodyPaint;
  dx?: number;
  dy?: number;
}

/** 껍데기에 앉은 알봉이(뚜껑 없이). 기본 모습·뜬 눈이면 egg-hatch 넷째 프레임의 아래쪽과 같다 */
export function hatchedPose(options: HatchedPoseOptions = {}): Composition | null {
  const form = characterRules.forms[0];
  const base = form ? getSprite(form.body) : null;
  if (!base) return null;
  const body = recolorBody(base, options.paint ?? PLAIN_PAINT);
  const layers: Layer[] = [{ sprite: body }];
  const eyes = getSprite(options.eyes ?? characterRules.eyes.default);
  if (eyes) layers.push({ sprite: eyes });
  return compose(layers, {
    w: W,
    h: H,
    body,
    bodyDx: options.dx ?? 0,
    bodyDy: options.dy ?? 0,
  });
}

/**
 * 필수 칸을 채운 수 → 금 단계. 하나라도 채우면 S1, 다 채우면 S4, 그 사이는 고르게 S1~S3.
 * (필수 7칸이면 1칸 S1 · 3칸 S2 · 5칸 S3 · 7칸 S4) 채운 수가 늘면 단계는 줄지 않는다.
 */
export function eggStageFor(filled: number, total: number): EggStage {
  const n = Math.max(1, Math.floor(total));
  const k = Math.max(0, Math.min(n, Math.floor(filled)));
  if (k === 0) return 0;
  if (k >= n) return EGG_STAGE_MAX;
  if (n <= 2) return 1;
  return clampStage(1 + Math.floor(((k - 1) * 3) / (n - 1)));
}
