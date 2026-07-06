/**
 * Shared helpers for the six MI extractors. Each extractor module
 * imports the bits it needs from here so per-extractor files stay
 * tightly scoped to their own logic.
 */
import type { Env } from '../../../types';
import { SECTORS } from '../aggregator';

export const SIGNAL_EXTRACTORS = [
  'sentiment', 'talc', 'demand_supply', 'sector_heat',
  'partner_rate_card', 'partner_comp_model',
] as const;
export type SignalExtractor = typeof SIGNAL_EXTRACTORS[number];

/** Stable 16-hex sha256 truncation. */
export async function shortHash(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const dig = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

/** ISO week key 'YYYY-Wnn'. */
export function weekKey(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Calendar month key 'YYYY-MM'. */
export function monthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function round(x: number): number { return Math.round(x * 1000) / 1000; }

/** Lower-case match against the canonical SECTORS list; fuzzy fallback. */
export function canonicalSector(raw: string): string {
  const t = raw.trim();
  for (const s of SECTORS) if (s.toLowerCase() === t.toLowerCase()) return s;
  const tt = t.toLowerCase();
  for (const s of SECTORS) {
    const tok = s.toLowerCase().split(/[\s/]+/);
    if (tok.some((x) => x.length >= 4 && tt.includes(x))) return s;
  }
  return t.slice(0, 64) || 'global';
}

function safeParseArray(s: string): string[] {
  try { const j = JSON.parse(s); return Array.isArray(j) ? j.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}

/** Resolve the canonical sector slug for a user. */
export async function resolveUserSector(env: Env, userId: number, persona: string): Promise<string> {
  try {
    if (persona === 'founder') {
      const r = await env.DB.prepare(
        `SELECT p.sector FROM projects p
           JOIN users u ON u.founder_id = p.founder_id
           WHERE u.id = ? AND p.deleted_at IS NULL
           ORDER BY p.created_at DESC LIMIT 1`,
      ).bind(userId).first<{ sector: string | null }>();
      if (r?.sector) return canonicalSector(r.sector);
    } else if (persona === 'investor') {
      const r = await env.DB.prepare(
        `SELECT sectors_json FROM investor_profiles WHERE user_id = ?`,
      ).bind(userId).first<{ sectors_json: string | null }>();
      const arr = r?.sectors_json ? safeParseArray(r.sectors_json) : [];
      if (arr[0]) return canonicalSector(arr[0]);
    } else if (persona === 'advisor') {
      const r = await env.DB.prepare(
        `SELECT sectors_json FROM advisors WHERE user_id = ?`,
      ).bind(userId).first<{ sectors_json: string | null }>();
      const arr = r?.sectors_json ? safeParseArray(r.sectors_json) : [];
      if (arr[0]) return canonicalSector(arr[0]);
    }
  } catch { /* schema may be missing on dev */ }
  return 'global';
}

export interface SignalWriteArgs {
  extractor: string;
  userId: number;
  persona: string;
  advisorAnswerId: number | null | undefined;
  questionId: string;
  sector: string | null;
  geo: string | null;
  period_key: string;
  payload: Record<string, unknown>;
  content_hash: string;
}

/**
 * Idempotent insert into market_intel_signals. Returns 1 when the
 * INSERT actually wrote a new row, 0 on conflict (no-op upsert) or
 * error — observability/stats counters depend on this distinction.
 */
export async function writeSignal(env: Env, args: SignalWriteArgs): Promise<number> {
  try {
    const r = await env.DB.prepare(
      `INSERT INTO market_intel_signals
         (extractor, user_id, persona, advisor_answer_id, question_id, sector, geo, period_key, payload_json, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(extractor, user_id, advisor_answer_id, content_hash) DO NOTHING`,
    ).bind(
      args.extractor, args.userId, args.persona, args.advisorAnswerId ?? null, args.questionId,
      args.sector, args.geo, args.period_key, JSON.stringify(args.payload), args.content_hash,
    ).run();
    return Number((r as any).meta?.changes || 0) > 0 ? 1 : 0;
  } catch (e) {
    console.warn('[mi.extractors] writeSignal failed:', (e as Error).message);
    return 0;
  }
}

export interface ExtractorContext {
  env: Env;
  userId: number;
  persona: string;
  questionId: string;
  rawValue: string;
  advisorAnswerId?: number | null;
  /** Pre-resolved sector slug to avoid N+1 lookups during sweeps. */
  sector: string;
  /** Stable hash of (user|question|normalised text). */
  contentHash: string;
  /** YYYY-Wnn for high-frequency signals. */
  weekKey: string;
  /** YYYY-MM for slow signals. */
  monthKey: string;
}
