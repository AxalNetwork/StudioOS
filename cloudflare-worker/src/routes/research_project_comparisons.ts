/**
 * D5157 part 3 (#5157) — a Research Project's companies and funds ("Add to
 * research" from the directories) and its comparisons (RS-02 D). Mounted at
 * `/api/research/projects` beside `research_projects.ts` (migration
 * 202611130634_5157_research_project_comparisons.sql).
 *
 * OWNER-SCOPED. Every route reads the project through `checkProjectOwner`, so
 * another member's project is a 404 like one that does not exist, and every
 * statement names `owner_user_id`.
 *
 * A SUBJECT NAMES A DIRECTORY ROW. Adding a company or a fund checks the row
 * is in the company directory or among the funds the fund directory serves
 * (a list taken down for its terms serves none), keeps its uid and its name,
 * and nothing else.
 *
 * VALUES ARE READ, NEVER STORED. A comparison's table is read from the
 * directories when the page is read: each value with its source and as-of
 * date, or Not recorded with the reason. Nothing is scored, ranked, summed or
 * filled in, and a failed directory read is Unreadable, never Not recorded.
 * A row that left the directory is said to have left it, by the name kept.
 *
 * D7167 (#7167): each fund cell carries the dated provenance object the fund
 * read uses (`provenanceOf`: publisher, list, URL, reported on, imported on,
 * reviewed on, verdict), and the fund table gains Manager, Label in the list,
 * Investment stage and Source use. A fund whose list was withdrawn is refused
 * with 410 `source_withdrawn`, never as `not_in_directory`.
 *
 * AN ARCHIVED PROJECT IS READ-ONLY (409 `project_archived`), as in part 1.
 * Every write leaves an audit receipt. All SQL is bound; a list of uids is one
 * bound JSON array read through `json_each`.
 *
 * D7177 (#7177, brief D7043) — A COMPARISON IS SAVED ALL OR NOTHING. Its new
 * subjects, the comparison and its members (and, from `/with-comparison`, the
 * new project) are one D1 batch, so a failure part-way leaves nothing. A failed
 * batch is answered `rolled_back: true` only after a read confirms nothing was
 * kept; when that read fails too the answer is `save_outcome_unknown`. Each
 * Compare sheet sends one `request_id`: a repeat returns the comparison the
 * first attempt made, and `GET /comparison-saves/:requestId` says whether it
 * was saved (migration 202611180051_7177_research_comparison_request_id.sql).
 * A value whose stored form cannot be read is `unreadable`, never Not recorded.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { presentMetrics } from '../services/researchCompanyDirectory';
import { loadFundSources, presentFund, type DirectoryRow as FundRow, type FundSourceRow } from '../services/researchFundDirectory';
import {
  SOURCE_WITHDRAWN_MESSAGE, loadVehicleFacts, presentFact, rowProvenance, type FactRow, type ProposedField,
} from '../services/researchFundProfile';
import type { RouteMount } from '../util/routeRegistry';
import { checkProjectOwner, defaultTitle as defaultProjectTitle, readField as readProjectField } from './research_projects';

const comparisons = new Hono<{ Bindings: Env }>();

export const KINDS = ['company', 'fund'] as const;
type Kind = typeof KINDS[number];
/** The longest comparison title (the migration's CHECK). */
export const TITLE_LIMIT = 160;
/** The most columns one comparison holds, so its table stays readable. */
export const MEMBER_LIMIT = 6;
/** The most companies or funds one "Add to research" takes. */
export const ADD_LIMIT = 25;
/** A directory uid as the directories write them. */
const UID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** A Compare sheet's request id (a uuid): what the migration's CHECK allows, in a safe alphabet. */
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
/** What a generated title ends with when it leaves names out. */
export const TITLE_MORE = ' …';
const TITLE_JOIN = ' · ';

/** Each kind's attributes, in the table's order: the same rows for every column. */
export const ATTRIBUTES: Record<Kind, Array<{ key: string; label: string }>> = {
  company: [
    { key: 'country', label: 'Country' },
    { key: 'sector', label: 'Sector' },
    { key: 'founded', label: 'Founded' },
    { key: 'employees', label: 'Employees' },
    { key: 'last_round', label: 'Last round' },
    { key: 'funding_total', label: 'Total funding' },
    { key: 'revenue', label: 'Revenue' },
  ],
  // D7167: the canvas's order (FND-P06), then the two rows the earlier table held.
  fund: [
    { key: 'manager', label: 'Manager' },
    { key: 'size', label: 'Reported size' },
    { key: 'vintage', label: 'Vintage' },
    { key: 'hq', label: 'Manager HQ' },
    { key: 'focus', label: 'Stated focus' },
    { key: 'fund_number', label: 'Label in the list' },
    { key: 'stage', label: 'Investment stage' },
    { key: 'source_use', label: 'Source use' },
    { key: 'notable_lps', label: 'Notable LPs' },
    { key: 'backing', label: 'EIF / EIFO' },
  ],
};

type Source = { name: string | null; url: string | null };
type Row = Record<string, any>;
export type Cell =
  | { status: 'recorded'; value: unknown; source: Source; as_of: string | null; [extra: string]: unknown }
  | { status: 'not_recorded'; reason: string }
  | { status: 'unreadable'; reason: string };

