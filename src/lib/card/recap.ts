/**
 * 올해 결산 카드. 캐릭터 카드(render.ts)와 같은 270픽셀 논리 격자·팔레트·그리기 도구를 쓴다.
 *
 * - 사실만 적는다(근무일·연가·출근 도장·배지·승급). 사람을 평가하는 말은 넣지 않는다.
 * - 날짜는 하루 단위로 적지 않는다('11월까지'). 결산 시작일(올해 임용이면 임용일)이 드러나지 않게 한다.
 * - 금액(올해 번 봉급)은 호출한 쪽이 켰을 때만 model 에 들어온다. 글자 카드에는 넣지 않는다.
 * - 1년 달력은 칸 3·4픽셀에 간격 1픽셀(정수 좌표)이라 내보내기 ×4 에서도 정수배다.
 */
import type { Tier } from '../achievements.ts';
import type { YearDay, YearRecap } from '../calc/recap.ts';
import { recapLeaveText, recapStepText } from '../calc/recap.ts';
import type { Look } from '../character/look.ts';
import { characterRules } from '../character/rules.ts';
import type { CardRatio } from '../store/schema.ts';
import {
  CARD_COLORS as C,
  CARD_SIZES,
  chip,
  fit,
  frame,
  icon,
  rect,
  stage,
  text,
  widthOf,
  type Ctx,
} from './render.ts';

export interface RecapFact {
  label: string;
  value: string;
}

export interface RecapCardModel {
  nickname: string;
  year: number;
  /** '11월까지', 정년퇴직한 해면 '정년퇴직일까지' */
  periodText: string;
  look: Look;
  formName: string;
  grade: number;
  step: number;
  /** '4→5호봉'. 올해 오른 적이 없으면 null */
  stepText: string | null;
  /** 근무일·연가·출근 도장·배지 */
  facts: RecapFact[];
  badges: { icon: string; tier: Tier }[];
  /** 켰을 때만: '25,123,000원'(미리보기에서 금액 가리기면 가린 문자열) */
  salary: string | null;
  /** 켰을 때만: 1년 달력 */
  grid: readonly YearDay[] | null;
  siteName: string;
  siteTagline: string;
  siteUrl: string;
}

/** 자리가 모자라 그리지 못한 것 */
export interface RecapOmitted {
  calendar: boolean;
  salary: boolean;
}

/** 결산의 네 가지 사실(화면·카드·글자 카드가 같은 문구를 쓴다) */
export function recapFacts(recap: YearRecap): RecapFact[] {
  return [
    { label: '근무일', value: `${recap.workdays}일` },
    { label: '연가', value: recapLeaveText(recap) },
    { label: '출근 도장', value: `${recap.visits}개` },
    { label: '배지', value: `${recap.badges.length}개` },
  ];
}

/** 카드 제목 줄 오른쪽의 기간: 하루 단위 날짜를 적지 않는다 */
export function recapPeriodText(recap: YearRecap): string {
  if (recap.retiredThisYear) return '정년퇴직일까지';
  return `${Number(recap.to.slice(5, 7))}월까지`;
}

/** 금액 줄의 이름표(긴 것이 들어가지 않으면 짧은 것) */
export const RECAP_SALARY_LABEL = '올해 번 봉급(봉급표 기준 추정)';
const RECAP_SALARY_SHORT = '올해 번 봉급(추정)';

export { recapStepText };

const P = characterRules.palette;
const VISIT = P[2] as string;
const LEAVE = P[6] as string;
const PLANNED = P[5] as string;

/** 1년 달력의 칸 크기(논리 픽셀). 간격은 1 */
const CELL: Record<CardRatio, number> = { square: 3, portrait: 4 };

export function calendarSize(ratio: CardRatio): { w: number; h: number } {
  const pitch = CELL[ratio] + 1;
  return { w: 31 * pitch - 1, h: 12 * pitch - 1 };
}

function drawCalendar(
  ctx: Ctx,
  grid: readonly YearDay[],
  x: number,
  y: number,
  ratio: CardRatio,
): void {
  const c = CELL[ratio];
  const pitch = c + 1;
  const half = Math.ceil(c / 2);
  for (const day of grid) {
    if (day.outside) continue;
    const cx = x + (day.day - 1) * pitch;
    const cy = y + (day.month - 1) * pitch;
    const base = day.holiday ? C.SHADOW : day.weekend ? C.PANEL2 : C.DESK;
    const leave = day.planned ? PLANNED : LEAVE;
    // 칸 하나에 한 가지 바탕: 연가 > 승급 > 들른 날 > 공휴일 > 주말 > 평일
    if (day.leave === 'full') rect(ctx, cx, cy, c, c, leave);
    else if (day.raise) rect(ctx, cx, cy, c, c, C.BLUE);
    else if (day.visited) rect(ctx, cx, cy, c, c, VISIT);
    else rect(ctx, cx, cy, c, c, base);
    if (day.leave === 'am') rect(ctx, cx, cy, c, half, leave);
    else if (day.leave === 'pm') rect(ctx, cx, cy + c - half, c, half, leave);
    else if (day.leave === 'hours') {
      const dot = c - 2;
      rect(ctx, cx + 1, cy + 1, dot, dot, leave);
    }
  }
}

