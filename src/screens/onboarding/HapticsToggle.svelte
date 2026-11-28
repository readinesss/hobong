<script lang="ts">
  /**
   * 첫 입력 화면 머리의 진동 단추(말을 거는 첫 입력·한 번에 쓰기가 함께 쓴다: 부록 P4).
   * - 진동을 지원하는 기기에서만 보인다(hapticsSupported).
   * - 움직임 줄이기 중에는 진동이 울리지 않으므로 단추를 숨긴다(켜진 채로 보여 울릴 것처럼 보이지 않게).
   *   고른 값은 그대로 남아 저장할 때 설정으로 들어가고, 설정 화면의 스위치가 같은 까닭을 글로 알린다.
   * - 누르면 이 화면의 진동을 바로 켜고 끈다(setHapticsEnabled). 소리·진동은 신호(emitCue)를 듣는 쪽이 낸다.
   */
  import { anim } from '../../lib/app/anim.svelte.ts';
  import { hapticsSupported, setHapticsEnabled } from '../../lib/app/haptics.ts';
  import { TALK } from '../../lib/talk.ts';
  import Icon from '../../lib/ui/Icon.svelte';

  interface Props {
    /** 진동(이 화면의 토글. 저장할 때 설정으로 들어간다) */
    haptics: boolean;
  }

  let { haptics = $bindable() }: Props = $props();

  const canVibrate = hapticsSupported();
  function toggle() {
    haptics = !haptics;
    setHapticsEnabled(haptics);
  }
</script>

{#if canVibrate && !anim.reduced}
  <button
    type="button"
    class="btn ghost small tool"
    aria-pressed={haptics}
    aria-label="진동"
    title={haptics ? TALK.egg.hapticsOn : TALK.egg.hapticsOff}
    onclick={toggle}
  >
    <Icon name={haptics ? 'icon-vibrate' : 'icon-vibrate-off'} />
  </button>
{/if}

<style>
  .tool {
    flex: none;
    color: var(--title-ink);
  }
  .tool:last-child {
    margin-right: -6px;
  }
</style>
