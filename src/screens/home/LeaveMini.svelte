<script lang="ts">
  import { nav } from '../../lib/app/nav.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { leaveBalance } from '../../lib/app/format.ts';
  import { formatLeaveHours } from '../../lib/calc/leave.ts';
  import Progress from '../../lib/ui/Progress.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const leave = $derived(view.leave);
  const hpd = $derived(leave.hoursPerDay);
  const balance = $derived(leaveBalance(leave.remainingHours, leave.grantedHours, leave.rate, hpd));
</script>

<Win title="연가" icon="icon-palm" id="leave-mini" area="leave">
  {#snippet aside()}{leave.year}년{/snippet}
  <div class="stack wide">
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
  </div>
</Win>
