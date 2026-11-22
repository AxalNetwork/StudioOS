/**
 * D6866 (#6866, canvas D6158 DX17 to DX25) — the closing workspace for one
 * deal: what each tab draws from the reads main already serves. Pure, so the
 * page and its tests share one answer.
 *
 * Reads (each LOADING, UNREADABLE or `ready(value)`, as closingListModel):
 *   checklist  GET /deals/:id/closing-checklist        {checklist|null}
 *   envelopes  GET /legal/esign                          scoped at its route
 *   conditions GET /ic/conditions                        every status, decision-scoped
 *   transfers  GET /deals/:id/transfers
 *   gate       GET /deals/:id/transfer-gate (Admin)     {held, open_conditions|null}
 *   events     GET /deals/:id/closing-checklist/events
 *   closing    GET /closings (+ /closings/:uid)          the closing record, if one is open
 *
 * Every state is a word with a glyph, never colour alone. A read that failed
 * says Unavailable (D5129) and never stands in as zero or as "nothing holds it".
 */
import { NOT_RECORDED, text } from '../../../lib/absence.js';

/** A read's three states. `ok(value)` carries any value (an object, a list, or null for "none applied"). */
export const LOADING = Object.freeze({ state: 'loading' });
export const UNREADABLE = Object.freeze({ state: 'unreadable' });
export const ok = (value) => ({ state: 'ready', value });

export const UNAVAILABLE_WORD = 'Unavailable';
export const DISCLAIMER = 'Axal VC records money movement it is told about. It does not move money.';

const isReady = (r) => r && r.state === 'ready';

/** YYYY-MM-DD of an ISO time or date. */
const ymd = (v) => (v ? String(v).slice(0, 10) : '');

/** Whole days from `a` to `b` (YYYY-MM-DD), b later is positive. */
function daysBetween(a, b) {
  const t = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86400000);
}

// ---------------------------------------------------------------------------
// Checklist (DX21)
// ---------------------------------------------------------------------------

/**
 * One checklist item's status, as a word and a glyph. Overdue is a Pending
 * item whose due date has passed: it needs both, so an item with no due date
 * is Pending, never Overdue.
 */
export function itemStatus(item, today) {
  const state = String(item?.state || 'pending');
  if (state === 'done') return { key: 'done', word: 'Done', glyph: '✓' };
  if (state === 'blocked') return { key: 'blocked', word: 'Blocked', glyph: '✕' };
  if (state === 'skipped') return { key: 'skipped', word: 'Skipped', glyph: '–' };
  const due = ymd(item?.due_date);
  if (due && today && due < today) {
    const n = daysBetween(due, today);
    return { key: 'overdue', word: `Overdue · ${n} day${n === 1 ? '' : 's'}`, glyph: '◷' };
  }
  return { key: 'pending', word: 'Pending', glyph: '○' };
}

/** Who owns an item: a person's name, the free label (e.g. "Founder"), or not recorded. */
export const itemOwner = (item) => item?.owner_name || item?.owner_label || null;

/** The checklist's summary line and its tab count ("4 of 8"). */
export function checklistSummary(read, today) {
  if (!read || read.state === 'loading') return { state: 'loading' };
  if (read.state === 'unreadable') return { state: 'unreadable' };
  const list = read.value;
  if (!list) return { state: 'none', tab: 'none' };
  const items = Array.isArray(list.items) ? list.items : [];
  const by = { done: 0, pending: 0, overdue: 0, blocked: 0, skipped: 0 };
  for (const i of items) by[itemStatus(i, today).key] += 1;
  return {
    state: items.length ? 'ready' : 'empty',
    total: items.length,
    ...by,
    tab: `${by.done} of ${items.length}`,
    template: list.template_slug || null,
  };
}

// ---------------------------------------------------------------------------
// Paper (DX17)
// ---------------------------------------------------------------------------

/**
 * An envelope's state in the agreement lifecycle's words. Executed means
 * completed and nothing else; a sent envelope with some signatures is Partly
 * signed.
 */
