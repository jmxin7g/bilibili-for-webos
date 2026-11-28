import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const pages = browser.contexts()[0].pages();
const app = pages.find(page => page.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
assert.ok(app, 'Start the local independent app in Simulator on port 9226');
const sessions = [];
const report = { date: new Date().toISOString(), test: process.argv[2], focusEmulated: true, result: 'RUNNING' };
await app.waitForFunction(() => window.showPage);
const saved = await app.evaluate(() => ({
  quality: quality.value, input: input.value, part: selectedPart,
  keys: Object.fromEntries(Object.keys(localStorage)
    .filter(key => key === 'history' || key.startsWith('history:') || key.startsWith('progress:') || key === 'test.skipProfilePrompt')
    .map(key => [key, localStorage.getItem(key)])),
}));
try {
  for (const page of pages.filter(page => page === app || page.url().includes('/screen/rcu/'))) {
    const session = await page.context().newCDPSession(page);
    sessions.push(session);
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  await app.evaluate(() => {
    localStorage.setItem('test.skipProfilePrompt', '1');
    if (profilePicker.open) profilePicker.close();
  });
  await import(new URL(`../tests/${process.argv[2]}`, import.meta.url));
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error.message;
  throw error;
} finally {
  try {
    await app.evaluate(async saved => {
      if (!player.hidden) await leavePlayer();
      for (const key of Object.keys(localStorage).filter(key => key === 'history' || key.startsWith('history:') || key.startsWith('progress:') || key === 'test.skipProfilePrompt')) localStorage.removeItem(key);
      for (const [key, value] of Object.entries(saved.keys)) localStorage.setItem(key, value);
      quality.value = saved.quality;
      quality.dispatchEvent(new Event('change'));
      input.value = saved.input;
      selectedPart = saved.part;
    }, saved);
    const restored = await app.evaluate(() => ({
      quality: quality.value, input: input.value, part: selectedPart,
      keys: Object.fromEntries(Object.keys(localStorage)
        .filter(key => key === 'history' || key.startsWith('history:') || key.startsWith('progress:') || key === 'test.skipProfilePrompt')
        .map(key => [key, localStorage.getItem(key)])),
    }));
    assert.deepEqual(restored, saved, 'Simulator test must restore playback preferences and progress');
    report.stateRestored = true;
  } catch (error) {
    report.result = 'FAIL';
    report.error = error.message;
    throw error;
  } finally {
    try {
      for (const session of sessions) {
        await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        await session.detach();
      }
      report.focusEmulationCleared = true;
    } catch (error) {
      report.result = 'FAIL';
      report.error = error.message;
      throw error;
    } finally {
      await mkdir('output/playwright', { recursive: true });
      await writeFile(`output/playwright/${process.argv[2].replace('.mjs', '-session.json')}`, JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      await browser.close();
    }
  }
}
