/**
 * 입자(껍데기 조각·색종이·깃·반짝이·빛 모으기). DOM 을 만지지 않는 순수 계산이라 단위 테스트로 지킨다.
 *
 * - 입자 밭(Field) 하나가 입자 목록과 시드 난수를 가진다. 시드가 같고 부른 순서가 같으면 결과가 같다.
 * - 시간은 1/60초 고정 단계로 나아간다(stepField 가 남은 시간을 모아 둔다). 프레임이 끊겨도 궤적이 같다.
 * - 한 밭의 입자는 max(기본 64)개를 넘지 않는다. 넘치면 오래된 것부터 버린다.
 * - 그리기는 Sink 에 맡긴다(무대 캔버스·효과 층 어느 쪽이든). 넘겨주는 좌표·크기는 모두 정수다(도트가 번지지 않게).
 * - 좌표 단위는 그리는 쪽이 정한다: 무대 캔버스면 스프라이트 픽셀, 효과 층이면 CSS px. 속도는 단위/초, 가속도는 단위/초².
 * - 움직임 줄이기는 루프에 얹는 쪽(sparkle.ts 의 runField)이 본다. 여기는 계산만 한다.
 */

/** 한 밭의 입자 상한(기본) */
export const MAX_PARTICLES = 64;
/** 고정 단계(ms) */
export const STEP_MS = 1000 / 60;
/** 부동소수 오차로 한 단계를 놓치지 않게 두는 틈 */
const EPSILON = 1e-6;
/** 느린 기기 안전장치: 프레임 간격이 이 값을 넘는 일이 이어지면 상한을 절반으로 줄인다 */
const SLOW_FRAME_MS = 33;
const SLOW_FRAMES = 3;
const MIN_BUDGET = 8;

/** 시드 난수(0 이상 1 미만). 같은 시드는 같은 수열 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 정해진 길(시작 → 굽은 점 → 끝)을 따라가는 입자의 길. 빛 모으기·깃 자람 */
export interface Path {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 중력(단위/초²). 길을 따라가는 입자는 쓰지 않는다 */
  ay: number;
  /** 태어나기 전 기다림(ms). 0 이 될 때까지 보이지 않고 나이도 먹지 않는다 */
  delay: number;
  age: number;
  ttl: number;
  kind: 'rect' | 'sprite';
  /** rect: 가로·세로와 색(색 이름은 그리는 쪽이 푼다) */
  w: number;
  h: number;
  color: string;
  /** rect: 수명의 마지막 1/3 에서 절반 크기로 줄었다 사라진다(흐려지지 않는다) */
  shrink: boolean;
  /** sprite: 이름·프레임 수·프레임 간격(ms). 간격이 0 이면 수명에 걸쳐 한 번만 넘긴다 */
  sprite: string;
  frames: number;
  frameMs: number;
  frame: number;
  path: Path | null;
}

export interface Field {
  particles: Particle[];
  /** 입자 상한 */
  max: number;
  rand: () => number;
  /** 고정 단계에 못 미쳐 남은 시간(ms) */
  acc: number;
  /** 이어진 느린 프레임 수와 상한을 이미 줄였는지(throttleField) */
  slow: number;
  halved: boolean;
}

export interface FieldOptions {
  /** 시드. 주지 않으면 그때그때 다르다 */
  seed?: number;
  max?: number;
}

export function createField(options: FieldOptions = {}): Field {
  const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
  return {
    particles: [],
    max: Math.max(1, Math.floor(options.max ?? MAX_PARTICLES)),
    rand: mulberry32(seed),
    acc: 0,
    slow: 0,
    halved: false,
  };
}

export function clearField(field: Field): void {
  field.particles.length = 0;
  field.acc = 0;
}

/** 입자의 생김새. sprite 를 주면 스프라이트, 아니면 색 네모 */
export interface ParticleLook {
  /** 스프라이트 이름(여럿이면 번갈아) */
  sprite?: string | readonly string[];
  frames?: number;
  frameMs?: number;
  /** 네모 색(번갈아 쓴다) */
  colors?: readonly string[];
  /** 네모 크기 [가로, 세로](번갈아 쓴다). 기본 1×1 */
  sizes?: readonly (readonly [number, number])[];
  shrink?: boolean;
}

type Range = number | readonly [number, number];

function pick(rand: () => number, range: Range): number {
  if (typeof range === 'number') return range;
  return range[0] + (range[1] - range[0]) * rand();
}

