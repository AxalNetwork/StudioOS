/**
 * D1095 (#2960) — Google Workspace part 6: the founder's Google feeds Grow.
 *
 *   Revenue and traction       FACT  a metrics Sheet the founder chose and mapped.
 *                                    Each dated row is one `project_metrics` row
 *                                    with `source = 'google_sheets'`, one per day
 *                                    by the existing unique index.
 *   Durable company-building   PROPOSAL  Calendar events the founder tags in
 *                                    their own title, `#board` or `#filing`.
 *                                    Accept writes the obligation; nothing is
 *                                    written before.
 *
 * ONLY COLUMNS NO CONNECTED SOURCE WRITES (#2402 decision 11 (a)). Stripe
 * writes `mrr`, `arr`, `monthly_churn_pct`, `active_users` and
 * `paying_accounts`; Mercury writes `cash_in_cents`, `net_burn` and, through
 * its spend snapshot (D752, `routes/revenue.ts`), `cash_balance`. So a Sheet
 * may map `new_users`, `cac`, `ltv`, `headcount` and `nrr_pct`, and nothing
 * else: #2402's list also named `cash_balance`, which Mercury writes, so the
 * rule wins over the list (D1095 §2). A mapping naming any other column is
 * refused when it is saved and again when it is synced.
 *
 * EVERY LANDING GOES THROUGH `connector_fed_items` (D655): a row the founder
 * deletes stays deleted through every later sync. Stop using (D1091) unlinks a
 * file's rows and keeps them; choosing the file again links them again.
 *
 * NOTHING HERE IS LOGGED WITH A FIGURE, A TITLE OR A TOKEN. From a Calendar
 * event only its id, its title without the tag and its date are kept: never
 * its description, place or attendees.
 */
import type { Env } from '../../types';
import { loadRefreshTokenExport, reencryptRefreshTokenExport, refreshGoogleAccessToken } from '../calendar';
import { WorkspaceError, workspaceRead } from './workspace';

// ───────────────────────────────────────────────────────────── the metrics Sheet

/** The `project_metrics` columns a metrics Sheet may write. */
export const SHEET_METRIC_FIELDS = Object.freeze(['new_users', 'cac', 'ltv', 'headcount', 'nrr_pct'] as const);
export type SheetField = typeof SHEET_METRIC_FIELDS[number];
/** Columns Stripe or Mercury write. A Sheet never claims one (a test reads their writers for this list). */
export const CONNECTED_METRIC_COLUMNS = Object.freeze(['mrr', 'arr', 'monthly_churn_pct', 'active_users', 'paying_accounts', 'cash_in_cents', 'net_burn', 'cash_balance']);
const WHOLE = new Set<string>(['new_users', 'headcount']);
export const FIELD_LABEL: Readonly<Record<SheetField, string>> = Object.freeze({
  new_users: 'New users', cac: 'CAC', ltv: 'LTV', headcount: 'Headcount', nrr_pct: 'NRR (%)',
});
/** A sync reads at most this many data rows of a Sheet; more marks it partly synced. */
export const MAX_SHEET_ROWS = 500;
/** The file module D1091 registers a metrics Sheet under. */
export const METRICS_FILE_MODULE = 'revenue_traction';
/** The module its ledger rows count under ("Now fed by", D655). */
export const METRICS_LEDGER_MODULE = 'revenue_and_traction';

export class GoogleGrowRefused extends Error {
  code: string; status: number; field: string | null;
  constructor(code: string, status = 400, field: string | null = null) { super(code); this.code = code; this.status = status; this.field = field; }
}

export interface MetricsMapping { date: string; tab: string | null; header: boolean; fields: Partial<Record<SheetField, string>> }

/**
 * A metrics mapping, as the Map columns dialog saves it: `date` and each
 * allowed field name a column letter (A to Z); `tab` names the Sheet's tab and
 * `header` says whether its first row is headings (default yes).
 */
