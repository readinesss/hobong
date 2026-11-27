<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { takeHandoff } from '../lib/app/handoff.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { env } from '../lib/fx/core.ts';
  import { TALK } from '../lib/talk.ts';
  import Sprite from '../lib/ui/Sprite.svelte';
  import CareerWindow from './home/CareerWindow.svelte';
  import GrowthWindow from './home/GrowthWindow.svelte';
  import LeaveMini from './home/LeaveMini.svelte';
  import LifetimeWindow from './home/LifetimeWindow.svelte';
  import RecapHint from './home/RecapHint.svelte';
  import StatusWindow from './home/StatusWindow.svelte';
  import TodayWindow from './home/TodayWindow.svelte';
  import UpcomingWindow from './home/UpcomingWindow.svelte';
  import PackageCard from './home/PackageCard.svelte';
  import WalletWindow from './home/WalletWindow.svelte';

  /**
   * 막 깨어났거나(hatch) 임용정보 패키지로 이어 왔을 때(import): 창들이 읽는 순서대로 하나씩 나타난다.
   * - 깨어난 직후에는 부화 무대에 서 있던 호봉이가 그 자리에서 상태창의 제자리로 걸어 들어온다(.walker: 화면에 고정된
   *   그림 한 장이 옮겨 가고, 닿으면 상태창의 진짜 그림으로 바뀐다). 상태창 틀은 그 둘레에서 자라난다.
   * - 그 뒤 창들이 120ms 간격으로 400ms 씩 아래에서 올라온다. 순서는 화면에 놓인 자리(위 → 아래, 왼쪽 → 오른쪽).
   *   상태창 안쪽(이름판 → 호봉 → 깃 → 승급 막대)도 차례로 나타나, 창 하나만 보이는 휴대폰에서도 차례 등장이 보인다.
   * - 움직임 줄이기면 이 모든 것 없이 바로 보인다.
   * - 포커스는 상태창 제목으로 옮기고, 홈에 왔다는 것을 한 번 읽어 준다.
   * - 임용정보 패키지 안내(상태창 안)는 등장이 끝난 뒤 조금 있다가 나온다. 새 배지 알림은 더 뒤에(App.svelte).
   */
  const STEP_MS = 120;
  const FIRST_MS = 160;
  const IN_MS = 400;
  /** 호봉이가 부화 무대 자리에서 상태창 자리까지 옮겨 가는 시간 */
  const WALK_MS = 460;
  const GUIDE_AFTER_MS = 300;

  let dash = $state<HTMLDivElement>();
  let entering = $state(false);
  let arrived = $state('');
  /** 차례 등장이 끝났는지(끝나야 패키지 안내가 나온다) */
  let settled = $state(app.entrance === null);
  /** 옮겨 가는 호봉이: 닿을 자리(뷰포트 px)와 배율 */
  let ghost = $state<{ x: number; y: number; scale: number } | null>(null);
  let ghostEl = $state<HTMLDivElement>();

  onMount(() => {
    const kind = app.entrance;
    const from = takeHandoff();
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
    const timers: ReturnType<typeof setTimeout>[] = [];

    // 부화 무대의 호봉이를 상태창 자리로 잇는다(상태창의 그림 크기가 정해진 뒤에 잰다)
    if (kind === 'hatch' && from) {
      void tick().then(() => {
        const seat = dash?.querySelector<HTMLElement>('#status .stage canvas');
        const to = seat?.getBoundingClientRect();
        if (!seat || !to || to.width === 0) return;
        ghost = { x: to.left, y: to.top, scale: Math.max(1, Math.round(to.width / 48)) };
        seat.style.visibility = 'hidden';
        void tick().then(() => {
          ghostEl?.animate(
            [
              {
                transform: `translate(${from.x - to.left}px, ${from.y - to.top}px) scale(${from.size / to.width})`,
              },
              { transform: 'none' },
            ],
            { duration: WALK_MS, easing: 'cubic-bezier(0.3, 0.1, 0.2, 1)', fill: 'both' },
          );
        });
        timers.push(
          setTimeout(() => {
            seat.style.visibility = '';
            ghost = null;
          }, WALK_MS + 20),
        );
      });
    }

    const total = FIRST_MS + wins.length * STEP_MS + IN_MS;
    timers.push(
      setTimeout(() => {
        entering = false;
        wins.forEach(({ el }) => el.style.removeProperty('--i'));
        app.clearEntrance();
      }, total + 40),
    );
    timers.push(setTimeout(() => (settled = true), total + GUIDE_AFTER_MS));
    return () => {
      timers.forEach(clearTimeout);
      const seat = dash?.querySelector<HTMLElement>('#status .stage canvas');
      if (seat) seat.style.visibility = '';
      app.clearEntrance();
    };
  });
