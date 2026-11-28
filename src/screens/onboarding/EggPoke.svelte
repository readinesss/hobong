<script lang="ts">
  /**
   * 알 콕 누르기(#39): 알 무대를 이름 있는 단추로 감싸, 누르기·길게 누르기(품기)·문지르기·마우스 올리기에 반응한다.
   *
   * - 손길 해석은 src/lib/fx/poke.ts(순수 함수)가, 그리기는 EggStage 가 한다. 이 파일은 이벤트를 잇기만 한다.
   * - 입력을 방해하지 않는다: pointerdown·mousedown·touchend 의 기본 동작을 막아 입력 칸의 포커스·화면 키보드·
   *   캐럿이 그대로다(실험: docs/PLAN.md 부록 N). 알 손길은 스크롤·포커스 옮기기·질문·맞장구를 하나도 건드리지 않는다.
   * - 누르면 같은 이벤트 안에서 눌린 그림을 그리고(100ms 안), 뗄 때 몸짓·조각·글·신호를 낸다.
   *   세로로 끌어 스크롤로 넘어가면 그림만 제자리(글·신호 없음).
   * - 마우스를 올리면(마우스가 있는 기기에서 마우스일 때만) 알아채고 커서 쪽으로 기운다. 터치에는 올리기가 없다.
   *   CSS :hover 로 만들지 않는다(터치 뒤 끈적하게 남는다).
   * - 키보드: Space·Enter 로 누른다(keydown 이 누름, click 이 확정). 낭독기의 click 도 한 번 누르기다.
   * - 글: 누를 때마다 무대 위에 짧은 한 줄(좁은 무대는 소리 글자). 낭독은 손길 한 묶음이 끝날 때 한 줄만(polite).
   * - 움직임 줄이기: 몸짓·조각 없이 글 한 줄과 멈춘 표시만. 진동은 신호(egg-poke)만 내고 haptics.ts 가 켰을 때만 잇는다.
   * - 누른 수는 메모리에만 둔다(저장 형식 그대로).
   */
  import { onMount, tick, type Snippet } from 'svelte';
  import { env } from '../../lib/fx/core.ts';
  import { emitCue } from '../../lib/fx/cues.ts';
  import {
    createPokeTracker,
    echoCount,
    echoMove,
    pickPokeLine,
    POKE,
    pokeReaction,
    pokeSfx,
    sideOf,
    type PokeCommit,
    type PokeLineKey,
    type PokeSide,
  } from '../../lib/fx/poke.ts';
  import { newTalkSeed, TALK } from '../../lib/talk.ts';
  import type EggStage from './EggStage.svelte';

  interface Props {
    /** 감싼 알(EggStage, pokeable) */
    egg: ReturnType<typeof EggStage> | undefined;
    /** 금 단계(0~4) */
    stage: number;
    /** 무대가 넓어 문장을 보일 수 있는지(아니면 소리 글자) */
    wordy?: boolean;
    /** 말풍선 옆 작은 무대(화면 키보드가 올라왔을 때) */
    compact?: boolean;
    /** 알 무대의 배율(소리 글자를 알 옆에 붙인다) */
    eggScale?: number;
    /** 폼을 내려도 위에 붙어 있는 무대('한 번에 쓰기') */
    sticky?: boolean;
    /** 확정할 때마다 이번 화면에서 누른 수를 알린다 */
    onpoke?: (total: number) => void;
    children: Snippet;
  }

  let {
    egg,
    stage,
    wordy = false,
    compact = false,
    eggScale = 2,
    sticky = false,
    onpoke,
    children,
  }: Props = $props();

  let button = $state<HTMLButtonElement>();
  /** 무대 위에 잠깐 보이는 한 줄(장식. 같은 뜻은 낭독 줄이 전한다) */
  let say = $state('');
  /** 낭독 줄(묶음에 한 번) */
  let spoken = $state('');
  /** 마우스를 올려 둔 동안 */
  let hovering = $state(false);

  const tracker = createPokeTracker();
  let turn = newTalkSeed() % 997;
  let lastLine: string | null = null;
  /** 이 묶음에서 마지막으로 보인 문장(묶음이 끝나면 이 줄을 읽는다) */
  let bundleLine = '';
  /** 지금 누르고 있는 포인터(키보드·낭독기면 null) */
  let pointerId: number | null = null;
  let downAt = 0;
  /** pointer 누름이 끝난 시각(확정이든 취소든). 뒤따르는 click 을 버린다 */
  let pointerEndAt = -Infinity;
  let hoverSide: PokeSide = 0;
  let fine: MediaQueryList | null = null;
  /** 문지르기 먼지: 2초에 6개까지 */
  let rubBits: number[] = [];

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let sayTimer: ReturnType<typeof setTimeout> | null = null;
  let spokenTimer: ReturnType<typeof setTimeout> | null = null;
  let blinkTimer: ReturnType<typeof setTimeout> | null = null;
  /** 눌린 그림을 최소 시간만큼 보이고 나서 틀 반응 */
  let pending: { timer: ReturnType<typeof setTimeout>; run: () => void } | null = null;

  const now = () => performance.now();
  const stop = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer);
    return null;
  };

  function flushPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { run } = pending;
    pending = null;
    run();
  }

  function sideAt(x: number): PokeSide {
    const box = button?.getBoundingClientRect();
    return box ? sideOf(x, box.left, box.width) : 0;
  }

  // ── 누르기 ──────────────────────────────────────────────────────────

  function begin(x: number, y: number, side: PokeSide): boolean {
    flushPending();
    const t = now();
    if (!tracker.down(t, x, y, side)) return false;
    downAt = t;
    egg?.press();
    scheduleTick(t + POKE.holdMs);
    return true;
  }

  function scheduleTick(at: number) {
    holdTimer = stop(holdTimer);
    holdTimer = setTimeout(onTick, Math.max(0, at - now()));
  }

  function onTick() {
    holdTimer = null;
    const step = tracker.tick(now());
    if (step.holdStart || step.heart) egg?.hold(true, step.heart === true);
    if (step.nextAt !== null) scheduleTick(step.nextAt);
  }

  /**
   * 누름을 취소한다(스크롤로 넘어감·밖에서 뗌·포인터 취소·포커스 잃음): 그림만 제자리, 글·신호 없음.
   * 해석기가 이미 누름을 풀었어도(세로 끌기) 눌린 그림은 늘 거둔다(unpress 는 바뀐 것이 있을 때만 그린다).
   */
  function abort() {
    holdTimer = stop(holdTimer);
    // 포인터 누름이었으면 뒤따르는 click(마우스는 캡처한 단추로 온다)을 확정으로 받지 않는다
    if (pointerId !== null) pointerEndAt = now();
    pointerId = null;
    tracker.cancel();
    egg?.unpress();
  }

  function commit(): PokeCommit | null {
    holdTimer = stop(holdTimer);
    const c = tracker.up(now());
    if (c) respond(c);
    return c;
  }

  function respond(c: PokeCommit) {
    const t = now();
    const recipe = pokeReaction({
      kind: c.kind,
      stage,
      combo: c.combo,
      side: c.side,
      rest: c.rest,
      reduced: env.reduced,
      busy: egg?.busy() ?? false,
      roomy: egg?.roomy() ?? true,
    });
    // 그림: 눌린 그림이 최소 50ms 는 보이게(빨리 떼면 몸짓을 그만큼 늦게)
    const wait = downAt + POKE.minSquashMs - t;
    const run = () => egg?.release(recipe, c.side);
    if (wait > 0 && recipe.move && !env.reduced) {
      const timer = setTimeout(() => {
        pending = null;
        run();
      }, wait);
      pending = { timer, run };
    } else run();
    // 글
    show(recipe.line);
    // 신호: 묶음의 첫 확정·품기에만(사용자 동작 안에서 낸다 — 진동은 그래야 울린다)
    if (c.cue) emitCue('egg-poke', { stage, combo: c.combo, hold: c.kind === 'hold' });
    onpoke?.(c.total);
    settleTimer = stop(settleTimer);
    settleTimer = setTimeout(settle, POKE.quietMs);
  }

  function show(key: PokeLineKey) {
    turn += 1;
    // 움직임 줄이기면 알이 멈춰 있으니 몸짓을 말하지 않는 문장(egg.poke.still)
    const line = pickPokeLine(key, turn, lastLine, env.reduced);
    lastLine = line;
    bundleLine = line;
    say = wordy ? line : pokeSfx(key, env.reduced);
    sayTimer = stop(sayTimer);
    sayTimer = setTimeout(() => {
      sayTimer = null;
      say = '';
    }, POKE.sayMs);
  }

  /** 묶음이 끝났다: 낭독 한 줄, 금이 길어진 알이면 메아리 */
  function settle() {
    settleTimer = null;
    const bundle = tracker.settle(now());
    if (!bundle) {
      // 아직 누르고 있다: 뗄 때 다시 잰다
      return;
    }
    const n = echoCount(bundle, stage);
    if (n !== null && !env.reduced && egg && !egg.busy()) {
      const marks = Array.from({ length: n }, (_, i) => ({
        at: i * 200,
        side: (i % 2 === 0 ? 'r' : 'l') as 'r' | 'l',
      }));
      egg.echo(echoMove(n), marks);
      show('echo');
    }
    void speak(bundleLine);
  }

  async function speak(line: string) {
    if (!line) return;
    if (spoken === line) {
      spoken = '';
      await tick();
    }
    spoken = line;
    spokenTimer = stop(spokenTimer);
    spokenTimer = setTimeout(() => {
      spokenTimer = null;
      spoken = '';
    }, POKE.spokenMs);
  }

  /** 질문이 바뀔 때: 기다리던 낭독 줄을 버린다(포커스 낭독과 겹치지 않게) */
  export function quiet(): void {
    settleTimer = stop(settleTimer);
    spokenTimer = stop(spokenTimer);
    tracker.forget();
    spoken = '';
  }

  // ── 포인터 ──────────────────────────────────────────────────────────

  function onPointerDown(e: PointerEvent) {
    if (!e.isPrimary || e.button !== 0) return;
    // 입력 칸의 포커스·화면 키보드·캐럿을 지킨다(알 단추로 포커스를 옮기지 않는다)
    e.preventDefault();
    if (pointerId !== null || tracker.pressing) return;
    if (e.pointerType === 'mouse') {
      try {
        button?.setPointerCapture(e.pointerId);
      } catch {
        // 잡지 못해도 누름은 그대로
      }
    }
    if (begin(e.clientX, e.clientY, sideAt(e.clientX))) pointerId = e.pointerId;
  }

  function onPointerMove(e: PointerEvent) {
    if (pointerId === null && isMouseHover(e)) {
      const side = sideAt(e.clientX);
      if (!hovering) enter(side);
      else if (side !== hoverSide) {
        hoverSide = side;
        egg?.setHover(side, peekFor(side));
      }
    }
    if (e.pointerId !== pointerId) return;
    const step = tracker.move(now(), e.clientX, e.clientY);
    if (!step) return;
    if (step.cancel) {
      abort();
      return;
    }
    if (step.rub && step.rub.turns >= POKE.rubTurns) {
      const t = now();
      rubBits = rubBits.filter((at) => t - at < 2000);
      const bits = rubBits.length < 6;
      if (bits) rubBits.push(t);
      egg?.rub(step.rub.dir, bits, step.rub.turns === POKE.rubTurns + 1);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    // 보통 단추처럼, 알 밖으로 끌고 가서 떼면 취소다
    const box = button?.getBoundingClientRect();
    if (
      box &&
      (e.clientX < box.left ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom)
    ) {
      abort();
      return;
    }
    pointerId = null;
    pointerEndAt = now();
    commit();
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    abort();
  }

  // ── 마우스 올리기(마우스가 있는 기기에서 마우스일 때만) ─────────────────

  function isMouseHover(e: PointerEvent): boolean {
    return e.pointerType === 'mouse' && fine?.matches === true && !env.reduced;
  }

  const peekFor = (side: PokeSide): 0 | 1 | 2 | null => (stage >= 1 ? (side === 1 ? 2 : 0) : null);

  function enter(side: PokeSide) {
    hovering = true;
    hoverSide = side;
    egg?.setHover(side, peekFor(side));
    blinkTimer = stop(blinkTimer);
    if (stage < 1) return;
    // 알아챈 지 조금 뒤에 한 번 깜빡인다(올린 동안 한 번만)
    blinkTimer = setTimeout(() => {
      if (!hovering) return;
      egg?.setHover(hoverSide, 1);
      blinkTimer = setTimeout(() => {
        blinkTimer = null;
        if (hovering) egg?.setHover(hoverSide, peekFor(hoverSide));
      }, POKE.blinkMs);
    }, POKE.hoverBlinkMs);
  }

  function leave() {
    blinkTimer = stop(blinkTimer);
    if (!hovering) return;
    hovering = false;
    egg?.setHover(null);
  }

  function onPointerEnter(e: PointerEvent) {
    if (isMouseHover(e)) enter(sideAt(e.clientX));
  }

  function onPointerLeave(e: PointerEvent) {
    if (e.pointerType === 'mouse') leave();
  }

  // ── 키보드·낭독기 ────────────────────────────────────────────────────

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    // 누르고 있는 키의 반복은 한 번 누르기다: 반복 keydown 의 기본 동작(Enter 의 click)을 막는다
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    if (e.isComposing || tracker.pressing) return;
    const box = button?.getBoundingClientRect();
    begin(box ? box.left + box.width / 2 : 0, box ? box.top + box.height / 2 : 0, 0);
  }

  function onClick() {
    // 포인터 누름(확정·취소 모두) 뒤의 click 은 버린다(터치는 touchend 에서 막아 오지 않는다)
    if (now() - pointerEndAt < POKE.clickEchoMs) return;
    if (pointerId !== null) return;
    // 키보드(keydown 에서 눌렀다) 또는 낭독기의 click(누름 없이 온다)
    if (!tracker.pressing) {
      const box = button?.getBoundingClientRect();
      if (!begin(box ? box.left + box.width / 2 : 0, box ? box.top + box.height / 2 : 0, 0)) return;
    }
    commit();
  }

  function onBlur() {
    if (pointerId === null) abort();
  }

  onMount(() => {
    const el = button;
    const preventTouchEnd = (e: TouchEvent) => {
      // 터치 뒤의 합성 click·mousedown 을 막는다(포커스를 옮기지 않고, 두 번 반응하지 않게)
      if (e.cancelable) e.preventDefault();
    };
    el?.addEventListener('touchend', preventTouchEnd, { passive: false });
    fine =
      typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : null;
    const onFine = () => {
      if (!fine?.matches) leave();
    };
    fine?.addEventListener('change', onFine);
    return () => {
      el?.removeEventListener('touchend', preventTouchEnd);
      fine?.removeEventListener('change', onFine);
      for (const timer of [holdTimer, settleTimer, sayTimer, spokenTimer, blinkTimer]) stop(timer);
      if (pending) clearTimeout(pending.timer);
      pending = null;
    };
  });
