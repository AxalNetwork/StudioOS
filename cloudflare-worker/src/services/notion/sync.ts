/**
 * D1086 (#2951, #2405 part 2) — the shared Notion sync: one founder-pressed
 * sync per section reads that section's picked sources and lands each item.
 *
 * WHAT LANDS, AND HOW (#2405 § Module map):
 *   - A FACT (a mapped database row, or a page under a picked page tree)
 *     goes through its module's own writer, registered here by parts 3–6
 *     (`registerFactWriter`). Its `connector_fed_items` row (migration 445)
 *     links it: a re-sync updates the linked row, never adds a second; a row
 *     the founder deleted keeps its ledger row with no `local_id` and is never
 *     written again ("deleted stays deleted", as `growFeeds.ts`).
 *   - A PROPOSAL waits in `notion_proposals` (migration 640) until the founder
 *     accepts it through its kind's acceptor (`registerAcceptor`, parts 3–6).
 *     Its fingerprint is the SHA-256 of what it says now: the same fingerprint
 *     leaves the row as it is (a dismissed proposal stays dismissed); a new
 *     one puts it back to `pending` with `changed = 1`.
 *
 * ONE OWNER PER ROW. A writer that lands in `roadmap_okrs` or `mvp_features`
 * updates only a row whose ledger owner is this connection
 * (`fedOwnership.ts`); a row another connection feeds, or a hand-entered one,
 * is never written (#2405 § Rows another provider also feeds).
 *
 * A BUDGET, AND A CURSOR. One sync makes at most `REQUEST_BUDGET` reads. When
 * it runs out it stores where it stopped in KV (`RATE_LIMITS`, TTL
 * `CURSOR_TTL_S`, at least KV's 60 seconds) and answers `partial`; the next
 * press resumes there. Each source's outcome is stored as counts only.
 *
 * Page text is data: it is fingerprinted and, for a proposal, kept as an
 * extract. Nothing in it is followed. Logs hold counts and outcomes only.
 */
import type { Env } from '../../types';
import { ledgerOwnerOf, type FedOwnedTable } from '../../integrations/fedOwnership';
import { NotionReadError, type NotionReads } from './reads';
import { NOTION_MODULES, mapRow, modulesOf, type FieldMap, type Mapped, type ProposalKind, type Section } from './modules';

export const REQUEST_BUDGET = 20;
export const CURSOR_TTL_S = 900;
const EXTRACT_MAX = 2000;
const CHILDREN_MAX = 100;

export interface SyncContext { integrationId: number; projectId: number; userId: number; today: string }
export interface FactItem { externalId: string; title: string | null; url: string | null; asOf: string | null; values: Mapped }

/** A module's writer: lands a fact in its own store, through its own rules (parts 3–6). */
export interface FactWriter {
  module: string;
  /** The store it writes, as the ledger names it. */
  localTable: string;
  /** A new row (`existingId` null) or an update of the mapped fields of a row this connection owns. Returns its id. */
  write(env: Env, ctx: SyncContext, item: FactItem, existingId: number | null): Promise<number>;
  alive(env: Env, projectId: number, id: number): Promise<boolean>;
  remove(env: Env, projectId: number, id: number): Promise<boolean>;
  /** The rows' values, by id, for "From Notion". */
  view?(env: Env, projectId: number, ids: number[]): Promise<Map<number, Record<string, string | number | null>>>;
  /**
   * D1088 (#2405 § Module map, rule 4): an item already in the module that a new
   * Notion row looks like. Found, the row is not imported: it waits as a
   * `fact_link` proposal, "Link to [existing]?".
   */
  lookAlike?(env: Env, ctx: SyncContext, item: FactItem): Promise<{ id: number; label: string } | null>;
}

/**
 * What an Accept may need beyond the proposal: the founder's own Notion, opened
 * only when asked (D1087: an interview reads its page whole, as of now).
 */
export interface AcceptDeps { reads: () => Promise<NotionReads> }