function blank(look: ParticleLook, index: number): Particle {
  const sprites = typeof look.sprite === 'string' ? [look.sprite] : (look.sprite ?? []);
  const sprite = sprites.length > 0 ? (sprites[index % sprites.length] as string) : '';
  const colors = look.colors ?? [];
  const sizes = look.sizes ?? [];
  const size = sizes.length > 0 ? (sizes[index % sizes.length] as readonly [number, number]) : null;
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ay: 0,
    delay: 0,
    age: 0,
    ttl: 0,
    kind: sprite ? 'sprite' : 'rect',
    w: Math.max(1, Math.round(size?.[0] ?? 1)),
    h: Math.max(1, Math.round(size?.[1] ?? 1)),
    color: colors.length > 0 ? (colors[index % colors.length] as string) : '',
    shrink: look.shrink ?? false,
    sprite,
    frames: Math.max(1, Math.floor(look.frames ?? 1)),
    frameMs: Math.max(0, look.frameMs ?? 0),
    frame: 0,
    path: null,
  };
}

function push(field: Field, particle: Particle): void {
  while (field.particles.length >= field.max) field.particles.shift();
  field.particles.push(particle);
}

export interface BurstOptions {
  x: number;
  y: number;
  count: number;
  /** 처음 빠르기(단위/초) */
  speed: Range;
  /** 퍼지는 각도 범위(라디안, 0 = 오른쪽, 시계 방향이 +). 기본은 사방 */
  angle?: readonly [number, number];
  /** 처음에 위로 띄우는 빠르기(단위/초). 포물선을 그리게 */
  lift?: number;
  /** 중력(단위/초²) */
  gravity?: number;
  /** 수명(ms) */
  ttl: Range;
  /** 태어나기 전 기다림(ms) */
  delay?: Range;
  look: ParticleLook;
}

/** 한 점에서 바깥으로 터진다: 껍데기 조각·색종이·깃 터짐·누른 자리 조각 */
export function emitBurst(field: Field, options: BurstOptions): void {
  const { rand } = field;
  const n = Math.max(0, Math.floor(options.count));
  const [from, to] = options.angle ?? [0, Math.PI * 2];
  const full = options.angle === undefined;
  const turn = full ? rand() * Math.PI * 2 : 0;
  for (let i = 0; i < n; i += 1) {
    // 고르게 나눈 각도에 조금씩 흔들림을 준다(한쪽으로 몰리지 않게)
    const slot = full ? i / n : n === 1 ? 0.5 : i / (n - 1);
    const jitter = ((rand() - 0.5) * (to - from)) / Math.max(1, n) / 1.5;
    const angle = turn + from + slot * (to - from) + jitter;
    const speed = pick(rand, options.speed);
    const p = blank(options.look, i);
    p.x = options.x;
    p.y = options.y;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - (options.lift ?? 0);
    p.ay = options.gravity ?? 0;
    p.ttl = Math.max(STEP_MS, pick(rand, options.ttl));
    p.delay = Math.max(0, pick(rand, options.delay ?? 0));
    push(field, p);
  }
}

export interface ConvergeOptions {
  /** 모이는 곳 */
  x: number;
  y: number;
  count: number;
  /** 출발하는 원의 반지름 */
  radius: Range;
  /** 길이 굽는 정도(반지름에 대한 비율). 기본 0.4 */
  bend?: number;
  ttl: Range;
  /** 입자마다 이만큼씩 늦게 출발한다(ms) */
  stagger?: number;
  look: ParticleLook;
}

/** 둘레의 원에서 한 점으로 굽은 길을 그리며 모인다: 승진 빛 모으기 */
export function emitConverge(field: Field, options: ConvergeOptions): void {
  const { rand } = field;
  const n = Math.max(0, Math.floor(options.count));
  const turn = rand() * Math.PI * 2;
  const bend = options.bend ?? 0.4;
  for (let i = 0; i < n; i += 1) {
    const angle = turn + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const radius = pick(rand, options.radius);
    const x0 = options.x + Math.cos(angle) * radius;
    const y0 = options.y + Math.sin(angle) * radius;
    // 굽은 점: 길의 가운데에서 옆으로 비켜난 곳(모두 같은 쪽으로 돌아 소용돌이처럼 보인다)
    const cx = (x0 + options.x) / 2 - Math.sin(angle) * radius * bend;
    const cy = (y0 + options.y) / 2 + Math.cos(angle) * radius * bend;
    const p = blank(options.look, i);
    p.x = x0;
    p.y = y0;
    p.path = { x0, y0, cx, cy, x1: options.x, y1: options.y };
    p.ttl = Math.max(STEP_MS, pick(rand, options.ttl));
    p.delay = i * Math.max(0, options.stagger ?? 0);
    push(field, p);
  }
}

