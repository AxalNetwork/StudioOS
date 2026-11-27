// D4537 (#4537, step 3): a From Axal skill's release evidence, read from GET /:uid's `freshness` (the decision the
// publish gate refuses on) and each version's manifest. Read only; nothing is decided in the browser.
//
// What is held:
//   - ready / blocked / not recorded come from `freshness` alone, and every Blocking code has its own words;
//   - the evaluation line never counts a missing run as a pass, and no runs is not "0 of 0 pass";
//   - "changed since the last approval" is changed, unchanged or not recorded, part by part; never approved is said;
//   - a version without a manifest says so, and a publish with no audit row is flagged.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_skill_release_4537.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { mountContracts } from './_contracts_dom.mjs';
import { ReleaseEvidence } from '../src/pages/hq/aiAgents/ReleaseEvidence.jsx';
import { NOT_RECORDED } from '../src/pages/hq/aiAgents/aiAgentsModel.js';
import { BLOCKING_WORDS, changeRows, evaluationLine, evidenceRows, readiness, shortHash, versionRecord } from '../src/pages/hq/aiAgents/releaseModel.js';

const h = React.createElement;
const find = (ui, id) => ui.nodes().filter((n) => ui.props(n)?.['data-testid'] === id);
const txt = (n) => n.textContent || (n.childNodes ?? []).map(txt).join('');
const H = (c) => c.repeat(64);
const EVIDENCE = { definition_hash: H('a'), suite: { revision: H('b'), cases: [{ uid: 'k1' }, { uid: 'k2' }] }, evaluator_version: 3, models: { required: ['m1', 'm2'], source: 'declared' }, evidence_hash: H('c') };
const BLOCKED = {
  ready: false, blocking: ['needs_approval', 'evaluation_incomplete'], evidence: EVIDENCE,
  review: { approved: false, changes: { definition: true, cases: false, evaluator: null, models: false }, released_version: null },
  evaluation: { pass: 2, total: 4, not_evaluated: 2, meets_bar: false, pass_bar: { pass: 9, of: 10 } },
};

test('readiness comes from freshness alone, and every Blocking code the server sends has words', () => {
  const src = readFileSync(new URL('../../cloudflare-worker/src/services/agents/skillLifecycle.ts', import.meta.url), 'utf8');
  const codes = /export type Blocking = ([^;]+);/.exec(src)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  assert.ok(codes.length >= 3);
  for (const c of codes) assert.ok(BLOCKING_WORDS[c], `no words for ${c}`);
  assert.deepEqual(readiness({ ready: true, blocking: [] }), { state: 'ready', label: 'Ready to publish', reasons: [] });
  const b = readiness(BLOCKED);
  assert.equal(b.state, 'blocked');
  assert.deepEqual(b.reasons, [BLOCKING_WORDS.needs_approval, BLOCKING_WORDS.evaluation_incomplete]);
  // Mutation checked: treating a missing decision as ready (`!freshness → ready`) fails here.
  assert.equal(readiness(null).state, 'unknown');
  assert.equal(readiness({}).label, NOT_RECORDED);
  assert.deepEqual(readiness({ ready: false, blocking: [] }).reasons, ['The server did not say why.']);
});

test('the evaluation line never counts a missing run as a pass', () => {
  assert.equal(evaluationLine(BLOCKED.evaluation), '2 of 4 pass · 2 not evaluated · bar 9 of 10');
  assert.equal(evaluationLine({ pass: 10, total: 10, not_evaluated: 0, pass_bar: { pass: 9, of: 10 } }), '10 of 10 pass · bar 9 of 10');
  assert.match(evaluationLine({ pass: 0, total: 0, not_evaluated: 0 }), /^No required runs/);
  assert.equal(evaluationLine(null), NOT_RECORDED);
});

test('changes since the last approval are part by part; never approved and not recorded are said', () => {
  assert.deepEqual(changeRows(BLOCKED.review).map((r) => [r.part, r.text]), [
    ['definition', 'Changed since the last approval'], ['cases', 'Unchanged'], ['evaluator', NOT_RECORDED], ['models', 'Unchanged'],
  ]);
  assert.equal(changeRows({ approved: false, changes: null }), null);
  assert.deepEqual(evidenceRows(EVIDENCE).map(([k]) => k), ['Definition', 'Golden cases', 'Evaluator', 'Required models', 'Evidence']);
  assert.equal(evidenceRows(EVIDENCE)[1][1], `2 · revision ${H('b').slice(0, 12)}`);
  assert.match(evidenceRows({ ...EVIDENCE, models: { required: [], source: 'default' } })[3][1], /None \(the default set\)/);
  assert.equal(shortHash('short'), NOT_RECORDED);
});

test('a version without a manifest says so; a publish with no audit row is flagged', () => {
  const old = versionRecord({ version: 1, published_at: '2026-10-01', by: { name: 'Sue' }, evidence: null, publish_audited: true });
  assert.equal(old.recorded, false);
  assert.match(old.lines[0], /No release evidence recorded/);
  assert.equal(old.audited, null);
  const v2 = versionRecord({
    version: 2, published_at: '2026-11-08', by: { name: 'Sue' }, publish_audited: false,
    evidence: { ...EVIDENCE, bar: { pass: 18, total: 20 }, review: { reviewer: { name: 'Rex' }, decided_at: '2026-11-08 10:00:00' } },
  });
  assert.equal(v2.head, 'v2 · 2026-11-08 · Sue');
  assert.match(v2.lines[1], /^18 of 20 runs passed · 2 cases · evaluator v3 · m1 · m2$/);
  assert.equal(v2.lines[2], 'Approved by Rex on 2026-11-08 10:00:00');
  assert.equal(v2.audited, 'This publish has no audit row.');
  assert.equal(versionRecord({ version: 3, evidence: { ...EVIDENCE }, publish_audited: null }).audited, null, 'an unread audit log is not a missing row');
});

test('the card draws the decision, the changes and every version, newest first', async () => {
  const ui = await mountContracts(h(ReleaseEvidence, {
    freshness: { ...BLOCKED, review: { ...BLOCKED.review, released_version: 2 } },
    versions: [{ version: 1, evidence: null }, { version: 2, evidence: { ...EVIDENCE, bar: { pass: 9, total: 10 } }, publish_audited: true }],
  }));
  try {
    const status = find(ui, 'release-readiness')[0];
    assert.equal(ui.props(status)['data-state'], 'blocked');
    assert.match(txt(status), /Not ready to publish/);
    assert.match(txt(find(ui, 'release-spent')[0]), /already released v2/);
    assert.equal(find(ui, 'release-changes').length, 1);
    assert.deepEqual(find(ui, 'release-version').map((n) => ui.props(n)['data-recorded']), ['yes', 'no']);
  } finally { await ui.unmount(); }
  const none = await mountContracts(h(ReleaseEvidence, { freshness: null, versions: [] }));
  try {
    assert.equal(none.props(find(none, 'release-readiness')[0])['data-state'], 'unknown');
    assert.match(none.text(), /This skill has never been approved\./);
    assert.match(none.text(), /No version has been published\./);
    assert.doesNotMatch(none.text(), /Ready to publish/);
  } finally { await none.unmount(); }
});
