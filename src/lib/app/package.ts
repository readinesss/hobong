/**
 * 임용정보 패키지(= 백업 파일) 내려받기. 홈의 안내 창이 쓴다(설정 화면은 글자로 보기·모두 지우기까지 맡아 따로 있다).
 * 암호 로직은 1차의 것을 그대로 쓴다(src/lib/store/crypto.ts).
 */
import type { Ymd } from '../calc/date.ts';
import { emitCue } from '../fx/cues.ts';
import { backupFileName } from '../store/backup.ts';
import { encryptBackup } from '../store/crypto.ts';
import { detectCapabilities, downloadText } from './files.ts';
import { app } from './state.svelte.ts';

export type PackageOutcome =
  /** 내려받기를 시작했고 '받음'으로 기록했다 */
  | { status: 'saved'; fileName: string }
  /** 내려받기는 시작했지만 그 사이 내용이 바뀌어 '받음'으로 기록하지 않았다 */
  | { status: 'stale'; fileName: string }
  /** 이 브라우저는 파일로 받을 수 없다(설정의 '글자로 보기'로 안내한다) */
  | { status: 'no-download' }
  /** 암호를 걸지 못했다 */
  | { status: 'lock-failed'; code: 'too-short' | 'unsupported' | 'format' };

/** 패키지를 파일로 내려받는다. password 를 주면 암호를 건다 */
export async function downloadPackage(today: Ymd, password?: string): Promise<PackageOutcome> {
  if (!detectCapabilities().download) return { status: 'no-download' };
  const { text, at, stamp } = app.exportBackup();
  let body = text;
  if (password !== undefined) {
    const sealed = await encryptBackup(text, password);
    if (!sealed.ok) return { status: 'lock-failed', code: sealed.code };
    body = sealed.text;
  }
  const fileName = backupFileName(today, password !== undefined);
  if (!downloadText(body, fileName)) return { status: 'no-download' };
  // 암호를 거는 사이 다른 탭이 바꿨으면 '받음'으로 세지 않는다
  if (!app.markBackedUp(at, stamp)) return { status: 'stale', fileName };
  emitCue('package-saved');
  return { status: 'saved', fileName };
}
