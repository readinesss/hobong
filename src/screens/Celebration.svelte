<script lang="ts">
  import { onMount } from 'svelte';
  import { anim } from '../lib/app/anim.svelte.ts';
  import { app, type Celebration } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { resolveLook, unlockList } from '../lib/character/look.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { welcomeLine } from '../lib/lines.ts';
  import Modal from '../lib/ui/Modal.svelte';
  import Money from '../lib/ui/Money.svelte';
  import Sprite from '../lib/ui/Sprite.svelte';

  interface Props {
    event: Celebration;
  }

  let { event }: Props = $props();

  /** 연출 단계: 0부터 올라가다 마지막 단계에서 멈춘다 */
  let phase = $state(0);
  const LAST = 8;

  const before = $derived(resolveLook(characterRules, event.fromGrade, event.fromStep, 'work'));
  const after = $derived(resolveLook(characterRules, event.toGrade, event.toStep, 'celebrate'));
  const unlocked = $derived(
    unlockList(characterRules).filter((u) => u.step > event.fromStep && u.step <= event.toStep),
  );
  const done = $derived(phase >= LAST);

  onMount(() => {
    if (anim.reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      phase = LAST;
      return;
    }
    const timer = setInterval(
      () => {
        phase += 1;
        if (phase >= LAST) clearInterval(timer);
      },
      event.kind === 'hatch' ? 420 : 260,
    );
    return () => clearInterval(timer);
  });

  function close() {
    app.acknowledgeGrowth(event.toGrade, event.toStep);
  }

  const title = $derived(event.kind === 'hatch' ? '호봉이가 깨어났어요' : '승급했어요');
  /** 오래 열지 않았다가 오면 두 호봉 이상을 한 번에 넘는다 */
  const grown = $derived(event.toStep - event.fromStep);
</script>

<Modal
  {title}
  icon={event.kind === 'hatch' ? 'icon-egg' : 'icon-arrow-up'}
  onclose={close}
  dismissible={done}
>
  <div class="stack wide center">
    <div class="stage" class:flash={!done && phase % 2 === 1}>
      {#if event.kind === 'hatch'}
        {#if !done}
          <Sprite
            sprite={characterRules.egg}
            frame={Math.min(3, Math.floor(phase / 2))}
            scale={4}
            animate={false}
          />
        {:else}
          <Sprite look={after} scale={4} label="알에서 깨어난 호봉이" />
        {/if}
      {:else if !done}
        <!-- 옛 모습과 새 모습의 실루엣이 번갈아 깜빡인다 -->
        <Sprite
          look={phase % 2 === 0 ? before : after}
          scale={4}
          animate={false}
          pose={{ silhouette: 12, plain: true }}
        />
      {:else}
        <Sprite look={after} scale={4} label="승급한 호봉이" />
      {/if}
    </div>

    {#if done}
      <div class="stack pop-in" role="status">
        {#if event.kind === 'hatch'}
          <p class="mid">{after.form.name}</p>
          <p>{welcomeLine(view.profile.nickname)}</p>
          <p class="cap muted">{after.form.blurb}</p>
        {:else}
          <p class="mid">{event.toGrade}급 {event.toStep}호봉</p>
          <p>
            {event.fromStep}호봉에서 {event.toStep}호봉으로 올랐어요. 깃이 {grown === 1
              ? '하나'
              : `${grown}개`} 더 자랐어요.
          </p>
          <p class="cap muted">
            월 봉급 <Money value={view.salary.amount} /> (봉급표 기준)
          </p>
        {/if}
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
    {:else}
      <p class="muted" aria-hidden="true">…</p>
    {/if}
  </div>
  {#snippet actions()}
    <button type="button" class="btn primary" data-autofocus onclick={close} disabled={!done}>
      {event.kind === 'hatch' ? '시작하기' : '확인'}
    </button>
  {/snippet}
</Modal>

<style>
  .center {
    justify-items: center;
    text-align: center;
  }
  .stage {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    width: 100%;
    padding-top: 12px;
    background: linear-gradient(
      var(--stage) 0 calc(100% - 24px),
      var(--stage-ground) calc(100% - 24px) 100%
    );
    box-shadow: var(--frame);
    margin: var(--u);
  }
  .stage.flash {
    background: var(--c8);
  }
  .unlocks {
    display: grid;
    gap: 6px;
    justify-items: center;
  }
</style>
