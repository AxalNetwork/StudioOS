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
import { inZone } from '../../lib/zoneTime';
import { branchOfUser } from '../../lib/shellRole';

/**
 * D246 — THE ONE SENTINEL FOR A READ THAT FAILED.
 *
 * AdminStudioHome and AdminStudioOverview each used to declare their own
 * `Symbol('unavailable')`. Two calls make two different symbols, so every
 * `=== UNAVAILABLE` branch in the overview compared against a value the home
 * page never sent: a failed read fell through to the "not recorded" helpers
 * and an unreadable store read as a store that does not exist. Every Studio
 * file imports this one.
 */
export const UNAVAILABLE = Symbol('unavailable');

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
  // `sla` and `unreadable` ride along for the needs-a-decision strip, so its
  // Approvals tile ranks from the same lane this card names.
  return { kind: 'ready', text: bits.join(' · '), sla: worst.sla || null, unreadable: unreadable.length };
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
 * HQ's pushed template library, and nothing else. Expiring agreements are
 * their own glance (below) because they come from a different store.
 */
export function contractsGlance(data) {
  if (!data) return { kind: 'unrecorded', reason: 'The template library did not answer.' };
  if (data.available === false) {
    return { kind: 'unreadable', reason: data.reason || 'The template library could not be read.' };
  }
  if (data.never_pushed_reason) {
    return { kind: 'unrecorded', reason: data.never_pushed_reason };
  }
  const n = Array.isArray(data.items) ? data.items.length : null;
  if (n === null) {
    return { kind: 'unrecorded', reason: 'The template library did not include a list.' };
  }
  if (n === 0) {
    return {
      kind: 'unrecorded',
      reason: 'HQ pushed a library and it was empty, so there is nothing to instantiate.',
    };
  }
  const asOf = data.pushed_at ? String(data.pushed_at).replace('T', ' ').slice(0, 16) : null;
  return {
    kind: 'ready',
    text: `${n} HQ template${n === 1 ? '' : 's'} ready to instantiate${asOf ? ` · as of ${asOf}` : ''}`,
  };
}

/**
 * #308 / D199 — AGREEMENTS THAT END INSIDE THE WINDOW, from the branch's own
 * contract stores via `GET /api/branch/home`.
 *
 * THIS REPLACES A REFUSAL THAT BLAMED THE WRONG THING. The card said these
 * were "not recorded on a branch" because "the contract ledger is HQ's table".
 * That ledger (`licence_contracts`) is the licence agreement itself and has no
 * end date, so pushing it would carry nothing that can expire. The Studio's
 * own agreements are in its own database; what two of their four stores lack
 * is an end date, and the server names those two on `undated`.
 *
 * A ZERO IS SCOPED TO WHAT WAS MEASURED. "None of the dated agreements"
 * rather than "none", with the server's note beside it, because a bare zero
 * would read as though an MSA sent through e-sign had been checked too.
 */
