/**
 * 캐릭터를 캔버스에 그린다(브라우저 전용).
 * 합성은 compose()가 하고, 여기서는 48×48 결과를 정수 배율로만 확대해 옮긴다.
 */
import { compose, toRgba, type Layer } from './compose.ts';
import type { Look } from './look.ts';
import { characterRules } from './rules.ts';
import { getSprite } from './sprites.ts';

export interface PoseOptions {
  /** 애니메이션 박자(0부터 계속 증가). 정지 화면은 0 */
  tick?: number;
  /** 눈을 강제로 바꾼다(부화·진화 연출용) */
  eyes?: string;
  /** 몸 전체를 한 색(팔레트 인덱스)으로 칠한 실루엣 */
  silhouette?: number;
  /** 그림자·효과를 빼고 몸통과 소품만 */
  plain?: boolean;
  /** 그림자를 이 색(팔레트 인덱스)으로 칠한다. 어두운 바닥에서 그림자가 묻히지 않게(야근 모드) */
  shadowInk?: number;
}

const { w: W, h: H } = characterRules.canvas;
/** 그림자 스프라이트의 색(팔레트 f) */
const SHADOW_COLOR = 15;

/** 48×48 팔레트 인덱스 그림을 만든다 */
export function poseOf(look: Look, options: PoseOptions = {}) {
  const tick = options.tick ?? 0;
  const body = getSprite(look.form.body);
  if (!body) return null;
  // 박자: 4틱(약 1초)마다 한 번 숨쉬듯 1px 내려앉고, 20틱마다 한 번 깜빡인다.
  const bob = tick % 4 >= 2 ? 1 : 0;
  const blink = look.canBlink && tick % 20 === 19;
  const fxFrame = Math.floor(tick / 2);

  const layers: Layer[] = [{ sprite: body }];
  const eyes = getSprite(options.eyes ?? (blink ? characterRules.eyes.blink : look.eyes));
  if (eyes) layers.push({ sprite: eyes });
  const shadow = look.form.shadow ?? characterRules.shadow;
  for (const part of look.parts) {
    const sprite = getSprite(part.sprite);
    if (!sprite) continue;
    const isShadow = part.sprite === shadow;
    if (options.plain && (part.animated || isShadow)) continue;
    const remap =
      isShadow && options.shadowInk !== undefined
        ? { ...part.remap, [SHADOW_COLOR]: options.shadowInk }
        : part.remap;
    layers.push({ sprite, remap, frame: part.animated ? fxFrame : 0 });
  }
  const comp = compose(layers, { w: W, h: H, body, bodyDy: bob });
  if (options.silhouette !== undefined) {
    for (let i = 0; i < comp.pixels.length; i += 1) {
      if (comp.pixels[i] !== 255) comp.pixels[i] = options.silhouette;
    }
  }
  return comp;
}

/** 스프라이트 하나(알 등)를 프레임 지정으로 그린다 */
export function poseOfSprite(name: string, frame = 0) {
  const sprite = getSprite(name);
  if (!sprite) return null;
  return compose([{ sprite, frame }], { w: W, h: H, body: sprite });
}

let scratch: HTMLCanvasElement | null = null;

/**
 * 합성 결과를 대상 캔버스에 scale배(정수)로 그린다. 보간을 꺼서 픽셀이 흐려지지 않는다.
 * dx, dy는 대상 캔버스의 픽셀 좌표.
 */
export function paintPose(
  ctx: CanvasRenderingContext2D,
  comp: { w: number; h: number; pixels: Uint8Array },
  dx: number,
  dy: number,
  scale: number,
): void {
  scratch ??= document.createElement('canvas');
  if (scratch.width !== comp.w || scratch.height !== comp.h) {
    scratch.width = comp.w;
    scratch.height = comp.h;
  }
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  const rgba = toRgba(comp, characterRules.palette);
  sctx.putImageData(
    new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, comp.w, comp.h),
    0,
    0,
  );
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, comp.w, comp.h, dx, dy, comp.w * scale, comp.h * scale);
}

export const SPRITE_SIZE = W;
