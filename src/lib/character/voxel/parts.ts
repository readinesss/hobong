/**
 * 다섯 형태가 함께 쓰는 조형: 2D 몸통을 영역 가면으로 나누기, 머리·얼굴(줄무늬·부리·눈·볼), 다리, 깃 판.
 * 숫자는 모두 2D 도트 좌표(kit.ts 머리말).
 */
import {
  W,
  H,
  TR,
  SOFT,
  ZOFF,
  F_SKIN,
  F_LIT,
  RAMP,
  blob,
  ellipsoid,
  union,
  maskOf,
  orMask,
  andNot,
  maskBox,
  outerOutline,
  lineRuns,
  edgeDist,
  fillSdf,
  fillPlate,
  decal,
  type Grid,
  type Mask,
  type Sdf,
  type SdfPart,
} from './kit.ts';
import type { BodyAnchors, Point, RegionCodes, VoxelInput, VoxelItem } from './input.ts';

const WH = W * H;

/** 외곽선 묶음 번호 */
export const G = {
  body: 1 | SOFT,
  arm: 2 | SOFT,
  beak: 1 | SOFT,
  feet: 3,
  crest: 5,
  shell: 6,
  tuft: 7 | SOFT,
  wingL: 10,
  wingR: 11,
  tailL: 12,
  tailR: 13,
  nub: 14,
  tail: 15 | SOFT,
};

/** 조형 중에 형태·부품이 함께 보는 값(bodyEnv 가 만들고, 몸을 채우며 몇 가지를 더 적는다) */
export interface Env {
  input: VoxelInput;
  /** 칠한 뒤 몸통 · 칠하기 전 몸통 · 영역 */
  px: Uint8Array;
  raw: Uint8Array;
  reg: Uint8Array;
  R: RegionCodes;
  /** 몸통 바깥 외곽선 */
  outer: Mask;
  anchors: BodyAnchors;
  headY: number;
  eyes: Point;
  base: number;
  shade: number;
  /** 영역 번호들의 가면 */
  is: (...codes: number[]) => Mask;
  /** 갇힌 선을 넣은 가면 */
  close: (m: Mask, run?: number) => Mask;
  side: (m: Mask, left: boolean) => Mask;
  mBody: Mask;
  mTuft: Mask;
  mCrest: Mask;
  mPlumeL: Mask;
  mPlumeR: Mask;
  mBelowL: Mask;
  mBelowR: Mask;
  mFeet: Mask;
  /** 이음매: 부품 m 과 이웃 가면 사이의 선 칸(검게 칠한 복셀로 두 부품을 잇는다) */
  seam: (m: Mask, other?: Mask, run?: number) => Mask;
  /** 그 칸의 칠한 뒤 색 */
  at: (i: number, j: number) => number;
  /** 가면 안에서 가장 많은 색(선 0 제외) */
  mainColor: (m: Mask) => number;
  /** 깃 색 꾸미기를 거친 색 */
  plume: (v: number) => number;
  /** 그늘색 표(RAMP) */
  ramp: readonly number[];
  /** 모자·관이 덮는 칸(그 아래의 볏·솜털은 만들지 않는다) */
  hideHead: Mask | null;
  /** 몸 부품 번호(fillBody 뒤) */
  bodySet: Set<number>;
  /** 머리+몸통 SDF(fillBody 뒤) */
  blob: Sdf | null;
  headZ?: number;
  zHead?: number;
  /** 머리와 몸통 사이에 띠(목걸이 끈·깃)를 두를 수 있는지 */
  neck: boolean;
}

/**
 * 2D 몸통(꾸미기 색을 칠한 뒤) → 조형에 쓰는 가면·색.
 * 영역은 저장소 regions.ts 의 regionsOf 결과를 그대로 받는다(몸·볏·깃·발·몸 아래·부리·볼·덧살).
 */
