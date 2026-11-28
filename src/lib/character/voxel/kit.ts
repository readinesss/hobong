/**
 * 조형 키트 — SDF 도형, 2D 가면 도구, 복셀 격자(채우기·무늬·옆 눈·겉 복셀 뽑기).
 * 순수 함수(DOM·Node API 없음). 실행 중에 조합 하나를 수십 ms 안에 만든다.
 *
 * 좌표계(2D 도트와 같다)
 *   x 0~47 왼→오(몸 중심선 x=24.0), y 0~47 위→아래, z −24~23 뒤→앞(+z 가 보는 사람 쪽)
 *   복셀 (i,j,k) 의 중심은 (i+.5, j+.5, k−ZOFF+.5)
 *
 * 부품 두 가지
 *   SDF 부품  { sdf, bbox:[x0,y0,z0,x1,y1,z1], mask }      둥근 덩어리(몸·머리·팔·모자…)
 *   판 부품   { mask, zc(i,j), th(i,j) }                    2D 그림을 두께 th 로 세운 판(날개·볏·꼬리·소품)
 * 공통 속성
 *   mask   48×48 Uint8Array. 0 인 칸에는 복셀을 두지 않는다(앞모습 = 2D 실루엣)
 *   color  기본 색(숫자) 또는 (x,y,z)=>색
 *   tex    48×48 색 그림(255=없음). 있으면 그 칸의 복셀 전체를 그 색으로(관통 칠)
 *   group  외곽선 묶음(1~126) | SOFT(128): 같은 몸끼리는 검정 대신 그늘색 선
 *          100~109: 1칸짜리(끈·손잡이) — 외곽선을 그늘색으로, 110 이상: 외곽선 없음(안경테·김)
 *   nmode  법선: 'sdf'(도형 기울기, SDF 부품 기본) | 판은 중심면·두께의 기울기(매끈한 곡면) | 'occ'(점유 기울기)
 *   flag   복셀 표시(숫자 또는 (x,y,z)=>숫자): F_SKIN 얼굴 도장(눈·안경·볼)을 찍어도 되는 살갗, F_LIT 그늘 금지
 */

export const W = 48,
  H = 48,
  D = 48,
  ZOFF = 24;
export const TR = 255;
export const SOFT = 128;
/** 복셀 표시 비트 */
export const F_SKIN = 1,
  F_LIT = 2;
/** 겉 복셀 한 개의 바이트 수(finish) */
export const STRIDE = 10;
const N = W * H * D;
const WH = W * H;
/**
 * 그늘색(3단 명암의 어두운 칸): 팔레트 안에서 고른다.
 * 가장 어두운 세 색(자주 1·남색 8·먹회색 f)은 더 어두운 색이 먹색(0)뿐이라 그늘을 두지 않는다
 * (수면모자·결재판 같은 남색 소품의 그늘 쪽이 외곽선과 한 덩어리로 까맣게 뭉개지지 않게).
 */
export const RAMP: readonly number[] = [0, 1, 1, 2, 3, 6, 7, 8, 8, 8, 9, 10, 13, 14, 15, 15];

/** 거리장·색·표시 함수: 복셀 중심 (x,y,z) → 값 */
export type Sdf = (x: number, y: number, z: number) => number;
/** 48×48 가면(0·1) */
export type Mask = Uint8Array;
/** 판 부품의 열 (i,j) → 값(중심 z·두께) */
export type ColumnFn = (i: number, j: number) => number;
export type NormalFn = (x: number, y: number, z: number) => ArrayLike<number>;
export interface MaskBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
}

