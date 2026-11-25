/**
 * 공유 카드. 화면을 캡처하지 않고 캔버스에 직접 그린다.
 *
 * 카드는 270픽셀 폭의 "논리 픽셀" 격자에 그리고 정수 배율로 확대한다(4배 = 1080px).
 * 글자는 픽셀 폰트의 격자 배수(12·15·30)만 쓰고 정수 좌표에 놓아 흐려지지 않게 한다.
 * 금액 같은 민감 항목은 호출한 쪽이 켰을 때만 model에 들어온다.
 */
import type { Tier } from '../achievements.ts';
import { paintPose, poseOf } from '../character/draw.ts';
import type { Look } from '../character/look.ts';
import { characterRules } from '../character/rules.ts';
import { getSprite } from '../character/sprites.ts';
import { TRANSPARENT } from '../character/sprite-format.ts';
import type { CardRatio } from '../store/schema.ts';

export interface CardModel {
  nickname: string;
  grade: number;
  step: number;
  maxStep: number;
  formName: string;
  look: Look;
  /** 호봉이의 한마디 */
  line: string;
  /** '2026. 11. 25.' */
  dateText: string;
  /** 다음 승급까지(최고 호봉이면 null) */
  raise: { ratio: number; dday: string } | null;
  /** 켠 항목만 들어온다: '재직 4년 2개월', '정년 D-10,810', '월 봉급 2,226,100원' */
  facts: string[];
  /** 켰을 때만: 최근 뱃지 */
  badges: { icon: string; tier: Tier }[];
  badgeCount: number;
  siteName: string;
  siteTagline: string;
  siteUrl: string;
}

export const CARD_SIZES: Record<CardRatio, { w: number; h: number }> = {
  square: { w: 270, h: 270 },
  portrait: { w: 270, h: 405 },
};

/** 내보내는 이미지의 확대 배율(270 × 4 = 1080px) */
export const EXPORT_SCALE = 4;

const P = characterRules.palette;
const INK = P[0] as string;
const NAVY = P[8] as string;
const BLUE = P[9] as string;
const WHITE = P[12] as string;
const GOLD = P[4] as string;
const ORANGE = P[3] as string;
const MUTED = '#4b5f79';
const DESK = '#dbe3ea';
const PANEL = '#f4f4f4';
const PANEL2 = '#e4eaef';
const SHADOW = '#94b0c2';
const SKY = '#cfe0ea';
const GROUND = '#a7c2d2';
const TIER_FILL: Record<Tier, string> = { bronze: '#f1c9a5', silver: '#cfdbe4', gold: GOLD };

const FONT_BODY = "'Galmuri14', sans-serif";
const FONT_CAP = "'Galmuri11', 'Galmuri14', sans-serif";

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** 모서리가 한 칸 접힌 도트 테두리(안쪽을 채우고 바깥에 u 두께의 막대 네 개) */
function frame(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  u = 2,
  line = INK,
): void {
  rect(ctx, x, y, w, h, fill);
  rect(ctx, x, y - u, w, u, line);
  rect(ctx, x, y + h, w, u, line);
  rect(ctx, x - u, y, u, h, line);
  rect(ctx, x + w, y, u, h, line);
}

function setFont(ctx: Ctx, size: 12 | 15 | 24 | 30): void {
  ctx.font = `${size}px ${size === 12 || size === 24 ? FONT_CAP : FONT_BODY}`;
  ctx.textBaseline = 'alphabetic';
}

