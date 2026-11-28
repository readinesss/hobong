<script lang="ts">
  /**
   * 제자리 부화: 첫 입력 화면 안에서(대화상자 없이) 알이 깨어난다.
   * 데이터는 이미 저장돼 있다(연출 중에 새로 고쳐도 남는다). 여기서는 보여 주기만 한다.
   *
   * - 시간표는 scenes.ts 의 hatchScene. [건너뛰기]가 처음부터 있고(첫 포커스) Esc 로도 끝 장면으로 간다.
   * - 끝 장면(이름·인사·소개 글)은 [바로 시작하기]를 누를 때까지 머문다. 저절로 넘어가지 않는다
   *   (세 줄을 읽을 시간을 사람이 정한다 — 시간 제한 없음). 그동안 호봉이가 가끔 콩콩 뛰며 하트를 띄운다.
   * - 인사는 [바로 시작하기]의 설명(aria-describedby)으로 한 번만 읽힌다(포커스가 그 버튼으로 간다. 알림 영역과 겹쳐 읽지 않게).
   * - 움직임 줄이기면 끝 장면만(알 → 호봉이 정지 그림 두 장과 글), 인사 몸짓도 하지 않는다.
   * - 홈으로 넘어갈 때 무대 위 호봉이의 자리를 넘겨, 홈의 상태창으로 그대로 걸어 들어가게 한다(handoff.ts).
   * - 9급이 아닌 사람은 알봉이로 깨어난 뒤 이어서 자기 모습으로 자란다(번쩍임 없이 칸이 섞이며 바뀐다).
   */
  import { onMount, tick, untrack } from 'svelte';
  import { anim } from '../../lib/app/anim.svelte.ts';
  import { setHandoff } from '../../lib/app/handoff.ts';
  import { theme } from '../../lib/app/theme.svelte.ts';
  import { poseOf } from '../../lib/character/draw.ts';
  import { eggPose, hatchedPose, lidPose } from '../../lib/character/egg.ts';
  import type { Look } from '../../lib/character/look.ts';
  import { characterRules } from '../../lib/character/rules.ts';
  import { getSprite } from '../../lib/character/sprites.ts';
  import { env, sleep, wake, type Job } from '../../lib/fx/core.ts';
  import { dissolveOrder, drawEvolve } from '../../lib/fx/evolve.ts';
  import { MOVES, moveAt, moveDuration } from '../../lib/fx/moves.ts';
  import { createField, emitBurst, emitRise } from '../../lib/fx/particles.ts';
  import { hatchScene, playScene, type SceneStep } from '../../lib/fx/scenes.ts';
  import { runField } from '../../lib/fx/sparkle.ts';
  import { blit, disc, drawParticles, ring, sprite, type Stage } from '../../lib/fx/stage.ts';
  import type { Playback } from '../../lib/fx/timeline.ts';
  import { fillLine, nickStem, pickLine, TALK } from '../../lib/talk.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Sprite from '../../lib/ui/Sprite.svelte';
  import StageCanvas from '../../lib/ui/StageCanvas.svelte';

  interface Props {
    /** 깨어난 모습(근무 중) */
    look: Look;
    nickname: string;
    /** 인사말 고르기 씨앗 */
    seed?: number;
    /** 알이었을 때 여러 번 콕 눌러 줬는지(#39). 인사말이 그걸 기억한다(메모리에만 — 저장하지 않는다) */
    poked?: boolean;
    /** 홈으로 넘어간다 */
    onend: () => void;
  }

  let { look, nickname, seed = 0, poked = false, onend }: Props = $props();

  // 이 화면은 깨어나는 한 번만 쓰인다: 처음 받은 값으로 장면과 인사말을 정한다
  const evolves = untrack(() => look.form.id !== characterRules.forms[0]?.id);
  const scene = hatchScene({ evolves });
  const greet = untrack(() =>
    fillLine(pickLine(poked ? TALK.hatch.greetPoked : TALK.hatch.greet, seed), {
      nick: nickStem(nickname),
    }),
  );

  let done = $state(false);
  /** 움직임 줄이기로 끝 장면만 보였는지(정지 그림 두 장) */
  let still = $state(false);
  let canvas = $state<ReturnType<typeof StageCanvas>>();
  let goBtn = $state<HTMLButtonElement>();
  let skipBtn = $state<HTMLButtonElement>();

  // 루프가 바꾸는 값(다시 그릴 때만 읽는다)
  let cur: SceneStep = scene.steps[0] as SceneStep;
  let since = 0;
  let glowMs = -1;
  const field = createField({ max: 32, seed: 7 });
  let stopField: (() => void) | null = null;
  const order = dissolveOrder(48 * 48, 11);
  let playback: Playback | null = null;
  /** 끝 장면의 인사 몸짓(콩콩)이 흐른 시간(ms). 음수면 쉬는 중 */
  let greetMs = -1;
  let stageBox = $state<HTMLDivElement>();
  /** 무대의 확대 배율(CSS px). StageCanvas 에 주는 값과 같다 */
  const SCALE = 4;
  const ROWS = 62;

  const job: Job = (_now, dt) => {
    since += dt;
    if (glowMs >= 0) glowMs += dt;
    canvas?.redraw();
    return !done;
  };

  const CENTER = { x: 24, y: 32 };

  function burst() {
    emitBurst(field, {
      x: CENTER.x,
      y: CENTER.y - 8,
      count: 8,
      speed: [34, 58],
      lift: 40,
      gravity: 220,
      ttl: [520, 640],
      look: { sprite: ['p-shell-a', 'p-shell-b'] },
    });
    emitBurst(field, {
      x: CENTER.x,
      y: CENTER.y - 10,
      count: 6,
      speed: [22, 40],
      lift: 20,
      gravity: 60,
      ttl: [420, 560],
      look: { sprite: 'p-star' },
    });
    stopField = runField(field, () => canvas?.redraw());
  }

  function onStep(step: SceneStep) {
    cur = step;
    since = 0;
    if (step.step === 'dust' && !env.reduced) {
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y + 4,
        count: 4,
        speed: [6, 14],
        angle: [Math.PI * 0.15, Math.PI * 0.85],
        gravity: 90,
        ttl: [360, 420],
        look: { sprite: 'fxc-dust', frames: 3 },
      });
      stopField = runField(field, () => canvas?.redraw());
    } else if (step.step === 'pop' && !env.reduced) {
      glowMs = 0;
      burst();
    } else if (step.step === 'end') {
      done = true;
      if (!env.reduced) {
        emitRise(field, {
          from: { x: CENTER.x + 12, y: CENTER.y - 12 },
          to: { x: CENTER.x + 15, y: CENTER.y - 24 },
          ttl: 800,
          sway: 2,
          look: { sprite: 'fxc-heart' },
        });
        stopField = runField(field, () => canvas?.redraw());
      }
    }
  }

  /** 끝 장면에서 가끔 콩콩 뛰며 하트를 띄운다('만났다'는 순간). 움직임 줄이기면 하지 않는다 */
  const greetJob: Job = (_now, dt) => {
    greetMs += dt;
    if (greetMs >= moveDuration(MOVES.hop)) greetMs = -1;
    canvas?.redraw();
    return greetMs >= 0;
  };
  function greetOnce() {
    if (env.reduced || !done) return;
    greetMs = 0;
    wake(greetJob);
    emitRise(field, {
      from: { x: CENTER.x + 10, y: CENTER.y - 10 },
      to: { x: CENTER.x + 14, y: CENTER.y - 26 },
      count: 2,
      ttl: [700, 900],
      sway: 4,
      stagger: 160,
      look: { sprite: 'fxc-heart' },
    });
    stopField = runField(field, () => canvas?.redraw());
  }
  // 끝 장면에 들어선 뒤 2.5초쯤마다 한 번(공용 박자 250ms × 10)
  $effect(() => {
    const beat = anim.tick;
    if (done && !anim.reduced && beat > 0 && beat % 10 === 0) untrack(greetOnce);
  });

  /** 홈으로: 무대 위 호봉이가 서 있는 자리(뷰포트 좌표)를 넘겨 상태창으로 이어 가게 한다 */
  function finish() {
    const box = stageBox?.querySelector('canvas')?.getBoundingClientRect();
    if (box && !env.reduced) {
      const size = 48 * SCALE;
      setHandoff({
        x: box.left + (box.width - size) / 2,
        y: box.bottom - size,
        size,
      });
    }
    onend();
  }

  function skip() {
    playback?.skip();
  }

  onMount(() => {
    const release = anim.use();
    still = env.reduced;
    playback = playScene(scene, onStep);
    if (!done) {
      wake(job);
      // 연출 내내 [건너뛰기]가 첫 포커스다
      skipBtn?.focus({ preventScroll: true });
    }
    void playback.finished.then(async (completed) => {
      if (!completed) return;
      await tick();
      // 끝 장면은 누를 때까지 머문다(저절로 넘어가지 않는다)
      goBtn?.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !done) {
        event.preventDefault();
        skip();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      release();
      document.removeEventListener('keydown', onKey);
      playback?.cancel();
      sleep(job);
      sleep(greetJob);
      stopField?.();
    };
  });

  const plainLook = $derived(poseOf(look, { plain: true }));

  function render(target: Stage) {
    const ox = Math.floor((target.w - 48) / 2);
    const oy = target.h - 48;
    const dark = theme.dark;
    const dust = dark ? { 14: 13 } : undefined;
    if (done) {
      const tickNow = anim.reduced ? 0 : anim.tick;
      const comp = poseOf(look, {
        tick: tickNow,
        eyes: 'eyes-happy',
        shadowInk: dark ? 0 : undefined,
      });
      const hop = greetMs >= 0 ? moveAt(MOVES.hop, greetMs).dy : 0;
      if (comp) blit(target, comp, ox, oy + hop);
      drawParticles(target, field, ox, oy, getSprite, dust);
      return;
    }
    const name = cur.step;
    const t = cur.ms > 0 ? Math.min(1, since / cur.ms) : 1;
    // 알 뒤의 둥근 빛: 팡 하는 순간 한 번 퍼지며 사라진다(되풀이하지 않는다)
    if (glowMs >= 0 && glowMs < 600) {
      const g = glowMs / 600;
      const r = 8 + Math.floor(g * 12);
      if (dark) {
        // 어두운 무대: 노랑을 반투명으로 덮으면 남색과 섞여 탁한 회색이 된다. 밝은 색(흰색)을 옅게 깔고
        // 그 가장자리에 또렷한 금빛 고리를 둘러 '빛'으로 읽히게 한다(고리는 퍼지며 얇아지다 사라진다)
        disc(target, ox + CENTER.x, oy + CENTER.y, r, 12, 0.3 * (1 - g));
        if (g < 0.75) ring(target, ox + CENTER.x, oy + CENTER.y, r + 1, 4, g < 0.4 ? 2 : 1);
      } else disc(target, ox + CENTER.x, oy + CENTER.y, r, 4, 0.5 * (1 - g));
    }
    if (name === 'clear' || name === 'knock' || name === 'dust' || name === 'knock-hard') {
      const move = name === 'knock' ? MOVES.knock : name === 'knock-hard' ? MOVES.knockHard : null;
      const at = move ? moveAt(move, since) : { dx: 0, dy: 0 };
      const comp = eggPose({
        stage: 4,
        peek: 0,
        glow: 1,
        lightStage: !dark,
        dx: at.dx,
        paint: look.paint,
      });
      if (comp) blit(target, comp, ox, oy);
      // 안에서 두드리는 충격 선(알 옆구리 바깥)
      const knock = getSprite('fxc-knock-side');
      if (knock && move && since < 240) {
        const frame = since < 120 ? 0 : 1;
        sprite(target, knock, ox + 36, oy + 30, { frame });
        if (name === 'knock-hard') sprite(target, knock, ox + 11, oy + 30, { frame, flipX: true });
      }
    } else if (name === 'crouch') {
      const comp = eggPose({
        stage: 4,
        peek: 1,
        glow: 2,
        lightStage: !dark,
        dy: 1,
        paint: look.paint,
      });
      if (comp) blit(target, comp, ox, oy);
    } else if (name === 'pop') {
      const body = hatchedPose({ eyes: 'eyes-happy', paint: look.paint });
      if (body) blit(target, body, ox, oy);
      // 뚜껑이 튀어 오르며 사라진다
      const lid = lidPose();
      if (lid && t < 1) {
        blit(target, lid, ox + Math.round(t * 6), oy - Math.round(t * 16), {
          alpha: t < 0.5 ? 1 : 1 - (t - 0.5) * 2,
        });
      }
    } else if (name === 'dissolve') {
      const from = hatchedPose({ eyes: 'eyes-happy', paint: look.paint });
      if (from && plainLook)
        drawEvolve(target, from, plainLook, ox, oy, 'dissolve', t, { color: -1, order });
    } else if (name === 'reveal') {
      if (plainLook) blit(target, plainLook, ox, oy);
      const twinkle = getSprite('fxc-twinkle');
      if (twinkle)
        sprite(target, twinkle, ox + 24, oy + 10, { frame: Math.min(2, Math.floor(t * 3)) });
    }
    drawParticles(target, field, ox, oy, getSprite, dust);
  }
</script>

<section class="win hatch" id="welcome-hatch" aria-labelledby="hatch-title">
  <header class="win-title">
    <Icon name="icon-egg" />
    <h1 id="hatch-title">{done ? TALK.hatch.status : TALK.hatch.title}</h1>
  </header>
  <div class="win-body stack wide center">
    <div class="stage" bind:this={stageBox}>
      <StageCanvas
        bind:this={canvas}
        rows={ROWS}
        scale={SCALE}
        {render}
        label={done ? `알에서 깨어난 호봉이, ${look.form.name}` : undefined}
      />
    </div>

    {#if done}
      <div class="stack pop-in result" id="hatch-result">
        <p class="mid">{look.form.name}</p>
        <p>{greet}</p>
        <p class="cap muted">{look.form.blurb}</p>
      </div>
      {#if still}
        <!-- 움직임 줄이기: 연출 대신 정지 그림 두 장 -->
        <p class="pair" id="hatch-pair">
          <Sprite sprite={characterRules.egg} frame={0} scale={2} animate={false} label="알" />
          <span aria-hidden="true">→</span>
          <Sprite {look} scale={2} animate={false} label={look.form.name} />
        </p>
      {/if}
    {:else}
      <p class="muted result" aria-hidden="true">…</p>
    {/if}

    <div class="btn-row end actions">
      {#if done}
        <button
          type="button"
          class="btn primary"
          bind:this={goBtn}
          aria-describedby="hatch-result"
          onclick={finish}
        >
          {TALK.hatch.go}
        </button>
      {:else}
        <button type="button" class="btn" bind:this={skipBtn} onclick={skip}>
          {TALK.hatch.skip}
        </button>
      {/if}
    </div>
  </div>
</section>

<style>
  .center {
    justify-items: center;
    text-align: center;
  }
  .stage {
    width: calc(100% - var(--u) * 2);
    background: linear-gradient(
      var(--stage) 0 calc(100% - 24px),
      var(--stage-ground) calc(100% - 24px) 100%
    );
    box-shadow: var(--frame);
    margin: var(--u);
    overflow: hidden;
  }
  /* 끝 장면의 글이 나올 자리를 미리 잡아 둔다(버튼이 위아래로 튀지 않게) */
  .result {
    min-height: 84px;
    align-content: start;
  }
  .pair {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
  }
  .actions {
    width: 100%;
  }
</style>
