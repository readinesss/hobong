/**
 * 얼굴 도장 — 눈·안경·선글라스·볼(볼 터치 포함)을 복셀에 칠하지 않고, 머리 표면의 한 점에 붙인 '도장'으로 둔다.
 * 렌더러가 그 점을 화면에 옮겨 2D 도트를 화면 칸에 그대로 찍는다(살갗 복셀 위에만).
 *   · 어느 각도에서도 눈은 2×3 점(먼 쪽은 1×3)으로 남고, 안경과 눈의 상대 위치는 2D 와 늘 같다.
 *   · 정면에서는 2D 와 같은 칸에 찍힌다. 고개를 돌리면 가까운 쪽 눈이 옆얼굴 쪽으로 미끄러져(방위 φ0 → φSide)
 *     옆모습에서도 얼굴 앞쪽 3~4칸 안에 점 눈이 보인다.
 *
 * 도장은 눈마다 하나(왼·오른). 타일(16×16, 가운데 (8,8)이 눈 중심)은 세 벌:
 *   full    2D 그대로             narrow  가로를 반으로 줄인 것(가장자리로 돌아간 먼 쪽 눈)
 *   side    full + 안경다리(옆얼굴에서만 보이는 2~3칸)
 * 순수 함수.
 */
import { W, H, TR, type Sdf } from './kit.ts';
import type { Point } from './input.ts';

export const TILE = 16;
const HALF = 8;
const PATH_STEPS = 9;
/** 옆얼굴에서 눈이 놓이는 방위(도) */
export const SIDE_AZIMUTH = 52;

/** 얼굴 도장의 층(아래 층부터). temple: 옆얼굴에서 보이는 안경다리 색 */
export interface FaceLayer {
  px: Uint8Array;
  kind: 'eye' | 'paint';
  layer: number;
  temple?: number | undefined;
}

export interface FaceStamp {
  /** −1 왼눈 · 1 오른눈 · 0 뒤통수 줄무늬 */
  side: number;
  back?: boolean;
  cx: number;
  cy: number;
  row0: number;
  full: Uint8Array;
  narrow: Uint8Array;
  sideTile: Uint8Array;
  /** 미끄러지는 길: 칸마다 [x,y,z,nx,ny,nz] */
  path: Float32Array;
  steps: number;
}

export interface Face {
  tile: number;
  stamps: FaceStamp[];
}

/**
 * layers: 아래 층부터. body: 몸 SDF, axisZ: 머리 축의 z, back: 뒤통수 줄무늬(윗줄·색)
 */
