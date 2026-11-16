/**
 * Practice · Delivery — the derivations, apart from the page that draws them.
 *
 * WHY A SEPARATE MODULE, the same reason as `opportunityLog.js` and
 * `engagementBoard.js`: importing the page pulls React and a `.css` through its
 * component tree, which the test loader cannot resolve. Everything here is pure
 * and imports nothing.
 *
 * THE ONE THING THIS MODULE DOES DIFFERENTLY FROM `engagementBoard.js`, and it
 * is a real distinction rather than an inconsistency. That module formats stored
 * CALENDAR DAYS — a term end an advisor typed as `2026-11-04` — and parses them
 * out of the string on purpose, because `new Date('2026-11-04')` is midnight UTC
 * and would render "Nov 3" for every reader west of Greenwich. The stamps here
 * are INSTANTS: `sent_at` and `opened_at` are written by `nowIso()` at the
 * moment something happened. An instant genuinely has a local day, and the
 * reader's is the right one, so these go through the browser's own formatter.
 * Using the string-slice approach here would report the UTC day to someone who
 * sent a deliverable at 11pm local and is being told it went out tomorrow.
 *
 * Its one import is `formatBytes`, from the Learning video upload's pure module
 * (no React, no client), for a stored file's size (#5961).
 */
import { formatBytes } from '../../learning/videoUpload.js';

/** `not_started` | `sent` | `opened` — the three the endpoint derives. */
export const STATE_LABEL = {
  not_started: 'Not started',
  sent: 'Sent',
  opened: 'Opened',
};
/** `Not started` is the alarming one on this artboard — its row is red-tinted. */
export const STATE_TONE = {
  not_started: 'danger',
  sent: 'neutral',
  opened: 'ok',
};

/**
 * An instant as a short local day — "Aug 20".
 *
 * Returns null rather than "Invalid Date" for anything unparseable, so every
 * caller has to decide what an absent date says instead of printing a
 * placeholder that looks like a value.
 */
export function shortMoment(value) {
  if (!value) return null;
  const t = Date.parse(String(value));
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Whole days from an instant to now, or null. Negative clamps to 0. */
export function daysSince(value, nowMs) {
  if (!value) return null;
  const t = Date.parse(String(value));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86400000));
}

/**
 * The version chip on a row — "v4", or the advisor's own label where they wrote
 * one ("v2 draft", which is the artboard's).
 *
 * The NUMBER is the order and the LABEL is the name; migration 239's header
 * argues why they are separate columns. This renders the name and falls back to
 * the order, so a version always has something to be called.
 */
export function versionTag(version) {
  if (!version) return null;
  const label = String(version.label || '').trim();
  return label || `v${version.version}`;
}

/** "4 versions" / "1 version" — the count beside a row. */
export function versionCountLabel(n) {
  const count = Number(n || 0);
  return `${count} ${count === 1 ? 'version' : 'versions'}`;
}

/**
 * The right-hand line under the version count: when the latest version went out.
 *
 * "Not sent" is a real state here and the artboard's own red row — a work
 * product whose latest version has never been sent is a draft, not a delivery.
 */
export function sentLine(latest) {
  if (!latest) return 'No version recorded';
  const day = shortMoment(latest.sent_at);
  return day ? `Sent ${day}` : 'Not sent';
}

/**
 * The cyan seam line — what happened after it went out.
 *
 * THE ARTBOARD'S SHARPEST ROW IS THE UNREAD ONE ("Not opened in 4 days"), and
 * that is the whole reason this zone has an open receipt at all. So the seam
 * reports the wait in days when a sent version has not been read, the day it
 * was read when it has, and NOTHING for a draft — a work product that never
 * went out has no seam to report, and inventing one would put a reassuring line
 * under the row the advisor most needs to act on.
 */
