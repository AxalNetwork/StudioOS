/**
 * #4170 (D4170, split from #4046) — Eadwyn's proposals for a data room: three
 * actions on file METADATA, never form fields, so they do not use the fill
 * registry. They live in the AIRail proposals store (`ai_rail_proposals`,
 * D780), one row per proposal, under the room's record `data-room:<uid>`:
 *
 *   match   `dataroom:match`   this top-level or foldered file answers this
 *                              checklist item (the file has no item yet)
 *   folder  `dataroom:folder`  move this top-level file into the named folder
 *                              (an existing top-level folder, or a new one)
 *   gap     `dataroom:gap`     this item has no file, and what would answer it.
 *                              Advisory: Accept marks it noted and writes nothing.
 *
 * THE RUN. One `rail_reason` run per press, quoted first: the press carries the
 * quote's `confirm_quote`, a digest of what will be sent, the model and the
 * hold, and a press without it, or with a stale one, runs nothing (402
 * `quote_required`). What is sent is the room's INDEX only: file names, folder
 * names and the checklist labels, inside an untrusted block. No file's content
 * is read, so nothing leaves the room's access gate. A new run withdraws the
 * member's earlier open proposals for the room.
 *
 * ACCEPT applies exactly one change and records who pressed
 * (`decided_by_user_id`, and one cycle-activity row), in one D1 batch keyed
 * by a fresh nonce: the proposal is marked accepted only while it is open and
 * its file is as proposed, and the file is written only under that nonce. If
 * the file write does not land, the proposal is put back to open. A match
 * writes `checklist_item`; a folder writes `folder_id` (creating the named
 * top-level folder first when there is none, with the file's own gate). A
 * folder move is refused (409 `would_change_access`) when it would change who
 * can open the file: a target folder that an active grant is scoped to, or
 * whose gate differs from the file's. Matching never changes who can open a
 * file (D1108). Nothing here deletes a file or changes a gate, a tier, an
 * expiry, an NDA or a grant.
 *
 * DISMISS writes the proposal only. UNDO (match and folder) puts the file back
 * as it was, only while it still holds what the accept wrote, and files the
 * proposal as discarded with `undone` in its decided payload; a folder the
 * accept created stays (empty folders are the founder's to delete).
 *
 * Bound SQL only; every statement binds `user_id` and the room's project.
 */
import type { Env } from '../types';
import { AI_SURFACE } from './aiSurfaces';
import type { RunOptions } from './aiRouter';
import { untrustedBlock, withUntrustedRule } from './ai/untrusted';
import { DILIGENCE_CHECKLIST, CHECKLIST_KEYS, checklistLabel } from './raiseCycle';
import { listRail, type RailProposal } from './railProposals';

export const PROPOSALS_PAGE = 'Founder · Raise · Data room';
export const RUN_OPTION = 'dataroom:propose';
export const PROPOSAL_TYPES = ['match', 'folder', 'gap'] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];
export const OPTION_OF: Readonly<Record<ProposalType, string>> = Object.freeze({
  match: 'dataroom:match', folder: 'dataroom:folder', gap: 'dataroom:gap',
});
export const typeOfOption = (option: string): ProposalType | null =>
  (PROPOSAL_TYPES.find((t) => OPTION_OF[t] === option) ?? null);
export const recordOf = (projectUid: string) => `data-room:${projectUid}`;

/** The most files sent in one run; past it, the newest are sent. */
export const MAX_FILES = 200;
/** The most proposals one run keeps. */
export const MAX_PROPOSALS = 20;
export const REASON_MAX = 280;
export const FOLDER_NAME_MAX = 80;

export type RoomFile = { id: number; uid: string; name: string; folder_id: number | null; folder: string | null; checklist_item: string | null; visibility: string };
export type RoomFolder = { id: number; uid: string; name: string; parent_id: number | null; visibility: string };
export type RoomFacts = { files: RoomFile[]; folders: RoomFolder[]; answered: Set<string> };

export type Proposal =
  | { type: 'match'; file_uid: string; item: string; reason: string }
  | { type: 'folder'; file_uid: string; folder_name: string; reason: string }
  | { type: 'gap'; item: string; would_satisfy: string; reason: string };

