/**
 * D1344 (#3552, part 5 of #3547) — the Email page's pure model, to the
 * owner's "Email" canvas (`design/incoming/Email Page.dc.html`, EM1–EM10) and
 * D1347 §3's two changes: there is no "Save to Gmail drafts" (Save keeps the
 * draft in Axal), and EM5's first card reads "You're matched".
 *
 * No React and no request here, so every rule the page draws by is testable:
 *   · which records have a person, so the Email action shows only there (EM4);
 *   · the address a draft goes to: the person's own module row, or a Network
 *     match's only from `GET /api/mail/shares` once both have shared (D1342);
 *   · the estimate shown before every draft (EM3a), never a charge before Draft;
 *   · each state's words (EM8).
 */
import { INTENTS, LENGTHS, TONES } from '../../../../cloudflare-worker/src/services/mail/intents.ts';

export { INTENTS, LENGTHS, TONES };

/**
 * A cycle record's person ref (`kind:id`), by module: the records the Email
 * action is on. A module with no person (a KPI, a milestone) has none, so no
 * action. Advisors and operating partners open from their own pages.
 */
// A Map, not an object: the key comes from the address, and a Map has no inherited keys
// (`constructor`, `toString`) for an address to reach.
const RECORD_PEOPLE = new Map([
  ['validate/customer-research', { kind: 'interviewee', id: /^[1-9][0-9]{0,9}$/ }],
  ['raise/capital-relationships', { kind: 'prospect', id: /^[1-9][0-9]{0,9}$/ }],
  ['build/founding-team', { kind: 'cofounder', id: /^h-[1-9][0-9]{0,9}$/ }],
  ['grow/partner-network', { kind: 'growth_partner', id: /^[a-z0-9][a-z0-9_-]{0,63}$/ }],
]);

/** The person ref of a cycle record, or null when the record has no person. */
export function personOfRecord(cycle, slug, recordId) {
  const spec = RECORD_PEOPLE.get(`${cycle}/${slug}`);
  if (!spec || recordId == null || recordId === '') return null;
  const id = String(recordId);
  return spec.id.test(id) ? `${spec.kind}:${id}` : null;
}

/** `/email` opened on one person, from a record (EM4b): the person and where the composer was opened from. */
export function emailHref(ref, from = null) {
  const q = new URLSearchParams({ person: ref, compose: '1' });
  if (from) q.set('from', from);
  return `/email?${q.toString()}`;
}

/** EM1's cards, in the canvas's words. Gmail sends only (D1347 Q1, option A); no "Save to Gmail drafts" (§3). */
export const PROVIDERS = Object.freeze([
  { key: 'gmail', name: 'Gmail', can: 'Sends mail you approve.', cannot: 'Does not read your inbox. Replies stay in Gmail.', how: 'Sign in with Google' },
  { key: 'outlook', name: 'Outlook / Microsoft 365', can: 'Sends mail you approve and shows replies from the people you write to here.', cannot: 'Reads only those conversations.', how: 'Sign in with Microsoft' },
  { key: 'imap', name: 'Other mailbox', can: 'Sends mail you approve and shows replies from those people.', cannot: 'Uses an app password over IMAP and SMTP, never your main password.', how: 'IMAP and SMTP' },
  { key: 'mcp', name: 'My own MCP mail server', can: 'Sends through a mail server you run.', cannot: 'You decide what it exposes.', how: 'A custom connector with a send tool' },
]);

/** The cards to draw: each provider the Worker offers (`GET /api/mail/accounts`' `providers`); one it does not offer is absent. */
export function offeredProviders(providers = {}) {
  return PROVIDERS.filter((p) => providers?.[p.key] === true);
}

const PROVIDER_NAME = { gmail: 'Gmail', outlook: 'Outlook', imap: 'Other mailbox', mcp: 'MCP mail server' };

/** "Gmail · me@x · sends only": a mailbox's chip and settings line. */
export function mailboxLine(account) {
  if (!account) return null;
  const reach = account.can_read ? 'sends and shows replies' : 'sends only';
  return `${PROVIDER_NAME[account.provider] ?? 'Mailbox'} · ${account.address} · ${reach}`;
}

/** The mailbox a draft sends from: the first active one. An expired one is a state of its own (EM8). */
export function sendingAccount(accounts = []) {
  return accounts.find((a) => a.status === 'active') ?? null;
}

/**
 * Where a draft goes. A Network match's address comes only from its share,
 * and only when both have shared (D1342); every other person's is their own
 * module row's (`person.address`). Null when there is none: the composer then
 * asks for it, never guesses it.
 */
export function recipientFor(person, shares = []) {
  if (!person) return null;
  if (person.kind === 'member') {
    const uid = String(person.ref || '').slice('member:'.length);
    const s = shares.find((x) => x.uid === uid);
    return s && s.ready && s.address ? s.address : null;
  }
  return typeof person.address === 'string' && person.address ? person.address : null;
}

