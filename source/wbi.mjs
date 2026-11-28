import { createHash } from 'node:crypto';

// WBI protocol permutation; implementation written for this independent app.
const order = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13];
export function signWbi(params, imgKey, subKey, timestamp = Math.floor(Date.now() / 1000)) {
  const combined = imgKey + subKey;
  const mixin = order.map(index => combined[index]).join('');
  const values = Object.fromEntries(params);
  values.wts = String(timestamp);
  const query = Object.keys(values).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(values[key].replace(/[!'()*]/g, ''))}`).join('&');
  const signature = createHash('md5').update(query + mixin).digest('hex');
  return `${query}&w_rid=${signature}`;
}
