/**
 * 알 콕 누르기(#39): 첫 입력의 알을 누르거나 마우스를 올리면 반응한다.
 * 휴대폰(360px, 터치)과 PC(1280px, 마우스) 두 프로젝트에서 돈다. 손길 해석의 자세한 경우는 tests/unit/poke.test.ts 에 있다.
 *
 * - 입력을 방해하지 않는다(포커스·글자·캐럿·스크롤·질문·진행 그대로)
 * - 누르면 같은 이벤트 안에서 그림이 바뀐다(시계를 돌리지 않고도), 글은 매번 같지 않다
 * - 키보드로 누를 수 있고, 낭독은 손길 한 묶음에 한 줄
 * - 움직임 줄이기는 글과 멈춘 표시만, 쉬는 동안 rAF 0
 * - 진동은 켰을 때 묶음에 한 번만
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  collectErrors,
  fillDate,
  NOW,
  openApp,
  ROOT,
  stubVibrate,
  tick,
  vibes,
} from './helpers.ts';

interface PokeTalk {
  label: string;
  tap: string[][];
  few: string[];
  hold: string[];
  sfx: { tap: string[] };
  still: { tap: string[][] };
}
const TALK = JSON.parse(readFileSync(join(ROOT, 'data/talk.json'), 'utf8')) as {
  egg: { poke: PokeTalk };
  hatch: { greetPoked: string[] };
};
const POKE = TALK.egg.poke;

const eggOf = (scope: Page | Locator) => scope.getByRole('button', { name: POKE.label });
const talkEgg = (page: Page) => eggOf(page.locator('#welcome-talk'));
const say = (scope: Page | Locator) => scope.locator('.egg-say');
const canvasOf = (egg: Locator) =>
  egg.locator('canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
const isMobile = (name: string) => name === 'mobile';
/** 움직임 줄이기에서 말하지 않는 몸짓 낱말 */
const MOTION_WORDS = /튀|뛰|뒤척|꼼지락|폴짝|웅크|들썩|두리번|부르르|화들짝|깜빡|흔들|데굴/;

/** 사람 손처럼 누른다: 휴대폰은 탭, PC 는 클릭 */
async function poke(egg: Locator, project: string): Promise<void> {
  if (isMobile(project)) await egg.tap();
  else await egg.click();
}

/**
 * 시계를 멈춘 채로도 쓸 수 있게 포인터 이벤트를 직접 보낸다(누름 → holdMs → 뗌).
 * frac: 단추 왼쪽에서 오른쪽까지 어디를 누르는지(0~1)
 */
async function pressAt(
  page: Page,
  egg: Locator,
  project: string,
  options: { frac?: number; holdMs?: number; up?: boolean } = {},
): Promise<void> {
  const box = await egg.boundingBox();
  if (!box) throw new Error('알 단추가 보이지 않는다');
  const init = {
    pointerId: 7,
    pointerType: isMobile(project) ? 'touch' : 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: box.x + box.width * (options.frac ?? 0.5),
    clientY: box.y + box.height / 2,
  };
  await egg.dispatchEvent('pointerdown', init);
  if (options.up === false) return;
  if (options.holdMs) await page.clock.runFor(options.holdMs);
  await egg.dispatchEvent('pointerup', { ...init, buttons: 0 });
}

/** 인사에서 첫 질문(닉네임)까지 */
async function startTalk(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '새로 시작' }).click();
  await page.getByRole('button', { name: '시작할게요' }).click();
  const nick = page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' });
  await expect(nick).toBeFocused();
  return nick;
}

/** 시계를 멈춘다(그 뒤로는 runFor 로만 흐른다) */
const pause = (page: Page) => page.clock.pauseAt(new Date(Date.parse(NOW) + 60_000));

/** 이제부터 rAF 부른 수를 센다(공용 루프는 부를 때마다 전역 requestAnimationFrame 을 찾는다) */
async function countRaf(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __raf: number; __rafWrapped?: boolean };
    w.__raf = 0;
    if (w.__rafWrapped) return;
    w.__rafWrapped = true;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      w.__raf += 1;
      return raf(cb);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __raf: number }).__raf);
}

