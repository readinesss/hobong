<script lang="ts">
  import { nav } from '../lib/app/nav.svelte.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { focusAfterDismiss } from '../lib/app/dismiss.ts';
  import { session } from '../lib/app/session.svelte.ts';
  import { formatKorean } from '../lib/calc/date.ts';
  import DismissButton from '../lib/ui/DismissButton.svelte';

  /** 이 횟수만큼 바뀌면 백업을 권한다 */
  const NUDGE_AFTER = 8;
  let dismissed = $state(false);

  const changes = $derived(app.data?.meta.changesSinceBackup ?? 0);
  const neverBackedUp = $derived((app.data?.meta.lastBackupAt ?? null) === null);
  const showNudge = $derived(!dismissed && changes >= NUDGE_AFTER && nav.tab !== 'settings');

  // 알리기만 하는 띠는 닫을 수 있다(이 탭에서만 기억). 내용이 바뀌면 키가 바뀌어 다시 보인다.
  // 데이터를 지키는 띠(다른 탭·저장 막힘·저장 실패)는 닫을 수 없다.
  const profileKey = $derived(`profile:${view.profileIssues.join('|')}`);
  const retiredKey = $derived(`retired:${view.retire.retireDate}`);
  const holidaysKey = $derived(`holidays:${view.rules.year}`);
  const showProfile = $derived(view.profileIssues.length > 0 && !session.isDismissed(profileKey));
  const showRetired = $derived(view.retired && !session.isDismissed(retiredKey));
  const showHolidays = $derived(view.holidayDataMissing && !session.isDismissed(holidaysKey));

  function close(key: string) {
    session.dismiss(key);
    void focusAfterDismiss();
  }
</script>

{#if app.staleNotice}
  <div class="note warn banner stack" role="alert" id="notice-stale">
    <p>{app.staleNotice}</p>
    <div class="btn-row">
      <button type="button" class="btn small primary" onclick={() => location.reload()}>
        새로 고침
      </button>
    </div>
  </div>
{:else if !app.persistent}
  <p class="note warn banner" role="status">
    이 브라우저에서는 저장이 되지 않아요(사생활 보호 창이거나 정책으로 막힘). 창을 닫기 전에
    설정에서 데이터를 내려받아 주세요.
  </p>
{:else if !app.writable}
  <p class="note warn banner" role="alert">
    저장 공간이 가득 찼거나 쓰기가 막혀 있어 바꾼 내용이 저장되지 않아요. 설정에서 데이터를 내려받아
    보관해 주세요.
  </p>
{:else if app.saveFailed}
  <p class="note warn banner" role="alert">
    방금 바꾼 내용을 저장하지 못했어요(저장 공간 부족 등). 설정에서 데이터를 내려받아 보관해 주세요.
  </p>
{/if}

{#if showProfile}
  <div class="note banner stack" role="status" id="notice-profile">
    <div class="row">
      <p class="grow">내 정보 중 확인이 필요한 값이 있어요. PC의 날짜·시각이 맞는지도 봐 주세요.</p>
      <DismissButton label="내 정보 점검 안내 닫기" onclick={() => close(profileKey)} />
    </div>
    <ul class="issues">
      {#each view.profileIssues as issue (issue)}
        <li>{issue}</li>
      {/each}
    </ul>
    <div class="btn-row">
      <button
        type="button"
        class="btn small"
        onclick={() => {
          nav.editProfileRequested = true;
          nav.go('settings');
        }}
      >
        내 정보 고치기
      </button>
    </div>
  </div>
{/if}

{#if showRetired}
  <div class="note banner row" role="status" id="notice-retired">
    <p class="grow">
      정년퇴직일({formatKorean(view.retire.retireDate, false)})이 지났어요. 호봉·봉급·재직기간은
      퇴직일 기준에서 멈춰 있어요. 그동안 수고 많으셨어요.
    </p>
    <DismissButton label="정년 안내 닫기" onclick={() => close(retiredKey)} />
  </div>
{/if}

{#if showHolidays}
  <div class="note warn banner row" role="status" id="notice-holidays">
    <p class="grow">
      {view.rules.year}년 공휴일 데이터가 아직 없어 주말만 쉬는 날로 계산하고 있어요. 지금 연 호봉
      앱이 옛 버전이에요. 새 hobong.html을 받아 열거나, 온라인이라면 새로 고침해 주세요.
    </p>
    <DismissButton label="공휴일 안내 닫기" onclick={() => close(holidaysKey)} />
  </div>
{/if}

{#if showNudge}
  <div class="note banner nudge" role="status">
    <p>
      {neverBackedUp
        ? '아직 데이터를 내려받은 적이 없어요.'
        : `마지막으로 내려받은 뒤 ${changes}번 바뀌었어요.`}
      업무용 PC는 브라우저 저장소가 지워질 수 있으니 파일로 보관해 두세요.
    </p>
    <div class="btn-row">
      <button type="button" class="btn small primary" onclick={() => nav.go('settings')}>
        내려받으러 가기
      </button>
      <button
        type="button"
        class="btn small"
        onclick={() => {
          dismissed = true;
          void focusAfterDismiss();
        }}
      >
        나중에
      </button>
    </div>
  </div>
{/if}

<style>
  .banner {
    margin-bottom: 12px;
  }
  .issues {
    margin: 0;
    padding-left: 1.2em;
    list-style: disc;
  }
  .nudge {
    display: grid;
    gap: 6px;
  }
  /* 글과 닫기 버튼을 한 줄에 두되 겹치지 않게(버튼은 오른쪽 위) */
  .row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .row .grow {
    min-width: 0;
  }
</style>
