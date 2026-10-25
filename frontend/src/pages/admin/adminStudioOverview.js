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
import { api } from '../../lib/api';
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
  // D473 — the digest printed how many accounts have not finished the week.
  // A recorded count (including zero) is part of this sentence. A missing
  // count is left off, never printed as zero.
  const pending = finiteHours(prog.pending_accounts);
  const pendingText = pending === null
    ? ''
    : ` · ${pending} ${pending === 1 ? 'account has' : 'accounts have'} not finished this week`;
  return {
    kind: 'ready',
    text: `Week ${prog.open_week} gate closes ${formattedClose} ${prog.zone}${pendingText}`,
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
      reason: data.empty_reason || 'HQ pushed a library and it was empty, so there is nothing to instantiate.',
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
  const share = revenue?.available === false
    ? {
      kind: 'unreadable',
      reason: revenue.reason || 'The share rate could not be read. This is not a claim that no rate was pushed.',
    }
    : (() => {
      const sharePct = revenue ? pctFromBps(revenue.share_bps) : null;
      return sharePct === null
        ? { kind: 'unrecorded', reason: revenue?.reason || 'The share rate is not recorded on the licence copy.' }
        : { kind: 'ready', text: `${sharePct}% share on this licence` };
    })();
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
    : licence == null
      ? null
      : licence === UNAVAILABLE
        ? failed('Seats')
        : (() => {
          if (lic?.seats_used_by_type == null) return failed('Seats');
          const lines = accountLines(lic.seats_used_by_type, lic?.seats);
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
    : home == null
      ? null
      : home === UNAVAILABLE
        ? failed('The queues')
        : approvalsGlance(home.queue_pressure);

  const programme = !onBranch
    ? absent
    : home == null
      ? null
      : home === UNAVAILABLE
        ? failed('The programme clock')
        : {
          ...programmeGlance(home.programme, inZone(home.programme?.week_closes_at, home.programme?.zone)),
          hoursToClose: finiteHours(home.programme?.hours_to_close),
        };

  // #308 / D199 — the agreements come from the DIGEST, not the template
  // library: two stores, so two independent states.
  const agreements = !onBranch
    ? absent
    : home == null
      ? null
      : home === UNAVAILABLE
        ? failed('Agreements')
        : agreementsGlance(home.agreements);

  const contracts = !onBranch
    ? { ...absent, agreements }
    : (templates == null || home == null)
      ? null
      : templates === UNAVAILABLE
        ? { ...failed('The template library'), agreements }
        : { ...contractsGlance(templates), agreements };

  let insightView;
  if (!onBranch) insightView = { share: absent, median: absent };
  else if (home == null || insights == null) insightView = null;
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

/**
 * D443 — one in-flight read of GET /api/admin/studio/glance, shared by the
 * strip and the cards so they cannot each ask.
 */
let glanceInflight = null;
export function loadStudioGlance() {
  if (!glanceInflight) {
    glanceInflight = api.adminStudioGlance().finally(() => { glanceInflight = null; });
  }
  return glanceInflight;
}

// ── D555: HQ's own figures (#1155) ───────────────────────────────────────

/** Each laned queue's console, by the Worker's lane key (`approvalSources.ts`). */
export const LANE_CONSOLES = {
  lp: '/admin/lp-applications',
  // D953 (#2371): lane 2 and this door take the Queue's address together.
  referrals: '/admin/programs/refer-and-earn/queue',
  cohort: '/admin/programs/spinout-lab/applications',
  moderation: '/admin/spinout-moderation',
  kyc: '/admin/kyc',
  partner_profiles: '/admin/partner-profiles',
  exploring: '/admin/exploring',
  jobs: '/admin/jobs',
  events: '/admin/events',
  best_fit: '/admin/best-fit',
  due_diligence: '/admin/due-diligence',
};

/** The lanes with no pending notion (`NOT_LANED`), by label, with their consoles. */
export const NO_QUEUE_CONSOLES = {
  Directory: '/admin/directory',
  Circles: '/admin/circles',
  // D923 (#2370): lane 13 and this door move together.
  'Partner invitations': '/admin/partner-invitations',
  // D953 (#2371): lane 16 and this door take People's address together.
  'Advisor cohort access': '/admin/programs/mentor-cohorts/people',
};

const fmtN = (n) => Number(n).toLocaleString('en-US');

/**
 * HQ's Accounts block. `null` exploring or Trash means that one read failed:
 * it is said, not shown as zero.
 */
export function hqAccountsView(accounts) {
  if (!accounts) return { kind: 'unrecorded', reason: 'HQ\'s accounts were not on the glance.' };
  if (accounts.available === false) return { kind: 'unreadable', reason: accounts.reason };
  const roles = (accounts.by_role || []).map((r) => `${fmtN(r.count)} ${r.role}`).join(' · ');
  return {
    kind: 'ready',
    label: accounts.label,
    total: accounts.total,
    byRole: accounts.by_role || [],
    new7d: accounts.new_7d,
    new30d: accounts.new_30d,
    deactivated: accounts.deactivated,
    exploring: accounts.exploring,
    trash: accounts.trash_projects,
    text: `${fmtN(accounts.total)} accounts${roles ? ` · ${roles}` : ''} · ${fmtN(accounts.new_7d)} new this week`
      + (accounts.exploring === null || accounts.exploring === undefined ? '' : ` · ${fmtN(accounts.exploring)} exploring`),
  };
}

/**
 * HQ's Approvals block: the pending total (null when any lane could not be
 * read), the lanes worst first as the Worker sorted them, each with its
 * console, and the lanes with no queue.
 */
export function hqApprovalsView(approvals) {
  if (!approvals || !Array.isArray(approvals.lanes)) {
    return { kind: 'unrecorded', reason: 'HQ\'s approval lanes were not on the glance.' };
  }
  const lanes = approvals.lanes.map((l) => ({
    ...l,
    to: LANE_CONSOLES[l.key] || null,
    // D935: Jobs still counts creation; #2700 moved Events to submission.
    // TODO #2715: remove its prefix when the Jobs query moves to submission.
    age: l.key === 'jobs' ? `created ${ageText(l.oldest_age_hours) || 'undated'}` : ageText(l.oldest_age_hours),
  }));
  const worst = lanes.find((l) => typeof l.count === 'number' && l.count > 0) || null;
  const total = approvals.pending_total;
  const unreadable = lanes.filter((l) => l.count === null).length;
  const head = total === null || total === undefined
    ? `${unreadable} lane${unreadable === 1 ? '' : 's'} could not be read, so no total`
    : total === 0 ? 'Nothing is waiting' : `${fmtN(total)} pending`;
  return {
    kind: 'ready',
    label: approvals.label,
    total: total ?? null,
    lanes,
    worst,
    unreadable,
    sla: worst?.sla || null,
    noQueue: (approvals.no_queue || []).map((n) => ({ ...n, to: NO_QUEUE_CONSOLES[n.label] || null })),
    notApplicable: approvals.not_applicable || [],
    text: worst ? `${head} · worst: ${worst.label}, oldest ${worst.age || 'undated'}` : head,
  };
}

/**
 * Last week's active accounts (D893): read from `activity_logs` on the glance.
 * A week before the log began has no value, and says so rather than 0.
 */
export const ACTIVE_BEFORE_LOG =
  'The request log holds nothing for that week, so it is left blank rather than shown as zero.';
function activeView(a) {
  if (a?.available === true) {
    return a.value === null || a.value === undefined
      ? { kind: 'unrecorded', reason: ACTIVE_BEFORE_LOG, week: a.week }
      : { kind: 'ready', value: a.value, week: a.week };
  }
  if (a?.available === false) return { kind: 'unreadable', reason: a.reason };
  return { kind: 'unrecorded', reason: a?.reason || 'Active accounts were not on the glance.' };
}

/** HQ's Insights block: each figure is its own state. */
export function hqInsightsView(insights) {
  if (!insights || insights.recorded === false) {
    return { kind: 'unrecorded', reason: insights?.reason || 'HQ\'s insights were not on the glance.' };
  }
  const weeks = insights.signups_by_week?.available ? insights.signups_by_week.weeks : null;
  const thisWeek = weeks ? weeks[weeks.length - 1] : null;
  return {
    kind: 'ready',
    label: insights.label,
    signups: insights.signups_by_week?.available
      ? { kind: 'ready', weeks, thisWeek: thisWeek?.count ?? null, eightWeeks: weeks.reduce((t, w) => t + w.count, 0) }
      : { kind: 'unreadable', reason: insights.signups_by_week?.reason },
    spend: insights.ai_spend_month?.available
      ? { kind: 'ready', usd: insights.ai_spend_month.usd, calls: insights.ai_spend_month.calls, month: insights.ai_spend_month.month }
      : { kind: 'unreadable', reason: insights.ai_spend_month?.reason },
    tickets: insights.open_tickets?.available
      ? { kind: 'ready', open: insights.open_tickets.open }
      : { kind: 'unreadable', reason: insights.open_tickets?.reason },
    active: activeView(insights.active_accounts),
    benchmark: { kind: 'unrecorded', reason: insights.benchmark?.reason },
  };
}

function unrecordedBlock(block, fallback) {
  return { kind: 'unrecorded', reason: block?.reason || fallback };
}

/** A missing hour is null. `Number(null)` is 0, and 0 would rank the tile as due now. */
function finiteHours(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The same object `studioGlances` returns, read off the glance payload
 * instead of the four branch responses. `UNAVAILABLE` is a read that failed.
 * A block with `recorded: false` is a figure this tier does not have, and
 * its reason is the server's — the page does not invent a softer one.
 */
export function glancesFromStudioGlance(payload, user) {
  const failed = (what) => ({
    kind: 'unreadable',
    reason: `${what} could not be read. This is not a claim that the territory has none.`,
  });
  if (!payload || payload === UNAVAILABLE) {
    const onBranch = Boolean(branchOfUser(user));
    return {
      tier: onBranch ? 'branch' : null,
      onBranch,
      lic: null,
      licenceAbsence: null,
      licenceUnreadable: null,
      seats: failed('Seats'),
      approvals: failed('The queues'),
      programme: failed('The programme clock'),
      contracts: { ...failed('The template library'), agreements: failed('Agreements') },
      insights: { share: failed('The share rate'), median: failed('The benchmark copy') },
    };
  }

  const onBranch = payload.tier === 'branch';
  const seats = payload.seats?.available === false
    ? { kind: 'unreadable', reason: payload.seats.reason || failed('Seats').reason }
    : payload.seats?.recorded === false
      ? unrecordedBlock(payload.seats, 'Seat use was not on the glance, so it is not shown as zero.')
      : payload.seats?.seats_used_by_type == null
        ? failed('Seats')
        : (() => {
          const lines = accountLines(payload.seats.seats_used_by_type, payload.seats?.seats);
          if (!lines) {
            return {
              kind: 'unrecorded',
              reason: payload.seats?.seats_used_basis || 'Seat use is not recorded on this copy, so it is not shown as zero.',
            };
          }
          return { kind: 'ready', lines };
        })();

  const onHq = payload.tier === 'hq';
  const hq = onHq ? {
    accounts: hqAccountsView(payload.accounts),
    approvals: hqApprovalsView(payload.approvals),
    insights: hqInsightsView(payload.insights),
  } : null;
  const approvals = payload.approvals?.recorded === false
    ? unrecordedBlock(payload.approvals, 'The queues were not on the glance, so this is not a claim that the board is clear.')
    : onHq ? hq.approvals : approvalsGlance(payload.approvals?.lanes);

  const programme = payload.programme?.recorded === false
    ? unrecordedBlock(payload.programme, 'The programme clock was not on the glance.')
    : {
      ...programmeGlance(
        payload.programme,
        inZone(payload.programme?.week_closes_at, payload.programme?.zone),
      ),
      hoursToClose: finiteHours(payload.programme?.hours_to_close),
    };

  const agreements = payload.agreements?.recorded === false
    ? unrecordedBlock(payload.agreements, 'Agreements were not on the glance, so this is not a claim that none are ending.')
    : agreementsGlance(payload.agreements);

  let library;
  if (payload.templates?.recorded === false) {
    library = unrecordedBlock(payload.templates, 'The template library was not on the glance.');
  } else if (!payload.templates || payload.templates.available === false) {
    library = contractsGlance(payload.templates?.available === false ? payload.templates : null);
  } else {
    library = contractsGlance({
      available: true,
      items: payload.templates.items,
      pushed_at: payload.templates.pushed_at,
      never_pushed_reason: payload.templates.never_pushed_reason,
      empty_reason: payload.templates.empty_reason,
    });
  }
  const contracts = { ...library, agreements };

  const shareUnreadable = payload.revenue?.available === false;
  const shareAbsent = !shareUnreadable && payload.revenue?.recorded === false;
  const medianAbsent = payload.insights?.recorded === false || onHq;
  const view = insightsGlance(
    shareUnreadable || shareAbsent ? null : payload.revenue,
    medianAbsent ? null : payload.insights,
  );
  const insightView = {
    share: shareUnreadable
      ? { kind: 'unreadable', reason: payload.revenue.reason || failed('The share rate').reason }
      : shareAbsent
        ? unrecordedBlock(payload.revenue, 'The share rate was not on the glance.')
        : view.share,
    median: medianAbsent
      ? unrecordedBlock(onHq ? payload.insights?.benchmark : payload.insights, 'The benchmark copy was not on the glance.')
      : view.median,
  };

  const licenceUnreadable = payload.licence?.available === false ? (payload.licence.reason || null) : null;
  const lic = payload.licence?.recorded && !licenceUnreadable ? payload.licence : null;
  return {
    tier: payload.tier || null,
    onBranch,
    lic,
    licenceUnreadable,
    licenceAbsence: payload.licence?.recorded === false ? payload.licence.reason : null,
    seats,
    approvals,
    programme,
    contracts,
    insights: insightView,
    hq,
  };
}

/** The sidebar's order, which breaks every tie in the strip. */
export const NEEDS_DECISION_ORDER = ['accounts', 'seats', 'approvals', 'programme', 'contracts'];

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
