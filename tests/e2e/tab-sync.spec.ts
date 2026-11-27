/**
 * 다른 탭(또는 다른 hobong.html)이 바꾼 저장본을 이 탭의 저장이 덮어쓰지 않는다(#26, docs/PLAN.md 부록 C·J).
 *
 * CI 의 WebKit 에서만 드러난 순서를 Chromium 에서 결정적으로 되풀이한다: 페이지가 떠 있는 채로 저장소를
 * 바꾸고(같은 탭의 쓰기라 storage 이벤트가 오지 않는다 — WebKit 의 file:// 에서 다른 탭의 쓰기가 그렇듯),
 * 시계를 다음 날로 돌려 방문 기록(자동 저장)을 일으키거나 사용자가 무언가를 바꾼 뒤, 저장소가 그대로인지 본다.
 */
import { expect, test, type Page } from '@playwright/test';
import type { UserData } from '../../src/lib/store/schema.ts';
import {
  closeDialogs,
  collectErrors,
  fillDate,
  fillMonth,
  makeSeed,
  makeSeedV6,
  openApp,
  startForm,
  storedData,
  tick,
} from './helpers.ts';

/** 이 탭 모르게 저장소를 바꾼다(이 탭에는 storage 이벤트가 오지 않는다) */
async function writeBehind(page: Page, raw: string | null): Promise<void> {
  await page.evaluate((value) => {
    if (value === null) window.localStorage.removeItem('hobong.data');
    else window.localStorage.setItem('hobong.data', value);
  }, raw);
}

const rawOf = (page: Page) => page.evaluate(() => window.localStorage.getItem('hobong.data'));

/** 지금 저장본을 바꿔 이 탭 모르게 다시 쓴다(다른 탭이 그 탭의 화면에서 무언가를 바꾼 것처럼) */
async function editBehind(page: Page, mutate: (data: UserData) => void): Promise<void> {
  const raw = await rawOf(page);
  if (!raw) throw new Error('저장본이 없다');
  const env = JSON.parse(raw) as { data: UserData };
  mutate(env.data);
  await writeBehind(page, JSON.stringify(env));
}

/** 탭으로 돌아왔다(WebKit file:// 처럼 storage 이벤트 없이 포커스로 알아챈다) */
const refocus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

async function open(page: Page): Promise<void> {
  await openApp(page, { seed: makeSeedV6({ nickname: '예전 탭' }) });
  await tick(page, 2500);
  await closeDialogs(page);
  await expect(page.locator('#status .nick')).toHaveText('예전 탭');
}

const DISCARDED =
  /다른 탭\(또는 다른 hobong\.html\)에서 데이터가 바뀌어 방금 한 것은 저장하지 않았어요/;

