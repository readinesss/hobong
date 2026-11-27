/**
 * 부화 무대 → 홈 상태창으로 호봉이를 이어 주는 자리 넘김.
 *
 * 부화 화면이 떠나기 직전에 무대 위 호봉이가 서 있던 자리(뷰포트 CSS px, 48칸 그림의 왼쪽 위와 한 변)를 적어 두면,
 * 홈이 뜨면서 한 번 꺼내(takeHandoff) 그 자리에서 상태창의 호봉이 자리까지 걸어 들어가는 그림을 그린다.
 * 한 번 꺼내면 비운다. 움직임 줄이기면 적지 않는다(홈은 바로 보인다).
 */
export interface Handoff {
  x: number;
  y: number;
  /** 그림 한 변(CSS px) */
  size: number;
}

let pending: Handoff | null = null;

export function setHandoff(next: Handoff | null): void {
  pending = next;
}

/** 적어 둔 자리를 꺼내고 비운다. 없으면 null */
export function takeHandoff(): Handoff | null {
  const taken = pending;
  pending = null;
  return taken;
}
