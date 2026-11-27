<script lang="ts">
  /**
   * '로그인·정보 저장은 준비 중'이라는 한마디와 호봉 알리기 버튼.
   * 임용정보 패키지를 내려받거나 불러오는 자리(홈 안내 창·설정·불러오기 창)에 함께 둔다.
   * - 약속이 아니다: 기한을 말하지 않고 '준비 중'이라고만 한다(문구는 data/talk.json wit).
   * - 알리기는 사이트 주소만 전한다. 닉네임·입력값·계산값은 싣지 않는다(src/lib/app/share.ts).
   */
  import { SHARE_URL, shareSite } from '../../lib/app/share.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { fillLine, pickLine, TALK } from '../../lib/talk.ts';
  import Icon from '../../lib/ui/Icon.svelte';

  interface Props {
    /** 한마디 고르기(자리마다 다른 문장이 나오게) */
    variant?: number;
    /** 결과를 알림 대신 이 칸 안에 적는다(대화상자 안에서는 알림이 가려질 수 있다) */
    inline?: boolean;
  }

  let { variant = 0, inline = false }: Props = $props();
  const wit = $derived(pickLine(TALK.wit, variant));
  let result = $state('');
  let busy = $state(false);

  async function share() {
    if (busy) return;
    busy = true;
    const outcome = await shareSite(TALK.share.title, TALK.share.text);
    busy = false;
    if (outcome === 'cancelled') return;
    const text =
      outcome === 'shared'
        ? TALK.share.shared
        : outcome === 'copied'
          ? TALK.share.copied
          : fillLine(TALK.share.failed, { url: SHARE_URL });
    if (inline) result = text;
    else app.toast(text, outcome === 'failed' ? 'warn' : 'good', 'icon-share', 5000);
  }
</script>

<div class="share-note stack">
  <p class="cap wit">
    <Icon name="icon-egg" />
    <span>{wit}</span>
  </p>
  <p class="cap muted">{TALK.share.lead} {TALK.share.fine}</p>
  <div class="btn-row">
    <button type="button" class="btn small" onclick={share} disabled={busy}>
      <Icon name="icon-share" />
      {TALK.share.button}
    </button>
  </div>
  {#if inline}<p class="cap" role="status">{result}</p>{/if}
</div>

<style>
  .wit {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .wit span {
    min-width: 0;
  }
</style>
