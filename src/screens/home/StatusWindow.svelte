<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { formatDday, josa } from '../../lib/app/format.ts';
  import { nav } from '../../lib/app/nav.svelte.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { lookName } from '../../lib/character/customize.ts';
  import { resolveLook } from '../../lib/character/look.ts';
  import { characterRules } from '../../lib/character/rules.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean } from '../../lib/calc/date.ts';
  import Progress from '../../lib/ui/Progress.svelte';
  import Sprite from '../../lib/ui/Sprite.svelte';
  import Win from '../../lib/ui/Win.svelte';

  interface Props {
    /** 무대 바로 아래(호봉이의 한마디 자리)에 끼울 것: 임용정보 패키지 안내 */
    nudge?: Snippet;
  }
  let { nudge }: Props = $props();

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

  /**
   * 승급·승진 연출이 끝 장면에 닿기 전에는 오르기 전 호봉·모습을 보여 준다
   * (대화상자 뒤로 비치는 상태창이 결과를 먼저 알려 주지 않게). 끝 장면에 닿으면 새 값으로 바뀐다.
   */
  const pending = $derived(app.celebration && !app.celebrationRevealed ? app.celebration : null);
  const look = $derived(
    pending
      ? resolveLook(
          characterRules,
          pending.fromForm,
          pending.fromStep,
          view.look.mood,
          view.characterLook,
          view.propOwner,
        )
      : view.look,
  );
  const shownStep = $derived(pending ? pending.fromStep : view.step);
  const shownLabel = $derived.by(() => {
    const label = view.homeRankStepLabel;
    if (!pending) return label;
    let before = label.replace(`${pending.toStep}호봉`, `${pending.fromStep}호봉`);
    if (pending.fromRankLabel && pending.toRankLabel)
      before = before.replace(pending.toRankLabel, pending.fromRankLabel);
    return before;
  });
  /** '직급'·'계급'·'직무등급' */
  const rankNoun = $derived(view.careerRules.ladder?.noun ?? '계급');
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
      <Sprite {look} {scale} label="호봉이. {lookName(characterRules, look)}, {look.moodLabel}" />
    </div>

    {#if nudge}{@render nudge()}{/if}

    <div class="stack wide info">
      <div class="stack">
        <p class="row wrap">
          <span class="tag blue">{look.form.name}</span>
          <span class="nick">{view.profile.nickname}</span>
        </p>
        {#if view.showIdentityHome && view.seriesHomeText}
          <!-- 직렬은 소속을 짐작하게 할 수 있다. 설정 '홈에 직렬·계급 이름 보이기'를 켰을 때만 -->
          <p class="cap" id="status-series">{view.seriesHomeText}</p>
        {/if}
        <p class="big level">
          {shownLabel}{#if !view.raisesAutomatically}<span class="cap muted"> (입력값) </span>{/if}
        </p>
        <p class="cap muted">{look.form.blurb}</p>
      </div>

      {#if view.careerRules.rankProblem}
        <div class="note warn stack" id="status-rank-problem">
          <p>
            {view.careerRules.rankProblem === 'missing'
              ? `${josa(rankNoun, '을', '를')} 골라 주세요. 아직 ${josa(rankNoun, '을', '를')} 고르지 않아 봉급·승진을 계산하지 않았어요.`
              : `${josa(rankNoun, '을', '를')} 다시 골라 주세요. 저장된 값이 이 직종의 ${rankNoun} 목록에 없어 봉급·승진을 계산하지 않았어요.`}
          </p>
          <div class="btn-row">
            <button
              type="button"
              class="btn small"
              onclick={() => {
                nav.editProfileRequested = true;
                nav.go('settings');
              }}
            >
              내 정보 고치기
            </button>
          </div>
        </div>
      {/if}

      {#if view.maxStep !== null}
        {@const maxStep = view.maxStep}
        <div class="stack">
          <div class="pips" role="img" aria-label="호봉 {shownStep}, 최고 {maxStep}호봉">
            {#each { length: maxStep } as _, i (i)}
              <i class:on={i < shownStep}></i>
            {/each}
          </div>
          <p class="cap muted">깃 {shownStep} / {maxStep}{wearing ? ` · ${wearing}` : ''}</p>
        </div>
      {:else if wearing}
        <p class="cap muted">{wearing}</p>
      {/if}

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
      {:else if view.noRaiseReason === 'manual'}
        <p class="note" class:warn={view.manualRaiseOverdue} id="status-manual-raise">
          {view.manualRaiseOverdue
            ? `입력한 다음 승급일(${formatKorean(view.profile.nextStepDate, false)})이 지났어요. 내 정보에서 호봉을 고쳐 주세요.`
            : `다음 승급일(입력한 날)은 ${formatKorean(view.profile.nextStepDate, false)}이에요. 승급은 자동으로 계산하지 않아요.`}
        </p>
      {:else if view.noRaiseReason === 'payOff' && view.careerRules.rankProblem}
        <!-- 위 상자가 이미 계급을 골라 달라고 한다(같은 말을 두 번 하지 않는다) -->
      {:else if view.noRaiseReason === 'payOff'}
        <p class="note">다음 승급은 봉급표를 정한 뒤 셀 수 있어요. {view.payOff?.reason ?? ''}</p>
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
