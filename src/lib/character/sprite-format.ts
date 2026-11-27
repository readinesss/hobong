/**
 * 스프라이트 텍스트 형식 파서.
 *
 * 한 글자가 한 픽셀이다. `.`은 투명, `0-9a-f`는 16색 팔레트 인덱스.
 * 그림은 src/assets/sprites/*.txt 에 사람이 직접 고칠 수 있는 형태로 둔다.
 *
 *   @name item-mug        스프라이트 시작(필수)
 *   @origin 2 6           기준점. 이 픽셀이 붙는 앵커 위치에 놓인다(기본 0 0)
 *   @attach handR         몸통의 어느 앵커에 붙는지(없으면 캔버스 원점)
 *   @layer 20             그리는 순서(작을수록 먼저, 음수는 몸통 뒤)
 *   @anchor eyes 24 21    (몸통 전용) 다른 부품이 붙을 좌표
 *   @skin                 (손 소품 전용) 소품을 쥔 날개 끝이 몸 색을 따른다. 날개 끝은 기준점 오른쪽
 *                         (x ≥ originX+1), 기준점 줄 위아래 2줄(|y − originY| ≤ 2) 안의 4·3 이다
 *                         (regions.ts skinSprite). 이 띠 밖의 4·3 은 소품 그림 색으로 남는다.
 *   @frame                프레임 구분(애니메이션용)
 *   # 주석
 */

export const TRANSPARENT = 255;
export const PALETTE_SIZE = 16;

export type Point = readonly [number, number];

export interface Sprite {
  name: string;
  w: number;
  h: number;
  origin: Point;
  attach: string | null;
  layer: number;
  anchors: Record<string, Point>;
  /** 소품을 쥔 날개 끝(기준점 오른쪽 띠의 4·3)이 몸 색을 따르는지(@skin) */
  skin: boolean;
  /** 프레임별 픽셀(행 우선). 값은 팔레트 인덱스 또는 TRANSPARENT */
  frames: Uint8Array[];
}

export class SpriteFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpriteFormatError';
  }
}

interface Draft {
  name: string;
  origin: Point;
  attach: string | null;
  layer: number;
  anchors: Record<string, Point>;
  skin: boolean;
  frames: string[][];
}

function toInt(value: string | undefined, where: string): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n)) {
    throw new SpriteFormatError(`${where}: 정수가 필요합니다 (받은 값: ${value ?? '없음'})`);
  }
  return n;
}

function finish(draft: Draft, label: string): Sprite {
  const where = `${label} @name ${draft.name}`;
  const frames = draft.frames.filter((rows) => rows.length > 0);
  const first = frames[0];
  if (!first) throw new SpriteFormatError(`${where}: 픽셀 행이 없습니다`);
  const h = first.length;
  const w = first[0]?.length ?? 0;
  const out: Uint8Array[] = [];
  frames.forEach((rows, fi) => {
    if (rows.length !== h) {
      throw new SpriteFormatError(
        `${where}: 프레임 ${fi}의 행 수(${rows.length})가 ${h}이 아닙니다`,
      );
    }
    const px = new Uint8Array(w * h);
    rows.forEach((row, y) => {
      if (row.length !== w) {
        throw new SpriteFormatError(
          `${where}: 프레임 ${fi} ${y}번째 행의 너비(${row.length})가 ${w}이 아닙니다`,
        );
      }
      for (let x = 0; x < w; x += 1) {
        const ch = row[x] as string;
        if (ch === '.') {
          px[y * w + x] = TRANSPARENT;
        } else {
          const v = parseInt(ch, 16);
          if (Number.isNaN(v) || !/^[0-9a-f]$/.test(ch)) {
            throw new SpriteFormatError(`${where}: 알 수 없는 픽셀 문자 '${ch}' (${x},${y})`);
          }
          px[y * w + x] = v;
        }
      }
    });
    out.push(px);
  });
  return {
    name: draft.name,
    w,
    h,
    origin: draft.origin,
    attach: draft.attach,
    layer: draft.layer,
    anchors: draft.anchors,
    skin: draft.skin,
    frames: out,
  };
}

/** 스프라이트 텍스트 한 덩어리(파일 하나)를 파싱한다. */
export function parseSprites(text: string, label = 'sprite'): Sprite[] {
  const sprites: Sprite[] = [];
  let draft: Draft | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('@')) {
      const [directive, ...args] = line.split(/\s+/);
      if (directive === '@name') {
        if (draft) sprites.push(finish(draft, label));
        const name = args[0];
        if (!name) throw new SpriteFormatError(`${label}: @name 뒤에 이름이 필요합니다`);
        draft = {
          name,
          origin: [0, 0],
          attach: null,
          layer: 0,
          anchors: {},
          skin: false,
          frames: [[]],
        };
        continue;
      }
      if (!draft) throw new SpriteFormatError(`${label}: ${directive}가 @name보다 먼저 나왔습니다`);
      const where = `${label} @name ${draft.name} ${directive}`;
      switch (directive) {
        case '@origin':
          draft.origin = [toInt(args[0], where), toInt(args[1], where)];
          break;
        case '@attach':
          if (!args[0]) throw new SpriteFormatError(`${where}: 앵커 이름이 필요합니다`);
          draft.attach = args[0];
          break;
        case '@layer':
          draft.layer = toInt(args[0], where);
          break;
        case '@anchor':
          if (!args[0]) throw new SpriteFormatError(`${where}: 앵커 이름이 필요합니다`);
          draft.anchors[args[0]] = [toInt(args[1], where), toInt(args[2], where)];
          break;
        case '@skin':
          draft.skin = true;
          break;
        case '@frame':
          if ((draft.frames[draft.frames.length - 1] as string[]).length > 0) draft.frames.push([]);
          break;
        default:
          throw new SpriteFormatError(`${where}: 알 수 없는 지시어`);
      }
      continue;
    }

    if (!draft) throw new SpriteFormatError(`${label}: 픽셀 행이 @name보다 먼저 나왔습니다`);
    (draft.frames[draft.frames.length - 1] as string[]).push(line);
  }

  if (draft) sprites.push(finish(draft, label));
  return sprites;
}

/** 여러 파일의 스프라이트를 이름으로 찾을 수 있게 모은다. 이름이 겹치면 오류. */
export function buildSpriteIndex(groups: Sprite[][]): Map<string, Sprite> {
  const index = new Map<string, Sprite>();
  for (const group of groups) {
    for (const sprite of group) {
      if (index.has(sprite.name)) {
        throw new SpriteFormatError(`스프라이트 이름이 중복됩니다: ${sprite.name}`);
      }
      index.set(sprite.name, sprite);
    }
  }
  return index;
}
