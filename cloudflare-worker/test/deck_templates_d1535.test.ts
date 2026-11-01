/**
 * D1535 (#3782, deck v2 B6) — the template store: migration 725,
 * `services/decks/templates.ts`, `routes/deck_templates.ts`.
 *
 *   · a template holds no figure (numberIn on every visible string, no metric
 *     value, no chart points), names no model, and records its provenance;
 *   · the Gallery filters by stage, New deck's seven audiences and style;
 *   · apply writes a proposal (`method_id` tpl:<uid>) and no deck version;
 *   · "Save as my template" strips text and figures and keeps structure,
 *     theme and decor, in the caller's own scope;
 *   · the pick is deterministic by stage × audience (× sector);
 *   · every HQ seed passes its contract and scores ≥ 80 on the rubric.
 *
 * The real migrated schema in memory (no file copies).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_templates_d1535.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckTemplates, { __resetSeedForTest } from '../src/routes/deck_templates.ts';
import { ATTESTATION, metaOf, pickTemplate, stripDeck, templateProblems, toSlides } from '../src/services/decks/templates.ts';
import { HQ_TEMPLATES } from '../src/services/decks/templateSeeds.ts';
import { deckRubric } from '../src/services/decks/rubric.ts';
import { sanitizeSlides } from '../src/routes/decks.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { CONTRACTS } from '../src/contracts/index.ts';
import { contractErrors } from '../src/contracts/validate.ts';
const schemaOf = (m: 'templates' | 'myTemplates' | 'saveAsTemplate') => JSON.parse(readFileSync(new URL(`../src/contracts/${CONTRACTS[m].schema}`, import.meta.url), 'utf8'));

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-d1535-only-not-a-real-credential'.repeat(2);

const H = (id: string, text: string, grid: any, style = 'heading') => ({ id, kind: 'text', style, text, grid });
const statement = (card: string, text: string) => ({ card, title: `[${card[0].toUpperCase()}${card.slice(1).replace('_', ' ')}]`, layout: 'statement', blocks: [H('S', text, { c1: 2, c2: 11, r1: 2, r2: 5 })], notes: '[Say it plainly.]' });
/** A synthetic H14 template: ten cards, placeholders only. */
function template(over: Record<string, unknown> = {}) {
  const cards = [
    { card: 'title', title: '[Title]', layout: 'title', blocks: [H('T', '[Venture name]', { c1: 1, c2: 12, r1: 2, r2: 3 }), H('S', '[One-line pitch]', { c1: 1, c2: 12, r1: 4, r2: 4 }, 'paragraph')], notes: '[Open with the venture.]', decor: [{ kind: 'shape', ref: 'circle', grid: { c1: 1, c2: 1, r1: 6, r2: 6 } }] },
    statement('problem', '[The pain, said plainly]'), statement('why_now', '[What changed now]'), statement('solution', '[What the product does]'),
    statement('traction', '[Growth so far]'), statement('market', '[Who needs this most]'), statement('competition', '[How customers cope]'),
    statement('round', '[The ask and what it proves]'), statement('use_of_funds', '[Where the money goes]'), statement('cap_table', '[Who holds the company]'),
  ];
  return {
    contract: 'deck_template/1', uid: 'tpl_hq_quiet_start', name: 'Quiet Start', description: 'A calm pre-seed story.', stage: 'pre_seed',
    audience_tags: ['angel', 'pre_seed_fund'], deck_audience: 'angel', style: 'minimal', swatch: 'white', length: 'full', aspect: '16:9', card_count: cards.length,
    theme: { kind: 'neutral_light', version: 1 }, cards, pending_cards: [],
    provenance: { origin: 'original', prompt_id: 'TPL-05', authored_by: 'test', reviewed_by: null, attestation: ATTESTATION }, ...over,
  };
}

