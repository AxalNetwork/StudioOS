/**
 * D6296 (#6296) — the generated diligence report carries the case: each
 * section's checklist with status and evidence count, the flags with state and
 * resolution, the verdicts with who signed off and when, the decision and its
 * reason, the requests with their dates, and the memo's four parts for a
 * caller who may read the memo (`memo_read`). The founder-facing share gains
 * none of it.
 *
 * Harness: D1246's — the real router over SQLite built from the production
 * baseline plus migrations 339, 620, 623, 621 and 622, a signed JWT with a
 * fresh TOTP session per caller, and the app's error mapping. A stub BROWSER
 * binding hands back the HTML the route renders; the PDF test leaves it out so
 * pdf-lib draws the stored report.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dd_report_contents_6296.test.ts
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
import { decryptBytes } from '../src/services/cryptoBox.ts';
import { NOT_RECORDED, NOT_IN_THIS_COPY } from '../src/services/dueDiligence.ts';

const SECRET = 'd6296-unit-test-secret-0123456789-abcdef';
const ADMIN = 1, LEAD = 2, REVIEWER = 3, INVESTOR = 4, FOUNDER = 5;
const CASE = 'case-d6296';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql').replace(/--[^\n]*/g, '');
const TABLES = ['users', 'user_sessions', 'projects', 'founders', 'deals', 'user_company_links', 'ic_decisions', 'ic_votes',
  'dd_cases', 'dd_sections', 'dd_findings', 'dd_external_sources', 'dd_attachments', 'dd_reviewers', 'dd_reports',
  'dd_audit_log', 'dd_checklist_items', 'dd_requests', 'notifications_inbox'];

const MEMO = {
  summary: 'Synthetic summary of the case.',
  verified: 'Synthetic verified: the cap table.',
  on_trust: 'Synthetic trust: the pipeline figures.',
  conditions: 'Synthetic condition: assign the IP.',
};
const REASON = 'Synthetic reason: the IP assignment is a condition.';

