<script lang="ts">
  /**
   * 승급·승진·성장 연출(대화상자).
   *
   * - 시간표는 scenes.ts(호봉 오름 stepUpScene, 승진·성장 promoteScene). 무대 캔버스 한 장에 캐릭터·입자·빛을 그린다.
   *   예전의 무대 배경 깜빡임과 실루엣 번갈아 보이기는 쓰지 않는다(번쩍임 안전: 부록 G4).
   * - [건너뛰기]가 첫 포커스이고 Esc 로도 끝 장면으로 간다. 끝 장면 전에는 닫히지 않는다.
   * - 끝 장면의 결과 문장은 한 번만 읽힌다(연출 중에는 아무것도 읽지 않는다): 연출을 본 뒤에는 role=status 로
   *   (새로 생긴 글이라 저절로 읽힌다), 움직임 줄이기로 끝 장면이 처음부터 떠 있을 때는 [확인]의 설명으로
   *   (이미 있는 글은 알림 영역이어도 읽히지 않는다 — 포커스가 가는 버튼에 이어 읽게 한다. 둘을 겹치지 않는다).
   * - 움직임 줄이기면 연출 없이 끝 장면만: '전 → 후' 정지 그림 두 장과 글.
   * - 연출이 떠 있는 동안 알림(새 배지 등)은 미룬다(app.toast). 뒤의 홈은 끝 장면에 닿은 뒤에 새 호봉으로 바뀐다
   *   (app.revealCelebration). 색종이·깃이 터지는 순간에는 대화상자 밖 효과 층에도 조각을 한 번 터뜨린다(confettiOutside).
   * - 홈에 직렬·계급 이름 보이기를 껐으면 계급 이름을 쓰지 않는다(호봉과 형태 이름만).
   */
  import { onMount, untrack } from 'svelte';
  import { anim } from '../lib/app/anim.svelte.ts';
  import { josa, withRo } from '../lib/app/format.ts';
  import { app, type Celebration } from '../lib/app/state.svelte.ts';
  import { theme } from '../lib/app/theme.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { poseOf } from '../lib/character/draw.ts';
  import { resolveLook, unlockList } from '../lib/character/look.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { getSprite } from '../lib/character/sprites.ts';
  import { env, sleep, wake, type Job } from '../lib/fx/core.ts';
  import {
    dissolveOrder,
    drawEvolve,
    rimOf,
    silhouetteColor,
    silhouetteRim,
  } from '../lib/fx/evolve.ts';
  import { MOVES, moveAt } from '../lib/fx/moves.ts';
  import { createField, emitBurst, emitConverge, emitRise } from '../lib/fx/particles.ts';
  import { playScene, promoteScene, stepUpScene, type SceneStep } from '../lib/fx/scenes.ts';
  import { runField, sparkle } from '../lib/fx/sparkle.ts';
  import { blit, dim, drawParticles, rays, sprite, type Stage } from '../lib/fx/stage.ts';
  import type { Playback } from '../lib/fx/timeline.ts';
  import Modal from '../lib/ui/Modal.svelte';
  import Money from '../lib/ui/Money.svelte';
  import Sprite from '../lib/ui/Sprite.svelte';
  import StageCanvas from '../lib/ui/StageCanvas.svelte';

  interface Props {
    event: Celebration;
  }

  let { event }: Props = $props();

  // 연출은 열릴 때의 값으로 한 번 정한다(연출 도중에 설정이 바뀌어도 장면은 그대로)
  const ev = untrack(() => event);
  const custom = untrack(() => view.characterLook);
  const owner = untrack(() => view.propOwner);
  const look = (form: string, step: number, mood: 'work' | 'celebrate') =>
    resolveLook(characterRules, form, step, mood, custom, owner);

  const before = look(ev.fromForm, ev.fromStep, 'work');
  const after = look(ev.toForm, ev.toStep, 'work');
  const party = look(ev.toForm, ev.toStep, 'celebrate');
  const unlocked = untrack(() =>
    unlockList(characterRules, view.handHeld).filter(
      (u) => u.step > ev.fromStep && u.step <= ev.toStep,
    ),
  );
  /** 오래 열지 않았다가 오면 두 호봉 이상을 한 번에 넘는다 */
  const grown = ev.toStep - ev.fromStep;
  const evolves = ev.fromForm !== ev.toForm;
  const scene =
    ev.kind === 'step'
      ? stepUpScene({ steps: Math.max(1, grown), unlock: unlocked.length > 0 })
      : promoteScene({ evolves });

  let done = $state(false);
  /** 움직임 줄이기로 끝 장면만 보였는지 */
  let still = $state(false);
  /** 숫자판에 지금 보이는 호봉 */
  let rolled = $state(ev.fromStep);
  /**
   * 무대 위 꼬리표('깃 +1', '새로 생김: 머그컵'). 새 소품이 생기면 '깃 +1' 아래에 하나 더 붙는다
   * ('깃 +1'이 0.2초 만에 '새로 생김'으로 바뀌어 깃이 자란 것이 묻히지 않게: 부록 P1)
   */
  let tags = $state<string[]>([]);
  /** 이름판(승진·성장): 형태 이름 또는 계급 이름 */
  let plate = $state('');
  let canvas = $state<ReturnType<typeof StageCanvas>>();
  let stageBox = $state<HTMLDivElement>();

  /**
   * 대화상자 밖 효과 층에 색종이를 한 번 터뜨린다(무대 위쪽 두 귀퉁이에서 바깥으로).
   * 화면 전체가 아니라 작은 조각 마흔 개가 0.8초쯤 퍼졌다 떨어진다(번쩍임 없음). 움직임 줄이기면 아무 일도 없다.
   */
  function confettiOutside() {
    const box = stageBox?.getBoundingClientRect();
    if (!box || env.reduced) return;
    const options = {
      count: 20,
      speed: [170, 400],
      lift: 340,
      gravity: 800,
      ttl: [620, 880],
    } as const;
    sparkle(box.left + box.width * 0.2, box.top + box.height * 0.3, options);
    sparkle(box.left + box.width * 0.8, box.top + box.height * 0.3, options);
  }

  const showNames = $derived(view.showIdentityHome);
  const title =
    ev.kind === 'promote' ? '승진했어요' : ev.kind === 'grow' ? '호봉이가 자랐어요' : '승급했어요';

  /** 이름판 글자: 계급 이름은 공개 설정을 켰을 때만, 아니면 형태 이름 */
  function plateText(end: boolean): string {
    const names = untrack(() => showNames);
    if (ev.kind === 'promote' && names && ev.fromRankLabel && ev.toRankLabel)
      return end ? `${ev.fromRankLabel} → ${ev.toRankLabel}` : ev.fromRankLabel;
    if (!evolves) return after.form.name;
    return end ? `${before.form.name} → ${after.form.name}` : before.form.name;
  }

  // ── 루프가 바꾸는 값(다시 그릴 때만 읽는다) ────────────────────────────
  let cur: SceneStep = scene.steps[0] as SceneStep;
  let since = 0;
  const field = createField({ max: 48, seed: 3 });
  let stopField: (() => void) | null = null;
  const order = dissolveOrder(48 * 48, 5);
  let playback: Playback | null = null;

  const bodySprite = (form: string) =>
    getSprite(characterRules.forms.find((f) => f.id === form)?.body ?? '');
  const anchor = (form: string, name: string): readonly [number, number] =>
    bodySprite(form)?.anchors[name] ?? [24, 30];
  /** 새 소품이 붙는 자리(비춤의 가운데) */
  const SLOT_ANCHOR: Record<string, string> = {
    neck: 'neck',
    handR: 'handR',
    handL: 'handL',
    face: 'eyes',
    head: 'crown',
  };
  const spotAt = anchor(ev.toForm, SLOT_ANCHOR[unlocked[0]?.slot ?? ''] ?? 'crown');
  const CENTER = { x: 24, y: 30 };

  const beforePlain = poseOf(before, { plain: true });
  const afterPlain = poseOf(after, { plain: true });

  function spawn() {
    stopField = runField(field, () => canvas?.redraw());
  }

  function onStep(step: SceneStep) {
    cur = step;
    since = 0;
    const name = step.step;
    if (name === 'end') {
      done = true;
      // 뒤의 홈(상태창)도 이제 새 호봉·모습으로 바뀐다
      app.revealCelebration();
      rolled = ev.toStep;
      tags = [];
      plate = plateText(true);
      return;
    }
    if (env.reduced) return;
    if (name === 'look') {
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y - 14,
        count: 2,
        speed: [16, 24],
        angle: [Math.PI * 1.1, Math.PI * 1.9],
        ttl: [360, 480],
        look: { sprite: 'p-star' },
      });
      spawn();
    } else if (name === 'feather') {
      const [nx, ny] = anchor(ev.fromForm, 'neck');
      emitRise(field, {
        from: { x: nx + 10, y: 46 },
        to: { x: nx, y: ny },
        ttl: 400,
        sway: 6,
        look: { sprite: 'p-feather' },
      });
      spawn();
    } else if (name === 'land') {
      tags = [`깃 +${Math.max(1, grown)}`];
    } else if (name === 'spot') {
      const first = unlocked[0];
      if (first) tags = [...tags, `새로 생김: ${first.name}`];
    } else if (name === 'confetti') {
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y - 10,
        count: 24,
        speed: [30, 62],
        lift: 46,
        gravity: 160,
        ttl: [520, 760],
        look: {
          colors: ['2', '4', '6', '9', 'a'],
          sizes: [
            [1, 2],
            [2, 1],
          ],
        },
      });
      spawn();
      confettiOutside();
    } else if (name === 'gather') {
      emitConverge(field, {
        x: CENTER.x,
        y: CENTER.y,
        count: 20,
        radius: [26, 34],
        ttl: [420, 560],
        stagger: 8,
        look: { sprite: 'p-glint' },
      });
      spawn();
    } else if (name === 'plate') {
      plate = plateText(true);
    } else if (name === 'burst') {
      plate = plateText(true);
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y - 4,
        count: 12,
        speed: [30, 54],
        lift: 30,
        gravity: 120,
        ttl: [480, 640],
        look: { sprite: 'p-feather' },
      });
      emitBurst(field, {
        x: CENTER.x,
        y: CENTER.y - 6,
        count: 8,
        speed: [22, 44],
        ttl: [380, 520],
        look: { sprite: 'p-star' },
      });
      spawn();
      confettiOutside();
    }
  }

  const job: Job = (_now, dt) => {
    since += dt;
    // 숫자판: 굴림 단계 동안 한 호봉씩 올라간다
    if (cur.step === 'roll' && grown > 0 && cur.ms > 0) {
      const next = Math.min(
        ev.toStep,
        ev.fromStep + Math.floor(Math.min(1, since / cur.ms) * grown),
      );
      if (next !== rolled) rolled = next;
    } else if (!done && rolled !== ev.toStep && scene.steps.indexOf(cur) > 2) {
      rolled = ev.toStep;
    }
    canvas?.redraw();
    return !done;
  };

  function skip() {
    playback?.skip();
  }

  onMount(() => {
    const release = anim.use();
    still = env.reduced;
    plate = plateText(false);
    playback = playScene(scene, onStep);
    if (!done) wake(job);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !done) {
        e.preventDefault();
        skip();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      release();
      document.removeEventListener('keydown', onKey);
      playback?.cancel();
      sleep(job);
      stopField?.();
    };
  });

  function close() {
    app.acknowledgeGrowth(ev.toRank, ev.toStep, ev.toForm);
  }

  function render(target: Stage) {
    const ox = Math.floor((target.w - 48) / 2);
    const oy = target.h - 48;
    const dark = theme.dark;
    const shadowInk = dark ? 0 : undefined;
    const sil = silhouetteColor(dark);
    const rim = silhouetteRim(dark);
    const dust = dark ? { 14: 13 } : undefined;
    if (done) {
      const comp = poseOf(party, { tick: anim.reduced ? 0 : anim.tick, shadowInk });
      if (comp) blit(target, comp, ox, oy);
      drawParticles(target, field, ox, oy, getSprite, dust);
      return;
    }
    const name = cur.step;
    const t = cur.ms > 0 ? Math.min(1, since / cur.ms) : 1;
    const whole = (which: typeof before, eyes?: string, dy = 0) => {
      const comp = poseOf(which, { tick: 0, eyes, shadowInk });
      if (comp) blit(target, comp, ox, oy + dy);
    };
    if (name === 'open') whole(before);
    else if (name === 'look' || name === 'roll' || name === 'feather')
      whole(before, 'eyes-sparkle');
    else if (name === 'land') whole(before, 'eyes-happy', moveAt(MOVES.bump, since).dy);
    else if (name === 'spot') {
      whole(after, 'eyes-happy');
      // 무대를 서서히 어둡게 덮고(300ms) 새 소품 둘레만 밝힌다. 끝날 때 다시 서서히 걷힌다
      const up = Math.min(1, since / 300);
      const down = Math.min(1, Math.max(0, (cur.ms - since) / 300));
      dim(target, 0, 0.4 * Math.min(up, down), {
        cx: ox + spotAt[0],
        cy: oy + spotAt[1],
        r: 10,
      });
      const arrow = getSprite('fxc-spot-arrow');
      // 화살표는 그림 바깥 위쪽에서 가리킨다(400ms 마다 1px 까딱: 자리만 바뀐다)
      if (arrow)
        sprite(target, arrow, ox + spotAt[0], oy + spotAt[1] - 12 + (Math.floor(since / 400) % 2));
    } else if (name === 'confetti' || name === 'plate') whole(after, 'eyes-happy');
    else if (name === 'gather') {
      // 빛줄기가 천천히 돈다(120ms 마다 조금씩: 회전이지 깜빡임이 아니다)
      rays(
        target,
        ox + CENTER.x,
        oy + CENTER.y,
        16,
        30,
        8,
        Math.floor(since / 120) * (Math.PI / 16),
        dark ? 4 : 3,
        0.35,
      );
      // 금빛 테두리가 한 번 생긴다(되돌아가지 않는다)
      if (evolves && beforePlain) blit(target, rimOf(beforePlain, dark ? 4 : 3), ox, oy);
      whole(before, 'eyes-sparkle');
    } else if (name === 'silhouette' && beforePlain && afterPlain)
      drawEvolve(target, beforePlain, afterPlain, ox, oy, 'silhouette', t, {
        color: sil,
        order,
        rim,
      });
    else if (name === 'dissolve' && beforePlain && afterPlain)
      drawEvolve(target, beforePlain, afterPlain, ox, oy, 'dissolve', t, {
        color: sil,
        order,
        rim,
      });
    else if (name === 'reveal' && beforePlain && afterPlain)
      drawEvolve(target, beforePlain, afterPlain, ox, oy, 'reveal', t, { color: sil, order, rim });
    else if (name === 'burst' || name === 'tour') {
      whole(after, 'eyes-happy');
      const twinkle = getSprite('fxc-twinkle');
      const [cx, cy] = anchor(ev.toForm, 'crown');
      // 바뀐 곳(머리 위)에 큰 반짝이 한 번
      if (twinkle && name === 'tour')
        sprite(target, twinkle, ox + cx + 8, oy + cy - 2, {
          frame: Math.min(2, Math.floor(t * 3)),
        });
    }
    drawParticles(target, field, ox, oy, getSprite, dust);
  }

  // ── 끝 장면의 글 ──────────────────────────────────────────────────────
  const headline = $derived(showNames ? ev.toLabel : `${ev.toStep}호봉`);
  const lines = $derived.by(() => {
    const out: string[] = [];
    if (ev.kind === 'promote') {
      out.push(
        showNames && ev.toRankLabel
          ? `${josa(ev.toRankLabel, '이', '가')} 되었어요. 축하해요!`
          : '승진을 축하해요!',
      );
      if (ev.toStep !== ev.fromStep) out.push(`지금 호봉은 ${ev.toStep}호봉이에요.`);
    } else if (grown > 0) {
      out.push(
        `${ev.fromStep}호봉에서 ${ev.toStep}호봉으로 올랐어요. 깃이 ${
          grown === 1 ? '하나' : `${grown}개`
        } 더 자랐어요.`,
      );
    }
    if (evolves) out.push(`${before.form.name}에서 ${withRo(after.form.name)} 자랐어요.`);
    else if (ev.kind === 'grow' && grown <= 0) out.push('함께한 시간만큼 자랐어요.');
    return out;
  });
  /** '전 → 후' 정지 그림: 모습이 달라졌거나, 움직임 줄이기여서 연출을 보지 못했을 때 */
  const showPair = $derived(done && (still || evolves || unlocked.length > 0));
  /**
   * 정지 그림의 낭독 이름. 형태가 바뀌면 두 형태 이름, 같은 형태에서 새 소품이 생기면 뒤 그림에 그 소품을 붙인다.
   * 이름으로 가를 것이 없으면(같은 형태·새 소품 없음) 두 그림을 장식으로 두고 바뀐 것은 위의 글이 전한다(부록 P1).
   */
  const pairNames = $derived.by((): [string, string] | null => {
    if (evolves) return [`전: ${before.form.name}`, `후: ${after.form.name}`];
    if (unlocked.length > 0)
      return [
        `전: ${before.form.name}`,
        `후: ${before.form.name}, 새로 생김: ${unlocked.map((u) => u.name).join(', ')}`,
      ];
    return null;
  });
  const rolls = ev.kind === 'step';
