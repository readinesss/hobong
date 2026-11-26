<script lang="ts">
  import CareerWindow from './home/CareerWindow.svelte';
  import GrowthWindow from './home/GrowthWindow.svelte';
  import LeaveMini from './home/LeaveMini.svelte';
  import StatusWindow from './home/StatusWindow.svelte';
  import TodayWindow from './home/TodayWindow.svelte';
  import UpcomingWindow from './home/UpcomingWindow.svelte';
  import WalletWindow from './home/WalletWindow.svelte';
</script>

<!--
  좁은 화면: 한 열(칸 순서는 grid-template-areas가 정한다)
  두 열(720~1099px): [상태창·정년·지갑] [오늘·승급·연가·다가오는 일정]. 열 묶음(.col)이 각자 위에서부터 쌓여
    창 높이가 달라도 빈틈이 생기지 않는다.
  세 열(1100px~): [상태창·정년] [오늘·승급·연가] [지갑·다가오는 일정]
-->
<div class="dash">
  <div class="col c1">
    <div class="col c1a">
      <StatusWindow />
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