/** A case with sections, a checklist with evidence, flags (one case-wide) and requests. */
function world(opts: { browser?: boolean } = { browser: true }) {
  const { DB, db } = makeD1('');
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  for (const m of ['339_dd_section_signoff', '620_dd_case_lifecycle', '302_push_subscriptions', '623_dd_team_templates', '621_dd_flag_workflow', '622_dd_documents_due_reminders']) {
    db.exec(read(`../sql/migrations/${m}.sql`));
  }
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, role, name] of [[ADMIN, 'admin', 'Ada Admin'], [LEAD, 'partner', 'Lee Lead'], [REVIEWER, 'partner', 'Rae Reviewer'],
    [INVESTOR, 'investor', 'Ivy Investor'], [FOUNDER, 'founder', 'Fay Founder']] as const) {
    u.run(id, `synthetic${id}@example.test`, name, role);
    db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))`).run(id, `fresh-${id}`);
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (1, 'Fay Founder', 'synthetic${FOUNDER}@example.test');
           INSERT INTO projects (id, name, founder_id) VALUES (10, 'Company Alpha', 1);`);
  db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id, status, risk_score, risk_band)
              VALUES (?, 'project', 10, 'Company Alpha', ?, ?, 'in_review', 0.7, 'yellow')`).run(CASE, LEAD, LEAD);
  db.prepare(`INSERT INTO dd_sections (id, case_id, section_key, title, weight, blocking, status, verdict, signed_off_by, completed_at)
              VALUES (1, 1, 'corporate_legal', 'Corporate & Legal Structure', 1.5, 1, 'completed', 'warn', ?, '2026-11-02 09:00:00')`).run(LEAD);
  db.exec(`INSERT INTO dd_sections (id, case_id, section_key, title, weight, blocking) VALUES (2, 1, 'market_traction', 'Market & Traction', 1, 0);`);
  // REVIEWER (a partner) reviews section 2; INVESTOR reviews section 1.
  db.prepare(`INSERT INTO dd_reviewers (case_id, section_id, user_id) VALUES (1, 2, ?)`).run(REVIEWER);
  db.prepare(`INSERT INTO dd_reviewers (case_id, section_id, user_id) VALUES (1, 1, ?)`).run(INVESTOR);
  db.exec(`INSERT INTO dd_checklist_items (id, case_id, section_id, item_key, title, status, severity) VALUES
             (1, 1, 1, 'corporate_legal.cap_table_clean', 'Cap table is clean', 'pass', NULL),
             (2, 1, 1, 'corporate_legal.ip_assigned', 'IP is assigned', 'flag', 'high'),
             (3, 1, 2, 'market_traction.revenue_matches', 'Revenue matches the bank', 'pending', NULL);
           INSERT INTO dd_item_evidence (uid, case_id, item_id, kind, url) VALUES
             ('e1', 1, 1, 'link', 'https://example.test/a'), ('e2', 1, 1, 'link', 'https://example.test/b'),
             ('e3', 1, 3, 'link', 'https://example.test/c');
           INSERT INTO dd_findings (id, case_id, section_id, source_kind, severity, title, state) VALUES
             (1, 1, 1, 'manual', 'high', 'Synthetic section flag', 'condition_to_close'),
             (2, 1, NULL, 'manual', 'medium', 'Synthetic case-wide flag', 'open');
           INSERT INTO dd_requests (id, case_id, section_id, title, state, created_at, due_date, responded_at) VALUES
             (1, 1, 1, 'Send the synthetic cap table', 'received', '2026-11-01 10:00:00', '2026-11-20', '2026-11-03 12:00:00');
           INSERT INTO dd_requests (id, case_id, section_id, title, state, created_at, withdrawn_at) VALUES
             (2, 1, NULL, 'Send synthetic bank statements', 'requested', '2026-11-01 11:00:00', '2026-11-04 08:00:00');`);
  const files = new Map<string, Uint8Array>();
  const rendered: string[] = [];
  const env: any = {
    DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    FILES: { put: async (k: string, v: any) => { files.set(k, v); }, get: async (k: string) => files.get(k) ? { arrayBuffer: async () => files.get(k) } : null },
  };
  if (opts.browser) {
    env.BROWSER = { fetch: async (_u: string, init: any) => { rendered.push(JSON.parse(init.body).html); return new Response(new Uint8Array([37, 80, 68, 70])); } };
  }
  return { db, env, files, rendered };
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
  const token = await new SignJWT({ user_id: who, role, jti: `fresh-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/dd${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Record the decision and the memo through their own routes, so both are ciphertext at rest. */
async function decideAndWriteMemo(w: any) {
  const d = await call(w, LEAD, 'POST', `/cases/${CASE}/decision`, { decision: 'proceed_with_conditions', reason: REASON });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const m = await call(w, LEAD, 'PUT', `/cases/${CASE}/memo`, MEMO);
  assert.equal(m.status, 200, JSON.stringify(m.body));
}

async function generate(w: any, who: number): Promise<{ status: number; body: any; html: string }> {
  const r = await call(w, who, 'POST', `/cases/${CASE}/report`, {});
  return { ...r, html: w.rendered.at(-1) ?? '' };
}

/** Text drawn in a pdf-lib PDF: its streams inflated, the hex upper-cased. */
function pdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const raw = buf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    try { out += inflateSync(buf.subarray(start, raw.indexOf('endstream', start))).toString('latin1'); } catch { /* not deflated */ }
  }
  return out.toUpperCase();
}
const hex = (s: string) => Buffer.from(s, 'latin1').toString('hex').toUpperCase();

/* ------------------------------------------------------------------ */

