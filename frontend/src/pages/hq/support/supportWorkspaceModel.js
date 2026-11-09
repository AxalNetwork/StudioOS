/**
 * D5034 (#5034) — HQ › Support v2's pure model: the four workspaces, what the
 * Queue leads with, the escalation and ticket rows in SLA order, the
 * subsidiaries line and the branch cards. Pure over the `GET /api/admin/hq-support`
 * payload (`routes/admin_hq_support.ts`), so every state is tested without a page.
 *
 * THE STATE RULES THE CANVAS KEEPS (`design/incoming/Support v2 Page.dc.html`):
 *   · a measured zero, a total that could not be made, and a read that failed
 *     are three things. A part that is not counted makes its figure a lower
 *     bound, written "18+", with the reason beside it, never a smaller exact
 *     number (SU11 "Incomplete total");
 *   · "All clear" is drawn only when every source that was asked answered
 *     with nothing open. HQ's own queues empty while a subsidiary has not
 *     answered is "Nothing waiting at HQ", and the subsidiaries line says what
 *     is not known;
 *   · SLA is a word with a shape ("Past SLA · 38h"), never colour alone.
 */
import { escalationKindLabel } from '../../../lib/escalationKinds';

/** The four workspaces, in the canvas's order. Queue is the default. */
export const SUPPORT_WORKSPACES = Object.freeze([
  { key: 'queue', label: 'Queue' },
  { key: 'branches', label: 'Branches' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'policy', label: 'Policy' },
]);

export const DEFAULT_WORKSPACE = 'queue';

/** `?tab=` to a workspace key; anything unknown is the Queue. */
export function workspaceFromSearch(value) {
  const v = String(value || '').toLowerCase();
  return SUPPORT_WORKSPACES.some((w) => w.key === v) ? v : DEFAULT_WORKSPACE;
}

export const workspaceHref = (key) => `?tab=${encodeURIComponent(key)}`;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** Hours to the canvas's unit: "<1h", "38h". Null when there is no age. */
export function hoursText(h) {
  const v = num(h);
  if (v === null) return null;
  return v < 1 ? '<1h' : `${Math.floor(v)}h`;
}

/** "14:30" from an ISO stamp the server sent, or null. The page never invents a time. */
export function clockOf(iso) {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : null;
}

/**
 * One figure from parts that each may be measured, cut or unread. A cut part
 * still contributes what was listed (a lower bound); an unread part
 * contributes nothing. Either makes the figure `partial`, drawn "N+".
 */
function sumParts(parts) {
  let value = 0;
  let partial = false;
  for (const p of parts) {
    if (p.value === null || p.value === undefined) {
      partial = true;
      value += p.floor || 0;
    } else {
      value += Number(p.value);
    }
  }
  return { value, partial };
}

/** "18" or "18+" — the words for a figure, never a smaller exact number. */
export const figureText = (f) => (f ? `${f.value}${f.partial ? '+' : ''}` : '…');

const bucketsOf = (data) => (data?.tickets?.available ? data.tickets.buckets || {} : null);
const HQ_TICKET_QUEUES = ['hq_held', 'admin_product'];

/**
 * What the Queue leads with: Past SLA, Due soon, Open and Oldest over HQ's
 * escalations and the HQ-hosted tickets (the canvas's "Open · escalations +
 * HQ tickets"), and the state of the whole.
 *
 *   state: 'loading' | 'failed' | 'clear' | 'hq_clear' | 'active'
 *
 * `clear` needs every part measured at zero AND the subsidiaries measured
 * (none deployed, or each answered with nothing open). `hq_clear` is HQ's own
 * parts measured at zero while a subsidiary is unread, still being asked, or
 * has tickets of its own.
 */
