/**
 * D1152 (#3057, part 4 of #2421) — the deal page's frame as pure functions:
 * the stage track and its one next action (DL2), what is new and the terms
 * at a glance (DL1's Overview); since D4815 part 4 (#5903, DE04) the header,
 * the investor's progress chip, the one financial strip and Your position, the notes' tags (DL14) and
 * the states (DL18–DL22). No React here, so `node --test` loads it alone.
 *
 * THE TRACK IS PART 2's READ. `GET /api/deals/:id/stage` (D1150) returns
 * `my_stage` (one of the eight steps, "You passed", "Passed by the studio",
 * or null with a reason), ONE `next_action` and `ic.state`. It carries no
 * dates, so a done step says Done, the current one Now, and a step ahead a
 * dash: a date the Worker did not send is never drawn. A firm with no IC
 * record reads its IC step "Not recorded" once it is past it, as DL2e–g do.
 *
 * NEVER A ZERO FOR A MISSING VALUE. Every figure the deal read lacks is
 * "Not recorded" with its reason; a read that failed is "Unreadable".
 */
import { dealMoney, roundAsk } from '../../components/deals/dealMoney.js';

export const STEPS = ['Invited', 'Reviewing', 'Diligence', 'IC', 'Terms', 'Committed', 'Signed', 'Funded'];
export const YOU_PASSED = 'You passed';
export const STUDIO_PASSED = 'Passed by the studio';
const IC_STEP = STEPS.indexOf('IC');

/** What each step asks of you, in the canvas's words without its sample figures. */
export const WHY = {
  Invited: 'You were invited to this deal. Say whether you’re interested.',
  Reviewing: 'The data room opens when the founder grants you access.',
  Diligence: 'The diligence case is open. Your section and the requests to the founder are there.',
  IC: 'Your firm’s IC record holds the memo and the votes.',
  Terms: 'The terms are ready for you to review.',
  Committed: 'Your commitment is recorded. Signing happens in the closing room.',
  Signed: 'You signed. The closing room holds the payment instructions.',
  Funded: 'Your money was received. The company now reports to you.',
};

/**
 * The track from the stage read: `{ state }` is `loading`, `unreadable`,
 * `none` (no progress fact, with the Worker's reason) or `ready`. A ready
 * track has the eight steps, at most one current step, and exactly one next
 * action — the Worker's, never a second one made up here.
 */
export function trackOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const r = read.data || {};
  const next = r.next_action && r.next_action.label ? r.next_action : null;
  if (r.my_stage == null) return { state: 'none', reason: r.reason || 'No progress on this deal is recorded for you.', next };
  const passed = r.my_stage === YOU_PASSED || r.my_stage === STUDIO_PASSED ? r.my_stage : null;
  const cur = passed ? -1 : STEPS.indexOf(r.my_stage);
  const icUnused = r.ic?.state === 'not_used';
  const steps = STEPS.map((word, i) => {
    // IC is a firm's own step: with no IC record, a step behind you is not recorded, not done.
    const kind = passed ? 'ahead'
      : i === IC_STEP && icUnused && cur > IC_STEP ? 'nr'
        : i < cur ? 'done' : i === cur ? 'now' : 'ahead';
    const line = { done: 'Done', now: 'Now', ahead: '—', nr: 'Not recorded' }[kind];
    return { word, kind, line, label: `Step ${i + 1} of ${STEPS.length}, ${word}, ${{ done: 'done', now: 'now', ahead: 'ahead', nr: 'not recorded' }[kind]}` };
  });
  return {
    state: 'ready',
    stage: r.my_stage,
    current: cur,
    passed,
    steps,
    next,
    why: passed ? (passed === YOU_PASSED ? 'You passed on this deal.' : 'The studio closed this deal. Nothing more to do.') : WHY[r.my_stage] || null,
    icNote: icUnused ? r.ic?.reason || 'No IC record is recorded for this firm.' : null,
  };
}

/**
 * D4815 part 4 (#5903, board DE04): the page's header, in the canvas's order.
 * Back to Deals (a founder goes back to Capital relationships, as before);
 * the venture; its sector and place; the company-stage chip; the website.
 * The deal read (`GET /api/deals/:id`) carries the sector (`project_sector`)
 * and the deal's website (`deals.website`). It carries no place and no
 * company stage, so each says Not recorded and names why; neither is made up
 * from another field. A website is only ever an http(s) address.
 */
export const NO_PLACE = 'The deal read carries no place for this company.';
export const NO_COMPANY_STAGE = 'The deal read carries no company stage.';

export function backOf(role) {
  return role === 'founder' ? { path: '/raise/capital-relationships', label: 'Back to Capital relationships' } : { path: '/deals', label: 'Back to Deals' };
}

