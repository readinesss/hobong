/**
 * 복셀 호봉이 생성기: from-look.ts 가 만든 입력(꾸민 2D 몸통 + 눈 + 소품 그림 + 앵커) → 겉 복셀 바이트.
 *
 *   generate(input)        한 번에 끝까지(조합 하나 수 ms~수십 ms)
 *   generateSteps(input)   단계마다 양보하는 생성기(몸 덩어리마다 → 소품마다 → 겉 복셀 → 얼굴). 느린 기기에서 프레임 사이에 나눠 돌린다
 *
 * 결과 { bytes(복셀당 STRIDE=10바이트, kit.ts finish), surface, faces, solid, meta }  meta.face = 얼굴 도장(face.ts)
 */
import {
  createGrid,
  finish,
  despeckle,
  maskOf,
  W,
  TR,
  ZOFF,
  D,
  STRIDE,
  F_SKIN,
  RAMP,
  type Grid,
  type Sdf,
  type Surface,
} from './kit.ts';
import { buildFace, faceFront, type Face, type FaceLayer } from './face.ts';
import { bodyEnv, isFaceDecal, foreheadStripes, type Env } from './parts.ts';
import { addItem, shapeOf, SHAPES } from './props.ts';
import type { VoxelInput } from './input.ts';
// 이름 붙여 가져온다(import * as 는 묶음에 모듈 객체 도우미를 넣어, 빌드가 지우는 vite 모듈 로더 자리가 어긋난다)
import { build as egg } from './forms/egg.ts';
import { build as chick } from './forms/chick.ts';
import { build as fledgling } from './forms/fledgling.ts';
import { build as bird } from './forms/bird.ts';
import { build as phoenix } from './forms/phoenix.ts';

export { RAMP };

/** 형태 조형: 큰 덩어리(몸 → 날개·꼬리 → 다리)마다 양보한다(느린 기기에서 한 단계가 길어지지 않게) */
export type FormBuild = (g: Grid, env: Env) => Generator<void, void, void>;
export const FORMS: Readonly<Record<string, { build: FormBuild }>> = {
  egg: { build: egg },
  chick: { build: chick },
  fledgling: { build: fledgling },
  bird: { build: bird },
  phoenix: { build: phoenix },
};

export interface VoxelMeta {
  form: string;
  float: boolean;
  zoff: number;
  depth: number;
  /**
   * 그림자 자리(발밑 줄 + 0.5. 떠 있으면 2D 그림자 shadow-float 세 줄의 가운데)·반지름·내려다볼 때 더 내려가는 칸·
   * 그만큼 몸을 띄우는 칸·납작함(정면·상한)
   */
  groundY: number;
  shadowR: number;
  shadowDrop: number;
  shadowRise: number;
  shadowFlat0: number;
  shadowFlat: number;
  face: Face;
  /** 몸 바탕·그늘 색(렌더러의 부드러운 선) */
  base: number;
  shade: number;
  parts: { name: string; count: number }[];
}
export interface VoxelResult extends Surface {
  meta: VoxelMeta;
}
/** generateSteps 가 양보할 때 내는 단계 이름(몸은 형태마다 두세 번, 소품은 하나마다 한 번) */
export type VoxelStep = 'env' | 'body' | 'items' | 'surface';

