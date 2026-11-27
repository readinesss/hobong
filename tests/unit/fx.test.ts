/**
 * 연출 엔진(src/lib/fx)과 진동(src/lib/app/haptics.ts).
 * - 입자: 시드가 같으면 같은 결과, 상한, 정수 좌표
 * - 시간표: 차례대로, 건너뛰기·움직임 줄이기면 끝 장면만
 * - 번쩍임 안전: 어느 1초 창에서도 같은 속성 전환 3회 미만, 넓은 면의 밝기는 300ms 이상 페이드
 * - 진동: 꺼짐·줄이기·미지원·가려짐이면 navigator.vibrate 를 부르지 않는다
 * DOM 이 없는 node 환경이라 document·navigator·requestAnimationFrame 은 흉내를 쓴다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUE_HAPTICS,
  HAPTIC_PATTERNS,
  haptic,
  hapticsEnabled,
  hapticsSupported,
  linkHaptics,
  setHapticsEnabled,
  stopHaptics,
} from '../../src/lib/app/haptics.ts';
import { activeJobs, disposeFx, env, MAX_DT, running, sleep, wake } from '../../src/lib/fx/core.ts';
import { CUE_NAMES, cueListeners, emitCue, onCue, type Cue } from '../../src/lib/fx/cues.ts';
import { moveAt, moveDuration, MOVES, WIGGLE_EVERY_MS } from '../../src/lib/fx/moves.ts';
import {
  createField,
  drawField,
  emitBurst,
  emitConverge,
  emitRise,
  MAX_PARTICLES,
  mulberry32,
  STEP_MS,
  stepField,
  throttleField,
  type Field,
  type Sink,
} from '../../src/lib/fx/particles.ts';
import {
  hatchScene,
  playScene,
  promoteScene,
  rollMs,
  SCENE_SAMPLES,
  stepUpScene,
} from '../../src/lib/fx/scenes.ts';
import {
  clearSparkles,
  MAX_SPARKLES,
  runField,
  sparkle,
  sparkleCount,
} from '../../src/lib/fx/sparkle.ts';
import {
  blinkFrame,
  createTimeline,
  FLASH,
  flashProblems,
  flipCounts,
  play,
  type SafeStep,
} from '../../src/lib/fx/timeline.ts';

// ── 흉내 ─────────────────────────────────────────────────────────────

/** requestAnimationFrame 흉내: frame(ms) 을 부를 때만 한 프레임이 지나간다 */
function fakeFrames() {
  let queue: Array<{ id: number; run: (now: number) => void }> = [];
  let nextId = 0;
  let now = 1000;
  vi.stubGlobal('requestAnimationFrame', (run: (now: number) => void) => {
    nextId += 1;
    queue.push({ id: nextId, run });
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue = queue.filter((entry) => entry.id !== id);
  });
  return {
    frame(ms = 16) {
      now += ms;
      const due = queue;
      queue = [];
      for (const entry of due) entry.run(now);
    },
    /** 여러 프레임을 흘려보낸다 */
    run(totalMs: number, stepMs = 16) {
      for (let t = 0; t < totalMs; t += stepMs) this.frame(stepMs);
    },
    get pending() {
      return queue.length;
    },
  };
}

interface FakeDocument {
  hidden: boolean;
  motion: string | null;
}

/** document 흉내: html[data-motion] 과 hidden 만 있다(createElement 가 없어, 그리려 들면 바로 드러난다) */
function fakeDocument(init: Partial<FakeDocument> = {}): FakeDocument {
  const state: FakeDocument = { hidden: false, motion: null, ...init };
  vi.stubGlobal('document', {
    get hidden() {
      return state.hidden;
    },
    documentElement: {
      getAttribute: (name: string) => (name === 'data-motion' ? state.motion : null),
    },
  });
  return state;
}

function fakeNavigator(options: { vibrate?: boolean; active?: boolean | null } = {}) {
  const vibrate = vi.fn((_pattern: number | number[]) => true);
  const value: Record<string, unknown> = {};
  if (options.vibrate ?? true) value.vibrate = vibrate;
  if (options.active !== null) value.userActivation = { hasBeenActive: options.active ?? true };
  vi.stubGlobal('navigator', value);
  return vibrate;
}

