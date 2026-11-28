/**
 * 알 콕 누르기(#39): 손길 해석과 반응표. 순수 함수만 있다(DOM·시계·무작위 없음).
 *
 * - 화면(EggPoke.svelte)은 이벤트가 올 때 시각(ms)과 좌표를 넣고, 돌려받은 것만 그린다. 테스트가 시계를 쥔다.
 * - 손길: 한 번 누르기(tap) · 길게 누르기 '품기'(hold, 500ms) · 문지르기(rub, 누른 채 좌우로 세 번 넘게 바꿈).
 *   세로로 8px 넘게 움직이면 스크롤로 보고 취소한다(그림만 제자리, 글·신호 없음).
 * - 묶음: 앞 확정과 600ms 안에 다시 누르면 같은 묶음(combo 가 오른다). 마지막 확정 뒤 700ms 조용하면 끝난다.
 *   낭독은 묶음이 끝날 때 한 줄만, 진동 신호는 묶음의 첫 확정과 품기에만(400ms 간격) 낸다.
 * - 쉬기: 3초 안에 열 번 누르면 알이 웅크리고, 1.5초 동안은 '통'만 한다(꾸중하지 않고 쉬어 간다).
 * - 손길은 금 단계·진행·질문을 바꾸지 않는다(그건 답할 때만). 저장하지 않는다(누른 수는 메모리에만).
 */
import TALK_RAW from '../../../data/talk.json';
import { MOVES, type Move, type MoveFrame } from './moves.ts';

export type PokeSide = -1 | 0 | 1;
export type PokeKind = 'tap' | 'hold' | 'rub';

export const POKE = {
  /** 눌린 그림이 보이는 가장 짧은 시간(ms). 이보다 빨리 떼면 몸짓을 그만큼 늦게 시작한다 */
  minSquashMs: 50,
  /** 이만큼 누르고 있으면 품기(ms) */
  holdMs: 500,
  /** 품기 동안 하트가 오르는 간격(ms)과 가장 많은 수 */
  heartEveryMs: 400,
  maxHearts: 3,
  /** 누른 채 움직여도 누름으로 보는 거리(px). 세로로 넘으면 스크롤이다 */
  slopPx: 8,
  /** 문지르기: 좌우를 바꿨다고 보는 거리(px)·창(ms)·바꾼 횟수 */
  rubStepPx: 4,
  rubWindowMs: 800,
  rubTurns: 3,
  /** 묶음: 앞 확정과 이 안(ms)이면 이어 누르기 */
  comboGapMs: 600,
  /** 마지막 확정 뒤 이만큼(ms) 조용하면 묶음이 끝난다 */
  quietMs: 700,
  /** 쉬기: restWindowMs 안에 restCount 번이면 restMs 동안 쉰다 */
  restCount: 10,
  restWindowMs: 3000,
  restMs: 1500,
  /** 진동 신호 사이(ms)와 묶음당 가장 많은 수 */
  cueGapMs: 400,
  cuesPerBundle: 2,
  /** 한 번에 튀는 조각 수(다섯 번째마다 ringBits) */
  maxBits: 3,
  ringBits: 5,
  /** 밭에 이만큼 넘게 떠 있으면 누름 조각은 내지 않는다(답할 때의 반응 몫을 남긴다) */
  fieldRoom: 20,
  /** 글 한 줄이 보이는 시간(ms)·낭독 줄을 비우기까지(ms) */
  sayMs: 2400,
  spokenMs: 2000,
  /** 움직임 줄이기의 멈춘 표시(ms) */
  stillMs: 1200,
  /** 마우스를 올린 지 이만큼(ms) 뒤에 한 번 깜빡인다 */
  hoverBlinkMs: 400,
  blinkMs: 160,
  /** pointer 로 확정한 뒤 이 안(ms)에 오는 click 은 같은 누름이다 */
  clickEchoMs: 800,
  /** 이번 첫 입력에서 이만큼 눌렀으면 부화 인사가 달라진다 */
  greetPokedAt: 12,
} as const;

/** 단추 안에서 누른 자리: 왼쪽 1/3 = -1, 가운데 = 0, 오른쪽 1/3 = +1 */
export function sideOf(x: number, left: number, width: number): PokeSide {
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  const t = (x - left) / width;
  if (t < 1 / 3) return -1;
  if (t >= 2 / 3) return 1;
  return 0;
}

const clamp3 = (n: number) => Math.max(-3, Math.min(3, n));

