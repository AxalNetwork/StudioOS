/**
 * D912 (#2696, part 6 of #2454) — the narrative's claims (NAR6, NAR7) and its
 * check (NAR8), through the real mounted routes on SQLite (the baseline and
 * every later migration).
 *
 *   1. Each claim state comes from D1264's store: a Mismatch with both figures
 *      and both sources, a Not backed claim with its Evidence candidates and
 *      Eadwyn's proposed link, the best source of each.
 *   2. NAR8: each figure against the current deck and the metrics, as "Check
 *      against" chooses; a figure stated in one place only is Not compared.
 *   3. Run the check stamps "Last checked" and logs one row, never a figure.
 *   4. "Use the record's figure" replaces the figure in its section and saves
 *      it through the section's own save, only for the figure shown.
 *   5. Who: the founder checks; an admin with a reason reads states only; an
 *      admin without one, another founder and nobody reach nothing.
 *
 * Every name and figure is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/narrative_claims_d912.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleRaise from '../src/routes/cycle_raise.ts';
import { FIGURE_KINDS, couldBack, sectionOfField } from '../src/services/narrative/claims.ts';
import { FIGURES } from '../src/services/raiseCycle.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d912-narrative-claims-0123456789';
const OWNER = 1, ADMIN = 4, OTHER = 5;
const PID = 7, OTHER_PID = 8;
const ROLE: Record<number, string> = { [OWNER]: 'founder', [ADMIN]: 'admin', [OTHER]: 'founder' };
const today = new Date().toISOString().slice(0, 10);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test'), (11, 'Synthetic Other', 'o@example.test');
    INSERT INTO users (id, email, name, role, founder_id, is_active) VALUES
      (${OWNER}, 'owner@example.test', 'Synthetic Owner', 'founder', 10, 1),
      (${ADMIN}, 'admin@example.test', 'Synthetic Admin', 'admin', NULL, 1),
      (${OTHER}, 'other@example.test', 'Synthetic Other Founder', 'founder', 11, 1);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10), (${OTHER_PID}, 'Synthetic other venture', 11);`);
  // The current deck states 40; Stripe's metric says 38.
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(21, PID, 6, JSON.stringify([{ title: 'Traction', fields: [{ key: 'body', kind: 'paragraph', value: 'We serve 40 paying customers.' }] }]), 'Synthetic deck', 1, OWNER);
  db.prepare("INSERT INTO project_metrics (project_id, snapshot_date, source, paying_accounts) VALUES (?, ?, 'stripe', 38)").run(PID, today);
  pin(db, { id: 1, kind: 'kpi-snapshot', ref: '5:paying_accounts', label: 'connector', provider: 'stripe', value: 38, unit: 'count' });
  // A pinned demand signal: a record that could back a count, linked to nothing.
  db.prepare("INSERT INTO demand_signals (id, project_id, kind, status, signal_date) VALUES (3, ?, 'loi', 'confirmed', ?)").run(PID, today);
  pin(db, { id: 2, kind: 'demand-signal', ref: '3', label: 'document', provider: null, value: null, unit: null });
  return db;
}

function pin(db: any, v: { id: number; kind: string; ref: string; label: string; provider: string | null; value: number | null; unit: string | null }) {
  const row: Record<string, unknown> = {
    id: v.id, uid: `item${v.id}`, project_id: PID, area: 'Investor narrative and Pitch deck', kind: v.kind, source_table: v.kind === 'demand-signal' ? 'demand_signals' : 'project_metrics',
    source_ref: v.ref, source_label: v.label, provider: v.provider, strength: 'measured', observed_on: today, summary: 'Synthetic record.', value_num: v.value,
    value_unit: v.unit, snapshot_hash: 'h'.repeat(64), state: 'pinned', visibility: 'after_nda', mutation_uid: `m${v.id}`,
  };
  for (const c of db.prepare('PRAGMA table_info(raise_evidence_items)').all() as any[]) {
    if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in row)) row[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : 'synthetic';
  }
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO raise_evidence_items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k] as any));
}

const app = new Hono<any>().route('/api/cycles/raise', cycleRaise);
app.onError((err: any, c: any) => c.json({ detail: String(err?.message || '') }, err?.message === 'Unauthorized' ? 401 : 500));

async function call(db: any, who: number | null, method: string, path: string, body?: unknown, pid = PID, support = false) {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (who) h.Authorization = 'Bearer ' + await new SignJWT({ user_id: who, role: ROLE[who], ...(support ? { impersonated_by: ADMIN } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await app.request(`/api/cycles/raise${path}${sep}project=${pid}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } finally { [console.warn, console.error] = saved; }
}

/** Version 1, blank, then its Traction section stating 42 paying customers and 3 letters of intent. */
async function version1(db: any, words = 'We serve 42 paying customers with 3 letters of intent.') {
  const v = await call(db, OWNER, 'POST', '/narrative-versions', { investor_type: 'seed_fund', start_from: 'blank' });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const s = await call(db, OWNER, 'PUT', `/narrative/${v.body.version}/sections/traction`, { body: words });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return v.body.version as number;
}