export function buildFace({
  eyes,
  layers,
  body,
  axisZ = 0.5,
  back = null,
}: {
  eyes: Point;
  layers: readonly FaceLayer[];
  body: Sdf;
  axisZ?: number;
  back?: { yTop: number; color: number } | null;
}): Face {
  const [ex, ey] = eyes;
  const stamps: FaceStamp[] = [];
  const hasLens = layers.some((L) => L.temple !== undefined);
  for (const side of [-1, 1]) {
    const cx = ex + 4 * side; // 눈 중심(칸 경계): 눈은 cx−1, cx 두 열
    const inSide = (x: number) => (side < 0 ? x < ex : x >= ex);
    const src = (L: FaceLayer, c: number, r: number) => {
      const x = cx - HALF + c,
        y = ey - 7 + r;
      return x < 0 || y < 0 || x >= W || y >= H || !inSide(x) ? TR : L.px[y * W + x]!;
    };
    const full = new Uint8Array(TILE * TILE).fill(TR),
      narrow = new Uint8Array(TILE * TILE).fill(TR),
      sideT = new Uint8Array(TILE * TILE).fill(TR);
    let any = false;
    for (const L of layers) {
      for (let r = 0; r < TILE; r++) {
        for (let c = 0; c < TILE; c++) {
          const v = src(L, c, r);
          if (v !== TR) {
            full[r * TILE + c] = v;
            any = true;
          }
        }
      }
      for (let r = 0; r < TILE; r++) {
        if (hasLens) {
          // 안경·선글라스를 쓴 얼굴: 눈 바로 옆의 빈 열 하나씩만 뺀다 — 8칸 알이 6칸 알이 되고 2×3 눈이 그 한가운데에 남는다
          // (반으로 줄이면 '테·눈·테'가 세로 막대 셋으로 붙어 읽히지 않는다)
          for (let n = 0; n < TILE; n++) {
            const c = n <= HALF - 2 ? n - 1 : n >= HALF + 1 ? n + 1 : n;
            const v = c >= 0 && c < TILE ? src(L, c, r) : TR;
            if (v !== TR) narrow[r * TILE + n] = v;
          }
          continue;
        }
        // 가로 반으로: 가운데 두 열(눈)이 한 칸이 되게 두 열씩 묶는다(…|cx−1,cx|…)
        for (let u = -HALF; u < HALF; u++) {
          const c0 = HALF + 2 * u - 1;
          const a = c0 >= 0 && c0 < TILE ? src(L, c0, r) : TR,
            b = c0 + 1 >= 0 && c0 + 1 < TILE ? src(L, c0 + 1, r) : TR;
          const v = a === 0 || b === 0 ? 0 : a !== TR ? a : b;
          if (v !== TR) narrow[r * TILE + u + HALF] = v;
        }
      }
    }
    sideT.set(full);
    // 안경다리: 테 바깥 가장자리에서 귀 쪽으로 3칸, 눈 윗줄보다 한 줄 위(옆모습에서 눈을 가로지르지 않는다)
    for (const L of layers) {
      if (L.temple === undefined) continue;
      const r = 5; // y = ey − 2
      let edge = -1;
      for (let c = 0; c < TILE; c++)
        if (src(L, c, r) !== TR || src(L, c, r + 1) !== TR) {
          edge = c;
          if (side < 0) break;
        }
      if (edge < 0) continue;
      for (let n = 1; n <= 3; n++) {
        const c = edge + side * n;
        if (c >= 0 && c < TILE && sideT[r * TILE + c] === TR) sideT[r * TILE + c] = L.temple;
      }
    }
    if (!any) continue;
    // 눈 자리가 미끄러지는 길: 방위 φ0(정면에서 2D 눈 자리) → φSide, 높이는 눈 가운데 줄
    const y = ey + 0.5;
    let z0 = 16;
    for (; z0 > -16; z0 -= 0.125) if (body(cx, y, z0) <= 0) break;
    const phi0 = Math.atan2(4, z0 - axisZ),
      phi1 = Math.max(phi0, (SIDE_AZIMUTH * Math.PI) / 180);
    const path = new Float32Array(PATH_STEPS * 6);
    for (let n = 0; n < PATH_STEPS; n++) {
      const phi = phi0 + ((phi1 - phi0) * n) / (PATH_STEPS - 1);
      const dx = side * Math.sin(phi),
        dz = Math.cos(phi);
      let r = 3;
      for (; r < 20; r += 0.125) if (body(24 + dx * r, y, axisZ + dz * r) > 0) break;
      const px = n === 0 ? cx : 24 + dx * r,
        pz = n === 0 ? z0 : axisZ + dz * r;
      const e = 0.6;
      const nx = body(px + e, y, pz) - body(px - e, y, pz),
        nz = body(px, y, pz + e) - body(px, y, pz - e);
      // 눈은 얼굴 옆으로 도는 것만 본다(위아래 기울기는 뺀다): 내려다봐도 눈이 가늘어지지 않게
      const ny = 0;
      const l = Math.hypot(nx, ny, nz) || 1;
      path.set([px, y, pz, nx / l, ny / l, nz / l], n * 6);
    }
    stamps.push({
      side,
      cx,
      cy: ey + 0.5,
      row0: ey - 7,
      full,
      narrow,
      sideTile: sideT,
      path,
      steps: PATH_STEPS,
    });
  }
  // 뒤통수 줄무늬 세 줄: 줄마다 도장 하나(뒤통수 표면의 방위 180°·180°±29° 자리). 돌려도 늘 2칸 굵기의 온전한 세로 줄이고,
  // 가장자리로 돌아가면 1칸으로 가늘어졌다가 사라진다(복셀에 칠하면 비스듬히 볼 때 끊긴 사선 자국이 된다)
  if (back) {
    const { yTop, color } = back;
    for (const k of [-1, 0, 1]) {
      const full = new Uint8Array(TILE * TILE).fill(TR),
        narrow = new Uint8Array(TILE * TILE).fill(TR);
      // 가운데 줄: 6행(yTop+2 ~ +7), 바깥 줄: 5행(yTop+3 ~ +7, 맨 아랫줄은 한 칸). 타일 행 7 = yTop+5
      for (let row = k === 0 ? 2 : 3; row <= 7; row++) {
        const r = row + 2;
        const one = k !== 0 && row === 7;
        if (!one) full[r * TILE + HALF - 1] = color;
        full[r * TILE + HALF] = color;
        narrow[r * TILE + HALF] = color;
      }
      const y = yTop + 5.5,
        phi = Math.PI + k * 0.5;
      const dx = Math.sin(phi),
        dz = Math.cos(phi);
      let r = 3;
      for (; r < 20; r += 0.125) if (body(24 + dx * r, y, axisZ + dz * r) > 0) break;
      const px = 24 + dx * r,
        pz = axisZ + dz * r,
        e = 0.6;
      const nx = body(px + e, y, pz) - body(px - e, y, pz),
        nz = body(px, y, pz + e) - body(px, y, pz - e),
        l = Math.hypot(nx, nz) || 1;
      const path = new Float32Array(12);
      path.set([px, y, pz, nx / l, 0, nz / l], 0);
      path.set([px, y, pz, nx / l, 0, nz / l], 6);
      stamps.push({
        side: 0,
        back: true,
        cx: Math.round(px),
        cy: y,
        row0: yTop - 2,
        full,
        narrow,
        sideTile: full,
        path,
        steps: 2,
      });
    }
  }
  return { tile: TILE, stamps };
}

