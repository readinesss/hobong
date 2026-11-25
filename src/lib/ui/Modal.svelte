<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    title: string;
    icon?: string;
    onclose: () => void;
    children: Snippet;
    /** 아래쪽 버튼 줄 */
    actions?: Snippet;
    /** 바깥을 누르거나 Esc로 닫을 수 있는지 */
    dismissible?: boolean;
    wide?: boolean;
  }

  let {
    title,
    icon,
    onclose,
    children,
    actions,
    dismissible = true,
    wide = false,
  }: Props = $props();

  let panel = $state<HTMLDivElement>();
  let previous: Element | null = null;
  const titleId = `modal-${Math.random().toString(36).slice(2, 9)}`;

  function focusable(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key !== 'Tab') return;
    // 포커스를 창 안에 가둔다.
    const items = focusable();
    if (items.length === 0) {
      event.preventDefault();
      panel?.focus();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    previous = document.activeElement;
    document.documentElement.setAttribute('data-modal', '');
    void tick().then(() => {
      const auto = panel?.querySelector<HTMLElement>('[data-autofocus]');
      (auto ?? panel)?.focus();
    });
    return () => {
      document.documentElement.removeAttribute('data-modal');
      if (previous instanceof HTMLElement) previous.focus();
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  {onkeydown}
  onpointerdown={(e) => {
    if (dismissible && e.target === e.currentTarget) onclose();
  }}
>
  <div
    bind:this={panel}
    class="win modal pop-in"
    class:wide
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
  >
    <header class="win-title">
      {#if icon}<Icon name={icon} />{/if}
      <h2 id={titleId}>{title}</h2>
      {#if dismissible}
        <button type="button" class="btn ghost small close" onclick={onclose} aria-label="닫기">
          <Icon name="icon-close" />
        </button>
      {/if}
    </header>
    <div class="win-body body">
      {@render children()}
    </div>
    {#if actions}
      <footer class="actions btn-row end">
        {@render actions()}
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(12px + var(--safe-t)) calc(12px + var(--safe-r)) calc(12px + var(--safe-b))
      calc(12px + var(--safe-l));
    background: rgba(26, 28, 44, 0.62);
    overscroll-behavior: contain;
  }
  .modal {
    display: flex;
    flex-direction: column;
    width: min(420px, 100%);
    max-height: 100%;
    margin: 0;
    outline: none;
  }
  .modal.wide {
    width: min(640px, 100%);
  }
  .body {
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .actions {
    padding: 6px 9px 9px;
    border-top: var(--u) solid var(--panel-2);
  }
  .close {
    margin: 0 -6px 0 0;
    color: var(--title-ink);
  }
  @media (max-width: 479px) {
    .backdrop {
      align-items: flex-end;
    }
  }
</style>
