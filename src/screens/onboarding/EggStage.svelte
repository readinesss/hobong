<script lang="ts" module>
  import type { MoveName } from '../../lib/fx/moves.ts';

  /**
   * 알의 반응(칸마다 다르다). 몸짓과 조각이 칸마다 달라 무엇을 답했는지 그림으로도 알아본다.
   * 뜻은 늘 글로도 전한다(이 그림은 장식이다).
   *
   * heart 하트·이름표 / star 반짝이 / calendar 달력 장 / badge 방패 휘장 / sheet 봉급표 종이 / tag 이름표 /
   * feather 깃 / coin 동전·월급 봉투 / tap·hop·nudge 조각 없이 몸짓만 조금 / flinch 움찔(고쳐야 할 때)
   */
  export type EggReaction =
    | 'heart'
    | 'star'
    | 'calendar'
    | 'badge'
    | 'sheet'
    | 'tag'
    | 'feather'
    | 'coin'
    | 'tap'
    | 'hop'
    | 'nudge'
    | 'flinch';

  /**
   * 반응마다의 몸짓 이름(moves.ts). 맞장구의 몸짓 대사(data/talk.json egg.move)도 이 짝을 따른다
   * (글이 그림과 어긋나지 않게 한곳에 둔다).
   */
  export const REACTION_MOVE = {
    heart: 'tap',
    star: 'nudge',
    calendar: 'shake',
    badge: 'tilt',
    sheet: 'tap',
    tag: 'nudge',
    feather: 'hop',
    coin: 'hop',
    tap: 'tap',
    hop: 'hop',
    nudge: 'nudge',
    flinch: 'flinch',
  } as const satisfies Record<EggReaction, MoveName>;

  /** 금 단계가 올랐을 때의 몸짓: 금이 가면 흔들, 다 채우면 콩콩(칸의 조각은 그대로 튄다) */
  export type EggRise = 'crack' | 'ready';
</script>