/** The room's index: names and placement only, never a file's content. */
export async function roomFacts(env: Env, projectId: number): Promise<RoomFacts> {
  const files = ((await env.DB.prepare(
    `SELECT f.id, f.uid, f.name, f.folder_id, fo.name AS folder, f.checklist_item, f.visibility
       FROM data_room_files f LEFT JOIN data_room_folders fo ON fo.id = f.folder_id AND fo.project_id = f.project_id
      WHERE f.project_id = ? ORDER BY f.id DESC LIMIT ?`,
  ).bind(projectId, MAX_FILES).all<RoomFile>()).results ?? []);
  const folders = ((await env.DB.prepare(
    'SELECT id, uid, name, parent_id, visibility FROM data_room_folders WHERE project_id = ? ORDER BY display_order, name',
  ).bind(projectId).all<RoomFolder>()).results ?? []);
  const answered = new Set(files.map((f) => f.checklist_item).filter((k): k is string => !!k && CHECKLIST_KEYS.has(k)));
  return { files, folders, answered };
}

/** Words a proposal may not carry: an email address, and the two words the product never uses. */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const BANNED = /\badvi(?:c|s)e|\badvisor/i;
export const wordsRefused = (s: string) => EMAIL.test(s) || BANNED.test(s);

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || s.length > max || wordsRefused(s)) return null;
  return s;
};

/**
 * The run's output, checked against the room as it is. A proposal survives only
 * when it names a file and an item or folder this room has, would change
 * something, and says why in plain words. At most one proposal per file and
 * per gap item; at most `MAX_PROPOSALS`.
 */
export function proposalsFrom(output: unknown, facts: RoomFacts): Proposal[] {
  let rows: unknown = output;
  if (typeof output === 'string') {
    const at = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if (at < 0 || end <= at) return [];
    try { rows = JSON.parse(output.slice(at, end + 1)); } catch { return []; }
  }
  if (!Array.isArray(rows)) return [];
  const byUid = new Map(facts.files.map((f) => [f.uid, f]));
  const usedFile = new Set<string>();
  const usedGap = new Set<string>();
  const out: Proposal[] = [];
  for (const r of rows as any[]) {
    if (out.length >= MAX_PROPOSALS) break;
    if (!r || typeof r !== 'object') continue;
    const reason = clean(r.reason, REASON_MAX);
    if (!reason) continue;
    if (r.type === 'match') {
      const f = byUid.get(String(r.file_uid ?? ''));
      const item = String(r.item ?? '');
      if (!f || f.checklist_item || !CHECKLIST_KEYS.has(item) || usedFile.has(f.uid)) continue;
      usedFile.add(f.uid);
      out.push({ type: 'match', file_uid: f.uid, item, reason });
    } else if (r.type === 'folder') {
      const f = byUid.get(String(r.file_uid ?? ''));
      const name = clean(r.folder_name, FOLDER_NAME_MAX);
      if (!f || f.folder_id != null || !name || usedFile.has(f.uid)) continue;
      usedFile.add(f.uid);
      out.push({ type: 'folder', file_uid: f.uid, folder_name: name, reason });
    } else if (r.type === 'gap') {
      const item = String(r.item ?? '');
      const would = clean(r.would_satisfy, REASON_MAX);
      if (!CHECKLIST_KEYS.has(item) || facts.answered.has(item) || !would || usedGap.has(item)) continue;
      usedGap.add(item);
      out.push({ type: 'gap', item, would_satisfy: would, reason });
    }
  }
  return out;
}

/** What the run is shown: names and placement only. The quote's digest is taken over this. */
export function indexOf(facts: RoomFacts) {
  return {
    checklist: DILIGENCE_CHECKLIST.map((c) => ({ item: c.key, label: c.label, answered: facts.answered.has(c.key) })),
    folders: facts.folders.filter((f) => f.parent_id == null).map((f) => f.name),
    files: facts.files.map((f) => ({ file_uid: f.uid, name: f.name, folder: f.folder, item: f.checklist_item })),
  };
}

