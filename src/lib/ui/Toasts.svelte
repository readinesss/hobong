<script lang="ts">
  import { app } from '../app/state.svelte.ts';
  import Icon from './Icon.svelte';

  /** 알림 묶음의 높이. 모바일에서 대화상자가 알림 밑으로 내려가도록 문서에 알려 준다. */
  let height = $state(0);
  $effect(() => {
    const root = document.documentElement;
    if (height > 0) root.style.setProperty('--toast-room', `${Math.ceil(height) + 9}px`);
    else root.style.removeProperty('--toast-room');
  });
</script>

<div class="toasts" aria-live="polite" aria-atomic="false" bind:clientHeight={height}>
  {#each app.toasts as toast (toast.id)}
    <div class="win toast pop-in {toast.kind}" role="status">
      {#if toast.icon}<Icon name={toast.icon} />{/if}
      <span class="grow">{toast.text}</span>
      {#if toast.action}
        <button
          type="button"
          class="btn small"
          onclick={() => {
            toast.action?.run();
            app.dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      {/if}
      <button
        type="button"
        class="btn ghost small"
        onclick={() => app.dismissToast(toast.id)}
        aria-label="알림 닫기"
      >
        <Icon name="icon-close" />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    /* 대화상자(100~) 위에 보이게 한다. 대화상자가 열려 있을 때 생긴 결과는 대화상자 안에도 적는다. */
    z-index: 110;
    left: calc(9px + var(--safe-l) + var(--rail-w));
    right: calc(9px + var(--safe-r));
    bottom: calc(var(--tabbar-h) + var(--safe-b) + 12px);
    display: grid;
    gap: 9px;
    justify-items: center;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 9px;
    width: min(420px, 100%);
    padding: 6px 6px 6px 12px;
    margin: 0;
  }
  .toast.good {
    box-shadow:
      var(--frame),
      var(--drop),
      inset var(--u) 0 0 0 var(--good-fill);
  }
  .toast.warn {
    box-shadow:
      var(--frame),
      var(--drop),
      inset var(--u) 0 0 0 var(--warn-fill);
  }
  .toast .btn {
    margin: 0;
  }
  /* 모바일 대화상자는 바닥에 붙으므로, 대화상자가 열려 있으면 알림을 위쪽에 둔다.
     대화상자는 --toast-room 만큼 내려와 제목·닫기 단추가 알림에 가리지 않는다(Modal.svelte). */
  @media (max-width: 479px) {
    :global(:root[data-modal]) .toasts {
      top: calc(9px + var(--safe-t));
      bottom: auto;
    }
  }
  @media (min-width: 720px) {
    .toasts {
      bottom: 18px;
      justify-items: end;
    }
  }
</style>