test.describe('알 콕 누르기', () => {
  test('알을 눌러도 입력 칸의 포커스·글자·캐럿·스크롤·질문·진행이 그대로다(화면 키보드가 올라온 작은 알에서도)', async ({
    page,
  }, info) => {
    const errors = collectErrors(page);
    await openApp(page);
    const nick = await startTalk(page);
    await nick.fill('홍길');
    await nick.evaluate((el) => (el as HTMLInputElement).setSelectionRange(1, 1));
    const egg = talkEgg(page);
    const progress = page.getByRole('progressbar', { name: '채운 칸' });
    const before = await page.evaluate(() => ({ y: scrollY, vh: visualViewport?.height }));
    for (let i = 0; i < 3; i += 1) {
      await poke(egg, info.project.name);
      await tick(page, 300);
    }
    await expect(say(egg)).toBeVisible();
    await expect(nick).toBeFocused();
    expect(
      await nick.evaluate((el) => [
        (el as HTMLInputElement).value,
        (el as HTMLInputElement).selectionStart,
      ]),
    ).toEqual(['홍길', 1]);
    expect(await page.evaluate(() => ({ y: scrollY, vh: visualViewport?.height }))).toEqual(before);
    await expect(page.locator('#talk-q')).toHaveText('뭐라고 불러 드릴까요?');
    await expect(progress).toHaveAttribute('aria-valuetext', '9칸 중 0칸');
    await expect(page.locator('#talk-ack')).toHaveCount(0);
    // 이어서 적어도 글자가 이어진다(알을 누르기 전 캐럿 자리에)
    await page.keyboard.type('X');
    await expect(nick).toHaveValue('홍X길');

    // 날짜 질문(연도 칸)에서도
    await nick.fill('김주무관');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    const year = page.getByLabel('생년월일 연도');
    await expect(year).toBeFocused();
    // 네 자리를 다 넣으면 달 칸으로 넘어가므로 두 자리만
    await year.fill('19');
    await poke(egg, info.project.name);
    await tick(page, 300);
    await expect(year).toBeFocused();
    await expect(year).toHaveValue('19');
    await expect(progress).toHaveAttribute('aria-valuetext', '9칸 중 1칸');

    // 화면 키보드가 올라와 작은 알이 되어도
    await page.setViewportSize({ width: 390, height: 360 });
    await tick(page, 600);
    await expect(page.locator('#welcome-talk .stage')).toHaveCount(0);
    const mini = page.locator('#welcome-talk .egg-mini');
    await expect(mini).toHaveAttribute('aria-hidden', 'true');
    await poke(egg, info.project.name);
    await tick(page, 200);
    await expect(year).toBeFocused();
    // 좁은 무대에서는 소리 글자
    await expect(say(egg)).toHaveClass(/sfx/);
    for (const target of [mini, page.locator('#welcome-talk .bubble'), year]) {
      await expect(target).toBeInViewport({ ratio: 1 });
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test('누르는 순간(시계를 돌리지 않고도) 그림이 바뀌고, 떼면 금 단계의 한 줄이 나온다. 매번 같지 않다', async ({
    page,
  }, info) => {
    await openApp(page);
    await startTalk(page);
    await tick(page, 1500);
    await pause(page);
    const egg = talkEgg(page);
    const rest = await canvasOf(egg);
    await pressAt(page, egg, info.project.name, { up: false });
    // 같은 이벤트 안에서 눌린 그림(한 줄 납작)을 그렸다
    expect(await canvasOf(egg)).not.toBe(rest);
    const box = await egg.boundingBox();
    await egg.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: isMobile(info.project.name) ? 'touch' : 'mouse',
      isPrimary: true,
      button: 0,
      clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2,
    });
    await expect(say(egg)).toBeVisible();
    const first = (await say(egg).textContent()) ?? '';
    expect(POKE.tap[0]).toContain(first);

    // 700ms 넘게 띄워 누르면(따로따로) 이어진 두 글이 같지 않다
    const lines = [first];
    for (let i = 0; i < 3; i += 1) {
      await page.clock.runFor(900);
      await pressAt(page, egg, info.project.name, { frac: i / 2 });
      lines.push((await say(egg).textContent()) ?? '');
    }
    for (let i = 1; i < lines.length; i += 1) expect(lines[i]).not.toBe(lines[i - 1]);
    // 끝나면 제자리로 돌아와 쉰다(그림이 처음과 같다)
    await page.clock.runFor(1500);
    expect(await canvasOf(egg)).toBe(rest);
  });

  test('이어 누르면 반응이 달라지고(이어 누르기 글), 금이 가면 그 단계의 글이 나온다', async ({
    page,
  }, info) => {
    await openApp(page);
    const nick = await startTalk(page);
    await pause(page);
    const egg = talkEgg(page);
    await pressAt(page, egg, info.project.name);
    await page.clock.runFor(200);
    await pressAt(page, egg, info.project.name);
    expect(POKE.few).toContain(await say(egg).textContent());
    await page.clock.runFor(1500);
    // 닉네임을 답하면 금이 간다(1단계) → 그 단계의 글
    await nick.fill('김주무관');
    await nick.press('Enter');
    await page.clock.runFor(1500);
    await pressAt(page, egg, info.project.name);
    expect(POKE.tap[1]).toContain(await say(egg).textContent());
  });

  test('키보드: Shift+Tab 으로 알 단추에 닿고, Enter·Space 로 누른다. 질문은 넘어가지 않는다', async ({
    page,
  }) => {
    await openApp(page);
    const nick = await startTalk(page);
    await nick.fill('홍길');
    await page.keyboard.press('Shift+Tab');
    const egg = talkEgg(page);
    await expect(egg).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(say(egg)).toBeVisible();
    const first = await say(egg).textContent();
    await tick(page, 900);
    await page.keyboard.press(' ');
    await expect(say(egg)).not.toHaveText(first ?? '');
    await expect(page.locator('#talk-q')).toHaveText('뭐라고 불러 드릴까요?');
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 0칸',
    );
    await page.keyboard.press('Tab');
    await expect(nick).toBeFocused();
    await expect(nick).toHaveValue('홍길');
  });

  test('낭독은 손길 한 묶음에 한 줄. 질문이 바뀌면 기다리던 줄은 읽지 않는다', async ({
    page,
  }, info) => {
    await openApp(page);
    const nick = await startTalk(page);
    await pause(page);
    await page.evaluate(() => {
      const w = window as unknown as { __spoken: string[] };
      w.__spoken = [];
      const live = document.querySelector('#welcome-talk .egg-spoken');
      if (!live) throw new Error('낭독 줄이 없다');
      new MutationObserver(() => {
        const text = live.textContent?.trim() ?? '';
        if (text) w.__spoken.push(text);
      }).observe(live, { childList: true, characterData: true, subtree: true });
    });
    const spoken = () =>
      page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    const live = page.locator('#welcome-talk .egg-spoken');
    await expect(live).toHaveAttribute('role', 'status');
    const egg = talkEgg(page);
    for (let i = 0; i < 5; i += 1) {
      await pressAt(page, egg, info.project.name);
      await page.clock.runFor(150);
    }
    expect(await spoken()).toEqual([]);
    await page.clock.runFor(1000);
    expect(await spoken()).toHaveLength(1);
    // 2초 뒤 비운다
    await page.clock.runFor(2500);
    await expect(live).toHaveText('');

    // 누르다가 [다음]으로 질문이 바뀌면 그 묶음은 읽지 않는다
    await nick.fill('김주무관');
    await pressAt(page, egg, info.project.name);
    await nick.press('Enter');
    await page.clock.runFor(2000);
    expect(await spoken()).toHaveLength(1);
  });

  test('움직임 줄이기: 몸짓·조각 없이 글 한 줄과 멈춘 표시만, 다시 그리기 루프도 돌지 않는다', async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await startTalk(page);
    await tick(page, 1000);
    await pause(page);
    const egg = talkEgg(page);
    const rest = await canvasOf(egg);
    const raf = await countRaf(page);
    await pressAt(page, egg, info.project.name);
    await expect(say(egg)).toBeVisible();
    // 알이 멈춰 있으니 몸짓을 말하지 않는 문장(egg.poke.still)
    const line = (await say(egg).textContent()) ?? '';
    expect(POKE.still.tap[0]).toContain(line);
    expect(line).not.toMatch(MOTION_WORDS);
    // 멈춘 표시 한 장
    expect(await canvasOf(egg)).not.toBe(rest);
    await page.clock.runFor(1300);
    expect(await canvasOf(egg)).toBe(rest);
    expect(await raf()).toBe(0);

    // 이어 누른 묶음(꼼지락·폴짝 자리)의 글과 낭독도 몸짓을 말하지 않는다
    const lines: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await pressAt(page, egg, info.project.name);
      lines.push((await say(egg).textContent()) ?? '');
      await page.clock.runFor(150);
    }
    await page.clock.runFor(800);
    lines.push((await page.locator('#welcome-talk .egg-spoken').textContent()) ?? '');
    for (const text of lines) expect(text).not.toMatch(MOTION_WORDS);
    expect(lines.at(-1)).not.toBe('');
    expect(await raf()).toBe(0);
  });

  test('누른 채 세로로 끌면(스크롤) 취소: 글 없이 바로 제자리로 돌아오고, 눌린 그림이 남지 않는다', async ({
    page,
  }, info) => {
    await openApp(page);
    await startTalk(page);
    await tick(page, 1500);
    await pause(page);
    const egg = talkEgg(page);
    const rest = await canvasOf(egg);
    const box = await egg.boundingBox();
    if (!box) throw new Error('알 단추가 보이지 않는다');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (isMobile(info.project.name)) {
      const init = { pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      await egg.dispatchEvent('pointerdown', { ...init, clientX: x, clientY: y });
      expect(await canvasOf(egg)).not.toBe(rest);
      for (let i = 1; i <= 4; i += 1)
        await egg.dispatchEvent('pointermove', { ...init, clientX: x, clientY: y - i * 6 });
      // 스크롤로 넘어간 그 자리에서 제자리(시계를 돌리지 않고도)
      expect(await canvasOf(egg)).toBe(rest);
      await egg.dispatchEvent('pointercancel', { ...init, clientX: x, clientY: y - 24 });
    } else {
      // 마우스로 누른 채 끌다가 알 밖에서 떼면 취소(뒤따르는 click 도 확정이 아니다)
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i += 1) await page.mouse.move(x, y + i * ((box.height + 200) / 10));
      await page.mouse.up();
      await page.clock.runFor(100);
      await expect(say(egg)).toHaveCount(0);
      // 가로로 끌어 밖에서 떼도 취소
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i += 1) await page.mouse.move(x + i * 40, y);
      await page.mouse.up();
      await page.mouse.move(x, box.y + box.height + 200);
    }
    await page.clock.runFor(1500);
    await expect(say(egg)).toHaveCount(0);
    await expect(page.locator('#welcome-talk .egg-spoken')).toHaveText('');
    expect(await canvasOf(egg)).toBe(rest);
    // 그 뒤 누르면 평소처럼 답한다
    await pressAt(page, egg, info.project.name);
    await expect(say(egg)).toBeVisible();
  });

  test('Enter 를 누르고 있어도(키 반복) 한 번 누르기다', async ({ page }) => {
    await openApp(page);
    const nick = await startTalk(page);
    await nick.fill('홍길');
    await pause(page);
    await page.keyboard.press('Shift+Tab');
    const egg = talkEgg(page);
    await expect(egg).toBeFocused();
    await page.keyboard.down('Enter');
    for (let i = 0; i < 15; i += 1) {
      await page.clock.runFor(33);
      await page.keyboard.down('Enter');
    }
    await page.keyboard.up('Enter');
    expect(POKE.tap[0]).toContain(await say(egg).textContent());
    await page.clock.runFor(1000);
    expect(POKE.tap[0]).toContain(await page.locator('#welcome-talk .egg-spoken').textContent());
    await expect(page.locator('#talk-q')).toHaveText('뭐라고 불러 드릴까요?');
  });

  test('다 채운 알이 기다리며 들썩이는 중에 눌러도 누르는 순간 눌린 그림이 나온다(어느 박자든)', async ({
    page,
  }, info) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '한 번에 쓰기' }).click();
    const form = page.locator('#welcome-form');
    await form.getByLabel('닉네임').fill('김주무관');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2024-03-04');
    await fillDate(page, '다음 승급일', '2027-03-01');
    await pause(page);
    const egg = eggOf(form);
    // 들썩임(1.5초마다 320ms)의 여러 박자에 걸리게 기다리는 시간을 75ms 씩 바꿔 가며 누른다
    for (let k = 0; k < 20; k += 1) {
      await page.clock.runFor(1500 + 75 * k);
      const before = await canvasOf(egg);
      await pressAt(page, egg, info.project.name, { up: false });
      expect(await canvasOf(egg), `k=${k}`).not.toBe(before);
      const box = await egg.boundingBox();
      await egg.dispatchEvent('pointerup', {
        pointerId: 7,
        pointerType: isMobile(info.project.name) ? 'touch' : 'mouse',
        isPrimary: true,
        button: 0,
        clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
        clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2,
      });
    }
  });

  test('쉬는 동안에는 다시 그리지 않는다(누른 반응이 끝나면 rAF 0)', async ({ page }, info) => {
    await openApp(page);
    await startTalk(page);
    await tick(page, 1500);
    await pause(page);
    const egg = talkEgg(page);
    await pressAt(page, egg, info.project.name);
    await page.clock.runFor(1500);
    const raf = await countRaf(page);
    await page.clock.runFor(1000);
    expect(await raf()).toBe(0);
  });

  test('마우스를 올리면 알아채고(PC), 떼면 제자리. 터치에는 올리기가 없다', async ({
    page,
  }, info) => {
    await openApp(page);
    await startTalk(page);
    const egg = talkEgg(page);
    if (isMobile(info.project.name)) {
      expect(
        await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches),
      ).toBe(false);
      await egg.tap();
      await tick(page, 300);
      await expect(egg).not.toHaveAttribute('data-hover');
      return;
    }
    await tick(page, 1500);
    const rest = await canvasOf(egg);
    const box = await egg.boundingBox();
    if (!box) throw new Error('알 단추가 보이지 않는다');
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await expect(egg).toHaveAttribute('data-hover', '');
    expect(await canvasOf(egg)).not.toBe(rest);
    // 올린 채 머물거나 같은 칸 안에서 움직여도 다시 그리기 루프는 돌지 않는다(깜빡임 지난 뒤)
    await tick(page, 800);
    const raf = await countRaf(page);
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2 + 5);
    await tick(page, 1000);
    expect(await raf()).toBe(0);
    // 글·낭독은 내지 않는다
    await expect(say(egg)).toHaveCount(0);
    await expect(page.locator('#welcome-talk .egg-spoken')).toHaveText('');
    // 떠나면 제자리
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
    await expect(egg).not.toHaveAttribute('data-hover');
    await tick(page, 600);
    expect(await canvasOf(egg)).toBe(rest);
  });

  test('길게 누르면 품기. 알 위에서만 메뉴·글자 선택·두 번 눌러 확대를 막는다', async ({
    page,
  }, info) => {
    await openApp(page);
    await startTalk(page);
    await pause(page);
    const egg = talkEgg(page);
    await pressAt(page, egg, info.project.name, { holdMs: 700 });
    expect(POKE.hold).toContain(await say(egg).textContent());

    const prevented = (target: Locator) =>
      target.evaluate((el) => {
        const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        el.dispatchEvent(e);
        return e.defaultPrevented;
      });
    expect(await prevented(egg)).toBe(true);
    expect(await prevented(page.locator('#welcome-talk .bubble'))).toBe(false);
    const style = await egg.evaluate((el) => {
      const s = getComputedStyle(el);
      return { touch: s.touchAction, select: s.userSelect };
    });
    expect(style).toEqual({ touch: 'pan-y pinch-zoom', select: 'none' });
    // 단추 안에는 구문 내용만(div 없음)
    expect(await egg.locator('div').count()).toBe(0);
    const box = await egg.boundingBox();
    expect(box && box.height >= 44 && box.width >= 44).toBe(true);
  });

  test('진동은 켰을 때 손길 묶음에 한 번만 짧게, 끄면 울리지 않는다. 답할 때의 반응은 그대로다', async ({
    page,
  }, info) => {
    await stubVibrate(page);
    await openApp(page);
    const nick = await startTalk(page);
    const egg = talkEgg(page);
    await pause(page);
    await pressAt(page, egg, info.project.name);
    expect(await vibes(page)).toEqual([[20]]);
    // 이어 누르면 울리지 않는다
    await page.clock.runFor(150);
    for (let i = 0; i < 4; i += 1) {
      await pressAt(page, egg, info.project.name);
      await page.clock.runFor(150);
    }
    expect(await vibes(page)).toEqual([[20]]);
    await page.clock.runFor(1500);
    // 답하면 지금처럼 금이 가며 두 번 울리고, 맞장구·진행이 오른다(누름은 진행을 바꾸지 않았다)
    await nick.fill('김주무관');
    await nick.press('Enter');
    await expect(page.locator('#talk-ack')).toContainText('김주무관님');
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 1칸',
    );
    expect(await vibes(page)).toEqual([[20], [20, 40, 20]]);
    await page.clock.runFor(1500);
    // 진동을 끄면 알을 눌러도 울리지 않는다
    await page.getByRole('button', { name: '진동', exact: true }).click();
    await page.clock.runFor(1500);
    await pressAt(page, egg, info.project.name);
    expect(await vibes(page)).toHaveLength(2);
  });

  test('움직임 줄이기면 알을 눌러도 울리지 않는다', async ({ page }, info) => {
    await stubVibrate(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await startTalk(page);
    await poke(talkEgg(page), info.project.name);
    await tick(page, 300);
    await expect(say(talkEgg(page))).toBeVisible();
    expect(await vibes(page)).toEqual([]);
  });

  test("'한 번에 쓰기' 폼의 알도 같은 단추: 눌러도 칸의 포커스·값이 그대로고 칸 반응이 생기지 않는다", async ({
    page,
  }, info) => {
    await stubVibrate(page);
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '한 번에 쓰기' }).click();
    const form = page.locator('#welcome-form');
    const egg = eggOf(form);
    await expect(egg).toBeVisible();
    // 폼을 내려도 위에 붙어 있다(붙어 있기는 단추가 맡는다)
    expect(await egg.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    const year = form.getByLabel('생년월일 연도');
    await year.fill('19');
    await poke(egg, info.project.name);
    await tick(page, 300);
    await expect(year).toBeFocused();
    await expect(year).toHaveValue('19');
    await expect(say(egg)).toHaveClass(/sfx/);
    expect(POKE.sfx.tap).toContain(await say(egg).textContent());
    // 칸 반응(금·다 채움의 진동)은 없고 손길의 짧은 진동만
    expect(await vibes(page)).toEqual([[20]]);
  });

  test('알이었을 때 열두 번 넘게 눌러 주면 깨어난 호봉이가 인사로 기억한다(저장하지 않는다)', async ({
    page,
  }, info) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '한 번에 쓰기' }).click();
    const form = page.locator('#welcome-form');
    const egg = eggOf(form);
    for (let i = 0; i < 12; i += 1) {
      await pressAt(page, egg, info.project.name);
      await tick(page, 100);
    }
    await form.getByLabel('닉네임').fill('김주무관');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2024-03-04');
    await form.getByLabel('현재 호봉', { exact: true }).fill('3');
    await fillDate(page, '다음 승급일', '2027-03-01');
    await form.getByRole('button', { name: '알 깨우기' }).click();
    await tick(page, 2500);
    const greet = TALK.hatch.greetPoked.map((line) => line.replace('{nick}', '김주무관'));
    const result = page.locator('#hatch-result');
    await expect(result).toBeVisible();
    const text = (await result.textContent()) ?? '';
    expect(greet.some((line) => text.includes(line))).toBe(true);
    // 누른 수는 어디에도 저장하지 않는다
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/poke/i);
  });
});
