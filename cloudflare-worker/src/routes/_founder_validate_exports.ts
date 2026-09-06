/**
 * The three Validate exports, as pure functions.
 *
 * Rows in, CSV string out — no `env`, no DB, no `fetch` — so each can be tested
 * against a fixture without standing up Hono or auth, the same split
 * `admin.conversations.helpers.ts` uses for the transcript export.
 *
 * WHAT THE CANVAS ASKED FOR AND WHAT THE PRODUCT HAS. The Validate canvas
 * labels the first of these "Export transcripts". There are no transcripts:
 * `discovery_interviews` has no transcript column, no recording, and no
 * severity — it has `notes` (free text carrying an optional quoted first line),
 * `pains_json`, `hypotheses_json`, and the four evidence columns migrations 072,
 * 074, 161 and 211 added. So the export is named for what it contains. Calling
 * it "transcripts" would be the same class of promise as a button posting to a
 * route the worker never declared.
 *
 * CONSENT IS THREE-STATE AND STAYS THAT WAY IN THE FILE. `quote_consent` is
 * yes, no, or never asked. A CSV that wrote `false` for never-asked would hand
 * a reader a spreadsheet saying every pre-211 interview declined; the column
 * writes `yes` / `no` / empty, and empty is how a CSV says "not recorded".
 */
import { toCsv } from '../services/csv';
import type { PainGroupsView } from '../services/painGroups';

export type ExportInterviewRow = {
  id: number;
  interviewee_name: string | null;
  interviewee_role: string | null;
  interviewee_company: string | null;
  interview_date: string | null;
  icp_fit: string | null;
  quote_consent: number | null;
  featured: number | null;
  validation_rating: number | null;
  validation_comment: string | null;
  notes: string | null;
  pains_json: string | null;
};

/** A JSON array column, or an empty list. A malformed blob is not a crash. */
function jsonList(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => (typeof p === 'string' ? p : String((p as any)?.pain ?? ''))).filter(Boolean);
  } catch {
    return [];
  }
}

/** yes / no / empty — never `false` for a question nobody asked. */
const consentCell = (v: number | null): string => (v == null ? '' : Number(v) === 1 ? 'yes' : 'no');

export const INTERVIEWS_CSV_HEADER = [
  'id', 'name', 'role', 'company', 'interview_date', 'icp_fit',
  'quote_consent', 'deck_eligible', 'solution_fit_rating', 'solution_fit_comment',
  'pains', 'notes',
] as const;

export function serializeInterviewsCsv(rows: readonly ExportInterviewRow[]): string {
  return toCsv(INTERVIEWS_CSV_HEADER, rows.map((r) => [
    r.id,
    r.interviewee_name,
    r.interviewee_role,
    r.interviewee_company,
    r.interview_date,
    // Empty, not "unknown": an unrecorded fit is a different thing from "not
    // our customer", and the board counts the two apart.
    r.icp_fit,
    consentCell(r.quote_consent),
    // Deck eligibility DERIVES from consent — it is not a second flag. The
    // canvas draws them as two columns and this keeps them one fact.
    Number(r.quote_consent) === 1 ? 'yes' : consentCell(r.quote_consent) === 'no' ? 'no' : '',
    r.validation_rating == null ? '' : r.validation_rating,
    r.validation_comment,
    jsonList(r.pains_json).join('; '),
    r.notes,
  ]));
}

export const PAIN_MAP_CSV_HEADER = [
  'theme', 'interviews', 'share_of_interviews', 'phrases',
] as const;

/**
 * The pain map, themes first and ungrouped phrases after.
 *
 * `count` is DISTINCT INTERVIEWS, not mentions — the same number the pain map
 * page shows. An earlier reading of that page computed frequency from
 * `phrases.length`, which counts wordings rather than people, and the two
 * disagree the moment two interviewees phrase one pain differently.
 *
 * Ungrouped phrases are exported too, marked as such. They are the reason a
 * theme's share does not sum to 100%, and omitting them would make the file
 * look complete while hiding the curation still to do.
 */
export function serializePainMapCsv(view: PainGroupsView): string {
  const total = Number(view.interview_total || 0);
  const share = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '');
  const rows: unknown[][] = view.groups.map((g) => [
    g.title,
    g.count,
    share(g.count),
    g.phrases.map((p) => p.display_phrase).join('; '),
  ]);
  for (const u of view.ungrouped) {
    rows.push([`(ungrouped) ${u.display_phrase}`, u.count, share(u.count), u.display_phrase]);
  }
  return toCsv(PAIN_MAP_CSV_HEADER, rows);
}

export type ExportHypothesis = {
  code: string;
  claim: string;
  lane: string;
  verdict: string | null;
  evidence: { supporting: number; contradicting: number; fitUnrecorded: number };
  bar_note: string | null;
  retired_at: string | null;
};

export type ExportDecision = {
  decision: string;
  reasoning: string | null;
  decided_at: string | null;
} | null;

export const SUMMARY_CSV_HEADER = [
  'code', 'claim', 'lane', 'verdict', 'for', 'against', 'fit_unrecorded',
  'distance_to_bar', 'retired_at',
] as const;

/**
 * The verdict summary: every claim with its evidence, and the founder's own
 * decision as a trailing block.
 *
 * The decision rides in this file rather than the board export because the two
 * have different readers — `canReadDecision` excludes partners, `canReadBoard`
 * does not — and a single export gated on the stricter rule is easier to reason
 * about than one that silently drops a section.
 *
 * `verdict` is null for a real reason and is written empty, not "unproven":
 * null means the evidence has not decided, which is not the same as evidence
 * that decided against.
 */
export function serializeSummaryCsv(
  hypotheses: readonly ExportHypothesis[],
  decision: ExportDecision,
): string {
  const table = toCsv(SUMMARY_CSV_HEADER, hypotheses.map((h) => [
    h.code,
    h.claim,
    h.lane,
    h.verdict,
    h.evidence.supporting,
    h.evidence.contradicting,
    h.evidence.fitUnrecorded,
    // Absent when the fits behind it are unrecorded — the board withholds this
    // rather than guessing, and so does the file.
    h.bar_note,
    h.retired_at,
  ]));
  const foot = decision
    ? toCsv(['decision', 'reasoning', 'decided_at'], [[decision.decision, decision.reasoning, decision.decided_at]])
    : toCsv(['decision'], [['not recorded']]);
  return `${table}\r\n\r\n${foot}`;
}
