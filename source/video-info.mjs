import { createHash } from 'node:crypto';

// Playback resolves first, then starts its optional metadata requests. Keep the
// response briefly to share it across both stages, scoped to the exact credentials.
export function createVideoInfoReader(readCredentials, loadVideoInfo, now = Date.now) {
  const pending = new Map();
  const recent = new Map();
  return async function videoInfo(bvid) {
    const cookieJar = await readCredentials();
    const key = `${bvid}:${createHash('sha256').update(cookieJar).digest('hex')}`;
    const cached = recent.get(key);
    if (cached && cached.expires > now()) return cached.data;
    if (pending.has(key)) return pending.get(key);

    const request = loadVideoInfo(bvid, cookieJar).then(data => {
      recent.delete(key);
      recent.set(key, { data, expires: now() + 5000 });
      if (recent.size > 64) recent.delete(recent.keys().next().value);
      return data;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
