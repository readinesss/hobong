/* eslint-disable @typescript-eslint/no-explicit-any -- 일부러 틀린 컨테이너를 손으로 만든다 */
/**
 * 백업 파일 암호(#13).
 * - Node 22 의 globalThis.crypto(WebCrypto)로 실제 반복 횟수(600,000회)를 그대로 돌린다.
 * - 왕복, 파일마다 새 salt·IV, 틀린 암호·손상, 형식·반복 횟수 범위 검사, base64, NFC
 * - 푼 평문은 지금의 parseBackup 검증을 그대로 지난다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { careerLookup, rulesFor } from '../../src/lib/rules/index.ts';
import {
  backupFileName,
  makeEnvelope,
  parseBackup,
  serializeBackup,
  type ParseContext,
} from '../../src/lib/store/backup.ts';
import {
  canEncrypt,
  decryptBackup,
  encryptBackup,
  fromBase64,
  KDF_ITERATIONS,
  KDF_MAX_ITERATIONS,
  KDF_MIN_ITERATIONS,
  looksEncrypted,
  MAX_ENCRYPTED_BYTES,
  passwordLength,
  readEncrypted,
  toBase64,
} from '../../src/lib/store/crypto.ts';
import { defaultLook, defaultSettings, newUserData } from '../../src/lib/store/defaults.ts';
import { SCHEMA_VERSION, type UserData } from '../../src/lib/store/schema.ts';

const TODAY = '2026-11-25';
const NOW = '2026-11-25T01:00:00.000Z';
const R = rulesFor(2026);
const ctx: ParseContext = {
  today: TODAY,
  ...careerLookup(R),
  defaultSettings: defaultSettings(R),
  nowIso: NOW,
};
const PASSWORD = 'hobong-pass-1';

function sampleData(): UserData {
  const data = newUserData(
    {
      nickname: '백업이',
      birthDate: '1995-05-20',
      hireDate: '2020-01-01',
      track: 'general',
      series: null,
      payTable: 'table3',
      rank: '8',
      rankDate: '2024-07-01',
      step: 6,
      nextStepDate: '2027-01-01',
      stepAsOf: TODAY,
      overrides: { longServiceDate: null, seniorDate: null, rankLimitDate: null },
    },
    defaultSettings(R),
    NOW,
    TODAY,
  );
  data.leave = {
    records: [{ id: 'a1', date: '2026-03-03', hours: 8, kind: 'day', memo: '가족 여행' }],
    grantOverrideHours: {},
  };
  return data;
}

const DATA = sampleData();
const PLAIN = serializeBackup(makeEnvelope(DATA, '0.1.0', NOW));

async function locked(password = PASSWORD, plain = PLAIN): Promise<string> {
  const result = await encryptBackup(plain, password);
  if (!result.ok) throw new Error(`암호화 실패: ${result.code}`);
  return result.text;
}

/** 컨테이너 JSON 을 고쳐 다시 글자로 만든다 */
function edit(text: string, change: (c: Record<string, any>) => void): string {
  const c = JSON.parse(text) as Record<string, any>;
  change(c);
  return JSON.stringify(c);
}

const b64 = (n: number) => toBase64(new Uint8Array(n).fill(7));