afterEach(() => {
  disposeFx();
  clearSparkles();
  stopHaptics();
  setHapticsEnabled(true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 입자 ─────────────────────────────────────────────────────────────

/** 세 가지 뿜기를 모두 쓴 밭 */
function sampleField(seed: number, max?: number): Field {
  const field = createField({ seed, max });
  emitBurst(field, {
    x: 24,
    y: 30,
    count: 8,
    speed: [20, 40],
    lift: 30,
    gravity: 160,
    ttl: [400, 600],
    look: { sprite: ['p-shell-a', 'p-shell-b'] },
  });
  emitBurst(field, {
    x: 24,
    y: 20,
    count: 24,
    speed: [30, 70],
    angle: [-Math.PI, 0],
    gravity: 120,
    ttl: [500, 700],
    delay: [0, 120],
    look: {
      colors: ['2', '4', '6', '9', 'a'],
      sizes: [
        [1, 2],
        [2, 1],
      ],
      shrink: true,
    },
  });
  emitConverge(field, {
    x: 24,
    y: 28,
    count: 20,
    radius: [26, 32],
    ttl: [400, 600],
    stagger: 10,
    look: { sprite: 'p-glint', frames: 2, frameMs: 120 },
  });
  emitRise(field, {
    from: { x: 24, y: 47 },
    to: { x: 30, y: 26 },
    ttl: 400,
    look: { sprite: 'p-feather' },
  });
  return field;
}

const snapshot = (field: Field) => JSON.stringify(field.particles);

/** 프레임 간격이 들쭉날쭉한 진행 */
const UNEVEN = [16, 17, 33, 8, 16, 50, 16, 4, 21, 16, 16, 40, 16, 16, 9, 16];

describe('입자: 시드', () => {
  it('mulberry32 는 0 이상 1 미만이고 같은 시드는 같은 수열', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 50 }, () => a());
    expect(seqA).toEqual(Array.from({ length: 50 }, () => b()));
    expect(seqA).not.toEqual(Array.from({ length: 50 }, () => c()));
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('시드가 같으면 뿜은 직후와 나아간 뒤가 모두 같다', () => {
    const a = sampleField(7);
    const b = sampleField(7);
    expect(snapshot(a)).toBe(snapshot(b));
    for (const dt of UNEVEN) {
      stepField(a, dt);
      stepField(b, dt);
      expect(snapshot(a)).toBe(snapshot(b));
    }
    expect(a.particles.length).toBeGreaterThan(0);
  });

  it('시드가 다르면 다르다', () => {
    expect(snapshot(sampleField(7))).not.toBe(snapshot(sampleField(8)));
  });

  it('프레임을 어떻게 나눠도 같은 자리에 온다(고정 단계)', () => {
    const a = sampleField(3);
    const b = sampleField(3);
    for (let i = 0; i < 12; i += 1) stepField(a, STEP_MS);
    stepField(b, STEP_MS * 5);
    stepField(b, STEP_MS * 7);
    expect(a.particles.length).toBe(b.particles.length);
    a.particles.forEach((p, i) => {
      const q = b.particles[i]!;
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
      expect(q.age).toBeCloseTo(p.age, 6);
    });
  });
});

describe('입자: 상한', () => {
  it('기본 상한은 64개. 넘치면 오래된 것부터 버린다', () => {
    expect(MAX_PARTICLES).toBe(64);
    const field = createField({ seed: 1 });
    for (let round = 0; round < 10; round += 1) {
      emitBurst(field, {
        x: round,
        y: 0,
        count: 30,
        speed: 10,
        ttl: 5000,
        look: { colors: ['4'] },
      });
      expect(field.particles.length).toBeLessThanOrEqual(MAX_PARTICLES);
    }
    expect(field.particles.length).toBe(MAX_PARTICLES);
    // 남은 것은 마지막에 뿜은 것들(x 9 가 30개, 그 앞 8 이 30개, 7 이 4개)
    const born = field.particles.map((p) => p.x);
    expect(born.filter((x) => x === 9)).toHaveLength(30);
    expect(born.filter((x) => x === 7)).toHaveLength(4);
    expect(Math.min(...born)).toBe(7);
  });

  it('한 번에 상한보다 많이 뿜어도, 나아가는 동안에도 넘지 않는다', () => {
    const field = sampleField(5, 16);
    expect(field.particles.length).toBe(16);
    emitConverge(field, { x: 0, y: 0, count: 500, radius: 20, ttl: 300, look: {} });
    expect(field.particles.length).toBe(16);
    for (const dt of UNEVEN) expect(stepField(field, dt)).toBeLessThanOrEqual(16);
  });

  it('수명이 다하면 사라지고, 밭이 비면 남은 시간도 비운다', () => {
    const field = sampleField(9);
    let left = field.particles.length;
    for (let t = 0; t < 2000 && left > 0; t += 16) left = stepField(field, 16);
    expect(left).toBe(0);
    expect(field.particles).toHaveLength(0);
    expect(field.acc).toBe(0);
  });

  it('느린 기기: 33ms 넘는 프레임이 세 번 이어지면 상한을 한 번만 절반으로', () => {
    const field = sampleField(2);
    expect(throttleField(field, 40)).toBe(false);
    expect(throttleField(field, 16)).toBe(false); // 이어지지 않으면 다시 센다
    expect(throttleField(field, 40)).toBe(false);
    expect(throttleField(field, 45)).toBe(false);
    expect(throttleField(field, 50)).toBe(true);
    expect(field.max).toBe(32);
    expect(field.particles.length).toBeLessThanOrEqual(32);
    for (let i = 0; i < 10; i += 1) expect(throttleField(field, 50)).toBe(false);
    expect(field.max).toBe(32);
  });
});

describe('입자: 그리기', () => {
  it('그리는 쪽에 넘기는 좌표·크기는 모두 정수', () => {
    for (const seed of [1, 2, 3, 99]) {
      const field = sampleField(seed);
      let calls = 0;
      const sink: Sink = {
        rect(x, y, w, h, color) {
          calls += 1;
          for (const v of [x, y, w, h]) expect(Number.isInteger(v)).toBe(true);
          expect(w).toBeGreaterThanOrEqual(1);
          expect(h).toBeGreaterThanOrEqual(1);
          expect(color).toMatch(/^[2469a]$/);
        },
        sprite(name, frame, x, y) {
          calls += 1;
          for (const v of [frame, x, y]) expect(Number.isInteger(v)).toBe(true);
          expect(name).not.toBe('');
          expect(frame).toBeGreaterThanOrEqual(0);
          expect(frame).toBeLessThan(2);
        },
      };
      for (const dt of [...UNEVEN, ...UNEVEN]) {
        stepField(field, dt);
        drawField(field, sink);
      }
      expect(calls).toBeGreaterThan(100);
    }
  });

  it('입자 자리는 소수여도(부드러운 궤적) 그릴 때만 반올림한다', () => {
    const field = sampleField(4);
    stepField(field, 100);
    expect(field.particles.some((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y))).toBe(
      true,
    );
  });

  it('기다리는 입자는 그리지 않고 나이도 먹지 않는다', () => {
    const field = createField({ seed: 1 });
    emitBurst(field, { x: 0, y: 0, count: 1, speed: 10, ttl: 200, delay: 100, look: {} });
    const seen: number[] = [];
    const sink: Sink = { rect: (x) => seen.push(x), sprite: () => undefined };
    stepField(field, 50);
    drawField(field, sink);
    expect(seen).toHaveLength(0);
    expect(field.particles[0]?.age).toBe(0);
    stepField(field, 100);
    drawField(field, sink);
    expect(seen).toHaveLength(1);
    expect(field.particles[0]?.age).toBeGreaterThan(0);
  });

  it('줄어드는 네모는 수명의 마지막 1/3 에서 절반 크기', () => {
    const field = createField({ seed: 1 });
    emitBurst(field, {
      x: 10,
      y: 10,
      count: 1,
      speed: 0,
      ttl: 300,
      look: { colors: ['4'], sizes: [[6, 6]], shrink: true },
    });
    const sizes: number[] = [];
    const sink: Sink = { rect: (_x, _y, w) => sizes.push(w), sprite: () => undefined };
    stepField(field, 100);
    drawField(field, sink);
    stepField(field, 150);
    drawField(field, sink);
    expect(sizes).toEqual([6, 3]);
  });

  it('모으기·떠오르기는 목표에 닿으며 끝난다', () => {
    const gather = createField({ seed: 6 });
    emitConverge(gather, { x: 24, y: 28, count: 20, radius: 30, ttl: 500, look: {} });
    const far = gather.particles.map((p) => Math.hypot(p.x - 24, p.y - 28));
    expect(Math.min(...far)).toBeGreaterThan(29);
    stepField(gather, 480);
    for (const p of gather.particles) expect(Math.hypot(p.x - 24, p.y - 28)).toBeLessThan(1);

    const rise = createField({ seed: 6 });
    emitRise(rise, { from: { x: 24, y: 47 }, to: { x: 30, y: 26 }, ttl: 400, look: {} });
    stepField(rise, 380);
    const feather = rise.particles[0]!;
    expect(Math.hypot(feather.x - 30, feather.y - 26)).toBeLessThan(1);
  });
});

// ── 공용 루프 ────────────────────────────────────────────────────────

describe('공용 루프', () => {
  it('일이 있을 때만 돌고, 끝나면 다음 프레임을 청하지 않는다', () => {
    const frames = fakeFrames();
    expect(running()).toBe(false);
    let calls = 0;
    wake(() => {
      calls += 1;
      return calls < 3;
    });
    expect(frames.pending).toBe(1);
    frames.frame();
    frames.frame();
    expect(running()).toBe(true);
    frames.frame();
    expect(calls).toBe(3);
    expect(activeJobs()).toBe(0);
    expect(running()).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it('같은 일을 여러 번 깨워도 루프는 하나, 프레임당 한 번', () => {
    const frames = fakeFrames();
    let calls = 0;
    const job = () => {
      calls += 1;
      return true;
    };
    wake(job);
    wake(job);
    wake(() => true);
    expect(frames.pending).toBe(1);
    frames.frame();
    expect(calls).toBe(1);
    expect(activeJobs()).toBe(2);
    sleep(job);
    frames.frame();
    expect(calls).toBe(1);
    expect(activeJobs()).toBe(1);
  });

  it(`끊긴 뒤의 dt 는 ${MAX_DT}ms 로 묶는다`, () => {
    const frames = fakeFrames();
    const seen: number[] = [];
    wake((_now, dt) => {
      seen.push(dt);
      return true;
    });
    frames.frame(16);
    frames.frame(16);
    frames.frame(5000);
    expect(seen[1]).toBe(16);
    expect(seen[2]).toBe(MAX_DT);
  });

  it('오류를 던진 일은 빠지고 다른 일은 계속 돈다', () => {
    const frames = fakeFrames();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    wake(() => {
      throw new Error('고장');
    });
    wake(() => {
      calls += 1;
      return true;
    });
    frames.frame();
    frames.frame();
    expect(error).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(activeJobs()).toBe(1);
  });

  it('disposeFx 는 남은 일과 예약된 프레임을 거둔다', () => {
    const frames = fakeFrames();
    wake(() => true);
    disposeFx();
    expect(activeJobs()).toBe(0);
    expect(frames.pending).toBe(0);
    expect(running()).toBe(false);
  });
});

describe('움직임 줄이기 판정', () => {
  it('DOM 이 없으면 줄이기가 아니다', () => {
    expect(env.reduced).toBe(false);
  });

  it('앱 설정(html[data-motion=reduced])', () => {
    const doc = fakeDocument();
    expect(env.reduced).toBe(false);
    doc.motion = 'reduced';
    expect(env.reduced).toBe(true);
  });

  it('기기 설정(prefers-reduced-motion)', () => {
    fakeDocument();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    }));
    expect(env.reduced).toBe(true);
  });
});

describe('입자를 루프에 얹기', () => {
  it('입자가 다 사라지면 한 번 더 그리고(지우고) 루프에서 빠진다', () => {
    const frames = fakeFrames();
    const field = sampleField(11);
    const counts: number[] = [];
    runField(field, (f) => counts.push(f.particles.length));
    expect(activeJobs()).toBe(1);
    frames.run(2000);
    expect(counts.length).toBeGreaterThan(10);
    expect(counts[counts.length - 1]).toBe(0);
    expect(counts.filter((n) => n === 0)).toHaveLength(1);
    expect(activeJobs()).toBe(0);
    expect(frames.pending).toBe(0);
  });

  it('돌고 있는 밭을 다시 얹어도 일은 하나', () => {
    fakeFrames();
    const field = sampleField(11);
    runField(field, () => undefined);
    runField(field, () => undefined);
    expect(activeJobs()).toBe(1);
  });

  it('돌려받은 함수로 그만두면 밭을 비우고 내린다', () => {
    const frames = fakeFrames();
    const field = sampleField(11);
    const stop = runField(field, () => undefined);
    frames.frame();
    stop();
    expect(field.particles).toHaveLength(0);
    expect(activeJobs()).toBe(0);
  });

  it('움직임 줄이기: 밭을 비우고 한 번만 그리게 한 뒤 루프를 깨우지 않는다', () => {
    const frames = fakeFrames();
    fakeDocument({ motion: 'reduced' });
    const field = sampleField(11);
    const counts: number[] = [];
    runField(field, (f) => counts.push(f.particles.length));
    expect(counts).toEqual([0]);
    expect(activeJobs()).toBe(0);
    expect(frames.pending).toBe(0);
  });

  it('도는 중에 움직임 줄이기를 켜면 다음 프레임에 비우고 멈춘다', () => {
    const frames = fakeFrames();
    const doc = fakeDocument();
    const field = sampleField(11);
    const counts: number[] = [];
    runField(field, (f) => counts.push(f.particles.length));
    frames.frame();
    expect(counts[0]).toBeGreaterThan(0);
    doc.motion = 'reduced';
    frames.frame();
    expect(counts[1]).toBe(0);
    expect(activeJobs()).toBe(0);
  });

  it('움직임 줄이기: 효과 층 조각은 생기지 않고 층도 만들지 않는다', () => {
    const frames = fakeFrames();
    fakeDocument({ motion: 'reduced' });
    // 흉내 document 에는 createElement 가 없다. 층을 만들려 들면 여기서 던진다
    sparkle(100, 100);
    sparkle(120, 80, { count: 24 });
    expect(sparkleCount()).toBe(0);
    expect(frames.pending).toBe(0);
    expect(MAX_SPARKLES).toBeLessThanOrEqual(MAX_PARTICLES);
  });
});

// ── 시간표 ───────────────────────────────────────────────────────────

const STEPS = [
  { at: 0, step: 'a' },
  { at: 100, step: 'b' },
  { at: 100, step: 'c' },
  { at: 450, step: 'd' },
  { at: 900, step: 'end' },
];

describe('시간표', () => {
  it('때가 된 단계를 차례로, 한 번씩 실행한다', () => {
    const seen: string[] = [];
    const timeline = createTimeline(STEPS, (step) => seen.push(step.step));
    expect(timeline.duration).toBe(900);
    expect(timeline.advance(0)).toBe(true);
    expect(seen).toEqual(['a']);
    timeline.advance(99);
    expect(seen).toEqual(['a']);
    timeline.advance(1);
    expect(seen).toEqual(['a', 'b', 'c']);
    timeline.advance(400);
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    expect(timeline.done).toBe(false);
    expect(timeline.advance(400)).toBe(false);
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'end']);
    expect(timeline.done).toBe(true);
    timeline.advance(1000);
    timeline.skip();
    expect(seen).toHaveLength(5);
  });

  it('적은 순서가 뒤섞여 있어도 시각 순으로', () => {
    const seen: string[] = [];
    const timeline = createTimeline([STEPS[4]!, STEPS[1]!, STEPS[0]!, STEPS[3]!, STEPS[2]!], (s) =>
      seen.push(s.step),
    );
    timeline.advance(5000);
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'end']);
  });

  it('움직임 줄이기면 끝 장면만 실행한다', () => {
    const seen: string[] = [];
    const timeline = createTimeline(STEPS, (step) => seen.push(step.step), { reduced: true });
    expect(timeline.advance(0)).toBe(false);
    expect(seen).toEqual(['end']);
    expect(timeline.done).toBe(true);
    timeline.advance(5000);
    expect(seen).toEqual(['end']);
  });

  it('건너뛰면 사이 단계를 버리고 끝 장면으로 간다', () => {
    const seen: string[] = [];
    const timeline = createTimeline(STEPS, (step) => seen.push(step.step));
    timeline.advance(120);
    timeline.skip();
    expect(seen).toEqual(['a', 'b', 'c', 'end']);
    expect(timeline.done).toBe(true);
    timeline.skip();
    timeline.advance(5000);
    expect(seen).toHaveLength(4);
  });

  it('그만두면 끝 장면도 실행하지 않는다', () => {
    const seen: string[] = [];
    const timeline = createTimeline(STEPS, (step) => seen.push(step.step));
    timeline.advance(120);
    timeline.cancel();
    timeline.advance(5000);
    timeline.skip();
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('빈 시간표는 바로 끝난다', () => {
    const timeline = createTimeline([], () => undefined);
    expect(timeline.done).toBe(true);
    expect(timeline.advance(10)).toBe(false);
  });
});