export function bodyEnv(input: VoxelInput): Env {
  const { body: px, bodyRaw: raw, regions: reg, REGION: R, anchors } = input;
  const outer = outerOutline(raw);
  const is = (...codes: number[]) => maskOf((i, j) => codes.includes(reg[j * W + i]!));
  const headY = anchors.head[1];
  // 갇힌 선(팔과 몸 사이 주름, 깃 사이 선)을 가면에 넣는다
  const close = (m: Mask, run = 2) => orMask(m, lineRuns(raw, outer, m, m, run));
  const bodyOnly = orMask(
    is(R.BODY, R.BEAK, R.CHEEK),
    maskOf((i, j) => reg[j * W + i] === R.SKIN && j >= headY),
  );
  const mBody = close(bodyOnly);
  const side = (m: Mask, left: boolean) =>
    maskOf((i, j) => m[j * W + i] && (left ? i < 24 : i >= 24));
  const plume = is(R.PLUME),
    below = is(R.BELOW);
  const plumeMap = input.colors.plume;
  const env: Env = {
    input,
    px,
    raw,
    reg,
    R,
    outer,
    anchors,
    headY,
    eyes: anchors.eyes,
    base: input.colors.base,
    shade: input.colors.shade,
    is,
    close,
    side,
    mBody,
    mTuft: close(maskOf((i, j) => reg[j * W + i] === R.SKIN && j < headY)),
    mCrest: close(is(R.CREST)),
    mPlumeL: close(side(plume, true)),
    mPlumeR: close(side(plume, false)),
    mBelowL: close(side(below, true)),
    mBelowR: close(side(below, false)),
    mFeet: is(R.FEET),
    seam: (m, other = mBody, run = 3) => lineRuns(raw, outer, m, other, run),
    at: (i, j) => px[j * W + i]!,
    mainColor(m) {
      const h = new Uint16Array(16);
      let best = 0,
        bn = -1;
      for (let i = 0; i < WH; i++) if (m[i] && px[i] !== TR && px[i] !== 0) h[px[i]!]!++;
      for (let c = 1; c < 16; c++)
        if (h[c]! > bn) {
          bn = h[c]!;
          best = c;
        }
      return best;
    },
    plume: (v) => plumeMap[v] ?? v,
    ramp: RAMP,
    hideHead: null,
    bodySet: new Set(),
    blob: null,
    neck: false,
  };
  return env;
}

/** 머리(다섯 형태가 같은 얼굴): 정수리 줄(head 앵커) 바로 아래부터 폭 20칸의 둥근 네모 */
export function headSdf(
  headY: number,
  { z = 0.8, rz = 9.6, ry = 9.4, p = 2.3, q = 2.3 } = {},
): Sdf {
  return blob(24, headY + 0.4 + ry, z, 10.7, ry, rz, p, q);
}

/**
 * 호랑이 줄무늬는 복셀에 칠하지 않는다. 이마의 세 줄(2D 그대로)과 뒤통수의 세 줄 모두 얼굴 도장(face.ts)이다:
 * 둥근 머리에 칠하면 비스듬히 볼 때 사선으로 끊겨 긁힌 자국이 되지만, 도장은 어느 각도에서도 2칸 굵기의 세로 줄로 남는다.
 */
/** 이마 줄무늬 칸(2D 그대로): 몸 영역의 그늘색 칸 중 머리 윗줄부터 4행 */
export function foreheadStripes(env: Env): Uint8Array {
  const { px, reg, R, shade, headY } = env;
  const out = new Uint8Array(WH).fill(TR);
  for (let j = headY + 1; j <= headY + 4; j++)
    for (let i = 0; i < W; i++) {
      const id = j * W + i;
      if (reg[id] === R.BODY && px[id] === shade) out[id] = shade;
    }
  return out;
}

/** sdf 가 열 (x,y) 에서 가장 앞으로 나오는 z */
export function sdfFront(sdf: Sdf, x: number, y: number, z0 = 16, z1 = -16): number {
  for (let z = z0; z >= z1; z -= 0.25) if (sdf(x, y, z) <= 0) return z;
  return 0;
}

/** 날개손 하나(fillBody o.arms) */
export interface ArmSpec {
  sdf: Sdf;
  nsdf?: Sdf;
  bbox: readonly number[];
  mask?: Mask;
  group?: number | undefined;
}
export interface BodySpec {
  /** 머리와 몸통을 이은 SDF */
  blob: Sdf;
  /** 머리 SDF(부리·줄무늬 자리 계산용) */
  head: Sdf;
  bbox: readonly number[];
  arms?: ArmSpec[];
  extra?: SdfPart[];
  /** (x,y,z)=>색 — 몸 위에 굽는 그늘. 없으면 바탕색 한 가지 */
  bodyColor?: Sdf | null;
}

/**
 * 몸(머리+몸통+팔) 채우기.
 * 눈·볼·안경은 복셀에 칠하지 않는다(face.ts 의 얼굴 도장). 몸 복셀에는 '살갗' 표시를, 얼굴 둘레에는 '그늘 금지' 표시를 둔다.
 * 2D 의 그늘 칸(팔 주름·아랫줄 그늘)도 칠하지 않는다: 주름은 렌더러의 부드러운 선이, 그늘은 빛이 맡는다(돌려도 그늘이 몸에 붙어 돌지 않게).
 * 반환: 몸 부품 번호 집합
 */
