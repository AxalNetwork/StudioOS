/**
 * Practice · Engagements — the derivations, apart from the page that draws them.
 *
 * WHY A SEPARATE MODULE, same reason as `opportunityLog.js`: importing
 * `EngagementsZone.jsx` pulls React and a `.css` through its component tree,
 * which the test loader cannot resolve. Everything here is pure, imports
 * nothing, and is therefore testable directly.
 *
 * WHAT LIVES HERE IS THE PART THAT CAN BE WRONG SILENTLY. The store answers
 * five lanes and the board draws four; the date line under a card says
 * something different in each of them; and the lane control must offer exactly
 * the moves the worker will accept. Get the last one wrong and the page shows a
 * button that 409s — get the first two wrong and it shows a confident wrong
 * date, which is worse.
 */

/**
 * The four lanes the board draws, in canvas order.
 *
 * `renewal_due` IS NOT HERE, and that is the canvas's own call: it folds into
 * Signed and is marked amber rather than given a fifth column. It is still a
 * stored lane, a chip, and a tile — just not a lane on the board.
 */
export const BOARD_LANES = [
  { key: 'drafting', label: 'Drafting' },
  { key: 'proposed', label: 'Proposed' },
  { key: 'signed', label: 'Signed' },
  { key: 'ended', label: 'Ended' },
];

/** The two stored lanes that mean "under contract" — what the Active tile counts. */
export const SIGNED_LANES = new Set(['signed', 'renewal_due']);

/** Which board column a stored lane renders in. */
export function boardLaneOf(lane) {
  return lane === 'renewal_due' ? 'signed' : String(lane || '');
}

/**
 * The lane moves this row may make, in the order the control offers them.
 *
 * MIRRORS `routes/advisors.ts` DELIBERATELY, AND THE TEST DERIVES THE RULE FROM
 * THE WORKER RATHER THAN TRUSTING THIS LIST. Two rules matter:
 *
 *   * `ended` is terminal, so it offers nothing. A recorded outcome that could
 *     be un-recorded is not a record.
 *   * A SIGNED row is never offered `ended`. Ending a signed contract is the
 *     renewal decision that went the wrong way, and the worker answers 409 with
 *     a message naming the renewal route. Offering the button anyway would put
 *     a control on the page whose only outcome is an error — and if it somehow
 *     worked, it would take a lost renewal out of the rate's denominator.
 */
export function laneMoves(lane) {
  switch (String(lane || '')) {
    case 'drafting': return ['proposed', 'signed', 'ended'];
    case 'proposed': return ['drafting', 'signed', 'ended'];
    case 'signed': return ['renewal_due'];
    case 'renewal_due': return ['signed'];
    default: return [];
  }
}

/** Whether this row has a renewal decision to record. */
export function canDecideRenewal(lane) {
  return SIGNED_LANES.has(String(lane || ''));
}

export const LANE_LABEL = {
  drafting: 'Drafting',
  proposed: 'Proposed',
  signed: 'Signed',
  renewal_due: 'Renewal due',
  ended: 'Ended',
};

export const SHAPE_LABEL = {
  retainer: 'Retainer',
  sprint: 'Sprint',
  equity: 'Equity',
  per_call: 'Per call',
};

export const OUTCOME_LABEL = { active: 'Active', renewed: 'Renewed', ended: 'Ended' };
export const OUTCOME_TONE = { active: 'neutral', renewed: 'ok', ended: 'neutral' };

/**
 * #5316 (D5316): why a signed engagement ended, as the Worker stores it. The two
 * answers the Practice v2 canvas draws; the Worker requires one when a signed
 * engagement is ended.
 */
export const END_REASON_LABEL = { did_not_renew: 'Did not renew', other: 'Ended for another reason' };

/**
 * The reason line for one engagement: a label for a recorded reason, `null` for
 * an engagement that has not ended, and "Not recorded" for one that ended
 * before the reason was asked. Never a guessed reason.
 */
