/**
 * D1093 (#2958, part 4 of #2402) — Google Workspace feeds Build: spec Docs as
 * Solution design proposals, and a mapped roadmap Sheet into Product roadmap.
 *
 * SPEC DOCS → PROPOSALS. Each Doc chosen for Solution design is read with
 * `documents.get`; its title and headings become one proposal in
 * `google_workspace_proposals` (kind `design_note`, module `solution_design`,
 * `source_key` = the file id). The fingerprint is the SHA-256 of the title and
 * headings: a sync that finds the same text leaves the proposal alone, whatever
 * its status, so a dismissed proposal does not come back; changed text puts it
 * back to pending. A proposal is judgement, not a fact: nothing reaches a
 * module until the founder accepts it. Accept writes one
 * `solution_design_notes` row (`source_path` = `google_docs/<file id>`) linked
 * by the ledger (`<file id>:design_note`); a later Accept of the same Doc
 * updates that note instead of writing a second one, unless the founder has
 * deleted it. The proposals table (migration 588) holds them, not
 * `solution_design_proposals`, whose `repository` and `path` are GitHub's
 * shape and which Disconnect does not clear.
 *
 * A ROADMAP SHEET → ROADMAP ITEMS. A Sheet chosen for Product roadmap lands
 * nothing until the founder maps it (GW4): which column is the objective, the
 * quarter and the status, and optionally the key result and the progress. Each
 * row with an objective is one fact, keyed in the ledger by its file and its
 * objective (`<file id>:row:<hash>`):
 *   - a new row creates a `roadmap_okrs` item;
 *   - a row the ledger holds updates its own item only, and only while this
 *     connection is that item's one owner (`fedOwnership.ts`): a GitHub-,
 *     Notion- or hand-entered row is never written;
 *   - a row whose item the founder deleted stays deleted, and is unlinked.
 * Sheet text is untrusted: it is stored as text and drawn as text.
 *
 * Reads are `workspaceRead`'s (GET only, bounded, error codes only). Nothing
 * here logs a cell, a heading or a title.
 */
import type { Env } from '../../types';
import { ledgerOwnerOf } from '../../integrations/fedOwnership';
import { WorkspaceError, workspaceRead } from './workspace';

export const DESIGN_KIND = 'design_note';
export const MAX_HEADINGS = 40;
export const MAX_ROWS = 500;
export const SHEET_RANGE = `A1:Z${MAX_ROWS + 1}`;
export const MAPPED_FIELDS = Object.freeze(['objective', 'key_result', 'quarter', 'status', 'progress'] as const);
export const REQUIRED_FIELDS = Object.freeze(['objective', 'quarter', 'status'] as const);
export type MappedField = (typeof MAPPED_FIELDS)[number];
export interface RoadmapMapping { header_row: number; columns: Partial<Record<MappedField, string>> }

const LEDGER_OF = 'SELECT external_id, local_id FROM connector_fed_items WHERE integration_id = ? AND external_id IN (SELECT value FROM json_each(?))';
const LEDGER_TOUCH = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`;
const LEDGER_NEW_ROW = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?, last_insert_rowid())
     ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`;
const UNLINK_DELETED = `UPDATE connector_fed_items SET local_id = NULL, local_table = NULL
     WHERE integration_id = ? AND external_id = ? AND local_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM roadmap_okrs WHERE id = ? AND project_id = ?)`;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const parsed = (raw: unknown) => { try { return typeof raw === 'string' ? JSON.parse(raw) : null; } catch { return null; } };
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, n);

// ── Spec Docs ────────────────────────────────────────────────────────────────

/** A Doc's title and its headings (HEADING_1 to HEADING_3), in order, as plain text. */
export function docOutline(doc: any): { title: string; headings: Array<{ level: number; text: string }> } {
  const title = clip(doc?.title, 300);
  const headings: Array<{ level: number; text: string }> = [];
  for (const block of Array.isArray(doc?.body?.content) ? doc.body.content : []) {
    const style = block?.paragraph?.paragraphStyle?.namedStyleType;
    const m = /^HEADING_([1-3])$/.exec(String(style || ''));
    if (!m) continue;
    const text = clip((block.paragraph.elements || []).map((e: any) => e?.textRun?.content ?? '').join(''), 200);
    if (text) headings.push({ level: Number(m[1]), text });
    if (headings.length >= MAX_HEADINGS) break;
  }
  return { title, headings };
}

