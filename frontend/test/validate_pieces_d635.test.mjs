/**
 * D635 — the Validate interview pieces, rendered. D704 removed the other two
 * (the decision panel and a claim's link list) with their pages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { InterviewEvidenceFields } from '../src/pages/founder/validatePieces.jsx';

const html = (node) => renderToStaticMarkup(node);
const record = readFileSync(new URL('../src/pages/founder/InterviewReviewPage.jsx', import.meta.url), 'utf8');
const validateRecords = readFileSync(new URL('../../cloudflare-worker/src/services/records/validate.ts', import.meta.url), 'utf8');
const pieces = readFileSync(new URL('../src/pages/founder/validatePieces.jsx', import.meta.url), 'utf8');

test('Not recorded is not None', () => {
  const fields = html(React.createElement(InterviewEvidenceFields, { fit: null, consent: null, company: '' }));
  assert.match(fields, /Not recorded/);
  assert.match(fields, /None/);
  assert.match(fields, /<option value="" selected="">Not recorded<\/option>/);
  assert.doesNotMatch(fields, /<option value="none" selected/);

});

// D704 (#1666): the Verdict and Hypotheses pages are gone, and with them
// VerdictPanel, earlierDecisions and ClaimLinkList. A decision is the Verdict
// module's (verdict_module_d693, verdict_d693), and a claim's unlink is its
// record's `unlink` action (cycle_records_validate_d690).
test('the writes the pieces stood for have their homes', () => {
  assert.match(record, /api\.updateInterviewEvidence\(/, "the interview record saves the evidence fields");
  assert.match(validateRecords, /key: 'unlink', label: 'Unlink evidence'/, "a claim's unlink is its record's action");
  for (const gone of ['VerdictPanel', 'earlierDecisions', 'ClaimLinkList']) assert.doesNotMatch(pieces, new RegExp(`export function ${gone}\\b`), `${gone} is removed`);
});