/** 누른 반대쪽으로 밀리게: 첫 칸의 dx 에 -side 를 더한다(끝은 그대로 제자리) */
export function withLean(move: Move, side: PokeSide): Move {
  if (side === 0 || move.length < 2) return move;
  const [first, ...rest] = move as readonly [MoveFrame, ...MoveFrame[]];
  return [{ ...first, dx: clamp3(first.dx - side) }, ...rest];
}

/** 메아리: 안에서 n 번 두드린다(한 번 200ms) */
export function echoMove(n: number): Move {
  const count = Math.max(1, Math.min(3, Math.round(n)));
  const out: MoveFrame[] = [];
  for (let i = 0; i < count; i += 1)
    out.push({ dx: 1, dy: 0, ms: 60 }, { dx: -1, dy: 0, ms: 60 }, { dx: 0, dy: 0, ms: 80 });
  return out;
}

/** 조각이 튀는 방향(라디안, 0 = 오른쪽, 시계 방향 +). 누른 반대쪽 위로 */
export function fanFor(side: PokeSide): readonly [number, number] {
  if (side < 0) return [Math.PI * 1.4, Math.PI * 1.95];
  if (side > 0) return [Math.PI * 1.05, Math.PI * 1.6];
  return [Math.PI * 1.1, Math.PI * 1.9];
}

// ── 해석기 ───────────────────────────────────────────────────────────

export type RestState = 'start' | 'on' | null;

export interface PokeCommit {
  kind: PokeKind;
  /** 이 묶음에서 몇 번째 확정인지(1부터) */
  combo: number;
  side: PokeSide;
  /** 쉬기 시작('start')·쉬는 중('on') */
  rest: RestState;
  /** 진동·소리 신호를 낼지 */
  cue: boolean;
  /** 이번 화면에서 확정한 수 */
  total: number;
}

export interface PokeStep {
  /** 세로로 움직여 스크롤로 넘어갔다: 그림만 제자리 */
  cancel?: boolean;
  /** 문지르는 방향이 바뀌었다(-1·1). started 면 이번에 문지르기로 넘어갔다 */
  rub?: { dir: -1 | 1; turns: number; started: boolean };
}

export interface PokeTick {
  holdStart?: boolean;
  heart?: boolean;
  /** 다음에 tick 을 부를 시각(ms). null 이면 부를 일 없음 */
  nextAt: number | null;
}

export interface PokeBundle {
  /** 묶음에서 확정한 수 */
  count: number;
  /** 마지막 확정의 combo·종류 */
  combo: number;
  kind: PokeKind;
  /** 묶음 안에서 쉬었는지 */
  rested: boolean;
}

export interface PokeTracker {
  down(now: number, x: number, y: number, side: PokeSide): boolean;
  move(now: number, x: number, y: number): PokeStep | null;
  tick(now: number): PokeTick;
  up(now: number): PokeCommit | null;
  cancel(): void;
  /** 묶음이 끝났으면(마지막 확정 뒤 quietMs) 요약을 한 번 돌려준다 */
  settle(now: number): PokeBundle | null;
  /** 기다리던 묶음을 버린다(질문이 바뀔 때) */
  forget(): void;
  readonly pressing: boolean;
  readonly total: number;
  /** 쉬는 중인지 */
  resting(now: number): boolean;
}