</script>

<button
  type="button"
  class="egg-poke"
  class:compact
  class:sticky
  aria-label={TALK.egg.poke.label}
  data-hover={hovering ? '' : undefined}
  bind:this={button}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onpointerenter={onPointerEnter}
  onpointerleave={onPointerLeave}
  onmousedown={(e) => e.preventDefault()}
  oncontextmenu={(e) => e.preventDefault()}
  ondragstart={(e) => e.preventDefault()}
  onkeydown={onKeyDown}
  onclick={onClick}
  onblur={onBlur}
>
  {@render children()}
  {#if say}<span
      class="egg-say"
      class:sfx={!wordy}
      class:near={!wordy && !compact}
      style:--egg-half="{eggScale * 14}px"
      aria-hidden="true"
    >
      {say}
    </span>{/if}
</button>
<p class="sr-only egg-spoken" role="status">{spoken}</p>

<style>
  .egg-poke {
    position: relative;
    display: block;
    width: 100%;
    min-width: 44px;
    min-height: 44px;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    text-align: inherit;
    cursor: pointer;
    /* 세로 스크롤과 핀치 확대는 남기고, 두 번 눌러 확대·가로 끌기는 알이 받는다 */
    touch-action: pan-y pinch-zoom;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  .egg-poke :global(canvas) {
    -webkit-user-drag: none;
  }
  /* 말풍선 옆 작은 무대: .scene.compact(flex)의 자식 */
  .egg-poke.compact {
    flex: none;
    display: flex;
    width: auto;
  }
  .egg-poke.sticky {
    position: sticky;
    top: var(--safe-t);
    z-index: 5;
  }
  .egg-poke:focus-visible {
    outline-offset: 0;
  }
  /* 무대 위에 잠깐 보이는 한 줄. 흐름 밖이라 말풍선·[다음]을 밀지 않는다 */
  .egg-say {
    position: absolute;
    top: 9px;
    left: 0;
    right: 0;
    width: fit-content;
    max-width: calc(100% - 24px);
    margin: 0 auto;
    padding: 3px 6px;
    background: var(--bubble);
    color: #1a1c2c;
    font-family: var(--font-cap);
    font-size: 12px;
    line-height: 15px;
    text-align: center;
    overflow-wrap: anywhere;
    pointer-events: none;
    box-shadow:
      0 calc(var(--u) * -1) 0 0 #1a1c2c,
      0 var(--u) 0 0 #1a1c2c,
      calc(var(--u) * -1) 0 0 0 #1a1c2c,
      var(--u) 0 0 0 #1a1c2c;
  }
  /* 소리 글자: 작게. 좁은 무대(말풍선 옆)는 왼쪽 위 모서리, 넓은 무대는 알 오른쪽 어깨 옆(알과 이어 읽히게) */
  .egg-say.sfx {
    top: 6px;
    left: 6px;
    right: auto;
    margin: 0;
    padding: 0 3px;
    max-width: none;
    white-space: nowrap;
  }
  .egg-say.sfx.near {
    left: calc(50% + var(--egg-half));
  }
  @media (forced-colors: active) {
    .egg-say {
      border: var(--u) solid CanvasText;
      background: Canvas;
      color: CanvasText;
    }
  }
</style>