/** One Doc's proposal: inserted, back to pending when its text changed, or left alone. */
export async function proposeDoc(env: Env, integrationId: number, projectId: number, file: { drive_file_id: string; name: string; modified_time: string | null }, doc: any): Promise<'proposed' | 'changed' | 'unchanged'> {
  const outline = docOutline(doc);
  const title = outline.title || clip(file.name, 300) || 'Untitled Doc';
  const fingerprint = await sha256(JSON.stringify([title, outline.headings]));
  const payload = JSON.stringify({ file_id: file.drive_file_id, headings: outline.headings, modified_time: file.modified_time });
  const was = await env.DB.prepare('SELECT id, fingerprint FROM google_workspace_proposals WHERE integration_id = ? AND project_id = ? AND source_key = ?')
    .bind(integrationId, projectId, file.drive_file_id).first<{ id: number; fingerprint: string }>();
  if (was && was.fingerprint === fingerprint) return 'unchanged';
  if (was) {
    await env.DB.prepare(`UPDATE google_workspace_proposals SET fingerprint = ?, title = ?, payload_json = ?, status = 'pending', decided_by = NULL, decided_at = NULL
       WHERE id = ?`).bind(fingerprint, title, payload, was.id).run();
    return 'changed';
  }
  await env.DB.prepare(`INSERT INTO google_workspace_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title, payload_json)
     VALUES (?, ?, 'solution_design', ?, ?, ?, ?, ?)`).bind(integrationId, projectId, DESIGN_KIND, file.drive_file_id, fingerprint, title, payload).run();
  return 'proposed';
}

export type DecideOutcome = 'ok' | 'not_found' | 'decided';
const docUrl = (fileId: string) => `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`;
const noteBody = (payload: any) => (Array.isArray(payload?.headings) ? payload.headings : [])
  .map((h: any) => `${'  '.repeat(Math.max(0, Number(h.level) - 1))}• ${clip(h.text, 200)}`).join('\n') || null;

async function outcomeOf(env: Env, projectId: number, integrationId: number, id: number): Promise<DecideOutcome> {
  const row = await env.DB.prepare('SELECT status FROM google_workspace_proposals WHERE id = ? AND project_id = ? AND integration_id = ? AND kind = ?')
    .bind(id, projectId, integrationId, DESIGN_KIND).first<{ status: string }>();
  return row ? 'decided' : 'not_found';
}

