/**
 * 소품·장식: 2D 그림을 앵커 자리에 입체로 세우는 공통 규칙 + 자주 보이는 소품의 덧붙임(목 뒤로 도는 끈·꽃줄).
 *
 *   stand  손에 든 판. 세 칸 두께의 판을 손 앞에 세우고, 바깥쪽이 뒤로 가게 tilt 만큼 기울인다:
 *          정면부터 든 손 쪽 옆모습까지 판의 앞면(2D 그림)이 보인다(옆에서 막대로 서지 않는다). puff>0 이면 가운데가 도톰하다.
 *   box    네모난 물건(결재판·계산기·책·칠판·무전기): stand 와 같되 가장자리 한 줄이 한 칸 얇은 상자(둥근 모서리). 책·무전기는 네 칸 두께.
 *   hug    몸 표면을 따라 붙는 얇은 판(머리핀·명찰·꽃목걸이). 표면에서 off 만큼 띄운다.
 *   paint  몸 앞면에 칠만 한다(넥타이·가슴 배지): 두께가 없어 옆에서 얼룩으로 튀어나오지 않는다.
 *   round  행마다 가로 폭을 지름으로 하는 둥근 단면(세로축 회전체): 모자·머그·도장·지구본·화분처럼 둥근 것.
 *   crown  왕관(금빛 깃): 둥근 테 위에 뿔 넷(crownRing).
 *   face   눈 앵커 소품(안경·선글라스·볼 터치)은 복셀이 아니라 얼굴 도장(face.ts)이다. 여기서는 만들지 않는다.
 *
 * 어느 규칙을 쓸지는 SHAPES 표(스프라이트 이름)에서 찾고, 없으면 붙는 앵커로 정한다(손 → stand, 가슴 → paint, 그 밖 → hug).
 * 새 소품이 생겨도 표에 없으면 기본 규칙으로 붙는다.
 *
 * 그림은 세 겹으로 나눈다(앞모습이 2D 와 같아지게):
 *   solid  안쪽 칸(불투명 − 바깥 외곽선). 바깥 외곽선은 렌더러가 다시 긋는다
 *   bare   외곽선 없이 투명과 맞닿은 색 칸(끈·김·빛 점·꽃목걸이) → 외곽선 없는 묶음
 *   line   안쪽 칸과 떨어진 선(머그 손잡이 끝) → 외곽선 없는 검은 복셀
 * 판 속(앞·뒤 한 칸 사이)의 선 칸은 소품의 주된 색으로 채운다: 옆에서 본 두께 면이 검은 조각이 되지 않는다.
 */
import {
  W,
  H,
  TR,
  maskOf,
  orMask,
  maskBox,
  outerOutline,
  edgeDist,
  fillPlate,
  fillSdf,
  frontZ,
  frontNear,
  decal,
  type ColumnFn,
  type Grid,
  type Mask,
  type MaskBox,
  type Sdf,
} from './kit.ts';
import type { Env } from './parts.ts';
import type { VoxelItem } from './input.ts';

const WH = W * H;
export const PG = {
  item: 40,
  hand: 41,
  hat: 42,
  crown: 43,
  card: 44,
  thin: 100,
  bare: 110,
  line: 111,
};

export type ShapeMode = 'stand' | 'box' | 'hug' | 'paint' | 'round' | 'crown' | 'face';
type ExtraId = 'lanyard' | 'collar' | 'leiRing';
/** th: 두께, tilt: 기울기(칸당), puff: 가운데 도톰함, off: 표면에서 띄우기, depth: round 의 앞뒤 비율, frontOnly: 앞·뒤 면에만 두는 색 */
export interface Shape {
  mode: ShapeMode;
  th?: number;
  tilt?: number;
  puff?: number;
  off?: number;
  depth?: number;
  /** 머리에 얹는 것(모자·관): 그 아래의 볏·솜털은 만들지 않는다 */
  sit?: boolean;
  group?: number;
  extra?: ExtraId;
  frontOnly?: readonly number[];
  /** 옆얼굴에서 보이는 안경다리 색(face) */
  temple?: number;
}

