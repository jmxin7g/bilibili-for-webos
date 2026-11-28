import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(p => p.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const report = { environment: 'webOS Simulator', fixtureAccounts: true, checks: [] };
const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
try {
 await page.waitForFunction(() => heroItems.length > 1 && window.displayAccount);
 await page.evaluate(() => {
  if (profilePicker.open) profilePicker.close();
  localStorage.setItem('test.skipProfilePrompt', '1');
  heroPreview.stop();
  const seed = heroItems[0];
  window.accountTestSeed = seed;
  window.serviceRequest = async path => {
   if (path === '/auth/accounts') return { accounts: [] };
   if (path === '/me/later') return { items: [] };
   if (path.startsWith('/recommend?')) return { items: Array.from({length: 8}, (_, i) => ({...seed, bvid: `sim-account-${i}`, title: `测试推荐 ${i}`})) };
   throw new Error(`Unexpected fixture request: ${path}`);
  };
  for (const [mid, position] of [['sim-A', 30], ['sim-B', 70]]) {
   localStorage.setItem(`history:${mid}`, JSON.stringify([{...seed, position}]));
   localStorage.setItem(`progress:${mid}:${seed.bvid}`, String(position));
  }
 });
 for (const [mid, position] of [['sim-A', 30], ['sim-B', 70], ['sim-A', 30]]) {
  const actual = await page.evaluate(({mid}) => {
   displayAccount({loggedIn:true,mid,name:mid});
   return { count:historyRow.children.length, position:readHistory()[0].position, progress:Number(localStorage.getItem(progressKey(accountTestSeed.bvid))), card:historyRow.firstElementChild.dataset.bvid };
  }, {mid});
  assert.equal(actual.count,1); assert.equal(actual.position,position); assert.equal(actual.progress,position);
  report.checks.push({mid,...actual});
 }
 await page.evaluate(() => displayAccount({loggedIn:false}));
 assert.equal(await page.evaluate(() => historyRow.children.length),0);
 report.checks.push({guest:'empty'});
 await page.waitForFunction(() => heroItems.length > 1);
 await page.evaluate(() => { showPage('browse'); window.scrollTo(0,0); heroPlay.focus(); });
 assert.equal(await page.locator('#recommend-refresh').count(),0);
 assert.equal(await page.locator('#hero-next').count(),0);
 assert.equal(await page.locator('#nav-pill .chevron').count(),0);
 assert.equal(await page.evaluate(() => document.activeElement.id),'hero-play');
 await mkdir('output/playwright',{recursive:true});
 await page.screenshot({path:'output/playwright/simulator-account-progress.png'});
 report.checks.push({focus:'hero-play',arrowsRemoved:true,refreshRemoved:true});
 report.result='PASS';
} finally {
 await page.evaluate(saved => {localStorage.clear();for(const [key,value] of Object.entries(saved)) localStorage.setItem(key,value);},saved);
 await page.reload();
 await mkdir('output/playwright',{recursive:true});
 await writeFile('output/playwright/simulator-account-progress.json',JSON.stringify(report,null,2));
 await browser.close();
}
console.log(JSON.stringify(report));
