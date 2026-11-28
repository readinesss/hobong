/**
 * 깃봉이·날봉이·봉황이 함께 쓰는 새 몸: 큰 머리 + 통통한 몸통(가슴은 앞으로, 엉덩이는 뒤로) + 날개손.
 * 형태 파일은 숫자(위치·반지름)와 깃 판만 정한다.
 */
import {
  W,
  H,
  TR,
  F_LIT,
  blob,
  ellipsoid,
  smooth,
  cutBelow,
  capsule,
  union,
  rimFill,
  fillSdf,
  decal,
  type Grid,
  type Mask,
  type Sdf,
} from '../kit.ts';
import { G, headSdf, fillBody, regionPlate, legs, type ArmSpec, type Env } from '../parts.ts';

/** 어깨→손끝 캡슐 [x0,y0,z0, x1,y1,z1, r0, r1, 덧붙임] */
export type ArmTuple = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  { group?: number; under?: boolean }?,
];

export interface BirdSpec {
  head?: Parameters<typeof headSdf>[1];
  /** [cy, rx, ry, rz, p] */
  torso: readonly [number, number, number, number, number];
  /** 몸 아래 줄(납작한 바닥) */
  bottom: number;
  /** [cy, z, rx, ry, rz] */
  chest: readonly [number, number, number, number, number];
  rump: readonly [number, number, number, number, number];
  arms: readonly ArmTuple[];
}

export function birdBody(g: Grid, env: Env, o: BirdSpec): { head: Sdf; body: Sdf } {
  const hy = env.headY;
  const head = headSdf(hy, o.head);
  const [tcy, trx, try_, trz, tp] = o.torso;
  const torso = blob(24, tcy, -0.3, trx, try_, trz, tp);
  const chest = ellipsoid(24, o.chest[0], o.chest[1], o.chest[2], o.chest[3], o.chest[4]);
  const rump = ellipsoid(24, o.rump[0], o.rump[1], o.rump[2], o.rump[3], o.rump[4]);
  const body = cutBelow(smooth(1.8, head, torso, chest, rump), o.bottom);
  const arms: ArmSpec[] = o.arms.map((a) => {
    const r = Math.max(a[6], a[7]) + 0.5;
    const cap = capsule(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]);
    return {
      group: a[8]?.group,
      // 법선은 몸과 부드럽게 이은 도형에서 받는다: 그늘이 팔에서 따로 놀지 않고 몸의 초승달 하나로 이어진다
      sdf: cap,
      nsdf: smooth(3, body, cap),
      bbox: [
        Math.min(a[0], a[3]) - r,
        Math.min(a[1], a[4]) - r,
        Math.min(a[2], a[5]) - r,
        Math.max(a[0], a[3]) + r,
        Math.max(a[1], a[4]) + r,
        Math.max(a[2], a[5]) + r,
      ],
    };
  });
  // 든 팔(a[8].under): 팔 둘레의 선 대신 팔 아래쪽으로 맞닿은 몸에 그늘 한 줄을 굽는다(어느 각도에서도 팔 밑의 한 줄)
  const up = o.arms
    .filter((a) => a[8]?.under)
    .map((a) => ({ cap: capsule(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]), a }));
  const bodyColor: Sdf | null = up.length
    ? (x, y, z) => {
        for (const { cap, a } of up) {
          const dx = a[3] - a[0],
            dy = a[4] - a[1];
          const t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy);
          // 팔 축의 아래쪽(y 가 큰 쪽)에 붙은 칸만
          if (
            t > 0.12 &&
            t < 0.95 &&
            (dx * (y - a[1]) - dy * (x - a[0])) * (dx > 0 ? 1 : -1) > 0.6 * Math.hypot(dx, dy)
          ) {
            const d = cap(x, y, z);
            if (d > 0 && d <= 1.15) return env.shade;
          }
        }
        return env.base;
      }
    : null;
  const pset = fillBody(g, env, {
    head,
    blob: body,
    bbox: [6, hy, -14, 42, o.bottom + 1, 13],
    arms,
    bodyColor,
  });
  for (const pi of pset) if (g.parts[pi]!.name !== 'beak') rimFill(g, pi, 2);
  env.neck = true; // 머리와 몸통 사이에 띠(목걸이 끈·깃)를 두를 수 있다
  return { head, body };
}

/** 볏: 도톰한 판(앞모습 = 2D 볏). 모자·관이 덮는 칸은 뺀다 */
export function crest(
  g: Grid,
  env: Env,
  { tMin = 2.6, tMax = 4.6, frontOnly = null as readonly number[] | null } = {},
): number {
  return regionPlate(g, env, {
    name: 'crest',
    mask: env.mCrest,
    seam: env.seam(env.mCrest),
    group: G.crest,
    hide: env.hideHead,
    tMin,
    tMax,
    ramp: 1,
    zc: () => 0.4,
    frontOnly,
  });
}