</script>

<!--
  좁은 화면: 한 열(칸 순서는 grid-template-areas가 정한다)
  두 열(720~1099px): [상태창·정년·생애 봉급·다가오는 일정] [오늘·승급·연가·지갑]. 열 묶음(.col)이 각자 위에서부터 쌓여
    창 높이가 달라도 빈틈이 생기지 않는다. 키가 큰 생애 봉급이 있는 왼쪽 열에 낮은 일정을, 오른쪽 열에 높은 지갑을 두어
    두 열의 끝을 맞춘다(responsive.spec 의 '열 끝 차이' 검사).
  세 열(1100px~): [상태창·정년·생애 봉급] [오늘·승급·연가] [지갑·다가오는 일정]
-->
<p class="sr-only" role="status" id="home-arrived">{arrived}</p>
{#if ghost}
  <!-- 부화 무대에서 상태창으로 옮겨 가는 호봉이(장식. 닿으면 상태창의 그림이 이어받는다) -->
  <div
    class="walker"
    aria-hidden="true"
    bind:this={ghostEl}
    style="left:{ghost.x}px;top:{ghost.y}px"
  >
    <Sprite look={view.look} scale={ghost.scale} animate={false} />
  </div>
{/if}
<RecapHint />
<div class="dash" class:entering bind:this={dash}>
  <div class="col c1">
    <div class="col c1a">
      <!-- 임용정보 패키지 안내는 상태창 안, 호봉이 무대 바로 아래에 끼운다(휴대폰 첫 화면에서도 보이게) -->
      <div class="status-cell">
        <StatusWindow>
          {#snippet nudge()}
            {#if settled}<PackageCard />{/if}
          {/snippet}
        </StatusWindow>
      </div>
      <CareerWindow />
      <!-- 정년까지의 길(날짜 진행률) 바로 아래에 생애 봉급(금액 진행률): 두 막대를 견줘 본다 -->
      <LifetimeWindow />
    </div>
    <div class="col c1b"><UpcomingWindow /></div>
  </div>
  <div class="col c2">
    <div class="col c2a">
      <TodayWindow />
      <GrowthWindow />
      <LeaveMini />
    </div>
    <div class="col c2b"><WalletWindow /></div>
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
      'lifetime'
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
  /*
    차례 등장: 창마다 120ms 씩 늦게, 아래에서 올라오며 나타난다. 움직임 줄이기면 이 클래스를 붙이지 않는다.
    상태창(맨 먼저)은 올라오지 않고 제자리에서 자라난다(호봉이가 그 안으로 걸어 들어온다).
  */
  @keyframes win-in {
    from {
      opacity: 0;
      transform: translateY(18px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes win-grow {
    from {
      opacity: 0;
      transform: scale(0.94);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes part-in {
    from {
      opacity: 0;
      transform: translateY(9px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .dash.entering :global(.win) {
    animation: win-in 400ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: calc(160ms + var(--i, 0) * 120ms);
  }
  .dash.entering :global(#status) {
    animation-name: win-grow;
    animation-delay: 0ms;
    transform-origin: 50% 180px;
  }
  /* 상태창 안쪽: 말풍선 → 이름판·호봉 → 깃 막대 → 승급 막대 순서로 */
  .dash.entering :global(#status .bubble),
  .dash.entering :global(#status .info > *) {
    animation: part-in 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
    animation-delay: 420ms;
  }
  .dash.entering :global(#status .info > :nth-child(1)) {
    animation-delay: 540ms;
  }
  .dash.entering :global(#status .info > :nth-child(2)) {
    animation-delay: 680ms;
  }
  .dash.entering :global(#status .info > :nth-child(3)) {
    animation-delay: 820ms;
  }
  .dash.entering :global(#status .info > :nth-child(n + 4)) {
    animation-delay: 960ms;
  }
  .walker {
    position: fixed;
    z-index: 40;
    line-height: 0;
    pointer-events: none;
    transform-origin: 0 0;
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
    /* 셋째 열은 지갑(.c2b) 위, 다가오는 일정(.c1b) 아래 */
    .c2b {
      grid-column: 3;
      grid-row: 1;
    }
    .c1b {
      grid-column: 3;
      grid-row: 2;
    }
  }
</style>
