/**
 * D898 (#2676) — the Pitch deck editor's slide model, through the real mounted
 * deck routes on SQLite (migration 539 applied from its file).
 *
 *   1. An old fielded deck, saved before D898, still opens, and reads its new
 *      columns as null ("Not recorded").
 *   2. A save keeps every layout, note, background, block, binding and the
 *      version's audience, round and theme, with a content hash.
 *   3. A save the model cannot keep whole is refused with what is wrong, and
 *      writes no version.
 *   4. A stored version with blocks that are not sound opens with them dropped.
 *   5. Restore keeps the restored version's audience, round and theme.
 *   6. The versions list carries Audience, Round and By.
 *   7. The twelve layouts fit the grid; video links are read without a fetch;
 *      D896's compare sees a chart's series.
 *
 * Every principal and line is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_slide_model_d898.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { CHART_TYPES, LAYOUTS, bindingOf, contentHash, sanitizeBlocks, videoOf } from '../src/services/decks/slideModel.ts';
import { bindingsOf, sanitizeBinding } from '../src/services/decks/sources.ts';
import { sanitizeImageUrl } from '../src/routes/decks.ts';
import { checkVideoLink } from '../src/services/decks/videoLink.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../sql/migrations/539_pitch_deck_editor.sql', import.meta.url), 'utf8');
const SECRET = 'synthetic-deck-model-secret-d898'.repeat(2);
const HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6';

const OWNER = 2, COFOUNDER = 6, ADVISOR = 11, INVESTOR = 3, OTHER_FOUNDER = 10;
const principals = [[OWNER, 'founder', 20], [COFOUNDER, 'founder', 60], [ADVISOR, 'advisor', null], [INVESTOR, 'investor', null], [OTHER_FOUNDER, 'founder', 30]] as const;

/** A deck as it was saved before D898: fielded slides, no layout, no blocks. */
const OLD_SLIDES = [
  { title: 'Synthetic problem', subtitle: null, body: '', bullets: [], image_url: null, method_id: 'yc_seed', spec_id: 'problem',
    fields: [{ key: 'problem_body', label: 'Problem', kind: 'paragraph', value: 'Synthetic pain', source: 'data' }] },
  { title: 'Synthetic traction', subtitle: null, body: 'Synthetic body', bullets: ['one', 'two'], image_url: null, method_id: 'yc_seed', spec_id: 'traction' },
];

const bind = (key: string) => ({ source_key: key, record_ref: 'synthetic:1', as_of: '2026-10-01', grade: 'Measured', snapshot_hash: HASH });

/** One card with every block kind, and the slide's own layout, notes and background. */
const MODEL_CARD = {
  title: 'Synthetic traction', method_id: 'yc_seed', spec_id: 'traction', layout: 'chart_text',
  notes: 'Say the churn figure is not recorded yet.', background: { color: '#FAF7F0' },
  fields: [{ key: 'traction_body', label: 'Traction', kind: 'paragraph', value: 'Synthetic', source: 'data', binding: bind('revenue.mrr') }],
  blocks: [
    { id: 'h', kind: 'text', grid: { c1: 1, c2: 6, r1: 1, r2: 1 }, style: 'heading', text: 'Synthetic heading' },
    { id: 'v', kind: 'video', grid: { c1: 7, c2: 9, r1: 1, r2: 2 }, url: 'https://youtu.be/AbCdEfGhIjK', poster_url: 'https://i.ytimg.com/vi/AbCdEfGhIjK/hqdefault.jpg', ratio: '16:9' },
    { id: 'a', kind: 'audio', grid: { c1: 10, c2: 12, r1: 1, r2: 1 }, url: 'https://example.com/clip.mp3', label: 'Synthetic clip' },
    { id: 'c', kind: 'chart', grid: { c1: 1, c2: 6, r1: 2, r2: 6 }, chart_type: 'line', range: '12m', previous: true,
      series: [{ label: 'MRR', binding: bind('revenue.mrr') }, { label: 'Typed', points: [{ x: 'Sep', y: 4 }, { x: 'Oct', y: 6 }] }] },
    { id: 'm1', kind: 'metric', grid: { c1: 7, c2: 9, r1: 3, r2: 4 }, label: 'Runway', value: '14 months', binding: bind('raise.runway') },
    { id: 'm2', kind: 'metric', grid: { c1: 10, c2: 12, r1: 3, r2: 4 }, label: 'Churn', value: null },
    { id: 'i', kind: 'image', grid: { c1: 7, c2: 12, r1: 5, r2: 5 }, image_url: 'https://example.com/a.png', alt: 'Synthetic', tag: 'illustration' },
    { id: 'g', kind: 'graphic', grid: { c1: 10, c2: 10, r1: 2, r2: 2 }, graphic: 'arrow-up', ratio: '1x1' },
    { id: 'l', kind: 'link', grid: { c1: 7, c2: 12, r1: 6, r2: 6 }, url: 'https://example.com/data-room', label: 'Open the data room' },
  ],
};