export function metricsMapping(raw: unknown): MetricsMapping {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new GoogleGrowRefused('invalid_mapping');
  const m = raw as Record<string, unknown>;
  const fields: Partial<Record<SheetField, string>> = {};
  const used = new Set<string>();
  const column = (k: string, v: unknown) => {
    if (typeof v !== 'string' || !/^[A-Z]$/.test(v)) throw new GoogleGrowRefused('invalid_mapping', 400, k);
    if (used.has(v)) throw new GoogleGrowRefused('mapping_column_twice', 400, k);
    used.add(v);
    return v;
  };
  for (const k of Object.keys(m)) {
    if (k === 'date' || k === 'tab' || k === 'header') continue;
    if (!(SHEET_METRIC_FIELDS as readonly string[]).includes(k)) {
      throw new GoogleGrowRefused(CONNECTED_METRIC_COLUMNS.includes(k) ? 'mapping_column_not_allowed' : 'invalid_mapping', 400, k);
    }
  }
  const date = column('date', m.date);
  for (const f of SHEET_METRIC_FIELDS) if (m[f] !== undefined && m[f] !== null) fields[f] = column(f, m[f]);
  if (!Object.keys(fields).length) throw new GoogleGrowRefused('mapping_needs_a_figure');
  let tab: string | null = null;
  if (m.tab !== undefined && m.tab !== null) {
    if (typeof m.tab !== 'string' || !m.tab.trim() || m.tab.length > 100 || /[\x00-\x1f]/.test(m.tab)) throw new GoogleGrowRefused('invalid_mapping', 400, 'tab');
    tab = m.tab;
  }
  if (m.header !== undefined && typeof m.header !== 'boolean') throw new GoogleGrowRefused('invalid_mapping', 400, 'header');
  return { date, tab, header: m.header !== false, fields };
}

/** The range a sync reads: the tab (quoted) or the first, A to Z, the header and MAX_SHEET_ROWS + 1 rows. */
export function sheetRange(mapping: MetricsMapping): string {
  const rows = MAX_SHEET_ROWS + 2;
  return mapping.tab ? `'${mapping.tab.replace(/'/g, "''")}'!A1:Z${rows}` : `A1:Z${rows}`;
}

const realDay = (y: number, m: number, d: number) => {
  const t = Date.UTC(y, m - 1, d);
  const s = new Date(t).toISOString().slice(0, 10);
  return s === `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` ? s : null;
};

/**
 * A Sheet cell as a day: `YYYY-MM-DD`, `YYYY/MM/DD`, or a month `YYYY-MM`,
 * which is its last day (Mercury's month rows sit on the same day). Anything
 * else, a locale's `10/03/2026` included, is not a date: which part is the
 * month would be a guess.
 */
export function sheetDay(v: unknown): string | null {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(s);
  if (m) return realDay(+m[1], +m[2], +m[3]);
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return new Date(Date.UTC(+m[1], +m[2], 0)).toISOString().slice(0, 10);
  return null;
}

/**
 * A Sheet cell as a figure, or null. A currency sign, thousands commas and a
 * trailing % are read; `1.234,5` is not (which mark is the decimal would be a
 * guess). Counts are whole and none is negative.
 */
export function sheetNumber(v: unknown, field: SheetField): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    let s = String(v ?? '').trim().replace(/^[$€£¥]\s*/, '').replace(/\s*[$€£¥]$/, '');
    if (field === 'nrr_pct') s = s.replace(/\s*%$/, '');
    if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return null;
    n = Number(s.replace(/,/g, ''));
  }
  if (!Number.isFinite(n) || n < 0) return null;
  if (WHOLE.has(field) && !Number.isInteger(n)) return null;
  return n;
}

export interface SheetRow { day: string; row: number; figures: Partial<Record<SheetField, number>> }
export interface Skipped { row: number; reason: 'not_a_date' | 'date_repeated' | 'no_figures' | 'not_a_number' | 'date_in_another_sheet'; field?: SheetField }