/** Accept: pending → accepted, once; writes or updates the Doc's note, linked by the ledger. */
export async function acceptDocProposal(env: Env, projectId: number, integrationId: number, id: number, userId: number): Promise<DecideOutcome> {
  const p = await env.DB.prepare(`SELECT id, source_key, title, payload_json FROM google_workspace_proposals
     WHERE id = ? AND project_id = ? AND integration_id = ? AND kind = ? AND status = 'pending'`).bind(id, projectId, integrationId, DESIGN_KIND)
    .first<{ id: number; source_key: string; title: string; payload_json: string }>();
  if (!p) return outcomeOf(env, projectId, integrationId, id);
  let payload: any = {};
  try { payload = JSON.parse(p.payload_json); } catch { payload = {}; }
  const externalId = `${p.source_key}:${DESIGN_KIND}`;
  const linked = await env.DB.prepare(`SELECT f.local_id FROM connector_fed_items f JOIN solution_design_notes n ON n.id = f.local_id AND n.project_id = ?
     WHERE f.integration_id = ? AND f.external_id = ? AND f.local_table = 'solution_design_notes'`).bind(projectId, integrationId, externalId)
    .first<{ local_id: number }>();
  const claim = env.DB.prepare(`UPDATE google_workspace_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'`).bind(userId, id);
  const write = linked
    ? [env.DB.prepare('UPDATE solution_design_notes SET title = ?, body = ?, source_url = ? WHERE id = ? AND project_id = ?')
      .bind(p.title, noteBody(payload), docUrl(p.source_key), linked.local_id, projectId),
    env.DB.prepare(LEDGER_TOUCH).bind(integrationId, projectId, 'solution_design', DESIGN_KIND, externalId, 'solution_design_notes', linked.local_id)]
    : [env.DB.prepare(`INSERT INTO solution_design_notes (project_id, proposal_id, title, body, source_url, source_path, created_by)
        VALUES (?, NULL, ?, ?, ?, ?, ?)`).bind(projectId, p.title, noteBody(payload), docUrl(p.source_key), `google_docs/${p.source_key}`, userId),
    env.DB.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
        VALUES (?, ?, 'solution_design', ?, ?, 'solution_design_notes', last_insert_rowid())
        ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`)
      .bind(integrationId, projectId, DESIGN_KIND, externalId)];
  const out = await env.DB.batch([claim, ...write]);
  if (!out[0]?.meta?.changes) return 'decided';
  return 'ok';
}

/** Dismiss: pending → dismissed, once. It comes back only if the Doc's title or headings change. */
export async function dismissDocProposal(env: Env, projectId: number, integrationId: number, id: number, userId: number): Promise<DecideOutcome> {
  const r = await env.DB.prepare(`UPDATE google_workspace_proposals SET status = 'dismissed', decided_by = ?, decided_at = CURRENT_TIMESTAMP
     WHERE id = ? AND project_id = ? AND integration_id = ? AND kind = ? AND status = 'pending'`).bind(userId, id, projectId, integrationId, DESIGN_KIND).run();
  return r.meta?.changes ? 'ok' : outcomeOf(env, projectId, integrationId, id);
}

// ── The roadmap Sheet ────────────────────────────────────────────────────────

const COLUMN = /^[A-Z]$/;
/** The mapping GW4 saves, validated here: the feed trusts no draft. Null when it cannot land a row. */
export function roadmapMapping(raw: unknown): RoadmapMapping | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as any;
  const cols = r.columns;
  if (!cols || typeof cols !== 'object' || Array.isArray(cols)) return null;
  const out: Partial<Record<MappedField, string>> = {};
  for (const [k, v] of Object.entries(cols)) {
    if (!(MAPPED_FIELDS as readonly string[]).includes(k)) return null;
    if (v == null || v === '') continue;
    if (typeof v !== 'string' || !COLUMN.test(v)) return null;
    out[k as MappedField] = v;
  }
  if (!REQUIRED_FIELDS.every((k) => out[k])) return null;
  if (new Set(Object.values(out)).size !== Object.values(out).length) return null;
  const header = r.header_row == null ? 1 : Number(r.header_row);
  if (!Number.isInteger(header) || header < 0 || header > 10) return null;
  return { header_row: header, columns: out };
}

const cell = (row: unknown[], col: string | undefined) => (col ? row[col.charCodeAt(0) - 65] : undefined);

/** The Sheet's status words in Product roadmap's lanes. An unknown word moves nothing. */
export function laneOf(raw: unknown): 'now' | 'next' | 'later' | 'done' | null {
  const s = clip(raw, 60).toLowerCase();
  if (!s) return null;
  if (/^(done|complete(d)?|shipped|launched|finished)$/.test(s)) return 'done';
  if (/^(now|in progress|doing|active|started|on track|at risk|ongoing)$/.test(s)) return 'now';
  if (/^(next|planned|to ?do|not started|up next)$/.test(s)) return 'next';
  if (/^(later|backlog|someday|parked|icebox)$/.test(s)) return 'later';
  return null;
}

/** Progress as a percentage 0–100, or null: "40%", "40", "0.4". Never a guess. */
export function progressOf(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().replace(/%$/, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  let n = Number(s);
  if (!String(raw).trim().endsWith('%') && n > 0 && n <= 1 && s.includes('.')) n *= 100;
  return n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : null;
}

export interface SheetRow { key: string; objective: string; quarter: string | null; lane: ReturnType<typeof laneOf>; keyResult: string | null; progress: number | null }

/** The rows a mapping lands: one per distinct objective, after the header row. Blank and repeated objectives are counted, not landed. */
export async function sheetRows(values: unknown, mapping: RoadmapMapping, fileId: string): Promise<{ rows: SheetRow[]; blank: number; repeated: number }> {
  const all = Array.isArray(values) ? values.slice(mapping.header_row, mapping.header_row + MAX_ROWS) : [];
  const seen = new Set<string>();
  const rows: SheetRow[] = []; let blank = 0; let repeated = 0;
  for (const raw of all) {
    const row = Array.isArray(raw) ? raw : [];
    const objective = clip(cell(row, mapping.columns.objective), 300);
    if (!objective) { blank += 1; continue; }
    const norm = objective.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(norm)) { repeated += 1; continue; }
    seen.add(norm);
    rows.push({
      key: `${fileId}:row:${(await sha256(norm)).slice(0, 16)}`,
      objective,
      quarter: clip(cell(row, mapping.columns.quarter), 20) || null,
      lane: laneOf(cell(row, mapping.columns.status)),
      keyResult: clip(cell(row, mapping.columns.key_result), 300) || null,
      progress: progressOf(cell(row, mapping.columns.progress)),
    });
  }
  return { rows, blank, repeated };
}

/** The item's key results as Product roadmap stores them: one, with its progress, when the Sheet has either. */
export function keyResultsJson(r: SheetRow): string {
  if (!r.keyResult && r.progress == null) return '[]';
  return JSON.stringify([{ text: r.keyResult || 'Progress', current: r.progress, target: r.progress == null ? null : 100, unit: r.progress == null ? null : '%' }]);
}

export interface RoadmapCounts { created: number; updated: number; held: number; deleted_kept: number; blank: number; repeated: number }

/** Lands one mapped Sheet's rows under the one-owner rule. */
export async function landRoadmapRows(env: Env, integrationId: number, projectId: number, userId: number, rows: SheetRow[]): Promise<Omit<RoadmapCounts, 'blank' | 'repeated'>> {
  const counts = { created: 0, updated: 0, held: 0, deleted_kept: 0 };
  if (!rows.length) return counts;
  const ledger = new Map(((await env.DB.prepare(LEDGER_OF).bind(integrationId, JSON.stringify(rows.map((r) => r.key))).all<{ external_id: string; local_id: number | null }>()).results || [])
    .map((r) => [r.external_id, r.local_id ?? null]));
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const touch = env.DB.prepare(LEDGER_TOUCH);
    if (ledger.has(r.key)) {
      const localId = ledger.get(r.key);
      if (!localId) { counts.deleted_kept += 1; stmts.push(touch.bind(integrationId, projectId, 'product_roadmap', 'roadmap_row', r.key, null, null)); continue; }
      let owner: number | null;
      try { owner = await ledgerOwnerOf(env, 'roadmap_okrs', localId); } catch { owner = -1; }
      if (owner !== integrationId) { counts.held += 1; continue; }
      const exists = await env.DB.prepare('SELECT 1 AS x FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(localId, projectId).first();
      if (!exists) { counts.deleted_kept += 1; stmts.push(env.DB.prepare(UNLINK_DELETED).bind(integrationId, r.key, localId, projectId)); continue; }
      stmts.push(
        env.DB.prepare(`UPDATE roadmap_okrs SET objective = ?, quarter = ?, key_results_json = ?, kanban_status = COALESCE(?, kanban_status), updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND project_id = ?`).bind(r.objective, r.quarter, keyResultsJson(r), r.lane, localId, projectId),
        touch.bind(integrationId, projectId, 'product_roadmap', 'roadmap_row', r.key, 'roadmap_okrs', localId),
      );
      counts.updated += 1;
      continue;
    }
    stmts.push(
      env.DB.prepare(`INSERT INTO roadmap_okrs (project_id, objective, key_results_json, kanban_status, quarter, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).bind(projectId, r.objective, keyResultsJson(r), r.lane ?? 'next', r.quarter, userId),
      env.DB.prepare(LEDGER_NEW_ROW).bind(integrationId, projectId, 'product_roadmap', 'roadmap_row', r.key, 'roadmap_okrs'),
    );
    counts.created += 1;
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return counts;
}