async function call(f: any, who: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await f.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  const text = await res.text();
  let value: any; try { value = JSON.parse(text); } catch { value = text; }
  return { status: res.status, body: value };
}

async function fixture() {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec('PRAGMA foreign_keys=OFF; ALTER TABLE users ADD COLUMN founder_id INTEGER; ALTER TABLE activity_logs ADD COLUMN project_id INTEGER; ALTER TABLE activity_logs ADD COLUMN entity_type TEXT; ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;');
  for (const table of ['projects', 'pitch_decks', 'raise_rounds', 'landing_pages']) f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, table)));
  // Migration 399: the brand voice, the dark logo and the archive, which the baseline predates.
  f.db.exec(readFileSync(new URL('../sql/migrations/399_landing_brand_voice_dark_logo_archive.sql', import.meta.url), 'utf8'));
  f.db.exec(MIGRATION);
  f.db.exec(`CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    INSERT INTO user_company_links VALUES(${OWNER},101),(${OTHER_FOUNDER},102);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',20,101),(2,'Synthetic other venture',30,102);
    INSERT INTO raise_rounds(uid,project_id,name) VALUES('round-seed',1,'Synthetic seed'),('round-other',2,'Synthetic other round');`);
  for (const [id, role, founder] of principals) {
    f.db.prepare('INSERT OR IGNORE INTO users(id,email,name,role) VALUES(?,?,?,?)').run(id, `synthetic${id}@example.test`, `Synthetic ${id}`, role);
    f.db.prepare("UPDATE users SET name = ?, role = ?, founder_id = ?, subscription_tier = 'studio', is_active = 1 WHERE id = ?").run(`Synthetic ${id}`, role, founder, id);
  }
  const env: any = { DB: f.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/decks', decks);
  app.onError((err: any, c: any) => c.json({ error: err?.message === 'Unauthorized' ? 'unauthorized' : String(err?.message) }, err?.message === 'Unauthorized' ? 401 : 500));
  const out = { ...f, app, env };
  // The old deck: version 1, written before D898, with none of the new columns set.
  f.db.prepare('INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(10,1,1,?,?,1,?)').run(JSON.stringify(OLD_SLIDES), 'Synthetic deck', OWNER);
  await ensureProjectMembershipSchema(env);
  f.db.exec(`INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,${OWNER},'owner','accepted'),(1,${COFOUNDER},'cofounder','accepted'),(1,${ADVISOR},'advisor','accepted')`);
  return out;
}
const versions = (f: any) => (f.db.prepare('SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = 1').get() as any).n;

test('1. an old fielded deck still opens, and reads its new columns as Not recorded', async () => {
  const f = await fixture();
  const r = await call(f, OWNER, 'GET', '/api/decks/10');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.slides, OLD_SLIDES, 'every old card reads back as it was written');
  assert.equal(r.body.audience, null);
  assert.equal(r.body.round, null);
  assert.equal(r.body.theme, null);
  assert.equal(r.body.content_hash, null, 'saved before D898: no hash');
  assert.deepEqual(r.body.by, { id: OWNER, name: `Synthetic ${OWNER}` });
  // Saving it unchanged keeps every old field and gives it a hash.
  const s = await call(f, OWNER, 'PUT', '/api/decks/10', { slides: OLD_SLIDES, title: 'Synthetic deck' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.version, 2);
  assert.equal(s.body.slides[0].fields[0].value, 'Synthetic pain');
  assert.deepEqual(s.body.slides[1].bullets, ['one', 'two']);
  assert.match(s.body.content_hash, /^[0-9a-f]{64}$/);
});