/** 정면(수평)에서 도장이 찍히는 2D 그림(48×48, TR=없음) — 브라우저 없는 앞모습 점검용 */
export function faceFront(face: Face | null | undefined): Uint8Array {
  const px = new Uint8Array(W * H).fill(TR);
  for (const s of face?.stamps ?? []) {
    if (s.back) continue;
    for (let r = 0; r < TILE; r++)
      for (let c = 0; c < TILE; c++) {
        const v = s.full[r * TILE + c]!;
        if (v === TR) continue;
        const x = s.cx - HALF + c,
          y = s.row0 + r;
        if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = v;
      }
  }
  return px;
}

/** 회전 행렬(복셀 → 화면, 행 우선 3×3) */
export type Mat3 = readonly (readonly [number, number, number])[];
export interface StampView {
  /** 프레임버퍼 한 변 */
  n: number;
  pivotY: number;
  /** 깊이 범위 */
  zr: number;
  /** cos(pitch) */
  cp: number;
  lift?: number;
}
export interface StampPlace {
  /** 타일 왼쪽 위가 놓일 프레임버퍼 칸(위가 0) */
  ox: number;
  oy: number;
  depth: number;
  /** 0 full · 1 narrow · 2 side */
  tile: number;
  nv: number;
}

/**
 * 한 프레임의 도장 자리. R 은 렌더러의 회전 행렬, yaw 는 도. 안 보이는 도장은 null.
 */
export function placeStamps(
  face: Face | null | undefined,
  R: Mat3,
  yawDeg: number,
  view: StampView,
): (StampPlace | null)[] {
  const out: (StampPlace | null)[] = [];
  if (!face) return out;
  const [r0, r1, r2] = R as [Mat3[number], Mat3[number], Mat3[number]];
  const sy = Math.sin((yawDeg * Math.PI) / 180);
  for (const s of face.stamps) {
    const near = Math.max(0, -s.side * sy);
    const t = near * near * (s.steps - 1);
    const n0 = Math.min(s.steps - 2, Math.floor(t)),
      f = t - n0;
    const v: number[] = [];
    for (let q = 0; q < 6; q++)
      v.push(s.path[n0 * 6 + q]! * (1 - f) + s.path[(n0 + 1) * 6 + q]! * f);
    const px = v[0]! - 24,
      py = v[1]! - view.pivotY,
      pz = v[2]!;
    const vx = r0[0] * px + r0[1] * py + r0[2] * pz;
    const vy = r1[0] * px + r1[1] * py + r1[2] * pz;
    const vz = r2[0] * px + r2[1] * py + r2[2] * pz;
    const nv = r2[0] * v[3]! + r2[1] * v[4]! + r2[2] * v[5]!;
    if (nv < FACING.narrow) {
      out.push(null);
      continue;
    }
    const ax = view.n / 2 + vx,
      ay = view.n / 2 - vy / view.cp - (view.lift ?? 0);
    const tile = nv < (s.back ? FACING.backFull : FACING.full) ? 1 : near * near > 0.4 ? 2 : 0;
    // 정면에서 ax = cx + 여백(정수), ay = (눈 가운데 줄 + 0.5) + 여백
    out.push({
      ox: Math.round(ax) - HALF,
      oy: Math.round(ay - 0.5) - 7,
      depth: view.zr - vz,
      tile,
      nv,
    });
  }
  return out;
}
/** 도장이 보이는 한계(표면 법선·시선의 내적): full 이상은 2D 그대로, narrow 이상은 반 폭, 그 아래는 숨김 */
export const FACING = { full: 0.64, narrow: 0.3, backFull: 0.5 };
/** 도장 수의 상한(눈 둘 + 뒤통수 줄무늬 셋) — 렌더러의 유니폼 배열 길이 */
export const MAX_STAMPS = 5;
