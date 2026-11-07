import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * The 2-minute demo from spec §12.2 on two isolated browser contexts, which stand in for
 * two phones, plus the failure paths the judges are most likely to try.
 */

const SHOTS = process.env.E2E_SCREENSHOT_DIR;

// There is a single demo applicant, so every test starts from freshly seeded data, as a demo does.
test.beforeEach(() => {
  const dataDir = process.env.TUONIBAN_E2E_DIR!;
  // The running node with tsx's loader, not `npx`: Windows cannot spawn `npx` without a shell.
  execFileSync(process.execPath, ['--import', 'tsx', 'server/src/reset-cli.ts'], {
    env: { ...process.env, DATABASE_PATH: join(dataDir, 'e2e.db'), PRIVATE_UPLOAD_DIR: join(dataDir, 'uploads') },
    stdio: 'ignore',
  });
});

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
}

// Each phone keeps polling until it is closed, so leftover phones would slow later tests down.
const openPhones: BrowserContext[] = [];

test.afterEach(async () => {
  await Promise.all(openPhones.splice(0).map((context) => context.close()));
});

async function newPhone(browser: Browser): Promise<Page> {
  const context = await browser.newContext(test.info().project.use);
  openPhones.push(context);
  return context.newPage();
}

/** S01 → S02: the applicant agrees and gets a QR code. Returns the assist link. */
async function applicantCreatesCode(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: '我要請人幫忙' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '我的協助碼' })).toBeVisible();
  const created = page.waitForResponse((r) => r.url().endsWith('/api/assistance-grants') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '同意並產生協助碼' }).click();
  const { data } = (await (await created).json()) as { data: { token: string } };
  await expect(page.getByRole('img', { name: /QR/ })).toBeVisible();
  await expect(page.getByText(/待領取/)).toBeVisible();
  return `http://localhost:4173/assist#token=${data.token}`;
}

/** S01 → S03 → S04: the helper pastes the link. */
async function helperOpensByPasting(page: Page, link: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '我要幫忙' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '掃碼開始協助' })).toBeVisible();
  await shot(page, 's03-scan');
  await page.getByLabel('或貼上協助連結').fill(link);
  await page.getByRole('button', { name: '開始協助' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '協助填寫需求' })).toBeVisible();
}

async function fillForm(page: Page): Promise<void> {
  const location = page.getByLabel(/^偏好地點/);
  await location.selectOption({ index: 1 });
  const date = page.getByLabel(/^偏好日期/);
  await date.fill((await date.getAttribute('min')) ?? '');
  await page.getByLabel(/^偏好時段/).selectOption('morning');
  await page.getByRole('radio', { name: '否' }).check();
  await page.getByLabel(/^代辦稱呼/).fill('小王');
  await page.getByLabel(/^代辦聯絡電話/).fill('0900000000');
}

test('the 2-minute demo: code, scan, fill, upload, submit, and the applicant sees the receipt', async ({ browser }) => {
  const applicant = await newPhone(browser);
  const helper = await newPhone(browser);

  await applicant.goto('/');
  await shot(applicant, 's01-home');
  const link = await applicantCreatesCode(applicant);
  await shot(applicant, 's02-qr');

  await helperOpensByPasting(helper, link);
  await expect(helper.getByText('正在協助：申請者 A')).toBeVisible();
  await expect(helper.getByText('身分資料已備妥')).toBeVisible();

  // The applicant's page updates by itself (5-second poll).
  await expect(applicant.getByRole('main').getByText('有人正在協助')).toBeVisible({ timeout: 15_000 });

  await fillForm(helper);
  await helper.getByRole('button', { name: '使用內建合成範例' }).click();
  await expect(helper.getByText(/已上傳/)).toBeVisible();
  await helper.getByRole('button', { name: '儲存草稿' }).click();
  await expect(helper.getByText(/最後儲存/)).toBeVisible();
  await shot(helper, 's04-form');

  // A refresh restores what was saved (AT06).
  await helper.reload();
  await expect(helper.getByLabel(/^代辦稱呼/)).toHaveValue('小王');

  await helper.getByRole('button', { name: '下一步：確認內容' }).click();
  await expect(helper.getByRole('heading', { level: 1, name: '確認這次需求' })).toBeVisible();
  await expect(helper.getByText(/不代表健檢名額或正式預約成功/)).toBeVisible();
  await shot(helper, 's05-review');

  // The helper cannot submit yet: the applicant has to confirm this exact content first (info.md F09).
  await expect(helper.getByRole('button', { name: '確認並模擬送出' })).toHaveCount(0);
  await helper.getByRole('button', { name: '送交本人確認' }).click();
  await expect(helper.getByText('已送交本人確認')).toBeVisible();

  // The applicant's page shows what to confirm by itself (5-second poll), with no protected values.
  const request = applicant.getByRole('region', { name: '請確認代辦者準備的內容' });
  await expect(request).toBeVisible({ timeout: 15_000 });
  await expect(request).toContainText('稱呼：小王');
  await expect(request).toContainText('身分資料：已備妥，原值不顯示');
  await shot(applicant, 's02-confirm-request');
  await request.getByRole('button', { name: '確認內容' }).click();
  await expect(applicant.getByText('你已確認內容，等待代辦者模擬送出。')).toBeVisible();

  // The helper's page picks up the answer by itself too.
  await expect(helper.getByText('本人已確認這份內容')).toBeVisible({ timeout: 15_000 });
  await helper.getByRole('button', { name: '確認並模擬送出' }).click();
  await expect(helper.getByRole('heading', { level: 1, name: '模擬送出完成' })).toBeVisible();
  const receiptNo = (await helper.getByText(/DEMO-\d{8}-\d{4}/).first().textContent())?.match(/DEMO-\d{8}-\d{4}/)?.[0];
  expect(receiptNo).toBeTruthy();
  await expect(helper.getByText(/尚未送交政府或醫院/).first()).toBeVisible();
  await shot(helper, 's06-result');

  // Refresh shows the same receipt, with nothing to edit (AT09).
  await helper.reload();
  await expect(helper.getByText(receiptNo!).first()).toBeVisible();
  await expect(helper.getByRole('button', { name: /儲存|送出/ })).toHaveCount(0);

  await expect(applicant.getByText(receiptNo!).first()).toBeVisible({ timeout: 15_000 });
  await shot(applicant, 's02-completed');

  // The protected applicant values never reach the helper's screen (AT11).
  await expect(helper.locator('body')).not.toContainText('虛構長者甲');
  await expect(helper.locator('body')).not.toContainText('DEMO-ID-0000');
});