/** The one run a press makes, so the quote and the run read the same input. */
export function runOptions(userId: number, projectUid: string, facts: RoomFacts, model?: string): RunOptions {
  const index = indexOf(facts);
  return {
    task: 'rail_reason',
    userId,
    model,
    surface: AI_SURFACE.raiseDataRoom,
    rail: { page: PROPOSALS_PAGE, option: RUN_OPTION, record: recordOf(projectUid) },
    maxTokens: 1500,
    temperature: 0,
    systemPrompt: withUntrustedRule([
      'You tidy a startup data room for investor diligence. You see only file names, folder names and the diligence checklist; never a file\'s content.',
      'Return a JSON array only, at most 20 objects, each one of:',
      '{"type":"match","file_uid":"…","item":"<checklist item>","reason":"…"} for a file with no item whose name says it answers that item;',
      '{"type":"folder","file_uid":"…","folder_name":"…","reason":"…"} for a file with no folder, naming an existing top-level folder or a short new one;',
      '{"type":"gap","item":"<checklist item>","would_satisfy":"…","reason":"…"} for an item no file answers.',
      'Use only file_uid and item values given. Reasons are one plain sentence. Never name a person, an email or a figure. Return [] when nothing fits.',
    ].join('\n')),
    messages: [{ role: 'user', content: untrustedBlock('record_text', JSON.stringify(index)) }],
  };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** What a quote promises: this member, this room, this index, this model, this hold. */
export async function quoteDigest(userId: number, projectUid: string, facts: RoomFacts, model: string, hold: number): Promise<string> {
  const text = JSON.stringify([userId, projectUid, indexOf(facts), model, hold]);
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// ── The list ────────────────────────────────────────────────────────────────

export type ProposalView = {
  uid: string; type: ProposalType; status: 'proposed' | 'accepted';
  reason: string; file: { uid: string; name: string } | null; item: { key: string; label: string } | null;
  folder: { name: string } | null; would_satisfy: string | null;
  created_at: string; decided_at: string | null; undoable: boolean;
};

/** The member's own proposals for the room: open ones, and accepted ones still to undo. A row whose file is gone is left out. */
export async function listProposals(env: Env, userId: number, projectId: number, projectUid: string): Promise<ProposalView[]> {
  const rows = (await listRail(env, userId, { page: PROPOSALS_PAGE, record: recordOf(projectUid) }))
    .filter((r) => typeOfOption(r.rail_option) && (r.status === 'proposed' || r.status === 'accepted'));
  const uids = [...new Set(rows.map((r) => String(r.payload.file_uid ?? '')).filter(Boolean))];
  const names = new Map<string, string>();
  if (uids.length) {
    const found = (await env.DB.prepare(
      'SELECT f.uid, f.name FROM data_room_files f JOIN json_each(?) j ON j.value = f.uid WHERE f.project_id = ?',
    ).bind(JSON.stringify(uids), projectId).all<{ uid: string; name: string }>()).results ?? [];
    for (const f of found) names.set(f.uid, f.name);
  }
  const out: ProposalView[] = [];
  for (const r of rows) {
    const view = viewOf(r, names);
    if (view) out.push(view);
  }
  return out;
}

function viewOf(r: RailProposal, names: Map<string, string>): ProposalView | null {
  const type = typeOfOption(r.rail_option);
  if (!type) return null;
  const p = r.payload as Record<string, any>;
  const fileUid = typeof p.file_uid === 'string' ? p.file_uid : null;
  if (type !== 'gap' && (!fileUid || !names.has(fileUid))) return null;
  const item = typeof p.item === 'string' ? { key: p.item, label: checklistLabel(p.item) ?? p.item } : null;
  const decided = (r.decided_payload ?? {}) as Record<string, any>;
  return {
    uid: r.uid,
    type,
    status: r.status as 'proposed' | 'accepted',
    reason: String(p.reason ?? ''),
    file: fileUid && names.has(fileUid) ? { uid: fileUid, name: names.get(fileUid)! } : null,
    item,
    folder: type === 'folder' ? { name: String(p.folder_name ?? '') } : null,
    would_satisfy: type === 'gap' ? String(p.would_satisfy ?? '') : null,
    created_at: r.created_at,
    decided_at: r.decided_at,
    undoable: r.status === 'accepted' && type !== 'gap' && typeof decided.nonce === 'string' && !decided.undone,
  };
}

// ── Accept, dismiss, undo ───────────────────────────────────────────────────

export type Outcome =
  | { ok: true; proposal: { uid: string; status: string }; change: Record<string, unknown> | null }
  | { ok: false; status: 404 | 409; code: string; message: string };

const NOT_OPEN: Outcome = { ok: false, status: 409, code: 'not_open', message: 'That proposal is not yours, or it has already been decided.' };
const STALE: Outcome = { ok: false, status: 409, code: 'proposal_stale', message: 'The file changed since Eadwyn proposed this. Dismiss it and ask again.' };
const ACCESS: Outcome = { ok: false, status: 409, code: 'would_change_access', message: 'Moving the file there would change who can open it, so nothing was moved. Move it in Files, where the gate is shown.' };

type Room = { id: number; uid: string };

/** The member's own open or accepted proposal for this room, or null. */
async function ownRow(env: Env, userId: number, room: Room, uid: string) {
  return env.DB.prepare(
    `SELECT uid, rail_option, status, payload_json, decided_payload_json FROM ai_rail_proposals
      WHERE uid = ? AND user_id = ? AND record_ref = ? AND rail_page = ?`,
  ).bind(uid, userId, recordOf(room.uid), PROPOSALS_PAGE).first<{ uid: string; rail_option: string; status: string; payload_json: string; decided_payload_json: string | null }>();
}

const parse = (s: string | null): Record<string, any> => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

/** Whether moving a top-level file of this gate into this folder would change who can open it. */
async function folderChangesAccess(env: Env, projectId: number, folder: { id: number; visibility: string }, visibility: string): Promise<boolean> {
  if (folder.visibility !== visibility) return true;
  const scoped = await env.DB.prepare(
    `SELECT 1 FROM data_room_grant_folders gf JOIN data_room_grants g ON g.id = gf.grant_id
      WHERE g.project_id = ? AND g.status = 'active' AND g.folders_scoped = 1 AND gf.folder_id = ? LIMIT 1`,
  ).bind(projectId, folder.id).first();
  return !!scoped;
}

/** Put a proposal this press accepted back to open: its file write did not land. */
async function reopen(env: Env, userId: number, uid: string, nonce: string) {
  await env.DB.prepare(
    `UPDATE ai_rail_proposals SET status = 'proposed', decided_payload_json = NULL, decided_at = NULL, decided_by_user_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE uid = ? AND user_id = ? AND status = 'accepted' AND json_extract(decided_payload_json, '$.nonce') = ?`,
  ).bind(uid, userId, nonce).run();
}

export async function acceptProposal(env: Env, userId: number, room: Room, uid: string): Promise<Outcome> {
  const row = await ownRow(env, userId, room, uid);
  const type = row ? typeOfOption(row.rail_option) : null;
  if (!row || !type || row.status !== 'proposed') return NOT_OPEN;
  const p = parse(row.payload_json);
  const nonce = crypto.randomUUID();
  const now = new Date().toISOString();

  if (type === 'gap') {
    const res = await env.DB.prepare(
      `UPDATE ai_rail_proposals SET status = 'accepted', decided_payload_json = ?, decided_at = CURRENT_TIMESTAMP, decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE uid = ? AND user_id = ? AND status = 'proposed'`,
    ).bind(JSON.stringify({ nonce, noted: true }), userId, uid, userId).run();
    return Number(res.meta?.changes ?? 0) ? { ok: true, proposal: { uid, status: 'accepted' }, change: null } : NOT_OPEN;
  }

  const file = await env.DB.prepare(
    'SELECT id, folder_id, checklist_item, visibility FROM data_room_files WHERE uid = ? AND project_id = ?',
  ).bind(String(p.file_uid ?? ''), room.id).first<{ id: number; folder_id: number | null; checklist_item: string | null; visibility: string }>();
  if (!file) return { ok: false, status: 404, code: 'file_not_found', message: 'That file is no longer in the room.' };

  if (type === 'match') {
    const item = String(p.item ?? '');
    if (!CHECKLIST_KEYS.has(item) || file.checklist_item) return STALE;
    const decided = JSON.stringify({ nonce, before: { checklist_item: null }, after: { checklist_item: item } });
    const [mark, write] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE ai_rail_proposals SET status = 'accepted', decided_payload_json = ?, decided_at = CURRENT_TIMESTAMP, decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE uid = ? AND user_id = ? AND status = 'proposed'
            AND EXISTS (SELECT 1 FROM data_room_files WHERE id = ? AND project_id = ? AND checklist_item IS NULL)`,
      ).bind(decided, userId, uid, userId, file.id, room.id),
      env.DB.prepare(
        `UPDATE data_room_files SET checklist_item = ?, updated_at = ?
          WHERE id = ? AND project_id = ? AND checklist_item IS NULL
            AND EXISTS (SELECT 1 FROM ai_rail_proposals WHERE uid = ? AND user_id = ? AND status = 'accepted' AND json_extract(decided_payload_json, '$.nonce') = ?)`,
      ).bind(item, now, file.id, room.id, uid, userId, nonce),
    ]);
    if (!Number(mark?.meta?.changes ?? 0)) return NOT_OPEN;
    if (!Number(write?.meta?.changes ?? 0)) { await reopen(env, userId, uid, nonce); return STALE; }
    return { ok: true, proposal: { uid, status: 'accepted' }, change: { file_id: file.id, checklist_item: item } };
  }

  // folder
  const name = typeof p.folder_name === 'string' ? p.folder_name.trim().slice(0, FOLDER_NAME_MAX) : '';
  if (!name || file.folder_id != null) return STALE;
  const existing = await env.DB.prepare(
    'SELECT id, visibility FROM data_room_folders WHERE project_id = ? AND parent_id IS NULL AND name = ? ORDER BY id LIMIT 1',
  ).bind(room.id, name).first<{ id: number; visibility: string }>();
  if (existing && await folderChangesAccess(env, room.id, existing, file.visibility)) return ACCESS;
  const decided = JSON.stringify({ nonce, before: { folder_id: null }, after: { folder_name: name }, created_folder: !existing });
  const folderUid = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ai_rail_proposals SET status = 'accepted', decided_payload_json = ?, decided_at = CURRENT_TIMESTAMP, decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE uid = ? AND user_id = ? AND status = 'proposed'
          AND EXISTS (SELECT 1 FROM data_room_files WHERE id = ? AND project_id = ? AND folder_id IS NULL)`,
    ).bind(decided, userId, uid, userId, file.id, room.id),
    // A new top-level folder takes the file's own gate, so the move changes no one's access.
    env.DB.prepare(
      `INSERT INTO data_room_folders (uid, project_id, parent_id, name, visibility, display_order, created_at, updated_at)
       SELECT ?, ?, NULL, ?, ?, 0, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM data_room_folders WHERE project_id = ? AND parent_id IS NULL AND name = ?)
          AND EXISTS (SELECT 1 FROM ai_rail_proposals WHERE uid = ? AND user_id = ? AND status = 'accepted' AND json_extract(decided_payload_json, '$.nonce') = ?)`,
    ).bind(folderUid, room.id, name, file.visibility, now, now, room.id, name, uid, userId, nonce),
    env.DB.prepare(
      `UPDATE data_room_files SET folder_id = (SELECT id FROM data_room_folders WHERE project_id = ? AND parent_id IS NULL AND name = ? AND visibility = ? ORDER BY id LIMIT 1), updated_at = ?
        WHERE id = ? AND project_id = ? AND folder_id IS NULL
          AND EXISTS (SELECT id FROM data_room_folders WHERE project_id = ? AND parent_id IS NULL AND name = ? AND visibility = ? ORDER BY id LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM data_room_grant_folders gf JOIN data_room_grants g ON g.id = gf.grant_id
                           WHERE g.project_id = ? AND g.status = 'active' AND g.folders_scoped = 1 AND gf.folder_id = (SELECT id FROM data_room_folders WHERE project_id = ? AND parent_id IS NULL AND name = ? AND visibility = ? ORDER BY id LIMIT 1))
          AND EXISTS (SELECT 1 FROM ai_rail_proposals WHERE uid = ? AND user_id = ? AND status = 'accepted' AND json_extract(decided_payload_json, '$.nonce') = ?)`,
    ).bind(room.id, name, file.visibility, now, file.id, room.id, room.id, name, file.visibility, room.id, room.id, name, file.visibility, uid, userId, nonce),
    env.DB.prepare(
      `UPDATE ai_rail_proposals SET decided_payload_json = json_set(decided_payload_json, '$.folder_id', (SELECT folder_id FROM data_room_files WHERE id = ? AND project_id = ?))
        WHERE uid = ? AND user_id = ? AND json_extract(decided_payload_json, '$.nonce') = ?`,
    ).bind(file.id, room.id, uid, userId, nonce),
  ]);
  if (!Number(results[0]?.meta?.changes ?? 0)) return NOT_OPEN;
  if (!Number(results[2]?.meta?.changes ?? 0)) { await reopen(env, userId, uid, nonce); return existing ? ACCESS : STALE; }
  return { ok: true, proposal: { uid, status: 'accepted' }, change: { file_id: file.id, folder_name: name, created_folder: !existing } };
}

