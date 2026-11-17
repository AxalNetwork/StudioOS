// D6897 (#6897, canvas D6054 RA-30) — the readiness snapshot shared outside Axal: the composer's checks, the reader's
// page (seven areas, Not scored yet, Team by a person, no overall score, no PMF), its refusal page, Shared links
// naming a snapshot, the public route and the client. Sample data only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/readiness_share_6897.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ReadinessSnapshotView } from '../src/pages/share/ReadinessSnapshotPage.jsx';
import { SharedLinksList } from '../src/pages/cycles/evidence/ShareOutside.jsx';
import { isPublicPath } from '../src/lib/api.js';
import { raiseEvidenceShareApi } from '../src/lib/api/raiseEvidenceShare.js';
import { snapshotErrors, snapshotBody, whatItShares, COVERING_LINE_MAX } from '../src/pages/cycles/evidence/shareOutsideModel.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(p, 'utf8');

const AREAS = [
  { key: 'narrative', label: 'Investor narrative', score: 7, evidence: 'Stated', missing: 'One customer story.', scored_on: '2026-11-02', words: '7 of 10' },
  { key: 'deck', label: 'Pitch deck', score: 6, evidence: 'Pattern', missing: null, scored_on: '2026-11-03', words: '6 of 10' },
  { key: 'data_room', label: 'Data room', score: null, evidence: null, missing: null, scored_on: null, words: 'Not scored yet' },
  { key: 'cap_table', label: 'Cap table', score: 0, evidence: 'Measured', missing: 'Every holder.', scored_on: '2026-11-04', words: '0 of 10' },
  { key: 'use_of_funds', label: 'Use of funds', score: null, evidence: null, missing: null, scored_on: null, words: 'Not scored yet' },
  { key: 'traction', label: 'Traction proof', score: 8, evidence: 'Stated', missing: null, scored_on: '2026-11-04', words: '8 of 10' },
  { key: 'team', label: 'Team', score: null, evidence: null, missing: null, scored_on: null, words: 'Team is assessed by a person' },
];
const READY = { status: 'ready', body: { state: 'ok', snapshot: { kind: 'readiness', venture: '[Sample venture]', covering_line: 'Where we stand before the partner meeting.', areas: AREAS }, link: { made_at: '2026-11-16T10:00:00Z', expires_at: '2026-11-30T10:00:00Z' } } };

test('the composer checks who it is for, the bounds and a one-sentence covering line, and sends only known fields', () => {
  const base = { label: '[Sample fund]', expires_in_days: 14, view_limit: 10, covering_line: '' };
  assert.deepEqual(snapshotErrors(base), {});
  assert.ok(snapshotErrors({ ...base, label: ' ' }).label);
  assert.ok(snapshotErrors({ ...base, expires_in_days: 91 }).expires_in_days);
  assert.ok(snapshotErrors({ ...base, view_limit: 0 }).view_limit);
  assert.ok(snapshotErrors({ ...base, covering_line: 'one\ntwo' }).covering_line);
  assert.ok(snapshotErrors({ ...base, covering_line: 'x'.repeat(COVERING_LINE_MAX + 1) }).covering_line);
  assert.deepEqual(snapshotErrors({ ...base, covering_line: 'x'.repeat(COVERING_LINE_MAX) }), {});
  assert.deepEqual(snapshotBody(base), { label: '[Sample fund]', expires_in_days: 14, view_limit: 10 });
  assert.deepEqual(snapshotBody({ ...base, covering_line: '  Two   spaces. ' }).covering_line, 'Two spaces.');
});

test('the reader’s page: dated, the covering line, seven areas, Not scored yet, a real 0, Team by a person, no overall score or PMF', () => {
  const out = html(h(ReadinessSnapshotView, { state: READY }));
  assert.match(out, /As of 2026-11-16|As of 16/);
  assert.match(out, /does not update/);
  assert.match(out, /Where we stand before the partner meeting\./);
  assert.equal((out.match(/data-testid="readiness-snapshot-area"/g) || []).length, 7);
  assert.equal((out.match(/Not scored yet/g) || []).length, 2);
  assert.match(out, /0 of 10/, 'a recorded 0 is shown as 0');
  assert.match(out, /Team is assessed by a person/);
  assert.doesNotMatch(out, /Product-market|overall|out of 100/i);
  const refused = html(h(ReadinessSnapshotView, { state: { status: 'refused', body: { state: 'revoked', title: 'This link was stopped by the founder', sentence: 'Ask the sender for a new link.' } } }));
  assert.match(refused, /stopped by the founder/); assert.doesNotMatch(refused, /Sample venture|of 10/);
  assert.match(html(h(ReadinessSnapshotView, { state: { status: 'loading' } })), /Opening the snapshot…/);
});

test('Shared links names a snapshot and offers a new one from the readiness page, not a new pack', () => {
  const link = { uid: 'u1', output: 'readiness', label: '[Sample fund]', reader: 'before_nda', item_count: 7, created_at: '2026-11-16', expires_at: '2026-11-30', view_count: 1, view_limit: 10, state: 'live', changed_since_sent: true };
  assert.equal(whatItShares(link), 'Readiness snapshot');
  assert.equal(whatItShares({ reader: 'before_nda' }), 'Before an NDA: coverage only');
  const out = html(h(SharedLinksList, { links: [link], onRevoke() {}, onMakeNew() {} }));
  assert.match(out, /Readiness snapshot/);
  assert.match(out, /Make a new snapshot/); assert.match(out, /href="\/raise\/fundraising-readiness"/);
  assert.doesNotMatch(out, /Make a new pack/);
});

test('the public route, the client and the founder-only button', async () => {
  assert.equal(isPublicPath('/share/readiness/abc'), true);
  const routes = read('frontend/src/routes/raiseEvidenceShare.jsx');
  assert.match(routes, /<Route path="\/share\/readiness\/:token" element=\{<ReadinessSnapshotPage \/>\} \/>/, 'no guard on the public page');
  let seen = null;
  const r = await raiseEvidenceShareApi.openReadiness('tok_en', async (url, init) => { seen = { url, init }; return { status: 410, json: async () => ({ state: 'revoked' }) }; });
  assert.equal(r.status, 410); assert.equal(seen.url, '/api/share/readiness/tok_en');
  assert.equal(seen.init.credentials, 'omit'); assert.ok(!('Authorization' in (seen.init.headers || {})));
  const home = read('frontend/src/pages/cycles/ReadinessHome.jsx');
  assert.match(home, /projectId && role === 'founder' \? <div[^>]*><ShareReadinessButton projectId=\{projectId\} \/>/);
  assert.match(read('frontend/src/pages/cycles/defs/raise.jsx'), /<ReadinessHome [^>]*role=\{ctx\.role\}/);
});
