/**
 * 이 탭에서만 기억하는 화면 상태(메모리). 저장소에는 쓰지 않으므로 새로 고치면 처음 값으로 돌아간다.
 * - 카드 화면: 고른 카드 종류, 결산 카드에 넣을 것(번 봉급·1년 달력)
 * - 닫은 안내 띠(키 → true)
 */
export type CardKind = 'character' | 'recap';

class Session {
  cardKind = $state<CardKind>('character');
  /** 결산 카드에 올해 번 봉급을 넣는지(기본 끔) */
  recapSalary = $state(false);
  /** 결산 카드에 1년 달력을 넣는지(기본 켬) */
  recapCalendar = $state(true);
  /** 닫은 안내 띠 */
  dismissed = $state<Record<string, true>>({});

  dismiss(key: string): void {
    this.dismissed = { ...this.dismissed, [key]: true };
  }

  /** 데이터를 지울 때 함께 처음으로 돌린다 */
  reset(): void {
    this.cardKind = 'character';
    this.recapSalary = false;
    this.recapCalendar = true;
    this.dismissed = {};
  }
}

export const session = new Session();
