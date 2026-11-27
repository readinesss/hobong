import { expect, test } from '@playwright/test';
import { closeDialogs, makeSeed, makeSeedV4, makeSeedV5, openApp, tick } from './helpers.ts';

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

/**
 * 화면에서 실제로 누를 수 있는 상자가 44px 보다 작은 것을 찾는다(페이지 안에서 실행).
 * 테두리(box-shadow)와 바깥 여백은 누를 수 없으므로 세지 않는다. 대신 ::before/::after 를
 * absolute 로 바깥까지 넓힌 영역은 요소의 일부라 누를 수 있으므로 더한다.
 * 줄 전체를 덮는 투명 체크박스처럼 라벨 안의 입력은 라벨 상자로 잰다.
 */
function smallTargets(): string[] {
  const out: string[] = [];
  const reach = (el: Element) => {
    let m = 0;
    for (const pe of ['::before', '::after']) {
      const s = getComputedStyle(el, pe);
      if (s.content === 'none' || s.position !== 'absolute') continue;
      const v = [s.top, s.right, s.bottom, s.left].map((x) => parseFloat(x) || 0);
      m = Math.max(m, -Math.min(...v));
    }
    return m;
  };
  const root = document.querySelector('[role="dialog"]') ?? document;
  const targets = root.querySelectorAll<HTMLElement>(
    'button, a[href], select, textarea, summary, input:not([type="hidden"]):not([hidden]), [role="button"], [role="radio"], [role="gridcell"]:not([aria-hidden="true"])',
  );
  for (const el of targets) {
    if (el.closest('[aria-hidden="true"], [hidden]')) continue;
    const host = (el.tagName === 'INPUT' && el.closest('label')) || el;
    const r = host.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.tagName === 'INPUT' && host === el && getComputedStyle(el).opacity === '0') continue;
    const x = reach(host);
    const w = r.width + 2 * x;
    const h = r.height + 2 * x;
    if (h < 43.5 || w < 43.5)
      out.push(
        `${el.tagName}.${el.className} "${(el.getAttribute('aria-label') || el.innerText || '').slice(0, 12)}" ${Math.round(w)}×${Math.round(h)}`,
      );
  }
  return out;
}

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

  test('어느 화면에서 새로 고쳐도 맨 위에서 시작한다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of TABS) {
      await openApp(page, { seed: makeSeed(), hash: tab.hash });
      await expect(page.getByRole('link', { name: tab.label })).toHaveAttribute(
        'aria-current',
        'page',
      );
      // 화면 주소(#badges 등)와 같은 id를 가진 요소가 있으면 브라우저가 그리로 내려가 버린다.
      expect(await page.evaluate((id) => document.getElementById(id) === null, tab.hash)).toBe(
        true,
      );
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
  });

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

  for (const size of [
    { width: 360, height: 760 },
    { width: 768, height: 1024 },
  ]) {
    test(`${size.width}px: 누를 수 있는 것은 44px 이상이다`, async ({ page }) => {
      await page.setViewportSize(size);
      await openApp(page, { seed: makeSeed() });
      for (const tab of TABS) {
        await page
          .getByRole('navigation', { name: '화면 이동' })
          .getByRole('link', { name: tab.label })
          .click();
        await tick(page, 600);
        const small = await page.evaluate(smallTargets);
        expect(small, `${tab.label} 화면의 작은 터치 대상`).toEqual([]);
      }
    });
  }

  test('360px: 백업 암호 대화상자도 44px 이상이고 가로로 넘치지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    test.skip(!(await page.evaluate(() => !!window.crypto?.subtle)), 'WebCrypto 없음');
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const dialog = page.getByRole('dialog');

    await page.getByRole('checkbox', { name: /암호 걸기/ }).check();
    expect(await page.evaluate(smallTargets), '데이터 창(암호 걸기)').toEqual([]);
    // 암호 걸기 대화상자(오류가 보이는 상태)
    await page.getByRole('button', { name: /글자로 보기/ }).click();
    await dialog.getByLabel('암호', { exact: true }).fill('hobong-pass-1');
    await dialog.getByLabel('암호 확인').fill('hobong-pass-2');
    await dialog.getByRole('button', { name: '암호 걸고 글자로 보기' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(await page.evaluate(smallTargets), '암호 걸기 대화상자').toEqual([]);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await dialog.getByLabel('암호', { exact: true }).fill('hobong-pass-1');
    await dialog.getByLabel('암호 확인').fill('hobong-pass-1');
    await dialog.getByRole('button', { name: '암호 걸고 글자로 보기' }).click();
    const text = await page
      .getByRole('dialog', { name: '백업 내용(글자)' })
      .locator('textarea')
      .inputValue();
    expect(await page.evaluate(smallTargets), '암호 글자 대화상자').toEqual([]);
    await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click();

    // 불러오기에서 암호를 묻는 화면(틀린 암호 오류가 보이는 상태)
    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    await dialog.getByRole('button', { name: /글자로 붙여넣기/ }).click();
    await dialog.locator('textarea').fill(text);
    await dialog.getByRole('button', { name: '확인하기' }).click();
    await dialog.getByLabel('암호', { exact: true }).fill('wrong-password');
    await dialog.getByRole('button', { name: '열기' }).click();
    await expect(dialog.getByRole('alert')).toContainText('암호가 틀렸거나');
    expect(await page.evaluate(smallTargets), '암호 묻기 화면').toEqual([]);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test('첫 화면과 입력 폼도 누를 수 있는 것은 44px 이상이다', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await openApp(page);
    expect(await page.evaluate(smallTargets), '첫 화면').toEqual([]);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: /예외가 있어요/ }).click();
    expect(await page.evaluate(smallTargets), '입력 폼').toEqual([]);
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

  test('라디오 칩은 화살표로 고르고, 선택 표시가 이름에 섞이지 않는다', async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, '키보드 조작은 데스크톱에서 확인한다');
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    const themes = page.getByRole('radiogroup', { name: '밝기' });
    // 고른 칩 하나만 Tab 정지점
    await expect(themes.locator('[tabindex="0"]')).toHaveCount(1);
    // 이름은 '▶ 25일' 이 아니라 '25일'
    await expect(page.getByRole('radio', { name: '25일', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await themes.getByRole('radio', { name: '주간' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(themes.getByRole('radio', { name: '야근 모드' })).toBeFocused();
    await expect(themes.getByRole('radio', { name: '야근 모드' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Home');
    await expect(themes.getByRole('radio', { name: '기기 설정대로' })).toBeFocused();
    await expect(themes.getByRole('radio', { name: '기기 설정대로' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('대화상자 안의 내용이 바뀌어도 포커스와 Esc 가 대화상자에 남는다', async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, '키보드 조작은 데스크톱에서 확인한다');
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    await page.getByRole('button', { name: '데이터 불러오기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /글자로 붙여넣기/ }).click();
    await dialog.getByLabel('백업 내용을 통째로 붙여넣어 주세요.').fill(makeSeed());
    await dialog.getByRole('button', { name: '확인하기' }).click();
    // 누른 버튼이 사라져도 포커스는 BODY 로 떨어지지 않고 '불러오기'로 간다
    await expect(dialog.getByRole('button', { name: /불러오기$/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
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

  for (const width of [320, 360, 414]) {
    test(`${width}px: 내 정보 폼과 고치기 대화상자가 가로로 넘치지 않는다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 760 });
      await openApp(page);
      await page.getByRole('button', { name: '새로 시작' }).click();
      await page.getByRole('button', { name: /예외가 있어요/ }).click();
      const doc = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(doc[0], '첫 화면 폼').toBeLessThanOrEqual(doc[1] as number);
      // 날짜 줄(달력 버튼까지)이 예외 칸 안에 들어간다
      const inside = await page.evaluate(() => {
        const well = document.querySelector('#pf-advanced')!.getBoundingClientRect();
        return [...document.querySelectorAll('#pf-advanced .date')].every(
          (d) => d.getBoundingClientRect().right <= well.right + 0.5,
        );
      });
      expect(inside, '예외 칸의 날짜 줄').toBe(true);

      await openApp(page, { seed: makeSeed(), hash: 'settings' });
      await page.getByRole('button', { name: '고치기' }).click();
      const body = await page.evaluate(() => {
        const b = document.querySelector('.modal .win-body')!;
        return [b.scrollWidth, b.clientWidth];
      });
      expect(body[0], '고치기 대화상자 본문').toBeLessThanOrEqual(body[1] as number);
    });
  }

  test('설정 화면은 보이는 순서대로 Tab 이 움직인다(넓은 화면의 열 배치에서도)', async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, '키보드 조작은 데스크톱에서 확인한다');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    const order = [
      'set-profile',
      'set-look',
      'set-data',
      'set-work',
      'set-display',
      'set-about',
      'set-contact',
      'set-dreams',
      'set-sources',
    ];
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).focus();
    const seen: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const win = await page.evaluate(() => document.activeElement?.closest('main .win')?.id ?? '');
      if (win && seen[seen.length - 1] !== win) {
        // 마지막 창을 지나 탭 줄을 돌아 다시 처음으로 오면 멈춘다
        if (seen.includes(win)) break;
        seen.push(win);
      }
      await page.keyboard.press('Tab');
    }
    // 창을 한 번씩만, 정한 순서대로 지난다(열 사이를 오가지 않는다)
    expect(seen).toEqual(order.filter((id) => seen.includes(id)));
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });

  test('넓은 화면의 업적·홈 배치에 큰 빈칸이 없다', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openApp(page, { seed: makeSeed(), hash: 'badges' });
    const gap = await page.evaluate(() => {
      const u = document.querySelector('#unlocks')!.getBoundingClientRect();
      const v = document.querySelector('#visits')!.getBoundingClientRect();
      return v.top - u.bottom;
    });
    expect(gap, '깃이 자라면 ↔ 출근 도장').toBeLessThanOrEqual(24);

    await page.setViewportSize({ width: 768, height: 900 });
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '홈' })
      .click();
    await tick(page, 600);
    const home = await page.evaluate(() => {
      const r = (q: string) => document.querySelector(q)!.getBoundingClientRect();
      return {
        career: r('#career').bottom,
        wallet: r('#wallet').top,
        leave: r('#leave-mini').bottom,
        upcoming: r('#upcoming').top,
      };
    });
    expect(home.wallet - home.career, '정년 ↔ 지갑').toBeLessThanOrEqual(24);
    expect(home.upcoming - home.leave, '연가 ↔ 다가오는 일정').toBeLessThanOrEqual(24);
  });

  // 올해 결산(#12): 업적 탭의 1년 달력과 카드 화면의 결산을 밝게·어둡게 두 폭에서 본다
  for (const width of [360, 1280]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${width}px ${theme}: 1년 달력과 결산 카드가 넘치지 않고 44px 이상이다`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        const seed = JSON.parse(makeSeed());
        seed.data.settings.theme = theme;
        await openApp(page, { seed: JSON.stringify(seed), hash: 'badges' });
        const overflow = () =>
          page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        // 달력 칸은 정수 px, 줄(달)마다 31칸 안에 들어가고 창 안에 있다
        const cal = await page.evaluate(() => {
          const win = document.querySelector('#visits')!.getBoundingClientRect();
          const cells = [...document.querySelectorAll<HTMLElement>('#visits [role="img"] i')];
          const sizes = new Set(cells.map((c) => c.getBoundingClientRect().width));
          const right = Math.max(...cells.map((c) => c.getBoundingClientRect().right));
          return { count: cells.length, sizes: [...sizes], right, winRight: win.right };
        });
        expect(cal.count).toBe(365);
        expect(cal.sizes).toHaveLength(1);
        expect(Number.isInteger(cal.sizes[0])).toBe(true);
        expect(cal.right).toBeLessThanOrEqual(cal.winRight);
        await page.getByText('달마다 글로 보기').click();
        expect(await overflow(), '업적 가로 넘침').toBeLessThanOrEqual(0);
        expect(await page.evaluate(smallTargets), '업적 화면의 작은 터치 대상').toEqual([]);

        await page
          .getByRole('navigation', { name: '화면 이동' })
          .getByRole('link', { name: '카드' })
          .click();
        await page.getByRole('radio', { name: '올해 결산' }).click();
        await page.getByRole('checkbox', { name: /올해 번 봉급/ }).check();
        await tick(page, 600);
        expect(await overflow(), '결산 카드 가로 넘침').toBeLessThanOrEqual(0);
        expect(await page.evaluate(smallTargets), '결산 카드 화면의 작은 터치 대상').toEqual([]);
        await expect(page.locator('#card-omitted')).toHaveCount(0);
      });
    }
  }

  // 안내 띠 닫기(#15)·장기재직휴가 창(#14): 좁은 폭에서 글과 닫기 버튼이 겹치지 않고 44px 이상이다
  for (const width of [360, 1280]) {
    test(`${width}px: 닫을 수 있는 안내 띠와 장기재직휴가 창이 넘치지 않고 44px 이상이다`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      // 정년이 지난 사람이 2028년(공휴일 데이터 없음)에 연다 → 정년·공휴일 띠 둘 다
      const seed = makeSeed(
        {
          birthDate: '1960-03-01',
          hireDate: '1985-03-01',
          gradeDate: '1985-03-01',
          step: 29,
          nextStepDate: '2021-01-01',
          stepAsOf: '2020-06-30',
        },
        { visits: { days: ['2028-01-04'], lastVisit: '2028-01-04' } },
      );
      await openApp(page, { seed, time: '2028-01-05T10:00:00+09:00' });
      const closes = page.getByRole('button', { name: /안내 닫기$/ });
      await expect(closes).toHaveCount(2);
      const layout = await page.evaluate(() =>
        ['#notice-retired', '#notice-holidays'].map((id) => {
          const banner = document.querySelector(id)!;
          const text = banner.querySelector('p')!.getBoundingClientRect();
          const button = banner.querySelector('[data-dismiss]')!.getBoundingClientRect();
          const box = banner.getBoundingClientRect();
          return {
            gap: button.left - text.right,
            inside: button.right <= box.right + 1 && button.top >= box.top - 1,
          };
        }),
      );
      for (const item of layout) {
        expect(item.gap, '글과 닫기 버튼이 겹침').toBeGreaterThanOrEqual(0);
        expect(item.inside, '닫기 버튼이 띠 밖으로 나감').toBe(true);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      expect(await page.evaluate(smallTargets), '안내 띠의 작은 터치 대상').toEqual([]);

      // 장기재직휴가 창(부칙 특례 문구·긴 근거 조항)
      await openApp(page, { seed: makeSeed({ hireDate: '2016-09-01' }), hash: 'leave' });
      await expect(page.locator('#leave-long')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      expect(await page.evaluate(smallTargets), '연가 화면의 작은 터치 대상').toEqual([]);
    });
  }

  // #20 직종 시드: 네 글자 계급('치안정감'·'소방준감')·우정 계급·교원(계급 없음)·준비 중 직종에서도
  // 모든 탭이 가로로 넘치지 않고, 누를 수 있는 것은 44px 이상이다(준비 중 띠·꺼진 항목 줄 포함)
  const TRACK_SEEDS: [string, string][] = [
    ['교원', makeSeedV4({ track: 'teacher', payTable: null, rank: '교원', step: 12 })],
    [
      '경찰 치안정감',
      makeSeedV4({
        track: 'police',
        payTable: null,
        rank: '치안정감',
        rankDate: '2024-01-01',
        step: 23,
        birthDate: '1968-01-01',
        hireDate: '1992-03-02',
      }),
    ],
    ['소방 소방준감', makeSeedV4({ track: 'fire', payTable: null, rank: '소방준감', step: 20 })],
    ['우정7급', makeSeedV4({ payTable: 'table8', rank: '7', step: 14 })],
    ['그 밖의 특정직', makeSeedV4({ track: 'otherSpecial', payTable: null, rank: null, step: 7 })],
  ];
  for (const width of [320, 360, 1280]) {
    test(`${width}px: 직종별 화면이 넘치지 않는다(360px 부터 44px 이상)`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 800 });
      for (const [name, seed] of TRACK_SEEDS) {
        await openApp(page, { seed });
        await tick(page, 6000);
        await closeDialogs(page);
        for (const tab of TABS) {
          await page
            .getByRole('navigation', { name: '화면 이동' })
            .getByRole('link', { name: tab.label })
            .click();
          await tick(page, 500);
          const over = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(over, `${name} ${tab.label}: 가로 넘침`).toBeLessThanOrEqual(0);
          // 320px 의 연가 달력은 7칸이라 칸 폭이 44px 에 못 미친다(직종과 무관, 360px 부터 검사)
          if (width >= 360)
            expect(
              await page.evaluate(smallTargets),
              `${name} ${tab.label}: 작은 터치 대상`,
            ).toEqual([]);
        }
      }
    });
  }

  test('320px: 직종·봉급표 칩과 별표 4 안내를 펼친 입력 폼도 넘치지 않고 44px 이상이다', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByText('별표 4는 누가 쓰나요?').click();
    await page.getByRole('button', { name: /예외가 있어요/ }).click();
    const check = async (what: string) => {
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(over, `${what}: 가로 넘침`).toBeLessThanOrEqual(0);
      expect(await page.evaluate(smallTargets), `${what}: 작은 터치 대상`).toEqual([]);
    };
    await check('일반직');
    await page.getByRole('radio', { name: '경찰', exact: true }).click();
    await check('경찰(계급정년 칸)');
    await page.getByRole('radio', { name: '그 밖의 특정직 (준비 중)' }).click();
    await check('그 밖의 특정직');
  });

  // 호봉이 꾸미기(#17): 좁은 폭부터 넓은 폭까지, 밝게·어둡게·고대비에서 견본이 넘치지 않고 44px 이상이다
  for (const width of [320, 360, 1280]) {
    for (const mode of ['light', 'dark', 'forced'] as const) {
      test(`${width}px ${mode}: 호봉이 꾸미기 창이 넘치지 않고 견본이 44px 이상이다`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        if (mode === 'forced') await page.emulateMedia({ forcedColors: 'active' });
        await openApp(page, {
          seed: makeSeedV5(
            { rank: '7', step: 14 },
            { theme: mode === 'dark' ? 'dark' : 'light', series: '간호' },
          ),
          hash: 'settings',
        });
        const over = () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
        expect(await over(), '설정 가로 넘침').toBeLessThanOrEqual(0);
        await page.locator('#set-look').getByRole('button', { name: '꾸미기' }).click();
        const dialog = page.getByRole('dialog', { name: '호봉이 꾸미기' });
        await expect(dialog).toBeVisible();
        await tick(page, 600);
        expect(await over(), '꾸미기 창 가로 넘침').toBeLessThanOrEqual(0);
        const body = await page.evaluate(() => {
          const b = document.querySelector('.modal .win-body')!;
          return [b.scrollWidth, b.clientWidth];
        });
        expect(body[0], '꾸미기 창 본문').toBeLessThanOrEqual(body[1] as number);
        expect(await page.evaluate(smallTargets), '꾸미기 창의 작은 터치 대상').toEqual([]);
        // 견본은 모두 이름 글자가 있고, 고른 견본에는 ✓ 표시가 붙는다(색만으로 구별하지 않는다)
        const tiles = await page.evaluate(() =>
          [...document.querySelectorAll('.modal .sw')].map((el) => ({
            name: el.querySelector('.name')?.textContent?.trim() ?? '',
            checked: (el.querySelector('input') as HTMLInputElement).checked,
            mark: getComputedStyle(el.querySelector('.tile')!, '::after').content,
          })),
        );
        expect(tiles.length).toBeGreaterThan(40);
        for (const t of tiles) {
          expect(t.name, '견본 이름').not.toBe('');
          if (t.checked) expect(t.mark, `${t.name} ✓ 표시`).toContain('✓');
        }
      });
    }
  }
});
