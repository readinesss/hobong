<script lang="ts">
  import './app.css';
  import { onMount, untrack } from 'svelte';
  import { freshAchievements } from './lib/achievements.ts';
  import { anim } from './lib/app/anim.svelte.ts';
  import { theme } from './lib/app/theme.svelte.ts';
  import { clock } from './lib/app/clock.svelte.ts';
  import { nav, TABS, type TabId } from './lib/app/nav.svelte.ts';
  import { app } from './lib/app/state.svelte.ts';
  import { view } from './lib/app/view.svelte.ts';
  import { trackNameOf } from './lib/app/track.ts';
  import { formatKorean } from './lib/calc/date.ts';
  import { formatDuration } from './lib/calc/today.ts';
  import Icon from './lib/ui/Icon.svelte';
  import Toasts from './lib/ui/Toasts.svelte';
  import Badges from './screens/Badges.svelte';
  import CardMaker from './screens/CardMaker.svelte';
  import Celebration from './screens/Celebration.svelte';
  import Home from './screens/Home.svelte';
  import Leave from './screens/Leave.svelte';
  import Notices from './screens/Notices.svelte';
  import Settings from './screens/Settings.svelte';
  import Welcome from './screens/Welcome.svelte';
  import WelcomeBack from './screens/WelcomeBack.svelte';

  let systemDark = $state(false);
  let systemReduced = $state(false);

  onMount(() => {
    app.init();
    clock.start();
    nav.start();

    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      systemDark = dark.matches;
      systemReduced = reduced.matches;
      anim.systemReduced = reduced.matches;
    };
    sync();
    dark.addEventListener('change', sync);
    reduced.addEventListener('change', sync);

    // 글자를 치는 동안에는 하단 탭을 숨겨, 화면 키보드 위로 탭이 올라와 입력란을 가리지 않게 한다.
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' &&
          !['checkbox', 'radio', 'file', 'button'].includes((el as HTMLInputElement).type)));
    const onFocusIn = (event: FocusEvent) => {
      if (!isTyping(event.target)) return;
      document.documentElement.setAttribute('data-typing', '');
      const el = event.target as HTMLElement;
      if (window.matchMedia('(max-width: 719px)').matches) {
        setTimeout(() => {
          if (document.activeElement === el)
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 320);
      }
    };
    const onFocusOut = () => {
      setTimeout(() => {
        if (!isTyping(document.activeElement))
          document.documentElement.removeAttribute('data-typing');
      }, 60);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    // 키보드: 숫자 1~5로 화면 전환
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!app.data || document.documentElement.hasAttribute('data-modal')) return;
      const target = event.target;
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;
      const index = Number(event.key) - 1;
      const tab = TABS[index];
      if (Number.isInteger(index) && tab) {
        event.preventDefault();
        nav.go(tab.id);
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      dark.removeEventListener('change', sync);
      reduced.removeEventListener('change', sync);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey);
    };
  });

  // 테마(야근 모드)
  const dark = $derived.by(() => {
    const setting = app.data?.settings.theme ?? 'auto';
    return setting === 'dark' || (setting === 'auto' && systemDark);
  });
  $effect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    theme.dark = dark;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#1a1c2c' : '#29366f');
  });

  // 움직임 줄이기
  const reduced = $derived(systemReduced || (app.data?.settings.reduceMotion ?? false));
  $effect(() => {
    if (reduced) document.documentElement.setAttribute('data-motion', 'reduced');
    else document.documentElement.removeAttribute('data-motion');
    anim.setReduced(reduced);
  });

  // 방문 기록(출근 도장)과 복귀 정산
  $effect(() => {
    const today = clock.today;
    if (!app.data) return;
    untrack(() => app.recordVisit(today));
  });

  // 승급 연출
  $effect(() => {
    if (!app.data) return;
    const rank = view.profile.rank;
    const step = view.step;
    const form = view.formId;
    untrack(() => app.checkGrowth(rank, step, form));
  });

  // 도감 등록
  $effect(() => {
    if (!app.data) return;
    const formId = view.look.form.id;
    untrack(() => app.markFormSeen(formId));
  });

  // 업적: 새로 얻은 것을 기록하고 알린다
  $effect(() => {
    if (!app.data) return;
    const earned = view.earned;
    untrack(() => {
      const stored = app.data?.achievements ?? {};
      const fresh = freshAchievements(stored, earned);
      const removed = Object.keys(stored).some((id) => !(id in earned));
      if (fresh.length === 0 && !removed) return;
      app.recordAchievements(earned);
      if (fresh.length > 3) {
        app.toast(
          `배지 ${fresh.length}개를 받았어요. 업적에서 확인해 보세요.`,
          'good',
          'icon-medal',
          5000,
        );
      } else {
        for (const id of fresh) {
          const badge = view.badges.find((b) => b.id === id);
          if (badge) app.toast(`새 배지: ${badge.title}`, 'good', badge.icon, 4500);
        }
      }
    });
  });

  // 탭 제목: 보고 있는 화면 이름을 앞에 붙인다(첫 화면의 제목은 Welcome 이 정한다)
  const TAB_TITLES: Record<TabId, string> = {
    home: '호봉 — 공무원 상태창',
    leave: '연가 장부 · 호봉',
    badges: '업적 · 호봉',
    card: '카드 · 호봉',
    settings: '설정 · 호봉',
  };
  $effect(() => {
    const data = app.data;
    if (!data) return;
    if (data.settings.tabTitle !== 'countdown') {
      document.title = TAB_TITLES[nav.tab];
      return;
    }
    const status = view.status;
    // 하루를 통째로 연가로 쉬는 날에는 퇴근 시각을 세지 않는다
    if (view.leave.todayHours >= view.rules.leave.units.hoursPerDay) {
      document.title = '연가 중 · 호봉';
    } else if (status.workday && status.secondsToEnd !== null) {
      document.title = `퇴근까지 ${formatDuration(status.secondsToEnd).slice(0, -3)} · 호봉`;
    } else {
      document.title = status.workday ? '오늘 근무 끝 · 호봉' : '쉬는 날 · 호봉';
    }
  });

  let mainEl = $state<HTMLElement>();
  function go(tab: TabId) {
    nav.go(tab);
    mainEl?.focus({ preventScroll: true });
  }
