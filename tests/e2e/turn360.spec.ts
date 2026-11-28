import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeDialogs, collectErrors, makeSeedV6, openApp, tick } from './helpers.ts';

/**
 * 호봉이 돌려 보기(#22): 큰 창, 입체 그림, 키·낭독, 움직임 줄이기, WebGL 없음, 닫기·포커스, 외부 요청, 쉬는 루프.
 * 저장본 기본값은 움직임 줄이기가 켜져 있다(makeSeed). 자동 회전을 보는 테스트는 끈다.
 */
function seed(options: { reduced?: boolean; rank?: string; step?: number } = {}): string {
  const env = JSON.parse(
    makeSeedV6(
      {
        rank: options.rank ?? '6',
        step: options.step ?? 12,
        hireDate: '2018-03-02',
        rankDate: '2022-01-01',
      },
      {
        look: {
          body: 'sprout',
          plume: 'forest',
          deco: { pin: 'flower', chest: null, cheek: true },
        },
      },
    ),
  ) as {
    data: { settings: { reduceMotion: boolean }; character: { seenForms: string[] } };
  };
  env.data.settings.reduceMotion = options.reduced ?? true;
  env.data.character.seenForms = ['egg', 'chick', 'fledgling', 'bird'];
  return JSON.stringify(env);
}

/**
 * 이 브라우저가 입체를 그릴 수 있는지(WebGL1 + 프래그먼트 highp). CI 의 헤드리스 Firefox·WebKit 은 없을 수 있다.
 * 없으면 입체에 기대는 테스트는 건너뛴다(그때의 '2D 그대로 + 알림' 길은 아래 'WebGL 을 쓸 수 없으면' 테스트가 본다)
 */
async function skipWithoutWebGL(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return false;
    const high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !!high && high.precision > 0;
  });
  test.skip(!ok, '이 브라우저에는 WebGL(프래그먼트 highp)이 없어 입체를 그릴 수 없다');
}

async function openTurn(page: Page, s: string): Promise<Locator> {
  await openApp(page, { seed: s });
  await closeDialogs(page);
  await skipWithoutWebGL(page);
  await page.getByRole('button', { name: '호봉이 돌려 보기' }).click();
  const dialog = page.getByRole('dialog', { name: '호봉이 돌려 보기' });
  await expect(dialog).toBeVisible();
  await tick(page, 200);
  await expect(dialog.locator('.h360')).toHaveAttribute('data-ready', 'true');
  return dialog;
}

/** 무대에서 가로로 끈다(dx 씩 n 번, 한 번에 ms) */
async function drag(page: Page, stage: Locator, dx: number, n: number, ms: number): Promise<void> {
  const box = await stage.boundingBox();
  if (!box) throw new Error('무대가 없다');
  const y = box.y + box.height / 2;
  let x = box.x + 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < n; i++) {
    x += dx;
    await tick(page, ms);
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
}

/** 요소 화면의 서로 다른 색 수(그림이 있는지 본다: 빈 무대는 바탕·바닥 두 색) */
async function colorCount(page: Page, target: Locator): Promise<number> {
  const png = await target.screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4)
      seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    return seen.size;
  }, png.toString('base64'));
}

/**
 * 입체 캔버스(WebGL)에 실제로 그려진 색 수를 잰다.
 * WebGL 그림은 화면에 넘긴 뒤에는 비워지고(preserveDrawingBuffer 끔) 스크린샷에 담기는지도 엔진마다 다르다.
 * 그래서 앱이 한 프레임을 그린 **바로 그 자리에서**(같은 작업 안에서) 캔버스를 2D 로 옮겨 센다.
 * 돌려받은 함수는 그동안 본 가장 큰 색 수를 돌려주고 다시 0 으로 둔다. openApp 뒤에 부른다(가짜 시계의 rAF 를 감싼다)
 */
async function watchSolid(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __solid: number; __solidWatch?: boolean };
    w.__solid = 0;
    if (w.__solidWatch) return;
    w.__solidWatch = true;
    const N = 64; // 복셀 프레임버퍼 한 변(캔버스는 그 정수배라 가장 가까운 칸으로 줄이면 색이 그대로다)
    const probe = document.createElement('canvas');
    probe.width = N;
    probe.height = N;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    const raf = window.requestAnimationFrame.bind(window);
    const read = () => {
      const el = document.querySelector<HTMLCanvasElement>('canvas.solid');
      if (!ctx || !el || el.width === 0) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, N, N);
      ctx.drawImage(el, 0, 0, N, N);
      const data = ctx.getImageData(0, 0, N, N).data;
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) === 0) continue;
        seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
      }
      if (seen.size > w.__solid) w.__solid = seen.size;
    };
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        cb(t);
        read();
      });
  });
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { __solid: number };
      const n = w.__solid;
      w.__solid = 0;
      return n;
    });
}

