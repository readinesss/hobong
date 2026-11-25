import { expect, test } from '@playwright/test';
import { makeSeed, openApp, tick } from './helpers.ts';

const TABS = [
  { hash: 'home', label: '홈' },
  { hash: 'leave', label: '연가' },
  { hash: 'badges', label: '업적' },
  { hash: 'card', label: '카드' },
  { hash: 'settings', label: '설정' },
];

/** 폭별 확인: 모바일(360·390), 태블릿(768), 데스크톱(1280·1920) */
const WIDTHS = [
  { width: 360, height: 760 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
];

test.describe('반응형과 조작', () => {
  for (const size of WIDTHS) {
    test(`${size.width}px: 가로로 넘치지 않고 창이 겹치지 않는다`, async ({ page }) => {
      await page.setViewportSize(size);
      await openApp(page, { seed: makeSeed() });
      for (const tab of TABS) {
        await page
          .getByRole('navigation', { name: '화면 이동' })
          .getByRole('link', { name: tab.label })
          .click();
        await tick(page, 800);
        const metrics = await page.evaluate(() => {
          const doc = document.documentElement;
          const wins = Array.from(document.querySelectorAll('main .win')).map((el) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              top: r.top + window.scrollY,
              bottom: r.bottom + window.scrollY,
              width: r.width,
            };
          });
          return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wins };
        });
        expect(metrics.scrollWidth, `${tab.label}: 가로 넘침`).toBeLessThanOrEqual(
          metrics.clientWidth,
        );
        expect(metrics.wins.length, `${tab.label}: 창 수`).toBeGreaterThan(0);
        for (const win of metrics.wins) {
          expect(win.width, `${tab.label}: 창 너비`).toBeGreaterThanOrEqual(
            Math.min(280, size.width - 40),
          );
          expect(win.left).toBeGreaterThanOrEqual(0);
          expect(win.right).toBeLessThanOrEqual(metrics.clientWidth + 1);
        }
        // 창끼리 겹치지 않는다
        for (let i = 0; i < metrics.wins.length; i += 1) {
          for (let j = i + 1; j < metrics.wins.length; j += 1) {
            const a = metrics.wins[i]!;
            const b = metrics.wins[j]!;
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            expect(overlapX > 1 && overlapY > 1, `${tab.label}: 창 ${i}와 ${j}가 겹침`).toBe(false);
          }
        }
      }
    });
  }

  test('모바일 폭에서는 하단 탭, 넓은 화면에서는 옆 레일', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, { seed: makeSeed() });
    const nav = page.getByRole('navigation', { name: '화면 이동' });
    let box = await nav.boundingBox();
    expect(box && box.y > 700 && box.width > 380).toBe(true);

    await page.setViewportSize({ width: 1280, height: 900 });
    box = await nav.boundingBox();
    expect(box && box.x === 0 && box.width < 200 && box.height > 800).toBe(true);
  });

  test('누를 수 있는 것은 44px 이상이다', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await openApp(page, { seed: makeSeed() });
    for (const tab of TABS) {
      await page
        .getByRole('navigation', { name: '화면 이동' })
        .getByRole('link', { name: tab.label })
        .click();
      await tick(page, 600);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const targets = document.querySelectorAll<HTMLElement>(
          'main button, main a.btn, main select, main input:not([type="hidden"]):not([hidden]), nav a',
        );
        for (const el of targets) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const style = getComputedStyle(el);
          if (style.opacity === '0' && el.tagName === 'INPUT') continue; // 줄 전체를 덮는 체크박스·보조 입력
          // 테두리(box-shadow 3px)를 포함한 실제 눌리는 크기
          const pad =
            el.classList.contains('btn') ||
            el.classList.contains('chip') ||
            el.classList.contains('input')
              ? 6
              : 0;
          const h = r.height + pad;
          const w = r.width + pad;
          // 달력의 날짜 칸은 폭이 화면을 7등분한 값이라 44px에 조금 못 미칠 수 있어 40px까지 허용한다
          const min = el.classList.contains('day') ? 40 : 44;
          if (h < min - 0.5 || w < min - 0.5)
            out.push(
              `${el.tagName}.${el.className} "${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 12)}" ${Math.round(w)}×${Math.round(h)}`,
            );
        }
        return out;
      });
      expect(small, `${tab.label} 화면의 작은 터치 대상`).toEqual([]);
    }
  });

  test('키보드만으로 탭을 옮기고 연가를 기록할 수 있다', async ({ page, isMobile }) => {
    test.skip(!!isMobile, '키보드 조작은 데스크톱에서 확인한다');
    await openApp(page, { seed: makeSeed() });
    // 건너뛰기 링크가 첫 번째 포커스
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: '본문으로 건너뛰기' })).toBeFocused();
    // 숫자 키로 화면 전환
    await page.keyboard.press('2');
    await expect(page.getByRole('heading', { name: '올해 연가' })).toBeVisible();
    await expect(page.getByRole('link', { name: '연가' })).toHaveAttribute('aria-current', 'page');
    // 달력: 방향키로 날짜 이동
    await page.getByRole('gridcell', { name: /11월 25일/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('gridcell', { name: /11월 26일/ })).toBeFocused();
    await expect(page.locator('#leave-entry')).toContainText('11월 26일 (목)');
    // 버튼은 Enter로
    await page.locator('#leave-entry').getByRole('button', { name: '오후 반일' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#leave-records')).toContainText('오후 반일');
    // 입력란 안에서는 숫자 키가 화면을 바꾸지 않는다
    await page.getByLabel('메모').focus();
    await page.keyboard.type('3');
    await expect(page.getByRole('heading', { name: '올해 연가' })).toBeVisible();
  });

  test('대화상자는 포커스를 가두고 Esc로 닫힌다', async ({ page, isMobile }) => {
    test.skip(!!isMobile, '키보드 조작은 데스크톱에서 확인한다');
    await openApp(page, { seed: makeSeed(), hash: 'leave' });
    const opener = page.getByRole('button', { name: '부여 일수 고치기' });
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      );
      expect(inside).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('움직임 줄이기 설정을 따른다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const seed = JSON.parse(makeSeed());
    seed.data.settings.reduceMotion = false;
    await openApp(page, { seed: JSON.stringify(seed) });
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  });

  test('모바일에서 글자를 치는 동안에는 하단 탭이 입력란을 가리지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await openApp(page, { seed: makeSeed(), hash: 'leave' });
    const nav = page.getByRole('navigation', { name: '화면 이동' });
    await expect(nav).toBeVisible();
    await page.getByLabel('메모').focus();
    await expect(nav).toBeHidden();
    await page.getByLabel('메모').blur();
    await tick(page, 300);
    await expect(nav).toBeVisible();
  });
});
