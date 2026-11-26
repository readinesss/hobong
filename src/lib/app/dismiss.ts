/**
 * 안내 띠를 닫은 뒤 포커스를 옮길 곳: 남은 띠의 닫기 버튼, 없으면 본문(#main).
 * 닫은 버튼이 DOM 에서 사라지면 포커스가 body 로 떨어지므로 다음 자리를 직접 정해 준다.
 */
import { tick } from 'svelte';

export async function focusAfterDismiss(): Promise<void> {
  await tick();
  const main = document.getElementById('main');
  const next = main?.querySelector<HTMLElement>('[data-dismiss]');
  (next ?? main)?.focus({ preventScroll: true });
}
