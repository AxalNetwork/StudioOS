/**
 * D1202 (#3152, part 7 of #2382) — HQ › Product testing's Review (TST2) and
 * Programs (TST4) tabs, the New program lightbox (TST7) and dialogs A–I (TST3),
 * as pure rules so the tests read them without a browser.
 *
 *   menuFor        the ⋯ menu a programme gets, by owner and status (TST4m):
 *                  only the steps D812 and D1198 allow, the rest left out.
 *   dialogFor      each dialog's title, lead line, what it changes, who is told
 *                  and what is recorded, its field and its button (A–H);
 *                  I is the Worker's refusal drawn inside the dialog.
 *   toldLine       after a step, who was told, in counts only.
 *   programsView   Programs' search, filters, sort and pager.
 *   earlierLine    a review card's line on the firm's earlier programmes.
 *
 * Everything a dialog says comes from the programme in hand: never an email
 * address, and never a zero for a figure the read does not carry.
 */
import { ROLE_OPTIONS, statusLabel } from '../../testing/programmeModel';

export const HQ_NAME = 'Axal VC';
export const ownerName = (p) => (p?.owner_kind === 'hq' ? HQ_NAME : (p?.owner_name || 'Partner firm not recorded'));
export const programHref = (uid, tab = null) => `/admin/platform/product-testing/programs/${encodeURIComponent(uid)}${tab ? `?tab=${tab}` : ''}`;
export const REC = 'It is recorded in the program’s history.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "14 Nov 2026", or null for anything that is not a day. */
export function dayWord(x) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** "1 Nov – 30 Nov 2026", or "Not set" when neither end is recorded. */
export function spanWords(a, z) {
  const x = dayWord(a); const y = dayWord(z);
  if (x && y) return `${x.replace(/ \d{4}$/, '')} – ${y}`;
  if (x) return `From ${x}`;
  if (y) return `Until ${y}`;
  return 'Not set';
}

const ROLE_WORD = Object.fromEntries(ROLE_OPTIONS);
/** Who can apply, as the canvas's column draws it: three names, then "+N". */
export function whoWords(roles) {
  const names = (Array.isArray(roles) ? roles : []).map((r) => ROLE_WORD[r] || r);
  if (!names.length) return 'No role chosen';
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
}

/** The square's letter when a programme has no logo (D1199's 404). */
export const logoInitial = (name) => (String(name || '').trim().charAt(0) || '?').toUpperCase();

// ---------------------------------------------------------------------------
// The ⋯ menu (TST4m)
// ---------------------------------------------------------------------------

/**
 * The ⋯ menu for one programme. Each item is a link (`to`) or a dialog
 * (`dialog`). A step the Worker would refuse is left out, never drawn
 * disabled: a partner's programme has no Edit (the firm edits it and sends it
 * again), Move to testing is offered on an open or closed one only, and Close
 * on an open or testing one (D812, D1198).
 */
export function menuFor(p) {
  if (!p) return [];
  const hq = p.owner_kind === 'hq';
  const view = { key: 'program', label: 'Open program', to: programHref(p.uid) };
  const history = { key: 'history', label: 'View history', to: programHref(p.uid, 'activity') };
  switch (p.status) {
    case 'draft': return hq
      ? [{ key: 'edit', label: 'Edit…', dialog: 'edit' }, { key: 'open', label: 'Open…', dialog: 'open' }, history]
      : [history];
    case 'submitted': return hq ? [history] : [{ key: 'approve', label: 'Approve…', dialog: 'approve' }, { key: 'reject', label: 'Send back…', dialog: 'reject' }, history];
    case 'approved': return hq ? [history] : [{ key: 'open', label: 'Open…', dialog: 'open' }, history];
    case 'open': return [view, { key: 'close', label: 'Close…', dialog: 'close' }, { key: 'testing', label: 'Move to testing…', dialog: 'testing' }, history];
    case 'closed': return [view, { key: 'testing', label: 'Move to testing…', dialog: 'testing' }, history];
    case 'testing': return [view, { key: 'close', label: 'Close…', dialog: 'close' }, history];
    case 'rejected': return [history];
    default: return [history];
  }
}

// ---------------------------------------------------------------------------
// The dialogs (TST3)
// ---------------------------------------------------------------------------

