/**
 * 앱 상태: 사용자 데이터를 읽고, 바꾸고, 저장한다.
 * 화면은 여기의 동작(메서드)만 호출하고 저장소를 직접 만지지 않는다.
 */
import { addDays, diffDays, todayYmd, yearOf, type Ymd } from '../calc/date.ts';
import { Calendar } from '../calc/calendar.ts';
import { careerOf, careerStepOn } from '../calc/career-profile.ts';
import { effectiveRetirement, serviceDayOf } from '../calc/retirement.ts';
import { decideGrowth } from '../character/growth.ts';
import { formIdFor, formIndex } from '../character/look.ts';
import { characterRules } from '../character/rules.ts';
import { careerLookup, rankStepLabel, rulesFor } from '../rules/index.ts';
import { defaultShowRank, trackNameOf } from './track.ts';
import type { RankKey } from '../rules/types.ts';
import {
  makeEnvelope,
  parseBackup,
  serializeBackup,
  type ParseContext,
  type ParseResult,
} from '../store/backup.ts';
import { defaultSettings, newUserData } from '../store/defaults.ts';
import type {
  CharacterLook,
  LeaveKind,
  LeaveRecord,
  Profile,
  Settings,
  UserData,
} from '../store/schema.ts';
import {
  clearAll,
  clearCorrupt,
  clearUndo,
  hasCorrupt,
  isNewerData,
  KEYS,
  loadData,
  loadUndo,
  openStore,
  readCorrupt,
  saveData,
  saveUndo,
  type KeyValueStore,
} from '../store/storage.ts';
import { cleanText } from '../store/validate.ts';
import { LIMITS } from '../store/schema.ts';
import type { EventBadgeId } from '../achievements.ts';

export const APP_VERSION: string = __APP_VERSION__;

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'warn';
  icon?: string;
  action?: ToastAction;
  /** 떠 있는 시간(ms). 연출 때문에 미뤘다가 다시 띄울 때 쓴다 */
  ms: number;
}

/** 내 정보에서 직종을 바꿔 저장한 뒤 한 번 보여 줄 안내 */
export interface TrackChange {
  trackLabel: string;
  /** 새 직종의 월급날 기본값(지금 월급날과 같으면 null) */
  paydayDefault: number | null;
  paydayNote: string;
  /**
   * 별표 30 에 이 직종의 기관이 따로 적혀 있어 기본값을 권할 수 있는지(교원 17일·군무원 10일).
   * 경찰·소방·해양경찰의 25일은 '따로 적혀 있지 않아' 둔 값이라(T13) 권하지 않고 같은 무게로 묻는다.
   */
  paydayFirm: boolean;
  /** 카드의 계급 이름 넣기를 이 값으로 다시 맞췄다(바꾸지 않았으면 null) */
  cardShowRank: boolean | null;
}

export interface WelcomeBack {
  /** 직전 방문일 */
  since: Ymd;
  days: number;
}

export interface Celebration {
  /**
   * step: 같은 계급에서 호봉이 오름 / grow: 재직 연수 등으로 형태·계급 순서가 오름 /
   * promote: 내 정보에서 승진을 알렸다(계급이 오르고 승진일이 바뀜).
   * 처음 깨어나는 연출은 대화상자가 아니라 첫 입력 화면 안에서 한다(Welcome 의 제자리 부화).
   */
  kind: 'step' | 'grow' | 'promote';
  fromRank: RankKey | null;
  fromStep: number;
  /** 연출 전 형태 id. 마지막 형태를 모르면 지금 형태 */
  fromForm: string;
  toRank: RankKey | null;
  toStep: number;
  toForm: string;
  /** '7급 12호봉' / '경위 12호봉' / '12호봉'(교원) */
  toLabel: string;
  /** 승진 전·후의 계급 이름('8급'·'경사'). 승진이 아니거나 이름이 없으면 null. 홈 공개 설정을 끄면 화면이 쓰지 않는다 */
  fromRankLabel: string | null;
  toRankLabel: string | null;
}

/** 홈 창들이 차례로 나타나는 까닭: 막 깨어남(hatch) / 임용정보 패키지로 이어함(import) */
export type Entrance = 'hatch' | 'import';

/**
 * today 기준 이 프로필의 호봉·형태·계급 이름(연출 기준을 맞추는 데 쓴다).
 * 화면(view.step·view.formId)과 같이 정년퇴직일이 지나면 그날 기준으로 센다(serviceDayOf).
 */
