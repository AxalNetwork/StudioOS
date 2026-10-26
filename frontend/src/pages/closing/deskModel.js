/**
 * D1219 (#3216, part 6 of #2424) — the admin desk complete, from the owner's
 * canvas "Closing room" (CP3, CP5–CP8, CP13–CP15, CP21). Pure, so
 * `frontend/test/closings_desk_d1219.test.mjs` holds each rule.
 *
 * WHAT IS READ. The desk is `GET /api/admin/closings` (D1215): every open
 * closing with its lines, lines waiting, committed and received cents, the
 * cap-table state, the owner and the next actor. One closing is
 * `GET /api/closings/:uid`, found from the deal id by `GET /api/closings`.
 * Its paper is D1216's staged envelopes (`/api/legal/esign/staged…`). What no
 * route serves (the money-by-route chart, a closing's step, a route's needs
 * beyond the signed paper, a fund's commitment and release) says "Not read
 * here yet", never a zero.
 *
 * THE PLATFORM NEVER MOVES MONEY. Every act here records. Amounts are integer
 * cents with the closing's currency. Eadwyn never fills money.
 */
import { DESK_PATH, STEPS, daysLeft, SOON_DAYS } from './closingModel.js';

export { DESK_PATH, STEPS, SOON_DAYS };

const cents = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

/** Integer cents in the closing's currency, or null (drawn "Not recorded"), never "$0.00" for a missing figure. */
export function moneyCents(value, currency = 'USD') {
  const c = cents(value);
  if (c == null) return null;
  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2 }).format(c / 100);
  } catch {
    return `${(c / 100).toFixed(2)} ${code}`;
  }
}

// ───────────────────────────────────────────────────────────── CP13, CP21: the desk

/** Who a closing waits on, in the canvas's words. */
export const WHO_WORD = Object.freeze({ admin: 'Studio team', investor: 'Investors', founder: 'Founder' });

/** The desk's rows from `GET /api/admin/closings`, deadline first (the Worker's order is kept as the tie-break). */
export function deskRows(closings, now = new Date()) {
  const list = Array.isArray(closings) ? closings : [];
  return list.filter((c) => c && c.uid).map((c, i) => {
    const deadline = c.deadline ? String(c.deadline).slice(0, 10) : null;
    const left = daysLeft(deadline, now);
    const who = c.next_actor?.who;
    return {
      uid: String(c.uid),
      dealId: c.deal_id,
      href: closingHrefFor(c.deal_id),
      company: c.project_name || null,
      round: c.round_label || null,
      currency: c.currency || 'USD',
      lines: Number.isFinite(Number(c.lines)) ? Number(c.lines) : null,
      waiting: Number.isFinite(Number(c.lines_waiting)) ? Number(c.lines_waiting) : null,
      committed: cents(c.total_cents),
      received: cents(c.received_cents),
      who: WHO_WORD[who] ? who : null,
      whoWord: WHO_WORD[who] || null,
      why: c.next_actor?.why || null,
      deadline,
      left,
      soon: left != null && left >= 0 && left < SOON_DAYS,
      past: left != null && left < 0,
      owner: c.owner_name || null,
      order: i,
    };
  });
}

/** One closing's admin address: the deal id is digits only (D1215 §5 keeps the deal-id address). */
export function closingHrefFor(dealId) {
  return /^[1-9]\d*$/.test(String(dealId)) ? `${DESK_PATH}/${dealId}` : DESK_PATH;
}

export const SORTS = Object.freeze([['deadline', 'Deadline'], ['company', 'Company'], ['committed', 'Committed']]);

/**
 * The desk's search, filters and sort. A closing with no deadline sorts last;
 * a missing committed figure sorts below every recorded one, never as zero.
 */
