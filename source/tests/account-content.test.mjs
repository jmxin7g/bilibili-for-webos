import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
function harness() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { children: [], hidden: false, textContent: '', attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); }, getAttribute(name) { return this.attributes.get(name); }, replaceChildren(...items) { this.children = items; }, addEventListener() {}, closest() { return this; }, querySelector() { return { textContent: '稍后再看' }; } });
    return elements.get(id);
  }
  const pending = [], handlers = [];
  const context = vm.createContext({ document: { getElementById: element, querySelector: element, querySelectorAll: () => [] }, window: { addEventListener: (name, fn) => handlers.push(fn) }, activePage: 'later', libraryPages: { following: 'following-shelf', later: 'later-shelf', 'cloud-history': 'cloud-history-shelf', favorites: 'favorites-shelf' }, videoCard: item => item, clock: String, mergeLocalHistory() {}, serviceRequest: path => new Promise((resolve, reject) => pending.push({ path, resolve, reject })) });
  const start = source.indexOf('const libraryRows =');
  const end = source.indexOf("document.querySelector('#page-library').addEventListener", start);
  const handlerStart = source.indexOf("window.addEventListener('accountchange', event => {", end);
  const handlerEnd = source.indexOf('\n});', handlerStart) + 4;
  vm.runInContext(source.slice(start, end) + '\n' + source.slice(handlerStart, handlerEnd), context);
  context.window.scrollY = 0;
  context.window.scrollTo = () => {};
  Object.assign(context, { pagePositions: new Map(), navItems: [], pages: [], updateNavPill() {}, setAmbient() {} });
  element('#home').dataset = {};
  const pageStart = source.indexOf('function showPage(name)');
  const pageEnd = source.indexOf('window.showPage =', pageStart);
  vm.runInContext(source.slice(pageStart, pageEnd), context);
  return { context, pending, element, switchAccount: () => handlers[0]({ detail: { changed: true } }) };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const reply = (r, name) => r.resolve({ items: [{ bvid: name }], folders: [], more: false, cursor: null, offset: '' });
test('switch clears old content and loads new account despite pending old requests', async () => {
  const h = harness();
  h.element('later-row').children = [{ bvid: 'old' }];
  const old = h.context.loadLibrary();
  h.switchAccount();
  assert.equal(h.element('later-row').children.length, 0);
  assert.deepEqual(h.pending.map(r => r.path), ['/me/later', '/me/later']);
  assert.equal(h.element('#library-status').getAttribute('aria-busy'), 'true');
  reply(h.pending[1], 'new');
  await settle();
  assert.equal(h.element('later-row').children[0].bvid, 'new');
  assert.equal(h.element('#library-status').getAttribute('aria-busy'), 'false');
  reply(h.pending[0], 'old');
  await old;
  assert.equal(h.element('later-row').children[0].bvid, 'new');
  assert.equal(h.element('#library-status').getAttribute('aria-busy'), 'false');
});
test('old pagination cannot append videos after switching accounts', async () => {
  const h = harness();
  h.context.activePage = 'following';
  const initial = h.context.loadLibrary();
  reply(h.pending[0], 'old');
  await initial;
  vm.runInContext('libraryState.followingMore = true', h.context);
  const more = vm.runInContext('libraryMore(libraryRows[0])', h.context);
  h.switchAccount();
  reply(h.pending[2], 'new');
  await settle();
  reply(h.pending[1], 'old-page2');
  await more;
  assert.deepEqual(Array.from(h.element('following-row').children, x => x.bvid), ['new']);
});
test('switch outside library clears cached rows before the next visit', async () => {
  const h = harness();
  const initial = h.context.loadLibrary();
  reply(h.pending[0], 'old');
  await initial;
  h.context.activePage = 'settings';
  h.switchAccount();
  assert.equal(h.pending.length, 1, 'nothing loads outside the library');
  assert.equal(h.element('later-row').children.length, 0);
  h.context.activePage = 'later';
  const next = h.context.loadLibrary();
  assert.equal(h.pending.length, 2, 'the switched-away list is not reused');
  reply(h.pending[1], 'new');
  await next;
  assert.equal(h.element('later-row').children[0].bvid, 'new');
});
test('old account errors cannot replace the new account status', async () => {
  const h = harness();
  const old = h.context.loadLibrary();
  h.switchAccount();
  reply(h.pending[1], 'new');
  await settle();
  h.pending[0].reject(new Error('旧账号需要登录'));
  await old;
  assert.equal(h.element('#library-status').textContent, '');
  assert.equal(h.element('#library-login').hidden, true);
});

