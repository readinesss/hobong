<script lang="ts">
  import { josa } from '../lib/app/format.ts';
  import { theme } from '../lib/app/theme.svelte.ts';
  import { calendar, view } from '../lib/app/view.svelte.ts';
  import { formatKorean } from '../lib/calc/date.ts';
  import { resolveLook, stageLabels, unlockList } from '../lib/character/look.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import type { AchievementView } from '../lib/achievements.ts';
  import Icon from '../lib/ui/Icon.svelte';
  import Modal from '../lib/ui/Modal.svelte';
  import Sprite from '../lib/ui/Sprite.svelte';
  import Win from '../lib/ui/Win.svelte';
  import YearPixelCalendar from './badges/YearPixelCalendar.svelte';

  const seen = $derived(new Set(view.data.character.seenForms));
  const noun = $derived(view.careerRules.ladder?.noun ?? '직급');
  const currentForm = $derived(view.look.form.id);
  const currentIndex = $derived(characterRules.forms.findIndex((f) => f.id === currentForm));
  /** 못 본 모습의 그림자 색(팔레트 번호): 어두운 화면에서는 밝은 회청색이라야 배경에 묻히지 않는다 */
  const silhouette = $derived(theme.dark ? 13 : 15);
  /** 형태 아래 이름: 사다리가 있으면 계급('9급'·'경위·경감'), 없으면 재직 연수('교직 2년') */
  const byLadder = $derived(
    view.careerRules.ladderId !== null &&
      view.careerRules.rank !== null &&
      !view.careerRules.rank.hideLabel,
  );
  const labels = $derived(
    stageLabels(
      characterRules,
      byLadder
        ? { id: view.careerRules.ladderId, ladder: view.careerRules.ladder }
        : { id: null, ladder: null },
      view.profile.track === 'teacher' ? '교직' : '재직',
    ),
  );
  const forms = $derived(
    characterRules.forms.map((form, index) => {
      // 직급은 내려가지 않으니, 지금보다 아래 직급의 모습은 지나온 것으로 친다(높은 직급으로 시작한 사람도)
      const passed = index < currentIndex;
      const known = seen.has(form.id) || form.id === currentForm || passed;
      const gradeLabel = labels[form.id] ?? '';
      return {
        form,
        known,
        current: form.id === currentForm,
        passed,
        gradeLabel,
        // 도감에는 소품 없이 기본 모습만 싣는다.
        look: resolveLook(characterRules, form.id, 0, 'work'),
      };
    }),
  );
  const seenCount = $derived(forms.filter((f) => f.known).length);

  const unlocks = $derived(
    unlockList(characterRules).map((u) => ({ ...u, open: u.step <= view.step })),
  );

  const year = $derived(view.recap.year);
  /** 올해 찍힌 출근 도장 수(앱을 연 날. 정년퇴직 뒤에 연 날도 센다)와 모두 찍힌 수(배지와 같은 기준) */
  const yearVisits = $derived(view.yearGrid.filter((d) => d.opened).length);
  const allVisits = $derived(view.data.visits.days.length);
  const holidaysKnown = $derived(calendar.hasHolidayData(year));

  const badges = $derived(view.badges);
  const total = $derived(badges.length);
  const TIER_LABEL = { bronze: '동', silver: '은', gold: '금' } as const;
  let detail = $state<AchievementView | null>(null);
  /** 잠긴 배지의 얻는 방법. 앞 문장과 띄어 쓴다('…못했어요. 어두운 화면을 켜면 얻어요.') */
  const lockedHint = (hint: string | null | undefined) =>
    hint ? ` ${hint.endsWith('면') ? `${hint} 얻어요.` : hint}` : '';
</script>

<!-- 넓은 화면(1100px~)에서는 두 열 묶음으로 쌓아(왼쪽 도감·배지, 오른쪽 깃·출근 도장) 빈칸이 생기지 않게 한다.
     좁은 폭에서는 .col 이 사라지고(display: contents) 창 하나하나를 grid-area 로 놓는다. -->
