import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { proxyMediaRange } from '../media-proxy.mjs';

test('a truncated Range response makes the next retry use the next CDN source', async () => {
  const stream = { url: 'https://primary.example/video', backups: ['https://backup.example/video'] };
  const requests = [];
  const networkFetch = async address => {
    requests.push(new URL(address).hostname);
    if (new URL(address).hostname === 'primary.example') {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('short'));
          setTimeout(() => controller.error(new Error('upstream ended before Content-Length')), 200);
        },
      }), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-9/10', 'Content-Length': '10' },
      });
    }
    return new Response('0123456789', {
      status: 206,
      headers: { 'Content-Range': 'bytes 0-9/10', 'Content-Length': '10' },
    });
  };
  const server = createServer((request, response) => {
    assert.equal(request.headers.range, 'bytes=0-9');
    proxyMediaRange(request, response, stream, {}, networkFetch);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}/media`;

  try {
    await assert.rejects(fetch(address, { headers: { Range: 'bytes=0-9' } }).then(response => response.arrayBuffer()));
    assert.equal(stream.preferred, 1);
    const retry = await fetch(address, { headers: { Range: 'bytes=0-9' } });
    assert.equal(retry.status, 206);
    assert.equal(await retry.text(), '0123456789');
    assert.deepEqual(requests, ['primary.example', 'backup.example']);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