const isKind = (v: unknown): v is Kind => v === 'company' || v === 'fund';
const has = (v: unknown) => (typeof v === 'string' ? v.trim() !== '' : v != null);
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const touch = (env: Env, id: number) =>
  env.DB.prepare("UPDATE research_projects SET updated_at = datetime('now') WHERE id = ?").bind(id).run();

/** D7177: the reason a held value cannot be shown, kept apart from Not recorded. */
export const UNREADABLE_CELL = 'Unreadable: the source record for this value could not be read';
const unreadable = (reason = UNREADABLE_CELL): Cell => ({ status: 'unreadable', reason });
/** One cell, or Unreadable when building it throws: a bad stored value never takes the table down. */
function guarded(build: () => Cell): Cell {
  try { return build(); } catch { return unreadable(); }
}
const numeric = (v: unknown) => v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
/** Every attribute of `kind` Unreadable: a row whose cells could not be built at all. */
export const unreadableCells = (kind: Kind): Record<string, Cell> =>
  Object.fromEntries(ATTRIBUTES[kind].map((a) => [a.key, unreadable()]));

/** A value with its source and date, or Not recorded — never a zero or a blank. */
function cell(value: unknown, source: Source, asOf: unknown, extra: Row = {}, reason = 'Not recorded: the directory holds no value'): Cell {
  if (!has(value)) return { status: 'not_recorded', reason };
  return { status: 'recorded', value: typeof value === 'string' ? value.trim() : value, ...extra, source, as_of: has(asOf) ? String(asOf) : null };
}

/** A company directory row as the comparison's cells (migration 228 and 375's columns). */
export function companyCells(r: Row): Record<string, Cell> {
  const record = { name: r.source_name ?? null, url: r.source_url ?? null };
  const m = presentMetrics(r) as Record<string, Row>;
  // A figure is held as a number; one held in any other form is Unreadable (D7177), not Not recorded.
  const metric = (x: Row, extra: Row = {}): Cell => (x.status !== 'recorded'
    ? { status: 'not_recorded', reason: 'Not recorded: no source lists it for this company' }
    : !numeric(x.value) ? unreadable('Unreadable: the stored figure could not be read as a number')
      : { status: 'recorded', value: Number(x.value), ...extra, source: { name: x.source_name ?? null, url: x.source_url ?? null }, as_of: x.as_of ?? null });
  const founded = Number(r.founded_year);
  return {
    country: guarded(() => cell(r.country, record, r.as_of)),
    sector: guarded(() => cell(r.sector, record, r.as_of)),
    founded: guarded(() => cell(Number.isInteger(founded) && founded > 0 ? founded : null, record, r.as_of)),
    employees: guarded(() => metric(m.headcount)),
    last_round: guarded(() => metric(m.last_funding, { currency: m.last_funding.currency ?? null, type: m.last_funding.type ?? null, date: m.last_funding.date ?? null })),
    funding_total: guarded(() => metric(m.funding_total, { currency: m.funding_total.currency ?? null })),
    revenue: guarded(() => metric(m.revenue, { currency: m.revenue.currency ?? null })),
  };
}

/**
 * A served fund directory row as the comparison's cells (migration 378's
 * columns). D7167: each recorded cell carries the row's `provenance`;
 * `review` is its list's terms review and `facts` its proposed fields, where
 * `null` means the facts could not be read (those cells are left out, which
 * the page reads as Unavailable, never as Not recorded).
 */
export function fundCells(raw: FundRow, review?: FundSourceRow, facts: Map<ProposedField, FactRow> | null = new Map()): Record<string, Cell> {
  const r = presentFund(raw);
  const source = { name: r.source_name ?? null, url: r.source_url ?? null };
  const reviews = new Map(review ? [[raw.source_name, review]] : []);
  const provenance = rowProvenance(raw, reviews);
  const dated = { provenance };
  const backing = r.eif == null && r.eifo == null ? null : { eif: r.eif, eifo: r.eifo };
  const out: Record<string, Cell> = {
    size: r.fund_size_cents != null && r.size_currency
      ? (numeric(r.fund_size_cents) ? cell(Number(r.fund_size_cents), source, r.as_of, { currency: r.size_currency, ...dated }) : unreadable('Unreadable: the stored fund size could not be read as a number'))
      : { status: 'not_recorded', reason: (r as Row).size_reason || 'Not recorded' },
    vintage: cell(r.fund_year, source, r.as_of, { date: r.fund_date ?? null, ...dated }),
    hq: cell(r.hq, source, r.as_of, dated),
    focus: cell(r.sector_focus, source, r.as_of, dated, 'Not recorded: the list states no focus for this vehicle'),
    fund_number: cell(r.fund_number, source, r.as_of, dated, 'Not recorded: the list gives this vehicle no label'),
    source_use: review
      ? { status: 'recorded', value: review.verdict, reviewed_on: review.reviewed_on, imported_on: provenance.imported_on, source, as_of: review.reviewed_on, provenance }
      : { status: 'not_recorded', reason: "Not recorded: this list's terms have not been reviewed" },
    notable_lps: cell(r.notable_lps, source, r.as_of, dated),
    backing: cell(backing, source, r.as_of, dated, 'Not recorded: the list names no LPs for this fund'),
  };
  if (facts) {
    for (const [key, field] of [['manager', 'manager_name'], ['stage', 'investment_stage']] as const) {
      const v = presentFact(field, facts.get(field), reviews);
      out[key] = v.status === 'recorded'
        ? { status: 'recorded', value: v.value, source: { name: v.provenance.list_name, url: v.provenance.published_url }, as_of: v.provenance.reported_on, provenance: v.provenance }
        : { status: 'not_recorded', reason: `Not recorded: ${v.reason.charAt(0).toLowerCase()}${v.reason.slice(1)}` };
    }
  }
  return out;
}

