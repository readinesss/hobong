/** 번들에 포함된 스프라이트(src/assets/sprites/*.txt)를 읽어 이름으로 찾는다 */
import { buildSpriteIndex, parseSprites, TRANSPARENT, type Sprite } from './sprite-format.ts';

const files = import.meta.glob<string>('../../assets/sprites/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const sprites: ReadonlyMap<string, Sprite> = buildSpriteIndex(
  Object.entries(files)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, text]) => parseSprites(text, path.split('/').pop() ?? path)),
);

export function getSprite(name: string): Sprite | null {
  return sprites.get(name) ?? null;
}

export interface IconPath {
  /** 팔레트 인덱스. 0은 현재 글자색으로 그린다 */
  color: number;
  d: string;
}

const iconCache = new Map<string, { w: number; h: number; paths: IconPath[] } | null>();

/**
 * 아이콘 스프라이트를 SVG 경로로 바꾼다(색마다 경로 하나, 가로로 이어진 픽셀은 한 줄로 합친다).
 * SVG로 그리면 어떤 배율에서도 또렷하고 글자색을 따라간다.
 */
export function iconPaths(name: string): { w: number; h: number; paths: IconPath[] } | null {
  const cached = iconCache.get(name);
  if (cached !== undefined) return cached;
  const sprite = sprites.get(name);
  if (!sprite) {
    iconCache.set(name, null);
    return null;
  }
  const frame = sprite.frames[0] as Uint8Array;
  const byColor = new Map<number, string[]>();
  for (let y = 0; y < sprite.h; y += 1) {
    let x = 0;
    while (x < sprite.w) {
      const color = frame[y * sprite.w + x] as number;
      if (color === TRANSPARENT) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < sprite.w && frame[y * sprite.w + x + run] === color) run += 1;
      const list = byColor.get(color) ?? [];
      list.push(`M${x} ${y}h${run}v1h-${run}z`);
      byColor.set(color, list);
      x += run;
    }
  }
  const result = {
    w: sprite.w,
    h: sprite.h,
    paths: [...byColor].map(([color, segments]) => ({ color, d: segments.join('') })),
  };
  iconCache.set(name, result);
  return result;
}
