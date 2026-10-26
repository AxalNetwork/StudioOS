/**
 * D966 (#2630) — the owner's repair of Mercury SAFEs accepted before #2629.
 *
 * Real SQL on node:sqlite (`_mercury_raise_fixture.ts`: baseline tables and
 * migrations), the real route behind the real guards, the real writers
 * (`addHolder`, `saveScenario`, `updateHolder`) and the real engine. Nothing
 * on the write path is stubbed. Three tests put a D1 binding in front of the
 * same database that fails or races one chosen statement, as a transient D1
 * error or a founder's save would. Every name, id and amount is invented.
 *
 * A pre-#2629 Accept is `acceptBefore2629`: the `kind === 'safe'` branch of
 * `acceptRaiseProposal` as `git show d15d97bd2f~1:cloudflare-worker/src/services/mercury/raiseFeeds.ts`
 * has it (claim, `addHolder` with no basis, land on the canonical scenario),
 * through today's `addHolder`, which still writes no basis when given none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminMercurySafeBasis from '../src/routes/admin_mercury_safe_basis.ts';
import { addHolder, saveScenario, updateHolder } from '../src/services/capTableWrites.ts';
import { simulate } from '../src/services/captable.ts';
import { readCapTable } from '../src/services/capTableToday.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { accept, fixture, sync, withFake } from './_mercury_raise_fixture.ts';

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const HOLDER = 900, PLAIN = 901;
const PATH = '/api/admin/mercury/safe-basis-repair';
const REASON = 'Mercury SAFEs accepted before #2629 are post-money';
const OUTCOMES = ['repaired', 'would_repair', 'has_basis', 'scenario_missing', 'scenario_other_venture',
  'entry_missing', 'entry_not_safe', 'record_venture', 'ambiguous', 'conflict', 'failed'];
const counts = (some: Record<string, number>) => ({ ...Object.fromEntries(OUTCOMES.map((o) => [o, 0])), ...some });
/** Every invented name and amount: none may reach an answer or a run's audit. */
const PRIVATE = ['@', 'example', 'Angel', 'Manual', 'Founder', 'Holder', 'Plain', '25000', '5000000', '12345', '3000000', '26000'];

// ───────────────────────────────────────────── the world

async function world() {
  const f = await fixture();
  for (const t of ['user_sessions', 'super_admins', 'admin_audit_log']) f.db.exec(tableFromBaseline(BASELINE, t));
  f.db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES
      (${HOLDER}, 'admin', 'Hal Holder', 'holder@example.com', 1), (${PLAIN}, 'admin', 'Pia Plain', 'plain@example.com', 1);
    INSERT INTO super_admins (user_id) VALUES (${HOLDER});`);
  return f;
}

/** A venture whose founder (user `u`, founder_id `11u`) owns project `pid`. 101 and 202 come with the fixture. */
function venture(f: any, pid: number, u: number) {
  f.db.prepare("INSERT INTO users (id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, 'founder', ?, ?, ?, 1, 'studio')")
    .run(u, u * 11, `Founder ${u}`, `f${u}@example.com`);
  f.db.prepare('INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (?, ?, ?, ?, ?)').run(pid, `p-${pid}`, `Venture ${pid}`, u * 11, u * 10);
}
const actor = (id: number) => ({ id, role: 'founder', subscription_tier: 'studio' }) as any;
const ownerOf = (pid: number) => pid / 101;

/** The venture's founder on its table, so a SAFE can be added (validateInputs needs one). */
const seed = (f: any, pid: number) => addHolder(f.env, { projectId: pid, actor: actor(ownerOf(pid)), group: 'founders', instrument: 'common', name: `Founder ${ownerOf(pid)}`, shares: 8_000_000 });
const manualSafe = (f: any, pid: number, name = 'Manual Angel') =>
  addHolder(f.env, { projectId: pid, actor: actor(ownerOf(pid)), group: 'investors', instrument: 'safe', name, amount_cents: 1_234_500, cap_cents: 300_000_000 });

let sourceSeq = 0;
/** A pending Mercury SAFE proposal, as a Raise sync writes one (`proposeStmt`). */
function pendingSafe(f: any, pid: number, name = 'Angel Fixture') {
  sourceSeq += 1;
  const r = f.db.prepare(`INSERT INTO mercury_raise_proposals (integration_id, project_id, kind, source_key, payload_json, target) VALUES (41, ?, 'safe', ?, ?, NULL)`)
    .run(pid, `safe-request-${sourceSeq}`, JSON.stringify({ investor_name: name, amount_cents: 2_500_000, cap_cents: 500_000_000, discount_pct: null, date: '2026-08-01', status: 'signed' }));
  return Number(r.lastInsertRowid);
}

/** Accept as `main` did before #2629: claim, `addHolder` with no basis, land on the canonical scenario with its ledger row. */
async function acceptBefore2629(f: any, id: number): Promise<string> {
  const env = f.env;
  const p = f.one('SELECT * FROM mercury_raise_proposals WHERE id = ?', id);
  const claimed = await env.DB.prepare(`UPDATE mercury_raise_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`).bind(ownerOf(p.project_id), id).run();
  assert.equal(claimed.meta.changes, 1);
  const payload = JSON.parse(p.payload_json);
  const out = await addHolder(env, {
    projectId: p.project_id, actor: actor(ownerOf(p.project_id)), group: 'investors', instrument: 'safe',
    name: String(payload.investor_name || 'SAFE investor').slice(0, 200),
    amount_cents: payload.amount_cents, cap_cents: payload.cap_cents ?? null, discount_pct: payload.discount_pct ?? null,
  });
  const base = await env.DB.prepare('SELECT id FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0 ORDER BY id LIMIT 1').bind(p.project_id).first();
  await env.DB.batch([
    env.DB.prepare('UPDATE mercury_raise_proposals SET local_table = ?, local_id = ?, target = ? WHERE id = ?').bind('cap_table_scenarios', base?.id ?? null, out.id, id),
    env.DB.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (?, ?, 'cap_table', 'safe', ?, ?, ?)`)
      .bind(p.integration_id, p.project_id, `raise:${p.project_id}:safe:${p.source_key}`, 'cap_table_scenarios', base?.id ?? null),
  ]);
  return out.id;
}

