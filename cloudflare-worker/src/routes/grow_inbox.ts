/** D4494: Distribution Inbox reads and personal read receipts; this router cannot send mail. */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { INBOX_READ_LIMIT, loadInbox, markInboxRead } from '../services/growInbox';
import { refuse } from '../util/refusal';

const router = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;
class InboxRefusal extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) { super(code); this.status = status; this.code = code; this.sentence = sentence; }
}
async function access(c: C, raw: unknown) {
  let user: User;
  try { user = await requireAuth(c); } catch { throw new InboxRefusal(401, 'unauthorized', 'Sign in to read replies.'); }
  if ((await selectJwt(c))?.payload.impersonated_by) throw new InboxRefusal(403, 'support_session_refused', 'Use your own account to read replies.');
  if (!/^[1-9][0-9]{0,9}$/.test(String(raw ?? ''))) throw new InboxRefusal(400, 'project_invalid', 'Choose a venture.');
  const project = Number(raw);
  const row = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(project).first<{ id: number; founder_id: number | null }>();
  if (!row || !await canAccessProject(c.env, user, row)) throw new InboxRefusal(404, 'project_not_found', 'Venture not found.');
  return { user, project, canWrite: await canAccessProject(c.env, user, row, { write: true }) };
}
function failure(c: C, error: unknown) {
  if (error instanceof InboxRefusal) return refuse(c, error.status, { code: error.code, message: error.sentence });
  return refuse(c, 503, { code: 'inbox_unreadable', message: 'Replies could not be read. Try again.' });
}
const uidOf = (raw: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(raw) ? raw : null;

router.get('/unread-count', async (c) => {
  try {
    const { user, project } = await access(c, c.req.query('project'));
    try { const inbox = await loadInbox(c.env, user, project); return c.json({ count: inbox.count, needs_you: inbox.needs_you, state: inbox.complete ? 'ready' : 'unreadable' }); }
    catch { return c.json({ count: null, needs_you: { count: null, organization: null }, state: 'unreadable' }); }
  } catch (error) { return failure(c, error); }
});
router.get('/', async (c) => {
  try {
    const { user, project, canWrite } = await access(c, c.req.query('project'));
    const inbox = await loadInbox(c.env, user, project);
    const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 120);
    const threads = inbox.threads.filter((t) => !q || [t.contact.name, t.contact.organization, t.last_line].some((s) => s?.toLowerCase().includes(q)))
      .map((t) => ({ contact: t.contact, campaign: t.campaign, unread: t.unread, last_at: t.last_at, channel: t.channel, last_line: t.last_line }));
    return c.json({ threads, unread_count: inbox.count, needs_you: inbox.needs_you, channels: inbox.channels, can_write: canWrite, state: inbox.complete ? 'ready' : 'unreadable' });
  } catch (error) { return failure(c, error); }
});
router.get('/:contactUid', async (c) => {
  try {
    const { user, project, canWrite } = await access(c, c.req.query('project'));
    const uid = uidOf(c.req.param('contactUid'));
    if (!uid) throw new InboxRefusal(404, 'contact_not_found', 'Prospect not found.');
    const inbox = await loadInbox(c.env, user, project, uid);
    const contact = inbox.contacts[0];
    if (!contact) throw new InboxRefusal(404, 'contact_not_found', 'Prospect not found.');
    return c.json({ thread: inbox.threads[0], recipient: contact.email, accounts: inbox.accounts, can_write: canWrite, state: inbox.complete ? 'ready' : 'unreadable' });
  } catch (error) { return failure(c, error); }
});
router.post('/:contactUid/read', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const { user, project } = await access(c, body?.project);
    const uid = uidOf(c.req.param('contactUid'));
    if (!uid) throw new InboxRefusal(404, 'contact_not_found', 'Prospect not found.');
    if (!Array.isArray(body?.message_keys) || body.message_keys.length > INBOX_READ_LIMIT || body.message_keys.some((k: unknown) => typeof k !== 'string' || !/^(?:contact:[1-9][0-9]{0,18}|mail:[a-f0-9]{64})$/.test(k))) throw new InboxRefusal(400, 'read_keys_invalid', 'Choose the replies you read.');
    const inbox = await loadInbox(c.env, user, project, uid);
    const contact = inbox.contacts[0];
    if (!contact) throw new InboxRefusal(404, 'contact_not_found', 'Prospect not found.');
    if (!inbox.complete) throw new InboxRefusal(503, 'inbox_unreadable', 'Replies could not be read. Try again.');
    if (!await markInboxRead(c.env, user, project, contact, body.message_keys, inbox.threads[0].messages)) throw new InboxRefusal(409, 'read_changed', 'The replies changed. Open the thread again.');
    return c.json({ ok: true });
  } catch (error) { return failure(c, error); }
});

export const mount = { path: '/api/grow/inbox', router: router };
export default router;