interface PartBase {
  name: string;
  group: number;
  /** 점유 기울기 법선을 잴 때의 묶음(없으면 group & 127) */
  ngroup?: number;
  color: number | Sdf;
  flag?: number | Sdf;
  tex?: Uint8Array | null;
  nmode?: 'sdf' | 'occ';
  sdf?: Sdf;
  /** 법선만 이 도형에서 받는다 */
  nsdf?: Sdf | undefined;
  normal?: NormalFn;
  item?: string;
  /** 채운 복셀 수(채운 뒤에 적힌다) */
  count?: number;
}
export interface SdfPart extends PartBase {
  sdf: Sdf;
  bbox: readonly number[];
  mask?: Mask | null;
  /** 이미 다른 부품이 있는 칸은 건너뛴다 */
  onlyEmpty?: boolean;
}
export interface PlatePart extends PartBase {
  mask: Mask;
  zc: ColumnFn;
  th: ColumnFn;
  core?: Uint8Array | null;
  back?: Uint8Array | null;
  box?: MaskBox | null;
}
export type Part = SdfPart | PlatePart;

export interface Grid {
  /** 칸마다 부품 번호(−1 빈 칸) */
  owner: Int16Array;
  color: Uint8Array;
  flag: Uint8Array;
  /** 열마다 맨 앞 복셀의 k(−1 없음) */
  front: Int16Array;
  parts: Part[];
  solid: number;
}

/** finish 의 결과 */
export interface Surface {
  /** 겉 복셀 STRIDE 바이트씩 */
  bytes: Uint8Array;
  surface: number;
  faces: number;
  solid: number;
}

// ---------- SDF 도형 ----------
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
export function sphere(cx: number, cy: number, cz: number, r: number): Sdf {
  return (x, y, z) => len3(x - cx, y - cy, z - cz) - r;
}
/** 타원체(아래쪽으로 어림한 거리: 건너뛰기에 안전하다) */
export function ellipsoid(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
): Sdf {
  const m = Math.min(rx, ry, rz);
  return (x, y, z) => (len3((x - cx) / rx, (y - cy) / ry, (z - cz) / rz) - 1) * m;
}
/** 각진 타원체: 정면(x·y) 단면이 p>2 일수록 둥근 네모(도트 몸통처럼 통통하게) */
export function blob(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  p = 2.4,
  q = 2,
): Sdf {
  const m = Math.min(rx, ry, rz),
    ip = 1 / p,
    iq = 1 / q;
  return (x, y, z) => {
    const X = Math.abs(x - cx) / rx,
      Y = Math.abs(y - cy) / ry,
      Z = Math.abs(z - cz) / rz;
    const xy = Math.pow(Math.pow(X, p) + Math.pow(Y, p), ip);
    // q>2 면 앞뒤(z)로도 둥근 네모: 위에서 내려다봐도 정수리가 뾰족해지지 않는다
    return (
      ((q === 2 ? Math.sqrt(xy * xy + Z * Z) : Math.pow(Math.pow(xy, q) + Math.pow(Z, q), iq)) -
        1) *
      m
    );
  };
}
export function box(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  round = 0,
): Sdf {
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2 - round,
    hy = (y1 - y0) / 2 - round,
    hz = (z1 - z0) / 2 - round;
  return (x, y, z) => {
    const qx = Math.abs(x - cx) - hx,
      qy = Math.abs(y - cy) - hy,
      qz = Math.abs(z - cz) - hz;
    return (
      len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
      Math.min(Math.max(qx, qy, qz), 0) -
      round
    );
  };
}
/** 선분 a-b 를 감싼 캡슐(굵기 r0→r1) */
export function capsule(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r0: number,
  r1 = r0,
): Sdf {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az,
    l2 = dx * dx + dy * dy + dz * dz;
  return (x, y, z) => {
    let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return len3(x - ax - dx * t, y - ay - dy * t, z - az - dz * t) - (r0 + (r1 - r0) * t);
  };
}
/** 세로축(y) 원기둥(rz 를 주면 타원 기둥) */
export function cylinderY(cx: number, cz: number, r: number, y0: number, y1: number, rz = r): Sdf {
  const m = Math.min(r, rz);
  return (x, y, z) => {
    const dr = (Math.hypot((x - cx) / r, (z - cz) / rz) - 1) * m;
    const dy = Math.max(y0 - y, y - y1);
    return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
  };
}
export function union(a: Sdf, b: Sdf, c?: Sdf, d?: Sdf): Sdf {
  if (c && d) return (x, y, z) => Math.min(a(x, y, z), b(x, y, z), c(x, y, z), d(x, y, z));
  if (c) return (x, y, z) => Math.min(a(x, y, z), b(x, y, z), c(x, y, z));
  return (x, y, z) => Math.min(a(x, y, z), b(x, y, z));
}
export const inter =
  (a: Sdf, b: Sdf): Sdf =>
  (x, y, z) =>
    Math.max(a(x, y, z), b(x, y, z));
