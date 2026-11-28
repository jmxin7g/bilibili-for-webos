import { Readable } from 'node:stream';
import { monitorMediaRoute, routedUrl } from './media-routing.mjs';
import routing from './vendor/bilibili-accelerator/routing.cjs';

export async function proxyMediaRange(request, response, stream, headers, networkFetch) {
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  const mediaHeaders = { ...headers };
  if (request.headers.range) mediaHeaders.Range = request.headers.range;
  const parsedRange = routing.parseRange(request.headers.range);
  const resumable = stream.route && parsedRange && Number.isFinite(parsedRange.length);
  let delivered = 0;
  let fileTotal;
  let sources = stream.backups?.length && request.headers.range ? [stream.url, ...stream.backups] : [stream.url];
  const selected = stream.route && request.headers.range ? stream.route.retry || routedUrl(stream.route) : null;
  if (stream.route) stream.route.retry = null;
  if (selected) sources = [selected, ...sources.filter(url => url !== selected)];
  const first = selected ? 0 : (stream.preferred || 0) % sources.length;
  const candidates = [...sources.slice(first), ...sources.slice(0, first)];
  for (const [index, mediaUrl] of candidates.entries()) {
    const answered = new AbortController();
    const routed = new AbortController();
    const monitor = stream.route ? monitorMediaRoute(stream.route, mediaUrl, { headers: { ...request.headers, range: mediaHeaders.Range } }, mediaHeaders, networkFetch, routed, controller.signal) : null;
    const headerTimer = index < candidates.length - 1 ? setTimeout(() => answered.abort(new DOMException('no response headers', 'TimeoutError')), 4000) : null;
    try {
      const upstream = await networkFetch(mediaUrl, {
        headers: mediaHeaders, redirect: 'error',
        signal: AbortSignal.any([controller.signal, answered.signal, routed.signal, AbortSignal.timeout(120000)]),
      });
      clearTimeout(headerTimer);
      if (!upstream.ok) throw new Error(`视频源 HTTP ${upstream.status}`);
      if (sources.length > 1 && upstream.status !== 206) throw new Error('视频源分段响应异常');
      if (resumable) {
        const contentRange = upstream.headers.get('content-range');
        const total = contentRange?.split('/')[1];
        if (upstream.status !== 206 || !contentRange?.startsWith(`bytes ${parsedRange.start + delivered}-${parsedRange.end}/`) ||
            Number(upstream.headers.get('content-length')) !== parsedRange.length - delivered || (fileTotal && total !== fileTotal)) {
          await upstream.body.cancel();
          throw new Error('视频源续传范围不匹配');
        }
        fileTotal = total;
      }
      if (!response.headersSent) {
        response.statusCode = upstream.status;
        response.setHeader('X-Media-Source', new URL(mediaUrl).host);
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const value = upstream.headers.get(name);
          if (value !== null) response.setHeader(name, value);
        }
      }
      for await (const chunk of Readable.fromWeb(upstream.body)) {
        monitor?.chunk(chunk.byteLength);
        if (resumable && delivered + chunk.byteLength > parsedRange.length) throw new Error('视频源续传数据超出范围');
        delivered += chunk.byteLength;
        if (!response.write(chunk)) {
          await new Promise(resolve => {
            const resume = () => {
              response.off('drain', resume);
              response.off('close', resume);
              resolve();
            };
            response.once('drain', resume);
            response.once('close', resume);
          });
        }
        if (response.destroyed) return;
        if (resumable && delivered === parsedRange.length) break;
      }
      if (resumable && delivered !== parsedRange.length) throw new Error('视频源分段传输不完整');
      monitor?.complete();
      response.end();
      return;
    } catch (error) {
      clearTimeout(headerTimer);
      monitor?.stop();
      if (controller.signal.aborted) {
        if (response.headersSent && sources.length > 1) stream.preferred = sources.indexOf(mediaUrl) + 1;
        return;
      }
      await monitor?.failed(error);
      if (resumable && stream.route.retry && stream.route.retry !== mediaUrl) {
        candidates.splice(index + 1, 0, stream.route.retry);
        stream.route.retry = null;
      }
      if (resumable && index < candidates.length - 1) {
        mediaHeaders.Range = `bytes=${parsedRange.start + delivered}-${parsedRange.end}`;
        console.warn(`media: ${new URL(mediaUrl).host} failed (${error.message}); resuming after ${delivered} bytes`);
        continue;
      }
      if (response.headersSent) {
        if (sources.length > 1) stream.preferred = (sources.indexOf(mediaUrl) + 1) % sources.length;
        response.destroy(error);
        return;
      }
      if (index === candidates.length - 1) throw error;
      console.warn(`media: ${new URL(mediaUrl).hostname} failed (${error.name}); trying backup`);
    } finally {
      monitor?.stop();
    }
  }
}
