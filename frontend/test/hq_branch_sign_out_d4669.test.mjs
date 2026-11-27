/**
 * D4669 part 2 (#4669) — the page half of HQ's sign-out on branch deployments
 * (the owner's option B). The Worker half is
 * cloudflare-worker/test/branch_emergency_sign_out_d4669.test.ts.
 *
 * What is pinned here is what the operator READS: a branch that did not
 * answer is never shown as done or as "nothing changed"; partial is said as
 * partial; a retry already on a branch's record says so; and the act cannot be
 * sent without a reason, a target and (for every account) the typed phrase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import BranchSignOut, {
  BranchResult, branchResultTitle, branchFormReady, BRANCH_ALL_PHRASE, BRANCH_REASON_MIN,
} from '../src/pages/hq/security/BranchSignOut.jsx';
import AccessWorkspace from '../src/pages/hq/security/AccessWorkspace.jsx';
import { outcomeLines } from '../src/pages/hq/security/deploymentScope.jsx';
import { readFileSync } from 'node:fs';

const h = React.createElement;
const text = (el) => renderedText(renderToStaticMarkup(el));
const REASON = 'Credential leak, ticket 9012';

const PARTIAL = {
  ok: false, outcome: 'partial', message: '1 of 3 branches answered that they acted.',
  outcomes: [
    { deployment: 'fr', outcome: 'done', affected: 2 },
    { deployment: 'de', outcome: 'failed', reason: 'de holds no account with id 4. Nothing changed there.' },
    { deployment: 'it', outcome: 'unreachable', timed_out: true, reason: 'Did not answer within 10s. It may or may not have signed anyone out.' },
  ],
};

test('an unreachable branch reads as "not known", never as done or as nothing changed', () => {
  const lines = outcomeLines(PARTIAL.outcomes);
  assert.equal(lines[0], 'fr · done · 2 accounts');
  assert.match(lines[1], /^de · failed — nothing changed/);
  assert.match(lines[2], /^it · unreachable — not known whether it acted/);
  // Mutation checked: dropping `unreachable` from OUTCOME_LABEL renders it as an unrecognised outcome.
  assert.doesNotMatch(lines[2], /unrecognised/);
  assert.match(outcomeLines([{ deployment: 'fr', outcome: 'done', affected: 1, replayed: true }])[0], /already on record from an earlier attempt/);
});

test('the headline says done only when every branch did, and partial as partial', () => {
  assert.equal(branchResultTitle(PARTIAL), 'Partial — done on 1 of 3 branches');
  assert.equal(branchResultTitle({ outcome: 'done', outcomes: [{ outcome: 'done' }, { outcome: 'done' }] }), 'Done on every branch asked (2 of 2)');
  assert.equal(branchResultTitle({ outcome: 'failed', outcomes: [{ outcome: 'unreachable' }] }), 'Not done — no branch answered that it acted (0 of 1)');
  assert.equal(branchResultTitle(null), null);
  const t = text(h(BranchResult, { res: PARTIAL }));
  assert.match(t, /Partial — done on 1 of 3 branches/);
  assert.match(t, /it · unreachable — not known whether it acted/);
});

test('it cannot be sent without a reason, a target, and for every account the typed phrase', () => {
  assert.equal(branchFormReady({ kind: 'account', email: 'a@b.example', reason: REASON }), true);
  assert.equal(branchFormReady({ kind: 'account', email: 'not-an-email', reason: REASON }), false);
  assert.equal(branchFormReady({ kind: 'account', email: 'a@b.example', reason: 'x'.repeat(BRANCH_REASON_MIN - 1) }), false);
  assert.equal(branchFormReady({ kind: 'all', reason: REASON, phrase: 'sign out' }), false, 'the phrase is exact');
  assert.equal(branchFormReady({ kind: 'all', reason: REASON, phrase: BRANCH_ALL_PHRASE }), true);
  assert.equal(branchFormReady({ kind: 'nobody', reason: REASON, phrase: BRANCH_ALL_PHRASE }), false);
});

test('the card says what it reaches and that the other acts do not; with no branch bound it says so', () => {
  const t = text(h(BranchSignOut, { scope: { branches_bound: 3 }, readOnly: false, send: async () => ({}) }));
  assert.match(t, /Asks each of the 3 bound branches to sign accounts out on its own deployment/);
  assert.match(t, /The acts above do not reach branches; this one does, and only when you send it/);
  assert.match(t, /A branch that does not answer is never counted as done/);
  assert.match(text(h(BranchSignOut, { scope: { branches_bound: 0 } })), /No branch is bound to this deployment/);
});

test('the Access workspace draws it beside the acts that stay on this deployment', () => {
  const list = {
    total: 0, token_hours: 24, sessions: [], impersonations: [],
    scope: { deployment: 'hq', reaches: 'this_deployment_only', branches_bound: 2, summary: 'Acts on HQ\'s accounts and sessions only.' },
  };
  const t = text(h(AccessWorkspace, { list, onAct: async () => ({}), onRetry: () => {} }));
  assert.match(t, /Sign out on branch deployments/);
  assert.match(t, /Every HQ-held account; branch databases are not touched/, 'the emergency act no longer says it stays here');
  // The key is made once per act and resent by Try again.
  const src = readFileSync('frontend/src/pages/hq/security/BranchSignOut.jsx', 'utf8');
  assert.match(src, /const \[key, setKey\] = useState\(\(\) => newOpKey\(\)\);/);
  assert.match(src, /op_key: key/);
});
