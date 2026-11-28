import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
assert.ok(page);
const saved = await page.evaluate(() => localStorage.getItem('danmaku'));
const report = { date: new Date().toISOString(), environment: 'webOS TV 26 Simulator on Mac', samples: [] };
try {
  await page.reload();
  await page.waitForFunction(() => window.showPage && document.querySelector('#startup-screen').hidden, null, { timeout: 60000 });
  await page.evaluate(() => { showPage('settings'); quality.value = '360'; input.value = 'BV1fwEwzeEPp'; quality.focus(); localStorage.removeItem('danmaku'); start.click(); });
  await page.waitForFunction(() => !player.hidden && video.readyState >= 3 && !video.paused, null, { timeout: 60000 });
  report.commentSource = 'synthetic timing fixture through existing spawnDanmaku; live endpoint HTTP 412';
  await page.evaluate(() => { const t=video.currentTime; danmakuItems=Array.from({length:240},(_,i)=>({t:t+i*0.15,text:`120Hz 弹幕测试 ${i+1}`,color:0xffffff,mode:1})); resetDanmakuTime(); });
  for (const enabled of [false, true]) {
    await page.evaluate(enabled => { if (enabled) localStorage.removeItem('danmaku'); else localStorage.setItem('danmaku', 'off'); resetDanmakuTime(); }, enabled);
    if (enabled) await page.waitForFunction(() => danmakuLayer.querySelector('.dm:not(.fixed)'), null, { timeout: 15000 });
    const sample = await page.evaluate(() => new Promise(resolve => {
      const intervals = []; let last; let start; let maxComments = 0; let tracked; let previousX; let changed = 0; let observations = 0;
      const mediaStart = video.currentTime; const q0 = video.getVideoPlaybackQuality();
      function frame(t) {
        if (start === undefined) start = t;
        if (last !== undefined) intervals.push(t - last);
        last = t; maxComments = Math.max(maxComments, danmakuLayer.childElementCount);
        const node = danmakuLayer.querySelector('.dm:not(.fixed)');
        if (node) {
          const x = new DOMMatrixReadOnly(getComputedStyle(node).transform).m41;
          if (tracked === node) { observations++; if (x !== previousX) changed++; }
          tracked = node; previousX = x;
        }
        if (t - start < 10000) { requestAnimationFrame(frame); return; }
        const sorted = [...intervals].sort((a,b) => a-b); const q1 = video.getVideoPlaybackQuality();
        resolve({ elapsedMs: t-start, callbacks: intervals.length, rafHz: intervals.length*1000/(t-start), medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*0.95)], intervalsNear120Hz: intervals.filter(dt=>dt>=6&&dt<=11).length, intervalsNear60Hz:intervals.filter(dt=>dt>=13&&dt<=20).length,maxComments,transformObservations:observations,transformChanges:changed,mediaAdvance:video.currentTime-mediaStart,videoFrames:q1.totalVideoFrames-q0.totalVideoFrames,droppedVideoFrames:q1.droppedVideoFrames-q0.droppedVideoFrames,visibility:document.visibilityState });
      }
      requestAnimationFrame(frame);
    }));
    report.samples.push({danmakuEnabled:enabled,...sample});
    console.log(JSON.stringify(report.samples.at(-1)));
  }
  report.result = report.samples[1].rafHz >= 110 ? '120HZ_CADENCE_OBSERVED' : '120HZ_NOT_OBSERVED';
} finally {
  await page.evaluate(value => { if(value===null)localStorage.removeItem('danmaku');else localStorage.setItem('danmaku',value); },saved);
  await writeFile('output/playwright/simulator-danmaku-rate.json',JSON.stringify(report,null,2));
  await browser.close();
}
