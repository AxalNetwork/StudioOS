/**
 * D1586 (#3833, deck v2 F7) — data-room proof links behind a shared figure.
 *
 *   1. `include.evidence` is off by default; with it on, only a data-room
 *      citation that a figure the link sends carries goes out, as `proof_ref`,
 *      and only on a link that requires the NDA.
 *   2. `GET /share/:token/proof/:ref` checks, in order: the link and its
 *      evidence, the NDA, email → account → grant, the ref, the file's tier.
 *   3. Private evidence (a bank figure, a quote, any non-data-room record) is
 *      never resolvable, even with every other check passing and the cited
 *      file sitting in the room.
 *
 * On the real migrated schema (`_storage_schema.ts`). Every name, email and
 * figure is invented; no file is read and nothing is sent.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_proof_links_d1586.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import decks from '../src/routes/decks.ts';
import deckShareActions from '../src/routes/deck_share_actions.ts';
import deckProof from '../src/routes/deck_proof.ts';
import { createDeckLink } from '../src/services/raiseWriters.ts';
import { DEFAULT_SHARE_INCLUDE, parseShareInclude, shareIncludeFromBody, sharedProofRefs, shareSlides } from '../src/services/decks/shareInclude.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

after(() => removeMigratedDatabases());

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const P = 1;
const DECK = 5;
const PROSPECT = 7;
const ADMIN = 30, INVESTOR = 40, STRANGER = 41, FOUNDER = 50;

const b = (source_key: string, record_ref: string) => ({ source_key, record_ref, grade: 'Sourced', as_of: '2026-10-01', snapshot_hash: 'h' });
const REF = {
  open: 'dataroom:f-open:v2:p3',
  bank: 'dataroom:f-bank:v1:p1',
  quote: 'dataroom:f-quote:v1:p1',
  iq: 'dataroom:f-iq:v1:p2',
  nda: 'dataroom:f-nda:v1:p0',
  tier: 'dataroom:f-tier:v1:p1',
  old: 'dataroom:f-old:v1:p1',
  mercury: 'mercury:acct-1:balance',
  forged: 'dataroom:f-forged:v1:p1',
};
const SLIDES = [
  {
    title: 'Plan',
    fields: [
      { key: 'plan_revenue', label: 'Revenue plan', kind: 'paragraph', value: '$2.4M', binding: b('dataroom.revenue_plan', REF.open) },
      // A bank field, cited to a file in the room: never on a link, so never proved.
      { key: 'bank_balance', label: 'Bank', kind: 'paragraph', value: '$410,000', binding: b('dataroom.revenue_plan', REF.bank) },
      // A quote with no consent recorded: never on a link.
      { key: 'customer_quote', label: 'Quote', kind: 'quote', value: 'It saved us a week.', binding: b('dataroom.contract_count', REF.quote) },
      // A bank record: not a data-room citation at all.
      { key: 'cash_note', label: 'Cash', kind: 'paragraph', value: 'Runway', binding: b('mercury.runway', REF.mercury) },
      // A data-room-shaped ref on a slot that is not a data-room slot: not a citation either.
      { key: 'runway_note', label: 'Runway', kind: 'paragraph', value: '14 months', binding: b('mercury.runway', REF.forged) },
    ],
  },
  {
    title: 'Grid',
    blocks: [
      { kind: 'metric', binding: b('dataroom.headcount_plan', REF.nda) },
      // An interview quote whose session recorded no consent: the consent gate leaves it out.
      { element: 'interview_quote', kind: 'text', session_uid: 's-none', binding: b('dataroom.contract_count', REF.iq) },
      { kind: 'chart', series: [{ name: 'Plan', binding: b('dataroom.revenue_plan', REF.tier) }] },
      { kind: 'metric', binding: b('dataroom.contract_count', REF.old) },
    ],
  },
];

function fixture() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id, is_active, email_verified) VALUES (?, ?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null, 1);
  u.run(INVESTOR, 'investor', 'Ivo Investor', 'ivo@example.test', null, 1);
  u.run(STRANGER, 'investor', 'Sam Stranger', 'sam@example.test', null, 1);
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001, 1);
  const ss = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, INVESTOR, STRANGER, FOUNDER]) ss.run(id, `j-${id}`);
  db.exec(`INSERT INTO projects (id, uid, name, founder_id) VALUES (${P}, 'proj-kestrel', 'Kestrel Labs', 1001)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_at) VALUES (?, ?, 1, ?, ?, 1, ?)')
    .run(DECK, P, JSON.stringify(SLIDES), 'Seed deck', '2026-10-21 09:00:00');
  // The prospect's email differs in case from the account's: it is the same address.
  db.prepare("INSERT INTO raise_prospects (id, uid, project_id, name, firm, email, stage) VALUES (?, 'p-7', ?, 'Ivo Investor', 'Fund A', 'Ivo@Example.test', 'diligence')").run(PROSPECT, P);
  const f = db.prepare(`INSERT INTO data_room_files (uid, project_id, name, r2_key, visibility, access_tier, deck_source, deck_source_revision, deck_extract_state)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'done')`);
  f.run('f-open', P, 'Plan.xlsx', 'data-room/1/f-open', 'open', 'invited', 2);
  f.run('f-bank', P, 'Bank.csv', 'data-room/1/f-bank', 'open', 'invited', 1);
  f.run('f-quote', P, 'Quotes.csv', 'data-room/1/f-quote', 'open', 'invited', 1);
  f.run('f-iq', P, 'Interviews.pdf', 'data-room/1/f-iq', 'open', 'invited', 1);
  f.run('f-nda', P, 'Headcount.csv', 'data-room/1/f-nda', 'nda', 'invited', 1);
  f.run('f-tier', P, 'Model.xlsx', 'data-room/1/f-tier', 'open', 'committed', 1);
  f.run('f-old', P, 'Contracts.pdf', 'data-room/1/f-old', 'open', 'invited', 2); // replaced since the deck cited v1
  const g = db.prepare("INSERT INTO data_room_grants (uid, project_id, investor_user_id, granted_by_user_id, status) VALUES (?, ?, ?, ?, 'active')");
  g.run('g-ivo', P, INVESTOR, FOUNDER);
  g.run('g-sam', P, STRANGER, FOUNDER);
  return db;
}

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: {} } as any);
const admin = { id: ADMIN, role: 'admin', email: 'ada@example.test' } as any;

const app = new Hono<any>();
app.route('/api/decks', deckProof);
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
async function get(db: DatabaseSync, path: string, as: number | null) {
  const headers: Record<string, string> = {};
  if (as) headers.Authorization = `Bearer ${await bearer(as)}`;
  const res = await app.request(path, { method: 'GET', headers }, envOf(db));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function link(db: DatabaseSync, body: Record<string, unknown> = {}) {
  const out = await createDeckLink(envOf(db), {
    projectId: P, user: admin,
    body: { deck_id: DECK, prospect_id: PROSPECT, expires_days: 14, nda_required: true, include: { evidence: true }, ...body },
  });
  return { id: out.id, token: out.share_path.replace('/share/deck/', '') };
}
function acceptNda(db: DatabaseSync, linkId: number, userId: number) {
  db.prepare("INSERT INTO deck_share_conversions (share_token_id, deck_id, project_id, user_id, type) VALUES (?, ?, ?, ?, 'nda_signed')").run(linkId, DECK, P, userId);
}
const proof = (db: DatabaseSync, token: string, ref: string, as: number | null = INVESTOR) =>
  get(db, `/api/decks/share/${token}/proof/${encodeURIComponent(ref)}`, as);
const logOf = (db: DatabaseSync) => (db.prepare('SELECT f.uid, l.action, l.user_id FROM data_room_access_log l LEFT JOIN data_room_files f ON f.id = l.file_id ORDER BY l.id').all() as any[]).map((r) => ({ ...r }));

// ---------------------------------------------------------------------------

test('D1586: evidence is off by default, a boolean, and a link sends only the citations it can prove', () => {
  // Mutation checked: the default on → the first assertion fails; proofRefOf without the `dataroom.` slot check → the forged ref goes out;
  // series and cell bindings not cut → a citation leaves with evidence off.
  assert.equal(DEFAULT_SHARE_INCLUDE.evidence, false);
  assert.equal(parseShareInclude(null).evidence, false);
  assert.equal(shareIncludeFromBody({ evidence: 'yes' }), null, 'a switch is a boolean');
  assert.equal(shareIncludeFromBody({ evidence: true })!.evidence, true);

  const off = JSON.stringify(shareSlides(SLIDES, DEFAULT_SHARE_INCLUDE));
  assert.ok(!off.includes('proof_ref') && !off.includes('dataroom:'), 'evidence off: no citation leaves the Worker');

  const on = { ...DEFAULT_SHARE_INCLUDE, evidence: true };
  const sent = shareSlides(SLIDES, on);
  assert.equal(sent[0].fields[0].binding.proof_ref, REF.open);
  assert.deepEqual(Object.keys(sent[0].fields[0].binding).sort(), ['as_of', 'grade', 'proof_ref'], 'a binding still says only its grade and date, and the proof key');
  assert.ok(!JSON.stringify(sent).includes(REF.mercury), 'a bank record is never a proof ref');
  assert.ok(!JSON.stringify(sent).includes(REF.forged), 'nor a data-room-shaped ref on another slot');
  assert.deepEqual([...sharedProofRefs(SLIDES, on)].sort(), [REF.nda, REF.old, REF.open, REF.tier].sort());
  assert.deepEqual([...sharedProofRefs(SLIDES, { ...on, figures: false })], [REF.open], 'with figures off, the metric and chart blocks are not sent, so they prove nothing');
  assert.equal(sharedProofRefs(SLIDES, DEFAULT_SHARE_INCLUDE).size, 0);
});

test('D1586: the share read carries proof refs only on a link that requires the NDA', async () => {
  // Mutation checked: decks.ts not gating evidence on the NDA → the open link's slides carry proof_ref.
  const db = fixture();
  try {
    const nda = await link(db);
    acceptNda(db, nda.id, INVESTOR);
    const read = await get(db, `/api/decks/share/${nda.token}`, INVESTOR);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.included.evidence, true);
    assert.equal(read.body.slides[0].fields[0].binding.proof_ref, REF.open);

    const open = await link(db, { nda_required: false });
    const r2 = await get(db, `/api/decks/share/${open.token}`, null);
    assert.equal(r2.status, 200);
    assert.equal(r2.body.included.evidence, false);
    assert.ok(!JSON.stringify(r2.body.slides).includes('proof_ref'));
    // And its proof route answers as a link with no evidence.
    assert.equal((await proof(db, open.token, REF.open)).body?.error, 'no_evidence');
  } finally { db.close(); }
});

test('D1586: the proof opens the cited file and page for the investor, and the room logs it', async () => {
  const db = fixture();
  try {
    const l = await link(db);
    acceptNda(db, l.id, INVESTOR);
    const ok = await proof(db, l.token, REF.open);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.url, /^\/api\/files\/dl\/[\w-]+\.[\w-]+$/);
    assert.equal(ok.body.name, 'Plan.xlsx');
    assert.equal(ok.body.page, 3);
    assert.deepEqual(logOf(db), [{ uid: 'f-open', action: 'download', user_id: INVESTOR }]);
    // A proof uses no view.
    assert.equal(Number((db.prepare('SELECT view_count FROM pitch_deck_share_tokens WHERE id = ?').get(l.id) as any).view_count), 0);
  } finally { db.close(); }
});

test('D1586: the checks run in order — evidence, NDA, email → account → grant', async () => {
  // Mutation checked: the NDA gate skipped → a bad ref before the NDA answers not_found; the admin refusal dropped → support_read_required fails;
  // the email match dropped → the stranger gets the file; email_verified dropped → the unverified account does;
  // activeGrant skipped → the ungranted investor does.
  const db = fixture();
  try {
    const none = await link(db, { include: {} });
    acceptNda(db, none.id, INVESTOR);
    assert.deepEqual([(await proof(db, none.token, REF.open)).status, (await proof(db, none.token, REF.open)).body.error], [404, 'no_evidence'], 'evidence off by default');

    const l = await link(db);
    // NDA first: signed out, or signed in without accepting, nothing else is read, not even the ref.
    const out = await proof(db, l.token, REF.open, null);
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'nda_required');
    assert.equal(out.body.signed_in, false);
    assert.equal((await proof(db, l.token, 'not-a-ref')).body.error, 'nda_required');

    // Email → account: the stranger accepted the NDA and holds a grant, but the link was sent to Ivo.
    acceptNda(db, l.id, STRANGER);
    const stranger = await proof(db, l.token, REF.open, STRANGER);
    assert.equal(stranger.status, 403);
    assert.equal(stranger.body.error, 'not_the_investor');

    acceptNda(db, l.id, INVESTOR);
    db.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').run(INVESTOR);
    assert.equal((await proof(db, l.token, REF.open)).body.error, 'not_the_investor', 'an unverified email is not the investor');
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(INVESTOR);

    // → grant: revoked, then expired, then live.
    db.prepare("UPDATE data_room_grants SET status = 'revoked' WHERE uid = 'g-ivo'").run();
    const revoked = await proof(db, l.token, REF.open);
    assert.equal(revoked.status, 403);
    assert.equal(revoked.body.error, 'no_grant');
    db.prepare("UPDATE data_room_grants SET status = 'active', expires_at = '2020-01-01 00:00:00' WHERE uid = 'g-ivo'").run();
    assert.equal((await proof(db, l.token, REF.open)).body.error, 'no_grant');
    db.prepare("UPDATE data_room_grants SET expires_at = NULL WHERE uid = 'g-ivo'").run();
    assert.equal((await proof(db, l.token, REF.open)).status, 200);

    // An admin is refused, as on the room's own download.
    acceptNda(db, l.id, ADMIN);
    const asAdmin = await proof(db, l.token, REF.open, ADMIN);
    assert.equal(asAdmin.status, 403);
    assert.equal(asAdmin.body.error, 'support_read_required');

    // A link with no prospect (a typed name) names no account, so it proves nothing.
    const typed = await link(db, { prospect_id: undefined, investor_label: 'Pat Partner' });
    acceptNda(db, typed.id, INVESTOR);
    assert.equal((await proof(db, typed.token, REF.open)).body.error, 'not_the_investor');

    // A withdrawn link is closed.
    db.prepare("UPDATE pitch_deck_share_tokens SET revoked_at = datetime('now'), expires_at = datetime('now', '-1 minute') WHERE id = ?").run(l.id);
    assert.equal((await proof(db, l.token, REF.open)).status, 410);
  } finally { db.close(); }
});

test('D1586: private evidence (bank data, quotes) is never resolvable', async () => {
  // Mutation checked: the sharedProofRefs check dropped → f-bank, f-quote and f-iq resolve (each is a live deck source in the room);
  // sharedProofRefs ignoring fieldKept or blockKept → the bank field, the quote and the interview quote resolve.
  const db = fixture();
  try {
    const l = await link(db, { include: { evidence: true, figures: true, sources: true, notes: true, bands: true, cap_table: true, team_photos: true } });
    acceptNda(db, l.id, INVESTOR);
    assert.equal((await proof(db, l.token, REF.open)).status, 200, 'the same investor, link and room do open a figure the link sends');
    for (const ref of [REF.bank, REF.quote, REF.iq, REF.mercury, 'interview_sessions:s-none:quote', 'dataroom:f-open:v2:p3/../f-bank']) {
      const r = await proof(db, l.token, ref);
      assert.equal(r.status, 404, ref);
      assert.equal(r.body.error, 'not_found', ref);
    }
    assert.deepEqual(logOf(db).map((x) => x.uid), ['f-open'], 'no private file was opened or logged');
  } finally { db.close(); }
});

test('D1586: the cited revision, then the file tier, as the data room checks them', async () => {
  // Mutation checked: the revision compare dropped → f-old opens; tierAdmits skipped → f-tier opens before commitment;
  // the file NDA skipped → f-nda opens without the founder's NDA.
  const db = fixture();
  try {
    const l = await link(db);
    acceptNda(db, l.id, INVESTOR);
    assert.equal((await proof(db, l.token, REF.old)).status, 404, 'a replaced file proves no figure cut from its old revision');
    assert.equal((await proof(db, l.token, 'dataroom:f-open:v1:p3')).status, 404, 'a ref the deck does not cite');

    assert.equal((await proof(db, l.token, REF.tier)).status, 404, 'a committed-only file, before commitment');
    db.prepare("UPDATE raise_prospects SET stage = 'committed' WHERE id = ?").run(PROSPECT);
    assert.equal((await proof(db, l.token, REF.tier)).status, 200);

    const blocked = await proof(db, l.token, REF.nda);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, 'file_nda_required');
    db.prepare("INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (?, ?, 'active')").run(FOUNDER, INVESTOR);
    const opened = await proof(db, l.token, REF.nda);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.page, null, 'p0 is unpaged');

    db.prepare("UPDATE data_room_files SET deck_source = 0 WHERE uid = 'f-open'").run();
    assert.equal((await proof(db, l.token, REF.open)).status, 404, 'a withdrawn source proves nothing');
    assert.deepEqual(logOf(db).map((x) => `${x.uid}:${x.action}`), ['f-tier:download', 'f-nda:blocked', 'f-nda:download']);
  } finally { db.close(); }
});
