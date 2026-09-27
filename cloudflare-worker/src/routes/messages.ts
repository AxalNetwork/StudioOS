/**
 * Messages — a person-to-person inbox. Mounted at /api/messages.
 * Schema: migration 185.
 *
 *   GET    /                      my threads, newest activity first
 *   POST   /                      start a thread with someone
 *   GET    /:uid                  one thread and its messages
 *   POST   /:uid/messages         post to it
 *   POST   /:uid/read             mark read up to now
 *   POST   /:uid/archive          archive it for everyone in it
 *
 * MEMBERSHIP IS THE ONLY KEY. Every read and every write joins
 * `message_thread_participants` on the caller. There is no admin override:
 * unlike a fund or a project, a private conversation has no oversight reading
 * — an operator who needs one has the audit log, not the inbox. That is a
 * deliberate divergence from the other scopes in `tenancyScope.ts`, which is
 * why this one is inline and narrow rather than added there as a fifth
 * resource: it is not a tenancy rule, it is "you are in the room or you are
 * not".
 *
 * Unread is DERIVED from `last_read_at`, never stored. A counter is a second
 * source of truth that drifts the first time a write half-fails.
 *
 * WHO THE OTHER PERSON IS (D414). Each thread carries its counterparties as a
 * card — handle, role, headline, and their name and photo only where their
 * own privacy_prefs show those on their public profile. The card is built by
 * the public card's own `effectiveFlags`, so a member who hides their name
 * there is not named here either. Nobody's email address is served: you do
 * not need the other person's address to talk to them inside the product.
 *
 * WHAT A THREAD IS ABOUT (D414). `subject_type` + `subject_id` name an object.
 * The detail read RESOLVES it into a context strip, and re-checks on every
 * read that the person reading may open that object — being in the thread is
 * not enough. A thread pinned to an engagement the reader cannot see shows
 * nothing about it; the same sentence covers "cannot see" and "no longer
 * exists", so the strip cannot be used to learn that an object is real.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { effectiveFlags } from './public';
import { refuse } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

const BODY_MAX = 8000;
const SUBJECT_MAX = 200;
// The objects a thread may be pinned to. A free-text subject_type would let
// the UI invent context rails for things that do not exist.
const SUBJECT_TYPES = new Set(['introduction', 'match', 'engagement', 'service', 'session', 'job']);

type ThreadRow = { id: number; uid: string; status: string };

/**
 * The other person, as their public card would show them (D414). Both reads
 * select the same columns for it, written out in each query so the SQL
 * checks can read them: id AS user_id, uid AS handle, role, name,
 * display_name, headline, privacy_prefs, headshot_r2_key. Name and
 * photo follow their privacy_prefs; the headline and role are what `/u/:handle`
 * always shows. No email, ever.
 */
export function personCard(row: any) {
  const role = String(row?.role || '').toLowerCase();
  const flags = effectiveFlags(row?.privacy_prefs, role);
  return {
    user_id: row.user_id,
    handle: row.handle,
    role,
    name: flags.name ? (row.display_name || row.name || null) : null,
    headline: row.headline || null,
    headshot_url: flags.headshot && row.headshot_r2_key ? `/api/settings/headshot/${row.handle}` : null,
    profile_path: `/u/${row.handle}`,
  };
}

/** Said once per response, for any card whose name is withheld. */
const NAME_WITHHELD = 'This member does not show their name on their profile, so it is not shown here either.';

/**
 * A resolved context strip: what the thread is about, as the reader may see it.
 * `link` is where the reader can open it; null with `link_absent` when there
 * is no page for this reader.
 */
type ThreadContext = {
  kind: string; title: string; amount_cents: number | null; status: string | null;
  link: { label: string; path: string } | null; link_absent: string | null;
};

const LANE_LABEL: Record<string, string> = {
  drafting: 'Drafting', proposed: 'Proposed', signed: 'Signed', renewal_due: 'Renewal due', ended: 'Ended',
};