/**
 * One dialog, A–H. `ctx` holds the programme (`p`) and, for F–H, the
 * application (`a`). Each says what it changes (`lead`), who is told and what
 * is recorded (`rows`, `nw` marking what D1198 made new), its field if any,
 * and its button. `call(api, ctx, value)` is the one request it makes.
 */
export function dialogFor(kind, { p, a = null } = {}) {
  const name = p?.product_name || 'this program';
  const firm = ownerName(p);
  const hq = p?.owner_kind === 'hq';
  const who = a?.name || 'this applicant';
  switch (kind) {
    case 'approve': return {
      key: 'A', title: `Approve ${name} from ${firm}?`,
      lead: 'It does not open yet. You open it when it should take applications.',
      field: { label: 'Note · optional', required: false, placeholder: `Add a note for ${firm}…` },
      rows: [{ t: `${firm} is told in their bell. ${REC}` }],
      confirm: 'Approve', call: (api, _c, note) => api.approve(p.uid, note || null),
      done: `${name} is approved. Open it when it should take applications.`,
    };
    case 'reject': return {
      key: 'B', title: `Send ${name} back to ${firm}?`, lead: null,
      field: { label: 'What should change? · required', required: true, min: 1, placeholder: 'Say what should change before they send it again.' },
      rows: [{ t: `They read your note in their bell and on the program. Their next edit returns it to draft, and they send it again. ${REC}` }],
      confirm: 'Send back', call: (api, _c, note) => api.reject(p.uid, note),
      done: `${name} was sent back to ${firm}.`,
    };
    case 'open': return {
      key: 'C', title: `Open ${name} to applications?`,
      lead: `Members whose profile is listed can apply.${dayWord(p?.closes_at) ? ` Applications close on ${dayWord(p.closes_at)}.` : ' No closing date is set.'}`,
      field: null,
      rows: [hq ? { t: 'No one else is told: it is Axal VC’s own program.' } : { t: `${firm} is told.`, nw: true }, { t: REC }],
      confirm: 'Open', call: (api) => api.open(p.uid),
      done: `${name} is open to applications.`,
    };
    case 'close': return {
      key: 'D', title: `Close ${name}?`,
      lead: 'No new applications. You can still pick and decline. Picked testers keep their place.',
      field: null,
      rows: [hq ? { t: 'No one else is told: it is Axal VC’s own program.' } : { t: `${firm} is told.`, nw: true }, { t: REC }],
      confirm: 'Close program', call: (api) => api.close(p.uid),
      done: `${name} is closed.`,
    };
    case 'testing': return {
      key: 'E', title: `Move ${name} to Testing?`,
      lead: 'Applications stay closed. Picked testers are testing now.',
      field: null,
      rows: [{ t: hq ? 'The picked testers are told.' : `${firm} and the picked testers are told.`, nw: true }, { t: REC }],
      confirm: 'Move to testing', call: (api) => api.startTesting(p.uid),
      done: `${name} is testing now.`,
    };
    case 'pick': {
      const places = Number(p?.places);
      const picked = Number(p?.picked_count);
      const full = Number.isFinite(places) && places > 0 && Number.isFinite(picked) && picked >= places;
      return {
        key: 'F', title: `Pick ${who} for ${name}?`,
        lead: Number.isFinite(places) && places > 0 && Number.isFinite(picked) ? `${Math.min(places, picked + 1)} of ${places} places will be filled.` : 'Places are not recorded for this program.',
        field: null,
        rows: [{ t: 'They are told in their bell. Axal VC Mail writes to them only if they agreed to be emailed.' }, { t: REC }],
        // I · drawn before the request when every place is taken, in the Worker's own sentence (programme_full).
        refusal: full ? FULL : null,
        confirm: 'Pick', call: (api) => api.pick(a.uid),
        done: `${who} is picked.`,
      };
    }
    case 'decline': return {
      key: 'G', title: `Decline ${who} for ${name}?`,
      lead: 'They are told “You were not picked”. You can pick them later while places remain.',
      field: null, rows: [{ t: REC }],
      confirm: 'Decline', call: (api) => api.decline(a.uid),
      done: `${who} is declined.`,
    };
    case 'withdraw': return {
      key: 'H', title: `Withdraw ${who}’s application to ${name}?`, lead: null,
      field: { label: 'Reason · required · 10 to 500 characters', required: true, min: 10, max: 500, placeholder: 'Write the reason they will read…' },
      rows: [{ t: 'If they were picked, their place is freed. They are told. It is recorded under your name.', nw: true }],
      confirm: 'Withdraw application', danger: true, call: (api, _c, reason) => api.withdraw(a.uid, reason),
      done: `${who}’s application is withdrawn.`,
    };
    default: return null;
  }
}