describe('암호 걸기 → 풀기', () => {
  it('왕복하면 평문이 그대로이고, 컨테이너에 정해진 머리 값이 있다', async () => {
    const text = await locked();
    const c = JSON.parse(text);
    expect(c).toMatchObject({
      app: 'hobong',
      format: 'hobong-encrypted',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 },
      cipher: { name: 'AES-GCM' },
    });
    expect(KDF_ITERATIONS).toBe(600_000);
    expect(Object.keys(c).sort()).toEqual(['app', 'cipher', 'data', 'format', 'kdf', 'version']);
    // 평문의 어떤 글자도 컨테이너에 드러나지 않는다
    expect(text).not.toContain('백업이');
    expect(text).not.toContain('가족 여행');
    expect(text).not.toContain('schemaVersion');
    expect(text).not.toContain(PASSWORD);
    expect(text.endsWith('\n')).toBe(true);
    expect(looksEncrypted(text)).toBe(true);
    expect(looksEncrypted(PLAIN)).toBe(false);

    const opened = await decryptBackup(text, PASSWORD);
    expect(opened).toEqual({ ok: true, plain: PLAIN });
  });

  it('푼 평문은 parseBackup 을 지나 원래 데이터와 같고, 컨테이너 자체는 "암호가 걸린 백업"으로 알아본다', async () => {
    const text = await locked();
    const opened = await decryptBackup(text, PASSWORD);
    if (!opened.ok) throw new Error(opened.code);
    const parsed = parseBackup(opened.plain, ctx);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toEqual(DATA);

    const direct = parseBackup(text, ctx);
    expect(direct).toMatchObject({ ok: false, code: 'encrypted' });
    if (!direct.ok) expect(direct.reason).toContain('암호가 걸린 백업');
  });

  it('예전(v3) 앱이 암호를 건 백업도 풀린 뒤 같은 변환을 거쳐 지금 버전으로 열린다', async () => {
    const v3 = readFileSync(join(process.cwd(), 'tests/fixtures/backup-v3.json'), 'utf8');
    const opened = await decryptBackup(await locked(PASSWORD, v3), PASSWORD);
    expect(opened).toEqual({ ok: true, plain: v3 });
    if (!opened.ok) return;
    const parsed = parseBackup(opened.plain, ctx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fromVersion).toBe(3);
    expect(parsed.migrated).toBe(true);
    // 평문 v3 파일을 불러온 것과 같다
    expect(parsed.data).toEqual((parseBackup(v3, ctx) as { data: UserData }).data);
    expect(parsed.data.profile).toMatchObject({
      track: 'general',
      payTable: 'table3',
      rank: '7',
      rankDate: '2021-07-01',
    });
    expect(serializeBackup(makeEnvelope(parsed.data, '0.1.0', NOW))).toContain(
      `"schemaVersion": ${SCHEMA_VERSION}`,
    );
  });

  it('v4 앱이 암호를 건 백업도 풀린 뒤 v5 기본값(직렬 없음·기본 모습·소리 끔)을 더해 열린다', async () => {
    const v4 = readFileSync(join(process.cwd(), 'tests/fixtures/backup-v4-police.json'), 'utf8');
    const opened = await decryptBackup(await locked(PASSWORD, v4), PASSWORD);
    expect(opened).toEqual({ ok: true, plain: v4 });
    if (!opened.ok) return;
    const parsed = parseBackup(opened.plain, ctx);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fromVersion).toBe(4);
    expect(parsed.migrated).toBe(true);
    expect(parsed.data).toEqual((parseBackup(v4, ctx) as { data: UserData }).data);
    expect(parsed.data.profile).toMatchObject({ track: 'police', rank: '경위', series: null });
    expect(parsed.data.character.look).toEqual(defaultLook());
    expect(parsed.data.settings).toMatchObject({
      identity: { showSeriesHome: true },
      haptics: true,
      sound: { sfx: false, bgm: false },
      pointer: 'pixel',
      sparkles: true,
      card: { showSeries: false, showRank: false },
    });
  });

  it('v5 백업(꾸미기·직렬·소리 설정)도 암호를 걸고 풀어 그대로 열린다', async () => {
    const v5 = readFileSync(join(process.cwd(), 'tests/fixtures/backup-v5.json'), 'utf8');
    const opened = await decryptBackup(await locked(PASSWORD, v5), PASSWORD);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const parsed = parseBackup(opened.plain, ctx);
    expect(parsed.ok && parsed.migrated).toBe(false);
    expect(parsed.ok && parsed.data).toEqual(JSON.parse(v5).data);
  });

  it('같은 평문·암호라도 파일마다 salt·IV·암호문이 모두 다르다(salt 16바이트, IV 12바이트)', async () => {
    const a = JSON.parse(await locked());
    const b = JSON.parse(await locked());
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
    expect(fromBase64(a.kdf.salt)?.length).toBe(16);
    expect(fromBase64(a.cipher.iv)?.length).toBe(12);
    // 암호문 = 평문 바이트 + 16바이트 태그
    expect(fromBase64(a.data)?.length).toBe(new TextEncoder().encode(PLAIN).length + 16);
  });

  it('잠근 파일 이름은 -locked.json 이다(불러오기의 .json 필터를 그대로 지난다)', () => {
    expect(backupFileName(TODAY, true)).toBe('hobong-backup-20261125-locked.json');
    expect(backupFileName(TODAY)).toBe('hobong-backup-20261125.json');
  });
});

