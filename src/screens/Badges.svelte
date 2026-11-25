<script lang="ts">
  import { view } from '../lib/app/view.svelte.ts';
  import { addDays, dayOfWeek, formatKorean, type Ymd } from '../lib/calc/date.ts';
  import { resolveLook, unlockList } from '../lib/character/look.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import type { Grade } from '../lib/store/schema.ts';
  import type { AchievementView } from '../lib/achievements.ts';
  import Icon from '../lib/ui/Icon.svelte';
  import Modal from '../lib/ui/Modal.svelte';
  import Sprite from '../lib/ui/Sprite.svelte';
  import Win from '../lib/ui/Win.svelte';

  const seen = $derived(new Set(view.data.character.seenForms));
  const currentForm = $derived(view.look.form.id);
  const forms = $derived(
    characterRules.forms.map((form) => {
      const grade = form.grades[0] as Grade;
      const known = seen.has(form.id) || form.id === currentForm;
      const gradeLabel =
        form.grades.length === 1 ? `${grade}급` : `${Math.max(...form.grades)}급 이상`;
      return {
        form,
        known,
        current: form.id === currentForm,
        gradeLabel,
        // 도감에는 소품 없이 기본 모습만 싣는다.
        look: resolveLook(characterRules, grade, 0, 'work'),
      };
    }),
  );
  const seenCount = $derived(forms.filter((f) => f.known).length);

  const unlocks = $derived(unlockList(characterRules).map((u) => ({ ...u, open: u.step <= view.step })));

  const visitDays = $derived(view.data.visits.days);
  const visitSet = $derived(new Set(visitDays));
  /** 최근 4주(일요일 시작)의 방문 도장 */
  const recentWeeks = $derived.by(() => {
    const end = addDays(view.today, 6 - dayOfWeek(view.today));
    const days: { date: Ymd; on: boolean; future: boolean; today: boolean }[] = [];
    for (let i = 27; i >= 0; i -= 1) {
      const date = addDays(end, -i);
      days.push({ date, on: visitSet.has(date), future: date > view.today, today: date === view.today });
    }
    return days;
  });

  const badges = $derived(view.badges);
  const total = $derived(badges.length);
  const TIER_LABEL = { bronze: '동', silver: '은', gold: '금' } as const;
  let detail = $state<AchievementView | null>(null);
</script>