/** A listed member's cells; a row whose cells cannot be built at all reads Unreadable in every row (D7177). */
export function memberCells(kind: Kind, row: Row, review?: FundSourceRow, facts: Map<ProposedField, FactRow> | null = new Map()): Record<string, Cell> {
  try {
    return kind === 'company' ? companyCells(row) : fundCells(row as FundRow, review, facts);
  } catch {
    return unreadableCells(kind);
  }
}

/** The directory rows among `uids`, by uid. A fund whose list was taken down is not served. */
export async function directoryRows(env: Env, kind: Kind, uids: string[]): Promise<Map<string, Row>> {
  if (!uids.length) return new Map();
  const list = JSON.stringify([...new Set(uids)]);
  const rows = kind === 'company'
    ? await env.DB.prepare('SELECT * FROM research_company_directory WHERE uid IN (SELECT value FROM json_each(?))').bind(list).all<Row>()
    // The served funds, as `SERVED_FUNDS` defines them: none from a list taken down for its terms.
    : await env.DB.prepare(
      `SELECT d.uid, d.name, d.website, d.linkedin, d.hq, d.fund_number, d.fund_size_cents, d.fund_date, d.quarter, d.fund_year,
              d.sector_focus, d.notable_lps, d.eif_flag, d.eifo_flag, d.source_name, d.source_url, d.as_of
         FROM research_fund_directory d
        WHERE d.uid IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed')`
    ).bind(list).all<Row>();
  return new Map((rows.results || []).map((r) => [String(r.uid), r]));
}

/** The uids still held in the fund directory but no longer served (a list taken down). */
async function withdrawnFunds(env: Env, uids: string[]): Promise<Set<string>> {
  if (!uids.length) return new Set();
  const rows = await env.DB.prepare('SELECT uid FROM research_fund_directory WHERE uid IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(uids)).all<{ uid: string }>();
  return new Set((rows.results || []).map((r) => r.uid));
}

/** `uids` from a request: 1..`max` distinct directory uids, or an error code. */
export function readUids(value: unknown, max: number): { uids?: string[]; error?: string } {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
  if (!list || !list.length) return { error: 'uids_required' };
  if (!list.every((u) => typeof u === 'string' && UID_RE.test(u))) return { error: 'invalid_uid' };
  const uids = [...new Set(list as string[])];
  if (uids.length > max) return { error: 'too_many' };
  return { uids };
}

/** A title a member typed: trimmed, 1..160 characters, or an error code. */
export function readTitle(value: unknown): { value?: string; error?: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: 'title_required' };
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > TITLE_LIMIT) return { error: 'title_too_long' };
  return { value: text };
}

/** A Compare sheet's request id: absent (null), or a uuid-like id; anything else is an error code. */
export function readRequestId(value: unknown): { value?: string | null; error?: string } {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string' || !REQUEST_ID_RE.test(value)) return { error: 'invalid_request_id' };
  return { value };
}

/**
 * The names joined as a title, cut at a whole name inside the limit. When
 * names are left out it ends with " …", and the room for it is kept inside
 * the limit (D7177: it used to be added after a title that already filled it,
 * 162 characters against the CHECK's 160). One name longer than the limit is
 * cut at the limit and ends with "…".
 */
export function defaultComparisonTitle(names: string[]): string {
  const kept: string[] = [];
  for (const name of names) {
    if ([...kept, name].join(TITLE_JOIN).length <= TITLE_LIMIT) { kept.push(name); continue; }
    while (kept.length && `${kept.join(TITLE_JOIN)}${TITLE_MORE}`.length > TITLE_LIMIT) kept.pop();
    return kept.length ? `${kept.join(TITLE_JOIN)}${TITLE_MORE}` : `${names[0].slice(0, TITLE_LIMIT - 1)}…`;
  }
  return kept.join(TITLE_JOIN);
}

/**
 * Adds the directory rows `uids` to the project as subjects (an existing one
 * is kept) and returns each uid's subject id, or the uids the directory does
 * not hold. A failed directory read throws to the caller.
 */