<div class="page">
  <div class="col left">
    <Win title="도감" icon="icon-book" id="dex" area="dex">
      {#snippet aside()}{seenCount} / {forms.length}{/snippet}
      <ul class="dex">
        {#each forms as item (item.form.id)}
          <li class="well" class:current={item.current}>
            <div class="pic">
              {#if item.known}
                <Sprite
                  look={item.look}
                  scale={2}
                  animate={false}
                  pose={{ plain: true }}
                  label="{item.form.name}의 모습"
                />
              {:else}
                <Sprite
                  look={item.look}
                  scale={2}
                  animate={false}
                  pose={{ plain: true, silhouette }}
                  label="아직 만나지 못한 모습"
                />
              {/if}
            </div>
            <strong>{item.known ? item.form.name : '???'}</strong>
            <span class="cap muted">{item.gradeLabel}</span>
            {#if item.current}<span class="tag blue">지금</span>{:else if item.passed}<span
                class="tag"
              >
                지나온 모습
              </span>{:else if item.known}<span class="tag">만남</span>{/if}
          </li>
        {/each}
      </ul>
      <p class="cap muted">
        {byLadder
          ? `${josa(noun, '이', '가')} 오르면 모습이 바뀌어요. 지나온 ${noun}의 모습은 열려 있고, 아직 만나지 못한 모습은 그림자로만 보여요.`
          : '함께 지낸 해가 쌓이면 모습이 바뀌어요. 지나온 모습은 열려 있고, 아직 만나지 못한 모습은 그림자로만 보여요.'}
      </p>
    </Win>

    <!-- id를 화면 주소(#badges)와 다르게 둔다: 같으면 새로 고칠 때 브라우저가 이 창으로 내려가 버린다 -->
    <Win title="배지" icon="icon-medal" id="badge-list" area="badges">
      {#snippet aside()}{view.earnedCount} / {total}{/snippet}
      <ul class="badges">
        {#each badges as badge (badge.id)}
          <li>
            <button
              type="button"
              class="badge {badge.tier}"
              class:locked={badge.at === null}
              onclick={() => (detail = badge)}
              aria-label="{badge.title}, {badge.at
                ? `${formatKorean(badge.at, false)} 달성`
                : `아직 얻지 못함${badge.hint ? `. ${badge.hint.endsWith('면') ? `${badge.hint} 얻어요` : badge.hint}` : ''}`}"
            >
              <span class="medal" aria-hidden="true">
                <Icon name={badge.at === null ? 'icon-lock' : badge.icon} scale={2} />
              </span>
              <span class="cap name">{badge.title}</span>
            </button>
          </li>
        {/each}
      </ul>
      <p class="cap muted">배지를 누르면 자세한 내용을 볼 수 있어요.</p>
    </Win>
  </div>
  <div class="col right">
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
              <Icon name="icon-lock" label="아직 얻지 못함" />
            {/if}
          </li>
        {/each}
      </ol>
      <p class="cap muted">
        호봉이 오를 때마다 깃이 하나씩 자라고, 몇몇 호봉에서는 소품이나 색이 달라져요.
      </p>
    </Win>

    <Win title="출근 도장" icon="icon-stamp" id="visits" area="visits">
      {#snippet aside()}{year}년 {yearVisits}개 · 모두 {allVisits}개{/snippet}
      <div class="stack wide">
        <YearPixelCalendar
          grid={view.yearGrid}
          {year}
          hoursPerDay={view.rules.leave.units.hoursPerDay}
          {holidaysKnown}
        />
        <p class="cap muted">
          호봉이를 들여다본 날마다 도장이 하나 찍혀요. 며칠 건너뛰어도 사라지지 않아요. 연가는 연가
          장부의 기록을 그대로 보여 줘요.{holidaysKnown
            ? ''
            : ` ${year}년 공휴일이 아직 반영되지 않아 주말만 쉬는 날로 보여요.`}
        </p>
      </div>
    </Win>
  </div>
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
          <p class="good">{formatKorean(detail.at)} 달성 · {TIER_LABEL[detail.tier]} 배지</p>
        {:else}
          <p class="muted">
            아직 얻지 못했어요.{lockedHint(detail.hint)}
          </p>
        {/if}
      </div>
    </div>
    {#snippet actions()}
      <button type="button" class="btn primary" data-autofocus onclick={() => (detail = null)}>
        확인
      </button>
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
  .badges {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 6px;
    margin-bottom: 9px;
  }
  /* 이름이 두 줄인 타일이 있어도 한 줄의 타일 높이를 맞춘다 */
  .badges li {
    display: grid;
  }
  .badge {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 3px;
    width: 100%;
    height: 100%;
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
  .col {
    display: contents;
  }
  /* 넓은 화면: 열 묶음으로 쌓는다(창 높이가 달라도 열 사이에 큰 빈칸이 생기지 않는다) */
  @media (min-width: 1100px) {
    .page {
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      grid-template-areas: none;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
  }
</style>
