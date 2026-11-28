import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signWbi } from '../wbi.mjs';

const img = '7cd084941338484aae1ad9425b84077c';
const sub = '4932caff0ff746eab6f01bf08b70ac45';
test('WBI matches the published protocol vector', () => {
  assert.equal(signWbi(new URLSearchParams({ foo:'114', bar:'514', zab:'1919810' }), img, sub, 1702204169), 'bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
});
test('Chinese, spaces and protocol-filtered characters are encoded consistently', () => {
  const query = signWbi(new URLSearchParams({ keyword:"五一四 !'()*", page:'2' }), img, sub, 1702204169);
  assert.match(query, /^keyword=%E4%BA%94%E4%B8%80%E5%9B%9B%20&page=2&wts=1702204169&w_rid=[0-9a-f]{32}$/);
  assert.equal(query, signWbi(new URLSearchParams({ page:'2', keyword:'五一四 ' }), img, sub, 1702204169));
});