/**
 * An acceptor's refusal: a status, a code and the sentence the page prints.
 * Nothing is written. Never carries a page's text or a property's value.
 */
export class AcceptRefused extends Error {
  status: number; code: string; detail: string;
  constructor(status: number, code: string, detail: string) { super(code); this.status = status; this.code = code; this.detail = detail; }
}

/** A proposal kind's Accept: writes through the module's writer and returns the row it became. */
export interface Acceptor {
  kind: ProposalKind;
  accept(env: Env, ctx: SyncContext, proposal: ProposalRow, body: Record<string, unknown>, deps: AcceptDeps): Promise<{ localTable: string; localId: number }>;
  /**
   * D1089: how a proposal reads before Accept ("Add Northwind at Meeting?",
   * "Link to …", "Update the snapshot"), from what it says and the module's own
   * rows. The fingerprint is unchanged by it. Never a page's text.
   */
  describe?(env: Env, ctx: SyncContext, p: { module: string; key: string; title: string; payload: Mapped | null }): Promise<{ title: string } | null>;
}

/**
 * D1089: a proposal module's row already linked to a local row (accepted) is
 * no longer a proposal: its change lands as a fact through this updater, the
 * module's own writer. Answers whether it changed anything.
 */
export type LinkedUpdater = (env: Env, ctx: SyncContext, localId: number, values: Mapped) => Promise<boolean>;
const LINKED = new Map<string, LinkedUpdater>();
export const registerLinkedUpdater = (module: string, fn: LinkedUpdater) => { LINKED.set(module, fn); };

const WRITERS = new Map<string, FactWriter>();
const ACCEPTORS = new Map<ProposalKind, Acceptor>();
export const registerFactWriter = (w: FactWriter) => { WRITERS.set(w.module, w); };
export const registerAcceptor = (a: Acceptor) => { ACCEPTORS.set(a.kind, a); };
export const factWriterFor = (module: string) => WRITERS.get(module) ?? null;
export const acceptorFor = (kind: ProposalKind) => ACCEPTORS.get(kind) ?? null;

export interface SourceRow {
  id: number; uid: string; integration_id: number; project_id: number; module: string; kind: 'page' | 'page_tree' | 'database';
  notion_id: string; title: string | null; url: string | null; field_map_json: string | null; status: string;
}
export interface ProposalRow {
  id: number; integration_id: number; project_id: number; source_id: number | null; module: string; kind: ProposalKind; source_key: string;
  fingerprint: string; title: string; extract: string | null; url: string | null; payload_json: string | null; status: string; changed: number;
}

export interface SourceCounts {
  read: number; written: number; updated: number; proposed: number; reproposed: number;
  kept_deleted: number; kept_dismissed: number; owned_elsewhere: number; no_writer: number;
  skipped: Array<{ reason: string; field: string | null; rows: number }>;
}
export interface SyncResult {
  /** `partial`: a source was not wholly read (skipped rows, unreadable, or the budget). `more`: the budget ran out and a press resumes. */
  section: Section; partial: boolean; more: boolean;
  sources: Array<{ uid: string; module: string; result: 'ok' | 'partial' | 'unreadable'; reason: string | null; counts: SourceCounts }>;
}

const zero = (): SourceCounts => ({ read: 0, written: 0, updated: 0, proposed: 0, reproposed: 0, kept_deleted: 0, kept_dismissed: 0, owned_elsewhere: 0, no_writer: 0, skipped: [] });
const cursorKey = (ctx: SyncContext, section: Section) => `notion:sync:${ctx.integrationId}:${ctx.projectId}:${section}`;
const parse = <T>(raw: string | null, fallback: T): T => { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };

async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The ledger's word on one item: `deleted` (kept with no row), `linked` with its row, or `new`. */
export async function ledgerState(env: Env, writer: FactWriter, ctx: SyncContext, externalId: string):
  Promise<{ state: 'new' } | { state: 'deleted' } | { state: 'linked'; id: number }> {
  const l = await env.DB.prepare('SELECT local_table, local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?')
    .bind(ctx.integrationId, externalId).first<{ local_table: string | null; local_id: number | null }>();
  if (!l) return { state: 'new' };
  if (l.local_id == null || l.local_table !== writer.localTable) return { state: 'deleted' };
  if (await writer.alive(env, ctx.projectId, Number(l.local_id))) return { state: 'linked', id: Number(l.local_id) };
  await env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL, last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?')
    .bind(ctx.integrationId, externalId).run();
  return { state: 'deleted' };
}

const FED_OWNED = new Set<string>(['roadmap_okrs', 'mvp_features']);

/** One fact through the ledger: written, updated (only a row this connection owns), or left deleted. */
async function landFact(env: Env, ctx: SyncContext, source: SourceRow, item: FactItem, counts: SourceCounts) {
  const writer = factWriterFor(source.module);
  if (!writer) { counts.no_writer += 1; return; }
  const known = await ledgerState(env, writer, ctx, item.externalId);
  if (known.state === 'deleted') {
    await env.DB.prepare('UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?')
      .bind(ctx.integrationId, item.externalId).run();
    counts.kept_deleted += 1;
    return;
  }
  if (known.state === 'linked') {
    if (FED_OWNED.has(writer.localTable)) {
      let owner: number | null = null;
      try { owner = await ledgerOwnerOf(env, writer.localTable as FedOwnedTable, known.id); } catch { owner = -1; }
      if (owner !== ctx.integrationId) { counts.owned_elsewhere += 1; return; }
    }
    await writer.write(env, ctx, item, known.id);
    await env.DB.prepare('UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?')
      .bind(ctx.integrationId, item.externalId).run();
    counts.updated += 1;
    return;
  }
  if (writer.lookAlike && await proposeLink(env, ctx, source, writer, item, counts)) return;
  const id = await writer.write(env, ctx, item, null);
  await env.DB.prepare(
    `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, 'notion_fact', ?, ?, ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET local_table = excluded.local_table, local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`,
  ).bind(ctx.integrationId, ctx.projectId, source.module, item.externalId, writer.localTable, id).run();
  counts.written += 1;
}

/**
 * D1088 — a new item that looks like one already in the module waits as
 * "Link to [existing]?" instead of becoming a second row. A row another
 * connection feeds is named (`fed_by`) and is never linked.
 */
async function proposeLink(env: Env, ctx: SyncContext, source: SourceRow, writer: FactWriter, item: FactItem, counts: SourceCounts): Promise<boolean> {
  const match = await writer.lookAlike!(env, ctx, item);
  if (!match) return false;
  let fedBy: string | null = null;
  if (FED_OWNED.has(writer.localTable)) {
    let owner: number | null = null;
    try { owner = await ledgerOwnerOf(env, writer.localTable as FedOwnedTable, match.id); } catch { owner = -1; }
    if (owner != null && owner !== ctx.integrationId) {
      const p = owner > 0 ? await env.DB.prepare('SELECT provider_key FROM integrations WHERE id = ?').bind(owner).first<{ provider_key: string }>() : null;
      fedBy = p?.provider_key ?? 'another_connection';
    }
  }
  const key = item.externalId.slice(item.externalId.lastIndexOf(':') + 1);
  await landProposal(env, ctx, source, 'fact_link', {
    key, title: item.title || match.label, extract: null, url: item.url,
    payload: { local_table: writer.localTable, local_id: match.id, existing: match.label, fed_by: fedBy },
    basis: JSON.stringify(['fact_link', item.title, match.id, fedBy]),
  }, counts);
  return true;
}