export function* generateSteps(input: VoxelInput): Generator<VoxelStep, VoxelResult, void> {
  const g = createGrid();
  const env = bodyEnv(input);
  const items = input.items.filter((it) => !isFaceDecal(it)).sort((a, b) => a.layer - b.layer);
  // 모자·관이 덮는 칸: 그 아래의 볏·솜털은 만들지 않는다
  const hats = items.filter((it) => shapeOf(it).sit);
  env.hideHead = hats.length ? maskOf((i, j) => hats.some((it) => it.px[j * W + i] !== TR)) : null;
  yield 'env';
  const body = (FORMS[input.form]?.build ?? egg)(g, env);
  while (!body.next().done) yield 'body';
  yield 'body';
  for (const it of items) {
    addItem(g, env, it);
    yield 'items';
  }
  despeckle(g);
  const surf = finish(g);
  yield 'surface';
  // 얼굴 도장: 몸의 볼 칸 → 이마 줄무늬 → 눈 → 눈 앵커 소품(볼 터치·안경·선글라스)을 층 순서로
  const { reg, R, px } = env;
  const cheek = new Uint8Array(W * 48).fill(TR);
  for (let i = 0; i < W * 48; i++) if (reg[i] === R.CHEEK) cheek[i] = px[i]!;
  const layers: FaceLayer[] = [
    { px: cheek, kind: 'paint', layer: 0 },
    { px: foreheadStripes(env), kind: 'eye', layer: 1 },
    { px: input.eyes, kind: 'eye', layer: 10 },
  ];
  for (const it of input.items)
    if (isFaceDecal(it))
      layers.push({ px: it.px, kind: 'paint', layer: it.layer, temple: SHAPES[it.name]?.temple });
  layers.sort((a, b) => a.layer - b.layer);
  const face = buildFace({
    eyes: env.eyes,
    layers,
    body: env.blob as Sdf,
    axisZ: env.headZ,
    back: { yTop: env.headY + 1, color: env.shade },
  });
  const meta: VoxelMeta = {
    form: input.form,
    float: input.float,
    zoff: ZOFF,
    depth: D,
    // 떠 있는 몸(봉황): 정면은 2D 그림자(shadow-float 10·12·10, 발밑 줄부터 세 줄)와 같은 줄·같은 폭.
    // 내려다볼수록 그림자는 shadowDrop(4) 칸 내리고 몸은 shadowRise(2) 칸 띄워, 뒤로 누운 꼬리 끝과 그림자 사이를 벌린다
    // — 그림자 아랫줄은 늘 무대(64칸)의 60째 줄 안이다
    groundY: input.anchors.ground[1] + (input.float ? 1.5 : 0.5),
    shadowR: input.float ? 6 : 10,
    shadowDrop: input.float ? 4 : 0,
    shadowRise: input.float ? 2 : 0,
    shadowFlat0: input.float ? 0.27 : 0.16,
    shadowFlat: input.float ? 0.27 : 9,
    face,
    base: env.base,
    shade: env.shade,
    parts: g.parts.map((p) => ({ name: p.name, count: p.count ?? 0 })),
  };
  return { ...surf, meta };
}

export function generate(input: VoxelInput): VoxelResult {
  const it = generateSteps(input);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

export interface FrontCheck {
  /** 앞모습 실루엣 일치(겹침 / 합집합) */
  iou: number;
  /** 겹친 칸 중 맨 앞 복셀 색이 2D 색과 같은 비율(명암 전, 외곽선 칸 제외) */
  same: number;
  only2d: number;
  only3d: number;
}

/**
 * 앞모습 점검(브라우저 없이): 복셀을 z 로 눌러 본 실루엣(+렌더러가 긋는 바깥 외곽선 1칸)과 2D 를 견준다.
 */
export function frontCheck(res: VoxelResult, ref: Uint8Array): FrontCheck {
  // sil: 복셀이 있는 칸, edge: 렌더러가 바깥 외곽선을 긋는 묶음(110 미만)의 복셀이 있는 칸
  const sil = new Uint8Array(W * 48),
    edge = new Uint8Array(W * 48),
    top = new Int16Array(W * 48).fill(-1),
    col = new Uint8Array(W * 48),
    skin = new Uint8Array(W * 48);
  const b = res.bytes;
  for (let n = 0; n < b.length; n += STRIDE) {
    const id = b[n + 1]! * W + b[n]!;
    sil[id] = 1;
    if ((b[n + 4]! & 127) < 110) edge[id] = 1;
    if (b[n + 2]! > top[id]!) {
      top[id] = b[n + 2]!;
      col[id] = b[n + 3]!;
      skin[id] = b[n + 9]! & F_SKIN;
    }
  }
  // 얼굴 도장은 정면에서 살갗 칸 위에 2D 그대로 찍힌다
  const fp = faceFront(res.meta.face);
  for (let id = 0; id < W * 48; id++) if (fp[id] !== TR && skin[id]) col[id] = fp[id]!;
  let both = 0,
    only2 = 0,
    only3 = 0,
    same = 0,
    cmp = 0;
  for (let j = 0; j < 48; j++)
    for (let i = 0; i < W; i++) {
      const id = j * W + i;
      const near =
        sil[id] ||
        (i > 0 && edge[id - 1]) ||
        (i < W - 1 && edge[id + 1]) ||
        (j > 0 && edge[id - W]) ||
        (j < 47 && edge[id + W]);
      const a = ref[id] !== TR;
      if (a && near) both++;
      else if (a) only2++;
      else if (near) only3++;
      if (a && sil[id]) {
        cmp++;
        if (col[id] === ref[id]) same++;
      }
    }
  return { iou: both / (both + only2 + only3), same: same / cmp, only2d: only2, only3d: only3 };
}