export function paperState(env) {
  const s = String(env?.status || '');
  if (s === 'completed') return { key: 'executed', word: 'Executed', glyph: '✓' };
  if (s === 'voided') return { key: 'voided', word: 'Voided', glyph: '–' };
  if (s === 'declined') return { key: 'rejected', word: 'Rejected', glyph: '✕' };
  if (s === 'draft') return { key: 'draft', word: 'Draft', glyph: '○' };
  const signed = Number(env?.signed_count) || 0;
  if (signed > 0) return { key: 'partly', word: 'Partly signed', glyph: '◐' };
  return { key: 'sent', word: 'Sent', glyph: '◷' };
}

/** The deal's envelopes, newest sent first, with their state and "n of m signed". */
export function paperRows(read, dealId) {
  if (!isReady(read)) return read && read.state === 'unreadable' ? { state: 'unreadable' } : { state: 'loading' };
  const rows = (read.value || [])
    .filter((e) => Number(e.deal_id) === Number(dealId))
    .map((e) => {
      const of = Number(e.recipient_count);
      return {
        id: e.id,
        title: e.document_title || e.document_type || 'Untitled document',
        type: e.document_type || null,
        status: paperState(e),
        signatures: Number.isFinite(of) && of > 0 ? `${Number(e.signed_count) || 0} of ${of} signed` : null,
        sent: ymd(e.sent_at || e.created_at) || null,
        executed: e.status === 'completed' ? ymd(e.completed_at) || null : null,
      };
    })
    .sort((a, b) => String(b.sent || '').localeCompare(String(a.sent || '')));
  const count = (k) => rows.filter((r) => r.status.key === k).length;
  return { state: 'ready', rows, executed: count('executed'), partly: count('partly'), voided: count('voided'), rejected: count('rejected') };
}

// ---------------------------------------------------------------------------
// Conditions (DX18) — read only here; the dialogs are the Investment committee's.
// ---------------------------------------------------------------------------

const COND_ORDER = { open: 0, met: 1, waived: 2 };
const COND_WORD = {
  open: { word: 'Open', glyph: '○' },
  met: { word: 'Met', glyph: '✓' },
  waived: { word: 'Waived', glyph: '–' },
};