// ── The sync ─────────────────────────────────────────────────────────────────

export interface FileOutcome { uid: string; module: string; name: string; state: 'synced' | 'needs_mapping' | 'unreadable'; error?: string; counts?: Record<string, number> }

/** One venture's Build files: Docs proposed, mapped Sheets landed. One file's failure never stops the next. */
export async function syncBuildFiles(env: Env, args: { integrationId: number; projectId: number; userId: number }) {
  const files = (await env.DB.prepare(`SELECT id, uid, module, kind, drive_file_id, name, mapping_json, modified_time FROM google_workspace_files
     WHERE integration_id = ? AND user_id = ? AND project_id = ? AND status <> 'stopped' AND module IN ('solution_design', 'product_roadmap') ORDER BY id`)
    .bind(args.integrationId, args.userId, args.projectId).all<any>()).results || [];
  const out: FileOutcome[] = [];
  const totals = { proposed: 0, changed: 0, unchanged: 0, created: 0, updated: 0, held: 0, deleted_kept: 0, blank: 0, repeated: 0, needs_mapping: 0, unreadable: 0 };
  for (const f of files) {
    try {
      if (f.module === 'solution_design' && f.kind === 'doc') {
        const doc = await workspaceRead(env, args.userId, 'documents.get', f.drive_file_id);
        const r = await proposeDoc(env, args.integrationId, args.projectId, f, doc);
        totals[r] += 1;
        out.push({ uid: f.uid, module: f.module, name: f.name, state: 'synced', counts: { [r]: 1 } });
      } else if (f.module === 'product_roadmap' && f.kind === 'sheet') {
        const mapping = roadmapMapping(parsed(f.mapping_json));
        if (!mapping) { totals.needs_mapping += 1; out.push({ uid: f.uid, module: f.module, name: f.name, state: 'needs_mapping' }); continue; }
        const reply = await workspaceRead(env, args.userId, 'spreadsheets.values.get', f.drive_file_id, { range: SHEET_RANGE });
        const { rows, blank, repeated } = await sheetRows(reply?.values, mapping, f.drive_file_id);
        const c = await landRoadmapRows(env, args.integrationId, args.projectId, args.userId, rows);
        for (const [k, v] of Object.entries({ ...c, blank, repeated })) totals[k as keyof typeof totals] += v;
        out.push({ uid: f.uid, module: f.module, name: f.name, state: 'synced', counts: { ...c, blank, repeated } });
      } else continue;
      await env.DB.prepare(`UPDATE google_workspace_files SET last_synced_at = CURRENT_TIMESTAMP, status = 'active', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(f.id).run();
    } catch (e) {
      const code = e instanceof WorkspaceError ? e.code : 'workspace_unreadable';
      totals.unreadable += 1;
      out.push({ uid: f.uid, module: f.module, name: f.name, state: 'unreadable', error: code });
      await env.DB.prepare(`UPDATE google_workspace_files SET status = 'unreadable', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(code, f.id).run().catch(() => {});
      console.warn('[googleBuild] file unreadable', code);
    }
  }
  return { files: out, totals };
}

/**
 * "From Google" on Solution design and Product roadmap (GW3): the files and
 * when each was last read, the pending proposals, and the roadmap items this
 * connection owns, as they stand now (a founder's later edit shows as theirs).
 */
export async function fromGoogle(env: Env, args: { integrationId: number; projectId: number; userId: number }) {
  const files = (await env.DB.prepare(`SELECT uid, module, kind, name, mapping_json, last_synced_at, status, last_error FROM google_workspace_files
     WHERE integration_id = ? AND user_id = ? AND project_id = ? AND status <> 'stopped' AND module IN ('solution_design', 'product_roadmap') ORDER BY id`)
    .bind(args.integrationId, args.userId, args.projectId).all<any>()).results || [];
  const proposals = (await env.DB.prepare(`SELECT id, source_key, title, payload_json, status FROM google_workspace_proposals
     WHERE integration_id = ? AND project_id = ? AND kind = ? AND status = 'pending' ORDER BY id`).bind(args.integrationId, args.projectId, DESIGN_KIND).all<any>()).results || [];
  const items = (await env.DB.prepare(`SELECT o.id, o.objective, o.quarter, o.kanban_status, o.key_results_json, f.external_id
     FROM connector_fed_items f JOIN roadmap_okrs o ON o.id = f.local_id AND o.project_id = ?
     WHERE f.integration_id = ? AND f.module = 'product_roadmap' AND f.kind = 'roadmap_row' AND f.local_table = 'roadmap_okrs' ORDER BY o.id`)
    .bind(args.projectId, args.integrationId).all<any>()).results || [];
  return {
    files: files.map((f: any) => ({ uid: f.uid, module: f.module, kind: f.kind, name: f.name, last_synced_at: f.last_synced_at, status: f.status, error: f.last_error,
      mapped: f.module === 'product_roadmap' ? roadmapMapping(parsed(f.mapping_json)) !== null : null })),
    proposals: proposals.map((p: any) => {
      let payload: any = {};
      try { payload = JSON.parse(p.payload_json); } catch { payload = {}; }
      return { id: p.id, file_id: p.source_key, title: p.title, headings: Array.isArray(payload.headings) ? payload.headings : [] };
    }),
    roadmap: items.map((o: any) => {
      let kr: any[] = [];
      try { kr = JSON.parse(o.key_results_json || '[]'); } catch { kr = []; }
      const first = Array.isArray(kr) ? kr[0] : null;
      return { id: o.id, objective: o.objective, quarter: o.quarter, lane: o.kanban_status,
        key_result: first?.text && first.text !== 'Progress' ? first.text : null, progress: typeof first?.current === 'number' ? first.current : null };
    }),
  };
}