export const subtract =
  (a: Sdf, b: Sdf): Sdf =>
  (x, y, z) =>
    Math.max(a(x, y, z), -b(x, y, z));
/** 부드러운 합집합(k: 이음새 둥글기) */
export function smooth(k: number, ...fs: Sdf[]): Sdf {
  const n = fs.length;
  return (x, y, z) => {
    let d = fs[0]!(x, y, z);
    for (let i = 1; i < n; i++) {
      const b = fs[i]!(x, y, z);
      let h = 0.5 + (0.5 * (b - d)) / k;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      d = b * (1 - h) + d * h - k * h * (1 - h);
    }
    return d;
  };
}
/** 좌우 대칭 복사(x=24 기준) */
export const mirrorX =
  (f: Sdf, cx = 24): Sdf =>
  (x, y, z) =>
    f(x < cx ? x : 2 * cx - x, y, z);
/** y 가 c 보다 아래(큰 쪽)인 부분을 잘라 낸다(납작한 바닥) */
export const cutBelow =
  (f: Sdf, c: number): Sdf =>
  (x, y, z) =>
    Math.max(f(x, y, z), y - c);

// ---------- 2D 가면 도구(48×48) ----------
export function maskOf(fn: (i: number, j: number) => unknown): Mask {
  const m = new Uint8Array(WH);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (fn(i, j)) m[j * W + i] = 1;
  return m;
}
export const orMask = (...ms: (Mask | null | undefined)[]): Mask => {
  const o = new Uint8Array(WH);
  for (const m of ms) if (m) for (let i = 0; i < WH; i++) if (m[i]) o[i] = 1;
  return o;
};
export const andNot = (a: Mask, b: Mask): Mask => {
  const o = new Uint8Array(WH);
  for (let i = 0; i < WH; i++) o[i] = a[i] && !b[i] ? 1 : 0;
  return o;
};
export function maskBox(m: Mask): MaskBox | null {
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1,
    n = 0;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++)
      if (m[j * W + i]) {
        n++;
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
  return n ? { x0, y0, x1, y1, n } : null;
}
/** 바깥 외곽선: 투명(또는 그림 밖)과 맞닿은 0 */
export function outerOutline(px: Uint8Array): Mask {
  const o = new Uint8Array(WH);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const id = j * W + i;
      if (px[id] !== 0) continue;
      if (
        i === 0 ||
        j === 0 ||
        i === W - 1 ||
        j === H - 1 ||
        px[id - 1] === TR ||
        px[id + 1] === TR ||
        px[id - W] === TR ||
        px[id + W] === TR
      )
        o[id] = 1;
    }
  return o;
}
/** 그림의 안쪽 가면: 불투명하고 바깥 외곽선이 아닌 칸(바깥 외곽선은 렌더러가 다시 긋는다) */
export function innerMask(px: Uint8Array): Mask {
  const o = outerOutline(px),
    m = new Uint8Array(WH);
  for (let i = 0; i < WH; i++) m[i] = px[i] !== TR && !o[i] ? 1 : 0;
  return m;
}
/**
 * 0(선) 칸의 가로·세로 토막 중 길이 maxRun 이하이고 한쪽 끝은 a, 반대쪽 끝은 b 에 닿는 것.
 * a===b 면 '부품 안에 갇힌 선'(팔과 몸 사이 주름, 깃 사이 선), 다르면 '이음매'(볏과 머리, 날개와 팔, 다리와 몸).
 * 바깥 외곽선 칸은 넣지 않는다(실루엣이 커지지 않게).
 */