async function world() {
  __resetSeedForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  const u = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  u.run(2, 'founder', 100, 'Synthetic founder', 'f@example.invalid', 'studio'); u.run(4, 'founder', 400, 'Other founder', 'o@example.invalid', 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(4,'Other venture',400)");
  db.prepare("INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current) VALUES (7,1,1,?,'Deck',1)").run(JSON.stringify([
    { layout: 'metric_tiles', title: 'Traction', blocks: [{ id: 'H', kind: 'text', style: 'heading', text: 'We grew 40% last quarter', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
      { id: 'M1', kind: 'metric', label: 'ARR', value: '$1.2M', binding: { source_key: 'grow.arr' }, grid: { c1: 1, c2: 3, r1: 2, r2: 4 } }], notes: 'Say the ARR', decor: [{ kind: 'icon', ref: 'rocket' }] },
  ]));
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckTemplates);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const put = (t: any, scope = 'hq', owner: number | null = null) => db.prepare(
    `INSERT INTO deck_templates (uid, scope, owner_id, name, description, stage, audience_tags, deck_audience, style, swatch, card_count, structure_json, theme_json, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.uid, scope, owner, t.name, t.description, t.stage, JSON.stringify(t.audience_tags), t.deck_audience, t.style, t.swatch, t.card_count, JSON.stringify(t), JSON.stringify(t.theme), JSON.stringify(t.provenance));
  return { db, env, app, put };
}
type W = Awaited<ReturnType<typeof world>>;
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await w.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, w.env);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}

test('a template holds no figure and names no model; its provenance is recorded', () => {
  // Mutations checked: numberIn skipped → the figure assert fails; the points check dropped → the points assert fails;
  // the attestation check dropped → the provenance assert fails.
  assert.deepEqual(templateProblems(template()), []);
  const t = template();
  (t.cards[1] as any).blocks[0].text = '[Grew 40% in a year]';
  assert.ok(templateProblems(t).some((p) => /holds a figure/.test(p)));
  const pts = template(); (pts.cards[4] as any).blocks.push({ id: 'C', kind: 'chart', chart_type: 'line', series: [{ label: '[MRR]', points: [{ x: 'a', y: 1 }] }] });
  assert.ok(templateProblems(pts).some((p) => /holds points/.test(p)));
  const val = template(); (val.cards[4] as any).blocks.push({ id: 'M1', kind: 'metric', label: '[ARR]', value: 'big' });
  assert.ok(templateProblems(val).some((p) => /metric holds a value/.test(p)));
  assert.ok(templateProblems(template({ provenance: { origin: 'original' } })).some((p) => /provenance/.test(p)));
  assert.ok(templateProblems(template({ audience_tags: ['vc'] })).some((p) => /seven audiences/.test(p)));
  assert.ok(templateProblems({ ...template(), note: '@cf/meta/x' }).some((p) => /names no model/.test(p)));
  assert.ok(templateProblems(template({ card_count: 9 })).some((p) => /card_count/.test(p)));
});

test('every HQ seed passes its contract and scores at least 80 on the rubric once applied; so does the fixture', () => {
  // Mutation checked: the gate lowered to 70 → a seed under 80 would pass; held by the explicit ≥ 80.
  for (const t of [...HQ_TEMPLATES, template()] as any[]) {
    assert.deepEqual(templateProblems(t), [], t.uid);
    const { score } = deckRubric(sanitizeSlides(toSlides(t)));
    assert.ok(score >= 80, `${t.uid}: rubric ${score}`);
  }
});

test('the Gallery filters by stage, New deck\'s seven audiences and style; a bad filter is 400', async () => {
  // Mutation checked: the audience filter dropped → the strategic assert fails.
  const w = await world();
  w.put(template());
  w.put(template({ uid: 'tpl_hq_joinery', name: 'Joinery', stage: 'series_a', audience_tags: ['strategic'], style: 'minimal' }));
  const all = await call(w, 2, 'GET', '/api/decks/templates');
  assert.equal(all.status, 200, all.text);
  assert.deepEqual(all.body.templates.map((t: any) => t.uid), ['tpl_hq_joinery', 'tpl_hq_quiet_start']);
  assert.deepEqual(all.body.templates[1], metaOf(template()));
  assert.deepEqual(all.body.filters.audiences.map((a: any) => a.key), ['angel', 'pre_seed_fund', 'seed_fund', 'series_a_fund', 'strategic', 'grant', 'other']);
  assert.deepEqual((await call(w, 2, 'GET', '/api/decks/templates?audience=strategic')).body.templates.map((t: any) => t.uid), ['tpl_hq_joinery']);
  assert.deepEqual((await call(w, 2, 'GET', '/api/decks/templates?stage=pre_seed&style=minimal')).body.templates.map((t: any) => t.uid), ['tpl_hq_quiet_start']);
  assert.deepEqual((await call(w, 2, 'GET', '/api/decks/templates?audience=grant')).body.templates, [], 'an empty filter is an empty list the Gallery words');
  assert.equal((await call(w, 2, 'GET', '/api/decks/templates?stage=growth')).body.error, 'invalid_stage');
  assert.ok(!all.text.includes('example.invalid'));
  assert.deepEqual(contractErrors(schemaOf('templates'), all.body), [], 'D1511: the reply matches its contract');
});

test('apply writes a proposal, never a version; the v1 method ids are untouched (Q5)', async () => {
  // Mutation checked: apply inserting into pitch_decks → the versions assert fails.
  const w = await world();
  w.put(template());
  const before = Number((w.db.prepare('SELECT COUNT(*) AS n FROM pitch_decks').get() as any).n);
  const r = await call(w, 2, 'POST', '/api/decks/templates/tpl_hq_quiet_start/apply', { project_id: 1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.template_id, 'tpl_hq_quiet_start');
  const row = w.db.prepare('SELECT method_id, slides FROM pitch_deck_proposals WHERE project_id = 1').get() as any;
  assert.equal(row.method_id, 'tpl:tpl_hq_quiet_start');
  assert.equal(JSON.parse(row.slides).length, 10);
  assert.equal(Number((w.db.prepare('SELECT COUNT(*) AS n FROM pitch_decks').get() as any).n), before, 'nothing is saved before Accept');
  assert.equal((await call(w, 4, 'POST', '/api/decks/templates/tpl_hq_quiet_start/apply', { project_id: 1 })).status, 403);
  assert.equal((await call(w, 2, 'POST', '/api/decks/templates/tpl_hq_nope/apply', { project_id: 1 })).status, 404);
});

test('Save as my template strips text and figures, keeps structure, theme and decor, and is the caller\'s own', async () => {
  // Mutations checked: the metric value kept → the null assert fails; the text kept → the placeholder assert fails;
  // decor dropped → the decor assert fails; mine unscoped → the other founder's empty list fails.
  const w = await world();
  const r = await call(w, 2, 'POST', '/api/decks/7/save-as-template', { name: 'My traction' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.template.name, 'My traction');
  const stored = JSON.parse((w.db.prepare("SELECT structure_json FROM deck_templates WHERE scope = 'user' AND owner_id = 2").get() as any).structure_json);
  const card = stored.cards[0];
  assert.equal(card.layout, 'metric_tiles');
  assert.deepEqual(card.decor, [{ kind: 'icon', ref: 'rocket' }], 'decor kept');
  assert.equal(card.blocks.find((b: any) => b.kind === 'text').text, '[Heading]');
  const m = card.blocks.find((b: any) => b.kind === 'metric');
  assert.deepEqual([m.value, m.label, m.binding], [null, '[Metric]', { source_key: 'grow.arr' }]);
  assert.equal(card.notes, undefined, 'notes are removed');
  assert.ok(!JSON.stringify(stored).includes('40%') && !JSON.stringify(stored).includes('1.2M'));
  const mine = await call(w, 2, 'GET', '/api/decks/templates/mine');
  assert.deepEqual(mine.body.templates.map((t: any) => t.name), ['My traction']);
  assert.deepEqual(contractErrors(schemaOf('myTemplates'), mine.body), []);
  assert.deepEqual(contractErrors(schemaOf('saveAsTemplate'), r.body), []);
  assert.deepEqual((await call(w, 4, 'GET', '/api/decks/templates/mine')).body.templates, []);
  assert.equal((await call(w, 4, 'POST', '/api/decks/7/save-as-template', { name: 'Theirs' })).status, 403);
  assert.deepEqual(stripDeck([{ blocks: [{ kind: 'chart', series: [{ label: 'MRR', points: [1, 2] }] }] }])[0].blocks[0].series, [{ label: '[Series]' }]);
});

test('the pick: by stage and audience, sector optional; the same inputs always give the same template and reason', async () => {
  // Mutation checked: Math.random in the tie-break → the repeat assert fails.
  const metas = [template(), template({ uid: 'tpl_hq_field_letter', name: 'Field Letter', audience_tags: ['strategic'] }), template({ uid: 'tpl_hq_ledger_line', name: 'Ledger Line', stage: 'series_a', audience_tags: ['seed_fund'] })].map(metaOf);
  const a = pickTemplate(metas, { stage: 'pre_seed', audience: 'strategic', sector: 'fintech' });
  assert.deepEqual(a, { template_id: 'tpl_hq_field_letter', reason: 'Picked Field Letter because it matches its stage and audience (Pre-seed · Strategic).' });
  for (let i = 0; i < 5; i += 1) assert.deepEqual(pickTemplate([...metas].reverse(), { stage: 'pre_seed', audience: 'strategic', sector: 'fintech' }), a, 'the same every time');
  assert.equal(pickTemplate(metas, { stage: 'series_b_plus', audience: 'grant' }).reason.startsWith('Picked'), true, 'never empty while the gallery has one');
  assert.deepEqual(pickTemplate([], { stage: 'seed' }), { template_id: null, reason: 'No template is in the gallery yet.' });
  const w = await world();
  w.put(template());
  assert.equal((await call(w, 2, 'GET', '/api/decks/templates/pick?stage=pre_seed&audience=angel')).body.template_id, 'tpl_hq_quiet_start');
});
