/** D4494: venture contact threads plus the caller's own readable mail; no send capability. */
import type { Env, User } from '../types';
import { ADAPTERS } from './mail/adapters';
import { accountView, markUsed, openCreds, type AccountRow } from './mail/accounts';
import type { ThreadMessage } from './mail/adapters/types';
import { logCycleWriteStatement } from './cycleActivity';

type Contact = { id: number; uid: string; project_id: number; name: string | null; organization: string | null; email: string; utm_json: string | null; status: string };
type Reply = { id: number; contact_id: number; direction: string; body: string | null; channel: string | null; created_at: string | null };
type Sent = { uid: string; contact_id: number; account_id: number; subject: string; sent_at: string; provider_message_id: string | null };
export type InboxMessage = { key: string; direction: 'inbound' | 'outbound'; source: 'contact_replies' | 'mail_sent' | 'mailbox'; channel: string | null; at: string | null; body: string | null; subject: string | null; preview: boolean };
export const INBOX_READ_LIMIT = 5000;
const CONTACT_LIMIT = 500, MESSAGE_LIMIT = INBOX_READ_LIMIT, MAIL_LIMIT = 1000, THREAD_LIMIT = 30;
const CHANNELS = new Set(['email', 'whatsapp', 'telegram', 'sms', 'voice', 'linkedin']);
const lower = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();
const epoch = (s: string | null) => s ? Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z') || 0 : 0;

async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('Inbox source unreadable');
  return result.results;
}

/** Test seam as in the mail services; the ownership/can_read gates live outside it. */
export const inboxMailboxReader = {
  async read(env: Env, account: AccountRow, sentId: string): Promise<ThreadMessage[]> {
    const fresh = await env.DB.prepare("SELECT * FROM mail_accounts WHERE id = ? AND user_id = ? AND status = 'active' AND can_read = 1").bind(account.id, account.user_id).first<AccountRow>();
    if (!fresh) throw new Error('Inbox mailbox unreadable');
    const adapter = ADAPTERS[fresh.provider];
    const creds = await openCreds(env, fresh);
    if (!creds || !adapter?.listThread) throw new Error('Inbox mailbox unreadable');
    const thread = await adapter.listThread(env, creds, sentId);
    await markUsed(env, fresh, thread.creds);
    return thread.messages;
  },
};

