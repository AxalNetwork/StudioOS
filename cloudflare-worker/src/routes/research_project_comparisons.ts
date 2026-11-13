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
 * AN ARCHIVED PROJECT IS READ-ONLY (409 `project_archived`), as in part 1.
 * Every write leaves an audit receipt. All SQL is bound; a list of uids is one
 * bound JSON array read through `json_each`.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { presentMetrics } from '../services/researchCompanyDirectory';
import { presentFund, type DirectoryRow as FundRow } from '../services/researchFundDirectory';
import type { RouteMount } from '../util/routeRegistry';
import { checkProjectOwner } from './research_projects';

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
  fund: [
    { key: 'hq', label: 'Headquarters' },
    { key: 'focus', label: 'Stated focus' },
    { key: 'fund_number', label: 'Fund' },
    { key: 'size', label: 'Fund size' },
    { key: 'vintage', label: 'Vintage' },
    { key: 'notable_lps', label: 'Notable LPs' },
    { key: 'backing', label: 'EIF / EIFO' },
  ],
};

type Source = { name: string | null; url: string | null };
type Row = Record<string, any>;
export type Cell =
  | { status: 'recorded'; value: unknown; source: Source; as_of: string | null; [extra: string]: unknown }
  | { status: 'not_recorded'; reason: string };

const isKind = (v: unknown): v is Kind => v === 'company' || v === 'fund';
const has = (v: unknown) => (typeof v === 'string' ? v.trim() !== '' : v != null);
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const touch = (env: Env, id: number) =>
  env.DB.prepare("UPDATE research_projects SET updated_at = datetime('now') WHERE id = ?").bind(id).run();

/** A value with its source and date, or Not recorded — never a zero or a blank. */
function cell(value: unknown, source: Source, asOf: unknown, extra: Row = {}, reason = 'Not recorded: the directory holds no value'): Cell {
  if (!has(value)) return { status: 'not_recorded', reason };
  return { status: 'recorded', value: typeof value === 'string' ? value.trim() : value, ...extra, source, as_of: has(asOf) ? String(asOf) : null };
}

/** A company directory row as the comparison's cells (migration 228 and 375's columns). */
export function companyCells(r: Row): Record<string, Cell> {
  const record = { name: r.source_name ?? null, url: r.source_url ?? null };
  const m = presentMetrics(r) as Record<string, Row>;
  const metric = (x: Row, extra: Row = {}): Cell => (x.status === 'recorded'
    ? { status: 'recorded', value: x.value, ...extra, source: { name: x.source_name ?? null, url: x.source_url ?? null }, as_of: x.as_of ?? null }
    : { status: 'not_recorded', reason: 'Not recorded: no source lists it for this company' });
  const founded = Number(r.founded_year);
  return {
    country: cell(r.country, record, r.as_of),
    sector: cell(r.sector, record, r.as_of),
    founded: cell(Number.isInteger(founded) && founded > 0 ? founded : null, record, r.as_of),
    employees: metric(m.headcount),
    last_round: metric(m.last_funding, { currency: m.last_funding.currency ?? null, type: m.last_funding.type ?? null, date: m.last_funding.date ?? null }),
    funding_total: metric(m.funding_total, { currency: m.funding_total.currency ?? null }),
    revenue: metric(m.revenue, { currency: m.revenue.currency ?? null }),
  };
}