test('opening the link directly, as a phone camera would, lands on the form', async ({ browser }) => {
  const applicant = await newPhone(browser);
  const helper = await newPhone(browser);
  const link = await applicantCreatesCode(applicant);

  await helper.goto(link);
  await expect(helper.getByRole('heading', { level: 1, name: '協助填寫需求' })).toBeVisible();
  // The token is removed from the address bar once it has been used.
  expect(new URL(helper.url()).hash).toBe('');

  // A second helper with the same code is refused without seeing the case (AT04).
  const stranger = await newPhone(browser);
  await stranger.goto(link);
  await expect(stranger.getByRole('heading', { level: 1 })).toContainText('已被領取');
  await expect(stranger.locator('body')).not.toContainText('小王');
});

test('stopping assistance blocks the helper on their next action (AT12)', async ({ browser }) => {
  const applicant = await newPhone(browser);
  const helper = await newPhone(browser);
  const link = await applicantCreatesCode(applicant);
  await helperOpensByPasting(helper, link);
  await expect(applicant.getByRole('main').getByText('有人正在協助')).toBeVisible({ timeout: 15_000 });

  await applicant.getByRole('button', { name: '停止協助' }).click();
  const dialog = applicant.getByRole('dialog');
  await expect(dialog).toContainText('已送出的內容不會自動撤回');
  await dialog.getByRole('button', { name: '停止協助' }).click();
  await expect(applicant.getByText(/已停止/).first()).toBeVisible();

  await helper.getByLabel(/^代辦稱呼/).fill('小王');
  await helper.getByRole('button', { name: '儲存草稿' }).click();
  await expect(helper.getByRole('heading', { level: 1, name: '這次協助已停止' })).toBeVisible();
  await shot(helper, 's07-revoked');

  // The applicant's activity log shows the stop and the refused save, without a reload (polling).
  const log = applicant.getByRole('region', { name: '協助紀錄' });
  await expect(log).toContainText('你停止了協助');
  await expect(log).toContainText('系統已擋下', { timeout: 15_000 });
  await shot(applicant, 's02-activity-log');
});

test('links from elsewhere are refused and never followed (AT05)', async ({ browser }) => {
  const helper = await newPhone(browser);
  await helper.goto('/');
  await helper.getByRole('button', { name: '我要幫忙' }).click();
  for (const bad of ['https://evil.example/assist#token=' + 'a'.repeat(43), 'hello', 'http://localhost:4173/assist#token=short']) {
    await helper.getByLabel('或貼上協助連結').fill(bad);
    await helper.getByRole('button', { name: '開始協助' }).click();
    await expect(helper).toHaveURL(/\/scan$/);
    await expect(helper.getByText(/這不是|協助碼/).first()).toBeVisible();
  }
  // Well-formed but unknown: the server says invalid, shown as the S07 state.
  await helper.getByLabel('或貼上協助連結').fill(`http://localhost:4173/assist#token=${'b'.repeat(43)}`);
  await helper.getByRole('button', { name: '開始協助' }).click();
  await expect(helper.getByRole('heading', { level: 1 })).toContainText('不是可用的協助碼');
});

