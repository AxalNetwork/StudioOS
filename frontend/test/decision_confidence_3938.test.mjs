// #3938 (IN2): a decision gate shows Clef's probability beside its recommendation,
// and shows nothing when none was recorded (a rule-based gate) — never "0%".
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/decision_confidence_3938.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confidenceLine } from '../src/lib/decisionConfidence.js';

test('the confidence line: a rounded percentage, or nothing', () => {
  // Mutation checked: a null probability rendered as "0% likely".
  assert.equal(confidenceLine(0.72), '72% likely');
  assert.equal(confidenceLine(0), '0% likely', 'a recorded zero is a figure');
  for (const none of [null, undefined, NaN, -1, 2, '0.5']) assert.equal(confidenceLine(none), null, String(none));
});

test('both gate cards on the pipeline page draw the confidence beside the recommendation', () => {
  const src = readFileSync(new URL('../src/pages/PipelinePage.jsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ confidenceLine \} from '\.\.\/lib\/decisionConfidence\.js';/);
  assert.match(src, /AI: \{\(gate\.ai_recommendation[^\n]*\n\s*\{confidenceLine\(gate\.ai_confidence\) && /, 'the deal card');
  assert.match(src, /AI: <span[^\n]*g\.ai_recommendation[^\n]*\n\s*\{confidenceLine\(g\.ai_confidence\) && /, 'the gate list');
});
