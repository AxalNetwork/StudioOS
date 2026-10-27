/**
 * D1089 (#2954, #2405 part 5) — what a founder's Notion lands in Raise.
 * Nothing reaches an investor before the founder accepts it.
 *
 *   - CAPITAL RELATIONSHIPS. Each row of a mapped investor CRM waits as a
 *     `prospect` proposal (D1086). It reads "Add [Firm] at [stage]?", or, when
 *     the row matches an investor already tracked (by email when the email is
 *     mapped, else by firm), "Link to [existing]". Accept on a match links the
 *     row to that investor and writes nothing: never a duplicate. Otherwise it
 *     adds the investor through `addProspect` (name, firm, the mapped stage,
 *     notes; an email only when the founder mapped one). Once linked, a stage
 *     changed in Notion is a fact through `updateProspect`'s stage writer, on
 *     each sync, not a new proposal (`registerLinkedUpdater`).
 *   - DATA ROOM. Each picked page waits as a `data_room_snapshot` proposal,
 *     "Add a snapshot of “[page]”?". Accept reads the page whole as of now
 *     (held to what was proposed: `changed_in_notion`) and stores its Markdown
 *     in R2 with a `data_room_files` row through the upload's own storage step
 *     (`storeDataRoomFile`): under the venture's prefix, counted to its owner,
 *     visibility `nda` unless the founder chooses `open` in the dialog. When
 *     the page changes after that, the sync proposes "Update the snapshot of
 *     “[page]”"; its Accept adds a version through Replace
 *     (`replaceDataRoomFile`). A version is added on Accept only.
 *
 * Registered on import (`routes/notion.ts`). Logs hold ids and counts only.
 */
import type { Env } from '../../types';
import { addProspect, updateProspect } from '../raiseWriters';
import { WriterError } from '../validateWriters';
import { storeDataRoomFile, replaceDataRoomFile } from '../../routes/data_room';
import { AcceptRefused, registerAcceptor, registerLinkedUpdater, type SyncContext } from './sync';

export const STAGE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  to_contact: 'Identified', contacted: 'Contacted', meeting: 'Meeting', diligence: 'Diligence', committed: 'Committed', passed: 'Passed',
});
export const SNAPSHOT_VISIBILITY = Object.freeze(['nda', 'open'] as const);

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const parse = (raw: string | null) => { try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { return {}; } };

async function sha256(value: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A writer's refusal as an acceptor's: its status and words, never a value. */
function refused(e: unknown): never {
  if (e instanceof WriterError) throw new AcceptRefused(e.status, 'refused', e.message);
  throw e;
}

// ---------------------------------------------------------------- Capital relationships

/** The investor a row already names: the email when it is mapped, else the firm. Never a guess on a name. */
async function matchOf(env: Env, projectId: number, v: Record<string, unknown>) {
  const email = str(v.email, 320)?.toLowerCase() ?? null;
  if (email) {
    const byEmail = await env.DB.prepare('SELECT id, name, firm FROM raise_prospects WHERE project_id = ? AND email = ?')
      .bind(projectId, email).first<{ id: number; name: string | null; firm: string | null }>();
    if (byEmail) return byEmail;
  }
  const firm = str(v.firm);
  if (!firm) return null;
  return env.DB.prepare('SELECT id, name, firm FROM raise_prospects WHERE project_id = ? AND firm IS NOT NULL AND lower(firm) = lower(?) ORDER BY id LIMIT 1')
    .bind(projectId, firm).first<{ id: number; name: string | null; firm: string | null }>();
}

registerAcceptor({
  kind: 'prospect',
  async describe(env, ctx, p) {
    const v = p.payload ?? {};
    const match = await matchOf(env, ctx.projectId, v);
    if (match) return { title: `Link to ${match.firm || match.name || 'the investor already tracked'}` };
    const stage = STAGE_WORDS[String(v.stage ?? 'to_contact')] ?? STAGE_WORDS.to_contact;
    return { title: `Add ${str(v.firm) || str(v.name) || 'this investor'} at ${stage}?` };
  },
  async accept(env, ctx, proposal) {
    const v = parse(proposal.payload_json);
    const match = await matchOf(env, ctx.projectId, v);
    if (match) {
      await env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)')
        .bind('notion_prospect_linked', JSON.stringify({ prospect_id: match.id, proposal_id: proposal.id }), `user:${ctx.userId}`, ctx.userId, ctx.projectId).run();
      return { localTable: 'raise_prospects', localId: Number(match.id) };
    }
    const body: Record<string, unknown> = { name: str(v.name), firm: str(v.firm), stage: v.stage ?? null, notes: str(v.notes, 4000) };
    // An email reaches the investor's record only when the founder mapped one.
    if (str(v.email, 320)) body.email = str(v.email, 320);
    try {
      const out = await addProspect(env, { projectId: ctx.projectId, userId: ctx.userId, body });
      return { localTable: 'raise_prospects', localId: Number(out.id) };
    } catch (e) { return refused(e); }
  },
});

