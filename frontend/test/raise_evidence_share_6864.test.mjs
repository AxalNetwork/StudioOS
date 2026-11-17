// D6864 (#6864, canvas D6054) — Raise evidence shared outside Axal: the composer's checks (RA-27), what each row tells
// the reader, Shared links (RA-29) with grey rows and words, Add evidence by hand (RA-32), the reader's page before
// and after an NDA (RA-28) and its refusal pages (RA-36), and the public route. Sample data only.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_evidence_share_6864.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { EvidencePackView } from '../src/pages/share/EvidencePackPage.jsx';
import { SharedLinksList } from '../src/pages/cycles/evidence/ShareOutside.jsx';
import { viewOf, sharedHref, AREAS } from '../src/pages/cycles/evidence/evidenceModel.js';
import { isPublicPath } from '../src/lib/api.js';
import { raiseEvidenceShareApi } from '../src/lib/api/raiseEvidenceShare.js';
import {
  composerErrors, composerBody, readerSees, readerWord, linkStateOf, isGrey, viewsLine, changedWord, typedErrors, typedBody, TYPED_FIXED,
} from '../src/pages/cycles/evidence/shareOutsideModel.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (p) => readFileSync(p, 'utf8');
const TODAY = '2026-11-16';

test('the composer refuses an after-NDA pack without the founder’s confirmation and a past day, and sends only known fields', () => {
  const base = { label: '[Seed fund] first look', reader: 'before_nda', expires_in_days: 14, view_limit: 10 };
  assert.deepEqual(composerErrors(base, TODAY), {});
  assert.ok(composerErrors({ ...base, label: '  ' }, TODAY).label);
  assert.ok(composerErrors({ ...base, label: 'x'.repeat(81) }, TODAY).label);
  // Mutation checked: drop the nda_confirmed check → this fails.
  assert.ok(composerErrors({ ...base, reader: 'after_nda', nda_signed_on: '2026-11-01' }, TODAY).nda_confirmed);
  assert.ok(composerErrors({ ...base, reader: 'after_nda', nda_confirmed: true, nda_signed_on: '2026-12-01' }, TODAY).nda_signed_on, 'not in the future');
  assert.deepEqual(composerErrors({ ...base, reader: 'after_nda', nda_confirmed: true, nda_signed_on: '2026-11-01' }, TODAY), {});
  assert.ok(composerErrors({ ...base, view_limit: 0 }, TODAY).view_limit);
  assert.ok(composerErrors({ ...base, expires_in_days: 91 }, TODAY).expires_in_days);
  assert.ok(composerErrors({ ...base, items: [] }, TODAY).items);
  assert.deepEqual(composerBody({ ...base, nda_confirmed: true, nda_signed_on: '2026-11-01' }), { label: '[Seed fund] first look', reader: 'before_nda', expires_in_days: 14, view_limit: 10 },
    'a before-NDA body carries no NDA fields');
  assert.deepEqual(Object.keys(composerBody({ ...base, reader: 'after_nda', nda_confirmed: true, nda_signed_on: '2026-11-01', items: ['a'] })).sort(),
    ['expires_in_days', 'items', 'label', 'nda_confirmed', 'nda_signed_on', 'reader', 'view_limit']);
});

test('each row says what the reader sees, from the Worker’s own reason', () => {
  assert.equal(readerSees({ value_num: 4200, value_reason: null }), 'Summary with figure');
  assert.equal(readerSees({ value_num: null, value_reason: 'Shared as a summary only.' }), 'Summary, no figure');
  assert.equal(readerSees({ value_num: null, value_reason: 'No figure is recorded for this item.' }), 'Summary · Not recorded');
  // Mutation checked: return 'Summary, no figure' for every reason → the withheld reason disappears and this fails.
  assert.equal(readerSees({ value_num: null, value_reason: 'One investor’s money is not shared with another investor.' }), 'Value withheld: One investor’s money is not shared with another investor.');
  assert.equal(readerWord('after_nda'), 'An NDA is signed outside Axal');
});

const link = (uid, state, o = {}) => ({ uid, label: `[${uid}]`, reader: 'before_nda', item_count: 4, created_at: '2026-11-09T10:00:00Z', expires_at: '2026-11-23T10:00:00Z', view_limit: 10, view_count: 4, last_viewed_at: '2026-11-09T12:00:00Z', revoked_at: null, state, changed_since_sent: false, ...o });

