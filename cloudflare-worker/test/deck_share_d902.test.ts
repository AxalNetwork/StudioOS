/**
 * D902 (#2681) — Pitch deck studio part 8: the share link with its NDA, what
 * a link includes, and the analytics per version.
 *
 * On node:sqlite with the tables cut from `schema_baseline.sql` and the link
 * migrations as written (248, 442, 463, 540). Every name, firm and figure here
 * is invented.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_share_d902.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import decks, { createShareLink, revokeShareLink, SHARE_LINK_CLOSED, SHARE_NO_VIEW_LIMIT } from '../src/routes/decks.ts';
import deckShareActions, { DEAL_PACK_NOT_OFFERED, NDA_YOUR_EMAIL, NDA_YOUR_NAME } from '../src/routes/deck_share_actions.ts';
import { createDeckLink, WriterError } from '../src/services/raiseWriters.ts';
import { DEFAULT_SHARE_INCLUDE, parseShareInclude, shareIncludeFromBody, shareSlides, shareSpinoutFields } from '../src/services/decks/shareInclude.ts';
import { askCardIndex, medianSeconds, NO_ASK_CARD } from '../src/services/decks/shareAnalytics.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SQL = resolve(process.cwd(), 'cloudflare-worker/sql');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(SQL, `migrations/${file}`), 'utf8');

const P = 1;
const ADMIN = 30;
const VIEWER = 40;
const FOUNDER = 50;
const V1 = 5;
const V2 = 6;
const PROSPECT = 7;

/** Version 2: a cover, a figure card, the ask, and a Sources appendix. */
const V2_SLIDES = [
  { title: 'Kestrel Labs', fields: [{ key: 'cover_headline', label: 'Headline', kind: 'paragraph', value: 'Seed round', source: 'data' }] },
  {
    title: 'Traction',
    fields: [
      { key: 'traction_grid', label: 'Traction', kind: 'metric_grid', value: [{ label: 'Customers', value: '38' }], source: 'data' },
      { key: 'bank_balance', label: 'Bank balance', kind: 'paragraph', value: '$410,000', source: 'data' },
      { key: 'validation_quote', label: 'Quote', kind: 'quote', value: 'It saved us a week.', source: 'data' },
      { key: 'vr_total_score', label: 'Score', kind: 'paragraph', value: '72', source: 'auto' },
    ],
  },
  { title: 'The Ask', fields: [{ key: 'ask_amount_usd', label: 'Ask', kind: 'paragraph', value: '$1.5M', source: 'data' }] },
  { title: 'Sources', appendix: true, fields: [{ key: 'sources_list', label: 'Sources', kind: 'bullets', value: ['Stripe'], source: 'data' }] },
];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_sessions', 'super_admins', 'projects', 'activity_logs', 'spinout_deck_overrides',
    'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'raise_prospects', 'documents', 'legal_templates']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(sqlOf('248_deck_share_revoked_at.sql'));
  addColumnsFrom(db, stripForeignKeys(sqlOf('463_raise_record_stores.sql')), 'pitch_deck_share_tokens');
  db.exec(sqlOf('540_deck_share_nda_include.sql'));
  db.exec(/CREATE TABLE IF NOT EXISTS deck_view_slides \([\s\S]*?\n\);/.exec(sqlOf('442_raise_cycle_stores.sql'))![0]);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test');
  u.run(VIEWER, 'investor', 'Ivo Viewer', 'ivo@example.test');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test');
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, VIEWER, FOUNDER]) ss.run(id, `j-${id}`);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(V1, P, 1, JSON.stringify(V2_SLIDES.slice(0, 3)), 'Seed deck', 0, '2026-10-02 09:00:00');
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(V2, P, 2, JSON.stringify(V2_SLIDES), 'Seed deck', 1, '2026-10-21 09:00:00');
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm) VALUES (?, 'p-7', ?, 'Pat Partner', 'Fund A')").run(PROSPECT, P);
  db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES ('investor_nda_axal', 'Investor NDA', 'investor', ?, '[]', 2, 1, 0)`)
    .run('This NDA is between {{recipient_name}} ({{recipient_email}}) and {{counterparty_name}}, from {{effective_date}}.');
  return db;
}

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
const admin = { id: ADMIN, role: 'admin', email: 'ada@example.test' } as any;

const app = new Hono<any>();
app.route('/api/decks', deckShareActions);
app.route('/api/decks', decks);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function bearer(as: number) {
  return new SignJWT({ user_id: as, role: as === ADMIN ? 'admin' : as === FOUNDER ? 'founder' : 'investor', jti: `j-${as}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
