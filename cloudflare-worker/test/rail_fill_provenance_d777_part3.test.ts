// D777 part 3 (#2102): placements are proposals in `ai_rail_proposals`, kept
// one by one, never for a field Eadwyn never fills, and a kept placement's
// provenance names the proposal and the run that produced it.
//
//   · Keeping re-checks the never-fill registry. A stored proposal whose field
//     is listed is discarded on the press (it can never become acceptable); an
//     edit that names a listed field is refused and the proposal stays open.
//     The route answers both 422 `{ refusal: 'never_fill' }` with the
//     registry's sentence, and nothing is kept.
//   · One at a time: the only decision route takes one uid. There is no bulk
//     decide, in the route or in the store. Deciding writes no fill: the
//     record's own Save is the only write.
//   · `recordRailFill` records the value the record's Save wrote from a kept
//     placement: the member's own row, a `proposal`, accepted or edited. The
//     provenance row carries `ai_proposal_id` (migration 518) and the run's
//     `ai_usage_log_id`, and `fillsForRow` answers both.
//   · A database made before migration 518 gains the column at runtime.
//
// Real SQLite: the AI fixture, migration 506's table, and `fill_provenance`
// from migration 246 plus every later migration's ADD COLUMN, 518's included,
// so the migration itself is what the test runs. env.AI is stubbed with the
// guard stub. Each case names the mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/rail_fill_provenance_d777_part3.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { run as aiRun, __resetForTest } from '../src/services/aiRouter.ts';
import { neverFillMessage } from '../src/services/fills/neverFill.ts';
import { fillsForRow } from '../src/services/fills/provenance.ts';
import { NeverFillRefusal, decideRail, getRail, proposeRail, recordRailFill } from '../src/services/railProposals.ts';
import railProposals from '../src/routes/ai_rail_proposals.ts';

const SQL = new URL('../sql/', import.meta.url);
const BASELINE = readFileSync(new URL('schema_baseline.sql', SQL), 'utf8');
const MIGRATIONS = readdirSync(new URL('migrations/', SQL)).filter((f) => f.endsWith('.sql')).sort();
const migration = (name: string) => readFileSync(new URL(`migrations/${name}`, SQL), 'utf8');
const M518 = '518_fill_provenance_rail_proposal.sql';
const MEMBER = 1;
const OTHER = 3;

/** `fill_provenance` as migration 246 creates it. */
function fillProvenanceDDL(): string {
  const src = migration('246_fills_the_blanks_everywhere.sql');
  const at = src.indexOf('CREATE TABLE IF NOT EXISTS fill_provenance');
  return src.slice(at, src.indexOf(');', at) + 2);
}
/** Every later migration's ADD COLUMN for `fill_provenance`, optionally stopping before one file. */
function addColumns(db: any, before?: string) {
  const re = /ALTER TABLE fill_provenance ADD COLUMN ([a-z_0-9]+)([^;]*);/g;
  for (const f of MIGRATIONS) {
    if (before && f >= before) break;
    for (const m of migration(f).matchAll(re)) db.exec(`ALTER TABLE fill_provenance ADD COLUMN ${m[1]}${m[2]};`);
  }
}

function world(opts: { before518?: boolean } = {}) {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec(migration('506_ai_rail_proposals.sql'));
  // The table `fill_provenance.proposal_id` (migration 246) references, as production has it.
  f.db.exec(tableFromBaseline(BASELINE, 'validate_proposals'));
  f.db.exec(fillProvenanceDDL());
  addColumns(f.db, opts.before518 ? M518 : undefined);
  if (!opts.before518) {
    // 518's index, as the file declares it.
    for (const m of migration(M518).matchAll(/CREATE INDEX IF NOT EXISTS[^;]*;/g)) f.db.exec(m[0]);
  }
  f.db.prepare("INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('admin',0,0,1)").run();
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(MEMBER, 5_000_000);
  const ai = { async run() { return { response: 'Pricing pain: "we reconcile by hand every Friday".', usage: { prompt_tokens: 30, completion_tokens: 9 } }; } };
  const env: any = { DB: f.DB, AI: withGuard(ai, () => 'safe'), JWT_SECRET: 'd777-part3-fixture-only-secret', ENVIRONMENT: 'development' };
  return { f, env };
}
const one = (w: any, sql: string, ...a: unknown[]) => ({ ...(w.f.db.prepare(sql).get(...a) as any) });

