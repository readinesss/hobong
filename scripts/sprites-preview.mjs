// 스프라이트 미리보기: 텍스트 스프라이트를 PNG로 그려 눈으로 확인한다.
//
//   node scripts/sprites-preview.mjs                       전체 목록(콘택트 시트)
//   node scripts/sprites-preview.mjs --compose body-egg,eyes-open,item-lanyard
//   옵션: --out <파일.png>  --scale <정수>  --bg <#rrggbb|checker>  --frame <n>
//         --remap 9:2,a:3   (합성 시 팔레트 인덱스 치환, 16진수)
//         --only char-,icons (이 접두사로 시작하는 파일만 읽는다)
//         --cell 16          (콘택트 시트 한 칸의 픽셀 크기, 기본 48)
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSprites, buildSpriteIndex, TRANSPARENT } from '../src/lib/character/sprite-format.ts';
import { compose } from '../src/lib/character/compose.ts';
import { encodePng } from './lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPRITE_DIR = join(ROOT, 'src/assets/sprites');
const CANVAS = 48;

const DEFAULT_PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
];

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function loadPalette() {
  const file = join(ROOT, 'data/character.json');
  if (existsSync(file)) {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(json.palette) && json.palette.length === 16) return json.palette;
  }
  return DEFAULT_PALETTE;
}

function loadSprites() {
  const only = (arg('only', '') || '').split(',').filter(Boolean);
  const groups = readdirSync(SPRITE_DIR)
    .filter((f) => f.endsWith('.txt'))
    .filter((f) => only.length === 0 || only.some((prefix) => f.startsWith(prefix)))
    .sort()
    .map((f) => parseSprites(readFileSync(join(SPRITE_DIR, f), 'utf8'), f));
  return buildSpriteIndex(groups);
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 인덱스 픽셀을 scale배로 확대해 RGBA 버퍼의 (ox, oy)에 그린다. */
function paint(target, tw, pixels, w, h, ox, oy, scale, palette, bg) {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = pixels[y * w + x];
      let rgb;
      if (v === TRANSPARENT) {
        if (bg === 'checker') rgb = (x + y) % 2 === 0 ? [222, 226, 230] : [240, 242, 245];
        else rgb = hexToRgb(bg);
      } else {
        rgb = hexToRgb(palette[v]);
      }
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const i = ((oy + y * scale + sy) * tw + ox + x * scale + sx) * 4;
          target[i] = rgb[0];
          target[i + 1] = rgb[1];
          target[i + 2] = rgb[2];
          target[i + 3] = 255;
        }
      }
    }
  }
}

const palette = loadPalette();
const sprites = loadSprites();
const scale = Number(arg('scale', '6'));
const bg = arg('bg', 'checker');
const out = arg('out', join(ROOT, '.preview/sprites.png'));
mkdirSync(dirname(out), { recursive: true });

const composeArg = arg('compose');
if (composeArg) {
  const names = composeArg.split(',').map((s) => s.trim());
  const remap = {};
  for (const pair of (arg('remap', '') || '').split(',').filter(Boolean)) {
    const [from, to] = pair.split(':');
    remap[parseInt(from, 16)] = parseInt(to, 16);
  }
  const frame = Number(arg('frame', '0'));
  const layers = names.map((name) => {
    const sprite = sprites.get(name);
    if (!sprite) throw new Error(`스프라이트 없음: ${name}`);
    return { sprite, frame, remap };
  });
  const comp = compose(layers, { w: CANVAS, h: CANVAS, body: layers[0].sprite });
  const size = CANVAS * scale;
  const rgba = new Uint8Array(size * size * 4);
  paint(rgba, size, comp.pixels, CANVAS, CANVAS, 0, 0, scale, palette, bg);
  writeFileSync(out, encodePng(size, size, rgba));
  console.log(`합성 미리보기: ${out} (${names.join(' + ')})`);
} else {
  // 콘택트 시트: 스프라이트·프레임마다 48×48 칸에 원점 기준으로 놓는다.
  const cells = [];
  for (const sprite of sprites.values()) {
    sprite.frames.forEach((frame, fi) => cells.push({ sprite, frame, fi }));
  }
  const cellPx = Number(arg('cell', String(CANVAS)));
  const cols = Math.min(cellPx <= 16 ? 12 : 8, Math.max(1, cells.length));
  const rows = Math.ceil(cells.length / cols);
  const gap = 2;
  const cell = cellPx * scale;
  const tw = cols * cell + (cols + 1) * gap;
  const th = rows * cell + (rows + 1) * gap;
  const rgba = new Uint8Array(tw * th * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 60;
    rgba[i + 1] = 64;
    rgba[i + 2] = 72;
    rgba[i + 3] = 255;
  }
  cells.forEach(({ sprite, frame }, i) => {
    const cx = gap + (i % cols) * (cell + gap);
    const cy = gap + Math.floor(i / cols) * (cell + gap);
    const blank = new Uint8Array(cellPx * cellPx).fill(TRANSPARENT);
    // 작은 부품은 칸 가운데에 놓는다(칸과 같은 크기면 그대로).
    const ox = Math.max(0, Math.floor((cellPx - sprite.w) / 2));
    const oy = Math.max(0, Math.floor((cellPx - sprite.h) / 2));
    for (let y = 0; y < sprite.h && y + oy < cellPx; y += 1) {
      for (let x = 0; x < sprite.w && x + ox < cellPx; x += 1) {
        blank[(y + oy) * cellPx + x + ox] = frame[y * sprite.w + x];
      }
    }
    paint(rgba, tw, blank, cellPx, cellPx, cx, cy, scale, palette, bg);
  });
  writeFileSync(out, encodePng(tw, th, rgba));
  console.log(`콘택트 시트: ${out} (${cols}열 × ${rows}행, 왼쪽 위부터)`);
  cells.forEach(({ sprite, fi }, i) => {
    const frames = sprite.frames.length > 1 ? ` [프레임 ${fi}]` : '';
    console.log(`  ${String(i + 1).padStart(2)}. (${Math.floor(i / cols) + 1}행 ${(i % cols) + 1}열) ${sprite.name}${frames}  ${sprite.w}×${sprite.h}`);
  });
}