/** 스프라이트 이름 → 규칙 */
export const SHAPES: Readonly<Record<string, Shape>> = {
  'item-folder': { mode: 'box' },
  'item-mug': { mode: 'round' },
  'item-stamp': { mode: 'round' },
  'item-tie': { mode: 'paint' },
  'item-lanyard': { mode: 'hug', th: 1, off: 0.2, extra: 'lanyard' },
  'item-lei': { mode: 'hug', th: 1.8, off: 0.2, extra: 'leiRing' },
  // 눈 앵커 소품은 복셀이 아니라 얼굴 도장(face.ts)으로 간다. temple: 옆얼굴에서 보이는 안경다리 색
  'item-glasses': { mode: 'face', temple: 14 },
  'item-sunglasses': { mode: 'face', temple: 15 },
  // 금빛 깃(왕관): 판이 아니라 회전체 — 둥근 테 위에 뿔 넷(앞·뒤·좌·우). 어느 각도에서도 테 + 뿔 두셋으로 읽힌다(crownRing)
  'item-crest-gold': { mode: 'crown', sit: true, group: PG.crown },
  'item-strawhat': { mode: 'round', depth: 0.92, sit: true, group: PG.hat },
  'item-partyhat': { mode: 'round', sit: true, group: PG.hat },
  'item-nightcap': { mode: 'round', sit: true, group: PG.hat },
  'series-calculator': { mode: 'box' },
  'series-book': { mode: 'box', th: 4 },
  'series-letter': { mode: 'stand', th: 2 },
  'series-laptop': { mode: 'stand', th: 3 },
  'series-stethoscope': { mode: 'stand', th: 2, puff: 0.5 },
  'series-sprout': { mode: 'round' },
  'series-wrench': { mode: 'stand', th: 3 },
  'series-setsquare': { mode: 'stand', th: 2 },
  'series-compass': { mode: 'stand', th: 2.2, puff: 0.5 },
  'series-umbrella': { mode: 'round', depth: 0.8 },
  'series-sujeo': { mode: 'stand', th: 2 },
  'track-extinguisher': { mode: 'round' },
  'track-lifering': { mode: 'stand', th: 2.4, puff: 0.8 },
  'track-globe': { mode: 'round' },
  'track-chalkboard': { mode: 'box' },
  'track-flashlight': { mode: 'round' },
  'track-radio': { mode: 'box', th: 4 },
};
const DEFAULTS: Readonly<Record<string, Shape>> = {
  handL: { mode: 'stand', th: 3, puff: 0.4 },
  handR: { mode: 'stand', th: 3, puff: 0.4 },
  head: { mode: 'hug', th: 1.4, off: 0.3 },
  crown: { mode: 'round', sit: true },
  chest: { mode: 'paint' },
  neck: { mode: 'hug', th: 1.4, off: 0.3 },
  eyes: { mode: 'face' },
};
const FALLBACK: Shape = { mode: 'hug', th: 1.4, off: 0.3 };
/** 기울기 기본값(칸당 뒤로 가는 칸 수): 0.8(약 39°) */
const TILT: Partial<Record<ShapeMode, number>> = { stand: 0.8, box: 0.8 };
export const shapeOf = (it: Pick<VoxelItem, 'name' | 'attach'>): Shape =>
  SHAPES[it.name] ?? (it.attach !== null ? DEFAULTS[it.attach] : undefined) ?? FALLBACK;

interface ItemLayers {
  solid: Mask;
  bare: Mask;
  line: Mask;
  all: Mask;
}

/** 그림을 세 겹(solid·bare·line)으로 나눈다 */
function layersOf(px: Uint8Array): ItemLayers {
  const outer = outerOutline(px);
  const solid = new Uint8Array(WH),
    bare = new Uint8Array(WH),
    line = new Uint8Array(WH);
  const tr = (id: number, i: number, j: number) =>
    i === 0 ||
    j === 0 ||
    i === W - 1 ||
    j === H - 1 ||
    px[id - 1] === TR ||
    px[id + 1] === TR ||
    px[id - W] === TR ||
    px[id + W] === TR;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const id = j * W + i,
        v = px[id];
      if (v === TR) continue;
      if (!outer[id]) {
        if (v !== 0 && tr(id, i, j)) bare[id] = 1;
        else solid[id] = 1;
      }
    }
  const inner = (id: number) => solid[id] || bare[id];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const id = j * W + i;
      if (!outer[id]) continue;
      if (
        (i > 0 && inner(id - 1)) ||
        (i < W - 1 && inner(id + 1)) ||
        (j > 0 && inner(id - W)) ||
        (j < H - 1 && inner(id + W))
      )
        continue;
      line[id] = 1;
    }
  return { solid, bare, line, all: orMask(solid, bare, line) };
}

