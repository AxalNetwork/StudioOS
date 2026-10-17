/** D690 — prove a record belongs to the selected venture before reading it. */
import type { Env } from '../../types';
import type { Store } from './types';
import { FUND_SECTIONS, READINESS_KEYS } from '../raiseCycle';

export const RECORD_ID = /^[a-z0-9][a-z0-9_-]*$/;

function numeric(id: string, prefix = ''): number | null {
  const raw = prefix ? (id.startsWith(prefix) ? id.slice(prefix.length) : '') : id;
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * A cap-table id in the venture's base scenario (D691 decision 4): `pool`,
 * an entry's `e-<n>` key, or `h-<n>` for an entry carrying register row n,
 * which must itself be this venture's.
 */
async function capEntryOwned(env: Env, id: string, projectId: number): Promise<boolean> {
  const base = await env.DB.prepare(
    'SELECT inputs_json FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0 ORDER BY updated_at DESC LIMIT 1',
  ).bind(projectId).first<{ inputs_json: string | null }>();
  if (!base) return false;
  if (id === 'pool') return true;
  let inputs: any = null;
  try { inputs = JSON.parse(String(base.inputs_json ?? '')); } catch { return false; }
  const entries: any[] = ['founders', 'safes', 'rounds'].flatMap((k) => (Array.isArray(inputs?.[k]) ? inputs[k] : []));
  if (/^e-[1-9][0-9]{0,8}$/.test(id)) return entries.some((e) => e?.key === id);
  const holder = numeric(id, 'h-');
  if (holder === null || !entries.some((e) => Number(e?.holder_id) === holder)) return false;
  return !!await env.DB.prepare('SELECT 1 FROM cap_table_holders WHERE id = ? AND project_id = ?').bind(holder, projectId).first();
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
    // D691 (#1699): Raise. A readiness item key and a use-of-funds section key
    // always resolve, scored or split or not (decision 3); every other id
    // resolves through its own row of this venture.
    case 'readiness_items':
      return READINESS_KEYS.includes(value);
    case 'use_of_funds':
      return FUND_SECTIONS.some((s) => s.key === value);
    case 'spinout_deck_overrides': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM spinout_deck_overrides WHERE project_id = ? AND version = ? LIMIT 1').bind(projectId, n).first();
    }
    case 'pitch_deck_share_tokens': {
      const n = numeric(value);
      return n !== null && !!await db.prepare(
        'SELECT 1 FROM pitch_deck_share_tokens t JOIN pitch_decks d ON d.id = t.deck_id WHERE t.id = ? AND d.project_id = ?',
      ).bind(n, projectId).first();
    }
    case 'data_room_files': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM data_room_files WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
    case 'cap_table_scenarios':
      return capEntryOwned(env, value, projectId);
    case 'raise_prospects': {
      const n = numeric(value);
      return n !== null && !!await db.prepare('SELECT 1 FROM raise_prospects WHERE id = ? AND project_id = ?').bind(n, projectId).first();
    }
  }
}
