/** D6864 (#6864): Raise evidence shared outside Axal as a dated pack link, and evidence added by hand.
 *  Real SQLite with the production schema and migrations; every person, venture and figure is synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import router from '../src/routes/cycle_raise.ts';
import evidenceSharePublic from '../src/routes/evidence_share_public.ts';
import { buildCandidates, acceptItem, setSharing, readRaiseEvidence } from '../src/services/raiseEvidence.ts';
import { addTypedEvidence, createPackLink, listPackLinks, revokePackLink, openPackLink, linkState, tokenHash } from '../src/services/raiseEvidenceShare.ts';

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r: any) => r.sql); db.close(); return ddl;
})();
const secret = 't'.repeat(64); // in-memory test signing seed only

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active,kyc_status) VALUES
   (1,'Synthetic Founder','one@example.invalid','founder',100,1,0,NULL),(3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0,NULL),
   (5,'Synthetic Investor','five@example.invalid','investor',NULL,1,0,'approved');
   INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES(1,'venture-one','Synthetic Venture',100,10);
   INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One');
   INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('three',3,10);`);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' };
  const ctx: any = { env, user: db.prepare('SELECT * FROM users WHERE id=1').get(), projectId: 1, companyId: 10, founder: true };
  const app = new Hono<any>(); app.route('/api/cycles/raise', router); app.route('/api/share/evidence', evidenceSharePublic);
  return { db, env, ctx, app };
}
type World = ReturnType<typeof world>;
function seed(w: World, table: string, values: Record<string, unknown>) {
  if (!/^[a-z_0-9]+$/.test(table)) throw new Error('bad fixture table');
  const row = { ...values }; for (const c of w.db.prepare('PRAGMA table_info(' + table + ')').all() as any[]) if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : c.name === 'uid' ? table + '-' + String(values.id ?? 'one') : 'synthetic';
  const keys = Object.keys(row); for (const k of keys) if (!/^[a-z_0-9]+$/.test(k)) throw new Error('bad fixture column');
  w.db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')').run(...keys.map(k => row[k] as any));
}
function sources(w: World) {
  seed(w, 'integrations', { id: 1, user_id: 1, provider_key: 'mercury', status: 'active' });
  seed(w, 'mercury_raise_facts', { id: 1, integration_id: 1, project_id: 1, kind: 'runway', fact_key: 'runway', value: 8, months: 3, amount_cents: 123400, label: 'product', as_of: '2026-09-02' });
  seed(w, 'discovery_interviews', { id: 1, project_id: 1, interviewee_name: 'PRIVATE INTERVIEWEE', interview_date: '2026-09-07', pains_json: '[]', quote_consent: 1, notes: 'PRIVATE QUOTE', icp_fit: 'strong' });
  seed(w, 'project_metrics', { id: 1, project_id: 1, snapshot_date: '2026-09-10', source: 'manual', mrr: 4200, cash_balance: 987654321 });
  seed(w, 'raise_prospects', { id: 1, uid: 'prospect-one', project_id: 1, name: 'PRIVATE INVESTOR', email: 'private@example.invalid', stage: 'committed', commit_status: 'soft', amount_cents: 50000, currency: 'USD', updated_at: '2026-10-26' });
}
const proposalOf = (w: World, kind: string, area?: string) => w.db.prepare(`SELECT uid,payload_json FROM ai_rail_proposals WHERE status='proposed' AND json_extract(payload_json,'$.kind')=? AND (? IS NULL OR json_extract(payload_json,'$.area')=?) LIMIT 1`).get(kind, area ?? null, area ?? null) as any;
async function share(w: World, kind: string, visibility: 'private' | 'summary' | 'after_nda', area?: string) {
  const q = proposalOf(w, kind, area); assert.ok(q, 'candidate ' + kind);
  let item: any = await acceptItem(w.ctx, q.uid, JSON.parse(q.payload_json).snapshot_hash);
  if (item.visibility !== visibility) item = await setSharing(w.ctx, item.uid, { version: item.version, visibility });
  return item;
}
async function pack(w: World) {
  sources(w); await buildCandidates(w.ctx);
  const kpi = await share(w, 'kpi-snapshot', 'after_nda', 'Investor narrative and Pitch deck');
  const icp = await share(w, 'icp-fit', 'summary');
  const runway = await share(w, 'bank-runway', 'after_nda');
  const commitment = await share(w, 'typed-commitment', 'after_nda');
  const kept = await share(w, 'kpi-snapshot', 'private', 'Capital model');
  return { kpi, icp, runway, commitment, kept };
}
/** What may never leave Axal in a pack: private fields, a balance, a bank amount, an investor's name, money or email. */
const NEVER = /PRIVATE|987654321|123400|50000|private@example|snapshot_hash|private_reason|source_ref|accepted_by|Synthetic Investor/;
const tokenOf = (path: string) => path.split('/').pop() as string;
/** A fixed day already past, so the NDA day is never in the future; no real clock is read. */
const NDA_DAY = '2026-11-01';
async function call(w: World, who: number, method: string, tail: string, body?: unknown) {
  const auth = { Authorization: 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret)) };
  const r = await w.app.request('/api/cycles/raise' + tail, { method, headers: { 'Content-Type': 'application/json', 'X-Company-Id': '10', ...auth }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, w.env);
  return { status: r.status, body: await r.json() as any };
}
async function open(w: World, token: string) {
  const r = await w.app.request('/api/share/evidence/' + token, { method: 'GET' }, w.env);
  return { status: r.status, cache: r.headers.get('Cache-Control'), body: await r.json() as any };
}

