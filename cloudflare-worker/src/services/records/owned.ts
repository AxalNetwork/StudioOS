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
    // D693 (#1703): Verdict's two stores, read only here and in services/verdict.ts.
    case 'validation_decisions': { const n = numeric(value); return n !== null && !!await db.prepare('SELECT 1 FROM validation_decisions WHERE id = ? AND project_id = ?').bind(n, projectId).first(); }
    case 'validation_decision_commitments': { const n = numeric(value); return n !== null && !!await db.prepare('SELECT 1 FROM validation_decision_commitments c JOIN validation_decisions d ON d.id = c.decision_id WHERE c.id = ? AND c.project_id = ? AND d.project_id = ?').bind(n, projectId, projectId).first(); }
  }
}
