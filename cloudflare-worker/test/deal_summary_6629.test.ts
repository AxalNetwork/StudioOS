/**
 * #6629 (D6629) — `GET /api/deals/:id/summary` and `/summary/pdf`: the NDA-gated deal summary an investor downloads.
 * Gated at download time (investor on the deal for the chosen firm, a paid plan, an active NDA), stamped for the
 * reader and firm, holding only what the deal page shows them, and recorded as a download. Synthetic fixtures only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deal_summary_6629.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import dealSummary, { DOWNLOAD_ACTION, SUMMARY_REFUSALS } from '../src/routes/deal_summary.ts';
import { SUMMARY_REASONS, evidenceFigure, keyStrip } from '../src/services/dealSummary.ts';
import { scorecardRowSignature } from '../src/services/ventureScoring/store.ts';
import { loadSchema } from './_schema_once.mjs';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in the #6629 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const SECRET = 'd6629-deal-summary-fixture-only-'.repeat(2); // A fixture signing key; never a service credential.
const FOUNDER = 1, INVESTOR = 4, OTHER = 5, FREE = 6, STRANGER = 7;
const FIRM = 70, OTHER_FIRM = 77;

async function fixture({ nda = true, shared = true, secondFirm = false, dropScores = false, dropLog = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active,investor_tier,investor_subscription_status) VALUES
      (${FOUNDER},'f@example.test','Synthetic Founder','founder',20,1,'free','free'),
      (${INVESTOR},'i@example.test','Ivy Investor','investor',NULL,1,'plus','active'),
      (${OTHER},'o@example.test','Oli Other','investor',NULL,1,'plus','active'),
      (${FREE},'free@example.test','Fay Free','investor',NULL,1,'free','free'),
      (${STRANGER},'s@example.test','Sam Stranger','investor',NULL,1,'plus','active');
    INSERT INTO company_profiles(id,uid,company_name) VALUES (${FIRM},'cp70','Northwind Capital'),(${OTHER_FIRM},'cp77','Elsewhere Partners');
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l1',${FIRM},${INVESTOR});
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage,sector) VALUES (10,'Example venture',20,'spinout','seed','build','fintech');
    INSERT INTO deals(id,project_id,status,target_raise,minimum_check,instrument,valuation_cap,closing_deadline,currency)
      VALUES (100,10,'active',2000000,25000,'SAFE',12000000,'2026-12-31','USD');
    INSERT INTO deal_invitations(deal_id,investor_user_id,company_id) VALUES (100,${INVESTOR},${FIRM}),(100,${OTHER},NULL),(100,${FREE},NULL);
    INSERT INTO commitments(deal_id,investor_user_id,amount,status) VALUES (100,${OTHER},777777,'confirmed');
    INSERT INTO deal_notes(uid,deal_id,author_user_id,company_id,tag,body,created_at) VALUES ('n9',100,${OTHER},${OTHER_FIRM},'Risk','ANOTHER-FIRM-NOTE','2026-11-03T10:00:00.000Z');
    INSERT INTO venture_score_sharing(project_id,audience,user_id,enabled,updated_by,updated_at) VALUES (10,'investors',0,${shared ? 1 : 0},${FOUNDER},'2026-10-26');`);
  if (secondFirm) db.exec(`INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l2',${OTHER_FIRM},${INVESTOR})`);
  if (nda) db.exec(`INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES (${FOUNDER},${INVESTOR},'active'),(${FOUNDER},${FREE},'active')`);
  const item = db.prepare(`INSERT INTO raise_evidence_items(uid,project_id,area,kind,source_table,source_ref,source_label,strength,observed_on,summary,value_num,value_unit,currency,snapshot_hash,state,visibility,mutation_uid,accepted_by)
    VALUES (?,10,?,'stated-by-founder','raise_evidence_typed',?,'typed','anecdote','2026-10-01',?,?,?,NULL,'h','pinned',?,?,${FOUNDER})`);
  item.run('e1', 'Data room', 't1', 'We have forty paying pilots.', 40, null, 'after_nda', 'm1');
  item.run('e2', 'Legal', 't2', 'PRIVATE-ITEM held back.', 9, null, 'private', 'm2');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, SCORING_HMAC_SECRET: SECRET, ENVIRONMENT: 'development' };
  const row = { project_id: 10, scope: 'team', uid: 's1', value: 70, band: 'Fair', confidence: 0.7, coverage: 0.9, inputs_json: JSON.stringify({ result: { inputs: [] } }),
    inputs_hash: 'h1', model_version: '1.0', trigger: 'rescore', computed_by: null, computed_at: '2026-11-01T10:00:00.000Z', state: 'scored' };
  db.prepare(`INSERT INTO venture_scorecards (uid, project_id, scope, value, band, confidence, coverage, inputs_json, inputs_hash, signature, model_version, trigger, computed_by, computed_at, state)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('s1', 10, 'team', 70, 'Fair', 0.7, 0.9, row.inputs_json, 'h1', await scorecardRowSignature(env, row), '1.0', 'rescore', null, row.computed_at, 'scored');
  if (dropScores) db.exec('DROP TABLE venture_scorecards');
  if (dropLog) db.exec('DROP TABLE data_room_access_log');
  const app = new Hono().route('/api/deals', dealSummary);
  // As index.ts maps the auth helpers' plain errors: signed out is 401.
  app.onError((e: any, c) => c.json({ detail: e?.message }, e?.message === 'Unauthorized' ? 401 : 500));
  const call = async (who: number | null, path = '/100/summary/pdf', headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { ...headers };
    if (who != null) h.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === FOUNDER ? 'founder' : 'investor' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    const res = await app.request(`/api/deals${path}`, { headers: h }, env).catch((e) => { if (e instanceof Response) return e; throw e; });
    const bytes = Buffer.from(await res.arrayBuffer());
    let json: any = null; try { json = JSON.parse(bytes.toString('utf8')); } catch { /* a PDF */ }
    return { status: res.status, type: res.headers.get('Content-Type'), disposition: res.headers.get('Content-Disposition'), bytes, json };
  };
  const downloads = () => db.prepare('SELECT project_id, file_id, user_id, action FROM data_room_access_log WHERE action = ?').all(DOWNLOAD_ACTION).map((r: any) => ({ ...r }));
  return { db, call, downloads };
}