<script lang="ts">
  /**
   * 말을 거는 알. 금 단계(0~4)의 그림과, 칸을 채울 때의 작은 반응(몸짓 + 입자)을 그린다.
   *
   * - 그림은 장식이다(aria-hidden). 금이 갔다·빛난다는 뜻은 감싼 화면이 글(입력 칸 설명)로 전한다.
   * - 움직임 줄이기면 몸짓·입자·번갈아 빛나기를 하지 않고 단계 그림만 바꾼다.
   * - 다 채우면(ready) 빛 테두리가 500ms 마다 얇게·두껍게 번갈고(작은 면적), 1.5초쯤마다 들썩인다.
   */
  import { onMount } from 'svelte';
  import { anim } from '../../lib/app/anim.svelte.ts';
  import { theme } from '../../lib/app/theme.svelte.ts';
  import { eggPose } from '../../lib/character/egg.ts';
  import type { BodyPaint } from '../../lib/character/regions.ts';
  import { getSprite } from '../../lib/character/sprites.ts';
  import { env, sleep, wake, type Job } from '../../lib/fx/core.ts';
  import { MOVES, moveAt, moveDuration, type Move } from '../../lib/fx/moves.ts';
  import { createField, emitBurst, emitRise } from '../../lib/fx/particles.ts';
  import { runField } from '../../lib/fx/sparkle.ts';
  import { blit, drawParticles, type Stage } from '../../lib/fx/stage.ts';
  import StageCanvas from '../../lib/ui/StageCanvas.svelte';

  interface Props {
    /** 금 단계(0~4) */
    stage: number;
    /** 필요한 칸을 다 채웠는지(빛 테두리·들썩임) */
    ready?: boolean;
    /** 고른 몸 색(틈새 빛) */
    paint?: BodyPaint;
    scale?: number;
    rows?: number;
  }

  let { stage, ready = false, paint, scale = 4, rows = 52 }: Props = $props();

  let canvas = $state<ReturnType<typeof StageCanvas>>();
  const field = createField({ max: 32 });
  let stopField: (() => void) | null = null;

  /** 지금 틀고 있는 몸짓과 흐른 시간(ms) */
  let move: Move | null = null;
  let moveMs = 0;
  /** 움찔: 이 시간(ms) 동안 눌린 그림 */
  let squashMs = 0;
  /** 말풍선 쪽을 보는 시간(ms) */
  let asideMs = 0;

  const moveJob: Job = (_now, dt) => {
    moveMs += dt;
    squashMs = Math.max(0, squashMs - dt);
    asideMs = Math.max(0, asideMs - dt);
    if (move && moveMs >= moveDuration(move)) move = null;
    canvas?.redraw();
    return move !== null || squashMs > 0 || asideMs > 0;
  };

  function play(next: Move) {
    if (env.reduced) return;
    move = next;
    moveMs = 0;
    wake(moveJob);
  }

  /** 알 한가운데(48칸 기준)와 알 꼭대기 */
  const CENTER = { x: 24, y: 34 };
  const TOP = { x: 24, y: 22 };

  /** 알 꼭대기에서 위로 퍼지는 부채꼴(라디안. 0 = 오른쪽, 시계 방향이 +) */
  const UP_FAN: readonly [number, number] = [Math.PI * 1.1, Math.PI * 1.9];

  /** 조각이 알에서 튀어 올라 포물선을 그리며 떨어진다(칸마다 그림이 다르다) */
  function toss(sprite: string | readonly string[], count: number, frames = 1) {
    emitBurst(field, {
      x: TOP.x,
      y: TOP.y + 3,
      count,
      speed: [16, 30],
      angle: UP_FAN,
      lift: 14,
      gravity: 70,
      ttl: [620, 820],
      delay: [0, 120],
      look: { sprite, frames, frameMs: 180 },
    });
  }

  function emit(kind: EggReaction) {
    if (env.reduced) return;
    if (kind === 'heart') {
      // 하트 다섯이 차례로 떠오르고, 이름표 하나가 톡 튀어나온다
      emitRise(field, {
        from: { x: TOP.x, y: TOP.y + 4 },
        to: { x: TOP.x + 2, y: TOP.y - 12 },
        count: 5,
        ttl: [640, 860],
        sway: 9,
        stagger: 70,
        look: { sprite: 'fxc-heart' },
      });
      toss('fxc-tag', 1);
    } else if (kind === 'star' || kind === 'hop') {
      emitBurst(field, {
        x: TOP.x,
        y: TOP.y + 2,
        count: kind === 'hop' ? 4 : 8,
        speed: [18, 34],
        angle: UP_FAN,
        lift: 10,
        gravity: 40,
        ttl: [520, 760],
        delay: [0, 100],
        look: { sprite: ['fxc-spark', 'fxc-spark', 'p-star'] },
      });
    } else if (kind === 'calendar') {
      toss('fxc-cal', 6);
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y + 2,
        count: 4,
        speed: [6, 12],
        angle: [Math.PI * 0.2, Math.PI * 0.8],
        gravity: 90,
        ttl: [380, 460],
        look: { sprite: 'fxc-dust', frames: 3 },
      });
    } else if (kind === 'badge') {
      toss(['fxc-badge', 'fxc-badge', 'fxc-spark'], 7);
    } else if (kind === 'sheet') {
      toss('fxc-sheet', 6);
    } else if (kind === 'tag') {
      toss(['fxc-tag', 'fxc-spark'], 6);
    } else if (kind === 'feather') {
      toss(['p-feather', 'p-feather', 'fxc-spark'], 8);
    } else if (kind === 'coin') {
      emitBurst(field, {
        x: TOP.x,
        y: TOP.y + 3,
        count: 5,
        speed: [16, 28],
        angle: UP_FAN,
        lift: 16,
        gravity: 80,
        ttl: [640, 820],
        delay: [0, 140],
        look: { sprite: 'fxc-coin', frames: 2, frameMs: 160 },
      });
      toss('fxc-envelope', 2);
    } else if (kind === 'nudge') {
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y - 6,
        count: 4,
        speed: [18, 26],
        ttl: [300, 420],
        look: { sprite: 'p-glint' },
      });
    }
    stopField = runField(field, () => canvas?.redraw());
  }

  /**
   * 칸을 채웠을 때(또는 고쳐야 할 때) 한 번 반응한다.
   * rise: 이 답으로 금 단계가 올랐으면 'crack'(흔들), 다 채웠으면 'ready'(콩콩). 조각은 칸의 것 그대로다.
   */
  export function react(kind: EggReaction, rise?: EggRise): void {
    if (env.reduced) return;
    if (kind === 'flinch') squashMs = 90;
    const move: Move =
      rise === 'crack' ? MOVES.shake : rise === 'ready' ? MOVES.hop : MOVES[REACTION_MOVE[kind]];
    play(move);
    emit(kind);
  }

  /** 새 질문을 띄울 때 잠깐 말풍선 쪽을 본다 */
  export function glance(): void {
    if (env.reduced) return;
    asideMs = 600;
    wake(moveJob);
  }

  onMount(() => {
    const release = anim.use();
    return () => {
      release();
      sleep(moveJob);
      stopField?.();
    };
  });

  // 다 채운 알은 1.5초쯤마다 들썩인다(공용 박자 250ms × 6)
  $effect(() => {
    const tick = anim.tick;
    if (ready && !anim.reduced && tick > 0 && tick % 6 === 0 && move === null) play(MOVES.wiggle);
  });

  function render(target: Stage) {
    const tick = anim.reduced ? 0 : anim.tick;
    const at = move ? moveAt(move, moveMs) : { dx: 0, dy: 0 };
    // 눈: 말풍선 쪽을 보는 중이면 2, 가끔 깜빡(1), 보통 0
    const peek = asideMs > 0 ? 2 : tick % 16 === 15 ? 1 : 0;
    const comp = eggPose({
      stage,
      peek,
      // 번갈아 빛나기: 두 박자(500ms)마다. 움직임 줄이기면 얇은 테두리로 멈춘다
      glow: ready ? (Math.floor(tick / 2) % 2 === 0 ? 1 : 2) : 0,
      lightStage: !theme.dark,
      squash: squashMs > 0,
      dx: at.dx,
      dy: at.dy,
      paint,
    });
    const ox = Math.floor((target.w - 48) / 2);
    const oy = target.h - 48;
    if (comp) blit(target, comp, ox, oy);
    drawParticles(target, field, ox, oy, getSprite, theme.dark ? { 14: 13 } : undefined);
  }
</script>

<StageCanvas bind:this={canvas} {rows} {scale} {render} />