describe('시간표를 루프에 얹기(play)', () => {
  it('첫 단계는 부른 자리에서, 나머지는 프레임을 따라. 끝나면 루프가 멈춘다', async () => {
    const frames = fakeFrames();
    const seen: string[] = [];
    const playback = play(STEPS, (step) => seen.push(step.step), { reduced: false });
    expect(seen).toEqual(['a']);
    expect(activeJobs()).toBe(1);
    frames.run(500);
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    frames.run(500);
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'end']);
    expect(playback.done).toBe(true);
    expect(activeJobs()).toBe(0);
    expect(frames.pending).toBe(0);
    await expect(playback.finished).resolves.toBe(true);
  });

  it('움직임 줄이기(지금 설정)를 따른다: 끝 장면만 그 자리에서, 루프는 깨우지 않는다', async () => {
    const frames = fakeFrames();
    fakeDocument({ motion: 'reduced' });
    const seen: string[] = [];
    const playback = play(STEPS, (step) => seen.push(step.step));
    expect(seen).toEqual(['end']);
    expect(playback.done).toBe(true);
    expect(activeJobs()).toBe(0);
    expect(frames.pending).toBe(0);
    await expect(playback.finished).resolves.toBe(true);
  });

  it('건너뛰기는 끝 장면으로, 그만두기는 아무것도 하지 않고 루프에서 내린다', async () => {
    const frames = fakeFrames();
    const seen: string[] = [];
    const skipped = play(STEPS, (step) => seen.push(step.step), { reduced: false });
    frames.run(200);
    skipped.skip();
    skipped.skip();
    expect(seen).toEqual(['a', 'b', 'c', 'end']);
    expect(activeJobs()).toBe(0);
    await expect(skipped.finished).resolves.toBe(true);

    seen.length = 0;
    const cancelled = play(STEPS, (step) => seen.push(step.step), { reduced: false });
    frames.run(200);
    cancelled.cancel();
    frames.run(2000);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(activeJobs()).toBe(0);
    await expect(cancelled.finished).resolves.toBe(false);
  });

  it('탭이 가려져 프레임이 멈추면 장면도 그 자리에서 멈췄다 이어진다', () => {
    const frames = fakeFrames();
    const seen: string[] = [];
    play(STEPS, (step) => seen.push(step.step), { reduced: false });
    frames.run(120);
    // 10초 뒤에 돌아온 첫 프레임: 50ms 만 흐른 것으로 친다
    frames.frame(10_000);
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});

