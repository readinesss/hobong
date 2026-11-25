<script lang="ts">
  import { characterRules } from '../character/rules.ts';
  import { iconPaths } from '../character/sprites.ts';

  interface Props {
    name: string;
    /** 확대 배율(정수). 16×16 아이콘이면 2 → 32px */
    scale?: number;
    /** 화면 낭독기에 읽어 줄 이름. 없으면 장식으로 취급한다 */
    label?: string;
  }

  let { name, scale = 1, label }: Props = $props();
  const icon = $derived(iconPaths(name));
</script>

{#if icon}
  <svg
    class="icon"
    width={icon.w * scale}
    height={icon.h * scale}
    viewBox="0 0 {icon.w} {icon.h}"
    shape-rendering="crispEdges"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : 'true'}
    focusable="false"
  >
    {#each icon.paths as path (path.color)}
      <path
        d={path.d}
        fill={path.color === 0 ? 'currentColor' : characterRules.palette[path.color]}
      />
    {/each}
  </svg>
{:else}
  <span class="icon-missing" style="width:{16 * scale}px;height:{16 * scale}px" aria-hidden="true"
  ></span>
{/if}

<style>
  .icon,
  .icon-missing {
    flex: none;
    display: inline-block;
    vertical-align: middle;
  }
</style>