test('the lead\'s report carries the decision, the memo, the checklist, the flags, the sign-offs and the requests', async () => {
  const w = world();
  await decideAndWriteMemo(w);
  const r = await generate(w, LEAD);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const html = r.html;
  // The decision and its reason, by whom.
  // Mutation checked: draw the decision without its words → no "Proceed with conditions".
  assert.match(html, /Proceed with conditions · recorded by Lee Lead · \d{4}-\d{2}-\d{2}/);
  assert.ok(html.includes(REASON), 'the reason');
  // The memo's four parts, under the Sign-off tab's labels.
  // Mutation checked: read the memo for no one (dealTeam false) → every part "Not in this copy".
  for (const [k, v] of Object.entries(MEMO)) assert.ok(html.includes(v), `memo ${k}`);
  for (const label of ['Summary', 'What we verified', 'What we take on trust', 'Conditions to close']) assert.ok(html.includes(label), label);
  // The checklist by section, with status and evidence count.
  // Mutation checked: count evidence for no item → "No evidence" on the cap table.
  assert.match(html, /Cap table is clean<\/td><td[^>]*>Pass<\/td><td[^>]*>2 pieces of evidence/);
  assert.match(html, /IP is assigned<\/td><td[^>]*>Flag \(high\)<\/td><td[^>]*>No evidence/);
  assert.match(html, /Revenue matches the bank<\/td><td[^>]*>Pending<\/td><td[^>]*>1 piece of evidence/);
  // Each item sits under its own section.
  assert.ok(html.indexOf('Cap table is clean') < html.indexOf('Market &amp; Traction</h2>'), 'section 1 item before section 2');
  assert.ok(html.indexOf('Revenue matches the bank') > html.indexOf('Market &amp; Traction</h2>'), 'section 2 item after its heading');
  assert.equal(html.split('Cap table is clean').length - 1, 1);
  // The sign-off (D466) and the flags with their state (D1247), kept.
  assert.match(html, /Signed off by Lee Lead · 2026-11-02/);
  assert.match(html, /Synthetic section flag[\s\S]*?Condition to close/);
  // A flag raised against no section, which the report dropped before.
  // Mutation checked: leave case_wide_flags empty → "Not recorded" under CASE-WIDE FLAGS.
  assert.match(html, /CASE-WIDE FLAGS[\s\S]*Synthetic case-wide flag[\s\S]*Open/);
  // The requests, with state and dates.
  // Mutation checked: drop the due date from requestLine → no "due 2026-11-20".
  assert.match(html, /Send the synthetic cap table<\/td><td[^>]*>Received · Corporate &amp; Legal Structure · asked 2026-11-01 · due 2026-11-20 · answered 2026-11-03/);
  // Mutation checked: read state alone → "Requested" for the withdrawn request.
  assert.match(html, /Send synthetic bank statements<\/td><td[^>]*>Withdrawn · Case-wide · asked 2026-11-01 · withdrawn 2026-11-04/);
  assert.ok(!html.includes(NOT_IN_THIS_COPY), 'the deal team reads every part');
  // The report list still shows the band at generation.
  const list = await call(w, LEAD, 'GET', `/cases/${CASE}/reports`);
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].risk_band_at_generation, 'yellow');
});

test('a case with no memo, decision or requests reads "Not recorded" in each part, and nothing is made up', async () => {
  const w = world();
  w.db.exec(`DELETE FROM dd_requests; DELETE FROM dd_checklist_items WHERE section_id = 2; DELETE FROM dd_findings WHERE section_id IS NULL;`);
  const r = await generate(w, ADMIN);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const html = r.html;
  const block = (title: string) => html.slice(html.indexOf(title), html.indexOf('</section>', html.indexOf(title)));
  // Mutation checked: render a missing decision as "Proceed" → the DECISION block names it.
  assert.ok(block('DECISION').includes(`>${NOT_RECORDED}</p>`), 'no decision');
  assert.ok(block('DECISION').includes(`Reason:</strong> ${NOT_RECORDED}`), 'no reason');
  // Mutation checked: draw an empty part blank → fewer than four "Not recorded" in the memo.
  assert.equal(block("THE DEAL TEAM'S MEMO").split(NOT_RECORDED).length - 1, 4, 'each memo part');
  assert.ok(block('REQUESTS TO THE SUBJECT').includes(NOT_RECORDED));
  assert.ok(block('CASE-WIDE FLAGS').includes(NOT_RECORDED));
  // A section with no checklist says so.
  const s2 = html.slice(html.indexOf('Market &amp; Traction</h2>'));
  assert.match(s2, new RegExp(`CHECKLIST</h3><p[^>]*>${NOT_RECORDED}</p>`));
});

