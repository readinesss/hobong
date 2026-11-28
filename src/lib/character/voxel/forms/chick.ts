/**
 * 솜봉이 — 두 발로 꼿꼿이 선 찹쌀떡. 머리와 몸이 한 덩어리, 바닥은 납작하고 다리는 가늘다.
 *   옆구리의 작은 날개손, 정수리 솜털 한 가닥(두 잎), 뒤에는 작은 꽁지.
 */
import { ellipsoid, smooth, mirrorX, cutBelow, rimFill, type Grid } from '../kit.ts';
import { G, headSdf, fillBody, regionPlate, legs, type Env } from '../parts.ts';

export function* build(g: Grid, env: Env): Generator<void, void, void> {
  const hy = env.headY;
  const head = headSdf(hy, { z: 0.3, rz: 9.6, ry: 9.2 });
  const belly = ellipsoid(24, hy + 14.6, 0, 13.6, 6.8, 10.8);
  const tail = ellipsoid(24, hy + 16.6, -10.4, 2.8, 2.1, 2.4);
  const mochi = cutBelow(smooth(3, head, belly, tail), hy + 20.9);
  const hand = ellipsoid(10.9, hy + 16.4, 0.6, 1.9, 2.0, 2.6);
  const pset = fillBody(g, env, {
    head,
    blob: mochi,
    bbox: [8, hy, -14, 40, hy + 21, 12],
    arms: [
      {
        sdf: mirrorX(hand),
        nsdf: smooth(3, mochi, mirrorX(hand)),
        bbox: [8, hy + 13, -3, 40, hy + 20, 4],
      },
    ],
  });
  for (const pi of pset) if (g.parts[pi]!.name !== 'beak') rimFill(g, pi, 2);
  yield;
  // 솜털: 앞으로 살짝 굽은 두 잎
  regionPlate(g, env, {
    name: 'tuft',
    mask: env.mTuft,
    group: G.tuft,
    hide: env.hideHead,
    tMin: 2,
    tMax: 2.6,
    zc: (_x, y) => 0.4 + (hy - y) * 0.18,
  });
  legs(g, env);
}
