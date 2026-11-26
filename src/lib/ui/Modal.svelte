<script lang="ts" module>
  /** 열려 있는 대화상자(나중에 연 것이 맨 위). 키보드 처리와 겹침 순서를 맨 위 것만 맡는다. */
  const stack: symbol[] = [];
</script>

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
  const me = Symbol('modal');
  /** 겹쳐 열린 대화상자일수록 위에 그린다 */
  let depth = $state(0);

  function focusable(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
  }

  const isTop = () => stack[stack.length - 1] === me;

  /** 처음 포커스할 곳: 누를 수 있는 [data-autofocus], 없으면 창 자체 */
  function autoTarget(): HTMLElement | undefined {
    const auto = panel?.querySelector<HTMLElement>('[data-autofocus]');
    if (auto && !auto.matches(':disabled') && auto.offsetParent !== null) return auto;
    return panel;
  }

  /** 포커스가 창 밖(BODY 등)으로 빠졌거나 창 자체에 머물러 있으면 알맞은 곳으로 되돌린다 */
  function recapture() {
    if (!panel || !isTop()) return;
    const active = document.activeElement;
    const outside = !active || active === document.body || !panel.contains(active);
    if (outside || active === panel) {
      const target = autoTarget();
      if (target && target !== active) target.focus();
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (!isTop()) return;
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
    const inside = !!active && !!panel?.contains(active);
    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    previous = document.activeElement;
    stack.push(me);
    depth = stack.length;
    document.documentElement.setAttribute('data-modal', '');
    // 포커스가 대화상자 밖에 있어도(누른 버튼이 사라져 BODY 로 떨어진 경우 등) 키가 듣도록 문서에 건다.
    document.addEventListener('keydown', onkeydown);
    // 내용이 바뀌어 포커스한 버튼이 사라지거나, 막혀 있던 [data-autofocus] 가 풀리면 다시 잡는다.
    const observer = new MutationObserver(() => recapture());
    void tick().then(() => {
      autoTarget()?.focus();
      if (panel)
        observer.observe(panel, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'hidden'],
        });
    });
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onkeydown);
      const at = stack.indexOf(me);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length === 0) document.documentElement.removeAttribute('data-modal');
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  style="z-index:{100 + depth}"
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
    onfocusout={(e) => {
      // 창 밖으로 빠져나가는 포커스(사라지는 버튼 등)는 창 안으로 되돌린다
      const next = e.relatedTarget;
      if (next instanceof Node && panel?.contains(next)) return;
      queueMicrotask(recapture);
    }}
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
      /* 위쪽에 알림이 떠 있으면(Toasts.svelte) 그 아래에서 창이 시작하게 한다 */
      padding-top: calc(12px + var(--safe-t) + var(--toast-room, 0px));
    }
  }
</style>
