/**
 * 이 파일(단일 HTML)에 함께 들어가는 오픈소스의 고지.
 * 내려받은 hobong.html 하나만 돌아다녀도 고지가 따라가도록 전문을 번들에 넣는다.
 */
import ofl from '../assets/fonts/OFL.txt?raw';
import svelteMit from '../assets/licenses/svelte-MIT.txt?raw';

export interface LicenseNotice {
  name: string;
  /** 무엇에 쓰였는지 */
  use: string;
  license: string;
  text: string;
}

export const LICENSE_NOTICES: readonly LicenseNotice[] = [
  {
    name: 'Galmuri',
    use: '글꼴 (Galmuri14·Galmuri11, 글자 집합만 줄여서 포함)',
    license: 'SIL Open Font License 1.1',
    text: ofl.trim(),
  },
  {
    name: 'Svelte',
    use: '화면을 그리는 라이브러리',
    license: 'MIT License',
    text: svelteMit.trim(),
  },
];