test('Shared links: words and glyphs, grey rows kept, Changed since sent with Make a new pack, Revoke only on a live link', () => {
  assert.equal(viewsLine(link('a', 'live')), '4 of 10');
  assert.equal(viewsLine({}), 'Not recorded');
  assert.deepEqual(linkStateOf('revoked'), { glyph: '✕', word: 'Revoked' });
  assert.equal(isGrey('expired'), true); assert.equal(isGrey('live'), false);
  assert.equal(changedWord(link('a', 'live', { changed_since_sent: true })), 'Changed since sent');
  assert.equal(changedWord(link('a', 'live', { changed_since_sent: null })), 'Could not be compared');
  assert.equal(changedWord(link('a', 'revoked', { changed_since_sent: true })), null);
  const out = html(h(SharedLinksList, { links: [link('Angel C', 'live', { changed_since_sent: true }), link('Old', 'expired'), link('Stopped', 'revoked')], onRevoke() {}, onMakeNew() {} }));
  assert.equal(out.split('data-testid="shared-link-row"').length - 1, 3, 'expired and revoked rows stay listed');
  assert.match(out, /Changed since sent · the reader’s copy did not change/);
  assert.match(out, /Make a new pack/);
  // Mutation checked: show Revoke on every row → three Revoke buttons in the table and this fails.
  assert.equal(out.split('data-testid="shared-link-revoke"').length - 1, 1);
  assert.match(out, /✕<\/span> Revoked/); assert.match(out, /◌<\/span> Expired/);
  assert.match(out, /data-testid="shared-links-cards"/, 'a phone gets cards');
  assert.match(out, /min-h-\[44px\]/);
});

test('Add evidence by hand: source, strength and sharing are fixed; the checks match the Worker’s', () => {
  assert.deepEqual(TYPED_FIXED, { source: 'Typed: stated by you', strength: 'Anecdote', sharing: 'Private' });
  assert.ok(typedErrors({ area: 'Product-market fit', summary: 'x' }, AREAS, TODAY).area, 'no Product-market fit area');
  assert.ok(typedErrors({ area: 'Legal', summary: '' }, AREAS, TODAY).summary);
  assert.ok(typedErrors({ area: 'Legal', summary: 'x', value: 'abc' }, AREAS, TODAY).value);
  assert.ok(typedErrors({ area: 'Legal', summary: 'x', unit: 'angels' }, AREAS, TODAY).unit);
  assert.ok(typedErrors({ area: 'Legal', summary: 'x', observed_on: '2027-01-01' }, AREAS, TODAY).observed_on);
  assert.deepEqual(typedBody({ area: 'Legal', summary: ' Counsel reviewed the SAFE. ', value: '2', unit: 'angels', observed_on: '2026-10-01' }),
    { area: 'Legal', summary: 'Counsel reviewed the SAFE.', value_num: 2, value_unit: 'angels', observed_on: '2026-10-01' });
  assert.ok(!('visibility' in typedBody({ area: 'Legal', summary: 'x' })), 'sharing is never sent: it is Private');
  const src = read('frontend/src/pages/cycles/evidence/ShareOutside.jsx');
  assert.match(src, /A claim this backs stays Founder’s figure/);
});

const packBefore = { state: 'ok', link: { made_at: '2026-11-09T10:00:00Z', expires_at: '2026-11-23T10:00:00Z' }, pack: {
  reader: 'before_nda', nda_signed: false, before_nda: 'Figures, files and quotes open once the NDA is signed.', venture: '[Northwind Labs]', partial: false,
  coverage: { state: 'recorded', groups: [{ area: 'Investor narrative and Pitch deck', kind: 'kpi-snapshot', source_label: 'connector', count: 2, newest: '2026-10-31' }] }, items: null, claims: null } };
const packAfter = { state: 'ok', link: { made_at: '2026-11-14T10:00:00Z', expires_at: '2026-11-28T10:00:00Z' }, pack: {
  reader: 'after_nda', nda_signed: true, nda_signed_on: '2026-11-12', venture: '[Northwind Labs]', partial: true, coverage: { state: 'recorded', groups: [] },
  items: { state: 'recorded', rows: [
    { uid: 'a', area: 'Investor narrative and Pitch deck', kind: 'kpi-snapshot', source_label: 'connector', strength: 'measured', observed_on: '2026-10-31', value_num: 48200, value_unit: 'money', currency: 'USD', value_reason: null },
    { uid: 'b', area: 'Capital relationships', kind: 'typed-commitment', source_label: 'typed', strength: 'anecdote', observed_on: null, value_num: null, value_reason: 'One investor’s money is not shared with another investor.' },
    { uid: 'c', area: 'Investor narrative and Pitch deck', kind: 'icp-fit', source_label: 'recorded', strength: 'pattern', observed_on: '2026-09-07', value_num: null, value_reason: 'Shared as a summary only.' },
  ] },
  claims: { state: 'recorded', rows: [{ uid: 'c1', state: 'mismatch', checked_at: '2026-11-13', founder_note: 'MRR in the deck includes October.' }, { uid: 'c2', state: 'backed', checked_at: '2026-11-13', founder_note: null }] } } };