/** This deal's conditions: open first, then Met, then Waived, each newest first. */
export function conditionRows(read, dealId) {
  if (!isReady(read)) return read && read.state === 'unreadable' ? { state: 'unreadable' } : { state: 'loading' };
  const rows = (read.value || [])
    .filter((c) => Number(c.deal_id) === Number(dealId))
    .map((c) => ({
      uid: c.uid,
      body: c.body || '',
      decision: c.decision_title || null,
      status: { key: c.status, ...(COND_WORD[c.status] || { word: String(c.status || ''), glyph: '·' }) },
      owner: c.owner_name || c.owner_label || null,
      raisedBy: c.created_by_name || null,
      resolvedBy: c.resolved_by_name || null,
      resolvedAt: ymd(c.resolved_at) || null,
      createdAt: c.created_at || '',
    }))
    .sort((a, b) => (COND_ORDER[a.status.key] ?? 9) - (COND_ORDER[b.status.key] ?? 9) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const open = rows.filter((r) => r.status.key === 'open').length;
  return {
    state: 'ready',
    rows,
    open,
    met: rows.filter((r) => r.status.key === 'met').length,
    waived: rows.filter((r) => r.status.key === 'waived').length,
    tab: open ? `${open} open` : 'none open',
  };
}

// ---------------------------------------------------------------------------
// Transfer (DX19) — the hold beside Record transfer.
// ---------------------------------------------------------------------------

/**
 * Whether Record transfer is on, and the reason beside it when it is not.
 * `canRecord` is the caller's (an Admin records money, D1215). The gate is
 * the record route's own rule: a hold on a decision the caller cannot see
 * holds without a count, and a gate that could not be read keeps the button
 * off. It never reads as "nothing holds it".
 */
export function transferHold(gateRead, canRecord) {
  if (!canRecord) return { state: 'refused', enabled: false, reason: 'An Admin records transfers.' };
  if (!gateRead || gateRead.state === 'loading') return { state: 'loading', enabled: false, reason: 'Checking the conditions…' };
  if (gateRead.state === 'unreadable') return { state: 'unreadable', enabled: false, reason: 'Could not check the conditions.', retry: true };
  const g = gateRead.value || {};
  if (!g.held) return { state: 'clear', enabled: true, reason: null };
  const n = Number(g.open_conditions);
  if (Number.isFinite(n) && n > 0) {
    return { state: 'held', enabled: false, count: n, reason: `${n} open condition${n === 1 ? ' holds' : 's hold'} this. Resolve ${n === 1 ? 'it' : 'them'} in the Investment committee.` };
  }
  return { state: 'held_hidden', enabled: false, count: null, reason: 'An open condition on a decision you cannot see holds this. Ask the Investment committee chair.' };
}

/**
 * The Phone verified cell (DX19): Yes with who confirmed it by phone, Yes
 * with the verifier not recorded (a transfer recorded before D6889, or with
 * no one named), or No. Never the recorder's name standing in.
 */
export function phoneCell(row) {
  if (!row.phoneVerified) return { key: 'none', word: 'No', glyph: '–', by: null };
  return { key: 'done', word: 'Yes', glyph: '✓', by: text(row.phoneVerifiedBy) };
}

/**
 * The Record transfer dialog's body (D6889): the verifier is sent only when
 * the transfer is phone-verified and one was picked, as the Admin's integer
 * user id. The Worker checks that it names an Admin and refuses otherwise.
 */
export function transferBody(form) {
  const body = {
    amount_cents: form.cents,
    reference: form.reference || null,
    phone_verified: !!form.phoneVerified,
    note: form.note || null,
  };
  const by = Number(form.phoneVerifiedBy);
  if (form.phoneVerified && Number.isSafeInteger(by) && by > 0) body.phone_verified_by = by;
  return body;
}

/** The Admins a verifier is picked from, by name; the caller first as "You". */
export function verifierOptions(admins, me) {
  const list = (Array.isArray(admins) ? admins : [])
    .filter((u) => u && u.role === 'admin' && u.is_active !== false && u.is_active !== 0)
    .map((u) => ({ id: Number(u.id), label: Number(u.id) === Number(me?.id) ? `You · ${text(u.name, u.email || NOT_RECORDED)}` : text(u.name, u.email || NOT_RECORDED) }))
    .filter((o) => Number.isSafeInteger(o.id) && o.id > 0);
  return list.sort((a, b) => (a.id === Number(me?.id) ? -1 : b.id === Number(me?.id) ? 1 : a.label.localeCompare(b.label)));
}

/** The deal's transfers, newest first, and the all-time total that says what it counts. */
export function transferRows(read) {
  if (!isReady(read)) return read && read.state === 'unreadable' ? { state: 'unreadable' } : { state: 'loading' };
  const rows = (read.value || []).map((t) => ({
    uid: t.uid,
    cents: Number(t.amount_cents) || 0,
    reference: t.reference || null,
    phoneVerified: !!t.phone_verified,
    // D6889: who confirmed the wire instructions by phone, when it was
    // verified and someone was named; null reads "Not recorded".
    phoneVerifiedBy: t.phone_verified ? (String(t.phone_verified_by_name ?? '').trim() || null) : null,
    recordedBy: t.recorded_by_name || null,
    at: ymd(t.recorded_at) || null,
    firm: t.company_name || null,
    note: t.note || null,
  })).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const totalCents = rows.reduce((s, r) => s + r.cents, 0);
  return { state: 'ready', rows, count: rows.length, totalCents, tab: String(rows.length) };
}

// ---------------------------------------------------------------------------
// Audit (DX20) — Admins only on this route.
// ---------------------------------------------------------------------------

const CK_WORD = { pending: 'Pending', done: 'Done', blocked: 'Blocked', skipped: 'Skipped' };
const CLOSING_EVENT_WORD = {
  opened: 'Closing opened',
  line_added: 'Line added',
  route_set: 'Capital route set',
  line_withdrawn: 'Line withdrawn',
  evidence_added: 'Evidence added',
  evidence_withdrawn: 'Evidence withdrawn',
  captable_accepted: 'Cap-table proposal accepted',
  captable_dismissed: 'Cap-table proposal dismissed',
  closed: 'Closing closed',
};

/**
 * Every recorded change on the deal, newest first: checklist moves (with
 * their actor), transfers (with who recorded them), paper sent and executed
 * (from the signing record), and closing events. A closing event's actor is
 * the read's `actor_name` (D6889); an account gone or unnamed reads
 * "Not recorded", never another name.
 */
export function auditRows({ events, transfers, paper, closing }) {
  const rows = [];
  if (isReady(events)) {
    for (const e of events.value || []) {
      const what = e.from_state !== e.to_state
        ? `Item “${e.item_label}” moved ${CK_WORD[e.from_state] || e.from_state} → ${CK_WORD[e.to_state] || e.to_state}`
        : `Item “${e.item_label}” updated`;
      rows.push({ at: e.at || '', kind: 'Checklist', what, who: e.actor_name || null, whoNote: e.actor_name ? null : 'Name not shown yet' });
    }
  }
  if (transfers && transfers.state === 'ready') {
    for (const t of transfers.rows) rows.push({ at: t.at || '', kind: 'Transfers', what: 'Transfer recorded', cents: t.cents, who: t.recordedBy, whoNote: t.recordedBy ? null : 'Name not shown yet' });
  }
  if (paper && paper.state === 'ready') {
    for (const p of paper.rows) {
      if (p.sent) rows.push({ at: p.sent, kind: 'Paper', what: `${p.title} sent`, who: null, whoNote: 'From the signing record' });
      if (p.executed) rows.push({ at: p.executed, kind: 'Paper', what: `${p.title} executed`, who: null, whoNote: 'From the signing record' });
    }
  }
  if (isReady(closing) && closing.value && Array.isArray(closing.value.events)) {
    for (const ev of closing.value.events) {
      rows.push({ at: ev.created_at || '', kind: 'Closing', what: CLOSING_EVENT_WORD[ev.event] || String(ev.event || '').replace(/_/g, ' '), who: String(ev.actor_name ?? '').trim() || null, whoNote: NOT_RECORDED });
    }
  }
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const counts = { All: rows.length, Checklist: 0, Paper: 0, Transfers: 0, Closing: 0 };
  for (const r of rows) counts[r.kind] += 1;
  const unavailable = [
    events && events.state === 'unreadable' ? 'checklist history' : null,
    transfers && transfers.state === 'unreadable' ? 'transfers' : null,
    paper && paper.state === 'unreadable' ? 'paper' : null,
    closing && closing.state === 'unreadable' ? 'closing record' : null,
  ].filter(Boolean);
  return { rows, counts, unavailable };
}

// ---------------------------------------------------------------------------
// Close (DX23 B) — the rules beside the unavailable Close action.
// ---------------------------------------------------------------------------

/**
 * The three rules `completeClosing` enforces, each met or not with its
 * reason. `closing` is the closing read (lines with status, captable.state)
 * or null when no closing record is open on this deal.
 */
export function closeRules(closing) {
  if (!closing) return { state: 'none', rules: [], canClose: false };
  if (closing.status === 'closed') return { state: 'closed', rules: [], canClose: false, closedAt: ymd(closing.closed_at) || null };
  const lines = Array.isArray(closing.lines) ? closing.lines : [];
  const live = lines.filter((l) => l.status !== 'withdrawn');
  const unsettled = live.filter((l) => l.status !== 'received');
  const received = live.filter((l) => l.status === 'received').length;
  const cap = closing.captable?.state || 'not_ready';
  const rules = [
    {
      key: 'settled',
      met: live.length > 0 && unsettled.length === 0,
      title: 'Every line is Received or Withdrawn.',
      detail: live.length === 0 ? 'No line is open on this closing.' : unsettled.length ? `${unsettled.length} line${unsettled.length === 1 ? ' is' : 's are'} not received yet.` : 'Every line is settled.',
    },
    {
      key: 'one_received',
      met: received > 0,
      title: 'At least one line is Received.',
      detail: `${received} of ${live.length} line${live.length === 1 ? '' : 's'} received.`,
    },
    {
      key: 'captable',
      met: cap === 'accepted' || cap === 'dismissed',
      title: 'The cap table is decided.',
      detail: cap === 'accepted' ? 'Accepted by the founder.' : cap === 'dismissed' ? 'Dismissed by the founder.' : cap === 'proposed' ? 'Proposed · waiting on the founder.' : 'Not proposed yet: the lines are not settled.',
    },
  ];
  const unmet = rules.filter((r) => !r.met).length;
  return { state: 'open', rules, unmet, canClose: unmet === 0 };
}

// ---------------------------------------------------------------------------
// After close (DX23 A) — Record in Portfolio: each received line, In Portfolio or not.
// ---------------------------------------------------------------------------

/** When a line's money was received: its live receiving evidence, accepted or recorded. */
function receivedOn(line) {
  const ev = (Array.isArray(line?.evidence) ? line.evidence : [])
    .filter((e) => e && e.side === 'receiving' && !e.withdrawn_at)
    .map((e) => ymd(e.accepted_at || e.created_at))
    .filter(Boolean)
    .sort();
  return ev.length ? ev[ev.length - 1] : null;
}

/**
 * The after-close Portfolio table (D6889 item 3). Shown only on a closed
 * closing, and only when the read carried `in_portfolio` (an admin or the
 * founder; an investor's read has neither field, so nothing is drawn). Each
 * received line says In Portfolio or Not in Portfolio; only an admin's read
 * carries `portfolio_position_uid`, so only an admin gets the position. A
 * line is never matched to a position by name or amount: the Worker's
 * `closing_line_uid` link is the only answer.
 */
export function portfolioRows(closing) {
  if (!closing || closing.status !== 'closed') return { state: 'hidden', rows: [] };
  const lines = (Array.isArray(closing.lines) ? closing.lines : []).filter((l) => l && l.status === 'received');
  if (!lines.some((l) => typeof l.in_portfolio === 'boolean')) return { state: 'hidden', rows: [] };
  const rows = lines.map((l) => {
    const position = l.in_portfolio === true ? (String(l.portfolio_position_uid ?? '').trim() || null) : null;
    return {
      uid: l.uid,
      name: text(l.investor_name),
      route: l.route || null,
      cents: Number(l.amount_cents) || 0,
      received: receivedOn(l),
      inPortfolio: l.in_portfolio === true,
      positionUid: position,
      status: l.in_portfolio === true
        ? { key: 'done', word: 'In Portfolio', glyph: '✓' }
        : { key: 'none', word: 'Not in Portfolio', glyph: '○' },
    };
  });
  return { state: 'ready', rows, inPortfolio: rows.filter((r) => r.inPortfolio).length };
}

/** The Portfolio company page for the closing's venture, from the positions list (admin); null when not found. */
export function companyHref(positions, projectId) {
  const list = Array.isArray(positions) ? positions : Array.isArray(positions?.items) ? positions.items : [];
  const hit = list.find((p) => Number(p?.project_id) === Number(projectId) && p?.project?.uid);
  return hit ? `/portfolio/companies/${encodeURIComponent(hit.project.uid)}` : null;
}

// ---------------------------------------------------------------------------
// Tabs (DX17 to DX22)
// ---------------------------------------------------------------------------

/** The workspace's tabs and their counts. An investor has no Audit tab. */
export function workspaceTabs({ investor, checklist, paper, conditions, transfers }) {
  const count = (x) => (x && x.state === 'unreadable' ? UNAVAILABLE_WORD : x && x.tab !== undefined ? x.tab : '');
  const tabs = [
    { key: 'checklist', label: 'Checklist', count: count(checklist) },
    { key: 'paper', label: 'Paper', count: paper && paper.state === 'ready' ? String(paper.rows.length) : count(paper) },
    { key: 'conditions', label: 'Conditions', count: count(conditions) },
    { key: 'transfer', label: 'Transfer', count: count(transfers) },
  ];
  if (!investor) tabs.push({ key: 'audit', label: 'Audit', count: '' });
  return tabs;
}

/**
 * The side sheet's Save body (DX21): only what changed, in the PATCH route's
 * names. An owner typed here is a label (the route takes a platform user's id
 * or a free label such as "Founder"); a cleared field is null. Nothing
 * changed is null, so Save stays off.
 */
export function itemPatch(item, form) {
  const out = {};
  const same = (a, b) => String(a ?? '') === String(b ?? '');
  if (form.state !== undefined && !same(form.state, item.state)) out.state = form.state;
  const owner = String(form.owner ?? '').trim();
  if (form.owner !== undefined && !same(owner, itemOwner(item) || '')) out.owner_label = owner || null;
  const due = String(form.due ?? '').trim();
  if (form.due !== undefined && !same(due, ymd(item.due_date))) out.due_date = due || null;
  if (form.note !== undefined && !same(form.note, item.note || '')) out.note = String(form.note).trim() ? form.note : null;
  return Object.keys(out).length ? out : null;
}
