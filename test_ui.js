// Playwright UI test for keleifei frontend
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', msg => console.log('[console]', msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  console.log('=== 1. Open / ===');
  await page.goto('http://localhost:3789/', { waitUntil: 'networkidle' });
  const title = await page.title();
  console.log('  title:', title);

  console.log('=== 2. Should show setup form (no users yet) ===');
  const setupVisible = await page.locator('text=系统尚未初始化').count();
  console.log('  setup visible:', setupVisible > 0);
  await page.screenshot({ path: 'C:/Users/86182/WorkBuddy/2026-09-07-12-07-24/keleifei-server/screen_1_setup.png' });

  console.log('=== 3. Fill setup form ===');
  await page.fill('#authName', '小雪老师');
  await page.fill('#authPass', '1234');
  await page.click('button:has-text("创建并进入系统")');
  await page.waitForTimeout(800);
  const headerText = await page.locator('.header h1').textContent();
  console.log('  header after setup:', headerText);
  await page.screenshot({ path: 'C:/Users/86182/WorkBuddy/2026-09-07-12-07-24/keleifei-server/screen_2_dashboard.png' });

  console.log('=== 4. Switch to items tab ===');
  await page.click('.tab:has-text("物品")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/Users/86182/WorkBuddy/2026-09-07-12-07-24/keleifei-server/screen_3_items.png' });

  console.log('=== 5. Add new item ===');
  await page.click('button:has-text("➕ 新增物品")');
  await page.waitForTimeout(300);
  await page.fill('#f_name', '双面胶');
  await page.fill('#f_spec', '宽4cm');
  await page.fill('#f_unit', '卷');
  await page.fill('#f_init', '50');
  await page.fill('#f_min', '10');
  await page.click('button:has-text("保存"):not(.ghost)');
  await page.waitForTimeout(800);
  const itemName = await page.locator('.item-card .name').first().textContent();
  console.log('  item shown:', itemName);
  await page.screenshot({ path: 'C:/Users/86182/WorkBuddy/2026-09-07-12-07-24/keleifei-server/screen_4_item_added.png' });

  console.log('=== 6. Switch to inbound tab ===');
  await page.click('.tab:has-text("入库")');
  await page.waitForTimeout(300);
  await page.fill('#in_qty', '20');
  await page.fill('#in_remark', '淘宝购入');
  await page.click('button:has-text("确认入库")');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:/Users/86182/WorkBuddy/2026-09-07-12-07-24/keleifei-server/screen_5_inbound.png' });

  console.log('=== 7. Switch to logs tab ===');
  await page.click('.tab:has-text("台账")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/Users/86182/WorkBuddy/2026-09-07-12-07-24/keleifei-server/screen_6_logs.png' });

  console.log('=== 8. Settings tab + diag ===');
  await page.click('.tab:has-text("设置")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("刷新诊断")');
  await page.waitForTimeout(500);
  const diagText = await page.locator('#diagBox').textContent();
  console.log('  diag:', diagText.slice(0, 200));
  await page.screenshot({ path: 'C:/Users/86182/WorkBuddy/2026-09-07-12-07-24/keleifei-server/screen_7_settings.png' });

  await browser.close();
  console.log('\n=== ALL UI TESTS DONE ===');
})();