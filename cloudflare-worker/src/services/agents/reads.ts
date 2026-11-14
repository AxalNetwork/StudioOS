/**
 * D1528 (#3847, E3 of #3742) — the read functions a run's `context` step may
 * call: one per rule book `reads` key (`catalogue.ts` READ_KEYS). A key with
 * no function here is refused `read_unavailable`, never skipped: an agent
 * whose rule book names a read it cannot have does not run on less than it
 * was told it would see.
 *
 * Each read:
 *   - runs as the agent's sponsor, inside the scope: the caller checks the
 *     sponsor still reads the scope (and, for a company agent's project, that
 *     the project is still the company's) before calling any;
 *   - answers `{ untrusted: true, data }` and at most `READ_MAX` bytes of
 *     JSON: what a person typed into a record is data, never instructions;
 *   - never answers an email or a numeric user id.
 *
 * Built: the project and company summaries, the team roster, the four
 * cycles' records (their activity lines, D690) and the typed records
 * (Mercury balances, Stripe revenue, the cap table, board metrics, burn, the
 * raise pipeline, transcripts and diligence). The data room, research, network,
 * compliance, GitHub and Vercel are not built yet and refuse `read_unavailable`.
 *
 * D4667 (#4667) — EVIDENCE, NOT JUST DATA. A read says what it covers. A collection
 * carries `returned`, `total` and `omitted` (counted, not guessed: `total` is
 * `null` when it could not be counted, never 0); a row carries a stable
 * reference (`activity:<uid>`) and says when its text was clipped; an answer
 * too large for `READ_MAX` drops whole rows from the end and says how many, or
 * says `incomplete`, and is never a JSON substring. An unknown count is
 * unavailable, never zero. The preflight that reads this is `skillInputs.ts`.
 *
 * Bound SQL only.
 */
import type { Env } from '../../types';
import type { AgentRow, Scope } from './teams';
import { isTeamViewer } from '../mercury/teamViewer';
import { atLeast, resolveAccess } from '../captableAccess';
import { readRecord } from '../capTableRecord';
import { heldLicences } from '../accountLicences';
import { canWrite } from '../../routes/_founder_validate_helpers';

export const READ_MAX = 8 * 1024;
/**
 * `page` (D4667, second slice): optional, for complete-period work. `after` is a row's `ref` from the page before
 * (the continuation), `from`/`to` bound the period by the record's own date (`YYYY-MM-DD`, inclusive). A run's
 * default context passes none and reads the latest page, as before.
 */
export type ReadPage = { after?: string | null; from?: string | null; to?: string | null };
export type ReadContext = { scope: Scope; agent: AgentRow; projectId: number | null; page?: ReadPage };
export type ReadResult = { untrusted: true; data: unknown; truncated?: true; incomplete?: true; reason?: 'too_large' };

/** What one collection in a read covers. `total` is null when it could not be counted. */
export type Coverage = { returned: number; total: number | null; omitted: number | null; complete: boolean };
export const coverageOf = (returned: number, total: number | null): Coverage => ({
  returned, total, omitted: total === null ? null : Math.max(0, total - returned), complete: total !== null && total <= returned,
});
type Reader = (env: Env, c: ReadContext) => Promise<unknown>;

const cut = (v: unknown, n = 600) => (typeof v === 'string' ? v.slice(0, n) : v ?? null);

const RECORD_LIMIT = 20;
const SUMMARY_MAX = 300;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVITY_REF = /^activity:([a-f0-9]{32})$/;

/** A page request that cannot be honoured is refused, never widened to the whole history. */
export class ReadPageError extends Error {
  readonly code: 'invalid_page' | 'unknown_cursor';
  constructor(code: 'invalid_page' | 'unknown_cursor') { super(code); this.code = code; }
}