/**
 * 행마다 색 칸(선 0 이 아닌 칸)의 가로 토막 가운데·반지름(round 규칙). 쥔 날개 끝(skin)과 선은 토막에 넣지 않는다
 * (머그 손잡이·호스처럼 선으로 이어진 것이 한 덩어리로 부풀지 않게).
 */
function rowRuns(px: Uint8Array, skin: Uint8Array | null) {
  const cx = new Float32Array(WH),
    rr = new Float32Array(WH);
  for (let j = 0; j < H; j++) {
    let i = 0;
    while (i < W) {
      const ok = (x: number) => {
        const v = px[j * W + x];
        return v !== TR && v !== 0 && !(skin && skin[j * W + x]);
      };
      if (!ok(i)) {
        i++;
        continue;
      }
      let e = i;
      while (e < W && ok(e)) e++;
      for (let x = i; x < e; x++) {
        cx[j * W + x] = (i + e) / 2;
        rr[j * W + x] = (e - i) / 2 + 0.3;
      }
      i = e;
    }
  }
  return { cx, rr };
}

/** 소품 하나를 격자에 더한다(층 순서대로 부른다: 뒤에 그리는 소품이 늘 앞에 선다) */
export function addItem(g: Grid, env: Env, it: VoxelItem): void {
  const sh = shapeOf(it);
  const L = layersOf(it.px);
  const box = maskBox(L.all);
  if (!box) return;
  const [ax] = it.anchor;
  let zc: ColumnFn, th: ColumnFn;
  const each = (fn: (i: number, j: number, id: number) => void) => {
    for (let j = box.y0; j <= box.y1; j++)
      for (let i = box.x0; i <= box.x1; i++) if (L.all[j * W + i]) fn(i, j, j * W + i);
  };

  if (sh.mode === 'crown') {
    crownRing(g, env, it, box, sh.group ?? PG.crown);
    return;
  }
  if (sh.mode === 'round') {
    const { cx, rr } = rowRuns(it.px, it.skin);
    const depth = sh.depth ?? 1;
    const half = (i: number, j: number) => {
      const id = j * W + i;
      if (it.skin && it.skin[id]) return 1.5;
      const r = rr[id]!,
        dx = i + 0.5 - cx[id]!;
      if (r === 0) return 0.5; // 선(0) 칸은 한 칸 두께
      return Math.max(0.5, Math.sqrt(Math.max(0, r * r - dx * dx)) * depth);
    };
    th = (i, j) => 2 * half(i, j);
    let z0: number;
    if (sh.sit)
      z0 = env.headZ ?? 0.5; // 모자·관: 머리 가운데 깊이에 얹는다
    else {
      z0 = -99;
      each((i, j) => {
        const f = frontZ(g, i, j);
        if (f !== null) z0 = Math.max(z0, f + 1 + half(i, j));
      });
      if (z0 === -99) z0 = 2;
    }
    zc = () => z0;
  } else if (sh.mode === 'paint') {
    // 몸 앞면에 칠만 한다(그림의 외곽선까지 그대로)
    decal(g, null, it.px);
    return;
  } else if (sh.mode === 'stand' || sh.mode === 'box') {
    const isBox = sh.mode === 'box';
    const ed = sh.puff || isBox ? edgeDist(L.all, 4) : null;
    const dir = ax < 24 ? -1 : 1;
    const tilt = sh.tilt ?? (TILT[sh.mode] as number);
    const t0 = sh.th ?? 3;
    const puff = sh.puff ?? 0;
    th = (i, j) =>
      isBox
        ? (ed as Uint8Array)[j * W + i]! <= 1
          ? t0 - 1
          : t0
        : t0 + (ed ? puff * (Math.min(ed[j * W + i]!, 4) - 1) : 0);
    // 손 가까운 열(앵커 ±2.5)은 그 앞면 바로 앞에 두고, 바깥으로 갈수록 뒤로 젖힌다. 열마다 뒤에 있는 것(날개·몸)보다는 앞에 둔다
    let zIn = -99;
    const floor = new Float32Array(W).fill(-99);
    each((i, j) => {
      const f = frontZ(g, i, j);
      if (f === null) return;
      const z = f + 1 + th(i, j) / 2;
      if (z > floor[i]!) floor[i] = z;
      if (Math.abs(i + 0.5 - ax) <= 2.5 && z > zIn) zIn = z;
    });
    if (zIn === -99) {
      for (let i = 0; i < W; i++) if (floor[i]! > zIn) zIn = floor[i]!;
    }
    if (zIn === -99) zIn = 2;
    zc = (i) => Math.max(zIn - tilt * Math.max(0, (i + 0.5 - ax) * dir), floor[i]!);
  } else {
    // hug(그리고 표에 없는 face 아닌 것): 몸 표면을 따라
    const off = sh.off ?? 0.3;
    const thick = sh.th as number;
    th = () => thick;
    const cache = new Float32Array(WH).fill(-99);
    zc = (i, j) => {
      const id = j * W + i;
      if (cache[id] === -99) cache[id] = frontNear(g, i, j) + 0.5 + off + thick / 2;
      return cache[id]!;
    };
    // 표면을 따라가되 미리 다 잰다(채우는 동안 앞면이 바뀌지 않게)
    each((i, j) => zc(i, j));
  }

  // 모자·관: 머리 꼭대기 외곽선 줄에 닿는 칸을 검은 복셀로 이어 머리에 얹는다
  let solid = L.solid;
  const tex = new Uint8Array(it.px);
  if (sh.sit) {
    const sit = maskOf(
      (i, j) =>
        j > 0 &&
        j < H - 1 &&
        !L.all[j * W + i] &&
        env.raw[j * W + i] === 0 &&
        L.all[(j - 1) * W + i] &&
        env.mBody[(j + 1) * W + i],
    );
    if (maskBox(sit)) {
      solid = orMask(solid, sit);
      for (let i = 0; i < WH; i++) if (sit[i]) tex[i] = 0;
      const zc0 = zc,
        th0 = th;
      zc = (i, j) => (sit[j * W + i] ? zc0(i, j - 1) : zc0(i, j));
      th = (i, j) => (sit[j * W + i] ? th0(i, j - 1) : th0(i, j));
    }
  }
  const group = sh.group ?? PG.item;
  // 판 속의 색: 선 칸과 frontOnly 색(금빛 깃의 흰 반짝임)은 소품의 주된 색으로
  const frontOnly = sh.frontOnly ?? [];
  const hist = new Uint16Array(16);
  let main = 0,
    mn = 0;
  for (let i = 0; i < WH; i++) {
    const v = it.px[i]!;
    if (v !== TR && v !== 0 && !frontOnly.includes(v) && ++hist[v]! > mn) {
      mn = hist[v]!;
      main = v;
    }
  }
  const core = new Uint8Array(WH).fill(TR);
  for (let i = 0; i < WH; i++) if (tex[i] === 0 || frontOnly.includes(tex[i]!)) core[i] = main;
  const common = { tex, core, zc, th, item: it.name };
  if (maskBox(solid)) fillPlate(g, { ...common, name: it.name, group, mask: solid, color: 0 });
  if (maskBox(L.bare))
    fillPlate(g, { ...common, name: it.name + ':bare', group: PG.bare, mask: L.bare, color: 0 });
  if (maskBox(L.line))
    fillPlate(g, {
      ...common,
      name: it.name + ':line',
      group: PG.line,
      mask: L.line,
      color: 0,
      th: () => 1,
    });
  if (sh.extra) EXTRA[sh.extra](g, env, it);
}

