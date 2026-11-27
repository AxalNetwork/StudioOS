/**
 * D5582 part 2 (#5582) — drafts and merged candidates on #5581's revision store, written where each domain keeps
 * drafts (the owner's narrowed option B, 2026-11-14). The database is the baseline plus every migration
 * (`_schema_once.mjs`), so `work_graph_*`, `pitch_deck_proposals`, `legal_templates` and
 * `legal_template_research_drafts` are the real tables.
 *
 *   1. An asset is drafted only for a deck, a template or an offer, always under `human_publication`.
 *   2. Only a person adopts the domain's current row as the head; wrong tenant and wrong kind are refused.
 *   3. Deck: two agents' separate-slide drafts become ONE `pitch_deck_proposals` row (the founder's Keep/Discard)
 *      and one WorkGraph revision on the head. The head does not move. A retry writes nothing new; a different
 *      candidate while one waits is `proposal_waiting` and leaves the row as it was.
 *   4. A conflict, a stale head and an agent's typed figure write nothing.
 *   5. After the person's publish, the head moves only if the published units are exactly the approved ones; an
 *      agent cannot confirm.
 *   6. Template: the candidate is a `legal_template_research_drafts` row pending counsel review whose notes carry
 *      the digest and no clause text; `legal_templates` is untouched; a second, different candidate is refused.
 *   7. Offer: nothing is stored; the partner's own save, confirmed, becomes the head.
 *   8. Units read back into the domain's form exactly (cards with loose blocks between addressed ones; markdown).
 *
 * Every studio, person, figure and clause is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/work_graph_drafting_5582.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { WORK_GRAPH_DEPS } from '../src/services/workGraphRevisions.ts';
import type { Actor, Scope, ValidationContext } from '../src/services/workGraphContracts.ts';
import {
  DRAFTING_POLICY, adoptCurrent, confirmPublished, proposeCandidate, registerDraftedAsset,
} from '../src/services/workGraphDrafting.ts';
import {
  clausesOf, deckUnits, legalTemplateUnits, markdownFromUnits, quoteUnits, slidesFromUnits, unitsDigest,
} from '../src/services/workGraphUnits.ts';
import { assignCardUids } from '../src/services/decks/cardUids.ts';

const NOW = new Date('2026-11-14T10:00:00Z');
WORK_GRAPH_DEPS.now = () => NOW;
let n = 0;
WORK_GRAPH_DEPS.newId = () => `id${++n}`;

const SCOPE: Scope = { tenantId: 4, companyId: 40, projectId: 400 };
const CTX: ValidationContext = { scope: SCOPE };
const FOUNDER: Actor = { kind: 'person', userId: 21 };
const COUNSEL: Actor = { kind: 'person', userId: 22 };
const WRITER: Actor = { kind: 'agent', agentRunId: 'run_writer', onBehalfOfUserId: 21, chargeId: 'chg_w' };
const VISUALS: Actor = { kind: 'agent', agentRunId: 'run_visuals', onBehalfOfUserId: 21, chargeId: 'chg_v' };

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return { db, env: { DB: d1Over(db) } as any };
}
type W = ReturnType<typeof world>;
const count = (w: W, table: string) => Number((w.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
const head = (w: W, uid: string) => (w.db.prepare('SELECT head_revision_uid AS h FROM work_graph_assets WHERE asset_uid = ?').get(uid) as any).h;

const card = (uid: string, title: string, body: string) => ({ uid, title, layout: 'two_columns', blocks: [{ id: 'b', kind: 'text', text: body }] });
const deckRow = (id: number, slides: any[]) => deckUnits({ id, version: id, slides });

async function deckAsset(w: W, key = 'deck') {
  const r: any = await registerDraftedAsset(w.env, CTX, { scope: SCOPE, kind: 'pitch_deck', accessClass: 'confidential', actor: FOUNDER, idempotencyKey: `a-${key}` });
  assert.equal(r.ok, true, JSON.stringify(r));
  const base = deckRow(1, [card('s1', 'Problem', 'the old problem'), card('s2', 'Solution', 'the old solution')]);
  const a: any = await adoptCurrent(w.env, CTX, { assetUid: r.assetUid, expectedRevisionUid: null, current: base, by: FOUNDER, idempotencyKey: `adopt-${key}` });
  assert.equal(a.ok, true, JSON.stringify(a));
  return { assetUid: r.assetUid as string, headUid: a.revisionUid as string, base };
}

const twoSlideDrafts = () => ({
  ours: deckRow(1, [card('s1', 'Problem', 'a sharper problem'), card('s2', 'Solution', 'the old solution')]),
  theirs: deckRow(1, [card('s1', 'Problem', 'the old problem'), card('s2', 'Solution', 'a clearer solution')]),
});

const deckTarget = { kind: 'pitch_deck' as const, projectId: 400, baseDeckId: 1, title: 'Seed deck', createdByUserId: 21 };

test('1. only decks, templates and offers are drafted, always under human_publication', async () => {
  const w = world();
  for (const kind of ['legal_signed', 'composite', 'image'] as const) {
    const r: any = await registerDraftedAsset(w.env, CTX, { scope: SCOPE, kind, accessClass: 'restricted', actor: FOUNDER, idempotencyKey: `k-${kind}` });
    assert.deepEqual([r.ok, r.code], [false, 'not_drafted_kind']);
  }
  const { assetUid } = await deckAsset(w);
  assert.equal((w.db.prepare('SELECT approval_policy AS p FROM work_graph_assets WHERE asset_uid = ?').get(assetUid) as any).p, DRAFTING_POLICY);
});

test('2. only a person adopts the current row; wrong tenant and wrong kind are refused', async () => {
  const w = world();
  const r: any = await registerDraftedAsset(w.env, CTX, { scope: SCOPE, kind: 'pitch_deck', accessClass: 'confidential', actor: FOUNDER, idempotencyKey: 'a' });
  const base = deckRow(1, [card('s1', 'Problem', 'x')]);
  assert.deepEqual(await adoptCurrent(w.env, CTX, { assetUid: r.assetUid, expectedRevisionUid: null, current: base, by: WRITER, idempotencyKey: 'x' }),
    { ok: false, code: 'person_required', ids: [r.assetUid] });
  const other: ValidationContext = { scope: { ...SCOPE, companyId: 41 } };
  assert.equal(((await adoptCurrent(w.env, other, { assetUid: r.assetUid, expectedRevisionUid: null, current: base, by: FOUNDER, idempotencyKey: 'y' })) as any).code, 'not_found');
  const tpl = legalTemplateUnits({ template_id: 1, version: 1, body_md: '# 1. A\nx' });
  assert.equal(((await adoptCurrent(w.env, CTX, { assetUid: r.assetUid, expectedRevisionUid: null, current: tpl, by: FOUNDER, idempotencyKey: 'z' })) as any).code, 'kind_mismatch');
  assert.equal(head(w, r.assetUid), null, 'nothing moved');
});

test('3. deck: two agents\' separate drafts become one proposal and one revision; the head does not move', async () => {
  const w = world();
  const { assetUid, headUid, base } = await deckAsset(w);
  const { ours, theirs } = twoSlideDrafts();
  const input = {
    assetUid, headRevisionUid: headUid, base: base.units, ours: ours.units, theirs: theirs.units, author: WRITER,
    contributors: { ours: 'run_writer', theirs: 'run_visuals' }, target: deckTarget, idempotencyKey: 'cand-1',
  };
  const r: any = await proposeCandidate(w.env, CTX, input);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(count(w, 'pitch_deck_proposals'), 1);
  const row = w.db.prepare('SELECT * FROM pitch_deck_proposals').get() as any;
  assert.equal(row.project_id, 400);
  assert.equal(row.base_deck_id, 1);
  assert.equal(row.method_id, null);
  const slides = JSON.parse(row.slides);
  assert.equal(slides[0].blocks[0].text, 'a sharper problem');
  assert.equal(slides[1].blocks[0].text, 'a clearer solution');
  // The proposal's slides read back as exactly the candidate the revision describes.
  assert.equal(await unitsDigest(deckUnits({ id: 0, version: 0, slides }).units), r.digest);
  assert.deepEqual(r.stored.source, { store: 'd1_record', locator: 'pitch_deck_proposals', id: String(row.id), revision: r.digest });
  const rev = w.db.prepare('SELECT digest, parent_uids_json AS parents FROM work_graph_revisions WHERE revision_uid = ?').get(r.stored.revisionUid) as any;
  assert.equal(rev.digest, r.digest);
  assert.ok(String(rev.parents).includes(headUid), 'the candidate descends from the head');
  assert.equal(head(w, assetUid), headUid, 'no candidate is published by proposing it');

  // A retry (a lost or late callback) writes nothing new.
  const again: any = await proposeCandidate(w.env, CTX, input);
  assert.equal(again.ok, true);
  assert.equal(again.stored.revisionUid, r.stored.revisionUid);
  assert.equal(count(w, 'pitch_deck_proposals'), 1);

  // A different candidate while one waits is the founder's to decide: refused, the row untouched.
  const other = deckRow(1, [card('s1', 'Problem', 'yet another problem'), card('s2', 'Solution', 'the old solution')]);
  const refused: any = await proposeCandidate(w.env, CTX, { ...input, ours: other.units, theirs: base.units, idempotencyKey: 'cand-2' });
  assert.deepEqual([refused.ok, refused.code, refused.ids], [false, 'proposal_waiting', [String(row.id)]]);
  assert.equal((w.db.prepare('SELECT slides FROM pitch_deck_proposals').get() as any).slides, row.slides);
});

test('4. a conflict, a stale head and an agent\'s typed figure write nothing', async () => {
  const w = world();
  const { assetUid, headUid, base } = await deckAsset(w);
  const before = [count(w, 'pitch_deck_proposals'), count(w, 'work_graph_revisions')];
  const a = deckRow(1, [card('s1', 'Problem', 'first rewrite'), card('s2', 'Solution', 'the old solution')]);
  const b = deckRow(1, [card('s1', 'Problem', 'second rewrite'), card('s2', 'Solution', 'the old solution')]);
  const common = { assetUid, headRevisionUid: headUid, base: base.units, author: WRITER, contributors: { ours: 'w', theirs: 'v' }, target: deckTarget };
  const conflict: any = await proposeCandidate(w.env, CTX, { ...common, ours: a.units, theirs: b.units, idempotencyKey: 'c1' });
  assert.deepEqual([conflict.ok, conflict.code, conflict.ids], [false, 'merge_conflict', ['s1/b']]);
  assert.equal(conflict.plan.conflicts[0].ours.text, 'first rewrite');

  const stale: any = await proposeCandidate(w.env, CTX, { ...common, headRevisionUid: 'wgr_old', ours: a.units, theirs: base.units, idempotencyKey: 'c2' });
  assert.equal(stale.code, 'stale_revision');

  // A deck asset never receives a template's draft.
  const misrouted: any = await proposeCandidate(w.env, CTX, {
    ...common, ours: a.units, theirs: base.units, idempotencyKey: 'c5',
    target: { kind: 'legal_template', templateId: 1, templateSlug: 'x', jurisdiction: 'England' },
  });
  assert.equal(misrouted.code, 'kind_mismatch');

  const figure = deckRow(1, [card('s1', 'Problem', 'we grew 40 percent'), card('s2', 'Solution', 'the old solution')]);
  const typed: any = await proposeCandidate(w.env, CTX, { ...common, ours: figure.units, theirs: base.units, idempotencyKey: 'c3' });
  assert.deepEqual([typed.code, typed.ids], ['figure_in_text', ['s1/b']]);
  // The same words from the founder are theirs to type.
  assert.deepEqual([count(w, 'pitch_deck_proposals'), count(w, 'work_graph_revisions')], before);
  const byFounder: any = await proposeCandidate(w.env, CTX, { ...common, author: FOUNDER, ours: figure.units, theirs: base.units, idempotencyKey: 'c4' });
  assert.equal(byFounder.ok, true, JSON.stringify(byFounder));
});

test('5. after the person publishes, the head moves only to exactly the approved units', async () => {
  const w = world();
  const { assetUid, headUid, base } = await deckAsset(w);
  const { ours, theirs } = twoSlideDrafts();
  const r: any = await proposeCandidate(w.env, CTX, {
    assetUid, headRevisionUid: headUid, base: base.units, ours: ours.units, theirs: theirs.units, author: VISUALS,
    contributors: { ours: 'run_writer', theirs: 'run_visuals' }, target: deckTarget, idempotencyKey: 'cand',
  });
  // The founder pressed Keep: the existing writer made deck version 2 from the proposal's slides.
  const proposal = JSON.parse((w.db.prepare('SELECT slides FROM pitch_deck_proposals').get() as any).slides);
  const kept = deckRow(2, proposal);

  // An agent cannot confirm the publish.
  assert.equal(((await confirmPublished(w.env, CTX, { assetUid, expectedRevisionUid: headUid, approvedDigest: r.digest, published: kept, approval: { ref: 'keep:2', reviewer: WRITER }, idempotencyKey: 'p0' })) as any).code, 'person_required');

  // Something other than the approved candidate was published: the head stays.
  const edited = deckRow(2, [...proposal.slice(0, 1), card('s2', 'Solution', 'edited after approval')]);
  const stale: any = await confirmPublished(w.env, CTX, { assetUid, expectedRevisionUid: headUid, approvedDigest: r.digest, published: edited, approval: { ref: 'keep:2', reviewer: FOUNDER }, idempotencyKey: 'p1' });
  assert.equal(stale.code, 'stale_approval');
  assert.equal(head(w, assetUid), headUid);

  const ok: any = await confirmPublished(w.env, CTX, { assetUid, expectedRevisionUid: headUid, approvedDigest: r.digest, published: kept, approval: { ref: 'keep:2', reviewer: FOUNDER }, idempotencyKey: 'p2' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.notEqual(head(w, assetUid), headUid);
  const now = w.db.prepare('SELECT source_locator, source_id FROM work_graph_revisions WHERE revision_uid = ?').get(head(w, assetUid)) as any;
  assert.deepEqual([now.source_locator, now.source_id], ['pitch_decks', '2'], 'the head is the published domain row, never the draft');
});

test('6. template: a research draft pending counsel review; legal_templates untouched; never overwritten', async () => {
  const w = world();
  const body = '# 1. Definitions\nTerms used here.\nSecond line.\nThird line.\n# 2. Confidentiality\nEach party keeps secrets.';
  const tid = Number(w.db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, version) VALUES ('WG Mutual NDA', 'Mutual NDA', 'gp', ?, 3)").run(body).lastInsertRowid);
  const tplBefore = JSON.stringify(w.db.prepare('SELECT * FROM legal_templates').all());
  const reg: any = await registerDraftedAsset(w.env, CTX, { scope: SCOPE, kind: 'legal_template', accessClass: 'internal', actor: COUNSEL, idempotencyKey: 'tpl' });
  const base = legalTemplateUnits({ template_id: tid, version: 3, body_md: body });
  const adopted: any = await adoptCurrent(w.env, CTX, { assetUid: reg.assetUid, expectedRevisionUid: null, current: base, by: COUNSEL, idempotencyKey: 'adopt' });
  const ours = legalTemplateUnits({ template_id: tid, version: 3, body_md: body.replace('Terms used here.', 'Terms used in this agreement.') });
  const theirs = legalTemplateUnits({ template_id: tid, version: 3, body_md: body.replace('Third line.', 'Third line, reworded.') });
  const target = { kind: 'legal_template' as const, templateId: tid, templateSlug: 'WG Mutual NDA', jurisdiction: 'England' };
  const r: any = await proposeCandidate(w.env, CTX, {
    assetUid: reg.assetUid, headRevisionUid: adopted.revisionUid, base: base.units, ours: ours.units, theirs: theirs.units,
    author: WRITER, contributors: { ours: 'run_writer', theirs: 'run_fact' }, target, idempotencyKey: 'c',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.plan.requiresHumanConfirmation, true);
  const draft = w.db.prepare('SELECT * FROM legal_template_research_drafts').get() as any;
  assert.equal(draft.status, 'pending_counsel_review');
  assert.equal(draft.template_slug, 'WG Mutual NDA');
  assert.ok(draft.draft_body_md.includes('Terms used in this agreement.') && draft.draft_body_md.includes('Third line, reworded.'));
  assert.ok(draft.review_notes.includes(r.digest));
  assert.ok(!draft.review_notes.includes('Terms used'), 'no clause text in the notes');
  assert.equal(JSON.stringify(w.db.prepare('SELECT * FROM legal_templates').all()), tplBefore, 'the live template is untouched');
  assert.equal(await unitsDigest(clausesOf(draft.draft_body_md, 'clause')), r.digest);

  // A different second candidate is refused; the draft stays as counsel has it.
  const other = legalTemplateUnits({ template_id: tid, version: 3, body_md: body.replace('Second line.', 'Second line, changed.') });
  const refused: any = await proposeCandidate(w.env, CTX, {
    assetUid: reg.assetUid, headRevisionUid: adopted.revisionUid, base: base.units, ours: other.units, theirs: base.units,
    author: WRITER, contributors: { ours: 'w', theirs: 'x' }, target, idempotencyKey: 'c2',
  });
  assert.deepEqual([refused.code, refused.ids], ['draft_waiting', [String(draft.id)]]);
  assert.equal((w.db.prepare('SELECT draft_body_md FROM legal_template_research_drafts').get() as any).draft_body_md, draft.draft_body_md);
  assert.equal(count(w, 'legal_template_research_drafts'), 1);

  // A slug that is not this template's is refused before anything is written.
  const wrong: any = await proposeCandidate(w.env, CTX, {
    assetUid: reg.assetUid, headRevisionUid: adopted.revisionUid, base: base.units, ours: other.units, theirs: base.units,
    author: WRITER, contributors: { ours: 'w', theirs: 'x' }, target: { ...target, templateSlug: 'Other', jurisdiction: 'France' }, idempotencyKey: 'c3',
  });
  assert.equal(wrong.code, 'not_found');
  assert.equal(count(w, 'legal_template_research_drafts'), 1);
});

test('7. offer: nothing is stored; the partner\'s own save, confirmed, becomes the head', async () => {
  const w = world();
  const reg: any = await registerDraftedAsset(w.env, CTX, { scope: SCOPE, kind: 'offer', accessClass: 'confidential', actor: FOUNDER, idempotencyKey: 'offer' });
  const q = (id: number, version: number, summary: string, note: string | null) => quoteUnits({ id, quote_id: 9, version, change_summary: summary, note, price_cents: 500000 });
  const base = q(1, 1, 'Three phases', null);
  const adopted: any = await adoptCurrent(w.env, CTX, { assetUid: reg.assetUid, expectedRevisionUid: null, current: base, by: FOUNDER, idempotencyKey: 'adopt' });
  const revsBefore = count(w, 'work_graph_revisions');
  const r: any = await proposeCandidate(w.env, CTX, {
    assetUid: reg.assetUid, headRevisionUid: adopted.revisionUid, base: base.units,
    ours: q(1, 1, 'Two phases', null).units, theirs: q(1, 1, 'Three phases', 'Client asked for a shorter plan').units,
    author: WRITER, contributors: { ours: 'w', theirs: 'v' }, target: { kind: 'offer' }, idempotencyKey: 'c',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.stored, null);
  assert.equal(count(w, 'work_graph_revisions'), revsBefore, 'nothing stored for an offer');
  assert.equal(count(w, 'quote_versions'), 0, 'no quote version written');
  // The partner saved version 2 with exactly the planned terms.
  const saved = q(2, 2, 'Two phases', 'Client asked for a shorter plan');
  const ok: any = await confirmPublished(w.env, CTX, { assetUid: reg.assetUid, expectedRevisionUid: adopted.revisionUid, approvedDigest: r.digest, published: saved, approval: { ref: 'quote_versions:2', reviewer: FOUNDER }, idempotencyKey: 'pub' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});

test('8. units read back into the domain\'s own form exactly', () => {
  const cards = assignCardUids([
    { title: 'A', layout: 'title', notes: 'n', blocks: [{ kind: 'image', src: 'x' }, { id: 'h', kind: 'text', text: 'hi' }, { kind: 'graphic' }, { id: 'm', kind: 'metric', value: '1' }] },
    { uid: 'k2', layout: 'statement', blocks: [] },
    { uid: 'k3', title: '', layout: 'quote' },
  ]);
  const back = slidesFromUnits(deckUnits({ id: 1, version: 1, slides: cards }).units);
  assert.deepEqual(back, cards);

  // A block one side added (not yet in the card's recorded order) is kept, after the card's other blocks.
  const units = deckUnits({ id: 1, version: 1, slides: cards }).units;
  const added = [...units, { id: `${cards[1].uid}/n2`, kind: 'card_area' as const, value: JSON.stringify({ id: 'n2', kind: 'text', text: 'new' }), text: 'new', textMergeable: true, sensitive: [] }];
  assert.deepEqual(slidesFromUnits(added)[1].blocks, [{ id: 'n2', kind: 'text', text: 'new' }]);
  const md = 'Intro\n\n# 1. One\na\nb\n## 1.1 Sub\nc\n# 2. Two\nd';
  assert.equal(markdownFromUnits(clausesOf(md, 'clause')), md);
});
