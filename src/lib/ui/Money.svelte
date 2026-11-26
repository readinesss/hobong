<script lang="ts">
  import { app } from '../app/state.svelte.ts';
  import { formatWon, formatWonShort, MASKED_WON } from '../app/format.ts';

  interface Props {
    value: number;
    /** 큰 금액을 '억·만' 단위로 줄여 쓴다 */
    short?: boolean;
    /** 앞에 붙일 부호(+ 등) */
    sign?: string;
    /** '약'을 붙인다 */
    approx?: boolean;
  }

  let { value, short = false, sign = '', approx = false }: Props = $props();
  const hidden = $derived(app.data?.settings.hideAmounts ?? false);
  const text = $derived(
    `${approx ? '약 ' : ''}${sign}${short ? formatWonShort(value) : formatWon(value)}`,
  );
</script>

{#if hidden}
  <span class="num masked" role="img" aria-label="금액 가려짐">{MASKED_WON}</span>
{:else}
  <span class="num">{text}</span>
{/if}

<style>
  .masked {
    color: var(--ink-2);
    letter-spacing: 0;
  }
</style>
