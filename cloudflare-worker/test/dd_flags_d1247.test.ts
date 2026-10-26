/**
 * D1247 (#3262, part 3 of #2385) — a Due Diligence flag can be raised by hand,
 * given an owner, worked through a state and closed with a resolution; each
 * change is in dd_audit_log and the flag's history reads it back.
 *
 * Harness: D1246's — the real router over SQLite built from the production
 * baseline plus migrations 339, 620, 623 and 621, a signed JWT per caller, and
 * the app's error mapping.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dd_flags_d1247.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import dd from '../src/routes/dd.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { renderReportHtml, renderReportPdf, flagStateLine } from '../src/services/dueDiligence.ts';

const SECRET = 'd1247-unit-test-secret-0123456789-abcdef';
const ADMIN = 1, LEAD = 2, REVIEWER = 3, OTHER = 4, ADVISOR = 5, OBSERVER = 6;
const CASE = 'case-d1247';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql').replace(/--[^\n]*/g, '');
const TABLES = ['users', 'user_sessions', 'projects', 'deals', 'user_company_links', 'ic_decisions', 'ic_votes',
  'dd_cases', 'dd_sections', 'dd_findings', 'dd_external_sources', 'dd_attachments', 'dd_reviewers', 'dd_reports',
  'dd_audit_log', 'dd_checklist_items', 'dd_requests', 'notifications_inbox'];

function world(opts: { before621?: (db: any) => void } = {}) {
  const { DB, db } = makeD1('');
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  db.exec(read('../sql/migrations/339_dd_section_signoff.sql'));
  db.exec(read('../sql/migrations/620_dd_case_lifecycle.sql'));
  db.exec(read('../sql/migrations/302_push_subscriptions.sql'));
  db.exec(read('../sql/migrations/623_dd_team_templates.sql'));
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, role, name] of [[ADMIN, 'admin', 'Ada Admin'], [LEAD, 'partner', 'Lee Lead'], [REVIEWER, 'partner', 'Rae Reviewer'],
    [OTHER, 'partner', 'Otto Other'], [ADVISOR, 'advisor', 'Avi Advisor'], [OBSERVER, 'investor', 'Obi Observer']] as const) {
    u.run(id, `synthetic${id}@example.test`, name, role);
  }
  db.exec(`INSERT INTO projects (id, name) VALUES (10, 'Company Alpha');`);
  db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id, status)
              VALUES (?, 'project', 10, 'Company Alpha', ?, ?, 'in_review')`).run(CASE, LEAD, LEAD);
  db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id, status)
              VALUES ('case-other', 'project', 10, 'Company Alpha', ?, ?, 'in_review')`).run(OTHER, OTHER);
  // Sections 1 and 2 are this case's; section 3 is the other case's.
  db.exec(`INSERT INTO dd_sections (id, case_id, section_key, title, weight, blocking) VALUES (1, 1, 'corporate_legal', 'Corporate & Legal Structure', 1, 1);
           INSERT INTO dd_sections (id, case_id, section_key, title, weight, blocking) VALUES (2, 1, 'market_traction', 'Market & Traction', 1, 0);
           INSERT INTO dd_sections (id, case_id, section_key, title, weight, blocking) VALUES (3, 2, 'market_traction', 'Market & Traction', 1, 0);`);
  db.prepare(`INSERT INTO dd_reviewers (case_id, section_id, user_id) VALUES (1, 2, ?)`).run(REVIEWER);
  db.prepare(`INSERT INTO dd_reviewers (case_id, section_id, user_id, role) VALUES (1, 2, ?, 'observer')`).run(OBSERVER);
  db.exec(`INSERT INTO dd_checklist_items (id, case_id, section_id, item_key, title, status, severity) VALUES
             (1, 1, 1, 'corporate_legal.cap_table_clean', 'Cap table is clean', 'pending', NULL),
             (2, 1, 2, 'market_traction.revenue_matches', 'Revenue matches the bank', 'fail', NULL),
             (3, 1, 1, 'corporate_legal.ip_assigned', 'IP is assigned', 'flag', 'high');`);
  opts.before621?.(db);
  db.exec(read('../sql/migrations/621_dd_flag_workflow.sql'));
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  return { db, env };
}

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  const status = (AUTH_ERROR_STATUSES as any)[msg] ?? (msg.startsWith('Forbidden') ? 403 : 500);
  if (status === 500) console.error('[test] unhandled:', err);
  return c.json({ detail: msg, code: msg }, status);
});
app.route('/api/dd', dd);

