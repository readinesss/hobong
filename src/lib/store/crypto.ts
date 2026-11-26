/**
 * 백업 파일 암호 걸기·풀기.
 *
 * 브라우저 내장 WebCrypto 만 쓴다(새 라이브러리·외부 요청 없음).
 * - 열쇠: PBKDF2-HMAC-SHA-256, 600,000회(OWASP 2023 권장값), 파일마다 새 salt 16바이트
 * - 암호화: AES-GCM 256비트, 파일마다 새 IV 12바이트, 인증 태그 16바이트(암호문 뒤에 붙는다)
 * - 평문: 지금의 백업 JSON 문자열(serializeBackup 결과) 그대로. 풀고 나면 parseBackup 검증을 그대로 거친다.
 *
 * 컨테이너(JSON):
 * {"app":"hobong","format":"hobong-encrypted","version":1,
 *  "kdf":{"name":"PBKDF2","hash":"SHA-256","iterations":600000,"salt":"<base64>"},
 *  "cipher":{"name":"AES-GCM","iv":"<base64>"},
 *  "data":"<base64(암호문 + 태그)>"}
 * 추가 인증 데이터(additionalData)는 쓰지 않는다. 다른 도구로도 위 값만으로 풀 수 있다.
 * 머리 값(반복 횟수·salt)을 바꾸면 열쇠가 달라져 어차피 풀리지 않는다.
 *
 * 암호와 오류 객체는 어디에도 남기지 않는다(저장소·콘솔 모두). 실패는 코드로만 돌려준다.
 * 아래 숫자는 보안 정책 값이며 법령 수치가 아니다.
 */
import { MAX_BACKUP_BYTES } from './backup.ts';

export const ENCRYPTED_FORMAT = 'hobong-encrypted';
export const ENCRYPTED_VERSION = 1;
/** OWASP Password Storage Cheat Sheet(2023): PBKDF2-HMAC-SHA256 600,000회 */
export const KDF_ITERATIONS = 600_000;
/** 읽을 때 받아들이는 반복 횟수 범위(너무 작으면 약하고, 너무 크면 화면이 멈춘다) */
export const KDF_MIN_ITERATIONS = 100_000;
export const KDF_MAX_ITERATIONS = 10_000_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
const TAG_BYTES = 16;
/** 앱이 정한 최소 길이(글자 수, NFC 기준) */
export const MIN_PASSWORD_LENGTH = 8;
/** 평문 한 글자는 UTF-8로 최대 3바이트 */
const MAX_PLAIN_UTF8_BYTES = MAX_BACKUP_BYTES * 3;
const MAX_DATA_BYTES = MAX_PLAIN_UTF8_BYTES + TAG_BYTES;
/** 암호 파일의 최대 크기(base64 로 늘어난 암호문 + 머리 몫) */
export const MAX_ENCRYPTED_BYTES = Math.ceil((MAX_DATA_BYTES * 4) / 3) + 4096;

export interface EncryptedBackup {
  app: 'hobong';
  format: typeof ENCRYPTED_FORMAT;
  version: typeof ENCRYPTED_VERSION;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  /** base64(암호문 + 16바이트 태그) */
  data: string;
}

export type LockError =
  /** crypto.subtle 이 없다(안전하지 않은 http:// 등) */
  | 'unsupported'
  /** JSON 이 아니거나 필드·이름·base64·길이가 맞지 않는다 */
  | 'format'
  /** 반복 횟수가 정수가 아니거나 허용 범위 밖이다 */
  | 'iterations'
  /** 더 새 버전의 컨테이너다 */
  | 'newer'
  /** AES-GCM 인증 실패(틀린 암호와 손상을 구별할 수 없다) */
  | 'wrong-or-damaged'
  /** 암호화할 때 암호가 너무 짧다 */
  | 'too-short';

type Bytes = Uint8Array<ArrayBuffer>;

export type ReadResult =
  | { ok: true; iterations: number; salt: Bytes; iv: Bytes; data: Bytes }
  | { ok: false; code: 'format' | 'iterations' | 'newer' };

/**
 * 이 브라우저(또는 넘겨준 Crypto)에서 암호를 걸고 풀 수 있는지.
 * 인자를 주지 않으면 globalThis.crypto 를 보고, undefined 를 직접 넘기면 그것을 본다.
 */
export function canEncrypt(...given: [c?: Crypto | undefined]): boolean {
  try {
    const c = given.length > 0 ? given[0] : globalThis.crypto;
    return (
      !!c &&
      typeof c.getRandomValues === 'function' &&
      !!c.subtle &&
      typeof c.subtle.deriveKey === 'function' &&
      typeof c.subtle.importKey === 'function' &&
      typeof c.subtle.encrypt === 'function' &&
      typeof c.subtle.decrypt === 'function'
    );
  } catch {
    return false;
  }
}

function parseObject(text: string): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.length > MAX_ENCRYPTED_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\ufeff/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 암호가 걸린 호봉 백업처럼 보이는지(형식이 온전한지는 readEncrypted 가 본다) */
export function looksEncrypted(text: string): boolean {
  const obj = parseObject(text);
  return !!obj && obj.app === 'hobong' && obj.format === ENCRYPTED_FORMAT;
}