test.describe('다른 탭이 바꾼 저장본', () => {
  test('자정의 방문 기록이 바깥에서 바뀐 저장본을 덮어쓰지 않는다(CI WebKit 의 순서)', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await open(page);
    const theirs = makeSeedV6({ nickname: '새 저장본' }, { retireMonth: '2040-12' });
    await writeBehind(page, theirs);
    // 떠 있던 페이지의 시계가 다음 날로 넘어가 방문을 기록한다
    await page.clock.setSystemTime(new Date('2026-11-26T09:00:00+09:00'));
    await tick(page, 1500);
    const stored = await storedData(page);
    expect(stored?.profile.nickname).toBe('새 저장본');
    expect(stored?.plan.retireMonth).toBe('2040-12');
    // 이 탭은 조용히 따라가고, 따라간 값 위에 오늘 방문을 기록한다
    expect(stored?.visits.days).toContain('2026-11-26');
    await expect(page.locator('#status .nick')).toHaveText('새 저장본');
    await expect(page.locator('.toasts')).not.toContainText('저장하지 않았어요');
    await expect(page.locator('#notice-stale')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('helpers 의 openApp 을 이어 부르면(시계를 다시 맞추고 새 저장본을 넣음) 새 저장본이 보인다', async ({
    page,
  }) => {
    // responsive.spec.ts '360px: 닫을 수 있는 안내 띠…'와 같은 차례. 정년이 지난 사람 → 다른 사람
    const retired = makeSeed(
      { birthDate: '1960-03-01', hireDate: '1985-03-01', gradeDate: '1985-03-01', step: 29 },
      { visits: { days: ['2028-01-04'], lastVisit: '2028-01-04' } },
    );
    await openApp(page, { seed: retired, time: '2028-01-05T10:00:00+09:00' });
    await expect(page.locator('#notice-retired')).toBeVisible();
    // 시계를 먼저 되돌리고 저장소를 바꾼 다음, 새로 고치기 전에 옛 페이지의 시계가 한 번 돈다(WebKit 에서 늘 그랬다)
    await page.clock.install({ time: new Date('2026-11-25T10:30:00+09:00') });
    await writeBehind(page, makeSeed({ nickname: '두 번째', hireDate: '2016-09-01' }));
    await tick(page, 1500);
    await page.reload();
    await tick(page);
    expect((await storedData(page))?.profile.nickname).toBe('두 번째');
    await expect(page.locator('#notice-retired')).toHaveCount(0);
  });

  test('사용자가 바꾼 것(금액 가리기)은 버리고 알린다. 다시 하면 바뀐 저장본 위에 저장된다', async ({
    page,
  }) => {
    await open(page);
    await writeBehind(page, makeSeedV6({ nickname: '새 저장본' }, { payday: 10 }));
    await page.getByRole('button', { name: '금액 가리기' }).click();
    await tick(page, 300);
    // 다른 탭의 값이 그대로다(따라간 뒤 자동 기록 — 본 모습·업적 — 은 그 위에 더해질 수 있다)
    const kept = await storedData(page);
    expect(kept?.profile.nickname).toBe('새 저장본');
    expect(kept?.settings.payday).toBe(10);
    expect(kept?.settings.hideAmounts).toBe(false);
    await expect(page.locator('.toasts')).toContainText(DISCARDED);
    await expect(page.locator('.toasts')).toContainText('바뀐 내용을 불러왔으니 다시 해 주세요');
    await expect(page.locator('#status .nick')).toHaveText('새 저장본');
    // 저장하지 못했다는 띠(저장 공간 부족 등)는 뜨지 않는다 — 이 탭의 메모리와 저장소가 같다
    await expect(page.getByText('방금 바꾼 내용을 저장하지 못했어요')).toHaveCount(0);
    await page.getByRole('button', { name: '금액 가리기' }).click();
    await tick(page, 300);
    const stored = await storedData(page);
    expect(stored?.settings.hideAmounts).toBe(true);
    expect(stored?.profile.nickname).toBe('새 저장본');
    expect(stored?.settings.payday).toBe(10);
  });

  test('퇴직 예정 달(docs/PLAN.md 부록 I39): 정했다고 하지 않고 다른 탭이 정한 달을 보인다', async ({
    page,
  }) => {
    await open(page);
    await writeBehind(page, makeSeedV6({ nickname: '예전 탭' }, { retireMonth: '2030-12' }));
    const win = page.locator('#lifetime');
    await page.locator('#lifetime-plan-open').click();
    await fillMonth(page, '퇴직 예정 달', '2035', '6');
    await page.locator('#lifetime-plan-submit').click();
    await tick(page, 300);
    expect((await storedData(page))?.plan.retireMonth).toBe('2030-12');
    await expect(page.locator('.toasts')).toContainText(DISCARDED);
    await expect(win.locator('#lifetime-head')).toContainText('2030년 12월까지 다닌다면');
    await expect(win).not.toContainText('2035년 6월');
    // 다시 하면 저장된다
    await page.locator('#lifetime-plan-open').click();
    await fillMonth(page, '퇴직 예정 달', '2035', '6');
    await page.locator('#lifetime-plan-submit').click();
    await tick(page, 300);
    expect((await storedData(page))?.plan.retireMonth).toBe('2035-06');
    await expect(win.locator('#lifetime-head')).toContainText('2035년 6월까지 다닌다면');
  });

  test('연가 기록: 기록했다고 하지 않는다', async ({ page }) => {
    await open(page);
    await writeBehind(page, makeSeedV6({ nickname: '새 저장본' }));
    await page.goto(`${page.url().split('#')[0]}#leave`);
    await tick(page, 600);
    await page.getByRole('button', { name: '1일', exact: true }).click();
    await tick(page, 300);
    const kept = await storedData(page);
    expect(kept?.profile.nickname).toBe('새 저장본');
    expect(kept?.leave.records).toEqual([]);
    await expect(page.locator('.toasts')).toContainText(DISCARDED);
    await expect(page.locator('.toasts')).not.toContainText('기록했어요');
  });

  test('다른 탭이 데이터를 지웠으면 첫 화면으로 가고 지웠다고 알린다', async ({ page }) => {
    await open(page);
    await writeBehind(page, null);
    await page.getByRole('button', { name: '금액 가리기' }).click();
    await tick(page, 300);
    expect(await rawOf(page)).toBeNull();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeVisible();
    await expect(page.locator('.toasts')).toContainText('데이터를 모두 지워서');
  });

  test('다른 탭이 읽지 못할 값으로 바꿨으면 건드리지 않고 새로 고치라고 한다', async ({ page }) => {
    await open(page);
    const broken = '{"app":"hobong","schemaVersion":6,';
    await writeBehind(page, broken);
    await page.getByRole('button', { name: '금액 가리기' }).click();
    await tick(page, 300);
    expect(await rawOf(page)).toBe(broken);
    await expect(page.locator('#notice-stale')).toContainText('읽지 못했어요');
    await expect(page.locator('.toasts')).not.toContainText('다시 해 주세요');
    // 자정의 자동 저장도 하지 않는다
    await page.clock.setSystemTime(new Date('2026-11-26T09:00:00+09:00'));
    await tick(page, 1500);
    expect(await rawOf(page)).toBe(broken);
    expect(await page.evaluate(() => window.localStorage.getItem('hobong.corrupt'))).toBeNull();
  });

  test('설정의 스위치·칸: 버려지면 저장값으로 돌아가고, 다시 누르면 바라던 값이 저장된다', async ({
    page,
  }) => {
    await open(page);
    await page.goto(`${page.url().split('#')[0]}#settings`);
    await tick(page, 600);
    const hide = page.getByRole('checkbox', { name: /금액 가리기/ });
    await expect(hide).not.toBeChecked();
    await writeBehind(page, makeSeedV6({ nickname: '새 저장본' }, { payday: 10 }));
    await hide.click({ force: true });
    await tick(page, 300);
    expect((await storedData(page))?.settings.hideAmounts).toBe(false);
    await expect(page.locator('.toasts')).toContainText(DISCARDED);
    // 스위치가 켜진 채로 남아 금액이 보이는 일이 없다
    await expect(hide).not.toBeChecked();
    await hide.click({ force: true });
    await tick(page, 300);
    expect((await storedData(page))?.settings.hideAmounts).toBe(true);
    await expect(hide).toBeChecked();
    // 다시 해서 저장됐으면 '저장하지 않았어요'는 닫힌다
    await expect(page.locator('.toasts')).not.toContainText(DISCARDED);

    // 근무시간 칸
    const start = page.getByLabel('출근');
    await expect(start).toHaveValue('09:00');
    await editBehind(page, (d) => (d.profile.nickname = '또 바뀜'));
    await start.fill('08:00');
    await tick(page, 300);
    expect((await storedData(page))?.settings.work.start).toBe('09:00');
    await expect(start).toHaveValue('09:00');

    // 직접 넣는 월급날 칸
    const payday = page.getByLabel('다른 날이면');
    await editBehind(page, (d) => (d.profile.nickname = '세 번째'));
    await payday.fill('7');
    await payday.blur();
    await tick(page, 300);
    expect((await storedData(page))?.settings.payday).toBe(10);
    // 10일은 고르는 칩에 있는 날이라 직접 넣는 칸은 비어 있어야 한다(친 7이 남지 않는다)
    await expect(payday).toHaveValue('');
  });

  test('카드의 스위치도 버려지면 저장값으로 돌아간다', async ({ page }) => {
    await open(page);
    await page.goto(`${page.url().split('#')[0]}#card`);
    await tick(page, 600);
    const badges = page.getByRole('checkbox', { name: '배지' });
    await expect(badges).toBeChecked();
    await editBehind(page, (d) => (d.profile.nickname = '새 저장본'));
    await badges.click({ force: true });
    await tick(page, 300);
    expect((await storedData(page))?.settings.card).toMatchObject({ showBadges: true });
    await expect(badges).toBeChecked();
  });

  test('내 정보 고치기: 연 뒤 포커스로 먼저 따라갔으면 옛 폼으로 덮지 않고 알린다', async ({
    page,
  }) => {
    await open(page);
    await page.goto(`${page.url().split('#')[0]}#settings`);
    await tick(page, 600);
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const form = page.getByRole('dialog', { name: '내 정보 고치기' });
    await expect(form.getByLabel('닉네임')).toHaveValue('예전 탭');
    await editBehind(page, (d) => (d.profile.nickname = 'B가 고친 이름'));
    await refocus(page);
    await tick(page, 300);
    await expect(page.locator('#set-profile')).toContainText('B가 고친 이름');
    await form.getByRole('button', { name: '저장' }).click();
    await tick(page, 300);
    expect((await storedData(page))?.profile.nickname).toBe('B가 고친 이름');
    await expect(form).toHaveCount(0);
    await expect(page.locator('.toasts')).toContainText(DISCARDED);
    await expect(page.locator('.toasts')).not.toContainText('내 정보를 고쳤어요');
  });

  test('꾸미기: 연 뒤 포커스로 먼저 따라갔으면 고른 것으로 덮지 않는다', async ({ page }) => {
    await open(page);
    await page.goto(`${page.url().split('#')[0]}#settings`);
    await tick(page, 600);
    await page.locator('#set-look').getByRole('button', { name: '꾸미기' }).click();
    const dialog = page.getByRole('dialog', { name: '호봉이 꾸미기' });
    await expect(dialog).toBeVisible();
    await editBehind(page, (d) => (d.profile.nickname = '새 저장본'));
    await refocus(page);
    await tick(page, 300);
    await dialog.getByRole('radio', { name: '하늘' }).check();
    await dialog.getByRole('button', { name: '바꾸기' }).click();
    await tick(page, 300);
    const stored = await storedData(page);
    expect(stored?.character.look.body).toBe('sunny');
    expect(stored?.profile.nickname).toBe('새 저장본');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.toasts')).toContainText(DISCARDED);
    await expect(page.locator('.toasts')).not.toContainText('모습을 바꿨어요');
  });

  test('지운 연가를 [되돌리기]: 그 사이 다른 탭이 바꿨어도 되살린다(다른 탭의 변경도 남는다)', async ({
    page,
  }) => {
    await open(page);
    await page.goto(`${page.url().split('#')[0]}#leave`);
    await tick(page, 600);
    await page.getByLabel('메모').fill('중요한 메모');
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    await tick(page, 7000);
    await page
      .locator('#leave-records')
      .getByRole('button', { name: /기록 지우기/ })
      .click();
    expect((await storedData(page))?.leave.records).toHaveLength(0);
    // 시드의 기본값(25일)과 다른 값이어야 덮어쓰기와 구별된다
    await editBehind(page, (d) => (d.settings.payday = 20));
    await page.getByRole('button', { name: '되돌리기' }).click();
    await tick(page, 300);
    const stored = await storedData(page);
    expect(stored?.leave.records.map((r) => r.memo)).toEqual(['중요한 메모']);
    expect(stored?.settings.payday).toBe(20);
    await expect(page.locator('.toasts')).not.toContainText('저장하지 않았어요');
  });

  test('첫 입력: 알 깨우기 전에 다른 탭이 먼저 넣었으면 불러온 닉네임을 알리고 포커스·뒤로 가기를 맞춘다', async ({
    page,
  }) => {
    await openApp(page);
    await startForm(page);
    await page.getByLabel('닉네임').fill('이 탭');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2024-03-04');
    await page.getByLabel('현재 직급').selectOption('9');
    await page.getByLabel('현재 호봉', { exact: true }).fill('3');
    await fillDate(page, '다음 승급일', '2027-03-01');
    await writeBehind(page, makeSeedV6({ nickname: 'B가 먼저' }));
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await tick(page, 600);
    expect((await storedData(page))?.profile.nickname).toBe('B가 먼저');
    await expect(page.locator('#status .nick')).toHaveText('B가 먼저');
    await expect(page.locator('.toasts')).toContainText(
      "그 데이터(닉네임 'B가 먼저')를 불러왔어요",
    );
    await expect(page.locator('.toasts')).toContainText('방금 넣은 내용은 저장하지 않았어요');
    await expect(page.locator('#main')).toBeFocused();
    // 끼워 둔 기록 자리를 거뒀다(홈에서 첫 [뒤로]가 헛돌지 않게)
    expect(
      await page.evaluate(
        () => (history.state as { hobongOnboarding?: boolean } | null)?.hobongOnboarding,
      ),
    ).toBeFalsy();
  });

  test('첫 입력 중에 포커스로 다른 탭의 데이터를 따라가도 말없이 폼을 치우지 않는다', async ({
    page,
  }) => {
    await openApp(page);
    await startForm(page);
    await page.getByLabel('닉네임').fill('넣던 이름');
    await writeBehind(page, makeSeedV6({ nickname: 'B가 먼저' }));
    await refocus(page);
    await tick(page, 600);
    await expect(page.locator('#status .nick')).toHaveText('B가 먼저');
    await expect(page.locator('.toasts')).toContainText(
      "그 데이터(닉네임 'B가 먼저')를 불러왔어요",
    );
    await expect(page.locator('#main')).toBeFocused();
    expect((await storedData(page))?.profile.nickname).toBe('B가 먼저');
  });

  test('이 기기 편의 값(hobong.prefs)은 다른 탭이 쓴 것을 옛 값으로 덮지 않는다', async ({
    page,
  }) => {
    await openApp(page);
    await page.evaluate(() =>
      window.localStorage.setItem('hobong.prefs', JSON.stringify({ packageGuide: 'done' })),
    );
    await page.getByRole('button', { name: '새로 시작' }).click();
    await tick(page, 300);
    const prefs = await page.evaluate(() => window.localStorage.getItem('hobong.prefs'));
    expect(JSON.parse(prefs ?? '{}')).toEqual({ packageGuide: 'done', onboardMode: 'talk' });
  });
});