export function createPokeTracker(): PokeTracker {
  let downAt: number | null = null;
  let downX = 0;
  let downY = 0;
  let side: PokeSide = 0;
  /** 누른 자리에서 slop 안에 머물렀는지(품기 자격) */
  let still = true;
  let holding = false;
  let hearts = 0;
  // 문지르기
  let anchorX = 0;
  let dir: -1 | 0 | 1 = 0;
  let turns: number[] = [];
  let rubbing = false;
  // 묶음
  let lastCommitAt: number | null = null;
  let combo = 0;
  let bundle: {
    count: number;
    combo: number;
    kind: PokeKind;
    rested: boolean;
    cues: number;
  } | null = null;
  let recent: number[] = [];
  let restUntil = -Infinity;
  let lastCueAt = -Infinity;
  let total = 0;

  const reset = () => {
    downAt = null;
    still = true;
    holding = false;
    hearts = 0;
    dir = 0;
    turns = [];
    rubbing = false;
  };

  return {
    get pressing() {
      return downAt !== null;
    },
    get total() {
      return total;
    },
    resting(now) {
      return now < restUntil;
    },
    down(now, x, y, at) {
      if (downAt !== null) return false;
      reset();
      downAt = now;
      downX = anchorX = x;
      downY = y;
      side = at;
      return true;
    },
    move(now, x, y) {
      if (downAt === null) return null;
      if (Math.abs(y - downY) > POKE.slopPx && !rubbing) {
        reset();
        return { cancel: true };
      }
      if (Math.abs(x - downX) > POKE.slopPx || Math.abs(y - downY) > POKE.slopPx) still = false;
      const dx = x - anchorX;
      if (Math.abs(dx) < POKE.rubStepPx) return null;
      const next: -1 | 1 = dx > 0 ? 1 : -1;
      anchorX = x;
      if (next === dir) return null;
      const turned = dir !== 0;
      dir = next;
      if (turned) turns.push(now);
      turns = turns.filter((t) => now - t <= POKE.rubWindowMs);
      const started = !rubbing && !holding && turns.length >= POKE.rubTurns;
      if (started) rubbing = true;
      return { rub: { dir: next, turns: turns.length, started } };
    },
    tick(now) {
      if (downAt === null || rubbing) return { nextAt: null };
      if (!holding) {
        if (!still) return { nextAt: null };
        if (now - downAt < POKE.holdMs) return { nextAt: downAt + POKE.holdMs };
        holding = true;
        hearts = 1;
        return { holdStart: true, heart: true, nextAt: downAt + POKE.holdMs + POKE.heartEveryMs };
      }
      if (hearts >= POKE.maxHearts) return { nextAt: null };
      const due = downAt + POKE.holdMs + hearts * POKE.heartEveryMs;
      if (now < due) return { nextAt: due };
      hearts += 1;
      return {
        heart: true,
        nextAt: hearts >= POKE.maxHearts ? null : due + POKE.heartEveryMs,
      };
    },
    up(now) {
      if (downAt === null) return null;
      const startedAt = downAt;
      const kind: PokeKind = holding ? 'hold' : rubbing ? 'rub' : 'tap';
      const at = side;
      reset();
      total += 1;
      const joined =
        bundle !== null && lastCommitAt !== null && startedAt - lastCommitAt <= POKE.comboGapMs;
      if (!joined) bundle = { count: 0, combo: 0, kind, rested: false, cues: 0 };
      const b = bundle as NonNullable<typeof bundle>;
      combo = joined ? combo + 1 : 1;
      lastCommitAt = now;
      b.count += 1;
      b.combo = combo;
      b.kind = kind;
      let rest: RestState = null;
      if (now < restUntil) rest = 'on';
      else {
        recent = recent.filter((t) => now - t < POKE.restWindowMs);
        recent.push(now);
        if (recent.length >= POKE.restCount) {
          rest = 'start';
          restUntil = now + POKE.restMs;
          recent = [];
        }
      }
      if (rest) b.rested = true;
      const cue =
        rest === null &&
        (b.count === 1 || kind === 'hold') &&
        now - lastCueAt > POKE.cueGapMs &&
        b.cues < POKE.cuesPerBundle;
      if (cue) {
        lastCueAt = now;
        b.cues += 1;
      }
      return { kind, combo, side: at, rest, cue, total };
    },
    cancel() {
      reset();
    },
    settle(now) {
      if (!bundle || lastCommitAt === null || downAt !== null) return null;
      if (now - lastCommitAt < POKE.quietMs) return null;
      const { count, combo: c, kind, rested } = bundle;
      bundle = null;
      combo = 0;
      return { count, combo: c, kind, rested };
    },
    forget() {
      bundle = null;
      combo = 0;
    },
  };
}

// ── 반응표 ───────────────────────────────────────────────────────────

export type PokeLineKey =
  | 'tap0'
  | 'tap1'
  | 'tap2'
  | 'tap3'
  | 'tap4'
  | 'few'
  | 'hop'
  | 'many'
  | 'readyMany'
  | 'rest'
  | 'hold'
  | 'rub'
  | 'echo';

export type BitShape = 'fan' | 'down' | 'ring';

export interface PokeBits {
  sprite: string | readonly string[];
  count: number;
  shape: BitShape;
  frames?: number;
}

export interface PokeRecipe {
  /** 틀 몸짓(기울임까지 들어 있다). null 이면 몸짓 없음 */
  move: Move | null;
  bits: PokeBits | null;
  /** 눈: 0 뜬 눈 · 1 깜빡 · 2 말풍선 쪽 */
  peek: { frame: 0 | 1 | 2; ms: number } | null;
  /** 안에서 두드리는 표시(몸짓 시작에서 at ms 뒤, 오른쪽 r · 왼쪽 l) */
  knock: readonly { at: number; side: 'r' | 'l' }[];
  /** 움직임 줄이기의 멈춘 표시(하트 한 장) */
  still: boolean;
  line: PokeLineKey;
}

