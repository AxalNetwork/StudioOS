import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deploy = readFileSync(new URL('../../documentation/operations/DEPLOY.md', import.meta.url), 'utf8');
const decision = readFileSync(new URL('../../documentation/architecture/decisions/D5605.md', import.meta.url), 'utf8');
const queue = deploy.split('### 1.2.1 ')[1]?.split('\n### ')[0] ?? '';

test('D5605 and the deploy runbook agree on build concurrency', () => {
  const setting = queue.match(/^\| Build concurrency \| (\d+) \|$/m)?.[1];
  const approved = decision.match(/^\| 4 \| Build concurrency is \*\*(\d+)\*\*/m)?.[1];
  assert.ok(setting && approved, 'both documents must state build concurrency');
  assert.equal(setting, approved);
});

test('the deploy runbook records the bypass and concurrency rules', () => {
  assert.match(queue, /no bypass actors/);
  assert.match(queue, /owner\s+edits the ruleset/);
  assert.match(queue, /8–10.*only once the measured\s+per-entry failure rate is \*\*at most 3%\*\* and run wall time is \*\*at most 15 minutes\*\*/);
  assert.match(queue, /\*\*2\*\* only while the queue-stalled alert is open/);
});