/** One upload's run, as the rail's press makes it: the member, the page and the option. */
const RAIL = { page: 'Founder · Validate · Experiments and evidence', option: 'upload:document', record: 'project:7' };
const run = (w: any) => aiRun(w.env, {
  task: 'validate_draft_hypotheses' as any, userId: MEMBER, surface: 'validate',
  rail: { page: RAIL.page, option: RAIL.option, recordRef: RAIL.record } as any,
  systemPrompt: 'Place the quotes.', messages: [{ role: 'user', content: 'Interview notes.' }], maxTokens: 50,
});
const placement = (field: string, value: string) => ({ userId: MEMBER, ...RAIL, kind: 'proposal' as const, payload: { field, value } });
/** A proposal stored before its field was listed: written straight to the table, as an older build would have. */
function storedBeforeListing(w: any, field: string): string {
  const uid = `legacy-${field}`;
  w.f.db.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json)
    VALUES (?, ?, ?, ?, ?, 'proposal', ?)`).run(uid, MEMBER, RAIL.page, RAIL.option, RAIL.record, JSON.stringify({ field, value: '1000' }));
  return uid;
}

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/ai/rail/proposals', railProposals);
  return a;
}
async function decide(w: any, who: number, uid: string, body: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(`/api/ai/rail/proposals/${uid}/decide`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, w.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('D777 a stored placement for a listed field is discarded on the press, and nothing is kept', async () => {
  // Mutations checked: the re-check removed (the accept keeps it); the UPDATE to
  // 'discarded' removed (the row stays open); `discarded` passed as false.
  const w = world();
  const uid = storedBeforeListing(w, 'fund_capital_calls.amount');
  await assert.rejects(decideRail(w.env, MEMBER, uid, 'accept'), (e: any) => {
    assert.ok(e instanceof NeverFillRefusal);
    assert.equal(e.field, 'fund_capital_calls.amount');
    assert.equal(e.discarded, true);
    assert.equal(e.message, neverFillMessage('fund_capital_calls.amount'));
    return true;
  });
  const row = await getRail(w.env, MEMBER, uid);
  assert.equal(row?.status, 'discarded');
  assert.equal(row?.decided_payload, null, 'a value was kept');
  // Decided once: a second press finds nothing open.
  assert.equal(await decideRail(w.env, MEMBER, uid, 'edit', { field: 'hypotheses.claim', value: 'x' }), null);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('D777 an edit that names a listed field is refused, and the placement stays open', async () => {
  // Mutations checked: the edit check removed (the edit is kept); the edit check
  // reading the stored field instead of the edited one; the check run on discard.
  const w = world();
  const p = await proposeRail(w.env, placement('hypotheses.claim', 'Ops leads reconcile by hand.'));
  await assert.rejects(decideRail(w.env, MEMBER, p.uid, 'edit', { field: 'profiles.ssn', value: '123-45-6789' }), (e: any) => {
    assert.ok(e instanceof NeverFillRefusal);
    assert.deepEqual([e.field, e.discarded], ['profiles.ssn', false]);
    return true;
  });
  assert.equal((await getRail(w.env, MEMBER, p.uid))?.status, 'proposed', 'the refusal closed the placement');
  // The member can still keep it as proposed, or throw it away.
  const kept = await decideRail(w.env, MEMBER, p.uid, 'edit', { field: 'hypotheses.claim', value: 'Ops leads reconcile every Friday.' });
  assert.equal(kept?.status, 'edited');
  const other = await proposeRail(w.env, placement('hypotheses.claim', 'x'));
  assert.equal((await decideRail(w.env, MEMBER, other.uid, 'discard', { field: 'profiles.ssn' }))?.status, 'discarded', 'discarding keeps nothing, so nothing is refused');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('D777 the route answers a never-fill press 422 with the registry\'s sentence; another member\'s uid is still 409', async () => {
  // Mutations checked: the catch removed (500); the status changed to 409; the
  // refusal's sentence replaced; the catch swallowing every error.
  const w = world();
  const legacy = storedBeforeListing(w, 'documents.signature');
  const r = await decide(w, MEMBER, legacy, { decision: 'accept' });
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    error: 'never_fill', refusal: 'never_fill', message: neverFillMessage('documents.signature'),
    field: 'documents.signature', discarded: true,
  });
  const p = await proposeRail(w.env, placement('hypotheses.claim', 'A line.'));
  const edit = await decide(w, MEMBER, p.uid, { decision: 'edit', payload: { field: 'fund_distributions.amount', value: '5000' } });
  assert.equal(edit.status, 422);
  assert.equal(edit.body.discarded, false);
  // Scoping is unchanged: another member's uid is not theirs to refuse or keep.
  assert.equal((await decide(w, OTHER, p.uid, { decision: 'accept' })).status, 409);
  assert.equal((await decide(w, MEMBER, p.uid, { decision: 'accept' })).status, 200);
  // Keeping is not a save: the press decides the proposal and writes no fill.
  // The record's own Save writes the value, then `recordRailFill` (case 5).
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM fill_provenance').n, 0, 'deciding wrote a fill');
  const route = readFileSync(new URL('../src/routes/ai_rail_proposals.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(route, /recordFill|recordRailFill|INSERT INTO/, 'the decide route writes something other than the decision');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('D777 placements are decided one at a time: one route, one uid, no bulk decision', () => {
  // Mutations checked: a POST /decide (no uid) added to the route; decideRail
  // taking a list of uids.
  const route = readFileSync(new URL('../src/routes/ai_rail_proposals.ts', import.meta.url), 'utf8');
  const writes = [...route.matchAll(/\br\.(post|put|patch|delete)\('([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(writes, ['post /:uid/decide'], 'a write route other than the one-uid decision');
  const store = readFileSync(new URL('../src/services/railProposals.ts', import.meta.url), 'utf8');
  assert.match(store, /export async function decideRail\(env: Env, userId: number, uid: string, decision/);
  assert.doesNotMatch(store, /WHERE uid IN \(/, 'a decision over several uids');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('D777 a kept placement\'s provenance names its proposal and the run that produced it', async () => {
  // Mutations checked: `aiProposalId` dropped from recordRailFill; the INSERT
  // binding `ai_proposal_id` as null; `usageLogId` dropped; fillsForRow not
  // selecting `ai_proposal_id`.
  const w = world();
  const r = await run(w);
  assert.equal(r.ok, true, JSON.stringify(r));
  const p = await proposeRail(w.env, { ...placement('hypotheses.claim', 'We reconcile by hand every Friday.'), model: r.usage.model, usageLogId: r.usageLogId });
  await decideRail(w.env, MEMBER, p.uid, 'edit', { field: 'hypotheses.claim', value: 'We reconcile by hand, every Friday.' });
  const proposalRow = one(w, 'SELECT id FROM ai_rail_proposals WHERE uid = ?', p.uid);

  const id = await recordRailFill(w.env, {
    userId: MEMBER, uid: p.uid, target: { table: 'hypotheses', rowId: 11, column: 'claim' },
    writtenValue: 'We reconcile by hand, every Friday.', fillClass: 'sourced', targetRowRef: 'hypotheses',
  });
  assert.ok(id > 0);
  const fp = one(w, `SELECT target_table, target_row_id, target_column, proposal_id, ai_proposal_id, ai_usage_log_id,
    task, decided_by, edited, proposed_value, written_value, model FROM fill_provenance WHERE id = ?`, id);
  assert.deepEqual(fp, {
    target_table: 'hypotheses', target_row_id: 11, target_column: 'claim',
    proposal_id: null, ai_proposal_id: proposalRow.id, ai_usage_log_id: r.usageLogId,
    task: RAIL.option, decided_by: MEMBER, edited: 1,
    proposed_value: 'We reconcile by hand every Friday.', written_value: 'We reconcile by hand, every Friday.', model: r.usage.model,
  });

  const [filled] = await fillsForRow(w.env, 'hypotheses', 11);
  assert.equal(filled.ai_proposal_id, proposalRow.id);
  assert.equal(filled.run?.usage_log_id, r.usageLogId);
  assert.equal(filled.run?.rail_option, RAIL.option, 'the run\'s own option');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('D777 only the member\'s own kept placement is recorded, and never into a listed field', async () => {
  // Mutations checked: the user_id scope dropped; the kind check dropped; the
  // status check dropped; recordFill's never-fill check removed.
  const w = world();
  const target = { table: 'hypotheses', rowId: 12, column: 'claim' };
  const fill = (uid: string, who = MEMBER, t = target) => recordRailFill(w.env, { userId: who, uid, target: t, writtenValue: 'x', fillClass: 'sourced' });

  const open = await proposeRail(w.env, placement('hypotheses.claim', 'x'));
  await assert.rejects(fill(open.uid), /has not been kept/);
  const thrown = await proposeRail(w.env, placement('hypotheses.claim', 'x'));
  await decideRail(w.env, MEMBER, thrown.uid, 'discard');
  await assert.rejects(fill(thrown.uid), /has not been kept/);
  const draft = await proposeRail(w.env, { ...placement('hypotheses.claim', 'x'), kind: 'draft' });
  await decideRail(w.env, MEMBER, draft.uid, 'accept');
  await assert.rejects(fill(draft.uid), /only a placement proposal/);

  const kept = await proposeRail(w.env, placement('hypotheses.claim', 'x'));
  await decideRail(w.env, MEMBER, kept.uid, 'accept');
  await assert.rejects(fill(kept.uid, OTHER), /no such proposal of yours/);
  await assert.rejects(fill(kept.uid, MEMBER, { table: 'payouts', rowId: 1, column: 'amount' }), /never fills/);
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM fill_provenance').n, 0, 'a refused fill was recorded');
  assert.ok(await fill(kept.uid) > 0);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('D777 migration 518 is additive, and a database made before it gains the column at runtime', async () => {
  // Mutations checked: the runtime ADD COLUMN removed from ensureFillProvenanceSchema.
  const sql = migration(M518).replace(/--[^\n]*/g, '');
  assert.match(sql, /ALTER TABLE fill_provenance ADD COLUMN ai_proposal_id INTEGER;/);
  // No declared reference: SQLite would refuse every fill on a database without ai_rail_proposals.
  assert.doesNotMatch(sql, /REFERENCES/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_fill_provenance_rail_proposal ON fill_provenance \(ai_proposal_id\);/);
  assert.doesNotMatch(sql, /^\s*(DROP|UPDATE|DELETE|INSERT)\b/im, 'not additive');

  const w = world({ before518: true });
  const cols = () => new Set((w.f.db.prepare('PRAGMA table_info(fill_provenance)').all() as any[]).map((c) => c.name));
  assert.equal(cols().has('ai_proposal_id'), false);
  const p = await proposeRail(w.env, placement('hypotheses.claim', 'x'));
  await decideRail(w.env, MEMBER, p.uid, 'accept');
  await recordRailFill(w.env, { userId: MEMBER, uid: p.uid, target: { table: 'hypotheses', rowId: 13, column: 'claim' }, writtenValue: 'x', fillClass: 'sourced' });
  assert.equal(cols().has('ai_proposal_id'), true);
  assert.equal(one(w, 'SELECT ai_proposal_id FROM fill_provenance').ai_proposal_id, one(w, 'SELECT id FROM ai_rail_proposals WHERE uid = ?', p.uid).id);
});
