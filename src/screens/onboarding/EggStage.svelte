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
   * - pokeable 이면 손길(#39, EggPoke.svelte 가 해석해 넘긴다)도 그린다: 눌린 그림·몸짓·조각·눈·두드림 표시·
   *   마우스 올린 자세·품기의 고정 테두리. 상태는 보통 변수로 두고, 바뀔 때 그 자리에서 redraw() 를 부른다
   *   (누르면 같은 이벤트 안에서 그림이 바뀐다). 루프(rAF)는 몸짓·입자가 있을 때만 돈다.
   * - 답할 때의 반응(react)이 늘 이긴다: 손길 몸짓·눌린 그림·눈·표시를 지우고 제 몸짓을 튼다.
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
  import {
    fanFor,
    POKE,
    type PokeBits,
    type PokeRecipe,
    type PokeSide,
  } from '../../lib/fx/poke.ts';
  import { runField } from '../../lib/fx/sparkle.ts';
  import { blit, drawParticles, sprite, type Stage } from '../../lib/fx/stage.ts';
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
    /** 손길(누르기·마우스 올리기)을 그릴지. 아니면 press 등을 불러도 아무 일 없다 */
    pokeable?: boolean;
  }

  let { stage, ready = false, paint, scale = 4, rows = 52, pokeable = false }: Props = $props();

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

  // ── 손길(#39) ── 모두 보통 변수: 바뀔 때 redraw() 를 직접 부른다
  /**
   * 지금 몸짓이 누구 것인지. 답할 때의 반응(react)이면 손길은 글만 낸다.
   * 다 채운 알이 기다리며 들썩이는 것(idle)은 손길이 끊고 들어간다(눌린 그림·손길 몸짓이 이긴다).
   */
  let moveSource: 'react' | 'poke' | 'idle' | null = null;
  /** 누르고 있는 동안의 눌린 그림 */
  let pressed = false;
  /** 마우스를 올린 자세(-1·0·1 = 커서 쪽으로 한 칸 기울어 한 칸 뜸). null 이면 없음 */
  let hover: PokeSide | null = null;
  let hoverPeek: 0 | 1 | 2 | null = null;
  /** 손길의 눈(남은 ms) */
  let pokePeek: { frame: 0 | 1 | 2; ms: number } = { frame: 0, ms: 0 };
  /** 안에서 두드리는 표시: 몸짓 시작에서 at ms 뒤부터 240ms */
  let knocks: readonly { at: number; side: 'r' | 'l' }[] = [];
  /** 품기: 번갈지 않는 고정 테두리 */
  let holdGlow = false;
  /** 문지르는 방향(한 칸) */
  let rubDx = 0;
  /** 움직임 줄이기의 멈춘 표시 */
  let still = false;
  let stillTimer: ReturnType<typeof setTimeout> | null = null;
  /** 마지막 손길 시각(다 채운 알의 들썩임을 한 박자 쉰다) */
  let lastPokeAt = -Infinity;
  const KNOCK_MS = 240;

  const moveJob: Job = (_now, dt) => {
    moveMs += dt;
    squashMs = Math.max(0, squashMs - dt);
    asideMs = Math.max(0, asideMs - dt);
    pokePeek.ms = Math.max(0, pokePeek.ms - dt);
    if (move && moveMs >= moveDuration(move)) {
      move = null;
      moveSource = null;
      knocks = [];
    }
    canvas?.redraw();
    return move !== null || squashMs > 0 || asideMs > 0 || pokePeek.ms > 0;
  };

  function play(next: Move, source: 'react' | 'poke' | 'idle' = 'react') {
    if (env.reduced) return;
    move = next;
    moveMs = 0;
    moveSource = source;
    if (source === 'react') knocks = [];
    wake(moveJob);
  }

  /** 알 한가운데(48칸 기준)와 알 꼭대기 */
  const CENTER = { x: 24, y: 34 };
  const TOP = { x: 24, y: 22 };
  /** 움직임 줄이기의 멈춘 하트 자리(알 오른쪽 어깨 옆) */
  const STILL = { x: 37, y: 20 };

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
    clearPoke();
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

  // ── 손길(#39): EggPoke 가 해석해 부른다 ─────────────────────────────

  /** 답할 때의 반응이 이긴다: 손길이 남긴 그림을 모두 거둔다 */
  function clearPoke() {
    pressed = false;
    pokePeek = { frame: 0, ms: 0 };
    knocks = [];
    holdGlow = false;
    rubDx = 0;
    clearStill();
  }

  function clearStill() {
    if (stillTimer) clearTimeout(stillTimer);
    stillTimer = null;
    still = false;
  }

  /** 답할 때의 반응 몸짓이 돌고 있는지(그동안의 손길은 글만) */
  export function busy(): boolean {
    return move !== null && moveSource === 'react';
  }

  /** 밭에 누름 조각을 띄울 자리가 있는지 */
  export function roomy(): boolean {
    return field.particles.length <= POKE.fieldRoom;
  }

  /** 기다리며 들썩이던 몸짓을 끊는다(손길이 이긴다) */
  function stopIdle() {
    if (moveSource !== 'idle') return;
    move = null;
    moveSource = null;
  }

  /** 누르는 순간: 한 줄 납작한 그림을 바로 그린다(움직임 줄이기면 그리지 않는다) */
  export function press(): void {
    if (!pokeable || env.reduced || busy()) return;
    stopIdle();
    pressed = true;
    canvas?.redraw();
  }

  /** 스크롤로 넘어가 취소: 그림만 제자리 */
  export function unpress(): void {
    if (!pokeable) return;
    const changed = pressed || holdGlow || rubDx !== 0;
    pressed = false;
    holdGlow = false;
    rubDx = 0;
    if (changed) canvas?.redraw();
  }

  /** 뗄 때: 해석한 반응을 튼다(side: 누른 자리 — 조각은 반대쪽 위로 튄다) */
  export function release(recipe: PokeRecipe, side: PokeSide = 0): void {
    if (!pokeable) return;
    lastPokeAt = performance.now();
    pressed = false;
    holdGlow = false;
    rubDx = 0;
    if (recipe.still) {
      showStill();
      return;
    }
    // 몸짓을 늦게 튼 사이(빨리 뗀 누름)에 답할 때의 반응이 시작됐으면 그쪽이 이긴다: 눌린 그림만 거둔다
    if (env.reduced || busy()) {
      canvas?.redraw();
      return;
    }
    if (recipe.move) {
      knocks = recipe.knock;
      play(recipe.move, 'poke');
    }
    if (recipe.peek) {
      pokePeek = { ...recipe.peek };
      wake(moveJob);
    }
    if (recipe.bits) emitBits(recipe.bits, side);
    canvas?.redraw();
  }

  /** 움직임 줄이기: 멈춘 하트 한 장을 잠깐(다시 그리기 두 번, 루프 없음) */
  function showStill() {
    clearStill();
    still = true;
    canvas?.redraw();
    stillTimer = setTimeout(() => {
      stillTimer = null;
      still = false;
      canvas?.redraw();
    }, POKE.stillMs);
  }

  /** 알 바닥(48칸 기준)과 알 둘레 반지름: 그림 egg-hatch 의 ground(24, 45), 폭 24칸·높이 24칸 */
  const FLOOR_Y = 45;
  const RIM = 13;

  function emitBits(bits: PokeBits, side: PokeSide) {
    if (bits.shape === 'down') {
      // 먼지: 알 바닥 양옆에서 바닥을 따라 퍼진다(배 위에 얹혀 얼룩처럼 보이지 않게, 무대 밑으로 빠지지 않게)
      for (let i = 0; i < bits.count; i += 1) {
        const dir = (i % 2 === 0 ? (side > 0 ? -1 : 1) : side > 0 ? 1 : -1) as -1 | 1;
        emitBurst(field, {
          x: CENTER.x + dir * 11,
          y: FLOOR_Y - 1,
          count: 1,
          speed: [8, 14],
          angle: dir > 0 ? [Math.PI * 1.8, Math.PI * 1.95] : [Math.PI * 1.05, Math.PI * 1.2],
          gravity: 30,
          ttl: [380, 460],
          look: { sprite: bits.sprite, frames: bits.frames ?? 1 },
        });
      }
    } else if (bits.shape === 'ring') {
      // 별 둘레: 알 테두리 바로 밖(반지름 13)에서 바깥으로 터진다. 위쪽 반원만(바닥 아래로 잘리지 않게),
      // 거리는 무대 높이에 맞춘다(작은 무대에서도 무대 안에 머문다)
      const speed: readonly [number, number] = rows >= 44 ? [14, 18] : [6, 9];
      const from = Math.PI * 0.92;
      const span = Math.PI * 1.16;
      for (let i = 0; i < bits.count; i += 1) {
        const angle = from + (span * i) / Math.max(1, bits.count - 1);
        emitBurst(field, {
          x: CENTER.x + Math.round(Math.cos(angle) * RIM),
          y: CENTER.y + Math.round(Math.sin(angle) * RIM),
          count: 1,
          speed,
          angle: [angle, angle],
          gravity: 0,
          ttl: [380, 440],
          delay: [0, 40],
          look: { sprite: bits.sprite },
        });
      }
    } else {
      // 부채꼴: 알 테두리 바로 위에서(얼굴에 붙어 보이지 않게)
      emitBurst(field, {
        x: TOP.x,
        y: TOP.y - 1,
        count: bits.count,
        speed: [16, 26],
        angle: fanFor(side),
        lift: 6,
        gravity: 40,
        ttl: [320, 460],
        look: { sprite: bits.sprite, frames: bits.frames ?? 1 },
      });
    }
    stopField = runField(field, () => canvas?.redraw());
  }

  /** 마우스를 올린 자세. 바뀔 때만 다시 그린다. null 이면 풀고 제자리에 '통' */
  export function setHover(side: PokeSide | null, peek: 0 | 1 | 2 | null = null): void {
    if (!pokeable || env.reduced) return;
    if (side === hover && peek === hoverPeek) return;
    const leaving = side === null && hover !== null;
    hover = side;
    hoverPeek = side === null ? null : peek;
    if (leaving && move === null && !pressed) play(MOVES.bump, 'poke');
    else canvas?.redraw();
  }

  /** 품기: 고정 테두리를 켜고 끈다. heart 면 하트 하나가 오른다 */
  export function hold(on: boolean, heart = false): void {
    if (!pokeable || env.reduced) return;
    holdGlow = on;
    if (heart) {
      emitRise(field, {
        from: { x: TOP.x, y: TOP.y + 4 },
        // 무대 위쪽의 글 한 줄에 가리지 않게 낮게 오른다
        to: { x: TOP.x + 1, y: TOP.y - 8 },
        count: 1,
        ttl: [860, 940],
        sway: 6,
        look: { sprite: 'fxc-heart' },
      });
      stopField = runField(field, () => canvas?.redraw());
    }
    canvas?.redraw();
  }

  /** 문지르기: 손가락 쪽으로 한 칸. 바뀔 때마다 먼지 하나(금이 길어졌으면 반짝이도) */
  export function rub(dir: -1 | 1, bits: boolean, wiggle: boolean): void {
    if (!pokeable || env.reduced || busy()) return;
    rubDx = dir;
    stopIdle();
    if (wiggle && move === null) play(MOVES.giggle, 'poke');
    if (bits && roomy()) {
      // 바닥에서 손가락 반대쪽으로 먼지가 인다(알 배 위가 아니라 바닥)
      emitBurst(field, {
        x: CENTER.x - dir * 11,
        y: FLOOR_Y - 1,
        count: 1,
        speed: [6, 10],
        angle: dir > 0 ? [Math.PI * 1.05, Math.PI * 1.2] : [Math.PI * 1.8, Math.PI * 1.95],
        gravity: 30,
        ttl: [340, 420],
        look: { sprite: stage >= 2 ? ['fxc-dust', 'fxc-spark'] : 'fxc-dust', frames: 1 },
      });
      stopField = runField(field, () => canvas?.redraw());
    }
    canvas?.redraw();
  }

  /** 메아리: 묶음이 끝난 뒤 안에서 같은 수만큼 두드린다 */
  export function echo(move: Move, marks: readonly { at: number; side: 'r' | 'l' }[]): void {
    if (!pokeable || env.reduced || busy()) return;
    knocks = marks;
    play(move, 'poke');
  }

  onMount(() => {
    const release = anim.use();
    return () => {
      release();
      sleep(moveJob);
      stopField?.();
      clearStill();
    };
  });

  // 다 채운 알은 1.5초쯤마다 들썩인다(공용 박자 250ms × 6). 방금 손길이 있었으면 한 박자 쉰다
  $effect(() => {
    const tick = anim.tick;
    if (ready && !anim.reduced && tick > 0 && tick % 6 === 0 && move === null) {
      if (pokeable && (pressed || performance.now() - lastPokeAt < 1500)) return;
      play(MOVES.wiggle, 'idle');
    }
  });

  function render(target: Stage) {
    const tick = anim.reduced ? 0 : anim.tick;
    // 자리: 몸짓 > 문지르기 > 마우스 올린 자세 > 제자리
    const at = move
      ? moveAt(move, moveMs)
      : rubDx !== 0
        ? { dx: rubDx, dy: 0 }
        : hover !== null
          ? { dx: hover, dy: -1 }
          : { dx: 0, dy: 0 };
    // 눈: 말풍선 쪽을 보는 중이면 2 > 손길의 눈 > 올린 자세의 눈 > 가끔 깜빡(1) > 보통 0
    const peek =
      asideMs > 0
        ? 2
        : pokePeek.ms > 0
          ? pokePeek.frame
          : still && stage >= 1
            ? 2
            : (hoverPeek ?? (tick % 16 === 15 ? 1 : 0));
    const comp = eggPose({
      stage,
      peek,
      // 번갈아 빛나기: 두 박자(500ms)마다. 움직임 줄이기면 얇은 테두리로 멈춘다. 품는 동안은 번갈지 않는다
      glow: holdGlow ? (ready ? 2 : 1) : ready ? (Math.floor(tick / 2) % 2 === 0 ? 1 : 2) : 0,
      lightStage: !theme.dark,
      squash: squashMs > 0 || pressed,
      dx: at.dx,
      dy: at.dy,
      paint,
    });
    const ox = Math.floor((target.w - 48) / 2);
    const oy = target.h - 48;
    if (comp) blit(target, comp, ox, oy);
    // 안에서 두드리는 표시(부화 장면과 같은 자리·같은 그림)
    if (move && knocks.length > 0) {
      const knock = getSprite('fxc-knock-side');
      if (knock)
        for (const mark of knocks) {
          const since = moveMs - mark.at;
          if (since < 0 || since >= KNOCK_MS) continue;
          const frame = since < KNOCK_MS / 2 ? 0 : 1;
          if (mark.side === 'r') sprite(target, knock, ox + 36, oy + 30, { frame });
          else sprite(target, knock, ox + 11, oy + 30, { frame, flipX: true });
        }
    }
    // 움직임 줄이기의 멈춘 표시: 알 오른쪽 어깨 옆 하트 한 장(무대 위쪽의 글 한 줄에 가리지 않게)
    if (still) {
      const heart = getSprite('fxc-heart');
      if (heart) sprite(target, heart, ox + STILL.x, oy + STILL.y);
    }
    drawParticles(target, field, ox, oy, getSprite, theme.dark ? { 14: 13 } : undefined);
  }
</script>

<StageCanvas bind:this={canvas} {rows} {scale} {render} />
