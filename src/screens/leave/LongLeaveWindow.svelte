<script lang="ts">
  /**
   * 지금 쓸 수 있거나 1년 안에 생기는 장기재직휴가 안내(복무규정 제20조제18항과 부칙).
   * 특별휴가라 연가 장부와 따로 보여 주고, 해당하는 구간이 없으면 창을 그리지 않는다.
   * 이미 썼는지는 저장하지 않으므로 알 수 없다(사실만 적는다).
   */
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean, type Ymd } from '../../lib/calc/date.ts';
  import type { LongLeaveNotice } from '../../lib/calc/milestones.ts';
  import Win from '../../lib/ui/Win.svelte';

  const notices = $derived(view.longLeave);
  const source = $derived(view.rules.leave.longService.source);
  const lawName = $derived(view.rules.laws[source.law]?.name ?? source.law);
  const d = (date: Ymd) => formatKorean(date, false);

  function band(n: LongLeaveNotice): string {
    return n.toYears === null
      ? `재직 ${n.fromYears}년 이상`
      : `재직 ${n.fromYears}년 이상 ${n.toYears}년 미만`;
  }

  function untilText(n: LongLeaveNotice): string {
    if (n.toYears === null) return `재직하는 동안(정년퇴직일 ${d(n.lastDay)}까지)`;
    if (n.byRetirement) return `정년퇴직일인 ${d(n.lastDay)}까지`;
    return `${d(n.lastDay)}까지`;
  }

  function body(n: LongLeaveNotice): string {
    if (n.status === 'open') return `${untilText(n)} 한 번 쓸 수 있어요.`;
    const start = n.startsAtEffective
      ? `이 휴가가 새로 생기는 ${d(n.from)}부터`
      : `재직 ${n.fromYears}년이 되는 ${d(n.from)}부터`;
    return `${start} ${untilText(n)} 한 번 쓸 수 있어요.`;
  }
</script>

{#if notices.length > 0}
  <Win title="장기재직휴가" icon="icon-plane" id="leave-long" area="long">
    {#snippet aside()}특별휴가{/snippet}
    <div class="stack wide">
      <ul class="items">
        {#each notices as n (n.fromYears)}
          <li class="well">
            <div class="head">
              <strong>{n.days}일</strong>
              {#if n.status === 'open'}
                <span class="tag gold">지금 쓸 수 있어요</span>
              {:else}
                <span class="tag">{d(n.from)}부터</span>
              {/if}
              <span class="cap muted">{band(n)}</span>
            </div>
            <p>{body(n)}</p>
            {#if n.status === 'open' && n.startsAtEffective}
              <p class="cap muted">
                재직 {n.fromYears}년을 넘긴 뒤 {d(n.effective)}에 이 휴가가 새로 생겼어요.
              </p>
            {/if}
            {#if n.graced}
              <p class="cap muted">
                부칙 특례로 기한이 {d(n.lastDay)}까지 늘었어요. 마지막 날을 시행일과 같은 달·날로 본
                이 서비스의 해석이라 하루 차이가 날 수 있어요.
              </p>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="note">
        장기재직휴가는 연가가 아니라 특별휴가예요. 써도 올해 연가는 줄지 않아요. 이 장부에는 적지
        말고 소속 기관 절차대로 신청해 주세요.
      </p>
      <p class="cap muted">
        구간마다 한 번이에요. 이미 썼다면 넘겨 주세요. 날짜는 임용일부터 센 재직기간으로
        계산했어요(휴직 등은 빼지 않았어요).
      </p>
      <p class="cap muted src">근거: {lawName} {source.article}</p>
    </div>
  </Win>
{/if}

<style>
  .items {
    display: grid;
    gap: 9px;
  }
  .items li {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 9px;
  }
  strong {
    font-weight: 400;
  }
  p {
    overflow-wrap: anywhere;
  }
</style>
