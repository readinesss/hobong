<script lang="ts">
  import { onMount } from 'svelte';
  import { formatDday, josa } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean } from '../../lib/calc/date.ts';
  import Progress from '../../lib/ui/Progress.svelte';
  import Sprite from '../../lib/ui/Sprite.svelte';
  import Win from '../../lib/ui/Win.svelte';

  let scale = $state(4);

  onMount(() => {
    const wide = window.matchMedia('(min-width: 1100px)');
    const update = () => {
      scale = wide.matches ? 5 : 4;
    };
    update();
    wide.addEventListener('change', update);
    return () => wide.removeEventListener('change', update);
  });

  const look = $derived(view.look);
  const raise = $derived(view.raiseProgress);
  const wearing = $derived(
    look.wearing.map((w) => (w.tint ? `${w.name}(${w.tint})` : w.name)).join(', '),
  );
  const unlockNote = $derived.by(() => {
    const next = view.nextUnlock;
    if (!next || !view.nextRaise) return '';
    return next.step === view.nextRaise.toStep
      ? ` · 새 소품 "${next.name}"`
      : ` · 다음 소품 "${next.name}"${josa(next.name, '은', '는').slice(next.name.length)} ${next.step}호봉`;
  });
</script>

<Win title="상태창" icon="icon-tiger" id="status" area="status">
  {#snippet aside()}{look.moodLabel}{/snippet}
  <div class="status">
    <div class="stage">
      <p class="bubble" aria-live="polite">{view.line}</p>
      <Sprite {look} {scale} label="호봉이. {look.form.name}, {look.moodLabel}" />
    </div>

    <div class="stack wide info">
      <div class="stack">
        <p class="row wrap">
          <span class="tag blue">{look.form.name}</span>
          <span class="nick">{view.profile.nickname}</span>
        </p>
        <p class="big level">{view.profile.grade}급 {view.step}호봉</p>
        <p class="cap muted">{look.form.blurb}</p>
      </div>

      <div class="stack">
        <div class="pips" role="img" aria-label="호봉 {view.step}, 최고 {view.maxStep}호봉">
          {#each { length: view.maxStep } as _, i (i)}
            <i class:on={i < view.step}></i>
          {/each}
        </div>
        <p class="cap muted">깃 {view.step} / {view.maxStep}{wearing ? ` · ${wearing}` : ''}</p>
      </div>

      {#if raise && view.nextRaise}
        <div class="stack">
          <div class="kv">
            <span>다음 승급까지</span>
            <span class="num"><strong>{formatDday(view.today, raise.next)}</strong></span>
          </div>
          <Progress
            value={raise.ratio}
            label="다음 승급까지의 진행률"
            valueText="{Math.round(raise.ratio * 100)}%, {raise.left}일 남음"
            tone="gold"
          />
          <p class="cap muted">
            {formatKorean(raise.next)}에 {view.nextRaise.toStep}호봉{unlockNote}
          </p>
        </div>
      {:else if view.noRaiseReason === 'retire'}
        <p class="note">
          {view.retired
            ? '정년퇴직하셨어요. 긴 길을 끝까지 걸어오셨어요.'
            : '정년퇴직일 전에 남은 정기승급이 없어요.'}
        </p>
      {:else}
        <p class="note">최고호봉이에요. 여기까지 오신 걸 축하해요.</p>
      {/if}
    </div>
  </div>
</Win>

<style>
  .status {
    display: grid;
    gap: 12px;
  }
  .stage {
    display: grid;
    justify-items: center;
    align-content: end;
    gap: 6px;
    min-height: 252px;
    padding: 12px 9px 0;
    margin: var(--u);
    background: linear-gradient(
      var(--stage) 0 calc(100% - 27px),
      var(--stage-ground) calc(100% - 27px) 100%
    );
    box-shadow: var(--frame);
    overflow: hidden;
  }
  .bubble {
    position: relative;
    max-width: 100%;
    padding: 6px 12px;
    margin: var(--u) var(--u) 9px;
    background: var(--bubble);
    color: #1a1c2c;
    box-shadow:
      0 calc(var(--u) * -1) 0 0 #1a1c2c,
      0 var(--u) 0 0 #1a1c2c,
      calc(var(--u) * -1) 0 0 0 #1a1c2c,
      var(--u) 0 0 0 #1a1c2c;
    text-align: center;
  }
  /* 말풍선 꼬리: 말풍선 아래 테두리 위에 겹쳐 그려 테두리를 끊고, 말풍선과 이어진 꼬리로 보이게 한다 */
  .bubble::after {
    content: '';
    position: absolute;
    left: calc(50% - 3px);
    bottom: -6px;
    width: 6px;
    height: 6px;
    background: var(--bubble);
    box-shadow:
      -3px 0 0 0 #1a1c2c,
      3px 0 0 0 #1a1c2c,
      0 3px 0 0 #1a1c2c;
  }
  .nick {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .level {
    white-space: nowrap;
  }
  .pips {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .pips i {
    width: 9px;
    height: 12px;
    background: var(--panel-2);
    box-shadow: inset 0 0 0 3px var(--ink-2);
    opacity: 0.55;
  }
  .pips i.on {
    background: var(--gold);
    box-shadow: inset 0 0 0 3px var(--c3);
    opacity: 1;
  }
  @media (min-width: 1100px) {
    .stage {
      min-height: 312px;
    }
  }
  @media (forced-colors: active) {
    .bubble {
      border: var(--u) solid CanvasText;
    }
    .bubble::after {
      display: none;
    }
    .pips i {
      border: 1px solid CanvasText;
      opacity: 1;
    }
    .pips i.on {
      forced-color-adjust: none;
      background: Highlight;
    }
  }
</style>
