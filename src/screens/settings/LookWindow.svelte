<script lang="ts">
  /**
   * 설정 > 호봉이 꾸미기(#17). 지금 모습을 보여 주고, '꾸미기'를 누르면 고르는 창을 연다.
   * 고르는 동안은 저장하지 않고, '바꾸기'를 눌러야 저장한다(설계 onboardingFlow §6).
   */
  import { untrack } from 'svelte';
  import { lookName, sameLook } from '../../lib/character/customize.ts';
  import { resolveLook } from '../../lib/character/look.ts';
  import { characterRules } from '../../lib/character/rules.ts';
  import { nav } from '../../lib/app/nav.svelte.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { defaultLook } from '../../lib/store/defaults.ts';
  import type { CharacterLook } from '../../lib/store/schema.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Modal from '../../lib/ui/Modal.svelte';
  import Sprite from '../../lib/ui/Sprite.svelte';
  import Win from '../../lib/ui/Win.svelte';
  import LookEditor from '../customize/LookEditor.svelte';

  /** 카드처럼 기분·시간대와 상관없는 근무 중 모습 */
  const current = $derived(
    resolveLook(characterRules, view.formId, view.step, 'work', view.characterLook, view.propOwner),
  );
  const currentName = $derived(lookName(characterRules, current));

  let editing = $state(false);
  let draft = $state<CharacterLook>(defaultLook());
  /** 고르는 창을 연 때의 app.dataGeneration(그 사이 다른 탭의 값을 따라갔으면 고른 것으로 덮지 않는다) */
  let base = 0;

  function open() {
    const saved = view.characterLook;
    draft = { ...saved, deco: { ...saved.deco } };
    base = untrack(() => app.dataGeneration);
    editing = true;
  }
  function close() {
    editing = false;
  }
  // 홈 안내 창의 [호봉이 꾸미기]로 들어오면 고르는 창을 바로 연다
  $effect(() => {
    if (nav.lookRequested) {
      nav.lookRequested = false;
      open();
    }
  });
  function save() {
    // 고른 것이 저장값과 같으면 저장하지 않는다(백업 뒤 바뀐 횟수를 늘리지 않게)
    if (sameLook(draft, view.characterLook)) {
      close();
      app.toast('바뀐 것이 없어요.', 'info', 'icon-check');
      return;
    }
    // 다른 탭이 바꾼 데이터를 따라가느라 버렸으면(창을 연 뒤 storage 이벤트·포커스로 먼저 따라갔어도) app 이
    // 알린다(다시 열면 바뀐 모습으로 시작한다)
    const kept = app.updateLook(draft, base);
    close();
    if (kept) app.toast('호봉이 모습을 바꿨어요.', 'good', 'icon-check');
  }
</script>

<Win title="호봉이 꾸미기" icon="icon-feather" id="set-look">
  <div class="stack wide">
    <div class="row">
      <span class="pic">
        <Sprite look={current} scale={2} animate={false} label={currentName} />
      </span>
      <p class="cap" aria-hidden="true">{currentName}</p>
    </div>
    <p class="cap muted">
      몸 색·볏·깃·작은 장식·손에 드는 소품을 고를 수 있어요. 홈·도감·카드·연출에 모두 같은 모습으로
      나와요.
    </p>
    <div class="btn-row">
      <button type="button" class="btn" onclick={open}>
        <Icon name="icon-pencil" /> 꾸미기
      </button>
    </div>
  </div>
</Win>

{#if editing}
  <Modal title="호봉이 꾸미기" icon="icon-feather" wide xwide onclose={close}>
    <LookEditor bind:look={draft} formId={view.formId} step={view.step} owner={view.propOwner} />
    {#snippet actions()}
      <p class="cap muted hint">고른 모습은 '바꾸기'를 눌러야 저장돼요.</p>
      <button type="button" class="btn" onclick={close}>취소</button>
      <button type="button" class="btn primary" onclick={save}>
        <Icon name="icon-check" /> 바꾸기
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .row p {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .pic {
    flex: none;
    display: block;
    line-height: 0;
    background: var(--stage);
    box-shadow: var(--frame);
    margin: var(--u);
  }
  .hint {
    flex: 1 1 100%;
  }
</style>