const claimRow = (db: any, kind: string) => db.prepare("SELECT * FROM raise_claims WHERE surface = 'narrative' AND claim_kind = ?").get(kind) as any;

test('D912: each claim state comes from D1264\'s store, with its best source; a Mismatch carries both figures and both sources', async () => {
  const db = fixture();
  const v = await version1(db);
  const r = await call(db, OWNER, 'GET', `/narrative/${v}/claims`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.can_check, true);
  const paying = r.body.claims.find((c: any) => c.figure === 'paying_customers');
  assert.equal(paying.state, 'mismatch');
  assert.equal(paying.section, 'traction');
  assert.equal(paying.section_label, 'Traction');
  assert.equal(paying.best_source, 'connector');
  assert.equal(paying.stated_shown, '42');
  assert.equal(paying.record.shown, '38');
  assert.equal(paying.record.provider, 'stripe');
  assert.deepEqual(paying.candidates, [], 'a Mismatch already has its record; no other KPI is pinned');
  const lois = r.body.claims.find((c: any) => c.figure === 'lois');
  assert.equal(lois.state, 'mismatch', 'one pinned LOI against a stated three');
  assert.equal(claimRow(db, 'paying_customers').state, 'mismatch', 'the read wrote D1264\'s store');
  assert.deepEqual(r.body.counts, { backed: 0, founders_figure: 0, mismatch: 2, not_backed: 0 });
  assert.equal(r.body.by_source.connector, 1);
});

test('D912: a Not backed claim offers the pinned records of its kind and Eadwyn\'s proposed link; no best source', async () => {
  const db = fixture();
  db.prepare('DELETE FROM raise_evidence_items WHERE id = 2').run();
  pin(db, { id: 4, kind: 'kpi-snapshot', ref: '9:headcount', label: 'typed', provider: null, value: null, unit: 'count' });
  const v = await version1(db, 'A team of 7 with 3 letters of intent.');
  const first = await call(db, OWNER, 'GET', `/narrative/${v}/claims`);
  const team = first.body.claims.find((c: any) => c.figure === 'headcount');
  assert.equal(team.state, 'not_backed', 'a value-less snapshot measures nothing');
  assert.equal(team.best_source, null);
  assert.deepEqual(team.candidates.map((i: any) => i.uid), ['item4'], 'the KPI snapshot is a record that could back it');
  const lois = first.body.claims.find((c: any) => c.figure === 'lois');
  assert.equal(lois.state, 'not_backed');
  assert.deepEqual(lois.candidates, [], 'NAR15c: no record of its kind');
  // Eadwyn proposes linking item4 to the headcount claim.
  const prop: Record<string, unknown> = {
    uid: 'prop1', user_id: OWNER, record_ref: `project:${PID}`, rail_option: 'raise:evidence-link', kind: 'proposal', status: 'proposed',
    payload_json: JSON.stringify({ claim_id: team.uid, item_id: 'item4', snapshot_hash: 'h'.repeat(64) }),
  };
  for (const c of db.prepare('PRAGMA table_info(ai_rail_proposals)').all() as any[]) {
    if (c.notnull && !c.pk && c.dflt_value == null && !(c.name in prop)) prop[c.name] = /INT|REAL|NUM/.test(c.type) ? 1 : 'synthetic';
  }
  const pk = Object.keys(prop);
  db.prepare(`INSERT INTO ai_rail_proposals (${pk.join(',')}) VALUES (${pk.map(() => '?').join(',')})`).run(...pk.map((k) => prop[k] as any));
  // A proposal for another claim is not offered on this one.
  const other = { ...prop, uid: 'prop2', payload_json: JSON.stringify({ claim_id: 'someone-else', item_id: 'item4', snapshot_hash: 'h'.repeat(64) }) };
  db.prepare(`INSERT INTO ai_rail_proposals (${pk.join(',')}) VALUES (${pk.map(() => '?').join(',')})`).run(...pk.map((k) => (other as any)[k]));
  const again = await call(db, OWNER, 'GET', `/narrative/${v}/claims`);
  const offered = again.body.claims.find((c: any) => c.figure === 'headcount').eadwyn;
  assert.deepEqual(offered.map((o: any) => [o.proposal_uid, o.item.uid]), [['prop1', 'item4']]);
  assert.equal(again.body.by_source.not_backed, 2);
  // The founder links item4 by hand: still Not backed (it holds no figure), so still no best source.
  // (D1263's link route re-reads the live record; these records are synthetic, so the row it writes is written here.)
  db.prepare("INSERT INTO raise_claim_evidence (project_id, claim_id, item_id, how, created_by, mutation_uid) SELECT ?, id, 4, 'founder', ?, 'mlink' FROM raise_claims WHERE uid = ?").run(PID, OWNER, team.uid);
  const linked = (await call(db, OWNER, 'GET', `/narrative/${v}/claims`)).body.claims.find((c: any) => c.figure === 'headcount');
  assert.equal(linked.state, 'not_backed');
  assert.deepEqual(linked.links.map((l: any) => [l.how, l.item.uid]), [['founder', 'item4']]);
  assert.equal(linked.best_source, null, 'a link that measures nothing is no best source');
  assert.deepEqual(linked.candidates, [], 'a linked record is no longer a candidate');
});

