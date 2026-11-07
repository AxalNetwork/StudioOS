/**
 * D4657 (#4657) test helper: give a test database the enrollment schema and
 * the saved work that proves a Lab milestone.
 *
 *   labEnrollmentSchema(db)      runs migration 202611071700 statement by
 *                                statement. The backfill INSERTs read tables a
 *                                cut-down test database may not have; those two
 *                                are skipped when their sources are absent, as
 *                                a fresh database would have nothing to fill.
 *   proveMilestone(db, uid, key) writes the row(s) `services/labEvidence.ts`
 *                                checks for `key`, creating the evidence table
 *                                (or a missing column) first when the test
 *                                database lacks it. Values are invented.
 *   enrollCohort / enrollLegacy  write an enrollment directly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const MIGRATION = readFileSync(
  resolve(new URL('../sql/migrations/202611071700_spinout_lab_enrollments.sql', import.meta.url).pathname), 'utf8');

function statements(sql: string): string[] {
  const noComments = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  return noComments.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
}

const hasTable = (db: DatabaseSync, t: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const columns = (db: DatabaseSync, t: string) =>
  new Set((db.prepare('SELECT name FROM pragma_table_info(?)').all(t) as Array<{ name: string }>).map((r) => r.name));

const BASELINE = readFileSync(resolve(new URL('../sql/schema_baseline.sql', import.meta.url).pathname), 'utf8');
function baselineDdl(name: string): string | null {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  if (at < 0) return null;
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

/** Tables the migration's backfill and the eligibility policy read. */
const PREREQUISITES: Record<string, string> = {
  cohort_cycles: 'id INTEGER PRIMARY KEY, year INTEGER, month INTEGER, start_at TEXT, end_at TEXT, status TEXT, app_status TEXT',
  cohort_applicants: 'id INTEGER PRIMARY KEY, application_id INTEGER, user_id INTEGER, cohort_cycle_id INTEGER, status TEXT, decided_at TEXT',
  user_spinout_flags: 'user_id INTEGER PRIMARY KEY, spinout_lab_admitted INTEGER, spinout_lab_cohort TEXT',
  spinout_lab_milestones: 'id INTEGER PRIMARY KEY, user_id INTEGER, week INTEGER, milestone_key TEXT, completed_at TEXT DEFAULT (datetime(\'now\')), UNIQUE (user_id, milestone_key)',
  spinout_moderation_cases: 'id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, reason_code TEXT, opened_at TEXT, resolved_at TEXT',
};

export function labEnrollmentSchema(db: DatabaseSync): void {
  if (hasTable(db, 'spinout_lab_enrollments')) return;
  for (const [t, cols] of Object.entries(PREREQUISITES)) {
    if (hasTable(db, t)) continue;
    db.exec(baselineDdl(t) ?? `CREATE TABLE ${t} (${cols})`);
  }
  for (const s of statements(MIGRATION)) db.exec(s);
}

/** Each evidence table with the columns the checks read. Created only when absent. */
const TABLES: Record<string, string> = {
  projects: 'id INTEGER PRIMARY KEY, uid TEXT, founder_id INTEGER, name TEXT, deleted_at TEXT, tam REAL, sam REAL, revenue REAL, mrr REAL, paying_customers INTEGER, paid_pilot_status TEXT, growth_signals TEXT, use_of_funds TEXT, funding_needed REAL, icp_definition_meta TEXT, created_at TEXT, updated_at TEXT',
  discovery_interviews: 'id INTEGER PRIMARY KEY, project_id INTEGER, interviewee_name TEXT, interviewee_role TEXT',
  roadmap_okrs: 'id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, quarter TEXT',
  landing_pages: 'id INTEGER PRIMARY KEY, project_id INTEGER, page_slug TEXT, name TEXT, tagline TEXT, theme_color TEXT, archived_at TEXT',
  pitch_decks: 'id INTEGER PRIMARY KEY, project_id INTEGER, is_current INTEGER, slides TEXT',
  score_snapshots: 'id INTEGER PRIMARY KEY, project_id INTEGER, total_score REAL, market_total REAL, team_total REAL, product_total REAL, capital_total REAL, fit_total REAL, distribution_total REAL',
  advisor_bookings: 'id INTEGER PRIMARY KEY, founder_user_id INTEGER, status TEXT',
  cofounder_interests: 'id INTEGER PRIMARY KEY, from_user_id INTEGER, to_user_id INTEGER, status TEXT',
  incorporations: 'id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, jurisdiction_id TEXT, company_name TEXT, amount_cents INTEGER, status TEXT',
  assessment_results: 'id INTEGER PRIMARY KEY, user_id INTEGER',
  user_values: 'user_id INTEGER, dimension_id TEXT',
  user_skills: 'id INTEGER PRIMARY KEY, user_id INTEGER, skill_id INTEGER',
  skills: 'id INTEGER PRIMARY KEY, is_active INTEGER',
  mvp_features: 'id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT',
  waitlist_signups: 'id INTEGER PRIMARY KEY, project_id INTEGER, followed_up_at TEXT',
  partner_bookings: 'id INTEGER PRIMARY KEY, founder_user_id INTEGER, status TEXT',
  project_metrics: 'id INTEGER PRIMARY KEY, project_id INTEGER, source TEXT',
  company_eins: 'id INTEGER PRIMARY KEY, project_id INTEGER',
  cap_table_scenarios: 'id INTEGER PRIMARY KEY, project_id INTEGER, is_variant INTEGER, inputs_json TEXT',
  section_83b_trackers: 'id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, mailed_at TEXT, filing_method TEXT',
  documents: 'id INTEGER PRIMARY KEY, project_id INTEGER, template_name TEXT, status TEXT',
  raise_rounds: 'id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, target_amount REAL',
  raise_prospects: 'id INTEGER PRIMARY KEY, project_id INTEGER, stage TEXT',
};

