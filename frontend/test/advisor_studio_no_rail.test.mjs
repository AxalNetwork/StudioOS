/** Owner request: Advisor /studio has no side AI rail. Render the real route,
 * require the Studio content, and keep the other Advisor boards' rail. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { railRenderer } from './_airailRender.mjs';

test('Advisor Studio renders without an AI rail, including unavailable reads', async () => {
  const renderer = await railRenderer();
  try {
    for (const state of ['down', 'empty']) {
      const drawn = await renderer.draw('Advisor', '/studio', state);
      assert.equal(drawn.rails, 0, `${state}: no Advisor Studio rail`);
      assert.equal(drawn.pageRendered, true, `${state}: Studio content remains mounted`);
      assert.deepEqual(drawn.escaped, [], `${state}: no render failure`);
    }
    const practice = await renderer.verdict('Advisor', '/practice');
    assert.equal(practice.pass, true, 'Advisor Practice still renders its rail');
    assert.equal(practice.drawn.at(-1).rails, 1, 'the removal is scoped to Studio');
  } finally { renderer.close(); }
});