export function queueOverview(data, { failed = false, branchState = 'ready' } = {}) {
  if (failed) return { state: 'failed', reasons: ['The Support read failed, so what is waiting is unknown — not none.'] };
  if (!data) return { state: 'loading' };
  const reasons = [];
  const esc = data.escalations;
  const buckets = bucketsOf(data);
  if (!esc?.available) reasons.push(`Escalations could not be read${esc?.reason ? `: ${esc.reason}` : '.'}`);
  if (!buckets) reasons.push(`HQ tickets could not be read${data.tickets?.reason ? `: ${data.tickets.reason}` : '.'}`);

  const escListed = esc?.available ? (esc.items || []) : [];
  const escParts = esc?.available
    ? {
      open: { value: esc.count, floor: escListed.length },
      past: { value: esc.bands ? esc.bands.past : null, floor: escListed.filter((x) => x.sla === 'past').length },
      due: { value: esc.bands ? esc.bands.due_soon : null, floor: escListed.filter((x) => x.sla === 'due_soon').length },
    }
    : { open: { value: null }, past: { value: null }, due: { value: null } };
  const ticketParts = HQ_TICKET_QUEUES.map((q) => {
    if (!buckets) return { open: { value: null }, past: { value: null }, due: { value: null } };
    const b = buckets[q] || {};
    const items = b.items || [];
    return {
      open: { value: b.count ?? null, floor: items.length },
      past: { value: b.bands ? b.bands.past : null, floor: items.filter((x) => x.sla_band === 'past').length },
      due: { value: b.bands ? b.bands.due_soon : null, floor: items.filter((x) => x.sla_band === 'due_soon').length },
    };
  });
  if (esc?.available && (esc.count === null || esc.count === undefined)) {
    reasons.push('More open escalations than one read counts, so the escalation figures are a floor.');
  }
  if (buckets && HQ_TICKET_QUEUES.some((q) => buckets[q]?.count === null || buckets[q]?.count === undefined)) {
    reasons.push('More open HQ tickets than one read counts, so the ticket figures are a floor.');
  }
  const all = [escParts, ...ticketParts];
  const open = sumParts(all.map((p) => p.open));
  const pastSla = sumParts(all.map((p) => p.past));
  const dueSoon = sumParts(all.map((p) => p.due));
  const ages = [
    esc?.available ? num(esc.oldest_age_hours) : null,
    ...HQ_TICKET_QUEUES.map((q) => (buckets ? num(buckets[q]?.oldest_age_hours) : null)),
  ].filter((a) => a !== null);
  const oldest = ages.length ? { value: Math.max(...ages), partial: open.partial } : (open.partial ? null : { value: null, partial: false });

  const hqZero = !open.partial && open.value === 0;
  const subs = subsidiaryLine(data, branchState);
  let state = 'active';
  if (hqZero) state = subs.state === 'none' || subs.state === 'zero' ? 'clear' : 'hq_clear';
  return { state, open, pastSla, dueSoon, oldest, reasons, subsidiaries: subs };
}

/**
 * The subsidiaries, in one line (the canvas folds them on the Queue).
 *
 *   state: 'loading' | 'failed' | 'none' | 'zero' | 'open' | 'partial'
 */
export function subsidiaryLine(data, branchState = 'ready') {
  if (branchState === 'loading') return { state: 'loading', text: 'Asking each subsidiary…' };
  if (branchState === 'failed') {
    return { state: 'failed', text: 'Subsidiary sources could not be read — whether they have tickets waiting is unknown, not none.' };
  }
  const bt = data?.branch_tickets;
  const lines = bt?.lines || [];
  if (!lines.length) return { state: 'none', text: 'No subsidiary support sources connected' };
  const answered = lines.filter((l) => l.state === 'ok');
  const unread = lines.filter((l) => l.state !== 'ok');
  const counted = answered.filter((l) => num(l.count) !== null);
  const openN = counted.reduce((s, l) => s + Number(l.count), 0);
  const cut = answered.length - counted.length;
  const pastN = answered.reduce((s, l) => s + (l.bands ? Number(l.bands.past) : 0), 0);
  const responding = `${answered.length} of ${lines.length} subsidiary ${lines.length === 1 ? 'source' : 'sources'} responding`;
  const partial = unread.length > 0 || cut > 0;
  const openText = `${openN}${partial ? '+' : ''} open on branch hosts`;
  const parts = [responding, openText];
  if (pastN > 0) parts.push(`${pastN} past SLA`);
  if (unread.length) parts.push(`not read: ${unread.map((l) => l.label || l.code).join(', ')}`);
  let state = 'open';
  if (partial) state = 'partial';
  else if (openN === 0) state = 'zero';
  return { state, text: parts.join(' · '), responding, open: { value: openN, partial }, unread: unread.map((l) => l.label || l.code) };
}

