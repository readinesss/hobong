/**
 * 봉황 — 오색 부채 날개를 머리 양옆으로 펴고, 엉덩이 뒤에서 청·적 부채 꼬리를 편 채 그림자 위에 떠 있다.
 *   날개: 깃 세 장씩(파랑·하늘·초록)이 날개손에서 V 자로 솟아 뒤로 젖혀진다.
 *   꼬리: 엉덩이 뒤 한 점에서 깃 일곱 장이 아래·뒤로 퍼지는 부채 한 장(tail 참고). 뒤에서는 아래 변이 볼록한 호,
 *         옆에서는 엉덩이에서 뒤·아래로 흐르는 쐐기, 앞에서는 바깥 깃이 2D 의 좌우 꼬리 자리에 보인다.
 */
import {
  W,
  H,
  TR,
  orMask,
  andNot,
  maskOf,
  maskBox,
  fillPlate,
  fillSdf,
  type Grid,
  type Sdf,
} from '../kit.ts';
import { G, type Env } from '../parts.ts';
import { birdBody, wing, legs, F_LIT } from './bird-base.ts';

export function build(g: Grid, env: Env): void {
  const hy = env.headY; // 12
  birdBody(g, env, {
    torso: [hy + 18.0, 11.4, 6.2, 9.2, 2.8],
    bottom: hy + 23.9,
    chest: [hy + 17.2, 5.2, 8.4, 5.2, 5.6],
    rump: [hy + 19.4, -7.0, 7.6, 4.4, 4.8],
    arms: [
      [12.2, hy + 16.4, 0.6, 8.6, hy + 21.0, 1.8, 2.4, 2.2],
      [35.8, hy + 16.4, 0.6, 39.4, hy + 21.0, 1.8, 2.4, 2.2],
    ],
  });
  budCrest(g, env);
  wing(g, env, {
    name: 'wingL',
    mask: env.mPlumeL,
    group: G.wingL,
    root: [10.5, hy + 15, 0.4],
    sweep: 0.3,
    curve: 0.02,
  });
  wing(g, env, {
    name: 'wingR',
    mask: env.mPlumeR,
    group: G.wingR,
    root: [37.5, hy + 15, 0.4],
    sweep: 0.3,
    curve: 0.02,
  });
  tail(g, env);
  legs(g, env, { z: 0.8, toe: 3 });
}

type V3 = readonly [number, number, number];

/**
 * 꼬리 깃 사이 골·깃받침 색: 깃(파랑 자리 9)에 칠해진 색의 그늘(RAMP). 깃 색 꾸미기가 무엇이든 2D 꼬리와 같은 계열이 된다
 * (오색·푸른 깃 9→남색 8, 노을 깃 2→자주 1, 달빛 깃 14→먹회색 15).
 * 숲 깃의 청록(7)만은 RAMP 그늘이 남색(8)이라 초록 꼬리에 파란 줄로 읽혀 먹회색(15)으로 둔다.
 * 가장 어두운 색(그늘이 자기 자신)이면 그대로다.
 */
const GROOVE_FIX: Readonly<Record<number, number>> = { 7: 15 };
export function grooveOf(feather: number, ramp: readonly number[]): number {
  return GROOVE_FIX[feather] ?? ramp[feather] ?? feather;
}

/**
 * 꼬리 — 허리 뒤 한 점(깃뿌리)에서 퍼지는 부채 한 장(가리비 껍데기·공작 꼬리).
 *   깃 일곱 장이 뿌리에서 아래·뒤로 퍼진다. 바깥 깃은 옆·아래로(앞모습에서 2D 의 좌우 꼬리 뭉치 자리), 가운데 깃일수록
 *   뒤로 길게 뻗는다 — 뒤(내려다보는 15°)에서 보면 맨 아래 변이 가운데에서 가장 낮은 볼록한 호 하나가 된다(두 덩이가 아니다).
 *   판은 깃 사이가 비지 않는 연속면(뿌리에서 잰 가로 각 phi 마다 깃 끝을 이어 보간한 캡슐)이고, 깃 끝은 둥글게 살짝 파인다.
 * 색은 굽는다(명암 디더 없음 F_LIT): 깃마다 파랑·하늘이 번갈아, 깃 사이에는 깃 그늘색 골 한 줄(뿌리에서 끝까지 방사형, grooveOf),
 *   깃 끝에만 붉은 점과 그 가운데 흰 한 칸 — 2D 꼬리의 '청색 깃 + 붉은 끝 + 흰 깃대'와 같은 낱말.
 *   앞모습에서는 가운데 깃이 발 사이로 조금 보인다(앱은 0°에서 2D 그림으로 시작하므로 정면 IoU 0.90 이상이면 된다).
 */