/**
 * 왕관(회전체): 2D 그림의 상자에서 숫자를 읽는다 — 아래 두 줄은 테(위 금색·아래 띠 색), 그 위는 뿔, 가운데 뿔 위 한 줄은 보석.
 *   테: 머리 축(headZ)을 도는 고리(바깥 반지름 = 외곽선 안 폭의 반 + 0.3, 두께 1.8). 속은 비어 내려다보면 정수리가 보인다.
 *   뿔: 2×2 기둥 넷이 테 위 반지름 r(= 2D 의 바깥 뿔 가운데까지 거리)에 앞·뒤·좌·우로 선다.
 *     앞에서는 왼·가운데·오른 뿔 셋(2D 와 같은 자리), 옆에서도 셋, 45°에서는 둘 — 고깔 하나로 뭉치지 않는다.
 *   보석: 앞·뒤 뿔 꼭대기에 붉은 한 칸(2D 가운데 뿔의 보석). 색은 그림에서 읽는다(금·그늘·반짝임·띠·보석).
 */
function crownRing(g: Grid, env: Env, it: VoxelItem, box: MaskBox, group: number) {
  const px = it.px,
    at = (i: number, j: number) => px[j * W + i]!;
  const cx = (box.x0 + box.x1 + 1) / 2,
    z0 = Math.round(env.headZ ?? 0.5); // 칸 경계에 맞춰 뿔이 2×2 로 선다
  const yBand = box.y1 - 1,
    yBot = box.y1 + 1; // 테: 아래 두 줄
  const hw = (box.x1 - box.x0 + 1) / 2,
    R = hw + 0.3,
    r = hw - 1; // box 는 외곽선 안쪽 칸
  // 그림에서 색 읽기: 띠(맨 아래 줄 가운데), 금(테 윗줄 가운데), 그늘(테 윗줄 오른쪽 끝 안), 반짝임(뿔 윗줄 왼쪽), 보석(가운데 뿔 위)
  const mid = Math.floor(cx);
  const pick = (v: number, d: number) => (v === TR || v === 0 ? d : v);
  const band = pick(at(mid, box.y1)!, 2),
    gold = pick(at(mid - 1, yBand)!, 4),
    shade = pick(at(box.x1 - 1, yBand)!, 3);
  let gem = 2,
    hi = 12,
    yTip = yBand - 1;
  for (let j = box.y0; j < yBand; j++) {
    const v = at(mid, j);
    if (v !== TR && v !== 0) {
      gem = v;
      break;
    }
  }
  for (let j = box.y0; j < yBand; j++) {
    const v = at(box.x0, j);
    if (v !== TR && v !== 0) {
      hi = v;
      yTip = j;
      break;
    }
  } // 바깥 뿔 꼭대기 줄
  const yGem = yTip - 1;
  const horns = [0, 90, 180, 270].map((d) => {
    const a = (d * Math.PI) / 180;
    return { x: cx + Math.sin(a) * r, z: z0 + Math.cos(a) * r, gem: d === 0 || d === 180, a };
  });
  const sdf: Sdf = (x, y, z) => {
    let d = 9;
    if (y >= yBand && y < yBot) {
      const q = Math.hypot(x - cx, z - z0);
      d = Math.max(q - (R + 0.02), R - 1.8 - q);
    }
    if (y >= yGem && y < yBand)
      for (const h of horns) {
        if (y < yTip && !h.gem) continue;
        const e = Math.max(Math.abs(x - h.x), Math.abs(z - h.z)) - 0.9; // 2×2 기둥
        if (e < d) d = e;
      }
    return d;
  };
  const color: Sdf = (x, y, z) => {
    if (y >= yBand) {
      if (y >= yBand + 1) return band;
      // 테 윗줄: 빛 반대쪽(오른쪽·뒤) 바깥 한 칸만 그늘
      return x - cx > R - 1.6 ? shade : gold;
    }
    if (y < yTip) return gem;
    // 뿔: 꼭대기 줄의 왼쪽 칸은 반짝임, 오른쪽 아래는 그늘
    let best = horns[0]!,
      bd = 9;
    for (const h of horns) {
      const dd = Math.hypot(x - h.x, z - h.z);
      if (dd < bd) {
        bd = dd;
        best = h;
      }
    }
    const side = (x - best.x) * Math.cos(best.a) - (z - best.z) * Math.sin(best.a); // 뿔을 마주 봤을 때 왼쪽(−)·오른쪽(+)
    if (y < yTip + 1) return side < 0 ? hi : gold;
    return side > 0 && y >= yBand - 1 ? shade : gold;
  };
  const pi = fillSdf(g, {
    name: it.name,
    group,
    sdf,
    color,
    item: it.name,
    bbox: [cx - R - 1, yGem, z0 - R - 1, cx + R + 1, yBot, z0 + R + 1],
  });
  g.parts[pi]!.nsdf = (x, y, z) =>
    Math.max(Math.hypot(x - cx, z - z0) - R, Math.abs(y - (yGem + yBot) / 2) - (yBot - yGem) / 2);
  // 테 아래와 머리 사이 선: 2D 처럼 머리에 얹힌 것으로 읽히게 맨 아랫줄 밑은 비운다(렌더러 외곽선)
}