async function req(db: DatabaseSync, method: string, path: string, as: number | null = null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${await bearer(as)}`;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, envOf(db));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const tokenOf = (sharePath: string) => sharePath.replace('/share/deck/', '');
const tokRow = (db: DatabaseSync, id: number) => db.prepare('SELECT * FROM pitch_deck_share_tokens WHERE id = ?').get(id) as any;
const viewCount = (db: DatabaseSync) => Number((db.prepare('SELECT COUNT(*) AS n FROM deck_share_views').get() as any).n);

async function studioLink(db: DatabaseSync, body: Record<string, unknown> = {}) {
  return createDeckLink(envOf(db), { projectId: P, user: admin, body: { deck_id: V2, prospect_id: PROSPECT, expires_days: 14, ...body } });
}

// ---------------------------------------------------------------------------
// What a link includes (answer A)
// ---------------------------------------------------------------------------

test('answer A by default: figures and the Sources appendix go; never a bank figure, an internal score or a quote without consent', () => {
  const out = shareSlides(V2_SLIDES, DEFAULT_SHARE_INCLUDE);
  assert.deepEqual(out.map((s) => s.title), ['Kestrel Labs', 'Traction', 'The Ask', 'Sources']);
  assert.deepEqual(out[1].fields.map((f: any) => f.key), ['traction_grid']);
  const consented = shareSlides([{ title: 'Q', fields: [{ key: 'q', kind: 'quote', value: 'Yes.', consent: true }] }], DEFAULT_SHARE_INCLUDE);
  assert.equal(consented[0].fields.length, 1, 'a quote with its consent recorded goes');
  for (const key of ['bank_account', 'balances_total', 'counterparty_name', 'iban', 'vr_tier']) {
    assert.equal(shareSlides([{ title: 'x', fields: [{ key, kind: 'paragraph', value: 'v' }] }], { ...DEFAULT_SHARE_INCLUDE, figures: true, bands: true, notes: true })[0].fields.length, 0, key);
  }
});

test('each switch: figures, the Sources appendix, speaker notes and the bands', () => {
  const notes = [{ title: 'A', notes: 'Say this.', fields: [{ key: 'scorecard_band', kind: 'paragraph', value: 'B', notes: 'n' }] }];
  assert.equal(shareSlides(V2_SLIDES, { ...DEFAULT_SHARE_INCLUDE, figures: false })[1].fields.length, 0);
  assert.deepEqual(shareSlides(V2_SLIDES, { ...DEFAULT_SHARE_INCLUDE, sources: false }).map((s) => s.title), ['Kestrel Labs', 'Traction', 'The Ask']);
  assert.equal('notes' in shareSlides(notes, DEFAULT_SHARE_INCLUDE)[0], false, 'notes off by default');
  assert.equal(shareSlides(notes, { ...DEFAULT_SHARE_INCLUDE, notes: true })[0].notes, 'Say this.');
  assert.equal(shareSlides(notes, DEFAULT_SHARE_INCLUDE)[0].fields.length, 0, 'a band only when bands are on');
  const both = shareSlides(notes, { ...DEFAULT_SHARE_INCLUDE, bands: true, notes: false })[0].fields[0];
  assert.equal('notes' in both, false, 'a field\'s notes go only with notes on');
  // A band is named by its prefix or by its suffix; each alone is enough.
  for (const key of ['pmf_score', 'band_summary', 'market_band']) {
    const one = [{ title: 'B', fields: [{ key, kind: 'paragraph', value: 'x' }] }];
    assert.equal(shareSlides(one, DEFAULT_SHARE_INCLUDE)[0].fields.length, 0, key);
    assert.equal(shareSlides(one, { ...DEFAULT_SHARE_INCLUDE, bands: true })[0].fields.length, 1, key);
  }
  for (const key of ['bandwidth', 'team_pmf_note']) {
    assert.equal(shareSlides([{ title: 'C', fields: [{ key, kind: 'paragraph', value: 'x' }] }], DEFAULT_SHARE_INCLUDE)[0].fields.length, 1, `${key} is not a band`);
  }
  assert.deepEqual(shareSpinoutFields({ vr_total_score: '72', team_founder: 'Fay', bank_balance: '1' }), { team_founder: 'Fay' });
});

test('a D896 binding leaves as its grade and date only, and a field bound to a score, a bank slot or a band is judged by that slot', () => {
  const binding = (source_key: string) => ({ source_key, record_ref: 'rec-41', as_of: '2026-10-20', grade: 'Measured', snapshot_hash: 'a'.repeat(24) });
  const slides = [{
    title: 'Traction', binding: binding('raise.mrr'),
    fields: [
      { key: 'mrr', kind: 'metric_grid', value: [{ label: 'MRR', value: '$12k' }], binding: binding('grow.mrr') },
      { key: 'runway', kind: 'paragraph', value: '14 months', binding: binding('raise.bank_balance') },
      { key: 'score', kind: 'paragraph', value: '71', binding: binding('scoring.vr_total') },
      { key: 'fit', kind: 'paragraph', value: 'Strong', binding: binding('scoring.pmf_band') },
    ],
    blocks: [{ kind: 'chart', binding: binding('grow.mrr') }],
  }];
  const [out] = shareSlides(slides, DEFAULT_SHARE_INCLUDE);
  assert.deepEqual(out.fields.map((f: any) => f.key), ['mrr'], 'the bank slot, the score and the band are not on the link');
  assert.deepEqual(out.fields[0].binding, { grade: 'Measured', as_of: '2026-10-20' });
  assert.deepEqual(out.binding, { grade: 'Measured', as_of: '2026-10-20' });
  assert.deepEqual(out.blocks[0].binding, { grade: 'Measured', as_of: '2026-10-20' });
  assert.doesNotMatch(JSON.stringify(out), /rec-41|aaaaaaaa|source_key/);
  const [banded] = shareSlides(slides, { ...DEFAULT_SHARE_INCLUDE, bands: true });
  assert.deepEqual(banded.fields.map((f: any) => f.key), ['mrr', 'fit'], 'bands on: the band, never the score or the bank');
});

test('the stored include and the body\'s include', () => {
  assert.deepEqual(parseShareInclude(null), DEFAULT_SHARE_INCLUDE);
  assert.deepEqual(parseShareInclude('not json'), DEFAULT_SHARE_INCLUDE);
  assert.deepEqual(parseShareInclude('{"notes":true,"figures":"yes"}'), { ...DEFAULT_SHARE_INCLUDE, notes: true });
  assert.deepEqual(shareIncludeFromBody(undefined), DEFAULT_SHARE_INCLUDE);
  assert.deepEqual(shareIncludeFromBody({ sources: false }), { ...DEFAULT_SHARE_INCLUDE, sources: false });
  for (const bad of [null, [], 'all', { secret: true }, { notes: 1 }]) assert.equal(shareIncludeFromBody(bad), null, JSON.stringify(bad));
});

// ---------------------------------------------------------------------------
// The one link writer
// ---------------------------------------------------------------------------

test('the one writer stores the view limit, the NDA and what is included, and says which version it is frozen to', async () => {
  const db = fixture();
  const out = await studioLink(db, { view_limit: 5, nda_required: true, include: { notes: true }, allow_download: false });
  assert.equal(out.view_limit, 5);
  assert.equal(out.nda_required, true);
  assert.deepEqual(out.include, { ...DEFAULT_SHARE_INCLUDE, notes: true });
  assert.equal(out.deck_version, 2);
  const row = tokRow(db, out.id);
  assert.equal(row.view_limit, 5);
  assert.equal(row.nda_required, 1);
  assert.deepEqual(JSON.parse(row.include_json), { ...DEFAULT_SHARE_INCLUDE, notes: true });
  assert.equal(row.allow_download, 0);
  const plain = await studioLink(db);
  assert.equal(tokRow(db, plain.id).view_limit, SHARE_NO_VIEW_LIMIT, 'no view limit is the sentinel');
  assert.equal(tokRow(db, plain.id).nda_required, 0);
  assert.deepEqual(JSON.parse(tokRow(db, plain.id).include_json), DEFAULT_SHARE_INCLUDE);
  assert.equal(plain.view_limit, null);
});

test('two links for one version in the same second are two tokens', async () => {
  const db = fixture();
  const real = Date.now;
  const frozen = real();
  Date.now = () => frozen;
  try {
    const [x, y] = [await studioLink(db), await studioLink(db)];
    assert.notEqual(x.share_path, y.share_path);
  } finally { Date.now = real; }
});

test('the writer refuses a view limit, an NDA flag or an include it cannot store', async () => {
  const db = fixture();
  for (const body of [{ view_limit: 0 }, { view_limit: 101 }, { view_limit: 1.5 }, { view_limit: '5' }, { nda_required: 'yes' }, { include: { secret: true } }, { include: [] }]) {
    await assert.rejects(studioLink(db, body), (e: any) => e instanceof WriterError && e.status === 400, JSON.stringify(body));
  }
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM pitch_deck_share_tokens').get() as any).n), 0, 'nothing stored');
});

// ---------------------------------------------------------------------------
// The NDA gate
// ---------------------------------------------------------------------------

test('a link with the NDA required returns no card, and uses no view, before the NDA is accepted on it', async () => {
  const db = fixture();
  const link = await studioLink(db, { nda_required: true });
  const token = tokenOf(link.share_path);
  for (const as of [null, VIEWER]) {
    const r = await req(db, 'GET', `/api/decks/share/${token}`, as);
    assert.equal(r.status, 200);
    assert.equal(r.body.gate, 'nda');
    assert.equal(r.body.nda_accepted, false);
    assert.equal(r.body.signed_in, as != null);
    assert.equal(r.body.project_name, 'Kestrel Labs');
    assert.deepEqual(r.body.frozen, { version: 2, as_of: '2026-10-21 09:00:00' });
    assert.equal('slides' in r.body, false, 'no card before acceptance');
  }
  assert.equal(viewCount(db), 0);
  assert.equal(tokRow(db, link.id).view_count, 0);
  // Another link's acceptance, or another person's, does not open this one.
  const other = await studioLink(db, { nda_required: true });
  db.exec('CREATE TABLE IF NOT EXISTS deck_share_conversions (id INTEGER PRIMARY KEY AUTOINCREMENT, view_id INTEGER, share_token_id INTEGER, deck_id INTEGER NOT NULL, project_id INTEGER, user_id INTEGER, type TEXT NOT NULL, ref_id TEXT, created_at TEXT DEFAULT (datetime(\'now\')))');
  db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, user_id, type) VALUES (?, ?, ?, 'nda_signed')").run(other.id, V2, VIEWER);
  db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, user_id, type) VALUES (?, ?, ?, 'nda_signed')").run(link.id, V2, FOUNDER);
  assert.equal((await req(db, 'GET', `/api/decks/share/${token}`, VIEWER)).body.gate, 'nda');
  db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, user_id, type) VALUES (?, ?, ?, 'signup')").run(link.id, V2, VIEWER);
  assert.equal((await req(db, 'GET', `/api/decks/share/${token}`, VIEWER)).body.gate, 'nda', 'a signup is not an NDA');
  // Accepted on this link by this person: the cards, and a view.
  db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, user_id, type) VALUES (?, ?, ?, 'nda_signed')").run(link.id, V2, VIEWER);
  const open = await req(db, 'GET', `/api/decks/share/${token}`, VIEWER);
  assert.equal(open.status, 200);
  assert.equal(open.body.gate, undefined);
  assert.equal(open.body.nda_required, true);
  assert.equal(open.body.slides.length, 4);
  assert.equal(viewCount(db), 1);
});

test('a link without the NDA opens at once, sends only what it includes, and says what it includes and its version', async () => {
  const db = fixture();
  const link = await studioLink(db, { include: { sources: false } });
  const r = await req(db, 'GET', `/api/decks/share/${tokenOf(link.share_path)}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.slides.map((s: any) => s.title), ['Kestrel Labs', 'Traction', 'The Ask']);
  assert.deepEqual(r.body.slides[1].fields.map((f: any) => f.key), ['traction_grid']);
  assert.doesNotMatch(JSON.stringify(r.body), /410,000|vr_total_score|saved us a week/);
  assert.deepEqual(r.body.included, { ...DEFAULT_SHARE_INCLUDE, sources: false });
  assert.equal(r.body.nda_required, false);
  assert.equal(r.body.offers_deal_pack, false, 'a studio link offers no deal pack');
  assert.deepEqual(r.body.frozen, { version: 2, as_of: '2026-10-21 09:00:00' });
});

