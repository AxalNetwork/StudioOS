/**
 * #3938 part 2 (D1478 task 4, §4.2 fix 15) — a match row, done as the plan's
 * three steps: RETRIEVE (embed the query and each candidate with the job's
 * retrieve model, bge-m3, and keep the nearest by cosine), RANK (the
 * reranker, bge-reranker-base, orders those against the query), WRITE (one
 * line per kept row, why it fits, from the job's write model: llama-3.2-3b by
 * default, through `textJob`, so a member's pick and the plan's presets apply).
 *
 * The jobs: NE1 (introductions, best fit, co-founder, advisors), GR4 (rank
 * applicants), RA11 (match investors to the venture) and LE10 (recommended for
 * you). Every step is the member's press, through `run()`: quoted, held,
 * guarded and charged on the caller's page and rail.
 *
 * DEGRADING, NEVER INVENTING. An embedding that cannot be read keeps the
 * candidates' own order (`retrieved: false`); a refused rank keeps the
 * retrieval's order (`ranked: false`); a line the writer did not give is
 * `null`, never a made-up reason. The caller shows its own rule-based reason
 * where a line is null.
 */
import type { Env } from '../../types';
import { run as aiRun, type RunOptions } from '../aiRouter';
import { jobStep } from './modelUseCases';
import { orderByRanking, rank } from './decide';
import type { RankedContext } from './shapes';
import { runRefusalView } from '../../util/railContext';
import type { RunResult } from '../aiRouter';

export type MatchJob = 'NE1' | 'GR4' | 'RA11' | 'LE10';
export type MatchCandidate = { key: string; text: string };
export type MatchRow = { key: string; position: number; line: string | null };
export type MatchResult = { rows: MatchRow[]; steps: { retrieved: boolean; ranked: boolean; written: boolean } };
type Charge = Pick<RunOptions, 'userId' | 'surface' | 'rail' | 'guardText'>;

export const CANDIDATES_MAX = 60;
export const RECALL = 20;
export const LINE_MAX = 160;

export type MatchDeps = {
  embed(text: string): Promise<number[] | null>;
  rerank(query: string, contexts: string[]): Promise<RankedContext[] | null>;
  write(prompt: string, rows: number): Promise<string | null>;
};

/** The job's retrieve and write models, from the plan's rows. */
export function jobModels(job: MatchJob): { retrieve: string; write: string } {
  const retrieve = jobStep(job, 0)?.default;
  const write = jobStep(job, 2)?.default;
  if (!retrieve || !write) throw new Error(`match job ${job} has no retrieve or write step`);
  return { retrieve, write };
}

/**
 * A run the member must hear about (the page switched off, a budget stop, the
 * guard, a plan lock): the press stops and the route answers it in its words
 * (`refuseRun`). Anything else, a model that cannot be reached, degrades.
 */
export class MatchRefused extends Error {
  readonly result: RunResult;
  constructor(result: RunResult) { super('match_refused'); this.result = result; }
}
const stopOn = (out: RunResult) => { if (!out.ok && runRefusalView(out)) throw new MatchRefused(out); };

export function defaultMatchDeps(env: Env, charge: Charge, job: MatchJob): MatchDeps {
  const { retrieve } = jobModels(job);
  return {
    async embed(text) {
      const out = await aiRun(env, { ...charge, surface: charge.surface, task: 'module_embed' as RunOptions['task'], model: retrieve, text });
      stopOn(out);
      return out.ok && Array.isArray(out.embedding) && out.embedding.length ? out.embedding : null;
    },
    async rerank(query, contexts) {
      const r = await rank(env, charge, { query, contexts });
      if (!r.ok) stopOn(r.result);
      return r.ok ? r.ranking : null;
    },
    async write(prompt, rows) {
      // The job's write step (`textJob`), so the member's pick and the presets apply.
      const out = await aiRun(env, {
        ...charge, surface: charge.surface, task: 'module_chat' as RunOptions['task'], textJob: job, maxTokens: Math.min(60 * rows, 900), temperature: 0.2,
        systemPrompt: 'You explain matches in plain words. One line per numbered candidate, at most 25 words, why it fits. Use only what the candidate text says; never invent a figure, a name or a fact. Never give advice. Reply only with the numbered lines.',
        messages: [{ role: 'user', content: prompt }],
      });
      stopOn(out);
      return out.ok && typeof out.output === 'string' ? out.output : null;
    },
  };
}

/** The seam the routes build their deps through; tests replace `make`. */
export const MATCH_DEPS: { make: (env: Env, charge: Charge, job: MatchJob) => MatchDeps } = { make: defaultMatchDeps };

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return -Infinity;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : -Infinity;
}

/** The writer's numbered lines: `1. …` per row; a missing or empty line is null. */
export function readLines(output: string | null, rows: number): Array<string | null> {
  const out: Array<string | null> = Array.from({ length: rows }, () => null);
  for (const raw of (output ?? '').split(/\r?\n/)) {
    const m = /^\s*(\d{1,2})[.)]\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    const text = m[2].replace(/\s+/g, ' ').trim().slice(0, LINE_MAX);
    if (i >= 0 && i < rows && text && out[i] == null) out[i] = text;
  }
  return out;
}

const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

export async function matchRows(query: string, candidates: MatchCandidate[], deps: MatchDeps, opts: { top?: number; write?: boolean } = {}): Promise<MatchResult> {
  const q = clip(query, 600);
  const pool = candidates.filter((c) => c.text.trim()).slice(0, CANDIDATES_MAX).map((c) => ({ ...c, text: clip(c.text, 800) }));
  const top = Math.max(1, Math.min(opts.top ?? 10, RECALL));
  if (!q || !pool.length) return { rows: [], steps: { retrieved: false, ranked: false, written: false } };

  // 1. Retrieve: the nearest by cosine, or the candidates' own order when the embeddings cannot be read.
  let recalled = pool;
  let retrieved = false;
  const qv = await deps.embed(q);
  if (qv) {
    const scored: Array<{ c: MatchCandidate; s: number }> = [];
    let all = true;
    for (const c of pool) {
      const v = await deps.embed(c.text);
      if (!v) { all = false; break; }
      scored.push({ c, s: cosine(qv, v) });
    }
    if (all) {
      recalled = scored.sort((x, y) => y.s - x.s).slice(0, RECALL).map((x) => x.c);
      retrieved = true;
    }
  }
  if (!retrieved) recalled = pool.slice(0, RECALL);

  // 2. Rank: the reranker's order, or the retrieval's when it is refused.
  let ordered = recalled;
  let ranked = false;
  const ranking = await deps.rerank(q, recalled.map((c) => c.text));
  if (ranking) { ordered = orderByRanking(recalled, ranking); ranked = true; }
  const kept = ordered.slice(0, top);

  // 3. Write: one line per kept row, or null where the writer gave none.
  let lines: Array<string | null> = kept.map(() => null);
  let written = false;
  if (opts.write !== false) {
    const prompt = [`What the member is looking for: ${q}`, '', 'Candidates:', ...kept.map((c, i) => `${i + 1}. ${c.text}`)].join('\n');
    const out = await deps.write(prompt, kept.length);
    if (out != null) { lines = readLines(out, kept.length); written = lines.some((l) => l != null); }
  }
  return { rows: kept.map((c, i) => ({ key: c.key, position: i + 1, line: lines[i] })), steps: { retrieved, ranked, written } };
}
