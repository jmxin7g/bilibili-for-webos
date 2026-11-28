// Visual/health walkthrough of every sidebar page plus one detail page. Run via tools/simulator-test.mjs.
// Screenshots + metrics go to output/playwright/walkthrough/.
import { writeFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const cdp = await page.context().newCDPSession(page);
const dir = 'output/playwright/walkthrough';
await mkdir(dir, { recursive: true });
const shot = async name => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(`${dir}/${name}.png`, Buffer.from(data, 'base64')); };
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push({ type: m.type(), text: m.text().slice(0, 200) }); });
page.on('pageerror', e => consoleErrors.push({ type: 'pageerror', text: e.message.slice(0, 200) }));
const metrics = () => page.evaluate(() => {
  const section = document.querySelector('[id^=page-]:not([hidden])');
  const imgs = [...section.querySelectorAll('img')].filter(i => i.getClientRects().length);
  const statuses = [...section.querySelectorAll('[role=status], .status, [id$=-status]')].map(e => e.textContent.trim()).filter(Boolean);
  return {
    section: section.id, cards: section.querySelectorAll('.video-card').length,
    visibleImgs: imgs.length, brokenImgs: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
    pendingImgs: imgs.filter(i => !i.complete).length,
    hOverflow: document.documentElement.scrollWidth > innerWidth, pageHeight: document.documentElement.scrollHeight,
    statuses, busy: !!section.querySelector('.loading, [aria-busy=true]'),
  };
});
const report = { date: new Date().toISOString(), pages: {} };
const pagesList = ['browse', 'popular', 'following', 'cloud-history', 'favorites', 'regions', 'search', 'settings'];
for (const name of pagesList) {
  const t0 = Date.now();
  await page.evaluate(n => { window.scrollTo(0, 0); showPage(n); }, name);
  // Wait until cards render or a status message appears (max 20 s), then let images settle.
  await page.waitForFunction(() => {
    const s = document.querySelector('[id^=page-]:not([hidden])');
    return s.querySelectorAll('.video-card').length > 0 || [...s.querySelectorAll('[role=status], [id$=-status]')].some(e => e.textContent.trim()) || s.id === 'page-settings' || s.id === 'page-search';
  }, null, { timeout: 20000 }).catch(() => {});
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  report.pages[name] = { readyMs, ...(await metrics()) };
  await shot(name);
}
// Detail page from the first recommended card.
await page.evaluate(() => { showPage('browse'); window.scrollTo(0, 0); });
await page.locator('#recommend-grid .video-card').first().focus();
await page.keyboard.press('Enter');
await page.waitForFunction(() => { const d = document.querySelector('#detail'); return d && !d.hidden; }, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
report.detail = await page.evaluate(() => { const d = document.querySelector('#detail'); return { open: !!d && !d.hidden, text: d?.innerText.slice(0, 300), active: document.activeElement.id || document.activeElement.className }; });
await shot('detail');
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
report.afterDetailBack = await page.evaluate(() => ({ detailHidden: document.querySelector('#detail')?.hidden, active: document.activeElement.className, row: document.activeElement.parentElement?.id }));
report.consoleErrors = consoleErrors;
await writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await browser.close();
