/**
 * The figures under Eadwyn on Admin Studio.
 *
 * Each function returns a kind the page can render without inventing a
 * number. `null` seats, an unreadable queue and a deadline with no zone are
 * absences. A measured empty queue is the one case that may say nothing is
 * waiting, because the read answered and every lane was empty.
 *
 * Community is not here. That card has no figures: four counts would be a
 * second read of four consoles (D128).
 */
import { seatState } from '../branch/BranchAccounts';
import { pctFromBps } from '../branch/BranchHome';

export const SEAT_TYPES = ['founder', 'investor', 'advisor', 'partner'];

const OFF_BRANCH =
  'This account is not on a branch deployment, so this territory figure is not recorded here.';

export function offBranchReason() {
  return OFF_BRANCH;
}

/**
 * Seat lines for the Accounts card.
 *
 * `seatsUsed === null` is an unreadable count, not four zeros. A key the
 * successful map omitted is that one type unrecorded, not zero either.
 *
 * @returns {null | { tiles: object[], tightestType: string|null }}
 */
export function accountLines(seatsUsed, seatsLicensed) {
  if (!seatsUsed || typeof seatsUsed !== 'object') return null;
  const licensed = seatsLicensed && typeof seatsLicensed === 'object' ? seatsLicensed : {};
  const tiles = SEAT_TYPES.map((type) => {
    const used = Number(seatsUsed[type]);
    const cap = Number(licensed[type]);
    if (!Number.isFinite(used) || !Number.isFinite(cap)) {
      return { type, missing: true };
    }
    return { type, used, licensed: cap, state: seatState(used, cap), missing: false };
  });
  const pressured = tiles.filter((t) => !t.missing && (t.state === 'tight' || t.state === 'over'));
  pressured.sort((a, b) => (b.used / Math.max(b.licensed, 1)) - (a.used / Math.max(a.licensed, 1)));
  return { tiles, tightestType: pressured[0]?.type || null };
}

function ageText(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return null;
  const h = Number(hours);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return `${Math.round(h)}h`;
}

/**
 * Approvals, oldest first. Count is secondary.
 *
 * `empty` only when every lane answered and every count is 0. One unreadable
 * lane means the board is not known to be clear.
 */
export function approvalsGlance(lanes) {
  if (!Array.isArray(lanes) || lanes.length === 0) {
    return { kind: 'unrecorded', reason: 'The queues did not answer, so nothing here is a claim that the board is clear.' };
  }
  const unreadable = lanes.filter((l) => l.count === null);
  const open = lanes.filter((l) => typeof l.count === 'number' && l.count > 0);
  if (!open.length && unreadable.length) {
    return {
      kind: 'unrecorded',
      reason: `${unreadable.map((l) => l.label).filter(Boolean).join(', ') || 'A queue'} could not be read, so this is not a claim that nothing is waiting.`,
    };
  }
  if (!open.length) return { kind: 'empty', text: 'Nothing is waiting.' };
  const worst = open.slice().sort((a, b) => (Number(b.oldest_age_hours) || 0) - (Number(a.oldest_age_hours) || 0))[0];
  const age = ageText(worst.oldest_age_hours);
  const sla = worst.sla === 'past'
    ? 'past the window'
    : worst.sla === 'due_soon'
      ? 'oldest due within 24h'
      : null;
  const bits = [
    worst.label,
    age ? `oldest ${age}` : 'oldest item has no readable date',
    sla,
    `${worst.count} open`,
  ].filter(Boolean);
  return { kind: 'ready', text: bits.join(' · ') };
}

/**
 * The next programme deadline, with the zone it is enforced in.
 * A close instant that cannot be formatted in that zone is not shown.
 */
export function programmeGlance(prog, formattedClose) {
  if (!prog) return { kind: 'unrecorded', reason: 'The programme clock did not answer.' };
  if (prog.open_week === null || prog.open_week === undefined) {
    return { kind: 'unrecorded', reason: prog.reason || 'No cohort week is open.' };
  }
  if (!prog.zone || !formattedClose) {
    return {
      kind: 'unrecorded',
      reason: 'The week has a deadline but it could not be shown in the zone it is enforced in, so it is not shown at all.',
    };
  }
  return {
    kind: 'ready',
    text: `Week ${prog.open_week} gate closes ${formattedClose} ${prog.zone}`,
  };
}

/**
 * HQ's pushed template library. Expiring agreements are never a number:
 * `licence_contracts` is HQ's table and a branch has no read of it.
 */
export function contractsGlance(data) {
  const agreements = {
    kind: 'unrecorded',
    reason: 'Agreements that expire inside 60 days are not recorded on a branch. The contract ledger is HQ\'s table.',
  };
  if (!data) return { kind: 'unrecorded', reason: 'The template library did not answer.', agreements };
  if (data.available === false) {
    return { kind: 'unreadable', reason: data.reason || 'The template library could not be read.', agreements };
  }
  if (data.never_pushed_reason) {
    return { kind: 'unrecorded', reason: data.never_pushed_reason, agreements };
  }
  const n = Array.isArray(data.items) ? data.items.length : null;
  if (n === null) {
    return { kind: 'unrecorded', reason: 'The template library did not include a list.', agreements };
  }
  if (n === 0) {
    return {
      kind: 'unrecorded',
      reason: 'HQ pushed a library and it was empty, so there is nothing to instantiate.',
      agreements,
    };
  }
  const asOf = data.pushed_at ? String(data.pushed_at).replace('T', ' ').slice(0, 16) : null;
  return {
    kind: 'ready',
    text: `${n} HQ template${n === 1 ? '' : 's'} ready to instantiate${asOf ? ` · as of ${asOf}` : ''}`,
    agreements,
  };
}

/** Share rate from the licence term, plus whether HQ published a median. No amount. */
export function insightsGlance(revenue, insights) {
  const sharePct = revenue ? pctFromBps(revenue.share_bps) : null;
  const share = sharePct === null
    ? { kind: 'unrecorded', reason: revenue?.reason || 'The share rate is not recorded on the licence copy.' }
    : { kind: 'ready', text: `${sharePct}% share on this licence` };
  if (!insights) {
    return {
      share,
      median: { kind: 'unrecorded', reason: 'Not recorded — HQ has not published a median.' },
    };
  }
  if (insights.benchmarks_available === false) {
    return {
      share,
      median: { kind: 'unreadable', reason: insights.benchmarks_reason || 'The benchmark copy could not be read.' },
    };
  }
  const benchmarks = Array.isArray(insights.benchmarks) ? insights.benchmarks : [];
  if (!benchmarks.length) {
    return {
      share,
      median: {
        kind: 'unrecorded',
        reason: insights.benchmarks_empty_reason || 'Not recorded — HQ has not published a median.',
      },
    };
  }
  const b = benchmarks[0];
  const when = b.pushed_at ? ` · HQ computed ${b.pushed_at}` : '';
  const n = Number.isFinite(Number(b.n_branches)) ? ` · ${b.n_branches} branches` : '';
  return {
    share,
    median: {
      kind: 'ready',
      text: `${b.label || b.metric_key} · median ${b.median_value}${n}${when}`,
    },
  };
}

export function freezeLine(name, suspendedAt) {
  const who = name || 'This territory';
  const day = freezeDay(suspendedAt);
  return day
    ? `${who} · frozen since ${day} · writes are blocked`
    : `${who} · frozen · writes are blocked`;
}

function freezeDay(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(ms);
}
