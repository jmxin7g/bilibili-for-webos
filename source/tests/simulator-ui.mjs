import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Apple TV style navigation in the actual Simulator app: sidebar and exit confirmation, hero and shelves,
// detail page, search keyboard / suggestions / hot searches, settings rows. Playback itself is covered by simulator-smoke.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9226', { noDefaults: true });
const page = browser.contexts()[0].pages().find(page => page.url().match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
assert.ok(page, 'Start the independent app in Simulator with debugging port 9226');
const report = { date: new Date().toISOString(), environment: 'webOS Simulator via CDP', steps: [], result: 'RUNNING' };
const previousProfilePrompt = await page.evaluate(() => localStorage.getItem('test.skipProfilePrompt'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const focus = () => page.evaluate(() => {
  const active = document.activeElement;
  return active.dataset?.page ? `nav:${active.dataset.page}` : (active.id || active.dataset?.bvid || active.tagName);
});
const press = async (key, expected, name) => {
  await page.keyboard.press(key);
  const actual = await focus();
  if (expected instanceof RegExp) assert.match(actual, expected, name);
  else if (expected !== undefined) assert.equal(actual, expected, name);
  report.steps.push({ name, key, focus: actual });
  return actual;
};
try {
  await page.evaluate(() => localStorage.setItem('test.skipProfilePrompt', '1'));
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible', 'Bring Simulator to the foreground');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#recommend-grid .video-card').length > 0 && document.querySelectorAll('#video-grid .video-card').length > 0, null, { polling: 100, timeout: 60000 });
  await wait(500);

  // Hero and sidebar.
  assert.equal(await focus(), 'hero-play', 'initial focus is the hero play button');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#sidebar')).opacity), '0', 'sidebar hidden while browsing');
  // Up stays on the hero; Back opens the sidebar.
  // Left on Play of the first featured item opens the sidebar; Right returns to Play (paging: simulator-hero-keys).
  await page.evaluate(() => { heroIndex = 0; showHero(heroItems[0]); markHeroDot(); heroPlay.focus({ preventScroll: true }); });
  await page.keyboard.press('ArrowLeft'); await wait(500);
  assert.equal(await focus(), 'nav:browse', 'left on play of the first item opens the sidebar');
  assert.equal(await page.evaluate(() => heroIndex), 0, 'opening the sidebar keeps the featured item');
  await page.keyboard.press('ArrowRight'); await wait(500);
  assert.equal(await focus(), 'hero-play', 'right returns to play');
  await press('ArrowUp', 'hero-play', 'up stays on hero');
  await press('Escape', 'nav:browse', 'back opens sidebar');
  await press('ArrowUp', 'nav:search', 'sidebar up');
  await press('ArrowDown', 'nav:browse', 'sidebar down');
  await press('Escape', 'exit-cancel', 'back on sidebar asks before exiting');
  assert.equal(await page.evaluate(() => document.querySelector('#exit-dialog').open), true);
  await press('ArrowRight', 'exit-confirm', 'exit dialog right');
  await press('Escape', 'nav:browse', 'back cancels exit');
  assert.equal(await page.evaluate(() => document.querySelector('#exit-dialog').open), false);
  await press('ArrowRight', 'hero-play', 'right closes sidebar');
  assert.equal(await page.locator('#nav-pill .chevron').count(), 0);
  assert.equal(await page.locator('#hero-next').count(), 0);
  assert.equal(await page.locator('#hero-info').count(), 0);
  assert.equal(await page.locator('#recommend-refresh').count(), 0);
  const hasLater = await page.locator('#hero-later').isVisible();
  const lastAction = hasLater ? 'hero-later' : 'hero-play';
  await press('ArrowRight', lastAction, 'hero buttons');
  const lastActionIndex = await page.evaluate(() => heroIndex);
  await press('ArrowRight', lastAction, 'right past the last hero button keeps that button focused');
  await wait(500);
  const heroCount = await page.evaluate(() => heroItems.length);
  assert.equal(await page.evaluate(() => heroIndex), heroCount > 1 ? (lastActionIndex + 1) % heroCount : lastActionIndex, 'right past the last button pages to the next featured item');
  await press('ArrowLeft', 'hero-play', 'hero buttons back');
  await page.evaluate(() => document.querySelector('#hero-play').focus());
  // Up from 搜索 reaches the sidebar profile (Apple TV's profile switcher); Down returns.
  await press('Escape', 'nav:browse', 'back opens sidebar again');
  await press('ArrowUp', 'nav:search', 'sidebar up to search');
  await press('ArrowUp', 'nav-profile', 'sidebar up to profile');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#profile-picker').open && document.activeElement.classList.contains('profile-choice'), null, { polling: 100, timeout: 10000 });
  report.steps.push({ name: 'profile opens the picker', key: 'Enter', focus: await focus() });
  assert.equal(await page.evaluate(() => document.querySelector('#profile-picker').open && document.activeElement.classList.contains('profile-choice')), true, 'picker focuses a profile');
  await page.keyboard.press('Escape');
  await wait(300);
  assert.equal(await page.evaluate(() => document.querySelector('#profile-picker').open), false, 'Back closes the picker');
  assert.equal(await focus(), 'nav-profile', 'focus returns to the profile');
  await press('ArrowDown', 'nav:search', 'profile down to search');
  await page.locator('.nav-item[data-page="browse"]').focus(); await page.evaluate(name => showPage(name), 'browse');
  await page.evaluate(() => document.querySelector('#hero-play').focus());

  // Shelves and detail page.
  const rows = await page.evaluate(() => visibleRows().map(row => row.id));
  for (const row of rows) {
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), row, `down reaches ${row}`);
  }
  for (let i = 0; i < rows.length; i++) await page.keyboard.press('ArrowUp');
  assert.equal(await focus(), 'hero-play', 'up from the first shelf returns to the hero');
  while (await page.evaluate(() => document.activeElement.parentElement?.id !== 'recommend-grid')) await page.keyboard.press('ArrowDown');
  const card = await focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#detail').hidden && document.activeElement.id === 'detail-play', null, { polling: 100, timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('#detail-related .video-card').length > 0, null, { polling: 100, timeout: 20000 });
  report.steps.push({ name: 'detail opened', title: await page.locator('#detail-title').textContent() });
  // A multi-part video has its 分集 row (buttons carrying data-page) between the buttons and the related shelf.
  const below = await press('ArrowDown', /^(BV|nav:\d+)/, 'detail down to parts or related');
  if (below.startsWith('nav:')) await press('ArrowDown', /^BV/, 'parts down to related');
  await press('ArrowUp', below.startsWith('nav:') ? /^nav:\d+$/ : 'detail-play', 'up from related');
  if (below.startsWith('nav:')) await press('ArrowUp', 'detail-play', 'parts up to play');
  await press('Escape', card, 'back returns to the original card');
  assert.equal(await page.evaluate(() => document.querySelector('#detail').hidden), true);

  // Search (Apple TV layout): entering lands on the on-screen keyboard; a typed letter brings suggestion pills,
  // reached with Right from the last key column; clearing brings back hot searches; Up leads to the query line.
  await page.locator('.nav-item[data-page="search"]').focus(); await page.evaluate(name => showPage(name), 'search');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.char), 'a', 'search page starts on the keyboard');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => searchInput.value), 'a', 'OK on a key types it');
  const suggested = await page.waitForFunction(() => !document.querySelector('#search-suggest').hidden, null, { polling: 100, timeout: 15000 }).then(() => true, () => false);
  if (suggested) {
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('suggestion')), true, 'Right from the last key column reaches the suggestions');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.char), 'f', 'Left from the first suggestion returns to the keyboard');
  } else report.steps.push({ name: 'suggestions unavailable', skipped: true });
  await page.evaluate(() => document.querySelector('#search-keys [data-action="clear"]').click());
  await wait(300);
  if (await page.evaluate(() => !document.querySelector('#search-trending').hidden)) {
    await page.evaluate(() => keyboardTarget().focus());
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('#trending-list')), true, 'with an empty query Right reaches hot searches');
    await page.keyboard.press('ArrowLeft');
  } else report.steps.push({ name: 'hot searches unavailable', skipped: true });
  for (let i = 0; i < 8 && await focus() !== 'search-field'; i++) await page.keyboard.press('ArrowUp');
  assert.equal(await focus(), 'search-field', 'Up from the keyboard reaches the query line');

  // Regressions found with the Simulator's own remote panel (real key path, including Back = 461).
  const rcu = browser.contexts()[0].pages().find(page => page.url().includes('/screen/rcu/'));
  assert.ok(rcu, 'Simulator remote panel page not found');
  const rcuPress = async key => { await rcu.locator(`[data-testid="buttonRCU-${key}"]`).click(); await wait(700); };
  // 1. Apple TV sidebar: moving the highlight does not switch the page; OK does (real remote-panel keys).
  await page.locator('.nav-item[data-page="browse"]').focus(); await page.evaluate(name => showPage(name), 'browse');
  await rcuPress('ArrowDown');
  const moved = await page.evaluate(() => ({ focus: document.activeElement.dataset.page, page: activePage }));
  report.steps.push({ name: 'sidebar highlight moves without switching', ...moved });
  assert.deepEqual(moved, { focus: 'popular', page: 'browse' }, 'moving in the sidebar keeps the current page');
  await rcuPress('Enter');
  assert.equal(await page.evaluate(() => activePage), 'popular', 'OK switches to the highlighted page');
  // Remote-panel Back leaves the detail page for the original card.
  // Entering 推荐 restores the last selected card, so start from the hero explicitly.
  await page.locator('.nav-item[data-page="browse"]').focus(); await page.evaluate(name => showPage(name), 'browse');
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#hero-play').focus({ preventScroll: true }); });
  await rcuPress('ArrowDown');
  while (await page.evaluate(() => document.activeElement.parentElement?.id !== 'recommend-grid')) await rcuPress('ArrowDown');
  const rcuCard = await focus();
  await rcuPress('Enter');
  assert.equal(await page.evaluate(() => !document.querySelector('#detail').hidden), true, 'remote Enter opens detail');
  await rcuPress('Back');
  assert.equal(await focus(), rcuCard, 'remote Back returns to the original card');
  report.steps.push({ name: 'remote panel Back', card: rcuCard });

  // A video without a cover keeps a 16:9 placeholder instead of collapsing the artwork.
  const placeholder = await page.evaluate(() => {
    const card = videoCard({ bvid: 'BV1placehold', title: '无封面', owner: '', duration: 1, cover: '' }, '');
    document.querySelector('#recommend-grid').append(card);
    const art = card.querySelector('.art').getBoundingClientRect();
    card.remove();
    return { width: Math.round(art.width), height: Math.round(art.height) };
  });
  report.steps.push({ name: 'missing cover placeholder', ...placeholder });
  assert.ok(placeholder.height > 0 && Math.abs(placeholder.width / placeholder.height - 16 / 9) < 0.05, 'missing cover keeps a 16:9 placeholder');

  // Account library entries (关注更新 / 稍后再看 / 观看历史 / 收藏夹 replace 我的): logged in, 关注更新 shows only its
  // own grid, Right enters it and Left from the first column returns to the sidebar; logged out, the page
  // offers the way to the login.
  await page.locator('.nav-item[data-page="following"]').focus(); await page.evaluate(name => showPage(name), 'following');
  await page.waitForFunction(() => !/正在加载/.test(document.querySelector('#library-status').textContent), null, { polling: 100, timeout: 30000 });
  const library = await page.evaluate(() => ({ loggedIn: !document.querySelector('#logout').hidden, rows: ['following-row', 'later-row', 'cloud-history-row', 'folder-row', 'favorite-row'].filter(id => document.getElementById(id).children.length).length, current: document.querySelector('.library-content > .shelf.current')?.id, login: !document.querySelector('#library-login').hidden }));
  report.steps.push({ name: 'library entries', ...library });
  await page.keyboard.press('ArrowRight');
  if (library.loggedIn) {
    assert.ok(library.rows > 0, 'library shows rows when logged in');
    assert.equal(library.current, 'following-shelf', '关注更新 shows the following shelf');
    assert.ok(await page.evaluate(() => !!document.activeElement.closest('#following-row')), 'Right enters the following grid');
    const firstCard = await focus();
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150);
    await press('Shift', 'nav:following', 'Left at the library boundary opens the sidebar');
    await press('ArrowRight', firstCard, 'Right from the sidebar returns to the same card');
    await press('Escape', 'nav:following', 'Back from the library opens the sidebar');
  } else {
    assert.equal(library.login, true, 'library offers login when logged out');
    assert.equal(await focus(), 'library-login');
  }

  // 分区: Right reaches the category pills, Down the grid, Up back to the selected pill.
  await page.locator('.nav-item[data-page="regions"]').focus(); await page.evaluate(name => showPage(name), 'regions');
  await page.waitForFunction(() => document.querySelector('#region-grid').getAttribute('aria-busy') !== 'true' && (document.querySelector('#region-grid .video-card') || !document.querySelector('#region-retry').hidden), null, { polling: 100, timeout: 30000 });
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.evaluate(() => document.activeElement.parentElement.id === 'region-tabs'), 'Right reaches the category pills');
  if (await page.evaluate(() => document.querySelector('#region-grid').children.length > 0)) {
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), 'region-grid', 'Down reaches the category grid');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-pressed')), 'true', 'Up returns to the selected category');
  } else report.steps.push({ name: '分区 grid unavailable', skipped: true });

  // Settings rows: Up/Down never change the quality; Left returns to the sidebar.
  const quality = await page.evaluate(() => document.querySelector('#quality').value);
  await page.locator('.nav-item[data-page="settings"]').focus(); await page.evaluate(name => showPage(name), 'settings');
  // Logged out the first row is 扫码登录; logged in it is a saved-account row, then 添加账号 and 退出当前账号.
  let row = await press('ArrowRight', /^(login|BUTTON)$/, 'settings first row');
  for (let i = 0; i < 8 && row !== 'quality'; i++) row = await press('ArrowDown', /^(BUTTON|add-account|logout|quality)$/, 'down through account rows');
  assert.equal(row, 'quality', 'down to quality');
  await press('ArrowDown', 'BUTTON', 'down past quality');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.setting), 'autoplay', 'below 默认画质 is 自动连播');
  // An option row steps through its values with OK and shows the value; a second OK restores it.
  const before = await page.evaluate(() => document.activeElement.querySelector('.value').textContent);
  await page.keyboard.press('Enter');
  assert.notEqual(await page.evaluate(() => document.activeElement.querySelector('.value').textContent), before, 'OK changes 自动连播');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.querySelector('.value').textContent), before, 'second OK restores it');
  await press('ArrowUp', 'quality', 'up to quality');
  assert.equal(await page.evaluate(() => document.querySelector('#quality').value), quality, 'moving rows keeps the quality');
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150);
  await press('Shift', 'nav:settings', 'left at settings boundary opens the sidebar');
  assert.equal(await page.evaluate(() => document.querySelector('#quality').value), quality, 'Left does not change the quality');
  await press('ArrowRight', 'quality', 'right from the sidebar returns to the row');
  await press('Escape', 'nav:settings', 'back returns to sidebar');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error.message.split('\n')[0];
  throw error;
} finally {
  await page.evaluate(value => {
    if (value === null) localStorage.removeItem('test.skipProfilePrompt');
    else localStorage.setItem('test.skipProfilePrompt', value);
  }, previousProfilePrompt);
  await page.evaluate(() => { if (document.querySelector('#exit-dialog').open) document.querySelector('#exit-dialog').close(); });
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/simulator-ui.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, steps: report.steps.length, error: report.error }));
  await browser.close();
}
