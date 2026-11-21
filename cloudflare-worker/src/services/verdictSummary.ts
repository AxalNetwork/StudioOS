/**
 * D6862 (#6862, D6021 V17/V18) — Eadwyn's read of the evidence offered for one
 * decision, before it is recorded: rows, each citing one evidence key, never
 * prose and never a choice.
 *
 * WHO DECIDES WHAT. The server sorts every checked row into Contradicts,
 * Supports or Checked but not counted, by the same count a decision uses
 * (`offeredCoverage` in `services/verdict.ts`, D4586's `decisionEvidenceV2`).
 * The model writes only one short line per row, keyed by a token the server
 * gave it (`E1`…). A line that cites no offered row is dropped; a row the
 * model left out, or a line that reads as a choice ("proceed", "pivot",
 * "stop", "recommend", "should"…), falls back to the row's own label. So the
 * model can neither move a row between groups, cite evidence that was not
 * offered, nor pick Proceed, Pivot or Stop. "What would change this" is the
 * hypothesis's own disproof, success bar and deadline, read here, never
 * written by the model.
 *
 * Nothing is stored: the text is saved only if the founder uses it as reasoning.
 *
 * #5130's shell-wide rail task system is not on `main`, so this is a Worker
 * endpoint (`routes/verdict_summary.ts`) the page's task card calls.
 */
import type { Env } from '../types';
import { offeredCoverage, VerdictError, DECISION_EVIDENCE_BAR, type EvidenceSource, type Scope, type OfferedCoverage } from './verdict';
import { untrustedBlock, withUntrustedRule } from './ai/untrusted';
import type { Exclusion } from './validateMethodology';

export const SUMMARY_PAGE = 'Founder · Validate · Verdict';
export const SUMMARY_OPTION = 'summary:verdict-evidence';
export const MAX_LINE = 160;

export type SummaryGroup = 'contradicts' | 'supports' | 'not_counted';
export type SummaryRow = { key: string; group: SummaryGroup; text: string; reason: Exclusion | null; from_label: boolean };
export type ChangeFacts = { code: string | null; disproof: string | null; success_bar: string | null; deadline: string | null } | null;
export type SummaryFacts = OfferedCoverage & { change: ChangeFacts };

/** The words that would make a line read as a choice. Eadwyn never picks the decision. */
const CHOICE_WORDS = /\b(proceed|proceeding|pivot|pivoting|stop|stopping|recommend\w*|should|must|advis\w*|suggest\w*|decide\w*|decision)\b/i;

const SYSTEM = withUntrustedRule([
  'You read the evidence a founder has offered for one decision.',
  'For each row, write one short neutral line (at most 120 characters) saying what that row shows, in plain words.',
  'Never choose, suggest or rank a decision. Never use the words proceed, pivot, stop, recommend, should or must.',
  'Answer with JSON only: {"rows":[{"row":"E1","text":"…"}]}, one entry per row, using the row tokens given.',
].join(' '));

const groupOf = (it: OfferedCoverage['items'][number]): SummaryGroup =>
  (it.excluded ? 'not_counted' : it.direction === 'contradicts' ? 'contradicts' : 'supports');

/** The checked rows, counted, with the hypothesis's own disproof, success bar and deadline. */
export async function summaryFacts(
  env: Env, projectId: number, scope: Scope, keys: unknown, { evidenceSource }: { evidenceSource?: EvidenceSource } = {},
): Promise<SummaryFacts> {
  const counted = await offeredCoverage(env, projectId, scope, keys, evidenceSource ? { evidenceSource } : {});
  if (!counted.items.length) throw new VerdictError(409, 'Nothing to read yet. Offer evidence for this decision first.', 'no_evidence');
  const change = scope === 'venture' ? null : await env.DB.prepare(
    'SELECT code, disproof, success_bar, deadline FROM hypotheses WHERE id = ? AND project_id = ?',
  ).bind(scope, projectId).first<{ code: string | null; disproof: string | null; success_bar: string | null; deadline: string | null }>();
  const text = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    ...counted,
    change: change ? { code: change.code, disproof: text(change.disproof), success_bar: text(change.success_bar), deadline: text(change.deadline) } : null,
  };
}

/** The prompt: each row as a token, its group and its label, the labels as untrusted record text. */
export function summaryPrompt(facts: SummaryFacts): string {
  const lines = facts.items.map((it, i) => `E${i + 1} (${groupOf(it).replace('_', ' ')}): ${it.label}`).join('\n');
  return `Rows offered for this decision:\n${untrustedBlock('record_text', lines)}`;
}

export const summarySystem = () => SYSTEM;

/** The model's lines, matched to the rows by token; null when nothing in the reply could be read. */
export function parseSummary(output: unknown, facts: SummaryFacts): SummaryRow[] | null {
  const raw = typeof output === 'string' ? output : '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let parsed: unknown = null;
  if (start >= 0 && end > start) { try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { parsed = null; } }
  const list = parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows) ? (parsed as { rows: unknown[] }).rows : null;
  if (!list) return null;
  const lines = new Map<number, string>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const m = /^E([1-9][0-9]{0,2})$/.exec(String((entry as { row?: unknown }).row ?? '').trim());
    const n = m ? Number(m[1]) : 0;
    // A token the server did not give, or a second line for one row, is dropped.
    if (!n || n > facts.items.length || lines.has(n)) continue;
    const text = String((entry as { text?: unknown }).text ?? '').replace(/\s+/g, ' ').trim();
    if (text && !CHOICE_WORDS.test(text)) lines.set(n, text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text);
  }
  if (!lines.size) return null;
  return facts.items.map((it, i) => {
    const own = lines.get(i + 1);
    return { key: it.id, group: groupOf(it), text: own ?? it.label, reason: it.excluded, from_label: own == null };
  });
}

/** The response body: the rows in the canvas's order (Contradicts first), the coverage and what would change it. */
export function summaryBody(rows: SummaryRow[], facts: SummaryFacts) {
  const order: SummaryGroup[] = ['contradicts', 'supports', 'not_counted'];
  const c = facts.coverage;
  return {
    rows: order.flatMap((g) => rows.filter((r) => r.group === g)),
    keys: facts.items.map((it) => it.id),
    coverage: { counted: c.counted, bar: c.bar ?? DECISION_EVIDENCE_BAR, sources: c.sources, links: c.links, interviews: c.interviews, state: c.state },
    change: facts.change,
  };
}
