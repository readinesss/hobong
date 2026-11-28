/**
 * #31 교육행정·지방 일반직(설계 local/design.md 8장 묶음 3 의 e2e 두 흐름).
 * ① 국가 일반직이 '교육행정'을 쳐서 '행정 · 교육행정 직류'를 고르고, 다시 열어도 그대로 보인다.
 * ② 교육청 사용자: 직렬 찾기 '교육행정' → 다른 표 안내 상자 → 직종 '지방 일반직' → 월급날 17일 → 홈 → 연가(반일 단추 없음) → 근거 법령.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  closeDialogs,
  fillDate,
  makeSeedV7,
  openApp,
  startForm,
  storedData,
  tick,
  wakeEgg,
} from './helpers.ts';

async function go(page: Page, label: string): Promise<void> {
  await page
    .getByRole('navigation', { name: '화면 이동' })
    .getByRole('link', { name: label })
    .click();
  await tick(page, 800);
}

test.describe('직류로 찾고 고르기(#31)', () => {
  test('국가 일반직: "교육행정"을 쳐서 행정 · 교육행정 직류를 고르고, 다시 열어도 그대로 보인다', async ({
    page,
  }) => {
    await openApp(page, { seed: makeSeedV7(), hash: 'settings' });
    await tick(page, 3000);
    await closeDialogs(page);
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    let dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
    const find = dialog.getByRole('searchbox', { name: '직렬·직류 찾기' });
    await find.fill('교육행정');
    // 상태 줄은 짧게(수와 다른 표에도 있다는 한 문장)
    await expect(dialog.locator('#pf-series-found')).toHaveText(
      '1개 찾았어요. 아래 목록에서 골라 주세요. 지방공무원 직렬표에도 1개 있어요.',
    );
    // 다른 표 안내 상자: 지방 표의 이름과 지방 일반직을 고르면 달라지는 것(월급날)
    const other = dialog.locator('#pf-series-other');
    await expect(other).toContainText('지방공무원 직렬표에 있어요: 교육행정 직렬(행정 직군).');
    await expect(other).toContainText('봉급표는 같아요.');
    await expect(other).toContainText('월급날 기본 20일(교육청·학교는 17일)');
    await expect(find).toHaveAccessibleDescription(/지방공무원 직렬표에 있어요/);
    const select = dialog.getByLabel('직렬', { exact: true });
    await expect(select.locator('option', { hasText: '행정 · 교육행정 직류' })).toHaveCount(1);
    // Enter: 지금 표에서 하나만 맞으면 그것을 고른다(다른 표의 결과는 세지 않는다)
    await find.press('Enter');
    await expect(select).toBeFocused();
    await expect(dialog.locator('#pf-series-found')).toHaveText('행정 · 교육행정 직류를 골랐어요.');
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    const saved = await storedData(page);
    expect(saved?.profile).toMatchObject({
      track: 'general',
      series: '행정',
      seriesJikryu: '교육행정',
    });
    await expect(page.locator('#set-series')).toContainText('행정 · 교육행정 직류');

    // 다시 열어도(새로 고침 뒤에도) 그대로
    await page.reload();
    await tick(page, 3000);
    await closeDialogs(page);
    await expect(page.locator('#set-series')).toContainText('행정 · 교육행정 직류');
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
    const reopened = dialog.getByLabel('직렬', { exact: true });
    await expect(reopened.locator('option:checked')).toHaveText('행정 · 교육행정 직류');

    // 직렬 '행정'을 다시 고르면 직류는 지운다
    await reopened.selectOption('행정');
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    expect((await storedData(page))?.profile).toMatchObject({ series: '행정', seriesJikryu: null });
  });

  test('직류는 카드 글에 나가지 않는다(직렬 이름 넣기를 켜도 직렬만)', async ({ page }) => {
    await openApp(page, {
      seed: makeSeedV7({}, { series: '행정', seriesJikryu: '교육행정', showSeries: true }),
      hash: 'card',
    });
    await tick(page, 3000);
    await closeDialogs(page);
    const text = page.locator('#card-text pre');
    await expect(text).toContainText('행정 직렬');
    await expect(text).not.toContainText('교육행정');
  });
});

test.describe('지방 일반직(#31)', () => {
  test('교육청 사용자: "교육행정" → 안내 상자 → 지방 일반직 → 17일 → 홈 → 연가 → 근거 법령', async ({
    page,
  }) => {
    await openApp(page);
    await startForm(page);
    await page.getByLabel('닉네임').fill('행정실');
    await fillDate(page, '생년월일', '1994-05-20');
    await fillDate(page, '임용일', '2021-03-10');

    // 기본 직종(일반직)에서 '교육행정'을 찾으면 국가 직류와 지방 직렬 안내가 함께 나온다
    const find = page.getByRole('searchbox', { name: '직렬·직류 찾기' });
    await find.fill('교육행정');
    const other = page.locator('#pf-series-other');
    await expect(other).toContainText('지방공무원 직렬표에 있어요');
    await expect(other).toContainText('지방공무원이면 직종에서 지방 일반직을 골라 주세요.');
    // [직종 고르기로 가기]는 직종 칸으로 옮길 뿐 직종을 바꾸지 않는다
    await other.getByRole('button', { name: '직종 고르기로 가기' }).click();
    await expect(page.locator('#pf-track [role="radio"][aria-checked="true"]')).toBeFocused();
    await expect(page.locator('#pf-track [role="radio"][aria-checked="true"]')).toHaveText(
      /^일반직/,
    );

    await page.getByRole('radio', { name: '지방 일반직 (일부 준비 중)', exact: true }).click();
    // 직렬 표가 지방 표로 바뀌고, 찾던 글자 그대로 지방 '교육행정' 직렬이 하나 맞는다
    await expect(page.locator('#pf-series-found')).toHaveText(
      '1개 찾았어요. 아래 목록에서 골라 주세요. 국가공무원 직렬표에도 1개 있어요.',
    );
    await expect(page.locator('#pf-series-other')).toContainText(
      '국가공무원 직렬표에 있어요: 행정 직렬의 교육행정 직류(행정 직군).',
    );
    await find.press('Enter');
    await expect(page.locator('#pf-series-found')).toHaveText('교육행정을 골랐어요.');

    await page.getByLabel('현재 직급').selectOption('8');
    await page.getByLabel('현재 호봉', { exact: true }).fill('6');
    await fillDate(page, '다음 승급일', '2027-03-01');

    // 월급날: 지방 일반직의 두 선택지만(국가 별표 30 의 네 날짜·기관 글이 나오지 않는다), 기본 20일
    const payday = page.getByRole('radiogroup', { name: '월급날' });
    // 두 단추는 같은 무게: '20일' / '교육청·학교 17일'(짧은 기관 이름은 규정 데이터의 괄호 속)
    await expect(payday.getByRole('radio')).toHaveText(['20일', '교육청·학교 17일']);
    await expect(payday.getByRole('radio', { name: '20일' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('body')).not.toContainText('대법원');
    await payday.getByRole('radio', { name: '교육청·학교 17일' }).click();
    await expect(page.locator('body')).toContainText('교육감이 임용권을 가지는 공무원');

    await wakeEgg(page);
    await expect(page.getByRole('heading', { name: '상태창' })).toBeVisible();
    const saved = await storedData(page);
    expect(saved?.profile).toMatchObject({
      track: 'localGeneral',
      payTable: null,
      rank: '8',
      series: '교육행정',
      seriesJikryu: null,
    });
    expect(saved?.settings.payday).toBe(17);

    // 홈: 일부 준비 중 띠(항목 이름은 해석 결과에서)
    await expect(page.locator('#main')).toContainText('지방 일반직은 일부만 계산해요.');
    await expect(page.locator('#main')).toContainText('반일 연가');
    await expect(page.locator('#main')).toContainText('다른 기준: 장기재직휴가');
    // 연가 일정: 연초 재직기간 기준이라 재직 N년이 되는 날 '늘어나요'라고 말하지 않는다
    await expect(page.locator('#main')).not.toContainText('일로 늘어나요');
    // 생애 봉급의 '어떻게 셈했나요': 지방 조문만(국가 보수·수당 조문이 섞이지 않는다)
    const how = page.locator('#lifetime-how');
    await how.locator('summary').click();
    await expect(how).toContainText(
      '지방공무원 보수규정 제12조(정기승급)·제19조(보수 지급일)·제21조(보수 계산)·제23조',
    );
    await expect(how).toContainText('지방공무원 수당 등에 관한 규정 제6조');
    await expect(how).not.toContainText('공무원보수규정 제2');
    await expect(how).not.toContainText('공무원수당 등에 관한 규정 제7조');
    // 꼬리말은 같은 말을 두 번 쓰지 않는다
    await expect(page.locator('.foot')).toContainText('지방 일반직 기준');
    await expect(page.locator('.foot')).not.toContainText('지방공무원 지방 일반직');

    // 연가: 반일 단추 없이 준비 중 안내, 하루·시간 단추는 그대로. 구간이 바뀌는 날은 숫자 없이
    await go(page, '연가');
    const entry = page.locator('#leave-entry');
    await expect(entry.getByRole('button', { name: '1일', exact: true })).toBeVisible();
    await expect(entry.getByRole('button', { name: '오전 반일' })).toHaveCount(0);
    await expect(entry.getByRole('button', { name: '오후 반일' })).toHaveCount(0);
    await expect(page.locator('#leave-half-off')).toContainText('준비 중');
    await expect(page.locator('#leave-half-off')).toContainText('시간 연가로 적어 주세요');
    await expect(page.locator('#main')).toContainText('소속 기관 인사시스템');
    await expect(page.locator('#main')).not.toContainText('e-사람');
    await expect(page.locator('#main')).toContainText('3월 10일에 재직 5년이 됐어요');

    // 설정 월급날: 당겨 받는 근거도 지방 조문
    await go(page, '설정');
    await expect(page.locator('#set-work')).toContainText(
      '토요일이나 공휴일이면 그 전날 받아요(지방공무원 보수규정 제19조).',
    );
    await expect(page.locator('#set-work')).not.toContainText('보수규정 제20조');
    // 근거 법령: 지방 법령
    const track = page.locator('#sources-track');
    await expect(track).toContainText('지방 일반직 규정');
    for (const law of [
      '지방공무원법',
      '지방공무원 임용령',
      '지방공무원 보수규정',
      '지방공무원 복무규정',
      '지방공무원 수당 등에 관한 규정',
    ])
      await expect(track).toContainText(law);
    await expect(
      track.locator('[data-off="pending"]').filter({ hasText: '대우공무원' }),
    ).not.toHaveCount(0);
    // 근무시간·정액급식비·봉급 계산은 지방 근거가 직종 칸에 있고, '모든 직종에 같은 규정'에는 국가 조문이 없다
    await expect(track).toContainText('지방공무원 복무규정 제2조제1항·제2항');
    await expect(track).toContainText('지방공무원 수당 등에 관한 규정 제18조');
    await expect(track).toContainText('지방공무원 보수규정 제23조제1항제1호');
    const common = page.locator('section[aria-labelledby="sources-common-title"]');
    await expect(common).toContainText('관공서의 공휴일에 관한 규정');
    await expect(common).not.toContainText('국가공무원 복무규정 제9조');
    await expect(common).not.toContainText('공무원수당 등에 관한 규정 제18조');
    await expect(common).not.toContainText('공무원보수규정 제22조');
  });

  test('국가 "행정 · 교육행정 직류" → 지방 일반직: 지방 표의 교육행정 직렬을 권하고(저절로 바꾸지 않음), 고르면 바뀐다', async ({
    page,
  }) => {
    await openApp(page, {
      seed: makeSeedV7({}, { series: '행정', seriesJikryu: '교육행정' }),
      hash: 'settings',
    });
    await tick(page, 3000);
    await closeDialogs(page);
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
    await expect(dialog.locator('#pf-series-counterpart')).toHaveCount(0);
    await dialog.getByRole('radio', { name: '지방 일반직 (일부 준비 중)', exact: true }).click();
    const hint = dialog.locator('#pf-series-counterpart');
    await expect(hint).toContainText('지방공무원 직렬표에는 교육행정 직렬이 따로 있어요.');
    const select = dialog.getByLabel('직렬', { exact: true });
    await expect(select).toHaveValue('행정');
    await expect(select).toHaveAccessibleDescription(/교육행정 직렬이 따로 있어요/);
    await hint.getByRole('button', { name: '교육행정 직렬로 고르기' }).click();
    await expect(select).toHaveValue('교육행정');
    await expect(dialog.locator('#pf-series-found')).toHaveText('교육행정을 골랐어요.');
    await expect(hint).toHaveCount(0);
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    expect((await storedData(page))?.profile).toMatchObject({
      track: 'localGeneral',
      series: '교육행정',
      seriesJikryu: null,
    });
    // 되돌아가면 국가 표의 짝(행정 · 교육행정 직류)을 권한다
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const back = page.getByRole('dialog', { name: '내 정보 고치기' });
    await back.getByRole('radio', { name: '일반직', exact: true }).click();
    await expect(back.locator('#pf-series-counterpart')).toContainText(
      '국가공무원 직렬표에서는 교육행정이 행정 직렬의 직류예요.',
    );
    await expect(
      back.locator('#pf-series-counterpart').getByRole('button', {
        name: '행정 · 교육행정 직류로 고르기',
      }),
    ).toBeVisible();
  });

  test('별표 4 일반직 → 지방 일반직 → 일반직: 같은 폼에서는 별표 4 를 되살리고, 저장 뒤 돌아오면 별표 3 으로 맞췄다고 알린다', async ({
    page,
  }) => {
    await openApp(page, { seed: makeSeedV7({ payTable: 'table4' }), hash: 'settings' });
    await tick(page, 3000);
    await closeDialogs(page);
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    let dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
    await dialog.getByRole('radio', { name: '지방 일반직 (일부 준비 중)', exact: true }).click();
    await dialog.getByRole('radio', { name: '일반직', exact: true }).click();
    const table = dialog.locator('#pf-pay-table');
    await expect(table.locator('[role="radio"][aria-checked="true"]')).toContainText('별표 4');
    await expect(dialog.locator('#pf-pay-table-notice')).toHaveCount(0);
    // 지방 일반직으로 저장한 뒤 다시 일반직으로
    await dialog.getByRole('radio', { name: '지방 일반직 (일부 준비 중)', exact: true }).click();
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    await closeDialogs(page);
    expect((await storedData(page))?.profile).toMatchObject({
      track: 'localGeneral',
      payTable: null,
    });
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
    await dialog.getByRole('radio', { name: '일반직', exact: true }).click();
    await expect(dialog.locator('#pf-pay-table-notice')).toHaveText(
      '봉급표를 별표 3으로 맞췄어요. 확인해 주세요.',
    );
    await dialog
      .locator('#pf-pay-table')
      .getByRole('radio', { name: /별표 4/ })
      .click();
    await expect(dialog.locator('#pf-pay-table-notice')).toHaveCount(0);
  });

  test('일반직 17일 → 지방 일반직: 월급날이 선택지 안이면 묻지 않고, 25일이면 두 날을 같은 무게로 묻는다', async ({
    page,
  }) => {
    await openApp(page, { seed: makeSeedV7({}, {}), hash: 'settings' });
    await tick(page, 3000);
    await closeDialogs(page);
    // 25일(일반직 기본) → 지방 일반직
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const dialog = page.getByRole('dialog', { name: '내 정보 고치기' });
    await dialog.getByRole('radio', { name: '지방 일반직 (일부 준비 중)', exact: true }).click();
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    const banner = page.locator('#notice-track-change');
    await expect(banner).toContainText(
      '지방 일반직 월급날은 기본 20일(교육청·학교는 17일)이에요. 지금은 25일로 되어 있어요.',
    );
    const buttons = banner.getByRole('button');
    await expect(buttons).toHaveText(['20일로 바꾸기', '17일로 바꾸기', '25일 그대로']);
    await expect(banner.locator('.btn.primary')).toHaveCount(0);
    await banner.getByRole('button', { name: '17일로 바꾸기' }).click();
    await tick(page);
    expect((await storedData(page))?.settings.payday).toBe(17);

    // 지방 일반직(17일) → 일반직 → 다시 지방 일반직: 17일은 선택지 안이라 묻지 않는다
    for (const name of ['일반직', '지방 일반직 (일부 준비 중)']) {
      await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
      const d = page.getByRole('dialog', { name: '내 정보 고치기' });
      await d.getByRole('radio', { name, exact: true }).click();
      await d.getByRole('button', { name: '저장' }).click();
      await tick(page);
      const b = page.locator('#notice-track-change');
      if (name === '일반직') {
        // 일반직 기본 25일과 다르니 지금 규칙대로 묻는다 — 그대로 둔다
        await b.getByRole('button', { name: '17일 그대로' }).click();
        await tick(page);
      } else {
        await expect(b).toHaveCount(0);
      }
    }
    expect((await storedData(page))?.settings.payday).toBe(17);
  });
});

test.describe('지방 일반직: 말을 거는 첫 입력(#31)', () => {
  const next = (page: Page) => page.getByRole('button', { name: '다음', exact: true });
  const bubble = (page: Page) => page.locator('#welcome-talk .bubble');

  test('봉급표는 묻지 않고 지방 직렬표에서 고르며, 월급날은 20일·17일 두 가지다', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('행정실');
    await next(page).click();
    await fillDate(page, '생년월일', '1994-05-20');
    await next(page).click();
    await fillDate(page, '임용일', '2021-03-10');
    await next(page).click();
    await expect(bubble(page)).toContainText('어떤 직종이에요?');
    await page.getByRole('radio', { name: '지방 일반직 (일부 준비 중)', exact: true }).click();
    await next(page).click();
    // 고를 봉급표가 하나뿐이라 봉급표 질문 없이 직렬로
    await expect(bubble(page)).toContainText('직렬도 골라 볼까요?');
    const find = page.getByRole('searchbox', { name: '직렬·직류 찾기' });
    await find.fill('교육행정');
    await expect(page.locator('#tk-series-found')).toHaveText(
      '1개 찾았어요. 아래 목록에서 골라 주세요. 국가공무원 직렬표에도 1개 있어요.',
    );
    await find.press('Enter');
    await expect(page.getByLabel('직렬', { exact: true })).toHaveValue('교육행정');
    await next(page).click();
    await expect(bubble(page)).toContainText('어울리는 소품을 들어 볼까요?');
    await page.getByRole('button', { name: '나중에' }).click();
    await expect(bubble(page)).toContainText('골라 주세요');
    await next(page).click();
    await page.getByLabel('현재 호봉', { exact: true }).fill('6');
    await next(page).click();
    await fillDate(page, '다음 승급일', '2027-03-01');
    await next(page).click();
    await expect(bubble(page)).toContainText('월급날은 며칠이에요?');
    const payday = page.getByRole('radiogroup', { name: '월급날' });
    await expect(payday.getByRole('radio')).toHaveText(['20일', '교육청·학교 17일']);
    // 기관에 따라 갈리니 '그대로 두세요'라고 하지 않고 두 날을 함께 알린다
    await expect(page.locator('#tk-hint')).toHaveText(
      '기본 20일(교육청·학교는 17일). 소속 기관의 월급날로 골라 주세요. 나중에 설정에서 바꿀 수 있어요.',
    );
    await page.getByRole('button', { name: '자세히' }).click();
    await expect(page.locator('#tk-more')).toContainText('20일: 지방자치단체와 지방의회(기본)');
    await expect(page.locator('#tk-more')).toContainText(
      '17일: 교육감이 임용권을 가지는 공무원(교육청·학교)',
    );
    await expect(page.locator('#tk-more')).toContainText('지방공무원 보수규정 제19조');
    await payday.getByRole('radio', { name: '교육청·학교 17일' }).click();
    await next(page).click();
    await expect(
      page.getByRole('heading', { level: 1, name: '이대로 깨워 볼까요?' }),
    ).toBeFocused();
    await expect(page.locator('#talk-summary')).toContainText('지방 일반직');
    await expect(page.locator('#talk-summary')).toContainText('교육행정');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await page.getByRole('button', { name: '건너뛰기' }).click();
    await page.getByRole('button', { name: '바로 시작하기' }).click();
    await tick(page, 2500);
    const data = await storedData(page);
    expect(data?.profile).toMatchObject({ track: 'localGeneral', series: '교육행정', rank: '9' });
    expect(data?.settings.payday).toBe(17);
  });

  test('직렬 질문에서 [직종 고르기로 가기]로 다녀와도 찾던 글자가 남는다', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    await page.getByRole('button', { name: '시작할게요' }).click();
    await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('행정실');
    await next(page).click();
    await fillDate(page, '생년월일', '1994-05-20');
    await next(page).click();
    await fillDate(page, '임용일', '2021-03-10');
    await next(page).click();
    await expect(bubble(page)).toContainText('어떤 직종이에요?');
    await next(page).click();
    await expect(bubble(page)).toContainText('봉급표');
    await next(page).click();
    await expect(bubble(page)).toContainText('직렬도 골라 볼까요?');
    const find = page.getByRole('searchbox', { name: '직렬·직류 찾기' });
    await find.fill('교육행정');
    await page.getByRole('button', { name: '직종 고르기로 가기' }).click();
    await expect(bubble(page)).toContainText('어떤 직종이에요?');
    await page.getByRole('radio', { name: '지방 일반직 (일부 준비 중)', exact: true }).click();
    await next(page).click();
    await expect(bubble(page)).toContainText('직렬도 골라 볼까요?');
    await expect(find).toHaveValue('교육행정');
    await expect(page.locator('#tk-series-found')).toHaveText(
      '1개 찾았어요. 아래 목록에서 골라 주세요. 국가공무원 직렬표에도 1개 있어요.',
    );
    await find.press('Enter');
    await expect(page.getByLabel('직렬', { exact: true })).toHaveValue('교육행정');
  });
});
