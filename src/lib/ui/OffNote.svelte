<script lang="ts">
  /**
   * 꺼진 항목(준비 중·해당 없음·다른 기준) 한 줄. 숫자 대신 상태와 사유를 보여 준다.
   * 상태는 색이 아니라 글자(꼬리표)로 구별한다. 화면마다 같은 모양으로 쓴다(#20 §7.5).
   */
  import { OFF_STATUS_LABEL } from '../app/track.ts';
  import type { Unavailable } from '../rules/types.ts';

  interface Props {
    /** 항목 이름('근속승진'). 없으면 사유만 */
    label?: string;
    off: Unavailable;
    id?: string;
  }

  let { label, off, id }: Props = $props();
</script>

<!-- 낭독기는 '정년: 준비 중. 사유'로 끊어 읽는다(보이는 꼬리표·이름은 같은 말이라 낭독에서 뺀다) -->
<p class="cap muted off-note" {id} data-off={off.status}>
  <span class="sr-only">{label ? `${label}: ` : ''}{OFF_STATUS_LABEL[off.status]}.</span>
  <span class="tag" aria-hidden="true">{OFF_STATUS_LABEL[off.status]}</span>
  {#if label}<span aria-hidden="true">{label}</span>{/if}
  {#if off.reason}<span class="reason">{off.reason}</span>{/if}
</p>

<style>
  .off-note {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 3px 6px;
    min-width: 0;
  }
  .reason {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
