import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const start = source.indexOf('let upEntry =');
const end = source.indexOf('// 分区:', start);

function harness(serviceRequest) {
  const nodes = Object.fromEntries(['#up-name', '#up-meta', '#up-sign', '#up-face'].map(id => [id, { textContent: '', removeAttribute() {} }]));
  const document = { activeElement: null, querySelector: id => nodes[id] };
  const focusable = () => ({
    focus() { document.activeElement = this; },
    scrollIntoView() {},
  });
  const upStatus = { textContent: 'Previous status' };
  const upRetry = { ...focusable(), hidden: true, addEventListener(_, cb) { this.click = cb; } };
  const upGrid = {
    children: [],
    replaceChildren(...items) { this.children = items; },
    append(...items) { this.children.push(...items); },
    get firstElementChild() { return this.children[0]; },
    get lastElementChild() { return this.children.at(-1); },
  };
  const upPage = { ...focusable(), scrollTop: 0 };
  const context = vm.createContext({
    document, upGrid, upStatus, upPage, upRetry, serviceRequest, clock: () => '',
    videoCard: item => ({ ...focusable(), dataset: { bvid: item.bvid } }),
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, document, upGrid, upStatus, upRetry, upPage };
}

function entry(mid = '123') {
  return { up: mid, page: 0, more: true, items: [], profile: null, error: '', loading: false };
}

const profile = { name: 'UP', sign: '', fans: 12, videos: 1 };

for (const outcome of ['videos', 'empty', 'error']) {
  test(`UP page has no loading text and preserves ${outcome} feedback`, async () => {
    let resolve, reject;
    const request = new Promise((res, rej) => { resolve = res; reject = rej; });
    const { context, upGrid, upStatus, upRetry, document } = harness(() => request);
    const shown = context.showUp(entry());
    try {
      assert.equal(upStatus.textContent, '', 'opening an avatar must not flash loading text');
    } finally {
      if (outcome === 'error') reject(new Error('network failure'));
      else resolve({ more: false, items: outcome === 'videos' ? [{ bvid: 'video' }] : [], profile });
      await shown;
    }
    assert.equal(upStatus.textContent, outcome === 'error' ? 'UP 主页面加载失败：network failure' : outcome === 'empty' ? '这位 UP 主还没有公开视频' : '');
    assert.equal(upGrid.children.length, outcome === 'videos' ? 1 : 0);
    assert.equal(upRetry.hidden, outcome !== 'error');
    if (outcome === 'error') assert.equal(document.activeElement, upRetry);
  });
}

test('returning from details restores cached UP pages, scroll and the same card', async () => {
  const requests = [];
  const h = harness(async path => {
    requests.push(path);
    return { profile, more: true, items: [{ bvid: `video-${requests.length}` }] };
  });
  const author = entry();
  await h.context.showUp(author);
  await h.context.loadUpPage(author);
  await h.context.loadUpPage(author);
  author.focusBvid = 'video-2';
  author.scrollTop = 480;
  vm.runInContext('upEntry = null', h.context);
  await h.context.showUp(author);
  assert.equal(requests.length, 3);
  assert.equal(h.upGrid.children.length, 3);
  assert.equal(h.upPage.scrollTop, 480);
  assert.equal(h.document.activeElement.dataset.bvid, 'video-2');
  await h.context.loadUpPage(author);
  assert.equal(requests.at(-1), '/up?mid=123&page=4');
});

test('UP retry after a pagination failure requests the same page and moves focus to new content', async () => {
  const requests = [];
  const h = harness(async path => {
    requests.push(path);
    if (requests.length === 2) throw new Error('network failure');
    return { profile, more: true, items: [{ bvid: `video-${requests.length}` }] };
  });
  const author = entry();
  await h.context.showUp(author);
  await h.context.loadUpPage(author);
  h.context.upKeys({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(h.document.activeElement, h.upRetry);
  await h.upRetry.click();
  assert.deepEqual(requests, ['/up?mid=123&page=1', '/up?mid=123&page=2', '/up?mid=123&page=2']);
  assert.equal(h.upRetry.hidden, true);
  assert.equal(h.document.activeElement.dataset.bvid, 'video-3');
});

test('an in-flight UP page is reused on return without updating a different overlay', async () => {
  let finish;
  const requests = [];
  const h = harness(path => {
    requests.push(path);
    if (path.includes('page=2')) return new Promise(resolve => { finish = resolve; });
    return Promise.resolve({ profile, more: true, items: [{ bvid: path }] });
  });
  const author = entry();
  await h.context.showUp(author);
  const pending = h.context.loadUpPage(author);
  await h.context.showUp(entry('456'));
  const otherCard = h.document.activeElement;
  finish({ more: false, items: [{ bvid: 'cached-page-2' }] });
  await pending;
  assert.equal(h.upGrid.children.length, 1);
  assert.equal(h.document.activeElement, otherCard);
  await h.context.showUp(author);
  assert.equal(requests.length, 3);
  assert.equal(h.upGrid.children.length, 2);
  assert.equal(h.upGrid.lastElementChild.dataset.bvid, 'cached-page-2');
});
