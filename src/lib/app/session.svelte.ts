/**
 * 이 탭에서만 기억하는 화면 상태(메모리). 저장소에는 쓰지 않으므로 새로 고치면 처음 값으로 돌아간다.
 * - 카드 화면: 고른 카드 종류, 결산 카드에 넣을 것(번 봉급·1년 달력·근무일)
 * - 닫은 안내 띠(키 → true)
 */
export type CardKind = 'character' | 'recap';

/** '패키지를 받아 두세요' 띠를 이 탭에서 미룬 표시(띠의 [나중에], 또는 홈 패키지 안내의 [나중에]) */
export const BACKUP_NUDGE_KEY = 'backup-nudge';

class Session {
  cardKind = $state<CardKind>('character');
  /** 결산 카드에 올해 번 봉급을 넣는지(기본 끔) */
  recapSalary = $state(false);
  /**
   * 결산 카드에 1년 달력·근무일을 넣는지. null 은 '아직 고르지 않음'이고 그때는 기본값을 따른다:
   * 보통은 켬, 올해 임용·정년퇴직이면 끔(재직 기간의 시작·끝을 짐작할 수 있다). recapShows 로 읽는다.
   */
  recapCalendar = $state<boolean | null>(null);
  recapWorkdays = $state<boolean | null>(null);
  /** 닫은 안내 띠 */
  dismissed = $state<Record<string, true>>({});

  dismiss(key: string): void {
    this.dismissed = { ...this.dismissed, [key]: true };
  }

  /** 결산 카드 항목을 넣는지: 고른 값이 있으면 그 값, 없으면 재직 시작·끝이 드러나는 결산인지에 따라 */
  recapShows(item: 'recapCalendar' | 'recapWorkdays', revealsService: boolean): boolean {
    return this[item] ?? !revealsService;
  }

  isDismissed(key: string): boolean {
    return this.dismissed[key] === true;
  }

  /** 데이터를 지울 때 함께 처음으로 돌린다 */
  reset(): void {
    this.cardKind = 'character';
    this.recapSalary = false;
    this.recapCalendar = null;
    this.recapWorkdays = null;
    this.dismissed = {};
  }
}

export const session = new Session();