/** A fresh venture with its founder and one SAFE accepted before #2629: its proposal id and entry key. */
async function landed(f: any, pid: number, name = 'Angel Fixture') {
  if (pid !== 101 && pid !== 202) venture(f, pid, ownerOf(pid));
  await seed(f, pid);
  const proposal = pendingSafe(f, pid, name);
  return { proposal, key: await acceptBefore2629(f, proposal) };
}

let draftSeq = 0;
/** A draft variant, as `POST /scenarios/by-project/:id/variants` writes one: the inputs it is sent, computed, is_variant = 1. */
function draft(f: any, pid: number, inputs: any) {
  draftSeq += 1;
  const now = new Date().toISOString();
  const r = f.db.prepare(`INSERT INTO cap_table_scenarios (uid, owner_user_id, project_id, name, inputs_json, result_json, computed_at, created_at, updated_at, is_variant)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(`draft-${draftSeq}`, ownerOf(pid), pid, `Draft ${draftSeq}`, JSON.stringify(inputs), JSON.stringify(simulate(inputs)), now, now, now);
  return Number(r.lastInsertRowid);
}

/** The founder's own save through the canonical writer (the tool's POST). */
async function founderSaves(f: any, pid: number, edit: (inputs: any) => any) {
  const row = canonical(f, pid);
  const saved = await saveScenario(f.env, { actor: actor(ownerOf(pid)), name: row.name, projectId: pid, inputs: edit(inputsOf(row)) });
  assert.ok(saved.ok);
}

const scenario = (f: any, id: number) => ({ ...f.one('SELECT * FROM cap_table_scenarios WHERE id = ?', id) });
const canonical = (f: any, pid: number) => ({ ...f.one('SELECT * FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0', pid) });
const inputsOf = (row: any) => JSON.parse(row.inputs_json);
const safeUnder = (row: any, key: string) => inputsOf(row).safes.find((e: any) => e.key === key);
const proposalRow = (f: any, id: number) => ({ ...f.one('SELECT * FROM mercury_raise_proposals WHERE id = ?', id) });
/** The rollback records, oldest first. */
const rollbacks = (f: any) => f.all(`SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'mercury_safe_basis_repaired' ORDER BY id`)
  .map((r: any) => ({ admin_user_id: r.admin_user_id, ...JSON.parse(r.filters_json) }));
/** The runs' audits, oldest first. */
const runs = (f: any) => f.all(`SELECT action, admin_user_id, filters_json FROM admin_audit_log
    WHERE action IN ('mercury_safe_basis_repair', 'mercury_safe_basis_repair_dry_run') ORDER BY id`)
  .map((r: any) => ({ action: r.action, admin_user_id: r.admin_user_id, raw: r.filters_json, ...JSON.parse(r.filters_json) }));
const scenarioActs = (f: any) => f.all(`SELECT project_id, user_id, details FROM activity_logs WHERE action = 'captable_scenario_updated' ORDER BY id`)
  .map((r: any) => ({ project_id: r.project_id, user_id: r.user_id, details: JSON.parse(r.details) }));
const outcomes = (body: any) => Object.fromEntries(body.rows.map((r: any) => [r.proposal_id, r.outcome]));
/** Old timestamps, so a write that moves them is seen whatever the clock does. */
const age = (f: any, pid: number) => f.db.prepare(`UPDATE cap_table_scenarios SET computed_at = '2026-01-01T00:00:00.000Z', updated_at = '2026-01-01T00:00:00.000Z'
    WHERE project_id = ? AND COALESCE(is_variant, 0) = 0`).run(pid);

function noPersonalData(text: string) {
  for (const s of PRIVATE) assert.ok(!text.includes(s), `the text carries "${s}": ${text.slice(0, 400)}`);
}

// ───────────────────────────────────────────── the route

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/admin/mercury', adminMercurySafeBasis);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message }, s) : c.json({ detail: 'unexpected' }, 500);
  });
  return a;
})();

/** A TOTP session for `id`, stepped up now unless `stale`, and its token. */
let jtiSeq = 0;
async function session(f: any, id: number, role: string, opts: { stale?: boolean } = {}) {
  jtiSeq += 1;
  const jti = `jti-${id}-${jtiSeq}`;
  if (opts.stale) f.db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now', '-2 days'))").run(id, jti);
  else f.db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))").run(id, jti);
  return new SignJWT({ user_id: id, role, jti }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
}

async function repair(f: any, jwt: string | null, body: unknown, env: any = f.env) {
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) };
    const res = await app.request(PATH, { method: 'POST', headers, body: JSON.stringify(body) }, env);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}

/** The same database behind a binding whose statements throw when `fails` says so; a batch holding one rolls back whole. */
function flaky(f: any, fails: (sql: string) => boolean) {
  const base = d1Over(f.db);
  return {
    ...f.env,
    DB: {
      ...base,
      prepare(sql: string) {
        if (!fails(sql)) return base.prepare(sql);
        const boom = () => { throw new Error('D1_ERROR: synthetic failure'); };
        const stmt: any = { bind: () => stmt, all: async () => boom(), first: async () => boom(), run: async () => boom(), runSync: boom };
        return stmt;
      },
    },
  };
}

// ───────────────────────────────────────────── 1. the repair, end to end

test('1. a SAFE accepted before #2629 has no basis; the dry run reports it and writes nothing; the write adds post_money to that entry alone, recomputes, keeps keys, variants and provenance, and records how to undo it; a second run writes nothing', async () => {
  const f = await world();
  // The Raise sync proposes Mercury's SAFE; the founder's table holds a founder and two manual SAFEs with no basis, one under the same investor name.
  await withFake(f, () => sync(f.env));
  const proposal = f.one(`SELECT id FROM mercury_raise_proposals WHERE kind = 'safe' AND project_id = 101`).id;
  await seed(f, 101);
  const manual = (await manualSafe(f, 101)).id;
  const namesake = (await manualSafe(f, 101, 'Angel Fixture')).id;
  const key = await acceptBefore2629(f, proposal);
  assert.deepEqual([manual, namesake, key], ['e-2', 'e-3', 'e-4']);
  const accepted = canonical(f, 101);
  const entry = safeUnder(accepted, key);
  assert.deepEqual(entry, { name: 'Angel Fixture', amount: 25000, cap: 5_000_000, key }, 'before #2629 the Mercury SAFE lands with no basis');
  assert.equal(JSON.parse(accepted.result_json).post_money_check.fraction, 0, 'so the engine reads it as a pre-money SAFE');
  // The founder models a round and an exit through the canonical writer, so the basis moves the results.
  await founderSaves(f, 101, (i) => ({ ...i, rounds: [{ name: 'Seed', pre_money: 8_000_000, investment: 2_000_000 }], exit_value: 40_000_000 }));
  age(f, 101);
  const before = canonical(f, 101);
  // A draft copied from it holds the same key with no basis; a second states a basis. Neither is ever written.
  const copied = draft(f, 101, inputsOf(before));
  const stated = draft(f, 101, { ...inputsOf(before), safes: inputsOf(before).safes.map((s: any) => (s.key === key ? { ...s, basis: 'pre_money' } : s)) });
  const drafts = () => [scenario(f, copied), scenario(f, stated)];
  const draftsBefore = drafts();
  const proposalBefore = proposalRow(f, proposal);
  const ledger = () => f.all('SELECT * FROM connector_fed_items ORDER BY id');
  const ledgerBefore = ledger();
  assert.ok(ledgerBefore.some((r: any) => r.kind === 'safe' && r.local_table === 'cap_table_scenarios'));

  // The dry run, by the Super Admin without a recent step-up: reported, nothing written.
  const dry = await repair(f, await session(f, HOLDER, 'admin', { stale: true }), {});
  assert.equal(dry.status, 200, dry.text);
  const row = { proposal_id: proposal, project_id: 101, scenario_id: before.id, entry_key: key, variants_untouched: [copied] };
  assert.deepEqual(dry.body, { dry_run: true, checked: 1, counts: counts({ would_repair: 1 }), written: 0, rows: [{ ...row, outcome: 'would_repair' }], next_after: null });
  assert.deepEqual(canonical(f, 101), before, 'a dry run writes nothing');
  assert.deepEqual([drafts(), rollbacks(f), scenarioActs(f)], [draftsBefore, [], []]);
  assert.deepEqual(runs(f).map((r: any) => [r.action, r.admin_user_id, r.dry_run, r.written, r.reason]), [['mercury_safe_basis_repair_dry_run', HOLDER, true, 0, undefined]]);

  // The write: the step-up and a reason.
  const holder = await session(f, HOLDER, 'admin');
  const done = await repair(f, holder, { dry_run: false, reason: REASON });
  assert.equal(done.status, 200, done.text);
  assert.deepEqual(done.body, { dry_run: false, checked: 1, counts: counts({ repaired: 1 }), written: 1, rows: [{ ...row, outcome: 'repaired' }], next_after: null });
  const after = canonical(f, 101);
  const expected = inputsOf(before);
  const at = expected.safes.findIndex((s: any) => s.key === key);
  const prior = expected.safes[at];
  expected.safes[at] = { ...prior, basis: 'post_money' };
  assert.equal(after.inputs_json, JSON.stringify(expected), 'that entry gains its basis; every other byte of the inputs is as it was');
  assert.deepEqual(inputsOf(after).safes.map((s: any) => [s.key, s.name, s.basis]),
    [['e-2', 'Manual Angel', undefined], ['e-3', 'Angel Fixture', undefined], [key, 'Angel Fixture', 'post_money']], 'never by name: the namesake and the manual SAFE keep no basis');
  assert.deepEqual([inputsOf(after).entry_key_seq, inputsOf(after).founders, inputsOf(after).rounds], [inputsOf(before).entry_key_seq, inputsOf(before).founders, inputsOf(before).rounds]);
  // Recomputed through the engine every save runs.
  assert.equal(after.result_json, JSON.stringify(simulate(expected)));
  assert.notEqual(after.result_json, before.result_json);
  assert.equal(JSON.parse(after.result_json).post_money_check.fraction, 0.005, 'the SAFE now converts post-money: 25,000 on a 5,000,000 cap');
  const conversion = (r: any) => r.rounds[0].conversions.filter((c: any) => c.basis === 'post_money').map((c: any) => c.name);
  assert.deepEqual([conversion(JSON.parse(before.result_json)), conversion(JSON.parse(after.result_json))], [[], ['Angel Fixture']]);
  // The row keeps what it is; only the computation's two stamps move.
  for (const col of ['id', 'uid', 'owner_user_id', 'project_id', 'name', 'is_variant', 'created_at']) assert.equal(after[col], before[col], col);
  assert.ok(after.computed_at > before.computed_at && after.updated_at > before.updated_at);
  // Variants and provenance are untouched.
  assert.deepEqual([drafts(), proposalRow(f, proposal), ledger()], [draftsBefore, proposalBefore, ledgerBefore]);

  // The rollback record: the operator, the reason and the entry exactly as it was, written with the change.
  const [record] = rollbacks(f);
  assert.deepEqual(rollbacks(f), [{
    admin_user_id: HOLDER, decision: 'D966', proposal_id: proposal, project_id: 101, scenario_id: before.id, scenario_uid: before.uid,
    entry_key: key, list: 'safes', index: at, prior_entry: prior, basis: 'post_money', reason: REASON,
  }]);
  const undone = inputsOf(after);
  undone[record.list][record.index] = record.prior_entry;
  assert.equal(JSON.stringify(undone), before.inputs_json, 'the record restores the inputs byte for byte');
  // D632: the venture's History names who changed its scenario, by ids.
  assert.deepEqual(scenarioActs(f), [{ project_id: 101, user_id: HOLDER, details: { scenario_uid: before.uid, is_variant: 0, repair: 'D966', entry_key: key } }]);
  const written = runs(f)[1];
  assert.deepEqual([written.action, written.admin_user_id, written.dry_run, written.written, written.reason, written.counts.repaired],
    ['mercury_safe_basis_repair', HOLDER, false, 1, REASON, 1]);
  assert.deepEqual(written.rows, [{ ...row, outcome: 'repaired' }]);

  // A second run, dry or written, finds the basis and writes nothing.
  for (const body of [{}, { dry_run: false, reason: REASON }]) {
    const again = await repair(f, holder, body);
    assert.equal(again.status, 200, again.text);
    assert.deepEqual([again.body.rows.map((r: any) => r.outcome), again.body.written], [['has_basis'], 0]);
    noPersonalData(again.text);
  }
  assert.deepEqual(canonical(f, 101), after);
  assert.deepEqual([rollbacks(f).length, scenarioActs(f).length, runs(f).length], [1, 1, 4]);

  // No answer and no run's audit carries a name, an email or an amount.
  for (const t of [dry.text, done.text, ...runs(f).map((r: any) => r.raw)]) noPersonalData(t);
});

test('2. a SAFE accepted today lands on the record with its basis, and is never a candidate', async () => {
  const f = await world();
  await withFake(f, () => sync(f.env));
  await seed(f, 101);
  const id = f.one(`SELECT id FROM mercury_raise_proposals WHERE kind = 'safe' AND project_id = 101`).id;
  const r = await accept(f.env, id);
  assert.equal(r.status, 200, r.text);
  assert.equal(proposalRow(f, id).local_table, 'cap_table_issuances');
  assert.equal(inputsOf(canonical(f, 101)).safes[0].basis, 'post_money', '#2629: the model entry carries its basis');
  const dry = await repair(f, await session(f, HOLDER, 'admin'), {});
  assert.deepEqual([dry.status, dry.body.checked, dry.body.rows], [200, 0, []]);
});

// ───────────────────────────────────────────── 3. what is left alone

test('3. every skip is reported and writes nothing: a stated basis, a deleted, re-keyed or retyped entry, a missing, moved or variant scenario, a record venture, an ambiguous key; a manual SAFE is never touched', async () => {
  const f = await world();

  // Venture 101: four SAFEs accepted before #2629, then the founder's own saves.
  await seed(f, 101);
  const stated = pendingSafe(f, 101, 'Stated Angel'), gone = pendingSafe(f, 101, 'Gone Angel'), noted = pendingSafe(f, 101, 'Noted Angel'), rekeyed = pendingSafe(f, 101, 'Rekeyed Angel');
  const keys: Record<number, string> = {};
  for (const id of [stated, gone, noted, rekeyed]) keys[id] = await acceptBefore2629(f, id);
  // One save: a basis stated by hand, an entry deleted, one made a note, one deleted.
  await founderSaves(f, 101, (i) => ({
    ...i,
    safes: i.safes.filter((s: any) => s.key !== keys[gone] && s.key !== keys[rekeyed])
      .map((s: any) => (s.key === keys[stated] ? { ...s, basis: 'pre_money' } : s.key === keys[noted] ? { ...s, instrument: 'note' } : s)),
  }));
  // A later save: a manual SAFE under the deleted entry's investor name takes a new key; a founder is posted under the other deleted key.
  await founderSaves(f, 101, (i) => ({ ...i, founders: [...i.founders, { name: 'Late Founder', shares: 1_000, key: keys[rekeyed] }], safes: [...i.safes, { name: 'Gone Angel', amount: 12345, cap: 3_000_000 }] }));
  const v101 = inputsOf(canonical(f, 101));
  assert.equal(v101.safes.find((s: any) => s.name === 'Gone Angel').key === keys[gone], false, 'the namesake is under a new key');
  assert.equal(v101.founders.find((s: any) => s.key === keys[rekeyed]).name, 'Late Founder');
  // A proposal whose recorded target is no entry key.
  const junk = f.db.prepare(`INSERT INTO mercury_raise_proposals (integration_id, project_id, kind, source_key, payload_json, target, status, local_table, local_id)
      VALUES (41, 101, 'safe', 'safe-junk', '{}', 'Gone Angel', 'accepted', 'cap_table_scenarios', ?)`).run(canonical(f, 101).id).lastInsertRowid;

  // Venture 202: its scenario deleted, as DELETE /scenarios/:uid does. And a proposal that landed on no scenario.
  const deleted = (await landed(f, 202)).proposal;
  f.db.prepare('DELETE FROM cap_table_scenarios WHERE uid = ?').run(canonical(f, 202).uid);
  const nowhere = (await landed(f, 303)).proposal;
  f.db.prepare('UPDATE mercury_raise_proposals SET local_id = NULL WHERE id = ?').run(nowhere);

  // Venture 404: its scenario moved to another venture. Venture 505: a proposal naming venture 404's scenario.
  const moved = await landed(f, 404);
  const movedId = canonical(f, 404).id;
  f.db.prepare('UPDATE cap_table_scenarios SET project_id = 9090 WHERE id = ?').run(movedId);
  const foreign = await landed(f, 505);
  f.db.prepare('UPDATE mercury_raise_proposals SET local_id = ? WHERE id = ?').run(movedId, foreign.proposal);

  // Venture 606: the record now holds its shares.
  const recorded = (await landed(f, 606)).proposal;
  f.db.exec(`INSERT INTO cap_table_share_classes (uid, project_id, name, kind) VALUES ('cls-606', 606, 'Common', 'common');
    INSERT INTO cap_table_issuances (uid, project_id, kind, holder_name, class_id, shares, issued_on, source, origin, status, recorded_at)
      VALUES ('iss-606', 606, 'founding', 'Founder 6', (SELECT id FROM cap_table_share_classes WHERE uid = 'cls-606'), 1000000, '2026-01-01', 'typed', 'owner', 'recorded', datetime('now'));`);
  assert.equal((await readCapTable(f.env, 606)).source, 'record');

  // Venture 707: the key names two entries. Venture 808: two accepted proposals claim one key.
  const twice = await landed(f, 707);
  const doubled = inputsOf(canonical(f, 707));
  doubled.safes.push({ ...doubled.safes.find((s: any) => s.key === twice.key), name: 'Manual Angel' });
  f.db.prepare('UPDATE cap_table_scenarios SET inputs_json = ? WHERE project_id = 707').run(JSON.stringify(doubled));
  const claimed = await landed(f, 808);
  const rival = f.db.prepare(`INSERT INTO mercury_raise_proposals (integration_id, project_id, kind, source_key, payload_json, target, status, local_table, local_id)
      VALUES (41, 808, 'safe', 'safe-rival', '{}', ?, 'accepted', 'cap_table_scenarios', ?)`).run(claimed.key, canonical(f, 808).id).lastInsertRowid;

  // Venture 909: its proposal names a draft copied from the scenario, and its inputs cannot be read by venture 1010's.
  const toDraft = await landed(f, 909);
  const copy = draft(f, 909, inputsOf(canonical(f, 909)));
  f.db.prepare('UPDATE mercury_raise_proposals SET local_id = ? WHERE id = ?').run(copy, toDraft.proposal);
  const unreadable = (await landed(f, 1010)).proposal;
  f.db.prepare(`UPDATE cap_table_scenarios SET inputs_json = 'not json' WHERE project_id = 1010`).run();

  // Venture 1111, the control: two SAFEs to repair (one stored with basis null) beside a manual SAFE with no basis.
  const plain = await landed(f, 1111);
  await manualSafe(f, 1111);
  const nulled = pendingSafe(f, 1111, 'Null Angel');
  const nulledKey = await acceptBefore2629(f, nulled);
  await founderSaves(f, 1111, (i) => ({ ...i, safes: i.safes.map((s: any) => (s.key === nulledKey ? { ...s, basis: null } : s)) }));

  // Never candidates: another kind, a dismissed SAFE and one landed on the record, though each names a SAFE with no basis.
  const control = canonical(f, 1111).id;
  const notCandidates = [['investor_credit', 'accepted', 'cap_table_scenarios'], ['safe', 'dismissed', 'cap_table_scenarios'], ['safe', 'accepted', 'cap_table_issuances']]
    .map(([kind, status, table], n) => Number(f.db.prepare(`INSERT INTO mercury_raise_proposals (integration_id, project_id, kind, source_key, payload_json, target, status, local_table, local_id)
      VALUES (41, 1111, ?, ?, '{}', ?, ?, ?, ?)`).run(kind, `not-${n}`, plain.key, status, table, control).lastInsertRowid));

  const pids = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010];
  const tables = () => Object.fromEntries([...pids.map((p) => [p, f.all('SELECT * FROM cap_table_scenarios WHERE project_id = ? ORDER BY id', p)]), [9090, scenario(f, movedId)]]);
  const tablesBefore = tables();
  age(f, 1111);
  const controlBefore = canonical(f, 1111);
  const expected = {
    [stated]: 'has_basis', [gone]: 'entry_missing', [noted]: 'entry_not_safe', [rekeyed]: 'entry_not_safe', [Number(junk)]: 'entry_missing',
    [deleted]: 'scenario_missing', [nowhere]: 'scenario_missing', [moved.proposal]: 'scenario_other_venture', [foreign.proposal]: 'scenario_other_venture',
    [recorded]: 'record_venture', [twice.proposal]: 'ambiguous', [claimed.proposal]: 'ambiguous', [Number(rival)]: 'ambiguous',
    [toDraft.proposal]: 'scenario_missing', [unreadable]: 'entry_missing', [plain.proposal]: 'would_repair', [nulled]: 'would_repair',
  };
  const holder = await session(f, HOLDER, 'admin');
  const dry = await repair(f, holder, { limit: 100 });
  assert.equal(dry.status, 200, dry.text);
  assert.deepEqual(outcomes(dry.body), expected);
  for (const id of notCandidates) assert.ok(!(id in outcomes(dry.body)), `proposal ${id} is no candidate`);
  assert.equal(dry.body.rows.find((r: any) => r.proposal_id === Number(junk)).entry_key, null, 'a target that is no key is answered as none');
  assert.deepEqual(dry.body.rows.find((r: any) => r.proposal_id === toDraft.proposal).variants_untouched, [copy]);

  const done = await repair(f, holder, { dry_run: false, reason: REASON, limit: 100 });
  assert.equal(done.status, 200, done.text);
  assert.deepEqual(outcomes(done.body), { ...expected, [plain.proposal]: 'repaired', [nulled]: 'repaired' });
  assert.deepEqual([done.body.written, done.body.counts], [2, counts({
    repaired: 2, has_basis: 1, entry_missing: 3, entry_not_safe: 2, scenario_missing: 3, scenario_other_venture: 2, record_venture: 1, ambiguous: 3,
  })]);
  assert.deepEqual(tables(), tablesBefore, 'nothing it reports and leaves is written');
  assert.equal(safeUnder(canonical(f, 101), keys[stated]).basis, 'pre_money', 'a stated basis is kept');
  // The control: the two SAFEs take post_money; the manual SAFE beside them keeps none.
  const fixed = inputsOf(canonical(f, 1111));
  assert.deepEqual(fixed.safes.map((s: any) => [s.name, s.basis]), [['Angel Fixture', 'post_money'], ['Manual Angel', undefined], ['Null Angel', 'post_money']]);
  const want = inputsOf(controlBefore);
  want.safes = want.safes.map((s: any) => (s.key === plain.key || s.key === nulledKey ? { ...s, basis: 'post_money' } : s));
  assert.equal(canonical(f, 1111).inputs_json, JSON.stringify(want));
  assert.deepEqual(rollbacks(f).map((r: any) => [r.proposal_id, r.prior_entry.basis]), [[plain.proposal, undefined], [nulled, null]]);
  noPersonalData(dry.text); noPersonalData(done.text);
});

// ───────────────────────────────────────────── 4. a concurrent edit

test('4. a founder\'s save between the read and the write is a conflict: nothing is written over it, and the next run repairs the edited entry', async () => {
  const f = await world();
  const { proposal, key } = await landed(f, 101);
  const base = d1Over(f.db);
  let raced = false;
  // The founder changes the SAFE's amount through the canonical writer just after the repair has read the scenario.
  const racing = {
    ...f.env,
    DB: {
      ...base,
      prepare(sql: string) {
        const st = base.prepare(sql);
        if (raced || !sql.includes('AS is_variant, inputs_json FROM cap_table_scenarios WHERE id = ?')) return st;
        return {
          bind: (...a: any[]) => {
            st.bind(...a);
            return {
              first: async () => {
                const row = await st.first();
                raced = true;
                await updateHolder(f.env, { projectId: 101, actor: actor(1), id: key, amount_cents: 2_600_000 });
                return row;
              },
            };
          },
        };
      },
    },
  };
  const holder = await session(f, HOLDER, 'admin');
  const first = await repair(f, holder, { dry_run: false, reason: REASON }, racing);
  assert.equal(first.status, 200, first.text);
  assert.ok(raced);
  assert.deepEqual([outcomes(first.body), first.body.written, first.body.counts.conflict], [{ [proposal]: 'conflict' }, 0, 1]);
  assert.deepEqual(safeUnder(canonical(f, 101), key), { name: 'Angel Fixture', amount: 26000, cap: 5_000_000, key }, 'the founder\'s edit stands, and no basis was written over it');
  assert.deepEqual([rollbacks(f), scenarioActs(f)], [[], []], 'no rollback record without its change');
  assert.equal(runs(f)[0].rows[0].outcome, 'conflict');

  const second = await repair(f, holder, { dry_run: false, reason: REASON });
  assert.deepEqual(outcomes(second.body), { [proposal]: 'repaired' });
  assert.deepEqual(safeUnder(canonical(f, 101), key), { name: 'Angel Fixture', amount: 26000, cap: 5_000_000, key, basis: 'post_money' });
  assert.deepEqual(rollbacks(f)[0].prior_entry, { name: 'Angel Fixture', amount: 26000, cap: 5_000_000, key });
  noPersonalData(first.text); noPersonalData(second.text);
});

// ───────────────────────────────────────────── 5. a run that fails

test('5. a write that throws mid-walk is failed, written whole or not at all; the walk goes on, the answer says what was written, and the run is audited', async () => {
  const f = await world();
  const a = await landed(f, 101), b = await landed(f, 202), c = await landed(f, 303);
  const holder = await session(f, HOLDER, 'admin');
  const bBefore = canonical(f, 202);
  let writes = 0;
  const body = { dry_run: false, reason: REASON };
  const first = await repair(f, holder, body, flaky(f, (sql) => /SET inputs_json = \?, result_json = \?/.test(sql) && ++writes === 2));
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(outcomes(first.body), { [a.proposal]: 'repaired', [b.proposal]: 'failed', [c.proposal]: 'repaired' });
  assert.deepEqual([first.body.written, first.body.counts.repaired, first.body.counts.failed], [2, 2, 1]);
  assert.ok(!/nothing was written/i.test(first.text), 'an answer never says nothing was written once a row is');
  assert.deepEqual(canonical(f, 202), bBefore, 'the failed row is left whole');
  assert.deepEqual(rollbacks(f).map((r: any) => r.proposal_id), [a.proposal, c.proposal], 'its rollback record went back with it');
  assert.equal(safeUnder(canonical(f, 101), a.key).basis, 'post_money');
  assert.equal(safeUnder(canonical(f, 303), c.key).basis, 'post_money');
  let audits = runs(f);
  assert.equal(audits.length, 1, 'a run that failed part-way is audited');
  assert.deepEqual([audits[0].action, audits[0].written, audits[0].counts.failed, audits[0].reason, audits[0].failed], ['mercury_safe_basis_repair', 2, 1, REASON, undefined]);
  assert.deepEqual(audits[0].rows.map((r: any) => [r.proposal_id, r.outcome]), [[a.proposal, 'repaired'], [b.proposal, 'failed'], [c.proposal, 'repaired']]);

  // Once D1 answers, the walk again: only the failed row is written.
  const second = await repair(f, holder, body);
  assert.deepEqual(outcomes(second.body), { [a.proposal]: 'has_basis', [b.proposal]: 'repaired', [c.proposal]: 'has_basis' });

  // A page that cannot be read answers 503 before any row is touched, and the run is still audited.
  const down = await repair(f, holder, body, flaky(f, (sql) => /FROM mercury_raise_proposals\s+WHERE id > \?/.test(sql)));
  assert.equal(down.status, 503, down.text);
  assert.equal(down.body.error, 'repair_unavailable');
  assert.match(down.body.message, /Nothing was written/);
  audits = runs(f);
  assert.equal(audits.length, 3);
  assert.deepEqual([audits[2].failed, audits[2].written, audits[2].checked, audits[2].rows], ['page_unreadable', 0, 0, []]);
  for (const t of [first.text, second.text, down.text, ...audits.map((r: any) => r.raw)]) noPersonalData(t);
});

// ───────────────────────────────────────────── 6. who may run it

test('6. refused: anyone not a Super Admin, a write without a recent step-up, a write without a reason; nothing is read or written', async () => {
  const f = await world();
  const { key } = await landed(f, 101);
  const before = canonical(f, 101);
  const write = { dry_run: false, reason: REASON };
  const member = await session(f, 1, 'founder');
  const plain = await session(f, PLAIN, 'admin');
  for (const [jwt, status] of [[null, 401], [member, 403], [plain, 403]] as const) {
    for (const body of [{}, write]) {
      const r = await repair(f, jwt, body);
      assert.equal(r.status, status, r.text);
    }
  }
  const stale = await session(f, HOLDER, 'admin', { stale: true });
  assert.equal((await repair(f, stale, write)).status, 403, 'a write takes a recent step-up');
  const holder = await session(f, HOLDER, 'admin');
  for (const reason of [undefined, '   ', 'x'.repeat(501), 42]) {
    const r = await repair(f, holder, { dry_run: false, reason });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error, 'reason_required');
  }
  assert.deepEqual(canonical(f, 101), before);
  assert.equal(safeUnder(before, key).basis, undefined);
  assert.deepEqual([runs(f), rollbacks(f)], [[], []], 'a refused request is no run');
  // The same Super Admin's dry run needs no step-up.
  assert.equal((await repair(f, stale, {})).status, 200);
});

// ───────────────────────────────────────────── 7. paging

test('7. paged by proposal id: `after` and `limit` walk every candidate once, `next_after` is null at the end, and the limit is 1 to 100', async () => {
  const f = await world();
  const a = await landed(f, 101);
  pendingSafe(f, 101, 'Pending Angel');
  const b = await landed(f, 202);
  const c = await landed(f, 303);
  const holder = await session(f, HOLDER, 'admin');
  const page = async (body: Record<string, unknown>) => {
    const r = await repair(f, holder, body);
    assert.equal(r.status, 200, r.text);
    return [r.body.rows.map((x: any) => x.proposal_id), r.body.next_after];
  };
  assert.deepEqual(await page({ limit: 1 }), [[a.proposal], a.proposal]);
  assert.deepEqual(await page({ limit: 1, after: a.proposal }), [[b.proposal], b.proposal]);
  assert.deepEqual(await page({ limit: 1, after: b.proposal }), [[c.proposal], c.proposal]);
  assert.deepEqual(await page({ limit: 1, after: c.proposal }), [[], null]);
  assert.deepEqual(await page({ limit: 2 }), [[a.proposal, b.proposal], b.proposal]);
  assert.deepEqual(await page({ limit: 2, after: b.proposal }), [[c.proposal], null]);
  assert.deepEqual(await page({ limit: 0 }), [[a.proposal], a.proposal], 'below 1 reads 1');

  // A written walk, page by page until next_after is null, repairs each once.
  let after: number | null = 0;
  const seen: number[] = [];
  while (after != null) {
    const r = await repair(f, holder, { dry_run: false, reason: REASON, limit: 2, after });
    seen.push(...r.body.rows.filter((x: any) => x.outcome === 'repaired').map((x: any) => x.proposal_id));
    after = r.body.next_after;
  }
  assert.deepEqual(seen, [a.proposal, b.proposal, c.proposal]);

  // 101 more candidates: 25 by default, at most 100 a page.
  const more = f.db.prepare(`INSERT INTO mercury_raise_proposals (integration_id, project_id, kind, source_key, payload_json, target, status, local_table, local_id)
      VALUES (41, 101, 'safe', ?, '{}', NULL, 'accepted', 'cap_table_scenarios', NULL)`);
  for (let n = 0; n < 101; n++) more.run(`bulk-${n}`);
  const bulk = async (body: Record<string, unknown>) => (await repair(f, holder, { after: c.proposal, ...body })).body;
  const def = await bulk({});
  assert.deepEqual([def.checked, def.counts.scenario_missing], [25, 25]);
  const max = await bulk({ limit: 1000 });
  assert.equal(max.checked, 100);
  assert.equal(max.next_after, max.rows[99].proposal_id);
});
