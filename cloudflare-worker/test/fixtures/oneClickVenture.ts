/**
 * D1511 (#3762) — a venture whose records fill every card of the one-click
 * deck, written into the real migrated schema with bound statements, so
 * `POST /api/decks/generate` reads them through `readSources` exactly as it
 * reads production's stores. SYNTHETIC: every name, figure and date is made
 * up; none is a real venture's or a real person's.
 *
 * Used by `fake_ai_one_click_d1511.test.ts` (the fixture run's assertions) and
 * by `frontend/tests/visual/server.ts` (the accepted deck the visual suite
 * draws), so both run on the same records.
 */
import type { DatabaseSync } from 'node:sqlite';

export const ONE_CLICK = Object.freeze({
  founderUserId: 2,
  founderId: 100,
  projectId: 1,
  integrationId: 7,
  ventureName: 'Synthetic Ledger Co',
  /** The day the records are read on, so "in the last 90 days" is stable. */
  asOf: '2026-10-20',
});

type Ids = Partial<typeof ONE_CLICK>;

/** Writes the founder, the venture and every record the one-click deck reads. */
export function seedOneClickVenture(db: DatabaseSync, ids: Ids = {}): typeof ONE_CLICK {
  const o = { ...ONE_CLICK, ...ids };
  const P = o.projectId;
  const U = o.founderUserId;
  const run = (sql: string, ...binds: unknown[]) => db.prepare(sql).run(...(binds as any[]));

  run('INSERT OR IGNORE INTO users (id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)',
    U, 'founder', o.founderId, 'Synthetic Founder', `synthetic-${U}@example.invalid`, 'studio');
  run('INSERT INTO projects (id, name, founder_id, use_of_funds, updated_at) VALUES (?, ?, ?, ?, ?)', P, o.ventureName, o.founderId,
    JSON.stringify([{ key: 'product', pct: 50 }, { key: 'go-to-market', pct: 30 }, { key: 'operations', pct: 20 }]), '2026-10-01 09:00:00');

  // Validate: interviews held and fitted, a pain theme they name, a claim, letters of intent, competitors.
  const pains = JSON.stringify(['Month-end close takes too long']);
  for (let i = 1; i <= 6; i++) {
    run(`INSERT INTO discovery_interviews (project_id, interviewee_name, stage, icp_fit, done_at, interview_date, pains_json) VALUES (?, ?, 'done', ?, ?, ?, ?)`,
      P, `Synthetic interviewee ${i}`, i <= 4 ? 'strong' : 'weak', `2026-09-${String(10 + i).padStart(2, '0')}`, `2026-09-${String(10 + i).padStart(2, '0')}`, pains);
  }
  const group = Number(run('INSERT INTO pain_groups (project_id, title, sort_order, updated_at) VALUES (?, ?, 0, ?)', P, 'Slow month-end close', '2026-09-20 10:00:00').lastInsertRowid);
  run('INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?, ?, ?, ?)', P, group, 'month-end close takes too long', 'Month-end close takes too long');
  run("INSERT INTO hypotheses (project_id, code, claim, sort_order, updated_at) VALUES (?, 'H1', ?, 0, '2026-09-21 10:00:00')", P, 'Finance teams want the close in a day');
  for (const [kind, status] of [['loi', 'confirmed'], ['loi', 'confirmed'], ['waitlist', 'counted']] as const) {
    run('INSERT INTO demand_signals (project_id, kind, signal_date, status) VALUES (?, ?, ?, ?)', P, kind, '2026-09-25', status);
  }
  for (const name of ['ledgerly', 'closekit']) {
    run('INSERT INTO competitor_tracking (uid, project_id, name_norm, price_position, depth_position, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      `comp-${P}-${name}`, P, name, 'higher', 'broader', '2026-09-26 10:00:00');
  }
  run("INSERT INTO market_sources (project_id, title, kind, created_at) VALUES (?, 'Synthetic market notes', 'notion', '2026-09-27 10:00:00')", P);

  // Build: must-haves, releases in the last 90 days, objectives, commits.
  for (let i = 1; i <= 4; i++) {
    run("INSERT INTO mvp_features (project_id, title, is_must_have, delivery_status, done_at, scope) VALUES (?, ?, 1, ?, ?, 'core')",
      P, `Synthetic feature ${i}`, i <= 3 ? 'Done' : 'Backlog', i <= 3 ? '2026-09-30' : null);
  }
  for (let i = 1; i <= 3; i++) run('INSERT INTO roadmap_releases (project_id, repository, tag, published_at) VALUES (?, ?, ?, ?)', P, 'synthetic/app', `v0.${i}.0`, `2026-0${7 + i}-15T10:00:00Z`);
  run("INSERT INTO roadmap_okrs (project_id, objective, kanban_status, updated_at) VALUES (?, 'Multi-entity close', 'now', '2026-10-02 10:00:00')", P);
  run('INSERT INTO github_contributors (integration_id, project_id, repository, login, commits_90d, updated_at) VALUES (?, ?, ?, ?, ?, ?)', 90, P, 'synthetic/app', 'synthetic-dev', 120, '2026-10-03 10:00:00');

  // Grow: the founder's typed metrics, and Mercury's revenue and runway facts.
  run("INSERT INTO project_metrics (project_id, snapshot_date, source, mrr, arr, monthly_churn_pct, paying_accounts) VALUES (?, '2026-10-01', 'manual', 15100, 181200, 1.8, 38)", P);
  run("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (?, ?, ?, 'mercury', 'active', 'oauth')", o.integrationId, `int-${o.integrationId}`, U);
  const fact = 'INSERT INTO mercury_raise_facts (integration_id, project_id, kind, fact_key, label, months, amount_cents, burn_cents, value, as_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  run(fact, o.integrationId, P, 'revenue', 'revenue:2026-08', '2026-08', 1, 1290000, null, null, '2026-10-05');
  run(fact, o.integrationId, P, 'revenue', 'revenue:2026-09', '2026-09', 1, 1510000, null, null, '2026-10-05');
  run(fact, o.integrationId, P, 'revenue', 'revenue:growth', '2026-09', 1, null, null, 17.1, '2026-10-05');
  run(fact, o.integrationId, P, 'runway', 'runway', 'Runway', 3, 62000000, 4100000, 15, '2026-10-05');

  // Team and Raise: founders on the cap table, their published archetypes and skills, the round and its call.
  for (const [id, role] of [[1, 'CEO'], [2, 'CTO']] as const) {
    run("INSERT INTO cap_table_holders (id, user_id, project_id, name, founder_role, kind, updated_at) VALUES (?, ?, ?, ?, ?, 'person', '2026-09-01 10:00:00')", id, U, P, `Synthetic holder ${id}`, role);
    run("INSERT INTO cap_table_vesting (user_id, holder_id, project_id, total_months, cliff_months, updated_at) VALUES (?, ?, ?, 48, 12, '2026-09-01 10:00:00')", U, id, P);
  }
  run("INSERT INTO cap_table_holders (id, user_id, project_id, name, kind, updated_at) VALUES (3, ?, ?, 'Synthetic angel', 'investor', '2026-09-02 10:00:00')", U, P);
  for (const axis of ['finance_ops', 'engineering']) {
    run("INSERT INTO skill_evidence (user_id, axis, source, count_lifetime, count_window, weighted, first_at, last_at, computed_at) VALUES (?, ?, 'fixture', 4, 2, 3.5, '2026-01-01', '2026-09-01', '2026-09-02 10:00:00')", U, axis);
  }
  run("INSERT INTO profile_archetypes (user_id, persona, archetype_slug, archetype_label, computed_at) VALUES (?, 'founder', 'operator', 'Operator', '2026-09-03 10:00:00')", U);
  run('INSERT INTO profile_archetype_publish (user_id, published) VALUES (?, 1)', U);
  run("INSERT INTO raise_rounds (uid, project_id, name, target_amount, close_date, status, updated_at) VALUES (?, ?, 'Synthetic seed', 1500000, '2027-01-15', 'active', '2026-10-04 10:00:00')", `round-${P}`, P);
  run(`INSERT INTO round_calls (uid, project_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, terms_hash, created_by, updated_at)
       VALUES (?, ?, 'Synthetic seed', 150000000, 'safe', '{}', 2500000, '2027-01-15', 'h', ?, '2026-10-04 10:00:00')`, `call-${P}`, P, U);

  // The AI allowance a member run draws on (as deck_new_d897.test.ts sets it).
  run('INSERT OR IGNORE INTO ai_topup_accounts (user_id, balance_microusd) VALUES (?, 5000000)', U);
  for (const key of ['founder:free', 'founder:studio']) run('INSERT OR IGNORE INTO ai_licence_caps (licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, 0, 0, 1)', key);
  return o;
}