export function endReasonLabel(e) {
  if (!e || e.outcome !== 'ended') return null;
  return END_REASON_LABEL[e.end_reason] || 'Not recorded';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-11-04` → `Nov 4`, the form the board's date line takes.
 *
 * PARSED FROM THE STRING, NOT THROUGH `Date`, and that is a bug fix rather than
 * a preference. `new Date('2026-11-04')` is midnight UTC, so in any negative
 * offset `toLocaleDateString` renders the day BEFORE — a contract that renews
 * on the 4th would read "Nov 3" for every reader west of Greenwich. These are
 * calendar days the advisor typed, not instants, so they are never given to a
 * timezone to interpret.
 */
export function shortDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

/**
 * The one line under a board card, which says something different in each lane.
 *
 * The canvas draws five forms — "Not sent", "Sent Aug 21", "Renews Nov 4",
 * "Ends Aug 29", "Ended Jun 30" — plus "Per call" for the shape that has no
 * term. Which of Renews and Ends a signed row means is `lane`'s job, which is
 * why the store keeps `renewal_due` rather than comparing dates against a clock
 * that moves.
 *
 * A MISSING DATE SAYS SO. An engagement whose term end was never recorded is
 * not one that renews today, and the card must not imply a date it does not
 * have.
 */
export function dueLine(e) {
  const lane = String(e?.lane || '');
  if (lane === 'drafting') return 'Not sent';
  if (lane === 'proposed') {
    const day = shortDay(e?.proposed_at);
    return day ? `Sent ${day}` : 'Sent, date not recorded';
  }
  if (lane === 'ended') {
    const day = shortDay(e?.ended_at);
    return day ? `Ended ${day}` : 'Ended, date not recorded';
  }
  if (!SIGNED_LANES.has(lane)) return 'Lane not recorded';
  const day = shortDay(e?.term_ends_at);
  const verb = lane === 'renewal_due' ? 'Ends' : 'Renews';
  // A PER-CALL ENGAGEMENT HAS NO TERM BY ITS NATURE, which is why the canvas's
  // Thornbury card reads "Per call" where its neighbours carry a date. If one
  // has a date recorded anyway it is shown beside the shape rather than hidden:
  // nothing stored gets dropped on the floor.
  if (e?.shape === 'per_call') return day ? `Per call · ${verb.toLowerCase()} ${day}` : 'Per call';
  return day ? `${verb} ${day}` : 'No term end recorded';
}

/**
 * "2 retainers, 1 sprint, 1 equity, 1 per-call" — the Active tile's own note,
 * from the shape counts the endpoint returns.
 *
 * `equity` AND `per-call` DO NOT PLURALISE, which the canvas's own string
 * confirms ("1 equity, 1 per-call"): one is a mass noun and the other is an
 * adjective standing in for a noun. A zero is dropped rather than printed —
 * "0 sprints" in a breakdown is noise, and a count that belongs nowhere else
 * already has the tile above it.
 */
const SHAPE_NOTE = {
  retainer: ['retainer', 'retainers'],
  sprint: ['sprint', 'sprints'],
  equity: ['equity', 'equity'],
  per_call: ['per-call', 'per-call'],
};
export function shapeNote(byShape) {
  const parts = [];
  for (const [key, [one, many]] of Object.entries(SHAPE_NOTE)) {
    const n = Number(byShape?.[key] || 0);
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return parts.length ? parts.join(', ') : null;
}

/**
 * "Novacraft, ends Aug 29" — the note beside a tile that counts clients.
 *
 * Names the client while there is ONE to name, and counts them once there are
 * more, because a tile note cannot hold a list. The canvas's own note is the
 * one-client form.
 */
export function clientNote(rows, verb) {
  if (!rows?.length) return null;
  if (rows.length > 1) return `${rows.length} clients`;
  const [only] = rows;
  const day = shortDay(only?.term_ends_at || only?.ended_at);
  const name = only?.client_name || 'Client not named';
  return day && verb ? `${name}, ${verb} ${day}` : name;
}

/**
 * #4831 (D4831): the Practice v2 chip row (PX-03), in canvas order. Each chip
 * narrows the board to one set and carries that set's count; `All` narrows
 * nothing. `Active` is every row under contract (signed or renewal due), the
 * same set the Active tile counts, so the chip and the tile always agree.
 */
export const LANE_CHIPS = [
  { key: 'active', test: (e) => SIGNED_LANES.has(String(e?.lane || '')) },
  { key: 'renewal_due', test: (e) => e?.lane === 'renewal_due' },
  { key: 'proposed', test: (e) => e?.lane === 'proposed' },
  { key: 'ended', test: (e) => e?.lane === 'ended' },
  { key: 'all', test: () => true },
];

/** The rows one chip shows. An unknown key shows everything, never nothing. */
export function chipRows(rows, key) {
  const chip = LANE_CHIPS.find((c) => c.key === key) || LANE_CHIPS[LANE_CHIPS.length - 1];
  return (rows || []).filter(chip.test);
}

/** `{ active, renewal_due, proposed, ended, all }`, over the whole record. */
export function chipCounts(rows) {
  return Object.fromEntries(LANE_CHIPS.map((c) => [c.key, (rows || []).filter(c.test).length]));
}

/**
 * The price line on a card and in the sheet. The store keeps an amount PER
 * CYCLE and no billing period, so the line says "per cycle" rather than
 * borrowing the canvas's "/ month" for a period nobody recorded. Equity has no
 * cash amount by its nature; any other shape without one is "Price not
 * recorded", never "$0".
 */
export function priceLine(e, money) {
  if (e?.amount_cents == null) return e?.shape === 'equity' ? 'Equity' : 'Price not recorded';
  const amount = money(e.amount_cents);
  return e?.shape === 'per_call' ? `${amount} per call` : `${amount} per cycle`;
}

/** The scope line: what the advisor wrote, or the fact that nothing was. */
export function scopeLine(e) {
  return e?.scope_label || e?.scope_includes || 'Scope not recorded';
}

/**
 * The sessions behind one engagement: the bookings made by its LINKED client
 * account, live or done. A cancelled or declined request was not a session.
 *
 * `null` means it cannot be said. The bookings were not read, or the client
 * is a name with no account, so nothing joins a booking to this contract.
 * Never 0 in either case.
 */
export const SESSION_STATUSES = new Set(['pending', 'confirmed', 'completed']);
export function sessionsFor(e, bookings) {
  if (!Array.isArray(bookings) || !e?.founder_user_id) return null;
  return bookings.filter((b) => b.client_user_id === e.founder_user_id && SESSION_STATUSES.has(b.status));
}

/** The work products filed under one engagement, or `null` when they were not read. */
export function deliverablesFor(e, deliverables) {
  if (!Array.isArray(deliverables)) return null;
  return deliverables.filter((d) => d.engagement_id === e?.id);
}

/**
 * "2 sessions · 3 deliverables", the card's activity line. A half that cannot
 * be said says why, in words, instead of a count.
 */
export function activityLine(e, bookings, deliverables) {
  const s = sessionsFor(e, bookings);
  const d = deliverablesFor(e, deliverables);
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const sessions = s ? plural(s.length, 'session')
    : !Array.isArray(bookings) ? 'Sessions could not be read'
      : 'Sessions need a linked client';
  const work = d ? plural(d.length, 'deliverable') : 'Deliverables could not be read';
  return `${sessions} · ${work}`;
}

/**
 * #4684, as PX-03 draws it: the people this engagement's work has already been
 * SENT to, by name, read from each sent version's own recipient. Changing the
 * client link moves none of it, so the sheet warns before anyone relinks.
 * Empty when nothing was sent; `null` when the deliverables were not read.
 */
export function priorRecipients(e, deliverables) {
  const mine = deliverablesFor(e, deliverables);
  if (!mine) return null;
  const names = new Map();
  for (const d of mine) {
    for (const v of d.versions || []) {
      if (v.sent_at && v.recipient_user_id != null && !names.has(v.recipient_user_id)) {
        names.set(v.recipient_user_id, v.recipient_name || `Member #${v.recipient_user_id}`);
      }
    }
  }
  return [...names.values()];
}

/** The six tabs of the engagement sheet, in canvas order (PX-03b). */
export const SHEET_TABS = ['Overview', 'Scope', 'Sessions', 'Delivery', 'Agreement', 'Activity'];

/**
 * A full calendar day for the sheet: `2026-08-01` → `1 Aug 2026`. Parsed from
 * the string for the same reason as `shortDay`.
 */
export function longDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  const month = m && MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/** The sheet's State line, which names the reason an ended row ended. */
export function stateLine(e) {
  const lane = LANE_LABEL[e?.lane] || 'Lane not recorded';
  if (e?.lane === 'ended') {
    const day = longDay(e?.ended_at);
    const why = e?.outcome === 'ended' ? ` · ${endReasonLabel(e)}` : '';
    return `${day ? `Ended ${day}` : 'Ended, date not recorded'}${why}`;
  }
  return e?.lane === 'renewal_due' ? 'Signed · renewal due' : lane;
}
