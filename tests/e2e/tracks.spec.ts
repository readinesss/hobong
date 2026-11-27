/**
 * #20 대상 확대 화면(설계 §8.2): 직종별 첫 입력 → 홈, 카드 계급 이름 기본값, 불러오기 요약, 근거 법령.
 * 원칙: 확인하지 못한 항목은 숫자 없이 '준비 중'과 사유를 보인다.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  closeDialogs,
  collectErrors,
  fixture,
  makeSeed,
  makeSeedV4,
  onboardTrack,
  openApp,
  PACKAGE_OPEN,
  startForm,
  storedData,
  tick,
} from './helpers.ts';

async function openSeed(page: Page, seed: string, hash?: string): Promise<void> {
  await openApp(page, { seed, hash });
  await tick(page, 6000);
  await closeDialogs(page);
}

test.describe('직종별 첫 입력 → 홈', () => {
  test('경찰 경정: 별표 10 봉급, 계급정년, 대우공무원. 근속승진 대상이 아니다', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await onboardTrack(page, {
      track: '경찰',
      rank: '경정',
      rankDate: '2020-01-01',
      step: 10,
    });
    await expect(page.locator('#status')).toContainText('경정 10호봉');
    await expect(page.locator('#wallet')).toContainText('별표 10');
    await expect(page.locator('#wallet')).toContainText('4,296,500원');
    // 계급정년(2034-01-01 → 6월 30일)이 연령정년(2035-06-30)보다 먼저
    await expect(page.locator('#career')).toContainText('계급정년(경정 14년) 기준');
    await expect(page.locator('#career')).toContainText('2034. 6. 30.');
    // 1월 1일 승진: 하루 차이로 퇴직일이 6개월 달라질 수 있다는 주의
    await expect(page.locator('#career-rank-limit-boundary')).toBeVisible();
    await expect(page.locator('#growth')).toContainText('총경 대우공무원');
    await expect(page.locator('#growth')).not.toContainText('근속승진');
    const data = await storedData(page);
    expect(data?.profile).toMatchObject({ track: 'police', payTable: null, rank: '경정' });
    // 경찰 계급 이름은 직종을 드러내므로 카드에는 기본으로 넣지 않는다(Q2)
    expect(data?.settings.card.showRank).toBe(false);
    expect(errors).toEqual([]);
  });

  test('소방 소방장: 소방위 근속승진 요건, 심사는 5일 전부터, 장기재직휴가는 조례', async ({
    page,
  }) => {
    await openApp(page);
    await onboardTrack(page, {
      track: '소방',
      rank: '소방장',
      rankDate: '2021-01-01',
      step: 8,
      birthDate: '1990-05-05',
      hireDate: '2014-03-03',
    });
    const growth = page.locator('#growth');
    await expect(growth).toContainText('소방위 근속승진 요건');
    await expect(growth).toContainText('5일');
    await expect(growth).toContainText("'할 수 있다' 규정");
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '연가' })
      .click();
    await tick(page);
    await expect(page.locator('#leave-long-off')).toContainText('조례');
  });

  test('교원: 계급 칸·승진 칸이 없고, 월급날 17일, 62세 정년, 예규 연가 문구', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await startForm(page);
    await page.getByRole('radio', { name: '교원', exact: true }).click();
    await expect(page.getByLabel(/^현재 (직급|계급)$/)).toHaveCount(0);
    await expect(page.getByText('임용 후 승진한 적이 있어요')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: '17일' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#pf-payday-hint')).toContainText('교육부');
    await page.getByRole('button', { name: /뒤로/ }).click();

    await onboardTrack(page, { track: '교원', step: 12 });
    await expect(page.locator('#status .level')).toHaveText('12호봉');
    await expect(page.locator('#wallet')).toContainText('별표 11');
    // 1975-03-10 생: 62세가 되는 2037-03-10(3~8월) → 그해 8월 31일
    await expect(page.locator('#career')).toContainText('2037. 8. 31.');
    await expect(page.locator('#career')).toContainText('교육공무원법');
    await expect(page.locator('#growth')).toContainText('교원 봉급표에는 직급이 없어');
    expect((await storedData(page))?.settings.payday).toBe(17);

    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '연가' })
      .click();
    await tick(page);
    const main = page.locator('#main');
    await expect(main).not.toContainText('연가보상비 1일 단가');
    await expect(page.locator('#leave-compensation-off')).toContainText('해당 없음');
    await expect(main).not.toContainText('저축·이월');
    await expect(main).not.toContainText('e-사람');
    await expect(main).toContainText('나이스');
    await page.locator('#leave-advance summary').click();
    await expect(page.locator('#leave-advance')).toContainText('교원휴가에 관한 예규');
    await expect(page.locator('#leave-advance')).toContainText('6월 미만');
    expect(errors).toEqual([]);
  });

  test('일반직 + 별표 4, 4급: 직접 종사 경고, 지갑은 별표 4. 별표 4 안내에 특정직 안내', async ({
    page,
  }) => {
    await openApp(page);
    await startForm(page);
    await page.getByRole('radio', { name: '공안업무 등(별표 4)' }).click();
    await page.getByText('별표 4는 누가 쓰나요?').click();
    await expect(page.locator('#pf-pay-table-special')).toContainText('그 밖의 특정직');
    await page.getByLabel('현재 직급').selectOption('4');
    await expect(page.locator('#pf-rank-warn')).toContainText('직접 종사');
    await page.getByRole('button', { name: /뒤로/ }).click();

    await onboardTrack(page, {
      payTable: '공안업무 등(별표 4)',
      rank: '4',
      rankLabel: '현재 직급',
      step: 10,
    });
    await expect(page.locator('#wallet')).toContainText('공무원보수규정 별표 4');
    await expect(page.locator('.foot')).toContainText('일반직(별표 4) 기준');
    // 일반직 사다리(1~9급)는 카드에 계급 이름을 기본으로 넣는다
    expect((await storedData(page))?.settings.card.showRank).toBe(true);
  });

  test('일반직 + 별표 8, 우정7급: 근속승진은 준비 중(숫자 없음)', async ({ page }) => {
    await openApp(page);
    await onboardTrack(page, {
      payTable: '우정직군(별표 8)',
      rank: '7',
      rankLabel: '현재 직급',
      step: 6,
      hireDate: '2019-03-04',
      birthDate: '1993-01-01',
    });
    await expect(page.locator('#status')).toContainText('우정7급 6호봉');
    const off = page.locator('#growth .off-note');
    await expect(off).toContainText('근속승진');
    await expect(off).toContainText('준비 중');
    await expect(page.locator('#growth')).not.toContainText('근속승진 요건');
    // 우정 계급 이름도 직렬을 드러내므로 카드에는 기본으로 넣지 않는다
    expect((await storedData(page))?.settings.card.showRank).toBe(false);
  });

  test('해양경찰 경위: 승진소요·대우는 준비 중, 정년·연가는 계산', async ({ page }) => {
    await openApp(page);
    await onboardTrack(page, {
      track: '해양경찰 (일부 준비 중)',
      rank: '경위',
      step: 9,
    });
    await expect(page.locator('#notice-track-pending')).toContainText('해양경찰은 일부만 계산해요');
    await expect(page.locator('#growth .off-note').first()).toContainText('승진소요최저연수');
    await expect(page.locator('#growth .off-note').first()).toContainText('준비 중');
    await expect(page.locator('#career')).toContainText('정년퇴직일');
    await expect(page.locator('#wallet')).toContainText('별표 10');
  });

  test('그 밖의 특정직: 홈 어디에도 금액이 없고 준비 중 띠, 연가 장부는 쓸 수 있다', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openApp(page);
    await onboardTrack(page, { track: '그 밖의 특정직 (준비 중)', step: 7 });
    await expect(page.locator('#status .level')).toContainText('7호봉(입력값)');
    await expect(page.locator('.dash')).not.toContainText(/\d원/);
    await expect(page.locator('#wallet')).toContainText('봉급 계산은 준비 중이에요');
    const banner = page.locator('#notice-track-pending');
    // 열여섯 항목이 모두 준비 중이라 '일부만'이라 하지 않고, 쓸 수 있는 것을 말한다
    await expect(banner).toContainText(
      '그 밖의 특정직은 봉급·정년·연가 일수 등을 아직 계산하지 않아요',
    );
    await expect(banner).not.toContainText('일부만');
    // 금액이 없으니 금액 가리기·추정치 안내·새 봉급표 줄도 없다
    await expect(page.locator('#today').getByRole('button', { name: '금액 가리기' })).toHaveCount(
      0,
    );
    await expect(page.locator('#wallet')).not.toContainText('추정치');
    await expect(page.locator('#wallet')).not.toContainText('새 봉급표');
    await banner.getByRole('button', { name: '무엇을 계산하나요?' }).click();
    await tick(page);
    await expect(page.locator('#sources-track')).toContainText('그 밖의 특정직 규정');
    await expect(page.locator('#sources-track')).toContainText('준비 중');

    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '연가' })
      .click();
    await tick(page);
    // 연가 일수 규정을 확인하지 못한 직종: 자동 부여 대신 직접 넣어 달라고 한다
    await expect(page.locator('#main')).toContainText('올해 연가 일수를 직접 넣어 주세요');
    await page.locator('#leave-entry').getByRole('button', { name: '1일', exact: true }).click();
    await tick(page);
    expect((await storedData(page))?.leave.records.length).toBe(1);
    // 기록이 있어도 부여 0을 계산값처럼 쓰지 않는다: '초과 사용'·'재직기간으로 계산'·제15조 문장 없음
    const summary = page.locator('#leave-summary');
    await expect(summary).toContainText('사용');
    await expect(summary).not.toContainText('초과 사용');
    await expect(summary).not.toContainText('재직기간으로 계산');
    await expect(page.locator('#leave-about')).not.toContainText('제15조');
    await summary.getByRole('button', { name: '부여 일수 넣기' }).click();
    const grant = page.getByRole('dialog');
    await expect(grant).not.toContainText('재직기간으로 계산한 값');
    await grant.getByRole('button', { name: '저장' }).click();
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '홈' })
      .click();
    await tick(page);
    // 0일을 넣으면 그때부터는 직접 넣은 값으로 센다(초과 사용은 사용자가 넣은 일수 기준)
    await expect(page.locator('#leave-mini')).toContainText('초과 사용');
    expect(errors).toEqual([]);
  });

  test('그 밖의 특정직: 홈 연가 창은 넣기 전에 남은·초과 숫자를 보이지 않고, [부여 일수 넣기]로 바로 넣는다', async ({
    page,
  }) => {
    await openSeed(
      page,
      makeSeedV4(
        { track: 'otherSpecial', payTable: null, rank: null, step: 7 },
        {
          leave: {
            records: [
              { id: 'r1', date: '2026-03-03', hours: 8, kind: 'day', memo: '' },
              { id: 'r2', date: '2026-04-07', hours: 8, kind: 'day', memo: '' },
            ],
            grantOverrideHours: {},
          },
        },
      ),
    );
    const mini = page.locator('#leave-mini');
    await expect(mini).toContainText('2일');
    await expect(mini).not.toContainText('초과 사용');
    await expect(mini).not.toContainText('/ 0일');
    await expect(mini.locator('.off-note')).toContainText('연가 일수');
    await mini.getByRole('button', { name: '부여 일수 넣기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('올해 부여 일수 넣기');
    await dialog.locator('#grant-days').fill('21');
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    expect((await storedData(page))?.leave.grantOverrideHours['2026']).toBe(21 * 8);
    await expect(page.locator('#leave-summary')).toContainText('남은 연가');
    await expect(page.locator('#leave-summary')).toContainText('(직접 넣은 값)');
  });
});

test.describe('직종 바꾸기·카드·불러오기·근거', () => {
  test('설정에서 경찰 → 교원: 계급 칸이 사라지고, 월급날 기본값 안내 띠로 17일로 바꾼다', async ({
    page,
  }) => {
    await openSeed(
      page,
      makeSeedV4({ track: 'police', payTable: null, rank: '경위', rankDate: '2022-09-01' }),
      'settings',
    );
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('현재 계급')).toBeVisible();
    await dialog.getByRole('radio', { name: '교원', exact: true }).click();
    await expect(dialog.getByLabel('현재 계급')).toHaveCount(0);
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    const banner = page.locator('#notice-track-change');
    await expect(banner).toContainText('교원 월급날 기본값은 17일이에요');
    await banner.getByRole('button', { name: '17일로 바꾸기' }).click();
    await tick(page);
    const data = await storedData(page);
    expect(data?.profile).toMatchObject({ track: 'teacher', rank: '교원', payTable: null });
    expect(data?.settings.payday).toBe(17);
    await expect(page.locator('#set-profile')).toContainText('교원');
    // 카드 미리보기에도 계급 이름이 없다
    await page
      .getByRole('navigation', { name: '화면 이동' })
      .getByRole('link', { name: '카드' })
      .click();
    await tick(page);
    await expect(page.locator('#card-preview [role="img"]')).not.toHaveAttribute(
      'aria-label',
      /경위/,
    );
    await expect(page.locator('#card-show-rank')).toHaveCount(0);
  });

  test('일반직 → 경찰로 바꾸면 카드의 계급 이름 넣기를 끄고 띠로 알린다', async ({ page }) => {
    await openSeed(page, makeSeedV4({ rank: '7' }), 'settings');
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: '경찰', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('계급을 순경으로 맞췄어요');
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    await expect(page.locator('#notice-track-change')).toContainText(
      '카드에는 계급 이름을 넣지 않게 바꿨어요',
    );
    expect((await storedData(page))?.settings.card.showRank).toBe(false);
  });

  test('일반직 봉급표만 별표 3 → 8 로 바꿔도 카드 계급 이름 설정이 바뀌면 띠로 알린다', async ({
    page,
  }) => {
    await openSeed(page, makeSeedV4({ rank: '7', step: 10 }), 'settings');
    await page.locator('#set-profile').getByRole('button', { name: '고치기' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: '우정직군(별표 8)' }).click();
    await dialog.getByRole('button', { name: '저장' }).click();
    await tick(page);
    const banner = page.locator('#notice-track-change');
    await expect(banner).toContainText('카드에는 계급 이름을 넣지 않게 바꿨어요');
    // 직종은 그대로라 월급날은 묻지 않는다
    await expect(banner).not.toContainText('월급날');
    expect((await storedData(page))?.settings.card.showRank).toBe(false);
  });

  test('카드의 계급 이름 넣기: 켜면 미리보기에 계급, 끄면 호봉만', async ({ page }) => {
    await openSeed(page, makeSeedV4({ rank: '7', step: 12 }), 'card');
    const preview = page.locator('#card-preview [role="img"]');
    await expect(preview).toHaveAttribute('aria-label', /7급 12호봉/);
    await page.getByRole('checkbox', { name: '계급 이름 넣기' }).uncheck();
    await tick(page);
    await expect(preview).not.toHaveAttribute('aria-label', /7급/);
    await expect(preview).toHaveAttribute('aria-label', /12호봉/);
    expect((await storedData(page))?.settings.card.showRank).toBe(false);
    // 결산 카드도 같은 설정을 따른다
    await page.getByRole('radio', { name: '올해 결산' }).click();
    await tick(page);
    await expect(preview).not.toHaveAttribute('aria-label', /7급/);
  });

  test('불러오기 요약은 직종과 계급·호봉을 보인다', async ({ page }) => {
    await openSeed(page, makeSeedV4(), 'settings');
    await page.getByRole('button', { name: PACKAGE_OPEN }).click();
    const path = join(mkdtempSync(join(tmpdir(), 'hobong-e2e-')), 'police.json');
    writeFileSync(path, fixture('backup-v4-police.json'));
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('dialog').getByRole('button', { name: '파일 고르기' }).click();
    await (await chooser).setFiles(path);
    await expect(page.getByRole('dialog')).toContainText('경찰 · 경위 9호봉');
  });

  test('근거 법령: 경찰은 경찰공무원법 근거와 준비 중 항목(시보)을 함께 보인다', async ({
    page,
  }) => {
    await openSeed(page, fixture('backup-v4-police.json'), 'settings');
    const track = page.locator('#sources-track');
    await expect(track).toContainText('경찰 규정');
    await expect(track).toContainText('경찰공무원법');
    await expect(track).toContainText('별표 10');
    await expect(track.locator('[data-off="pending"]').filter({ hasText: '시보' })).toHaveCount(1);
    // 일반직 값을 그대로 쓰는 항목은 적용 조항과 숫자가 나온 조문·단서를 함께 보인다
    const annual = track.locator('li').filter({ hasText: '연가 일수 · 적용하는 조문' });
    await expect(annual).toContainText('제15조');
    await expect(annual).toContainText('반영하지 않아요');
    await expect(track.locator('li').filter({ hasText: '연가 일수 · 적용 조항' })).toContainText(
      '경찰공무원 복무규정',
    );
  });

  test('직종이 없던 저장본(v3)을 열면 새로 계산하는 직종을 한 번 알린다', async ({ page }) => {
    await openSeed(page, makeSeed());
    const banner = page.locator('#notice-upgraded');
    await expect(banner).toContainText('경찰·소방·교원');
    await banner.getByRole('button', { name: '알겠어요' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await tick(page, 3000);
    await closeDialogs(page);
    await expect(page.locator('#notice-upgraded')).toHaveCount(0);
  });

  test('계급이 사다리에 없는 저장본은 상태창에서 다시 골라 달라고 한다', async ({ page }) => {
    await openSeed(page, makeSeedV4({ track: 'police', payTable: null, rank: null }));
    await expect(page.locator('#status-rank-problem')).toContainText('계급을 골라 주세요');
    await expect(page.locator('#status-rank-problem')).not.toContainText('목록에 없어');
    // 원문 미확인이 아니라 입력이 모자란 것: '준비 중'이 아니라 '입력 필요'
    await expect(page.locator('#career')).toContainText('입력 필요');
    await expect(page.locator('#career')).not.toContainText('준비 중');
    // 홈에서는 상태창이 이미 알리므로 위 띠에 '고를 수 없어요'·날짜 안내를 겹쳐 적지 않는다
    await expect(page.locator('#main')).not.toContainText('이 계급은 고를 수 없어요');
    await expect(page.getByRole('button', { name: '내 정보 고치기' })).toHaveCount(1);
  });

  test('키보드만으로 직종·봉급표·계급을 고른다(라디오 묶음은 Tab 정지점 하나)', async ({
    page,
  }) => {
    await openApp(page);
    await startForm(page);
    const general = page.getByRole('radio', { name: '일반직', exact: true });
    await general.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '경찰', exact: true })).toBeFocused();
    await expect(page.getByRole('radio', { name: '경찰', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('ArrowLeft');
    await expect(general).toHaveAttribute('aria-checked', 'true');
    // 다음 Tab 은 같은 묶음의 다른 칩이 아니라 봉급표 묶음(고른 칩)으로 간다
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: '일반직(별표 3)' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('radio', { name: '우정직군(별표 8)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByLabel('현재 직급').locator('option').first()).toHaveText('우정9급');
    // 빈 채로 저장하면 오류 요약은 하나(role=alert)
    await page.getByRole('button', { name: '알 깨우기' }).click();
    await expect(page.getByRole('alert')).toHaveCount(1);
  });
});
