import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
test('scrubbing previews, captures, commits, clamps, cancels and preserves pause', () => {
  for (const paused of [false, true]) {
    const handlers = {};
    const video = { duration: 100, currentTime: 20, readyState: 4, paused };
    const progress = { value: 20, getBoundingClientRect: () => ({ left: 100, width: 400 }) };
    const scrubber = { addEventListener: (name, fn) => handlers[name] = fn,
      setPointerCapture(id) { this.capture = id; },
      releasePointerCapture() { delete this.capture; handlers.lostpointercapture(); } };
    const context = { video, scrubDrag: null, document: { querySelector: s => s === '.scrubber' ? scrubber : progress },
      showControls() {}, showScrubPreview() {}, placeOnScrubber() {}, playhead: {}, scrubPreview: { hidden: false } };
    vm.runInNewContext(source.slice(source.indexOf("const scrubber = document.querySelector('.scrubber');"), source.indexOf("video.addEventListener('seeking', () => { if (!player.hidden)")), context);
    const send = (name, x, id = 1, button = 0) => handlers[name]({ clientX: x, pointerId: id, button, preventDefault() {} });
    send('pointerdown', 200);
    assert.equal(scrubber.capture, 1);
    send('pointermove', 400);
    assert.equal(progress.value, 75);
    assert.equal(video.currentTime, 20);
    send('pointermove', 100, 2);
    assert.equal(progress.value, 75);
    send('pointerup', 700);
    assert.equal(video.currentTime, 100);
    assert.equal(video.paused, paused);
    send('pointerdown', 300); send('pointerup', 300);
    assert.equal(video.currentTime, 50);
    send('pointerdown', 0); send('pointerup', 0);
    assert.equal(video.currentTime, 0);
    send('pointerdown', 400); send('lostpointercapture');
    assert.equal(video.currentTime, 0);
    assert.equal(progress.value, 0);
    assert.equal(context.scrubPreview.hidden, true);
    send('pointerdown', 300, 1, 2);
    assert.equal(context.scrubDrag, null);
    for (const duration of [NaN, Infinity, 0]) {
      video.duration = duration; send('pointerdown', 300);
      assert.equal(context.scrubDrag, null);
    }
  }
});
