// Leaving the app pauses playback and saves the position; returning keeps it paused.
// A: real Home key on the Simulator remote, then reopen the app from the Simulator's App List.
// B: a video that starts while the page is hidden is paused at once (visibility injected, because the
//    Simulator freezes background apps and the late-load timing cannot be produced for real).
// Run it DIRECTLY (node tests/simulator-background.mjs), not through tools/simulator-test.mjs: that runner turns on
// CDP focus emulation, which keeps the page "visible" after Home, so visibilitychange never fires and the Simulator
// pauses/resumes the media itself. This script does its own profile-prompt and localStorage restore.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const pages = browser.contexts()[0].pages();
const app = pages.find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const rcu = pages.find(p => p.url().includes('/screen/rcu/'));
const appList = pages.find(p => p.url().includes('/screen/appList/'));
const BV = 'BV1fwEwzeEPp';
const report = { date: new Date().toISOString(), result: 'RUNNING' };
const front = () => { try { execFileSync('open', ['-a', '/Applications/webOS_TV_26_Simulator_1.5.0.app']); } catch {} };
front();
const previousQuality = await app.evaluate(() => quality.value);
const savedKeys = await app.evaluate(() => Object.fromEntries(Object.keys(localStorage)
  .filter(k => k.startsWith('history') || k.startsWith('progress:')).map(k => [k, localStorage.getItem(k)])));
await app.evaluate(() => { if (profilePicker.open) profilePicker.close(); });
const state = () => app.evaluate(bv => ({ visible: document.visibilityState, playerOpen: !player.hidden, paused: video.paused, time: video.currentTime, saved: Number(localStorage.getItem(progressKey(bv))), controls: !overlay.hidden }), BV);
try {
  front();
  await app.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 10000 });
  await app.evaluate(bv => { quality.value = '360'; input.value = bv; start.click(); }, BV);
  await app.waitForFunction(() => !player.hidden && !video.paused && video.readyState >= 3 && video.currentTime > 3, null, { timeout: 60000 });

  // A. Home while playing.
  const before = await state();
  await rcu.locator('[data-testid="buttonRCU-Home"]').click();
  await new Promise(resolve => setTimeout(resolve, 3000));
  // Reopen from the Simulator App List: pick the entry whose React appInfo.appPath is this app's folder (the dev
  // app and the built app share id and title, and the list's contents vary with how the Simulator started).
  const appFolder = decodeURIComponent(new URL('.', app.url()).pathname).replace(/\/$/, '');
  const reopened = await appList.evaluate(folder => {
    for (const entry of document.querySelectorAll('main section:last-child > div')) {
      let fiber = entry[Object.keys(entry).find(key => key.startsWith('__reactFiber'))];
      while (fiber && !fiber.memoizedProps?.appInfo) fiber = fiber.return;
      if (fiber?.memoizedProps.appInfo.appPath?.replace(/\/$/, '') === folder) { entry.click(); return folder; }
    }
    return null;
  }, appFolder);
  assert.ok(reopened, 'running app found in the Simulator App List');
  front();
  await app.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 15000 });
  report.home = { before, after: await state() };
  assert.equal(report.home.after.playerOpen, true, 'player still open after returning');
  assert.equal(report.home.after.paused, true, 'playback paused while away');
  assert.ok(report.home.after.time - before.time < 1.5, 'media did not keep playing in the background');
  assert.ok(Math.abs(report.home.after.saved - report.home.after.time) < 0.5, 'position saved when leaving');
  assert.equal(report.home.after.controls, true, 'controls shown on return');
  await new Promise(resolve => setTimeout(resolve, 3000));
  assert.equal(await app.evaluate(() => video.paused), true, 'stays paused after return');
  report.homeStaysPaused = true;
  // The new handler pauses any playback that starts while the page is hidden, so make sure the window is in front.
  front();
  await app.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 10000 });
  // Resume as the viewer does: OK on the play/pause button (a key press releases the background hold).
  await app.locator('#toggle').focus();
  await app.keyboard.press('Enter');
  await app.waitForFunction(t => !video.paused && video.currentTime > t + 1, report.home.after.time, { timeout: 15000 });
  report.resumesWithPlay = true;
  await app.evaluate(() => leavePlayer());

  // B. Playback that starts while hidden is paused immediately.
  await app.evaluate(bv => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    window.__backgroundPlaying = 0;
    video.addEventListener('playing', () => { window.__backgroundPlaying++; }, { once: true });
    input.value = bv; start.click();
  }, BV);
  await app.waitForFunction(() => window.__backgroundPlaying > 0, null, { timeout: 60000 });
  await new Promise(resolve => setTimeout(resolve, 1500));
  report.hiddenStart = await app.evaluate(() => ({ paused: video.paused, time: video.currentTime }));
  await app.evaluate(() => { delete document.visibilityState; });
  assert.equal(report.hiddenStart.paused, true, 'playback that starts while hidden is paused');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.message.split('\n')[0]; throw error;
} finally {
  front();
  await app.evaluate(async ([q, keys]) => {
    delete document.visibilityState;
    if (!player.hidden) await leavePlayer();
    quality.value = q; quality.dispatchEvent(new Event('change'));
    for (const k of Object.keys(localStorage)) if ((k.startsWith('history') || k.startsWith('progress:')) && !(k in keys)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v);
  }, [previousQuality, savedKeys]).catch(e => { report.restoreError = e.message; });
  report.stateRestored = !report.restoreError;
  await writeFile('output/playwright/simulator-background.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
