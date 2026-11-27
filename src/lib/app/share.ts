/**
 * 호봉 알리기: 사이트 주소만 전한다. 닉네임·입력값·계산값은 싣지 않는다(정해진 소개 글과 주소뿐).
 * 공유 시트(Web Share)가 있으면 그것을, 없으면 주소를 클립보드에 복사한다. 어디로도 직접 보내지 않는다.
 */
import { emitCue } from '../fx/cues.ts';
import { SITE_URL } from '../config.ts';
import { copyText } from './files.ts';

/** 알릴 주소(프로토콜 포함) */
export const SHARE_URL = `https://${SITE_URL}/`;

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** 공유 시트를 쓸 수 있는지(없으면 주소 복사) */
export function canShareSheet(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareSite(title: string, text: string): Promise<ShareResult> {
  if (canShareSheet()) {
    try {
      await navigator.share({ title, text, url: SHARE_URL });
      emitCue('share');
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // 공유 시트를 열지 못하면(권한·지원 안 함) 복사로 대신한다
    }
  }
  if (await copyText(SHARE_URL)) {
    emitCue('share');
    return 'copied';
  }
  return 'failed';
}
