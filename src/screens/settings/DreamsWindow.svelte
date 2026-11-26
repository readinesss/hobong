<script lang="ts">
  /**
   * 호봉이의 꿈(#28): 앞으로 만들고 싶은 것. 목록은 data/site.json 의 dreams 에서 읽는다.
   * 약속이 아니라 꿈이라 날짜·기한은 적지 않는다.
   */
  import { CONTACT_EMAIL, DREAM_GROUPS, DREAMS } from '../../lib/site.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const groups = DREAM_GROUPS.map((group) => ({
    ...group,
    items: DREAMS.filter((dream) => dream.status === group.status),
  })).filter((group) => group.items.length > 0);
</script>

<Win title="호봉이의 꿈" icon="icon-moon" id="set-dreams">
  <div class="stack wide">
    <p class="cap muted">호봉이가 꾸는 꿈이에요. 꿈이라서 순서와 모양은 자라면서 바뀔 수 있어요.</p>
    {#each groups as group (group.status)}
      <section class="stack" aria-labelledby="dreams-{group.status}">
        <h3 class="group" id="dreams-{group.status}">
          <Icon name={group.icon} />
          <span>{group.label}</span>
          <span class="cap muted">{group.items.length}</span>
        </h3>
        <ul class="dreams">
          {#each group.items as dream (dream.id)}
            <li class="dream" data-status={dream.status}>
              <strong>{dream.title}</strong>
              <span class="cap muted">{dream.blurb}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    <p class="cap muted">
      {#if CONTACT_EMAIL}
        보태고 싶은 꿈이 있으면 제안·문의 메일로 알려 주세요.
      {:else}
        보태고 싶은 꿈은 메일 주소가 생기면 알려 주실 수 있어요.
      {/if}
    </p>
  </div>
</Win>

<style>
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: inherit;
    font-weight: normal;
  }
  .dreams {
    display: grid;
    gap: 6px;
  }
  /* 설정 화면에서 이 창이 전체 폭(720~1099px)이나 2/3 폭(1100px~)일 때 두 줄로 놓는다 */
  @media (min-width: 720px) {
    .dreams {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: stretch;
    }
  }
  .dream {
    display: grid;
    gap: 3px;
    padding: 6px 9px;
    background: var(--panel-2);
    box-shadow: inset var(--u) 0 0 0 var(--ink-2);
  }
  .dream[data-status='done'] {
    box-shadow: inset 3px 0 0 0 var(--good);
  }
  .dream[data-status='growing'] {
    box-shadow: inset 3px 0 0 0 var(--accent);
  }
  .dream[data-status='dream'] {
    box-shadow: inset 3px 0 0 0 var(--gold);
  }
  @media (forced-colors: active) {
    .dream {
      border-left: 3px solid CanvasText;
      box-shadow: none;
    }
  }
</style>