/**
 * 날개(깃 판): 뿌리 root=[x,y,z] 에서 멀어질수록 뒤로 젖혀진다(sweep: 거리 1당, curve: 거리² 항).
 * 뿌리는 날개손과 같은 깊이라 팔에 붙어 있고, 끝은 뒤로 흘러 옆에서 봐도 판이 서지 않는다(세 칸 두께, 옆면은 깃 색).
 */
export function wing(
  g: Grid,
  env: Env,
  {
    name,
    mask,
    group,
    root,
    sweep = 0.38,
    curve = 0.01,
    tMin = 2.6,
    tMax = 3.6,
    seamTo = env.mBody,
  }: {
    name: string;
    mask: Mask;
    group: number;
    root: readonly [number, number, number];
    sweep?: number;
    curve?: number;
    tMin?: number;
    tMax?: number;
    seamTo?: Mask;
  },
): number {
  return regionPlate(g, env, {
    name,
    mask,
    seam: env.seam(mask, seamTo),
    group,
    tMin,
    tMax,
    lineBack: true,
    zc: (x, y) => {
      const d = Math.hypot(x - root[0], y - root[1]);
      return root[2] - sweep * d - curve * d * d;
    },
  });
}

/**
 * 솜뭉치 깃(깃봉이의 흰 솜깃 날개): 판이 아니라 둥근 덩어리. 앞면에만 2D 그림(깃 사이 선·그늘)을 칠하고 옆·뒤는 깃 색 한 가지.
 * 몸과 맞닿는 선은 복셀로 만들지 않는다(옆에서 검은 고리가 되지 않게; 앞모습의 선은 렌더러가 묶음 경계에 긋는다).
 */
export function puff(
  g: Grid,
  env: Env,
  {
    name,
    mask,
    group,
    center,
    r,
    lean = 0,
  }: {
    name: string;
    mask: Mask;
    group: number;
    center: readonly [number, number, number];
    r: readonly [number, number, number];
    lean?: number;
  },
): number {
  const main = env.mainColor(mask),
    line = env.input.colors.plume[13] ?? 13;
  const out = center[0] < 24 ? -1 : 1,
    top = center[1] - r[1];
  // lean: 위로 갈수록 앞으로(음수면 뒤로) 눕는다(칸당)
  const ell = ellipsoid(center[0], center[1], center[2], r[0], r[1], r[2]),
    zl = Math.abs(lean) * r[1];
  const zOf = (y: number, z: number) => z - lean * (y - center[1]);
  // 그늘은 굽는다: 아래 1/4 은 깃 그늘색(빛이 화면 위쪽에 붙어 있어 돌려도 맞다). 렌더러의 그늘 단은 끈다(F_LIT) — 뒤에서 솜깃 전체가 회색 덩어리가 되지 않게.
  // 바깥 옆면에는 깃 사이 골(회색 한 줄)을 한두 줄만
  const color: Sdf = (x, y, z) => {
    if (y > center[1] + r[1] * 0.42) return line;
    return (x - center[0]) * out > 1 &&
      zOf(y, z) < center[2] + r[2] - 1.2 &&
      Math.floor(y - top) % 5 === 3
      ? line
      : main;
  };
  const pi = fillSdf(g, {
    name,
    group,
    mask,
    color,
    flag: F_LIT,
    sdf: lean ? (x, y, z) => ell(x, y, zOf(y, z)) : ell,
    bbox: [
      center[0] - r[0] - 1,
      center[1] - r[1] - 1,
      center[2] - r[2] - 1 - zl,
      center[0] + r[0] + 1,
      center[1] + r[1] + 1,
      center[2] + r[2] + 1 + zl,
    ],
  });
  rimFill(g, pi, 3, 0.6);
  const tex = new Uint8Array(W * H).fill(TR);
  // 앞면에는 2D 의 그늘 칸만 칠한다. 가장자리의 먹색 홈은 칠하지 않는다(옆에서 검은 '−' 줄로 보인다)
  for (let i = 0; i < W * H; i++) if (mask[i] && env.raw[i] !== 0) tex[i] = env.px[i]!;
  decal(g, new Set([pi]), tex);
  return pi;
}

/** 꽁지(뒤에만 보이는 작은 깃 뭉치): 몸 실루엣 안에만 둔다 */
export function tailNub(
  g: Grid,
  env: Env,
  {
    sdf,
    bbox,
    color,
    flag = 0,
    mask = env.mBody,
    name = 'nub',
    group = G.nub,
    onlyEmpty = false,
  }: {
    sdf: Sdf;
    bbox: readonly number[];
    color: number | Sdf;
    flag?: number;
    mask?: Mask;
    name?: string;
    group?: number;
    onlyEmpty?: boolean;
  },
): number {
  return fillSdf(g, { name, group, sdf, bbox, mask, color, flag, onlyEmpty });
}
export { legs, union, ellipsoid, capsule, F_LIT };