function tail(g: Grid, env: Env) {
  const hy = env.headY;
  const red = env.plume(2),
    blue = env.plume(9),
    sky = env.plume(10),
    groove = grooveOf(blue, env.ramp);
  const R: V3 = [24, hy + 20.2, -11.2];
  // 깃 끝(바깥 → 가운데 → 바깥). 가운데일수록 뒤로 길다
  const TIPS: readonly V3[] = [
    [7.6, hy + 27.8, -12.2],
    [12.2, hy + 30.0, -17.0],
    [18.2, hy + 29.6, -21.0],
    [24, hy + 29.6, -23.0],
    [29.8, hy + 29.6, -21.0],
    [35.8, hy + 30.0, -17.0],
    [40.4, hy + 27.8, -12.2],
  ];
  const NF = TIPS.length;
  const tipOf = (k: number) => TIPS[k] as V3;
  const phiOf = (x: number, y: number, z: number) =>
    Math.atan2(x - R[0], Math.hypot(y - R[1], z - R[2]));
  const PH = TIPS.map((t) => phiOf(t[0], t[1], t[2]));
  const LEN = TIPS.map((t) => Math.hypot(t[0] - R[0], t[1] - R[1], t[2] - R[2]));
  const ph = (k: number) => PH[k] as number;
  // phi → 깃 번호(실수): 깃 끝 phi 사이를 선형으로
  const fOf = (phi: number) => {
    if (phi <= ph(0)) return (phi - ph(0)) / (ph(1) - ph(0));
    for (let k = 0; k < NF - 1; k++)
      if (phi <= ph(k + 1)) return k + (phi - ph(k)) / (ph(k + 1) - ph(k));
    return NF - 1 + (phi - ph(NF - 1)) / (ph(NF - 1) - ph(NF - 2));
  };
  const tipAt = (f: number): V3 => {
    const k = Math.max(0, Math.min(NF - 2, Math.floor(f))),
      t = Math.max(0, Math.min(1, f - k));
    const a = tipOf(k),
      b = tipOf(k + 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  const sdf: Sdf = (x, y, z) => {
    const f = fOf(phiOf(x, y, z));
    const fc = Math.max(0, Math.min(NF - 1, f));
    const T = tipAt(fc);
    // 깃 끝 둥글게: 깃 가운데가 가장 길고 깃 사이는 0.9칸 짧다
    const fr = fc - Math.round(fc),
      short = 1.6 * (fr * fr * 4);
    const L = Math.hypot(T[0] - R[0], T[1] - R[1], T[2] - R[2]),
      s = Math.max(0.2, (L - short) / L);
    const bx = R[0] + (T[0] - R[0]) * s,
      by = R[1] + (T[1] - R[1]) * s,
      bz = R[2] + (T[2] - R[2]) * s;
    // 뿌리 → 끝 선분까지의 거리(두께: 뿌리 1.5 → 끝 1.25칸 반지름)
    const ux = bx - R[0],
      uy = by - R[1],
      uz = bz - R[2],
      uu = ux * ux + uy * uy + uz * uz;
    const t = Math.max(0, Math.min(1, ((x - R[0]) * ux + (y - R[1]) * uy + (z - R[2]) * uz) / uu));
    const d = Math.hypot(x - R[0] - ux * t, y - R[1] - uy * t, z - R[2] - uz * t);
    // 바깥 깃 바깥으로는 둥글게 닫는다
    const over = Math.max(0, Math.abs(f - fc)) * 4.5;
    return Math.hypot(d, over) - (1.5 - 0.25 * t);
  };
  const color: Sdf = (x, y, z) => {
    const f = fOf(phiOf(x, y, z)),
      k = Math.max(0, Math.min(NF - 1, Math.round(f)));
    const r = Math.hypot(x - R[0], y - R[1], z - R[2]);
    if (r < 3.2) return groove; // 깃받침
    const L = LEN[k] as number,
      off = Math.abs(f - k); // off: 깃 가운데에서 0, 깃 사이에서 0.5
    // 깃 사이 골: 깃 폭(이 거리에서 깃 하나의 가로 폭 칸 수)에 맞춰 늘 한 칸
    const a = tipOf(Math.min(k + 1, NF - 1)),
      b = tipOf(Math.max(k - 1, 0));
    const wid = ((r / L) * Math.hypot(a[0] - b[0], a[2] - b[2])) / 2;
    if (f > -0.2 && f < NF - 0.8 && (0.5 - off) * wid < 0.55) return groove;
    // 깃 끝의 붉은 점(깃 가운데, 끝에서 1.9칸 안쪽이 중심인 원) + 그 가운데 흰 한 칸
    const ex = off * wid,
      ey = r - (L - 2.0),
      e2 = ex * ex + ey * ey * 0.8;
    if (e2 < 0.45) return 12;
    if (e2 < 3.6) return red;
    return k % 2 ? sky : blue;
  };
  fillSdf(g, {
    name: 'fan',
    group: G.tail,
    sdf,
    color,
    flag: F_LIT,
    onlyEmpty: true,
    bbox: [5, hy + 15, -27, 43, hy + 34, -4],
  });
}

/**
 * 볏(봉오리 셋 달린 관): 낮은 받침(다섯 칸 깊이) 위에 봉오리 셋(2×2, 세 칸 깊이)이 한 줄로 선다.
 *   봉오리 사이의 선(2D 의 먹색 한 칸)은 깊이 전체를 먹색으로 둔다: 비스듬히 봐도 사이가 메워지지 않아 늘 봉오리로 읽힌다
 *   (예전에는 속을 볏 색으로 채워 15°부터 한 덩어리 원통 모자가 됐다).
 *   흰 반짝임은 맨 앞 한 칸에만: 옆·뒤는 볏 색이다(뒤에서 흰 구슬 셋으로 보이지 않게).
 */
function budCrest(g: Grid, env: Env) {
  const hy = env.headY,
    { raw, px } = env;
  let all = orMask(env.mCrest, env.seam(env.mCrest));
  if (env.hideHead) all = andNot(all, env.hideHead);
  if (!maskBox(all)) return;
  const main = env.mainColor(env.mCrest);
  const budRow = hy - 3; // 봉오리는 이 줄까지(그 아래는 받침)
  const tex = new Uint8Array(W * H).fill(TR),
    back = new Uint8Array(W * H).fill(TR),
    core = new Uint8Array(W * H).fill(TR);
  for (let i = 0; i < W * H; i++) {
    if (!all[i]) continue;
    const j = (i / W) | 0;
    tex[i] = raw[i] === 0 ? 0 : px[i]!;
    if (tex[i] === 12) back[i] = main; // 흰 반짝임은 앞면만
    if (tex[i] === 0 && j > budRow) core[i] = main; // 받침 속의 선은 볏 색
  }
  const buds = maskOf((i, j) => all[j * W + i] && j <= budRow),
    base = maskOf((i, j) => all[j * W + i] && j > budRow);
  fillPlate(g, {
    name: 'crest',
    group: G.crest,
    mask: buds,
    tex,
    back,
    color: main,
    zc: () => 0.5,
    th: () => 3,
    nmode: 'occ',
  });
  // 봉오리 사이 틈(2D 의 먹색 한 칸, 위가 뚫린 바깥선이라 가면에는 없다): 먹색 복셀로 채워 둔다 — 틈이 비어 있으면 15°만 돌려도
  // 봉오리끼리 겹쳐 납작한 원통 모자가 된다. 외곽선 없는 묶음(110)이라 앞모습의 윗선은 2D 그대로다
  const gap = maskOf(
    (i, j) =>
      j <= budRow &&
      !all[j * W + i] &&
      raw[j * W + i] === 0 &&
      all[j * W + i - 1] &&
      all[j * W + i + 1],
  );
  if (maskBox(gap))
    fillPlate(g, {
      name: 'crest-gap',
      group: 110,
      mask: gap,
      color: 0,
      zc: () => 0.5,
      th: () => 3,
      nmode: 'occ',
    });
  fillPlate(g, {
    name: 'crest-base',
    group: G.crest,
    mask: base,
    tex,
    back,
    core,
    color: main,
    zc: () => 0.5,
    th: (_i, j) => (j === budRow + 1 ? 5 : j === budRow + 2 ? 5 : 4),
    nmode: 'occ',
  });
}