/** The scope line's source words: "3 of 3 subsidiary sources responding" or why not. */
export function sourcesText(data, branchState) {
  const s = subsidiaryLine(data, branchState);
  if (s.state === 'loading') return 'asking subsidiaries…';
  if (s.state === 'failed') return 'subsidiary sources unreadable';
  if (s.state === 'none') return 'No subsidiary support sources connected';
  return s.responding;
}

// ───────────────────────────────────────────────────────── escalations ──

const BAND_ORDER = ['past', 'due_soon', 'ok'];
export const BAND_WORD = { past: 'Past SLA', due_soon: 'Due soon', ok: 'On time' };
const BAND_GROUP = { past: 'Past SLA', due_soon: 'Due soon', ok: 'Open' };

/**
 * The deadline line under an escalation's SLA: "72h SLA · late by 2h" or
 * "120h SLA · 16h left". From the kind's limit (the escalation table HQ
 * serves) and the row's own `due_at` against the read's time — never the
 * browser's clock, so the line says what was true at the read.
 */
export function deadlineText(item, { readAt, kindHours } = {}) {
  const limit = kindHours ? num(kindHours[item.kind]) : null;
  const due = Date.parse(item.due_at || '');
  const at = Date.parse(readAt || '');
  const head = limit !== null ? `${limit}h SLA` : null;
  if (!Number.isFinite(due) || !Number.isFinite(at)) return head;
  const h = (due - at) / 3600000;
  const tail = h < 0 ? `late by ${hoursText(-h)}` : `${hoursText(h)} left`;
  return head ? `${head} · ${tail}` : tail;
}

/** kind → limit hours, from `sla_policy.escalation_kinds`. */
export function kindHoursOf(slaPolicy) {
  const out = {};
  for (const k of slaPolicy?.escalation_kinds || []) out[k.kind] = k.hours;
  return out;
}

/** A row's preview: the request's first line, cut at a word near 140 characters. */
export function previewOf(detail, max = 140) {
  const t = String(detail || '').trim().split(/\n/)[0];
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > 80 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/**
 * The listed escalations as the canvas's three bands, Past SLA first, each
 * oldest first (the read is ordered oldest first, so order within a band is
 * kept). `kind` narrows to one kind's own rows from the server's whole-board
 * measurement (D5030), never a filter over the 25 listed.
 */
export function escalationGroups(escalations, { kind = '', readAt, kindHours } = {}) {
  if (!escalations?.available) return [];
  let rows = escalations.items || [];
  if (kind) {
    const k = Array.isArray(escalations.kinds) ? escalations.kinds.find((x) => x.kind === kind) : null;
    rows = k ? (k.items || []) : rows.filter((x) => x.kind === kind);
  }
  return BAND_ORDER.map((band) => ({
    band,
    title: BAND_GROUP[band],
    rows: rows.filter((x) => (x.sla || 'ok') === band).map((x) => ({
      uid: x.uid,
      item: x,
      title: `${x.branch_code} · ${x.subject || escalationKindLabel(x.kind)}`,
      kind: capital(escalationKindLabel(x.kind)),
      // "fr · Seat increase · Seat increase" says one thing twice: the kind is named only when the subject is not it.
      showKind: Boolean(x.subject) && String(x.subject).trim().toLowerCase() !== String(escalationKindLabel(x.kind)).toLowerCase(),
      preview: previewOf(x.detail),
      raisedBy: x.raised_by_name || null,
      sla: { band, text: `${BAND_WORD[band]}${hoursText(x.age_hours) ? ` · ${hoursText(x.age_hours)}` : ''}` },
      deadline: deadlineText(x, { readAt, kindHours }),
    })),
  })).filter((g) => g.rows.length);
}

const capital = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());