export function agreementsGlance(a) {
  if (!a) {
    return {
      kind: 'unrecorded',
      reason: 'The digest did not include an agreements read, so this is not a claim that none are ending.',
    };
  }
  if (a.expiring === null || a.expiring === undefined) {
    return { kind: 'unreadable', reason: a.reason || 'The agreement stores could not be read.' };
  }
  const days = Number.isFinite(a.window_days) ? a.window_days : 60;
  const note = a.undated?.reason || null;
  if (a.expiring === 0) {
    return { kind: 'empty', text: `None of the dated agreements ends inside ${days} days.`, note };
  }
  return {
    kind: 'ready',
    text: `${a.expiring} ${a.expiring === 1 ? 'expires' : 'expire'} inside ${days} days`,
    note,
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

/**
 * D246 — EVERY STUDIO FIGURE, COMPUTED ONCE.
 *
 * The overview cards and the needs-a-decision tiles both render from this, so
 * a tile and its card can never disagree: they are the same object. `null` is
 * still being read; a prop equal to `UNAVAILABLE` is a read that failed and
 * becomes `unreadable`, never one of the "not recorded" sentences.
 */
export function studioGlances({ user, home, licence, templates, insights }) {
  const onBranch = Boolean(branchOfUser(user));
  const absent = { kind: 'unrecorded', reason: OFF_BRANCH };
  const failed = (what) => ({
    kind: 'unreadable',
    reason: `${what} could not be read. This is not a claim that the territory has none.`,
  });

  const lic = licence && licence !== UNAVAILABLE ? licence.licence || null : null;
  const seats = !onBranch
    ? absent
    : licence === null
      ? null
      : licence === UNAVAILABLE
        ? failed('Seats')
        : (() => {
          const lines = accountLines(lic?.seats_used_by_type, lic?.seats);
          if (!lines) {
            return {
              kind: 'unrecorded',
              reason: lic?.seats_used_basis || 'Seat use is not recorded on this copy, so it is not shown as zero.',
            };
          }
          return { kind: 'ready', lines };
        })();

  const approvals = !onBranch
    ? absent
    : home === null
      ? null
      : home === UNAVAILABLE
        ? failed('The queues')
        : approvalsGlance(home.queue_pressure);

  const programme = !onBranch
    ? absent
    : home === null
      ? null
      : home === UNAVAILABLE
        ? failed('The programme clock')
        : {
          ...programmeGlance(home.programme, inZone(home.programme?.week_closes_at, home.programme?.zone)),
          hoursToClose: Number.isFinite(home.programme?.hours_to_close) ? home.programme.hours_to_close : null,
        };

  // #308 / D199 — the agreements come from the DIGEST, not the template
  // library: two stores, so two independent states.
  const agreements = !onBranch
    ? absent
    : home === null
      ? null
      : home === UNAVAILABLE
        ? failed('Agreements')
        : agreementsGlance(home.agreements);

  const contracts = !onBranch
    ? { ...absent, agreements }
    : (templates === null || home === null)
      ? null
      : templates === UNAVAILABLE
        ? { ...failed('The template library'), agreements }
        : { ...contractsGlance(templates), agreements };

  let insightView;
  if (!onBranch) insightView = { share: absent, median: absent };
  else if (home === null || insights === null) insightView = null;
  else {
    const view = insightsGlance(
      home === UNAVAILABLE ? null : home.revenue,
      insights === UNAVAILABLE ? null : insights,
    );
    insightView = {
      share: home === UNAVAILABLE ? failed('The share rate') : view.share,
      median: insights === UNAVAILABLE ? failed('The benchmark copy') : view.median,
    };
  }

  return { onBranch, lic, seats, approvals, programme, contracts, insights: insightView };
}

/** The sidebar's order, which breaks every tie in the strip. */
export const NEEDS_DECISION_ORDER = ['seats', 'approvals', 'programme', 'contracts'];

/**
 * How urgent a tile is: 0 unreadable, 1 past its window (or seats over the
 * licence), 2 due within 24 hours (or a seat type at AMBER_AT), 3 the rest.
 * Read off the same glance the overview card renders.
 */
export function tileUrgency(key, glance) {
  if (!glance) return 3;
  if (glance.kind === 'unreadable') return 0;
  if (key === 'approvals') {
    if (glance.unreadable > 0) return 0;
    if (glance.sla === 'past') return 1;
    if (glance.sla === 'due_soon') return 2;
    return 3;
  }
  if (key === 'seats' && glance.kind === 'ready') {
    const states = glance.lines.tiles.filter((t) => !t.missing).map((t) => t.state);
    if (states.includes('over')) return 1;
    if (states.includes('tight')) return 2;
    return 3;
  }
  if (key === 'programme' && glance.kind === 'ready') {
    return glance.hoursToClose !== null && glance.hoursToClose <= 24 ? 2 : 3;
  }
  return 3;
}

/**
 * WORST FIRST, COMPUTED — never typed. Unreadable, then past the window, then
 * due within 24 hours or at AMBER_AT, then the rest in sidebar order.
 *
 * @param {{ key: string, glance: object|null }[]} tiles
 */
export function orderNeedsDecision(tiles) {
  return tiles
    .map((t) => ({ ...t, urgency: tileUrgency(t.key, t.glance) }))
    .sort((a, b) => (a.urgency - b.urgency)
      || (NEEDS_DECISION_ORDER.indexOf(a.key) - NEEDS_DECISION_ORDER.indexOf(b.key)));
}

/**
 * The Seats tile's figure: the fullest measured seat type from `accountLines`.
 * `null` when no type was measured.
 */
export function fullestSeat(lines) {
  if (!lines) return null;
  const measured = lines.tiles.filter((t) => !t.missing && t.state !== 'unlicensed');
  if (!measured.length) return null;
  const tight = lines.tightestType && measured.find((t) => t.type === lines.tightestType);
  return tight || measured.slice().sort((a, b) => (b.used / Math.max(b.licensed, 1)) - (a.used / Math.max(a.licensed, 1)))[0];
}