test('Add evidence by hand (RA-32): typed, Anecdote, Private; refused when malformed or not a founder', async () => {
  const w = world(); try {
    const r: any = await addTypedEvidence(w.ctx, { area: 'Capital relationships', summary: 'Two angels said they would follow a lead.', value_num: 2, value_unit: 'angels', observed_on: '2026-10-01' });
    assert.equal(r.source, 'Typed: stated by you'); assert.equal(r.strength, 'Anecdote'); assert.equal(r.sharing, 'Private');
    const row: any = w.db.prepare('SELECT * FROM raise_evidence_items WHERE uid=?').get(r.item.uid);
    // Mutation checked: insert 'summary' or 'measured' → these fail.
    assert.equal(row.source_label, 'typed'); assert.equal(row.strength, 'anecdote'); assert.equal(row.visibility, 'private'); assert.equal(row.state, 'pinned');
    for (const bad of [{ area: 'Product-market fit', summary: 'x' }, { area: 'Legal', summary: '' }, { area: 'Legal', summary: 'x'.repeat(201) },
      { area: 'Legal', summary: 'x', value_unit: 'angels' }, { area: 'Legal', summary: 'x', observed_on: '2999-01-01' }, { area: 'Legal', summary: 'x', visibility: 'after_nda' },
      { area: 'Legal', summary: 'x', value_num: 1, currency: 'usd' }]) {
      await assert.rejects(addTypedEvidence(w.ctx, bad as any), (e: any) => e.code === 'invalid' && e.status === 400, JSON.stringify(bad));
    }
    await assert.rejects(addTypedEvidence({ ...w.ctx, founder: false }, { area: 'Legal', summary: 'x' }), (e: any) => e.status === 403);
    // The founder's list reads it as recorded, never "not recorded" for want of a connector.
    const list: any = await readRaiseEvidence(w.ctx);
    const listed = list.items.rows.find((i: any) => i.uid === r.item.uid);
    assert.equal(listed.source_state, 'recorded');
    // Sharing it is still the founder's own decision afterwards, and it then counts in a pack.
    const shared: any = await setSharing(w.ctx, r.item.uid, { version: 1, visibility: 'summary' });
    assert.equal(shared.visibility, 'summary');
    const link = await createPackLink(w.ctx, { label: 'First look', reader: 'before_nda' });
    assert.equal(link.item_count, 1);
  } finally { w.db.close(); }
});

