/**
 * Task #6 (AT-1) — six MI extractors over anonymised advisor data.
 *
 * Each extractor takes a normalised advisor answer (or, for nightly
 * sweeps, a row from advisor_answers + the user persona/sector
 * resolution) and writes one row to `market_intel_signals`. Aggregation
 * → `market_intel_aggregates` is owned by `./reducer.ts`.
 *
 * Design choices:
 *   - Lexicon-based valence + energy. Keeps per-write cost at zero —
 *     aiRouter is reserved for the paraphrase pipeline (snippets only)
 *     so the per-answer fan-out remains free of LLM budget pressure.
 *   - Idempotent via UNIQUE(extractor, user_id, advisor_answer_id,
 *     content_hash). Re-running on the same input upserts the same row.
 *   - Opt-out is enforced at the entry point (`runExtractorsForAnswer`)
 *     so opted-out users contribute zero rows.
 */
import type { Env } from '../../types';
import { embedText } from '../vectorize';
import { run as aiRun } from '../aiRouter';
import { SECTORS } from './aggregator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable 16-hex sha256 truncation. */
async function shortHash(input: string): Promise<string> {
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

/** Resolve the canonical sector slug for a user (founder→project, investor/mentor→profile, partner→global). */
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
    } else if (persona === 'mentor') {
      const r = await env.DB.prepare(
        `SELECT sectors_json FROM mentors WHERE user_id = ?`,
      ).bind(userId).first<{ sectors_json: string | null }>();
      const arr = r?.sectors_json ? safeParseArray(r.sectors_json) : [];
      if (arr[0]) return canonicalSector(arr[0]);
    }
  } catch { /* schema may be missing on dev */ }
  return 'global';
}