/** 목에 두르는 것은 뒤로 갈수록 이만큼(칸)까지 올라가 뒤통수 아래로 지나간다(등 한가운데의 허리띠가 되지 않게) */
const RISE = 4;
/** 몸 표면을 한 칸 두께로 도는 띠(목걸이 끈·깃 띠): 몸 도형의 거리 0~1 사이, 빈 칸에만 */
function ring(
  g: Grid,
  env: Env,
  {
    name,
    rowAt,
    color,
    group,
    skip,
  }: {
    name: string;
    rowAt: (z: number) => number;
    color: number;
    group: number;
    skip?: (x: number, z: number) => boolean;
  },
) {
  const body = env.blob;
  // 목이 없는 몸(알봉이·솜봉이)은 띠를 두르면 허리띠처럼 보여 앞의 2D 끈만 둔다
  if (!body || !env.neck) return;
  const sdf: Sdf = (x, y, z) => {
    if (Math.floor(y) !== rowAt(z)) return 2;
    if (skip && skip(x, z)) return 2;
    const d = body(x, y, z);
    return Math.max(-d - 0.2, d - 0.95);
  };
  let y0 = 99,
    y1 = -99;
  for (let z = -14; z <= 14; z++) {
    const r = rowAt(z);
    if (r < y0) y0 = r;
    if (r > y1) y1 = r;
  }
  fillSdf(g, {
    name,
    group,
    color,
    sdf,
    bbox: [6, y0, -14, 42, y1 + 1, 14],
    nsdf: body,
    onlyEmpty: true,
  });
}