/** 다음 프레임 요청 수를 센다(fx/core 루프가 쉬는지) */
async function countFrames(page: Page, ms: number): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __raf?: typeof requestAnimationFrame };
    w.__frames = 0;
    if (!w.__raf) {
      const raf = window.requestAnimationFrame.bind(window);
      w.__raf = raf;
      window.requestAnimationFrame = (cb) => {
        w.__frames += 1;
        return raf(cb);
      };
    }
  });
  await tick(page, ms);
  return page.evaluate(() => (window as unknown as { __frames: number }).__frames);
}

test.describe('호봉이 돌려 보기(#22)', () => {
  test('창이 열리면 2D 로 시작하고, 돌리면 입체가 그려진다', async ({ page }) => {
    const errors = collectErrors(page);
    const dialog = await openTurn(page, seed());
    const view = dialog.locator('.h360');
    const solid = await watchSolid(page);
    // 처음에는 늘 2D 그림
    await expect(view).toHaveAttribute('data-view', '2d');
    await page.keyboard.press('ArrowRight');
    await tick(page, 300);
    await expect(view).toHaveAttribute('data-view', '3d');
    await expect(view).toHaveAttribute('data-deg', '45');
    // 캔버스는 복셀 64칸의 정수배(넓은 화면 6배 × 기기 배율 — WebKit 프로젝트는 2배 화면이다)
    const canvas = dialog.locator('canvas.solid');
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    expect(await canvas.evaluate((el) => (el as HTMLCanvasElement).width)).toBe(
      64 * Math.round(6 * dpr),
    );
    // 캔버스에 그림이 있다(빈 무대의 두 색보다 훨씬 많은 색)
    expect(await solid()).toBeGreaterThan(6);
    expect(errors).toEqual([]);
  });

  test('←/→·Home 으로 돌리면 방향 글과 그림 이름이 바뀐다', async ({ page }) => {
    const dialog = await openTurn(page, seed());
    const status = dialog.getByRole('status');
    const picture = dialog.getByRole('img', { name: /호봉이 정면$/ });
    await expect(picture).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await tick(page, 100);
    await expect(status).toHaveText('호봉이 오른쪽 앞모습');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await tick(page, 100);
    await expect(status).toHaveText('호봉이 뒷모습');
    await expect(dialog.getByRole('img', { name: /호봉이 뒷모습$/ })).toBeVisible();
    await expect(dialog.getByText('호봉이 뒷모습 180°')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await tick(page, 100);
    await expect(status).toHaveText('호봉이 오른쪽 뒷모습');
    await page.keyboard.press('Home');
    await tick(page, 100);
    await expect(status).toHaveText('호봉이 정면');
    // 정면에 멈추면 다시 2D 그림
    await expect(dialog.locator('.h360')).toHaveAttribute('data-view', '2d');
  });

  test('움직임 줄이기: 자동 회전이 없고, 키 한 번에 45° 로 바로 간다', async ({ page }) => {
    const dialog = await openTurn(page, seed({ reduced: true }));
    await expect(dialog.getByRole('button', { name: '자동 회전' })).toHaveCount(0);
    await expect(dialog.getByText(/자동 회전은 쉬어요/)).toBeVisible();
    const view = dialog.locator('.h360');
    await tick(page, 1000);
    await expect(view).toHaveAttribute('data-deg', '0');
    await expect(view).toHaveAttribute('data-view', '2d');
    await page.keyboard.press('ArrowLeft');
    await tick(page, 50);
    await expect(view).toHaveAttribute('data-deg', '315');
    await expect(view).toHaveAttribute('data-view', '3d');
    await page.keyboard.press('Home');
    await tick(page, 50);
    // 바둑판 한 박자 없이 바로 2D
    await expect(view).toHaveAttribute('data-view', '2d');
  });

  test('자동 회전: 기본으로 돌고, 끄면 이 기기에 기억하며 루프가 쉰다', async ({ page }) => {
    const dialog = await openTurn(page, seed({ reduced: false }));
    const view = dialog.locator('.h360');
    const auto = dialog.getByRole('button', { name: '자동 회전' });
    await expect(auto).toHaveAttribute('aria-pressed', 'true');
    await tick(page, 1500);
    await expect(view).toHaveAttribute('data-view', '3d');
    expect(Number(await view.getAttribute('data-deg'))).toBeGreaterThan(0);
    expect(await countFrames(page, 500)).toBeGreaterThan(5);

    await auto.click();
    await expect(auto).toHaveAttribute('aria-pressed', 'false');
    const prefs = await page.evaluate(() => window.localStorage.getItem('hobong.prefs'));
    expect(JSON.parse(prefs ?? '{}')).toMatchObject({ turnAuto: false });
    const before = await view.getAttribute('data-draws');
    // 가만히 두면 그리지 않고 다음 프레임도 청하지 않는다
    await tick(page, 300);
    expect(await countFrames(page, 1000)).toBe(0);
    await expect(view).toHaveAttribute('data-draws', before ?? '');

    // 다시 열면 기억한 대로 꺼져 있다
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '호봉이 돌려 보기' }).click();
    await expect(
      page.getByRole('dialog', { name: '호봉이 돌려 보기' }).getByRole('button', {
        name: '자동 회전',
      }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('끌어서 돌린다(가로 끌기)', async ({ page }) => {
    const dialog = await openTurn(page, seed());
    const view = dialog.locator('.h360');
    const box = await dialog.locator('.stage').boundingBox();
    if (!box) throw new Error('무대가 없다');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 60, y);
    await page.mouse.down();
    for (let x = 60; x <= 200; x += 20) {
      await page.mouse.move(box.x + x, y);
      await tick(page, 20);
    }
    await page.mouse.up();
    await tick(page, 50);
    await expect(view).toHaveAttribute('data-view', '3d');
    expect(Number(await view.getAttribute('data-deg'))).toBeGreaterThan(30);
    await expect(dialog.getByRole('status')).toHaveText(/^호봉이 /);
  });

  test('튕기면 관성으로 더 돌다 15° 칸에 멈추고, 톡 누르기는 자동 회전을 끄지 않는다', async ({
    page,
  }) => {
    const dialog = await openTurn(page, seed({ reduced: false }));
    const view = dialog.locator('.h360');
    const stage = dialog.locator('.stage');
    const auto = dialog.getByRole('button', { name: '자동 회전' });
    await tick(page, 800);
    // 톡 누르기: 자동 회전 그대로(누르는 동안만 쉰다)
    const box = await stage.boundingBox();
    if (!box) throw new Error('무대가 없다');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(auto).toHaveAttribute('aria-pressed', 'true');
    const before = Number(await view.getAttribute('data-deg'));
    await tick(page, 600);
    expect(Number(await view.getAttribute('data-deg'))).not.toBe(before);

    // 튕기기(30px × 4, 16ms 간격): 가로로 끌었으니 자동 회전은 꺼지고, 손을 뗀 뒤에도 더 돈다.
    // 관성은 손을 뗄 때의 속도로 정해진다. 가짜 시계는 세우지 않으면 실제 시간과 함께 흐르므로, 느린 기기에서
    // 끄는 사이에 실제 시간이 끼어들어 속도가 0 으로 재어지지 않게 시계를 세워 두고 끈다(그 뒤로는 tick 만큼만 흐른다).
    // 세우는 시각은 지금보다 넉넉히 뒤여야 한다(그사이에도 시계가 흘러 '지나간 시각'이 되면 세울 수 없다)
    await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
    await drag(page, stage, 30, 4, 16);
    await expect(auto).toHaveAttribute('aria-pressed', 'false');
    const released = Number(await view.getAttribute('data-deg'));
    await tick(page, 2000);
    const settled = Number(await view.getAttribute('data-deg'));
    const moved = (settled - released + 360) % 360;
    expect(moved).toBeGreaterThan(20);
    expect(moved).toBeLessThan(330);
    expect(settled % 15).toBe(0);
    await expect(dialog.getByRole('status')).toHaveText(/^호봉이 /);
    // 멈춘 뒤에는 루프가 쉰다
    expect(await countFrames(page, 500)).toBe(0);
  });

  test('컨텍스트를 잃으면 2D 로 두고, 되찾으면 다시 입체로 돌린다', async ({ page }) => {
    const errors = collectErrors(page);
    const dialog = await openTurn(page, seed());
    const view = dialog.locator('.h360');
    await page.keyboard.press('ArrowRight');
    await tick(page, 100);
    await expect(view).toHaveAttribute('data-view', '3d');
    await dialog.locator('canvas.solid').evaluate((el) => {
      const gl = (el as HTMLCanvasElement).getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context');
      (window as unknown as { __lose?: WEBGL_lose_context | null }).__lose = ext;
      ext?.loseContext();
    });
    await tick(page, 100);
    await expect(view).toHaveAttribute('data-view', '2d');
    await expect(dialog.getByText(/잠시 입체로 그릴 수 없어/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: '오른쪽으로 45° 돌리기' })).toBeDisabled();
    await page.evaluate(() =>
      (window as unknown as { __lose?: WEBGL_lose_context | null }).__lose?.restoreContext(),
    );
    await tick(page, 100);
    await expect(view).toHaveAttribute('data-ready', 'true');
    await expect(dialog.getByText(/잠시 입체로 그릴 수 없어/)).toHaveCount(0);
    const solid = await watchSolid(page);
    await page.keyboard.press('ArrowRight');
    await tick(page, 300);
    await expect(view).toHaveAttribute('data-view', '3d');
    expect(await solid()).toBeGreaterThan(6);
    expect(errors).toEqual([]);
  });

  test('고대비에서도 캔버스가 정수배 크기 그대로다', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    const dialog = await openTurn(page, seed());
    const [width, shown, dpr] = await dialog
      .locator('canvas.solid')
      .evaluate((el) => [
        (el as HTMLCanvasElement).width,
        el.getBoundingClientRect().width,
        window.devicePixelRatio,
      ]);
    // 테두리가 캔버스를 줄이지 않는다: 보이는 크기 × 기기 배율이 캔버스 칸 수와 같고, 그 수는 64 의 정수배다
    expect((shown ?? 0) * (dpr ?? 1)).toBe(width);
    expect((width ?? 0) % 64).toBe(0);
  });

  test('WebGL 을 쓸 수 없으면 2D 그대로 두고 한 줄로 알린다', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    const errors = collectErrors(page);
    await openApp(page, { seed: seed() });
    await closeDialogs(page);
    await page.getByRole('button', { name: '호봉이 돌려 보기' }).click();
    const dialog = page.getByRole('dialog', { name: '호봉이 돌려 보기' });
    await tick(page, 200);
    await expect(
      dialog.getByText('이 브라우저에서는 입체로 그릴 수 없어 그림으로 보여 드려요.'),
    ).toBeVisible();
    const view = dialog.locator('.h360');
    await expect(view).toHaveAttribute('data-view', '2d');
    await expect(dialog.getByRole('button', { name: '오른쪽으로 45° 돌리기' })).toBeDisabled();
    await page.keyboard.press('ArrowRight');
    await tick(page, 300);
    await expect(view).toHaveAttribute('data-view', '2d');
    // 2D 그림은 그대로 보인다
    expect(await colorCount(page, dialog.locator('.stage'))).toBeGreaterThan(6);
    expect(errors).toEqual([]);
  });

  test('Esc 로 닫히고 포커스가 돌려 보기 단추로 돌아온다', async ({ page }) => {
    await openTurn(page, seed());
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '호봉이 돌려 보기' })).toBeFocused();
  });

  test('꾸미기 미리보기와 도감에서도 연다(외부 요청 0건)', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await openApp(page, { seed: seed(), hash: 'settings' });
    await closeDialogs(page);
    await skipWithoutWebGL(page);
    await page.locator('#set-look').getByRole('button', { name: '꾸미기' }).click();
    const editor = page.getByRole('dialog', { name: '호봉이 꾸미기' });
    await editor.getByRole('button', { name: '돌려 보기' }).click();
    const turn = page.getByRole('dialog', { name: '호봉이 돌려 보기' });
    await expect(turn.getByText('고르는 중인 모습이에요.', { exact: false })).toBeVisible();
    await tick(page, 200);
    await page.keyboard.press('ArrowRight');
    await tick(page, 300);
    await expect(turn.locator('.h360')).toHaveAttribute('data-view', '3d');
    // 위의 창(돌려 보기)만 닫히고 꾸미기 창은 남는다
    await page.keyboard.press('Escape');
    await expect(turn).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('button', { name: '돌려 보기' })).toBeFocused();
    await page.keyboard.press('Escape');

    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '업적' })
      .click();
    await tick(page, 800);
    // 만난 모습만 누를 수 있다
    await expect(page.getByRole('button', { name: /의 모습 돌려 보기$/ })).toHaveCount(4);
    await page.getByRole('button', { name: '깃봉이의 모습 돌려 보기' }).click();
    const dex = page.getByRole('dialog', { name: '호봉이 돌려 보기' });
    await expect(dex.getByText('도감의 깃봉이')).toBeVisible();
    await tick(page, 200);
    await expect(dex.locator('.h360')).toHaveAttribute('data-ready', 'true');
    expect(
      requests.filter((url) => !/^(file|data|blob):/.test(url)),
      '외부 요청',
    ).toEqual([]);
  });
});