export function lineRuns(px: Uint8Array, outer: Mask, a: Mask, b: Mask, maxRun = 3): Mask {
  const out = new Uint8Array(WH);
  const scan = (len: number, count: number, at: (u: number, v: number) => number) => {
    for (let u = 0; u < count; u++) {
      let v = 0;
      while (v < len) {
        if (px[at(u, v)] !== 0) {
          v++;
          continue;
        }
        let e = v;
        while (e < len && px[at(u, e)] === 0) e++;
        if (v > 0 && e < len && e - v <= maxRun) {
          const p = at(u, v - 1),
            q = at(u, e);
          if ((a[p] && b[q]) || (b[p] && a[q]))
            for (let t = v; t < e; t++) {
              const id = at(u, t);
              if (!outer[id]) out[id] = 1;
            }
        }
        v = e;
      }
    }
  };
  scan(W, H, (j, i) => j * W + i);
  scan(H, W, (i, j) => j * W + i);
  return out;
}
/** 가면 가장자리까지의 거리(칸, 4방향). 가장자리 칸이 1, 가면 밖은 0. cap 까지만 센다 */
export function edgeDist(mask: Mask, cap = 5): Uint8Array {
  const d = new Uint8Array(WH);
  let cur: number[] = [];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const id = j * W + i;
      if (!mask[id]) continue;
      if (
        i === 0 ||
        j === 0 ||
        i === W - 1 ||
        j === H - 1 ||
        !mask[id - 1] ||
        !mask[id + 1] ||
        !mask[id - W] ||
        !mask[id + W]
      ) {
        d[id] = 1;
        cur.push(id);
      }
    }
  for (let r = 2; r <= cap && cur.length; r++) {
    const next: number[] = [];
    for (const id of cur)
      for (const q of [id - 1, id + 1, id - W, id + W])
        if (mask[q] && !d[q]) {
          d[q] = r;
          next.push(q);
        }
    cur = next;
  }
  for (let i = 0; i < WH; i++) if (mask[i] && !d[i]) d[i] = cap;
  return d;
}

// ---------- 복셀 격자 ----------
let scratch: Grid | null = null;
/** 격자 하나를 돌려 쓴다(조합마다 새로 잡지 않는다) */
export function createGrid(): Grid {
  scratch ??= {
    owner: new Int16Array(N),
    color: new Uint8Array(N),
    flag: new Uint8Array(N),
    front: new Int16Array(WH),
    parts: [],
    solid: 0,
  };
  const g = scratch;
  g.owner.fill(-1);
  g.flag.fill(0);
  g.front.fill(-1);
  g.parts = [];
  g.solid = 0;
  return g;
}

function put(g: Grid, id: number, pi: number, c: number, f = 0) {
  if (g.owner[id]! < 0) g.solid++;
  g.owner[id] = pi;
  g.color[id] = c;
  g.flag[id] = f;
}
const flagOf = (part: Part): Sdf | null => (typeof part.flag === 'function' ? part.flag : null);
const flagBase = (part: Part): number => ((part.flag as number | undefined) ?? 0) | 0;

/** SDF 부품 채우기. 열마다 z 를 훑되 거리만큼 건너뛴다 */
export function fillSdf(g: Grid, part: SdfPart): number {
  const pi = g.parts.length;
  g.parts.push(part);
  const { sdf, bbox, mask, tex } = part;
  const fn = typeof part.color === 'function' ? part.color : null,
    base = fn ? 0 : (part.color as number);
  const i0 = Math.max(0, Math.floor(bbox[0]!)),
    i1 = Math.min(W - 1, Math.ceil(bbox[3]!) - 1);
  const j0 = Math.max(0, Math.floor(bbox[1]!)),
    j1 = Math.min(H - 1, Math.ceil(bbox[4]!) - 1);
  const k0 = Math.max(0, Math.floor(bbox[2]!) + ZOFF),
    k1 = Math.min(D - 1, Math.ceil(bbox[5]!) - 1 + ZOFF);
  const { front } = g,
    only = !!part.onlyEmpty;
  const ff = flagOf(part),
    fbase = ff ? 0 : flagBase(part);
  let n = 0;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const col = j * W + i;
      if (mask && !mask[col]) continue;
      const x = i + 0.5,
        y = j + 0.5;
      const t = tex ? tex[col]! : TR;
      for (let k = k1; k >= k0; k--) {
        const z = k - ZOFF + 0.5;
        const d = sdf(x, y, z);
        if (d <= 0) {
          if (only && g.owner[(k * H + j) * W + i]! >= 0) continue;
          put(
            g,
            (k * H + j) * W + i,
            pi,
            t !== TR ? t : fn ? fn(x, y, z) : base,
            ff ? ff(x, y, z) : fbase,
          );
          if (k > front[col]!) front[col] = k;
          n++;
        } else if (d >= 2) k -= (d | 0) - 1;
      }
    }
  part.count = n;
  return pi;
}