test('a section reviewer may generate; their copy holds no memo, reason, requests, case-wide flags or other sections\' checklist', async () => {
  const w = world();
  await decideAndWriteMemo(w);
  // The case read's flag for the reviewer says the memo is not theirs.
  const caseRead = await call(w, REVIEWER, 'GET', `/cases/${CASE}`);
  assert.equal(caseRead.body.allowed.memo_read, false);
  assert.equal(caseRead.body.allowed.report, true);
  // A partner who reviews a section reaches the route (D1245 `report`).
  const r = await generate(w, REVIEWER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const html = r.html;
  // Mutation checked: decide dealTeam by `user.role === 'partner'` → the memo and the reason are drawn.
  for (const v of Object.values(MEMO)) assert.ok(!html.includes(v), `no memo part: ${v}`);
  assert.ok(!html.includes(REASON), 'no reason');
  assert.ok(!html.includes('Send the synthetic cap table') && !html.includes('Send synthetic bank statements'), 'no requests');
  assert.ok(!html.includes('Synthetic case-wide flag'), 'no case-wide flag');
  assert.ok(html.includes(NOT_IN_THIS_COPY));
  // The decision itself, which the case read gives them, is there.
  assert.match(html, /Proceed with conditions · recorded by Lee Lead/);
  // Their section's checklist, not the other's.
  // Mutation checked: draw every section's checklist → the cap table item is drawn.
  assert.match(html, /Revenue matches the bank<\/td><td[^>]*>Pending/);
  assert.ok(!html.includes('Cap table is clean'), 'no checklist of a section they do not review');
  // A reviewer who is not a partner is refused before anything is rendered.
  const before = w.rendered.length;
  const inv = await call(w, INVESTOR, 'POST', `/cases/${CASE}/report`, {});
  assert.equal(inv.status, 403);
  assert.equal(w.rendered.length, before, 'nothing rendered for a refused caller');
});

test('the stored PDF (pdf-lib, no BROWSER) draws the same parts, and the sign-off', async () => {
  const w = world({ browser: false });
  await decideAndWriteMemo(w);
  const r = await call(w, LEAD, 'POST', `/cases/${CASE}/report`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.format, 'pdf');
  const key = w.db.prepare('SELECT storage_key FROM dd_reports ORDER BY id DESC LIMIT 1').get().storage_key;
  const pdf = pdfText(new Uint8Array(await decryptBytes(w.env, w.files.get(key)!)));
  // Mutation checked: drop the PDF's memo block → no hex for the summary.
  for (const s of [MEMO.summary, MEMO.conditions, 'Proceed with conditions', 'Cap table is clean', '2 pieces of evidence',
    'Send the synthetic cap table', 'Synthetic case-wide flag', 'Signed off by Lee Lead']) {
    assert.ok(pdf.includes(hex(s)), `the PDF draws "${s}"`);
  }
});

test('the founder-facing share gains nothing: the subject receives the same notice as before', async () => {
  const w = world();
  await decideAndWriteMemo(w);
  const r = await call(w, ADMIN, 'POST', `/cases/${CASE}/report/share`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true }, 'the response carries nothing of the case');
  const rows = w.db.prepare('SELECT type, title, body, link, payload, category FROM notifications_inbox WHERE user_id = ?').all(FOUNDER);
  // Mutation checked: add the decision to the notice body → the pinned body differs.
  assert.deepEqual(rows.map((x: any) => ({ ...x })), [{
    type: 'dd_report_ready',
    title: 'Your due diligence report is available',
    body: 'Axal has completed a DD review for Company Alpha. Reach out to your partner to discuss the findings.',
    link: null, payload: null, category: 'dd_report_ready',
  }]);
  const all = JSON.stringify(rows);
  for (const v of [...Object.values(MEMO), REASON, 'Cap table is clean', 'Synthetic case-wide flag', 'Proceed with conditions']) {
    assert.ok(!all.includes(v), `the subject never receives "${v}"`);
  }
  // No report is generated or stored by sharing.
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM dd_reports').get().n, 0);
});
