<script lang="ts">
  import { nav } from '../lib/app/nav.svelte.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';

  /** 이 횟수만큼 바뀌면 백업을 권한다 */
  const NUDGE_AFTER = 8;
  let dismissed = $state(false);

  const changes = $derived(app.data?.meta.changesSinceBackup ?? 0);
  const neverBackedUp = $derived((app.data?.meta.lastBackupAt ?? null) === null);
  const showNudge = $derived(!dismissed && changes >= NUDGE_AFTER && nav.tab !== 'settings');
</script>

{#if !app.persistent}
  <p class="note warn banner" role="status">
    이 브라우저에서는 저장이 되지 않아요(사생활 보호 창이거나 정책으로 막힘). 창을 닫기 전에 설정에서 데이터를 내려받아 주세요.
  </p>
{:else if app.saveFailed}
  <p class="note warn banner" role="alert">
    방금 바꾼 내용을 저장하지 못했어요(저장 공간 부족 등). 설정에서 데이터를 내려받아 보관해 주세요.
  </p>
{/if}

{#if view.holidayDataMissing}
  <p class="note banner" role="status">
    {view.rules.year}년 공휴일 데이터가 아직 없어 주말만 쉬는 날로 계산하고 있어요. 호봉을 최신 버전으로 바꿔 주세요.
  </p>
{/if}

{#if showNudge}
  <div class="note banner nudge" role="status">
    <p>
      {neverBackedUp ? '아직 데이터를 내려받은 적이 없어요.' : `마지막으로 내려받은 뒤 ${changes}번 바뀌었어요.`}
      업무용 PC는 브라우저 저장소가 지워질 수 있으니 파일로 보관해 두세요.
    </p>
    <div class="btn-row">
      <button type="button" class="btn small primary" onclick={() => nav.go('settings')}>내려받으러 가기</button>
      <button type="button" class="btn small" onclick={() => (dismissed = true)}>나중에</button>
    </div>
  </div>
{/if}

<style>
  .banner {
    margin-bottom: 12px;
  }
  .nudge {
    display: grid;
    gap: 6px;
  }
</style>