/**
 * 가장자리 메우기: 가면 안인데 SDF 가 닿지 않은 칸을 이웃 열의 가운데 깊이로 얇게 채운다(고리 rings 번).
 * 도형 숫자가 2D 실루엣보다 조금 작아도 앞모습이 2D 와 같아지고, 가장자리는 얇아져 둥글게 읽힌다.
 */
export function rimFill(g: Grid, pi: number, rings = 2, shrink = 0.55): void {
  const part = g.parts[pi]!,
    mask = part.mask as Mask,
    { owner, front } = g;
  const fn = typeof part.color === 'function' ? part.color : null,
    base = fn ? 0 : (part.color as number);
  const ff = flagOf(part),
    fbase = ff ? 0 : flagBase(part);
  const lo = new Int16Array(WH).fill(-1),
    hi = new Int16Array(WH).fill(-1);
  for (let col = 0; col < WH; col++) {
    if (!mask[col]) continue;
    for (let k = D - 1; k >= 0; k--)
      if (owner[k * WH + col] === pi) {
        if (hi[col]! < 0) hi[col] = k;
        lo[col] = k;
      }
  }
  for (let r = 0; r < rings; r++) {
    const add: number[] = [];
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        const col = j * W + i;
        if (!mask[col] || hi[col]! >= 0) continue;
        let best = -1,
          bl = 0;
        for (const q of [col - 1, col + 1, col - W, col + W])
          if (hi[q]! >= 0 && hi[q]! - lo[q]! + 1 > bl) {
            bl = hi[q]! - lo[q]! + 1;
            best = q;
          }
        if (best < 0) continue;
        const len = Math.max(1, Math.round(bl * shrink)),
          a = Math.round((lo[best]! + hi[best]! + 1 - len) / 2);
        add.push(col, a, a + len - 1);
      }
    if (!add.length) break;
    for (let t = 0; t < add.length; t += 3) {
      const col = add[t]!,
        i = col % W,
        j = (col / W) | 0;
      for (let k = add[t + 1]!; k <= add[t + 2]!; k++) {
        const id = k * WH + col;
        if (owner[id]! >= 0) continue;
        put(
          g,
          id,
          pi,
          fn ? fn(i + 0.5, j + 0.5, k - ZOFF + 0.5) : base,
          ff ? ff(i + 0.5, j + 0.5, k - ZOFF + 0.5) : fbase,
        );
      }
      lo[col] = add[t + 1]!;
      hi[col] = add[t + 2]!;
      if (add[t + 2]! > front[col]!) front[col] = add[t + 2]!;
    }
  }
}

/**
 * 판 부품 채우기: 열 (i,j) 에 z 중심 zc, 두께 th 인 토막.
 * 법선은 중심면(zc)과 반두께(h)의 기울기에서 받는다: 앞면 ∝ (−(zc+h)′, 1), 뒷면 ∝ ((zc−h)′, −1).
 * 가장자리에서는 h 가 0 으로 떨어져 법선이 바깥으로 눕는다(모서리가 둥글게 읽힌다). 점유 기울기보다 매끈해 명암 띠가 흩어지지 않는다.
 *   part.core  (선택) 48×48 색: 앞·뒤 한 칸 사이(옆에서 보이는 두께 면)의 색
 *   part.back  (선택) 48×48 색: 맨 앞 한 칸을 뺀 나머지(옆·뒤에서 보이는 면)의 색 — 앞모습만 2D 그대로 두고 뒤는 다른 색으로
 */
