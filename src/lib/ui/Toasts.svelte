<script lang="ts">
  import { app } from '../app/state.svelte.ts';
  import Icon from './Icon.svelte';
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
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
    z-index: 90;
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
  @media (min-width: 720px) {
    .toasts {
      bottom: 18px;
      justify-items: end;
    }
  }
</style>