/** Dismiss: the proposal is discarded by this member; no file is touched. */
export async function dismissProposal(env: Env, userId: number, room: Room, uid: string): Promise<Outcome> {
  const row = await ownRow(env, userId, room, uid);
  if (!row || !typeOfOption(row.rail_option) || row.status !== 'proposed') return NOT_OPEN;
  const res = await env.DB.prepare(
    `UPDATE ai_rail_proposals SET status = 'discarded', decided_at = CURRENT_TIMESTAMP, decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE uid = ? AND user_id = ? AND status = 'proposed'`,
  ).bind(userId, uid, userId).run();
  return Number(res.meta?.changes ?? 0) ? { ok: true, proposal: { uid, status: 'discarded' }, change: null } : NOT_OPEN;
}

/** Undo an accepted match or folder: the file goes back only while it still holds what the accept wrote. */
export async function undoProposal(env: Env, userId: number, room: Room, uid: string): Promise<Outcome> {
  const row = await ownRow(env, userId, room, uid);
  const type = row ? typeOfOption(row.rail_option) : null;
  const d = parse(row?.decided_payload_json ?? null);
  if (!row || !type || type === 'gap' || row.status !== 'accepted' || typeof d.nonce !== 'string' || d.undone) {
    return { ok: false, status: 409, code: 'not_undoable', message: 'Only an accepted match or folder move can be undone, once.' };
  }
  const p = parse(row.payload_json);
  const file = await env.DB.prepare('SELECT id FROM data_room_files WHERE uid = ? AND project_id = ?')
    .bind(String(p.file_uid ?? ''), room.id).first<{ id: number }>();
  if (!file) return { ok: false, status: 404, code: 'file_not_found', message: 'That file is no longer in the room.' };
  const restore = type === 'match'
    ? env.DB.prepare(
      `UPDATE data_room_files SET checklist_item = NULL, updated_at = ?
        WHERE id = ? AND project_id = ? AND checklist_item = ?`,
    ).bind(new Date().toISOString(), file.id, room.id, String(d.after?.checklist_item ?? ''))
    : env.DB.prepare(
      `UPDATE data_room_files SET folder_id = NULL, updated_at = ?
        WHERE id = ? AND project_id = ? AND folder_id = ?`,
    ).bind(new Date().toISOString(), file.id, room.id, Number(d.folder_id) || -1);
  const [moved, marked] = await env.DB.batch([
    restore,
    env.DB.prepare(
      `UPDATE ai_rail_proposals
          SET status = 'discarded', decided_payload_json = json_set(decided_payload_json, '$.undone', json('true'), '$.undone_by', ?, '$.undone_at', ?),
              decided_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE uid = ? AND user_id = ? AND status = 'accepted' AND changes() = 1`,
    ).bind(userId, new Date().toISOString(), userId, uid, userId),
  ]);
  if (!Number(moved?.meta?.changes ?? 0) || !Number(marked?.meta?.changes ?? 0)) {
    return { ok: false, status: 409, code: 'proposal_stale', message: 'The file changed since this was accepted, so it was left as it is.' };
  }
  return { ok: true, proposal: { uid, status: 'discarded' }, change: { file_id: file.id, undone: type } };
}
