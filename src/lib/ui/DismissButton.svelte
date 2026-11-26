<script lang="ts">
  /**
   * 알리기만 하는 안내 띠의 닫기 버튼(누르는 영역 44px, 이름 있는 버튼).
   * data-dismiss 는 닫은 뒤 포커스를 옮길 다음 자리를 찾는 표시다(focusAfterDismiss).
   */
  import Icon from './Icon.svelte';

  interface Props {
    /** 화면 낭독기·툴팁에 쓰는 이름. 예: '정년 안내 닫기' */
    label: string;
    onclick: () => void;
    /** 띠의 오른쪽 위 구석에 붙인다(띠 안쪽 여백을 조금 덜어 쓴다). 버튼 줄 안에 둘 때는 false */
    corner?: boolean;
  }

  let { label, onclick, corner = true }: Props = $props();
</script>

<button
  type="button"
  class="btn small ghost dismiss"
  class:corner
  data-dismiss
  aria-label={label}
  title={label}
  {onclick}
>
  <Icon name="icon-close" />
</button>

<style>
  .dismiss {
    flex: none;
  }
  .corner {
    align-self: flex-start;
    /* 띠 안쪽 여백(9px)을 조금 덜어 오른쪽 위 구석에 붙인다. 누르는 영역은 그대로 44px */
    margin: -6px -6px 0 0;
  }
  /* 고대비에서는 ghost 버튼의 테두리가 지워지므로 실제 선으로 다시 그린다 */
  @media (forced-colors: active) {
    .btn.ghost.dismiss {
      border-color: ButtonText;
    }
  }
</style>