async function messageKey(account: number, message: ThreadMessage): Promise<string> {
  // A receipt names only a digest, not a copy of private mail. Including the
  // account prevents one member's read from marking another mailbox's message.
  const input = message.id ? JSON.stringify([account, message.id]) : JSON.stringify([account, lower(message.from), message.received_at, message.subject, message.preview]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return 'mail:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function campaignOf(contact: Contact, campaigns: { uid: string; name: string }[]) {
  try {
    const utm = JSON.parse(contact.utm_json || '{}');
    const uid = utm?.campaign_uid ?? utm?.campaign;
    return campaigns.find((c) => c.uid === uid) ?? null;
  } catch { return null; }
}

export async function loadInbox(env: Env, user: User, project: number, onlyContact?: string) {
  const failed = new Set<string>();
  async function source<T>(name: string, stmt: D1PreparedStatement): Promise<T[]> {
    try { return await rows<T>(stmt); } catch { failed.add(name); return []; }
  }
  // The selected project is always bound, even when a member can read two ventures.
  const contacts = await rows<Contact>(onlyContact
    ? env.DB.prepare("SELECT id, uid, project_id, name, organization, email, utm_json, status FROM contacts WHERE project_id = ? AND audience = 'customer' AND uid = ?").bind(project, onlyContact)
    : env.DB.prepare("SELECT id, uid, project_id, name, organization, email, utm_json, status FROM contacts WHERE project_id = ? AND audience = 'customer' ORDER BY id LIMIT 501").bind(project));
  if (contacts.length > CONTACT_LIMIT) failed.add('limit');
  const selected = contacts.slice(0, CONTACT_LIMIT), ids = new Set(selected.map((c) => c.id));
  const [replies, sent, accounts, receipts, campaigns] = await Promise.all([
    source<Reply>('contact_replies', env.DB.prepare("SELECT r.id, r.contact_id, r.direction, r.body, r.channel, r.created_at FROM contact_replies r JOIN contacts c ON c.id = r.contact_id WHERE c.project_id = ? AND c.audience = 'customer' AND (? IS NULL OR c.uid = ?) ORDER BY r.id DESC LIMIT 5001").bind(project, onlyContact ?? null, onlyContact ?? null)),
    source<Sent>('mail_sent', env.DB.prepare("SELECT s.uid, c.id AS contact_id, s.account_id, s.subject, s.sent_at, s.provider_message_id FROM mail_sent s JOIN mail_accounts a ON a.id = s.account_id AND a.user_id = s.user_id JOIN contacts c ON lower(trim(c.email)) = lower(trim(s.recipient)) WHERE c.project_id = ? AND c.audience = 'customer' AND s.user_id = ? AND s.sent_at IS NOT NULL AND (? IS NULL OR c.uid = ?) ORDER BY s.id DESC LIMIT 1001").bind(project, user.id, onlyContact ?? null, onlyContact ?? null)),
    source<AccountRow>('mail_accounts', env.DB.prepare("SELECT * FROM mail_accounts WHERE user_id = ? AND status <> 'revoked' ORDER BY id").bind(user.id)),
    source<{ contact_id: number; message_key: string }>('read_receipts', env.DB.prepare('SELECT r.contact_id, r.message_key FROM grow_inbox_reads r JOIN contacts c ON c.id = r.contact_id WHERE r.user_id = ? AND c.project_id = ? AND (? IS NULL OR c.uid = ?) ORDER BY r.read_at DESC LIMIT 50001').bind(user.id, project, onlyContact ?? null, onlyContact ?? null)),
    source<{ uid: string; name: string }>('campaigns', env.DB.prepare('SELECT uid, name FROM grow_campaigns WHERE project_id = ?').bind(project)),
  ]);
  if (replies.length > MESSAGE_LIMIT || sent.length > MAIL_LIMIT || receipts.length > 50000) failed.add('limit');
  const byContact = new Map<number, InboxMessage[]>(selected.map((c) => [c.id, []]));
  for (const r of replies.slice(0, MESSAGE_LIMIT)) {
    if (!ids.has(r.contact_id)) continue;
    if (r.direction !== 'inbound' && r.direction !== 'outbound') { failed.add('contact_replies'); continue; }
    byContact.get(r.contact_id)!.push({ key: 'contact:' + r.id, source: 'contact_replies', direction: r.direction, channel: CHANNELS.has(r.channel || '') ? r.channel : null, at: r.created_at, body: r.body, subject: null, preview: false });
  }
  const ownAccounts = new Map(accounts.filter((a) => a.user_id === user.id).map((a) => [a.id, a]));
  const fetched = new Map<string, Promise<ThreadMessage[]>>();
  let mailboxMessages = 0;
  // Sequential per account: a mailbox refresh can rotate its token. A bounded
  // read that cannot finish is explicit, never an invented unread zero.
  for (const s of sent.slice(0, MAIL_LIMIT)) {
    if (!ids.has(s.contact_id)) continue;
    const messages = byContact.get(s.contact_id)!;
    messages.push({ key: 'sent:' + s.uid, source: 'mail_sent', direction: 'outbound', channel: 'email', at: s.sent_at, subject: s.subject, body: null, preview: false });
    const a = ownAccounts.get(s.account_id);
    if (!a || a.can_read !== 1) continue;
    if (a.status !== 'active' || !s.provider_message_id) { failed.add('mailbox'); continue; }
    const key = a.id + ':' + s.provider_message_id;
    if (!fetched.has(key)) {
      if (fetched.size >= THREAD_LIMIT) { failed.add('limit'); continue; }
      fetched.set(key, inboxMailboxReader.read(env, a, s.provider_message_id));
    }
    try {
      const thread = await fetched.get(key)!;
      if (!Array.isArray(thread)) throw new Error('Inbox mailbox unreadable');
      mailboxMessages += thread.length;
      if (mailboxMessages > MESSAGE_LIMIT) throw new Error('Inbox mailbox unreadable');
      const contact = selected.find((c) => c.id === s.contact_id)!;
      for (const m of thread) {
        const from = lower(m.from), outbound = from === lower(a.address);
        if (!from || (!outbound && from !== lower(contact.email))) continue;
        messages.push({ key: await messageKey(a.id, m), source: 'mailbox', direction: outbound ? 'outbound' : 'inbound', channel: 'email', at: m.received_at, body: m.preview, subject: m.subject, preview: true });
      }
    } catch { failed.add('mailbox'); }
  }
  const seen = new Set(receipts.map((r) => r.contact_id + ':' + r.message_key));
  const complete = failed.size === 0;
  const threads = selected.map((c) => {
    const unique = [...new Map(byContact.get(c.id)!.map((m) => [m.key, m])).values()].sort((a, b) => epoch(a.at) - epoch(b.at) || a.key.localeCompare(b.key));
    const inbound = unique.filter((m) => m.direction === 'inbound');
    const unread = complete ? inbound.some((m) => !seen.has(c.id + ':' + m.key)) : null;
    const last = unique.at(-1);
    return { contact: { uid: c.uid, name: c.name, organization: c.organization, status: c.status }, campaign: campaignOf(c, campaigns), unread,
      last_at: last?.at ?? null, channel: last?.channel ?? null, last_line: last?.body ?? last?.subject ?? null, messages: unique };
  }).filter((t) => t.messages.length > 0 || !!onlyContact).sort((a, b) => epoch(b.last_at) - epoch(a.last_at) || a.contact.uid.localeCompare(b.contact.uid));
  const count = complete ? threads.filter((t) => t.unread === true).length : null;
  const groups = new Map<string, number>();
  for (const t of threads.filter((t) => t.unread === true && t.contact.organization)) groups.set(t.contact.organization!, (groups.get(t.contact.organization!) ?? 0) + 1);
  const top = [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const recordedChannels = new Set(replies.filter((r) => ids.has(r.contact_id)).map((r) => r.channel));
  return { contacts: selected, threads, count, complete, failed: [...failed],
    needs_you: { count, organization: top ? { name: top[0], count: top[1] } : null },
    channels: ['email', 'whatsapp', 'linkedin', 'telegram', 'sms', 'voice'].map((channel) => ({ channel, state: channel === 'email' ? accounts.some((a) => a.can_read === 1 && a.status === 'active') ? 'connected' : 'not_connected' : recordedChannels.has(channel) ? 'recorded' : 'not_connected' })),
    accounts: accounts.filter((a) => a.user_id === user.id).map(accountView),
  };
}

/** Mark exactly the inbound messages the viewer loaded; a concurrent arrival stays unread. */
export async function markInboxRead(env: Env, user: User, project: number, contact: Contact, keys: string[], messages: InboxMessage[]) {
  const allowed = new Set(messages.filter((m) => m.direction === 'inbound').map((m) => m.key));
  if (keys.length > MESSAGE_LIMIT || keys.some((k) => !allowed.has(k))) return false;
  const statements = [...new Set(keys)].map((key) => env.DB.prepare('INSERT INTO grow_inbox_reads (user_id, contact_id, message_key) VALUES (?, ?, ?) ON CONFLICT(user_id, contact_id, message_key) DO NOTHING').bind(user.id, contact.id, key));
  if (statements.length) {
    statements.push(logCycleWriteStatement(env, { projectId: project, userId: user.id, cycle: 'grow', module: 'distribution', entityId: contact.uid, action: 'distribution_inbox_read', summary: 'Read Distribution replies' }));
    // D1 batch is atomic. Stay within its statement limit without claiming a
    // partially marked thread was fully read.
    for (let i = 0; i < statements.length; i += 90) await env.DB.batch(statements.slice(i, i + 90));
  }
  return true;
}
