/**
 * D4669 — HQ · Security says what its session acts reach: this deployment,
 * and which branch deployments were not reached. And ending a support
 * session reads as ending it.
 *
 * Renders the components with payloads shaped like the Worker's and reads
 * the text a person would see. Security v2 (D4801) moved the session acts
 * into the Access workspace; the scope sits under "What each action reaches". The Worker half is proved against a real
 * database in cloudflare-worker/test/session_containment_d4669.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import AccessWorkspace from '../src/pages/hq/security/AccessWorkspace.jsx';
import { DeploymentOutcomes, outcomeLines, scopeSentence } from '../src/pages/hq/security/deploymentScope.jsx';

const text = (C, props) => renderedText(renderToStaticMarkup(React.createElement(C, props)));

const SCOPE = {
  deployment: 'hq', reaches: 'this_deployment_only', branches_bound: 2,
  summary: "Acts on HQ's accounts and sessions only. 2 bound branches are not reached: each keeps its own sessions.",
};
const LIST = {
  token_hours: 24, total: 0, expiry_minutes: 30, rows: [],
  impersonations: { available: true, rows: [] },
  scope: SCOPE,
};

test('the Access workspace states the scope the server reports, and ending a support session reads as ending it', () => {
  const t = text(AccessWorkspace, { list: LIST, unavailable: Symbol('unavailable'), onAct: async () => ({}), onRetry: () => {}, now: Date.parse('2026-11-07T14:30:00Z') });
  assert.match(t, /Scope · Acts on HQ's accounts and sessions only\. 2 bound branches are not reached/);
  assert.match(t, /Ends the support session: its token is refused from its next request/);
  assert.doesNotMatch(t, /lapses at its own expiry|carries no session id/, 'the old caveat is still shown');
});

test('a list with no scope does not imply a platform-wide act', () => {
  const s = scopeSentence(undefined);
  assert.match(s, /not stated by the server/);
  assert.match(s, /this deployment only/);
  assert.doesNotMatch(s, /every tenant|everywhere|all tenants/);
});

test('each deployment gets its own line: done with its count, not reached with the reason, failed as nothing changed', () => {
  const lines = outcomeLines([
    { deployment: 'hq', outcome: 'done', affected: 3 },
    { deployment: 'fr', outcome: 'not_reached', reason: 'A branch is its own deployment.' },
    { deployment: 'de', outcome: 'failed' },
    { deployment: 'branches', outcome: 'unknown', reason: 'Bindings unreadable.' },
    { deployment: 'xx', outcome: 'surprise' },
  ]);
  assert.deepEqual(lines, [
    'HQ · done · 3 accounts',
    'fr · not reached — A branch is its own deployment.',
    'de · failed — nothing changed',
    'branches · unknown — Bindings unreadable.',
    'xx · unrecognised outcome (surprise)',
  ]);
  assert.deepEqual(outcomeLines(null), []);
  assert.equal(outcomeLines([{ deployment: 'hq', outcome: 'done', affected: 1 }])[0], 'HQ · done · 1 account');
});

test('the outcome list renders every line, and renders nothing without outcomes', () => {
  const t = text(DeploymentOutcomes, { outcomes: [{ deployment: 'hq', outcome: 'done', affected: 2 }, { deployment: 'fr', outcome: 'not_reached' }] });
  assert.match(t, /HQ · done · 2 accounts/);
  assert.match(t, /fr · not reached/);
  assert.equal(renderToStaticMarkup(React.createElement(DeploymentOutcomes, { outcomes: [] })), '');
});
