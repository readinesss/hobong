/**
 * 시간표로 장면을 진행한다.
 *
 * - 시간표는 [{ at: 시작부터 ms, … }] 목록. 때가 된 단계를 차례로 onStep 에 넘긴다.
 * - 마지막 단계는 '끝 장면'이어야 한다(결과 그림과 글). 건너뛰기는 사이 단계를 버리고 끝 장면으로 바로 간다.
 * - 움직임 줄이기면 끝 장면만 실행한다(그 자리에서 바로, 루프를 깨우지 않는다).
 * - createTimeline 은 시계를 갖지 않는다(advance 로 민다). 화면은 play 로 공용 루프(core)에 얹는다.
 *   탭이 가려지면 루프가 멈추므로 장면도 그 자리에서 멈췄다가 이어진다.
 *
 * 번쩍임 안전(flashProblems 가 시간표를 검사하고, tests/unit/fx.test.ts 가 모든 장면에 돌린다)
 * - 같은 속성(flips 에 적은 이름)이 뚝 바뀌는 일은 어느 1초 안에도 3번 미만.
 * - 무대처럼 넓은 면의 밝기 전환(fades)은 300ms 이상 걸리는 페이드로만.
 * - 되풀이해 번갈아 바뀌는 것(빛 테두리 등)은 blinkFrame 으로: 간격이 500ms 아래로 내려가지 않는다.
 */
import { env, sleep, wake, type Job } from './core.ts';

export interface Step {
  /** 장면 시작부터의 시각(ms) */
  at: number;
}

/** 번쩍임 검사에 쓰는 표시를 단 단계 */
export interface SafeStep extends Step {
  /** 이 단계에서 뚝 바뀌는 속성 이름(예: 'egg-frame', 'outline-color') */
  flips?: readonly string[];
  /** 이 단계에서 시작하는 넓은 면의 밝기 페이드: 속성 이름 → 걸리는 시간(ms) */
  fades?: Readonly<Record<string, number>>;
}

export interface TimelineOptions {
  /** 움직임 줄이기. true 면 끝 장면만 */
  reduced?: boolean;
}

export interface Timeline {
  /** dt(ms)만큼 민다. 아직 남았으면 true */
  advance(dtMs: number): boolean;
  /** 끝 장면으로 바로 간다(이미 끝났으면 아무 일도 없다) */
  skip(): void;
  /** 더 진행하지 않는다. 끝 장면도 실행하지 않는다(화면을 떠날 때) */
  cancel(): void;
  readonly done: boolean;
  readonly elapsed: number;
  /** 끝 장면이 시작하는 시각(ms) */
  readonly duration: number;
}

export function createTimeline<T extends Step>(
  steps: readonly T[],
  onStep: (step: T, index: number) => void,
  options: TimelineOptions = {},
): Timeline {
  // at 순서로(같으면 적은 순서 그대로)
  const order = steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.at - b.step.at || a.index - b.index);
  const lastIndex = order.length - 1;
  let next = 0;
  let elapsed = 0;
  let done = order.length === 0;

  const fire = (i: number) => {
    const entry = order[i];
    if (entry) onStep(entry.step, entry.index);
  };
  const finish = () => {
    if (done) return;
    done = true;
    // 끝 장면을 아직 안 했으면 그것만 한다
    if (next <= lastIndex) {
      next = lastIndex + 1;
      fire(lastIndex);
    }
  };

  return {
    advance(dtMs) {
      if (done) return false;
      if (options.reduced) {
        finish();
        return false;
      }
      elapsed += Math.max(0, dtMs);
      while (!done && next <= lastIndex && (order[next] as { step: T }).step.at <= elapsed) {
        const i = next;
        next += 1;
        if (i === lastIndex) done = true;
        fire(i);
      }
      return !done;
    },
    skip: finish,
    cancel() {
      done = true;
      next = lastIndex + 1;
    },
    get done() {
      return done;
    },
    get elapsed() {
      return elapsed;
    },
    get duration() {
      return order[lastIndex]?.step.at ?? 0;
    },
  };
}

export interface Playback {
  /** 끝 장면으로 바로 간다(건너뛰기 버튼·Esc) */
  skip(): void;
  /** 그만둔다. 끝 장면도 실행하지 않는다 */
  cancel(): void;
  readonly done: boolean;
  readonly elapsed: number;
  /** 끝 장면까지 갔으면 true, cancel 로 그만뒀으면 false */
  readonly finished: Promise<boolean>;
}

