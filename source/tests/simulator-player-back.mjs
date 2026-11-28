import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const pages = browser.contexts()[0].pages();
const page = pages.find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const rcu = pages.find(p => p.url().includes('/screen/rcu/'));
assert.ok(page); assert.ok(rcu);
const report = { date: new Date().toISOString(), checks: [], result: 'RUNNING' };
try {
  await page.reload();
  await page.waitForFunction(() => window.showPage && document.querySelector('#startup-screen').hidden, null, { timeout: 60000 });
  await page.evaluate(() => { showPage('settings'); quality.value = '360'; input.value = 'BV1fwEwzeEPp'; });
  for (const trigger of ['Escape', 'Simulator RCU Back']) {
    await page.evaluate(() => { quality.focus(); start.click(); });
    await page.waitForFunction(() => !player.hidden && video.readyState >= 3 && !video.paused, null, { timeout: 60000 });
    await page.evaluate(() => showControls());
    const before = await page.evaluate(() => video.currentTime);
    if (trigger === 'Escape') await page.keyboard.press('Escape');
    else await rcu.locator('[data-testid="buttonRCU-Back"]').click({ force: true });
    assert.deepEqual(await page.evaluate(() => ({ playerVisible: !player.hidden, controlsHidden: overlay.hidden, paused: video.paused, focus: document.activeElement.id })), { playerVisible: true, controlsHidden: true, paused: false, focus: 'player' });
    await page.waitForFunction(time => video.currentTime > time + 1, before, { timeout: 15000 });
    // Enter reveals the controls again without pausing or exiting.
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => !overlay.hidden && !video.paused && !player.hidden), true);
    if (trigger === 'Escape') await page.keyboard.press('Escape');
    else await rcu.locator('[data-testid="buttonRCU-Back"]').click({ force: true });
    assert.equal(await page.evaluate(() => overlay.hidden && !player.hidden), true);
    await page.screenshot({ path: `output/playwright/player-back-hidden-${trigger === 'Escape' ? 'keyboard' : 'rcu'}.png` });
    if (trigger === 'Escape') await page.keyboard.press('Escape');
    else await rcu.locator('[data-testid="buttonRCU-Back"]').click({ force: true });
    await page.waitForFunction(() => player.hidden && !home.hidden);
    assert.equal(await page.evaluate(() => document.activeElement !== document.body && document.activeElement.getClientRects().length > 0), true);
    report.checks.push({ trigger, firstBack: 'controls hidden; playback advances', enter: 'controls revealed', secondBack: 'exits playback; focus restored' });
  }
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message; throw error;
} finally {
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/simulator-player-back.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