test('a pack before an NDA is coverage only, is frozen, and stores only the token digest', async () => {
  const w = world(); try {
    const p = await pack(w);
    const link: any = await createPackLink(w.ctx, { label: '[Seed fund] first look', reader: 'before_nda' });
    assert.equal(link.sent, false, 'making a link sends nothing');
    assert.match(link.path, /^\/share\/evidence\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(link.path);
    const stored: any = w.db.prepare('SELECT * FROM raise_evidence_share_links WHERE uid=?').get(link.uid);
    // Mutation checked: store the raw token → this fails.
    assert.equal(stored.token_hash, await tokenHash(token)); assert.doesNotMatch(JSON.stringify(stored), new RegExp(token));
    const r = await open(w, token);
    assert.equal(r.status, 200); assert.equal(r.cache, 'no-store');
    assert.equal(r.body.pack.nda_signed, false); assert.equal(r.body.pack.items, null); assert.equal(r.body.pack.claims, null);
    assert.equal(r.body.pack.venture, 'Synthetic One');
    assert.doesNotMatch(JSON.stringify(r.body), /value_num/);
    assert.doesNotMatch(JSON.stringify(r.body).replace(/[0-9a-f]{16,}/gi, ''), NEVER);
    const kinds = r.body.pack.coverage.groups.map((g: any) => g.kind).sort();
    assert.ok(!kinds.includes(p.kept.kind) || r.body.pack.coverage.groups.filter((g: any) => g.kind === 'kpi-snapshot').every((g: any) => g.count === 1), 'the private item never counts');
    // The reader's copy does not change when the founder changes sharing afterwards; the list says so.
    await setSharing(w.ctx, p.icp.uid, { version: p.icp.version, visibility: 'private' });
    const again = await open(w, token);
    assert.deepEqual(again.body.pack.coverage, r.body.pack.coverage);
    const list: any = await listPackLinks(w.ctx);
    assert.equal(list.links[0].changed_since_sent, true);
    assert.equal(list.links[0].view_count, 2);
  } finally { w.db.close(); }
});

test('after an NDA needs the founder’s confirmation and date; it carries figures only for After NDA items', async () => {
  const w = world(); try {
    const p = await pack(w);
    for (const bad of [{ reader: 'after_nda' }, { reader: 'after_nda', nda_confirmed: true }, { reader: 'after_nda', nda_confirmed: false, nda_signed_on: '2026-11-01' },
      { reader: 'after_nda', nda_confirmed: true, nda_signed_on: '2999-01-01' }, { reader: 'after_nda', nda_confirmed: true, nda_signed_on: '2026-02-30' }]) {
      await assert.rejects(createPackLink(w.ctx, { label: 'x', ...bad }), (e: any) => e.code === 'nda_unconfirmed', JSON.stringify(bad));
    }
    const link: any = await createPackLink(w.ctx, { label: 'Diligence', reader: 'after_nda', nda_confirmed: true, nda_signed_on: NDA_DAY });
    const row: any = w.db.prepare('SELECT nda_signed_on, nda_confirmed_by FROM raise_evidence_share_links WHERE uid=?').get(link.uid);
    assert.equal(row.nda_signed_on, NDA_DAY); assert.equal(row.nda_confirmed_by, 1);
    const r = await open(w, tokenOf(link.path));
    const by = new Map(r.body.pack.items.rows.map((i: any) => [i.uid, i]));
    assert.equal(by.has(p.kept.uid), false, 'a Private item never leaves');
    assert.equal((by.get(p.kpi.uid) as any).value_num, 4200);
    assert.equal((by.get(p.icp.uid) as any).value_reason, 'Shared as a summary only.');
    assert.match((by.get(p.commitment.uid) as any).value_reason, /One investor/);
    assert.equal(r.body.pack.nda_signed_on, NDA_DAY);
    assert.doesNotMatch(JSON.stringify(r.body).replace(/[0-9a-f]{16,}/gi, ''), NEVER);
  } finally { w.db.close(); }
});

test('a Mismatch carries the founder’s note under it, only while the note was written against the stated figure', async () => {
  const w = world(); try {
    const p = await pack(w);
    const item: any = w.db.prepare('SELECT id FROM raise_evidence_items WHERE uid=?').get(p.kpi.uid);
    seed(w, 'raise_claims', { id: 1, uid: 'claimmrr', project_id: 1, surface: 'deck', surface_version: 'v1', field_key: 'mrr', claim_kind: 'mrr', stated_value: '5000', state: 'mismatch', note: 'MRR in the deck includes October.', note_value: '5000' });
    seed(w, 'raise_claims', { id: 2, uid: 'claimarr', project_id: 1, surface: 'deck', surface_version: 'v1', field_key: 'arr', claim_kind: 'arr', stated_value: '9', state: 'mismatch', note: 'Stale note.', note_value: '8' });
    for (const claim of [1, 2]) seed(w, 'raise_claim_evidence', { project_id: 1, claim_id: claim, item_id: item.id, how: 'founder', mutation_uid: 'm' + claim });
    const link: any = await createPackLink(w.ctx, { label: 'Diligence', reader: 'after_nda', nda_confirmed: true, nda_signed_on: NDA_DAY });
    const r = await open(w, tokenOf(link.path));
    const claims = new Map(r.body.pack.claims.rows.map((c: any) => [c.uid, c]));
    // Mutation checked: drop the founder_note mapping → the first fails; drop `note_value IS stated_value` → the second fails.
    assert.equal((claims.get('claimmrr') as any).founder_note, 'MRR in the deck includes October.');
    assert.equal((claims.get('claimarr') as any).founder_note, null, 'a note written against another figure does not apply');
    assert.equal((claims.get('claimmrr') as any).state, 'mismatch', 'a Mismatch is never hidden');
  } finally { w.db.close(); }
});

test('views, expiry and Revoke refuse the link with a page that names no venture; the row stays on Shared links', async () => {
  const w = world(); try {
    await pack(w);
    const once: any = await createPackLink(w.ctx, { label: 'One look', reader: 'before_nda', view_limit: 1 });
    assert.equal((await open(w, tokenOf(once.path))).status, 200);
    // Mutation checked: drop `view_count < view_limit` from the UPDATE → a second open succeeds and this fails.
    const spent = await open(w, tokenOf(once.path));
    assert.equal(spent.status, 410); assert.equal(spent.body.state, 'used_up');
    const stopped: any = await createPackLink(w.ctx, { label: 'Stop me', reader: 'before_nda' });
    await revokePackLink(w.ctx, stopped.uid);
    await assert.rejects(revokePackLink(w.ctx, stopped.uid), (e: any) => e.code === 'already_stopped' && e.status === 409);
    const revoked = await open(w, tokenOf(stopped.path));
    assert.equal(revoked.status, 410); assert.equal(revoked.body.title, 'This link was stopped by the founder');
    const old: any = await createPackLink(w.ctx, { label: 'Old', reader: 'before_nda' });
    w.db.prepare("UPDATE raise_evidence_share_links SET expires_at='2020-01-01T00:00:00.000Z' WHERE uid=?").run(old.uid);
    const expired = await open(w, tokenOf(old.path));
    assert.equal(expired.status, 410); assert.equal(expired.body.state, 'expired');
    for (const t of ['A'.repeat(43), 'short', 'A'.repeat(44)]) { const r = await open(w, t); assert.equal(r.status, 404, t); assert.equal(r.body.state, 'not_found', t); }
    for (const refused of [spent, revoked, expired]) assert.doesNotMatch(JSON.stringify(refused.body), /Synthetic|coverage|pack/, 'a refusal carries no venture data');
    // A refused open consumes nothing.
    assert.equal((w.db.prepare('SELECT view_count FROM raise_evidence_share_links WHERE uid=?').get(stopped.uid) as any).view_count, 0);
    const list: any = await listPackLinks(w.ctx);
    assert.deepEqual(list.links.map((l: any) => l.state).sort(), ['expired', 'revoked', 'used_up']);
    assert.ok(list.links.every((l: any) => l.changed_since_sent === null), 'only a live link is compared');
  } finally { w.db.close(); }
});

test('a pack can be narrowed to the items ticked; an empty pack and a bad selection are refused', async () => {
  const w = world(); try {
    await assert.rejects(createPackLink(w.ctx, { label: 'Nothing', reader: 'before_nda' }), (e: any) => e.code === 'empty' && e.status === 409);
    const p = await pack(w);
    const link: any = await createPackLink(w.ctx, { label: 'Just MRR', reader: 'after_nda', nda_confirmed: true, nda_signed_on: NDA_DAY, items: [p.kpi.uid] });
    assert.equal(link.item_count, 1);
    const r = await open(w, tokenOf(link.path));
    assert.deepEqual(r.body.pack.items.rows.map((i: any) => i.uid), [p.kpi.uid]);
    for (const items of [[], ['not a uid!'], 'x']) await assert.rejects(createPackLink(w.ctx, { label: 'x', items } as any), (e: any) => e.code === 'invalid');
    await assert.rejects(createPackLink(w.ctx, { label: 'x', reader: 'before_nda', send_to: 'someone@example.invalid' } as any), (e: any) => e.code === 'invalid', 'nothing is sent');
    await assert.rejects(createPackLink(w.ctx, { label: 'x', view_limit: 0 }), (e: any) => e.code === 'invalid');
    await assert.rejects(createPackLink(w.ctx, { label: 'x', expires_in_days: 91 }), (e: any) => e.code === 'invalid');
    await assert.rejects(createPackLink({ ...w.ctx, founder: false }, { label: 'x' }), (e: any) => e.status === 403);
  } finally { w.db.close(); }
});

test('the routes: founders only, through the evidence gate; admins get no Share action', async () => {
  const w = world(); try {
    await pack(w);
    const made = await call(w, 1, 'POST', '/evidence/share-links?project=1', { label: 'Via route', reader: 'before_nda' });
    assert.equal(made.status, 201); assert.match(made.body.path, /^\/share\/evidence\//);
    const listed = await call(w, 1, 'GET', '/evidence/share-links?project=1');
    assert.equal(listed.status, 200); assert.equal(listed.body.links.length, 1);
    // Mutation checked: evidenceScope(c, false) on the list with listPackLinks' founderOnly dropped → the admin reads the links and this fails.
    for (const [method, tail, body] of [['GET', '/evidence/share-links?project=1'], ['POST', '/evidence/share-links?project=1', { label: 'x' }],
      ['POST', '/evidence/items?project=1', { area: 'Legal', summary: 'x' }], ['POST', `/evidence/share-links/${made.body.uid}/revoke?project=1`, {}]] as const) {
      const r = await call(w, 3, method, tail, body);
      assert.equal(r.status, 403, method + ' ' + tail);
    }
    const added = await call(w, 1, 'POST', '/evidence/items?project=1', { area: 'Legal', summary: 'Counsel reviewed the SAFE.' });
    assert.equal(added.status, 201); assert.equal(added.body.sharing, 'Private');
    const bad = await call(w, 1, 'POST', '/evidence/share-links?project=1', { label: 'x', reader: 'after_nda' });
    assert.equal(bad.status, 400); assert.match(bad.body.message, /Confirm that an NDA is signed outside Axal/);
    const stop = await call(w, 1, 'POST', `/evidence/share-links/${made.body.uid}/revoke?project=1`, {});
    assert.equal(stop.status, 200); assert.equal(stop.body.state, 'revoked');
  } finally { w.db.close(); }
});

test('link state words: revoked over expired over used up over live', () => {
  const live = { revoked_at: null, expires_at: '2999-01-01T00:00:00Z', view_count: 0, view_limit: 1 };
  assert.equal(linkState(live), 'live');
  assert.equal(linkState({ ...live, view_count: 1 }), 'used_up');
  assert.equal(linkState({ ...live, view_count: 1, expires_at: '2000-01-01T00:00:00Z' }), 'expired');
  assert.equal(linkState({ ...live, view_count: 1, expires_at: '2000-01-01T00:00:00Z', revoked_at: '2026-01-01' }), 'revoked');
});

test('openPackLink refuses a malformed token before touching the store', async () => {
  const w = world(); try {
    assert.deepEqual(await openPackLink(w.env, '../../etc'), { ok: false, refusal: 'not_found' });
  } finally { w.db.close(); }
});