test('D912: a Backed claim offers no candidates; an older version is checked as itself', async () => {
  const db = fixture();
  // A value-less snapshot of the same metric: a candidate for a claim that needs one, never for a Backed one.
  pin(db, { id: 6, kind: 'kpi-snapshot', ref: '6:paying_accounts', label: 'typed', provider: null, value: null, unit: 'count' });
  const v1 = await version1(db, 'We serve 38 paying customers.');
  const r = await call(db, OWNER, 'GET', `/narrative/${v1}/claims`);
  const paying = r.body.claims.find((c: any) => c.figure === 'paying_customers');
  assert.equal(paying.state, 'backed');
  assert.deepEqual(paying.candidates, []);
  // Version 2 states another figure; asking for v1 checks v1, not the newest.
  const v2 = await call(db, OWNER, 'POST', '/narrative-versions', { investor_type: 'angel', start_from: 'blank' });
  await call(db, OWNER, 'PUT', `/narrative/${v2.body.version}/sections/traction`, { body: 'We serve 50 paying customers.' });
  db.prepare("DELETE FROM raise_claims WHERE surface = 'narrative'").run();
  const old = await call(db, OWNER, 'GET', `/narrative/${v1}/claims`);
  assert.deepEqual(old.body.claims.map((c: any) => [c.figure, c.stated_shown, c.state]), [['paying_customers', '38', 'backed']]);
  assert.deepEqual((db.prepare("SELECT surface_version FROM raise_claims WHERE surface = 'narrative'").all() as any[]).map((x) => x.surface_version), ['v1']);
});