const listPaths = { following: '/me/following', later: '/me/later', 'cloud-history': '/me/history', favorites: '/me/favorites' };
const rowOf = { following: 'following-row', later: 'later-row', 'cloud-history': 'cloud-history-row', favorites: 'folder-row' };
const enter = (h, page) => { h.context.activePage = 'browse'; h.element(`${page}-shelf`).querySelector = () => ({ src: '' }); h.context.showPage(page); };
for (const page of ['following', 'later', 'cloud-history', 'favorites']) {
  test(`entering ${page} requests only its own list`, () => {
    const h = harness();
    enter(h, page);
    assert.deepEqual(h.pending.map(r => r.path), [listPaths[page]]);
  });
  test(`reentering ${page} within a minute reuses the list; later it requests current content`, async () => {
    const h = harness();
    enter(h, page);
    reply(h.pending[0], 'old');
    await settle();
    enter(h, page);
    assert.equal(h.pending.length, 1, 'a fresh list is not requested again');
    vm.runInContext(`libraryState.loadedAt[libraryKeys['${page}']] = Date.now() - 61000`, h.context);
    enter(h, page);
    assert.deepEqual(h.pending.slice(1).map(r => r.path), [listPaths[page]], 'an older list is requested again');
    if (page === 'favorites') h.pending[1].resolve({ folders: [] });
    else reply(h.pending[1], 'updated');
    await settle();
    const first = h.element(rowOf[page]).children[0];
    if (page !== 'favorites') assert.equal(first.bvid, 'updated');
  });
  test(`a stale ${page} list reloads on the next entry`, async () => {
    const h = harness();
    enter(h, page);
    reply(h.pending[0], 'old');
    await settle();
    vm.runInContext(`markLibraryStale(libraryKeys['${page}'])`, h.context);
    enter(h, page);
    assert.equal(h.pending.length, 2);
  });
}

test('refresh supersedes pending loads and pagination from the same account', async () => {
  const h = harness();
  h.context.activePage = 'following';
  const old = h.context.loadLibrary();
  const fresh = h.context.loadLibrary(true);
  reply(h.pending[1], 'fresh');
  await fresh;
  reply(h.pending[0], 'stale');
  await old;
  assert.equal(h.element('following-row').children[0].bvid, 'fresh');
  vm.runInContext('libraryState.followingMore = true', h.context);
  const more = vm.runInContext('libraryMore(libraryRows[0])', h.context);
  const refresh = h.context.loadLibrary(true);
  reply(h.pending[3], 'latest');
  await refresh;
  reply(h.pending[2], 'stale-page2');
  await more;
  assert.deepEqual(Array.from(h.element('following-row').children, x => x.bvid), ['latest']);
});
test('refresh clears videos from a favorite folder that no longer exists', async () => {
  const h = harness();
  h.context.activePage = 'favorites';
  h.element('favorite-row').children = [{ bvid: 'deleted-favorite' }];
  vm.runInContext('libraryState.folder = 123; libraryState.favoriteMore = true', h.context);
  const refresh = h.context.loadLibrary(true);
  h.pending.forEach(r => reply(r, 'fresh'));
  await refresh;
  assert.equal(h.element('favorite-row').children.length, 0);
  assert.equal(vm.runInContext('libraryState.folder', h.context), null);
  assert.equal(vm.runInContext('libraryState.favoriteMore', h.context), false);
});

test('history page shows platform records without prepending device playback history', async () => {
  const h = harness();
  const row = h.element('cloud-history-row');
  row.querySelectorAll = () => [];
  row.querySelector = () => null;
  row.prepend = (...cards) => row.children.unshift(...cards);
  Object.assign(h.context, {
    readHistory: () => [{ bvid: 'device-only' }],
    historyCard: item => ({ ...item, dataset: { bvid: item.bvid } }),
    historyRow: h.element('history-row'),
  });
  const start = source.indexOf('function renderHistory()');
  const end = source.indexOf('\nrenderHistory();', start);
  delete h.context.mergeLocalHistory;
  vm.runInContext(source.slice(start, end), h.context);
  h.context.activePage = 'cloud-history';
  const load = h.context.loadLibrary();
  h.pending.forEach(r => reply(r, 'platform-latest'));
  await load;
  assert.deepEqual(Array.from(row.children, c => c.bvid), ['platform-latest']);
});
