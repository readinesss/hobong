/**
 * 깃봉이 — 한쪽 날개를 번쩍 들어 흔드는 비대칭 자세. 흰 솜깃 날개, 붉은 두 갈래 볏.
 *   오른날개손은 어깨에서 위·바깥·살짝 뒤로 뻗는다: 옆에서 보면 눈보다 뒤, 머리 옆 높이에 팔과 솜뭉치가 올라가 있다.
 *   왼날개손은 내리고 솜뭉치는 팔 바깥 뒤쪽에 붙는다.
 */
import type { Grid } from '../kit.ts';
import { G, type Env } from '../parts.ts';
import { birdBody, crest, puff, tailNub, legs, ellipsoid } from './bird-base.ts';

export function build(g: Grid, env: Env): void {
  const hy = env.headY; // 16
  birdBody(g, env, {
    torso: [hy + 17.0, 12.0, 6.3, 9.4, 2.6],
    bottom: hy + 22.9,
    chest: [hy + 16, 4.4, 7.6, 4.6, 5.2],
    rump: [hy + 18, -7.0, 7.4, 4.4, 4.8],
    arms: [
      [12.4, hy + 14.6, 0.0, 9.4, hy + 20.3, -0.6, 2.4, 2.3], // 내린 왼날개손
      [34.4, hy + 15.8, 0.0, 38.3, hy + 8.0, -7.0, 2.7, 2.3, { group: G.body, under: true }], // 번쩍 든 오른날개손: 어깨에서 위·바깥으로(뒤로 눕히지 않는다)
    ],
  });
  crest(g, env);
  // 내린 날개: 몸 옆에 붙은 둥근 솜깃. 뒤로 조금 길고 뒤쪽이 처져 옆에서 보면 옆구리의 접은 날개
  puff(g, env, {
    name: 'wingL',
    mask: env.mPlumeL,
    group: G.wingL,
    center: [6.2, hy + 16.6, -2.4],
    r: [5.6, 5.3, 5.0],
    lean: 0.25,
  });
  // 든 날개: 손끝 바깥에 선 둥근 솜깃. 팔과 같은 깊이라 60°까지 돌려도 머리 옆으로 보이고, 옆에서는 어깨 위 머리 옆에 세운 흰 날개로 보인다
  // (더 앞으로 내밀면 75°에서도 보이지만 반대쪽 옆모습에서 눈을 가린다)
  puff(g, env, {
    name: 'wingR',
    mask: env.mPlumeR,
    group: G.wingR,
    center: [42.2, hy + 10.6, -9.2],
    r: [4.8, 5.6, 2.8],
    lean: -0.12,
  });
  // 흰 솜 꽁지
  tailNub(g, env, {
    sdf: ellipsoid(24, hy + 19.4, -10.6, 3.0, 2.2, 2.6),
    bbox: [20, hy + 16, -14, 28, hy + 23, -7],
    color: env.plume(12),
  });
  legs(g, env);
}
