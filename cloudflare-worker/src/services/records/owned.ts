/** D690 — prove a record belongs to the selected venture before reading it. */
import type { Env } from '../../types';
import type { Store } from './types';

export const RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/;

function numeric(id: string, prefix = ''): number | null {
  const raw = prefix ? (id.startsWith(prefix) ? id.slice(prefix.length) : '') : id;
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Fixed statements only: a request never supplies a table or SQL fragment. */
export async function ownedRow(env: Env, store: Store, id: string | number, projectId: number): Promise<boolean> {
  const value = String(id);
  if (!RECORD_ID.test(value) || !Number.isSafeInteger(projectId) || projectId < 1) return false;
  const db = env.DB;
  switch (store) {
    case 'pain_groups': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM pain_groups WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'discovery_interviews': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM discovery_interviews WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'customer_segments': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM customer_segments WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'competitor_candidates':
      return !!await db.prepare(
        'SELECT 1 FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id WHERE c.id = ? AND a.project_id = ?',
      ).bind(value, projectId).first();
    case 'demand_signals': {
      const n = numeric(value, 'signal-');
      return n !== null && !!await db.prepare('SELECT 1 FROM demand_signals WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'revenue_entries': {
      const n = numeric(value, 'revenue-');
      return n !== null && !!await db.prepare('SELECT 1 FROM revenue_entries WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'waitlist_signups': {
      const n = numeric(value, 'waitlist-');
      return n !== null && !!await db.prepare(
        "SELECT 1 FROM waitlist_signups WHERE id = ? AND project_id = ? AND (audience IS NULL OR audience = 'customer')",
      ).bind(n, projectId).first();
    }
    case 'hypotheses': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM hypotheses WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'hypothesis_pain_links': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM hypothesis_pain_links l JOIN hypotheses h ON h.id = l.hypothesis_id JOIN pain_groups p ON p.id = l.pain_group_id WHERE l.id = ? AND h.project_id = ? AND p.project_id = ?',
      ).bind(n, projectId, projectId).first();
    }
    case 'interview_sessions': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM interview_sessions s JOIN discovery_interviews i ON i.id = s.interview_id WHERE s.id = ? AND i.project_id = ?',
      ).bind(n, projectId).first();
    }
    // D690 (#1692): Demand and urgency signals' one id space, `signal-`,
    // `revenue-` (a deposit or pilot in the ledger) or `waitlist-` (a customer
    // sign-up, never an investor's), each proved in its own store.
    case 'demand_records': {
      const signal = numeric(value, 'signal-');
      if (signal !== null) return !!await db.prepare('SELECT 1 FROM demand_signals WHERE id = ? AND project_id = ?').bind(signal, projectId).first();
      const revenue = numeric(value, 'revenue-');
      if (revenue !== null) return !!await db.prepare(
        "SELECT 1 FROM revenue_entries WHERE id = ? AND project_id = ? AND revenue_type IN ('deposit', 'pilot')",
      ).bind(revenue, projectId).first();
      const signup = numeric(value, 'waitlist-');
      return signup !== null && !!await db.prepare(
        "SELECT 1 FROM waitlist_signups WHERE id = ? AND project_id = ? AND (audience IS NULL OR audience = 'customer')",
      ).bind(signup, projectId).first();
    }
    case 'hypothesis_experiments': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM hypothesis_experiments x JOIN hypotheses h ON h.id = x.hypothesis_id WHERE x.id = ? AND x.project_id = ? AND h.project_id = ?',
      ).bind(n, projectId, projectId).first();
    }
    case 'hypothesis_evidence_links': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM hypothesis_evidence_links l JOIN hypotheses h ON h.id = l.hypothesis_id WHERE l.id = ? AND l.project_id = ? AND h.project_id = ?',
      ).bind(n, projectId, projectId).first();
    }
    // D693 (#1703): Verdict's two stores, read only here and in services/verdict.ts.
    case 'validation_decisions': { const n = numeric(value); return n !== null && !!await db.prepare('SELECT 1 FROM validation_decisions WHERE id = ? AND project_id = ?').bind(n, projectId).first(); }
    case 'validation_decision_commitments': { const n = numeric(value); return n !== null && !!await db.prepare('SELECT 1 FROM validation_decision_commitments c JOIN validation_decisions d ON d.id = c.decision_id WHERE c.id = ? AND c.project_id = ? AND d.project_id = ?').bind(n, projectId, projectId).first(); }
    // D690 (S18-B, #1694): Build. Each id resolves through its store and the venture.
    case 'mvp_features': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM mvp_features WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'mvp_must_haves': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM mvp_features WHERE id = ? AND project_id = ? AND is_must_have = 1').bind(n, projectId).first();
    }
    case 'roadmap_okrs': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'cap_table_founders': {
      // project_id is nullable on the register, so it is always bound.
      const n = numeric(value, 'h-');
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM cap_table_holders WHERE id = ? AND project_id = ? AND founder_role IS NOT NULL',
      ).bind(n, projectId).first();
    }
    case 'build_filings': {
      const step = numeric(value, 'step-');
      if (step !== null) return !!await db.prepare('SELECT 1 FROM formation_steps WHERE id = ? AND project_id = ?').bind(step, projectId).first();
      const obligation = numeric(value, 'obligation-');
      if (obligation !== null) return !!await db.prepare(
        'SELECT 1 FROM entity_obligations o JOIN projects p ON p.entity_id = o.entity_id WHERE o.id = ? AND p.id = ?',
      ).bind(obligation, projectId).first();
      const lab = /^lab-([1-9][0-9]{0,9})-([0-2])$/.exec(value);
      return !!lab && !!await db.prepare('SELECT 1 FROM incorporations WHERE id = ? AND project_id = ?').bind(Number(lab[1]), projectId).first();
    }
    case 'build_systems':
      return ['bank', 'accounting', 'payroll', 'crm', 'workspace'].includes(value)
        && !!await db.prepare('SELECT 1 FROM projects WHERE id = ?').bind(projectId).first();
    case 'mvp_test_sessions': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM mvp_test_sessions WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'founder_contributions': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM founder_contributions WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'mvp_test_findings': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM mvp_test_findings t JOIN mvp_test_sessions s ON s.id = t.session_id WHERE t.id = ? AND s.project_id = ?',
      ).bind(n, projectId).first();
    }
    case 'mvp_feature_links': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM mvp_feature_links l JOIN mvp_features f ON f.id = l.feature_id WHERE l.id = ? AND f.project_id = ?',
      ).bind(n, projectId).first();
    }
    case 'mvp_release_checks': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM mvp_release_checks k JOIN mvp_features f ON f.id = k.feature_id WHERE k.id = ? AND f.project_id = ?',
      ).bind(n, projectId).first();
    }
    case 'venture_risks': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM venture_risks r JOIN mvp_features f ON f.id = r.feature_id WHERE r.id = ? AND r.project_id = ? AND f.project_id = ?',
      ).bind(n, projectId, projectId).first();
    }
    case 'formation_step_checks': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM formation_step_checks k JOIN formation_steps s ON s.id = k.step_id WHERE k.id = ? AND s.project_id = ?',
      ).bind(n, projectId).first();
    }
  }
}