export function fillPlate(g: Grid, part: PlatePart): number {
  const pi = g.parts.length;
  g.parts.push(part);
  const { mask, zc, th, tex, core, back } = part;
  const fn = typeof part.color === 'function' ? part.color : null,
    base = fn ? 0 : (part.color as number);
  const ff = flagOf(part),
    fbase = ff ? 0 : flagBase(part);
  const { front } = g;
  const b = part.box ?? maskBox(mask);
  const zA = new Float32Array(WH),
    hA = new Float32Array(WH);
  let n = 0;
  if (b)
    for (let j = b.y0; j <= b.y1; j++)
      for (let i = b.x0; i <= b.x1; i++) {
        const col = j * W + i;
        if (!mask[col]) continue;
        const c = zc(i, j),
          t = Math.max(1, th(i, j));
        // 두께 t 를 정수 칸으로: 중심 c 에서 가장 가까운 칸부터 round(t) 칸
        const nvox = Math.max(1, Math.round(t));
        let ka = Math.round(c - nvox / 2) + ZOFF,
          kb = ka + nvox - 1;
        if (ka < 0) ka = 0;
        if (kb > D - 1) kb = D - 1;
        zA[col] = (ka + kb + 1) / 2 - ZOFF;
        hA[col] = (kb - ka + 1) / 2;
        const tc = tex ? tex[col]! : TR;
        const cc = core && kb - ka >= 2 ? core[col]! : TR;
        const bc = back ? back[col]! : TR;
        for (let k = ka; k <= kb; k++) {
          const z = k - ZOFF + 0.5;
          const v =
            bc !== TR && k < kb
              ? bc
              : cc !== TR && k > ka && k < kb
                ? cc
                : tc !== TR
                  ? tc
                  : fn
                    ? fn(i + 0.5, j + 0.5, z)
                    : base;
          put(g, (k * H + j) * W + i, pi, v, ff ? ff(i + 0.5, j + 0.5, z) : fbase);
          n++;
        }
        if (kb > front[col]!) front[col] = kb;
      }
  part.count = n;
  if (!part.normal && part.nmode !== 'occ') {
    const at = (A: Float32Array, i: number, j: number, d: number) =>
      i < 0 || j < 0 || i >= W || j >= H || !mask[j * W + i] ? d : A[j * W + i]!;
    const out = [0, 0, 1];
    part.normal = (x, y, z) => {
      const i = x | 0,
        j = y | 0,
        col = j * W + i;
      const z0 = zA[col]!;
      const s = z >= z0 ? 1 : -1;
      // 이웃이 가면 밖이면 중심면은 그대로 잇고(z0) 두께만 0 으로 본다
      const zx = (at(zA, i + 1, j, z0)! - at(zA, i - 1, j, z0)!) / 2,
        zy = (at(zA, i, j + 1, z0)! - at(zA, i, j - 1, z0)!) / 2;
      const hx = (at(hA, i + 1, j, 0)! - at(hA, i - 1, j, 0)!) / 2,
        hy = (at(hA, i, j + 1, 0)! - at(hA, i, j - 1, 0)!) / 2;
      out[0] = -(s * zx + hx);
      out[1] = -(s * zy + hy);
      out[2] = s;
      return out;
    };
  }
  return pi;
}

