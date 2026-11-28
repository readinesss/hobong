/**
 * 말을 거는 첫 입력(#23·#21): 알이 하나씩 묻고, 답할 때마다 맞장구를 친다.
 * 한 화면 폼('한 번에 쓰기')의 검증은 onboarding.spec 에 있다.
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, fillDate, makeSeedV5, NOW, openApp, storedData, tick } from './helpers.ts';

const next = (page: Page) => page.getByRole('button', { name: '다음', exact: true });
const bubble = (page: Page) => page.locator('#welcome-talk .bubble');
const prefsOf = (page: Page) =>
  page.evaluate(() => JSON.parse(window.localStorage.getItem('hobong.prefs') ?? '{}'));

/** 인사에서 시작해 닉네임·생년월일·임용일까지 답한다(직종 질문에서 멈춘다) */
async function untilTrack(page: Page): Promise<void> {
  await page.getByRole('button', { name: '새로 시작' }).click();
  await page.getByRole('button', { name: '시작할게요' }).click();
  await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('김주무관');
  await next(page).click();
  await fillDate(page, '생년월일', '1996-04-12');
  await next(page).click();
  await fillDate(page, '임용일', '2024-03-04');
  await next(page).click();
  await expect(bubble(page)).toContainText('어떤 직종이에요?');
}

/**
 * 직종 질문에서 일반직·별표 3 그대로 직렬 질문까지 간다.
 * 답하면 맞장구를 먼저 보여 주고(그동안 [다음]을 다시 받지 않는다) 질문이 바뀌므로, 바뀐 질문을 보고 나서 누른다.
 */
async function fromTrackToSeries(page: Page): Promise<void> {
  await next(page).click();
  await expect(bubble(page)).toContainText('어느 봉급표를 쓰세요?');
  await next(page).click();
  await expect(bubble(page)).toContainText('직렬도 골라 볼까요?');
}

/** 계급 질문부터 확인 단계까지(9급·3호봉·다음 승급일 2027-03-01·월급날 기본) */
async function fromRankToSummary(page: Page): Promise<void> {
  await expect(bubble(page)).toContainText('골라 주세요');
  await next(page).click();
  await page.getByLabel('현재 호봉', { exact: true }).fill('3');
  await next(page).click();
  await fillDate(page, '다음 승급일', '2027-03-01');
  await next(page).click();
  await expect(bubble(page)).toContainText('월급날은 며칠이에요?');
  await next(page).click();
  await expect(page.getByRole('heading', { level: 1, name: '이대로 깨워 볼까요?' })).toBeFocused();
}

