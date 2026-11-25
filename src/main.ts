import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app 요소를 찾을 수 없습니다.');

/**
 * 다른 사이트가 호봉을 iframe 에 넣어 띄우지 못하게 한다(겹쳐 보이게 하고 누르게 만드는 속임수 방지).
 * 메타 태그 CSP 로는 frame-ancestors 를 줄 수 없어 스크립트로 막는다.
 */
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

if (isFramed()) {
  const box = document.createElement('p');
  box.className = 'framed-notice';
  box.textContent = '호봉은 다른 페이지 안에서는 열리지 않아요. 새 창에서 열어 주세요.';
  target.replaceChildren(box);
} else {
  mount(App, { target });
}