function legend(ctx: Ctx, items: [string, string][], x: number, y: number): void {
  let lx = x;
  for (const [color, label] of items) {
    rect(ctx, lx, y + 3, 6, 6, color);
    lx += 9;
    lx += Math.ceil(text(ctx, label, lx, y, 12, C.MUTED)) + 8;
  }
}

/**
 * 결산 카드를 그린다. ctx 의 캔버스는 (CARD_SIZES[ratio] × scale) 크기여야 한다.
 */
export function drawRecapCard(
  ctx: Ctx,
  model: RecapCardModel,
  ratio: CardRatio,
  scale: number,
): RecapOmitted {
  const { w: W, h: H } = CARD_SIZES[ratio];
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;

  rect(ctx, 0, 0, W, H, C.DESK);
  const px = 8;
  const py = 8;
  const pw = W - 18;
  const ph = H - 18;
  rect(ctx, px + 2, py + 4, pw, ph, C.SHADOW);
  rect(ctx, px + 4, py + 2, pw, ph, C.SHADOW);
  frame(ctx, px, py, pw, ph, C.PANEL);

  // 제목 줄: '호봉이 2026 결산' · '11월까지'
  rect(ctx, px, py, pw, 22, C.NAVY);
  icon(ctx, 'icon-tiger', px + 4, py + 3, 1, C.INK);
  text(ctx, `${model.siteName}이 ${model.year} 결산`, px + 24, py + 5, 12, C.WHITE);
  text(ctx, model.periodText, px + pw - 6, py + 5, 12, C.WHITE, 'right');

  const left = px + 8;
  const right = px + pw - 8;
  const inner = right - left;
  const footerH = 20;
  const footerY = py + ph - footerH;
  const bottom = footerY - 4;

  // 위: 작은 무대(왼쪽) + 이름·호봉·승급·배지(오른쪽)
  const stageW = 100;
  const stageH = 100;
  const top = py + 32;
  stage(ctx, { look: model.look, nickname: model.nickname, line: '' }, left + 2, top, stageW, stageH, false, 2);
  const cx = left + stageW + 12;
  const cw = right - cx;
  let cy = py + 28;
  chip(ctx, fit(ctx, model.formName, 12, cw - 14), cx - 2, cy);
  cy += 24;
  text(ctx, fit(ctx, model.nickname, 15, cw), cx, cy, 15, C.INK);
  cy += 20;
  const stepLine = `${model.grade}급 ${model.step}호봉`;
  text(ctx, stepLine, cx, cy, widthOf(ctx, stepLine, 15) <= cw ? 15 : 12, C.INK);
  cy += 20;
  if (model.stepText) {
    text(ctx, fit(ctx, `승급 ${model.stepText}`, 12, cw), cx, cy, 12, C.MUTED);
    cy += 16;
  }
  if (model.badges.length > 0) {
    const size = 16;
    const gap = 4;
    const room = Math.max(1, Math.floor((cw - 24) / (size + gap)));
    model.badges.slice(0, room).forEach((badge, i) => {
      const bx = cx + 2 + i * (size + gap);
      frame(ctx, bx, cy + 4, size, size, C.TIER_FILL[badge.tier]);
      icon(ctx, badge.icon, bx, cy + 4, 1);
    });
    const rest = model.badges.length - Math.min(room, model.badges.length);
    if (rest > 0) text(ctx, `+${rest}`, cx + 4 + room * (size + gap), cy + 6, 12, C.MUTED);
  }

  let y = top + stageH + 8;
  const omitted: RecapOmitted = { calendar: false, salary: false };
  const cal = calendarSize(ratio);
  const legendItems: [string, string][] = [
    [VISIT, '들른 날'],
    [LEAVE, '연가'],
    ...(model.grid?.some((d) => d.raise) ? ([[C.BLUE, '승급']] as [string, string][]) : []),
  ];

  if (ratio === 'square') {
    // 아래 왼쪽: 사실 네 줄 / 오른쪽: 1년 달력과 범례
    const withCal = model.grid !== null && y + cal.h + 18 <= bottom - (model.salary ? 18 : 0);
    const factW = withCal ? inner - cal.w - 8 : inner;
    const lineH = 16;
    if (withCal) {
      model.facts.forEach((fact, i) => {
        text(ctx, fit(ctx, `${fact.label} ${fact.value}`, 12, factW), left, y + i * lineH, 12, C.INK);
      });
      const gx = right - cal.w;
      drawCalendar(ctx, model.grid as readonly YearDay[], gx, y + 2, ratio);
      legend(ctx, legendItems.slice(0, 2), gx, y + cal.h + 6);
      y += Math.max(model.facts.length * lineH, cal.h + 20) + 4;
    } else {
      // 달력이 없으면 두 칸씩 크게
      const colW = Math.floor(inner / 2);
      model.facts.forEach((fact, i) => {
        const fx = left + (i % 2) * colW;
        const fy = y + Math.floor(i / 2) * 34;
        text(ctx, fact.label, fx, fy, 12, C.MUTED);
        text(ctx, fit(ctx, fact.value, 15, colW - 6), fx, fy + 15, 15, C.INK);
      });
      y += 68 + 4;
      if (model.grid !== null) omitted.calendar = true;
    }
  } else {
    // 세로형: 사실 2×2, 그 아래 1년 달력, 금액
    const colW = Math.floor(inner / 2);
    model.facts.forEach((fact, i) => {
      const fx = left + (i % 2) * colW;
      const fy = y + Math.floor(i / 2) * 36;
      text(ctx, fact.label, fx, fy, 12, C.MUTED);
      text(ctx, fit(ctx, fact.value, 15, colW - 6), fx, fy + 15, 15, C.INK);
    });
    y += 72 + 6;
    if (model.grid !== null) {
      if (y + 16 + cal.h <= bottom - (model.salary ? 34 : 0)) {
        text(ctx, '1년 달력', left, y, 12, C.MUTED);
        legend(ctx, legendItems, left + 60, y);
        y += 18;
        drawCalendar(ctx, model.grid, left + Math.floor((inner - cal.w) / 2), y, ratio);
        y += cal.h + 8;
      } else {
        omitted.calendar = true;
      }
    }
  }

  if (model.salary !== null) {
    const amountW = widthOf(ctx, model.salary, 12);
    const long = widthOf(ctx, RECAP_SALARY_LABEL, 12) + amountW + 8 <= inner;
    if (long || ratio === 'square') {
      if (y + 14 <= bottom) {
        text(ctx, long ? RECAP_SALARY_LABEL : RECAP_SALARY_SHORT, left, y, 12, C.MUTED);
        text(ctx, model.salary, right, y, 12, C.INK, 'right');
      } else omitted.salary = true;
    } else if (y + 32 <= bottom) {
      text(ctx, RECAP_SALARY_LABEL, left, y, 12, C.MUTED);
      text(ctx, model.salary, right, y + 16, 15, C.INK, 'right');
    } else omitted.salary = true;
  }

  // 아래: 서비스 이름과 주소
  rect(ctx, px, footerY, pw, footerH, C.NAVY);
  const urlWidth = widthOf(ctx, model.siteUrl, 12);
  const brand = `${model.siteName} · ${model.siteTagline}`;
  const brandFits = widthOf(ctx, brand, 12) + urlWidth + 24 <= pw;
  text(ctx, brandFits ? brand : model.siteName, px + 8, footerY + 4, 12, C.WHITE);
  text(ctx, model.siteUrl, px + pw - 8, footerY + 4, 12, C.GOLD, 'right');

  ctx.restore();
  return omitted;
}

/** 이미지를 붙일 수 없는 메신저용 글자 카드(금액·하루 단위 날짜는 넣지 않는다) */
export function recapTextCard(model: RecapCardModel): string {
  const fact = (label: string) => {
    const found = model.facts.find((f) => f.label === label);
    return found ? `${found.label} ${found.value}` : null;
  };
  const pair = (a: string, b: string) => [fact(a), fact(b)].filter(Boolean).join(' · ');
  const lines = [
    `[${model.siteName}] ${model.nickname}의 ${model.year}년 (${model.periodText})`,
    `${model.grade}급 ${model.step}호봉${model.stepText ? ` · 승급 ${model.stepText}` : ''}`,
    pair('근무일', '연가'),
    pair('출근 도장', '배지'),
    model.siteUrl,
  ];
  return lines.filter((line) => line.length > 0).join('\n');
}