function safeParseArray(s: string): string[] {
  try { const j = JSON.parse(s); return Array.isArray(j) ? j.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}

/** Lower-case match against the canonical SECTORS list; falls back to the original string. */
export function canonicalSector(raw: string): string {
  const t = raw.trim();
  for (const s of SECTORS) if (s.toLowerCase() === t.toLowerCase()) return s;
  // Fuzzy: token overlap
  const tt = t.toLowerCase();
  for (const s of SECTORS) {
    const tok = s.toLowerCase().split(/[\s/]+/);
    if (tok.some((x) => x.length >= 4 && tt.includes(x))) return s;
  }
  return t.slice(0, 64) || 'global';
}

// ---------------------------------------------------------------------------
// Sentiment lexicon (compact, deterministic, free)
// ---------------------------------------------------------------------------

const POS = ['great', 'strong', 'growing', 'fast', 'aggressive', 'tailwind', 'bullish', 'momentum',
  'demand', 'breakout', 'win', 'wins', 'opportunity', 'profitable', 'scaling', 'launched',
  'shipped', 'closed', 'raised', 'love', 'excited', 'optimistic'];
const NEG = ['weak', 'shrinking', 'slow', 'cautious', 'headwind', 'bearish', 'churn', 'risk',
  'risky', 'lose', 'losing', 'lost', 'bad', 'fail', 'failed', 'stalled', 'crowded',
  'expensive', 'concerned', 'worried', 'pessimistic', 'unprofitable'];
const ENERGY = ['must', 'urgent', 'now', 'asap', 'immediately', 'soon', 'rapidly', 'aggressive',
  'pivoting', 'deciding', 'closing', 'shipping'];

function scoreSentiment(text: string): { valence: number; energy: number; n_terms: number } {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return { valence: 0, energy: 0, n_terms: 0 };
  let pos = 0, neg = 0, eng = 0, n = 0;
  for (const t of tokens) {
    if (POS.includes(t)) { pos++; n++; }
    else if (NEG.includes(t)) { neg++; n++; }
    if (ENERGY.includes(t)) eng++;
  }
  const valence = n === 0 ? 0 : (pos - neg) / Math.max(1, n);
  const energy = Math.min(1, eng / Math.max(8, tokens.length / 20));
  return { valence, energy, n_terms: n };
}

// ---------------------------------------------------------------------------
// TALC stage classifier (Technology Adoption Life-Cycle position)
// ---------------------------------------------------------------------------

const TALC_RULES: Array<{ stage: 'discovery' | 'building' | 'scaling' | 'distributing'; terms: string[] }> = [
  { stage: 'discovery',     terms: ['idea', 'discovery', 'interview', 'problem', 'hypothesis', 'pre-revenue'] },
  { stage: 'building',      terms: ['mvp', 'beta', 'prototype', 'wedge', 'pmf', 'design partner'] },
  { stage: 'scaling',       terms: ['series a', 'series b', 'arr', 'expansion', 'enterprise', 'channel'] },
  { stage: 'distributing',  terms: ['ipo', 'acquired', 'liquidity', 'secondary', 'distribution', 'm&a'] },
];

function classifyTalc(text: string): { stage: string; confidence: number } | null {
  const t = text.toLowerCase();
  let best: { stage: string; hits: number } = { stage: '', hits: 0 };
  for (const r of TALC_RULES) {
    const hits = r.terms.reduce((acc, term) => acc + (t.includes(term) ? 1 : 0), 0);
    if (hits > best.hits) best = { stage: r.stage, hits };
  }
  if (best.hits === 0) return null;
  return { stage: best.stage, confidence: Math.min(1, best.hits / 3) };
}

// ---------------------------------------------------------------------------
// Demand / Supply classifier (founders → demand, mentors/partners → supply)
// ---------------------------------------------------------------------------

const TOPIC_TAGS = ['gtm', 'engineering', 'design', 'fundraising', 'legal', 'finance',
  'product', 'sales', 'marketing', 'data', 'ops', 'recruiting'];

function tagTopics(text: string): string[] {
  const t = text.toLowerCase();
  const found = new Set<string>();
  for (const tag of TOPIC_TAGS) if (t.includes(tag)) found.add(tag);
  // a few aliases
  if (/hire|hiring|recruit/.test(t)) found.add('recruiting');
  if (/ai|llm|ml/.test(t)) found.add('engineering');
  if (/customer|sales\b|deal/.test(t)) found.add('sales');
  return Array.from(found);
}

// ---------------------------------------------------------------------------
// Public extractor entrypoint
// ---------------------------------------------------------------------------

export interface ExtractorInput {
  env: Env;
  userId: number;
  persona: string;                    // founder|investor|mentor|partner
  questionId: string;
  rawValue: string;
  advisorAnswerId?: number | null;
}

export interface ExtractorResult {
  signals_written: number;
  embeddings_written: number;
  skipped_reason?: string;
}

/**
 * Run all eligible extractors for one advisor answer. Honors the
 * `users.mi_contribution_optout` flag synchronously — opted-out users
 * write zero rows. Caller (queueWorker / nightly cron) holds the
 * idempotency key via UNIQUE(extractor, user_id, advisor_answer_id,
 * content_hash).
 */
export async function runExtractorsForAnswer(input: ExtractorInput): Promise<ExtractorResult> {
  const { env, userId, persona, questionId, rawValue, advisorAnswerId } = input;
  if (!rawValue || rawValue.trim().length < 4) {
    return { signals_written: 0, embeddings_written: 0, skipped_reason: 'too_short' };
  }
  // Opt-out check (column may be missing on dev — treat absence as "contribute").
  try {
    const o = await env.DB.prepare(`SELECT mi_contribution_optout AS x FROM users WHERE id = ?`)
      .bind(userId).first<{ x: number | null }>();
    if (o && Number(o.x) === 1) {
      return { signals_written: 0, embeddings_written: 0, skipped_reason: 'opted_out' };
    }
  } catch { /* column missing — schema bootstrap pending; allow */ }

  const sector = await resolveUserSector(env, userId, persona);
  const text = rawValue.slice(0, 4000);
  const hash = await shortHash(`${userId}|${questionId}|${text.toLowerCase().replace(/\s+/g, ' ').trim()}`);
  const wk = weekKey();
  const mn = monthKey();

  let signals = 0;
  let embeds = 0;

  // 1. Sentiment — every persona, weekly bucket, sector-keyed.
  const sent = scoreSentiment(text);
  if (sent.n_terms >= 1 || text.length >= 60) {
    signals += await writeSignal(env, {
      extractor: 'sentiment', userId, persona, advisorAnswerId, questionId,
      sector, geo: 'global', period_key: wk,
      payload: { valence: round(sent.valence), energy: round(sent.energy), n_terms: sent.n_terms },
      content_hash: hash,
    });
  }

  // 2. TALC — founders + investors only (the only personas with a stage POV).
  if (persona === 'founder' || persona === 'investor') {
    const talc = classifyTalc(text);
    if (talc) {
      signals += await writeSignal(env, {
        extractor: 'talc', userId, persona, advisorAnswerId, questionId,
        sector, geo: 'global', period_key: mn,
        payload: { stage: talc.stage, confidence: round(talc.confidence) },
        content_hash: hash,
      });
    }
  }

  // 3. Demand / Supply — founders=demand, mentors/partners=supply.
  if (persona === 'founder' || persona === 'mentor' || persona === 'partner') {
    const side = persona === 'founder' ? 'demand' : 'supply';
    const tags = tagTopics(text);
    if (tags.length) {
      signals += await writeSignal(env, {
        extractor: 'demand_supply', userId, persona, advisorAnswerId, questionId,
        sector, geo: 'global', period_key: mn,
        payload: { side, topics: tags },
        content_hash: hash,
      });
    }
  }

  // 4. Sector heat — derived signal: tag every contribution to a sector
  //    so the reducer can compute heat = volume × |valence| per sector.
  if (sector !== 'global') {
    signals += await writeSignal(env, {
      extractor: 'sector_heat', userId, persona, advisorAnswerId, questionId,
      sector, geo: 'global', period_key: wk,
      payload: { contribution: 1, valence: round(sent.valence) },
      content_hash: hash,
    });
  }

  // 5. Thesis embedding — investors only, "thesis"-bearing questions.
  //    We embed once per user per question_id; UNIQUE upsert keeps it idempotent.
  if (persona === 'investor' && /thesis|invest|sector|stage|focus|conviction/i.test(questionId + ' ' + text)) {
    const wrote = await upsertEmbedding(env, userId, 'investor', 'thesis', questionId, text);
    if (wrote) embeds++;
  }
  // For founders, embed discovery/problem text so fit_match can run.
  if (persona === 'founder' && /discovery|problem|solution|why_now|customer|wedge|product/i.test(questionId + ' ' + text)) {
    const wrote = await upsertEmbedding(env, userId, 'founder', 'discovery', questionId, text);
    if (wrote) embeds++;
  }

  // 6. Fit match runs lazily (read-time) via reducer.recomputeFitMatch
  //    when a new investor thesis or founder discovery embedding arrives.
  //    No per-answer write here.

  return { signals_written: signals, embeddings_written: embeds };
}

function round(x: number): number { return Math.round(x * 1000) / 1000; }

async function writeSignal(env: Env, args: {
  extractor: string; userId: number; persona: string; advisorAnswerId: number | null | undefined;
  questionId: string; sector: string | null; geo: string | null; period_key: string;
  payload: Record<string, unknown>; content_hash: string;
}): Promise<number> {
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
    return (r as any).meta?.changes ? 1 : 1; // SQLite returns changes=0 on no-op upsert; treat both as ok
  } catch (e) {
    console.warn('[mi.extractors] writeSignal failed:', (e as Error).message);
    return 0;
  }
}

