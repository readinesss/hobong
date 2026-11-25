/**
 * 파일 저장·불러오기, 클립보드, 공유 시트.
 * 기기·브라우저마다 되는 것이 달라 먼저 가능 여부를 확인하고, 안 되면 호출한 쪽이 대체 방법을 보여준다.
 * 모두 브라우저 안에서만 일어나며 어디로도 전송하지 않는다.
 */

export interface Capabilities {
  /** <a download>로 파일 저장 */
  download: boolean;
  /** 클립보드에 이미지 복사 */
  copyImage: boolean;
  /** 클립보드에 글자 복사 */
  copyText: boolean;
  /** 파일을 담은 공유 시트 */
  shareFiles: boolean;
}

export function detectCapabilities(): Capabilities {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const hasClipboardItem = typeof ClipboardItem !== 'undefined';
  let shareFiles = false;
  try {
    if (nav && typeof nav.canShare === 'function' && typeof File !== 'undefined') {
      shareFiles = nav.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] });
    }
  } catch {
    shareFiles = false;
  }
  return {
    download: typeof document !== 'undefined' && 'download' in document.createElement('a'),
    copyImage:
      !!nav?.clipboard &&
      typeof nav.clipboard.write === 'function' &&
      hasClipboardItem &&
      window.isSecureContext,
    copyText:
      !!nav?.clipboard && typeof nav.clipboard.writeText === 'function' && window.isSecureContext,
    shareFiles,
  };
}

/** Blob을 파일로 저장한다. 시작하지 못하면 false */
export function downloadBlob(blob: Blob, fileName: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 일부 브라우저는 바로 해제하면 저장이 취소된다.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(text: string, fileName: string, type = 'application/json'): boolean {
  return downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), fileName);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 예전 방식으로 다시 시도
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

/** 공유 시트를 연다. 사용자가 닫으면 'cancelled' */
export async function shareFile(
  blob: Blob,
  fileName: string,
  title: string,
): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    const file = new File([blob], fileName, { type: blob.type });
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** 사용자가 고른(또는 끌어다 놓은) 파일의 내용을 글자로 읽는다 */
export function readFileText(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error('파일이 너무 큽니다. 호봉 백업 파일이 맞는지 확인해 주세요.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsText(file, 'utf-8');
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}
