<script lang="ts">
  import { app } from '../lib/app/state.svelte.ts';
  import { clock } from '../lib/app/clock.svelte.ts';
  import { yearOf } from '../lib/calc/date.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { rulesFor } from '../lib/rules/index.ts';
  import type { Profile } from '../lib/store/schema.ts';
  import Icon from '../lib/ui/Icon.svelte';
  import Sprite from '../lib/ui/Sprite.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import ProfileForm from './ProfileForm.svelte';

  let step = $state<'intro' | 'form'>('intro');
  let importing = $state(false);
  let dropped = $state<File | null>(null);
  let dragging = $state(false);

  const rules = $derived(rulesFor(yearOf(clock.today)));

  function create(profile: Profile, payday: number) {
    app.createProfile(profile, { payday });
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      dropped = file;
      importing = true;
    }
  }
</script>

<main
  class="welcome"
  class:dragging
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (e.target === e.currentTarget) dragging = false;
  }}
  ondrop={onDrop}
>
  <div class="inner">
    {#if step === 'intro'}
      <section class="win hero">
        <header class="win-title">
          <Icon name="icon-tiger" />
          <h1>호봉 — 공무원 상태창</h1>
          <span class="aside cap">{rules.meta.sectionYear.salary}년 기준</span>
        </header>
        <div class="win-body stack wide">
          <div class="stage">
            <Sprite
              sprite={characterRules.egg}
              frame={0}
              scale={4}
              label="아직 깨어나지 않은 호봉이의 알"
            />
          </div>
          <div class="stack">
            <p class="lead">호봉이 오르면 자라는 <span class="nowrap">아기 봉황 "호봉이"</span></p>
            <p class="muted">
              호봉·월급·승급일·연가·정년을 한 화면에서 확인하세요. 임용일을 넣으면 알에서 호봉이가
              깨어납니다.
            </p>
          </div>

          {#if app.corruptNotice}
            <div class="note warn" role="alert">
              <p>이 브라우저에 있던 데이터를 읽지 못했어요. ({app.corruptNotice})</p>
              <p>내려받아 둔 백업 파일이 있다면 "데이터 불러오기"로 이어서 쓸 수 있어요.</p>
            </div>
          {/if}

          <div class="choices">
            <button type="button" class="btn primary choice" onclick={() => (step = 'form')}>
              <Icon name="icon-egg" scale={2} />
              <span>새로 시작</span>
            </button>
            <button type="button" class="btn choice" onclick={() => (importing = true)}>
              <Icon name="icon-upload" scale={2} />
              <span>데이터 불러오기</span>
            </button>
          </div>
          <p class="cap muted center">백업 파일을 이 화면에 끌어다 놓아도 돼요.</p>

          <ul class="facts cap">
            <li>
              <Icon name="icon-shield" /> 서버가 없어요. 입력한 내용은 이 브라우저에만 저장돼요.
            </li>
            <li>
              <Icon name="icon-lock" /> 외부로 나가는 통신이 없어요. 인터넷이 막힌 업무망에서도 그대로
              동작해요.
            </li>
            <li><Icon name="icon-user" /> 실명·소속은 묻지 않아요. 닉네임만 받아요.</li>
            <li><Icon name="icon-book" /> 금액은 봉급표 기준 추정치이며 실수령액과 달라요.</li>
          </ul>
          {#if !app.persistent}
            <p class="note warn">
              이 브라우저는 저장소를 쓸 수 없는 상태예요(사생활 보호 창이거나 정책으로 막힘). 창을
              닫으면 내용이 사라지니 데이터 내려받기로 보관해 주세요.
            </p>
          {/if}
        </div>
      </section>
    {:else}
      <section class="win">
        <header class="win-title">
          <Icon name="icon-pencil" />
          <h1>내 정보 넣기</h1>
          <button type="button" class="btn ghost small back" onclick={() => (step = 'intro')}>
            <Icon name="icon-chevron-left" /> 뒤로
          </button>
        </header>
        <div class="win-body">
          <ProfileForm askPayday submitLabel="알 깨우기" onsubmit={create} />
        </div>
      </section>
      <p class="cap muted center foot">
        적용 대상: {rules.target.label}. 입력한 값은 설정에서 언제든 고칠 수 있어요.
      </p>
    {/if}
  </div>
</main>

{#if importing}
  <ImportDialog
    file={dropped}
    onclose={() => {
      importing = false;
      dropped = null;
    }}
  />
{/if}

<style>
  .welcome {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    justify-content: center;
    padding: calc(18px + var(--safe-t)) calc(12px + var(--safe-r)) calc(24px + var(--safe-b))
      calc(12px + var(--safe-l));
  }
  .welcome.dragging {
    outline: 6px dashed var(--accent);
    outline-offset: -12px;
  }
  .inner {
    width: min(480px, 100%);
    margin: auto 0;
  }
  .stage {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    padding: 12px 0 0;
    background: linear-gradient(
      var(--stage) 0 calc(100% - 24px),
      var(--stage-ground) calc(100% - 24px) 100%
    );
    box-shadow: var(--frame);
    margin: var(--u);
  }
  .lead {
    font-size: 15px;
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
  }
  .choice {
    flex-direction: column;
    gap: 6px;
    min-height: 96px;
    padding-top: 12px;
    padding-bottom: 15px;
  }
  .choice:active {
    padding-top: 15px;
    padding-bottom: 12px;
  }
  .facts {
    display: grid;
    gap: 6px;
    color: var(--ink-2);
  }
  .facts li {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .center {
    text-align: center;
  }
  .foot {
    margin-top: 12px;
  }
  .back {
    color: var(--title-ink);
    margin: 0 -6px 0 0;
  }
</style>