async function cycleRecords(env: Env, c: ReadContext, cycle: string) {
  if (!c.projectId) return { records: [], coverage: coverageOf(0, null), scope: 'no_project' };
  const like = `${cycle}.%`;
  const page = c.page ?? {};
  const from = page.from ?? null;
  const to = page.to ?? null;
  if ((from !== null && !DAY.test(from)) || (to !== null && !DAY.test(to)) || (from && to && from > to)) throw new ReadPageError('invalid_page');
  // The period, by the record's own date, and the continuation: fixed SQL, every value bound (a null bound is no bound).
  const lo = from ? `${from} 00:00:00` : null;
  const hi = to ? `${to} 23:59:59` : null;
  const scopeArgs = [c.projectId, like, lo, lo, hi, hi];
  // Rows older than the one the last page ended on, in the same project, cycle and period.
  let afterId: number | null = null;
  if (page.after != null) {
    const m = ACTIVITY_REF.exec(String(page.after));
    if (!m) throw new ReadPageError('invalid_page');
    const row = await env.DB.prepare(
      'SELECT id FROM activity_logs WHERE uid = ? AND project_id = ? AND entity_type LIKE ? AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at <= ?)',
    ).bind(m[1], ...scopeArgs).first<{ id: number }>();
    if (!row) throw new ReadPageError('unknown_cursor');
    afterId = Number(row.id);
  }
  const r = await env.DB.prepare(
    `SELECT uid, entity_type, action, details, created_at FROM activity_logs
      WHERE project_id = ? AND entity_type LIKE ? AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at <= ?)
        AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
  ).bind(...scopeArgs, afterId, afterId, RECORD_LIMIT + 1).all<{ uid: string; entity_type: string; action: string; details: string | null; created_at: string }>();
  const rows = r.results ?? [];
  const more = rows.length > RECORD_LIMIT;
  // The whole count of the period, apart from the page: a total is never inferred from the page.
  const n = await (async () => env.DB.prepare(
    'SELECT COUNT(*) AS n FROM activity_logs WHERE project_id = ? AND entity_type LIKE ? AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at <= ?)',
  ).bind(...scopeArgs).first<{ n: number }>())().catch(() => null);
  const records = rows.slice(0, RECORD_LIMIT).map((x) => ({
    ref: `activity:${x.uid}`,
    module: x.entity_type.slice(cycle.length + 1), action: x.action, summary: cut(x.details, SUMMARY_MAX), at: x.created_at,
    ...(typeof x.details === 'string' && x.details.length > SUMMARY_MAX ? { clipped: true } : {}),
  }));
  const total = n && Number.isFinite(Number(n.n)) ? Number(n.n) : null;
  // A first page keeps the whole-collection coverage it always had. A later page says what it holds, and the
  // period's total; `pages()` below is what adds the pages up.
  return {
    records, coverage: coverageOf(records.length, total), source: 'activity_logs',
    period: { from, to }, page: { after: page.after ?? null, next: more ? records[records.length - 1].ref : null },
  };
}

/**
 * The sponsor may not read this source for this venture (D4667, second slice): a typed reader checks the source's
 * own rule as the sponsor, and answers this rather than an empty record, so a run's context says so in place and
 * the preflight reports `withheld`. It is not "nothing recorded", and it carries none of the source's data.
 */
export type Withheld = { withheld: true; reason: string };
const withheld = (reason: string): Withheld => ({ withheld: true, reason });
export const isWithheld = (v: unknown): v is Withheld => !!v && typeof v === 'object' && (v as Withheld).withheld === true;

async function sponsorOf(env: Env, c: ReadContext) {
  const id = Number((c.agent as AgentRow | undefined)?.sponsor_user_id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  // As auth hydrates a caller: the row and the licences it holds, so a source's own rule sees the same person.
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').bind(id).first<any>();
  if (!u) return null;
  return { ...u, licences: await heldLicences(env.DB as any, { id: Number(u.id), role: u.role }) };
}

const REVENUE_LIMIT = 200;
const MONTHS_BACK = 12;
const monthsAgo = (now: Date, n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1)).toISOString().slice(0, 10);

/**
 * D4667 (second slice) — the typed readers. Each answers records with their own stable reference, the unit each
 * amount is in, its currency (or `null` where the source records none: never assumed), its date and the coverage of
 * what was read. Each checks the source's own rule as the agent's sponsor first.
 */
const TYPED: Partial<Record<string, Reader>> = {
  // The venture's own Mercury, as Grow records it (D1384 `mercury_grow_facts`): its cash and treasury now. The team
  // only, as Grow shows it (`isTeamViewer`). Per-account balances are not recorded for a venture, only the totals.
  'mercury.balances': async (env, c) => {
    if (!c.projectId) return null;
    const who = await sponsorOf(env, c);
    if (!who || !(await isTeamViewer(env, { id: Number(who.id), founder_id: who.founder_id ?? null }, c.projectId))) {
      return withheld('Only the venture\'s team reads its Mercury figures.');
    }
    const rows = (await env.DB.prepare(
      `SELECT id, kind, amount_cents, as_of FROM mercury_grow_facts
        WHERE project_id = ? AND kind IN ('cash', 'treasury') AND period = 'current' ORDER BY kind, id`,
    ).bind(c.projectId).all<{ id: number; kind: string; amount_cents: number | null; as_of: string }>()).results ?? [];
    const records = rows.map((r) => ({
      ref: `mercury_fact:${r.id}`, kind: r.kind, amount: r.amount_cents == null ? null : Number(r.amount_cents),
      unit: 'cents', currency: null, at: r.as_of,
    }));
    return { records, coverage: coverageOf(records.length, records.length), source: 'mercury_grow_facts', currency_note: 'Mercury records no currency on these facts.' };
  },
  // Revenue the venture recorded or imported (`revenue_entries`: Stripe, Mercury, CSV or typed), in a period (default
  // the last twelve months). Monthly totals are given per currency only when every entry of the period was read.
  'stripe.revenue': async (env, c) => {
    if (!c.projectId) return null;
    const page = c.page ?? {};
    if ((page.from != null && !DAY.test(page.from)) || (page.to != null && !DAY.test(page.to))) throw new ReadPageError('invalid_page');
    const from = page.from ?? monthsAgo(new Date(), MONTHS_BACK);
    const to = page.to ?? new Date().toISOString().slice(0, 10);
    if (from > to) throw new ReadPageError('invalid_page');
    const rows = (await env.DB.prepare(
      `SELECT uid, amount_cents, currency, revenue_type, received_on, source, verification FROM revenue_entries
        WHERE project_id = ? AND received_on >= ? AND received_on <= ? ORDER BY received_on DESC, id DESC LIMIT ?`,
    ).bind(c.projectId, from, to, REVENUE_LIMIT).all<any>()).results ?? [];
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM revenue_entries WHERE project_id = ? AND received_on >= ? AND received_on <= ?')
      .bind(c.projectId, from, to).first<{ n: number }>().catch(() => null);
    const records = rows.map((r) => ({
      ref: `revenue:${r.uid}`, amount: Number(r.amount_cents), unit: 'cents', currency: String(r.currency || '').toUpperCase() || null,
      type: r.revenue_type, at: r.received_on, source: r.source, verification: r.verification,
    }));
    const coverage = coverageOf(records.length, n && Number.isFinite(Number(n.n)) ? Number(n.n) : null);
    const byMonth = coverage.complete
      ? Object.values(records.reduce<Record<string, { month: string; currency: string | null; amount: number; entries: number; unit: 'cents' }>>((m, r) => {
        const k = `${r.at.slice(0, 7)}|${r.currency}`;
        m[k] ??= { month: r.at.slice(0, 7), currency: r.currency, amount: 0, entries: 0, unit: 'cents' };
        m[k].amount += r.amount; m[k].entries += 1;
        return m;
      }, {})).sort((a, b) => a.month.localeCompare(b.month))
      : null;
    return { records, coverage, period: { from, to }, by_month: byMonth, source: 'revenue_entries' };
  },
  // The cap table record (D1015 `cap_table_*`), only at Full access for the sponsor (`resolveAccess`, the cap
  // table's own rule): an agent never reads a holding its sponsor could not open in full.
  'cap_table.read': async (env, c) => {
    if (!c.projectId) return null;
    const project = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(c.projectId).first<{ id: number; founder_id: number | null }>();
    if (!project) return null;
    const who = await sponsorOf(env, c);
    const access = who ? await resolveAccess(env, who, project) : null;
    if (!access || !access.ok || !atLeast(access.level, 'full')) return withheld('The sponsor may not open this cap table in full.');
    const rec: any = await readRecord(env, c.projectId);
    return {
      ref: `cap_table:${c.projectId}`, currency: rec.currency?.code ?? null, currency_set: rec.currency?.source === 'set',
      units: { shares: 'shares', money: 'cents', price_per_share: 'micros', rates: 'bps' },
      classes: rec.by_class ?? null, holders: rec.by_holder ?? null, outstanding: rec.outstanding ?? null, fully_diluted: rec.fully_diluted ?? null,
      instruments: rec.instruments ?? null,
      source: 'cap_table_record',
    };
  },
};

/** The venture's founder and the sponsor, for a gate that reads the venture's own records. */
async function ventureAndSponsor(env: Env, c: ReadContext) {
  if (!c.projectId) return null;
  const project = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(c.projectId).first<{ id: number; founder_id: number | null }>();
  if (!project) return null;
  return { project, who: await sponsorOf(env, c) };
}

const PIPELINE_LIMIT = 200;
const SESSION_LIMIT = 3;
const SEGMENT_LIMIT = 200;
const centsOf = (cents: unknown, dollars: unknown) => (cents != null && Number.isFinite(Number(cents)) ? Number(cents)
  : dollars != null && Number.isFinite(Number(dollars)) ? Math.round(Number(dollars) * 100) : null);

/**
 * D4667 (third slice, owner's answer A) — four read keys of their own, so an agent reads these records only when
 * its rule book names them. Each is typed, scope-bound and gated as the sponsor. A field the source does not record
 * is named in `missing_fields`, never filled in; the preflight then calls the input partial.
 */
const TYPED_MORE: Partial<Record<string, Reader>> = {
  'grow.board_metrics': async (env, c) => {
    if (!c.projectId) return null;
    const who = await sponsorOf(env, c);
    if (!who || !(await isTeamViewer(env, { id: Number(who.id), founder_id: who.founder_id ?? null }, c.projectId))) {
      return withheld('Only the venture’s team reads its recorded board metrics.');
    }
    const now = new Date();
    const from = c.page?.from ?? monthsAgo(now, 3);
    const to = c.page?.to ?? now.toISOString().slice(0, 10);
    if (c.page?.after || !DAY.test(from) || !DAY.test(to) || from > to) throw new ReadPageError('invalid_page');
    const rows = (await env.DB.prepare(
      `SELECT v.uid, k.label, k.unit, k.currency, v.as_of, v.value, v.value_cents, v.source
         FROM custom_kpi_values v JOIN custom_kpis k ON k.id = v.kpi_id
        WHERE k.project_id = ? AND v.as_of >= ? AND v.as_of <= ?
        ORDER BY v.as_of DESC, v.id DESC LIMIT ?`,
    ).bind(c.projectId, from, to, PIPELINE_LIMIT).all<{
      uid: string; label: string; unit: 'money' | 'pct' | 'count'; currency: string | null;
      as_of: string; value: number | null; value_cents: number | null; source: string;
    }>()).results ?? [];
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM custom_kpi_values v JOIN custom_kpis k ON k.id = v.kpi_id
        WHERE k.project_id = ? AND v.as_of >= ? AND v.as_of <= ?`,
    ).bind(c.projectId, from, to).first<{ n: number }>().catch(() => null);
    const records = rows.map(row => ({
      ref: `custom_kpi_value:${row.uid}`, at: row.as_of, label: row.label,
      value: row.unit === 'money' ? row.value_cents : row.value,
      unit: row.unit === 'money' ? 'cents' : row.unit,
      currency: row.unit === 'money' ? row.currency : null, source: row.source,
    }));
    const missingUnits = records.some(record => record.value == null || (record.unit === 'cents' && !record.currency));
    return {
      records, coverage: coverageOf(records.length, count?.n ?? null), period: { from, to },
      source: 'custom_kpi_values', ...(missingUnits ? { missing_fields: ['value or currency'] } : {}),
    };
  },
  // Net burn from the venture's metrics (`project_metrics`: typed by the founder, or fed from Stripe or Mercury),
  // by snapshot date, in a period (default the last twelve months). The team only, as Mercury's figures are.
  'grow.burn': async (env, c) => {
    if (!c.projectId) return null;
    const who = await sponsorOf(env, c);
    if (!who || !(await isTeamViewer(env, { id: Number(who.id), founder_id: who.founder_id ?? null }, c.projectId))) {
      return withheld('Only the venture\'s team reads its burn.');
    }
    const page = c.page ?? {};
    if ((page.from != null && !DAY.test(page.from)) || (page.to != null && !DAY.test(page.to))) throw new ReadPageError('invalid_page');
    const from = page.from ?? monthsAgo(new Date(), MONTHS_BACK);
    const to = page.to ?? new Date().toISOString().slice(0, 10);
    if (from > to) throw new ReadPageError('invalid_page');
    const rows = (await env.DB.prepare(
      `SELECT id, snapshot_date, net_burn, source FROM project_metrics
        WHERE project_id = ? AND net_burn IS NOT NULL AND snapshot_date >= ? AND snapshot_date <= ? ORDER BY snapshot_date DESC, id DESC LIMIT ?`,
    ).bind(c.projectId, from, to, PIPELINE_LIMIT).all<{ id: number; snapshot_date: string; net_burn: number; source: string | null }>()).results ?? [];
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM project_metrics WHERE project_id = ? AND net_burn IS NOT NULL AND snapshot_date >= ? AND snapshot_date <= ?')
      .bind(c.projectId, from, to).first<{ n: number }>().catch(() => null);
    const records = rows.map((r) => ({
      ref: `project_metric:${r.id}`, at: r.snapshot_date, amount: centsOf(null, r.net_burn), unit: 'cents', currency: null,
      source: r.source ?? 'typed',
    }));
    return {
      records, coverage: coverageOf(records.length, n && Number.isFinite(Number(n.n)) ? Number(n.n) : null), period: { from, to },
      source: 'project_metrics', currency_note: 'The metrics record no currency.',
    };
  },
  // The venture's own raise pipeline (`raise_prospects`): each investor's stage, amount and next step, as of now.
  // When a stage last changed is not recorded (only a line of activity text), so it is named missing, not guessed.
  'raise.pipeline': async (env, c) => {
    const v = await ventureAndSponsor(env, c);
    if (!v) return null;
    if (!v.who || !canWrite(v.project, v.who)) return withheld('Only the venture\'s own team reads its raise pipeline.');
    const rows = (await env.DB.prepare(
      `SELECT uid, firm, stage, amount, amount_cents, currency, commit_status, instrument, next_step_due, updated_at FROM raise_prospects
        WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
    ).bind(v.project.id, PIPELINE_LIMIT).all<any>()).results ?? [];
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM raise_prospects WHERE project_id = ?').bind(v.project.id).first<{ n: number }>().catch(() => null);
    const records = rows.map((r) => ({
      ref: `raise_prospect:${r.uid}`, firm: cut(r.firm, 120), stage: r.stage, commit_status: r.commit_status ?? null, instrument: r.instrument ?? null,
      amount: centsOf(r.amount_cents, r.amount), unit: 'cents', currency: r.currency ? String(r.currency).toUpperCase() : null,
      next_step_due: r.next_step_due ?? null, at: r.updated_at, stage_changed_at: null,
    }));
    return {
      records, coverage: coverageOf(records.length, n && Number.isFinite(Number(n.n)) ? Number(n.n) : null),
      as_of: new Date().toISOString(), missing_fields: ['stage_changed_at'], source: 'raise_prospects',
    };
  },
  // Interview transcripts (`interview_sessions` and their segments: the final transcript when there is one, else the
  // live one), newest first, with each session's consent. A session whose recording consent is not `given` carries
  // its consent and speakers but none of its words.
  'validate.transcripts': async (env, c) => {
    const v = await ventureAndSponsor(env, c);
    if (!v) return null;
    if (!v.who || !canWrite(v.project, v.who)) return withheld('Only the venture\'s own team reads its interview transcripts.');
    const sessions = (await env.DB.prepare(
      `SELECT id, uid, consent_status, consent_method, consent_at, started_at, created_at FROM interview_sessions
        WHERE project_id = ? ORDER BY id DESC LIMIT ?`,
    ).bind(v.project.id, SESSION_LIMIT).all<any>()).results ?? [];
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM interview_sessions WHERE project_id = ?').bind(v.project.id).first<{ n: number }>().catch(() => null);
    const records = [];
    for (const s of sessions) {
      const segs = (await env.DB.prepare(
        `SELECT start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
          WHERE session_id = ? AND source = (SELECT CASE WHEN EXISTS (SELECT 1 FROM interview_transcript_segments WHERE session_id = ? AND source = 'final') THEN 'final' ELSE 'live' END)
          ORDER BY start_ms, id LIMIT ?`,
      ).bind(s.id, s.id, SEGMENT_LIMIT + 1).all<any>()).results ?? [];
      const given = s.consent_status === 'given';
      records.push({
        ref: `interview_session:${s.uid}`, at: s.started_at ?? s.created_at,
        consent: { status: s.consent_status, method: s.consent_method ?? null, at: s.consent_at ?? null },
        speakers: [...new Set(segs.map((x: any) => String(x.speaker_label)))],
        segments: given ? segs.slice(0, SEGMENT_LIMIT).map((x: any) => ({ start_ms: x.start_ms ?? null, end_ms: x.end_ms ?? null, speaker: x.speaker_label, text: cut(x.text, 600) })) : null,
        ...(given ? {} : { words_withheld: 'Recording consent is not recorded as given.' }),
        ...(given && segs.length > SEGMENT_LIMIT ? { segments_clipped: true } : {}),
      });
    }
    return { records, coverage: coverageOf(records.length, n && Number.isFinite(Number(n.n)) ? Number(n.n) : null), source: 'interview_sessions' };
  },
  // Due diligence on the venture (`dd_cases` with subject the project): each workstream's status and whether it is
  // assigned and blocking, and each request the venture was sent, with its dates. Open questions are the requests
  // still `requested`. Only what the venture itself is shown: never a reviewer's notes, verdict or identity.
  'raise.diligence': async (env, c) => {
    const v = await ventureAndSponsor(env, c);
    if (!v) return null;
    if (!v.who || !canWrite(v.project, v.who)) return withheld('Only the venture\'s own team reads its diligence requests.');
    const cases = (await env.DB.prepare(
      `SELECT id, uid, status, target_ic_date, round_label, created_at FROM dd_cases
        WHERE subject_type = 'project' AND subject_id = ? AND status <> 'archived' ORDER BY id DESC`,
    ).bind(v.project.id).all<any>()).results ?? [];
    const workstreams: any[] = [];
    const records: any[] = [];
    for (const k of cases) {
      const secs = (await env.DB.prepare('SELECT section_key, title, status, assignee_user_id, blocking, completed_at FROM dd_sections WHERE case_id = ? ORDER BY id')
        .bind(k.id).all<any>()).results ?? [];
      for (const x of secs) workstreams.push({ case: `dd_case:${k.uid}`, key: x.section_key, title: cut(x.title, 200), status: x.status, assigned: x.assignee_user_id != null, blocking: Number(x.blocking) === 1, completed_at: x.completed_at ?? null });
      const reqs = (await env.DB.prepare('SELECT id, title, state, due_date, responded_at, reviewed_at, withdrawn_at, created_at FROM dd_requests WHERE case_id = ? ORDER BY id')
        .bind(k.id).all<any>()).results ?? [];
      for (const r of reqs) {
        records.push({
          ref: `dd_request:${k.uid}:${r.id}`, case: `dd_case:${k.uid}`, title: cut(r.title, 200), state: r.withdrawn_at ? 'withdrawn' : r.state,
          open: !r.withdrawn_at && r.state === 'requested', due: r.due_date ?? null, responded_at: r.responded_at ?? null, reviewed_at: r.reviewed_at ?? null, at: r.created_at,
        });
      }
    }
    return {
      cases: cases.map((k) => ({ ref: `dd_case:${k.uid}`, status: k.status, target_ic_date: k.target_ic_date ?? null, round: cut(k.round_label, 120) })),
      workstreams, records, coverage: coverageOf(records.length, records.length), source: 'dd_cases',
    };
  },
};

export const READERS: Partial<Record<string, Reader>> = {
  ...TYPED,
  ...TYPED_MORE,
  'project.summary': async (env, c) => {
    if (!c.projectId) return null;
    const p = await env.DB.prepare(
      'SELECT name, stage, sector, status, description, problem_statement, solution, why_now FROM projects WHERE id = ?',
    ).bind(c.projectId).first<Record<string, unknown>>();
    return p ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, cut(v)])) : null;
  },
  'company.profile': async (env, c) => {
    const companyId = c.scope.kind === 'company' ? c.scope.id : c.scope.company_id;
    if (!companyId) return null;
    const p = await env.DB.prepare(
      'SELECT company_name, stage, revenue_range, employee_count, description, website FROM company_profiles WHERE id = ?',
    ).bind(companyId).first<Record<string, unknown>>();
    return p ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, cut(v)])) : null;
  },
  'team.roster': async (env, c) => {
    const [companyId, projectId] = c.scope.kind === 'company' ? [c.scope.id, null] : [null, c.scope.id];
    const agents = await env.DB.prepare(
      `SELECT role_key, first_name, last_name, status FROM team_agents
        WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? AND status <> 'removed' LIMIT 20`,
    ).bind(c.scope.kind, companyId ?? 0, projectId ?? 0).all<Record<string, unknown>>();
    const people = c.scope.kind === 'company'
      ? (await env.DB.prepare(
        `SELECT u.name, l.role_in_company AS role FROM user_company_links l JOIN users u ON u.id = l.user_id
          WHERE l.company_id = ? AND u.is_active = 1 LIMIT 30`,
      ).bind(c.scope.id).all<Record<string, unknown>>()).results ?? []
      : [];
    return { agents: agents.results ?? [], people };
  },
  'validate.records': (env, c) => cycleRecords(env, c, 'validate'),
  'build.records': (env, c) => cycleRecords(env, c, 'build'),
  'raise.records': (env, c) => cycleRecords(env, c, 'raise'),
  'grow.records': (env, c) => cycleRecords(env, c, 'grow'),
};

export const readAvailable = (key: string) => typeof READERS[key] === 'function';

/**
 * What each built reader PROVIDES, so a skill that needs more is told so. The cycle readers answer the
 * latest activity summaries: not a typed ledger, a contract's text or a cohort's rows (#4667).
 */
export const READER_PROVIDES: Readonly<Record<string, 'project_profile' | 'company_profile' | 'roster' | 'activity_summaries' | 'typed_record'>> = Object.freeze({
  'project.summary': 'project_profile', 'company.profile': 'company_profile', 'team.roster': 'roster',
  'mercury.balances': 'typed_record', 'stripe.revenue': 'typed_record', 'cap_table.read': 'typed_record',
  'grow.burn': 'typed_record', 'raise.pipeline': 'typed_record', 'validate.transcripts': 'typed_record', 'raise.diligence': 'typed_record',
  'grow.board_metrics': 'typed_record',
  'validate.records': 'activity_summaries', 'build.records': 'activity_summaries', 'raise.records': 'activity_summaries', 'grow.records': 'activity_summaries',
});

/**
 * D4667 (second slice) — every page of one collection read, for work that needs the complete period. It follows
 * `page.next` until there is none or `maxPages` is reached, and says which: `coverage.complete` is true only when
 * every row the period holds was read. Bounded: at most `maxPages` pages of `RECORD_LIMIT` rows.
 */
export async function readPages(env: Env, key: string, c: ReadContext, opts: { maxPages?: number } = {}, readers: Partial<Record<string, Reader>> = READERS) {
  const f = readers[key];
  if (!f) throw new Error('read_unavailable');
  const maxPages = Math.max(1, Math.min(Number(opts.maxPages ?? 10) || 10, 50));
  const records: any[] = [];
  let after: string | null = c.page?.after ?? null;
  let total: number | null = null;
  let pages = 0;
  let next: string | null = null;
  do {
    const out: any = await f(env, { ...c, page: { ...(c.page ?? {}), after } });
    if (!out || !Array.isArray(out.records) || !out.coverage) return null;
    pages += 1;
    records.push(...out.records);
    total = out.coverage.total;
    next = out.page?.next ?? null;
    after = next;
  } while (next && pages < maxPages);
  const coverage = coverageOf(records.length, total);
  return { records, coverage: { ...coverage, complete: coverage.complete && next === null }, pages, next, period: { from: c.page?.from ?? null, to: c.page?.to ?? null } };
}

/** The bytes of a value as JSON. */
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v ?? null)).length;

/**
 * A value over the limit, with whole rows dropped from the end of its lists until it fits, and what was
 * dropped counted. The typed shape stays; `null` when no list can be shortened enough.
 */
function shrink(data: unknown): { data: unknown; dropped: Record<string, number> } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  const lists = Object.keys(copy).filter((k) => Array.isArray(copy[k]));
  if (!lists.length) return null;
  const dropped: Record<string, number> = {};
  const work = Object.fromEntries(lists.map((k) => [k, [...(copy[k] as unknown[])]]));
  const render = () => ({ ...copy, ...work, omitted_for_size: { ...dropped } });
  while (bytes(render()) > READ_MAX - 64) {
    // Take from the longest list, so no one list is emptied while another is long.
    const k = lists.reduce((a, b) => (work[b].length > work[a].length ? b : a));
    if (!work[k].length) return null;
    work[k].pop();
    dropped[k] = (dropped[k] ?? 0) + 1;
  }
  return { data: render(), dropped };
}

/** One read, wrapped to `READ_MAX` bytes of JSON without ever turning it into a substring. */
export async function readOne(env: Env, key: string, c: ReadContext, readers: Partial<Record<string, Reader>> = READERS): Promise<ReadResult> {
  const f = readers[key];
  if (!f) throw new Error('read_unavailable');
  const data = await f(env, c);
  if (bytes(data) <= READ_MAX) return { untrusted: true, data };
  const smaller = shrink(data);
  if (smaller) return { untrusted: true, data: smaller.data, truncated: true };
  // Nothing whole can be dropped: say so, rather than hand the model half a document.
  return { untrusted: true, data: null, incomplete: true, reason: 'too_large' };
}