async function ensureSubjects(env: Env, projectId: number, userId: number, kind: Kind, uids: string[]) {
  const listed = await directoryRows(env, kind, uids);
  const missing = uids.filter((u) => !listed.has(u));
  // D7167: a fund still held but withheld for its list's terms is refused by name.
  const withdrawn = kind === 'fund' && missing.length ? [...await withdrawnFunds(env, missing)] : [];
  if (withdrawn.length) return { missing, withdrawn };
  if (missing.length) return { missing };
  let added = 0;
  for (const uid of uids) {
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO research_project_subjects (project_id, owner_user_id, kind, directory_uid, name, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(projectId, userId, kind, uid, String(listed.get(uid)!.name).trim() || uid, userId).run();
    added += Number(r.meta?.changes || 0);
  }
  const ids = await env.DB.prepare(
    `SELECT id, directory_uid, name FROM research_project_subjects
      WHERE project_id = ? AND owner_user_id = ? AND kind = ? AND directory_uid IN (SELECT value FROM json_each(?))`
  ).bind(projectId, userId, kind, JSON.stringify(uids)).all<{ id: number; directory_uid: string; name: string }>();
  const byUid = new Map((ids.results || []).map((r) => [r.directory_uid, r]));
  return { added, subjects: uids.map((u) => byUid.get(u)!) };
}

/** D7167: 410 `source_withdrawn`, naming the funds whose list was taken down. Nothing was written. */
const withdrawnRefusal = (c: Context<{ Bindings: Env }>, withdrawn: string[]) =>
  c.json({ detail: 'source_withdrawn', message: SOURCE_WITHDRAWN_MESSAGE, withdrawn }, 410);

/** The project for a write: the caller's own, and not archived. */
async function writableProject(c: Context<{ Bindings: Env }>, userId: number) {
  const project = await checkProjectOwner(c.env, c.req.param('uid') || '', userId);
  if (!project) return { response: c.json({ detail: 'not_found' }, 404) };
  if (project.status === 'archived') return { response: c.json({ detail: 'project_archived' }, 409) };
  return { project };
}

async function ownComparison(env: Env, projectId: number, userId: number, uid: string) {
  return env.DB.prepare(
    'SELECT id, uid, kind, title FROM research_project_comparisons WHERE uid = ? AND project_id = ? AND owner_user_id = ?'
  ).bind(uid, projectId, userId).first<{ id: number; uid: string; kind: Kind; title: string }>();
}

// ---------------------------------------------------------------------------
// The read: the project's companies and funds, and its comparisons
// ---------------------------------------------------------------------------

comparisons.get('/:uid/comparisons', async (c) => {
  const user = await requireAuth(c);
  const project = await checkProjectOwner(c.env, c.req.param('uid'), user.id);
  if (!project) return c.json({ detail: 'not_found' }, 404);
  const subjects = (await c.env.DB.prepare(
    `SELECT s.id, s.kind, s.directory_uid, s.name, s.created_at,
            (SELECT COUNT(*) FROM research_project_comparison_members m WHERE m.subject_id = s.id) AS comparisons
       FROM research_project_subjects s
      WHERE s.project_id = ? AND s.owner_user_id = ?
      ORDER BY s.kind, s.id`
  ).bind(project.id, user.id).all<{ id: number; kind: Kind; directory_uid: string; name: string; created_at: string; comparisons: number }>()).results || [];
  const sets = (await c.env.DB.prepare(
    `SELECT id, uid, kind, title, created_at, updated_at FROM research_project_comparisons
      WHERE project_id = ? AND owner_user_id = ? ORDER BY id`
  ).bind(project.id, user.id).all<{ id: number; uid: string; kind: Kind; title: string; created_at: string; updated_at: string }>()).results || [];
  const members = (await c.env.DB.prepare(
    `SELECT m.comparison_id, m.subject_id, m.position FROM research_project_comparison_members m
       JOIN research_project_comparisons k ON k.id = m.comparison_id
      WHERE k.project_id = ? AND k.owner_user_id = ?
      ORDER BY m.comparison_id, m.position, m.subject_id`
  ).bind(project.id, user.id).all<{ comparison_id: number; subject_id: number; position: number }>()).results || [];

  // One directory read per kind, for every subject. A failed read marks that
  // kind Unreadable; it never makes a row look absent or a value look missing.
  const read: Record<Kind, { state: 'ok' | 'unreadable'; rows: Map<string, Row>; withdrawn: Set<string> }> = {
    company: { state: 'ok', rows: new Map(), withdrawn: new Set() },
    fund: { state: 'ok', rows: new Map(), withdrawn: new Set() },
  };
  // D7167: each fund cell's provenance needs its list's review and the proposed
  // fields. Either failing leaves those parts out (Unavailable), not the column.
  let reviews = new Map<string, FundSourceRow>();
  let facts: Map<string, Map<ProposedField, FactRow>> | null = new Map();
  for (const kind of KINDS) {
    const uids = subjects.filter((s) => s.kind === kind).map((s) => s.directory_uid);
    if (!uids.length) continue;
    try {
      read[kind].rows = await directoryRows(c.env, kind, uids);
      if (kind === 'fund') {
        read[kind].withdrawn = await withdrawnFunds(c.env, uids.filter((u) => !read[kind].rows.has(u)));
        reviews = await loadFundSources(c.env).catch(() => new Map());
        facts = await loadVehicleFacts(c.env, [...read[kind].rows.keys()]).catch(() => null);
      }
    } catch {
      read[kind].state = 'unreadable';
    }
  }
  const subjectView = (s: typeof subjects[number]) => {
    const r = read[s.kind];
    const row = r.rows.get(s.directory_uid);
    const state = r.state === 'unreadable' ? 'unreadable' : row ? 'listed' : r.withdrawn.has(s.directory_uid) ? 'withdrawn' : 'removed';
    return { kind: s.kind, uid: s.directory_uid, name: row?.name ? String(row.name) : s.name, state, added_at: s.created_at, comparisons: Number(s.comparisons || 0) };
  };
  const byId = new Map(subjects.map((s) => [s.id, s]));
  return c.json({
    project: { uid: project.uid, status: project.status },
    directory: { company: read.company.state, fund: read.fund.state },
    attributes: ATTRIBUTES,
    limits: { members: MEMBER_LIMIT, add: ADD_LIMIT, title: TITLE_LIMIT },
    subjects: subjects.map(subjectView),
    comparisons: sets.map((k) => ({
      uid: k.uid, kind: k.kind, title: k.title, created_at: k.created_at, updated_at: k.updated_at,
      members: members.filter((m) => m.comparison_id === k.id).map((m) => {
        const s = byId.get(m.subject_id)!;
        const view = subjectView(s);
        const row = read[s.kind].rows.get(s.directory_uid);
        const values = view.state === 'listed' && row
          ? memberCells(s.kind, row, reviews.get(String(row.source_name)), facts ? (facts.get(s.directory_uid) ?? new Map()) : null)
          : null;
        return { ...view, values };
      }),
    })),
  });
});

// ---------------------------------------------------------------------------
// Add to research: companies and funds
// ---------------------------------------------------------------------------

comparisons.post('/:uid/subjects', async (c) => {
  const user = await requireAuth(c);
  const { project, response } = await writableProject(c, user.id);
  if (!project) return response;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  if (!isKind(body.kind)) return c.json({ detail: 'invalid_kind' }, 400);
  const read = readUids(body.uids ?? body.uid, ADD_LIMIT);
  if (read.error) return c.json({ detail: read.error }, 400);
  let result;
  try {
    result = await ensureSubjects(c.env, project.id, user.id, body.kind, read.uids!);
  } catch {
    return c.json({ detail: 'directory_unreadable' }, 503);
  }
  if (result.withdrawn) return withdrawnRefusal(c, result.withdrawn);
  if (result.missing) return c.json({ detail: 'not_in_directory', missing: result.missing }, 404);
  if (result.added) {
    await touch(c.env, project.id);
    await logAdminAction(c.env, user.id, user.email, 'research_project_subject_added', { project_uid: project.uid, kind: body.kind, count: result.added });
  }
  return c.json({ ok: true, added: result.added, already: read.uids!.length - result.added });
});

comparisons.delete('/:uid/subjects/:kind/:subjectUid', async (c) => {
  const user = await requireAuth(c);
  const { project, response } = await writableProject(c, user.id);
  if (!project) return response;
  const kind = c.req.param('kind');
  if (!isKind(kind)) return c.json({ detail: 'invalid_kind' }, 400);
  const result = await c.env.DB.prepare(
    'DELETE FROM research_project_subjects WHERE project_id = ? AND owner_user_id = ? AND kind = ? AND directory_uid = ?'
  ).bind(project.id, user.id, kind, c.req.param('subjectUid')).run();
  if (!result.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_subject_removed', { project_uid: project.uid, kind, directory_uid: c.req.param('subjectUid') });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

/** A comparison as the save and the save-status read report it. */
type SavedRow = { uid: string; kind: Kind; title: string; created_at: string; project_uid: string; project_title: string; members: number };
const savedDto = (r: SavedRow) => ({
  item: { uid: r.uid, kind: r.kind, title: r.title, members: Number(r.members || 0), created_at: r.created_at },
  project: { uid: r.project_uid, title: r.project_title },
});

/** The caller's own comparison saved under `requestId`, with its project, or null: another member's reads as none. */
async function checkSaveOwner(env: Env, userId: number, requestId: string) {
  return env.DB.prepare(
    `SELECT k.uid, k.kind, k.title, k.created_at, p.uid AS project_uid, p.title AS project_title,
            (SELECT COUNT(*) FROM research_project_comparison_members m WHERE m.comparison_id = k.id) AS members
       FROM research_project_comparisons k JOIN research_projects p ON p.id = k.project_id
      WHERE k.owner_user_id = ? AND k.request_id = ?`
  ).bind(userId, requestId).first<SavedRow>();
}

/** The caller's comparison by its uid, with its project, or null. */
async function savedByUid(env: Env, userId: number, uid: string) {
  return env.DB.prepare(
    `SELECT k.uid, k.kind, k.title, k.created_at, p.uid AS project_uid, p.title AS project_title,
            (SELECT COUNT(*) FROM research_project_comparison_members m WHERE m.comparison_id = k.id) AS members
       FROM research_project_comparisons k JOIN research_projects p ON p.id = k.project_id
      WHERE k.owner_user_id = ? AND k.uid = ?`
  ).bind(userId, uid).first<SavedRow>();
}

/** What a save is asked to write. `newProject` is set only by `/with-comparison`. */
export interface SavePlan {
  userId: number;
  projectUid: string;
  newProject?: { title: string; question: string };
  kind: Kind;
  uids: string[];
  names: Map<string, string>;
  title: string;
  requestId: string | null;
}
export type SaveOutcome =
  | { state: 'saved'; saved: SavedRow; added: number }
  | { state: 'repeat'; saved: SavedRow }
  | { state: 'rolled_back' }
  | { state: 'unknown' };

/**
 * The statements of one save, for one D1 batch (one transaction): the new
 * project, the subjects not yet in it, the comparison, its members in column
 * order, and the project's updated time. Every statement names the project by
 * uid and owner, and only while it is not archived; a member whose subject or
 * comparison is missing has a NULL key and fails its NOT NULL, so a save can
 * never keep a comparison short of a column: the whole batch is undone instead.
 */
export function saveStatements(env: Env, plan: SavePlan, comparisonUid: string) {
  const statements = [];
  if (plan.newProject) {
    statements.push(env.DB.prepare(
      'INSERT INTO research_projects (uid, owner_user_id, title, question, created_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(plan.projectUid, plan.userId, plan.newProject.title, plan.newProject.question, plan.userId));
  }
  for (const uid of plan.uids) {
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO research_project_subjects (project_id, owner_user_id, kind, directory_uid, name, created_by)
       VALUES ((SELECT id FROM research_projects WHERE uid = ? AND owner_user_id = ? AND status <> 'archived'), ?, ?, ?, ?, ?)`
    ).bind(plan.projectUid, plan.userId, plan.userId, plan.kind, uid, plan.names.get(uid) || uid, plan.userId));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO research_project_comparisons (uid, project_id, owner_user_id, kind, title, created_by, request_id)
     VALUES (?, (SELECT id FROM research_projects WHERE uid = ? AND owner_user_id = ? AND status <> 'archived'), ?, ?, ?, ?, ?)`
  ).bind(comparisonUid, plan.projectUid, plan.userId, plan.userId, plan.kind, plan.title, plan.userId, plan.requestId));
  plan.uids.forEach((uid, i) => {
    statements.push(env.DB.prepare(
      `INSERT INTO research_project_comparison_members (comparison_id, subject_id, kind, position, created_by)
       VALUES ((SELECT id FROM research_project_comparisons WHERE uid = ? AND owner_user_id = ?),
               (SELECT id FROM research_project_subjects WHERE project_id = (SELECT id FROM research_projects WHERE uid = ? AND owner_user_id = ? AND status <> 'archived')
                   AND owner_user_id = ? AND kind = ? AND directory_uid = ?),
               ?, ?, ?)`
    ).bind(comparisonUid, plan.userId, plan.projectUid, plan.userId, plan.userId, plan.kind, uid, plan.kind, i + 1, plan.userId));
  });
  statements.push(env.DB.prepare(
    "UPDATE research_projects SET updated_at = datetime('now') WHERE uid = ? AND owner_user_id = ?"
  ).bind(plan.projectUid, plan.userId));
  return statements;
}

/**
 * Runs one save and says what the database holds after it. A failed batch is
 * `rolled_back` only when a read then finds no comparison under its uid (the
 * batch is one transaction, so no comparison means no subject, member or
 * project from it either); a repeat that lost a race to the first attempt is
 * answered with the first attempt's comparison; a read that fails too leaves
 * the outcome `unknown`, and nobody is told nothing was added.
 */
export async function runSave(env: Env, plan: SavePlan): Promise<SaveOutcome> {
  const comparisonUid = newUid();
  const statements = saveStatements(env, plan, comparisonUid);
  const subjectsFrom = plan.newProject ? 1 : 0;
  let results;
  try {
    results = await env.DB.batch(statements);
  } catch {
    try {
      if (plan.requestId) {
        const first = await checkSaveOwner(env, plan.userId, plan.requestId);
        if (first) return { state: 'repeat', saved: first };
      }
      const kept = await savedByUid(env, plan.userId, comparisonUid);
      return kept ? { state: 'saved', saved: kept, added: 0 } : { state: 'rolled_back' };
    } catch {
      return { state: 'unknown' };
    }
  }
  const added = results.slice(subjectsFrom, subjectsFrom + plan.uids.length).reduce((n, r) => n + Number(r?.meta?.changes || 0), 0);
  let saved: SavedRow | null = null;
  try { saved = await savedByUid(env, plan.userId, comparisonUid); } catch { /* the batch committed: answer from the plan */ }
  return {
    state: 'saved', added,
    saved: saved || { uid: comparisonUid, kind: plan.kind, title: plan.title, created_at: '', project_uid: plan.projectUid, project_title: plan.newProject?.title || '', members: plan.uids.length },
  };
}

/** The answer for a save outcome, with the receipt for one that wrote. */
async function answerSave(c: Context<{ Bindings: Env }>, user: { id: number; email: string }, plan: SavePlan, outcome: SaveOutcome) {
  if (outcome.state === 'rolled_back') {
    return c.json({ detail: 'save_rolled_back', message: 'Nothing was saved: every write of this save was undone.', rolled_back: true }, 500);
  }
  if (outcome.state === 'unknown') {
    return c.json({ detail: 'save_outcome_unknown', message: 'The save may not have finished. Check its status before saving again.', rolled_back: null }, 503);
  }
  if (outcome.state === 'repeat') {
    return c.json({ ...savedDto(outcome.saved), request_id: plan.requestId, repeat: true, rolled_back: false }, 200);
  }
  if (plan.newProject) await logAdminAction(c.env, user.id, user.email, 'research_project_created', { project_uid: plan.projectUid });
  await logAdminAction(c.env, user.id, user.email, 'research_project_comparison_created', {
    project_uid: plan.projectUid, comparison_uid: outcome.saved.uid, kind: plan.kind, members: plan.uids.length, subjects_added: outcome.added,
  });
  return c.json({ ...savedDto(outcome.saved), request_id: plan.requestId, repeat: false, rolled_back: false, subjects_added: outcome.added }, 201);
}

/**
 * The comparison part of a save request: kind, 1..6 uids, an optional title
 * and an optional request id, each checked before anything is read or written.
 */
function readComparisonBody(body: Row): { error: string } | { error?: undefined; kind: Kind; uids: string[]; title: string | null; requestId: string | null } {
  if (!isKind(body.kind)) return { error: 'invalid_kind' };
  const read = readUids(body.uids, MEMBER_LIMIT);
  if (read.error) return { error: read.error === 'too_many' ? 'comparison_full' : read.error };
  const sentTitle = body.title === undefined || body.title === null || body.title === '' ? null : readTitle(body.title);
  if (sentTitle?.error) return { error: sentTitle.error };
  const requestId = readRequestId(body.request_id);
  if (requestId.error) return { error: requestId.error };
  return { kind: body.kind, uids: read.uids!, title: sentTitle?.value ?? null, requestId: requestId.value ?? null };
}

/** The directory names for a save, by uid, or the refusal sent before any write. */
async function readNames(c: Context<{ Bindings: Env }>, kind: Kind, uids: string[]) {
  let listed: Map<string, Row>;
  try {
    listed = await directoryRows(c.env, kind, uids);
  } catch {
    return { response: c.json({ detail: 'directory_unreadable' }, 503) };
  }
  const missing = uids.filter((u) => !listed.has(u));
  // D7167: a fund still held but withheld for its list's terms is refused by name (410), never as not_in_directory.
  const withdrawn = kind === 'fund' && missing.length ? [...await withdrawnFunds(c.env, missing)] : [];
  if (withdrawn.length) return { response: withdrawnRefusal(c, withdrawn) };
  if (missing.length) return { response: c.json({ detail: 'not_in_directory', missing }, 404) };
  return { names: new Map(uids.map((u) => [u, String(listed.get(u)!.name ?? '').trim() || u])) };
}

comparisons.post('/:uid/comparisons', async (c) => {
  const user = await requireAuth(c);
  const { project, response } = await writableProject(c, user.id);
  if (!project) return response;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  const asked = readComparisonBody(body);
  if (asked.error !== undefined) return c.json({ detail: asked.error }, 400);
  // A repeat of a save already made answers with that comparison and writes nothing.
  if (asked.requestId) {
    const first = await checkSaveOwner(c.env, user.id, asked.requestId);
    if (first && first.project_uid !== project.uid) return c.json({ detail: 'request_id_reused' }, 409);
    if (first) return c.json({ ...savedDto(first), request_id: asked.requestId, repeat: true, rolled_back: false }, 200);
  }
  const named = await readNames(c, asked.kind, asked.uids);
  if (!named.names) return named.response;
  const names = named.names;
  const plan: SavePlan = {
    userId: user.id, projectUid: project.uid, kind: asked.kind, uids: asked.uids, names,
    title: asked.title ?? defaultComparisonTitle(asked.uids.map((u) => names.get(u)!)), requestId: asked.requestId,
  };
  return answerSave(c, user, plan, await runSave(c.env, plan));
});

// D7177 (the optional ◇): a new project and its first comparison in one
// request, so a refused or undone comparison never leaves an empty project.
comparisons.post('/with-comparison', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !body.project || typeof body.project !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  const question = readProjectField('question', body.project.question);
  if (question.error || question.value == null) return c.json({ detail: question.error || 'question_required' }, 400);
  const titleIn = body.project.title === undefined || body.project.title === null || body.project.title === '' ? undefined : body.project.title;
  const projectTitle = titleIn === undefined ? { value: defaultProjectTitle(question.value) } : readProjectField('title', titleIn);
  if (projectTitle.error || !projectTitle.value) return c.json({ detail: projectTitle.error || 'title_required' }, 400);
  const asked = readComparisonBody(body);
  if (asked.error !== undefined) return c.json({ detail: asked.error }, 400);
  if (asked.requestId) {
    const first = await checkSaveOwner(c.env, user.id, asked.requestId);
    if (first) return c.json({ ...savedDto(first), request_id: asked.requestId, repeat: true, rolled_back: false }, 200);
  }
  const named = await readNames(c, asked.kind, asked.uids);
  if (!named.names) return named.response;
  const names = named.names;
  const plan: SavePlan = {
    userId: user.id, projectUid: newUid(), newProject: { title: projectTitle.value, question: question.value },
    kind: asked.kind, uids: asked.uids, names,
    title: asked.title ?? defaultComparisonTitle(asked.uids.map((u) => names.get(u)!)), requestId: asked.requestId,
  };
  return answerSave(c, user, plan, await runSave(c.env, plan));
});

// D7177: was the save sent under this request id made? A read, never a write.
comparisons.get('/comparison-saves/:requestId', async (c) => {
  const user = await requireAuth(c);
  const requestId = readRequestId(c.req.param('requestId'));
  if (requestId.error || !requestId.value) return c.json({ detail: 'invalid_request_id' }, 400);
  let saved: SavedRow | null;
  try {
    saved = await checkSaveOwner(c.env, user.id, requestId.value);
  } catch {
    return c.json({ detail: 'save_status_unreadable', message: 'The save status could not be read just now.', state: 'unreadable' }, 503);
  }
  if (!saved) return c.json({ state: 'not_found', request_id: requestId.value });
  return c.json({ state: 'saved', request_id: requestId.value, ...savedDto(saved) });
});

comparisons.patch('/:uid/comparisons/:comparisonUid', async (c) => {
  const user = await requireAuth(c);
  const { project, response } = await writableProject(c, user.id);
  if (!project) return response;
  const set = await ownComparison(c.env, project.id, user.id, c.req.param('comparisonUid'));
  if (!set) return c.json({ detail: 'not_found' }, 404);
  const body = await c.req.json().catch(() => null);
  const title = readTitle(body?.title);
  if (title.error) return c.json({ detail: title.error }, 400);
  await c.env.DB.prepare(
    "UPDATE research_project_comparisons SET title = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?"
  ).bind(title.value, set.id, user.id).run();
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_comparison_updated', { project_uid: project.uid, comparison_uid: set.uid });
  return c.json({ item: { uid: set.uid, kind: set.kind, title: title.value } });
});

comparisons.delete('/:uid/comparisons/:comparisonUid', async (c) => {
  const user = await requireAuth(c);
  const { project, response } = await writableProject(c, user.id);
  if (!project) return response;
  const set = await ownComparison(c.env, project.id, user.id, c.req.param('comparisonUid'));
  if (!set) return c.json({ detail: 'not_found' }, 404);
  await c.env.DB.prepare('DELETE FROM research_project_comparisons WHERE id = ? AND owner_user_id = ?').bind(set.id, user.id).run();
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_comparison_deleted', { project_uid: project.uid, comparison_uid: set.uid });
  return c.json({ ok: true });
});

comparisons.post('/:uid/comparisons/:comparisonUid/members', async (c) => {
  const user = await requireAuth(c);
  const { project, response } = await writableProject(c, user.id);
  if (!project) return response;
  const set = await ownComparison(c.env, project.id, user.id, c.req.param('comparisonUid'));
  if (!set) return c.json({ detail: 'not_found' }, 404);
  const body = await c.req.json().catch(() => null);
  const read = readUids(body?.uid, 1);
  if (read.error) return c.json({ detail: read.error }, 400);
  const uid = read.uids![0];
  // Already a column: nothing to add. A full table refuses before anything is written.
  const there = await c.env.DB.prepare(
    `SELECT 1 AS x FROM research_project_comparison_members m
       JOIN research_project_subjects s ON s.id = m.subject_id
      WHERE m.comparison_id = ? AND s.project_id = ? AND s.owner_user_id = ? AND s.kind = ? AND s.directory_uid = ?`
  ).bind(set.id, project.id, user.id, set.kind, uid).first();
  if (there) return c.json({ ok: true, added: false });
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS last FROM research_project_comparison_members WHERE comparison_id = ?'
  ).bind(set.id).first<{ n: number; last: number }>();
  if (Number(count?.n || 0) >= MEMBER_LIMIT) return c.json({ detail: 'comparison_full' }, 409);
  let result;
  try {
    result = await ensureSubjects(c.env, project.id, user.id, set.kind, [uid]);
  } catch {
    return c.json({ detail: 'directory_unreadable' }, 503);
  }
  if (result.withdrawn) return withdrawnRefusal(c, result.withdrawn);
  if (result.missing) return c.json({ detail: 'not_in_directory', missing: result.missing }, 404);
  const subject = result.subjects![0];
  // D7815: count, next position and duplicate exclusion are decided by one write, never a stale read.
  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO research_project_comparison_members (comparison_id, subject_id, kind, position, created_by)
     SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1, ?
       FROM research_project_comparison_members WHERE comparison_id = ?
     HAVING COUNT(*) < ? AND NOT EXISTS (
       SELECT 1 FROM research_project_comparison_members WHERE comparison_id = ? AND subject_id = ?
     )`
  ).bind(set.id, subject.id, set.kind, user.id, set.id, MEMBER_LIMIT, set.id, subject.id).run();
  if (Number(inserted.meta?.changes) === 0) {
    const existing = await c.env.DB.prepare(
      'SELECT 1 AS x FROM research_project_comparison_members WHERE comparison_id = ? AND subject_id = ?'
    ).bind(set.id, subject.id).first();
    return existing ? c.json({ ok: true, added: false }) : c.json({ detail: 'comparison_full' }, 409);
  }
  await c.env.DB.prepare("UPDATE research_project_comparisons SET updated_at = datetime('now') WHERE id = ?").bind(set.id).run();
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_comparison_member_added', { project_uid: project.uid, comparison_uid: set.uid, kind: set.kind, directory_uid: subject.directory_uid });
  return c.json({ ok: true, added: true });
});

comparisons.delete('/:uid/comparisons/:comparisonUid/members/:memberUid', async (c) => {
  const user = await requireAuth(c);
  const { project, response } = await writableProject(c, user.id);
  if (!project) return response;
  const set = await ownComparison(c.env, project.id, user.id, c.req.param('comparisonUid'));
  if (!set) return c.json({ detail: 'not_found' }, 404);
  const result = await c.env.DB.prepare(
    `DELETE FROM research_project_comparison_members
      WHERE comparison_id = ? AND subject_id IN (
        SELECT id FROM research_project_subjects WHERE project_id = ? AND owner_user_id = ? AND kind = ? AND directory_uid = ?)`
  ).bind(set.id, project.id, user.id, set.kind, c.req.param('memberUid')).run();
  if (!result.meta?.changes) return c.json({ detail: 'not_found' }, 404);
  await c.env.DB.prepare("UPDATE research_project_comparisons SET updated_at = datetime('now') WHERE id = ?").bind(set.id).run();
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_comparison_member_removed', { project_uid: project.uid, comparison_uid: set.uid, kind: set.kind, directory_uid: c.req.param('memberUid') });
  return c.json({ ok: true });
});

export const mount: RouteMount = { path: '/api/research/projects', router: comparisons };
export default comparisons;
