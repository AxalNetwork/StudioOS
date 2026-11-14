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
    jsonList(r.pains_json).length === 0 ? '' : Number(r.quote_consent) === 1
      ? jsonList(r.pains_json).join('; ') : 'Withheld (no consent to quote)',
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
 * page shows.
 *
 * THAT SENTENCE WAS AN ASSERTION, NOT AN OBSERVATION, and it was wrong for as
 * long as it stood. It went on to say an "earlier reading of that page computed
 * frequency from `phrases.length`, which counts wordings rather than people" —
 * and that reading was still the live one: `FounderValidateWorkspace`'s pain map
 * divided `g.phrases.length` by the interview total, ranked by it, and quoted it
 * in its own footnote. So this file and that page rendered one record two
 * different ways one screen apart, with this comment vouching for the agreement.
 *
 * Worse than a disagreement about wording: `analyzePains` seeds every curated
 * alias as a phrase whether or not an interview logged it, so a theme with three
 * curated wordings and no mentions at all drew "3 phrases · 150%" with its bar
 * pinned at 100% while this export wrote `0` and `0%` for the same theme. The
 * page reads `count` now, `zone_actions.test.mjs` fails if the numerator ever
 * goes back to a length, and the sentence above is true.
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

// ---------------------------------------------------------------------------
// D6019 (#6019): the competitor list, the demand signals, and the evidence
// behind each claim with its experiments. Same contract as the three above:
// rows in, CSV out, and an empty cell is "not recorded", never `0`.
// ---------------------------------------------------------------------------

export type ExportCompetitorRow = {
  name: string;
  kind: string;
  latest_signal: string | null;
  latest_on: string | null;
  source_url: string | null;
  source_kind: string | null;
};

export const COMPETITORS_CSV_HEADER = [
  'company', 'kind', 'latest_signal', 'latest_signal_date', 'source',
] as const;

/**
 * The tracked list, one row per competitor, exactly as Market intelligence lists
 * it (`loadTracked`): a name the venture stopped tracking is not in the file.
 * A competitor with no signal writes empty signal cells, not "none": nobody
 * recorded one, which is not the same as the competitor having done nothing.
 */
export function serializeCompetitorsCsv(rows: readonly ExportCompetitorRow[]): string {
  return toCsv(COMPETITORS_CSV_HEADER, rows.map((c) => [
    c.name,
    c.kind,
    c.latest_signal,
    c.latest_on,
    c.source_url ?? c.source_kind,
  ]));
}

export type ExportSignalRow = {
  key: string;
  signal: string;
  who: string | null;
  /** Major units as exact decimal text (`toMajorString`), or null when no amount is recorded or it cannot be read. */
  amount: string | null;
  currency: string | null;
  period: string | null;
  date: string | null;
  counts: string;
};

export const SIGNALS_CSV_HEADER = [
  'id', 'signal', 'who', 'amount', 'currency', 'period', 'date', 'counts',
] as const;

/** Anything shaped like an email address. A waitlist name cell never carries one. */
const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Demand and urgency signals: recorded signals, paid pre-sales and waitlist
 * sign-ups, the one population the module lists (`demandRowsOf`).
 *
 * A WAITLIST ROW CARRIES NO EMAIL ADDRESS. The read never selects the address,
 * and a sign-up who typed their address into the name field is written with an
 * empty name: a person who joined a waitlist did not agree to have their address
 * passed around in a spreadsheet.
 *
 * An amount that is absent is empty, never `0`; its currency is written only
 * beside an amount.
 */
export function serializeSignalsCsv(rows: readonly ExportSignalRow[]): string {
  return toCsv(SIGNALS_CSV_HEADER, rows.map((r) => {
    const waitlist = r.key.startsWith('waitlist-');
    const who = waitlist && r.who != null && EMAILISH.test(r.who) ? null : r.who;
    return [
      r.key,
      r.signal,
      who,
      r.amount,
      r.amount == null ? null : r.currency,
      r.period,
      r.date,
      r.counts,
    ];
  }));
}