/**
 * The Queue's kind filter: All, then the kinds that have something open (or
 * whose count could not be made), then the chosen kind if it has none.
 * Every other kind waits behind More filters — the full taxonomy is Policy's.
 */
export function queueKindChoices(choices, value = '') {
  const all = choices.find((c) => c.kind === '') || null;
  const rest = choices.filter((c) => c.kind !== '');
  const active = rest.filter((c) => c.count === null || c.count > 0 || c.kind === value);
  const more = rest.filter((c) => !active.includes(c));
  return { all, active, more };
}

// ─────────────────────────────────────────────────────────── tickets ──

const PRIORITY_TIER = { urgent: 'P1', high: 'P2', medium: 'P3', low: 'P3' };
/** Filing priority to the ticket tier (`supportSlaPolicy.ts`): urgent → P1, high → P2, medium and low → P3. */
export const tierOfPriority = (p) => PRIORITY_TIER[String(p || '').toLowerCase()] || null;

const RISK = { past: 0, due_soon: 1, ok: 2 };
const CONTEXT = { hq_held: 'Customer ticket on HQ', admin_product: 'Subsidiary admin ticket' };

/**
 * HQ-hosted tickets as one list, oldest risk first: past SLA, then due soon,
 * then on time, then the undated; within each, oldest first. The two queues
 * stay named on each row (Context), so nothing is merged away.
 */
export function hqTicketRows(data, { tiers } = {}) {
  const buckets = bucketsOf(data);
  if (!buckets) return [];
  const hours = {};
  for (const t of tiers || []) hours[t.id] = t.hours;
  const rows = HQ_TICKET_QUEUES.flatMap((q) => (buckets[q]?.items || []).map((x) => {
    const tier = tierOfPriority(x.priority);
    const limit = tier ? num(hours[tier]) : null;
    const age = num(x.age_hours);
    const left = limit !== null && age !== null ? limit - age : null;
    return {
      key: `${q}:${x.id}`,
      id: x.id,
      title: x.title || `Ticket #${x.id}`,
      requester: x.requester || null,
      context: CONTEXT[q],
      licence: x.licence ? (x.licence.licence_ref || x.licence.brand_name) : null,
      priority: [tier, x.priority].filter(Boolean).join(' · ') || null,
      age: hoursText(x.age_hours),
      ageHours: age,
      band: x.sla_band || null,
      sla: x.sla_band
        ? { band: x.sla_band, text: BAND_WORD[x.sla_band], detail: left === null ? null : (left < 0 ? `late by ${hoursText(-left)}` : `${hoursText(left)} left`) }
        : null,
      to: `/help/tickets/${x.id}`,
    };
  }));
  return rows.sort((a, b) => {
    const ra = a.band in RISK ? RISK[a.band] : 3;
    const rb = b.band in RISK ? RISK[b.band] : 3;
    if (ra !== rb) return ra - rb;
    return (b.ageHours ?? -1) - (a.ageHours ?? -1);
  });
}

/** The HQ-hosted tickets' "N open", or the floor and why. */
export function hqTicketCount(data) {
  const buckets = bucketsOf(data);
  if (!buckets) return null;
  return sumParts(HQ_TICKET_QUEUES.map((q) => ({ value: buckets[q]?.count ?? null, floor: (buckets[q]?.items || []).length })));
}

// ────────────────────────────────────────────────────────── branches ──

/**
 * One card per subsidiary (canvas SU04a): its source state, open tickets,
 * past SLA, oldest, and how its matrix row splits between its host and
 * axal.vc. An unread branch is Unavailable with its reason, never zero, and
 * says that its escalations are held at HQ and still shown.
 */