test('2. a save keeps layout, notes, background, every block, every binding, and the audience, round and theme', async () => {
  const f = await fixture();
  const theme = { kind: 'neutral_light', background: { image_url: 'https://example.com/bg.png' } };
  const s = await call(f, COFOUNDER, 'PUT', '/api/decks/10', { slides: [OLD_SLIDES[0], MODEL_CARD], audience: 'seed_fund', round_ref: 'round-seed', theme });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const back = (await call(f, OWNER, 'GET', `/api/decks/${s.body.id}`)).body;
  const card = back.slides[1];
  assert.equal(card.layout, 'chart_text');
  assert.equal(card.notes, MODEL_CARD.notes);
  assert.deepEqual(card.background, { color: '#faf7f0', image_url: null });
  assert.deepEqual(card.blocks.map((b: any) => [b.id, b.kind]), MODEL_CARD.blocks.map((b) => [b.id, b.kind]), 'all nine blocks, all eight kinds, in order');
  const by = Object.fromEntries(card.blocks.map((b: any) => [b.id, b]));
  assert.deepEqual(by.c.series[0].binding, bind('revenue.mrr'));
  assert.deepEqual(by.c.series[1].points, [{ x: 'Sep', y: 4 }, { x: 'Oct', y: 6 }], 'the typed series keeps its points');
  assert.equal(by.c.range, '12m');
  assert.equal(by.c.previous, true);
  assert.deepEqual(by.m1.binding, bind('raise.runway'));
  assert.equal(by.m2.value, null, 'a tile with no figure stays null: Not recorded, never 0');
  assert.deepEqual([by.v.provider, by.v.video_id, by.v.url], ['youtube', 'AbCdEfGhIjK', 'https://www.youtube.com/watch?v=AbCdEfGhIjK']);
  assert.equal(by.l.url, 'https://example.com/data-room');
  assert.deepEqual(card.fields[0].binding, bind('revenue.mrr'), 'a field keeps its binding');
  assert.equal(back.audience, 'seed_fund');
  assert.deepEqual(back.round, { uid: 'round-seed', name: 'Synthetic seed' });
  assert.deepEqual(back.theme, { kind: 'neutral_light', background: { color: null, image_url: 'https://example.com/bg.png' } });
  assert.deepEqual(back.by, { id: COFOUNDER, name: `Synthetic ${COFOUNDER}` });
  // The stored hash is the hash of what was stored.
  const row = f.db.prepare('SELECT slides, theme_json, content_hash FROM pitch_decks WHERE id = ?').get(s.body.id) as any;
  assert.equal(row.content_hash, await contentHash(JSON.parse(row.slides), JSON.parse(row.theme_json)));
  // A later save that does not name them keeps the version's audience, round and theme.
  const t = await call(f, OWNER, 'PUT', `/api/decks/${s.body.id}`, { slides: back.slides });
  assert.equal(t.body.audience, 'seed_fund');
  assert.equal(t.body.round.uid, 'round-seed');
  assert.equal(t.body.theme.kind, 'neutral_light');
  assert.equal(t.body.content_hash, s.body.content_hash, 'the same content hashes the same');
  // One activity row per save, and it carries no figure.
  const logs = f.db.prepare("SELECT details FROM activity_logs WHERE action = 'deck_saved'").all() as any[];
  assert.equal(logs.length, 2);
  for (const l of logs) assert.doesNotMatch(String(l.details), /14 months|Synthetic heading|\d{2,}/);
});