/** One proposal by its fingerprint: new, unchanged (a dismissed one stays dismissed), or back to pending with "Changed in Notion". */
async function landProposal(env: Env, ctx: SyncContext, source: SourceRow, kind: ProposalKind, p: { key: string; title: string; extract: string | null; url: string | null; payload: Mapped | null; basis: string }, counts: SourceCounts) {
  const fingerprint = await sha256(p.basis);
  const described = await acceptorFor(kind)?.describe?.(env, ctx, { module: source.module, key: p.key, title: p.title, payload: p.payload });
  if (described?.title) p = { ...p, title: described.title };
  const old = await env.DB.prepare('SELECT id, fingerprint, status FROM notion_proposals WHERE integration_id = ? AND project_id = ? AND kind = ? AND source_key = ?')
    .bind(ctx.integrationId, ctx.projectId, kind, p.key).first<{ id: number; fingerprint: string; status: string }>();
  const title = p.title.slice(0, 300) || 'Untitled';
  const extract = p.extract ? p.extract.slice(0, EXTRACT_MAX) : null;
  const payload = p.payload ? JSON.stringify(p.payload) : null;
  if (!old) {
    await env.DB.prepare(
      `INSERT INTO notion_proposals (integration_id, project_id, source_id, module, kind, source_key, fingerprint, title, extract, url, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(integration_id, project_id, kind, source_key) DO NOTHING`,
    ).bind(ctx.integrationId, ctx.projectId, source.id, source.module, kind, p.key, fingerprint, title, extract, p.url, payload).run();
    counts.proposed += 1;
    return;
  }
  if (old.fingerprint === fingerprint) { if (old.status === 'dismissed') counts.kept_dismissed += 1; return; }
  await env.DB.prepare(
    `UPDATE notion_proposals SET fingerprint = ?, title = ?, extract = ?, url = ?, payload_json = ?, status = 'pending', changed = 1,
       decided_by = NULL, decided_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(fingerprint, title, extract, p.url, payload, old.id).run();
  counts.reproposed += 1;
}

/** A proposal module's row linked by an earlier Accept: true when it was handled as a fact (updated or unchanged). */
async function landLinked(env: Env, ctx: SyncContext, module: string, rowId: string, values: Mapped, counts: SourceCounts): Promise<boolean> {
  const externalId = `notion:${ctx.projectId}:${module}:${rowId}`;
  const l = await env.DB.prepare('SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?')
    .bind(ctx.integrationId, externalId).first<{ local_id: number | null }>();
  if (!l) return false;
  // Accept always records its row; a row deleted since is found absent by the updater, which then writes nothing.
  if (await LINKED.get(module)!(env, ctx, Number(l.local_id), values)) counts.updated += 1;
  await env.DB.prepare('UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE integration_id = ? AND external_id = ?')
    .bind(ctx.integrationId, externalId).run();
  return true;
}

const skip = (counts: SourceCounts, reason: string, field: string | null) => {
  const s = counts.skipped.find((x) => x.reason === reason && x.field === field);
  if (s) s.rows += 1; else counts.skipped.push({ reason, field, rows: 1 });
};

interface Cursor { source: string; cursor: string | null; done: string[] }

/**
 * One section's sync. Reads only that section's active sources of this
 * venture and this connection, within the budget; a budget spent stores the
 * cursor and answers `partial`. A source Notion will not open is
 * `unreadable` with its code, and the others still sync.
 */
export async function syncSection(env: Env, reads: NotionReads, ctx: SyncContext, section: Section): Promise<SyncResult> {
  const modules = modulesOf(section);
  const sources = ((await env.DB.prepare(
    `SELECT * FROM notion_sources WHERE integration_id = ? AND project_id = ? AND status = 'active'
       AND module IN (SELECT value FROM json_each(?)) ORDER BY id`,
  ).bind(ctx.integrationId, ctx.projectId, JSON.stringify(modules)).all<SourceRow>()).results) || [];
  const key = cursorKey(ctx, section);
  const saved = parse<Cursor | null>(await env.RATE_LIMITS.get(key), null);
  let budget = REQUEST_BUDGET;
  const spend = () => { if (budget <= 0) throw new BudgetSpent(); budget -= 1; };
  const out: SyncResult = { section, partial: false, more: false, sources: [] };
  let stopAt: Cursor | null = null;

  for (const source of sources) {
    if (saved && saved.done.includes(source.uid)) continue;
    const counts = zero();
    const resume = saved && saved.source === source.uid ? saved.cursor : null;
    let result: 'ok' | 'partial' | 'unreadable' = 'ok';
    let reason: string | null = null;
    // Where this source would resume: the next page of rows, or the next child of a tree.
    let at: string | null = resume;
    try {
      await syncSource(env, reads, ctx, source, counts, spend, resume, (cursor) => { at = cursor; });
    } catch (e) {
      if (e instanceof BudgetSpent) {
        result = 'partial';
        stopAt = { source: source.uid, cursor: at, done: [...(saved?.done ?? []), ...out.sources.map((s) => s.uid)] };
      } else if (e instanceof NotionReadError) {
        result = 'unreadable'; reason = e.code;
      } else throw e;
    }
    if (counts.skipped.length && result === 'ok') result = 'partial';
    out.sources.push({ uid: source.uid, module: source.module, result, reason, counts });
    await env.DB.prepare(
      `UPDATE notion_sources SET last_synced_at = CURRENT_TIMESTAMP, last_result = ?, last_counts_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(result, JSON.stringify(counts), source.id).run();
    if (stopAt) break;
  }
  if (stopAt) {
    out.partial = true; out.more = true;
    await env.RATE_LIMITS.put(key, JSON.stringify(stopAt), { expirationTtl: CURSOR_TTL_S });
  } else if (saved) {
    await env.RATE_LIMITS.delete(key);
  }
  if (out.sources.some((s) => s.result !== 'ok')) out.partial = true;
  console.info(`[notion] sync section=${section} sources=${out.sources.length} partial=${out.partial}`);
  return out;
}