export interface RiseOptions {
  from: { x: number; y: number };
  to: { x: number; y: number };
  count?: number;
  /** 길이 옆으로 굽는 폭(단위). 기본 6. 입자마다 좌우가 번갈아 바뀐다 */
  sway?: number;
  ttl: Range;
  stagger?: number;
  look: ParticleLook;
}

/** 아래에서 떠올라 한 점에 닿는다: 깃 자람·동전 */
export function emitRise(field: Field, options: RiseOptions): void {
  const { rand } = field;
  const n = Math.max(0, Math.floor(options.count ?? 1));
  const sway = options.sway ?? 6;
  for (let i = 0; i < n; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const x0 = options.from.x + (n > 1 ? (rand() - 0.5) * sway : 0);
    const y0 = options.from.y;
    const p = blank(options.look, i);
    p.x = x0;
    p.y = y0;
    p.path = {
      x0,
      y0,
      cx: (x0 + options.to.x) / 2 + side * sway,
      cy: (y0 + options.to.y) / 2,
      x1: options.to.x,
      y1: options.to.y,
    };
    p.ttl = Math.max(STEP_MS, pick(rand, options.ttl));
    p.delay = i * Math.max(0, options.stagger ?? 0);
    push(field, p);
  }
}

function tick(field: Field): void {
  const s = STEP_MS / 1000;
  const list = field.particles;
  let kept = 0;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i] as Particle;
    if (p.delay > EPSILON) {
      p.delay = Math.max(0, p.delay - STEP_MS);
      list[kept] = p;
      kept += 1;
      continue;
    }
    p.age += STEP_MS;
    if (p.age + EPSILON >= p.ttl) continue;
    const t = p.age / p.ttl;
    if (p.path) {
      // 처음엔 빠르고 닿을 때 느려진다
      const e = 1 - (1 - t) * (1 - t);
      const u = 1 - e;
      p.x = u * u * p.path.x0 + 2 * u * e * p.path.cx + e * e * p.path.x1;
      p.y = u * u * p.path.y0 + 2 * u * e * p.path.cy + e * e * p.path.y1;
    } else {
      p.vy += p.ay * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
    }
    if (p.frames > 1) {
      p.frame =
        p.frameMs > 0
          ? Math.floor(p.age / p.frameMs) % p.frames
          : Math.min(p.frames - 1, Math.floor(t * p.frames));
    }
    list[kept] = p;
    kept += 1;
  }
  list.length = kept;
}

/** dt(ms)만큼 나아간다. 남은(기다리는 것 포함) 입자 수를 돌려준다 */
export function stepField(field: Field, dtMs: number): number {
  if (field.particles.length === 0) {
    field.acc = 0;
    return 0;
  }
  field.acc += Math.max(0, dtMs);
  while (field.acc + EPSILON >= STEP_MS) {
    field.acc -= STEP_MS;
    tick(field);
    if (field.particles.length === 0) {
      field.acc = 0;
      break;
    }
  }
  return field.particles.length;
}

/**
 * 느린 기기 안전장치. 프레임 간격(ms)을 넘겨주면, 33ms 를 넘는 프레임이 세 번 이어질 때
 * 그 밭의 상한을 한 번만 절반으로 줄인다. 줄였으면 true.
 */
export function throttleField(field: Field, frameMs: number): boolean {
  if (field.halved) return false;
  field.slow = frameMs > SLOW_FRAME_MS ? field.slow + 1 : 0;
  if (field.slow < SLOW_FRAMES) return false;
  field.halved = true;
  field.max = Math.max(Math.min(MIN_BUDGET, field.max), Math.floor(field.max / 2));
  while (field.particles.length > field.max) field.particles.shift();
  return true;
}

/** 그리는 쪽. 좌표·크기는 정수로만 온다 */
export interface Sink {
  /** 색 네모. x, y 는 왼쪽 위 */
  rect(x: number, y: number, w: number, h: number, color: string): void;
  /** 스프라이트. x, y 는 입자의 가운데(스프라이트 기준점을 어디에 둘지는 그리는 쪽이 정한다) */
  sprite(name: string, frame: number, x: number, y: number): void;
}

/** 지금 보이는 입자를 그린다(기다리는 입자는 건너뛴다) */
export function drawField(field: Field, sink: Sink): void {
  for (const p of field.particles) {
    if (p.delay > EPSILON) continue;
    if (p.kind === 'sprite') {
      sink.sprite(p.sprite, p.frame, Math.round(p.x), Math.round(p.y));
      continue;
    }
    const small = p.shrink && p.age > p.ttl * 0.66;
    const w = small ? Math.max(1, Math.round(p.w / 2)) : p.w;
    const h = small ? Math.max(1, Math.round(p.h / 2)) : p.h;
    sink.rect(Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h, p.color);
  }
}