/** Once linked, a stage changed in Notion moves the investor through the stage writer; nothing else is written. */
registerLinkedUpdater('capital_relationships', async (env, ctx, localId, values) => {
  const stage = typeof values.stage === 'string' ? values.stage : null;
  if (!stage) return false;
  const now = await env.DB.prepare('SELECT stage FROM raise_prospects WHERE id = ? AND project_id = ?').bind(localId, ctx.projectId).first<{ stage: string }>();
  if (!now || now.stage === stage) return false;
  await updateProspect(env, { projectId: ctx.projectId, userId: ctx.userId, prospectId: localId, body: { stage } });
  return true;
});

// ---------------------------------------------------------------- Data room

/** The file an earlier snapshot of this page became, if it is still in the room. */
async function snapshotOf(env: Env, ctx: SyncContext, key: string) {
  const l = await env.DB.prepare('SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?')
    .bind(ctx.integrationId, `notion:${ctx.projectId}:data_room:${key}`).first<{ local_id: number | null }>();
  if (!l?.local_id) return null;
  return env.DB.prepare('SELECT id FROM data_room_files WHERE id = ? AND project_id = ?').bind(l.local_id, ctx.projectId).first<{ id: number }>();
}

registerAcceptor({
  kind: 'data_room_snapshot',
  async describe(env, ctx, p) {
    const page = p.title || 'this page';
    return { title: (await snapshotOf(env, ctx, p.key)) ? `Update the snapshot of “${page}”` : `Add a snapshot of “${page}”?` };
  },
  async accept(env, ctx, proposal, body, deps) {
    const visibility = body.visibility == null || body.visibility === '' ? 'nda' : String(body.visibility);
    if (!(SNAPSHOT_VISIBILITY as readonly string[]).includes(visibility)) throw new AcceptRefused(400, 'invalid_visibility', 'A snapshot is for investors under NDA, or open to every investor with access.');
    const page = await (await deps.reads()).fetchPage(proposal.source_key);
    if ((await sha256(page.fingerprint)) !== proposal.fingerprint) {
      throw new AcceptRefused(409, 'changed_in_notion', 'This page changed in Notion after it was proposed. Sync from Notion, then add the snapshot.');
    }
    if (!page.markdown.trim()) throw new AcceptRefused(400, 'page_empty', 'This page is empty in Notion, so there is nothing to snapshot.');
    const project = await env.DB.prepare('SELECT id, uid FROM projects WHERE id = ?').bind(ctx.projectId).first<{ id: number; uid: string }>();
    const user = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(ctx.userId).first<{ id: number; role: string }>();
    if (!project || !user) throw new AcceptRefused(404, 'project_not_available', 'This venture is not available.');
    const bytes = new TextEncoder().encode(page.markdown);
    try {
      const earlier = await snapshotOf(env, ctx, proposal.source_key);
      if (earlier) {
        // A later change adds a version; the room keeps the earlier one.
        const out = await replaceDataRoomFile(env, { project, userId: user.id, fileId: earlier.id, bytes, contentType: 'text/markdown', caller: user });
        return { localTable: 'data_room_files', localId: out.id };
      }
      const name = `${(page.title || proposal.title || 'Notion page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 180)}.md`;
      const out = await storeDataRoomFile(env, { project, user, folderId: null, name, bytes, contentType: 'text/markdown', visibility, access: {} });
      return { localTable: 'data_room_files', localId: Number(out.id) };
    } catch (e) {
      if (e instanceof Response) {
        const j = await e.clone().json().catch(() => null) as { error?: string; message?: string } | null;
        throw new AcceptRefused(e.status, j?.error || 'refused', j?.message || 'The snapshot could not be stored.');
      }
      return refused(e);
    }
  },
});