</script>

<Modal {title} icon="icon-arrow-up" onclose={close} dismissible={done}>
  <div class="stack wide center">
    <div class="stage" id="celebration-stage" bind:this={stageBox}>
      <StageCanvas
        bind:this={canvas}
        rows={60}
        scale={4}
        {render}
        label={done
          ? `${ev.kind === 'step' ? '승급한' : '자란'} 호봉이, ${after.form.name}`
          : undefined}
      />
      {#if !done}
        <!-- 연출 중의 숫자판·이름판·꼬리표는 장식이다. 같은 내용을 끝 장면의 글이 전한다 -->
        <div class="over" aria-hidden="true">
          {#if rolls}
            <p class="plate num">
              {#key rolled}<span class="digit">{rolled}</span>{/key}<span>호봉</span>
            </p>
          {:else if plate}
            {#key plate}<p class="plate name">{plate}</p>{/key}
          {/if}
          {#if tags.length > 0}
            <div class="tags">
              {#each tags as text (text)}<p class="tag gold pop-in">{text}</p>{/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if done}
      <div class="stack pop-in" role={still ? undefined : 'status'} id="celebration-result">
        <p class="mid">{headline}</p>
        {#each lines as line (line)}<p>{line}</p>{/each}
        {#if evolves || ev.kind !== 'step'}
          <p class="cap muted">{after.form.name} · {after.form.blurb}</p>
        {/if}
        {#if view.salary}<p class="cap muted">
            월 봉급 <Money value={view.salary.amount} /> (봉급표 기준)
          </p>{/if}
        {#if unlocked.length > 0}
          <ul class="unlocks">
            {#each unlocked as item (item.step + item.name)}
              <li>
                <span class="tag gold">새로 생김</span>
                {item.name} <span class="cap muted">{item.blurb}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if showPair}
        <p class="pair" id="celebration-pair" aria-hidden={pairNames ? undefined : 'true'}>
          <Sprite look={before} scale={2} animate={false} label={pairNames?.[0]} />
          <span aria-hidden="true">→</span>
          <Sprite look={after} scale={2} animate={false} label={pairNames?.[1]} />
        </p>
      {/if}
    {:else}
      <p class="muted" aria-hidden="true">…</p>
    {/if}
  </div>
  {#snippet actions()}
    {#if done}
      <button
        type="button"
        class="btn primary"
        data-autofocus
        aria-describedby={still ? 'celebration-result' : undefined}
        onclick={close}
      >
        확인
      </button>
    {:else}
      <button type="button" class="btn" data-autofocus onclick={skip}>건너뛰기</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .center {
    justify-items: center;
    text-align: center;
  }
  .stage {
    position: relative;
    width: calc(100% - var(--u) * 2);
    background: linear-gradient(
      var(--stage) 0 calc(100% - 24px),
      var(--stage-ground) calc(100% - 24px) 100%
    );
    box-shadow: var(--frame);
    margin: var(--u);
    overflow: hidden;
  }
  .over {
    position: absolute;
    inset: 6px 6px auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 6px;
    pointer-events: none;
  }
  /* 이름판·숫자판: 밝은 테마는 흰 판, 야근 모드는 어두운 판(넓은 흰 면이 튀지 않게) */
  .plate {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    margin: var(--u);
    padding: 3px 9px;
    background: var(--panel);
    color: var(--ink);
    box-shadow:
      0 0 0 var(--u) var(--gold),
      0 0 0 calc(var(--u) * 2) #1a1c2c;
    font-family: var(--font-cap);
  }
  .plate.name {
    animation: plate-bump 0.16s steps(2, end) both;
  }
  .digit {
    display: inline-block;
    min-width: 2ch;
    text-align: right;
    font-size: 24px;
    line-height: 30px;
    animation: digit-roll 0.12s ease-out both;
  }
  @keyframes digit-roll {
    from {
      transform: translateY(9px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes plate-bump {
    from {
      transform: translateY(-3px);
    }
    to {
      transform: none;
    }
  }
  .tags {
    display: grid;
    justify-items: end;
    gap: 3px;
  }
  .pair {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
  }
  .unlocks {
    display: grid;
    gap: 6px;
    justify-items: center;
  }
</style>