export function branchCards(data) {
  const lines = data?.branch_tickets?.lines || [];
  const rows = data?.matrix?.available ? data.matrix.rows || [] : [];
  return lines.map((l) => {
    const row = rows.find((r) => r.branch_code === l.code) || null;
    const split = row?.about_admin && row.about_admin.on_branch !== undefined
      ? `${row.about_admin.on_branch} on ${l.label || l.code} host · ${row.about_admin.on_hq} on axal.vc`
      : null;
    if (l.state !== 'ok') {
      return { code: l.code, label: l.label || l.code, state: l.state === 'not_deployed' ? 'not_deployed' : 'unavailable', reason: l.reason || null };
    }
    return {
      code: l.code,
      label: l.label || l.code,
      state: 'connected',
      open: num(l.count),
      past: l.bands ? Number(l.bands.past) : null,
      oldest: hoursText(l.oldest_age_hours),
      split,
      escalations: row?.escalations && row.escalations.value !== null && row.escalations.value !== undefined ? Number(row.escalations.value) : null,
    };
  });
}

/**
 * A subsidiary's name for a branch code (the decision sheet's "Subsidiary"),
 * from what the reads carry: the branch hosts' lines, then the matrix. The
 * code itself when neither names it — never a guessed name.
 */
export function branchLabelOf(data, code) {
  if (!code) return null;
  const line = (data?.branch_tickets?.lines || []).find((l) => l.code === code);
  if (line?.label) return line.label;
  const row = data?.matrix?.available ? (data.matrix.rows || []).find((r) => r.branch_code === code) : null;
  return row?.label || code;
}

/** The uid of the row after `uid` in the queue's order, for focus after a decision. */
export function nextUidAfter(groups, uid) {
  const flat = (groups || []).flatMap((g) => g.rows.map((r) => r.uid));
  const i = flat.indexOf(uid);
  return i >= 0 && i + 1 < flat.length ? flat[i + 1] : null;
}

/** Whether the queues-by-subsidiary matrix compares anything: a licence row beside HQ's. */
export const matrixCompares = (matrix) => Boolean(matrix?.available) && (matrix.rows || []).some((r) => r.kind === 'licence');

// ─────────────────────────────────────────────────────────── delivery ──

/** Decisions this session whose push did not reach the branch, first. */
export function deliveryRows(recorded) {
  const failedFirst = (r) => (r.pushed && r.pushed.ok === true ? 1 : 0);
  return [...(recorded || [])].sort((a, b) => failedFirst(a) - failedFirst(b));
}

export const notDelivered = (recorded) => (recorded || []).filter((r) => !(r.pushed && r.pushed.ok === true)).length;

/**
 * The GitHub mirror in one line when nothing needs looking at; null when the
 * full strip should be drawn (activity with failures, no token, or a read
 * that failed — degraded states expand, per the canvas).
 */
export function mirrorLine(sync) {
  if (!sync?.available) return null;
  if (Number(sync.failed) > 0 || Number(sync.not_configured) > 0) return null;
  const w = sync.window_hours;
  if (!Number(sync.synced)) return `No ticket activity in the last ${w}h`;
  return `${plural(Number(sync.synced), 'ticket', 'tickets')} mirrored in the last ${w}h · none failed`;
}

// ─────────────────────────────────────────────────────────── policy ──

/**
 * Whether HQ's ticket SLA is on every subsidiary (D5032), as the Policy
 * workspace's banner says it:
 *
 *   'none'       no subsidiary is deployed: nothing to distribute to
 *   'complete'   every deployed branch applies the current version
 *   'incomplete' a branch is stale, unreported or unreadable
 *   'unknown'    the branches have not answered (loading) or could not be read
 */
export function distributionState(slaPolicy, branchState = 'ready') {
  const p = slaPolicy?.branch_copy?.propagation || null;
  if (!p) return branchState === 'ready' ? { state: 'none' } : { state: 'unknown', branchState };
  if (!p.total) return { state: 'none' };
  if (p.current >= p.total) return { state: 'complete', current: p.current, total: p.total };
  return { state: 'incomplete', current: p.current, total: p.total };
}

