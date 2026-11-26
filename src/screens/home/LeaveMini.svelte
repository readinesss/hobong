<script lang="ts">
  import { nav } from '../../lib/app/nav.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { leaveBalance } from '../../lib/app/format.ts';
  import { formatLeaveHours } from '../../lib/calc/leave.ts';
  import { isAvailable } from '../../lib/rules/index.ts';
  import type { Unavailable } from '../../lib/rules/types.ts';
  import OffNote from '../../lib/ui/OffNote.svelte';
  import Progress from '../../lib/ui/Progress.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const leave = $derived(view.leave);
  const hpd = $derived(leave.hoursPerDay);
  const balance = $derived(leaveBalance(leave.remainingHours, leave.grantedHours, leave.rate, hpd));
  /** 연가 일수 계산이 꺼진 직종(준비 중): 직접 넣기 전에는 남은·초과 숫자를 보이지 않는다(Q4) */
  const annualOff = $derived(
    isAvailable(view.careerRules.leave.annual)
      ? null
      : (view.careerRules.leave.annual as unknown as Unavailable),
  );

  function openGrant() {
    nav.editGrantRequested = true;
    nav.go('leave');
  }
</script>

<Win title="연가" icon="icon-palm" id="leave-mini" area="leave">
  {#snippet aside()}{leave.year}년{/snippet}
  <div class="stack wide">
    {#if leave.needsManualGrant}
      <div class="kv">
        <span>사용</span>
        <strong class="big">{formatLeaveHours(leave.usedHours, hpd)}</strong>
      </div>
      {#if leave.plannedHours > 0}
        <p class="cap muted">(예정 {formatLeaveHours(leave.plannedHours, hpd)} 포함)</p>
      {/if}
      <p class="note" id="leave-mini-manual">올해 부여 일수를 넣으면 남은 연가를 셀 수 있어요.</p>
      {#if annualOff}<OffNote label="연가 일수" off={annualOff} />{/if}
      <div class="btn-row">
        <button type="button" class="btn" onclick={openGrant}>부여 일수 넣기</button>
        <button type="button" class="btn" onclick={() => nav.go('leave')}>연가 장부 열기</button>
      </div>
    {:else}
      <div class="kv">
        <span>{balance.label}</span>
        <span>
          <strong class="big" class:warn={balance.over}>{balance.value}</strong>
          <span class="cap muted">/ {formatLeaveHours(leave.grantedHours, hpd)}</span>
        </span>
      </div>
      <Progress
        value={leave.rate}
        label="올해 연가 사용률"
        valueText={leave.grantedHours > 0 ? `${balance.rateText} 사용` : '부여된 연가 없음'}
        cells={Math.max(4, Math.min(24, Math.round(leave.grantedHours / hpd)))}
      />
      <p class="cap muted">
        {formatLeaveHours(leave.usedHours, hpd)} 사용{leave.plannedHours > 0
          ? ` (예정 ${formatLeaveHours(leave.plannedHours, hpd)} 포함)`
          : ''} · 사용률 {balance.rateText}
      </p>
      <button type="button" class="btn wide" onclick={() => nav.go('leave')}>연가 장부 열기</button>
    {/if}
  </div>
</Win>