export function fillBody(g: Grid, env: Env, o: BodySpec): Set<number> {
  const { eyes, base, shade, mBody, px, raw, reg, R } = env;
  const [ex, ey] = eyes;
  const zHead = sdfFront(o.head, 24, ey + 0.5);
  const pset = new Set<number>();
  // 얼굴(눈·부리 둘레)은 그늘 금지: 고개를 돌려도 얼굴이 어두워지지 않는다
  const faceFlag: Sdf = (x, y, z) =>
    z > zHead - 7 && y > ey - 5 && y < ey + 7.5 && Math.abs(x - 24) < 10.5
      ? F_SKIN | F_LIT
      : F_SKIN;
  pset.add(
    fillSdf(g, {
      name: 'body',
      group: G.body,
      sdf: o.blob,
      bbox: o.bbox,
      mask: mBody,
      color: o.bodyColor ?? base,
      flag: faceFlag,
    }),
  );
  // a.group: 팔의 외곽선 묶음. 몸과 같은 묶음(G.body)이면 팔 둘레에 선이 서지 않는다(몸 위에 올라간 팔이 고리로 그려지지 않게)
  for (const a of o.arms ?? [])
    pset.add(
      fillSdf(g, {
        name: 'arm',
        group: a.group ?? G.arm,
        sdf: a.sdf,
        nsdf: a.nsdf,
        bbox: a.bbox,
        mask: a.mask ?? mBody,
        color: base,
      }),
    );
  for (const a of o.extra ?? []) pset.add(fillSdf(g, { ...a, mask: a.mask ?? mBody }));
  // 부리: 얼굴에서 1~2칸 튀어나온 쐐기(앞모습은 2D 부리 6칸). 그늘을 두지 않는다(옆에서 빨간 코가 되지 않게)
  const mBeak = env.is(R.BEAK);
  const by = ey + 3.5,
    zf = sdfFront(o.head, 24, by);
  const beakColor = px[(ey + 3) * W + ex - 1]!;
  pset.add(
    fillSdf(g, {
      name: 'beak',
      group: G.beak,
      ngroup: 9,
      mask: mBeak,
      color: beakColor,
      flag: F_LIT,
      sdf: union(
        ellipsoid(24, by - 0.1, zf + 0.3, 2.4, 0.95, 2.3),
        ellipsoid(24, by + 1.0, zf - 0.5, 1.3, 0.8, 1.5),
      ),
      bbox: [21, by - 1.5, zf - 3, 27, by + 2.5, zf + 3],
    }),
  );

  // 앞면 무늬: 가슴털 같은 다른 색 칸과 갇힌 선. 그늘색 칸(줄무늬는 얼굴 도장)·볼은 뺀다
  const tAlways = new Uint8Array(WH).fill(TR);
  for (let i = 0; i < WH; i++) {
    if (!mBody[i] || reg[i] === R.BEAK || reg[i] === R.CHEEK) continue;
    const v = px[i]!;
    if (raw[i] === 0) tAlways[i] = 0;
    else if (v !== base && v !== shade) tAlways[i] = v;
  }
  decal(g, pset, tAlways);
  env.bodySet = pset;
  env.blob = o.blob;
  env.headZ = 0.5;
  env.zHead = zHead;
  return pset;
}
/** 얼굴 도장으로 가는 소품(눈 앵커에 붙는 것: 볼 터치·안경·선글라스) */
export const isFaceDecal = (it: Pick<VoxelItem, 'attach'>): boolean => it.attach === 'eyes';

export interface RegionPlateSpec {
  name: string;
  /** 영역 가면(갇힌 선 포함) */
  mask: Mask;
  /** 이웃 부품과 잇는 선 칸(검은 복셀) */
  seam?: Mask | null;
  /** (x,y)=>판 중심 z */
  zc: (x: number, y: number) => number;
  /** 가장자리·가운데 두께 */
  tMin?: number;
  tMax?: number;
  ramp?: number;
  group: number;
  hide?: Mask | null;
  flag?: number;
  frontOnly?: readonly number[] | null;
  thAt?: ((x: number, y: number) => number) | null;
  backMap?: Readonly<Record<number, number>> | null;
  lineBack?: boolean;
  backAt?: ((i: number, j: number, c: number) => number) | null;
}

/**
 * 2D 영역을 판으로 세운다(날개·볏·꼬리·솜털). 깃 사이 선(0)은 골이 되고 깃 가운데는 도톰하다.
 */
