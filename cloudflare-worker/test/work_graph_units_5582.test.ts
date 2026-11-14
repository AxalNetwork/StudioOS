/**
 * D5582 part 1 (#5582, WorkGraph P1) — document, deck, offer and legal units, and the merge plan over them:
 *
 *   1. Acceptance 1: two agents editing separate slides (or clauses) lose nothing; two editing the same clause get
 *      a reviewable conflict carrying both variants, never a silent replacement; only a person picks a variant.
 *   2. Acceptance 2: a frozen export pins the exact approved deck revision and its media versions; any later edit
 *      to a unit changes the digest, so the old approval no longer releases it (D5579's validator).
 *   3. Acceptance 3: signed evidence has no unit and refuses a merge and a ChangeSet; another tenant's deck and an
 *      agent's approval are refused.
 *   4. The guarded text merge: disjoint line edits of a plain clause merge; touching or overlapping lines, a
 *      sensitive clause, an offer term and a deck layout are conflicts.
 *   5. Sensitive review: a changed price, equity, party, jurisdiction or figure is listed for a person, and a legal
 *      template candidate always needs confirmation.
 *   6. The adapters: clause ids from numbering and slugs, unique; deck areas on D1500 uids and D1577 areas; a block
 *      with no id is the card's layout unit; the SourceRef names the canonical table and revision (D5579 §2).
 *
 * Pure: no database. Every party, figure and clause is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_units_5582.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clausesOf, deckUnits, legalTemplateUnits, quoteUnits, sensitiveIn, signedEnvelopeUnits, unitsDigest, type Unit,
} from '../src/services/workGraphUnits.ts';
import { chooseVariant, mergeLines, planMerge, readyForReview, type MergePlan } from '../src/services/workGraphMerge.ts';
import { validateWorkGraph, type Actor, type Scope, type WorkGraph } from '../src/services/workGraphContracts.ts';

const SCOPE: Scope = { tenantId: 3, companyId: 30, projectId: 300 };
const PERSON: Actor = { kind: 'person', userId: 9 };
const RESEARCH: Actor = { kind: 'agent', agentRunId: 'run_research', onBehalfOfUserId: 9, chargeId: null };

const plan = (p: ReturnType<typeof planMerge>): MergePlan => {
  assert.ok(!('ok' in p), `expected a plan, got ${JSON.stringify(p)}`);
  return p as MergePlan;
};

const card = (uid: string, title: string, blocks: any[] = []) => ({ uid, title, layout: 'two_columns', blocks });
const text = (id: string, t: string) => ({ id, kind: 'text', text: t, grid: { c1: 1, c2: 6, r1: 2, r2: 6 } });
const deck = (id: number, slides: any[], hash: string | null = null) => deckUnits({ id, version: id, content_hash: hash, slides });

const TEMPLATE = [
  'Preamble line.',
  '# 1. Definitions',
  'Terms used here.',
  'Second definition line.',
  'Third definition line.',
  '# 2. Confidentiality',
  'Each party keeps the other party\'s information confidential.',
  '# 3. Governing law',
  'This agreement is governed by the laws of England.',
].join('\n');

const tpl = (body: string, version = 1) => legalTemplateUnits({ template_id: 41, version, body_md: body });

test('6. adapters: clause ids, deck areas and canonical SourceRefs', () => {
  const t = tpl(TEMPLATE, 4);
  assert.deepEqual(t.units.map((u) => u.id), ['__preamble', '1', '2', '3']);
  assert.deepEqual(t.source, { store: 'd1_record', locator: 'legal_template_versions', id: '41:4', revision: '4' });
  assert.deepEqual(clausesOf('# Scope\na\n# Scope\nb', 'section').map((u) => u.id), ['scope', 'scope-2']);
  assert.deepEqual(clausesOf('', 'clause'), []);

  const d = deck(7, [card('intro', 'Hello', [text('b1', 'one'), { kind: 'image', src: 'x' }]), { title: 'No uid' }], 'a'.repeat(64));
  assert.deepEqual(d.units.map((u) => u.id), ['intro/__title', 'intro/b1', 'intro/__layout', 'c2/__title', 'c2/__layout']);
  assert.equal(d.units.find((u) => u.id === 'intro/__layout')!.kind, 'card_layout');
  assert.equal(d.units.find((u) => u.id === 'intro/__layout')!.textMergeable, false);
  assert.deepEqual(d.source, { store: 'd1_record', locator: 'pitch_decks', id: '7', revision: 'a'.repeat(64) });
  assert.equal(deck(8, []).source.revision, 'v8', 'a version written before content_hash falls back to its number');

  const q = quoteUnits({ id: 5, quote_id: 2, version: 3, change_summary: 'Split into phases', note: null, price_cents: 120000 });
  assert.deepEqual(q.units.map((u) => [u.id, u.textMergeable]), [['price_cents', false], ['change_summary', false], ['note', false]]);
  assert.deepEqual(q.units[0].sensitive, ['money'], 'a price is money whatever its words');
  assert.deepEqual(q.source, { store: 'd1_record', locator: 'quote_versions', id: '5', revision: '3' });
});

test('1a. two agents edit separate slides: nothing is lost', async () => {
  const base = deck(1, [card('s1', 'Problem', [text('b', 'old problem')]), card('s2', 'Solution', [text('b', 'old solution')])]);
  const ours = deck(1, [card('s1', 'Problem', [text('b', 'sharper problem')]), card('s2', 'Solution', [text('b', 'old solution')])]);
  const theirs = deck(1, [card('s1', 'Problem', [text('b', 'old problem')]), card('s2', 'Solution', [text('b', 'clearer solution')])]);
  const p = plan(planMerge('pitch_deck', base.units, ours.units, theirs.units));
  assert.equal(p.outcomes['s1/b'], 'ours');
  assert.equal(p.outcomes['s2/b'], 'theirs');
  assert.deepEqual(p.conflicts, []);
  assert.ok(p.units.find((u) => u.id === 's1/b')!.text.includes('sharper'));
  assert.ok(p.units.find((u) => u.id === 's2/b')!.text.includes('clearer'));
  assert.equal(p.requiresHumanConfirmation, true, 'a candidate combining both sides is confirmed by a person');
  assert.ok(readyForReview(p));
  // The order of the deck is kept.
  assert.deepEqual(p.units.map((u) => u.id), base.units.map((u) => u.id));
  // The combined candidate is a new digest, different from either side's.
  const dig = await unitsDigest(p.units);
  assert.notEqual(dig, await unitsDigest(ours.units));
  assert.notEqual(dig, await unitsDigest(theirs.units));
});

test('1b. the same clause edited twice is a reviewable conflict, never a silent replacement', () => {
  const base = tpl(TEMPLATE);
  const ours = tpl(TEMPLATE.replace("keeps the other party's information confidential", 'keeps all information secret'));
  const theirs = tpl(TEMPLATE.replace("keeps the other party's information confidential", 'protects shared information'));
  const p = plan(planMerge('legal_template', base.units, ours.units, theirs.units));
  assert.equal(p.outcomes['2'], 'conflict');
  assert.equal(p.conflicts.length, 1);
  const c = p.conflicts[0];
  assert.equal(c.reason, 'text_overlap');
  assert.ok(c.ours!.text.includes('secret') && c.theirs!.text.includes('protects'), 'both variants are carried');
  assert.equal(p.units.find((u) => u.id === '2')!.value, base.units.find((u) => u.id === '2')!.value, 'the unit holds its base until a person picks');
  assert.equal(readyForReview(p), false);

  // Only a person picks a variant; the result still needs confirmation.
  assert.deepEqual(chooseVariant(p, '2', 'ours', RESEARCH), { ok: false, code: 'not_a_person' });
  assert.deepEqual(chooseVariant(p, '1', 'ours', PERSON), { ok: false, code: 'not_in_conflict' });
  assert.deepEqual(chooseVariant(p, 'nope', 'ours', PERSON), { ok: false, code: 'unknown_unit' });
  const picked = chooseVariant(p, '2', 'theirs', PERSON) as MergePlan;
  assert.ok(picked.units.find((u) => u.id === '2')!.text.includes('protects'));
  assert.equal(readyForReview(picked), true);
  assert.equal(picked.requiresHumanConfirmation, true);
});

test('1c. delete against change, and two different additions under one id, are conflicts', () => {
  const base = tpl(TEMPLATE);
  const dropped = tpl(TEMPLATE.replace(/# 2\. Confidentiality\n[^\n]*\n/, ''));
  const edited = tpl(TEMPLATE.replace('Each party keeps', 'Every party keeps'));
  const p = plan(planMerge('legal_template', base.units, dropped.units, edited.units));
  assert.deepEqual(p.conflicts.map((c) => [c.unitId, c.reason]), [['2', 'delete_vs_change']]);
  const kept = chooseVariant(p, '2', 'ours', PERSON) as MergePlan;
  assert.equal(kept.units.some((u) => u.id === '2'), false, 'picking the deletion removes the clause');

  const a = tpl(`${TEMPLATE}\n# 4. Notices\nBy email.`);
  const b = tpl(`${TEMPLATE}\n# 4. Notices\nBy post.`);
  assert.deepEqual(plan(planMerge('legal_template', base.units, a.units, b.units)).conflicts.map((c) => c.reason), ['both_added']);
});

test('4. the guarded text merge', () => {
  // Disjoint lines of a plain clause merge, and only that clause is touched.
  const base = tpl(TEMPLATE);
  const ours = tpl(TEMPLATE.replace('Terms used here.', 'Terms used in this agreement.'));
  const theirs = tpl(TEMPLATE.replace('Third definition line.', 'Third definition, reworded.'));
  const p = plan(planMerge('legal_template', base.units, ours.units, theirs.units));
  assert.equal(p.outcomes['1'], 'text_merged');
  const merged = p.units.find((u) => u.id === '1')!.text;
  assert.ok(merged.includes('Terms used in this agreement.') && merged.includes('Third definition, reworded.'));
  assert.equal(p.requiresHumanConfirmation, true);

  // Adjacent lines touch: a conflict.
  const adj = tpl(TEMPLATE.replace('Second definition line.', 'Second, changed.'));
  assert.equal(plan(planMerge('legal_template', base.units, ours.units, adj.units)).outcomes['1'], 'conflict');

  // A sensitive clause (governing law) is never text-merged, even with disjoint edits.
  const lawO = tpl(TEMPLATE.replace('This agreement is governed', 'This Agreement is governed'));
  const lawT = tpl(TEMPLATE.replace('laws of England.', 'laws of England.\nNo other law applies.'));
  const law = plan(planMerge('legal_template', base.units, lawO.units, lawT.units));
  assert.deepEqual(law.conflicts.map((c) => [c.unitId, c.reason]), [['3', 'sensitive']]);

  // An offer term is never text-merged.
  const q = (summary: string) => quoteUnits({ id: 1, quote_id: 1, version: 1, change_summary: summary, note: null, price_cents: null }).units;
  const offer = plan(planMerge('offer', q('Phase one\nPhase two'), q('Phase one, shorter\nPhase two'), q('Phase one\nPhase two, longer')));
  assert.deepEqual(offer.conflicts.map((c) => [c.unitId, c.reason]), [['change_summary', 'not_text_mergeable']]);

  // The kind decides too: text-mergeable sections under an offer are still not merged.
  const sec = (body: string) => clausesOf(body, 'section');
  const offerDoc = plan(planMerge('offer', sec('# A\none\ntwo\nthree'), sec('# A\nONE\ntwo\nthree'), sec('# A\none\ntwo\nTHREE')));
  assert.deepEqual(offerDoc.conflicts.map((c) => [c.unitId, c.reason]), [['a', 'not_text_mergeable']]);

  // The identical edit on both sides is taken once, not a conflict.
  const same = tpl(TEMPLATE.replace('Terms used here.', 'Terms used in this agreement.'));
  const sp = plan(planMerge('legal_template', base.units, same.units, same.units));
  assert.equal(sp.outcomes['1'], 'same');
  assert.deepEqual(sp.conflicts, []);

  // A deck layout unit is never text-merged.
  const lay = (layout: string) => deckUnits({ id: 1, version: 1, slides: [{ uid: 'k', title: 't', layout }] }).units;
  assert.deepEqual(plan(planMerge('pitch_deck', lay('a'), lay('b'), lay('c'))).conflicts.map((c) => c.reason), ['not_text_mergeable']);

  // Line merge itself: insertions at one point, and a replace of the same line, conflict.
  assert.equal(mergeLines('a\nb\nc', 'a\nX\nb\nc', 'a\nY\nb\nc'), null);
  assert.equal(mergeLines('a\nb\nc', 'a\nB\nc', 'a\nBB\nc'), null);
  assert.equal(mergeLines('a\nb\nc\nd\ne', 'A\nb\nc\nd\ne', 'a\nb\nc\nd\nE'), 'A\nb\nc\nd\nE');
  assert.equal(mergeLines('a\nb', 'a\nb', 'a\nb'), 'a\nb');
});

test('5. sensitive changes are listed for a person; a legal template always needs confirmation', () => {
  const base = tpl(TEMPLATE);
  const party = tpl(TEMPLATE.replace('Each party keeps', 'Acme Widgets Ltd keeps'));
  const p = plan(planMerge('legal_template', base.units, party.units, base.units));
  assert.equal(p.outcomes['2'], 'ours');
  assert.deepEqual(p.review, [{ unitId: '2', categories: ['legal_entity'] }]);
  assert.equal(p.requiresHumanConfirmation, true);

  const quiet = tpl(TEMPLATE.replace('Preamble line.', 'Preamble, reworded.'));
  const q = plan(planMerge('legal_template', base.units, quiet.units, base.units));
  assert.deepEqual(q.review, []);
  assert.equal(q.requiresHumanConfirmation, true, 'legal templates always need a person');

  // A deck with one plain change by one side and nothing sensitive needs no confirmation of its own.
  const d0 = deck(1, [card('s', 'Story', [text('b', 'plain words')])]);
  const d1 = deck(1, [card('s', 'Story', [text('b', 'other plain words')])]);
  assert.equal(plan(planMerge('pitch_deck', d0.units, d1.units, d0.units)).requiresHumanConfirmation, false);

  // A metric block is an investor claim even with no telling word.
  const m0 = deck(1, [card('s', 'Story', [{ id: 'm', kind: 'metric', value: '12' }])]);
  const m1 = deck(1, [card('s', 'Story', [{ id: 'm', kind: 'metric', value: '15' }])]);
  const mp = plan(planMerge('pitch_deck', m0.units, m1.units, m0.units));
  assert.deepEqual(mp.review, [{ unitId: 's/m', categories: ['investor_claim'] }]);
  assert.equal(mp.requiresHumanConfirmation, true, 'a sensitive change alone needs a person, merged or not');

  for (const [t, cat] of [
    ['a fee of $5,000', 'money'], ['10% of the shares', 'equity'], ['signed by both', 'signature'],
    ['indemnify the buyer', 'liability'], ['Acme GmbH', 'legal_entity'], ['the courts of Paris', 'jurisdiction'],
    ['ARR grew 3x', 'investor_claim'],
  ] as const) {
    assert.ok(sensitiveIn(t).includes(cat), `${t} -> ${cat}`);
  }
  assert.deepEqual(sensitiveIn('A plain sentence about the weather.'), []);
});

test('2. a frozen export pins the approved revision and its media; a later edit needs renewed approval', async () => {
  const v1 = deck(11, [card('s1', 'Problem', [text('b', 'the problem'), { id: 'img', kind: 'image', image_uid: 'img_1' }])]);
  const d1 = await unitsDigest(v1.units);
  const imgDigest = 'b'.repeat(64);
  const graph = (deckDigest: string, approvedDigest: string): WorkGraph => ({
    workItems: [{ id: 'wi', scope: SCOPE, deliverableAssetId: 'deck', modifies: [], baseVersionId: 'dv1', dependsOn: [], author: RESEARCH, priority: 1, risk: 'medium', idempotencyKey: 'k' }],
    assets: [
      { id: 'deck', scope: SCOPE, kind: 'pitch_deck', headVersionId: 'dv1', accessClass: 'confidential', approvalPolicy: 'human_publication' },
      { id: 'img', scope: SCOPE, kind: 'image', headVersionId: 'iv1', accessClass: 'confidential', approvalPolicy: 'human_publication' },
    ],
    versions: [
      { id: 'dv1', assetId: 'deck', scope: SCOPE, parents: [], digest: deckDigest, byteLength: 1, mediaProfile: 'application/json', source: v1.source, recipe: null, residency: null, license: null, author: RESEARCH, createdAt: 't', expiresAt: null },
      { id: 'iv1', assetId: 'img', scope: SCOPE, parents: [], digest: imgDigest, byteLength: 1, mediaProfile: 'image/png', source: { store: 'r2_object', locator: 'FILES', id: 'deck-images/300/img_1.png', revision: imgDigest }, recipe: null, residency: null, license: null, author: RESEARCH, createdAt: 't', expiresAt: null },
    ],
    changeSets: [
      { id: 'cs-d', scope: SCOPE, workItemId: 'wi', assetId: 'deck', baseVersionId: 'dv1', proposedDigest: deckDigest, components: [], author: RESEARCH, idempotencyKey: 'k-d' },
      { id: 'cs-i', scope: SCOPE, workItemId: 'wi', assetId: 'img', baseVersionId: 'iv1', proposedDigest: imgDigest, components: [], author: RESEARCH, idempotencyKey: 'k-i' },
    ],
    reviews: [
      { id: 'r-d', scope: SCOPE, changeSetId: 'cs-d', contentDigest: approvedDigest, decision: 'approve', reviewer: PERSON, approvalRef: null, decidedAt: 't' },
      { id: 'r-i', scope: SCOPE, changeSetId: 'cs-i', contentDigest: imgDigest, decision: 'approve', reviewer: PERSON, approvalRef: null, decidedAt: 't' },
    ],
    releases: [{
      id: 'export', scope: SCOPE, approvalIds: ['r-d', 'r-i'], expectedPreviousId: null, idempotencyKey: 'k-x',
      components: [{ assetId: 'deck', versionId: 'dv1', digest: deckDigest }, { assetId: 'img', versionId: 'iv1', digest: imgDigest }],
    }],
  });
  // The export as approved: clean.
  assert.deepEqual(validateWorkGraph(graph(d1, d1), { scope: SCOPE }), []);

  // Any later edit to any unit makes a new digest; the old approval does not release it.
  const v2 = deck(11, [card('s1', 'Problem', [text('b', 'the problem, edited'), { id: 'img', kind: 'image', image_uid: 'img_1' }])]);
  const d2 = await unitsDigest(v2.units);
  assert.notEqual(d2, d1);
  const codes = validateWorkGraph(graph(d2, d1), { scope: SCOPE }).map((v) => v.code).sort();
  assert.deepEqual(codes, ['stale_approval', 'unapproved_release']);

  // Reordering cards alone also changes the digest.
  const swapped = deck(11, [card('s2', 'B'), card('s1', 'A')]);
  const straight = deck(11, [card('s1', 'A'), card('s2', 'B')]);
  assert.notEqual(await unitsDigest(swapped.units), await unitsDigest(straight.units));
});

test('3. signed evidence, another tenant and an agent approval are refused', () => {
  const env = signedEnvelopeUnits({ envelope_uuid: 'env-1', body_sha256: 'c'.repeat(64) });
  assert.deepEqual(env.units, []);
  assert.deepEqual(env.source, { store: 'esign_envelope', locator: 'esign', id: 'env-1', revision: 'c'.repeat(64) });
  const u: Unit[] = [];
  assert.deepEqual(planMerge('legal_signed', u, u, u), { ok: false, code: 'immutable_record' });

  const base: WorkGraph = {
    workItems: [{ id: 'wi', scope: SCOPE, deliverableAssetId: 'sig', modifies: [], baseVersionId: 'sv', dependsOn: [], author: RESEARCH, priority: 1, risk: 'high', idempotencyKey: 'k' }],
    assets: [{ id: 'sig', scope: SCOPE, kind: 'legal_signed', headVersionId: 'sv', accessClass: 'restricted', approvalPolicy: 'human_publication' }],
    versions: [{ id: 'sv', assetId: 'sig', scope: SCOPE, parents: [], digest: 'c'.repeat(64), byteLength: 1, mediaProfile: 'application/pdf', source: env.source, recipe: null, residency: null, license: null, author: PERSON, createdAt: 't', expiresAt: null }],
    changeSets: [{ id: 'cs', scope: SCOPE, workItemId: 'wi', assetId: 'sig', baseVersionId: 'sv', proposedDigest: 'd'.repeat(64), components: [], author: RESEARCH, idempotencyKey: 'k2' }],
  };
  assert.deepEqual(validateWorkGraph(base, { scope: SCOPE }).map((v) => v.code), ['immutable_record']);

  // Another tenant's deck is refused for this caller.
  const other = { ...SCOPE, companyId: 31 };
  const d = deck(1, [card('s', 'x')]);
  const g: WorkGraph = { assets: [{ id: 'deck', scope: other, kind: 'pitch_deck', headVersionId: null, accessClass: 'confidential', approvalPolicy: 'human_publication' }] };
  assert.deepEqual(validateWorkGraph(g, { scope: SCOPE }).map((v) => v.code), ['wrong_tenant']);
  assert.equal(d.kind, 'pitch_deck');

  // A legal template's ChangeSet approved by an agent is refused.
  const t: WorkGraph = {
    workItems: [{ id: 'wi', scope: SCOPE, deliverableAssetId: 'tpl', modifies: [], baseVersionId: 'tv', dependsOn: [], author: RESEARCH, priority: 1, risk: 'high', idempotencyKey: 'k' }],
    assets: [{ id: 'tpl', scope: SCOPE, kind: 'legal_template', headVersionId: 'tv', accessClass: 'internal', approvalPolicy: 'human_publication' }],
    versions: [{ id: 'tv', assetId: 'tpl', scope: SCOPE, parents: [], digest: 'e'.repeat(64), byteLength: 1, mediaProfile: 'text/markdown', source: tpl(TEMPLATE).source, recipe: null, residency: null, license: null, author: PERSON, createdAt: 't', expiresAt: null }],
    changeSets: [{ id: 'cs', scope: SCOPE, workItemId: 'wi', assetId: 'tpl', baseVersionId: 'tv', proposedDigest: 'f'.repeat(64), components: [], author: RESEARCH, idempotencyKey: 'k2' }],
    reviews: [{ id: 'r', scope: SCOPE, changeSetId: 'cs', contentDigest: 'f'.repeat(64), decision: 'approve', reviewer: RESEARCH, approvalRef: null, decidedAt: 't' }],
  };
  assert.deepEqual(validateWorkGraph(t, { scope: SCOPE }).map((v) => v.code), ['agent_review']);
});