async function upsertEmbedding(env: Env, userId: number, persona: 'founder' | 'investor',
  kind: 'thesis' | 'discovery' | 'needs' | 'offerings', questionId: string, text: string): Promise<boolean> {
  const vec = await embedText(env, text);
  if (!vec) return false;
  const f32 = new Float32Array(vec);
  const blob = new Uint8Array(f32.buffer);
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm);
  const hash = await shortHash(text.toLowerCase().slice(0, 1024));
  try {
    await env.DB.prepare(
      `INSERT INTO market_intel_embeddings
         (user_id, persona, kind, source_question_id, vector, norm, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, kind) DO UPDATE SET
         vector = excluded.vector,
         norm = excluded.norm,
         source_question_id = excluded.source_question_id,
         content_hash = excluded.content_hash,
         updated_at = datetime('now')
       WHERE market_intel_embeddings.content_hash != excluded.content_hash`,
    ).bind(userId, persona, kind, questionId, blob, norm, hash).run();
    return true;
  } catch (e) {
    console.warn('[mi.extractors] upsertEmbedding failed:', (e as Error).message);
    return false;
  }
}

/**
 * Optional paraphrase pass — used only by the reducer when persisting
 * snippets. Returns null if the LLM refused or budget is exhausted.
 */
export async function paraphraseForSnippet(env: Env, userId: number, text: string): Promise<string | null> {
  if (!text || text.length < 20) return null;
  try {
    const r = await aiRun(env, {
      task: 'paraphrase',
      userId,
      systemPrompt: 'Paraphrase the input so no proper nouns, company names, or personally identifiable details remain. Keep it neutral, ≤ 220 chars, single sentence.',
      messages: [{ role: 'user', content: text.slice(0, 1200) }],
      maxTokens: 120, temperature: 0.2,
    });
    if (!r.ok || !r.output) return null;
    return r.output.trim().slice(0, 280);
  } catch (e) {
    console.warn('[mi.extractors] paraphrase failed:', (e as Error).message);
    return null;
  }
}
