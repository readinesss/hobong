/**
 * 번들 글꼴(WOFF2)의 형식 검사.
 * glyf/loca 변환(transform)을 한 큰 WOFF2 는 WebKit(Safari 엔진)이 해독하지 못하는 경우가 있어
 * (CI 의 WebKit 에서 확인), 변환 없이(null transform) 저장한 것만 받는다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FONTS = join(import.meta.dirname, '..', '..', 'src', 'assets', 'fonts');

/** WOFF2 표 목록에서 표마다 변환 버전을 읽는다(알려진 표 번호 10 = glyf, 11 = loca) */
function tableTransforms(bytes: Uint8Array): Map<number | string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = String.fromCharCode(...bytes.slice(0, 4));
  if (signature !== 'wOF2') throw new Error(`WOFF2 가 아님: ${signature}`);
  const numTables = view.getUint16(12);
  let offset = 48;
  const readBase128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = bytes[offset] ?? 0;
      offset += 1;
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('UIntBase128 이 너무 길다');
  };
  const out = new Map<number | string, number>();
  for (let t = 0; t < numTables; t += 1) {
    const flags = bytes[offset] ?? 0;
    offset += 1;
    const index = flags & 0x3f;
    const version = flags >> 6;
    let key: number | string = index;
    if (index === 63) {
      key = String.fromCharCode(...bytes.slice(offset, offset + 4));
      offset += 4;
    }
    readBase128(); // origLength
    const isGlyfOrLoca = index === 10 || index === 11;
    const transformed = isGlyfOrLoca ? version !== 3 : version !== 0;
    if (transformed) readBase128(); // transformLength
    out.set(key, version);
  }
  return out;
}

describe('번들 글꼴', () => {
  for (const name of ['Galmuri14.subset.woff2', 'Galmuri11.subset.woff2']) {
    it(`${name}: glyf·loca 를 변환하지 않은 WOFF2 다(WebKit 호환)`, () => {
      const bytes = new Uint8Array(readFileSync(join(FONTS, name)));
      const transforms = tableTransforms(bytes);
      expect(transforms.get(10), 'glyf 변환 버전').toBe(3);
      expect(transforms.get(11), 'loca 변환 버전').toBe(3);
    });
  }
});
