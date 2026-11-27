<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/app/state.svelte.ts';
  import { env } from '../lib/fx/core.ts';
  import { TALK } from '../lib/talk.ts';
  import CareerWindow from './home/CareerWindow.svelte';
  import GrowthWindow from './home/GrowthWindow.svelte';
  import LeaveMini from './home/LeaveMini.svelte';
  import RecapHint from './home/RecapHint.svelte';
  import StatusWindow from './home/StatusWindow.svelte';
  import TodayWindow from './home/TodayWindow.svelte';
  import UpcomingWindow from './home/UpcomingWindow.svelte';
  import PackageCard from './home/PackageCard.svelte';
  import WalletWindow from './home/WalletWindow.svelte';

  /**
   * 막 깨어났거나(hatch) 임용정보 패키지로 이어 왔을 때(import): 창들이 읽는 순서대로 하나씩 나타난다.
   * - 순서는 화면에 놓인 자리(위 → 아래, 왼쪽 → 오른쪽)로 매긴다. 열 수가 달라도 읽는 순서와 같다.
   * - 움직임 줄이기면 차례 등장 없이 바로 보인다.
   * - 포커스는 상태창 제목으로 옮기고, 홈에 왔다는 것을 한 번 읽어 준다.
   * - 패키지 안내 창은 창들이 다 나온 뒤 조금 있다가 나온다(방해하지 않게).
   */
  const STEP_MS = 60;
  const FIRST_MS = 120;
  const IN_MS = 280;
  const GUIDE_AFTER_MS = 600;

  let dash = $state<HTMLDivElement>();
  let entering = $state(false);
  let arrived = $state('');
  /** 차례 등장이 끝났는지(끝나야 패키지 안내 창이 나온다) */
  let settled = $state(app.entrance === null);

  onMount(() => {
    const kind = app.entrance;
    if (kind === null) return;
    const title = document.getElementById('status-title');
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
    arrived = kind === 'hatch' ? TALK.hatch.home : '임용정보 패키지로 이어 왔어요. 홈 화면이에요.';
    if (env.reduced || !dash) {
      app.clearEntrance();
      settled = true;
      return;
    }
    const wins = [...dash.querySelectorAll<HTMLElement>('.win')]
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
    wins.forEach(({ el }, i) => el.style.setProperty('--i', String(i)));
    entering = true;
    const total = FIRST_MS + wins.length * STEP_MS + IN_MS;
    const end = setTimeout(() => {
      entering = false;
      wins.forEach(({ el }) => el.style.removeProperty('--i'));
      app.clearEntrance();
    }, total + 40);
    const guide = setTimeout(() => (settled = true), total + GUIDE_AFTER_MS);
    return () => {
      clearTimeout(end);
      clearTimeout(guide);
      app.clearEntrance();
    };
  });
</script>

<!--
  좁은 화면: 한 열(칸 순서는 grid-template-areas가 정한다)
  두 열(720~1099px): [상태창·정년·지갑] [오늘·승급·연가·다가오는 일정]. 열 묶음(.col)이 각자 위에서부터 쌓여
    창 높이가 달라도 빈틈이 생기지 않는다.
  세 열(1100px~): [상태창·정년] [오늘·승급·연가] [지갑·다가오는 일정]
-->
<p class="sr-only" role="status" id="home-arrived">{arrived}</p>
<RecapHint />
<div class="dash" class:entering bind:this={dash}>
  <div class="col c1">
    <div class="col c1a">
      <!-- 임용정보 패키지 안내는 상태창 바로 아래에 끼운다(막 깨어난 호봉이를 밀어내지 않게) -->
      <div class="status-cell">
        <StatusWindow />
        {#if settled}<PackageCard />{/if}
      </div>
      <CareerWindow />
    </div>
    <div class="col c1b"><WalletWindow /></div>
  </div>
  <div class="col c2">
    <div class="col c2a">
      <TodayWindow />
      <GrowthWindow />
      <LeaveMini />
    </div>
    <div class="col c2b"><UpcomingWindow /></div>
  </div>
</div>

<style>
  .dash {
    display: grid;
    gap: 9px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'status'
      'today'
      'growth'
      'wallet'
      'career'
      'leave'
      'upcoming';
    align-items: start;
  }
  .col {
    display: contents;
  }
  .status-cell {
    grid-area: status;
    display: grid;
    gap: 9px;
    min-width: 0;
    align-content: start;
  }
  .status-cell :global(.win) {
    grid-area: auto !important;
  }
  /* 차례 등장: 창마다 조금씩 늦게, 아래에서 살짝 올라오며 나타난다. 움직임 줄이기면 이 클래스를 붙이지 않는다 */
  @keyframes win-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .dash.entering :global(.win) {
    animation: win-in 280ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: calc(120ms + var(--i, 0) * 60ms);
  }
  @media (min-width: 720px) {
    .dash {
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas: none;
    }
    .c1,
    .c2 {
      display: grid;
      gap: 12px;
      min-width: 0;
      align-content: start;
    }
    .col :global(.win) {
      grid-area: auto !important;
    }
    .status-cell {
      grid-area: auto;
      gap: 12px;
    }
  }
  @media (min-width: 1100px) {
    .dash {
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) minmax(0, 1fr);
      /* 셋째 열의 지갑 바로 밑에 다가오는 일정이 붙도록, 남는 높이는 둘째 줄이 받는다 */
      grid-template-rows: auto 1fr;
    }
    .c1,
    .c2 {
      display: contents;
    }
    .c1a,
    .c2a,
    .c1b,
    .c2b {
      display: grid;
      gap: 12px;
      min-width: 0;
      align-content: start;
    }
    .c1a {
      grid-column: 1;
      grid-row: 1 / span 2;
    }
    .c2a {
      grid-column: 2;
      grid-row: 1 / span 2;
    }
    .c1b {
      grid-column: 3;
      grid-row: 1;
    }
    .c2b {
      grid-column: 3;
      grid-row: 2;
    }
  }
</style>