test.describe('말을 거는 첫 입력', () => {
  test('헷갈리는 칸은 나중에 고칠 수 있다고 알려 준다(호봉 질문과 확인 화면)', async ({ page }) => {
    await openApp(page);
    await untilTrack(page);
    await fromTrackToSeries(page);
    // 직렬은 고르지 않고 넘어간다 → 계급 질문
    await next(page).click();
    await expect(bubble(page)).toContainText('골라 주세요');
    await next(page).click();
    // 호봉 질문: 입력 칸의 설명으로 이어져 낭독된다
    const step = page.getByLabel('현재 호봉', { exact: true });
    await expect(step).toBeVisible();
    const hint = page
      .locator('#welcome-talk')
      .getByText("설정의 '내 정보'에서 언제든 고칠 수 있어요");
    await expect(hint).toBeVisible();
    const hintId = await hint.getAttribute('id');
    expect(hintId, '안내에 id 가 있어야 입력 칸의 설명으로 이을 수 있다').toBeTruthy();
    expect((await step.getAttribute('aria-describedby')) ?? '').toContain(hintId as string);
    await step.fill('3');
    await next(page).click();
    await fillDate(page, '다음 승급일', '2027-03-01');
    await next(page).click();
    await expect(bubble(page)).toContainText('월급날은 며칠이에요?');
    await next(page).click();
    // 확인 화면: [알 깨우기]의 설명으로 한 번 더 알린다
    await expect(
      page.getByRole('heading', { level: 1, name: '이대로 깨워 볼까요?' }),
    ).toBeFocused();
    const wake = page.getByRole('button', { name: '알 깨우기' });
    await expect(page.locator('#tk-later')).toHaveText(
      "깨운 뒤에도 설정의 '내 정보'에서 언제든 고칠 수 있어요.",
    );
    await expect(wake).toHaveAttribute('aria-describedby', 'tk-later');
  });

  test('"새로 시작"을 누르면 알이 인사하고, 진행 막대와 "한 번에 쓰기"가 있다', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '호봉이와 첫 만남' })).toBeFocused();
    await expect(page).toHaveTitle('호봉이와 첫 만남 · 호봉');
    await expect(bubble(page)).toContainText('호봉이예요');
    await expect(page.getByRole('button', { name: '시작할게요' })).toBeVisible();
    // 같은 이름의 버튼은 하나뿐이다
    await expect(page.getByRole('button', { name: '한 번에 쓰기' })).toHaveCount(1);
    const bar = page.getByRole('progressbar', { name: '채운 칸' });
    await expect(bar).toHaveAttribute('aria-valuetext', '9칸 중 0칸');
    // 알 그림은 장식이다(뜻은 글로 전한다)
    await expect(page.locator('#welcome-talk .stage')).toHaveAttribute('aria-hidden', 'true');
    expect(await storedData(page)).toBeNull();
  });

  test('질문마다 입력 칸에 포커스가 가고, 질문이 이름·맞장구와 남은 칸이 설명이 된다', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();

    const nick = page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' });
    await expect(nick).toBeFocused();
    await expect(nick).toHaveAccessibleDescription(/남은 칸 9개\./);
    // 필수 칸에는 건너뛰기가 없다
    await expect(page.getByRole('button', { name: '건너뛰기' })).toHaveCount(0);
    await nick.fill('김주무관');
    await nick.press('Enter');

    // 생년월일: 묶음의 이름은 질문, 첫 칸에 포커스. 맞장구는 닉네임을 부른다(설명으로만 읽힌다: 알림 영역 없음).
    // 설명은 포커스를 받는 연도 칸에 달려 있다(묶음의 설명을 읽지 않는 낭독기에서도 읽힌다). 묶음에는 달지 않는다(두 번 읽지 않게)
    const birthYear = page.getByLabel('생년월일 연도');
    await expect(birthYear).toBeFocused();
    const birth = page.getByRole('group', { name: '생년월일을 알려 주세요.' });
    await expect(birth).toBeVisible();
    await expect(birthYear).toHaveAccessibleDescription(
      /김주무관님.*알에 작은 금이 생겼어요\. 남은 칸 8개\..*정년퇴직일을 셀 때만 써요/,
    );
    await expect(birth).not.toHaveAttribute('aria-describedby');
    // 맞장구는 그림과 맞는다: 첫 칸에서 금 단계가 올랐으니(S0 → S1) 금을 말한다
    await expect(page.locator('#talk-ack')).toContainText(/금이 갔어요|작은 금이 생겼어요/);
    await expect(page.locator('#welcome-talk [role="alert"]')).toHaveCount(0);
    await expect(page.locator('#welcome-talk [aria-live]')).toHaveCount(0);
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 1칸',
    );
    await fillDate(page, '생년월일', '1996-04-12');
    await next(page).click();

    // 둘째·셋째 칸에서는 금 단계가 그대로다(9칸 중 2·3칸 = S1): 금을 말하지 않고, 그 칸의 몸짓(까딱)을 말한다
    await expect(page.getByLabel('임용일 연도')).toBeFocused();
    await expect(page.locator('#talk-ack')).not.toContainText(/금이|금 사이|조금만 더/);
    await expect(page.locator('#talk-ack')).toContainText(/까딱/);
    await expect(page.getByLabel('임용일 연도')).toHaveAccessibleDescription(
      /알에 작은 금이 생겼어요\. 남은 칸 7개\./,
    );
    await fillDate(page, '임용일', '2024-03-04');
    await next(page).click();

    // 직종(필수): 고른 칩에 포커스, 건너뛰기 없음
    await expect(page.getByRole('radio', { name: '일반직', exact: true })).toBeFocused();
    await expect(page.locator('#talk-ack')).not.toContainText(/금이|금 사이|조금만 더/);
    await expect(
      page.getByRole('radiogroup', { name: '어떤 직종이에요?' }),
    ).toHaveAccessibleDescription(/알에 작은 금이 생겼어요\. 남은 칸 6개\./);
    await expect(page.getByRole('button', { name: '건너뛰기' })).toHaveCount(0);
    // 칩에서 Enter 는 [다음]과 같다(화살표로 고르고 바로 넘어간다). 넷째 칸에서 금이 길어진다(S2)
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: '일반직', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');

    // 봉급표(일반직만)
    await expect(page.getByRole('radio', { name: '일반직(별표 3)' })).toBeFocused();
    await expect(page.locator('#talk-ack')).toContainText(
      /금이 조금 더 길어졌어요|금이 쭉 길어졌어요/,
    );
    // Space 는 고르기일 뿐 넘어가지 않는다
    await page.keyboard.press('Space');
    await expect(bubble(page)).toContainText('어느 봉급표를 쓰세요?');
    await page.keyboard.press('Enter');

    // 직렬(선택): 건너뛸 수 있다
    await expect(bubble(page)).toContainText('직렬도 골라 볼까요?');
    await expect(page.getByRole('searchbox', { name: '직렬·직류 찾기' })).toBeFocused();
    await expect(
      page.getByRole('searchbox', { name: '직렬·직류 찾기' }),
    ).toHaveAccessibleDescription(/남은 칸 4개\./);
    // 도움말은 한 줄이고, 어디에 저장하고 어디에 보이는지는 [자세히]에 접혀 있다([다음]이 화면 밖으로 밀리지 않게)
    const seriesField = page.locator('#tk-series-field');
    await expect(seriesField.locator('#tk-series-hint')).toHaveText(
      '선택 사항이에요. 계산에는 쓰지 않고, 어울리는 소품을 권할 때만 써요.',
    );
    await expect(seriesField).not.toContainText('임용정보 패키지에는 들어가요');
    const seriesMore = seriesField.getByRole('button', { name: '자세히' });
    await expect(seriesMore).toHaveAttribute('aria-expanded', 'false');
    await seriesMore.click();
    await expect(seriesMore).toHaveAttribute('aria-expanded', 'true');
    await expect(seriesField.locator('#tk-series-more')).toContainText(
      '소품으로 직렬이 짐작될 수 있어요',
    );
    await page.getByRole('button', { name: '건너뛰기' }).click();

    // 계급: 사다리의 칩 + 승진 여부
    await expect(bubble(page)).toContainText('지금 직급을 골라 주세요.');
    await expect(page.getByRole('radio', { name: '9급', exact: true })).toBeFocused();
    await expect(
      page.getByRole('radiogroup', { name: '임용된 뒤 승진한 적이 있어요?' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '건너뛰기' })).toHaveCount(0);
    await next(page).click();

    // 호봉: 든 숫자('1')가 모두 골라져 있어, 그대로 치면 바뀐다('13'이 되지 않는다)
    const stepBox = page.getByLabel('현재 호봉', { exact: true });
    await expect(stepBox).toBeFocused();
    await expect(stepBox).toHaveValue('1');
    await page.keyboard.type('3');
    await expect(stepBox).toHaveValue('3');
    await next(page).click();

    await expect(page.getByLabel('다음 승급일 연도')).toBeFocused();
    // '잘 모르겠어요'가 어림한 날을 채운다
    await page.getByRole('button', { name: /모르겠어요/ }).click();
    await expect(page.getByLabel('다음 승급일 연도')).toHaveValue('2027');
    // 누른 버튼은 사라진다: 포커스는 허공(BODY)이 아니라 [다음]으로 간다
    await expect(page.getByRole('button', { name: /모르겠어요/ })).toHaveCount(0);
    await expect(next(page)).toBeFocused();
    await fillDate(page, '다음 승급일', '2027-03-01');
    await next(page).click();

    await expect(page.getByRole('radio', { name: '25일' })).toBeFocused();
    await expect(
      page.getByRole('radiogroup', { name: '월급날은 며칠이에요?' }),
    ).toHaveAccessibleDescription(/남은 칸 1개\..*잘 모르겠으면 그대로 두세요/);
    // 날짜마다의 기관은 [자세히]에. 기본값의 근거(별표 30)는 대화에 적지 않는다
    const ask = page.locator('#welcome-talk form.ask');
    await expect(ask).not.toContainText('그 밖의 기관');
    await ask.getByRole('button', { name: '자세히' }).click();
    await expect(ask.locator('#tk-more')).toHaveText('25일: 그 밖의 기관 및 그 소속 기관');
    await page.getByRole('radio', { name: '25일' }).focus();
    await page.keyboard.press('Enter');
    // 마지막 필수 칸: 다 채웠다고 말한다
    await expect(page.locator('#talk-ack')).toContainText(/다 채웠어요|다 됐어요/);

    // 확인: 제목에 포커스, 다 채웠다
    await expect(
      page.getByRole('heading', { level: 1, name: '이대로 깨워 볼까요?' }),
    ).toBeFocused();
    await expect(page).toHaveTitle('이대로 깨워 볼까요? · 호봉');
    // 답 목록이 길어도 [알 깨우기]는 화면 아래에 붙어 늘 보이고, 빛나는 알도 함께 보인다
    await expect(page.getByRole('button', { name: '알 깨우기' })).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#welcome-talk .stage')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 9칸',
    );
    const summary = page.locator('#talk-summary');
    await expect(summary).toContainText('김주무관');
    await expect(summary).toContainText('1996. 4. 12.');
    await expect(summary).toContainText('3호봉');
    await expect(summary).toContainText('고르지 않음');
    expect(await storedData(page)).toBeNull();

    // 알 깨우기 → 제자리 부화(건너뛰기가 첫 포커스) → 홈
    await page.getByRole('button', { name: '알 깨우기' }).click();
    const skip = page.getByRole('button', { name: '건너뛰기' });
    await expect(skip).toBeFocused();
    // 연출 중에도 데이터는 이미 저장돼 있다
    expect((await storedData(page))?.profile.nickname).toBe('김주무관');
    await page.keyboard.press('Escape');
    const result = page.locator('#hatch-result');
    await expect(result).toContainText('알봉이');
    await expect(result).toContainText('김주무관님');
    // 인사는 포커스가 가는 [바로 시작하기]의 설명으로 한 번만 읽힌다(알림 영역과 겹쳐 읽지 않는다)
    const go = page.getByRole('button', { name: '바로 시작하기' });
    await expect(go).toBeFocused();
    await expect(go).toHaveAccessibleDescription(/알봉이.*김주무관님/);
    await expect(page.locator('#welcome-hatch [role="status"]')).toHaveCount(0);
    // 끝 장면은 누를 때까지 머문다(읽을 시간을 사람이 정한다: 저절로 넘어가지 않는다)
    await tick(page, 8000);
    await expect(result).toBeVisible();
    await expect(go).toBeFocused();
    await go.click();
    await expect(page.locator('#status-title')).toBeFocused();
    await expect(page.locator('#home-arrived')).toHaveText('호봉이가 깨어났어요. 홈 화면이에요.');
    await tick(page, 2500);
    await expect(page.locator('#status')).toContainText('9급 3호봉');

    const data = await storedData(page);
    expect(data?.profile).toMatchObject({
      nickname: '김주무관',
      birthDate: '1996-04-12',
      hireDate: '2024-03-04',
      track: 'general',
      payTable: 'table3',
      series: null,
      rank: '9',
      rankDate: '2024-03-04',
      step: 3,
      nextStepDate: '2027-03-01',
    });
    expect(data?.settings.payday).toBe(25);
    expect(data?.settings.identity.showSeriesHome).toBe(true);
    expect(data?.character.look.prop).toBe('auto');
    expect(await prefsOf(page)).toEqual({ onboardMode: 'talk', packageGuide: 'pending' });
    expect(errors).toEqual([]);
  });

  test('값을 고쳐야 하면 넘어가지 않고 다정하게 알려 준다(알림 영역 없이 칸의 설명으로)', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    await next(page).click();
    const nick = page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' });
    await expect(nick).toHaveAttribute('aria-invalid', 'true');
    await expect(nick).toBeFocused();
    await expect(page.locator('#tk-error')).toHaveText('닉네임을 넣어 주세요.');
    await expect(page.locator('#talk-oops')).toBeVisible();
    await expect(page.locator('#welcome-talk [role="alert"]')).toHaveCount(0);
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 0칸',
    );
    await nick.fill('테스트');
    await next(page).click();
    // 없는 날짜는 그 까닭을 알려 준다
    await page.getByLabel('생년월일 연도').fill('1996');
    await page.getByLabel('생년월일 월').fill('2');
    await page.getByLabel('생년월일 일').fill('30');
    await next(page).click();
    await expect(page.locator('#tk-birth-error')).toHaveText(
      '없는 날짜예요. 1996년 2월은 29일까지예요.',
    );
    await expect(bubble(page)).toContainText('생년월일을 알려 주세요.');
  });

  test('뒤로 가도 값이 남고, 알의 금과 진행은 줄지 않는다', async ({ page }) => {
    await openApp(page);
    await untilTrack(page);
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 3칸',
    );
    await page.getByRole('button', { name: '이전 질문' }).click();
    await expect(page.getByLabel('임용일 연도')).toBeFocused();
    await expect(page.getByLabel('임용일 연도')).toHaveValue('2024');
    await expect(page.getByLabel('임용일 월')).toHaveValue('3');
    await page.getByRole('button', { name: '이전 질문' }).click();
    await expect(page.getByLabel('생년월일 일')).toHaveValue('12');
    await page.getByRole('button', { name: '이전 질문' }).click();
    await expect(page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' })).toHaveValue(
      '김주무관',
    );
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 3칸',
    );
  });

  test('"한 번에 쓰기"와 오가도 값이 남고, 고른 방식을 기억한다', async ({ page }) => {
    await openApp(page);
    await untilTrack(page);
    await page.getByRole('button', { name: '한 번에 쓰기' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '내 정보 넣기' })).toBeFocused();
    await expect(page.getByLabel('닉네임')).toHaveValue('김주무관');
    await expect(page.getByLabel('임용일 연도')).toHaveValue('2024');
    expect(await prefsOf(page)).toEqual({ onboardMode: 'form' });
    await page.getByLabel('닉네임').fill('호봉집사');

    // 첫 화면으로 갔다 오면 폼이 바로 열린다(기억한 방식)
    await page.getByRole('button', { name: '뒤로' }).click();
    await page.getByRole('button', { name: '새로 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '내 정보 넣기' })).toBeFocused();

    // 다시 하나씩 묻기로: 하던 질문과 고친 값이 그대로다
    await page.getByRole('button', { name: '하나씩 묻기' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '호봉이와 첫 만남' })).toBeFocused();
    await expect(bubble(page)).toContainText('어떤 직종이에요?');
    await page.getByRole('button', { name: '이전 질문' }).click();
    await page.getByRole('button', { name: '이전 질문' }).click();
    await page.getByRole('button', { name: '이전 질문' }).click();
    await expect(page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' })).toHaveValue(
      '호봉집사',
    );
    expect(await prefsOf(page)).toEqual({ onboardMode: 'talk' });

    // 새로 고쳐도 방식은 남는다(입력값은 저장하지 않는다)
    await page.reload();
    await tick(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '호봉이와 첫 만남' })).toBeFocused();
    expect(await storedData(page)).toBeNull();
  });

  test('경찰: 봉급표·직렬은 묻지 않고, 직종 소품은 물어본 뒤 "들기"를 골라야 든다', async ({
    page,
  }) => {
    await openApp(page);
    await untilTrack(page);
    await page.getByRole('radio', { name: '경찰', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '8칸 중 3칸',
    );
    await next(page).click();
    // 소품(선택): 들기 / 나중에
    await expect(bubble(page)).toContainText('어울리는 소품을 들어 볼까요?');
    await expect(page.locator('#welcome-talk')).toContainText('손전등');
    await expect(page.locator('#welcome-talk')).toContainText('소품은 카드 그림에도 보여요');
    // 포커스가 가는 [들기]가 무엇을 드는지 스스로 말한다: 질문·소품 이름·카드에 보인다는 안내·알 상태
    const take = page.getByRole('button', { name: '들기' });
    await expect(take).toBeFocused();
    await expect(take).toHaveAccessibleDescription(
      /어울리는 소품을 들어 볼까요\?.*손전등.*소품은 카드 그림에도 보여요.*남은 칸 \d+개\./,
    );
    await expect(page.getByRole('button', { name: '나중에' })).toHaveAccessibleDescription(
      /손전등.*카드 그림에도 보여요/,
    );
    await page.getByRole('button', { name: '나중에' }).click();
    // 계급: 경찰 사다리
    await expect(bubble(page)).toContainText('지금 계급을 골라 주세요.');
    await expect(page.getByRole('radio', { name: '순경' })).toBeVisible();
    // 고를 수 없는 계급은 한 줄로만 알린다. 봉급표 근거(별표 10) 같은 규정 문장은 대화에 적지 않는다
    await expect(page.locator('#tk-unselectable')).toHaveText(
      '치안총감은 여기서는 고를 수 없어요.',
    );
    await expect(page.locator('#welcome-talk form.ask')).not.toContainText('별표');
    await page.getByRole('radio', { name: '경위' }).click();
    await fromRankToSummary(page);
    await expect(page.locator('#talk-summary')).toContainText('나중에');

    // 확인에서 소품을 고쳐 '들기'로 바꾸고, 홈 공개 스위치를 끈다
    await page.getByRole('button', { name: '소품 고치기' }).click();
    await page.getByRole('button', { name: '들기' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: '이대로 깨워 볼까요?' }),
    ).toBeFocused();
    await expect(page.locator('#talk-summary')).toContainText('손전등');
    await page.getByRole('checkbox', { name: '홈에 직렬·계급 이름 보이기' }).uncheck();
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await page.getByRole('button', { name: '건너뛰기' }).click();
    // 경위는 알봉이가 아니다: 끝 장면의 이름이 그 모습이다
    await expect(page.locator('#hatch-result')).toContainText('날봉이');
    await page.getByRole('button', { name: '바로 시작하기' }).click();
    await tick(page, 2500);

    const data = await storedData(page);
    expect(data?.profile).toMatchObject({
      track: 'police',
      payTable: null,
      rank: '경위',
      series: null,
    });
    expect(data?.character.look.prop).toBe('flashlight');
    expect(data?.settings.identity.showSeriesHome).toBe(false);
    // 홈에는 계급 이름 없이 호봉만
    await expect(page.locator('#status')).toContainText('3호봉');
    await expect(page.locator('#status')).not.toContainText('경위');
  });

  test('일반직 직렬: 고르면 소품을 묻고, "나중에"면 들지 않는다. 직렬을 바꾸면 다시 묻는다', async ({
    page,
  }) => {
    await openApp(page);
    await untilTrack(page);
    await fromTrackToSeries(page);
    await page.getByLabel('직렬', { exact: true }).selectOption('간호');
    await next(page).click();
    await expect(bubble(page)).toContainText('어울리는 소품을 들어 볼까요?');
    await expect(page.locator('#welcome-talk')).toContainText('청진기');
    await page.getByRole('button', { name: '들기' }).click();
    await fromRankToSummary(page);
    await expect(page.locator('#talk-summary')).toContainText('청진기');

    // 직렬을 지우면(고르지 않음) 소품 질문이 사라지고 소품은 기본으로 돌아간다
    await page.getByRole('button', { name: '직렬 고치기' }).click();
    await page.getByLabel('직렬', { exact: true }).selectOption('');
    await page.getByRole('button', { name: '확인으로 돌아가기' }).click();
    await expect(page.getByRole('button', { name: '소품 고치기' })).toHaveCount(0);

    // 다시 골라 '나중에'
    await page.getByRole('button', { name: '직렬 고치기' }).click();
    await page.getByLabel('직렬', { exact: true }).selectOption('간호');
    await page.getByRole('button', { name: '확인으로 돌아가기' }).click();
    await page.getByRole('button', { name: '소품 고치기' }).click();
    await page.getByRole('button', { name: '나중에' }).click();
    await expect(page.locator('#talk-summary')).toContainText('들지 않기');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await page.getByRole('button', { name: '바로 시작하기' }).click();
    await tick(page, 2500);
    const data = await storedData(page);
    expect(data?.profile.series).toBe('간호');
    expect(data?.character.look.prop).toBe('none');
    await expect(page.locator('#status-series')).toHaveText('간호 직렬');
  });

  test('교원: 계급을 묻지 않고 필수 칸이 7개다', async ({ page }) => {
    await openApp(page);
    await untilTrack(page);
    await page.getByRole('radio', { name: '교원', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '7칸 중 3칸',
    );
    await next(page).click();
    // 소품(작은 칠판)은 건너뛴다
    await page.getByRole('button', { name: '나중에' }).click();
    await expect(bubble(page)).toContainText('지금 몇 호봉이에요?');
  });

  test('확인 단계에서 호봉이를 꾸미면 그 모습으로 깨어난다', async ({ page }) => {
    await openApp(page);
    await untilTrack(page);
    await fromTrackToSeries(page);
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await fromRankToSummary(page);
    await page.getByRole('button', { name: '호봉이 꾸미기' }).click();
    const dialog = page.getByRole('dialog', { name: '호봉이 꾸미기' });
    await dialog.getByRole('radio', { name: '하늘', exact: true }).check();
    await dialog.getByRole('button', { name: '이 모습으로' }).click();
    await expect(page.locator('#talk-summary')).toContainText('고른 모습으로 깨어날게요.');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await page.getByRole('button', { name: '바로 시작하기' }).click();
    await tick(page, 2500);
    expect((await storedData(page))?.character.look.body).toBe('sky');
    await expect(page.locator('#status').getByRole('img', { name: /하늘 몸/ })).toBeVisible();
  });

  test('화면 키보드가 올라와 높이가 줄어도 말풍선과 [다음]이 보인다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    const nick = page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' });
    await expect(nick).toBeFocused();
    await expect(page.locator('#welcome-talk .stage')).toBeVisible();
    // 키보드가 화면의 절반쯤을 가린다(보이는 높이 360px)
    await page.setViewportSize({ width: 390, height: 360 });
    await tick(page, 600);
    // 큰 알 무대는 물러나지만 알은 사라지지 않는다: 말풍선 옆 작은 무대에서 같은 반응을 보여 준다.
    // 작은 알·말풍선·입력 칸·[다음]이 한 화면에 든다
    await expect(page.locator('#welcome-talk .stage')).toHaveCount(0);
    const mini = page.locator('#welcome-talk .egg-mini');
    await expect(mini).toHaveAttribute('aria-hidden', 'true');
    await expect(mini.locator('canvas')).toBeVisible();
    for (const target of [mini, bubble(page), nick, next(page)]) {
      await expect(target).toBeInViewport({ ratio: 1 });
    }
    // 다음 질문(세 칸 날짜)에서도
    await nick.fill('김주무관');
    await next(page).click();
    await tick(page, 600);
    for (const target of [mini, bubble(page), page.getByLabel('생년월일 연도'), next(page)]) {
      await expect(target).toBeInViewport({ ratio: 1 });
    }
    // 가로로 넘치지 않는다
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    // 키보드가 내려가면 알이 돌아온다
    await page.setViewportSize({ width: 390, height: 664 });
    await tick(page, 300);
    await expect(page.locator('#welcome-talk .stage')).toBeVisible();
    await expect(mini).toHaveCount(0);
  });

  test('답하면 맞장구를 먼저 보여 주고 나서 질문을 바꾼다(그동안 [다음]을 다시 받지 않는다)', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    const nick = page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' });
    await nick.fill('김주무관');
    // 시계를 멈춰 맞장구가 보이는 사이를 본다
    await page.clock.pauseAt(new Date(Date.parse(NOW) + 60_000));
    await nick.press('Enter');
    await expect(page.locator('#talk-ack')).toContainText('김주무관님');
    await expect(page.locator('#talk-q')).toBeHidden();
    await expect(nick).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 1칸',
    );
    // 그 사이 한 번 더 눌러도 질문을 건너뛰지 않는다
    await nick.press('Enter');
    await page.clock.runFor(500);
    await expect(page.getByLabel('생년월일 연도')).toBeFocused();
    await expect(page.locator('#talk-q')).toBeVisible();
    await expect(page.locator('#talk-q')).toHaveText('생년월일을 알려 주세요.');
    await expect(page.getByRole('progressbar', { name: '채운 칸' })).toHaveAttribute(
      'aria-valuetext',
      '9칸 중 1칸',
    );
  });

  test('브라우저의 뒤로 가기는 사이트를 떠나지 않고 이전 질문으로 간다. 값이 있으면 떠나기 전에 묻는다', async ({
    page,
  }) => {
    const leaveAsks = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    await openApp(page);
    const url = page.url();
    // 아무것도 넣지 않았으면 묻지 않는다
    expect(await leaveAsks()).toBe(false);
    await untilTrack(page);
    expect(await leaveAsks()).toBe(true);

    await page.goBack();
    expect(page.url()).toBe(url);
    await expect(page.getByLabel('임용일 연도')).toBeFocused();
    await expect(page.getByLabel('임용일 연도')).toHaveValue('2024');
    await page.goBack();
    await expect(page.getByLabel('생년월일 일')).toHaveValue('12');
    await page.goBack();
    await expect(page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' })).toHaveValue(
      '김주무관',
    );
    // 인사 → 첫 화면. 그 뒤로는 끼워 둔 기록이 없다(뒤로 가기가 헛돌지 않는다)
    await page.goBack();
    await expect(bubble(page)).toContainText('호봉이예요');
    await page.goBack();
    expect(page.url()).toBe(url);
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeFocused();
    expect(await page.evaluate(() => history.state)).toBeNull();
    // 반쯤 저장하지 않는다
    expect(await storedData(page)).toBeNull();

    // 화면의 [뒤로]로 첫 화면에 와도 기록 자리를 거둔다
    await page.getByRole('button', { name: '새로 시작' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '호봉이와 첫 만남' })).toBeFocused();
    expect(await page.evaluate(() => history.state)).toEqual({ hobongOnboarding: true });
    await page.locator('#welcome-talk').getByRole('button', { name: '뒤로' }).click();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeFocused();
    await expect.poll(() => page.evaluate(() => history.state)).toBeNull();

    // 깨운 뒤에는 묻지 않고, 홈에서 뒤로 가기가 첫 입력으로 되돌리지 않는다
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '한 번에 쓰기' }).click();
    const form = page.locator('#welcome-form');
    await form.getByLabel('현재 호봉', { exact: true }).fill('3');
    await form.getByLabel('다음 승급일 연도').fill('20270301');
    await form.getByRole('button', { name: '알 깨우기' }).click();
    await expect(page.getByRole('button', { name: '건너뛰기' })).toBeFocused();
    expect(await leaveAsks()).toBe(false);
    await expect.poll(() => page.evaluate(() => history.state)).toBeNull();
  });

  test("닉네임이 '님'으로 끝나면 맞장구에 '님'을 덧붙이지 않는다", async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    // 인사말은 언제 저장되는지 사실대로 말한다(깨우기 전에는 저장하지 않는다)
    await expect(page.locator('#welcome-talk')).toContainText(
      '알을 깨울 때 이 브라우저에만 저장돼요(그 전에 창을 닫으면 사라져요)',
    );
    await page.getByRole('button', { name: '시작할게요' }).click();
    await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('호봉집사님');
    await next(page).click();
    await expect(page.getByLabel('생년월일 연도')).toBeFocused();
    await expect(page.locator('#talk-ack')).toContainText('호봉집사님');
    await expect(page.locator('#talk-ack')).not.toContainText('님님');
  });
});

