/**
 * 겉 복셀 바이트(kit.ts finish) → 삼각형 메시(Float32Array). 순수 함수.
 * 정점 속성: 위치(3) · 법선(3) · [색, 묶음, 표시(F_SKIN·F_LIT)](3)
 */
import { STRIDE } from './kit.ts';

type Quad = readonly (readonly [number, number, number])[];
const FACES: readonly (readonly [number, number, number, Quad])[] = [
  [
    1,
    0,
    0,
    [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  ],
  [
    -1,
    0,
    0,
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  ],
  [
    0,
    1,
    0,
    [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  [
    0,
    -1,
    0,
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  ],
  [
    0,
    0,
    1,
    [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  ],
  [
    0,
    0,
    -1,
    [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  ],
];
const ORDER = [0, 1, 2, 0, 2, 3];

export interface VoxelMesh {
  pos: Float32Array;
  nrm: Float32Array;
  cg: Float32Array;
  /** 정점 수 */
  count: number;
  faces: number;
  voxels: number;
}

export function buildMesh(bytes: Uint8Array, zoff = 24): VoxelMesh {
  const n = bytes.length / STRIDE;
  let faces = 0;
  for (let v = 0; v < n; v++) {
    let m = bytes[v * STRIDE + 8];
    while (m) {
      faces += m & 1;
      m >>= 1;
    }
  }
  const pos = new Float32Array(faces * 18),
    nrm = new Float32Array(faces * 18),
    cg = new Float32Array(faces * 18);
  let o = 0;
  for (let v = 0; v < n; v++) {
    const b = v * STRIDE;
    const x = bytes[b]!,
      y = bytes[b + 1]!,
      z = bytes[b + 2]! - zoff,
      c = bytes[b + 3]!,
      g = bytes[b + 4]!;
    const nx = (bytes[b + 5]! - 128) / 127,
      ny = (bytes[b + 6]! - 128) / 127,
      nz = (bytes[b + 7]! - 128) / 127;
    const mask = bytes[b + 8]!,
      fl = bytes[b + 9]!;
    for (let f = 0; f < 6; f++) {
      if (!(mask & (1 << f))) continue;
      const F = FACES[f]!,
        q = F[3];
      // 얇은 판의 뒷면은 법선을 뒤집어 양면 명암
      let sx = nx,
        sy = ny,
        sz = nz;
      if (sx * F[0] + sy * F[1] + sz * F[2] < -0.2) {
        sx = -sx;
        sy = -sy;
        sz = -sz;
      }
      for (let t = 0; t < 6; t++) {
        const p = q[ORDER[t]!]!;
        pos[o] = x + p[0];
        pos[o + 1] = y + p[1];
        pos[o + 2] = z + p[2];
        nrm[o] = sx;
        nrm[o + 1] = sy;
        nrm[o + 2] = sz;
        cg[o] = c;
        cg[o + 1] = g;
        cg[o + 2] = fl;
        o += 3;
      }
    }
  }
  return { pos, nrm, cg, count: o / 3, faces, voxels: n };
}
