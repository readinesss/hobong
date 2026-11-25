/**
 * 앱 상태: 사용자 데이터를 읽고, 바꾸고, 저장한다.
 * 화면은 여기의 동작(메서드)만 호출하고 저장소를 직접 만지지 않는다.
 */
import { addDays, diffDays, todayYmd, yearOf, type Ymd } from '../calc/date.ts';
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
  clearUndo,
  KEYS,
  loadData,
  loadUndo,
  openStore,
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
  kind: 'step' | 'grade' | 'hatch';
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

class AppStore {
  data = $state<UserData | null>(null);
  ready = $state(false);
  /** 브라우저를 닫아도 남는 저장소를 쓰고 있는지 */
  persistent = $state(true);
  /** 저장에 실패했는지(용량 초과 등) */
  saveFailed = $state(false);
  /** 읽지 못한 저장본이 있어 따로 옮겨 뒀는지 */
  corruptNotice = $state<string | null>(null);
  /** 되돌릴 수 있는 직전 상태의 보관 시각 */
  undoSavedAt = $state<string | null>(null);
  toasts = $state<Toast[]>([]);
  welcomeBack = $state<WelcomeBack | null>(null);
  celebration = $state<Celebration | null>(null);

  #store: KeyValueStore | null = null;
  #toastSeq = 0;

  context(now = new Date()): ParseContext {
    const today = todayYmd(now);
    const rules = rulesFor(yearOf(today));
    return {
      today,
      maxStep: (grade: Grade) => maxStepOf(rules.salary, grade),
      defaultSettings: defaultSettings(rules),
      nowIso: now.toISOString(),
    };
  }

  init(): void {
    const opened = openStore(() => window.localStorage);
    this.#store = opened.store;
    this.persistent = opened.persistent;
    this.#load();
    // 다른 탭에서 바뀌면 따라간다(서로 덮어쓰지 않게).
    window.addEventListener('storage', (event) => {
      if (event.key === KEYS.data || event.key === KEYS.undo || event.key === null) this.#load();
    });
    this.ready = true;
  }

  #load(): void {
    if (!this.#store) return;
    const ctx = this.context();
    const loaded = loadData(this.#store, ctx);
    if (loaded.status === 'ok') {
      this.data = loaded.data;
      if (loaded.migrated) this.#persist();
    } else {
      this.data = null;
      if (loaded.status === 'corrupt') this.corruptNotice = loaded.reason;
    }
    this.undoSavedAt = loadUndo(this.#store, ctx)?.savedAt ?? null;
  }

  #persist(): void {
    if (!this.#store || !this.data) return;
    const ok = saveData(
      this.#store,
      $state.snapshot(this.data) as UserData,
      APP_VERSION,
      new Date().toISOString(),
    );
    this.saveFailed = !ok;
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

  /** 오늘 방문을 기록하고, 오랜만이면 복귀 정산을 준비한다 */
  recordVisit(today: Ymd): void {
    const data = this.data;
    if (!data) return;
    const days = data.visits.days;
    const last = days[days.length - 1] ?? null;
    if (last === today) return;
    if (last !== null && last < today && diffDays(last, today) >= 2) {
      this.welcomeBack = { since: last, days: diffDays(last, today) };
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

  /** 백업 파일 내용. 내려받기에 성공하면 markBackedUp을 부른다 */
  exportText(): string {
    if (!this.data) return '';
    return serializeBackup(
      makeEnvelope($state.snapshot(this.data) as UserData, APP_VERSION, new Date().toISOString()),
    );
  }

  markBackedUp(): void {
    if (!this.data) return;
    this.data.meta.lastBackupAt = new Date().toISOString();
    this.data.meta.changesSinceBackup = 0;
    this.#persist();
  }

  /** 파일 내용을 검사만 한다(아직 아무것도 바꾸지 않는다) */
  inspect(text: string): ParseResult {
    return parseBackup(text, this.context());
  }

  /** 검사를 통과한 데이터로 바꾼다. 기존 데이터가 있으면 되돌릴 수 있게 먼저 보관한다 */
  importData(incoming: UserData): void {
    if (!this.#store) return;
    const nowIso = new Date().toISOString();
    if (this.data) {
      saveUndo(this.#store, $state.snapshot(this.data) as UserData, APP_VERSION, nowIso);
      this.undoSavedAt = nowIso;
    }
    this.data = incoming;
    // 불러온 직후에는 승급 연출 대신 조용히 기준만 맞춘다.
    this.welcomeBack = null;
    this.celebration = null;
    this.#persist();
  }

  /** 불러오기 직전 상태로 되돌린다 */
  undoImport(): boolean {
    if (!this.#store) return false;
    const snapshot = loadUndo(this.#store, this.context());
    if (!snapshot) return false;
    this.data = snapshot.data;
    this.#persist();
    clearUndo(this.#store);
    this.undoSavedAt = null;
    this.celebration = null;
    return true;
  }

  /** 모든 데이터를 지우고 처음 화면으로 돌아간다 */
  reset(): void {
    if (this.#store) clearAll(this.#store);
    this.data = null;
    this.undoSavedAt = null;
    this.corruptNotice = null;
    this.welcomeBack = null;
    this.celebration = null;
  }

  dismissCorruptNotice(): void {
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
