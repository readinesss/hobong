<script lang="ts">
  /**
   * 제안·문의(#28). 주소는 data/site.json 의 contactEmail 에서 읽는다. 비어 있으면 '준비 중'만 보인다.
   * 앱은 아무것도 보내지 않는다: 주소를 보여 주고 복사하게 하거나, 사용자의 메일 프로그램을 연다.
   * 메일 쓰기 링크에는 앱 버전·규정 데이터 연도만 넣고 사용자가 입력한 값은 넣지 않는다.
   */
  import { copyText } from '../../lib/app/files.ts';
  import { app, APP_VERSION } from '../../lib/app/state.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean } from '../../lib/calc/date.ts';
  import { CONTACT_EMAIL, mailtoHref } from '../../lib/site.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Win from '../../lib/ui/Win.svelte';

  /** 숫자가 틀려 보일 때 함께 보내면 좋은 정보(개인정보 없음) */
  const appInfo = $derived(
    `호봉 ${APP_VERSION} · 규정 데이터 ${view.rules.year}년(확인 ${formatKorean(view.rules.meta.verifiedAt, false)})`,
  );
  const mailto = $derived(
    CONTACT_EMAIL ? mailtoHref(CONTACT_EMAIL, '[호봉] ', `\n\n---\n${appInfo}`) : null,
  );

  async function copyAddress() {
    if (!CONTACT_EMAIL) return;
    if (await copyText(CONTACT_EMAIL)) app.toast('메일 주소를 복사했어요.', 'good', 'icon-copy');
    else app.toast('복사하지 못했어요. 주소를 길게 눌러 골라 주세요.', 'warn', 'icon-warn');
  }

  async function copyInfo() {
    if (await copyText(appInfo)) app.toast('앱 정보를 복사했어요.', 'good', 'icon-copy');
    else app.toast('복사하지 못했어요. 글자를 길게 눌러 골라 주세요.', 'warn', 'icon-warn');
  }
</script>

<Win title="제안·문의" icon="icon-mail" id="set-contact">
  <div class="stack wide">
    <p>
      더 있었으면 하는 기능, 틀려 보이는 숫자, 불편한 점을 알려 주세요. 하나하나 읽고 다음 판에
      반영할지 살펴봐요.
    </p>
    {#if CONTACT_EMAIL && mailto}
      <div class="stack">
        <div class="kv">
          <span>메일</span>
          <span class="address" id="contact-address">{CONTACT_EMAIL}</span>
        </div>
        <div class="btn-row">
          <a class="btn" href={mailto}>
            <Icon name="icon-mail" /> 메일 쓰기
          </a>
          <button
            type="button"
            class="btn"
            onclick={copyAddress}
            aria-describedby="contact-address"
          >
            <Icon name="icon-copy" /> 주소 복사
          </button>
        </div>
        <p class="cap muted">
          제목 앞에 [제안]·[문의]·[불편]을 붙여 주시면 찾기 쉬워요. 메일 프로그램이 열리지 않으면
          주소를 복사해 쓰던 메일에서 보내 주세요.
        </p>
      </div>
    {:else}
      <p class="muted" id="contact-pending">
        메일 주소를 준비하고 있어요. 주소가 생기면 여기에 보여 드릴게요.
      </p>
    {/if}
    <div class="stack">
      <div class="kv">
        <span>앱 정보</span>
        <span class="cap">{appInfo}</span>
      </div>
      <div class="btn-row">
        <button type="button" class="btn small" onclick={copyInfo}>
          <Icon name="icon-copy" /> 앱 정보 복사
        </button>
      </div>
      <p class="cap muted">
        숫자가 틀려 보이면 앱 정보를 함께 보내 주세요. 개인 정보는 들어 있지 않아요.
      </p>
    </div>
    <ul class="facts">
      <li>
        <Icon name="icon-user" />
        <span class="cap">
          실명·소속·연락처 같은 개인정보는 적지 않아도 돼요. 업무용 메일로 보내면 소속이 드러날 수
          있어요.
        </span>
      </li>
      <li>
        <Icon name="icon-info" />
        <span class="cap">
          호봉은 정부나 기관의 공식 서비스가 아니에요. 보수·인사에 관한 민원이나 공식 문의는 소속
          기관의 인사·급여 담당에게 해 주세요.
        </span>
      </li>
    </ul>
  </div>
</Win>

<style>
  .address {
    overflow-wrap: anywhere;
    user-select: all;
  }
  .facts {
    display: grid;
    gap: 9px;
  }
  .facts li {
    display: flex;
    gap: 9px;
    align-items: flex-start;
  }
</style>