test('a link made before 540 opens with answer A', async () => {
  const db = fixture();
  const { token } = await createShareLink(envOf(db), { deckId: V2, deckVersion: 2, userId: ADMIN, actorEmail: null, ttlSeconds: null, projectId: P });
  db.exec('UPDATE pitch_deck_share_tokens SET include_json = NULL');
  const r = await req(db, 'GET', `/api/decks/share/${token}`);
  assert.deepEqual(r.body.included, DEFAULT_SHARE_INCLUDE);
  assert.doesNotMatch(JSON.stringify(r.body.slides), /410,000/);
});

// ---------------------------------------------------------------------------
// PD22: the closed link
// ---------------------------------------------------------------------------

test('a withdrawn or expired link says so, names the venture to ask, and shows nothing from the deck', async () => {
  const db = fixture();
  const gone = await studioLink(db);
  await revokeShareLink(envOf(db), V2, gone.id);
  const r = await req(db, 'GET', `/api/decks/share/${tokenOf(gone.share_path)}`);
  assert.equal(r.status, 410);
  assert.deepEqual(r.body, { error: 'share link is no longer valid', code: 'link_closed', message: SHARE_LINK_CLOSED, venture: 'Kestrel Labs', ask: 'Ask Kestrel Labs for a new one.' });
  assert.equal(SHARE_LINK_CLOSED, 'This link is no longer open.');

  const { token } = await createShareLink(envOf(db), { deckId: V2, deckVersion: 2, userId: ADMIN, actorEmail: null, ttlSeconds: 60, projectId: P });
  const real = Date.now;
  Date.now = () => real() + 120_000;
  try {
    const e = await req(db, 'GET', `/api/decks/share/${token}`);
    assert.equal(e.status, 410);
    assert.equal(e.body.error, 'share link has expired');
    assert.equal(e.body.venture, 'Kestrel Labs');
    assert.equal('slides' in e.body, false);
  } finally { Date.now = real; }

  // A token whose signature is forged names nothing.
  const forged = `${token.split('.')[0]}.AAAA`;
  const f = await req(db, 'GET', `/api/decks/share/${forged}`);
  assert.equal(f.status, 403);
  assert.doesNotMatch(JSON.stringify(f.body), /Kestrel/);
});