</script>

{#if !app.ready}
  <div class="boot" aria-hidden="true"></div>
{:else if !app.data}
  <Welcome />
  <Toasts />
{:else}
  <a class="skip btn primary" href="#main">본문으로 건너뛰기</a>
  <div class="shell">
    <header class="top no-print">
      <div class="brand">
        <Icon name="icon-tiger" scale={2} />
        <div class="stack names">
          <h1>호봉</h1>
          <span class="cap sub">공무원 상태창</span>
        </div>
      </div>
      <span class="tag gold basis" title="규정 데이터 기준 연도">
        {view.salary?.tableYear ?? view.rules.year}년 기준
      </span>
    </header>

    <nav class="tabs no-print" aria-label="화면 이동">
      <ul>
        {#each TABS as tab, i (tab.id)}
          <li>
            <a
              href="#{tab.id}"
              class="tab"
              aria-current={nav.tab === tab.id ? 'page' : undefined}
              onclick={(e) => {
                e.preventDefault();
                go(tab.id);
              }}
            >
              <Icon name={tab.icon} scale={2} />
              <span class="tab-label">{tab.label}</span>
              <kbd class="cap key" aria-hidden="true">{i + 1}</kbd>
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <main id="main" bind:this={mainEl} tabindex="-1">
      <Notices />
      {#if nav.tab === 'home'}
        <Home />
      {:else if nav.tab === 'leave'}
        <Leave />
      {:else if nav.tab === 'badges'}
        <Badges />
      {:else if nav.tab === 'card'}
        <CardMaker />
      {:else}
        <Settings />
      {/if}
      <footer class="foot cap muted">
        <p>
          {view.rules.target.label}
          {view.showIdentityHome ? trackNameOf(view.careerRules) : view.careerRules.track.label} 기준
          · 규정 확인일 {formatKorean(view.rules.meta.verifiedAt, false)} · 공식 인사·급여 시스템의 기록이
          기준이며 이 화면은 참고용이에요.
        </p>
      </footer>
    </main>
  </div>

  <Toasts />
  {#if app.celebration}
    <Celebration event={app.celebration} />
  {:else if app.welcomeBack}
    <WelcomeBack info={app.welcomeBack} />
  {/if}
{/if}

<style>
  .boot {
    min-height: 100vh;
  }
  .skip {
    position: fixed;
    left: 9px;
    top: -80px;
    z-index: 200;
  }
  .skip:focus {
    top: calc(9px + var(--safe-t));
  }
  .shell {
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    grid-template-areas:
      'top'
      'main';
  }
  .top {
    grid-area: top;
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
    padding: calc(6px + var(--safe-t)) calc(12px + var(--safe-r)) 6px calc(12px + var(--safe-l));
    background: var(--title-bg);
    color: var(--title-ink);
    box-shadow: 0 var(--u) 0 0 var(--line);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .names {
    gap: 0;
  }
  .names h1 {
    font-weight: 400;
    line-height: 21px;
  }
  .sub {
    opacity: 0.85;
    line-height: 15px;
  }
  main {
    grid-area: main;
    min-width: 0;
    width: 100%;
    max-width: 1320px;
    margin: 0 auto;
    padding: 12px calc(9px + var(--safe-r)) calc(var(--tabbar-h) + var(--safe-b) + 24px)
      calc(9px + var(--safe-l));
    outline: none;
  }
  .foot {
    margin: 18px 6px 0;
    text-align: center;
  }

  /* 하단 탭(모바일) */
  .tabs {
    position: fixed;
    z-index: 30;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 0 var(--safe-r) var(--safe-b) var(--safe-l);
    background: var(--panel);
    box-shadow: 0 calc(var(--u) * -1) 0 0 var(--line);
  }
  .tabs ul {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .tab {
    position: relative;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 0;
    height: var(--tabbar-h);
    color: var(--ink-2);
    text-decoration: none;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .tab-label {
    font-family: var(--font-cap);
    font-size: 12px;
    line-height: 18px;
  }
  .tab[aria-current='page'] {
    color: var(--ink);
    background: var(--panel-2);
    box-shadow: inset 0 var(--u) 0 0 var(--accent);
  }
  .tab:active {
    background: var(--panel-2);
  }
  .tab:focus-visible {
    outline-offset: -6px;
  }
  .key {
    display: none;
  }
  :global(:root[data-typing]) .tabs {
    display: none;
  }

  /* 옆 레일(태블릿·데스크톱) */
  @media (min-width: 720px) {
    .shell {
      --rail: 84px;
      grid-template-columns: var(--rail) minmax(0, 1fr);
      grid-template-areas:
        'tabs top'
        'tabs main';
    }
    :global(:root) {
      --rail-w: 84px;
    }
    .tabs {
      grid-area: tabs;
      position: sticky;
      top: 0;
      bottom: auto;
      align-self: start;
      height: 100vh;
      height: 100dvh;
      padding: calc(9px + var(--safe-t)) 0 9px var(--safe-l);
      box-shadow: var(--u) 0 0 0 var(--line);
      overflow-y: auto;
    }
    :global(:root[data-typing]) .tabs {
      display: block;
    }
    .tabs ul {
      grid-template-columns: 1fr;
      gap: 3px;
    }
    .tab {
      height: 72px;
    }
    .tab[aria-current='page'] {
      box-shadow: inset var(--u) 0 0 0 var(--accent);
    }
    main {
      padding: 18px calc(18px + var(--safe-r)) 30px 18px;
    }
  }
  @media (min-width: 1100px) {
    .shell {
      --rail: 168px;
    }
    :global(:root) {
      --rail-w: 168px;
    }
    .tab {
      grid-template-columns: auto 1fr auto;
      justify-items: start;
      align-items: center;
      gap: 9px;
      height: 54px;
      padding: 0 12px;
    }
    .tab-label {
      font-family: var(--font-body);
      font-size: 15px;
      line-height: 24px;
    }
    .key {
      display: block;
      padding: 0 6px;
      box-shadow: 0 0 0 var(--u) var(--ink-2);
      opacity: 0.7;
    }
  }
  @media print {
    main {
      padding: 0;
    }
  }
</style>