/** 글자 한 줄. (x, y)는 글자 칸의 왼쪽 위. 그린 폭을 돌려준다 */
function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: 12 | 15 | 24 | 30,
  color: string,
  align: 'left' | 'right' | 'center' = 'left',
): number {
  setFont(ctx, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  // Galmuri의 기준선은 글자 칸 위에서 (size × 0.8)만큼 아래에 있다.
  ctx.fillText(value, Math.round(x), Math.round(y + size * 0.8));
  return ctx.measureText(value).width;
}

function widthOf(ctx: Ctx, value: string, size: 12 | 15 | 24 | 30): number {
  setFont(ctx, size);
  return ctx.measureText(value).width;
}

/** 폭에 맞게 뒤를 줄인다 */
function fit(ctx: Ctx, value: string, size: 12 | 15 | 24 | 30, max: number): string {
  if (widthOf(ctx, value, size) <= max) return value;
  const chars = [...value];
  while (chars.length > 1 && widthOf(ctx, `${chars.join('')}…`, size) > max) chars.pop();
  return `${chars.join('')}…`;
}

/** 16×16 아이콘을 픽셀 그대로 그린다(색 0은 ink로) */
function icon(ctx: Ctx, name: string, x: number, y: number, scale = 1, ink = INK): void {
  const sprite = getSprite(name);
  if (!sprite) return;
  const px = sprite.frames[0] as Uint8Array;
  for (let j = 0; j < sprite.h; j += 1) {
    for (let i = 0; i < sprite.w; i += 1) {
      const v = px[j * sprite.w + i] as number;
      if (v === TRANSPARENT) continue;
      rect(ctx, x + i * scale, y + j * scale, scale, scale, v === 0 ? ink : (P[v] as string));
    }
  }
}

/** 칸 단위로 채우는 진행 막대 */
function bar(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  cells: number,
  fill: string,
): void {
  frame(ctx, x, y, w, h, PANEL2);
  const clamped = Math.min(1, Math.max(0, ratio));
  const filled =
    clamped <= 0
      ? 0
      : clamped >= 1
        ? cells
        : Math.min(cells - 1, Math.max(1, Math.round(clamped * cells)));
  const cell = w / cells;
  for (let i = 0; i < filled; i += 1) {
    const x0 = Math.round(x + i * cell);
    const x1 = Math.round(x + (i + 1) * cell);
    rect(ctx, x0, y, x1 - x0 - 1, h, fill);
  }
}

/** 여러 항목을 ' · '로 이어 폭 안에 들어가는 줄들로 나눈다 */
function packFacts(ctx: Ctx, facts: string[], max: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const fact of facts) {
    const next = current ? `${current} · ${fact}` : fact;
    if (current && widthOf(ctx, next, 12) > max) {
      lines.push(current);
      current = fact;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines).map((line) => fit(ctx, line, 12, max));
}

function badgeRow(ctx: Ctx, model: CardModel, x: number, y: number, max: number): void {
  const size = 20;
  const gap = 4;
  const room = Math.max(1, Math.floor((max - 30) / (size + gap)));
  const shown = model.badges.slice(0, room);
  shown.forEach((badge, i) => {
    const bx = x + 2 + i * (size + gap);
    frame(ctx, bx, y + 2, size, size, TIER_FILL[badge.tier]);
    icon(ctx, badge.icon, bx + 2, y + 4, 1);
  });
  const rest = model.badgeCount - shown.length;
  if (rest > 0) text(ctx, `+${rest}`, x + 4 + shown.length * (size + gap), y + 6, 12, MUTED);
}

function stage(
  ctx: Ctx,
  model: CardModel,
  x: number,
  y: number,
  w: number,
  h: number,
  withBubble: boolean,
): void {
  frame(ctx, x, y, w, h, SKY);
  rect(ctx, x, y + h - 18, w, 18, GROUND);
  const pose = poseOf(model.look, { tick: 0 });
  const spriteScale = 3;
  const sw = 48 * spriteScale;
  if (pose) paintPose(ctx, pose, x + Math.floor((w - sw) / 2), y + h - sw - 2, spriteScale);
  if (withBubble) {
    const line = fit(ctx, model.line, 12, w - 28);
    const tw = Math.ceil(widthOf(ctx, line, 12));
    const bw = tw + 14;
    const bx = x + Math.floor((w - bw) / 2);
    frame(ctx, bx, y + 8, bw, 20, WHITE);
    rect(ctx, x + Math.floor(w / 2) - 2, y + 28, 4, 2, WHITE);
    rect(ctx, x + Math.floor(w / 2) - 4, y + 28, 2, 2, INK);
    rect(ctx, x + Math.floor(w / 2) + 2, y + 28, 2, 2, INK);
    rect(ctx, x + Math.floor(w / 2) - 2, y + 30, 4, 2, INK);
    text(ctx, line, bx + 7, y + 12, 12, INK);
  }
}

function chip(ctx: Ctx, label: string, x: number, y: number): number {
  const w = Math.ceil(widthOf(ctx, label, 12)) + 10;
  frame(ctx, x + 2, y + 2, w, 16, BLUE);
  text(ctx, label, x + 7, y + 4, 12, WHITE);
  return w + 4;
}

/**
 * 카드를 그린다. ctx의 캔버스는 (CARD_SIZES[ratio] × scale) 크기여야 한다.
 */
export function drawCard(ctx: Ctx, model: CardModel, ratio: CardRatio, scale: number): void {
  const { w: W, h: H } = CARD_SIZES[ratio];
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // 바탕과 카드 창
  rect(ctx, 0, 0, W, H, DESK);
  const px = 8;
  const py = 8;
  const pw = W - 18;
  const ph = H - 18;
  rect(ctx, px + 2, py + 4, pw, ph, SHADOW);
  rect(ctx, px + 4, py + 2, pw, ph, SHADOW);
  frame(ctx, px, py, pw, ph, PANEL);

  // 제목 줄
  rect(ctx, px, py, pw, 22, NAVY);
  icon(ctx, 'icon-tiger', px + 4, py + 3, 1, INK);
  text(ctx, `${model.siteName}이 카드`, px + 24, py + 5, 12, WHITE);
  text(ctx, model.dateText, px + pw - 6, py + 5, 12, WHITE, 'right');

  const left = px + 8;
  const right = px + pw - 8;
  const inner = right - left;
  const footerH = 20;
  const footerY = py + ph - footerH;

  let y: number;
  if (ratio === 'square') {
    // 왼쪽 무대 + 오른쪽 요약
    const stageW = 150;
    const stageH = 150;
    stage(ctx, model, left + 2, py + 30, stageW - 4, stageH, false);
    const cx = left + stageW + 6;
    const cw = right - cx;
    let cy = py + 28;
    chip(ctx, model.formName, cx - 2, cy);
    cy += 27;
    // 두 자리 호봉("14호봉")은 큰 글자로는 오른쪽 칸을 넘친다. 넘치면 두 줄 모두 한 단계 작게 쓴다.
    const stepText = `${model.step}호봉`;
    const big: 24 | 30 = widthOf(ctx, stepText, 30) <= cw ? 30 : 24;
    text(ctx, `${model.grade}급`, cx, cy, big, INK);
    cy += big + 4;
    text(ctx, stepText, cx, cy, big, INK);
    cy += big + 8;
    text(ctx, `깃 ${model.step}/${model.maxStep}`, cx, cy, 12, MUTED);
    cy += 18;
    if (model.raise) {
      text(ctx, `승급 ${model.raise.dday}`, cx, cy, 12, INK);
      cy += 18;
      bar(ctx, cx + 2, cy, cw - 4, 8, model.raise.ratio, 10, GOLD);
    } else {
      text(ctx, '최고 호봉', cx, cy, 12, INK);
    }
    y = py + 30 + stageH + 8;
    text(ctx, fit(ctx, model.nickname, 15, inner), left, y, 15, INK);
    y += 20;
  } else {
    // 위쪽 넓은 무대 + 아래 정보
    stage(ctx, model, left + 2, py + 30, inner - 4, 168, true);
    y = py + 30 + 168 + 8;
    const chipW = chip(ctx, model.formName, left, y);
    text(ctx, fit(ctx, model.nickname, 15, inner - chipW - 4), left + chipW + 4, y + 1, 15, INK);
    y += 27;
    text(ctx, `${model.grade}급 ${model.step}호봉`, left, y, 30, INK);
    y += 38;
    // 깃 게이지
    const pipW = 5;
    const pipGap = 2;
    const perRow = Math.floor((inner + pipGap) / (pipW + pipGap));
    for (let i = 0; i < model.maxStep; i += 1) {
      const rx = left + (i % perRow) * (pipW + pipGap);
      const ry = y + Math.floor(i / perRow) * 10;
      rect(ctx, rx, ry, pipW, 8, i < model.step ? ORANGE : SHADOW);
      rect(ctx, rx + 1, ry + 1, pipW - 2, 6, i < model.step ? GOLD : PANEL2);
    }
    y += Math.ceil(model.maxStep / perRow) * 10 + 4;
    if (model.raise) {
      text(ctx, '다음 승급까지', left, y, 12, MUTED);
      text(ctx, model.raise.dday, right, y, 12, INK, 'right');
      y += 18;
      bar(ctx, left + 2, y, inner - 4, 8, model.raise.ratio, 20, GOLD);
      y += 16;
    } else {
      text(ctx, '최고 호봉에 올랐어요', left, y, 12, MUTED);
      y += 20;
    }
  }

  // 켠 항목과 뱃지: 남은 높이만큼만
  const rowsLeft = () => Math.floor((footerY - 4 - y) / 18);
  const wantBadges = model.badges.length > 0;
  const factLines = packFacts(
    ctx,
    model.facts,
    inner,
    Math.max(0, rowsLeft() - (wantBadges && rowsLeft() > 1 ? 1 : 0)),
  );
  for (const line of factLines) {
    text(ctx, line, left, y, 12, MUTED);
    y += 18;
  }
  if (wantBadges && footerY - 4 - y >= 24) {
    badgeRow(ctx, model, left, y, inner);
    y += 26;
  }
  if (ratio === 'square' && footerY - 4 - y >= 18 && factLines.length === 0 && !wantBadges) {
    text(ctx, fit(ctx, `"${model.line}"`, 12, inner), left, y, 12, MUTED);
  }

  // 아래: 서비스 이름과 주소
  rect(ctx, px, footerY, pw, footerH, NAVY);
  const urlWidth = widthOf(ctx, model.siteUrl, 12);
  const brand = `${model.siteName} · ${model.siteTagline}`;
  const brandFits = widthOf(ctx, brand, 12) + urlWidth + 24 <= pw;
  text(ctx, brandFits ? brand : model.siteName, px + 8, footerY + 4, 12, WHITE);
  text(ctx, model.siteUrl, px + pw - 8, footerY + 4, 12, GOLD, 'right');

  ctx.restore();
}

/** 이미지가 막힌 메신저용 글자 카드(금액은 넣지 않는다) */
export function textCard(model: CardModel, cells = 10): string {
  const lines = [
    `[${model.siteName}] ${model.nickname} · ${model.formName}`,
    `${model.grade}급 ${model.step}호봉`,
  ];
  if (model.raise) {
    const filled = Math.round(Math.min(1, Math.max(0, model.raise.ratio)) * cells);
    lines.push(
      `다음 승급 ${'■'.repeat(filled)}${'□'.repeat(cells - filled)} ${Math.round(model.raise.ratio * 100)}% (${model.raise.dday})`,
    );
  }
  for (const fact of model.facts) {
    if (!fact.includes('봉급')) lines.push(fact);
  }
  lines.push(model.siteUrl);
  return lines.join('\n');
}

/** 카드를 그리기 전에 폰트가 준비됐는지 확인한다 */
export async function ensureCardFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load("15px 'Galmuri14'", '호봉 0'),
      document.fonts.load("12px 'Galmuri11'", '호봉 0'),
    ]);
  } catch {
    // 폰트를 못 불러와도 기본 글꼴로 그린다
  }
}