/** 열 (i,j) 의 맨 앞 복셀 z(중심). 없으면 null */
export function frontZ(g: Grid, i: number, j: number): number | null {
  const k = i < 0 || j < 0 || i >= W || j >= H ? -1 : g.front[j * W + i]!;
  return k < 0 ? null : k - ZOFF + 0.5;
}
/** 열 (i,j) 에 복셀이 없으면 몸 가운데 쪽으로 옮겨 가며 가장 가까운 앞면을 찾는다 */
export function frontNear(g: Grid, i: number, j: number, fallback = 4): number {
  const dir = i < 24 ? 1 : -1;
  for (let s = 0; s < 14; s++) {
    const z = frontZ(g, i + dir * s, j);
    if (z !== null) return z;
  }
  for (let s = 1; s < 6; s++) {
    const z = frontZ(g, i, j + s) ?? frontZ(g, i, j - s);
    if (z !== null) return z;
  }
  return fallback;
}

function gradNz(f: Sdf, x: number, y: number, z: number) {
  const e = 0.6;
  const gx = f(x + e, y, z) - f(x - e, y, z),
    gy = f(x, y + e, z) - f(x, y - e, z),
    gz = f(x, y, z + e) - f(x, y, z - e);
  return gz / (Math.sqrt(gx * gx + gy * gy + gz * gz) || 1);
}

/**
 * 앞면 무늬: 열마다 맨 앞 복셀이 pset 부품이면(pset 이 null 이면 어느 부품이든) tex 색으로 칠한다.
 * minNz>0 이면 앞을 보는 면에만(옆·아래로 도는 면에 2D 테두리 그늘이 늘어지지 않게).
 */
export function decal(
  g: Grid,
  pset: ReadonlySet<number> | null,
  tex: Uint8Array,
  { minNz = 0 } = {},
): void {
  const { owner, color, front, parts } = g;
  for (let col = 0; col < WH; col++) {
    const t = tex[col]!;
    if (t === TR) continue;
    const k = front[col]!;
    if (k < 0) continue;
    const id = k * WH + col,
      o = owner[id]!;
    if (pset && !pset.has(o)) continue;
    if (minNz > 0) {
      const p = parts[o]!;
      if (
        p.sdf &&
        gradNz(p.nsdf ?? p.sdf, (col % W) + 0.5, ((col / W) | 0) + 0.5, k - ZOFF + 0.5) < minNz
      )
        continue;
    }
    color[id] = t;
  }
}

// 점유 기울기용 이웃(반지름 2)
const NB: number[] = [];
for (let c = -2; c <= 2; c++)
  for (let b = -2; b <= 2; b++)
    for (let a = -2; a <= 2; a++) {
      const d2 = a * a + b * b + c * c;
      if (d2 === 0 || d2 > 4.5) continue;
      NB.push(a, b, c, Math.exp(-d2 / 2.5));
    }
const enc = (v: number) => {
  const r = Math.round(v * 127 + 128);
  return r < 0 ? 0 : r > 255 ? 255 : r;
};

/**
 * 외톨이 선 복셀 지우기: 판 속(앞뒤가 막힌 칸)의 먹색(0) 복셀인데 6방 이웃에 먹색이 하나도 없으면(비스듬히 볼 때 점으로 튀는 칸)
 * 이웃 가운데 가장 흔한 색으로 바꾼다. 선은 두 칸 이상 이어진 것만 남는다.
 */
export function despeckle(g: Grid): number {
  const { owner, color } = g;
  const fix: number[] = [];
  const nb = [1, -1, W, -W, WH, -WH];
  for (let k = 1; k < D - 1; k++)
    for (let j = 1; j < H - 1; j++) {
      let id = (k * H + j) * W + 1;
      for (let i = 1; i < W - 1; i++, id++) {
        if (owner[id]! < 0 || color[id] !== 0) continue;
        // 열의 맨 앞·맨 뒤 칸(앞모습·뒷모습의 2D 선)은 그대로 둔다
        if (owner[id + WH]! < 0 || owner[id - WH]! < 0) continue;
        let lone = true,
          best = -1,
          bn = 0,
          exposed = false;
        const cnt = new Uint8Array(16);
        for (let t = 0; t < 6; t++) {
          const q = id + nb[t]!;
          if (owner[q]! < 0) {
            exposed = true;
            continue;
          }
          const c = color[q]!;
          if (c === 0) {
            lone = false;
            break;
          }
          if (++cnt[c]! > bn) {
            bn = cnt[c]!;
            best = c;
          }
        }
        if (lone && exposed && best >= 0) fix.push(id, best);
      }
    }
  for (let t = 0; t < fix.length; t += 2) color[fix[t]!] = fix[t + 1]!;
  return fix.length / 2;
}