const EXTRA: Record<ExtraId, (g: Grid, env: Env, it: VoxelItem) => void> = {
  /** 공무원증: 앞의 V 끈은 2D 그대로, 옆구리를 돌아 어깨 옆선(z −1)에서 끊는다 — 머리와 몸이 한 덩어리라 등 뒤로 두르면 등 한가운데의 빨간 줄이 된다(알봉이·솜봉이처럼 뒤에는 끈이 없다) */
  lanyard(g, env, it) {
    const [nx, ny] = it.anchor;
    const strap = it.px[(ny - 1) * W + nx - 6]!;
    if (strap === TR) return;
    ring(g, env, {
      name: 'strap-ring',
      group: PG.thin,
      color: strap,
      rowAt: (z) => ny - 1 + Math.round(Math.max(-RISE, Math.min(0, z - 2) * 0.34)),
      skip: (x, z) => z < -1 || (z > 2 && Math.abs(x - nx) < 6.5),
    });
  },
  /** 넥타이: 목 앞 절반을 도는 깃 띠 */
  collar(g, env, it) {
    const [nx, ny] = it.anchor;
    const c = it.px[(ny + 2) * W + nx - 1]!;
    if (c === TR) return;
    ring(g, env, {
      name: 'collar',
      group: PG.thin,
      color: c,
      rowAt: () => ny + 1,
      skip: (x, z) => z < 0 || (z > 1 && Math.abs(x - nx) < 2.5),
    });
  },
  /** 꽃목걸이: 목 뒤로 꽃과 줄이 번갈아 돈다 */
  leiRing(g, env, it) {
    const [nx, ny] = it.anchor;
    const body = env.blob;
    if (!body || !env.neck) return;
    const sdf: Sdf = (x, y, z) => {
      const row = ny - 1 + Math.round(Math.max(-RISE, Math.min(0, z - 3) * 0.34));
      if (y < row || y >= row + (z < -1 ? 1 : 2)) return 2; // 뒤에서는 한 칸 굵기
      if (z > 3 && Math.abs(x - nx) < 8.5) return 2;
      const d = body(x, y, z);
      return Math.max(-d - 0.2, d - 1.4);
    };
    fillSdf(g, {
      name: 'lei-ring',
      group: PG.bare,
      sdf,
      nsdf: body,
      onlyEmpty: true,
      bbox: [6, ny - 8, -14, 42, ny + 2, 14],
      color: (x, _y, z) => {
        const a = Math.atan2(x - 24, z);
        return Math.floor((a + Math.PI) * 2.2) % 2 ? 2 : 6;
      },
    });
  },
};
