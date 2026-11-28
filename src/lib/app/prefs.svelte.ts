/**
 * 이 기기에서만 기억하는 편의 값(localStorage 'hobong.prefs'). 사용자 데이터(hobong.data)와 따로 둔다:
 * 임용정보 패키지에 담기지 않고, 다른 기기로 옮겨 가지 않으며, 입력값은 하나도 들어가지 않는다.
 *
 * - onboardMode: 첫 입력을 어떤 방식으로 했는지('talk' 하나씩 묻기 / 'form' 한 번에 쓰기). 다음에 같은 방식으로 연다.
 * - packageGuide: 임용정보 패키지 안내 창의 상태.
 *   'pending' 첫 입력을 마쳐 안내를 보일 차례 / 'later' '나중에'를 눌렀다(다시 묻지 않는다) / 'done' 받았다.
 *   값이 없으면(예전부터 쓰던 사람·패키지로 이어한 사람) 안내 창을 띄우지 않는다.
 * - turnAuto: 호봉이 돌려 보기(#22)에서 자동 회전을 켜 두었는지. 값이 없으면 켠다(움직임 줄이기에서는 늘 끈다).
 *
 * 저장소를 쓸 수 없으면(사생활 보호 창·정책) 이 탭의 메모리에만 둔다. 읽기·쓰기 실패는 조용히 넘긴다.
 */
export const PREFS_KEY = 'hobong.prefs';

export type OnboardMode = 'talk' | 'form';
export type PackageGuide = 'pending' | 'later' | 'done';

export interface Prefs {
  onboardMode?: OnboardMode;
  packageGuide?: PackageGuide;
  turnAuto?: boolean;
}

const MODES: readonly string[] = ['talk', 'form'];
const GUIDES: readonly string[] = ['pending', 'later', 'done'];

/** 저장된 글자를 읽어 아는 값만 남긴다(모르는 값·형식은 버린다) */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const dict = value as Record<string, unknown>;
    const out: Prefs = {};
    if (typeof dict.onboardMode === 'string' && MODES.includes(dict.onboardMode))
      out.onboardMode = dict.onboardMode as OnboardMode;
    if (typeof dict.packageGuide === 'string' && GUIDES.includes(dict.packageGuide))
      out.packageGuide = dict.packageGuide as PackageGuide;
    if (typeof dict.turnAuto === 'boolean') out.turnAuto = dict.turnAuto;
    return out;
  } catch {
    return {};
  }
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 저장된 값을 읽는다(읽지 못하면 null — 저장소가 없거나 막혔다) */
function readStored(): Prefs | null {
  try {
    const store = storage();
    return store ? parsePrefs(store.getItem(PREFS_KEY)) : null;
  } catch {
    return null;
  }
}

class PrefsStore {
  /** 앱이 뜰 때 한 번 읽어 둔다(화면이 그리는 도중에 읽어 상태를 바꾸지 않게) */
  value = $state<Prefs>(readStored() ?? {});

  constructor() {
    // 다른 탭(또는 다른 hobong.html)이 바꾸면 따라간다(이벤트가 오지 않는 브라우저는 쓰기 직전에 다시 읽는다)
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('storage', (event) => {
      if (event.key === PREFS_KEY || event.key === null) this.value = readStored() ?? this.value;
    });
  }

  /**
   * 쓰기 직전의 값: 저장소를 다시 읽는다. 이 탭이 연 뒤 다른 탭이 바꾼 것(예: 그 탭에서 패키지를 받아 'done')을
   * 이 탭의 옛 값으로 덮지 않게(부록 J13). 저장소를 읽지 못하면 이 탭의 메모리 값.
   */
  #fresh(): Prefs {
    return readStored() ?? this.value;
  }

  get onboardMode(): OnboardMode | undefined {
    return this.value.onboardMode;
  }

  get packageGuide(): PackageGuide | undefined {
    return this.value.packageGuide;
  }

  get turnAuto(): boolean | undefined {
    return this.value.turnAuto;
  }

  set(patch: Prefs): void {
    this.value = { ...this.#fresh(), ...patch };
    this.#save();
  }

  /** 데이터를 모두 지울 때: 패키지 안내 상태는 처음으로, 고른 입력 방식·자동 회전은 기기 편의라 남긴다 */
  resetForNewStart(): void {
    const { onboardMode, turnAuto } = this.#fresh();
    this.value = {
      ...(onboardMode ? { onboardMode } : {}),
      ...(turnAuto !== undefined ? { turnAuto } : {}),
    };
    this.#save();
  }

  #save(): void {
    try {
      const store = storage();
      if (!store) return;
      if (Object.keys(this.value).length === 0) store.removeItem(PREFS_KEY);
      else store.setItem(PREFS_KEY, JSON.stringify(this.value));
    } catch {
      // 저장소가 막혀 있으면 이 탭에서만 기억한다
    }
  }
}

export const prefs = new PrefsStore();