/** 컨테이너의 형식·길이·반복 횟수를 검사하고 바이트로 푼다(아직 암호는 쓰지 않는다) */
export function readEncrypted(text: string): ReadResult {
  const obj = parseObject(text);
  if (!obj || obj.app !== 'hobong' || obj.format !== ENCRYPTED_FORMAT) {
    return { ok: false, code: 'format' };
  }
  if (typeof obj.version === 'number' && Number.isInteger(obj.version)) {
    if (obj.version > ENCRYPTED_VERSION) return { ok: false, code: 'newer' };
    if (obj.version !== ENCRYPTED_VERSION) return { ok: false, code: 'format' };
  } else {
    return { ok: false, code: 'format' };
  }
  const { kdf, cipher } = obj;
  if (!isObject(kdf) || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') {
    return { ok: false, code: 'format' };
  }
  if (!isObject(cipher) || cipher.name !== 'AES-GCM') return { ok: false, code: 'format' };
  const iterations = kdf.iterations;
  if (
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < KDF_MIN_ITERATIONS ||
    iterations > KDF_MAX_ITERATIONS
  ) {
    return { ok: false, code: 'iterations' };
  }
  const salt = typeof kdf.salt === 'string' ? fromBase64(kdf.salt) : null;
  const iv = typeof cipher.iv === 'string' ? fromBase64(cipher.iv) : null;
  const data = typeof obj.data === 'string' ? fromBase64(obj.data) : null;
  if (
    !salt ||
    salt.length !== SALT_BYTES ||
    !iv ||
    iv.length !== IV_BYTES ||
    !data ||
    data.length < TAG_BYTES ||
    data.length > MAX_DATA_BYTES
  ) {
    return { ok: false, code: 'format' };
  }
  return { ok: true, iterations, salt, iv, data };
}

function bytes(length: number): Bytes {
  return new Uint8Array(new ArrayBuffer(length));
}

function encodeUtf8(text: string): Bytes {
  const encoded = new TextEncoder().encode(text);
  const out = bytes(encoded.length);
  out.set(encoded);
  return out;
}

/** 암호의 글자 수(NFC 로 맞춘 뒤 코드 포인트 단위: 한글 한 글자·이모지 하나가 한 글자) */
export function passwordLength(password: string): number {
  return Array.from(password.normalize('NFC')).length;
}

async function deriveKey(
  c: Crypto,
  password: string,
  salt: Bytes,
  iterations: number,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  // 같은 글자를 다른 방식(NFD 등)으로 입력해도 같은 열쇠가 되게 NFC 로 맞춘다.
  const base = await c.subtle.importKey(
    'raw',
    encodeUtf8(password.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return c.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/** 백업 글자에 암호를 건다. 결과는 컨테이너 JSON 글자 */
export async function encryptBackup(
  plain: string,
  password: string,
  opts: { crypto?: Crypto; iterations?: number } = {},
): Promise<
  { ok: true; text: string } | { ok: false; code: 'unsupported' | 'too-short' | 'format' }
> {
  const c = opts.crypto ?? globalThis.crypto;
  if (!canEncrypt(c)) return { ok: false, code: 'unsupported' };
  if (typeof password !== 'string' || passwordLength(password) < MIN_PASSWORD_LENGTH) {
    return { ok: false, code: 'too-short' };
  }
  if (typeof plain !== 'string' || plain.length === 0 || plain.length > MAX_BACKUP_BYTES) {
    return { ok: false, code: 'format' };
  }
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  if (
    !Number.isInteger(iterations) ||
    iterations < KDF_MIN_ITERATIONS ||
    iterations > KDF_MAX_ITERATIONS
  ) {
    return { ok: false, code: 'format' };
  }
  try {
    const salt = c.getRandomValues(bytes(SALT_BYTES));
    const iv = c.getRandomValues(bytes(IV_BYTES));
    const key = await deriveKey(c, password, salt, iterations, 'encrypt');
    const sealed = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodeUtf8(plain));
    const container: EncryptedBackup = {
      app: 'hobong',
      format: ENCRYPTED_FORMAT,
      version: ENCRYPTED_VERSION,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
      cipher: { name: 'AES-GCM', iv: toBase64(iv) },
      data: toBase64(new Uint8Array(sealed)),
    };
    return { ok: true, text: `${JSON.stringify(container, null, 2)}\n` };
  } catch {
    // 오류 내용(암호가 담길 수 있는 곳)은 남기지 않는다
    return { ok: false, code: 'unsupported' };
  }
}

/** 암호를 풀어 백업 글자(평문)를 돌려준다. 평문은 호출한 쪽이 parseBackup 으로 검증한다 */
export async function decryptBackup(
  text: string,
  password: string,
  opts: { crypto?: Crypto } = {},
): Promise<{ ok: true; plain: string } | { ok: false; code: LockError }> {
  const c = opts.crypto ?? globalThis.crypto;
  const read = readEncrypted(text);
  if (!read.ok) return read;
  if (!canEncrypt(c)) return { ok: false, code: 'unsupported' };
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, code: 'wrong-or-damaged' };
  }
  let key: CryptoKey;
  try {
    key = await deriveKey(c, password, read.salt, read.iterations, 'decrypt');
  } catch {
    return { ok: false, code: 'unsupported' };
  }
  let opened: ArrayBuffer;
  try {
    opened = await c.subtle.decrypt({ name: 'AES-GCM', iv: read.iv }, key, read.data);
  } catch {
    return { ok: false, code: 'wrong-or-damaged' };
  }
  try {
    return { ok: true, plain: new TextDecoder('utf-8', { fatal: true }).decode(opened) };
  } catch {
    return { ok: false, code: 'wrong-or-damaged' };
  }
}

const CHUNK = 0x8000;

/** 바이트 → base64(큰 배열도 호출 스택이 넘치지 않게 조각으로 나눈다) */
export function toBase64(input: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < input.length; i += CHUNK) {
    binary += String.fromCharCode(...input.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 → 바이트. 표준 알파벳·올바른 패딩이 아니면 null */
export function fromBase64(text: string): Bytes | null {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const out = bytes(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