export interface PokeInput {
  kind: PokeKind;
  /** 금 단계(0~4) */
  stage: number;
  combo: number;
  side: PokeSide;
  rest: RestState;
  reduced: boolean;
  /** 답할 때의 반응(react)이 돌고 있다: 글만 */
  busy: boolean;
  /** 밭에 조각을 더 띄울 자리가 있는지 */
  roomy: boolean;
}

/** 금 단계마다의 조각(한 번 누르기) */
const STAGE_BITS: readonly (PokeBits | null)[] = [
  { sprite: 'fxc-spark', count: 1, shape: 'fan' },
  { sprite: 'fxc-dust', count: 2, shape: 'down', frames: 3 },
  { sprite: 'fxc-spark', count: 2, shape: 'fan' },
  { sprite: ['fxc-spark', 'fxc-spark', 'p-star'], count: 3, shape: 'fan' },
  null,
];

/** 누른 반대쪽(두드림 표시) */
const away = (side: PokeSide): 'r' | 'l' => (side > 0 ? 'l' : 'r');

function lineKey(input: PokeInput): PokeLineKey {
  if (input.rest) return 'rest';
  if (input.kind === 'hold') return 'hold';
  if (input.kind === 'rub') return 'rub';
  const stage = clampStage(input.stage);
  if (input.combo <= 1) return `tap${stage}` as PokeLineKey;
  if (stage === 4 && input.combo >= 3) return 'readyMany';
  if (input.combo % 5 === 0) return 'hop';
  if (input.combo >= 6) return 'many';
  return 'few';
}

function clampStage(stage: number): 0 | 1 | 2 | 3 | 4 {
  return Math.max(0, Math.min(4, Math.floor(Number.isFinite(stage) ? stage : 0))) as
    0 | 1 | 2 | 3 | 4;
}

const bitsOf = (base: PokeBits | null, count: number): PokeBits | null =>
  base && count > 0 ? { ...base, count: Math.min(POKE.maxBits, count) } : null;

/** 금 단계마다 한 번 누르기의 몸짓: 자다 화들짝 · 부르르 · 두리번 · 콩콩 */
const STAGE_TAP: readonly Move[] = [MOVES.startle, MOVES.jolt, MOVES.lookAround, MOVES.boing2];

/**
 * 손길 하나에 대한 반응. 단계(0~4) × 이어 누른 수 × 누른 자리로 매번 달라진다.
 * 이어 누르기: 1 단계별 몸짓 · 2 콩콩 · 3~4 꼼지락 · 다섯 번째마다 큰 폴짝과 별 둘레 · 그 사이(6~9)는 콩콩·꼼지락을 번갈아.
 */
export function pokeReaction(input: PokeInput): PokeRecipe {
  const line = lineKey(input);
  const none: PokeRecipe = { move: null, bits: null, peek: null, knock: [], still: false, line };
  if (input.reduced) return { ...none, still: true };
  if (input.busy) return none;
  if (input.rest === 'start') return { ...none, move: MOVES.tuck };
  if (input.rest === 'on') return { ...none, move: MOVES.bump };
  if (input.kind === 'hold') return { ...none, move: MOVES.hop };
  if (input.kind === 'rub') return none;

  const stage = clampStage(input.stage);
  const base = STAGE_BITS[stage] ?? null;
  const room = (bits: PokeBits | null) => (input.roomy ? bits : null);
  const lean = (move: Move) => withLean(move, input.side);
  const combo = Math.max(1, Math.floor(input.combo));

  if (stage === 4) {
    if (combo >= 3)
      return {
        ...none,
        move: MOVES.knock,
        knock: [
          { at: 0, side: 'r' },
          { at: 200, side: 'l' },
        ],
      };
    if (combo === 2)
      return {
        ...none,
        move: lean(MOVES.boing2),
        bits: room({ sprite: 'fxc-spark', count: 1, shape: 'fan' }),
        knock: [{ at: 200, side: away(input.side) }],
      };
    return {
      ...none,
      move: lean(MOVES.readyPoke),
      peek: { frame: 2, ms: 300 },
      knock: [{ at: 260, side: away(input.side) }],
    };
  }
  if (combo === 1)
    return {
      ...none,
      move: lean(STAGE_TAP[stage] ?? MOVES.boing),
      bits: room(base),
      peek:
        stage === 2 ? { frame: 1, ms: POKE.blinkMs } : stage === 3 ? { frame: 2, ms: 300 } : null,
    };
  if (combo === 2)
    return { ...none, move: lean(MOVES.boing2), bits: room(bitsOf(base, (base?.count ?? 0) + 1)) };
  if (combo <= 4) return { ...none, move: lean(MOVES.giggle), bits: room(bitsOf(base, 2)) };
  if (combo % 5 === 0)
    return {
      ...none,
      move: MOVES.bigHop,
      bits: room({ sprite: 'p-star', count: POKE.ringBits, shape: 'ring' }),
    };
  return {
    ...none,
    move: lean(combo % 2 === 0 ? MOVES.boing2 : MOVES.giggle),
    bits: room(bitsOf(base, 1)),
  };
}

