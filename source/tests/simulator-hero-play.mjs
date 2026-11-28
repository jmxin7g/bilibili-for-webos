import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(page => page.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const rcu = browser.contexts()[0].pages().find(page => page.url().includes('/screen/rcu/'));
const report = { date: new Date().toISOString(), checks: [] };
const previousProfilePrompt = await page.evaluate(() => localStorage.getItem('test.skipProfilePrompt'));
try {
  await page.evaluate(() => localStorage.setItem('test.skipProfilePrompt', '1'));
  await page.reload();
  await page.waitForFunction(() => window.showPage && heroItem, null, { polling: 100, timeout: 60000 });
  await page.evaluate(() => {
    if (profilePicker.open) profilePicker.close();
    window.heroTestRequest = serviceRequest;
    serviceRequest = (path, ...args) => path.startsWith('/resolve?')
      ? Promise.reject(new Error('该视频不提供所选画质')) : heroTestRequest(path, ...args);
  });
  for (const trigger of ['click', 'Enter', 'remote-confirm']) {
    await page.evaluate(() => { showPage('browse'); window.scrollTo(0, 0); });
    const bvid = await page.evaluate(() => heroItem.bvid);
    if (trigger === 'click') await page.locator('#hero-play').click({ force: true });
    else {
      await page.locator('#hero-play').focus();
      if (trigger === 'Enter') await page.keyboard.press('Enter');
      else await rcu.locator('[data-testid="buttonRCU-Enter"]').click({ force: true });
    }
    await page.waitForFunction(() => !start.disabled && homeStatus.textContent.startsWith('播放失败'), null, { polling: 100 });
    const state = await page.evaluate(() => ({
      bvid: input.value, focus: document.activeElement.id, scroll: window.scrollY, clickedAtScroll: returnScroll,
      detail: !detail.hidden, player: !player.hidden,
      status: document.querySelector('#hero-status')?.textContent,
    }));
    report.checks.push({ trigger, ...state });
    assert.equal(state.bvid, bvid);
    assert.equal(state.detail, false);
    assert.equal(state.player, false);
    assert.equal(state.scroll, 0, 'failed hero playback must not scroll to the footer retry button');
    assert.equal(state.focus, 'hero-play');
    assert.equal(state.status, '播放失败：该视频不提供所选画质');
  }
  const cdp = await page.context().newCDPSession(page);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/hero-play-error.png', Buffer.from(screenshot.data, 'base64'));
  assert.equal(await page.locator('#hero-info').count(), 0, 'hero info button was removed');
  assert.equal(await page.locator('#hero-play').evaluate(button => getComputedStyle(button).fontSize), '0px', 'play text remains accessible but is not displayed');
  const card = page.locator('#recommend-grid .video-card').first();
  const cardBvid = await card.getAttribute('data-bvid');
  await card.click({ force: true });
  const detailState = await page.evaluate(() => ({ detail: !detail.hidden, player: !player.hidden }));
  assert.equal(detailState.detail, true, 'video cards still open details');
  assert.equal(detailState.player, false);
  await page.evaluate(() => backDetail());
  assert.equal(await page.evaluate(() => document.activeElement.dataset.bvid), cardBvid);
  report.checks.push({ trigger: 'card-details-and-back', ...detailState, returnedFocus: cardBvid });
  report.result = 'PASS';
} finally {
  await page.evaluate(() => { if (window.heroTestRequest) { serviceRequest = heroTestRequest; delete window.heroTestRequest; } });
  await page.evaluate(previous => {
    if (previous === null) localStorage.removeItem('test.skipProfilePrompt');
    else localStorage.setItem('test.skipProfilePrompt', previous);
  }, previousProfilePrompt);
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/hero-play.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