test('D912: NAR8 — each figure against the deck and the metrics, as Check against chooses; one place only is Not compared', async () => {
  const db = fixture();
  const v = await version1(db, 'We serve 42 paying customers with 3 letters of intent.');
  const r = await call(db, OWNER, 'GET', `/narrative/${v}/check`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.against, ['deck', 'metrics']);
  assert.equal(r.body.deck.version, 6);
  const paying = r.body.rows.find((x: any) => x.figure === 'paying_customers');
  assert.equal(paying.narrative.shown, '42');
  assert.equal(paying.deck.shown, '40');
  assert.equal(paying.deck.source, 'Pitch deck v6 · card 1');
  assert.equal(paying.metrics.shown, '38');
  assert.equal(paying.result, 'mismatch');
  assert.deepEqual(paying.differs, ['deck', 'metrics']);
  assert.equal(r.body.rows.find((x: any) => x.figure === 'lois').result, 'not_compared', 'stated in the narrative only');
  assert.equal(r.body.compared, 1);
  assert.equal(r.body.checked_at, null);
  // Check against the metrics only: the deck is not read.
  db.prepare("UPDATE narrative_version_meta SET check_against_json = '[\"metrics\"]' WHERE project_id = ? AND version = ?").run(PID, v);
  const metricsOnly = await call(db, OWNER, 'GET', `/narrative/${v}/check`);
  const p2 = metricsOnly.body.rows.find((x: any) => x.figure === 'paying_customers');
  assert.equal(p2.deck, null);
  assert.deepEqual(p2.differs, ['metrics']);
  // The deck's first statement of a figure is the one compared.
  db.prepare("UPDATE narrative_version_meta SET check_against_json = NULL WHERE project_id = ? AND version = ?").run(PID, v);
  db.prepare("UPDATE pitch_decks SET slides = ? WHERE id = 21").run(JSON.stringify([{ title: 'A', fields: [{ key: 'b', value: 'We serve 40 paying customers.' }] }, { title: 'B', fields: [{ key: 'b', value: 'Now 41 paying customers.' }] }]));
  assert.equal((await call(db, OWNER, 'GET', `/narrative/${v}/check`)).body.rows.find((x: any) => x.figure === 'paying_customers').deck.source, 'Pitch deck v6 · card 1');
  // The deck agreeing within the check's tolerance is OK.
  db.prepare("UPDATE narrative_version_meta SET check_against_json = '[\"deck\"]' WHERE project_id = ? AND version = ?").run(PID, v);
  db.prepare("UPDATE pitch_decks SET slides = ? WHERE id = 21").run(JSON.stringify([{ title: 'T', fields: [{ key: 'b', value: 'We serve 42 paying customers.' }] }]));
  assert.equal((await call(db, OWNER, 'GET', `/narrative/${v}/check`)).body.rows.find((x: any) => x.figure === 'paying_customers').result, 'ok');
});