export type ExportClaim = { id: number; code: string; claim: string; retired_at: string | null };

export type ExportEvidenceItem = {
  id: string;
  hypothesis_id: number;
  kind: string;
  label: string;
  direction: string;
  strength: string | null;
  date: string | null;
};

export type ExportDecisionCitation = {
  ref_id: string;
  decision: string;
  state: string | null;
  decided_at: string | null;
  superseded_at: string | null;
};

export type ExportExperiment = {
  hypothesis_id: number;
  title: string;
  method: string | null;
  target: string | null;
  status: string;
  result: string | null;
};

export const EVIDENCE_CSV_HEADER = [
  'code', 'claim', 'retired_at', 'evidence_id', 'kind', 'evidence', 'direction', 'strength', 'date', 'decisions',
] as const;

export const EXPERIMENTS_CSV_HEADER = [
  'code', 'experiment', 'method', 'target', 'status', 'result', 'observed',
] as const;

/** `proceed 2026-10-12`, with `(withheld)` and `(superseded)` said when they apply. */
function citationText(d: ExportDecisionCitation): string {
  return [
    d.decision,
    d.decided_at ? String(d.decided_at).slice(0, 10) : null,
    d.state === 'withheld' ? '(withheld)' : null,
    d.superseded_at ? '(superseded)' : null,
  ].filter(Boolean).join(' ');
}

/**
 * Every claim's linked evidence, then its experiments as a second block.
 *
 * The evidence rows are the record's Evidence section (`evidenceFor`): an
 * interview behind a pain link, or a directly linked interview, demand signal,
 * metric or experiment, each with its direction, strength and date. An
 * interview is named by its date and theme, never by the interviewee's words, so
 * no quote reaches this file whatever the consent.
 *
 * A claim with nothing linked still has a row, reading "No evidence linked",
 * so the file cannot be read as missing the claim.
 *
 * `decisions` names the Verdict decisions that rested on the item. That column
 * is why the route is gated as the summary is (`canReadDecision`).
 *
 * `observed` is yes only when the experiment has a result (D4586 § 4): a done
 * experiment with no result recorded is context, not a finding.
 */
export function serializeEvidenceCsv(
  claims: readonly ExportClaim[],
  items: readonly ExportEvidenceItem[],
  citations: readonly ExportDecisionCitation[],
  experiments: readonly ExportExperiment[],
): string {
  const citedBy = new Map<string, string[]>();
  for (const d of citations) {
    const list = citedBy.get(d.ref_id) ?? [];
    list.push(citationText(d));
    citedBy.set(d.ref_id, list);
  }
  const itemsBy = new Map<number, ExportEvidenceItem[]>();
  for (const it of items) {
    const list = itemsBy.get(Number(it.hypothesis_id)) ?? [];
    list.push(it);
    itemsBy.set(Number(it.hypothesis_id), list);
  }
  const rows: unknown[][] = [];
  for (const h of claims) {
    const own = itemsBy.get(Number(h.id)) ?? [];
    if (own.length === 0) {
      rows.push([h.code, h.claim, h.retired_at, null, null, 'No evidence linked', null, null, null, null]);
      continue;
    }
    for (const it of own) {
      rows.push([
        h.code, h.claim, h.retired_at, it.id, it.kind, it.label, it.direction, it.strength, it.date,
        (citedBy.get(it.id) ?? []).join('; '),
      ]);
    }
  }
  const codeOf = new Map(claims.map((h) => [Number(h.id), h.code]));
  const table = toCsv(EVIDENCE_CSV_HEADER, rows);
  const exps = toCsv(EXPERIMENTS_CSV_HEADER, experiments.map((x) => {
    const observed = typeof x.result === 'string' && x.result.trim() !== '';
    return [codeOf.get(Number(x.hypothesis_id)) ?? null, x.title, x.method, x.target, x.status, observed ? x.result : null, observed ? 'yes' : 'no'];
  }));
  return `${table}\r\n\r\n${exps}`;
}
