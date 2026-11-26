/**
 * 앱 상태: 사용자 데이터를 읽고, 바꾸고, 저장한다.
 * 화면은 여기의 동작(메서드)만 호출하고 저장소를 직접 만지지 않는다.
 */
import { addDays, diffDays, todayYmd, yearOf, type Ymd } from '../calc/date.ts';
import { Calendar } from '../calc/calendar.ts';
import { maxStepOf } from '../calc/salary.ts';
import { stepOn } from '../calc/step.ts';
import { rulesFor } from '../rules/index.ts';
import {
  makeEnvelope,
  parseBackup,
  serializeBackup,
  type ParseContext,
  type ParseResult,
} from '../store/backup.ts';
import { defaultSettings, newUserData } from '../store/defaults.ts';
import type {
  Grade,
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
}

export interface WelcomeBack {
  /** 직전 방문일 */
  since: Ymd;
  days: number;
}

export interface Celebration {
  kind: 'step' | 'hatch';
  fromGrade: Grade;
  fromStep: number;
  toGrade: Grade;
  toStep: number;
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

  #store: KeyValueStore | null = null;
  #toastSeq = 0;
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
      maxStep: (grade: Grade) => maxStepOf(rules.salary, grade),
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

  createProfile(profile: Profile, settings?: Partial<Settings>): void {
    if (!this.canWrite) return;
    const now = new Date();
    const today = todayYmd(now);
    const rules = rulesFor(yearOf(today));
    const data = newUserData(
      profile,
      { ...defaultSettings(rules), ...settings },
      now.toISOString(),
      today,
    );
    data.character.lastStep = stepOn(profile, today, maxStepOf(rules.salary, profile.grade));
    this.data = data;
    this.#persist();
    this.celebration = {
      kind: 'hatch',
      fromGrade: profile.grade,
      fromStep: data.character.lastStep,
      toGrade: profile.grade,
      toStep: data.character.lastStep,
    };
  }

  updateProfile(profile: Profile): void {
    const today = todayYmd(new Date());
    const rules = rulesFor(yearOf(today));
    this.commit((d) => {
      d.profile = profile;
      // 직접 고친 값이 연출을 일으키지 않게 기준을 맞춘다.
      d.character.lastGrade = profile.grade;
      d.character.lastStep = stepOn(profile, today, maxStepOf(rules.salary, profile.grade));
    });
  }

  /** 승급·승진 연출을 본 것으로 기록한다 */
  acknowledgeGrowth(grade: Grade, step: number): void {
    this.celebration = null;
    if (!this.data) return;
    if (this.data.character.lastGrade === grade && this.data.character.lastStep === step) return;
    this.commit((d) => {
      d.character.lastGrade = grade;
      d.character.lastStep = step;
    }, false);
  }

  /** 오늘 기준 호봉이 마지막으로 본 호봉보다 올랐으면 연출을 준비한다 */
  checkGrowth(grade: Grade, step: number): void {
    const data = this.data;
    if (!data || this.celebration) return;
    const { lastGrade, lastStep } = data.character;
    if (grade === lastGrade && step > lastStep) {
      this.celebration = {
        kind: 'step',
        fromGrade: lastGrade,
        fromStep: lastStep,
        toGrade: grade,
        toStep: step,
      };
    } else if (grade !== lastGrade || step !== lastStep) {
      // 직급이 바뀌었거나 호봉이 내려간 경우(직접 수정)는 조용히 맞춘다.
      this.acknowledgeGrowth(grade, step);
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
    const id = (this.#toastSeq += 1);
    this.toasts.push({ id, text, kind, icon, action });
    if (this.toasts.length > 4) this.toasts.splice(0, this.toasts.length - 4);
    setTimeout(() => this.dismissToast(id), ms);
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
