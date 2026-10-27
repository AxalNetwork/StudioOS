// D1267 (#3290) — Raise evidence part 6: an Evidence part under each Raise
// module's table (VR6), and the Pitch deck editor's claim chips with the
// optional "Sources on Axal" slide (VR7). A share-link deck carries no evidence.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_evidence_modules_d1267.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { EvidencePartView, SlideEvidenceView } from '../src/pages/cycles/evidence/EvidencePart.jsx';
import {
  MODULE_EVIDENCE, SOURCES_TITLE, deckChecked, moduleEvidence, newestVersion, slideClaims, sourcesLines,
} from '../src/pages/cycles/evidence/moduleEvidence.js';
import { MODULES } from '../src/pages/cycles/modules.js';
import { sourcesCard } from '../src/pages/raise/pitch/PitchEditor.jsx';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const count = (out, s) => out.split(s).length - 1;

const rec = (o = {}) => ({ value: 16950, shown: '$16,950', stated_shown: '$18,400', source_label: 'connector', provider: 'stripe', observed_on: '2026-09-30', items: ['kpi'], ...o });
const claim = (uid, surface, version, field, kind, state, o = {}) => ({ uid, surface, surface_version: version, field_key: field, claim_kind: kind, stated_value: '18400', state, checked_at: null, record: null, links: [], ...o });
const item = (uid, area, o = {}) => ({ uid, area, kind: 'loi-file', source_label: 'document', provider: null, strength: 'pattern', observed_on: '2026-09-28', state: 'pinned', visibility: 'after_nda', value_num: null, value_unit: null, ...o });
function fixture() {
  return {
    claims: { state: 'recorded', rows: [
      claim('n3', 'narrative', 'v3', 'traction#mrr', 'mrr', 'mismatch', { record: rec() }),
      claim('n3b', 'narrative', 'v3', 'traction#paying_customers', 'paying_customers', 'backed', { stated_value: '42', record: rec({ shown: '42', stated_shown: '42' }) }),
      claim('n2', 'narrative', 'v2', 'traction#mrr', 'mrr', 'mismatch'),
      claim('n10', 'narrative', 'v10', 'why#arr', 'arr', 'founders_figure', { record: rec({ source_label: 'typed', provider: null, shown: '$220,800', stated_shown: '$220,800' }) }),
      claim('d1', 'deck', 'v4', 'slide:1#mrr', 'mrr', 'mismatch', { record: rec() }),
      claim('d12', 'deck', 'v4', 'slide:12#pilots', 'pilots', 'not_backed', { stated_value: '16' }),
      claim('d1b', 'deck', 'v4', 'slide:1#paying_customers', 'paying_customers', 'backed', { stated_value: '42', record: rec({ shown: '42', stated_shown: '42', observed_on: '2026-09-30' }) }),
      claim('d3', 'deck', 'v3', 'slide:1#mrr', 'mrr', 'backed', { record: rec() }),
      claim('d4dup', 'deck', 'v4', 'slide:3#mrr', 'mrr', 'mismatch', { record: rec() }),
      claim('r1', 'readiness', 'current', 'traction', 'traction_proof', 'backed', { stated_value: null, record: rec({ shown: null }) }),
      claim('m1', 'capital_model', 'current', 'gross_margin_pct', 'margin', 'not_backed', { stated_value: '80' }),
    ] },
    items: { state: 'recorded', rows: [item('loi', 'Data room'), item('gone', 'Data room', { state: 'unpinned' }), item('legal', 'Legal', { kind: 'signed-document', source_label: 'signed' })] },
    permissions: { can_decide: true },
  };
}
const ready = (r = fixture()) => ({ status: 'ready', read: r });

test('every Raise module has its evidence, and nothing else does', () => {
  assert.deepEqual(Object.keys(MODULE_EVIDENCE).sort(), MODULES.raise.map((m) => m.slug).sort());
  assert.equal(moduleEvidence(fixture(), 'solution-design'), null);
});

test('a module shows its own surfaces at their newest version, and its own pinned areas', () => {
  assert.equal(newestVersion(fixture().claims.rows, 'narrative'), 'v10', 'v10 is newer than v3, read as numbers');
  assert.equal(newestVersion(fixture().claims.rows, 'readiness'), 'current');
  assert.equal(newestVersion([], 'deck'), null);
  const nar = moduleEvidence(fixture(), 'investor-narrative');
  assert.deepEqual(nar.claims.map((c) => c.uid), ['n10']);
  assert.equal(nar.version, 'v10');
  const ready2 = moduleEvidence(fixture(), 'fundraising-readiness');
  assert.deepEqual(ready2.claims.map((c) => c.uid), ['r1', 'm1']);
  assert.deepEqual(ready2.items.map((i) => i.uid), ['legal']);
  assert.equal(ready2.version, null, 'a current surface names no version');
  const deck = moduleEvidence(fixture(), 'pitch-deck');
  assert.deepEqual(deck.claims.map((c) => c.uid), ['d1', 'd12', 'd1b', 'd4dup'], 'the deck module shows the current deck’s claims');
  assert.equal(deck.version, 'v4'); assert.equal(deck.hasItems, false);
  const room = moduleEvidence(fixture(), 'data-room');
  assert.equal(room.hasClaims, false);
  assert.deepEqual(room.items.map((i) => i.uid), ['loi'], 'an unpinned item is not shown');
  const r = fixture(); r.claims = { state: 'unreadable', rows: null };
  assert.equal(moduleEvidence(r, 'investor-narrative').claims, null, 'Unreadable, never empty');
});

