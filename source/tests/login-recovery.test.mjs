import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const auth = readFileSync(new URL('../app/auth.js', import.meta.url), 'utf8');
const qr = { size: 21, matrix: '1' + '0'.repeat(440), id: 'fixture' };
function harness() {
 const pending=[], draws=[], canvasContext={fillRect(...rect) { draws.push([this.fillStyle, ...rect]); }};
 const image={parentElement:{dataset:{}}, getContext: () => canvasContext}, status={};
 const context=vm.createContext({loginGeneration:0,loginTimer:null,loginController:null,AbortController,qrImage:image,qrStatus:status,clearTimeout(){},setTimeout(){},serviceRequest:(_path,_method,signal)=>new Promise((resolve,reject)=>pending.push({resolve,reject,signal}))});
 vm.runInContext(auth.slice(auth.indexOf('function drawLoginQr('),auth.indexOf('// One page for signing')),context);
 return {context,pending,image,status,draws};
}
test('QR failure stops spinner and retry displays QR',async()=>{
 const h=harness(), first=h.context.generateQr();
 h.pending[0].reject(new Error('offline'));await first;
 assert.equal(h.image.parentElement.dataset.state,'error');
 assert.match(h.status.textContent,/二维码生成失败/);
 const retry=h.context.generateQr();h.pending[1].resolve(qr);await retry;
 assert.equal(h.image.hidden,false);assert.equal(h.image.parentElement.dataset.state,'ready');
 assert.deepEqual(h.draws, [['#fff', 0, 0, 232, 232], ['#000', 32, 32, 8, 8]]);
});
test('old QR error cannot overwrite refreshed QR',async()=>{
 const h=harness(),old=h.context.generateQr(),fresh=h.context.generateQr();
 assert.equal(h.pending[0].signal.aborted,true);
 h.pending[1].resolve(qr);await fresh;
 h.pending[0].reject(new Error('old'));await old;
 assert.equal(h.draws.length, 2);assert.equal(h.image.parentElement.dataset.state,'ready');
});

test('malformed QR data never becomes visible', async () => {
 const h = harness(), request = h.context.generateQr();
 h.pending[0].resolve({ ...qr, matrix: 'invalid' });
 await request;
 assert.equal(h.image.hidden, true);
 assert.equal(h.image.parentElement.dataset.state, 'error');
 assert.equal(h.draws.length, 0);
});

function serviceHarness(window, options) {
  const context = vm.createContext({ window: { addEventListener() {}, ...window }, AbortSignal, setTimeout, clearTimeout, ...options });
  vm.runInContext(auth.slice(auth.indexOf('let tvConnection;'), auth.indexOf('function displayAccount(')), context);
  return context.window;
}

test('refresh reconnects after a failed Luna handshake and a stale token', async () => {
  let handshakes = 0;
  let cancellations = 0;
  const tokens = [];
  const window = serviceHarness({ tvService: true }, {
    webOS: { service: { request(_url, callbacks) {
      const number = ++handshakes;
      if (number === 1) callbacks.onFailure({ errorText: 'fixture' });
      else callbacks.onSuccess({ base: 'http://127.0.0.1:8770', token: `fixture-${number}` });
      return { cancel() { cancellations++; } };
    } } },
    fetch: async (_url, { headers }) => {
      const token = headers['X-Prototype-Token'];
      tokens.push(token);
      if (token === 'fixture-2') return { ok: false, status: 403 };
      return { ok: true, json: async () => ({ id: 'qr' }) };
    },
  });
  await assert.rejects(window.serviceRequest('/auth/qr', 'POST'), /启动失败/);
  assert.deepEqual(await window.serviceRequest('/auth/qr', 'POST'), { id: 'qr' });
  assert.deepEqual(tokens, ['fixture-2', 'fixture-3']);
  assert.equal(cancellations, 2);
});

test('refresh reloads local credentials after the development service restarts', async () => {
  const tokens = [];
  const window = serviceHarness({ serviceToken: 'stale' }, {
    document: {
      createElement: () => ({ remove() {} }),
      head: { append(script) { window.serviceToken = 'current'; script.onload(); } },
    },
    fetch: async (_url, { headers }) => {
      const token = headers['X-Prototype-Token'];
      tokens.push(token);
      if (token === 'stale') return { ok: false, status: 403 };
      return { ok: true, json: async () => ({ id: 'qr' }) };
    },
  });
  assert.deepEqual(await window.serviceRequest('/auth/qr', 'POST'), { id: 'qr' });
  assert.deepEqual(tokens, ['stale', 'current']);
});
const source=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
test('bind failure does not publish new credentials',async()=>{
 for(const fail of [true,false]){
  const writes=[];let errorHandler;
  const context=vm.createContext({URL,port:8769,lanHost:undefined,television:false,hosts:['127.0.0.1:8769'],serviceToken:'fixture',console:{log(){}},writeFile:async(...args)=>writes.push(args),server:{once:(_,fn)=>errorHandler=fn,close(){},listen:(_,__,fn)=>{if(fail)errorHandler(new Error('EPERM'));else fn();}}});
  vm.runInContext(source.slice(source.indexOf('export const ready ='),source.indexOf('export { serviceToken }')).replace('export const ready =','globalThis.ready =').replaceAll('import.meta.url',"'file:///tmp/test/server.mjs'"),context);
  if(fail)await assert.rejects(context.ready,/EPERM/);else await context.ready;
  assert.equal(writes.length,fail?0:1);
 }
});