describe('틀린 암호·손상', () => {
  it('틀린 암호는 wrong-or-damaged', async () => {
    const text = await locked();
    expect(await decryptBackup(text, 'hobong-pass-2')).toEqual({
      ok: false,
      code: 'wrong-or-damaged',
    });
    expect(await decryptBackup(text, '')).toEqual({ ok: false, code: 'wrong-or-damaged' });
  });

  it('암호문 한 바이트를 뒤집거나 태그를 자르면 wrong-or-damaged', async () => {
    const text = await locked();
    const flipped = edit(text, (c) => {
      const data = fromBase64(c.data)!;
      data[10] = (data[10] ?? 0) ^ 0x01;
      c.data = toBase64(data);
    });
    expect(await decryptBackup(flipped, PASSWORD)).toEqual({ ok: false, code: 'wrong-or-damaged' });

    const cut = edit(text, (c) => {
      const data = fromBase64(c.data)!;
      c.data = toBase64(data.subarray(0, data.length - 4));
    });
    expect(await decryptBackup(cut, PASSWORD)).toEqual({ ok: false, code: 'wrong-or-damaged' });
  });

  it('머리 값(salt·IV·반복 횟수)을 바꾸면 열쇠가 달라져 풀리지 않는다', async () => {
    const text = await locked();
    const salt = edit(text, (c) => (c.kdf.salt = b64(16)));
    const iv = edit(text, (c) => (c.cipher.iv = b64(12)));
    const iterations = edit(text, (c) => (c.kdf.iterations = 600_001));
    for (const changed of [salt, iv, iterations])
      expect(await decryptBackup(changed, PASSWORD)).toEqual({
        ok: false,
        code: 'wrong-or-damaged',
      });
  });
});

describe('형식 검사(암호를 쓰기 전에 거른다)', () => {
  it('JSON 아님·이름 다름·base64 아님·길이 틀림은 format, 새 버전은 newer', async () => {
    const text = await locked();
    const cases: [string, string][] = [
      ['JSON 아님', text.slice(0, 40)],
      ['배열', '[1,2,3]'],
      ['app 다름', edit(text, (c) => (c.app = 'other'))],
      ['format 다름', edit(text, (c) => (c.format = 'hobong'))],
      ['version 없음', edit(text, (c) => delete c.version)],
      ['version 0', edit(text, (c) => (c.version = 0))],
      ['version 문자열', edit(text, (c) => (c.version = '1'))],
      ['kdf 없음', edit(text, (c) => delete c.kdf)],
      ['kdf.name 다름', edit(text, (c) => (c.kdf.name = 'scrypt'))],
      ['kdf.hash 다름', edit(text, (c) => (c.kdf.hash = 'SHA-1'))],
      ['cipher.name 다름', edit(text, (c) => (c.cipher.name = 'AES-CBC'))],
      ['salt 15바이트', edit(text, (c) => (c.kdf.salt = b64(15)))],
      ['salt 숫자', edit(text, (c) => (c.kdf.salt = 16))],
      ['iv 16바이트', edit(text, (c) => (c.cipher.iv = b64(16)))],
      ['data 15바이트', edit(text, (c) => (c.data = b64(15)))],
      ['data 없음', edit(text, (c) => delete c.data)],
      ['base64 아닌 글자', edit(text, (c) => (c.data = `${c.data.slice(0, -4)}%%%%`))],
      ['base64 URL 알파벳', edit(text, (c) => (c.data = c.data.replace(/\+/g, '-')))],
    ];
    for (const [name, value] of cases) {
      // URL 알파벳 바꾸기는 + 가 없으면 바뀌지 않으므로 그 경우만 건너뛴다
      if (name === 'base64 URL 알파벳' && !/-/.test(JSON.parse(value).data)) continue;
      expect(readEncrypted(value), name).toEqual({ ok: false, code: 'format' });
      expect(await decryptBackup(value, PASSWORD), name).toEqual({ ok: false, code: 'format' });
    }
    const newer = edit(text, (c) => (c.version = 2));
    expect(readEncrypted(newer)).toEqual({ ok: false, code: 'newer' });
    expect(await decryptBackup(newer, PASSWORD)).toEqual({ ok: false, code: 'newer' });
  });

  it('너무 큰 글자는 읽지 않는다', () => {
    const huge = `{"app":"hobong","format":"hobong-encrypted","data":"${'A'.repeat(MAX_ENCRYPTED_BYTES)}"}`;
    expect(looksEncrypted(huge)).toBe(false);
    expect(readEncrypted(huge)).toEqual({ ok: false, code: 'format' });
  });

  it('반복 횟수가 정수가 아니거나 10만~1000만 밖이면 iterations', async () => {
    const text = await locked();
    for (const value of [99_999, 10_000_001, 600_000.5, '600000', -600_000, 0, null]) {
      const changed = edit(text, (c) => (c.kdf.iterations = value));
      expect(readEncrypted(changed), String(value)).toEqual({ ok: false, code: 'iterations' });
      expect(await decryptBackup(changed, PASSWORD)).toEqual({ ok: false, code: 'iterations' });
    }
    // 경계값은 받아들인다(1000만은 실제로 풀지 않고 형식 검사만 본다)
    expect(KDF_MIN_ITERATIONS).toBe(100_000);
    expect(KDF_MAX_ITERATIONS).toBe(10_000_000);
    const max = readEncrypted(edit(text, (c) => (c.kdf.iterations = 10_000_000)));
    expect(max).toMatchObject({ ok: true, iterations: 10_000_000 });
    const min = await encryptBackup(PLAIN, PASSWORD, { iterations: 100_000 });
    if (!min.ok) throw new Error(min.code);
    expect(JSON.parse(min.text).kdf.iterations).toBe(100_000);
    expect(await decryptBackup(min.text, PASSWORD)).toEqual({ ok: true, plain: PLAIN });
    // 쓰는 쪽도 범위 밖 반복 횟수로는 만들지 않는다
    expect(await encryptBackup(PLAIN, PASSWORD, { iterations: 1000 })).toEqual({
      ok: false,
      code: 'format',
    });
  });
});