class BudgetSpent extends Error { constructor() { super('budget_spent'); } }

/** One source: a database's rows a page at a time, or a page tree's children, or one page. */
async function syncSource(env: Env, reads: NotionReads, ctx: SyncContext, source: SourceRow, counts: SourceCounts,
  spend: () => void, resume: string | null, mark: (cursor: string | null) => void) {
  const mod = NOTION_MODULES[source.module];
  if (!mod) return;
  if (source.kind === 'database') {
    const map = parse<FieldMap | null>(source.field_map_json, null);
    if (!map) { skip(counts, 'not_mapped', null); return; }
    let cursor: string | null = resume;
    do {
      mark(cursor);
      spend();
      const page = await reads.queryRows(source.notion_id, { cursor });
      for (const row of page.rows) {
        counts.read += 1;
        const mapped = mapRow(source.module, map, row.properties);
        if (!mapped.values) { skip(counts, mapped.skip.reason, mapped.skip.field); continue; }
        const externalId = `notion:${ctx.projectId}:${source.module}:${row.id}`;
        if (mod.lands === 'fact') {
          await landFact(env, ctx, source, { externalId, title: null, url: row.url, asOf: row.last_edited, values: mapped.values }, counts);
        } else if (LINKED.has(source.module) && await landLinked(env, ctx, source.module, row.id, mapped.values, counts)) {
          // Accepted before: its change is a fact through the module's writer, not a new proposal.
        } else {
          const title = String(Object.values(mapped.values).find((v) => typeof v === 'string' && v) ?? 'Untitled');
          await landProposal(env, ctx, source, mod.proposal!, { key: row.id, title, extract: null, url: row.url, payload: mapped.values, basis: JSON.stringify(mapped.values) }, counts);
        }
      }
      cursor = page.next_cursor;
    } while (cursor);
    mark(null);
    return;
  }
  // A page, or the pages directly under a page; a tree resumes at the child it stopped before.
  let pages: Array<{ id: string; title: string | null }>;
  if (source.kind === 'page_tree') {
    spend();
    pages = (await reads.listChildren(source.notion_id)).filter((c) => c.kind === 'page').slice(0, CHILDREN_MAX);
  } else pages = [{ id: source.notion_id, title: source.title }];
  const start = resume && /^\d+$/.test(resume) ? Math.min(Number(resume), pages.length) : 0;
  for (let i = start; i < pages.length; i += 1) {
    const p = pages[i];
    mark(String(i));
    counts.read += 1;
    const externalId = `notion:${ctx.projectId}:${source.module}:${p.id}`;
    if (mod.lands === 'fact') {
      // A tree's page lands its title and link only; the text stays in Notion.
      await landFact(env, ctx, source, { externalId, title: p.title, url: null, asOf: null, values: { title: p.title ?? 'Untitled' } }, counts);
      continue;
    }
    spend();
    const page = await reads.fetchPage(p.id);
    await landProposal(env, ctx, source, mod.proposal!, { key: page.id, title: page.title ?? p.title ?? 'Untitled', extract: page.markdown, url: page.url, payload: { last_edited: page.last_edited }, basis: page.fingerprint }, counts);
  }
  mark(null);
}