/** The Worker's sentence when a pick finds every place taken (D812 `decide`, `programme_full`). */
export const FULL = 'Every place is taken. Decline someone first.';

/** Whether a dialog's field holds what its button needs. */
export function fieldReady(spec, value) {
  if (!spec?.field) return true;
  const v = String(value ?? '').trim();
  if (!spec.field.required) return v.length <= (spec.field.max ?? Infinity);
  return v.length >= (spec.field.min ?? 1) && v.length <= (spec.field.max ?? Infinity);
}

/** After a step, who was told: counts only, from the Worker's `told`. Null when it says nothing. */
export function toldLine(told) {
  if (!told || typeof told !== 'object') return null;
  const parts = [];
  if (Number.isFinite(Number(told.owner)) && told.owner !== null) parts.push(`${Number(told.owner)} at the firm told`);
  if (Number.isFinite(Number(told.testers)) && told.testers !== null) parts.push(`${Number(told.testers)} picked ${Number(told.testers) === 1 ? 'tester' : 'testers'} told`);
  if (Number.isFinite(Number(told.mail_reach)) && told.mail_reach !== null) parts.push(`Axal VC Mail can reach ${Number(told.mail_reach)}`);
  if (told.member === true) parts.push('the member was told');
  if (told.member === false) parts.push('the member’s bell did not take the notice');
  if (!parts.length) return null;
  const line = `${parts.join(' · ')}.`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// ---------------------------------------------------------------------------
// Programs (TST4)
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 25;
export const SORTS = [
  ['changed_desc', 'Last change, newest first'],
  ['changed_asc', 'Last change, oldest first'],
  ['name', 'Product, A to Z'],
  ['closes', 'Applications close, soonest first'],
];
export const OWNER_FILTERS = [['', 'Any owner'], ['hq', 'Axal VC'], ['partner', 'Partner firms']];
export const PLACES_FILTERS = [['', 'Any places'], ['full', 'Full'], ['not_full', 'Not full']];
export const CLOSES_FILTERS = [['', 'Any closing date'], ['7', 'Close in the next 7 days'], ['30', 'Close in the next 30 days'], ['past', 'Closed in the past']];
/** The status chips, in the canvas's order. */
export const CHIP_ORDER = ['submitted', 'rejected', 'draft', 'approved', 'open', 'testing', 'closed'];

const time = (x) => { const t = Date.parse(String(x ?? '')); return Number.isFinite(t) ? t : null; };

/**
 * The table's rows: searched by product or firm, filtered by status, owner (or
 * one firm, by name), who can apply, places and the closing date, sorted, and
 * paged. `today` is `YYYY-MM-DD`. A programme whose date is not recorded is
 * never in a date window.
 */
export function programsView(items, f = {}, today = new Date().toISOString().slice(0, 10)) {
  const list = Array.isArray(items) ? items : [];
  const q = String(f.q || '').trim().toLowerCase();
  const now = time(today);
  const rows = list.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (f.owner === 'hq' && p.owner_kind !== 'hq') return false;
    if (f.owner === 'partner' && p.owner_kind !== 'partner') return false;
    if (f.firm && ownerName(p) !== f.firm) return false;
    if (f.role && !(Array.isArray(p.eligible_roles) && p.eligible_roles.includes(f.role))) return false;
    if (f.places === 'full' && !(Number(p.places) > 0 && Number(p.picked_count) >= Number(p.places))) return false;
    if (f.places === 'not_full' && !(Number(p.places) > 0 && Number(p.picked_count) < Number(p.places))) return false;
    if (f.closes) {
      const c = time(p.closes_at);
      if (c == null || now == null) return false;
      const days = (c - now) / 86_400_000;
      if (f.closes === 'past' ? days >= 0 : days < 0 || days > Number(f.closes)) return false;
    }
    if (q && !`${p.product_name || ''} ${ownerName(p)}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const by = {
    changed_desc: (a, b) => (time(b.updated_at) ?? -Infinity) - (time(a.updated_at) ?? -Infinity),
    changed_asc: (a, b) => (time(a.updated_at) ?? Infinity) - (time(b.updated_at) ?? Infinity),
    name: (a, b) => String(a.product_name || '').localeCompare(String(b.product_name || '')),
    closes: (a, b) => (time(a.closes_at) ?? Infinity) - (time(b.closes_at) ?? Infinity),
  }[f.sort] || ((a, b) => (time(b.updated_at) ?? -Infinity) - (time(a.updated_at) ?? -Infinity));
  rows.sort(by);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(f.page) || 1), pages);
  const start = (page - 1) * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);
  return {
    rows: shown, total: rows.length, all: list.length, page, pages,
    count: rows.length ? `${start + 1}–${start + shown.length} of ${rows.length}` : `0 of ${list.length}`,
  };
}

/** The status chips over the table: All, then each status with its count. */
export function statusChips(items) {
  const list = Array.isArray(items) ? items : [];
  return [{ status: '', label: `All ${list.length}` }, ...CHIP_ORDER.map((s) => ({ status: s, label: `${statusLabel(s)} ${list.filter((p) => p.status === s).length}` }))];
}

/** The firms the owner filter can narrow to, by name. */
export const firmsOf = (items) => [...new Set((Array.isArray(items) ? items : []).filter((p) => p.owner_kind === 'partner' && p.owner_name).map((p) => p.owner_name))].sort();

/** One row's figures: places as "n of N" once it has opened, applicants once it has opened. */
export function rowFigures(p) {
  const opened = ['open', 'testing', 'closed'].includes(p?.status);
  const places = Number(p?.places);
  return {
    opened,
    places: !Number.isFinite(places) || places <= 0 ? 'Places not recorded' : opened ? `${Number(p.picked_count) || 0} of ${places}` : `${places} places`,
    bar: opened && places > 0 ? Math.min(100, Math.round(((Number(p.picked_count) || 0) / places) * 100)) : null,
    applicants: opened ? String(Number(p?.applicant_count) || 0) : 'Not open yet',
    applications: spanWords(p?.opens_at, p?.closes_at),
    testing: spanWords(p?.testing_starts, p?.testing_ends),
    who: whoWords(p?.eligible_roles),
    changed: dayWord(p?.updated_at) || 'Not recorded',
  };
}

// ---------------------------------------------------------------------------
// Review (TST2)
// ---------------------------------------------------------------------------

/**
 * "Partner firm’s earlier programs: 2 closed, 1 open." from the programme list
 * itself: the same firm's other programmes that have opened, by status. HQ's
 * list carries every firm's programmes, so this is read, never a guess.
 */
export function earlierLine(p, items) {
  if (!p || p.owner_kind !== 'partner') return null;
  const mine = (Array.isArray(items) ? items : []).filter((x) => x.uid !== p.uid && x.owner_kind === 'partner' && x.owner_name && x.owner_name === p.owner_name);
  const counted = ['closed', 'testing', 'open'].map((s) => [s, mine.filter((x) => x.status === s).length]).filter(([, n]) => n > 0);
  const what = counted.length ? counted.map(([s, n]) => `${n} ${statusLabel(s).toLowerCase()}`).join(', ') : 'none yet';
  return `Partner firm’s earlier programs: ${what}.`;
}

/**
 * "Last sent back: 18 Oct 2026." from the programme's own history (D1197's
 * events read), or "never". Null while the history has not answered, and a
 * sentence of its own when it could not be read: never "never" on a failed read.
 */
export function sentBackLine(events) {
  if (events === undefined) return null;
  if (events === false) return 'Its history could not be read, so when it was last sent back is not shown.';
  const rows = Array.isArray(events) ? events : [];
  const last = rows.filter((e) => e.action === 'rejected' || e.action === 'sent_back').map((e) => e.at).filter(Boolean).sort().pop();
  return `Last sent back: ${last ? dayWord(last) : 'never'}.`;
}
