/**
 * 알봉이 — 반쪽 껍데기에 폭 앉아 두 날개손을 테두리에 걸쳤다.
 *   껍데기: 속이 빈 그릇. 윗가장자리 톱니는 앞에서 2D 톱니와 같고 뒤는 앞을 거울처럼 잇는다.
 *   몸: 머리 + 껍데기 속을 채운 몸. 날개손은 테두리 위에 얹힌 작은 덩어리.
 */
import {
  blob,
  ellipsoid,
  smooth,
  mirrorX,
  fillSdf,
  rimFill,
  orMask,
  maskOf,
  decal,
  W,
  H,
  TR,
  type Grid,
  type Sdf,
} from '../kit.ts';
import { G, headSdf, fillBody, type Env } from '../parts.ts';

export function build(g: Grid, env: Env): void {
  const hy = env.headY;
  // 머리: 앞뒤 단면은 타원(q=2)이라 위에서 보면 원에 가깝고 정수리가 둥글다(비스듬히 볼 때 네모 식빵이 되지 않게)
  const head = headSdf(hy, { z: 0.4, rz: 9.4, q: 2, p: 2.2 });
  const shellOuter = blob(24, hy + 16.4, 0, 11.5, 6.0, 10.8, 2.5);
  const inside = blob(24, hy + 15.2, 0, 10.6, 5.6, 9.6, 2.4);
  const insideC: Sdf = (x, y, z) => Math.max(inside(x, y, z), shellOuter(x, y, z) + 0.9);
  const bodyBlob = smooth(2, head, insideC);
  const hand = ellipsoid(11.7, hy + 14.1, 1.4, 2.8, 2.2, 3.2);
  const pset = fillBody(g, env, {
    head,
    blob: bodyBlob,
    bbox: [10, hy, -12, 38, hy + 22, 12],
    arms: [
      {
        sdf: mirrorX(hand),
        nsdf: smooth(3, bodyBlob, mirrorX(hand)),
        bbox: [8, hy + 11, -3, 40, hy + 17, 6],
      },
    ],
  });
  for (const pi of pset) if (g.parts[pi]!.name !== 'beak') rimFill(g, pi, 1);

  // 껍데기: 열마다 윗가장자리(2D 에서 껍데기 칸이 처음 나오는 행)
  // 껍데기 가면: 흰 칸 + 톱니 외곽선(안쪽 선). 선 칸을 비워 두면 껍데기를 앞뒤로 꿰뚫는 틈이 되어 비스듬히 볼 때 검은 줄이 선다.
  // 그래서 껍데기에 넣고 앞면에만 검게 칠한다(앞모습은 2D 그대로, 뒤·옆은 흰 껍데기)
  const white = orMask(env.mPlumeL, env.mPlumeR, env.mBelowL, env.mBelowR);
  const edge = maskOf((i, j) => {
    const id = j * W + i;
    return (
      env.raw[id] === 0 &&
      !env.outer[id] &&
      !env.mBody[id] &&
      (white[id - 1] || white[id + 1] || white[id - W] || white[id + W])
    );
  });
  const mShell = orMask(white, edge);
  const rim = new Float32Array(W).fill(H);
  for (let i = 0; i < W; i++)
    for (let j = hy + 10; j < H; j++)
      if (mShell[j * W + i]) {
        rim[i] = j;
        break;
      }
  const rimAt = (x: number, z: number) => {
    const i = x < 0 ? 0 : x > 47 ? 47 : Math.floor(x);
    // 옆(가장자리 열)은 z 에 따라 톱니를 한 칸씩 넣는다(앞 톱니가 옆으로 늘어지지 않게)
    const side =
      Math.abs(z) < 5 && (x < 15 || x > 33) ? (Math.floor(Math.abs(z) / 2.5) % 2 ? 1 : 0) : 0;
    return rim[i]! + side;
  };
  // 그릇 속은 몸으로 채운다(2D 가면과 상관없이 벽 안쪽 전부): 톱니 틈으로 빈 그릇 안이 들여다보이지 않게.
  // 벽이 두 칸이라 앞에서는 벽에 가려 2D 그대로다
  const filling: Sdf = (x, y, z) =>
    Math.max(inside(x, y, z), shellOuter(x, y, z) + 1.9, hy + 13 - y);
  env.bodySet.add(
    fillSdf(g, {
      name: 'filling',
      group: G.body,
      sdf: filling,
      bbox: [11, hy + 12, -12, 37, hy + 23, 12],
      mask: orMask(mShell, env.mBody),
      color: env.base,
    }),
  );
  const shellInner = blob(24, hy + 15.6, 0, 9.5, 4.6, 8.8, 2.5);
  const cup: Sdf = (x, y, z) =>
    y < rimAt(x, z) ? 3 : Math.max(shellOuter(x, y, z), -shellInner(x, y, z));
  const pi = fillSdf(g, {
    name: 'shell',
    group: G.shell,
    sdf: cup,
    nsdf: shellOuter,
    bbox: [11, hy + 12, -12, 37, hy + 23, 12],
    mask: mShell,
    color: 12,
  });
  rimFill(g, pi, 2);
  const tex = new Uint8Array(W * H).fill(TR);
  for (let i = 0; i < W * H; i++) if (edge[i]) tex[i] = 0;
  decal(g, new Set([pi]), tex);
}