test.describe('움직임 줄이기', () => {
  test('부화는 정지 그림 두 장과 글로, 저절로 넘어가지 않고, 홈 창들은 차례 등장 없이 바로 보인다', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await untilTrack(page);
    await fromTrackToSeries(page);
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await fromRankToSummary(page);
    await page.getByRole('button', { name: '알 깨우기' }).click();
    // 연출 없이 끝 장면: 건너뛰기 버튼이 없다
    await expect(page.getByRole('button', { name: '건너뛰기' })).toHaveCount(0);
    await expect(page.locator('#hatch-result')).toContainText('알봉이');
    await expect(page.locator('#hatch-pair').getByRole('img')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '바로 시작하기' })).toBeFocused();
    // 끝 장면이 처음부터 떠 있어도 인사는 포커스가 간 버튼의 설명으로 한 번 읽힌다(알림 영역은 없다)
    await expect(page.getByRole('button', { name: '바로 시작하기' })).toHaveAccessibleDescription(
      /알봉이.*김주무관님/,
    );
    await expect(page.locator('#welcome-hatch [role="status"]')).toHaveCount(0);
    // 한참 두어도 저절로 넘어가지 않는다
    await tick(page, 5000);
    await expect(page.locator('#hatch-result')).toBeVisible();
    await page.getByRole('button', { name: '바로 시작하기' }).click();
    await expect(page.getByRole('heading', { name: '상태창' })).toBeVisible();
    await expect(page.locator('.dash.entering')).toHaveCount(0);
    await expect(page.locator('.shell.entering')).toHaveCount(0);
    // 패키지 안내 창도 기다리지 않고 바로 나온다
    await expect(page.locator('#package-guide')).toBeVisible();
  });
});

