import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaybackMappings, playbackMappingLifetime as lifetime } from '../playback-mappings.mjs';

test('sweeping removes untouched expired mappings and preserves recently used streams', () => {
  let time = 0;
  const now = () => time;
  const streams = createPlaybackMappings({ renewOnAccess: true, now });
  const manifests = createPlaybackMappings({ now });
  streams.set('active', 'active stream');
  streams.set('unused', 'unused stream');
  manifests.set('dash', 'manifest');
  time = lifetime - 1;
  assert.equal(streams.get('active'), 'active stream');
  assert.equal(manifests.get('dash'), 'manifest');

  time = lifetime;
  streams.sweep();
  manifests.sweep();
  // Reading just before the original deadline still finds nothing after deletion.
  time--;
  assert.equal(streams.get('unused'), undefined);
  assert.equal(manifests.get('dash'), undefined);
  assert.equal(streams.get('active'), 'active stream');
});

test('an expired lookup deletes the mapping and clear invalidates active entries', () => {
  let time = 0;
  const streams = createPlaybackMappings({ renewOnAccess: true, now: () => time });
  streams.set('expired', 'media');
  time = lifetime;
  assert.equal(streams.get('expired'), undefined);
  time--;
  assert.equal(streams.get('expired'), undefined);
  streams.set('active', 'media');
  streams.clear();
  assert.equal(streams.get('active'), undefined);
});
