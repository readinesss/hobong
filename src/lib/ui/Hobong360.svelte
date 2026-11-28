<script lang="ts">
  /**
   * 호봉이 돌려 보기(#22). 2D 그림 위에 같은 자리·같은 크기로 복셀 입체(WebGL1)를 겹쳐 두고,
   * 돌리기 시작하면 입체로, 정면에 멈추면 다시 2D 그림으로 돌아온다.
   *
   * - 처음에는 늘 2D 그림이다(효과만 뺀 still 자세: 동전·반짝이는 입체에 없다). 입체 모형은 열자마자 fx/core 루프에서
   *   한 프레임에 한 단계씩 만들어 두고(generateSteps), 각도가 0° 를 벗어나는 첫 프레임에 입체로 바꾼다.
   *   바꿀 때는 한 칸 걸러 바둑판으로 두 장면을 겹치는 한 박자(120ms)를 둔다(반투명 섞기는 팔레트 밖 색을 만든다).
   *   정면에 멈추면 같은 한 박자로 2D 에 돌아온다. 다만 0° 입체가 2D 와 많이 다른 모습(앞모습 겹침 0.95 미만 — 봉황:
   *   2D 의 두 꼬리 뭉치 대신 발밑 부채)은 멈춘 채 바꾸면 튀므로 정면에서도 입체 그대로 둔다.
   * - 그리는 것은 각도·둥실거림·테마가 바뀔 때뿐. 일이 없으면 루프에서 빠진다(가만히 있으면 프레임 요청 0).
   * - 조작: 끌기(마우스·터치, 가로만 — 세로는 화면 넘기기. 튕기면 관성으로 돌다 15° 칸에 멈춘다), ←/→ 45°, Home 정면,
   *   자동 회전(이 기기에 기억). 자동 회전은 실제로 가로로 끌 때만 꺼진다(톡 누르기·세로 넘기기는 그대로).
   *   움직임 줄이기: 자동 회전·관성 없음, 키·끌기 모두 45° 단계로 바로, 내려다보는 각도 2단, 바둑판 섞기 없음.
   * - 정수 픽셀: 복셀 1칸 = 기기 픽셀 round(scale × dpr) 칸. 2D 그림(Sprite)과 같은 셈이라 두 장면이 칸까지 겹친다.
   * - WebGL 을 쓸 수 없거나 모형을 만들 수 없으면 2D 그림을 그대로 두고 까닭을 한 줄로 알린다.
   */
  import { onMount, untrack } from 'svelte';
  import { anim } from '../app/anim.svelte.ts';
  import { prefs } from '../app/prefs.svelte.ts';
  import { theme } from '../app/theme.svelte.ts';
  import type { Look } from '../character/look.ts';
  import { characterRules } from '../character/rules.ts';
  import { frontCheck, RAMP } from '../character/voxel/generate.ts';
  import {
    cachedModel,
    meshOf,
    modelJob,
    releaseMesh,
    voxelKey,
    type VoxelModel,
  } from '../character/voxel/model.ts';
  import { makeRenderer, VIEW, type VoxelRenderer } from '../character/voxel/renderer.ts';
  import {
    degreeOf,
    directionOf,
    isFront,
    nextStop,
    normYaw,
    signedYaw,
    TURN_STEP,
  } from '../character/voxel/turn.ts';
  import { sleep, wake, type Job } from '../fx/core.ts';
  import Icon from './Icon.svelte';
  import Sprite from './Sprite.svelte';

  interface Props {
    look: Look;
    /** 복셀(=2D 그림의 한 픽셀) 한 칸의 CSS 픽셀(정수) */
    scale?: number;
    /** 호봉이의 이름(형태·꾸미기). 방향 앞에 붙여 읽는다 */
    label: string;
  }

  let { look, scale = 4, label }: Props = $props();

  /** 프레임버퍼 한 변(칸)과 그 안에서 48×48 2D 그림이 놓이는 자리 */
  const N = VIEW.fb;
  const PAD = (N - 48) / 2;
  /** 무대 바닥 띠가 시작하는 칸(홈 무대와 같은 높이: 그림 41째 줄) */
  const GROUND = PAD + 41;
  /** 2D 그림 캔버스: 48×48 둘레에 한 칸씩 빈 테두리 */
  const FRAME = { x: -1, y: -1, w: 50, h: 50 };
  /** 2D ↔ 입체가 바뀔 때 바둑판으로 겹치는 시간(ms) */
  const FADE_MS = 120;
  /** 끌기: 무대 너비의 몇 배를 끌면 한 바퀴인지 */
  const DRAG_TURN = 1.5;
  /** 창을 연 뒤 자동 회전을 시작하기까지(ms) */
  const OPEN_HOLD = 400;
  /** 관성: 프레임(16.7ms)마다 줄어드는 비율, 멈추는 속도(°/ms), 가장 빠른 속도, 손을 뗄 때 속도를 재는 시간(ms) */
  const SPIN_DECAY = 0.9;
  const SPIN_STOP = 0.03;
  const SPIN_MAX = 1.5;
  const SPIN_WINDOW = 80;
  /** 관성이 멈출 때 붙는 칸(°) */
  const SNAP = 15;
  const CANT_BUILD = '이 모습은 입체로 만들 수 없어 그림으로 보여 드려요.';
  const LOST = '잠시 입체로 그릴 수 없어 그림으로 보여 드려요. 다시 그릴 수 있게 되면 돌아와요.';
  /** 바둑판 가면(conic-gradient)을 못 쓰는 브라우저(Firefox 82 이하 등)는 바뀌는 한 박자를 건너뛴다 */
  const CAN_MASK =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    ['mask-image', '-webkit-mask-image'].some((p) =>
      CSS.supports(p, 'repeating-conic-gradient(#000 0 25%, transparent 0 50%)'),
    );

  // 첫 배율을 처음부터 맞춘다(마운트 뒤에 바꾸면 캔버스·WebGL 컨텍스트를 한 번 더 만든다)
  let dpr = $state(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const dev = $derived(Math.max(1, Math.round(scale * dpr)));
  const cell = $derived(dev / dpr);
  const reduced = $derived(anim.reduced);

  let root = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();

  /** 보이는 장면: 2D 그림 / 입체 / 입체 위에 2D 를 바둑판으로(바뀌는 한 박자) */
  let shown = $state<'2d' | '3d' | 'fade'>('2d');
  let note = $state('');
  let ready = $state(false);
  let auto = $state(false);
  let deg = $state(0);
  /** 낭독(키·단추·끌기를 마쳤을 때만 바꾼다. 자동 회전 중에는 조용히) */
  let said = $state('');
  let draws = $state(0);

  // 루프가 쓰는 값(반응형이 아니다)
  let yaw = 0;
  let target: number | null = null;
  let acc = 0;
  let clock = 0;
  let lift = 0;
  let dirty = false;
  let fadeLeft = 0;
  /** 바둑판 한 박자가 끝나면 보일 장면 */
  let fadeTo: '2d' | '3d' = '2d';
  /**
   * 정면에 멈추면 2D 로 돌아갈지. 0° 입체가 2D 와 많이 다른 모습(봉황: 2D 의 두 꼬리 뭉치 대신 발밑 부채)은
   * 돌아가는 순간이 튀므로 입체 그대로 정면에 둔다(앞모습 겹침 0.95 미만)
   */
  let backTo2d = true;
  let dragging: {
    id: number;
    x: number;
    yaw: number;
    moved: boolean;
    /** 최근 끌기 자취 [시각(ms), 각도] — 손을 뗄 때의 속도 */
    trail: [number, number][];
    /** 누를 때 관성으로 돌고 있었는지(붙잡아 멈춘 것) */
    caught: boolean;
  } | null = null;
  /** 관성 속도(°/ms, 0 이면 없음) */
  let spin = 0;
  let renderer: VoxelRenderer | null = null;
  /** 지금 렌더러를 데웠는지(warm) */
  let warmed = false;
  let model: VoxelModel | null = null;

  const direction = $derived(directionOf(deg));
  const usable = $derived(note === '');

  function paint() {
    dirty = false;
    if (!renderer || !model) return;
    renderer.draw(yaw, undefined, {
      reduced,
      lift,
      shadowInk: theme.dark ? 0 : undefined,
    });
    if (!warmed) {
      warmed = true;
      renderer.warm();
    }
    deg = degreeOf(yaw);
    draws += 1;
  }

  /** 바둑판 한 박자를 거쳐 to 로(움직임 줄이기는 바로) */
  function fadeInto(to: '2d' | '3d') {
    if (reduced || !CAN_MASK) {
      shown = to;
      return;
    }
    shown = 'fade';
    fadeTo = to;
    fadeLeft = FADE_MS;
  }

  /** 움직이기 시작했다: 모형이 준비돼 있으면 입체로 */
  function moving() {
    if (!ready) return;
    if (shown === '2d') fadeInto('3d');
    else if (shown === 'fade' && fadeTo === '2d') shown = '3d';
  }

  /** 멈췄다: 정면이면 2D 그림으로 돌아온다 */
  function settle() {
    if (shown !== '3d' || auto || target !== null || dragging || spin !== 0 || !isFront(yaw))
      return;
    yaw = 0;
    if (backTo2d) fadeInto('2d');
  }

  const frame: Job = (_now, dt) => {
    clock += dt;
    const spinning = auto && !reduced && ready && !dragging;
    if (spinning) {
      acc += dt;
      const stepMs = 1000 / VIEW.autoFps;
      while (acc >= stepMs) {
        acc -= stepMs;
        yaw = normYaw(yaw + 360 / VIEW.autoSteps);
        dirty = true;
      }
      // 떠 있는 봉황은 돌 때만 0.5초마다 한 칸 둥실(멈춰 있으면 그리지 않는다)
      const l = model?.res.meta.float ? Math.floor(clock / 500) % 2 : 0;
      if (l !== lift) {
        lift = l;
        dirty = true;
      }
    } else if (lift !== 0) {
      lift = 0;
      dirty = true;
    }
    if (spin !== 0 && !dragging) {
      yaw = normYaw(yaw + spin * dt);
      spin *= Math.pow(SPIN_DECAY, dt / (1000 / 60));
      dirty = dt > 0 || dirty;
      if (Math.abs(spin) < SPIN_STOP) {
        // 가까운 15° 칸에 붙인다(정면 가까이면 정면)
        spin = 0;
        const stop = Math.round(signedYaw(yaw) / SNAP) * SNAP;
        yaw = signedYaw(yaw);
        target = stop;
        say();
      }
    }
    // dt 0(같은 프레임에 두 번 불림)이면 움직인 것이 없다
    if (target !== null && ready && dt > 0) {
      const d = target - yaw;
      if (Math.abs(d) < 0.5) {
        yaw = normYaw(target);
        target = null;
      } else yaw += d * Math.min(1, dt / 90);
      dirty = true;
    }
    if (dirty) {
      if (!isFront(yaw) || target !== null) moving();
      paint();
    }
    if (shown === 'fade') {
      fadeLeft -= dt;
      if (fadeLeft <= 0) shown = fadeTo;
    }
    settle();
    return spinning || spin !== 0 || (target !== null && ready) || shown === 'fade' || dirty;
  };

  function nudge() {
    wake(frame);
  }

  function say() {
    said = `호봉이 ${directionOf(target ?? yaw)}`;
  }

  function setAuto(on: boolean, remember: boolean) {
    auto = on && !reduced;
    acc = 0;
    if (remember) prefs.set({ turnAuto: on });
    if (auto) {
      target = null;
      spin = 0;
    }
    nudge();
  }

  function turn(dir: -1 | 1) {
    if (!usable) return;
    setAuto(false, false);
    spin = 0;
    const to = nextStop(target ?? yaw, dir);
    if (reduced) {
      yaw = normYaw(to);
      target = null;
      dirty = true;
    } else target = to;
    said = `호봉이 ${directionOf(to)}`;
    nudge();
  }

  function front() {
    if (!usable) return;
    setAuto(false, false);
    spin = 0;
    if (reduced) {
      yaw = 0;
      target = null;
      dirty = true;
    } else {
      yaw = signedYaw(yaw);
      target = 0;
    }
    said = '호봉이 정면';
    nudge();
  }

  function adopt(m: VoxelModel) {
    if (model !== m) backTo2d = frontCheck(m.res, m.ref).iou >= 0.95;
    model = m;
    if (!renderer) return;
    renderer.setModel(meshOf(m), m.res.meta);
    ready = true;
    dirty = true;
    nudge();
  }

  function fail(reason: string) {
    note = reason;
    ready = false;
    auto = false;
    target = null;
    spin = 0;
    dragging = null;
    shown = '2d';
  }

  // 모형: 모습이 바뀌면 다시 만든다(캐시에 있으면 바로). 만드는 동안은 있던 장면을 그대로 둔다
  $effect(() => {
    const current = look;
    const key = voxelKey(current);
    const hit = cachedModel(key);
    if (hit) {
      untrack(() => adopt(hit));
      return;
    }
    const job = modelJob(current, (m) => {
      if (m) adopt(m);
      else fail(CANT_BUILD);
    });
    const run: Job = () => job();
    wake(run);
    return () => {
      job.cancel();
      sleep(run);
    };
  });

  // 렌더러: 캔버스(배율이 바뀌면 새 캔버스)마다 하나. 놓을 때 GPU 자원도 놓는다
  $effect(() => {
    const el = canvas;
    const size = N * dev;
    if (!el) return;
    el.width = size;
    el.height = size;
    const make = () =>
      makeRenderer(el, { palette: characterRules.palette, ramp: RAMP, scale: dev });
    const made = make();
    if (!made.ok) {
      untrack(() => fail(made.reason));
      return;
    }
    let r = made.renderer;
    const use = (next: VoxelRenderer) => {
      r = next;
      renderer = next;
      warmed = false;
      if (model) adopt(model);
    };
    // 컨텍스트를 잃으면(GPU 초기화·다른 탭이 GPU 를 많이 씀) 2D 로 두고, 브라우저가 되돌려 주면 렌더러를 다시 만든다
    const lost = (event: Event) => {
      event.preventDefault();
      renderer = null;
      fail(LOST);
    };
    const restored = () => {
      const again = make();
      if (!again.ok) {
        fail(again.reason);
        return;
      }
      note = '';
      use(again.renderer);
    };
    el.addEventListener('webglcontextlost', lost);
    el.addEventListener('webglcontextrestored', restored);
    untrack(() => use(r));
    return () => {
      el.removeEventListener('webglcontextlost', lost);
      el.removeEventListener('webglcontextrestored', restored);
      if (renderer === r) renderer = null;
      ready = false;
      r.dispose();
    };
  });

  // 테마(야근 모드의 그림자 색)·움직임 줄이기가 바뀌면 다시 그린다
  $effect(() => {
    void theme.dark;
    const r = reduced;
    untrack(() => {
      if (r && auto) auto = false;
      dirty = true;
      nudge();
    });
  });

  function onkey(event: KeyboardEvent) {
    if (!root || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    // 이 보기가 든 대화상자(없으면 이 보기) 안에 포커스가 있을 때만
    const scope = root.closest('[role="dialog"]') ?? root;
    const active = document.activeElement;
    if (!active || !scope.contains(active)) return;
    if (document.documentElement.hasAttribute('data-modal') && !root.closest('[role="dialog"]'))
      return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      turn(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      front();
    }
  }

  // 누르기만 해서는 자동 회전·키로 돌던 것을 건드리지 않는다(누르는 동안만 자동 회전이 쉰다). 관성은 붙잡아 멈춘다
  function down(event: PointerEvent) {
    if (!usable || event.button > 0 || !stage) return;
    const caught = spin !== 0;
    spin = 0;
    dragging = { id: event.pointerId, x: event.clientX, yaw, moved: false, trail: [], caught };
    stage.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const d = dragging;
    if (!d || event.pointerId !== d.id) return;
    const dx = event.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) {
      // 실제로 가로로 끌기 시작했다: 자동 회전·키 이동을 멈추고 손을 따른다
      d.moved = true;
      target = null;
      if (auto) setAuto(false, false);
    }
    let next = d.yaw + (dx * 360) / (N * cell * DRAG_TURN);
    if (reduced) next = Math.round(next / TURN_STEP) * TURN_STEP;
    const now = performance.now();
    d.trail.push([now, next]);
    while (d.trail.length > 2 && now - (d.trail[0] as [number, number])[0] > SPIN_WINDOW)
      d.trail.shift();
    if (next === yaw) return;
    yaw = next;
    dirty = true;
    moving();
    nudge();
  }
  /** 손을 뗄 때의 각속도(°/ms): 마지막 SPIN_WINDOW 동안 움직인 만큼. 그사이 멈춰 있었으면 0 */
  function release(d: NonNullable<typeof dragging>): number {
    const now = performance.now();
    const recent = d.trail.filter(([t]) => now - t <= SPIN_WINDOW * 1.5);
    const first = recent[0];
    const last = recent.at(-1);
    if (!first || !last || last[0] - first[0] < 8) return 0;
    const v = (last[1] - first[1]) / (last[0] - first[0]);
    return Math.max(-SPIN_MAX, Math.min(SPIN_MAX, v));
  }
  function up(event: PointerEvent) {
    const d = dragging;
    if (!d || event.pointerId !== d.id) return;
    dragging = null;
    // 튕겨 놓으면 관성으로 돈다(세로 넘기기로 바뀐 pointercancel·움직임 줄이기는 없음)
    const v = d.moved && !reduced && event.type === 'pointerup' ? release(d) : 0;
    if (Math.abs(v) >= SPIN_STOP * 3) {
      spin = v;
      moving();
    } else if (d.caught && !d.moved && !reduced) {
      // 도는 것을 붙잡아 세웠다: 가까운 15° 칸에 붙인다
      yaw = signedYaw(yaw);
      target = Math.round(yaw / SNAP) * SNAP;
      say();
    } else if (d.moved) {
      // 정면 가까이(±6°)에 놓으면 정면에 붙인다
      if (Math.abs(signedYaw(yaw)) < 6 && !isFront(yaw)) {
        yaw = 0;
        dirty = true;
      }
      say();
    }
    nudge();
  }

  onMount(() => {
    const update = () => {
      dpr = window.devicePixelRatio || 1;
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('keydown', onkey);
    const el = stage;
    el?.addEventListener('pointerdown', down);
    el?.addEventListener('pointermove', move);
    el?.addEventListener('pointerup', up);
    el?.addEventListener('pointercancel', up);
    // 자동 회전: 이 기기에 기억한 값(처음에는 켜짐). 움직임 줄이기에서는 끈다
    setAuto(prefs.turnAuto ?? true, false);
    // 열자마자 돌지 않고 잠깐 2D 그림(홈과 같은 모습)을 보여 준 뒤 돌기 시작한다
    acc = -OPEN_HOLD;
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('keydown', onkey);
      el?.removeEventListener('pointerdown', down);
      el?.removeEventListener('pointermove', move);
      el?.removeEventListener('pointerup', up);
      el?.removeEventListener('pointercancel', up);
      sleep(frame);
      releaseMesh();
    };
  });
</script>

<div
  class="h360"
  bind:this={root}
  data-view={shown}
  data-ready={ready ? 'true' : 'false'}
  data-deg={deg}
  data-draws={draws}
>
  <div
    class="stage"
    class:usable
    class:dark={theme.dark}
    bind:this={stage}
    style="width:{N * cell}px;height:{N * cell}px;--cell:{cell}px;--ground:{GROUND * cell}px"
  >
    <!-- 그림 자리 하나(role=img)에 2D 그림과 입체 캔버스를 겹친다. 이름은 지금 보는 방향 -->
    <span class="pic" role="img" aria-label="{label}. 호봉이 {direction}">
      <span
        class="flat"
        class:off={shown === '3d'}
        class:fade={shown === 'fade'}
        style="left:{(PAD - 1) * cell}px;top:{(PAD - 1) * cell}px"
      >
        <!-- 둘레에 빈 칸 하나: 창이 소수 기기 픽셀에 놓일 때 캔버스 가장자리 줄이 섞인 색이 되는데, 그 줄을 비워 둔다 -->
        <Sprite {look} {scale} animate={false} pose={{ still: true }} crop={FRAME} />
      </span>
      {#key dev}
        <canvas bind:this={canvas} class="solid" class:off={shown === '2d'} aria-hidden="true"
        ></canvas>
      {/key}
    </span>
  </div>

  <p class="dir cap" aria-hidden="true">
    호봉이 {direction} <span class="num muted">{deg}°</span>
  </p>
  <p class="sr-only" role="status">{said}</p>

  <div class="btn-row controls">
    <button
      type="button"
      class="btn small"
      onclick={() => turn(-1)}
      disabled={!usable}
      aria-label="왼쪽으로 45° 돌리기"
      title="왼쪽으로 45° (←)"
    >
      <Icon name="icon-chevron-left" />
    </button>
    <button type="button" class="btn small" onclick={front} disabled={!usable} title="정면 (Home)">
      정면
    </button>
    <button
      type="button"
      class="btn small"
      onclick={() => turn(1)}
      disabled={!usable}
      aria-label="오른쪽으로 45° 돌리기"
      title="오른쪽으로 45° (→)"
    >
      <Icon name="icon-chevron-right" />
    </button>
    {#if !reduced}
      <button
        type="button"
        class="btn small"
        aria-pressed={auto}
        disabled={!usable}
        onclick={() => setAuto(!auto, true)}
      >
        <Icon name="icon-turn" /> 자동 회전
      </button>
    {/if}
  </div>

  {#if note}
    <p class="note" id="h360-note">{note}</p>
  {:else}
    <p class="cap muted hint">
      {reduced
        ? '끌거나 ←/→ 키로 45°씩 돌려요. Home 키는 정면이에요. 움직임 줄이기가 켜져 있어 자동 회전은 쉬어요.'
        : '끌거나 ←/→ 키로 돌려요. Home 키는 정면이에요.'}
    </p>
  {/if}
</div>

<style>
  .h360 {
    display: grid;
    justify-items: center;
    gap: 6px;
  }
  .h360 > p {
    margin: 0;
    text-align: center;
  }
  .stage {
    position: relative;
    flex: none;
    margin: var(--u);
    background: linear-gradient(var(--stage) 0 var(--ground), var(--stage-ground) 0 100%);
    box-shadow: var(--frame);
    overflow: hidden;
    /* 가로 끌기는 돌리기, 세로는 화면 넘기기 */
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }
  .stage.usable {
    cursor: grab;
  }
  .stage.usable:active {
    cursor: grabbing;
  }
  .pic {
    position: absolute;
    inset: 0;
    display: block;
  }
  .flat {
    position: absolute;
    display: block;
    line-height: 0;
  }
  .flat :global(canvas) {
    display: block;
  }
  .solid {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    image-rendering: crisp-edges;
    image-rendering: pixelated;
  }
  .off {
    opacity: 0;
  }
  /* 바뀌는 한 박자: 2D 그림을 한 칸 걸러(바둑판) 입체 위에 얹는다 */
  .fade {
    -webkit-mask: repeating-conic-gradient(#000 0 25%, transparent 0 50%) 0 0 /
      calc(var(--cell) * 2) calc(var(--cell) * 2);
    mask: repeating-conic-gradient(#000 0 25%, transparent 0 50%) 0 0 / calc(var(--cell) * 2)
      calc(var(--cell) * 2);
  }
  .dir {
    min-height: 18px;
  }
  .controls {
    justify-content: center;
  }
  .hint,
  .note {
    max-width: 36em;
  }
  @media (forced-colors: active) {
    /* 테두리는 바깥(outline)에: 안쪽 크기가 64 × 칸 그대로라 정수 픽셀이 깨지지 않는다 */
    .stage {
      forced-color-adjust: none;
      outline: var(--u) solid CanvasText;
    }
  }
</style>