/** A served fund directory row as the comparison's cells (migration 378's columns). */
export function fundCells(raw: FundRow): Record<string, Cell> {
  const r = presentFund(raw);
  const source = { name: r.source_name ?? null, url: r.source_url ?? null };
  const backing = r.eif == null && r.eifo == null ? null : { eif: r.eif, eifo: r.eifo };
  return {
    hq: cell(r.hq, source, r.as_of),
    focus: cell(r.sector_focus, source, r.as_of),
    fund_number: cell(r.fund_number, source, r.as_of),
    size: r.fund_size_cents != null && r.size_currency
      ? cell(r.fund_size_cents, source, r.as_of, { currency: r.size_currency })
      : { status: 'not_recorded', reason: (r as Row).size_reason || 'Not recorded' },
    vintage: cell(r.fund_year, source, r.as_of, { date: r.fund_date ?? null }),
    notable_lps: cell(r.notable_lps, source, r.as_of),
    backing: cell(backing, source, r.as_of, {}, 'Not recorded: the list names no LPs for this fund'),
  };
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

/** The names joined as a title, cut at a name inside the limit. */
export function defaultComparisonTitle(names: string[]): string {
  let title = '';
  for (const name of names) {
    const next = title ? `${title} · ${name}` : name;
    if (next.length > TITLE_LIMIT) return title ? `${title} …` : name.slice(0, TITLE_LIMIT - 1) + '…';
    title = next;
  }
  return title;
}

/**
 * Adds the directory rows `uids` to the project as subjects (an existing one
 * is kept) and returns each uid's subject id, or the uids the directory does
 * not hold. A failed directory read throws to the caller.
 */
async function ensureSubjects(env: Env, projectId: number, userId: number, kind: Kind, uids: string[]) {
  const listed = await directoryRows(env, kind, uids);
  const missing = uids.filter((u) => !listed.has(u));
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
  for (const kind of KINDS) {
    const uids = subjects.filter((s) => s.kind === kind).map((s) => s.directory_uid);
    if (!uids.length) continue;
    try {
      read[kind].rows = await directoryRows(c.env, kind, uids);
      if (kind === 'fund') read[kind].withdrawn = await withdrawnFunds(c.env, uids.filter((u) => !read[kind].rows.has(u)));
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
        return { ...view, values: view.state === 'listed' && row ? (s.kind === 'company' ? companyCells(row) : fundCells(row as FundRow)) : null };
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

comparisons.post('/:uid/comparisons', async (c) => {
  const user = await requireAuth(c);
  const { project, response } = await writableProject(c, user.id);
  if (!project) return response;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ detail: 'invalid_body' }, 400);
  if (!isKind(body.kind)) return c.json({ detail: 'invalid_kind' }, 400);
  const read = readUids(body.uids, MEMBER_LIMIT);
  if (read.error) return c.json({ detail: read.error === 'too_many' ? 'comparison_full' : read.error }, 400);
  const sentTitle = body.title === undefined || body.title === null || body.title === '' ? null : readTitle(body.title);
  if (sentTitle?.error) return c.json({ detail: sentTitle.error }, 400);
  let result;
  try {
    result = await ensureSubjects(c.env, project.id, user.id, body.kind, read.uids!);
  } catch {
    return c.json({ detail: 'directory_unreadable' }, 503);
  }
  if (result.missing) return c.json({ detail: 'not_in_directory', missing: result.missing }, 404);
  const title = sentTitle?.value ?? defaultComparisonTitle(result.subjects!.map((s) => s.name));
  const uid = newUid();
  const made = await c.env.DB.prepare(
    `INSERT INTO research_project_comparisons (uid, project_id, owner_user_id, kind, title, created_by)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(uid, project.id, user.id, body.kind, title, user.id).first<{ id: number }>();
  let position = 0;
  for (const s of result.subjects!) {
    position += 1;
    await c.env.DB.prepare(
      'INSERT INTO research_project_comparison_members (comparison_id, subject_id, kind, position, created_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(made!.id, s.id, body.kind, position, user.id).run();
  }
  await touch(c.env, project.id);
  await logAdminAction(c.env, user.id, user.email, 'research_project_comparison_created', {
    project_uid: project.uid, comparison_uid: uid, kind: body.kind, members: position, subjects_added: result.added,
  });
  return c.json({ item: { uid, kind: body.kind, title } }, 201);
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
  if (result.missing) return c.json({ detail: 'not_in_directory', missing: result.missing }, 404);
  const subject = result.subjects![0];
  await c.env.DB.prepare(
    'INSERT INTO research_project_comparison_members (comparison_id, subject_id, kind, position, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(set.id, subject.id, set.kind, Number(count?.last || 0) + 1, user.id).run();
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