describe('WebCrypto 를 쓸 수 없을 때', () => {
  it('canEncrypt 는 crypto·subtle 이 없으면 false', () => {
    expect(canEncrypt(globalThis.crypto)).toBe(true);
    expect(canEncrypt(undefined)).toBe(false);
    expect(canEncrypt({} as Crypto)).toBe(false);
    const noSubtle = {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    } as unknown as Crypto;
    expect(canEncrypt(noSubtle)).toBe(false);
  });

  it('subtle 이 없는 crypto 로는 걸지도 풀지도 않고 unsupported', async () => {
    const noSubtle = {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    } as unknown as Crypto;
    expect(await encryptBackup(PLAIN, PASSWORD, { crypto: noSubtle })).toEqual({
      ok: false,
      code: 'unsupported',
    });
    const text = await locked();
    expect(await decryptBackup(text, PASSWORD, { crypto: noSubtle })).toEqual({
      ok: false,
      code: 'unsupported',
    });
  });
});

describe('암호 글자', () => {
  it('8자 미만은 too-short, 글자 수는 한글·이모지를 한 글자로 센다', async () => {
    expect(await encryptBackup(PLAIN, 'abcdefg')).toEqual({ ok: false, code: 'too-short' });
    expect(await encryptBackup(PLAIN, '')).toEqual({ ok: false, code: 'too-short' });
    expect(passwordLength('호봉암호1234')).toBe(8);
    expect(passwordLength('🐯🐯🐯🐯🐯🐯🐯')).toBe(7);
    // NFD 로 쓴 한글은 자모가 나뉘어 길어 보이지만 NFC 로 맞춰 센다
    expect(passwordLength('호봉암호123'.normalize('NFD'))).toBe(7);
    expect(await encryptBackup(PLAIN, '호봉암호123'.normalize('NFD'))).toEqual({
      ok: false,
      code: 'too-short',
    });
    expect(await encryptBackup(PLAIN, '🐯🐯🐯🐯🐯🐯🐯')).toEqual({ ok: false, code: 'too-short' });
  });

  it('NFC 로 맞추므로 같은 한글 암호를 NFD 로 넣어도 열린다', async () => {
    const text = await locked('호봉암호1234');
    const nfd = '호봉암호1234'.normalize('NFD');
    expect(nfd).not.toBe('호봉암호1234');
    expect(await decryptBackup(text, nfd)).toEqual({ ok: true, plain: PLAIN });
  });

  it('빈 평문이나 너무 큰 평문은 걸지 않는다', async () => {
    expect(await encryptBackup('', PASSWORD)).toEqual({ ok: false, code: 'format' });
    expect(await encryptBackup('x'.repeat(2 * 1024 * 1024 + 1), PASSWORD)).toEqual({
      ok: false,
      code: 'format',
    });
  });
});

describe('base64', () => {
  it('200KB 무작위 바이트를 왕복한다(조각 처리로 호출 스택이 넘치지 않는다)', () => {
    const data = new Uint8Array(200 * 1024);
    for (let i = 0; i < data.length; i += 65_536)
      globalThis.crypto.getRandomValues(data.subarray(i, i + 65_536));
    const text = toBase64(data);
    expect(text).toBe(Buffer.from(data).toString('base64'));
    expect(fromBase64(text)).toEqual(data);
  });

  it('잘못된 패딩·알파벳·길이는 null', () => {
    expect(fromBase64('')).toEqual(new Uint8Array(0));
    expect(fromBase64('QUJD')).toEqual(new Uint8Array([65, 66, 67]));
    expect(fromBase64('QUI=')).toEqual(new Uint8Array([65, 66]));
    for (const bad of ['QUJ', 'QU=I', 'Q===', 'QUJD=', 'QU I=', 'QU-_', 'QUI=\n'])
      expect(fromBase64(bad), bad).toBeNull();
  });
});