export function websiteHref(raw) {
  const v = String(raw ?? '').trim();
  if (!v || /\s/.test(v)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.href : null;
  } catch { return null; }
}

export function headerOf(deal) {
  const sector = deal?.project_sector ? String(deal.project_sector) : null;
  return {
    name: deal?.project_name || `Deal #${deal?.id ?? ''}`,
    sector: sector || 'Sector not recorded',
    sectorMissing: !sector,
    place: 'Place not recorded',
    placeMissing: true,
    placeReason: NO_PLACE,
    stage: { value: 'Not recorded', missing: true, reason: NO_COMPANY_STAGE },
    website: websiteHref(deal?.website),
  };
}

/**
 * The investor's progress, its own element in the header ("Diligence · Step 3
 * of 8"), from the same stage read as the sequence. Nothing is drawn as a step
 * the read did not name.
 */
export function progressChip(track) {
  if (!track || track.state === 'loading') return { state: 'loading', text: 'Reading your step…' };
  if (track.state === 'unreadable') return { state: 'unreadable', text: 'Your step: Unreadable' };
  if (track.state === 'none') return { state: 'none', text: 'No step recorded for you' };
  if (track.passed) return { state: 'passed', text: track.passed };
  return { state: 'ready', text: `${track.stage} · Step ${track.current + 1} of ${STEPS.length}` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A recorded date as "20 Dec 2026"; null when the value is not a date. */
export function closesOn(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const blank = (v) => v == null || v === '';

/**
 * The one financial strip (DE04): Round, Instrument, Committed, Minimum,
 * Closes, every figure from the deal read and nowhere else above the fold.
 * A field the deal does not hold is Not recorded; a field it holds that
 * cannot be read as what it is (an amount that is not a number, a currency
 * that is not a code, a date that is not a date) is Unreadable. Never 0 for
 * either. Committed is the round's confirmed total across every investor,
 * said as such, and never the viewer's own commitment.
 */
export function financialStrip(deal) {
  const cur = deal?.currency || 'USD';
  const money = (v) => (blank(v) ? { state: 'nr' } : dealMoney(v, cur) ? { state: 'value', value: dealMoney(v, cur) } : { state: 'ur' });
  const ask = roundAsk(deal);
  const askRaw = !blank(deal?.target_raise) ? deal.target_raise : deal?.amount;
  const round = ask != null ? money(ask) : blank(askRaw) ? { state: 'nr' } : { state: 'ur' };
  const instrument = blank(deal?.instrument) ? { state: 'nr' } : { state: 'value', value: String(deal.instrument) };
  const closes = blank(deal?.closing_deadline) ? { state: 'nr' } : closesOn(deal.closing_deadline) ? { state: 'value', value: closesOn(deal.closing_deadline) } : { state: 'ur' };
  const cells = [
    ['round', 'Round', round, 'No round size is recorded on this deal.'],
    ['instrument', 'Instrument', instrument, 'No instrument is recorded on this deal.'],
    ['committed', 'Committed', money(deal?.capital_committed), 'No committed total is recorded on this deal.'],
    ['minimum', 'Minimum', money(deal?.minimum_check), 'No minimum check is recorded on this deal.'],
    ['closes', 'Closes', closes, 'No closing date is recorded on this deal.'],
  ];
  return cells.map(([key, label, c, why]) => ({
    key, label, state: c.state,
    value: c.state === 'value' ? c.value : c.state === 'nr' ? 'Not recorded' : 'Unreadable',
    reason: c.state === 'nr' ? why : c.state === 'ur' ? `The ${label.toLowerCase()} on this deal could not be read. That is not a claim that none is recorded.` : null,
    sub: key === 'committed' && c.state === 'value' ? 'Confirmed, all investors' : null,
  }));
}

/**
 * Your position (DE04), and the one rule that keeps it yours: a row is the
 * viewer's commitment only when it is theirs (`investor_user_id`), on this
 * deal, live (pending or confirmed), and held in the firm context the Worker
 * read under (`in_context` true and its `company_id` that context). A row
 * from a read for another deal or another selected firm is not drawn: the
 * page reads again and shows Reading until it lands. Another firm's
 * commitment, or another investor's, is never shown as the viewer's.
 */
export function viewerCommitment(read, { userId, dealId, firmId } = {}, currency = 'USD') {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (dealId !== undefined && read.dealId !== undefined && String(read.dealId) !== String(dealId)) return { state: 'loading' };
  if (firmId !== undefined && read.firmId !== undefined && String(read.firmId ?? '') !== String(firmId ?? '')) return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const rows = Array.isArray(read.items) ? read.items : [];
  const own = rows.find((r) => r
    && userId != null && String(r.investor_user_id) === String(userId)
    && (dealId === undefined || String(r.deal_id) === String(dealId))
    && (r.status === 'pending' || r.status === 'confirmed')
    && r.in_context === true
    && String(r.company_id ?? '') === String(r.firm_context ?? ''));
  if (!own) return { state: 'none' };
  return {
    state: 'ready',
    amount: dealMoney(own.amount, currency) || 'Not recorded',
    status: own.status === 'confirmed' ? 'Confirmed' : 'Pending',
    firm: own.company_id == null ? 'Held in your own name.' : `Held for ${own.company_name || 'your firm'}.`,
  };
}

/** The terms at a glance (DL1), each from the deal or Not recorded; the strip's figures are not repeated. */
export function termsAtGlance(deal) {
  const cur = deal?.currency || 'USD';
  const pct = (v) => (v == null || v === '' ? null : `${v}%`);
  // D4815 part 4: Instrument and Minimum are the strip's; DE04 draws each figure once above the fold.
  return [
    ['Valuation cap', dealMoney(deal?.valuation_cap, cur)],
    ['Carry', pct(deal?.carry_pct)],
    ['Management fee', pct(deal?.management_fee_pct)],
  ].map(([label, value]) => ({ label, value: value ?? 'Not recorded', missing: value == null }));
}

/** What changed, in words, from part 2's `whats-new` (types and times only). */
export const CHANGE_WORDS = {
  deal: 'The deal’s status changed',
  document: 'A document was added',
  firm_note: 'A note was added at your firm',
  investor_commitment: 'An investor committed',
  diligence_answer: 'The founder answered a diligence request',
};

export function whatsNewOf(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const r = read.data || {};
  if (r.first_visit) return { state: 'first', line: 'This is your first look, so there is nothing to compare yet. Changes show here from your next visit.' };
  const rows = (r.changes || []).map((c) => ({ text: CHANGE_WORDS[c.type] || 'Something changed', at: c.at ? String(c.at).slice(0, 10) : 'Date not recorded' }));
  return { state: 'ready', since: r.since ? String(r.since).slice(0, 10) : null, rows, unavailable: (r.unavailable || []).map((u) => u.reason) };
}

/** How a failed deal read is drawn: not on the deal (DL22a), gone, or unreadable (DL20b). */
export function readFailure(err) {
  const s = Number(err?.status);
  if (s === 403) return 'not_on_deal';
  if (s === 404) return 'not_found';
  return 'unreadable';
}

/** DL22: the words for a viewer who cannot open a deal page, before any read. */
export const NO_PERMISSION = {
  not_on_deal: { title: 'You’re not on this deal.', line: 'Deals open to investors the studio invites.', action: { text: 'Back to Deals', to: '/deals' } },
  advisor: { title: 'Deal pages are for investors.', line: 'If you’re reviewing this company, open your diligence section.', action: { text: 'My reviews', to: '/due-diligence' } },
  exploring: { title: 'Deal pages open once you set up an investor profile.', line: 'An Explorer has no investor profile yet.', action: { text: 'Set up your profile', to: '/account/profile' } },
};
export const NOT_FOUND = { title: 'This deal is not here.', line: 'It may have been removed, or the address is wrong.' };
export const DEAL_UNREADABLE = 'This deal could not be read. That is not the same as it not existing.';

/** The roles that never read a deal: their DL22 card is drawn with no request. */
export function blockedRole(role) {
  return role === 'advisor' || role === 'exploring' ? role : null;
}

/** DL14: a note's tags, and the one rule a body must meet before it is sent. */
export const NOTE_TAGS = ['Thesis', 'Risk', 'Question', 'Decision'];
export const NOTE_MAX = 10000;
export function noteError(body) {
  const b = String(body ?? '').trim();
  if (!b) return 'Write the note first.';
  if (b.length > NOTE_MAX) return `Keep a note to ${NOTE_MAX.toLocaleString('en-US')} characters.`;
  return null;
}

/** DL18c and the activity's empty line. */
export const EMPTY = {
  notes: { title: 'No notes yet.', line: 'Write one below. Only you and your firm read them.' },
  activity: 'No activity on this deal yet.',
};

/**
 * Eadwyn's draft (DL14) is AUTOFILL's proposal (#2431). #4046: it arrives through Ask on New note, drawn
 * from the deal's company and stage and your firm's notes; a summary of the deal's whole record is not read yet.
 */
export const EADWYN_DRAFT_WAITS = 'Ask on New note drafts a note from this deal’s company and stage and your firm’s notes. Nothing lands until you save it as your note. A summary of the deal’s whole record is not read here yet.';

/** DL24a: the scorecard strip's slot until SCORING's per-deal read exists (#2428). */
export const DECK_SLOT = {
  eye: 'Pitch deck studio canvas',
  title: 'Deck',
  line: 'The deck shows here once a per-deal deck grant exists; today a deck opens through its share link.',
};
