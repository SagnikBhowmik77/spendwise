// Review screenshots of every screen: desktop + phone, light + dark, against the running dev server.
// Usage: SHOT_EMAIL=... SHOT_PASSWORD=... node scripts/shots.mjs <output-dir>
// Reports page errors and horizontal overflow (a layout wider than the screen).
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.SHOT_URL || 'http://localhost:5200';
const out = process.argv[2];
const { SHOT_EMAIL: email, SHOT_PASSWORD: password } = process.env;
if (!out || !email || !password) {
  console.error('Usage: SHOT_EMAIL=... SHOT_PASSWORD=... node scripts/shots.mjs <output-dir>');
  process.exit(1);
}
await mkdir(out, { recursive: true });

// Every signed-in screen (tabs included), in the order the redesign goes through them.
const PAGES = [
  ['dashboard', '/'], ['transactions', '/transactions'], ['budgets', '/budgets'], ['budgets-envelopes', '/budgets?tab=envelopes'],
  ['budgets-funds', '/budgets?tab=funds'], ['accounts', '/accounts'], ['insights', '/insights'], ['investments', '/investments'],
  ['plan', '/plan'], ['plan-fire', '/plan?tab=fire'], ['bills', '/bills'], ['goals', '/goals'], ['wishlist', '/goals?tab=wishlist'],
  ['debts', '/debts'], ['groups', '/groups'], ['vehicles', '/vehicles'], ['vault', '/vault'], ['recurring', '/recurring'],
  ['trips', '/trips'], ['import', '/import'], ['integrations', '/integrations'], ['household', '/household'],
  ['activity', '/activity'], ['settings', '/settings'], ['ui', '/ui'],
];
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 860 }, { name: 'phone', width: 390, height: 844 }];
const only = process.env.SHOT_ONLY?.split(',');

const browser = await chromium.launch();
const problems = [];
for (const theme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme });
    const page = await ctx.newPage();
    page.on('pageerror', (err) => problems.push(`${vp.name}/${theme}: page error ${err.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`${vp.name}/${theme}: console ${msg.text()}`); });

    await page.goto(`${base}/login`);
    await page.waitForLoadState('networkidle');
    if (!only || only.includes('login')) await page.screenshot({ path: `${out}/${vp.name}-${theme}-login.png`, fullPage: true });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/`);

    for (const [slug, path] of PAGES) {
      if (only && !only.includes(slug)) continue;
      await page.goto(base + path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) problems.push(`${vp.name}/${theme}/${slug}: page is ${overflow}px wider than the screen`);
      await page.screenshot({ path: `${out}/${vp.name}-${theme}-${slug}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? `Problems:\n${problems.join('\n')}` : 'No page errors, no horizontal overflow.');