test('the slide’s claims: this version, this slide (slide 1 is not slide 12), and whether the version is checked', () => {
  assert.deepEqual(slideClaims(fixture(), 4, 1).map((c) => c.uid), ['d1', 'd1b']);
  assert.deepEqual(slideClaims(fixture(), 4, 12).map((c) => c.uid), ['d12']);
  assert.deepEqual(slideClaims(fixture(), 3, 1).map((c) => c.uid), ['d3']);
  assert.equal(deckChecked(fixture(), 4), true);
  assert.equal(deckChecked(fixture(), 5), false);
  assert.equal(slideClaims({ claims: { state: 'unreadable' } }, 4, 1), null);
});

test('Sources on Axal: each figure once, its source, “which differs” for a mismatch, and its date; no record says so', () => {
  assert.deepEqual(sourcesLines(fixture(), 4), [
    'MRR — Connector · Stripe, which differs — 30 Sep 2026',
    'Pilots — No record on StudioOS',
    'Paying customers — Connector · Stripe — 30 Sep 2026',
  ]);
  const card = sourcesCard({ layouts: [{ id: 'cover', blocks: [] }, { id: 'statement', blocks: [{ kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 6 } }] }] }, ['a', 'b']);
  assert.equal(card.title, SOURCES_TITLE); assert.equal(card.layout, 'statement');
  assert.deepEqual(card.blocks.map((b) => [b.kind, b.style, b.text]), [['text', 'list', 'a\nb']]);
});

test('VR6 rendered: claims open their drawers, items theirs, the venture kept; refused shows nothing; failed says Unreadable', () => {
  const out = html(h(EvidencePartView, { slug: 'investor-narrative', state: ready(), search: '?project_id=7' }));
  assert.ok(out.includes('Evidence · v10') && out.includes('href="/raise/evidence/claim/n10?project_id=7"'));
  assert.ok(out.includes('Founder’s figure') && !out.includes('href="/raise/evidence/claim/n3?'), 'an older version is not shown');
  assert.ok(out.includes('href="/raise/evidence?project_id=7"'), 'Open Evidence');
  const room = html(h(EvidencePartView, { slug: 'data-room', state: ready(), search: '?project_id=7' }));
  assert.ok(room.includes('href="/raise/evidence/item/loi?project_id=7"') && !room.includes('data-testid="module-claim"'));
  assert.equal(html(h(EvidencePartView, { slug: 'data-room', state: { status: 'refused' } })), '');
  assert.ok(html(h(EvidencePartView, { slug: 'data-room', state: { status: 'error', message: '' } })).includes('data-testid="evidence-unreadable-module-evidence"'));
  const empty = { ...fixture(), claims: { state: 'recorded', rows: [] } };
  assert.ok(html(h(EvidencePartView, { slug: 'cap-table', state: ready(empty) })).includes('No claim stated here is checked yet.'));
});

test('VR7 rendered: the slide’s chips, the share-link note, the Sources preview; a reader cannot add the slide', () => {
  const out = html(h(SlideEvidenceView, { state: ready(), version: 4, slide: 1 }));
  assert.equal(count(out, 'data-testid="slide-claim"'), 2);
  assert.ok(out.includes('data-state="mismatch"') && out.includes('data-state="backed"'));
  assert.ok(out.includes('People who open this deck by link see the slides only.'));
  assert.ok(out.includes('data-testid="slide-add-sources"') && out.includes('MRR — Connector · Stripe, which differs — 30 Sep 2026'));
  assert.ok(!html(h(SlideEvidenceView, { state: ready(), version: 4, slide: 1, readOnly: true })).includes('slide-add-sources'));
  assert.ok(html(h(SlideEvidenceView, { state: ready(), version: 9, slide: 1 })).includes('data-testid="slide-not-checked"'));
  assert.equal(html(h(SlideEvidenceView, { state: { status: 'refused' }, version: 4, slide: 1 })), '');
});

test('the wiring: every Raise module page mounts the part; the editor mounts the chips', () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.ok(route.includes("import EvidencePart from './evidence/EvidencePart';"));
  assert.ok(route.includes('<EvidencePart slug={m.slug} projectId={ctx.projectId} />'), 'the generic part, for every module');
  for (const s of ['investor-narrative', 'fundraising-readiness', 'capital-relationships']) assert.ok(route.includes(`<EvidencePart slug="${s}" projectId={ctx.projectId} />`), s);
  const editor = read('frontend/src/pages/raise/pitch/PitchEditor.jsx');
  assert.ok(/<SlideEvidence projectId=\{project\?\.id\} version=\{base\.deck\.version\} slide=\{sel \+ 1\} readOnly=\{readOnly\}/.test(editor));
});

test('a share-link deck carries no evidence: the reader, its page and its viewer read none', () => {
  const decks = read('cloudflare-worker/src/routes/decks.ts');
  const start = decks.indexOf("decks.get('/share/:token', async (c) => {");
  const end = decks.indexOf("decks.post('/share/:token/heartbeat'");
  assert.ok(start > 0 && end > start);
  const reader = decks.slice(start, end);
  assert.ok(!/raise_claims|raise_evidence|raiseEvidence|readRaiseEvidence|evidencePack|claim_check/.test(reader), 'the share reader reads no evidence');
  for (const f of ['frontend/src/pages/PitchDeckPrintPage.jsx', 'frontend/src/pages/raise/pitch/ShareViewerParts.jsx', 'frontend/src/pages/raise/pitch/PitchPresent.jsx']) {
    const src = read(f);
    assert.ok(!/cycles\/evidence|raiseEvidence|SlideEvidence/.test(src), `${f} draws no evidence`);
  }
});
