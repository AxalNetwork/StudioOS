/** Owner request: the LP investor workspace keeps its content without an AI side rail. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { railRenderer } from './_airailRender.mjs';

test('LP investor workspace renders without an AI rail for investors', async () => {
  const renderer = await railRenderer();
  try {
    for (const profile of ['Investor']) {
      for (const state of ['down', 'empty']) {
        const drawn = await renderer.draw(profile, '/spinout-lab/investor-workspace', state);
        assert.equal(drawn.rails, 0, `${profile}/${state}: no AI side rail`);
        assert.deepEqual(drawn.escaped, [], `${profile}/${state}: no render failure`);
        assert.equal(drawn.pageRendered, true, `${profile}/${state}: workspace content remains mounted`);
      }
    }
  } finally { renderer.close(); }
});
