/**
 * 날봉이 — 가슴을 쭉 펴고 파란 날개를 양옆 위로 활짝 편 당당한 자세(대칭). 긴 다리, 흰 가슴털, 세 갈래 볏.
 */
import type { Grid } from '../kit.ts';
import { G, type Env } from '../parts.ts';
import { birdBody, crest, wing, tailNub, legs, ellipsoid, union, capsule } from './bird-base.ts';

export function* build(g: Grid, env: Env): Generator<void, void, void> {
  const hy = env.headY; // 13
  birdBody(g, env, {
    torso: [hy + 18.6, 11.4, 6.6, 9.2, 2.8],
    bottom: hy + 24.9,
    chest: [hy + 17.4, 5.2, 8.2, 5.2, 5.6],
    rump: [hy + 20, -7.0, 7.4, 4.4, 4.8],
    arms: [
      [12.3, hy + 16.2, 0.6, 9.9, hy + 21.8, 1.8, 2.4, 2.3],
      [35.7, hy + 16.2, 0.6, 38.1, hy + 21.8, 1.8, 2.4, 2.3],
    ],
  });
  yield;
  crest(g, env);
  wing(g, env, {
    name: 'wingL',
    mask: env.mPlumeL,
    group: G.wingL,
    root: [12.5, hy + 14, 0.4],
    sweep: 0.3,
    curve: 0.022,
  });
  wing(g, env, {
    name: 'wingR',
    mask: env.mPlumeR,
    group: G.wingR,
    root: [35.5, hy + 14, 0.4],
    sweep: 0.3,
    curve: 0.022,
  });
  yield;
  // 짧은 파란 꽁지깃(뒤·옆에서만 보인다)
  tailNub(g, env, {
    sdf: union(
      capsule(24, hy + 20.4, -8.6, 24, hy + 22.2, -13.2, 2.6, 1.3),
      ellipsoid(24, hy + 21.6, -11.6, 4.2, 1.2, 2.6),
    ),
    bbox: [19, hy + 17, -15, 29, hy + 25, -7],
    color: (_x, _y, z) => (z < -11.5 ? env.plume(10) : env.plume(9)),
  });
  legs(g, env);
}