function growthMarkOf(profile: Profile, today: Ymd) {
  const c = careerOf(rulesFor, profile, yearOf(today));
  const day = serviceDayOf(effectiveRetirement(c, profile), today);
  const step = careerStepOn(c, profile, day);
  const form = formIdFor(characterRules, {
    ladderId: c.ladderId,
    rank: profile.rank,
    hireDate: profile.hireDate,
    today: day,
  });
  return { rank: profile.rank, step, form, label: rankStepLabel(c, step), career: c };
}

function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

/** 복귀 정산을 띄우는 문턱 */
const WELCOME_BACK = {
  /** 놓친 근무일(마지막 방문 다음 날 ~ 어제) */
  missedWorkdays: 3,
  /** 달력 일수 */
  calendarDays: 7,
} as const;

/** 놓친 근무일을 세는 달력(공휴일 반영) */
const visitCalendar = new Calendar(rulesFor);

class AppStore {
  data = $state<UserData | null>(null);
  ready = $state(false);
  /** 브라우저를 닫아도 남는 저장소를 쓰고 있는지 */
  persistent = $state(true);
  /** 저장소에 쓸 수 있는지(가득 찼거나 쓰기만 막힌 경우 false) */
  writable = $state(true);
  /** 저장에 실패했는지(용량 초과 등) */
  saveFailed = $state(false);
  /** 방금 읽지 못한 저장본의 이유(그 로드에서만) */
  corruptNotice = $state<string | null>(null);
  /** 읽지 못해 따로 옮겨 둔 저장본이 남아 있는지 */
  corruptKept = $state(false);
  /** 더 새로운 버전의 호봉에서 저장한 데이터가 있어 이 탭(파일)은 손대지 않는다 */
  newerNotice = $state<string | null>(null);
  /** 다른 탭(또는 다른 hobong.html)이 데이터를 바꿔 이 탭이 더는 쓰지 않는다. 새로 고쳐야 한다 */
  staleNotice = $state<string | null>(null);
  /** 되돌릴 수 있는 직전 상태의 보관 시각 */
  undoSavedAt = $state<string | null>(null);
  toasts = $state<Toast[]>([]);
  welcomeBack = $state<WelcomeBack | null>(null);
  celebration = $state<Celebration | null>(null);
  /**
   * 승급·승진 연출이 끝 장면에 닿았는지. 닿기 전에는 뒤의 홈(상태창)이 오르기 전 호봉·모습을 보여 준다
   * (결과를 연출보다 먼저 보지 않게). 연출이 새로 뜰 때마다 false 로 돌린다.
   */
  celebrationRevealed = $state(false);
  /**
   * 직종이 없던 형식(v3 이하)의 저장본을 방금 바꿔 열었다. 홈에 '이제 경찰·소방·교원도 계산해요' 띠를
   * 한 번 띄운다(이 탭의 메모리. 바꾼 저장본은 v4 로 저장되므로 다음에 열면 뜨지 않는다).
   */
  upgradedFromV3 = $state(false);
  /** 내 정보에서 직종을 바꿔 저장한 뒤의 안내(월급날 기본값·카드 계급 이름). 띠를 닫으면 null */
  trackChange = $state<TrackChange | null>(null);
  /**
   * 첫 입력 화면에서 알이 깨어나는 중이다. 데이터는 이미 저장됐지만(연출 중에 새로 고쳐도 남는다)
   * 연출이 끝날 때까지 첫 화면을 그대로 둔다(App.svelte).
   */
  hatching = $state(false);
  /** 홈에 막 들어섰다: 창들이 차례로 나타난다(한 번). 홈이 다 보인 뒤 null 로 돌린다 */
  entrance = $state<Entrance | null>(null);

  #store: KeyValueStore | null = null;
  #toastSeq = 0;
  /** 승급·승진 연출이 떠 있는 동안 미뤄 둔 알림(연출이 닫히면 차례로 띄운다) */
  #heldToasts: (() => void)[] = [];
  /** 이 탭이 마지막으로 읽거나 쓴 저장본 원문. 다른 탭이 바꿨는지 알아보는 데 쓴다 */
  #lastRaw: string | null = null;

  /**
   * 검사 기준. stored 가 true 면 이 브라우저에 저장돼 있던 값을 읽을 때의 기준이다
   * (형식만 보고 "오늘"에 따라 달라지는 검사는 하지 않는다).
   */
  context(now = new Date(), stored = false): ParseContext {
    const today = todayYmd(now);
    const rules = rulesFor(yearOf(today));
    return {
      today,
      ...careerLookup(rules),
      defaultSettings: defaultSettings(rules),
      nowIso: now.toISOString(),
      stored,
    };
  }