export function regionPlate(
  g: Grid,
  env: Env,
  {
    name,
    mask,
    seam = null,
    zc,
    tMin = 1.8,
    tMax = 3.4,
    ramp = 2,
    group,
    hide = null,
    flag = 0,
    frontOnly = null,
    thAt = null,
    backMap = null,
    lineBack = false,
    backAt = null,
  }: RegionPlateSpec,
): number {
  let m = seam ? orMask(mask, seam) : mask;
  if (hide) m = andNot(m, hide);
  if (!maskBox(m)) return -1;
  const { px, raw } = env;
  // 두께: 선이 아닌 칸에서 잰 가장자리 거리
  const ed = edgeDist(
    maskOf((i, j) => m[j * W + i] && raw[j * W + i] !== 0),
    ramp + 1,
  );
  const tex = new Uint8Array(WH).fill(TR);
  for (let i = 0; i < WH; i++) if (m[i]) tex[i] = raw[i] === 0 ? 0 : px[i]!;
  // 선 칸의 속(앞·뒤 한 칸 사이)은 깃 색: 옆에서 본 두께 면이 검은 칼날이 되지 않는다
  const main = env.mainColor(mask);
  const core = new Uint8Array(WH).fill(TR);
  for (let i = 0; i < WH; i++)
    if (m[i] && (raw[i] === 0 || frontOnly?.includes(raw[i]!))) core[i] = main;
  // backMap {색: 색}: 맨 앞 한 칸 뒤로는 이 색으로 바꾼다(봉황 꼬리의 붉은 줄기가 뒤에서 다리처럼 보이지 않게 깃 색으로)
  let back: Uint8Array | null = null;
  if (backMap) {
    back = new Uint8Array(WH).fill(TR);
    for (let i = 0; i < WH; i++) {
      const to = backMap[tex[i]!];
      if (m[i] && to !== undefined) back[i] = to;
    }
  }
  // lineBack: 깃 사이 선(0)은 맨 앞 한 칸에만 둔다. 그 뒤(옆·뒤에서 보이는 면)는 이웃 깃 색의 그늘색 골로 —
  // 돌려 봤을 때 얇게 보이는 날개가 검은 철사 두 줄이 되지 않는다
  if (lineBack) {
    back ??= new Uint8Array(WH).fill(TR);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const id = j * W + i;
        if (!m[id] || tex[id] !== 0) continue;
        let c = main;
        for (const q of [id - 1, id + 1, id - W, id + W])
          if (m[q] && tex[q] !== 0 && tex[q] !== TR) {
            c = tex[q]!;
            break;
          }
        back[id] = env.ramp[c] === 0 ? c : env.ramp[c]!;
      }
  }
  // backAt(i,j): 맨 앞 한 칸 뒤의 색을 자리마다 정한다(뒤에서 본 깃 무늬를 앞 그림과 따로 그릴 때)
  if (backAt) {
    back ??= new Uint8Array(WH).fill(TR);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) if (m[j * W + i]) back[j * W + i] = backAt(i, j, tex[j * W + i]!);
  }
  return fillPlate(g, {
    name,
    group,
    mask: m,
    tex,
    core,
    back,
    flag,
    color: main,
    zc: (i, j) => zc(i + 0.5, j + 0.5),
    // thAt(x,y): 자리마다 다른 두께를 더한다(봉황 꼬리처럼 끝으로 갈수록 앞뒤로 넓어지는 깃)
    th: (i, j) => {
      const d = ed[j * W + i]!;
      return (
        (d <= 1 ? tMin : tMin + (tMax - tMin) * Math.min(1, (d - 1) / ramp)) +
        (thAt ? thAt(i + 0.5, j + 0.5) : 0)
      );
    },
  });
}

/** 다리: 2D 의 가는 다리(1칸)를 두 칸 깊이 기둥으로, 발은 앞으로 내민 발가락 */
export function legs(g: Grid, env: Env, { z = 0.6, toe = 4 } = {}): void {
  const { mFeet } = env;
  const b = maskBox(mFeet);
  if (!b) return;
  const m = orMask(mFeet, env.seam(mFeet, env.mBody, 2));
  const tex = new Uint8Array(WH).fill(TR);
  for (let i = 0; i < WH; i++) if (m[i]) tex[i] = env.raw[i] === 0 ? 0 : env.px[i]!;
  const footRow = b.y1;
  // 발은 그늘 금지(주황의 그늘색은 붉은색이라 발이 얼룩져 보인다)
  fillPlate(g, {
    name: 'legs',
    group: G.feet,
    mask: m,
    tex,
    color: 3,
    flag: F_LIT,
    zc: (_i, j) => (j === footRow ? z + (toe - 2) / 2 : z),
    th: (_i, j) => (j === footRow ? toe : 2),
  });
}

export { ZOFF };