test('D912: Run the check stamps Last checked, writes the claims and logs one row with no figure', async () => {
  const db = fixture();
  const v = await version1(db);
  const before = (db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'narrative_checked'").get() as any).n;
  const r = await call(db, OWNER, 'POST', `/narrative/${v}/check`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.checked_at);
  assert.equal(r.body.claims.claims.length, 2);
  assert.ok(claimRow(db, 'paying_customers').checked_at);
  const rows = db.prepare("SELECT details FROM activity_logs WHERE action = 'narrative_checked'").all() as any[];
  assert.equal(rows.length, before + 1);
  assert.doesNotMatch(String(rows.at(-1).details), /\b42\b|\b38\b|\b40\b/);
  // Last checked is the run, even when nothing changed.
  db.prepare("UPDATE raise_claims SET checked_at = '2000-01-01 00:00:00' WHERE surface = 'narrative'").run();
  await call(db, OWNER, 'POST', `/narrative/${v}/check`);
  assert.notEqual(claimRow(db, 'paying_customers').checked_at, '2000-01-01 00:00:00');
  const read = await call(db, OWNER, 'GET', `/narrative/${v}/check`);
  assert.equal(read.body.checked_at, claimRow(db, 'paying_customers').checked_at);
});

test('D912: Use the record\'s figure replaces it in its section, through the section\'s own save, only for the figure shown', async () => {
  const db = fixture();
  const v = await version1(db);
  const claims = (await call(db, OWNER, 'GET', `/narrative/${v}/claims`)).body.claims;
  const uid = claims.find((c: any) => c.figure === 'paying_customers').uid;
  const lois = claims.find((c: any) => c.figure === 'lois').uid;
  assert.equal((await call(db, OWNER, 'POST', `/narrative/${v}/claims/${uid}/use-record`, { record_value: 37 })).body.code, 'record_changed');
  assert.equal((await call(db, OWNER, 'POST', `/narrative/${v}/claims/${uid}/use-record`, {})).status, 400);
  assert.equal((await call(db, OWNER, 'POST', `/narrative/${v}/claims/nope/use-record`, { record_value: 38 })).status, 404);
  const words = () => (db.prepare("SELECT value FROM spinout_deck_overrides WHERE project_id = ? AND version = ? AND field_key = 'traction.takeaway'").get(PID, v) as any).value;
  assert.equal(words(), 'We serve 42 paying customers with 3 letters of intent.', 'a refused swap writes nothing');
  // An LOI count has no single record figure to write in: the record is a count of pinned records, and it differs.
  const loiSwap = await call(db, OWNER, 'POST', `/narrative/${v}/claims/${lois}/use-record`, { record_value: 1 });
  assert.equal(loiSwap.status, 200, 'a count is swapped to the count the check read');
  const ok = await call(db, OWNER, 'POST', `/narrative/${v}/claims/${uid}/use-record`, { record_value: 38 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(words(), 'We serve 38 paying customers with 1 letters of intent.');
  assert.equal(claimRow(db, 'paying_customers').state, 'backed', 'the claim is checked again after the save');
  const saves = db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'narrative_section_saved'").get() as any;
  assert.equal(saves.n, 3, 'one save row per swap, plus the first save');
  // A figure that now agrees is not swapped, though it has a record.
  const again = await call(db, OWNER, 'POST', `/narrative/${v}/claims/${uid}/use-record`, { record_value: 38 });
  assert.equal(again.body.code, 'claim_not_mismatch');
});

test('D912: who — an admin with a reason reads states only; no reason, another founder and nobody reach nothing; only the founder checks', async () => {
  const db = fixture();
  const v = await version1(db);
  await call(db, OWNER, 'POST', `/narrative/${v}/check`);
  const noReason = await call(db, ADMIN, 'GET', `/narrative/${v}/claims`);
  assert.equal(noReason.status, 403);
  assert.equal(noReason.body.code, 'read_reason_required');
  db.prepare("INSERT INTO narrative_read_reasons (project_id, reader_user_id, reader_kind, reason, expires_at) VALUES (?, ?, 'admin', 'Synthetic support request.', datetime('now', '+1 day'))").run(PID, ADMIN);
  const admin = await call(db, ADMIN, 'GET', `/narrative/${v}/claims`);
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.equal(admin.body.can_check, false);
  const row = admin.body.claims.find((c: any) => c.figure === 'paying_customers');
  assert.equal(row.state, 'mismatch');
  for (const k of ['stated_value', 'stated_shown', 'record', 'candidates', 'eadwyn', 'note', 'links']) assert.equal(k in row, false, `an admin reads no ${k}`);
  assert.doesNotMatch(JSON.stringify(admin.body), /:\s*"?(42|38)"?[,}]/, 'no figure anywhere');
  assert.equal((await call(db, ADMIN, 'POST', `/narrative/${v}/check`)).status, 403, 'an admin reads and changes nothing');
  // A support session on the founder's account reads, and never checks.
  const support = await call(db, OWNER, 'POST', `/narrative/${v}/check`, undefined, PID, true);
  assert.equal(support.status, 403, JSON.stringify(support.body));
  assert.equal(support.body.code, 'founder_only');
  const supportRead = await call(db, OWNER, 'GET', `/narrative/${v}/claims`, undefined, PID, true);
  assert.equal(supportRead.body.can_check, false);
  assert.equal((await call(db, OTHER, 'GET', `/narrative/${v}/claims`)).status, 403);
  assert.equal((await call(db, null, 'GET', `/narrative/${v}/claims`)).status, 401);
  assert.equal((await call(db, OWNER, 'GET', '/narrative/99/claims')).status, 404);
  assert.equal((await call(db, OWNER, 'GET', '/narrative/0/claims')).status, 409);
});

test('D912: every figure has the kinds that could back it, and every narrative field maps to its section', () => {
  assert.deepEqual(Object.keys(FIGURE_KINDS).sort(), [...FIGURES].sort());
  assert.deepEqual(sectionOfField('traction.takeaway'), { key: 'traction', label: 'Traction' });
  assert.deepEqual(sectionOfField('why_now'), { key: 'why_now', label: 'Why now' });
  assert.equal(sectionOfField('cover.thesis'), null);
  assert.equal(couldBack('headcount', { kind: 'kpi-snapshot', source_ref: '9:headcount' }), true);
  assert.equal(couldBack('headcount', { kind: 'kpi-snapshot', source_ref: '5:paying_accounts' }), false, 'another metric of a snapshot');
  assert.equal(couldBack('lois', { kind: 'loi-file', source_ref: '3' }), true);
  assert.equal(couldBack('raise', { kind: 'kpi-snapshot', source_ref: '1:mrr' }), false, 'nothing records the raise');
});
