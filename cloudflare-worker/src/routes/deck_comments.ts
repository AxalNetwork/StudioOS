import { holdsLicence } from '../services/accountLicences';
/**
 * D1570 (#3817, deck builder v2 D9) — comments on a deck's cards, with
 * @mentions, an assignee and Resolve, and the approval a share waits for
 * (PD-3 · pd33 "Comments on a card", and its inset).
 *
 *   GET  /api/decks/:id/comments                 the venture's threads, the people who can be mentioned, the open count
 *   POST /api/decks/:id/comments                 { body, card_index | card_uid, area?, parent_uid?, mentions? } one comment
 *   POST /api/decks/:id/comments/:uid/assign     { user_id | null } a thread's assignee
 *   POST /api/decks/:id/comments/:uid/resolve    { resolved?: boolean } Resolve, or open it again
 *   GET  /api/decks/:id/approval                 who must approve this version before it is shared, and who has
 *   PUT  /api/decks/:id/approvers                { user_ids } the founders name the approvers
 *   POST /api/decks/:id/approve                  an approver signs off this version
 *
 * WHO (owner decision Q = B, 2026-11-01). The venture's founders (its owner,
 * an accepted owner or cofounder member, through `projectOwned` with write
 * access) read, comment, assign, resolve and name approvers. An advisor or an
 * Operating Partner comments only when the founder grants it: a live
 * `advisor_client_grants` row with `scope_deck` (migration 741), with the role
 * re-checked on every request, as the client brief does. Anyone else, an
 * advisor member without the grant and an Admin included, is not found:
 * Admins have their own thread with the founders, the deck's notes (D905), and
 * comments are separate from it.
 *
 * A comment is pinned to a card, and optionally one area on it. A thread is
 * its first comment and the replies to it; the assignee and Resolve are the
 * first comment's. A mention names a person who can read the thread; each
 * person mentioned is told once per comment: the notice is sent only after
 * one UPDATE claims `deck_comment_mentions.notified_at`.
 *
 * NO AI ANYWHERE IN A THREAD. Comments are only between people (the owner
 * ruled out chat): nothing here reads or calls a model, and Eadwyn never
 * replies in one.
 *
 * Every write logs one `raise.pitch-deck` activity row naming the card and
 * version, never the comment's words. Mounted before `routes/decks.ts`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { cardRefOf } from '../services/decks/cardUids';
import { approvalSentence, pendingApprovers } from '../services/decks/deckApproval';
import { notify } from '../services/notify';
import { kindOfRole, peopleOf, type Kind } from '../services/decks/deckPeople';

const deckComments = new Hono<{ Bindings: Env }>();

export const COMMENT_MAX = 2000;
export const COMMENT_LIST_MAX = 500;
export const MENTION_MAX = 20;
export const APPROVER_MAX = 10;
const AREA = /^[A-Za-z0-9_.:-]{1,64}$/;
const UID = /^[a-f0-9]{32}$/;

type Viewer = { kind: Kind; manage: boolean };
type DeckRow = { id: number; project_id: number; version: number; slides: string | null };
type CommentRow = {
  id: number; uid: string; deck_id: number; deck_version: number; card_index: number; card_uid: string | null; area: string | null;
  parent_uid: string | null; author_user_id: number; author_name: string | null; body: string;
  assignee_user_id: number | null; assignee_name: string | null; resolved_at: string | null;
  resolved_by_user_id: number | null; resolved_by_name: string | null; created_at: string;
};

const NOT_FOUND = { error: 'deck_not_found', message: 'That deck is not one you can read.' };
const newUid = () => crypto.randomUUID().replace(/-/g, '');
const person = (id: number | null, name: string | null) => (id == null ? null : { id: Number(id), name: name ?? null });

async function deckRow(env: Env, id: number): Promise<DeckRow | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return env.DB.prepare('SELECT id, project_id, version, slides FROM pitch_decks WHERE id = ?').bind(id).first<DeckRow>();
}

/** A live grant that opens the deck's comments to this advisor or Operating Partner. */
async function deckGrantLive(env: Env, projectId: number, userId: number): Promise<boolean> {
  const g = await env.DB.prepare(
    `SELECT 1 AS ok FROM advisor_client_grants
      WHERE project_id = ? AND advisor_user_id = ? AND status = 'active' AND scope_deck = 1
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
  ).bind(projectId, userId).first<{ ok: number }>();
  return Boolean(g);
}

/**
 * What the caller is to this deck's comments, or null. A founder by the deck's
 * write access; an advisor or Operating Partner by role now and the founder's
 * `scope_deck` grant; nobody else.
 */
async function viewerOf(c: any, user: User, projectId: number, writing: boolean): Promise<Viewer | null> {
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin') return null;
  try {
    // A founder's write is recorded first by projectOwned when they are not the owner.
    await projectOwned(c, user, projectId, { write: true, audit: writing });
    return { kind: 'founder', manage: true };
  } catch { /* not a founder of this venture: the grant decides */ }
  if (!holdsLicence(user, 'advisor') && !holdsLicence(user, 'partner')) return null;
  return await deckGrantLive(c.env, projectId, Number(user.id)) ? { kind: kindOfRole(role), manage: false } : null;
}

// The one comment reader, by venture (all) or by id (one); bound, never built.
const COMMENTS_OF_PROJECT = `SELECT c.id, c.uid, c.deck_id, c.deck_version, c.card_index, c.card_uid, c.area, p.uid AS parent_uid,
         c.author_user_id, au.name AS author_name, c.body, c.assignee_user_id, asg.name AS assignee_name,
         c.resolved_at, c.resolved_by_user_id, rb.name AS resolved_by_name, c.created_at
    FROM deck_comments c
    LEFT JOIN deck_comments p ON p.id = c.parent_id
    LEFT JOIN users au ON au.id = c.author_user_id
    LEFT JOIN users asg ON asg.id = c.assignee_user_id
    LEFT JOIN users rb ON rb.id = c.resolved_by_user_id
   WHERE c.project_id = ? AND (? IS NULL OR c.id = ?)
   ORDER BY c.created_at, c.id LIMIT ?`;

function commentView(r: CommentRow, mentions: { id: number; name: string | null }[]) {
  return {
    uid: r.uid,
    deck_id: Number(r.deck_id),
    deck_version: Number(r.deck_version),
    card_index: Number(r.card_index),
    card_uid: r.card_uid ?? null,
    area: r.area ?? null,
    parent_uid: r.parent_uid ?? null,
    author: { id: Number(r.author_user_id), name: r.author_name ?? null },
    body: r.body,
    mentions,
    assignee: person(r.assignee_user_id, r.assignee_name),
    resolved_at: r.resolved_at ?? null,
    resolved_by: person(r.resolved_by_user_id, r.resolved_by_name),
    created_at: r.created_at,
  };
}

/** Who each of the venture's comments mentions (or one comment's, given its id). */
async function mentionsOf(env: Env, projectId: number, commentId: number | null): Promise<Map<number, { id: number; name: string | null }[]>> {
  const rows = (await env.DB.prepare(
    `SELECT m.comment_id, m.user_id, u.name FROM deck_comment_mentions m
       JOIN deck_comments c ON c.id = m.comment_id LEFT JOIN users u ON u.id = m.user_id
      WHERE c.project_id = ? AND (? IS NULL OR m.comment_id = ?)
      ORDER BY m.comment_id, m.user_id`,
  ).bind(projectId, commentId, commentId).all<{ comment_id: number; user_id: number; name: string | null }>()).results ?? [];
  const out = new Map<number, { id: number; name: string | null }[]>();
  for (const r of rows) {
    const list = out.get(Number(r.comment_id)) ?? [];
    list.push({ id: Number(r.user_id), name: r.name ?? null });
    out.set(Number(r.comment_id), list);
  }
  return out;
}

async function oneComment(env: Env, projectId: number, id: number) {
  const row = await env.DB.prepare(COMMENTS_OF_PROJECT).bind(projectId, id, id, 1).first<CommentRow>();
  if (!row) return null;
  return commentView(row, (await mentionsOf(env, projectId, Number(row.id))).get(Number(row.id)) ?? []);
}

/** A thread's first comment on this venture, by its uid, or null. */
async function threadOf(env: Env, projectId: number, uid: string) {
  if (!UID.test(uid)) return null;
  return env.DB.prepare('SELECT id, author_user_id, assignee_user_id, parent_id, card_index, deck_version FROM deck_comments WHERE uid = ? AND project_id = ?')
    .bind(uid, projectId).first<{ id: number; author_user_id: number; assignee_user_id: number | null; parent_id: number | null; card_index: number; deck_version: number }>();
}

/** The deck, its venture and what the caller is to it; or the refusal. */
async function open(c: any, writing: boolean): Promise<{ user: User; row: DeckRow; viewer: Viewer; projectId: number } | { refused: Response }> {
  const user = await requireAuth(c);
  const row = await deckRow(c.env, Number(c.req.param('id')));
  if (!row) return { refused: c.json(NOT_FOUND, 404) };
  const projectId = Number(row.project_id);
  const viewer = await viewerOf(c, user, projectId, writing);
  if (!viewer) return { refused: c.json(NOT_FOUND, 404) };
  return { user, row, viewer, projectId };
}

const slidesOf = (row: DeckRow): unknown[] => {
  try { const s = JSON.parse(row.slides || '[]'); return Array.isArray(s) ? s : []; } catch { return []; }
};

const logWrite = (env: Env, projectId: number, user: User, entityId: number, action: string, summary: string) => logCycleWriteStatement(env, {
  projectId, userId: Number(user.id), cycle: 'raise', module: 'pitch-deck', entityId, action, summary,
});

deckComments.get('/:id/comments', async (c) => {
  const got = await open(c, false);
  if ('refused' in got) return got.refused;
  const { user, row, viewer, projectId } = got;
  const rows = (await c.env.DB.prepare(COMMENTS_OF_PROJECT).bind(projectId, null, null, COMMENT_LIST_MAX).all<CommentRow>()).results ?? [];
  const mentions = await mentionsOf(c.env, projectId, null);
  const comments = rows.map((r) => commentView(r, mentions.get(Number(r.id)) ?? []));
  return c.json({
    deck_id: Number(row.id),
    version: Number(row.version),
    viewer: { user_id: Number(user.id), kind: viewer.kind, can_manage: viewer.manage },
    people: await peopleOf(c.env, projectId),
    comments,
    open: comments.filter((x) => x.parent_uid === null && x.resolved_at === null).length,
  });
});

deckComments.post('/:id/comments', async (c) => {
  const got = await open(c, true);
  if ('refused' in got) return got.refused;
  const { user, row, projectId } = got;
  const input = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  if (!body) return c.json({ error: 'comment_required', message: 'Write the comment first.' }, 400);
  if (body.length > COMMENT_MAX) return c.json({ error: 'comment_too_long', message: `A comment is at most ${COMMENT_MAX.toLocaleString('en-US')} characters.` }, 400);

  // A reply joins its thread's card and area; a new thread names its card on this version.
  let card: number; let cardUid: string | null; let area: string | null = null; let parentId: number | null = null;
  if (input?.parent_uid != null) {
    const parent = await threadOf(c.env, projectId, String(input.parent_uid));
    if (!parent || parent.parent_id != null) return c.json({ error: 'thread_not_found', message: 'That thread is not on this deck.' }, 404);
    const p = await c.env.DB.prepare('SELECT card_index, card_uid, area FROM deck_comments WHERE id = ?').bind(parent.id).first<{ card_index: number; card_uid: string | null; area: string | null }>();
    parentId = Number(parent.id); card = Number(p?.card_index ?? parent.card_index); cardUid = p?.card_uid ?? null; area = p?.area ?? null;
  } else {
    const slides = slidesOf(row);
    const ref = cardRefOf(slides, { card: input?.card_index ?? null, card_uid: input?.card_uid ?? null });
    if ('error' in ref || ref.index === null || ref.index >= slides.length) {
      return c.json({ error: 'invalid_card', message: 'Pin the comment to a card in this version of the deck.' }, 400);
    }
    card = ref.index; cardUid = ref.uid;
    if (input?.area != null && input.area !== '') {
      if (typeof input.area !== 'string' || !AREA.test(input.area)) return c.json({ error: 'invalid_area', message: 'That area is not one on this card.' }, 400);
      area = input.area;
    }
  }

  // A mention names someone who can read the thread; each person once, never the author.
  const asked = Array.isArray(input?.mentions) ? input!.mentions as unknown[] : [];
  if (asked.length > MENTION_MAX) return c.json({ error: 'too_many_mentions', message: `Mention at most ${MENTION_MAX} people in one comment.` }, 400);
  const ids = [...new Set(asked.map((v) => Number(v)))];
  if (ids.some((v) => !Number.isSafeInteger(v) || v < 1)) return c.json({ error: 'mention_not_on_deck', message: 'Mention someone who can read this deck\'s comments.' }, 400);
  const people = new Map((await peopleOf(c.env, projectId)).map((p) => [p.id, p]));
  if (ids.some((v) => !people.has(v))) return c.json({ error: 'mention_not_on_deck', message: 'Mention someone who can read this deck\'s comments.' }, 400);
  const mentioned = ids.filter((v) => v !== Number(user.id));

  const uid = newUid();
  const [insert] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO deck_comments (uid, project_id, deck_id, deck_version, card_index, card_uid, area, parent_id, author_user_id, body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, projectId, row.id, row.version, card, cardUid, area, parentId, user.id, body),
    logWrite(c.env, projectId, user, Number(row.id), parentId ? 'deck_comment_replied' : 'deck_comment_posted',
      `${parentId ? 'Reply' : 'Comment'} on card ${card + 1}, v${row.version}`),
  ]);
  const id = Number(insert?.meta?.last_row_id);
  if (mentioned.length) {
    await c.env.DB.batch(mentioned.map((m) => c.env.DB.prepare('INSERT OR IGNORE INTO deck_comment_mentions (comment_id, user_id) VALUES (?, ?)').bind(id, m)));
  }
  // Each person is told once: the notice goes only to the one request whose UPDATE claims the row.
  const author = String(user.name || '').trim() || 'Someone on the venture';
  for (const m of mentioned) {
    const claim = await c.env.DB.prepare('UPDATE deck_comment_mentions SET notified_at = datetime(\'now\') WHERE comment_id = ? AND user_id = ? AND notified_at IS NULL')
      .bind(id, m).run();
    if (Number(claim?.meta?.changes) !== 1) continue;
    await notify(c.env, {
      userId: m, type: 'deck_comment_mention', category: 'mentions',
      title: `${author} mentioned you on card ${card + 1}.`,
      body: 'Open the deck to read the comment and reply.',
      link: `/raise/pitch/edit?project_id=${projectId}&comment=${uid}`,
      payload: { deck_id: Number(row.id), comment_uid: uid, card_index: card },
    }).catch(() => null);
  }
  const saved = await oneComment(c.env, projectId, id);
  if (!saved) return c.json({ error: 'comment_unreadable', message: 'The comment was saved but could not be read back. Reload the comments.' }, 500);
  return c.json({ comment: saved }, 201);
});

deckComments.post('/:id/comments/:uid/assign', async (c) => {
  const got = await open(c, true);
  if ('refused' in got) return got.refused;
  const { user, row, viewer, projectId } = got;
  const thread = await threadOf(c.env, projectId, c.req.param('uid'));
  if (!thread) return c.json({ error: 'thread_not_found', message: 'That thread is not on this deck.' }, 404);
  if (thread.parent_id != null) return c.json({ error: 'not_a_thread', message: 'Assign the thread, not a reply.' }, 400);
  if (!viewer.manage && Number(thread.author_user_id) !== Number(user.id)) {
    return c.json({ error: 'not_yours', message: 'The founders or the person who started the thread assign it.' }, 403);
  }
  const input = await c.req.json().catch(() => null) as { user_id?: unknown } | null;
  const to = input?.user_id == null ? null : Number(input.user_id);
  if (to !== null && !(await peopleOf(c.env, projectId)).some((p) => p.id === to)) {
    return c.json({ error: 'assignee_not_on_deck', message: 'Assign someone who can read this deck\'s comments.' }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE deck_comments SET assignee_user_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?").bind(to, thread.id, projectId),
    logWrite(c.env, projectId, user, Number(row.id), 'deck_comment_assigned', `Thread on card ${Number(thread.card_index) + 1} ${to === null ? 'unassigned' : 'assigned'}`),
  ]);
  return c.json({ comment: await oneComment(c.env, projectId, Number(thread.id)) });
});

deckComments.post('/:id/comments/:uid/resolve', async (c) => {
  const got = await open(c, true);
  if ('refused' in got) return got.refused;
  const { user, row, viewer, projectId } = got;
  const thread = await threadOf(c.env, projectId, c.req.param('uid'));
  if (!thread) return c.json({ error: 'thread_not_found', message: 'That thread is not on this deck.' }, 404);
  if (thread.parent_id != null) return c.json({ error: 'not_a_thread', message: 'Resolve the thread, not a reply.' }, 400);
  const me = Number(user.id);
  if (!viewer.manage && Number(thread.author_user_id) !== me && Number(thread.assignee_user_id) !== me) {
    return c.json({ error: 'not_yours', message: 'The founders, the person who started the thread or its assignee resolve it.' }, 403);
  }
  const input = await c.req.json().catch(() => null) as { resolved?: unknown } | null;
  const resolved = input?.resolved !== false;
  await c.env.DB.batch([
    resolved
      ? c.env.DB.prepare("UPDATE deck_comments SET resolved_at = datetime('now'), resolved_by_user_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?").bind(me, thread.id, projectId)
      : c.env.DB.prepare("UPDATE deck_comments SET resolved_at = NULL, resolved_by_user_id = NULL, updated_at = datetime('now') WHERE id = ? AND project_id = ?").bind(thread.id, projectId),
    logWrite(c.env, projectId, user, Number(row.id), resolved ? 'deck_comment_resolved' : 'deck_comment_reopened', `Thread on card ${Number(thread.card_index) + 1} ${resolved ? 'resolved' : 'opened again'}`),
  ]);
  return c.json({ comment: await oneComment(c.env, projectId, Number(thread.id)) });
});

/** This version's approval: every approver still named, whether each signed it off, and who is waited on. */
async function approvalView(env: Env, row: DeckRow) {
  const projectId = Number(row.project_id);
  const rows = (await env.DB.prepare(
    `SELECT a.user_id, u.name, a.approved_deck_id, a.approved_version, a.approved_at
       FROM deck_approvers a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.project_id = ? AND a.removed_at IS NULL ORDER BY a.id`,
  ).bind(projectId).all<{ user_id: number; name: string | null; approved_deck_id: number | null; approved_version: number | null; approved_at: string | null }>()).results ?? [];
  const pending = await pendingApprovers(env, projectId, Number(row.id));
  return {
    deck_id: Number(row.id),
    version: Number(row.version),
    approvers: rows.map((r) => ({
      user_id: Number(r.user_id), name: r.name ?? null,
      approved: r.approved_deck_id != null && Number(r.approved_deck_id) === Number(row.id),
      approved_version: r.approved_version == null ? null : Number(r.approved_version),
      approved_at: r.approved_at ?? null,
    })),
    pending,
    message: pending.length ? approvalSentence(pending) : null,
  };
}

deckComments.get('/:id/approval', async (c) => {
  const got = await open(c, false);
  if ('refused' in got) return got.refused;
  return c.json(await approvalView(c.env, got.row));
});

deckComments.put('/:id/approvers', async (c) => {
  const got = await open(c, true);
  if ('refused' in got) return got.refused;
  const { user, row, viewer, projectId } = got;
  if (!viewer.manage) return c.json({ error: 'founders_only', message: 'The founders name who approves the deck.' }, 403);
  const input = await c.req.json().catch(() => null) as { user_ids?: unknown } | null;
  if (!Array.isArray(input?.user_ids)) return c.json({ error: 'approvers_required', message: 'Send the approvers as a list, or an empty one.' }, 400);
  const ids = [...new Set((input!.user_ids as unknown[]).map((v) => Number(v)))];
  if (ids.length > APPROVER_MAX) return c.json({ error: 'too_many_approvers', message: `Name at most ${APPROVER_MAX} approvers.` }, 400);
  const people = new Set((await peopleOf(c.env, projectId)).map((p) => p.id));
  if (ids.some((v) => !people.has(v))) return c.json({ error: 'approver_not_on_deck', message: 'Name approvers who can read this deck\'s comments.' }, 400);
  const keep = JSON.stringify(ids);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE deck_approvers SET removed_at = datetime('now'), updated_at = datetime('now')
        WHERE project_id = ? AND removed_at IS NULL AND user_id NOT IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
    ).bind(projectId, keep),
    // Named again after removal: their earlier approval does not come back with them.
    ...ids.map((id) => c.env.DB.prepare(
      `INSERT INTO deck_approvers (uid, project_id, user_id, added_by_user_id) VALUES (?, ?, ?, ?)
       ON CONFLICT (project_id, user_id) DO UPDATE SET
         approved_deck_id = CASE WHEN deck_approvers.removed_at IS NULL THEN deck_approvers.approved_deck_id ELSE NULL END,
         approved_version = CASE WHEN deck_approvers.removed_at IS NULL THEN deck_approvers.approved_version ELSE NULL END,
         approved_at = CASE WHEN deck_approvers.removed_at IS NULL THEN deck_approvers.approved_at ELSE NULL END,
         added_by_user_id = CASE WHEN deck_approvers.removed_at IS NULL THEN deck_approvers.added_by_user_id ELSE excluded.added_by_user_id END,
         removed_at = NULL, updated_at = datetime('now')`,
    ).bind(newUid(), projectId, id, user.id)),
    logWrite(c.env, projectId, user, Number(row.id), 'deck_approvers_set', `Approvers set: ${ids.length}`),
  ]);
  return c.json(await approvalView(c.env, row));
});

deckComments.post('/:id/approve', async (c) => {
  const got = await open(c, true);
  if ('refused' in got) return got.refused;
  const { user, row, projectId } = got;
  const res = await c.env.DB.prepare(
    `UPDATE deck_approvers SET approved_deck_id = ?, approved_version = ?, approved_at = datetime('now'), updated_at = datetime('now')
      WHERE project_id = ? AND user_id = ? AND removed_at IS NULL`,
  ).bind(row.id, row.version, projectId, user.id).run();
  if (Number(res?.meta?.changes) !== 1) return c.json({ error: 'not_an_approver', message: 'You are not named to approve this deck.' }, 403);
  await logWrite(c.env, projectId, user, Number(row.id), 'deck_approved', `Approved v${row.version}`).run();
  return c.json(await approvalView(c.env, row));
});

export default deckComments;