/** The words drawn on the PDF's pages: every hex string shown, from each (inflated) content stream. */
function pdfText(bytes: Buffer): string {
  const s = bytes.toString('latin1');
  const out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = m[1];
    try { body = zlib.inflateSync(Buffer.from(body, 'latin1')).toString('latin1'); } catch { /* not compressed */ }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], 'hex').toString('latin1'));
  }
  return out.join('\n');
}

// Mutation checked: the stamp's firm dropped (fails); the stage block left out (fails); a private evidence item printed
// (fails); another investor's name printed (fails); another firm's note read (fails); the download not recorded (fails).
test('an investor on the deal with an NDA gets the summary, stamped for them and their firm, and the download is recorded', async () => {
  const f = await fixture();
  const r = await f.call(INVESTOR);
  assert.equal(r.status, 200, r.bytes.toString('utf8').slice(0, 200));
  assert.equal(r.type, 'application/pdf');
  assert.match(r.disposition ?? '', /^attachment; filename="axal-deal-summary-100-\d{4}-\d{2}-\d{2}\.pdf"$/);
  assert.equal(r.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const text = pdfText(r.bytes);
  assert.match(text, /Deal summary: Example venture/);
  assert.match(text, /Prepared \d{1,2} [A-Z][a-z]{2} \d{4} for Ivy Investor, Northwind Capital\./);
  for (const want of ['$2,000,000', 'SAFE', '$25,000', '31 Dec 2026', '$12,000,000', 'Invited', 'Fair', 'We have forty paying pilots.']) assert.ok(text.includes(want), `missing ${want}`);
  assert.ok(text.includes('Not recorded'), 'carry and fee are not recorded, and say so');
  for (const never of ['Oli Other', 'o@example.test', 'i@example.test', 'PRIVATE-ITEM', 'ANOTHER-FIRM-NOTE', 'Elsewhere Partners']) assert.ok(!text.includes(never), `leaked ${never}`);
  assert.deepEqual(f.downloads(), [{ project_id: 10, file_id: null, user_id: INVESTOR, action: DOWNLOAD_ACTION }]);
});

// Mutation checked: availability writing an audit row (fails); the stamp read from another firm (fails).
test('the availability read says yes with the stamp, and records nothing', async () => {
  const f = await fixture();
  const r = await f.call(INVESTOR, '/100/summary');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { available: true, format: 'pdf', stamp: 'for Ivy Investor, Northwind Capital' });
  assert.deepEqual(f.downloads(), []);
});