/** A pending proposal's Dismiss: it stays dismissed until its text changes in Notion. */
export async function dismissProposal(env: Env, ctx: SyncContext, id: number): Promise<'ok' | 'not_found' | 'decided'> {
  const row = await env.DB.prepare('SELECT status FROM notion_proposals WHERE id = ? AND project_id = ? AND integration_id = ?')
    .bind(id, ctx.projectId, ctx.integrationId).first<{ status: string }>();
  if (!row) return 'not_found';
  if (row.status !== 'pending') return 'decided';
  await env.DB.prepare(`UPDATE notion_proposals SET status = 'dismissed', changed = 0, decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`)
    .bind(ctx.userId, id).run();
  return 'ok';
}

/** A pending proposal's Accept, through its kind's acceptor; the row it became joins the ledger. */
const NO_READS: AcceptDeps = { reads: async () => { throw new NotionReadError('not_connected'); } };

export async function acceptProposal(env: Env, ctx: SyncContext, id: number, body: Record<string, unknown>, deps: AcceptDeps = NO_READS):
  Promise<'not_found' | 'decided' | 'not_ready' | { localTable: string; localId: number }> {
  const row = await env.DB.prepare('SELECT * FROM notion_proposals WHERE id = ? AND project_id = ? AND integration_id = ?')
    .bind(id, ctx.projectId, ctx.integrationId).first<ProposalRow>();
  if (!row) return 'not_found';
  if (row.status !== 'pending') return 'decided';
  const acceptor = acceptorFor(row.kind);
  if (!acceptor) return 'not_ready';
  const landed = await acceptor.accept(env, ctx, row, body, deps);
  await env.DB.batch([
    env.DB.prepare(`UPDATE notion_proposals SET status = 'accepted', changed = 0, local_table = ?, local_id = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`).bind(landed.localTable, landed.localId, ctx.userId, id),
    env.DB.prepare(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(integration_id, external_id) DO UPDATE SET local_table = excluded.local_table, local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`)
      .bind(ctx.integrationId, ctx.projectId, row.module, `notion_${row.kind}`, `notion:${ctx.projectId}:${row.module}:${row.source_key}`, landed.localTable, landed.localId),
  ]);
  return landed;
}

/**
 * A fact the founder deletes: its row goes through the module's writer, and
 * the ledger keeps the item with no row, so no later sync brings it back.
 */
export async function deleteFact(env: Env, ctx: SyncContext, ledgerId: number): Promise<'ok' | 'not_found'> {
  const l = await env.DB.prepare(
    `SELECT id, module, external_id, local_table, local_id FROM connector_fed_items WHERE id = ? AND integration_id = ? AND project_id = ? AND kind = 'notion_fact'`,
  ).bind(ledgerId, ctx.integrationId, ctx.projectId).first<{ id: number; module: string; external_id: string; local_table: string | null; local_id: number | null }>();
  if (!l || l.local_id == null) return 'not_found';
  const writer = factWriterFor(l.module);
  if (!writer || writer.localTable !== l.local_table) return 'not_found';
  await writer.remove(env, ctx.projectId, Number(l.local_id));
  await env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').bind(l.id).run();
  return 'ok';
}