test('the reader’s page before an NDA: dated, does not update, coverage only, no sign-in and no Eadwyn', () => {
  const out = html(h(EvidencePackView, { state: { status: 'ready', body: packBefore } }));
  assert.match(out, /As of 9 Nov 2026\. This pack does not update/);
  assert.match(out, /Figures, files and quotes open once the NDA is signed\./);
  assert.match(out, /KPI snapshot/); assert.match(out, /31 Oct 2026/);
  assert.doesNotMatch(out, /Eadwyn|Sign in|Log in/);
  assert.doesNotMatch(out, /evidence-pack-items/, 'no items before an NDA');
});

test('the reader’s page after an NDA: figure only where shared, Value withheld with its reason, a Mismatch with the founder’s note', () => {
  const out = html(h(EvidencePackView, { state: { status: 'ready', body: packAfter } }));
  assert.match(out, /Shared after an NDA signed outside Axal on 12 Nov 2026\./);
  assert.match(out, /\$48,200/);
  assert.match(out, /Value withheld: One investor’s money is not shared with another investor\./);
  assert.match(out, /Shared as a summary only\./);
  // Mutation checked: drop the note paragraph → this fails; hide mismatch rows → the state count fails.
  assert.match(out, /Founder’s note: MRR in the deck includes October\./);
  assert.match(out, /data-state="mismatch"/);
  assert.match(out, /Some evidence could not be read when this pack was made/);
  assert.match(out, /print:max-w-none/, 'print styles give the A4 copy');
  assert.match(out, /dark:bg-gray-950/);
});

test('the refusal pages name no venture and show no evidence; loading says what it is doing', () => {
  for (const [state, title] of [['expired', 'This link has expired'], ['used_up', 'This link has been opened as many times as its sender allowed'], ['revoked', 'This link was stopped by the founder'], ['not_found', 'This link does not open anything']]) {
    const out = html(h(EvidencePackView, { state: { status: 'refused', body: { state, title, sentence: 'Ask the sender for a new link.' } } }));
    assert.match(out, new RegExp(title)); assert.doesNotMatch(out, /Northwind|evidence-pack-items|coverage/);
  }
  assert.match(html(h(EvidencePackView, { state: { status: 'refused', body: null } })), /This link does not open anything/);
  assert.match(html(h(EvidencePackView, { state: { status: 'loading' } })), /Opening the pack…/);
});

test('the public route, the address and the client: no sign-in, no cookies, and Shared links is a page of Evidence', async () => {
  assert.deepEqual(viewOf('/raise/evidence/shared'), { page: 'shared', drawer: null, id: null });
  assert.equal(sharedHref('?project_id=3'), '/raise/evidence/shared?project_id=3');
  assert.equal(isPublicPath('/share/evidence/abc'), true);
  const routes = read('frontend/src/routes/raiseEvidenceShare.jsx');
  assert.match(routes, /<Route path="\/share\/evidence\/:token" element=\{<EvidencePackPage \/>\} \/>/, 'no guard on the public page');
  assert.match(routes, /<Route path="\/raise\/evidence\/shared" element=\{guard\(labRoles\(\['admin', 'founder'\]\)/);
  let seen = null;
  const r = await raiseEvidenceShareApi.openShared('tok_en', async (url, init) => { seen = { url, init }; return { status: 410, json: async () => ({ state: 'revoked' }) }; });
  assert.equal(r.status, 410); assert.equal(seen.url, '/api/share/evidence/tok_en');
  // Mutation checked: credentials 'include' → the reader's own Axal session would ride along and this fails.
  assert.equal(seen.init.credentials, 'omit'); assert.ok(!('Authorization' in (seen.init.headers || {})));
  const page = read('frontend/src/pages/cycles/evidence/RaiseEvidence.jsx');
  assert.match(page, /Share outside Axal/); assert.match(page, /founder && \(view\.page === 'view' \|\| view\.page === 'shared'\)/, 'only founders get the Share action');
});