/** Each dated row's figures; every row not landed is named with its reason. */
export function sheetRows(values: unknown, mapping: MetricsMapping): { rows: SheetRow[]; skipped: Skipped[]; partial: boolean } {
  const grid = Array.isArray(values) ? values as unknown[][] : [];
  const start = mapping.header ? 1 : 0;
  const body = grid.slice(start, start + MAX_SHEET_ROWS);
  const col = (letter: string) => letter.charCodeAt(0) - 65;
  const rows: SheetRow[] = []; const skipped: Skipped[] = []; const seen = new Set<string>();
  body.forEach((cells, i) => {
    const row = start + i + 1;
    const line = Array.isArray(cells) ? cells : [];
    if (line.every((c) => String(c ?? '').trim() === '')) return;
    const day = sheetDay(line[col(mapping.date)]);
    if (!day) { skipped.push({ row, reason: 'not_a_date' }); return; }
    if (seen.has(day)) { skipped.push({ row, reason: 'date_repeated' }); return; }
    seen.add(day);
    const figures: Partial<Record<SheetField, number>> = {};
    for (const [f, letter] of Object.entries(mapping.fields) as Array<[SheetField, string]>) {
      const cell = line[col(letter)];
      if (String(cell ?? '').trim() === '') continue;
      const n = sheetNumber(cell, f);
      if (n == null) skipped.push({ row, reason: 'not_a_number', field: f });
      else figures[f] = n;
    }
    if (!Object.keys(figures).length) { skipped.push({ row, reason: 'no_figures' }); return; }
    rows.push({ day, row, figures });
  });
  return { rows, skipped, partial: grid.length - start > MAX_SHEET_ROWS };
}

// ───────────────────────────────────────────────────────────── landing the Sheet

const LEDGER_LINK = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, 'metric_day', ?, 'project_metrics', (SELECT id FROM project_metrics WHERE project_id = ? AND snapshot_date = ? AND source = 'google_sheets'))
     ON CONFLICT(integration_id, external_id) DO UPDATE SET project_id = excluded.project_id, module = excluded.module, local_table = excluded.local_table,
       local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;
const UPSERT = `INSERT INTO project_metrics (project_id, snapshot_date, new_users, cac, ltv, headcount, nrr_pct, notes, source, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google_sheets', ?)
     ON CONFLICT(project_id, snapshot_date, source) DO UPDATE SET new_users = excluded.new_users, cac = excluded.cac, ltv = excluded.ltv,
       headcount = excluded.headcount, nrr_pct = excluded.nrr_pct, notes = excluded.notes`;
const LEDGER_TOUCH = 'UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?';
const LEDGER_UNLINK = 'UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = ? AND external_id = ?';

/** The ledger id of one Sheet row: D1091's `<drive_file_id>:<item>`, so Stop using finds it. */
export const sheetExternalId = (fileId: string, projectId: number, day: string) => `${fileId}:${projectId}:${day}`;

export interface SheetCounts { written: number; kept_deleted: number }

/**
 * Lands a Sheet's rows. A row the founder deleted (its ledger row unlinked and
 * its `project_metrics` row gone) is never written again; one Stop using
 * unlinked, whose row is still there, is linked again. `claimed` holds the days
 * an earlier Sheet wrote in this sync: one source keeps one row per day.
 */