/**
 * 겉 복셀만 뽑아 STRIDE(10)바이트씩 적는다:
 *   i, j, k(=z+ZOFF), 색, 묶음, nx, ny, nz(×127+128), 면 마스크(+x −x +y −y +z −z 가 드러났는지), 표시(F_SKIN·F_LIT)
 */
export function finish(g: Grid): Surface {
  const { owner, color, parts } = g;
  let cap = 4096,
    out = new Uint8Array(cap * STRIDE),
    n = 0,
    faces = 0;
  const ng = parts.map((p) => p.ngroup ?? p.group & 127);
  for (let k = 0; k < D; k++)
    for (let j = 0; j < H; j++) {
      let id = (k * H + j) * W;
      for (let i = 0; i < W; i++, id++) {
        const o = owner[id]!;
        if (o < 0) continue;
        let m = 0;
        if (i === W - 1 || owner[id + 1]! < 0) m |= 1;
        if (i === 0 || owner[id - 1]! < 0) m |= 2;
        if (j === H - 1 || owner[id + W]! < 0) m |= 4;
        if (j === 0 || owner[id - W]! < 0) m |= 8;
        if (k === D - 1 || owner[id + WH]! < 0) m |= 16;
        if (k === 0 || owner[id - WH]! < 0) m |= 32;
        if (!m) continue;
        const p = parts[o]!;
        let nx: number, ny: number, nz: number;
        const x = i + 0.5,
          y = j + 0.5,
          z = k - ZOFF + 0.5;
        if (p.normal) {
          const v = p.normal(x, y, z);
          nx = v[0]!;
          ny = v[1]!;
          nz = v[2]!;
        } else if (p.sdf && p.nmode !== 'occ') {
          const f = p.nsdf ?? p.sdf,
            e = 0.6;
          nx = f(x + e, y, z) - f(x - e, y, z);
          ny = f(x, y + e, z) - f(x, y - e, z);
          nz = f(x, y, z + e) - f(x, y, z - e);
        } else {
          const gq = ng[o];
          nx = 0;
          ny = 0;
          nz = 0;
          for (let t = 0; t < NB.length; t += 4) {
            const a = NB[t]!,
              b = NB[t + 1]!,
              c = NB[t + 2]!;
            const I = i + a,
              J = j + b,
              K = k + c;
            if (I < 0 || J < 0 || K < 0 || I >= W || J >= H || K >= D) continue;
            const q = owner[id + a + b * W + c * WH]!;
            if (q >= 0 && ng[q] === gq) {
              const wgt = NB[t + 3]!;
              nx -= a * wgt;
              ny -= b * wgt;
              nz -= c * wgt;
            }
          }
          // 한 칸 두께 판: 앞뒤가 대칭이라 기울기가 없다 → 앞을 본다(뒷면은 메시가 뒤집는다)
          if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) < 0.2) nz = 1;
        }
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        if (n === cap) {
          cap *= 2;
          const o2 = new Uint8Array(cap * STRIDE);
          o2.set(out);
          out = o2;
        }
        const b = n * STRIDE;
        out[b] = i;
        out[b + 1] = j;
        out[b + 2] = k;
        out[b + 3] = color[id]!;
        out[b + 4] = p.group;
        out[b + 5] = enc(nx / l);
        out[b + 6] = enc(ny / l);
        out[b + 7] = enc(nz / l);
        out[b + 8] = m;
        out[b + 9] = g.flag[id]!;
        n++;
        faces +=
          (m & 1) +
          ((m >> 1) & 1) +
          ((m >> 2) & 1) +
          ((m >> 3) & 1) +
          ((m >> 4) & 1) +
          ((m >> 5) & 1);
      }
    }
  return { bytes: out.subarray(0, n * STRIDE), surface: n, faces, solid: g.solid };
}
