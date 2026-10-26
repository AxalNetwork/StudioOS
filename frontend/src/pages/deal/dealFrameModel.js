/**
 * D1152 (#3057, part 4 of #2421) — the deal page's frame as pure functions:
 * the stage track and its one next action (DL2), the key strip (DL1), what is
 * new and the terms at a glance (DL1's Overview), the notes' tags (DL14) and
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
import { dealMoney } from '../../components/deals/dealMoney.js';

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

const notRecorded = (reason) => ({ value: 'Not recorded', missing: true, reason });

/**
 * The key strip (DL1): the round, what is committed, your commitment (an
 * investor) or how many investors (staff and the founder), and when it
 * closes. `mine` is the commitments read: `{ status, items }`.
 */
export function keyStrip(deal, mine, role) {
  const cur = deal?.currency || 'USD';
  const target = dealMoney(deal?.target_raise ?? deal?.amount, cur);
  const committed = dealMoney(deal?.capital_committed, cur);
  const pct = Number.isFinite(Number(deal?.progress_pct)) && deal?.progress_pct != null ? Math.max(0, Math.min(100, Number(deal.progress_pct))) : null;
  const tiles = [
    { key: 'round', label: 'Round', ...(target ? { value: target } : notRecorded('No round size is recorded on this deal.')), sub: deal?.instrument || 'Instrument not recorded' },
    { key: 'committed', label: 'Committed', ...(committed ? { value: committed } : notRecorded('No committed total is recorded.')), sub: pct == null ? 'Share of the round not recorded' : `${pct}% of the round`, bar: pct },
  ];
  if (role === 'investor') {
    const own = Array.isArray(mine?.items) ? mine.items.find((c) => c.status === 'pending' || c.status === 'confirmed') : null;
    tiles.push(mine?.status === 'unreadable'
      ? { key: 'mine', label: 'Your commitment', value: 'Unreadable', missing: true, reason: 'Your commitment could not be read. That is not a claim that you have none.' }
      : mine?.status !== 'ready' ? { key: 'mine', label: 'Your commitment', value: '', loading: true, sub: 'Reading…' }
        : own ? { key: 'mine', label: 'Your commitment', value: dealMoney(own.amount, cur) || 'Not recorded', sub: own.status === 'confirmed' ? 'Confirmed' : 'Pending' }
          : { key: 'mine', label: 'Your commitment', value: '—', sub: 'Not committed yet' });
  } else {
    const all = Array.isArray(mine?.items) ? mine.items.filter((c) => c.status === 'pending' || c.status === 'confirmed') : null;
    tiles.push(mine?.status === 'unreadable'
      ? { key: 'investors', label: 'Investors', value: 'Unreadable', missing: true, reason: 'The commitments could not be read.' }
      : mine?.status !== 'ready' ? { key: 'investors', label: 'Investors', value: '', loading: true, sub: 'Reading…' }
        : all ? { key: 'investors', label: 'Investors', value: String(new Set(all.map((c) => c.investor_user_id)).size), sub: 'With a pending or confirmed commitment' }
          : { key: 'investors', label: 'Investors', ...notRecorded('This view reads the committed total only.') });
  }
  tiles.push(deal?.closing_deadline
    ? { key: 'closes', label: 'Closes', value: String(deal.closing_deadline).slice(0, 10), sub: 'Closing deadline' }
    : { key: 'closes', label: 'Closes', ...notRecorded('No closing deadline is recorded.'), sub: 'Closing deadline' });
  return tiles;
}

/** The terms at a glance (DL1), each from the deal or Not recorded. */
export function termsAtGlance(deal) {
  const cur = deal?.currency || 'USD';
  const pct = (v) => (v == null || v === '' ? null : `${v}%`);
  return [
    ['Instrument', deal?.instrument || null],
    ['Valuation cap', dealMoney(deal?.valuation_cap, cur)],
    ['Minimum', dealMoney(deal?.minimum_check, cur)],
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

/** Eadwyn's draft (DL14) is AUTOFILL's proposal (#2431); nothing reads it yet. */
export const EADWYN_DRAFT_WAITS = 'Eadwyn’s draft summary of this deal is not read here yet. It arrives with AUTOFILL (#2431) as a proposal: nothing lands until you save it as your note.';

/** DL24a: the scorecard strip's slot until SCORING's per-deal read exists (#2428). */
export const SCORE_SLOT = {
  eye: 'Scope strip · Venture scorecard canvas',
  title: 'Scorecard',
  line: 'The eleven scopes, in the scorecard’s order, show here once the per-deal score read lands (SCORING, #2428). This is not a score of zero.',
};
export const DECK_SLOT = {
  eye: 'Pitch deck studio canvas',
  title: 'Deck',
  line: 'The deck shows here once a per-deal deck grant exists; today a deck opens through its share link.',
};
