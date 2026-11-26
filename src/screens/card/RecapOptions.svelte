<script lang="ts">
  /** 올해 결산 카드에 담을 것. 이 탭에서만 기억한다(저장하지 않는다) */
  import { session } from '../../lib/app/session.svelte.ts';
  import type { YearRecap } from '../../lib/calc/recap.ts';

  interface Props {
    recap: YearRecap;
    hideAmounts: boolean;
    holidaysKnown: boolean;
  }

  let { recap, hideAmounts, holidaysKnown }: Props = $props();
</script>

<fieldset class="stack">
  <legend class="muted">결산에 담을 것</legend>
  <label class="switch">
    <input
      type="checkbox"
      checked={session.recapCalendar}
      onchange={(e) => (session.recapCalendar = e.currentTarget.checked)}
    />
    <span class="box" aria-hidden="true"></span>
    <span>1년 달력 <span class="cap muted">들른 날·연가를 도트로 보여요</span></span>
  </label>
  <label class="switch">
    <input
      type="checkbox"
      checked={session.recapSalary}
      onchange={(e) => (session.recapSalary = e.currentTarget.checked)}
    />
    <span class="box" aria-hidden="true"></span>
    <span>
      올해 번 봉급(봉급표 기준 추정치) <span class="cap muted">금액이 그대로 보여요</span>
    </span>
  </label>
  {#if hideAmounts && session.recapSalary}
    <p class="cap muted" id="recap-amount-masked">
      금액 가리기가 켜져 있어 미리보기에서는 금액을 가려요. 저장·복사할 때 한 번 더 물어봐요.
    </p>
  {/if}
  <p class="cap muted">
    결산은 1월 1일(올해 임용이면 임용일)부터 오늘까지예요. 날짜를 하루까지 적지 않아 임용일이
    드러나지 않게 했어요. 승급은 지금 직급 기준으로 거슬러 센 값이에요.{recap.salaryTableYear !==
    recap.year
      ? ` 번 봉급은 ${recap.salaryTableYear}년 봉급표로 계산해요.`
      : ''}{holidaysKnown
      ? ''
      : ` ${recap.year}년 공휴일이 아직 반영되지 않아 근무일은 주말만 뺀 값이에요.`}
  </p>
</fieldset>

<style>
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 3px;
  }
</style>