async function call(w: any, who: number, method: string, path: string, body?: unknown) {
  const role = w.db.prepare('SELECT role FROM users WHERE id = ?').get(who).role;
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/dd${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const raise = (w: any, who: number, flag: Record<string, unknown>) => call(w, who, 'POST', `/cases/${CASE}/findings`, flag);
const change = (w: any, who: number, id: number, changes: Record<string, unknown>) => call(w, who, 'PATCH', `/cases/${CASE}/findings/${id}`, changes);
const row = (w: any, id: number) => w.db.prepare('SELECT * FROM dd_findings WHERE id = ?').get(id) as any;
const score = (w: any) => (w.db.prepare('SELECT risk_score FROM dd_cases WHERE id = 1').get() as any).risk_score;
const FLAG = { section_id: 2, severity: 'critical', title: 'Revenue restated twice', detail: 'Synthetic detail for the test.' };

/* ------------------------------------------------------------------ */

test('migration 621: every finding starts open; one already resolved reads closed', () => {
  const w = world({
    before621: (db) => db.exec(`INSERT INTO dd_findings (case_id, section_id, source_kind, severity, title, resolved_at) VALUES
      (1, 1, 'opencorporates', 'high', 'Open from a connector', NULL),
      (1, 1, 'opencorporates', 'low', 'Resolved before 621', '2026-10-01 10:00:00');`),
  });
  const states = w.db.prepare('SELECT title, state FROM dd_findings ORDER BY id').all().map((r: any) => r.state);
  // Mutation checked: drop the backfill UPDATE → ['open', 'open'].
  assert.deepEqual(states, ['open', 'closed']);
  // A connector's insert, which names none of the new columns, still starts open.
  w.db.exec(`INSERT INTO dd_findings (case_id, section_id, source_kind, severity, title) VALUES (1, 1, 'sanctions', 'info', 'New')`);
  assert.equal(row(w, 3).state, 'open');
  assert.throws(() => w.db.exec(`UPDATE dd_findings SET state = 'resolved' WHERE id = 3`), /CHECK/);
});

test('a flag is raised by hand: stored, its detail ciphertext, audited, scored', async () => {
  const w = world();
  const before = score(w);
  const r = await raise(w, LEAD, { ...FLAG, owner_user_id: REVIEWER, checklist_item_id: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const f = row(w, r.body.finding.id);
  assert.deepEqual([f.source_kind, f.raised_by_user_id, f.owner_user_id, f.checklist_item_id, f.state, f.section_id],
    ['manual', LEAD, REVIEWER, 2, 'open', 2]);
  assert.ok(f.detail_enc && !String(f.detail_enc).includes('Synthetic detail'), 'the detail is ciphertext at rest');
  assert.equal(r.body.finding.source, 'raised');
  assert.equal(r.body.finding.owner_user_id, REVIEWER);
  // Mutation checked: skip the audit → no row.
  const a = w.db.prepare(`SELECT action, target_type, target_id, actor_user_id FROM dd_audit_log WHERE action = 'finding_raised'`).get() as any;
  assert.deepEqual([a.target_type, a.target_id, a.actor_user_id], ['dd_finding', f.id, LEAD]);
  // Mutation checked: skip the recompute → the score is unchanged.
  assert.notEqual(score(w), before, 'a critical flag moves the score');
  assert.equal(r.body.band, (w.db.prepare('SELECT risk_band FROM dd_cases WHERE id = 1').get() as any).risk_band);
});

test('a section reviewer raises and works flags only in their own section', async () => {
  const w = world();
  assert.equal((await raise(w, REVIEWER, FLAG)).status, 201, 'their section');
  // Mutation checked: let any reviewer write any section → 201.
  const other = await raise(w, REVIEWER, { ...FLAG, section_id: 1 });
  assert.deepEqual([other.status, other.body.code], [403, 'not_your_section']);
  const obs = await raise(w, OBSERVER, FLAG);
  assert.deepEqual([obs.status, obs.body.code], [403, 'observer_reads_only']);
  assert.equal((await raise(w, OTHER, FLAG)).status, 403, 'not on the case');
  assert.equal((await raise(w, ADVISOR, FLAG)).status, 403, 'an advisor never opens a case');
  assert.equal((await raise(w, ADMIN, { ...FLAG, section_id: 1 })).status, 201, 'admin raises anywhere');
  assert.equal((await raise(w, LEAD, { ...FLAG, section_id: 1 })).status, 201, 'the lead raises anywhere');
  // Working a flag follows the same rule.
  const inSection1 = Number(w.db.prepare(`SELECT id FROM dd_findings WHERE section_id = 1 LIMIT 1`).get().id);
  const inSection2 = Number(w.db.prepare(`SELECT id FROM dd_findings WHERE section_id = 2 LIMIT 1`).get().id);
  assert.equal((await change(w, REVIEWER, inSection1, { state: 'in_progress' })).status, 403);
  assert.equal((await change(w, OBSERVER, inSection2, { state: 'in_progress' })).status, 403);
  assert.equal((await change(w, REVIEWER, inSection2, { state: 'in_progress' })).status, 200);
});

test('a raise is refused, with its code, for anything it cannot stand behind', async () => {
  const w = world();
  const code = async (flag: Record<string, unknown>) => { const r = await raise(w, LEAD, flag); return [r.status, r.body.code]; };
  assert.deepEqual(await code({ ...FLAG, section_id: undefined }), [400, 'section_required']);
  assert.deepEqual(await code({ ...FLAG, section_id: 3 }), [404, 'section_not_on_case'], 'another case\'s section');
  assert.deepEqual(await code({ ...FLAG, severity: 'severe' }), [400, 'invalid_severity']);
  assert.deepEqual(await code({ ...FLAG, title: '   ' }), [400, 'invalid_title']);
  assert.deepEqual(await code({ ...FLAG, title: 'x'.repeat(201) }), [400, 'invalid_title']);
  assert.deepEqual(await code({ ...FLAG, detail: 'x'.repeat(4001) }), [400, 'invalid_detail']);
  assert.deepEqual(await code({ ...FLAG, owner_user_id: 999 }), [404, 'owner_not_found']);
  assert.deepEqual(await code({ ...FLAG, checklist_item_id: 1 }), [400, 'item_other_section'], 'item 1 is in section 1');
  assert.deepEqual(await code({ ...FLAG, checklist_item_id: 99 }), [404, 'item_not_on_case']);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM dd_findings').get().n, 0, 'nothing was written');
});

test('a closed flag leaves the score but stays on the case and in the report; reopening puts it back', async () => {
  const w = world();
  assert.equal((await call(w, LEAD, 'POST', `/cases/${CASE}/recompute`)).status, 200);
  const open = score(w);
  assert.notEqual(open, null);
  const id = (await raise(w, LEAD, FLAG)).body.finding.id;
  const flagged = score(w);
  assert.notEqual(flagged, open);
  // Mutation checked: drop the resolution rule → 200.
  const bare = await change(w, LEAD, id, { state: 'closed' });
  assert.deepEqual([bare.status, bare.body.code], [400, 'resolution_required']);
  assert.equal((await change(w, LEAD, id, { state: 'accepted' })).body.code, 'resolution_required', 'accepting needs one too');
  assert.equal(row(w, id).state, 'open', 'nothing changed');

  const closed = await change(w, LEAD, id, { state: 'closed', resolution: 'The restatement was an audit fix.' });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const f = row(w, id);
  assert.equal(f.state, 'closed');
  assert.equal(f.resolved_by_user_id, LEAD);
  assert.match(String(f.resolved_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'a SQL stamp, like every other');
  assert.ok(f.resolution_enc && !String(f.resolution_enc).includes('audit fix'), 'the resolution is ciphertext at rest');
  // Mutation checked: never set resolved_at → the score keeps the flag.
  assert.equal(score(w), open, 'a closed flag leaves the score');

  const read = (await call(w, LEAD, 'GET', `/cases/${CASE}`)).body;
  const onCase = read.findings.find((x: any) => x.id === id);
  assert.deepEqual([onCase.state, onCase.resolution, onCase.resolved_by_user_id], ['closed', 'The restatement was an audit fix.', LEAD]);
  // The report keeps it, marked closed with its resolution.
  const html = renderReportHtml({ uid: CASE, subject_label: 'Company Alpha', subject_type: 'project', risk_score: null, risk_band: null, status: 'in_review', created_at: '2026-10-26', notes: null },
    [{ section_key: 'market_traction', title: 'Market & Traction', weight: 1, status: 'in_progress', verdict: null, reviewer_notes: null,
      signed_off_by_name: null, completed_at: null,
      findings: [{ severity: 'critical', title: 'Revenue restated twice', detail: null, evidence_url: null, state: 'closed', resolution: 'The restatement was an audit fix.' }] } as any]);
  assert.match(html, /Revenue restated twice/);
  // Mutation checked: drop the state line from the render → no "Closed".
  assert.match(html, /Closed — The restatement was an audit fix\./);
  // The PDF draws the same line (pdf-lib writes text as hex, in deflated streams).
  const pdfBytes = Buffer.from(await renderReportPdf({ uid: CASE, subject_label: 'Company Alpha', subject_type: 'project', risk_score: null, risk_band: null, status: 'in_review', created_at: '2026-10-26', notes: null },
    [{ section_key: 'market_traction', title: 'Market & Traction', weight: 1, status: 'in_progress', verdict: null, reviewer_notes: null,
      signed_off_by_name: null, completed_at: null,
      findings: [{ severity: 'critical', title: 'Revenue restated twice', detail: null, evidence_url: null, state: 'closed', resolution: 'Audit fix.' }] } as any]));
  const raw = pdfBytes.toString('latin1');
  let pdf = '';
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    try { pdf += inflateSync(pdfBytes.subarray(start, raw.indexOf('endstream', start))).toString('latin1'); } catch { /* not deflated */ }
  }
  // Mutation checked: drop the PDF's state line → no hex for it.
  assert.ok(pdf.toUpperCase().includes(Buffer.from('Closed', 'latin1').toString('hex').toUpperCase()), 'the PDF says Closed');
  assert.equal(flagStateLine({ state: 'accepted' }), 'Accepted');
  assert.equal(flagStateLine({ state: null, resolution: 'x' }), null, 'a report from before 621 draws no state');
  const route = read_route();
  assert.match(route, /state: f\.state \?\? null,\s*\n\s*resolution: await decField\(c\.env, 'dd_findings', 'resolution'/, 'the report route passes both on');

  // Accepted is a risk taken on, still scored.
  const reopened = await change(w, LEAD, id, { state: 'accepted' });
  assert.equal(reopened.status, 200, 'the stored resolution satisfies accept');
  assert.equal(row(w, id).resolved_at, null, 'leaving closed clears the stamp');
  assert.equal(row(w, id).resolved_by_user_id, null);
  // Mutation checked: keep resolved_at when leaving closed → the score stays open.
  assert.equal(score(w), flagged, 'an accepted flag counts again');
});

function read_route() { return read('../src/routes/dd.ts'); }

test('a change is refused for a bad state, owner or resolution, or an empty body', async () => {
  const w = world();
  const id = (await raise(w, LEAD, FLAG)).body.finding.id;
  const code = async (body: Record<string, unknown>) => { const r = await change(w, LEAD, id, body); return [r.status, r.body.code]; };
  assert.deepEqual(await code({}), [400, 'nothing_to_change']);
  assert.deepEqual(await code({ state: 'resolved' }), [400, 'invalid_state']);
  assert.deepEqual(await code({ owner_user_id: 'someone' }), [400, 'invalid_owner']);
  assert.deepEqual(await code({ owner_user_id: 999 }), [404, 'owner_not_found']);
  assert.deepEqual(await code({ resolution: 'x'.repeat(4001) }), [400, 'invalid_resolution']);
  assert.deepEqual((await call(w, LEAD, 'PATCH', `/cases/case-other/findings/${id}`, { state: 'open' })).status, 403, 'not the other case\'s lead');
  // Another case's lead cannot reach this flag through their own case.
  const viaOther = await call(w, OTHER, 'PATCH', `/cases/case-other/findings/${id}`, { state: 'in_progress' });
  assert.deepEqual([viaOther.status, viaOther.body.code], [404, 'finding_not_found']);
  // Owner can be named and cleared.
  assert.equal((await change(w, LEAD, id, { owner_user_id: REVIEWER })).body.finding.owner_user_id, REVIEWER);
  assert.equal((await change(w, LEAD, id, { owner_user_id: null })).body.finding.owner_user_id, null);
});

test('a connector finding is worked the same way; a case-wide one only by the lead', async () => {
  const w = world();
  w.db.exec(`INSERT INTO dd_findings (id, case_id, section_id, source_kind, severity, title) VALUES
    (40, 1, 2, 'opencorporates', 'high', 'Registry mismatch'), (41, 1, NULL, 'sanctions', 'high', 'Case-wide hit');`);
  const r = await change(w, REVIEWER, 40, { state: 'condition_to_close', owner_user_id: REVIEWER });
  assert.equal(r.status, 200);
  assert.equal(r.body.finding.source, 'connector');
  // Mutation checked: let a reviewer work a flag with no section → 200.
  const wide = await change(w, REVIEWER, 41, { state: 'in_progress' });
  assert.deepEqual([wide.status, wide.body.code], [403, 'not_your_section']);
  assert.equal((await change(w, LEAD, 41, { state: 'in_progress' })).status, 200);
});

test('history lists each change, in order, to those who can read the flag', async () => {
  const w = world();
  const id = (await raise(w, REVIEWER, FLAG)).body.finding.id;
  await change(w, LEAD, id, { owner_user_id: REVIEWER, state: 'in_progress' });
  await change(w, REVIEWER, id, { state: 'closed', resolution: 'Explained by the auditor.' });
  await change(w, LEAD, id, { state: 'open' });
  // Another flag's change must not appear in this one's history.
  const other = (await raise(w, LEAD, { ...FLAG, section_id: 1 })).body.finding.id;
  await change(w, LEAD, other, { state: 'in_progress' });

  const h = await call(w, REVIEWER, 'GET', `/cases/${CASE}/findings/${id}/history`);
  assert.equal(h.status, 200, JSON.stringify(h.body));
  // Mutation checked: drop the target filter → the other flag's rows appear.
  assert.deepEqual(h.body.items.map((i: any) => i.action), ['finding_raised', 'finding_updated', 'finding_closed', 'finding_reopened']);
  assert.deepEqual(h.body.items.map((i: any) => i.actor_name), ['Rae Reviewer', 'Lee Lead', 'Rae Reviewer', 'Lee Lead']);
  assert.deepEqual(h.body.items[1].details, { from_state: 'open', to_state: 'in_progress', owner_from: null, owner_to: REVIEWER, resolution_changed: false });
  assert.equal(h.body.items[2].details.resolution_changed, true);
  assert.ok(!JSON.stringify(h.body).includes('Explained by the auditor'), 'the history never carries the resolution text');
  assert.ok(!JSON.stringify(h.body).includes('@example.test'), 'nor an email address');

  assert.equal((await call(w, OBSERVER, 'GET', `/cases/${CASE}/findings/${id}/history`)).status, 200, 'an observer reads');
  // Mutation checked: drop the section check → 200 for a reviewer of another section.
  assert.equal((await call(w, REVIEWER, 'GET', `/cases/${CASE}/findings/${other}/history`)).status, 403);
  assert.equal((await call(w, OTHER, 'GET', `/cases/${CASE}/findings/${id}/history`)).status, 403);
  assert.equal((await call(w, ADVISOR, 'GET', `/cases/${CASE}/findings/${id}/history`)).status, 403);
  assert.equal((await call(w, LEAD, 'GET', `/cases/${CASE}/findings/999/history`)).status, 404);
  // An actor whose account is gone keeps the row.
  w.db.prepare('DELETE FROM users WHERE id = ?').run(REVIEWER);
  const gone = await call(w, LEAD, 'GET', `/cases/${CASE}/findings/${id}/history`);
  assert.deepEqual(gone.body.items.map((i: any) => i.actor_name), [null, 'Lee Lead', null, 'Lee Lead']);
});

test('the case read lists flagged and failed checklist items as flags with source Checklist', async () => {
  const w = world();
  await raise(w, LEAD, FLAG);
  const all = (await call(w, LEAD, 'GET', `/cases/${CASE}`)).body;
  const fromChecklist = all.flags.filter((f: any) => f.source === 'checklist');
  // Mutation checked: keep only 'flag' → item 2 (a fail) is missing.
  assert.deepEqual(fromChecklist.map((f: any) => f.checklist_item_id).sort(), [2, 3]);
  const failed = fromChecklist.find((f: any) => f.checklist_item_id === 2);
  assert.deepEqual([failed.severity, failed.severity_recorded, failed.item_status, failed.title], ['medium', false, 'fail', 'Revenue matches the bank']);
  const flagged = fromChecklist.find((f: any) => f.checklist_item_id === 3);
  assert.deepEqual([flagged.severity, flagged.severity_recorded], ['high', true]);
  assert.equal(all.flags.filter((f: any) => f.kind === 'finding').length, 1);
  const raised = all.findings[0];
  for (const k of ['state', 'owner_user_id', 'raised_by_user_id', 'checklist_item_id', 'resolution', 'source']) assert.ok(k in raised, k);
  assert.equal(raised.detail, FLAG.detail, 'the raiser\'s detail decrypts on the read');
  // A section reviewer sees only their section's flags.
  const scoped = (await call(w, REVIEWER, 'GET', `/cases/${CASE}`)).body;
  assert.deepEqual([...new Set(scoped.flags.map((f: any) => f.section_id))], [2]);
});

test('two writers never both win: a flag changed under a change is 409', async () => {
  const w = world();
  const id = (await raise(w, LEAD, FLAG)).body.finding.id;
  // Someone else moves the flag between this change's read and its write.
  const real = w.env.DB;
  w.env.DB = { ...real, prepare: (q: string) => {
    if (q.includes('UPDATE dd_findings SET state = ?')) w.db.prepare(`UPDATE dd_findings SET state = 'in_progress' WHERE id = ?`).run(id);
    return real.prepare(q);
  } };
  // Mutation checked: drop `AND state = ?` from the update → 200, the other writer's move overwritten.
  const r = await change(w, LEAD, id, { state: 'closed', resolution: 'Raced.' });
  assert.deepEqual([r.status, r.body.code], [409, 'finding_changed']);
  w.env.DB = real;
  assert.equal(row(w, id).state, 'in_progress', 'the other writer\'s change stands');
  assert.equal(w.db.prepare(`SELECT COUNT(*) AS n FROM dd_audit_log WHERE action = 'finding_closed'`).get().n, 0);
});
