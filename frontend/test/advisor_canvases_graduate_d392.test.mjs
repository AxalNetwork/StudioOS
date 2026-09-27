/**
 * D392 — the incoming advisor canvases graduate: Introductions shows both
 * sides of the consent, `/advisor/research` lands on the Research bucket, the
 * Markets gap card stops describing a feed the zone no longer is, and the
 * Expertise zones get the canvas's filter rows.
 *
 * Every test drives real code — the zone's own card, the page's own
 * predicates, the gap registry — so it pins what a reader would see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { PropositionCard, NARROW } from '../src/pages/advisor/network/IntroductionsZone.jsx';
import { MATCH_FIELDS, fieldShown, filled } from '../src/pages/advisor/expertise/ProfileZone.jsx';
import { RESEARCH_STORE_GAPS } from '../src/workspaces/noStoreCopy.js';
import { ADVISOR_ZONE_FILTERS } from '../src/workspaces/advisorZoneFilters.js';
import { ADVISOR_ZONE_ACTIONS } from '../src/workspaces/advisorZoneActions.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));
const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const prop = (over) => ({
  uid: 'p1', status: 'pending', counterpart_status: 'pending', responded_at: null, counterpart_responded_at: null,
  target: { name: 'Dev Rao', role: 'founder' }, terms: null, ...over,
});
const card = (row) => renderedText(renderToStaticMarkup(React.createElement(PropositionCard, { row })));

// ── Introductions ──────────────────────────────────────────────────────────

test('D392: an advisor sees both sides of the consent, not only their own', () => {
  const oneSide = card(prop({ status: 'accepted', responded_at: '2026-09-01 10:00:00' }));
  assert.match(oneSide, /One side/);
  assert.match(oneSide, /You agreed/);
  assert.match(oneSide, /Dev Rao not recorded/);
  assert.doesNotMatch(oneSide, /You accepted\b(?! ·)/, 'the one-sided "You accepted" chip is gone');

  const both = card(prop({ status: 'accepted', counterpart_status: 'accepted' }));
  assert.match(both, /Both agreed/);
  assert.match(both, /Record as made/, 'once both agree, the advisor can record that it happened');

  const unasked = card(prop({ status: 'pending', counterpart_status: null }));
  assert.match(unasked, /Dev Rao has not been asked/, 'no mirror row is never "not answered"');

  const made = card(prop({ status: 'accepted', counterpart_status: 'accepted', terms: { kind: 'favour', made_at: '2026-09-10', outcome: null } }));
  assert.match(made, /Made/);
  assert.match(made, /no outcome recorded/);

  const theyDeclined = card(prop({ status: 'accepted', counterpart_status: 'declined' }));
  assert.match(theyDeclined, /Declined/);
  assert.doesNotMatch(theyDeclined, /Record as made/);
});

test('D392: the four chips are live, and each narrows by the shared state', () => {
  const row = ADVISOR_ZONE_FILTERS['network/introductions'];
  assert.deepEqual(row.map((r) => r.canvas), ['All', 'Gated', 'Made', 'Declined']);
  assert.ok(row.every((r) => r.key && !r.unbuilt && !r.label), 'every chip is live and named as the canvas names it');
  const rows = [
    prop({ uid: 'req' }),
    prop({ uid: 'one', status: 'accepted' }),
    prop({ uid: 'both', status: 'accepted', counterpart_status: 'accepted' }),
    prop({ uid: 'made', status: 'accepted', counterpart_status: 'accepted', terms: { made_at: '2026-09-10' } }),
    prop({ uid: 'no', counterpart_status: 'declined' }),
    prop({ uid: 'old', status: 'expired' }),
  ];
  const ids = (k) => rows.filter(NARROW[k]).map((r) => r.uid);
  assert.deepEqual(ids('gated'), ['req', 'one']);
  assert.deepEqual(ids('made'), ['made']);
  assert.deepEqual(ids('declined'), ['no']);
});

test('D392: Consent log is a handler the zone supplies, and the retired claims are gone', () => {
  const ops = ADVISOR_ZONE_ACTIONS['network/introductions'];
  assert.deepEqual(ops.find((o) => o.label === 'Consent log'), { label: 'Consent log', kind: 'handler', handler: 'consentLog' });
  const zone = read('frontend/src/pages/advisor/network/IntroductionsZone.jsx');
  assert.match(zone, /consentLog: \{\s*onClick: \(\) => setLogOpen\(true\)/);
  // Inside the zone component itself, and only there — the first draft also
  // put it in the made form, where `logOpen` does not exist; lint caught it,
  // and this now does.
  const at = zone.indexOf('export default function IntroductionsZone');
  assert.match(zone.slice(at), /\{logOpen && <ConsentLog rows=\{state\.rows\}/);
  assert.doesNotMatch(zone.slice(0, at), /<ConsentLog/);
  const filters = read('frontend/src/workspaces/advisorZoneFilters.js');
  assert.doesNotMatch(filters, /NO_CONNECTED_STATE|Awaiting you/);
  assert.doesNotMatch(raw('frontend/src/pages/advisor/network/IntroductionsZone.jsx'),
    /returns only YOUR row|a decline is never reported back/);
});

// ── Research ───────────────────────────────────────────────────────────────

test('D392: the Markets gap no longer says the page reads the signals feed, and names who it is true for', () => {
  const m = RESEARCH_STORE_GAPS.markets;
  assert.deepEqual(m.roles, ['founder', 'investor']);
  assert.doesNotMatch(m.why, /reads instead is the signals feed/);
  assert.match(m.why, /comparable readings/);
  assert.doesNotMatch(m.heading, /^Signals are stored/);
  const ws = read('frontend/src/workspaces/ResearchWorkspace.jsx');
  assert.match(ws, /markets: 'Comparable ranges you entered/);
  assert.doesNotMatch(ws, /markets: 'Signals from the sectors/);
});

test('D392: the gap card is drawn only for the licences its entry names', () => {
  const ws = read('frontend/src/workspaces/ResearchWorkspace.jsx');
  const scope = ws.match(/const gap = (storeGap && \(!storeGap\.roles \|\| storeGap\.roles\.includes\(role\)\) \? storeGap : null);/);
  assert.ok(scope, 'the role scope is gone');
  // Evaluate the page's own expression against each licence.
  // eslint-disable-next-line no-new-func
  const pick = new Function('storeGap', 'role', `return ${scope[1]};`);
  for (const role of ['founder', 'investor']) assert.equal(pick(RESEARCH_STORE_GAPS.markets, role), RESEARCH_STORE_GAPS.markets, role);
  for (const role of ['partner', 'advisor']) assert.equal(pick(RESEARCH_STORE_GAPS.markets, role), null, role);
  assert.equal(pick(RESEARCH_STORE_GAPS.companies, 'advisor'), RESEARCH_STORE_GAPS.companies,
    'an entry with no roles is shown to everyone, as before');
});

// ── Expertise ──────────────────────────────────────────────────────────────

test('D392: Profile chips — Match-critical is the meter\'s list, Gaps reads the saved record', () => {
  const keys = MATCH_FIELDS.map(([, k]) => k);
  assert.ok(fieldShown('match', 'headline', {}));
  assert.ok(!fieldShown('match', 'bio', {}), 'a field the meter does not count is not match-critical');
  for (const k of keys) assert.ok(fieldShown('match', k, {}), k);
  const saved = { headline: 'ex-Stripe PM', sectors: [], bio: '  ' };
  assert.ok(!fieldShown('gaps', 'headline', saved), 'a filled field is not a gap');
  assert.ok(fieldShown('gaps', 'sectors', saved), 'an empty list is a gap');
  assert.ok(fieldShown('gaps', 'bio', saved), 'whitespace is a gap');
  assert.ok(fieldShown('all', 'bio', saved));
  assert.equal(filled({ stages: ['seed'] }, 'stages'), true);
});

test('D392: Services, Proof and Thinking narrow the list they draw, and export it', () => {
  for (const [file, zone] of [
    ['ServicesZone.jsx', 'expertise/services'],
    ['ProofZone.jsx', 'expertise/proof'],
    ['ThinkingZone.jsx', 'expertise/thinking'],
  ]) {
    const src = read(`frontend/src/pages/advisor/expertise/${file}`);
    assert.match(src, new RegExp(`advisorZoneFilters\\('${zone.replace('/', '\\/')}', \\{ value: view, onChange: setView \\}\\)`), file);
    // Filtered inline, or looked up from lists the page already filtered.
    assert.match(src, /const shown = [^;]*(\.filter\(|_VIEWS\[view\])/, `${file} narrows`);
    assert.match(src, /shown\.map\(/, `${file} draws the narrowed list`);
    assert.match(src, new RegExp(`advisorZoneActions\\('${zone.replace('/', '\\/')}'[^;]*rows: shown`), `${file} exports the narrowed list`);
  }
  const proof = read('frontend/src/pages/advisor/expertise/ProofZone.jsx');
  assert.match(proof, /PROOF_VIEWS = \{ attested: attested, awaiting: awaiting, self: selfStated \}/,
    'the chips are the strip\'s own three counts');
  const thinking = read('frontend/src/pages/advisor/expertise/ThinkingZone.jsx');
  assert.match(thinking, /draft: \(a\) => a\.status !== 'published'/, 'Drafts is what the shelf labels Draft');
});

test('D392: the chips a store cannot serve say what is missing', () => {
  const unbuilt = Object.entries(ADVISOR_ZONE_FILTERS)
    .filter(([z]) => z.startsWith('expertise/'))
    .flatMap(([z, rows]) => rows.filter((r) => r.unbuilt).map((r) => `${z} · ${r.canvas}`));
  assert.deepEqual(unbuilt, ['expertise/profile · Public preview', 'expertise/thinking · Essays']);
});

test('D392: no Expertise figure is a typed zero or a bare dash', () => {
  const proof = read('frontend/src/pages/advisor/expertise/ProofZone.jsx');
  assert.doesNotMatch(proof, /value: '—'/, 'Credential verified is absent, not a dash');
  assert.match(proof, /s\.value === null \? <Unrecorded \/>/);
  const thinking = read('frontend/src/pages/advisor/expertise/ThinkingZone.jsx');
  assert.doesNotMatch(thinking, /views \?\? 0|word_count \|\| 0/);
});
