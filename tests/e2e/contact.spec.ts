import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { allowClipboard, collectErrors, makeSeed, openApp, ROOT, tick } from './helpers.ts';

/**
 * 제안·문의와 호봉이의 꿈(#28). 메일 주소는 data/site.json 에서 읽는다.
 * 주소가 비어 있으면 '준비 중'만 보이고, 메일 쓰기 링크(mailto)는 화면에 없다.
 */
const site = JSON.parse(readFileSync(join(ROOT, 'data', 'site.json'), 'utf8')) as {
  contactEmail: string;
  dreams: { id: string; status: string; title: string }[];
};
const hasEmail = site.contactEmail.trim() !== '';

test.describe('제안·문의와 호봉이의 꿈', () => {
  test('설정 화면에 두 창이 있고, 주소가 없으면 준비 중이라고만 한다', async ({ page }) => {
    const errors = collectErrors(page);
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    const contact = page.locator('#set-contact');
    await expect(contact.getByRole('heading', { name: '제안·문의' })).toBeVisible();
    await expect(contact).toContainText('공식 서비스가 아니에요');
    await expect(contact).toContainText('개인정보는 적지 않아도 돼요');
    if (hasEmail) {
      await expect(contact.getByRole('link', { name: '메일 쓰기' })).toHaveAttribute(
        'href',
        new RegExp(`^mailto:${site.contactEmail.trim().replace(/[.+]/g, '\\$&')}\\?subject=`),
      );
    } else {
      await expect(page.locator('#contact-pending')).toContainText('메일 주소를 준비하고 있어요');
      await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
      await expect(contact.getByRole('button', { name: '주소 복사' })).toHaveCount(0);
    }
    // 앱 정보: 버전과 규정 데이터 연도만(입력한 닉네임 같은 개인 정보는 없다)
    await expect(contact).toContainText(/호봉 \d+\.\d+\.\d+ · 규정 데이터 \d{4}년/);
    await expect(contact).not.toContainText('김주무관');
    expect(errors).toEqual([]);
  });

  test('앱 정보 복사를 누르면 알려 준다', async ({ page, browserName }) => {
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    await allowClipboard(page, browserName);
    await page.locator('#set-contact').getByRole('button', { name: '앱 정보 복사' }).click();
    await tick(page);
    await expect(page.getByText('앱 정보를 복사했어요.')).toBeVisible();
  });

  test('호봉이의 꿈은 상태별로 묶어 모두 보여 준다', async ({ page }) => {
    await openApp(page, { seed: makeSeed(), hash: 'settings' });
    const dreams = page.locator('#set-dreams');
    await expect(dreams.getByRole('heading', { name: '호봉이의 꿈' })).toBeVisible();
    const labels: Record<string, string> = {
      done: '이룬 꿈',
      growing: '자라는 중',
      dream: '꾸는 꿈',
    };
    for (const [status, label] of Object.entries(labels)) {
      const count = site.dreams.filter((d) => d.status === status).length;
      if (count === 0) continue;
      const group = dreams.getByRole('region', { name: new RegExp(`^${label}`) });
      await expect(group.getByRole('listitem')).toHaveCount(count);
    }
    for (const dream of site.dreams) await expect(dreams).toContainText(dream.title);
  });
});
