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
  넓은 화면: 열 묶음(.col)이 각자 위에서부터 쌓여, 창 높이가 달라도 빈틈이 생기지 않는다
-->
<div class="dash">
  <div class="col c1">
    <StatusWindow />
    <CareerWindow />
  </div>
  <div class="col c2">
    <TodayWindow />
    <GrowthWindow />
    <LeaveMini />
  </div>
  <div class="col c3">
    <WalletWindow />
    <UpcomingWindow />
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
    .col {
      display: grid;
      gap: 12px;
      min-width: 0;
      align-content: start;
    }
    .col :global(.win) {
      grid-area: auto !important;
    }
    .c3 {
      grid-column: 1 / -1;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }
  }
  @media (min-width: 1100px) {
    .dash {
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) minmax(0, 1fr);
    }
    .c3 {
      grid-column: auto;
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