test.describe('차례 등장', () => {
  test('깨어난 직후 홈의 창들이 읽는 순서대로 하나씩 나타나고, 끝나면 표시를 거둔다', async ({
    page,
  }) => {
    await openApp(page);
    await untilTrack(page);
    await fromTrackToSeries(page);
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await fromRankToSummary(page);
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await page.getByRole('button', { name: '바로 시작하기' }).click();
    await expect(page.locator('.dash.entering')).toHaveCount(1);
    // 상태창이 맨 먼저(--i 0), 순서는 화면에 놓인 자리 그대로다
    const order = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.dash .win')]
        .map((el) => ({
          id: el.id,
          i: Number(el.style.getPropertyValue('--i')),
          top: el.getBoundingClientRect().top,
          left: el.getBoundingClientRect().left,
        }))
        .sort((a, b) => a.i - b.i),
    );
    expect(order[0]?.id).toBe('status');
    expect(order.length).toBeGreaterThanOrEqual(7);
    for (let k = 1; k < order.length; k += 1) {
      const a = order[k - 1]!;
      const b = order[k]!;
      expect(b.top > a.top || (b.top === a.top && b.left >= a.left)).toBe(true);
    }
    // 패키지 안내와 새 배지 알림은 창들이 다 나온 뒤에(막 나타나는 화면을 덮지 않는다)
    await expect(page.locator('#package-guide')).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);
    await tick(page, 2500);
    await expect(page.locator('.dash.entering')).toHaveCount(0);
    await expect(page.locator('#package-guide')).toBeVisible();
    // 부화 무대에서 옮겨 온 호봉이는 상태창의 그림이 이어받았다
    await expect(page.locator('.walker')).toHaveCount(0);
    await expect(page.locator('#status .stage canvas')).toBeVisible();
    // 배지 알림은 등장이 끝나고 1.5초 뒤에
    await tick(page, 1500);
    await expect(page.locator('.toast').filter({ hasText: '배지' })).toBeVisible();
    // 새로 고치면 차례 등장은 다시 하지 않는다
    await page.reload();
    await tick(page);
    await expect(page.locator('.dash.entering')).toHaveCount(0);
  });
});