// ── 번쩍임 안전 ──────────────────────────────────────────────────────

describe('번쩍임 안전', () => {
  it('기준: 1초 창에 같은 속성 전환 3회 미만, 넓은 면 페이드 300ms 이상', () => {
    expect(FLASH.windowMs).toBe(1000);
    expect(FLASH.maxFlips).toBe(3);
    expect(FLASH.minFadeMs).toBeGreaterThanOrEqual(300);
  });

  it('창 안의 전환을 속성별로 센다(창의 뒤 끝은 제외)', () => {
    const steps: SafeStep[] = [
      { at: 0, flips: ['a', 'b'] },
      { at: 400, flips: ['a'] },
      { at: 999, flips: ['a'] },
      { at: 1000, flips: ['b'] },
      { at: 2500, flips: ['a'] },
    ];
    const counts = flipCounts(steps);
    expect(counts.get('a')).toBe(3);
    expect(counts.get('b')).toBe(1);
    expect(flashProblems(steps)).toHaveLength(1);
    expect(flashProblems(steps)[0]).toContain('a');
  });

  it('500ms 간격으로 번갈아 바뀌는 것은 통과, 400ms 는 걸린다', () => {
    const every = (ms: number): SafeStep[] =>
      Array.from({ length: 12 }, (_, i) => ({ at: i * ms, flips: ['glow'] }));
    expect(flashProblems(every(500))).toEqual([]);
    expect(flashProblems(every(400))).toHaveLength(1);
    expect(flashProblems(every(260))).toHaveLength(1); // 예전 승급 연출의 간격
  });

  it('300ms 보다 짧은 밝기 전환을 잡는다', () => {
    expect(flashProblems([{ at: 0, fades: { 'stage-dim': 300 } }])).toEqual([]);
    const problems = flashProblems([{ at: 0, fades: { 'stage-dim': 120 } }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('stage-dim');
  });

  it('모든 장면 시간표가 기준을 지킨다', () => {
    expect(SCENE_SAMPLES.length).toBeGreaterThanOrEqual(7);
    for (const scene of SCENE_SAMPLES) {
      expect(flashProblems(scene.steps), scene.name).toEqual([]);
      for (const count of flipCounts(scene.steps).values())
        expect(count, scene.name).toBeLessThan(3);
      for (const step of scene.steps)
        for (const ms of Object.values(step.fades ?? {}))
          expect(ms, `${scene.name} ${step.step}`).toBeGreaterThanOrEqual(300);
    }
  });

  it('승급 건수·새 소품 유무가 달라도 지킨다', () => {
    for (let steps = 1; steps <= 31; steps += 1) {
      for (const unlock of [false, true])
        expect(flashProblems(stepUpScene({ steps, unlock }).steps)).toEqual([]);
    }
  });

  it('번갈아 보이는 그림(blinkFrame)은 간격을 아무리 짧게 줘도 1초에 3번 미만 바뀐다', () => {
    for (const every of [1, 100, 260, 400, 500, 800, 1600]) {
      const flips: SafeStep[] = [];
      let prev = blinkFrame(0, every);
      for (let t = 1; t <= 6000; t += 1) {
        const frame = blinkFrame(t, every);
        if (frame !== prev) flips.push({ at: t, flips: ['blink'] });
        prev = frame;
      }
      expect(flips.length, `${every}ms`).toBeGreaterThan(0);
      expect(flashProblems(flips), `${every}ms`).toEqual([]);
    }
    expect(blinkFrame(0, 500)).toBe(0);
    expect(blinkFrame(500, 500)).toBe(1);
    expect(blinkFrame(1000, 500)).toBe(0);
    expect(blinkFrame(1600, 800, 3)).toBe(2);
  });
});

describe('장면 시간표의 짜임', () => {
  it("시각 순으로 적혀 있고 마지막 단계 하나만 'end'", () => {
    for (const scene of SCENE_SAMPLES) {
      const { steps } = scene;
      expect(steps.at(-1)?.step, scene.name).toBe('end');
      expect(
        steps.filter((s) => s.step === 'end'),
        scene.name,
      ).toHaveLength(1);
      steps.forEach((step, i) => {
        expect(Number.isInteger(step.at) && step.at >= 0, scene.name).toBe(true);
        expect(Number.isInteger(step.ms) && step.ms >= 0, scene.name).toBe(true);
        if (i > 0) expect(step.at, scene.name).toBeGreaterThanOrEqual(steps[i - 1]!.at);
        if (step.cue) expect(CUE_NAMES, scene.name).toContain(step.cue);
      });
      // 단계 이름은 장면 안에서 겹치지 않는다(화면이 이름으로 갈라 그린다)
      expect(new Set(steps.map((s) => s.step)).size, scene.name).toBe(steps.length);
      // 대표 신호는 시간표 어딘가에 있다
      if (scene.keyCue)
        expect(
          steps.map((s) => s.cue),
          scene.name,
        ).toContain(scene.keyCue);
    }
  });

  it('길이: 부화 3초 안, 호봉 오름 3초 안팎, 승진 3.6초 안(건너뛰기는 늘 된다)', () => {
    const end = (steps: readonly { at: number }[]) => steps.at(-1)!.at;
    expect(end(hatchScene({ evolves: false }).steps)).toBe(2000);
    expect(end(hatchScene({ evolves: true }).steps)).toBe(2800);
    expect(end(stepUpScene({ steps: 1, unlock: false }).steps)).toBeLessThanOrEqual(2400);
    expect(end(stepUpScene({ steps: 31, unlock: true }).steps)).toBeLessThanOrEqual(5000);
    expect(end(promoteScene({ evolves: true }).steps)).toBeLessThanOrEqual(3600);
    expect(end(promoteScene({ evolves: false }).steps)).toBeLessThanOrEqual(2200);
  });

  it('숫자 굴림: 6호봉까지는 칸당 120ms, 넘으면 60ms', () => {
    expect(rollMs(1)).toBe(120);
    expect(rollMs(6)).toBe(720);
    expect(rollMs(7)).toBe(420);
    expect(rollMs(0)).toBe(120);
  });
});

describe('몸짓', () => {
  it('정수 픽셀만 쓰고 작게(3px 안) 움직인다', () => {
    for (const [name, move] of Object.entries(MOVES)) {
      expect(move.length, name).toBeGreaterThan(0);
      for (const frame of move) {
        expect(Number.isInteger(frame.dx) && Number.isInteger(frame.dy), name).toBe(true);
        expect(Math.abs(frame.dx), name).toBeLessThanOrEqual(3);
        expect(Math.abs(frame.dy), name).toBeLessThanOrEqual(3);
        expect(frame.ms, name).toBeGreaterThanOrEqual(40);
      }
      expect(moveDuration(move), name).toBeLessThanOrEqual(600);
    }
    expect(moveDuration(MOVES.wiggle)).toBeLessThan(WIGGLE_EVERY_MS);
  });

  it('끝나면 제자리로 돌아온다', () => {
    for (const move of Object.values(MOVES)) {
      expect(moveAt(move, moveDuration(move))).toEqual({ dx: 0, dy: 0 });
      expect(moveAt(move, -1)).toEqual({ dx: 0, dy: 0 });
    }
    expect(moveAt(MOVES.shake, 0)).toEqual({ dx: 1, dy: 0 });
    expect(moveAt(MOVES.shake, 70)).toEqual({ dx: -1, dy: 0 });
    expect(moveAt(MOVES.tap, 30)).toEqual({ dx: 0, dy: -2 });
  });

  it('값을 고쳐야 할 때의 움찔이 가장 짧고 작다(혼내는 느낌이 나지 않게)', () => {
    expect(moveDuration(MOVES.flinch)).toBeLessThanOrEqual(200);
    expect(Math.max(...MOVES.flinch.map((frame) => Math.abs(frame.dx)))).toBe(1);
  });
});

// ── 신호 ─────────────────────────────────────────────────────────────

describe('신호(cue)', () => {
  it('듣는 쪽에 그 자리에서 전하고, 그만 들으면 오지 않는다', () => {
    const seen: Cue[] = [];
    const off = onCue((cue) => seen.push(cue));
    expect(cueListeners()).toBe(1);
    emitCue('egg-react');
    emitCue('egg-crack', { stage: 2 });
    expect(seen.map((cue) => cue.name)).toEqual(['egg-react', 'egg-crack']);
    expect(seen[1]?.detail).toEqual({ stage: 2 });
    off();
    emitCue('hatch');
    expect(seen).toHaveLength(2);
    expect(cueListeners()).toBe(0);
  });

  it('듣는 쪽이 없어도, 듣는 쪽이 오류를 던져도 화면은 멈추지 않는다', () => {
    expect(() => emitCue('package-saved')).not.toThrow();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const seen: string[] = [];
    const offBad = onCue(() => {
      throw new Error('소리 고장');
    });
    const offGood = onCue((cue) => seen.push(cue.name));
    expect(() => emitCue('step-up')).not.toThrow();
    expect(seen).toEqual(['step-up']);
    expect(error).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });

  it('신호 이름은 겹치지 않고, 작업 지시에 적힌 것이 모두 있다', () => {
    expect(new Set(CUE_NAMES).size).toBe(CUE_NAMES.length);
    for (const name of [
      'egg-react',
      'egg-crack',
      'hatch',
      'step-up',
      'promotion',
      'evolve',
      'package-saved',
    ])
      expect(CUE_NAMES).toContain(name);
  });
});

describe('장면 재생(playScene)', () => {
  const listen = () => {
    const names: string[] = [];
    const off = onCue((cue) => names.push(cue.name));
    return { names, off };
  };

  it('단계마다 화면을 부르고 그 단계의 신호를 낸다', () => {
    const frames = fakeFrames();
    const { names, off } = listen();
    const seen: string[] = [];
    playScene(hatchScene({ evolves: false }), (step) => seen.push(step.step), { reduced: false });
    expect(seen).toEqual(['clear']);
    expect(names).toEqual(['hatch-start']);
    frames.run(2100);
    expect(seen).toEqual(['clear', 'knock', 'dust', 'knock-hard', 'crouch', 'pop', 'end']);
    expect(names).toEqual(['hatch-start', 'egg-knock', 'egg-knock', 'hatch', 'greet']);
    off();
  });

  it('움직임 줄이기: 끝 장면만 보이고, 대표 신호와 끝 신호만 한 번씩', () => {
    const frames = fakeFrames();
    fakeDocument({ motion: 'reduced' });
    const { names, off } = listen();
    const seen: string[] = [];
    playScene(hatchScene({ evolves: true }), (step) => seen.push(step.step));
    expect(seen).toEqual(['end']);
    expect(names).toEqual(['hatch', 'greet']);
    expect(frames.pending).toBe(0);

    names.length = 0;
    playScene(stepUpScene({ steps: 2, unlock: true }), () => undefined);
    expect(names).toEqual(['step-up']);
    names.length = 0;
    playScene(promoteScene({ evolves: true }), () => undefined);
    expect(names).toEqual(['evolve']);
    off();
  });

  it('건너뛰기: 대표 신호를 이미 냈으면 다시 내지 않는다', () => {
    const frames = fakeFrames();
    const { names, off } = listen();
    const early = playScene(promoteScene({ evolves: true }), () => undefined, { reduced: false });
    frames.run(400);
    early.skip();
    expect(names).toEqual(['promotion', 'evolve']);

    names.length = 0;
    const late = playScene(promoteScene({ evolves: true }), () => undefined, { reduced: false });
    frames.run(1400);
    late.skip();
    expect(names).toEqual(['promotion', 'evolve']);
    off();
  });
});

// ── 진동 ─────────────────────────────────────────────────────────────

describe('진동', () => {
  it('지원하는 기기에서 켜져 있으면 무늬대로 울린다', () => {
    fakeDocument();
    const vibrate = fakeNavigator();
    expect(hapticsSupported()).toBe(true);
    expect(hapticsEnabled()).toBe(true);
    expect(haptic('crack')).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith([...HAPTIC_PATTERNS.crack]);
    expect(haptic([10.4, 30, 10])).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith([10, 30, 10]);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('설정에서 껐으면 부르지 않는다', () => {
    fakeDocument();
    const vibrate = fakeNavigator();
    setHapticsEnabled(false);
    expect(haptic('tick')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    expect(haptic('tick')).toBe(true);
  });

  it('움직임 줄이기(앱 설정)면 부르지 않는다', () => {
    fakeDocument({ motion: 'reduced' });
    const vibrate = fakeNavigator();
    expect(haptic('ready')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('움직임 줄이기(기기 설정)면 부르지 않는다', () => {
    fakeDocument();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const vibrate = fakeNavigator();
    expect(haptic('ready')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('지원하지 않는 기기(아이폰 Safari 등)에서는 조용히 넘어간다', () => {
    fakeDocument();
    fakeNavigator({ vibrate: false });
    expect(hapticsSupported()).toBe(false);
    expect(haptic('tick')).toBe(false);
    expect(() => stopHaptics()).not.toThrow();
    vi.stubGlobal('navigator', undefined);
    expect(hapticsSupported()).toBe(false);
    expect(haptic('tick')).toBe(false);
  });

  it('화면이 가려져 있으면 부르지 않는다', () => {
    const doc = fakeDocument({ hidden: true });
    const vibrate = fakeNavigator();
    expect(haptic('tick')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    doc.hidden = false;
    expect(haptic('tick')).toBe(true);
  });

  it('사용자가 아직 화면을 누른 적이 없으면 부르지 않는다', () => {
    fakeDocument();
    const blocked = fakeNavigator({ active: false });
    expect(haptic('tick')).toBe(false);
    expect(blocked).not.toHaveBeenCalled();
    // userActivation 을 모르는 브라우저는 그대로 청한다(브라우저가 알아서 막는다)
    const unknown = fakeNavigator({ active: null });
    expect(haptic('tick')).toBe(true);
    expect(unknown).toHaveBeenCalledTimes(1);
  });

  it('브라우저가 던져도 화면은 멈추지 않는다', () => {
    fakeDocument();
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('막힘');
      },
    });
    expect(haptic('tick')).toBe(false);
  });

  it('무늬는 다듬는다: 정수 ms, 2초·16마디까지, 빈 무늬는 부르지 않는다', () => {
    fakeDocument();
    const vibrate = fakeNavigator();
    expect(haptic([])).toBe(false);
    expect(haptic([0, 0])).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    haptic(Array.from({ length: 40 }, () => 100));
    const sent = vibrate.mock.calls[0]?.[0] as number[];
    expect(sent.length).toBeLessThanOrEqual(16);
    expect(sent.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2000);
    haptic([5000, 20]);
    expect(vibrate).toHaveBeenCalledTimes(1);
    haptic([Number.NaN, -5, 30]);
    expect(vibrate).toHaveBeenLastCalledWith([0, 0, 30]);
  });

  it('멈춤은 우리가 울린 적이 있을 때만 청한다(끄면 울리던 것도 멈춘다)', () => {
    fakeDocument();
    const vibrate = fakeNavigator();
    stopHaptics();
    setHapticsEnabled(false);
    expect(vibrate).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    haptic('knock');
    setHapticsEnabled(false);
    expect(vibrate).toHaveBeenLastCalledWith(0);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('정해 둔 무늬: 짧고(1초 안), 울림은 20ms 이상(짧은 진동을 무시하는 기기)', () => {
    for (const [name, pattern] of Object.entries(HAPTIC_PATTERNS)) {
      expect(pattern.length % 2, name).toBe(1); // 울림으로 시작해 울림으로 끝난다
      expect(
        pattern.reduce((a: number, b: number) => a + b, 0),
        name,
      ).toBeLessThanOrEqual(1000);
      pattern.forEach((ms, i) => {
        if (i % 2 === 0) expect(ms, name).toBeGreaterThanOrEqual(20);
      });
    }
  });
});

describe('신호에 진동 얹기', () => {
  it('신호를 들으면 그 무늬로 울리고, 그만 들으면 울리지 않는다', () => {
    fakeDocument();
    const vibrate = fakeNavigator();
    const unlink = linkHaptics();
    emitCue('egg-react');
    expect(vibrate).toHaveBeenLastCalledWith([...HAPTIC_PATTERNS.tick]);
    emitCue('egg-crack');
    expect(vibrate).toHaveBeenLastCalledWith([...HAPTIC_PATTERNS.crack]);
    emitCue('evolve');
    expect(vibrate).toHaveBeenLastCalledWith([...HAPTIC_PATTERNS.evolve]);
    expect(vibrate).toHaveBeenCalledTimes(3);
    unlink();
    emitCue('egg-react');
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it('값을 고쳐야 할 때·저장·공유 신호에는 울리지 않는다', () => {
    fakeDocument();
    const vibrate = fakeNavigator();
    const unlink = linkHaptics();
    for (const name of ['egg-flinch', 'package-saved', 'package-loaded', 'share'] as const)
      emitCue(name);
    expect(vibrate).not.toHaveBeenCalled();
    expect(CUE_HAPTICS['egg-flinch']).toBeUndefined();
    unlink();
  });

  it('신호 표의 이름과 무늬가 모두 실제로 있다', () => {
    for (const [cue, name] of Object.entries(CUE_HAPTICS)) {
      expect(CUE_NAMES).toContain(cue);
      expect(Object.keys(HAPTIC_PATTERNS)).toContain(name);
    }
  });

  it('부화 장면: 두드림 두 번과 팡에 맞춰 울리고, 움직임 줄이기면 한 번도 울리지 않는다', () => {
    const frames = fakeFrames();
    const doc = fakeDocument();
    const vibrate = fakeNavigator();
    const unlink = linkHaptics();
    playScene(hatchScene({ evolves: false }), () => undefined);
    frames.run(2100);
    expect(vibrate.mock.calls.map((call) => call[0])).toEqual([
      [...HAPTIC_PATTERNS.knock],
      [...HAPTIC_PATTERNS.knock],
      [...HAPTIC_PATTERNS.pop],
    ]);

    vibrate.mockClear();
    doc.motion = 'reduced';
    playScene(hatchScene({ evolves: false }), () => undefined);
    frames.run(2100);
    expect(vibrate).not.toHaveBeenCalled();
    unlink();
  });
});
