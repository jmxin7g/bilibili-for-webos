// Player info line shows only the UP owner, and the status line stays empty while playing or paused.
// Run through tools/simulator-test.mjs (handles profile prompt and state restore).
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const cdp = await page.context().newCDPSession(page);
const shot = async name => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(`output/playwright/${name}`, Buffer.from(data, 'base64')); };
const previousQuality = await page.evaluate(() => quality.value);
const report = { date: new Date().toISOString(), result: 'RUNNING' };
try {
  await mkdir('output/playwright', { recursive: true });
  if (await page.evaluate(() => !player.hidden)) await page.evaluate(() => leavePlayer());
  await page.evaluate(() => { quality.value = '360'; quality.dispatchEvent(new Event('change')); input.value = 'BV1fwEwzeEPp'; start.click(); });
  await page.waitForFunction(() => !player.hidden && video.readyState >= 3 && !video.paused, null, { timeout: 60000 });
  await page.evaluate(() => showControls());
  report.playing = await page.evaluate(() => ({ source: document.querySelector('#source').textContent, status: playerStatus.textContent, owner: current.owner }));
  assert.equal(report.playing.source, report.playing.owner, 'source line is the owner only');
  assert.equal(report.playing.status, '', 'no 正在播放 label');
  await shot('player-labels-playing.png');
  await page.waitForFunction(() => overlay.hidden, null, { timeout: 8000 });
  report.autoHide = true;
  await page.evaluate(() => video.pause());
  await page.waitForFunction(() => !overlay.hidden && video.paused, null, { timeout: 5000 });
  report.paused = await page.evaluate(() => ({ source: document.querySelector('#source').textContent, status: playerStatus.textContent }));
  assert.equal(report.paused.status, '', 'no 已暂停 label');
  assert.ok(!/实际画质|正在播放|已暂停/.test(report.paused.source + report.paused.status));
  await shot('player-labels-paused.png');
  await page.waitForTimeout(6000);
  assert.equal(await page.evaluate(() => overlay.hidden), false, 'controls stay while paused');
  report.pausedControlsStay = true;
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message.split('\n')[0]; throw error;
} finally {
  await page.evaluate(v => { if (!player.hidden) leavePlayer(); quality.value = v; quality.dispatchEvent(new Event('change')); }, previousQuality);
  await writeFile('output/playwright/simulator-player-labels.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
