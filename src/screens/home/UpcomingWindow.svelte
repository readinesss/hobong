<script lang="ts">
  import { formatDday } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean } from '../../lib/calc/date.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Win from '../../lib/ui/Win.svelte';
</script>

<Win title="다가오는 일정" icon="icon-list" id="upcoming" area="upcoming">
  {#if view.upcoming.length === 0}
    <p class="muted">남은 일정이 없어요. 긴 길을 다 오셨습니다.</p>
  {:else}
    <ol class="list">
      {#each view.upcoming as item (item.id)}
        <li>
          <span class="ico"><Icon name={item.icon} scale={2} /></span>
          <div class="grow stack">
            <div class="kv">
              <span class="title">{item.title}</span>
              <strong class="num">{formatDday(view.today, item.date)}</strong>
            </div>
            <p class="cap muted">{formatKorean(item.date)} · {item.detail}</p>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</Win>

<style>
  .list {
    display: grid;
    gap: 12px;
  }
  .list li {
    display: flex;
    gap: 9px;
    align-items: flex-start;
  }
  .ico {
    flex: none;
    padding: 3px;
    background: var(--panel-2);
  }
  .title {
    color: var(--ink) !important;
  }
</style>
