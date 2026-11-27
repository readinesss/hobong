<script lang="ts">
  /**
   * '로그인·정보 저장은 준비 중'이라는 한마디와 호봉 알리기 버튼.
   * - 한마디(wit)는 임용정보 패키지를 내려받거나 불러오는 자리(홈 안내·설정·불러오기 창)에 둔다.
   *   약속이 아니다: 기한을 말하지 않고 '준비 중'이라고만 한다(문구는 data/talk.json wit).
   * - 알리기 권유는 써 본 뒤의 자리에만 둔다: 패키지를 받은 뒤(홈 안내)·설정·카드 화면.
   *   첫 화면에서도 열리는 불러오기 창에는 권하지 않는다(아직 써 보기 전이다 — share={false}).
   *   권유 문장은 한마디와 짝을 이뤄 이어 읽힌다(talk.json share.leads, 같은 차례).
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
    /** '준비 중' 한마디를 보일지(카드 화면처럼 패키지와 상관없는 자리에서는 끈다) */
    wit?: boolean;
    /** 알리기 권유와 버튼을 보일지 */
    share?: boolean;
    /** 권유 문장을 바꾼다(주지 않으면 한마디와 짝인 문장) */
    lead?: string;
  }

  let {
    variant = 0,
    inline = false,
    wit: showWit = true,
    share: showShare = true,
    lead,
  }: Props = $props();
  const wit = $derived(pickLine(TALK.wit, variant));
  const ask = $derived(lead ?? pickLine(TALK.share.leads, variant));
  let result = $state('');
  let busy = $state(false);

  async function tell() {
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
  {#if showWit}
    <p class="cap wit">
      <Icon name="icon-egg" />
      <span>{wit}</span>
    </p>
  {/if}
  {#if showShare}
    <p class="cap ask">{ask} <span class="muted">{TALK.share.fine}</span></p>
    <div class="btn-row">
      <button type="button" class="btn small" onclick={tell} disabled={busy}>
        <Icon name="icon-share" />
        {TALK.share.button}
      </button>
    </div>
    {#if inline}<p class="cap" role="status">{result}</p>{/if}
  {/if}
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