/**
 * One resolver per subject type that something in the product writes (D414).
 *
 * `engagement` IS AN ADVISOR ENGAGEMENT. Three tables are called engagements
 * (`engagements`, `service_engagements`, `advisor_engagements`); the only code
 * that opens a thread about one — the advisor Delivery zone's nudge — pins it
 * to an `advisor_engagements` id. So that is the table this reads, and the
 * reader must be the advisor on it or the founder it is for.
 *
 * The other five types have no writer, so no resolver: guessing which of
 * several tables a `match` or a `session` means would be inventing the
 * answer. Their threads say so in the Worker's own sentence.
 */
const CONTEXT_RESOLVERS: Record<string, (env: Env, id: number, viewerId: number) => Promise<ThreadContext | null>> = {
  engagement: async (env, id, viewerId) => {
    const e = await env.DB.prepare(
      `SELECT e.scope_label, e.lane, e.amount_cents, e.founder_user_id, a.user_id AS advisor_user_id
         FROM advisor_engagements e JOIN advisors a ON a.id = e.advisor_id
        WHERE e.id = ?`,
    ).bind(id).first<any>();
    if (!e) return null;
    const isAdvisor = e.advisor_user_id !== null && Number(e.advisor_user_id) === viewerId;
    const isClient = e.founder_user_id !== null && Number(e.founder_user_id) === viewerId;
    if (!isAdvisor && !isClient) return null;
    return {
      kind: 'Engagement',
      title: e.scope_label || 'Advisory engagement',
      amount_cents: e.amount_cents ?? null,
      status: LANE_LABEL[e.lane] || null,
      link: isAdvisor ? { label: 'View engagement', path: '/practice/engagements' } : null,
      link_absent: isAdvisor ? null : 'There is no page yet where a founder opens an advisor engagement; it lives in the advisor’s practice.',
    };
  },
};

/** Why a thread pinned to a subject shows no strip, in the Worker's words. */
const CONTEXT_UNSEEN = 'This conversation was opened about something you cannot open here, or that no longer exists.';
const contextUnresolved = (type: string) =>
  `Nothing in the product opens a conversation about ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} yet, so there is no record to show beside this one.`;

async function resolveContext(env: Env, type: string | null, id: number | null, viewerId: number) {
  if (!type) return { context: null, context_absent: null };
  const resolver = CONTEXT_RESOLVERS[type];
  if (!resolver) return { context: null, context_absent: contextUnresolved(type) };
  if (id === null || id === undefined) return { context: null, context_absent: CONTEXT_UNSEEN };
  const ctx = await resolver(env, Number(id), viewerId);
  return ctx ? { context: ctx, context_absent: null } : { context: null, context_absent: CONTEXT_UNSEEN };
}

/** The thread, only if the caller is in it. */
async function memberThread(env: Env, uid: string, userId: number): Promise<ThreadRow | null> {
  const row = await env.DB.prepare(
    `SELECT t.id, t.uid, t.status
       FROM message_threads t
       JOIN message_thread_participants p ON p.thread_id = t.id AND p.user_id = ?
      WHERE t.uid = ?`,
  ).bind(userId, uid).first<ThreadRow>();
  return row || null;
}

