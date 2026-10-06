/**
 * The Ops canvas's practice tools (D571), as derivations apart from the pages.
 *
 * `design/incoming/Ops Page.dc.html` draws five advisor screens: deliverables
 * per client (A1), session types (A2), booking links (A3), the client data
 * access log (A4) and the profile a client sees (A5). The first four live in
 * the Practice zones that already hold their stores, so this module serves
 * `DeliveryZone`, `SessionsZone` and `EngagementsZone`, plus the profile page.
 * Pure, and imports nothing, for the reason `README.md` gives: a guard can
 * import a module and not a page.
 *
 * WHAT THE STORES CANNOT SAY, which every function here is written around:
 *   · a work product has no due date and no status column. Its state is
 *     derived from what was sent and opened (migration 239), so Planned and
 *     In progress are one state, and Accepted needs a sign-off nothing writes;
 *   · a session type has no "included" column. Included is a price of zero,
 *     the only no-charge value the store holds besides a free intro;
 *   · a booking does not record the session type or the link it came through,
 *     so neither has a booking count;
 *   · a booking link cannot be switched on or off by any route, and no page
 *     opens one by its address;
 *   · the access log is read by the client company that owns the record, not
 *     by the advisor who opened it.
 */

// ───────────────────────────── A1 · Deliverables ─────────────────────────────

/**
 * The canvas's status flow, as the store can say it.
 *
 * The canvas draws Planned → In progress → Delivered → Accepted. The store
 * derives `not_started` | `sent` | `opened` from two stamps, and carries a
 * `signed_off_at` that no route writes. So the four canvas steps land on four
 * store states, but not one to one: `canvas` names which drawn steps each
 * stands for.
 */
export const DELIVERABLE_FLOW = Object.freeze([
  { key: 'not_started', label: 'Not started', canvas: ['Planned', 'In progress'] },
  { key: 'sent', label: 'Sent', canvas: ['Delivered'] },
  { key: 'opened', label: 'Opened', canvas: [] },
  { key: 'accepted', label: 'Accepted', canvas: ['Accepted'] },
]);

/** Where one work product sits on that flow, or null for a state the route never sends. */
export function deliverableStep(item) {
  // The latest version's sign-off, not any version's: a newer version sent
  // after an old one was signed off has not itself been accepted.
  if (item?.latest_version?.signed_off_at) return 'accepted';
  return ['not_started', 'sent', 'opened'].includes(item?.state) ? item.state : null;
}

/**
 * Work products grouped by client, client names in order, rows in the order
 * the route sent them (newest first).
 *
 * Grouped on the exact name, as the route's own `clients` total counts them,
 * so the group count and the tile beside it cannot disagree. A blank name is
 * its own group, last.
 */
export function groupByClient(items) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    const client = String(item.client_name ?? '').trim();
    if (!groups.has(client)) groups.set(client, []);
    groups.get(client).push(item);
  }
  return [...groups.entries()]
    .map(([client, rows]) => ({ client, rows }))
    .sort((a, b) => (a.client === '') - (b.client === '') || a.client.localeCompare(b.client));
}

