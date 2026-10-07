/**
 * D635 — the three Validate controls, rendered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimLinkList, InterviewEvidenceFields, VerdictPanel, earlierDecisions } from '../src/pages/founder/validatePieces.jsx';

const html = (node) => renderToStaticMarkup(node);
const page = readFileSync(new URL('../src/workspaces/founder/FounderValidateWorkspace.jsx', import.meta.url), 'utf8');
const pieces = readFileSync(new URL('../src/pages/founder/validatePieces.jsx', import.meta.url), 'utf8');

test('a later decision keeps the earlier one on the card, and a partner sees no card', () => {
  const payload = {
    current: { id: 2, decision: 'pivot', reasoning: 'narrow it', decided_at: '2026-10-07 12:00:00', superseded_at: null },
    history: [
      { id: 2, decision: 'pivot', reasoning: 'narrow it', decided_at: '2026-10-07 12:00:00', superseded_at: null },
      { id: 1, decision: 'proceed', reasoning: 'ship it', decided_at: '2026-09-01 12:00:00', superseded_at: '2026-10-07 12:00:00' },
    ],
  };
  assert.deepEqual(earlierDecisions(payload).map((row) => row.decision), ['proceed']);
  const ready = html(React.createElement(VerdictPanel, {
    phase: 'ready', current: payload.current, earlier: earlierDecisions(payload),
  }));
  assert.match(ready, /Pivot/);
  assert.match(ready, /Proceed/);
  assert.match(ready, /ship it/);
  assert.match(ready, /Record a later decision/);

  const hidden = html(React.createElement(VerdictPanel, { phase: 'hidden' }));
  assert.equal(hidden, '');
  const empty = html(React.createElement(VerdictPanel, { phase: 'empty', earlier: [] }));
  assert.match(empty, /No decision recorded yet/);
  assert.match(empty, /Record a decision/);
  const failed = html(React.createElement(VerdictPanel, { phase: 'unreadable', onRetry: () => {} }));
  assert.match(failed, /could not be read/);
  assert.match(failed, /Retry/);
});

test('Not recorded is not None, and a missing fit withholds the claim verdict', () => {
  const fields = html(React.createElement(InterviewEvidenceFields, { fit: null, consent: null, company: '' }));
  assert.match(fields, /Not recorded/);
  assert.match(fields, /None/);
  assert.match(fields, /<option value="" selected="">Not recorded<\/option>/);
  assert.doesNotMatch(fields, /<option value="none" selected/);

  const withheld = html(React.createElement(ClaimLinkList, {
    withheld: true,
    links: [{ id: 9, pain_group_id: 3, direction: 'supports' }],
    groups: [{ id: 3, title: 'Price' }],
  }));
  assert.match(withheld, /Verdict withheld/);
  assert.match(withheld, /Price/);
  assert.match(withheld, /Supporting/);
  assert.match(withheld, /Unlink/);
  const bare = html(React.createElement(ClaimLinkList, { links: [], groups: [] }));
  assert.match(bare, /This claim has no linked themes/);
  assert.doesNotMatch(bare, /Verdict withheld/);
});

test('the three pages call the three writes', () => {
  assert.match(page, /recordValidationDecision/);
  assert.match(page, /updateInterviewEvidence/);
  assert.match(page, /unlinkHypothesisPain/);
  assert.match(page, /status === 403 \? \{ hidden: true \}/);
  assert.match(pieces, /flex flex-col gap-2 sm:flex-row/);
});
