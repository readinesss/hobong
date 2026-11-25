<script lang="ts">
  import CareerWindow from './home/CareerWindow.svelte';
  import GrowthWindow from './home/GrowthWindow.svelte';
  import LeaveMini from './home/LeaveMini.svelte';
  import StatusWindow from './home/StatusWindow.svelte';
  import TodayWindow from './home/TodayWindow.svelte';
  import UpcomingWindow from './home/UpcomingWindow.svelte';
  import WalletWindow from './home/WalletWindow.svelte';
</script>

<div class="dash">
  <StatusWindow />
  <TodayWindow />
  <GrowthWindow />
  <WalletWindow />
  <CareerWindow />
  <LeaveMini />
  <UpcomingWindow />
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
  @media (min-width: 720px) {
    .dash {
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas:
        'status today'
        'status growth'
        'wallet career'
        'wallet leave'
        'upcoming upcoming';
    }
  }
  @media (min-width: 1100px) {
    .dash {
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) minmax(0, 1fr);
      grid-template-areas:
        'status today wallet'
        'status growth wallet'
        'career leave upcoming';
    }
  }
</style>
