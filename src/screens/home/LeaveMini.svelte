<script lang="ts">
  import { nav } from '../../lib/app/nav.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatLeaveHours } from '../../lib/calc/leave.ts';
  import Progress from '../../lib/ui/Progress.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const leave = $derived(view.leave);
  const hpd = $derived(leave.hoursPerDay);
</script>

<Win title="연가" icon="icon-palm" id="leave-mini" area="leave">
  {#snippet aside()}{leave.year}년{/snippet}
  <div class="stack wide">
    <div class="kv">
      <span>남은 연가</span>
      <span>
        <strong class="big">{formatLeaveHours(leave.remainingHours, hpd)}</strong>
        <span class="cap muted">/ {formatLeaveHours(leave.grantedHours, hpd)}</span>
      </span>
    </div>
    <Progress
      value={leave.rate}
      label="올해 연가 사용률"
      valueText="{Math.round(leave.rate * 100)}% 사용"
      cells={Math.max(4, Math.min(24, Math.round(leave.grantedHours / hpd)))}
    />
    <p class="cap muted">
      {formatLeaveHours(leave.usedHours, hpd)} 사용{leave.plannedHours > 0
        ? ` (예정 ${formatLeaveHours(leave.plannedHours, hpd)} 포함)`
        : ''} · 사용률 {Math.round(leave.rate * 100)}%
    </p>
    <button type="button" class="btn wide" onclick={() => nav.go('leave')}>연가 장부 열기</button>
  </div>
</Win>
