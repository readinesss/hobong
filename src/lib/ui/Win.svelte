<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    title: string;
    icon?: string;
    /** 제목 줄 오른쪽에 놓을 것 */
    aside?: Snippet;
    children: Snippet;
    /** 본문 안쪽 여백을 없앤다 */
    flush?: boolean;
    id?: string;
    area?: string;
    level?: 2 | 3;
  }

  let { title, icon, aside, children, flush = false, id, area, level = 2 }: Props = $props();
  const headingId = $derived(id ? `${id}-title` : undefined);
</script>

<section class="win" {id} aria-labelledby={headingId} style={area ? `grid-area:${area}` : undefined}>
  <header class="win-title">
    {#if icon}<Icon name={icon} />{/if}
    <svelte:element this={`h${level}`} id={headingId}>{title}</svelte:element>
    {#if aside}<div class="aside cap">{@render aside()}</div>{/if}
  </header>
  <div class={flush ? '' : 'win-body'}>
    {@render children()}
  </div>
</section>