export function filterDesk(rows, { q = '', who = '', owner = '', sort = 'deadline' } = {}) {
  const needle = String(q).trim().toLowerCase();
  let out = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (needle && !`${r.company || ''} ${r.round || ''}`.toLowerCase().includes(needle)) return false;
    if (who && r.who !== who) return false;
    if (owner && (r.owner || '') !== owner) return false;
    return true;
  });
  const by = {
    deadline: (a, b) => (a.deadline == null) - (b.deadline == null) || String(a.deadline || '').localeCompare(String(b.deadline || '')) || a.order - b.order,
    company: (a, b) => String(a.company || '￿').localeCompare(String(b.company || '￿')) || a.order - b.order,
    committed: (a, b) => (a.committed == null) - (b.committed == null) || (b.committed ?? 0) - (a.committed ?? 0) || a.order - b.order,
  }[sort] || null;
  if (by) out = [...out].sort(by);
  return out;
}

/** The owners the Owner filter offers: each recorded name once, in order. */
export function ownersOf(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The first day of the quarter `now` is in, as YYYY-MM-DD (UTC). */
export function quarterStart(now = new Date()) {
  const m = now.getUTCMonth() - (now.getUTCMonth() % 3);
  return `${now.getUTCFullYear()}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * CP13's tiles. Open and the three "waiting on" counts come from the desk;
 * Closed this quarter from `GET /api/closings` (every closing, for an admin).
 * A read that failed gives null for its tiles, drawn "Unreadable", never 0.
 */
export function deskTiles(rows, all, now = new Date()) {
  const desk = Array.isArray(rows) ? rows : null;
  const count = (who) => (desk ? desk.filter((r) => r.who === who).length : null);
  const since = quarterStart(now);
  const closed = Array.isArray(all)
    ? all.filter((c) => c?.status === 'closed' && c.closed_at && String(c.closed_at).slice(0, 10) >= since).length
    : null;
  return [
    { key: 'open', label: 'Open', value: desk ? desk.length : null, sub: 'closings' },
    { key: 'admin', label: 'Waiting on the studio team', value: count('admin'), sub: 'closings' },
    { key: 'investor', label: 'Waiting on investors', value: count('investor'), sub: 'closings' },
    { key: 'founder', label: 'Waiting on the founder', value: count('founder'), sub: 'closings' },
    { key: 'closed', label: 'Closed this quarter', value: closed, sub: `since ${since}` },
  ];
}

/**
 * The deals an Admin may open a closing for: every deal not already holding
 * an open closing, nearest deadline first, then by name.
 */
export function openableDeals(deals, closings) {
  const busy = new Set((Array.isArray(closings) ? closings : []).filter((c) => c?.status === 'open').map((c) => Number(c.deal_id)));
  return (Array.isArray(deals) ? deals : [])
    .filter((d) => d && /^[1-9]\d*$/.test(String(d.id)) && !busy.has(Number(d.id)))
    .map((d) => ({ id: Number(d.id), name: d.project_name || 'Venture not recorded', instrument: d.instrument || null, deadline: d.closing_deadline ? String(d.closing_deadline).slice(0, 10) : null }))
    .sort((a, b) => (a.deadline == null) - (b.deadline == null) || String(a.deadline || '').localeCompare(String(b.deadline || '')) || a.name.localeCompare(b.name));
}

/** The closing an address names: the deal's open closing, else its newest. */
export function closingForDeal(list, dealId) {
  const mine = (Array.isArray(list) ? list : []).filter((c) => Number(c?.deal_id) === Number(dealId));
  return mine.find((c) => c.status === 'open') || mine[0] || null;
}

// ───────────────────────────────────────────────────────────── CP14: one closing

/** A line's status in the canvas's words (D1215: Received only on the receiving side's evidence). */
export const LINE_STATUS = Object.freeze({ open: 'Waiting for money', sent: 'Sent, not yet confirmed', received: 'Received', withdrawn: 'Withdrawn' });
export const lineStatus = (s) => LINE_STATUS[s] || 'Not recorded';

/** The four capital routes (D1215's `ROUTES`), in the canvas's order and words. */
export const ROUTES = Object.freeze(['direct', 'syndicate', 'axal_fund', 'third_party_fund']);
export const ROUTE_WORD = Object.freeze({ direct: 'Direct', syndicate: 'Syndicate (SPV)', axal_fund: 'Axal VC fund', third_party_fund: 'Third-party fund' });
export const routeWord = (r) => ROUTE_WORD[r] || null;

/** One closing's figures. Received sums received lines only; withdrawn lines count nowhere. */
export function closingFigures(closing) {
  const lines = Array.isArray(closing?.lines) ? closing.lines : [];
  const live = lines.filter((l) => l.status !== 'withdrawn');
  return {
    lines: live.length,
    committed: cents(closing?.total_cents),
    received: live.filter((l) => l.status === 'received').reduce((n, l) => n + (cents(l.amount_cents) ?? 0), 0),
    waiting: live.filter((l) => l.status !== 'received').length,
    noRoute: live.filter((l) => !l.route).length,
  };
}

// ───────────────────────────────────────────────────────────── CP14, CP7: Axal acts

/** The three Super Admin acts of D1215 §3, and Fund admin's capital call. */
export const ACT_FALLBACK = Object.freeze({
  'closing.countersign': 'A Super Admin countersigns a closing for an Axal entity.',
  'fund_investment.commit': 'A Super Admin commits fund money to a company.',
  'fund_investment.release': 'A Super Admin records that the fund released the investment.',
  'capital_call.issue': 'A Super Admin issues capital calls.',
});
export const STEP_UP_LINE = 'Requires your authenticator code';
export const NO_ROUTE_YET = 'No route records this yet (D1215 §3), so it is not done here.';

/**
 * Whether this viewer's control for a Super Admin act is live. Only a Super
 * Admin whom the act table does not refuse; an Admin never, whatever the table
 * says or if it failed to read.
 */
export function actControl(user, access, act) {
  const superAdmin = Number(user?.is_super_admin ?? 0) === 1;
  const row = Array.isArray(access?.acts) ? access.acts.find((a) => a?.act === act) : null;
  if (!superAdmin) return { enabled: false, sentence: row?.sentence || ACT_FALLBACK[act] || 'Only a Super Admin can do this.' };
  if (row && row.allowed === false) return { enabled: false, sentence: row.sentence || ACT_FALLBACK[act] };
  return { enabled: true, sentence: STEP_UP_LINE };
}

/**
 * The staged envelopes on a line whose Axal stage waits for its release
 * (D1216). Only Axal's stage ever reads `awaiting_release` (`viewOf`).
 */
export function awaitingRelease(envelopes) {
  return (Array.isArray(envelopes) ? envelopes : []).filter((e) => !e?.voided && Array.isArray(e?.stages)
    && e.stages.some((s) => s.state === 'awaiting_release'));
}

/** A line's paper in one phrase, from its staged envelopes, newest first. */
export function paperWord(envelopes) {
  const list = (Array.isArray(envelopes) ? envelopes : []).filter((e) => !e?.voided);
  if (!list.length) return 'No paper sent';
  const e = list[0];
  if (e.complete) return 'Signed';
  if (e.stages?.some((s) => s.state === 'declined')) return 'Declined';
  if (e.stages?.some((s) => s.state === 'awaiting_release')) return 'Waiting for Axal’s countersign';
  const done = (e.stages || []).filter((s) => s.state === 'signed').length;
  return `Signing · ${done} of ${(e.stages || []).length} signed`;
}

// ───────────────────────────────────────────────────────────── CP5: choose the route

/**
 * What each route needs, as CP5 lists them. Only the signed paper is read
 * here (D1216's envelopes); every other need has no read yet and says so.
 */
export const ROUTE_NEEDS = Object.freeze({
  direct: { line: 'The investor pays the company. You need the company’s receiving account.', needs: ['Receiving account'] },
  syndicate: { line: 'Members sign the SPV Joinder and pay the SPV; the SPV pays the company.', needs: ['Joinders signed', 'Members’ identity checks', 'SPV receiving account'] },
  axal_fund: { line: 'The fund invests. If it needs cash, Fund admin calls its LPs first.', needs: ['Countersign for Axal: a Super Admin', 'Fund cash: read in Fund admin'] },
  third_party_fund: { line: 'Another fund invests. StudioOS keeps a record and the evidence of the transfer only.', needs: ['Business check', 'Receiving account'] },
});

/** The vehicle a route names, and what to ask for it. Direct names none. */
export const VEHICLE_ASK = Object.freeze({
  syndicate: 'The SPV this line goes through',
  axal_fund: 'The Axal VC fund that invests',
  third_party_fund: 'The fund that invests, by its legal name',
});

/** A syndicate's vehicle reference, and the syndicate id one names. */
export const syndicateRef = (id) => `syndicate:${Number(id)}`;
export function syndicateIdOf(ref) {
  const m = /^syndicate:([1-9]\d*)$/.exec(String(ref || ''));
  return m ? Number(m[1]) : null;
}

/** The PUT body for a route: a vehicle is required for every route but Direct, and trimmed to 120. */
export function routeBody(route, vehicle) {
  if (!ROUTES.includes(route)) return { error: 'Choose a route.' };
  const v = String(vehicle ?? '').trim().slice(0, 120);
  if (route !== 'direct' && !v) return { error: `${VEHICLE_ASK[route]} is not named yet.` };
  return { route, vehicle_ref: route === 'direct' ? null : v };
}

// ───────────────────────────────────────────────────────────── CP15: activity

/** Each `closing_events` name (D1215), its words and its step (1–7), or null for none. */
export const EVENT_WORD = Object.freeze({
  opened: ['Opened the closing', 1],
  line_added: ['Added a line', 1],
  route_set: ['Set a line’s route', 3],
  line_withdrawn: ['Withdrew a line', null],
  evidence_added: ['Recorded evidence on a line', 5],
  evidence_withdrawn: ['Withdrew evidence on a line', 5],
  captable_accepted: ['Accepted the cap-table proposal', 6],
  captable_dismissed: ['Dismissed the cap-table proposal', 6],
  closed: ['Marked the closing Closed', 7],
});

/** The activity rows, newest first, with each one's step. The log holds no amount, name or account number. */
export function activityRows(events) {
  const list = Array.isArray(events) ? events : [];
  return list.map((e, i) => {
    const known = EVENT_WORD[e?.event];
    const route = e?.event === 'route_set' ? routeWord(String(e.source_ref || '').replace(/^route:/, '')) : null;
    return {
      key: `${i}-${e?.event}`,
      at: e?.created_at || null,
      actor: Number.isInteger(Number(e?.actor_user_id)) && Number(e.actor_user_id) > 0 ? Number(e.actor_user_id) : null,
      words: known ? (route ? `${known[0]} to ${route}` : known[0]) : 'Recorded an event this page does not name',
      step: known ? known[1] : null,
      source: e?.source_ref || null,
      order: i,
    };
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || b.order - a.order);
}

export const filterActivity = (rows, step) => (step ? rows.filter((r) => r.step === step) : rows);

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // A cell that starts with = + - @ is read as a formula by a spreadsheet: quote it as text.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The activity as CSV, the rows exactly as drawn. */
export function activityCsv(rows) {
  const head = ['When', 'Account', 'What', 'Step', 'Source'];
  const body = (Array.isArray(rows) ? rows : []).map((r) => [r.at, r.actor ?? '', r.words, r.step ? `${r.step} ${STEPS[r.step - 1]}` : '', r.source]);
  return [head, ...body].map((row) => row.map(csvCell).join(',')).join('\n');
}

// ───────────────────────────────────────────────────────────── CP3: prepare the paper

/** The closing papers, as CP3 lists them. Counsel's text is the template store's; a type without it is a counsel draft. */
export const PAPERS = Object.freeze([
  { group: 'Portfolio', type: 'safe', label: 'SAFE' },
  { group: 'Portfolio', type: 'term_sheet', label: 'Term Sheet' },
  { group: 'Portfolio', type: 'stock_purchase_agreement', label: 'Stock Purchase Agreement' },
  { group: 'Fund', type: 'subscription_agreement', label: 'Subscription Agreement' },
  { group: 'Fund', type: 'spv_joinder', label: 'SPV Joinder' },
  { group: 'Fund', type: 'co_investment_side_letter', label: 'Co-Investment Side Letter' },
  { group: 'Fund', type: 'strategic_side_letter', label: 'Strategic Side Letter / Focused SPV' },
]);

/** A merge field that is money: Eadwyn never proposes it, and only a sourced figure fills it. */
export const isMoneyField = (key) => /amount|price|cap\b|valuation|discount|fee|carry|cents|dollars|investment|commitment/i.test(String(key || ''));

/** `purchase_amount` → "Purchase amount". */
export const fieldLabel = (key) => {
  const w = String(key || '').replace(/[._]+/g, ' ').trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/**
 * The fields the paper leaves open, each with the value a read gives it and
 * that read's name, or empty. Only three facts are sourced here: the company
 * from the deal, the investor and the purchase amount from the line. Every
 * other field is typed by the Admin; a money field is never proposed.
 */
export function paperFields(unfilled, { company, investor, amountCents, currency } = {}) {
  const amount = moneyCents(amountCents, currency);
  const source = (key) => {
    const k = String(key).toLowerCase();
    if (/^company(_name)?$/.test(k) && company) return { value: company, from: 'From the deal' };
    if (/^investor(_name)?$/.test(k) && investor) return { value: investor, from: 'From the line' };
    if (/^(purchase_amount|investment_amount|amount)$/.test(k) && amount) return { value: amount, from: 'From the line' };
    return { value: '', from: null };
  };
  return (Array.isArray(unfilled) ? unfilled : []).map((key) => ({ key, label: fieldLabel(key), money: isMoneyField(key), ...source(key) }));
}

/** The signers CP3 sends, in order: the company, then the investor; Axal is added last through `countersign` (D1216). */
export function signersFor({ founderUserId, investorUserId } = {}) {
  const out = [];
  if (Number.isInteger(Number(founderUserId)) && Number(founderUserId) > 0) out.push({ role: 'company', user_id: Number(founderUserId) });
  if (Number.isInteger(Number(investorUserId)) && Number(investorUserId) > 0) out.push({ role: 'investor', user_id: Number(investorUserId) });
  return out;
}

export const NOT_YET = 'Not read here yet';

/** What the desk and one closing draw that no read carries yet. Never a zero. */
export const DESK_WAITS = Object.freeze({
  chart: 'Money by route, closed per month, is not read here yet: the desk reads open closings, and no read sums closed lines by route and month.',
  step: 'Each closing’s step is not read here yet: the desk carries who acts next, drawn as Waiting on.',
  eadwyn: 'Eadwyn’s proposals for this paper are not read here yet. Eadwyn never fills money: an amount, cap, discount, carry or fee comes from the deal, the line or the cap table.',
  needs: 'Only the signed paper is read here. The receiving account, the identity and business checks, the joinders and the fund’s cash are not read here yet.',
  fundCommit: 'Whether fund money is committed is not read here yet: no route records it (D1215 §3).',
  fundRelease: 'Whether the investment was released is not read here yet: no route records it (D1215 §3).',
  position: 'Whether a position names this line is not read here yet.',
  members: 'The SPV’s joinders, its members’ identity checks and what each member paid the SPV are not read here yet.',
  thirdParty: 'The fund’s manager, legal name, jurisdiction and business check have no store yet; only its name is recorded, as the line’s vehicle.',
  actor: 'An account is named by its number: the activity log holds no name.',
});

/** Whether Mark Closed applies, and why not (D1215's `completeClosing` rule, read before it is asked). */
export function closeState(closing) {
  if (!closing || closing.status !== 'open') return { ok: false, why: 'This closing is closed, so nothing on it changes.' };
  const s = closing.captable?.state;
  if (s === 'accepted' || s === 'dismissed') return { ok: true, why: null };
  if (s === 'proposed') return { ok: false, why: 'The founder has not decided the cap-table proposal yet.' };
  return { ok: false, why: 'Every line must be received or withdrawn, with one received, before the closing closes.' };
}

export const FUND_CALLS_PATH = '/admin/fund-admin/calls';
