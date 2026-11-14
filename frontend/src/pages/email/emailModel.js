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
import { costLine } from '../../ui/askPanelModel.js';

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

/**
 * #4660 (finding 4): the one person-reference contract between a record's
 * Email action and `RecordEmailSheet`. A person ref is the string
 * `personOfRecord` returns (`kind:id`, e.g. `interviewee:11`); `EmailAction`,
 * `emailHref` and the Sheet all take that string, never an object. This says
 * whether a value is one, so the Sheet never asks the Worker about
 * `undefined`.
 */
export function isPersonRef(value) {
  return typeof value === 'string' && /^[a-z][a-z_]{0,30}:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
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

/** The live update blocks a draft may carry (D1344), as chips. */
export const BLOCKS = Object.freeze([
  { value: 'kpis', label: 'KPIs' }, { value: 'raise_status', label: 'Raise status' }, { value: 'project_progress', label: 'Project progress' },
  { value: 'interview_insights', label: 'Interview insights' }, { value: 'one_liner', label: 'Company one-liner' },
]);
export const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
/** A body's words, whitespace folded: what "unchanged" and "blank" compare. */
export const bodyText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * #4017 (IV-D3): the record Sheet's cost line before a draft, D1442's words
 * ("Holds up to $X · you pay what it uses"). Until the estimate answers it
 * says so, never "$0.00".
 */
export function draftHoldLine(estimate) {
  const n = Number(estimate?.hold_microusd);
  if (estimate?.hold_microusd == null || !Number.isFinite(n) || n <= 0) return null;
  return costLine(n);
}
export const HOLD_READING = 'Reading what this draft holds…';
/** D4666: a revision's own hold, in the words of the button it belongs to. */
export function reviseHoldLine(label, estimate) {
  const hold = aiTokens(estimate?.hold_microusd);
  return hold ? `${label} · holds up to ${hold} in AI tokens. Nothing is charged until you press ${label}.` : null;
}

/** The field trigger shows on a blank Body only, and never for a reader (#4017). */
export const showBodyTrigger = ({ body, readOnly = false, open = false } = {}) => !readOnly && !open && bodyText(body) === '';

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
  fund_gp: 'LP commitment', work_product: 'Delivery',
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
 * person they have a draft for, newest first. The page draws the profile's
 * own groups from `GET /api/mail/people` since D4664 (`peoplePane`); this
 * stays as the founder's draft-and-share projection.
 */
export function founderPeople({ drafts = [], shares = [] } = {}) {
  const groups = [];
  const recent = recentDrafts(drafts);
  if (recent) groups.push(recent);
  const matches = shares.map((s) => ({ ref: s.person, name: s.name, source: `Network · accepted ${day(s.matched_at) ?? 'on a day not recorded'}`, last: day(s.matched_at), share: s }));
  if (matches.length) groups.push({ key: 'network', label: 'Network matches', people: matches, empty: null, error: null });
  return groups;
}

/** "Your drafts": one row per record person the member has a draft for, newest first; null when there is none. A Network match is never here. */
export function recentDrafts(drafts = []) {
  const seen = new Set();
  const recent = [];
  for (const d of Array.isArray(drafts) ? drafts : []) {
    const ref = d?.person;
    if (!ref || seen.has(ref) || ref.startsWith('member:')) continue;
    seen.add(ref);
    recent.push({ ref, name: draftName(d), source: `From ${MODULE_OF_KIND[ref.split(':')[0]] ?? 'a record'}`, last: day(d.created_at) });
  }
  return recent.length ? { key: 'recent', label: 'Your drafts', people: recent, empty: null, error: null } : null;
}

/**
 * D4664 (#4664, finding 8): each profile's "No people yet", in its own words
 * and with a door that profile can open. Only a founder is sent to Customer
 * research; an explorer, who has no module of their own, gets no door.
 */
const NO_PEOPLE = Object.freeze({
  founder: { line: 'People appear here as you record interviews, add investors to your pipeline or accept Network matches.', action: 'Open Customer research', href: '/validate/customer-research' },
  investor: { line: 'People appear here from your deal flow, your portfolio, your co-investors and your Network matches.', action: 'Open Network', href: '/network' },
  advisor: { line: 'People appear here from your client sessions, your cohort founders and your Network matches.', action: 'Open your clients', href: '/advisor/advisory/clients' },
  partner: { line: 'People appear here from your engagements, your leads and your Network matches.', action: 'Open Network', href: '/network' },
  admin: { line: 'People appear here once you hold a case: an application you scheduled or decided, or a support ticket assigned to you.', action: 'Open Spin-Out Lab applications', href: '/admin/programs/spinout-lab/applications' },
  explorer: { line: 'Your Network matches appear here once you and another member both accept an introduction.', action: null, href: null },
});

/** The "No people yet" card for a profile: `{ title, line, action, href }`. An unknown profile gets no door. */
export function noPeopleState(profile) {
  const own = NO_PEOPLE[profile] ?? { line: 'People appear here as you work with them.', action: null, href: null };
  return { title: 'No people yet', ...own };
}

/** One server row (`GET /api/mail/people`) as the pane draws it: the source, the last contact day and the derived marker, as returned. */
function paneRow(p) {
  return { ref: p.ref, name: p.name, role: p.role ?? null, source: p.source, last: day(p.last_contact), marker: p.marker_label ?? null };
}

/**
 * D4664 (#4664, finding 8): the People pane from the profile's own read.
 * `people` is `{ status: 'reading' | 'ready' | 'unreadable', data }`, `data`
 * being `GET /api/mail/people`'s body. The member's recent drafts lead, as a
 * section of their own; they never stand in for the profile's read.
 *
 *   · each server group keeps its own state: rows, its own `empty` line, or
 *     its own `error`. A failed group never erases a healthy one, and is
 *     never drawn as empty;
 *   · `none` is true only when the read answered, no group failed and no
 *     group (nor the drafts) has anyone: the one time "No people yet" is true.
 */
export function peoplePane({ drafts = [], people = { status: 'reading', data: null } } = {}) {
  const recent = recentDrafts(drafts);
  const ready = people?.status === 'ready';
  const server = ready && Array.isArray(people.data?.groups) ? people.data.groups : [];
  const groups = server.map((g) => ({
    key: g.key, label: g.label,
    people: g.error ? [] : (Array.isArray(g.people) ? g.people : []).map(paneRow),
    empty: g.error ? null : (g.empty ?? null),
    error: g.error ? String(g.error) : null,
  }));
  return {
    status: people?.status ?? 'reading',
    profile: ready ? (people.data?.profile ?? null) : null,
    note: ready ? (people.data?.note ?? null) : null,
    prompt: ready ? (people.data?.empty ?? null) : null,
    groups: recent ? [recent, ...groups] : groups,
    none: ready && !recent && groups.every((g) => !g.error && g.people.length === 0),
  };
}

/**
 * D4664 (#4664, finding 10): what the page may say about one Network match's
 * sharing. `read` is the shares read, `{ status: 'reading' | 'ready' |
 * 'unreadable', items }`. Only a read that answered decides anything: while
 * it reads, or after it failed, the state is unknown. Then there is no
 * address and no composer, and never "they have not shared".
 */
export function shareStatus(read, personRef) {
  if (read?.status === 'unreadable') return { known: false, state: 'unreadable', share: null };
  if (read?.status !== 'ready') return { known: false, state: 'reading', share: null };
  const share = (Array.isArray(read.items) ? read.items : []).find((s) => s.person === personRef) ?? null;
  if (!share) return { known: true, state: 'none', share: null };
  if (share.ready) return { known: true, state: 'ready', share };
  if (share.mine === 'shared') return { known: true, state: 'waiting', share };
  return { known: true, state: 'matched', share };
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

/**
 * #4660 (part 3): the versions of the draft chain a stored draft belongs to, to
 * reopen it in the composer: its ancestors by `parent_uid` (oldest first), the
 * draft itself, then the latest revision of each step after it. `at` is the
 * index of the draft that was opened. A draft whose parent is not in the list
 * simply starts the chain; nothing is invented. Null when the uid is not in the
 * list.
 */
export function draftChain(drafts, uid) {
  const list = Array.isArray(drafts) ? drafts : [];
  const byUid = new Map(list.map((d) => [d.uid, d]));
  const chosen = byUid.get(uid);
  if (!chosen) return null;
  const before = [];
  const seen = new Set([chosen.uid]);
  for (let d = byUid.get(chosen.parent_uid); d && !seen.has(d.uid); d = byUid.get(d.parent_uid)) { before.unshift(d); seen.add(d.uid); }
  const after = [];
  for (let tip = chosen; ;) {
    const kids = list.filter((d) => d.parent_uid === tip.uid && !seen.has(d.uid));
    if (!kids.length) break;
    const next = kids.reduce((a, b) => (String(b.created_at ?? '') >= String(a.created_at ?? '') ? b : a));
    after.push(next); seen.add(next.uid); tip = next;
  }
  return { versions: [...before, chosen, ...after], at: before.length };
}

/** A stored draft as the conversation shows it: the member's own text when they saved one, else what Eadwyn wrote. */
export function draftRowText(d) {
  const e = d?.edit ?? null;
  return { subject: e ? e.subject : (d?.subject ?? ''), body: e ? e.body : (d?.body ?? ''), edited: !!e };
}

/** D4662 / D4665: history preserves the provider outcome; an unconfirmed delivery is never labelled sent or failed. */
export function sentLine(row) {
  if (row.status === 'uncertain') return 'Delivery is unconfirmed. Check your mailbox before sending again.';
  if (row.status === 'pending') return 'Sending. The mail server has not answered yet.';
  if (row.status === 'failed') return `Not sent: ${row.error || 'the mail server refused it.'}`;
  return quotedLine(row);
}
