import { expect, test } from '@playwright/test';
import {
  collectErrors,
  fillDate,
  onboard,
  openApp,
  startForm,
  storedData,
  tick,
} from './helpers.ts';

test.describe('첫 화면과 입력 폼', () => {
  test('"새로 시작"과 "패키지로 이어하기"가 나란히 있다', async ({ page }) => {
    await openApp(page);
    const start = page.getByRole('button', { name: '새로 시작' });
    const load = page.getByRole('button', { name: '패키지로 이어하기', exact: true });
    // 예전 이름의 버튼은 없다
    await expect(page.getByRole('button', { name: '데이터 불러오기' })).toHaveCount(0);
    await expect(page.getByText('받아 둔 임용정보 패키지가 있으면')).toBeVisible();
    await expect(start).toBeVisible();
    await expect(load).toBeVisible();
    const a = await start.boundingBox();
    const b = await load.boundingBox();
    expect(a && b && Math.abs(a.y - b.y) < 4).toBe(true);
    await expect(page.getByText('외부로 나가는 통신이 없어요')).toBeVisible();
    await expect(page.getByText('실수령액과 달라요')).toBeVisible();
  });

  test('"새로 시작"은 말을 거는 방식으로 열리고, "한 번에 쓰기"는 늘 고를 수 있다', async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole('button', { name: '새로 시작' }).click();
    // 처음에는 알이 인사한다(대화 방식)
    await expect(page.getByRole('heading', { level: 1, name: '호봉이와 첫 만남' })).toBeFocused();
    await expect(page.getByRole('button', { name: '시작할게요' })).toBeVisible();
    // 인사에서도, 질문 도중에도 한 화면 폼으로 바꿀 수 있다
    await page.getByRole('button', { name: '시작할게요' }).click();
    await page.getByRole('textbox', { name: '뭐라고 불러 드릴까요?' }).fill('김주무관');
    await page.getByRole('button', { name: '한 번에 쓰기' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '내 정보 넣기' })).toBeFocused();
    // 대화에서 넣은 값이 폼에 그대로 있다
    await expect(page.getByLabel('닉네임')).toHaveValue('김주무관');
    // 폼에서도 대화로 돌아갈 수 있다
    await expect(page.getByRole('button', { name: '하나씩 묻기' })).toBeVisible();
  });

  test('한 번에 쓰기에서도 알은 제자리에서 깨어난다(대화상자 없이, 건너뛰기가 첫 포커스)', async ({
    page,
  }) => {
    await openApp(page);
    await startForm(page);
    await page.getByLabel('닉네임').fill('김주무관');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2024-03-04');
    await page.getByLabel('현재 직급').selectOption('9');
    await page.getByLabel('현재 호봉', { exact: true }).fill('3');
    await fillDate(page, '다음 승급일', '2027-03-01');
    expect(await storedData(page)).toBeNull();
    await page.getByRole('button', { name: '알 깨우기' }).click();

    // 저장은 연출보다 먼저 끝난다(연출 중에 새로 고쳐도 남는다)
    expect((await storedData(page))?.profile.nickname).toBe('김주무관');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveTitle('알이 깨어나요 · 호봉');
    const skip = page.getByRole('button', { name: '건너뛰기' });
    await expect(skip).toBeFocused();
    // 연출 중에는 아무것도 읽지 않는다
    await expect(page.locator('#welcome-hatch [role="status"]')).toHaveCount(0);
    // 끝까지 두면 스스로 끝 장면에 이르고(2초), 잠깐 머문 뒤 홈으로 넘어간다
    await tick(page, 2100);
    const result = page.locator('#hatch-result');
    await expect(result).toHaveAttribute('role', 'status');
    await expect(result).toContainText('알봉이');
    await expect(result).toContainText('김주무관님');
    await expect(page.getByRole('button', { name: '바로 시작하기' })).toBeFocused();
    await tick(page, 1500);
    await expect(page.locator('#status-title')).toBeFocused();
    await tick(page, 2500);
    await expect(page.locator('#status')).toContainText('9급 3호봉');
  });

  test('빈 폼은 넘어가지 않고 고칠 곳을 알려준다', async ({ page }) => {
    await openApp(page);
    await startForm(page);
    // 날짜 묶음의 이름은 '생년월일 필수'(띄어 읽힌다), 닉네임 예시는 직함이 아닌 별명
    await expect(page.getByRole('group', { name: '생년월일 필수' })).toHaveCount(1);
    await expect(page.getByLabel('생년월일 연도')).toHaveAttribute('aria-required', 'true');
    await expect(page.getByLabel('닉네임')).toHaveAttribute('placeholder', '예: 호봉이집사');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await expect(page.getByText('닉네임을 넣어 주세요.')).toBeVisible();
    await expect(page.getByText('생년월일을 넣어 주세요.')).toBeVisible();
    await expect(page.getByText('임용일을 넣어 주세요.')).toBeVisible();
    await expect(page.getByText('다음 승급일을 넣어 주세요.')).toBeVisible();
    // 요약의 개수는 화면에 보이는 오류 수와 같고(숨은 '현 직급 임용일'은 세지 않는다),
    // 알림(role=alert)은 요약 하나만 읽힌다
    await expect(page.locator('form .error')).toHaveCount(4);
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('alert')).toContainText('고칠 곳이 4군데');
    expect(await storedData(page)).toBeNull();
  });

  test('없는 날짜는 "넣어 주세요"가 아니라 그 까닭을 알려준다', async ({ page }) => {
    await openApp(page);
    await startForm(page);
    await page.getByLabel('생년월일 연도').fill('1996');
    await page.getByLabel('생년월일 월').fill('2');
    await page.getByLabel('생년월일 일').fill('30');
    await expect(page.locator('#pf-birth-error')).toHaveText(
      '없는 날짜예요. 1996년 2월은 29일까지예요.',
    );
    await expect(page.getByLabel('생년월일 일')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('생년월일 월').fill('13');
    await expect(page.locator('#pf-birth-error')).toHaveText('월은 1~12로 넣어 주세요.');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await expect(page.getByText('생년월일을 넣어 주세요.')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('고칠 곳이 4군데');
  });

  test('승진 체크를 켜면 현 직급 임용일 칸이 필수로 나온다', async ({ page }) => {
    await openApp(page);
    await startForm(page);
    await page.getByRole('checkbox', { name: '임용 후 승진한 적이 있어요' }).check();
    await expect(page.getByLabel('현 직급 임용일(승진일) 연도')).toHaveAttribute(
      'aria-required',
      'true',
    );
  });

  test('첫 화면과 폼을 오가면 포커스가 따라가고, 입력한 값은 남는다', async ({ page }) => {
    await openApp(page);
    await startForm(page);
    await expect(page.getByRole('heading', { level: 1, name: '내 정보 넣기' })).toBeFocused();
    await expect(page).toHaveTitle('내 정보 넣기 · 호봉');
    await page.getByLabel('닉네임').fill('호봉집사');
    await page.getByLabel('생년월일 연도').fill('1996');
    await page.getByRole('button', { name: '뒤로' }).click();
    await expect(page.getByRole('button', { name: '새로 시작' })).toBeFocused();
    await startForm(page);
    await expect(page.getByLabel('닉네임')).toHaveValue('호봉집사');
    await expect(page.getByLabel('생년월일 연도')).toHaveValue('1996');
  });

  test('잘못된 날짜를 거른다', async ({ page }) => {
    await openApp(page);
    await startForm(page);
    await page.getByLabel('닉네임').fill('테스트');
    await fillDate(page, '생년월일', '1996-04-12');
    await fillDate(page, '임용일', '2027-01-01'); // 오늘(2026-11-25)보다 뒤
    await fillDate(page, '다음 승급일', '2027-03-01');
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await expect(page.getByText('임용일은 오늘이거나 오늘보다 앞이어야 해요.')).toBeVisible();
    expect(await storedData(page)).toBeNull();
  });

  test('입력을 마치면 알이 깨어나고 대시보드가 계산값을 보여준다', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await onboard(page);
    // 본 화면에도 h1 이 정확히 하나 있다(머리말의 '호봉')
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: '호봉' })).toBeVisible();

    // 9급 3호봉 봉급(2026년 봉급표)
    await expect(page.locator('#status')).toContainText('9급 3호봉');
    await expect(page.locator('#wallet')).toContainText('2,168,000원');
    await expect(page.locator('#wallet')).toContainText('2026년 봉급표');
    // 다음 승급: 2027-03-01 → D-96, 4호봉(+26,000원)
    await expect(page.locator('#growth')).toContainText('D-96');
    await expect(page.locator('#growth')).toContainText('3호봉 → 4호봉');
    await expect(page.locator('#growth')).toContainText('+26,000원');
    // 정년: 1996-04-12생 → 2056-06-30
    await expect(page.locator('#career')).toContainText('2056. 6. 30.');
    // 근속승진(9급 5년 6개월): 2024-03-04 → 2029-09-04
    await expect(page.locator('#growth')).toContainText('2029. 9. 4.');
    // 대우공무원(4년 뒤 처음 오는 1일): 2028-04-01
    await expect(page.locator('#growth')).toContainText('2028. 4. 1.');
    // 연가: 재직 2년 8개월 → 15일
    await expect(page.locator('#leave-mini')).toContainText('15일');
    // 월급날(기본 25일)
    await expect(page.locator('#today')).toContainText('D-DAY');

    const data = await storedData(page);
    expect(data?.profile).toMatchObject({
      nickname: '김주무관',
      birthDate: '1996-04-12',
      hireDate: '2024-03-04',
      track: 'general',
      payTable: 'table3',
      rankDate: '2024-03-04',
      rank: '9',
      step: 3,
      nextStepDate: '2027-03-01',
    });
    expect(data?.settings.payday).toBe(25);
    // 저장본에는 계산값이 없다
    expect(JSON.stringify(data)).not.toContain('2168000');
    expect(errors).toEqual([]);
  });

  test('새로 고쳐도 그대로 이어진다', async ({ page }) => {
    await openApp(page);
    await onboard(page);
    await page.reload();
    await tick(page);
    await expect(page.locator('#status')).toContainText('9급 3호봉');
    await expect(page.getByRole('button', { name: '새로 시작' })).toHaveCount(0);
  });

  test('"모르겠어요" 버튼이 다음 승급일을 어림해 넣는다', async ({ page }) => {
    await openApp(page);
    await startForm(page);
    await fillDate(page, '임용일', '2024-03-04');
    // 1년 뒤(2025-03-04) 이후 처음 오는 1일 = 2025-04-01 → 오늘보다 뒤가 될 때까지 1년씩: 2027-04-01
    await page.getByRole('button', { name: /모르겠어요/ }).click();
    await expect(page.getByLabel('다음 승급일 연도')).toHaveValue('2027');
    await expect(page.getByLabel('다음 승급일 월')).toHaveValue('4');
    await expect(page.getByLabel('다음 승급일 일')).toHaveValue('1');
  });
});
