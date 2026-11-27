<script lang="ts" module>
  /** 알의 반응(칸마다 다르다). 뜻은 늘 글로도 전한다(이 그림은 장식이다) */
  export type EggReaction =
    'tap' | 'heart' | 'star' | 'shake' | 'tilt' | 'hop' | 'coin' | 'nudge' | 'flinch';
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
  const field = createField({ max: 24 });
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

  function emit(kind: EggReaction) {
    if (env.reduced) return;
    if (kind === 'heart') {
      emitRise(field, {
        from: { x: TOP.x + 9, y: TOP.y + 2 },
        to: { x: TOP.x + 12, y: TOP.y - 10 },
        ttl: 700,
        sway: 2,
        look: { sprite: 'fxc-heart' },
      });
    } else if (kind === 'star' || kind === 'hop') {
      emitBurst(field, {
        x: TOP.x,
        y: TOP.y + 2,
        count: kind === 'hop' ? 3 : 2,
        speed: [14, 22],
        angle: [Math.PI * 1.15, Math.PI * 1.85],
        lift: 6,
        gravity: 30,
        ttl: [380, 520],
        look: { sprite: 'p-star' },
      });
    } else if (kind === 'shake') {
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y + 2,
        count: 3,
        speed: [6, 12],
        angle: [Math.PI * 0.2, Math.PI * 0.8],
        gravity: 90,
        ttl: [380, 460],
        look: { sprite: 'fxc-dust', frames: 3 },
      });
    } else if (kind === 'tilt') {
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y - 6,
        count: 4,
        speed: [18, 26],
        ttl: [300, 420],
        look: { sprite: 'p-glint' },
      });
    } else if (kind === 'coin') {
      emitRise(field, {
        from: { x: TOP.x, y: TOP.y },
        to: { x: TOP.x, y: TOP.y - 12 },
        ttl: 600,
        sway: 0,
        look: { sprite: 'fxc-coin', frames: 2, frameMs: 200 },
      });
    }
    stopField = runField(field, () => canvas?.redraw());
  }

  const MOVE_OF: Record<EggReaction, Move> = {
    tap: MOVES.tap,
    heart: MOVES.tap,
    star: MOVES.nudge,
    shake: MOVES.shake,
    tilt: MOVES.tilt,
    hop: MOVES.hop,
    coin: MOVES.tap,
    nudge: MOVES.nudge,
    flinch: MOVES.flinch,
  };

  /** 칸을 채웠을 때(또는 고쳐야 할 때) 한 번 반응한다 */
  export function react(kind: EggReaction): void {
    if (env.reduced) return;
    if (kind === 'flinch') squashMs = 90;
    play(MOVE_OF[kind]);
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