test('inside TownPass the scan button uses the app bridge, and a cancelled scan is silent', async ({ browser }) => {
  const applicant = await newPhone(browser);
  const link = await applicantCreatesCode(applicant);

  const helper = await newPhone(browser);
  // Mimics TPWebView's flutterObject: replies are JSON strings delivered as message events.
  await helper.addInitScript((scanned: string) => {
    const target = new EventTarget();
    let calls = 0;
    (window as unknown as { flutterObject: unknown }).flutterObject = {
      postMessage(raw: string) {
        const { name } = JSON.parse(raw) as { name: string };
        if (name !== 'qr_code_scan') return;
        calls += 1;
        const data = calls === 1 ? null : scanned; // first scan cancelled, second succeeds
        setTimeout(() => {
          target.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ name, data }) }));
          (window as unknown as { scanReplies: number }).scanReplies = calls;
        }, 50);
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
  }, link);

  await helper.goto('/');
  await helper.getByRole('button', { name: '我要幫忙' }).click();
  await helper.getByRole('button', { name: '掃描協助碼' }).click();
  // The native scanner is open until the app replies; only then can the button be used again.
  await helper.waitForFunction(() => (window as unknown as { scanReplies?: number }).scanReplies === 1);
  await expect(helper).toHaveURL(/\/scan$/);
  await expect(helper.locator('.field__error, .notice--error')).toHaveCount(0);

  await helper.getByRole('button', { name: '掃描協助碼' }).click();
  await expect(helper.getByRole('heading', { level: 1, name: '協助填寫需求' })).toBeVisible();
  // Inside the app TownPass shows its own title bar, but the demo label must stay.
  await expect(helper.getByText('模擬服務')).toBeVisible();
  await expect(helper.getByRole('link', { name: '託你辦，回首頁' })).toHaveCount(0);
  await expect(helper.getByRole('link', { name: '回首頁' })).toBeVisible();
  await shot(helper, 's04-in-townpass');
});

test('main screens have no serious accessibility violations and fit 320px (AT14)', async ({ browser }) => {
  const applicant = await newPhone(browser);
  const helper = await newPhone(browser);
  const check = async (page: Page, label: string) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
    await page.setViewportSize({ width: 320, height: 700 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${label} overflows at 320px`).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 390, height: 844 });
  };

  await applicant.goto('/');
  await check(applicant, 'S01');
  const link = await applicantCreatesCode(applicant);
  await check(applicant, 'S02');
  await helper.goto('/');
  await helper.getByRole('button', { name: '我要幫忙' }).click();
  await check(helper, 'S03');
  await helper.getByLabel('或貼上協助連結').fill(link);
  await helper.getByRole('button', { name: '開始協助' }).click();
  await expect(helper.getByRole('heading', { level: 1, name: '協助填寫需求' })).toBeVisible();
  await check(helper, 'S04');

  await fillForm(helper);
  await helper.getByRole('button', { name: '使用內建合成範例' }).click();
  await expect(helper.getByText(/已上傳/)).toBeVisible();
  await helper.getByRole('button', { name: '下一步：確認內容' }).click();
  await expect(helper.getByRole('heading', { level: 1, name: '確認這次需求' })).toBeVisible();
  await check(helper, 'S05');
  await helper.getByRole('button', { name: '送交本人確認' }).click();
  await expect(applicant.getByRole('region', { name: '請確認代辦者準備的內容' })).toBeVisible({ timeout: 15_000 });
  await check(applicant, 'S02 confirm');
});

test('the applicant can send the content back, and the helper asks again after fixing it (info.md E03)', async ({
  browser,
}) => {
  const applicant = await newPhone(browser);
  const helper = await newPhone(browser);
  const link = await applicantCreatesCode(applicant);
  await helperOpensByPasting(helper, link);
  await fillForm(helper);
  await helper.getByRole('button', { name: '使用內建合成範例' }).click();
  await expect(helper.getByText(/已上傳/)).toBeVisible();
  await helper.getByRole('button', { name: '下一步：確認內容' }).click();
  await helper.getByRole('button', { name: '送交本人確認' }).click();

  const request = applicant.getByRole('region', { name: '請確認代辦者準備的內容' });
  await request.getByRole('button', { name: '退回修改' }).click({ timeout: 15_000 });
  await expect(applicant.getByText('你已退回內容，等待代辦者修改後再請你確認。')).toBeVisible();

  await expect(helper.getByRole('main').getByText(/本人退回了這份內容。請返回修改/)).toBeVisible({ timeout: 15_000 });
  await helper.getByRole('button', { name: '返回修改' }).click();
  await helper.getByLabel(/^代辦稱呼/).fill('小王（女兒）');
  await helper.getByRole('button', { name: '下一步：確認內容' }).click();
  await helper.getByRole('button', { name: '送交本人確認' }).click();

  await expect(request).toContainText('稱呼：小王（女兒）', { timeout: 15_000 });
  await request.getByRole('button', { name: '確認內容' }).click();
  await expect(helper.getByRole('button', { name: '確認並模擬送出' })).toBeVisible({ timeout: 15_000 });
  await expect(applicant.getByRole('region', { name: '協助紀錄' })).toContainText('你退回內容，請代辦者修改');
});