r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const rows = await c.env.DB.prepare(
      `SELECT t.uid, t.subject, t.subject_type, t.subject_id, t.status,
              t.last_message_at, t.created_at,
              (SELECT COUNT(*) FROM messages m
                WHERE m.thread_id = t.id
                  AND m.sender_user_id != ?
                  AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)) AS unread,
              (SELECT m2.body FROM messages m2
                WHERE m2.thread_id = t.id ORDER BY m2.created_at DESC LIMIT 1) AS preview
         FROM message_threads t
         JOIN message_thread_participants p ON p.thread_id = t.id AND p.user_id = ?
        WHERE t.status = 'open'
        ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
        LIMIT 100`,
    ).bind(user.id, user.id).all<any>();

    // Counterparties, in one pass rather than a query per thread.
    const items = rows.results || [];
    let people: any[] = [];
    if (items.length) {
      const placeholders = items.map(() => '?').join(',');
      const res = await c.env.DB.prepare(
        `SELECT t.uid AS thread_uid, u.id AS user_id, u.uid AS handle, u.role, u.name, u.display_name,
                  u.headline, u.privacy_prefs, u.headshot_r2_key
           FROM message_thread_participants p
           JOIN message_threads t ON t.id = p.thread_id
           JOIN users u ON u.id = p.user_id
          WHERE t.uid IN (${placeholders}) AND p.user_id != ?`,
      ).bind(...items.map((x: any) => x.uid), user.id).all<any>();
      people = res.results || [];
    }
    const byThread = new Map<string, any[]>();
    for (const p of people) {
      if (!byThread.has(p.thread_uid)) byThread.set(p.thread_uid, []);
      byThread.get(p.thread_uid)!.push(personCard(p));
    }
    const out = items.map((t: any) => ({ ...t, unread: Number(t.unread), participants: byThread.get(t.uid) || [] }));
    return c.json({
      items: out,
      // The header's "N unread across M conversations", counted here once.
      unread_total: out.reduce((a: number, t: any) => a + t.unread, 0),
      absent: {
        ...(out.some((t: any) => t.participants.some((p: any) => p.name === null)) ? { name: NAME_WITHHELD } : {}),
        // The canvas says threads appear on their own when an introduction is
        // accepted or a match is made. Nothing does that: only this route and
        // the advisor nudge open a thread.
        auto_threads: 'Conversations do not open on their own when an introduction is accepted or a match is made: nothing creates them yet. Every thread here was started by a person.',
        search_scope: 'Search covers the 100 most recent open conversations, the ones listed here.',
      },
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    const body = await c.req.json().catch(() => ({} as any));
    const email = String(body.to_email || '').trim().toLowerCase();
    const text = String(body.body || '').trim();
    if (!email) return c.json({ detail: 'to_email is required' }, 400);
    if (!text) return c.json({ detail: 'A first message is required' }, 400);
    if (body.subject_type !== undefined && body.subject_type !== null
        && !SUBJECT_TYPES.has(String(body.subject_type))) {
      return c.json({ detail: 'invalid subject_type' }, 400);
    }

    // An existing account only. Nothing is mailed and no placeholder user is
    // created — the UI says so rather than implying an invite.
    const other = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?')
      .bind(email).first<{ id: number }>();
    if (!other) return c.json({ detail: 'No account with that address' }, 404);
    if (other.id === user.id) return c.json({ detail: 'You cannot message yourself' }, 400);

    // D414 — A THREAD CAN ONLY BE PINNED TO WHAT ITS STARTER CAN OPEN. The
    // read re-checks for every reader; this stops a thread being opened about
    // someone else's engagement in the first place.
    const subjectType = body.subject_type ? String(body.subject_type) : null;
    const subjectId = body.subject_id != null && body.subject_id !== '' ? Number(body.subject_id) : null;
    if (subjectType && subjectId !== null) {
      if (!Number.isInteger(subjectId)) {
        return refuse(c, 400, { code: 'subject_invalid', message: 'That is not something a conversation can be about.' });
      }
      const resolver = CONTEXT_RESOLVERS[subjectType];
      if (resolver && !(await resolver(c.env, subjectId, user.id))) {
        return refuse(c, 404, { code: 'subject_not_found', message: `That ${subjectType} is not one you can open, so a conversation cannot be pinned to it.` });
      }
    }

    const uid = newUid();
    const now = nowIso();
    const ins = await c.env.DB.prepare(
      `INSERT INTO message_threads
         (uid, subject, subject_type, subject_id, created_by_user_id, status, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).bind(uid, body.subject ? String(body.subject).slice(0, SUBJECT_MAX) : null,
           subjectType, subjectType ? subjectId : null,
           user.id, now, now, now).run();
    const threadId = Number((ins as any).meta?.last_row_id);

    // The sender has read their own opening message by definition; the
    // recipient has never opened the thread, which is what NULL means here.
    for (const participantId of [user.id, other.id]) {
      await c.env.DB.prepare(
        `INSERT INTO message_thread_participants (thread_id, user_id, last_read_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(threadId, participantId, participantId === user.id ? now : null, now).run();
    }
    await c.env.DB.prepare(
      'INSERT INTO messages (uid, thread_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(newUid(), threadId, user.id, text.slice(0, BODY_MAX), now).run();

    return c.json({ uid }, 201);
  } catch (e) { return mapError(c, e); }
});

r.get('/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const thread = await memberThread(c.env, c.req.param('uid'), user.id);
    // A thread the caller is not in is indistinguishable from one that does
    // not exist. A 403 would confirm the conversation is real.
    if (!thread) return c.json({ detail: 'Conversation not found' }, 404);

    const detail = await c.env.DB.prepare(
      'SELECT uid, subject, subject_type, subject_id, status, created_at FROM message_threads WHERE id = ?',
    ).bind(thread.id).first<any>();
    // Who sent each message is `sender_user_id`; the page names them from the
    // participant cards, so no name or address rides on each row.
    const msgs = await c.env.DB.prepare(
      `SELECT m.uid, m.body, m.created_at, m.sender_user_id
         FROM messages m
        WHERE m.thread_id = ? ORDER BY m.created_at ASC LIMIT 500`,
    ).bind(thread.id).all<any>();
    const people = await c.env.DB.prepare(
      `SELECT u.id AS user_id, u.uid AS handle, u.role, u.name, u.display_name,
                  u.headline, u.privacy_prefs, u.headshot_r2_key
         FROM message_thread_participants p JOIN users u ON u.id = p.user_id
        WHERE p.thread_id = ? AND p.user_id != ?`,
    ).bind(thread.id, user.id).all<any>();
    const participants = (people.results || []).map(personCard);
    const { context, context_absent } = await resolveContext(c.env, detail?.subject_type ?? null, detail?.subject_id ?? null, user.id);

    return c.json({
      thread: detail,
      me: { user_id: user.id },
      messages: msgs.results || [],
      participants,
      context,
      absent: {
        ...(context_absent ? { context: context_absent } : {}),
        ...(context?.link_absent ? { context_link: context.link_absent } : {}),
        ...(participants.some((p: any) => p.name === null) ? { name: NAME_WITHHELD } : {}),
        // The canvas's paperclip. There is no attachment store yet.
        attachments: 'Files cannot be attached to a conversation yet: there is nowhere to keep them.',
      },
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/messages', async (c) => {
  try {
    const user = await requireAuth(c);
    const thread = await memberThread(c.env, c.req.param('uid'), user.id);
    if (!thread) return c.json({ detail: 'Conversation not found' }, 404);
    if (thread.status !== 'open') return c.json({ detail: 'This conversation is archived' }, 409);

    const body = await c.req.json().catch(() => ({} as any));
    const text = String(body.body || '').trim();
    if (!text) return c.json({ detail: 'A message is required' }, 400);

    const now = nowIso();
    await c.env.DB.prepare(
      'INSERT INTO messages (uid, thread_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(newUid(), thread.id, user.id, text.slice(0, BODY_MAX), now).run();
    await c.env.DB.prepare('UPDATE message_threads SET last_message_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, thread.id).run();
    // Sending is reading: otherwise your own message counts against you.
    await c.env.DB.prepare(
      'UPDATE message_thread_participants SET last_read_at = ? WHERE thread_id = ? AND user_id = ?',
    ).bind(now, thread.id, user.id).run();
    return c.json({ ok: true }, 201);
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/read', async (c) => {
  try {
    const user = await requireAuth(c);
    const thread = await memberThread(c.env, c.req.param('uid'), user.id);
    if (!thread) return c.json({ detail: 'Conversation not found' }, 404);
    await c.env.DB.prepare(
      'UPDATE message_thread_participants SET last_read_at = ? WHERE thread_id = ? AND user_id = ?',
    ).bind(nowIso(), thread.id, user.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/:uid/archive', async (c) => {
  try {
    const user = await requireAuth(c);
    const thread = await memberThread(c.env, c.req.param('uid'), user.id);
    if (!thread) return c.json({ detail: 'Conversation not found' }, 404);
    // Archiving is for the whole thread, not per-person. A per-person hide
    // would need its own column, and a conversation one side has "archived"
    // while the other is still writing into it is a worse experience than
    // either alternative.
    await c.env.DB.prepare("UPDATE message_threads SET status = 'archived', updated_at = ? WHERE id = ?")
      .bind(nowIso(), thread.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export default r;