export async function landSheet(env: Env, integrationId: number, projectId: number, userId: number, fileId: string, rows: SheetRow[], today: string,
  claimed: Set<string>, skipped: Skipped[]): Promise<SheetCounts> {
  const prefix = `${fileId}:${projectId}:`;
  const ledger = new Map(((await env.DB.prepare(
    'SELECT external_id, local_id FROM connector_fed_items WHERE integration_id = ? AND project_id = ? AND substr(external_id, 1, length(?)) = ?',
  ).bind(integrationId, projectId, prefix, prefix).all<{ external_id: string; local_id: number | null }>()).results ?? [])
    .map((l) => [l.external_id, l.local_id]));
  const alive = new Map(((await env.DB.prepare(
    "SELECT id, snapshot_date FROM project_metrics WHERE project_id = ? AND source = 'google_sheets'",
  ).bind(projectId).all<{ id: number; snapshot_date: string }>()).results ?? []).map((r) => [r.snapshot_date, r.id]));
  const counts: SheetCounts = { written: 0, kept_deleted: 0 };
  const notes = `Read from your Google Sheet on ${today}.`;
  const statements: D1PreparedStatement[] = [];
  for (const r of rows) {
    if (claimed.has(r.day)) { skipped.push({ row: r.row, reason: 'date_in_another_sheet' }); continue; }
    const externalId = sheetExternalId(fileId, projectId, r.day);
    const linked = ledger.has(externalId) ? ledger.get(externalId) : undefined;
    const rowId = alive.get(r.day);
    // Deleted by the founder: the ledger knows the day and no row is left.
    if (ledger.has(externalId) && rowId === undefined) {
      if (linked != null) statements.push(env.DB.prepare(LEDGER_UNLINK).bind(integrationId, externalId));
      statements.push(env.DB.prepare(LEDGER_TOUCH).bind(integrationId, externalId));
      counts.kept_deleted += 1;
      continue;
    }
    claimed.add(r.day);
    const f = r.figures;
    statements.push(
      env.DB.prepare(UPSERT).bind(projectId, r.day, f.new_users ?? null, f.cac ?? null, f.ltv ?? null, f.headcount ?? null, f.nrr_pct ?? null, notes, userId),
      env.DB.prepare(LEDGER_LINK).bind(integrationId, projectId, METRICS_LEDGER_MODULE, externalId, projectId, r.day),
    );
    counts.written += 1;
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  return counts;
}

export interface SheetsOutcome {
  files: number; written: number; kept_deleted: number; partial: boolean;
  skipped: Array<Skipped & { file: string }>; problems: Array<{ file: string; error: string }>;
}

/** Every metrics Sheet this member chose for the venture, each read and landed on its own. */
export async function syncMetricsSheets(env: Env, integrationId: number, projectId: number, userId: number, today: string,
  fetcher?: typeof fetch): Promise<SheetsOutcome> {
  const files = (await env.DB.prepare(
    "SELECT id, uid, drive_file_id, mapping_json FROM google_workspace_files WHERE integration_id = ? AND user_id = ? AND project_id = ? AND module = ? AND status <> 'stopped' ORDER BY id",
  ).bind(integrationId, userId, projectId, METRICS_FILE_MODULE).all<{ id: number; uid: string; drive_file_id: string; mapping_json: string | null }>()).results ?? [];
  const out: SheetsOutcome = { files: files.length, written: 0, kept_deleted: 0, partial: false, skipped: [], problems: [] };
  const claimed = new Set<string>();
  for (const file of files) {
    let error: string | null = null;
    try {
      if (!file.mapping_json) throw new GoogleGrowRefused('not_mapped');
      const mapping = metricsMapping(JSON.parse(file.mapping_json));
      const reply = await workspaceRead(env, userId, 'spreadsheets.values.get', file.drive_file_id, { range: sheetRange(mapping) }, fetcher);
      const { rows, skipped, partial } = sheetRows(reply?.values, mapping);
      const counts = await landSheet(env, integrationId, projectId, userId, file.drive_file_id, rows, today, claimed, skipped);
      out.written += counts.written; out.kept_deleted += counts.kept_deleted; out.partial ||= partial;
      out.skipped.push(...skipped.slice(0, 50).map((s) => ({ ...s, file: file.uid })));
    } catch (e) {
      error = e instanceof GoogleGrowRefused || e instanceof WorkspaceError ? e.code : 'google_unreadable';
      out.problems.push({ file: file.uid, error });
    }
    const unreadable = error && error !== 'not_mapped' && !error.startsWith('mapping') && error !== 'invalid_mapping';
    await env.DB.prepare(
      `UPDATE google_workspace_files SET status = ?, last_error = ?, last_synced_at = CASE WHEN ? IS NULL THEN CURRENT_TIMESTAMP ELSE last_synced_at END,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(unreadable ? 'unreadable' : 'active', error, error, file.id).run();
  }
  return out;
}

/** A founder deletes a Sheet row; its ledger rows keep the day and the next sync leaves it deleted. */
export async function deleteSheetFact(env: Env, projectId: number, id: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM project_metrics WHERE id = ? AND project_id = ? AND source = 'google_sheets'").bind(id, projectId).first();
  if (!row) return false;
  await env.DB.batch([
    env.DB.prepare("UPDATE connector_fed_items SET local_id = NULL WHERE project_id = ? AND local_table = 'project_metrics' AND local_id = ?").bind(projectId, id),
    env.DB.prepare("DELETE FROM project_metrics WHERE id = ? AND project_id = ? AND source = 'google_sheets'").bind(id, projectId),
  ]);
  return true;
}

// ───────────────────────────────────────────────────────────── the Calendar

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'];
/** The days ahead a sync reads, and its page budget. */
export const CALENDAR_DAYS_AHEAD = 365;
export const CALENDAR_PAGES = 4;
export const DURABLE_MODULE = 'durable_company_building';

export type CalendarKind = 'board_meeting' | 'filing_deadline';
/** What each tag proposes, and the obligation kind Accept writes (growWriters' OBLIGATION_KINDS). */
export const CALENDAR_TAGS: Readonly<Record<string, { kind: CalendarKind; obligation: 'governance' | 'compliance'; label: string }>> = Object.freeze({
  board: { kind: 'board_meeting', obligation: 'governance', label: 'Board meeting' },
  filing: { kind: 'filing_deadline', obligation: 'compliance', label: 'Filing deadline' },
});
const TAG = /(^|\s)#(board|filing)(?=$|[\s.,;:!?)])/gi;

/**
 * The founder's tag in an event's title: `#board` or `#filing`, as its own
 * word. The title is kept without it; a title with both tags, or none, is
 * not proposed.
 */
export function calendarTag(summary: unknown): { kind: CalendarKind; title: string } | null {
  const s = String(summary ?? '');
  const tags = new Set([...s.matchAll(TAG)].map((m) => m[2].toLowerCase()));
  if (tags.size !== 1) return null;
  const tag = CALENDAR_TAGS[[...tags][0]];
  const title = s.replace(TAG, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { kind: tag.kind, title: title || tag.label };
}

export interface CalendarEvent { id?: string; status?: string; summary?: string; start?: { date?: string; dateTime?: string } }
export interface CalendarProposal { event_id: string; kind: CalendarKind; title: string; date: string }

/** Tagged, not cancelled, with an id and a day: an all-day event's date, a timed one's day where it was set. */
export function calendarProposals(events: CalendarEvent[]): CalendarProposal[] {
  const out: CalendarProposal[] = [];
  for (const e of events) {
    if (e.status === 'cancelled' || typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(e.id)) continue;
    const tag = calendarTag(e.summary);
    const day = sheetDay(String(e.start?.date ?? e.start?.dateTime ?? '').slice(0, 10));
    if (!tag || !day) continue;
    out.push({ event_id: e.id, kind: tag.kind, title: tag.title, date: day });
  }
  return out;
}

/**
 * The member's primary Calendar from today for CALENDAR_DAYS_AHEAD days, on
 * the grant they already gave (D1091's one Google store). GET only, no
 * redirect, ten seconds, error codes only; only id, status, title and start
 * are asked for.
 */
export async function readCalendar(env: Env, userId: number, today: string, fetcher: typeof fetch = fetch): Promise<{ events: CalendarEvent[]; partial: boolean }> {
  const grant = await env.DB.prepare('SELECT scope FROM google_oauth_tokens WHERE user_id = ?').bind(userId).first<{ scope: string | null }>()
    .catch(() => { throw new WorkspaceError('calendar_unreadable'); });
  if (!grant) throw new WorkspaceError('google_not_connected', 409);
  const scopes = String(grant.scope ?? '').split(/[\s,]+/).filter(Boolean);
  if (scopes.length && !scopes.some((s) => CALENDAR_SCOPES.includes(s))) throw new WorkspaceError('calendar_not_allowed', 409);
  let token: string;
  try {
    const stored = await loadRefreshTokenExport(env, 'google_oauth_tokens', userId);
    if (!stored?.raw) throw new WorkspaceError('google_not_connected', 409);
    token = await refreshGoogleAccessToken(env, stored.raw);
    if (stored.wasPlaintext) await reencryptRefreshTokenExport(env, 'google_oauth_tokens', userId, stored.raw);
  } catch (e) { throw e instanceof WorkspaceError ? e : new WorkspaceError('calendar_reconnect', 409); }
  const from = Date.parse(`${today}T00:00:00Z`);
  const events: CalendarEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < CALENDAR_PAGES; page++) {
    const q = new URLSearchParams({
      singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '250',
      fields: 'items(id,status,summary,start),nextPageToken',
      timeMin: new Date(from).toISOString(), timeMax: new Date(from + CALENDAR_DAYS_AHEAD * 86_400_000).toISOString(),
      ...(pageToken ? { pageToken } : {}),
    });
    let body: { items?: CalendarEvent[]; nextPageToken?: string } | null;
    try {
      const res = await fetcher(`${CALENDAR_API}/calendars/primary/events?${q}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 429) throw new WorkspaceError('google_rate_limited');
      if (res.status === 401 || res.status === 403) throw new WorkspaceError('calendar_reconnect', 409);
      if (!res.ok) throw new WorkspaceError('calendar_unreadable');
      const text = await res.text();
      if (text.length > 2 * 1024 * 1024) throw new WorkspaceError('calendar_unreadable');
      body = JSON.parse(text);
    } catch (e) { throw e instanceof WorkspaceError ? e : new WorkspaceError('calendar_unreadable'); }
    events.push(...(Array.isArray(body?.items) ? body!.items : []));
    pageToken = typeof body?.nextPageToken === 'string' ? body.nextPageToken : '';
    if (!pageToken) return { events, partial: false };
  }
  return { events, partial: true };
}

export interface CalendarOutcome { proposed: number; updated: number; withdrawn: number; decided_kept: number; partial: boolean }

/**
 * Proposes each tagged event once. A pending proposal follows its event (a new
 * title or day); a decided one is never proposed again. When the read was
 * whole, a pending proposal whose event is gone or no longer tagged is
 * withdrawn.
 */
export async function proposeFromCalendar(env: Env, integrationId: number, projectId: number, found: CalendarProposal[], partial: boolean): Promise<CalendarOutcome> {
  const existing = new Map(((await env.DB.prepare(
    "SELECT id, source_key, fingerprint, status FROM google_workspace_proposals WHERE integration_id = ? AND project_id = ? AND module = ? AND substr(source_key, 1, 9) = 'calendar:'",
  ).bind(integrationId, projectId, DURABLE_MODULE).all<{ id: number; source_key: string; fingerprint: string; status: string }>()).results ?? [])
    .map((p) => [p.source_key, p]));
  const out: CalendarOutcome = { proposed: 0, updated: 0, withdrawn: 0, decided_kept: 0, partial };
  const statements: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const p of found) {
    const key = `calendar:${p.event_id}`;
    seen.add(key);
    const fingerprint = `${p.kind}|${p.date}|${p.title}`;
    const was = existing.get(key);
    if (was && was.status !== 'pending') { out.decided_kept += 1; continue; }
    if (was && was.fingerprint === fingerprint) continue;
    statements.push(env.DB.prepare(
      `INSERT INTO google_workspace_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(integration_id, project_id, source_key) DO UPDATE SET kind = excluded.kind, fingerprint = excluded.fingerprint,
         title = excluded.title, payload_json = excluded.payload_json WHERE google_workspace_proposals.status = 'pending'`,
    ).bind(integrationId, projectId, DURABLE_MODULE, p.kind, key, fingerprint, p.title, JSON.stringify({ date: p.date, event_id: p.event_id })));
    if (was) out.updated += 1; else out.proposed += 1;
  }
  if (!partial) {
    for (const [key, p] of existing) {
      if (p.status !== 'pending' || seen.has(key)) continue;
      statements.push(env.DB.prepare("DELETE FROM google_workspace_proposals WHERE id = ? AND status = 'pending'").bind(p.id));
      out.withdrawn += 1;
    }
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  return out;
}

export type DecideOutcome = { state: 'ok'; proposal: { id: number; kind: CalendarKind; title: string; date: string; event_id: string } } | { state: 'not_found' | 'decided' };

/** One pending Calendar proposal of this member's on this venture. */
export async function pendingProposal(env: Env, integrationId: number, projectId: number, id: number): Promise<DecideOutcome> {
  const p = await env.DB.prepare(
    'SELECT id, kind, title, payload_json, status FROM google_workspace_proposals WHERE id = ? AND integration_id = ? AND project_id = ? AND module = ?',
  ).bind(id, integrationId, projectId, DURABLE_MODULE).first<{ id: number; kind: CalendarKind; title: string; payload_json: string; status: string }>();
  if (!p) return { state: 'not_found' };
  if (p.status !== 'pending') return { state: 'decided' };
  const payload = JSON.parse(p.payload_json || '{}');
  return { state: 'ok', proposal: { id: p.id, kind: p.kind, title: p.title, date: String(payload.date), event_id: String(payload.event_id) } };
}

/** Marks a proposal decided; Accept also links the obligation it wrote through the ledger. */
export async function decideProposal(env: Env, integrationId: number, projectId: number, id: number, userId: number,
  accepted: { obligationId: number; eventId: string } | null): Promise<boolean> {
  const statements = [env.DB.prepare(
    "UPDATE google_workspace_proposals SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND integration_id = ? AND project_id = ? AND status = 'pending'",
  ).bind(accepted ? 'accepted' : 'dismissed', userId, id, integrationId, projectId)];
  if (accepted) statements.push(env.DB.prepare(
    `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
       VALUES (?, ?, ?, 'obligation', ?, 'compliance_events', ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET local_table = excluded.local_table, local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`,
  ).bind(integrationId, projectId, DURABLE_MODULE, `calendar:${accepted.eventId}:${projectId}`, accepted.obligationId));
  const [r] = await env.DB.batch(statements);
  return Number(r.meta?.changes ?? 0) > 0;
}

// ───────────────────────────────────────────────────────────── the read for From Google

export interface FromGoogleRead {
  files: Array<{ uid: string; name: string; status: string; last_error: string | null; last_synced_at: string | null; mapped: boolean; mine: boolean }>;
  facts?: Array<{ id: number; snapshot_date: string } & Partial<Record<SheetField, number | null>>>;
  kept_deleted?: number;
  proposals?: Array<{ id: number; kind: CalendarKind; title: string; date: string }>;
  decided?: { accepted: number; dismissed: number };
}

/** What a module's From Google section draws: the venture's Sheets and their rows, or this member's Calendar proposals. */
export async function readFromGoogle(env: Env, projectId: number, viewerId: number, integrationId: number | null,
  module: 'revenue_and_traction' | 'durable_company_building'): Promise<FromGoogleRead> {
  if (module === 'revenue_and_traction') {
    const files = (await env.DB.prepare(
      "SELECT uid, name, status, last_error, last_synced_at, mapping_json, user_id FROM google_workspace_files WHERE project_id = ? AND module = ? AND status <> 'stopped' ORDER BY id",
    ).bind(projectId, METRICS_FILE_MODULE).all<{ uid: string; name: string; status: string; last_error: string | null; last_synced_at: string | null; mapping_json: string | null; user_id: number }>()).results ?? [];
    const facts = (await env.DB.prepare(
      "SELECT id, snapshot_date, new_users, cac, ltv, headcount, nrr_pct FROM project_metrics WHERE project_id = ? AND source = 'google_sheets' ORDER BY snapshot_date DESC, id DESC LIMIT 200",
    ).bind(projectId).all<any>()).results ?? [];
    const deleted = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM connector_fed_items WHERE project_id = ? AND module = ? AND kind = 'metric_day' AND local_id IS NULL",
    ).bind(projectId, METRICS_LEDGER_MODULE).first<{ n: number }>();
    return {
      files: files.map((f) => ({ uid: f.uid, name: f.name, status: f.status, last_error: f.last_error, last_synced_at: f.last_synced_at, mapped: !!f.mapping_json, mine: f.user_id === viewerId })),
      facts, kept_deleted: Number(deleted?.n ?? 0),
    };
  }
  if (integrationId == null) return { files: [], proposals: [], decided: { accepted: 0, dismissed: 0 } };
  const rows = (await env.DB.prepare(
    'SELECT id, kind, title, payload_json, status FROM google_workspace_proposals WHERE integration_id = ? AND project_id = ? AND module = ? ORDER BY id',
  ).bind(integrationId, projectId, DURABLE_MODULE).all<{ id: number; kind: CalendarKind; title: string; payload_json: string; status: string }>()).results ?? [];
  const pending = rows.filter((p) => p.status === 'pending').map((p) => ({ id: p.id, kind: p.kind, title: p.title, date: String(JSON.parse(p.payload_json || '{}').date) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return {
    files: [], proposals: pending,
    decided: { accepted: rows.filter((p) => p.status === 'accepted').length, dismissed: rows.filter((p) => p.status === 'dismissed').length },
  };
}