  init(): void {
    const opened = openStore(() => window.localStorage);
    this.#store = opened.store;
    this.persistent = opened.persistent;
    this.writable = opened.writable;
    this.#load();
    // 다른 탭에서 바뀌면 따라간다(서로 덮어쓰지 않게).
    window.addEventListener('storage', (event) => {
      if (event.key === KEYS.data || event.key === KEYS.undo || event.key === null)
        this.#followOtherTab();
    });
    // storage 이벤트가 오지 않는 경우(일부 브라우저의 file://, 새로 고친 탭 등)에도
    // 이 탭으로 돌아오면 저장소가 바뀌었는지 다시 본다.
    const recheck = () => this.#recheckStore();
    window.addEventListener('focus', recheck);
    window.addEventListener('pageshow', recheck);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') recheck();
    });
    this.ready = true;
  }

  /** 지금 저장소의 원문을 이 탭이 아는 값으로 기억한다 */
  #rememberStored(): void {
    try {
      this.#lastRaw = this.#store?.getItem(KEYS.data) ?? null;
    } catch {
      this.#lastRaw = null;
    }
  }

  /** 이 탭이 마지막으로 읽거나 쓴 뒤에 저장소가 바뀌었으면 따라간다 */
  #recheckStore(): void {
    if (!this.#store) return;
    let raw: string | null;
    try {
      raw = this.#store.getItem(KEYS.data);
    } catch {
      return;
    }
    if (raw !== this.#lastRaw) this.#followOtherTab();
  }

  #load(): void {
    if (!this.#store) return;
    const ctx = this.context(new Date(), true);
    const loaded = loadData(this.#store, ctx);
    this.newerNotice = null;
    if (loaded.status === 'ok') {
      this.data = loaded.data;
      if (loaded.fromVersion < 4) this.upgradedFromV3 = true;
      if (loaded.migrated || loaded.restored) this.#persist();
      if (loaded.restored) {
        this.toast(
          '예전에 읽지 못해 따로 옮겨 뒀던 데이터를 되살렸어요.',
          'good',
          'icon-undo',
          6000,
        );
      }
    } else {
      this.data = null;
      if (loaded.status === 'corrupt') this.corruptNotice = loaded.reason;
      if (loaded.status === 'newer') this.newerNotice = loaded.reason;
    }
    this.corruptKept = hasCorrupt(this.#store);
    this.undoSavedAt = loadUndo(this.#store, ctx)?.savedAt ?? null;
    this.#rememberStored();
  }

  /**
   * 다른 탭이 저장소를 바꿨다. 읽을 수 있으면 따라가고, 읽지 못하면(더 새 버전 등)
   * 저장소는 그대로 두고 이 탭이 더는 쓰지 않게 막는다.
   */
  #followOtherTab(): void {
    if (!this.#store) return;
    const ctx = this.context(new Date(), true);
    const loaded = loadData(this.#store, ctx, { readOnly: true });
    if (loaded.status === 'ok') {
      this.data = loaded.data;
    } else if (loaded.status === 'empty') {
      this.data = null;
    } else {
      this.staleNotice =
        loaded.status === 'newer'
          ? '다른 탭(또는 다른 hobong.html)에서 더 새 버전의 호봉이 데이터를 바꿨어요. 이 탭은 예전 버전이라 더는 저장하지 않아요. 새로 고침하거나 새 버전으로 열어 주세요.'
          : '다른 탭에서 바뀐 데이터를 이 탭이 읽지 못했어요. 이 탭은 더는 저장하지 않아요. 새로 고침해 주세요.';
    }
    this.corruptKept = hasCorrupt(this.#store);
    this.undoSavedAt = loadUndo(this.#store, ctx)?.savedAt ?? null;
    this.#rememberStored();
  }

  /** 이 탭이 저장소에 써도 되는지 */
  get canWrite(): boolean {
    return this.newerNotice === null && this.staleNotice === null;
  }

  /** 저장한다. 성공하면 true */
  #persist(): boolean {
    if (!this.#store || !this.data) return false;
    if (!this.canWrite) {
      this.saveFailed = true;
      return false;
    }
    const ctx = this.context(new Date(), true);
    // 다른 탭·파일이 더 새 버전으로 저장해 뒀다면 덮어쓰지 않는다.
    if (isNewerData(this.#store, ctx)) {
      this.staleNotice =
        '더 새 버전의 호봉이 저장한 데이터가 있어 이 탭은 저장하지 않았어요. 새 버전으로 열어 주세요.';
      this.saveFailed = true;
      return false;
    }
    const snapshot = $state.snapshot(this.data) as UserData;
    const nowIso = new Date().toISOString();
    // 앱이 저장한 값이 다음에 열 때 검사를 통과하는지 미리 확인한다(스스로 손상을 만들지 않게).
    const check = parseBackup(serializeBackup(makeEnvelope(snapshot, APP_VERSION, nowIso)), ctx);
    if (!check.ok) {
      this.saveFailed = true;
      return false;
    }
    const ok = saveData(this.#store, snapshot, APP_VERSION, nowIso);
    this.saveFailed = !ok;
    if (ok) this.#rememberStored();
    return ok;
  }

  /**
   * 데이터를 바꾸고 저장한다.
   * count가 true면 "마지막 백업 이후 변경"으로 센다(방문 기록 같은 자동 변경은 세지 않는다).
   */
  commit(mutate: (data: UserData) => void, count = true): void {
    if (!this.data) return;
    mutate(this.data);
    this.data.meta.updatedAt = new Date().toISOString();
    if (count) this.data.meta.changesSinceBackup += 1;
    this.#persist();
  }

  // ── 방문 ─────────────────────────────────────────────────────────────

  /**
   * 오늘 방문을 기록하고, 오랜만이면 복귀 정산을 준비한다.
   * 주말·연휴만 지나간 것(금→월)은 오랜만이 아니다: 놓친 근무일이 WELCOME_BACK.missedWorkdays 일 이상이거나
   * 달력으로 WELCOME_BACK.calendarDays 일 이상 지났을 때만 띄운다.
   */
  recordVisit(today: Ymd): void {
    const data = this.data;
    if (!data) return;
    const days = data.visits.days;
    const last = days[days.length - 1] ?? null;
    if (last === today) return;
    if (last !== null && last < today) {
      const days = diffDays(last, today);
      // 마지막 방문 다음 날부터 어제까지의 근무일
      const missed = days >= 2 ? visitCalendar.workdaysBetween(addDays(last, 1), today) : 0;
      if (missed >= WELCOME_BACK.missedWorkdays || days >= WELCOME_BACK.calendarDays) {
        this.welcomeBack = { since: last, days };
      }
    }
    this.commit((d) => {
      d.visits.lastVisit = last;
      if (!d.visits.days.includes(today)) {
        d.visits.days.push(today);
        d.visits.days.sort();
        if (d.visits.days.length > LIMITS.maxVisitDays)
          d.visits.days.splice(0, d.visits.days.length - LIMITS.maxVisitDays);
      }
    }, false);
  }

  dismissWelcomeBack(): void {
    this.welcomeBack = null;
  }

  // ── 프로필 ───────────────────────────────────────────────────────────

  /**
   * 첫 입력을 마쳐 새 데이터를 만든다. 깨어나는 연출은 첫 입력 화면이 맡으므로 여기서는 저장만 한다.
   * hatch 를 주면 연출이 끝날 때(finishHatch)까지 첫 화면을 유지한다. 저장했으면 true.
   */
  createProfile(
    profile: Profile,
    settings?: Partial<Settings>,
    look?: CharacterLook,
    options: { hatch?: boolean } = {},
  ): boolean {
    if (!this.canWrite) return false;
    const now = new Date();
    const today = todayYmd(now);
    const rules = rulesFor(yearOf(today));
    const mark = growthMarkOf(profile, today);
    const base = defaultSettings(rules);
    const data = newUserData(
      profile,
      {
        ...base,
        // 카드의 계급 이름은 일반직 사다리(1~9급)만 기본으로 넣는다(경찰·소방·우정 계급 이름은 직종을 드러낸다)
        card: { ...base.card, showRank: defaultShowRank(mark.career) },
        ...settings,
      },
      now.toISOString(),
      today,
      look,
    );
    data.character.lastStep = mark.step;
    data.character.lastForm = mark.form;
    this.hatching = options.hatch === true;
    this.celebration = null;
    this.data = data;
    this.#persist();
    return true;
  }

  /** 깨어나는 연출이 끝났다(또는 건너뛰었다): 홈으로 넘어가 창들이 차례로 나타난다 */
  finishHatch(): void {
    if (!this.hatching) return;
    this.hatching = false;
    this.entrance = 'hatch';
  }

  /** 홈의 차례 등장이 끝났다 */
  clearEntrance(): void {
    this.entrance = null;
  }

  /**
   * 내 정보를 고쳐 저장한다. celebrate 를 주면(고치는 화면의 '승진했어요') 같은 사다리에서 계급 순서가 오르고
   * 승진일이 뒤로 바뀐 경우에만 승진 연출을 띄운다. 틀린 값을 바로잡는 것(승진일 그대로·계급을 내림)은 조용히 맞춘다.
   */
  updateProfile(profile: Profile, options: { celebrate?: boolean } = {}): void {
    const today = todayYmd(new Date());
    const mark = growthMarkOf(profile, today);
    const before = this.data ? careerOf(rulesFor, this.data.profile, yearOf(today)) : null;
    const promoted = options.celebrate === true ? this.#promotionFrom(profile, mark, today) : null;
    const trackChanged = before !== null && before.sel.track !== profile.track;
    // 일반직 사다리(1~9급)와 다른 사다리 사이를 오가면 카드의 계급 이름 기본값을 다시 맞춘다(Q2)
    const showRank = defaultShowRank(mark.career);
    const cardReset =
      before !== null &&
      defaultShowRank(before) !== showRank &&
      this.data?.settings.card.showRank !== showRank;
    this.commit((d) => {
      d.profile = profile;
      // 직접 고친 값(직종·계급을 바꾼 경우 포함)이 연출을 일으키지 않게 기준을 맞춘다.
      d.character.lastRank = profile.rank;
      d.character.lastStep = mark.step;
      d.character.lastForm = mark.form;
      if (cardReset) d.settings.card = { ...d.settings.card, showRank };
    });
    const payday = mark.career.payday;
    // 월급날은 직종을 바꿀 때만 묻는다. 카드 설정은 봉급표만 바꿔 사다리가 바뀌어도(별표 3 ↔ 8) 알린다.
    const paydayDiffers =
      trackChanged && this.data !== null && this.data.settings.payday !== payday.defaultDay;
    const generalDay = rulesFor(yearOf(today)).tracks.items.general.payday.defaultDay;
    this.trackChange =
      paydayDiffers || cardReset
        ? {
            trackLabel: trackNameOf(mark.career),
            paydayDefault: paydayDiffers ? payday.defaultDay : null,
            paydayNote: payday.note,
            paydayFirm: payday.defaultDay !== generalDay,
            cardShowRank: cardReset ? showRank : null,
          }
        : null;
    if (promoted) this.#celebrate(promoted);
  }

  /** 지금 저장된 내 정보에서 profile 로 바꾸는 것이 승진이면 그 연출 정보, 아니면 null */
  #promotionFrom(
    profile: Profile,
    mark: ReturnType<typeof growthMarkOf>,
    today: Ymd,
  ): Celebration | null {
    const old = this.data?.profile;
    if (!old || old.rank === null || profile.rank === null) return null;
    const was = growthMarkOf(old, today);
    const ranks = mark.career.ladder?.ranks ?? null;
    // 같은 사다리(직종·봉급표가 같다)에서만
    if (!ranks || was.career.ladderId !== mark.career.ladderId) return null;
    const from = ranks.findIndex((r) => r.key === old.rank);
    const to = ranks.findIndex((r) => r.key === profile.rank);
    if (from < 0 || to <= from) return null;
    if (!(profile.rankDate > old.rankDate)) return null;
    // 모습이 작아지는 연출은 그리지 않는다
    if (formIndex(characterRules, mark.form) < formIndex(characterRules, was.form)) return null;
    return {
      kind: 'promote',
      fromRank: old.rank,
      fromStep: was.step,
      fromForm: was.form,
      toRank: profile.rank,
      toStep: mark.step,
      toForm: mark.form,
      toLabel: mark.label,
      fromRankLabel: ranks[from]?.label ?? null,
      toRankLabel: ranks[to]?.label ?? null,
    };
  }

  /** 직종을 바꾼 뒤 안내 띠의 '그 날로 바꾸기' */
  applyTrackPayday(): void {
    const day = this.trackChange?.paydayDefault ?? null;
    this.trackChange = null;
    if (day !== null) this.updateSettings({ payday: day });
  }

  /**
   * 승급·승진 연출을 띄운다. 뒤의 홈은 끝 장면에 닿을 때까지 오르기 전 값을 보이고(celebrationRevealed),
   * 이미 떠 있던 알림은 거뒀다가 연출이 닫힌 뒤 다시 띄운다(연출 위에 알림이 쌓이지 않게).
   */
  #celebrate(event: Celebration): void {
    this.celebrationRevealed = false;
    this.celebration = event;
    for (const shown of this.toasts.splice(0))
      this.#heldToasts.push(() =>
        this.toast(shown.text, shown.kind, shown.icon, shown.ms, shown.action),
      );
  }

  /** 승급·성장 연출을 본 것으로 기록한다 */
  acknowledgeGrowth(rank: RankKey | null, step: number, form: string): void {
    this.celebration = null;
    if (!this.data) return;
    const c = this.data.character;
    if (c.lastRank === rank && c.lastStep === step && c.lastForm === form) return;
    this.commit((d) => {
      d.character.lastRank = rank;
      d.character.lastStep = step;
      d.character.lastForm = form;
    }, false);
  }

  /**
   * 오늘 기준 호봉·형태가 마지막으로 본 것보다 올랐으면 연출을 준비한다(decideGrowth).
   * 형태가 내려갔거나 마지막 형태를 모르면(null·모르는 id) 연출 없이 지금 값으로 기록한다.
   */
  checkGrowth(rank: RankKey | null, step: number, form: string): void {
    const data = this.data;
    if (!data || this.celebration) return;
    const { lastRank, lastStep, lastForm } = data.character;
    const today = todayYmd(new Date());
    const c = careerOf(rulesFor, data.profile, yearOf(today));
    const decision = decideGrowth(
      characterRules,
      { rank: lastRank, step: lastStep, form: lastForm },
      { rank, step, form },
      c.ladder?.ranks ?? null,
    );
    if (decision.kind === 'step' || decision.kind === 'grow') {
      this.#celebrate({
        kind: decision.kind,
        fromRank: lastRank,
        fromStep: lastStep,
        fromForm:
          lastForm !== null && characterRules.forms.some((f) => f.id === lastForm)
            ? lastForm
            : form,
        toRank: rank,
        toStep: step,
        toForm: form,
        toLabel: rankStepLabel(c, step),
        fromRankLabel: null,
        toRankLabel: null,
      });
    } else if (decision.kind === 'record') {
      // 계급이 바뀌었거나 호봉·형태가 내려간 경우(직접 수정·규칙 변경)는 조용히 맞춘다.
      this.acknowledgeGrowth(rank, step, form);
    }
  }

  markFormSeen(formId: string): void {
    if (!this.data || this.data.character.seenForms.includes(formId)) return;
    this.commit((d) => {
      d.character.seenForms.push(formId);
    }, false);
  }

  // ── 연가 ─────────────────────────────────────────────────────────────

  addLeave(entries: { date: Ymd; kind: LeaveKind; hours: number; memo?: string }[]): void {
    if (entries.length === 0) return;
    this.commit((d) => {
      for (const entry of entries) {
        const record: LeaveRecord = {
          id: newId(),
          date: entry.date,
          hours: entry.hours,
          kind: entry.kind,
          memo: cleanText(entry.memo ?? '', LIMITS.memoMax),
        };
        d.leave.records.push(record);
      }
      d.leave.records.sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
      );
    });
  }

  removeLeave(id: string): LeaveRecord | null {
    const found = this.data?.leave.records.find((r) => r.id === id) ?? null;
    if (!found) return null;
    const copy = { ...found };
    this.commit((d) => {
      d.leave.records = d.leave.records.filter((r) => r.id !== id);
    });
    return copy;
  }

  restoreLeave(record: LeaveRecord): void {
    this.commit((d) => {
      if (d.leave.records.some((r) => r.id === record.id)) return;
      d.leave.records.push(record);
      d.leave.records.sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
      );
    });
  }

  /** 올해 부여 시간을 직접 고친다. null이면 자동 계산으로 되돌린다 */
  setGrantOverride(year: number, hours: number | null): void {
    this.commit((d) => {
      if (hours === null) delete d.leave.grantOverrideHours[String(year)];
      else d.leave.grantOverrideHours[String(year)] = Math.max(0, Math.round(hours));
    });
  }

  // ── 꾸미기 ───────────────────────────────────────────────────────────

  /**
   * 호봉이 꾸미기를 저장한다(#17). 고르지 않은 칸의 값(이 버전이 모르는 새 장식 id 등)은 받은 그대로 둔다 —
   * 그릴 때만 기본값으로 대신한다.
   */
  updateLook(look: CharacterLook): void {
    this.commit((d) => {
      d.character.look = { ...look, deco: { ...look.deco } };
    });
  }

  // ── 설정·업적 ────────────────────────────────────────────────────────

  updateSettings(patch: Partial<Settings>, count = true): void {
    this.commit((d) => {
      d.settings = { ...d.settings, ...patch };
    }, count);
  }

  /** 새로 얻은 업적을 기록한다(달성일 포함) */
  recordAchievements(earned: Record<string, { at: Ymd }>): void {
    this.commit((d) => {
      d.achievements = earned;
    }, false);
  }

  /** 행동으로 얻는 업적을 준다. 새로 얻었으면 true */
  grantEvent(id: EventBadgeId): boolean {
    if (!this.data || this.data.achievements[id]) return false;
    const today = todayYmd(new Date());
    this.commit((d) => {
      d.achievements[id] = { at: today };
    }, false);
    return true;
  }

  // ── 데이터 내려받기·불러오기 ─────────────────────────────────────────

  /**
   * 백업 파일 내용. 파일 안의 기록(마지막 내려받기, 백업 배지)은 내려받은 뒤의 상태로 맞춘다.
   * 그래야 이 파일로 되살렸을 때 "아직 내려받은 적 없어요"가 뜨지 않는다.
   * 내려받기(또는 복사)에 성공하면 같은 시각과 stamp 로 markBackedUp 을 부른다.
   * stamp 는 내보낸 내용의 지문이다. 암호를 거는 동안(비동기) 다른 탭이 바꾸었거나, 글자 창을 연 뒤에
   * 내용이 바뀌었으면 markBackedUp 이 '백업됨'으로 기록하지 않는다.
   */
  exportBackup(now = new Date()): { text: string; at: string; stamp: string } {
    const at = now.toISOString();
    if (!this.data) return { text: '', at, stamp: '' };
    const snapshot = $state.snapshot(this.data) as UserData;
    const backedUp = AppStore.withBackupMark(snapshot, at);
    return {
      text: serializeBackup(makeEnvelope(backedUp, APP_VERSION, at)),
      at,
      stamp: AppStore.contentStamp(snapshot),
    };
  }

  /** 백업에 담기는 내용의 지문. 백업 표시(마지막 내려받기·변경 횟수·백업 배지)는 빼고 본다 */
  static contentStamp(data: UserData): string {
    return JSON.stringify({
      ...data,
      meta: { ...data.meta, lastBackupAt: null, changesSinceBackup: 0 },
      achievements: { ...data.achievements, 'evt-backup': null },
    });
  }

  /** 지금 내용이 stamp 를 만든 때와 같은지 */
  isSameContent(stamp: string): boolean {
    return (
      this.data !== null && AppStore.contentStamp($state.snapshot(this.data) as UserData) === stamp
    );
  }

  /** 내려받은 뒤의 상태: 마지막 내려받기 시각, 변경 횟수 0, 백업 배지 */
  static withBackupMark(data: UserData, at: string): UserData {
    const day = todayYmd(new Date(at));
    return {
      ...data,
      meta: { ...data.meta, lastBackupAt: at, changesSinceBackup: 0 },
      achievements: data.achievements['evt-backup']
        ? data.achievements
        : { ...data.achievements, 'evt-backup': { at: day } },
    };
  }

  /**
   * 내려받은(복사한) 것으로 기록한다. stamp 를 주면 지금 내용이 그때와 같을 때만 기록하고,
   * 그 사이 바뀌었으면 아무것도 바꾸지 않고 false 를 돌려준다(파일에 없는 변경을 '백업됨'으로 세지 않게).
   */
  markBackedUp(at: string, stamp?: string): boolean {
    if (stamp !== undefined) {
      // storage 이벤트가 아직 오지 않았어도 다른 탭이 바꿨는지 먼저 따라가 본다
      this.#recheckStore();
      if (!this.isSameContent(stamp)) return false;
    }
    if (!this.data) return false;
    const marked = AppStore.withBackupMark($state.snapshot(this.data) as UserData, at);
    this.data.meta.lastBackupAt = marked.meta.lastBackupAt;
    this.data.meta.changesSinceBackup = 0;
    if (!this.data.achievements['evt-backup'])
      this.data.achievements['evt-backup'] = marked.achievements['evt-backup'] as { at: Ymd };
    this.#persist();
    return true;
  }

  /** 파일 내용을 검사만 한다(아직 아무것도 바꾸지 않는다) */
  inspect(text: string): ParseResult {
    return parseBackup(text, this.context());
  }

  /**
   * 검사를 통과한 데이터로 바꾼다. 기존 데이터가 있으면 되돌릴 수 있게 먼저 보관한다.
   * 결과: 'imported'(기존 데이터 없이 불러옴) / 'replaced'(보관 뒤 덮어씀) / 'failed'(아무것도 바꾸지 않음)
   */
  importData(
    incoming: UserData,
    exportedAt: string | null = null,
  ): 'imported' | 'replaced' | 'failed' {
    if (!this.#store || !this.canWrite) return 'failed';
    const nowIso = new Date().toISOString();
    const replacing = this.data !== null;
    if (this.data) {
      // 직전 상태를 보관하지 못하면 덮어쓰지 않는다(되돌릴 길 없이 바뀌지 않게).
      if (!saveUndo(this.#store, $state.snapshot(this.data) as UserData, APP_VERSION, nowIso))
        return 'failed';
      this.undoSavedAt = nowIso;
    }
    // 파일에서 막 불러온 상태는 그 파일과 같으므로 "백업 이후 변경"은 0이다.
    const normalized =
      exportedAt && (incoming.meta.lastBackupAt === null || incoming.meta.lastBackupAt < exportedAt)
        ? {
            ...incoming,
            meta: { ...incoming.meta, lastBackupAt: exportedAt, changesSinceBackup: 0 },
          }
        : { ...incoming, meta: { ...incoming.meta, changesSinceBackup: 0 } };
    this.data = normalized;
    // 불러온 직후에는 승급 연출 대신 조용히 기준만 맞춘다.
    this.welcomeBack = null;
    this.celebration = null;
    this.hatching = false;
    // 첫 화면에서 임용정보 패키지로 이어하면 부화 연출 없이 홈 창들만 차례로 나타난다
    this.entrance = replacing ? null : 'import';
    this.#persist();
    return replacing ? 'replaced' : 'imported';
  }

  /** 불러오기 직전 상태로 되돌린다 */
  undoImport(): boolean {
    if (!this.#store || !this.canWrite) return false;
    const snapshot = loadUndo(this.#store, this.context(new Date(), true));
    if (!snapshot) return false;
    this.data = snapshot.data;
    // 되돌린 상태를 저장하지 못했으면 보관본을 지우지 않는다(새로 고쳐도 다시 되돌릴 수 있게).
    if (!this.#persist()) return false;
    clearUndo(this.#store);
    this.undoSavedAt = null;
    this.celebration = null;
    return true;
  }

  /** 모든 데이터를 지우고 처음 화면으로 돌아간다 */
  reset(): void {
    if (this.#store) clearAll(this.#store);
    this.#rememberStored();
    this.data = null;
    this.undoSavedAt = null;
    this.corruptNotice = null;
    this.corruptKept = false;
    this.welcomeBack = null;
    this.celebration = null;
    this.upgradedFromV3 = false;
    this.trackChange = null;
    this.hatching = false;
    this.entrance = null;
  }

  dismissCorruptNotice(): void {
    this.corruptNotice = null;
  }

  /** 읽지 못해 따로 옮겨 둔 저장본(원문) */
  corruptCopies(): string[] {
    return this.#store ? readCorrupt(this.#store) : [];
  }

  /** 따로 옮겨 둔 저장본을 지운다(내려받은 뒤에만 부른다) */
  discardCorruptCopies(): void {
    if (this.#store) clearCorrupt(this.#store);
    this.corruptKept = false;
    this.corruptNotice = null;
  }

  // ── 알림 ─────────────────────────────────────────────────────────────

  toast(
    text: string,
    kind: Toast['kind'] = 'info',
    icon?: string,
    ms = 3200,
    action?: ToastAction,
  ): void {
    // 승급·승진 연출이 떠 있는 동안에는 미룬다(연출 위에 알림이 쌓이지 않게). 닫히면 releaseToasts 가 띄운다
    if (this.celebration !== null) {
      this.#heldToasts.push(() => this.toast(text, kind, icon, ms, action));
      if (this.#heldToasts.length > 4) this.#heldToasts.shift();
      return;
    }
    const id = (this.#toastSeq += 1);
    this.toasts.push({ id, text, kind, icon, action, ms });
    if (this.toasts.length > 4) this.toasts.splice(0, this.toasts.length - 4);
    setTimeout(() => this.dismissToast(id), ms);
  }

  /** 미뤄 둔 알림을 띄운다(연출이 닫힌 뒤 App 이 부른다). 연출이 아직 떠 있으면 아무 일도 없다 */
  releaseToasts(): void {
    if (this.celebration !== null || this.#heldToasts.length === 0) return;
    const held = this.#heldToasts;
    this.#heldToasts = [];
    for (const show of held) show();
  }

  /** 연출의 끝 장면에 닿았다: 뒤의 홈이 새 호봉·모습으로 바뀐다 */
  revealCelebration(): void {
    this.celebrationRevealed = true;
  }

  dismissToast(id: number): void {
    const index = this.toasts.findIndex((t) => t.id === id);
    if (index >= 0) this.toasts.splice(index, 1);
  }
}

export const app = new AppStore();

/** 오늘 이후로 가장 가까운 평일(연가 입력 기본값 등에 쓴다) */
export function nextDay(date: Ymd): Ymd {
  return addDays(date, 1);
}