/** The marks the workspace nav carries: work, not decoration. */
export function workspaceMarks(overview, recorded, distribution) {
  const marks = {};
  const past = overview?.pastSla;
  if (past && past.value > 0) marks.queue = { text: `${figureText(past)} past SLA`, tone: 'negative' };
  const nd = notDelivered(recorded);
  if (nd > 0) marks.delivery = { text: `${nd} not delivered`, tone: 'negative' };
  if (distribution?.state === 'incomplete') marks.policy = { text: 'Not on every branch', tone: 'attention' };
  return marks;
}

// ──────────────────────────────────────────────────────── part 3 ──

const SUPPORT = '/admin/hq-support';

/**
 * D5034 part 3 — Eadwyn's block on Support: the page's own next steps (D4873
 * `steps`), drawn in place of the model list and prices, so the rail answers
 * "what needs me here" and not "which model". Built only from what the page
 * read; each step links to the workspace where the work is, and nothing in it
 * acts. A figure the page could not make is never a step's zero.
 */
export function supportRailSteps({ overview, recorded, distribution, failed = false, onRetry } = {}) {
  const title = 'For Support';
  if (failed) return { title, state: 'unavailable', text: 'The Support read failed, so what is waiting is unknown, not none.', onRetry };
  if (!overview || overview.state === 'loading') return { title, state: 'loading' };
  const items = [];
  if (overview.pastSla && overview.pastSla.value > 0) {
    items.push({ key: 'past', tone: 'act', text: `${figureText(overview.pastSla)} past SLA, escalations and HQ tickets together.`, to: `${SUPPORT}?tab=queue`, action: 'Open the queue' });
  }
  if (overview.dueSoon && overview.dueSoon.value > 0) {
    items.push({ key: 'due', tone: 'info', text: `${figureText(overview.dueSoon)} due soon.`, to: `${SUPPORT}?tab=queue`, action: 'Open the queue' });
  }
  const nd = notDelivered(recorded);
  if (nd > 0) {
    items.push({ key: 'delivery', tone: 'act', text: `${plural(nd, 'decision', 'decisions')} recorded at HQ but not delivered.`, to: `${SUPPORT}?tab=delivery`, action: 'Open Delivery' });
  }
  if (distribution?.state === 'incomplete') {
    items.push({ key: 'policy', tone: 'act', text: `HQ's ticket SLA is applied on ${distribution.current} of ${distribution.total} subsidiaries.`, to: `${SUPPORT}?tab=policy`, action: 'Open Policy' });
  }
  const subs = overview.subsidiaries;
  if (subs && (subs.state === 'failed' || (subs.unread && subs.unread.length))) {
    items.push({
      key: 'branches', tone: 'info',
      text: subs.state === 'failed' ? 'The subsidiaries could not be read.' : `Not read: ${subs.unread.join(', ')}.`,
      to: `${SUPPORT}?tab=branches`, action: 'Open Branches',
    });
  }
  if (items.length) return { title, state: 'ready', items, foot: 'Eadwyn reads this page and changes nothing. You record every decision.' };
  if (overview.state === 'clear') return { title, state: 'empty', text: 'Nothing is waiting at HQ, and every source answered.' };
  return { title, state: 'empty', text: 'Nothing on this page needs a step from you.' };
}

/**
 * D5034 part 3 — whether the subsidiary figures on screen are older than
 * HQ's. They are when a quiet refresh brought HQ's own read back but the
 * branch read has not (yet) answered: the page keeps the last good branch
 * figures, and says which read they come from instead of mixing two times.
 * Null when they are the same read.
 */
export function branchFreshness(hqReadAt, branchReadAt, { asking = false } = {}) {
  if (!hqReadAt || !branchReadAt || String(branchReadAt) >= String(hqReadAt)) return null;
  const at = clockOf(branchReadAt);
  return {
    at,
    asking,
    text: `Subsidiary figures are from the ${at ? `${at} UTC ` : 'earlier '}read${asking ? ', asking each subsidiary again…' : '; the latest subsidiary read did not complete.'}`,
  };
}

/** What the offline banner says, with the read it keeps on screen. */
export function offlineText(readAt) {
  return `You're offline. Showing the ${readAt ? `${readAt} UTC ` : 'last '}read. Decisions can't be recorded until you reconnect.`;
}
