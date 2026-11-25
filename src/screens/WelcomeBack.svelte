<script lang="ts">
  import { formatDday } from '../lib/app/format.ts';
  import { app, type WelcomeBack } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { formatMonthDay } from '../lib/calc/date.ts';
  import Modal from '../lib/ui/Modal.svelte';
  import Sprite from '../lib/ui/Sprite.svelte';

  interface Props {
    info: WelcomeBack;
  }

  let { info }: Props = $props();
  const since = $derived(view.since(info.since));
  const close = () => app.dismissWelcomeBack();
</script>

<Modal title="다시 만나서 반가워요" icon="icon-tiger" onclose={close}>
  <div class="stack wide">
    <div class="row">
      <Sprite look={view.look} scale={2} animate={false} />
      <p>
        {info.days}일 만이에요, {view.profile.nickname}님. 자리를 비운 사이에도 호봉이는 잘
        지냈어요.
      </p>
    </div>
    <dl class="well stack">
      <div class="kv">
        <dt>마지막으로 들른 날</dt>
        <dd>{formatMonthDay(info.since)}</dd>
      </div>
      <div class="kv">
        <dt>그사이 지나간 근무일</dt>
        <dd class="num">+{since.workdays}일</dd>
      </div>
      {#if since.paydays > 0}
        <div class="kv">
          <dt>지나간 봉급날</dt>
          <dd class="num">{since.paydays}번</dd>
        </div>
      {/if}
      {#if since.raises > 0}
        <div class="kv">
          <dt>오른 호봉</dt>
          <dd class="num">+{since.raises}호봉</dd>
        </div>
      {/if}
      {#if view.nextRaise}
        <div class="kv">
          <dt>다음 승급</dt>
          <dd class="num">{formatDday(view.today, view.nextRaise.date)}</dd>
        </div>
      {/if}
    </dl>
  </div>
  {#snippet actions()}
    <button type="button" class="btn primary" data-autofocus onclick={close}>확인</button>
  {/snippet}
</Modal>

<style>
  dl,
  dt,
  dd {
    margin: 0;
  }
</style>