/** A web address, or null. Anything else typed into a link field is never an href. */
export function safeHref(url) {
  const s = String(url ?? '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

/** A link's host, for a cell too narrow for the whole address. */
export function linkHost(url) {
  try { return new URL(url).host || null; } catch { return null; }
}

/**
 * The attachment the canvas draws: the newest version that carries a link.
 *
 * A link travels with a version (migration 239), and a version is never
 * edited after it is recorded, so the attachment of a work product is the
 * newest version's link where it has one, and an older version's otherwise.
 */
export function attachmentOf(item) {
  const versions = (Array.isArray(item?.versions) ? item.versions : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
  const v = versions.find((x) => typeof x.link_url === 'string' && x.link_url.trim());
  return v ? { url: v.link_url.trim(), version: v } : null;
}

/**
 * The PATCH body for an edit, or the reason it cannot be sent.
 *
 * TWO THINGS THE ROUTE DOES QUIETLY, said here instead. A blank title is
 * swapped back for the stored one without a word (`|| row.title`), so a blank
 * title is refused before it is sent. And a client name typed beside an
 * engagement is dropped, because the engagement names the client.
 *
 * `confirm` is true when a SENT work product would change engagement. The
 * client's received list is read through the engagement, so moving one takes
 * it off one client's list and puts it on another's.
 */
export function deliverableEdit(item, draft) {
  const title = String(draft?.title ?? '').trim();
  if (!title) return { error: 'A work product needs a title.' };
  if (title.length > 200) return { error: 'A title is at most 200 characters.' };
  const raw = draft?.engagement_id;
  const engagement = raw === '' || raw == null ? null : Number(raw);
  if (engagement != null && !Number.isInteger(engagement)) return { error: 'Pick an engagement from the list.' };
  const current = item?.engagement_id ?? null;
  const body = { title };
  if (engagement !== current) body.engagement_id = engagement;
  if (engagement == null) {
    const client = String(draft?.client_name ?? '').trim();
    if (!client) return { error: 'Name the client, or pick the engagement it belongs to.' };
    if (client.length > 200) return { error: 'A client name is at most 200 characters.' };
    if (client !== item?.client_name) body.client_name = client;
  }
  const sent = item?.state === 'sent' || item?.state === 'opened';
  return { body, confirm: sent && engagement !== current };
}

/** The body for a link attached as the next version, or the reason it cannot be. */
export function attachmentBody(draft) {
  const link = String(draft?.link_url ?? '').trim();
  if (!safeHref(link)) return { error: 'Enter a web address that starts with https://' };
  if (link.length > 2000) return { error: 'A link is at most 2,000 characters.' };
  const summary = String(draft?.summary ?? '').trim();
  return { body: { link_url: link, summary: summary || null } };
}

// ───────────────────────────── A2 · Session types ─────────────────────────────

/**
 * How a stored type is priced: `price` | `included` | `free` | `unset`.
 *
 * FOUR, NOT TWO. Migration 240 keeps "unpriced" (NULL) apart from "free"
 * (`is_free_intro`), and the canvas adds "included" — no separate charge.
 * The store has no column for that, so it is a price of zero, which is the
 * only other no-charge value it can hold. A null is never read as zero.
 */
export function priceMode(type) {
  if (type?.is_free_intro) return 'free';
  const c = type?.price_cents;
  if (c == null || c === '') return 'unset';
  const n = Number(c);
  if (!Number.isFinite(n)) return 'unset';
  return n === 0 ? 'included' : 'price';
}

/** The canvas's rule: a type cannot be bookable until a price or "included" is set. */
export const canBeBookable = (type) => priceMode(type) !== 'unset';

/**
 * `bookable` | `off` | `unpriced_on`. The third is a stored contradiction: a
 * type the create route switched on (it always does) before anyone priced it.
 * It is shown as one rather than hidden, and the only move offered is off.
 */
export function bookableState(type) {
  if (!type?.is_active) return 'off';
  return canBeBookable(type) ? 'bookable' : 'unpriced_on';
}

export const PRICE_MODES = Object.freeze([
  { key: 'price', label: 'A price' },
  { key: 'included', label: 'Included', hint: 'No separate charge' },
  { key: 'free', label: 'Free intro' },
  { key: 'unset', label: 'Not set yet' },
]);

/** Typed dollars into whole cents: the same rule as `dollarsToCents` in `../expertise/kit`. */
export function parseAmount(input) {
  const raw = String(input ?? '').trim().replace(/[$,\s]/g, '');
  if (!raw) return { cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: 'Enter an amount like 150 or 150.50' };
  return { cents: Math.round(Number(raw) * 100) };
}

/** The editor's starting values for a stored type, or for a new one. */
export function sessionTypeForm(type) {
  const mode = type ? priceMode(type) : 'unset';
  return {
    name: type?.name || '',
    duration: type?.duration_minutes == null ? '' : String(type.duration_minutes),
    mode,
    amount: mode === 'price' ? String(Number(type.price_cents) / 100) : '',
    bookable: Boolean(type?.is_active),
    note: type?.cadence_note || '',
  };
}

/**
 * The body a save sends, or the reason it cannot be sent.
 *
 * `is_active` is the bookable switch. The create route ignores it and always
 * stores a new type switched on, so the page follows a create with a second
 * write when the type should be off; the update route takes it as sent.
 */
export function sessionTypeBody(form) {
  const name = String(form?.name ?? '').trim();
  if (!name) return { error: 'A session type needs a name.' };
  if (name.length > 200) return { error: 'A name is at most 200 characters.' };
  const length = String(form?.duration ?? '').trim();
  let duration = null;
  if (length) {
    if (!/^\d+$/.test(length) || Number(length) < 1 || Number(length) > 1440) {
      return { error: 'Length is whole minutes, from 1 to 1440.' };
    }
    duration = Number(length);
  }
  const mode = form?.mode;
  let price = null;
  let free = false;
  if (mode === 'price') {
    const parsed = parseAmount(form?.amount);
    if (parsed.error) return { error: parsed.error };
    if (parsed.cents == null || parsed.cents <= 0) return { error: 'Enter the price, or choose Included.' };
    price = parsed.cents;
  } else if (mode === 'included') {
    price = 0;
  } else if (mode === 'free') {
    free = true;
  } else if (mode !== 'unset') {
    return { error: 'Choose how this type is priced.' };
  }
  const bookable = Boolean(form?.bookable);
  if (bookable && mode === 'unset') {
    return { error: 'A type with no price cannot be bookable. Set a price or mark it included first.' };
  }
  const note = String(form?.note ?? '').trim();
  if (note.length > 200) return { error: 'The line under the name is at most 200 characters.' };
  return {
    body: {
      name, duration_minutes: duration, cadence_note: note || null,
      price_cents: price, is_free_intro: free, is_active: bookable,
    },
  };
}

// ───────────────────────────── A3 · Booking links ─────────────────────────────

/** The Worker's own slug rule (`routes/advisors.ts`), checked before the round trip. */
export const LINK_SLUG = /^[a-z0-9][a-z0-9/-]{1,98}[a-z0-9]$/;
export const LINK_AUDIENCES = Object.freeze(['public', 'cohort', 'private']);
export const AUDIENCE_LABEL = Object.freeze({
  public: 'Public, on your profile',
  cohort: 'One cohort only',
  private: 'Unlisted: the link is the only way in',
});

/** The address as it is shown. Migration 240: "the path segment after /b/". */
export const bookingLinkAddress = (slug) => `axal.vc/b/${slug}`;
/** The address as it is copied. */
export const bookingLinkUrl = (slug) => `https://axal.vc/b/${slug}`;

/** A slug offered from a type's name, which the advisor edits before saving. */
export function suggestSlug(name) {
  return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

/** The create body, or the reason it cannot be sent. */
export function linkBody(form) {
  const slug = String(form?.slug ?? '').trim();
  if (!LINK_SLUG.test(slug)) {
    return { error: 'Use lowercase letters, digits, hyphens and slashes: three characters or more, starting and ending with a letter or digit.' };
  }
  const audience = form?.audience || 'public';
  if (!LINK_AUDIENCES.includes(audience)) return { error: 'Choose who the link is for.' };
  const cohort = String(form?.cohort_ref ?? '').trim();
  if (audience === 'cohort' && !cohort) return { error: 'A cohort link needs the cohort it admits.' };
  if (cohort.length > 100) return { error: 'A cohort name is at most 100 characters.' };
  const raw = form?.session_type_id;
  const note = String(form?.note ?? '').trim();
  if (note.length > 300) return { error: 'A note is at most 300 characters.' };
  return {
    body: {
      slug,
      session_type_id: raw === '' || raw == null ? null : Number(raw),
      audience,
      cohort_ref: audience === 'cohort' ? cohort : null,
      requires_payout_account: Boolean(form?.requires_payout_account),
      note: note || null,
    },
  };
}

/**
 * Each session type with the links that sell it, in the types' order, then
 * the links whose type is unset or unknown under `type: null`.
 *
 * One link per type is the canvas's shape and not a rule the store keeps:
 * two links may name one type, and both are listed rather than one dropped.
 */
export function linksByType(types, links) {
  const list = Array.isArray(links) ? links.filter(Boolean) : [];
  const known = new Set();
  const out = (Array.isArray(types) ? types : []).filter(Boolean).map((type) => {
    known.add(type.id);
    return { type, links: list.filter((l) => l.session_type_id === type.id) };
  });
  const loose = list.filter((l) => l.session_type_id == null || !known.has(l.session_type_id));
  if (loose.length) out.push({ type: null, links: loose });
  return out;
}

// ───────────────────────────── A4 · Client data access log ─────────────────────────────

/** What the log's `action` column holds (migration 218): two opens, and no other verb. */
export const ACCESS_ACTION_LABEL = Object.freeze({ open_brief: 'Opened', open_document: 'Opened' });

/**
 * A SQLite stamp as an instant. `CURRENT_TIMESTAMP` writes `2026-10-06 09:41:00`
 * in UTC with no zone marker, and `Date.parse` reads that shape as LOCAL time,
 * which would move every row by the reader's offset.
 */
export function stampMs(value) {
  if (!value) return null;
  let s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** "Oct 6 · 09:41", in the reader's own time, or null. */
export function stampLabel(value) {
  const t = stampMs(value);
  if (t == null) return null;
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

/** The record a row names, or null with the reason the name is missing. */
export function accessRecord(row) {
  if (row?.action === 'open_brief') return { label: 'Client brief', missing: null };
  if (row?.action === 'open_document') {
    return row.document_title
      ? { label: row.document_title, missing: null }
      : { label: null, missing: 'the document was deleted after it was opened' };
  }
  return { label: null, missing: 'the log names no record for this action' };
}

/** Who opened it: the advisor's name, else their address. */
export const accessWho = (row) => row?.advisor_name || row?.advisor_email || null;

/** A `YYYY-MM-DD` day as the reader's own midnight, or null. */
function dayStartMs(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/**
 * The rows a filter keeps: by client, by who, and between two days inclusive.
 *
 * A row whose stamp cannot be read is kept while no day is set and dropped
 * once one is, because it cannot be placed inside a window.
 */
export function filterAccessRows(rows, { client = '', who = '', from = '', to = '' } = {}) {
  const fromMs = dayStartMs(from);
  const toStart = dayStartMs(to);
  const toMs = toStart == null ? null : toStart + 86_400_000 - 1;
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false;
    if (client && r.client !== client) return false;
    if (who && accessWho(r) !== who) return false;
    if (fromMs == null && toMs == null) return true;
    const t = stampMs(r.created_at);
    if (t == null) return false;
    return (fromMs == null || t >= fromMs) && (toMs == null || t <= toMs);
  });
}

/** The distinct values a filter offers, in order. */
export function distinctOf(rows, pick) {
  return [...new Set((Array.isArray(rows) ? rows : []).map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// ───────────────────────────── A5 · The profile a client sees ─────────────────────────────

/** "[positioning] · [sector], [sector] · [country]", from what the advisor wrote. */
export function profileSub(advisor) {
  const sectors = Array.isArray(advisor?.sectors) ? advisor.sectors.filter(Boolean) : [];
  return [advisor?.headline, sectors.join(', '), advisor?.country]
    .map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
}

/** Two letters for the avatar circle. */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** The year the profile was created here, or null. */
export function sinceYear(advisor) {
  const t = stampMs(advisor?.created_at);
  return t == null ? null : new Date(t).getUTCFullYear();
}