<div class="page">
  <Win title="도감" icon="icon-book" id="dex" area="dex">
    {#snippet aside()}{seenCount} / {forms.length}{/snippet}
    <ul class="dex">
      {#each forms as item (item.form.id)}
        <li class="well" class:current={item.current}>
          <div class="pic">
            {#if item.known}
              <Sprite look={item.look} scale={2} animate={false} pose={{ plain: true }} label="{item.form.name}의 모습" />
            {:else}
              <Sprite look={item.look} scale={2} animate={false} pose={{ plain: true, silhouette: 15 }} label="아직 만나지 못한 모습" />
            {/if}
          </div>
          <strong>{item.known ? item.form.name : '???'}</strong>
          <span class="cap muted">{item.gradeLabel}</span>
          {#if item.current}<span class="tag blue">지금</span>{:else if item.known}<span class="tag">만남</span>{/if}
        </li>
      {/each}
    </ul>
    <p class="cap muted">
      직급이 오르면 모습이 바뀌어요. 아직 만나지 못한 모습은 그림자로만 보여요.
    </p>
  </Win>

  <Win title="깃이 자라면" icon="icon-feather" id="unlocks" area="unlocks">
    {#snippet aside()}{view.step}호봉{/snippet}
    <ol class="unlocks">
      {#each unlocks as item (item.step + item.name)}
        <li class:open={item.open}>
          <span class="tag" class:gold={item.open}>{item.step}호봉</span>
          <div class="grow">
            <span>{item.name}</span>
            <span class="cap muted">{item.blurb}</span>
          </div>
          {#if item.open}
            <Icon name="icon-check" label="얻음" />
          {:else}
            <Icon name="icon-lock" label="아직" />
          {/if}
        </li>
      {/each}
    </ol>
    <p class="cap muted">호봉이 오를 때마다 깃이 하나씩 자라고, 몇몇 호봉에서는 소품이나 색이 달라져요.</p>
  </Win>

  <Win title="출근 도장" icon="icon-stamp" id="visits" area="visits">
    {#snippet aside()}{visitDays.length}개{/snippet}
    <div class="stack wide">
      <div class="weeks" role="img" aria-label="최근 4주 동안 들른 날 {recentWeeks.filter((d) => d.on).length}일">
        {#each recentWeeks as day (day.date)}
          <i class:on={day.on} class:future={day.future} class:today={day.today} title={formatKorean(day.date)}></i>
        {/each}
      </div>
      <p class="cap muted">
        호봉이를 들여다본 날마다 도장이 하나 찍혀요. 며칠 건너뛰어도 사라지지 않아요.
      </p>
    </div>
  </Win>

  <Win title="뱃지" icon="icon-medal" id="badges" area="badges">
    {#snippet aside()}{view.earnedCount} / {total}{/snippet}
    <ul class="badges">
      {#each badges as badge (badge.id)}
        <li>
          <button
            type="button"
            class="badge {badge.tier}"
            class:locked={badge.at === null}
            onclick={() => (detail = badge)}
            aria-label="{badge.title}, {badge.at ? `${formatKorean(badge.at, false)} 달성` : `아직. ${badge.hint ?? ''}`}"
          >
            <span class="medal" aria-hidden="true">
              <Icon name={badge.at === null ? 'icon-lock' : badge.icon} scale={2} />
            </span>
            <span class="cap name">{badge.title}</span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="cap muted">뱃지를 누르면 자세한 내용을 볼 수 있어요.</p>
  </Win>
</div>

{#if detail}
  <Modal title={detail.title} icon="icon-medal" onclose={() => (detail = null)}>
    <div class="detail">
      <span class="medal big {detail.at === null ? 'lockedm' : detail.tier}" aria-hidden="true">
        <Icon name={detail.at === null ? 'icon-lock' : detail.icon} scale={3} />
      </span>
      <div class="stack">
        <p>{detail.desc}</p>
        {#if detail.at}
          <p class="good">{formatKorean(detail.at)} 달성 · {TIER_LABEL[detail.tier]} 뱃지</p>
        {:else}
          <p class="muted">아직 얻지 못했어요. {detail.hint}</p>
        {/if}
      </div>
    </div>
    {#snippet actions()}
      <button type="button" class="btn primary" data-autofocus onclick={() => (detail = null)}>확인</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .page {
    display: grid;
    gap: 9px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'dex'
      'unlocks'
      'visits'
      'badges';
    align-items: start;
  }
  .dex {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 6px;
    margin-bottom: 9px;
  }
  .dex li {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 6px 3px 9px;
    text-align: center;
  }
  .dex li.current {
    box-shadow: inset 0 0 0 var(--u) var(--accent);
  }
  .dex strong {
    font-weight: 400;
  }
  .pic {
    display: grid;
    place-items: end center;
    width: 96px;
    height: 96px;
  }
  .unlocks {
    display: grid;
    gap: 6px;
    margin-bottom: 9px;
  }
  .unlocks li {
    display: flex;
    align-items: center;
    gap: 9px;
    opacity: 0.7;
  }
  .unlocks li.open {
    opacity: 1;
  }
  .unlocks .grow {
    display: grid;
  }
  .unlocks .tag {
    min-width: 54px;
    justify-content: center;
  }
  .weeks {
    display: grid;
    grid-template-columns: repeat(7, 24px);
    gap: 6px;
    justify-content: start;
  }
  .weeks i {
    width: 24px;
    height: 24px;
    background: var(--panel-2);
    box-shadow: inset 0 0 0 var(--u) rgba(127, 140, 160, 0.4);
  }
  .weeks i.on {
    background: var(--warn-fill);
    box-shadow:
      inset 0 0 0 var(--u) #7e2a3a,
      inset 0 0 0 6px var(--warn-fill),
      inset 0 0 0 9px #f4f4f4;
  }
  .weeks i.future {
    opacity: 0.35;
  }
  .weeks i.today {
    outline: var(--u) solid var(--ink);
    outline-offset: 0;
  }
  .badges {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 6px;
    margin-bottom: 9px;
  }
  .badge {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 3px;
    width: 100%;
    min-height: 96px;
    padding: 9px 3px 6px;
    border: 0;
    background: var(--panel-2);
    color: var(--ink);
    cursor: pointer;
    text-align: center;
    touch-action: manipulation;
  }
  .badge:active {
    background: var(--panel);
    box-shadow: inset 0 0 0 var(--u) var(--ink-2);
  }
  .badge:focus-visible {
    outline-offset: -3px;
  }
  .name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .medal {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    background: var(--panel);
    box-shadow: 0 0 0 var(--u) var(--line);
    margin: var(--u);
  }
  .medal.big {
    width: 66px;
    height: 66px;
  }
  .badge.bronze .medal,
  .medal.bronze {
    background: #f1c9a5;
    color: #1a1c2c;
  }
  .badge.silver .medal,
  .medal.silver {
    background: #cfdbe4;
    color: #1a1c2c;
  }
  .badge.gold .medal,
  .medal.gold {
    background: var(--gold);
    color: #1a1c2c;
  }
  .badge.locked .name {
    color: var(--ink-2);
  }
  .badge.locked .medal,
  .medal.lockedm {
    background: var(--panel);
    color: var(--ink-2);
    box-shadow: 0 0 0 var(--u) var(--ink-2);
  }
  .detail {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  @media (min-width: 720px) {
    .page {
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas:
        'dex dex'
        'unlocks visits'
        'badges badges';
    }
  }
  @media (min-width: 1100px) {
    .page {
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      grid-template-areas:
        'dex unlocks'
        'badges unlocks'
        'badges visits';
    }
  }
</style>