// ---------------------------------------------------------------------------
// The NDA's text, the context, and the deal pack
// ---------------------------------------------------------------------------

test('the NDA text reads before acceptance: the person\'s own fields as placeholders, or filled when signed in', async () => {
  const db = fixture();
  const link = await studioLink(db, { nda_required: true });
  const path = `/api/decks/share/${tokenOf(link.share_path)}/nda`;
  const anon = await req(db, 'GET', path);
  assert.equal(anon.status, 200);
  assert.equal(anon.body.filled_for_you, false);
  assert.ok(anon.body.text.includes(`${NDA_YOUR_NAME} (${NDA_YOUR_EMAIL}) and Kestrel Labs`));
  const me = await req(db, 'GET', path, VIEWER);
  assert.equal(me.body.filled_for_you, true);
  assert.ok(me.body.text.includes('Ivo Viewer (ivo@example.test) and Kestrel Labs'));
  db.exec("UPDATE legal_templates SET body_md = 'Signed by {{recipient_name}} for {{fund_name}}.'");
  assert.equal((await req(db, 'GET', path)).status, 409, 'a field nobody can fill is refused, as the POST refuses it');
});

test('a studio link says it needs the NDA and offers no deal pack; the deal-pack routes refuse it; a Lab link still offers it', async () => {
  const db = fixture();
  const link = await studioLink(db, { nda_required: true });
  const t = tokenOf(link.share_path);
  const ctx = await req(db, 'GET', `/api/decks/share/${t}/context`);
  assert.equal(ctx.body.nda_required, true);
  assert.equal(ctx.body.offers_deal_pack, false);
  for (const p of ['deal-pack', 'deal-pack/sign']) {
    const r = await req(db, 'POST', `/api/decks/share/${t}/${p}`, VIEWER, { check_size: 1, valuation_cap: 1, discount: 1, signed_by: 'x', document_ids: [] });
    assert.equal(r.status, 404, p);
    assert.deepEqual(r.body, { code: 'deal_pack_not_offered', detail: DEAL_PACK_NOT_OFFERED });
  }
  const lab = await createShareLink(envOf(db), { deckId: V2, deckVersion: 2, userId: ADMIN, actorEmail: null, ttlSeconds: null, projectId: P });
  const labCtx = await req(db, 'GET', `/api/decks/share/${lab.token}/context`);
  assert.equal(labCtx.body.offers_deal_pack, true);
  assert.equal((await req(db, 'GET', `/api/decks/share/${lab.token}`)).body.offers_deal_pack, true, 'the share read agrees with the context');
  assert.equal(labCtx.body.nda_required, false);
});