/** Create every evidence table the database lacks, and add any missing column a check reads. */
export function evidenceTables(db: DatabaseSync): void {
  for (const [t, cols] of Object.entries(TABLES)) {
    if (!hasTable(db, t)) { db.exec(`CREATE TABLE ${t} (${cols})`); continue; }
    const have = columns(db, t);
    for (const c of cols.split(',').map((x) => x.trim())) {
      const [name, ...type] = c.split(/\s+/);
      if (!have.has(name)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${name} ${type.filter((w) => !/PRIMARY|KEY/.test(w)).join(' ')}`);
    }
  }
  const u = columns(db, 'users');
  if (!u.has('founder_id')) db.exec('ALTER TABLE users ADD COLUMN founder_id INTEGER');
}

/** The user's project (created on first use). Founder id = user id, an invented value. */
export function labProject(db: DatabaseSync, userId: number): number {
  evidenceTables(db);
  db.prepare('UPDATE users SET founder_id = COALESCE(founder_id, ?) WHERE id = ?').run(userId, userId);
  const founder = (db.prepare('SELECT founder_id AS f FROM users WHERE id = ?').get(userId) as { f: number }).f;
  const row = db.prepare('SELECT id FROM projects WHERE founder_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(founder) as { id: number } | undefined;
  if (row) return row.id;
  return insertRow(db, 'projects', { founder_id: founder, name: 'Test Venture' });
}

const repeat = (n: number, f: () => void) => { for (let i = 0; i < n; i++) f(); };
let seq = 0;

/** Insert `values`, filling every other NOT NULL column without a default with an invented value. */
export function insertRow(db: DatabaseSync, table: string, values: Record<string, unknown>): number {
  const info = db.prepare('SELECT name, type, "notnull" AS nn, dflt_value AS d, pk FROM pragma_table_info(?)').all(table) as
    Array<{ name: string; type: string; nn: number; d: unknown; pk: number }>;
  const row: Record<string, unknown> = { ...values };
  for (const c of info) {
    if (c.name in row || c.pk || !c.nn || c.d !== null) continue;
    seq += 1;
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? seq : `fixture-${table}-${c.name}-${seq}`;
  }
  const cols = Object.keys(row);
  const r = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...(cols.map((k) => row[k]) as never[]));
  return Number(r.lastInsertRowid);
}

/** Write the saved work that proves `key` for `userId`. */
export function proveMilestone(db: DatabaseSync, userId: number, key: string): void {
  const project_id = labProject(db, userId);
  // Proving a step twice is harmless: a row a UNIQUE index already holds is the proof.
  const ins = (t: string, v: Record<string, unknown>) => {
    try { return insertRow(db, t, v); } catch (e) { if (/UNIQUE constraint/.test(String((e as Error).message))) return 0; throw e; }
  };
  const setProject = (sql: string) => db.prepare(`UPDATE projects SET ${sql} WHERE id = ?`).run(project_id);
  const interviewsTo = (n: number) => {
    const have = (db.prepare('SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?').get(project_id) as { n: number }).n;
    repeat(Math.max(0, n - have), () => ins('discovery_interviews', { project_id, interviewee_name: 'Pat Example' }));
  };
  const m = /^customer_interview_logged_(\d)$/.exec(key);
  if (m) return interviewsTo(Number(m[1]));
  switch (key) {
    case 'project_created': return;
    case 'okrs_created': repeat(3, () => ins('roadmap_okrs', { project_id, objective: 'Ship' })); return;
    case 'brand_basics_filled': ins('landing_pages', { project_id, name: 'Venture', tagline: 'A tagline', page_slug: `brand-${++seq}` }); return;
    case 'landing_page_created': ins('landing_pages', { project_id, name: 'Venture', page_slug: `page-${++seq}` }); return;
    case 'pitch_deck_drafted': ins('pitch_decks', { project_id, is_current: 1, slides: '[]' }); return;
    case 'scoring_run_completed': ins('score_snapshots', { project_id, total_score: 60 }); return;
    case 'scoring_confidence_70':
      ins('score_snapshots', { project_id, total_score: 80, market_total: 20, team_total: 16, product_total: 12, capital_total: 12, fit_total: 12, distribution_total: 2 }); return;
    case 'advisor_meeting_booked': ins('advisor_bookings', { founder_user_id: userId, status: 'confirmed' }); return;
    case 'office_hours_booked': ins('partner_bookings', { founder_user_id: userId, status: 'confirmed' }); return;
    case 'cofounder_request_sent': ins('cofounder_interests', { from_user_id: userId, to_user_id: 9999, status: 'sent' }); return;
    case 'incorporation_completed': ins('incorporations', { user_id: userId, project_id, status: 'paid' }); return;
    case 'market_sizing_completed': case 'market_research_shared': setProject('tam = 1e9, sam = 1e8'); return;
    case 'revenue_proof_added': case 'revenue_summary_generated': setProject('mrr = 1200'); return;
    case 'use_of_funds_filled': setProject(`use_of_funds = '[{"label":"Build","pct":100}]', funding_needed = 500000`); return;
    case 'ein_received': ins('company_eins', { project_id, ein_enc: 'v1.fixture', ein_last4: '0000' }); return;
    case 'founder_stock_issued': case 'captable_locked': {
      // One base scenario per project: both steps write into it.
      const base = db.prepare('SELECT id, inputs_json FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0').get(project_id) as { id: number; inputs_json: string } | undefined;
      const inputs = base ? JSON.parse(base.inputs_json || '{}') : { founders: [], rounds: [] };
      if (key === 'founder_stock_issued') inputs.founders = [{ shares: 1000 }];
      else inputs.rounds = [{ name: 'Seed' }];
      if (base) db.prepare('UPDATE cap_table_scenarios SET inputs_json = ? WHERE id = ?').run(JSON.stringify(inputs), base.id);
      else ins('cap_table_scenarios', { project_id, is_variant: 0, inputs_json: JSON.stringify(inputs) });
      return;
    }
    case 'section83b_filed': ins('section_83b_trackers', { project_id, user_id: userId, mailed_at: '2026-11-01', filing_method: 'mail' }); return;
    case 'cofounder_agreement_signed': ins('documents', { project_id, template_name: 'cofounder_agreement', status: 'signed' }); return;
    case 'fundraise_ask_locked': ins('raise_rounds', { project_id, status: 'active', target_amount: 500000 }); return;
    case 'investor_intros_secured': repeat(3, () => ins('raise_prospects', { project_id, stage: 'intro' })); return;
    case 'discovery_followups_mapped': repeat(3, () => ins('waitlist_signups', { project_id, followed_up_at: '2026-11-01' })); return;
    case 'mvp_scoped':
      for (const added_value of ['High', 'Low', 'Medium']) ins('mvp_features', { project_id, title: added_value, added_value }); return;
    case 'icp_defined': setProject(`icp_definition_meta = '{"status":"confirmed"}'`); interviewsTo(3); return;
    case 'profiling_completed': {
      const skill = ins('skills', { is_active: 1 });
      ins('user_skills', { user_id: userId, skill_id: skill }); ins('user_values', { user_id: userId, dimension_id: 'd1' });
      ins('assessment_results', { user_id: userId }); return;
    }
    case 'data_room_built':
      for (const k of ['pitch_deck_drafted', 'use_of_funds_filled', 'founder_stock_issued', 'scoring_run_completed', 'customer_interview_logged_3', 'incorporation_completed']) proveMilestone(db, userId, k);
      ins('roadmap_okrs', { project_id, objective: 'Ship' }); setProject('mrr = 1200'); return;
    default: throw new Error(`proveMilestone: no fixture for ${key}`);
  }
}

export function enrollLegacy(db: DatabaseSync, userId: number): void {
  labEnrollmentSchema(db);
  db.prepare("INSERT OR IGNORE INTO spinout_lab_enrollments (user_id, kind) VALUES (?, 'legacy')").run(userId);
}

export function enrollCohort(db: DatabaseSync, userId: number, cycleId: number, startAt: string): void {
  labEnrollmentSchema(db);
  db.prepare("INSERT OR IGNORE INTO spinout_lab_enrollments (user_id, kind, cohort_cycle_id, cycle_source, started_at) VALUES (?, 'cohort', ?, 'assigned', ?)")
    .run(userId, cycleId, startAt);
}