// Mutation checked: the Free-plan gate dropped (fails); the NDA gate dropped (fails); the investor licence gate dropped (fails);
// a deal the investor is not on answering (fails). No refused request records a download.
test('refused: no NDA, a Free plan, not on the deal, not an investor, signed out', async () => {
  const noNda = await fixture({ nda: false });
  const a = await noNda.call(INVESTOR);
  assert.equal(a.status, 403); assert.equal(a.json.error, 'nda_required');
  assert.deepEqual((await noNda.call(INVESTOR, '/100/summary')).json, { available: false, code: 'nda_required', reason: SUMMARY_REFUSALS.nda_required });

  const f = await fixture();
  const free = await f.call(FREE);
  assert.equal(free.status, 402); assert.equal(free.json.error, 'investor_tier_required'); assert.equal(free.json.message, SUMMARY_REFUSALS.investor_tier_required);
  assert.equal((await f.call(FREE, '/100/summary')).json.code, 'investor_tier_required');
  const stranger = await f.call(STRANGER);
  assert.equal(stranger.status, 404); assert.equal(stranger.json.error, 'deal_not_found');
  assert.equal((await f.call(FOUNDER)).status, 403, 'the founder holds no Investor licence');
  assert.equal((await f.call(null)).status, 401);
  assert.equal((await f.call(INVESTOR, '/abc/summary/pdf')).status, 400);
  assert.deepEqual([...noNda.downloads(), ...f.downloads()], []);
});

// Mutation checked: the firm narrowing dropped from the deal's visibility (fails: another firm's invitation would open it).
test('cross-firm: an invitation held for one firm opens nothing when another firm is chosen', async () => {
  const f = await fixture({ secondFirm: true });
  const elsewhere = await f.call(INVESTOR, '/100/summary/pdf', { 'X-Company-Id': String(OTHER_FIRM) });
  assert.equal(elsewhere.status, 404); assert.equal(elsewhere.json.error, 'deal_not_found');
  const here = await f.call(INVESTOR, '/100/summary/pdf', { 'X-Company-Id': String(FIRM) });
  assert.equal(here.status, 200);
  assert.match(pdfText(here.bytes), /for Ivy Investor, Northwind Capital/);
  assert.equal(f.downloads().length, 1);
});

// Mutation checked: access remembered from the availability read instead of read again (fails).
test('changed access: what the menu said is not trusted at download time', async () => {
  const f = await fixture();
  assert.equal((await f.call(INVESTOR, '/100/summary')).json.available, true);
  f.db.exec(`UPDATE pairwise_ndas SET status = 'revoked' WHERE party_b_user_id = ${INVESTOR}`);
  assert.equal((await f.call(INVESTOR)).json.error, 'nda_required');
  f.db.exec(`UPDATE pairwise_ndas SET status = 'active' WHERE party_b_user_id = ${INVESTOR}`);
  f.db.exec(`DELETE FROM deal_invitations WHERE investor_user_id = ${INVESTOR}`);
  assert.equal((await f.call(INVESTOR)).status, 404);
  assert.deepEqual(f.downloads(), []);
});

// Mutation checked: one failed block failing the whole file (fails); a failed block drawn as none (fails);
// a file sent when the download could not be recorded (fails).
test('a block that cannot be read says so and the rest prints; no record, no file', async () => {
  const unread = await (await fixture({ dropScores: true })).call(INVESTOR);
  assert.equal(unread.status, 200);
  const text = pdfText(unread.bytes);
  assert.match(text, /Unreadable\. The scorecard could not be read/);
  assert.ok(text.includes('We have forty paying pilots.'));
  const locked = pdfText((await (await fixture({ shared: false })).call(INVESTOR)).bytes);
  assert.ok(locked.includes(SUMMARY_REASONS.scoresLocked));
  assert.ok(!locked.includes('Fair'));
  const unlogged = await (await fixture({ dropLog: true })).call(INVESTOR);
  assert.equal(unlogged.status, 503);
  assert.equal(unlogged.json.error, 'summary_unrecorded');
  assert.notEqual(unlogged.type, 'application/pdf');
});

// Mutation checked: a missing figure drawn as 0 (fails); a withheld value drawn as a figure (fails).
test('figures: missing is Not recorded with why, never 0; a withheld value says why', () => {
  const strip = keyStrip({ currency: 'USD', target_raise: null, amount: null, capital_committed: 0, minimum_check: 'x', closing_deadline: null });
  assert.deepEqual(strip.map((c) => [c.label, c.value]), [['Round', 'Not recorded'], ['Instrument', 'Not recorded'], ['Committed', '$0'], ['Minimum', 'Unreadable'], ['Closes', 'Not recorded']]);
  assert.equal(strip[0].note, 'No round size is recorded on this deal.');
  assert.equal(evidenceFigure({ value_num: 5, value_reason: 'Shared as a summary only.' }), 'Value withheld: Shared as a summary only.');
  assert.equal(evidenceFigure({ value_num: null }), 'Not recorded');
  assert.equal(evidenceFigure({ value_num: 12, value_unit: 'months' }), '12 months');
});