export interface PlayOptions {
  /** 움직임 줄이기. 주지 않으면 지금 설정(env.reduced)을 따른다 */
  reduced?: boolean;
}

/**
 * 시간표를 공용 루프에 얹어 돌린다.
 * at 이 0 인 단계는 부른 자리에서 바로 실행한다(누른 그 순간 반응하게). 움직임 줄이기면 끝 장면만 그 자리에서 실행하고 끝난다.
 * 그래서 onStep 은 play 가 돌아오기 전에 불릴 수 있다. 돌려받은 Playback 을 onStep 안에서 쓰지 않는다.
 */
export function play<T extends Step>(
  steps: readonly T[],
  onStep: (step: T, index: number) => void,
  options: PlayOptions = {},
): Playback {
  const timeline = createTimeline(steps, onStep, { reduced: options.reduced ?? env.reduced });
  let settle: (completed: boolean) => void = () => undefined;
  let settled = false;
  const finished = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const end = (completed: boolean) => {
    if (settled) return;
    settled = true;
    sleep(job);
    settle(completed);
  };
  const job: Job = (_now, dt) => {
    if (settled) return false;
    const more = timeline.advance(dt);
    if (!more) end(true);
    return more;
  };

  if (timeline.advance(0)) wake(job);
  else end(true);

  return {
    skip() {
      if (settled) return;
      timeline.skip();
      end(true);
    },
    cancel() {
      if (settled) return;
      timeline.cancel();
      end(false);
    },
    get done() {
      return timeline.done;
    },
    get elapsed() {
      return timeline.elapsed;
    },
    finished,
  };
}

/** 번쩍임 안전 기준 */
export const FLASH = {
  /** 이 길이(ms)의 어느 창에서도 */
  windowMs: 1000,
  /** 같은 속성 전환은 이 횟수 미만 */
  maxFlips: 3,
  /** 넓은 면의 밝기 전환은 이 시간(ms) 이상 걸리는 페이드로 */
  minFadeMs: 300,
  /** 되풀이해 번갈아 바뀌는 그림의 가장 짧은 간격(ms). 1초에 두 번까지 */
  minBlinkMs: 500,
} as const;

/** 속성별로, 어느 1초 창(앞은 포함·뒤는 제외)에 가장 많이 든 전환 횟수 */
export function flipCounts(
  steps: readonly SafeStep[],
  windowMs: number = FLASH.windowMs,
): Map<string, number> {
  const times = new Map<string, number[]>();
  for (const step of steps) {
    for (const prop of step.flips ?? []) {
      const list = times.get(prop) ?? [];
      list.push(step.at);
      times.set(prop, list);
    }
  }
  const counts = new Map<string, number>();
  for (const [prop, list] of times) {
    list.sort((a, b) => a - b);
    let most = 0;
    let from = 0;
    for (let to = 0; to < list.length; to += 1) {
      while ((list[to] as number) - (list[from] as number) >= windowMs) from += 1;
      most = Math.max(most, to - from + 1);
    }
    counts.set(prop, most);
  }
  return counts;
}

/** 시간표가 번쩍임 기준을 어긴 곳(없으면 빈 목록) */
export function flashProblems(steps: readonly SafeStep[]): string[] {
  const problems: string[] = [];
  for (const [prop, count] of flipCounts(steps)) {
    if (count >= FLASH.maxFlips)
      problems.push(`${prop}: ${FLASH.windowMs}ms 안에 ${count}번 바뀌어요`);
  }
  for (const step of steps) {
    for (const [prop, ms] of Object.entries(step.fades ?? {})) {
      if (ms < FLASH.minFadeMs)
        problems.push(`${prop}: ${step.at}ms 의 밝기 전환이 ${ms}ms 로 너무 짧아요`);
    }
  }
  return problems;
}

/**
 * 되풀이해 번갈아 보이는 그림(빛 테두리·틈새 빛)의 지금 프레임.
 * 간격은 FLASH.minBlinkMs 아래로 내려가지 않는다(더 짧게 줘도 500ms 로 돈다). 움직임 줄이기면 부르지 말고 0번 그림을 쓴다.
 */
export function blinkFrame(elapsedMs: number, everyMs: number, frames = 2): number {
  const every = Math.max(FLASH.minBlinkMs, everyMs);
  const count = Math.max(1, Math.floor(frames));
  return Math.floor(Math.max(0, elapsedMs) / every) % count;
}