// ---------------------------------------------------------------------------
// PD19: the analytics, per version
// ---------------------------------------------------------------------------

test('the ask card and the median', () => {
  assert.equal(askCardIndex(V2_SLIDES), 2);
  assert.equal(askCardIndex([{ title: 'Cover' }, { spec_id: 'seed_ask', title: 'Round' }]), 1);
  assert.equal(askCardIndex([{ title: 'Asking around' }, { title: 'Team' }]), null);
  assert.equal(askCardIndex(null), null);
  assert.equal(medianSeconds([]), null);
  assert.equal(medianSeconds([100, 80]), 90);
  assert.equal(medianSeconds([5, 1, 9]), 5);
});

test('engagement adds, for this version: viewers, the median per viewer, seconds per card against the version before, the ask, and each link', async () => {
  const db = fixture();
  const a = await studioLink(db, { nda_required: true, view_limit: 3, allow_forwarding: false });
  const b = await createDeckLink(envOf(db), { projectId: P, user: admin, body: { deck_id: V2, investor_label: 'Typed Name Capital', expires_days: null } });
  const v = db.prepare('INSERT INTO deck_share_views (id, share_token_id, deck_id, ip_hash, ua_fingerprint, read_seconds) VALUES (?, ?, ?, ?, ?, ?)');
  v.run(1, a.id, V2, 'ip-a', 'ua-a', 30); // viewer A, twice: 80 s
  v.run(2, a.id, V2, 'ip-a', 'ua-a', 50);
  v.run(3, b.id, V2, 'ip-b', 'ua-b', 100); // viewer B: 100 s
  v.run(4, b.id, V1, 'ip-c', 'ua-c', 999); // version 1: not this version's
  const s = db.prepare('INSERT INTO deck_view_slides (view_id, slide_index, seconds) VALUES (?, ?, ?)');
  s.run(1, 0, 10); s.run(1, 1, 10); s.run(1, 2, 10); // A reached the ask (card 2)
  s.run(3, 0, 60); s.run(3, 1, 40); // B did not
  s.run(4, 0, 7); s.run(4, 1, 3); // version 1
  db.exec("CREATE TABLE IF NOT EXISTS deck_share_conversions (id INTEGER PRIMARY KEY AUTOINCREMENT, view_id INTEGER, share_token_id INTEGER, deck_id INTEGER NOT NULL, project_id INTEGER, user_id INTEGER, type TEXT NOT NULL, ref_id TEXT, created_at TEXT DEFAULT (datetime('now')))");
  db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, user_id, type) VALUES (?, ?, ?, 'nda_signed')").run(a.id, V2, VIEWER);
  db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, user_id, type) VALUES (?, ?, ?, 'nda_signed')").run(a.id, V2, VIEWER);

  const r = await req(db, 'GET', `/api/decks/${V2}/engagement`, ADMIN);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.analytics, {
    available: true,
    viewers: 2,
    median_seconds_per_viewer: 90,
    cards: { version: 2, seconds: [{ index: 0, seconds: 70 }, { index: 1, seconds: 50 }, { index: 2, seconds: 10 }] },
    previous: { version: 1, deck_id: V1, seconds: [{ index: 0, seconds: 7 }, { index: 1, seconds: 3 }] },
    reached_ask: { recorded: true, ask_index: 2, viewers: 1 },
  });
  const byId = new Map(r.body.shares.map((x: any) => [x.id, x]));
  assert.deepEqual(
    (({ investor, allow_download, allow_forwarding, nda_required, nda_signed, view_limit }) => ({ investor, allow_download, allow_forwarding, nda_required, nda_signed, view_limit }))(byId.get(a.id) as any),
    { investor: 'Fund A', allow_download: true, allow_forwarding: false, nda_required: true, nda_signed: 1, view_limit: 3 },
  );
  assert.equal((byId.get(b.id) as any).investor, 'Typed Name Capital');
  assert.equal((byId.get(b.id) as any).nda_signed, 0);
  assert.deepEqual((byId.get(b.id) as any).include, DEFAULT_SHARE_INCLUDE);
  assert.doesNotMatch(JSON.stringify(r.body.analytics), /ip-|ua-/, 'no hash in the analytics');

  // A version with no ask card says so.
  db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = ?').run(JSON.stringify([{ title: 'Cover' }]), V2);
  const r2 = await req(db, 'GET', `/api/decks/${V2}/engagement`, ADMIN);
  assert.deepEqual(r2.body.analytics.reached_ask, { recorded: false, reason: NO_ASK_CARD });
  // The first version has no version before it; a version nobody opened has no median.
  const first = (await req(db, 'GET', `/api/decks/${V1}/engagement`, ADMIN)).body.analytics;
  assert.equal(first.previous, null);
  // The version before is the nearest one, not the first.
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(V2 + 100, P, 3, '[]', 'Seed', 0, '2026-10-23 09:00:00');
  const third = (await req(db, 'GET', `/api/decks/${V2 + 100}/engagement`, ADMIN)).body.analytics;
  assert.deepEqual([third.previous.version, third.previous.deck_id], [2, V2]);
  db.exec('DELETE FROM deck_share_views');
  assert.equal((await req(db, 'GET', `/api/decks/${V2}/engagement`, ADMIN)).body.analytics.median_seconds_per_viewer, null);
});

test('analytics that cannot be read answer alone, and the links still list', async () => {
  const db = fixture();
  await studioLink(db);
  db.exec('DROP TABLE deck_view_slides');
  const r = await req(db, 'GET', `/api/decks/${V2}/engagement`, ADMIN);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.analytics, { available: false, unreadable: true, reason: 'The views on this version could not be read. That is not the same as none.' });
  assert.equal(r.body.shares.length, 1);
  assert.equal(r.body.shares[0].investor, null);
  assert.equal(r.body.shares[0].nda_signed, null);
});
