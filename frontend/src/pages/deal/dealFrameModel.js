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

/** What changed, in words, from part 2's `whats-new` (types and times only).
 *  One sentence for every type the Worker sends (D6170); a test reads the
 *  Worker's list from deal_context.ts and fails when the two differ. The
 *  route serves the investor only, so each sentence speaks to that investor
 *  and names no other investor or amount. */
export const CHANGE_WORDS = {
  deal: 'The deal’s status changed',
  deck: 'The founder shared a new deck version with you',
  document: 'A document was added',
  firm_note: 'A note was added at your firm',
  investor_commitment: 'An investor committed',
  diligence_answer: 'The founder answered a diligence request',
  invitation: 'Your invitation changed',
  member: 'You joined the deal room',
  dd: 'Your diligence case was updated',
  ic: 'The IC record on this deal changed',
  commitment: 'Your commitment changed',
  envelope: 'Your signing papers moved',
  funded: 'Your money was received',
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
 * #6193 (D6193, DL14): the activity's chips, in canvas order. `Mine` is the investor's own rows (the Notes tab
 * only). The other three narrow on the row's `kind` from the Worker; a row with no kind is Deal, as the Worker
 * classes it.
 */
export const ACTIVITY_FILTERS = [
  ['all', 'All'], ['mine', 'Mine'], ['deal', 'Deal'], ['documents', 'Documents'], ['diligence', 'Diligence'],
];

/** The rows one chip shows. */
export function activityShown(events, filter) {
  const rows = Array.isArray(events) ? events : [];
  if (filter === 'mine') return rows.filter((e) => e.mine);
  if (filter === 'deal' || filter === 'documents' || filter === 'diligence') return rows.filter((e) => (e.kind || 'deal') === filter);
  return rows;
}

/**
 * What an empty chip says. A narrowed list that is empty is what this reader can see, never a claim that
 * nothing happened: documents sit behind the venture's NDA, and a diligence case is read by its own team.
 */
export function activityEmpty(filter) {
  if (filter === 'mine') return 'None of your own activity on this deal is recorded.';
  if (filter === 'deal') return 'No deal activity you can read is recorded.';
  if (filter === 'documents') return 'No document activity you can read is recorded. Documents show once you hold the venture’s NDA.';
  if (filter === 'diligence') return 'No diligence activity you can read is recorded. A case shows to its own owner and reviewers.';
  return EMPTY.activity;
}

/**
 * Eadwyn's draft (DL14). #4046: Ask on New note drafts a note from the deal's company and stage and your
 * firm's notes. #6194: the card drafts a deal summary on request, from what this investor may read (the
 * deal's terms, the shared evidence, their own diligence case, their firm's notes); it is "Not saved"
 * until Save as my note, and Discard writes no note.
 */
export const EADWYN_DRAFT_WAITS = 'Ask on New note drafts a note from this deal’s company and stage and your firm’s notes. Nothing lands until you save it as your note.';
export const EADWYN_DRAFT = Object.freeze({
  eye: 'Eadwyn · draft',
  title: 'Draft: deal summary from the evidence and diligence so far',
  line: 'Eadwyn reads only what you may read here: the deal’s terms, the evidence the founder shared with you, your own diligence case and your firm’s notes. Nothing behind an unsigned NDA is used. It drafts only when you ask, and nothing lands until you save it as your note.',
  ask: 'Draft a deal summary',
  running: 'Drafting from what is on record…',
  mark: 'Eadwyn’s draft · Not saved',
  save: 'Save as my note',
  discard: 'Discard',
  again: 'Try again',
  empty: 'Eadwyn drafted no summary from what is on record. Nothing was saved.',
  aiOff: 'AI assistance is off on this page.',
  unreadable: 'Whether Eadwyn can draft here could not be read. Nothing was asked.',
  unavailable: 'Eadwyn cannot draft on this deal for you.',
});
/** #6194: how each source's state reads beside its name. */
export const DRAFT_SOURCE_STATE = Object.freeze({ used: 'Used', none: 'None on record', not_shared: 'Not shared', unreadable: 'Unreadable' });
/** #6194: the sources a draft names, as rows; an unknown state reads Unreadable, never Used. */
export function draftSourceRows(sources) {
  return (Array.isArray(sources) ? sources : []).filter((s) => s && s.key).map((s) => ({
    key: String(s.key), label: String(s.label || s.key), state: Object.hasOwn(DRAFT_SOURCE_STATE, s.state) ? s.state : 'unreadable',
    word: DRAFT_SOURCE_STATE[s.state] || DRAFT_SOURCE_STATE.unreadable, note: String(s.note || ''),
  }));
}

/** DL24a: the scorecard strip's slot until SCORING's per-deal read exists (#2428). */
export const DECK_SLOT = {
  eye: 'Pitch deck studio canvas',
  title: 'Deck',
  line: 'The deck shows here once a per-deal deck grant exists; today a deck opens through its share link.',
};