/** 진동 호출을 받아 적는 가짜 navigator.vibrate 를 심는다(진동이 없는 브라우저 엔진에서도 같은 검증을 한다) */
async function stubVibrate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: number[][] = [];
    (window as unknown as { __vibes: number[][] }).__vibes = calls;
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value: (pattern: number | number[]) => {
        calls.push(Array.isArray(pattern) ? [...pattern] : [pattern]);
        return true;
      },
    });
    // 진동 버튼·스위치는 터치 기기에서만 보인다(데스크톱 프로젝트에서도 휴대폰처럼 검증한다)
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
      configurable: true,
      get: () => 5,
    });
  });
}

/** 울린 진동 무늬들(멈춤 요청 vibrate(0) 은 뺀다) */
const vibes = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __vibes: number[][] }).__vibes.filter((p) => p.some((ms) => ms > 0)),
  );

test.describe('진동', () => {
  test('칸을 채우면 짧게 울리고, 고쳐야 할 때는 울리지 않는다. 끄면 울리지 않고 설정에도 꺼진 채 저장된다', async ({
    page,
  }) => {
    await stubVibrate(page);
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    // 화면을 연 것만으로는 울리지 않는다
    expect(await vibes(page)).toEqual([]);

    // 빈 칸으로 넘기려 하면 알이 움찔할 뿐 울리지 않는다(진동은 경고처럼 느껴진다)
    await next(page).click();
    await expect(page.locator('#talk-oops')).toBeVisible();
    expect(await vibes(page)).toEqual([]);

    // 닉네임을 답하면 알에 금이 가며 두 번 울린다
    await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('김주무관');
    await next(page).click();
    await expect(page.getByLabel('생년월일 연도')).toBeFocused();
    expect(await vibes(page)).toEqual([[20, 40, 20]]);

    // 진동 버튼으로 끈다: 그 뒤로는 울리지 않는다
    const toggle = page.getByRole('button', { name: '진동', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await fillDate(page, '생년월일', '1996-04-12');
    await next(page).click();
    await expect(page.getByLabel('임용일 연도')).toBeFocused();
    expect(await vibes(page)).toHaveLength(1);

    // 한 번에 쓰기로 마저 채워 깨운다: 끈 값이 설정으로 저장되고, 부화에서도 울리지 않는다
    // (대화 화면은 값을 지키려고 가려 둔 채 남아 있어, 폼 안의 칸으로 좁혀 고른다)
    await page.getByRole('button', { name: '한 번에 쓰기' }).click();
    const form = page.locator('#welcome-form');
    await form.getByLabel('임용일 연도').fill('20240304');
    await form.getByLabel('현재 호봉', { exact: true }).fill('3');
    await form.getByLabel('다음 승급일 연도').fill('20270301');
    await form.getByRole('button', { name: '알 깨우기' }).click();
    await tick(page, 2500);
    await expect(page.locator('#hatch-result')).toBeVisible();
    expect(await vibes(page)).toHaveLength(1);
    expect((await storedData(page))?.settings.haptics).toBe(false);
  });

  test('켜 두면 부화의 두드림과 팡에 맞춰 울린다', async ({ page }) => {
    await stubVibrate(page);
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '한 번에 쓰기' }).click();
    await page.getByLabel('닉네임').fill('김주무관');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2024-03-04');
    await page.getByLabel('현재 호봉', { exact: true }).fill('3');
    await fillDate(page, '다음 승급일', '2027-03-01');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await tick(page, 2500);
    await expect(page.locator('#hatch-result')).toBeVisible();
    const all = await vibes(page);
    // 마지막 칸에서 포커스가 나가며 '다 채움'이 한 번 울렸고
    expect(all).toContainEqual([20, 60, 20, 60, 30]);
    // 부화는 두드림 두 번(똑똑)과 팡에 맞춰 따로 울린다
    expect(all.slice(-3)).toEqual([[30, 100, 30], [30, 100, 30], [80]]);
    expect((await storedData(page))?.settings.haptics).toBe(true);
  });

  test('움직임 줄이기(기기 설정)면 울리지 않는다', async ({ page }) => {
    await stubVibrate(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('김주무관');
    await next(page).click();
    await expect(page.getByLabel('생년월일 연도')).toBeFocused();
    expect(await vibes(page)).toEqual([]);
    // 맞장구도 그림과 맞춘다: 금 단계 그림은 바뀌므로 금은 말하지만, 멈춰 있는 알의 몸짓은 말하지 않는다
    const moving = /흔들|갸웃|까딱|콩콩|폴짝|톡 하고|통 하고|움직였/;
    await expect(page.locator('#talk-ack')).toContainText(/금이 갔어요|작은 금이 생겼어요/);
    await expect(page.locator('#talk-ack')).not.toContainText(moving);
    await fillDate(page, '생년월일', '1996-04-12');
    await next(page).click();
    await expect(page.getByLabel('임용일 연도')).toBeFocused();
    await expect(page.locator('#talk-ack')).toBeVisible();
    await expect(page.locator('#talk-ack')).not.toContainText(moving);
    await fillDate(page, '임용일', '2024-03-04');
    await next(page).click();
    await expect(page.getByRole('radio', { name: '일반직', exact: true })).toBeFocused();
    await expect(page.locator('#talk-ack')).not.toContainText(moving);
  });

  test('데스크톱처럼 vibrate 함수만 있고 터치가 없는 기기에서는 진동 버튼·스위치를 보이지 않는다', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'vibrate', {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
        configurable: true,
        get: () => 0,
      });
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === '(pointer: coarse)'
          ? ({ ...real('not all'), media: query, matches: false } as MediaQueryList)
          : real(query);
    });
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    await expect(page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' })).toBeFocused();
    await expect(page.getByRole('button', { name: '진동', exact: true })).toHaveCount(0);

    await page.evaluate((value) => window.localStorage.setItem('hobong.data', value), makeSeedV5());
    await page.goto(`${page.url().split('#')[0]}#settings`);
    await page.reload();
    await tick(page);
    await expect(page.locator('#set-profile')).toBeVisible();
    await expect(page.locator('#set-haptics')).toHaveCount(0);
  });

  test('설정의 진동 스위치는 지원하는 기기에서만 보이고, 끄면 저장된다', async ({ page }) => {
    await stubVibrate(page);
    await openApp(page, { seed: makeSeedV5(), hash: 'settings' });
    const toggle = page.locator('#set-haptics').getByRole('checkbox');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    expect((await storedData(page))?.settings.haptics).toBe(false);
  });
  test('진동이 없는 기기(아이폰 Safari 등)에서는 진동 버튼·스위치를 보이지 않고, 알 상태는 글로 전한다', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'vibrate', {
        configurable: true,
        value: undefined,
      });
    });
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    await expect(page.getByRole('button', { name: '진동', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('김주무관');
    await next(page).click();
    // 같은 정보(알에 금이 감·남은 칸)는 입력 칸의 설명으로 전해진다
    await expect(page.getByLabel('생년월일 연도')).toHaveAccessibleDescription(
      /알에 작은 금이 생겼어요\. 남은 칸 8개\./,
    );

    await page.evaluate((value) => window.localStorage.setItem('hobong.data', value), makeSeedV5());
    await page.goto(`${page.url().split('#')[0]}#settings`);
    await page.reload();
    await tick(page);
    await expect(page.locator('#set-profile')).toBeVisible();
    await expect(page.locator('#set-haptics')).toHaveCount(0);
  });
});
