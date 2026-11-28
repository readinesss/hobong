<script lang="ts">
  /**
   * 호봉이 돌려 보기(#22) 큰 창. 홈 상태창·호봉이 꾸미기·도감에서 연다.
   * 배율은 창에 들어가는 가장 큰 정수배(2~6): 360px 폭은 4배(256px), 넓은 화면은 6배(384px).
   */
  import { onMount } from 'svelte';
  import type { Look } from '../character/look.ts';
  import Hobong360 from './Hobong360.svelte';
  import Modal from './Modal.svelte';

  interface Props {
    look: Look;
    /** 호봉이 이름(형태·꾸미기). 낭독과 창 안 글에 쓴다 */
    label: string;
    /** 창 제목 아래 한 줄(어느 모습을 보는지: 꾸미는 중인 모습, 도감의 모습 등) */
    caption?: string;
    onclose: () => void;
  }

  let { look, label, caption, onclose }: Props = $props();

  /**
   * 창 너비(대화상자 여백·본문 여백·무대 테두리 빼고)와 높이(창 위아래 여백·제목·방향 글·단추·안내·아래 줄 빼고)에
   * 들어가는 가장 큰 정수배. 높이 몫(330)은 360×560 에서 잰 창 바깥 높이(무대 빼고 약 320px)에 조금 더 얹은 값
   */
  function fit(): { scale: number; wide: boolean } {
    if (typeof window === 'undefined') return { scale: 4, wide: false };
    const w = window.innerWidth;
    const h = window.innerHeight;
    const wide = w >= 700;
    const roomW = Math.min(wide ? 640 : 420, w - 24) - 36;
    const roomH = h - 330;
    return {
      scale: Math.max(2, Math.min(6, Math.floor(roomW / 64), Math.floor(roomH / 64))),
      wide,
    };
  }

  // 첫 배율을 처음부터 정한다(마운트 뒤에 바꾸면 캔버스·WebGL 컨텍스트를 한 번 더 만든다)
  const first = fit();
  let scale = $state(first.scale);
  let wide = $state(first.wide);

  onMount(() => {
    const update = () => {
      const next = fit();
      scale = next.scale;
      wide = next.wide;
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  });
</script>

<Modal title="호봉이 돌려 보기" icon="icon-turn" {wide} {onclose}>
  {#if caption}<p class="cap muted caption">{caption}</p>{/if}
  <Hobong360 {look} {scale} {label} />
  {#snippet actions()}
    <button type="button" class="btn" onclick={onclose} data-autofocus>닫기</button>
  {/snippet}
</Modal>

<style>
  .caption {
    margin: 0;
    text-align: center;
  }
</style>
