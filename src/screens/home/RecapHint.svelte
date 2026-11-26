<script lang="ts">
  /**
   * 12월에만 대시보드 맨 위에 조용히 띄우는 결산 안내(알림·움직임 없음).
   * 닫으면 이 탭에서만 기억한다(새로 고치면 다시 보인다).
   */
  import { focusAfterDismiss } from '../../lib/app/dismiss.ts';
  import { nav } from '../../lib/app/nav.svelte.ts';
  import { session } from '../../lib/app/session.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { parseYmd } from '../../lib/calc/date.ts';
  import DismissButton from '../../lib/ui/DismissButton.svelte';
  import Icon from '../../lib/ui/Icon.svelte';

  const key = $derived(`recap-hint-${view.recap.year}`);
  const show = $derived(
    parseYmd(view.today).m === 12 && view.recap.status === 'active' && !session.isDismissed(key),
  );

  function openRecap() {
    session.cardKind = 'recap';
    nav.go('card');
  }

  function close() {
    session.dismiss(key);
    // 닫은 버튼이 사라지므로 남은 띠의 닫기 버튼, 없으면 본문 처음으로 포커스를 옮긴다
    void focusAfterDismiss();
  }
</script>

{#if show}
  <div class="note hint" id="recap-hint">
    <Icon name="icon-calendar" />
    <p class="grow">
      {view.recap.year}년 결산이 준비됐어요. 올해 기록을 카드로 모아 볼 수 있어요.
    </p>
    <div class="btn-row">
      <button type="button" class="btn small" onclick={openRecap}>결산 카드 보기</button>
      <DismissButton label="결산 안내 닫기" onclick={close} corner={false} />
    </div>
  </div>
{/if}

<style>
  .hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 9px;
    margin-bottom: 12px;
  }
  .hint p {
    min-width: 12em;
  }
</style>
