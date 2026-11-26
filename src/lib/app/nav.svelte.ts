/** 화면(탭) 전환. 주소의 #조각으로 기억해 새로 고쳐도 같은 탭이 열린다. */

export const TABS = [
  { id: 'home', label: '홈', icon: 'icon-home' },
  { id: 'leave', label: '연가', icon: 'icon-palm' },
  { id: 'badges', label: '업적', icon: 'icon-medal' },
  { id: 'card', label: '카드', icon: 'icon-camera' },
  { id: 'settings', label: '설정', icon: 'icon-gear' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

function fromHash(hash: string): TabId {
  const id = hash.replace(/^#\/?/, '');
  return TABS.some((t) => t.id === id) ? (id as TabId) : 'home';
}

class Nav {
  tab = $state<TabId>('home');
  /** 설정 화면을 열면서 '내 정보 고치기' 대화상자도 바로 열어 달라는 요청(안내 띠의 버튼) */
  editProfileRequested = $state(false);
  /** 연가 화면을 열면서 '부여 일수' 대화상자도 바로 열어 달라는 요청(홈 연가 창의 [부여 일수 넣기]) */
  editGrantRequested = $state(false);

  start(): void {
    this.tab = fromHash(location.hash);
    window.addEventListener('hashchange', () => {
      this.tab = fromHash(location.hash);
    });
  }

  go(tab: TabId): void {
    this.tab = tab;
    const hash = `#${tab}`;
    if (location.hash !== hash) {
      try {
        history.replaceState(null, '', hash);
      } catch {
        // file:// 등에서 막히면 주소는 그대로 둔다
      }
    }
    window.scrollTo({ top: 0 });
  }
}

export const nav = new Nav();