/** AI tokens as dollars ($1 of tokens buys $1 of AI use): `$0.0060` under a dollar. Null with no figure, never $0. */
export function aiTokens(micro) {
  if (micro == null || !Number.isFinite(Number(micro))) return null;
  const usd = Number(micro) / 1_000_000;
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

/**
 * EM3a's estimate line, shown before every draft. Without an estimate the
 * Draft button is not offered: "Nothing is charged until you press Draft."
 */
export function estimateLine(estimate) {
  const hold = aiTokens(estimate?.hold_microusd);
  if (!hold) return null;
  return `Draft with Eadwyn · holds up to ${hold} in AI tokens. Nothing is charged until you press Draft.`;
}

/** The Draft button is pressable only once its estimate is on screen, and the intent is chosen. */
export function canDraft({ estimate, intent, busy = false } = {}) {
  return !busy && !!estimateLine(estimate) && !!intent;
}

/** EM8's states, in the canvas's words; `name` is the person's, `provider` the mailbox's. */
export function stateFor(kind, { name = 'This person', provider = 'Gmail', module = 'their record', sentence = null } = {}) {
  switch (kind) {
    case 'no_mailbox': return { title: 'No mailbox connected', line: 'Connect Gmail, Outlook or another mailbox to send from your own address.', action: 'Connect a mailbox' };
    case 'expired': return { title: `${provider} connection expired`, line: sentence || `${provider} ended the connection. Nothing was sent since then.`, action: `Reconnect ${provider}` };
    case 'no_tokens': return { title: 'Not enough AI tokens', line: sentence || 'This draft needs more AI tokens than your balance holds.', action: 'Top up' };
    case 'send_failed': return { title: 'Send failed', line: sentence || 'The mail server refused it. Nothing was sent.', action: 'Try again' };
    case 'no_address': return { title: 'No email address on record', line: `${name} has no address in ${module}.`, action: 'Add their email' };
    case 'not_shared': return { title: 'Address not shared yet', line: `${name} hasn’t shared their address. You can email them once they do.`, action: 'Open in Network' };
    case 'no_people': return { title: 'No people yet', line: 'People appear here as you record interviews, add investors to your pipeline or accept Network matches.', action: 'Open Customer research' };
    default: return null;
  }
}

/** The module a person's address would be recorded in, for "No email address on record". */
export const MODULE_OF_KIND = Object.freeze({
  interviewee: 'Customer research', prospect: 'Capital relationships', cofounder: 'Founding team', growth_partner: 'Partner network',
  advisor: 'Advisors', partner: 'Operating partners', member: 'Network',
});

/** EM5's Network cards, D1347 §3's first card included ("You're matched"). */
export function networkCard(share) {
  if (!share) return null;
  if (share.ready) return { eyebrow: 'Network · ready', title: `Email ${share.name}`, line: 'You both shared an address. The composer opens with “Introduce myself”.', action: `Email ${share.name}` };
  if (share.mine === 'shared') return { eyebrow: 'Network · waiting', title: `Waiting for ${share.name}`, line: 'You shared your address. Email opens when they share theirs. They are told once.', action: null };
  return { eyebrow: 'Network · match', title: `You and ${share.name} both accepted`, line: share.line, action: 'Share your email address' };
}

/**
 * The People pane for a founder (D1344): their Network matches, and every
 * person they have a draft for, newest first. The other profiles' groups are
 * the Worker's (`GET /api/mail/people`, D1348) once it lands.
 */
export function founderPeople({ drafts = [], shares = [] } = {}) {
  const seen = new Set();
  const recent = [];
  for (const d of drafts) {
    const ref = d?.person;
    if (!ref || seen.has(ref) || ref.startsWith('member:')) continue;
    seen.add(ref);
    recent.push({ ref, name: draftName(d), source: `From ${MODULE_OF_KIND[ref.split(':')[0]] ?? 'a record'}`, last: day(d.created_at) });
  }
  const matches = shares.map((s) => ({ ref: s.person, name: s.name, source: `Network · accepted ${day(s.matched_at) ?? 'on a day not recorded'}`, last: day(s.matched_at), share: s }));
  const groups = [];
  if (recent.length) groups.push({ key: 'recent', label: 'Your drafts', people: recent });
  if (matches.length) groups.push({ key: 'network', label: 'Network matches', people: matches });
  return groups;
}

/** A draft's person, by name: its own record's label ("Customer research · Ada" → "Ada"), else the ref itself. */
export function draftName(d) {
  const own = (Array.isArray(d?.sources) ? d.sources : []).find((x) => x?.ref === d?.person);
  const label = typeof own?.label === 'string' ? own.label : '';
  const name = label.includes(' · ') ? label.slice(label.indexOf(' · ') + 3).trim() : label.trim();
  return name || d?.person || 'A person';
}

export function day(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** EM7's sent log page label: "1–20 of 23"; null when the count is not known. */
export function pageLabel(page, perPage, total) {
  if (!Number.isFinite(total)) return null;
  if (total === 0) return '0 sent';
  const from = (page - 1) * perPage + 1;
  return `${from}–${Math.min(total, page * perPage)} of ${total}`;
}

/** A sent row's quoted line: "Quoted: a, b", or "Quoted: nothing" — never blank. */
export function quotedLine(row) {
  const q = Array.isArray(row?.quoted) ? row.quoted : [];
  return `Quoted: ${q.length ? q.join(', ') : 'nothing'}`;
}