test('3. a save the model cannot keep whole is refused with what is wrong, and writes no version', async () => {
  const f = await fixture();
  const block = (over: any) => ({ ...MODEL_CARD, blocks: [{ id: 'x', kind: 'text', grid: { c1: 1, c2: 6, r1: 1, r2: 1 }, text: 'Synthetic', ...over }] });
  const cases: Array<[string, any, RegExp]> = [
    ['an unknown layout', { slides: [{ ...MODEL_CARD, layout: 'carousel' }] }, /layout is not one of the twelve/],
    ['notes past 4,000 characters', { slides: [{ ...MODEL_CARD, notes: 'x'.repeat(4001) }] }, /notes are longer/],
    ['a block off the grid', { slides: [block({ grid: { c1: 1, c2: 13, r1: 1, r2: 1 } })] }, /12 × 6 grid/],
    ['a range that runs backwards', { slides: [block({ grid: { c1: 6, c2: 1, r1: 1, r2: 1 } })] }, /12 × 6 grid/],
    ['a row past six', { slides: [block({ grid: { c1: 1, c2: 2, r1: 6, r2: 7 } })] }, /12 × 6 grid/],
    ['an unknown kind', { slides: [block({ kind: 'carousel' })] }, /unknown kind/],
    ['two blocks on one cell', { slides: [{ ...MODEL_CARD, blocks: [MODEL_CARD.blocks[0], { ...MODEL_CARD.blocks[0], id: 'y' }] }] }, /overlaps/],
    ['a video that is not YouTube or Vimeo', { slides: [block({ kind: 'video', url: 'https://example.com/v.mp4' })] }, /YouTube or Vimeo/],
    ['a plain-http link', { slides: [block({ kind: 'link', url: 'http://example.com' })] }, /https on a public host/],
    ['a link to a private host', { slides: [block({ kind: 'audio', url: 'https://10.0.0.5/clip.mp3' })] }, /https on a public host/],
    ['a binding that is not a source', { slides: [block({ kind: 'metric', binding: { source_key: 'MRR' } })] }, /binding is not a source/],
    ['blocks that are not a list', { slides: [{ ...MODEL_CARD, blocks: 'text' }] }, /must be a list/],
    ['more than 24 blocks', { slides: [{ ...MODEL_CARD, blocks: Array.from({ length: 25 }, (_, i) => ({ kind: 'text', grid: { c1: (i % 12) + 1, c2: (i % 12) + 1, r1: Math.floor(i / 12) + 1, r2: Math.floor(i / 12) + 1 } })) }] }, /at most 24 blocks/],
    ['an unknown audience', { slides: [MODEL_CARD], audience: 'family_office' }, /audience must be one of/],
    ["another venture's round", { slides: [MODEL_CARD], round_ref: 'round-other' }, /round of this venture/],
    ['a theme of no kind', { slides: [MODEL_CARD], theme: { kind: 'sepia' } }, /theme\.kind/],
  ];
  for (const [what, body, sentence] of cases) {
    const r = await call(f, OWNER, 'PUT', '/api/decks/10', body);
    assert.equal(r.status, 400, `${what}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), sentence, what);
  }
  assert.equal(versions(f), 1, 'no refused save wrote a version');
  // Whoever may not write the deck is refused before the model is read.
  for (const who of [ADVISOR, INVESTOR, OTHER_FOUNDER]) assert.equal((await call(f, who, 'PUT', '/api/decks/10', { slides: [MODEL_CARD] })).status, 403, String(who));
  assert.equal(versions(f), 1);
});

test('4. a stored version whose blocks are not sound opens with them dropped, and restores what was sound', async () => {
  const f = await fixture();
  const stored = [{ ...MODEL_CARD, layout: 'carousel', blocks: [
    MODEL_CARD.blocks[0],
    { ...MODEL_CARD.blocks[0], id: 'overlap' },
    { id: 'off', kind: 'text', grid: { c1: 0, c2: 3, r1: 1, r2: 1 } },
    { id: 'bad-video', kind: 'video', grid: { c1: 7, c2: 9, r1: 3, r2: 4 }, url: 'https://example.com/v.mp4' },
    MODEL_CARD.blocks[3],
  ] }];
  f.db.prepare('INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(20,1,2,?,?,0,?)').run(JSON.stringify(stored), 'Synthetic deck', OWNER);
  const r = await call(f, OWNER, 'POST', '/api/decks/20/restore');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.slides[0].layout, undefined, 'an unknown layout is dropped');
  assert.deepEqual(r.body.slides[0].blocks.map((b: any) => b.id), ['h', 'c'], 'the overlapping, off-grid and non-video blocks are dropped');
});

test('5. restore keeps the audience, round and theme of the version it restores', async () => {
  const f = await fixture();
  const s = await call(f, OWNER, 'PUT', '/api/decks/10', { slides: [MODEL_CARD], audience: 'angel', round_ref: 'round-seed', theme: { kind: 'neutral_dark' } });
  await call(f, OWNER, 'PUT', `/api/decks/${s.body.id}`, { slides: OLD_SLIDES, audience: 'grant', round_ref: null, theme: null });
  const r = await call(f, OWNER, 'POST', `/api/decks/${s.body.id}/restore`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.version, 4);
  assert.equal(r.body.audience, 'angel');
  assert.equal(r.body.round.uid, 'round-seed');
  assert.deepEqual(r.body.theme, { kind: 'neutral_dark', background: null });
  assert.equal(r.body.content_hash, s.body.content_hash, 'the restored version reads the same as the one it restores');
});

test('6. the versions list carries Audience, Round and By; a version from before D898 reads them as null', async () => {
  const f = await fixture();
  await call(f, COFOUNDER, 'PUT', '/api/decks/10', { slides: [MODEL_CARD], audience: 'seed_fund', round_ref: 'round-seed' });
  const r = await call(f, OWNER, 'GET', '/api/decks/by-project/1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.versions.map((v: any) => [v.version, v.audience, v.round?.name ?? null, v.by?.name ?? null]), [
    [2, 'seed_fund', 'Synthetic seed', `Synthetic ${COFOUNDER}`],
    [1, null, null, `Synthetic ${OWNER}`],
  ]);
  assert.equal(r.body.versions[0].slides, undefined, 'the list stays light');
});

test('7. the twelve layouts fit the grid; video links are read without a fetch; the compare sees a chart\'s series', async () => {
  assert.equal(LAYOUTS.length, 12);
  assert.equal(bindingOf, sanitizeBinding, "a block's binding follows D896's one rule");
  assert.equal(CHART_TYPES.length, 12);
  for (const l of LAYOUTS) {
    assert.equal(sanitizeBlocks(l.blocks, sanitizeImageUrl).length, l.blocks.length, `${l.id}: every preset block sits on the grid, none overlapping`);
  }
  assert.deepEqual(videoOf('https://www.youtube.com/watch?v=AbCdEfGhIjK'), { provider: 'youtube', video_id: 'AbCdEfGhIjK', url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK' });
  assert.equal(videoOf('https://youtube.com/shorts/AbCdEfGhIjK')?.video_id, 'AbCdEfGhIjK');
  assert.deepEqual(videoOf('https://vimeo.com/123456789'), { provider: 'vimeo', video_id: '123456789', url: 'https://vimeo.com/123456789' });
  for (const bad of ['http://youtu.be/AbCdEfGhIjK', 'https://youtube.com.evil.test/watch?v=AbCdEfGhIjK', 'https://youtu.be/short', 'https://vimeo.com/channels/x', 'not a link']) {
    assert.equal(videoOf(bad), null, bad);
  }
  const found = bindingsOf([MODEL_CARD]).map((b) => [b.field, b.binding.source_key]);
  assert.deepEqual(found, [['traction_body', 'revenue.mrr'], ['block:3:series:0', 'revenue.mrr'], ['block:4', 'raise.runway']]);
});

test('8. a kept "Fill from project" proposal is for the audience, round and theme of the version it was proposed over', async () => {
  const f = await fixture();
  const s = await call(f, OWNER, 'PUT', '/api/decks/10', { slides: [MODEL_CARD], audience: 'series_a_fund', round_ref: 'round-seed', theme: { kind: 'brand' } });
  f.db.prepare('INSERT INTO pitch_deck_proposals(id,project_id,base_deck_id,slides,title,created_by) VALUES(7,1,?,?,?,?)').run(s.body.id, JSON.stringify([MODEL_CARD]), 'Synthetic deck', OWNER);
  const r = await call(f, OWNER, 'POST', '/api/decks/proposals/7/keep');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const kept = (await call(f, OWNER, 'GET', '/api/decks/by-project/1')).body.versions[0];
  assert.deepEqual([kept.version, kept.audience, kept.round?.uid, kept.theme?.kind], [3, 'series_a_fund', 'round-seed', 'brand']);
});

test('9. a share link and the print export carry the cards and theme, never the notes, the saver, the audience or the round', async () => {
  const f = await fixture();
  const saved = await call(f, OWNER, 'PUT', '/api/decks/10', { slides: [MODEL_CARD], audience: 'seed_fund', round_ref: 'round-seed', theme: { kind: 'neutral_dark' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const link = await call(f, OWNER, 'POST', `/api/decks/${saved.body.id}/share`, {});
  assert.equal(link.status, 200, JSON.stringify(link.body));
  const shared = await call(f, null, 'GET', `/api/decks/share/${link.body.token}`);
  const { signDeckPrintToken } = await import('../src/routes/decks.ts');
  const printed = await call(f, null, 'GET', `/api/decks/print-export/${await signDeckPrintToken(f.env, saved.body.id)}`);
  for (const [what, r] of [['share', shared], ['print', printed]] as const) {
    assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.slides[0].blocks.length, MODEL_CARD.blocks.length, `${what}: the cards render`);
    assert.equal(r.body.theme.kind, 'neutral_dark', `${what}: on their theme`);
    const text = JSON.stringify(r.body);
    assert.doesNotMatch(text, /churn figure is not recorded/, `${what}: no speaker notes`);
    for (const k of ['audience', 'round', 'by', 'content_hash']) assert.equal(k in r.body, false, `${what}: no ${k}`);
    assert.doesNotMatch(text, /Synthetic seed|round-seed|seed_fund/, `${what}: no round or audience`);
  }
});

test('10. the editor reads the slide model from the Worker: the grid, the twelve layouts, the kinds', async () => {
  const f = await fixture();
  const r = await call(f, OWNER, 'GET', '/api/decks/model');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.grid, { cols: 12, rows: 6 });
  assert.deepEqual(r.body.layouts.map((l: any) => l.id), LAYOUTS.map((l) => l.id));
  assert.equal(r.body.chart_types.length, 12);
  assert.ok(r.body.block_kinds.includes('video'));
  assert.ok([401, 403].includes((await call(f, null, 'GET', '/api/decks/model')).status), 'signed out reads nothing');
});

test("11. the brand kit: the newest live landing page's palette, fonts, voice and logos; none is null; a failed read is 503", async () => {
  const f = await fixture();
  let r = await call(f, OWNER, 'GET', '/api/decks/brand-kit?project_id=1');
  assert.deepEqual([r.status, r.body.kit], [200, null], 'no landing page: no kit, never a sample');
  const page = f.db.prepare(`INSERT INTO landing_pages (project_id, slug, name, theme_color, palette_bg, palette_ink, palette_accent, font_pairing, voice_json, logo_url, logo_svg, archived_at)
    VALUES (1, ?, ?, '#2BB39A', ?, '#0f2a3d', NULL, 'Outfit + Space Grotesk', ?, ?, '<svg onload="x()"></svg>', ?)`);
  page.run('live', 'Synthetic Labs', '#fbfaf7', JSON.stringify({ tags: ['plain', 'warm'] }), 'https://example.com/logo.png', null);
  page.run('newer-archived', 'Synthetic Archived', '#000000', '[]', null, '2026-01-01'); // newer, but archived
  r = await call(f, COFOUNDER, 'GET', '/api/decks/brand-kit?project_id=1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.kit.name, 'Synthetic Labs', 'the archived page is not the kit');
  assert.deepEqual(r.body.kit.palette, { bg: '#fbfaf7', ink: '#0f2a3d', accent: '#2bb39a', secondary: null }, 'the accent falls back to the theme colour');
  assert.deepEqual(r.body.kit.voice, ['plain', 'warm']);
  assert.deepEqual(r.body.kit.logo, { light: 'https://example.com/logo.png', dark: null, inline: true });
  assert.doesNotMatch(JSON.stringify(r.body), /<svg|onload/, 'the inline SVG never leaves the Worker');
  for (const who of [ADVISOR, INVESTOR, OTHER_FOUNDER]) assert.equal((await call(f, who, 'GET', '/api/decks/brand-kit?project_id=1')).status, 403, String(who));
  assert.equal((await call(f, OWNER, 'GET', '/api/decks/brand-kit')).status, 400);
  f.db.exec('DROP TABLE landing_pages');
  r = await call(f, OWNER, 'GET', '/api/decks/brand-kit?project_id=1');
  assert.deepEqual([r.status, r.body.code], [503, 'unreadable'], 'a failed read is unreadable, never an empty kit');
});

test('12. a video link is checked with its provider only, on fixed URLs, with no redirect followed', async () => {
  const asked: Array<[string, any]> = [];
  const answer = (status: number, body: unknown) => async (url: string, init: any) => { asked.push([url, init]); return new Response(JSON.stringify(body), { status }); };
  let r = await checkVideoLink('https://youtu.be/AbCdEfGhIjK', sanitizeImageUrl, answer(200, { title: 'Synthetic demo', thumbnail_url: 'https://evil.test/x.jpg' }) as any);
  assert.deepEqual(r, { state: 'ok', provider: 'youtube', video_id: 'AbCdEfGhIjK', url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK', title: 'Synthetic demo', poster_url: 'https://i.ytimg.com/vi/AbCdEfGhIjK/hqdefault.jpg' });
  assert.equal(asked[0][0], 'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DAbCdEfGhIjK', 'a fixed endpoint, the canonical URL');
  assert.equal(asked[0][1].redirect, 'error');
  r = await checkVideoLink('https://vimeo.com/123456789', sanitizeImageUrl, answer(200, { title: 'V', thumbnail_url: 'https://i.vimeocdn.com/video/1.jpg' }) as any);
  assert.equal((r as any).poster_url, 'https://i.vimeocdn.com/video/1.jpg');
  r = await checkVideoLink('https://vimeo.com/123456789', sanitizeImageUrl, answer(200, { title: 'V', thumbnail_url: 'https://images.example.com/x.jpg' }) as any);
  assert.equal((r as any).poster_url, null, "a poster off the provider's host is dropped");
  assert.deepEqual(await checkVideoLink('https://youtu.be/AbCdEfGhIjK', sanitizeImageUrl, answer(404, {}) as any), { state: 'not_found' });
  assert.deepEqual(await checkVideoLink('https://youtu.be/AbCdEfGhIjK', sanitizeImageUrl, answer(500, {}) as any), { state: 'unreadable' });
  assert.deepEqual(await checkVideoLink('https://youtu.be/AbCdEfGhIjK', sanitizeImageUrl, (async () => { throw new Error('net'); }) as any), { state: 'unreadable' });
  const before = asked.length;
  assert.deepEqual(await checkVideoLink('https://example.com/v.mp4', sanitizeImageUrl, answer(200, {}) as any), { state: 'refused' });
  assert.equal(asked.length, before, 'a link that is not YouTube or Vimeo is never fetched');
  // Through the route, on a stubbed fetch.
  const f = await fixture();
  const real = globalThis.fetch;
  try {
    globalThis.fetch = answer(200, { title: 'Synthetic demo' }) as any;
    const ok = await call(f, OWNER, 'GET', `/api/decks/video-link?url=${encodeURIComponent('https://youtu.be/AbCdEfGhIjK')}`);
    assert.deepEqual([ok.status, ok.body.title], [200, 'Synthetic demo']);
    const no = await call(f, OWNER, 'GET', `/api/decks/video-link?url=${encodeURIComponent('https://example.com/v.mp4')}`);
    assert.deepEqual([no.status, no.body.error], [400, 'Paste a YouTube or Vimeo link.']);
    globalThis.fetch = answer(404, {}) as any;
    assert.equal((await call(f, OWNER, 'GET', `/api/decks/video-link?url=${encodeURIComponent('https://youtu.be/AbCdEfGhIjK')}`)).status, 404);
    globalThis.fetch = answer(502, {}) as any;
    assert.equal((await call(f, OWNER, 'GET', `/api/decks/video-link?url=${encodeURIComponent('https://youtu.be/AbCdEfGhIjK')}`)).status, 503);
  } finally { globalThis.fetch = real; }
});