export function seamLine(item, nowMs) {
  const latest = item?.latest_version;
  if (!latest || !latest.sent_at) return null;
  if (latest.opened_at) {
    const day = shortMoment(latest.opened_at);
    return day ? `Opened ${day}` : 'Opened';
  }
  const days = daysSince(latest.sent_at, nowMs);
  if (days == null) return 'Sent, not opened';
  if (days === 0) return 'Sent today, not opened yet';
  return `Not opened in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * The median, rendered.
 *
 * Hours under a day read as hours, above it as days, and NULL reads as nothing
 * at all — never "0 h", which would say a deliverable was opened the instant it
 * was sent (D56/D68). The endpoint returns null before the first open for
 * exactly that reason.
 */
export function medianLabel(hours) {
  if (hours == null) return null;
  const n = Number(hours);
  if (!Number.isFinite(n)) return null;
  if (n < 48) return `${Math.round(n)} h`;
  const days = n / 24;
  return `${days % 1 === 0 ? days : days.toFixed(1)} d`;
}

/**
 * WHICH ROWS A CHIP SHOWS IS NOT IN HERE, and the omission is deliberate. It
 * lived here for one draft, as a `visibleItems(items, filter)`, and
 * `profile_zone_filters.test.mjs` failed the page for it: a chip declared live
 * in `advisorZoneFilters.js` must be named by the page that mounts the chip row,
 * because a predicate one import away lets a chip be declared live over a page
 * that cannot serve it. `EngagementsZone` narrows in the page for the same
 * reason. So the split is: this module derives and formats, the page decides
 * what a chip shows — and `DeliveryZone.jsx` carries the argument about the
 * canvas's `Draft` chip where the code that resolves it lives.
 */

/**
 * Who a nudge would actually reach, and who it would miss.
 *
 * A bulk action over a mixed set that delivers to some rows and skips the rest
 * is worse than no button, so the page reports both halves before it sends
 * anything. `missed` is only ever non-empty for a work product whose engagement
 * was unlinked AFTER a send — the store refuses the send otherwise — which is
 * the one case the send rule cannot prevent and therefore the one the page has
 * to say out loud.
 */
export function nudgeTargets(items) {
  const unopened = (items || []).filter((i) => i.state === 'sent');
  return {
    reachable: unopened.filter((i) => i.client_user_email),
    missed: unopened.filter((i) => !i.client_user_email),
  };
}

/** The default nudge body, which the advisor can edit before it is sent. */
export function nudgeBody(item) {
  const tag = versionTag(item?.latest_version);
  const day = shortMoment(item?.latest_version?.sent_at);
  return `Following up on ${item?.title || 'the work product'}${tag ? ` (${tag})` : ''}`
    + `${day ? `, sent ${day}` : ''}. Let me know if you would like to talk it through.`;
}

/**
 * #4712 (D4712): review coverage of the held sessions, with a third answer.
 *
 * `reviews[id]` is an array when the session's reviews were read, and `null`
 * (or absent) when they could not be, or were never requested. An unread
 * session is UNKNOWN, never "No review": the page reporting "3 without a
 * review" over sessions it did not read would be claiming something it has not
 * looked at (D56/D68).
 */
export function reviewCoverage(sessions, reviews) {
  let reviewed = 0; let awaiting = 0; let unknown = 0;
  for (const b of sessions || []) {
    const rs = reviews?.[b.id];
    if (!Array.isArray(rs)) unknown += 1;
    else if (rs.length > 0) reviewed += 1;
    else awaiting += 1;
  }
  return { reviewed, awaiting, unknown };
}

// ───────────────────── #4833 (D4833) · Practice v2 Delivery ─────────────────────
//
// The Practice v2 canvas (`design/incoming/Practice v2 Page.dc.html`, PX-06,
// D4874) draws Delivery as cards whose state is the LATEST VERSION's, with a
// detail sheet that keeps every older version, its recipient and its receipts.
// Everything below reads stamps the store writes; nothing here stores a state.

/**
 * The states a version can be in, from its own stamps alone.
 *
 * `draft` is a version with no `sent_at`: recorded, never sent. `sent`,
 * `opened` and `accepted` are the recipient's receipts (`opened_at`,
 * `signed_off_at`), which only the client's routes write (D4684). `ready` is
 * an unsent version the advisor marked ready to send (`ready_at`, #5316,
 * D5316): still a draft to the client, who sees nothing until it is sent, and
 * the send clears the mark (#4833 part 2).
 */
export const VERSION_STATUS_LABEL = {
  draft: 'Draft',
  ready: 'Ready',
  sent: 'Sent',
  opened: 'Opened',
  accepted: 'Accepted',
};
export const VERSION_STATUS_TONE = {
  draft: 'warn',
  ready: 'info',
  sent: 'neutral',
  opened: 'ok',
  accepted: 'ok',
};

/** One version's status: draft, ready, sent, opened or accepted. Null for no version. */
export function versionStatus(version) {
  if (!version) return null;
  if (!version.sent_at) return version.ready_at ? 'ready' : 'draft';
  if (version.signed_off_at) return 'accepted';
  if (version.opened_at) return 'opened';
  return 'sent';
}

/**
 * A work product's card status: its LATEST version's.
 *
 * The endpoint's own `state` folds every version together (`opened` if any
 * version was ever opened), which is right for the receipt tiles and wrong for
 * a card: the canvas's "Pricing model v2" is a Draft whose v1 was opened, and
 * the thing the advisor has to act on is the unsent v2. A work product with no
 * version at all is a draft too.
 */
export function cardStatus(item) {
  return versionStatus(item?.latest_version) || 'draft';
}

/** The filter keys, in the canvas's order: Draft · Ready · Sent · Opened · Accepted · All. */
export const DELIVERY_FILTERS = ['draft', 'ready', 'sent', 'opened', 'accepted', 'all'];

/**
 * Whether a work product is waiting to be sent with a version marked ready:
 * the Worker's own `ready_version` (the highest UNSENT version marked ready,
 * D5316), which is what `totals.ready` counts. The Ready chip narrows on this,
 * so the chip's count and the cards under it are the same set.
 *
 * It is beside the card's status, not folded into it, as it is in the Worker:
 * the mark is set on the latest version from this page, so a Ready card is a
 * Ready pill, but a mark left on an older unsent version (set through the API
 * before a newer draft was added) keeps the card a Draft and still lists it
 * under Ready, where it says which version is marked.
 */
export function isReadyItem(item) {
  return item?.ready_version != null;
}

/**
 * How many cards each filter would show, for the chip counts.
 *
 * Ready's count is the Worker's `totals.ready`, over every work product, and
 * null when the read did not carry it: a missing count is drawn as a chip with
 * no number, never as 0 (D56/D68). The other counts are the cards' own.
 */
export function statusCounts(items, totals = null) {
  const counts = { draft: 0, ready: 0, sent: 0, opened: 0, accepted: 0, all: 0 };
  for (const item of items || []) {
    counts[cardStatus(item)] += 1;
    counts.all += 1;
  }
  const ready = totals?.ready;
  counts.ready = typeof ready === 'number' && Number.isFinite(ready) ? ready : null;
  return counts;
}

/**
 * Who marked a version ready to send, and when: `{ day, by }`, or null for a
 * version that is not marked. `by` is null when the account that marked it no
 * longer reads back, and the page says "Not recorded" for it rather than a
 * name; `day` is null for a stamp that cannot be read.
 */
export function readyMark(version) {
  if (!version?.ready_at || version.sent_at) return null;
  const by = String(version.ready_by_name || '').trim() || null;
  return { day: shortMoment(version.ready_at), by };
}

/** "Marked ready to send Nov 9 by Ada" — the day and the name when they read back. */
export function readyLine(version) {
  const mark = readyMark(version);
  if (!mark) return null;
  return `Marked ready to send ${mark.day || '(day unreadable)'}${mark.by ? ` by ${mark.by}` : ''}`;
}

/**
 * The Ready control on a work product's latest version, said with its
 * consequence before it is pressed. Null when there is nothing to mark: no
 * version, or a latest version already sent (the Worker refuses both a mark
 * and a clear on a sent version, 409 `already_sent`).
 *
 * A version with no document cannot be marked: ready means it could be sent
 * as it stands, and the Worker refuses it 422 `empty_version`. The control is
 * then disabled with the reason, rather than pressed into the refusal.
 */
export function readyAction(item) {
  const v = item?.latest_version;
  if (!v || v.sent_at) return null;
  const tag = `v${v.version}`;
  if (v.ready_at) {
    return {
      kind: 'clear', version: v.version, tag, label: 'Clear Ready', enabled: true,
      consequence: `${tag} goes back to Draft. Nothing is sent or deleted.`,
    };
  }
  const content = versionDocument(v) != null;
  return {
    kind: 'mark', version: v.version, tag, label: `Mark ${tag} ready`, enabled: content,
    consequence: content
      ? `Marks ${tag} ready to send. Nothing is sent: the client sees nothing until you send it, and sending clears the mark.`
      : `${tag} has no document, so it cannot be marked ready. Add a version with a file or a link first.`,
  };
}

/**
 * The sentence for a refused mark or clear. A 409 `already_sent` means the
 * version went out in the meantime (from another tab, or the by-client group),
 * so it is no longer waiting to be sent and the page reloads to show the send.
 */
export function readyRefusal(error, tag = 'This version') {
  if (error?.code === 'already_sent' || (error?.status === 409 && !error?.code)) {
    return `${tag} has already been sent, so it can’t be marked ready or cleared. The list below has been read again.`;
  }
  if (error?.code === 'empty_version') {
    return `${tag} has no document, so it cannot be marked ready. Add a version with a file or a link first.`;
  }
  return error?.message || 'The Ready mark could not be changed. Nothing was changed.';
}

/**
 * One version's receipt line, from its own stamps: "Sent Nov 6 to J. Park ·
 * opened Nov 6 · accepted Nov 7", or "Not sent".
 *
 * A historical version keeps ITS recipient and ITS receipts, never the latest
 * version's: each is read from the version row it belongs to.
 */
export function receiptLine(version) {
  if (!version) return 'No version recorded';
  if (!version.sent_at) return 'Not sent';
  const parts = [];
  const sent = shortMoment(version.sent_at);
  const to = version.recipient_name ? ` to ${version.recipient_name}` : '';
  parts.push(sent ? `Sent ${sent}${to}` : `Sent${to}`);
  if (version.opened_at) parts.push(`opened ${shortMoment(version.opened_at) || '(day unreadable)'}`);
  if (version.signed_off_at) parts.push(`accepted ${shortMoment(version.signed_off_at) || '(day unreadable)'}`);
  return parts.join(' · ');
}

/**
 * The receipt line under a card, from the latest version's stamps: "Opened
 * Nov 6 · Accepted Nov 7", the unread wait ("Not opened in 4 days"), or, for a
 * draft whose earlier version went out, that version's own last receipt
 * ("v1 opened Nov 3"). A draft with nothing ever sent says so.
 */
export function cardReceiptLine(item, nowMs) {
  const latest = item?.latest_version;
  if (!latest) return 'No version recorded yet';
  if (latest.sent_at) {
    const parts = [];
    if (latest.opened_at) parts.push(`Opened ${shortMoment(latest.opened_at) || '(day unreadable)'}`);
    if (latest.signed_off_at) parts.push(`Accepted ${shortMoment(latest.signed_off_at) || '(day unreadable)'}`);
    return parts.length ? parts.join(' · ') : seamLine(item, nowMs);
  }
  const earlier = (item.versions || []).find((v) => v.sent_at && Number(v.version) !== Number(latest.version));
  if (!earlier) return 'Never sent';
  const s = versionStatus(earlier);
  const stamp = s === 'accepted' ? earlier.signed_off_at : s === 'opened' ? earlier.opened_at : earlier.sent_at;
  const day = shortMoment(stamp);
  return `v${earlier.version} ${s}${day ? ` ${day}` : ''}`;
}

/**
 * What the page must say about a SENT version's recipient, or null.
 *
 *   · `not_recorded`: sent, but no recipient is on the row. D4684 pinned every
 *     earlier send to the engagement's client; a send with no linked client
 *     then has none, and a guess is not a record.
 *   · `missing`: the row names an account that no longer reads back (the user
 *     row is gone), so there is no name to show: the recipient is no longer
 *     active on Axal.
 *   · `moved`: the engagement's client today is someone else. The version
 *     stays with the person it went to; a new send goes to the new client.
 */
export function recipientNote(item, version) {
  if (!version?.sent_at) return null;
  if (version.recipient_user_id == null) {
    return { kind: 'not_recorded', text: 'Recipient not recorded for this send' };
  }
  if (!version.recipient_name) {
    return { kind: 'missing', text: 'The account this was sent to is no longer active on Axal' };
  }
  if (item?.client_user_id != null && Number(item.client_user_id) !== Number(version.recipient_user_id)) {
    return { kind: 'moved', text: `Stays with ${version.recipient_name}; the engagement’s client has changed since` };
  }
  return null;
}

/**
 * The send confirmation, "Send v3 to Acme?", said in full before anything is
 * sent: who receives it, which document, and what sending fixes.
 *
 * The recipient is the engagement's client as linked NOW, because that is who
 * the Worker's send route records (D4684). `sendable` is false, with the
 * reason, for a version that has gone, has no content (D4712) or has nobody
 * with an account to go to.
 */
export function sendConfirmation(item) {
  const v = item?.latest_version;
  if (!v) return { sendable: false, reason: 'There is no version to send.' };
  const tag = `v${v.version}`;
  const client = String(item?.client_name || '').trim() || 'this client';
  const person = item?.client_user_name || item?.client_user_email || null;
  const base = {
    tag,
    heading: `Send ${tag} to ${client}?`,
    recipient: person ? `${person} · ${client}` : null,
    document: `${item?.title || 'Work product'} ${tag}`,
    note: String(v.summary ?? '').trim() || null,
    // #5961: the version's own summary, when one was recorded (D5959). Null otherwise, and nothing is drawn for it.
    summary: versionSummary(v),
    link: typeof v.link_url === 'string' ? v.link_url.trim() : '',
    // #5961: a stored file is named by its file name (D5960); null for a link or no document.
    fileName: null,
    after: `${tag} can’t be edited after sending; add v${Number(v.version) + 1} for changes.`,
    confirm: `Send ${tag} to ${person || client}`,
  };
  if (v.sent_at) return { ...base, sendable: false, reason: `${tag} has already been sent.` };
  if (!person) {
    return { ...base, sendable: false, reason: 'No client account is linked to this work product’s engagement, so it cannot be sent.' };
  }
  const doc = versionDocument(v);
  if (doc?.kind === 'file') return { ...base, fileName: doc.name, sendable: true, reason: null };
  if (!doc) return { ...base, sendable: false, reason: `${tag} has no content to send. Add a version with a file or a link, then send that one.` };
  return { ...base, host: doc.host, sendable: true, reason: null };
}

// ──────────────── #5961 (D4833-p3) · a version's summary and stored file ────────────────
//
// D5959 stores a version's optional summary apart from its change note
// (`version_summary`; `summary` stays the change note). D5960 lets a version's
// document be a stored file: `document` is `file`, `link` or null, and `file`
// is `{ name, type, size }`, never the storage key.

/** What the Worker takes as a version's file (D5960, `company_documents.ts`): at most 10 MB, a PDF, JPEG or PNG. */
export const DELIVERABLE_FILE = {
  maxBytes: 10 * 1024 * 1024,
  types: { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG' },
};
/** The file input's `accept`. */
export const DELIVERABLE_FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
/** The limits as the field says them: "A PDF, JPEG or PNG of at most 10 MB." */
export const DELIVERABLE_FILE_LIMITS_LINE = `A PDF, JPEG or PNG of at most ${formatBytes(DELIVERABLE_FILE.maxBytes)}.`;

/** A version's summary (D5959), trimmed, or null when none was recorded. Never the change note. */
export function versionSummary(version) {
  const s = String(version?.version_summary ?? '').trim();
  return s || null;
}

/**
 * A version's document: `{ kind: 'file', name, type, size, sizeLabel }` for a
 * stored file, `{ kind: 'link', href, host, path }` for an https link, or null
 * when it has neither (a title-only v1, or a link that is not https). A file
 * wins over a link, as the Worker's `document` says.
 */
export function versionDocument(version) {
  if (!version) return null;
  if (version.document === 'file') {
    const f = version.file || {};
    const size = f.size == null ? null : Number(f.size);
    return {
      kind: 'file',
      name: String(f.name || '').trim() || 'document',
      type: f.type || null,
      size: Number.isFinite(size) ? size : null,
      sizeLabel: Number.isFinite(size) ? formatBytes(size) : null,
    };
  }
  const href = typeof version.link_url === 'string' ? version.link_url.trim() : '';
  try {
    const u = new URL(href);
    if (u.protocol === 'https:' && u.hostname) return { kind: 'link', href, host: u.hostname, path: u.pathname === '/' ? '' : u.pathname };
  } catch { /* not a link */ }
  return null;
}

/**
 * A file the Worker would refuse, said in the Worker's own sentence, or null.
 * Checked before a byte is sent; the Worker checks again by the file's bytes,
 * and its refusal is shown as it comes.
 */
export function fileRefusal(file) {
  if (!file) return null;
  const size = Number(file.size);
  if (Number.isFinite(size) && size > DELIVERABLE_FILE.maxBytes) return 'The file is larger than 10 MB.';
  if (size === 0) return 'The file is empty.';
  const declared = String(file.type || '').toLowerCase().split(';')[0].trim();
  if (declared && !DELIVERABLE_FILE.types[declared]) return 'Upload a PDF, JPEG or PNG file.';
  return null;
}

/**
 * The Add version dialog's draft as what the Worker takes: `{ body, file }`,
 * or `{ error }` with the sentence to show. The change note is required, and
 * the document is exactly one of an https link or a file (D4712, D5960). The
 * summary is optional and is sent only when written (D5959).
 */
export function versionDraft(draft) {
  const summary = String(draft?.summary ?? '').trim();
  if (!summary) return { error: 'Say what changed in this version.' };
  if (summary.length > 2000) return { error: 'The note is at most 2,000 characters.' };
  const link = String(draft?.link_url ?? '').trim();
  const file = draft?.file || null;
  if (file && link) return { error: 'A version’s document is a link or a file, not both. Remove one.' };
  if (file) {
    const refused = fileRefusal(file);
    if (refused) return { error: refused };
  } else {
    let https = false;
    try { https = new URL(link).protocol === 'https:'; } catch { https = false; }
    if (!https) return { error: 'Choose a file, or enter a web address that starts with https://' };
    if (link.length > 2000) return { error: 'A link is at most 2,000 characters.' };
  }
  const versionSummaryText = String(draft?.version_summary ?? '').trim();
  if (versionSummaryText.length > 2000) return { error: 'The summary is at most 2,000 characters.' };
  const body = file ? { summary } : { link_url: link, summary };
  if (versionSummaryText) body.version_summary = versionSummaryText;
  return { body, file };
}