/** 묶음이 끝났을 때 메아리(안에서 같은 수만큼 두드림)를 할지: 금이 길어진 뒤(2단계~), 두세 번 눌렀을 때 */
export function echoCount(bundle: PokeBundle, stage: number): 2 | 3 | null {
  if (stage < 2 || bundle.rested || bundle.kind !== 'tap') return null;
  return bundle.count === 2 || bundle.count === 3 ? bundle.count : null;
}

// ── 글 ───────────────────────────────────────────────────────────────

type SfxKey = 'few' | 'hop' | 'many' | 'readyMany' | 'rest' | 'hold' | 'rub' | 'echo';

interface PokeTalk {
  tap: readonly (readonly string[])[];
  few: readonly string[];
  hop: readonly string[];
  many: readonly string[];
  readyMany: readonly string[];
  rest: readonly string[];
  hold: readonly string[];
  rub: readonly string[];
  echo: readonly string[];
  sfx: Record<SfxKey, string> & { tap: readonly string[] };
  /**
   * 움직임 줄이기(알이 멈춰 있다)의 글: 몸짓을 말하는 키만 바꿔 둔다. 소리·느낌·눈·멈춘 하트만 말한다.
   * 여기 없는 키(품기·문지르기·똑똑·메아리)는 원래도 몸짓을 말하지 않는다.
   */
  still: {
    tap: readonly (readonly string[])[];
    few: readonly string[];
    hop: readonly string[];
    many: readonly string[];
    rest: readonly string[];
    sfx: { tap: readonly string[] } & Partial<Record<SfxKey, string>>;
  };
}

const LINES = TALK_RAW.egg.poke as PokeTalk;

type StillKey = 'few' | 'hop' | 'many' | 'rest';
const STILL_KEYS: readonly string[] = ['few', 'hop', 'many', 'rest'] satisfies StillKey[];

/** 글 키의 문장들. reduced 면 움직임 줄이기의 글(몸짓을 말하지 않는다) */
export function pokeLines(key: PokeLineKey, reduced = false): readonly string[] {
  if (key.startsWith('tap')) {
    const stage = Number(key.slice(3));
    return (reduced ? LINES.still.tap[stage] : LINES.tap[stage]) ?? [];
  }
  if (reduced && STILL_KEYS.includes(key)) return LINES.still[key as StillKey];
  return LINES[key as Exclude<PokeLineKey, `tap${number}`>];
}

/** 좁은 무대에 쓰는 소리 글자. reduced 면 몸짓 글자(폴짝·꼼지락) 대신 소리·느낌 글자 */
export function pokeSfx(key: PokeLineKey, reduced = false): string {
  if (key.startsWith('tap')) {
    const stage = Number(key.slice(3));
    return (reduced ? LINES.still.sfx.tap[stage] : LINES.sfx.tap[stage]) ?? '';
  }
  const k = key as SfxKey;
  return (reduced ? LINES.still.sfx[k] : undefined) ?? LINES.sfx[k];
}

/** 문장을 차례로 돌려 고른다(무작위 없음). 바로 앞 문장과 같으면 하나 건너뛴다 */
export function pickPokeLine(
  key: PokeLineKey,
  turn: number,
  last: string | null,
  reduced = false,
): string {
  const lines = pokeLines(key, reduced);
  if (lines.length === 0) return '';
  const n = lines.length;
  let index = ((Math.floor(turn) % n) + n) % n;
  if (n > 1 && lines[index] === last) index = (index + 1) % n;
  return lines[index] as string;
}
