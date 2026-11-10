/**
 * D4800 (#4800, canvas SE01 and SE11a, D4803) — what the Overview workspace
 * says, derived from the two reads the page already makes and nothing else:
 * `GET /api/admin/security/overview` and `GET /api/admin/security/governance`.
 * No figure here is computed from anything those two do not return. (D4800's
 * second slice added the names of administrators without MFA to `/overview`.)
 *
 * FOUR PARTS, IN THE CANVAS'S ORDER:
 *   findings  Action required, most severe first. Each finding has its
 *             evidence (`detail`, `when`) and one next action. A check that
 *             could not run is a finding of its own (Unavailable), so a
 *             partial failure can never read as "nothing is open".
 *   clear     "Checked and clear": measured zeros, each saying what was read
 *             and when, so absence reads as evidence. Only checks that RAN
 *             are listed; an unreadable store is never in this row.
 *   areas     Status by area: state, a one-line fact and its freshness. No
 *             overall score (D4803).
 *   sources   "n of n sources read", from the ledger's own `sources[]`.
 *
 * A read in flight is `loading`, a failed read is `unreadable`, a returned
 * payload is `ready`. The page passes `{ state, value, at }` for each, where
 * `at` is when the browser received it — the only freshness the platform
 * has (per-store collection times are not recorded, #4800 question C).
 */

import { eventLabel, outcomeState } from './eventsModel.js';

const fmt = (n) => Number(n).toLocaleString();
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

/** "14:30 UTC" from an ISO stamp, or null. */
export function clockOf(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return `${new Date(t).toISOString().slice(11, 16)} UTC`;
}

/** "2026-11-01 03:10 UTC" from a server stamp, or null. Server stamps are UTC. */
export function stampOf(v) {
  if (!v) return null;
  return `${String(v).slice(0, 16).replace('T', ' ')} UTC`;
}

/** Whole days from `from` to `to`, or null when either cannot be parsed. */
function daysBetween(from, to) {
  const a = Date.parse(from || '');
  const b = Date.parse(to || '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

const SEVERITY = { failed: 0, action_required: 1, unavailable: 2 };

/** Where each source's rows come from, in words, for the source list. */
export const SOURCE_LABELS = Object.freeze({
  security_events: 'Security ledger (refusals and step-ups)',
  admin_audit_log: 'Admin action log',
  activity_logs: 'Activity log',
  impersonation_sessions: 'Support sessions',
  licence_events: 'Licence events',
});

export function buildOverview({ overview, feed }) {
  const findings = [];
  const clear = [];
  const ov = overview?.state === 'ready' ? overview.value : null;
  const fd = feed?.state === 'ready' ? feed.value : null;
  const readOv = clockOf(overview?.at);
  const readFeed = clockOf(feed?.at);
  const readNote = (clock) => (clock ? `Read ${clock}` : 'Read this visit');
  const loading = overview?.state === 'loading' || feed?.state === 'loading' || !overview || !feed;

  // ── The checks that could not run. Each is its own finding. ────────────
  const couldNot = (id, title, detail, retry, tab) => findings.push({
    id, state: 'unavailable', title, detail, when: 'This read', where: tab ? labelOfTab(tab) : 'Overview', tab,
    action: { label: 'Retry', retry },
  });
  if (overview?.state === 'unreadable') {
    couldNot('overview-unreadable', 'The security overview could not be read',
      'MFA, sessions, deletion requests, sanctions, AI safety and the restore drill were not checked. This is not a claim that nothing is open.',
      'overview', null);
  }
  if (feed?.state === 'unreadable') {
    couldNot('feed-unreadable', 'The security ledger could not be read',
      'None of its sources answered, so recent refusals, impersonations, licence changes and exports were not checked.',
      'feed', 'events');
  }
  const sources = fd?.sources || [];
  for (const s of sources) {
    if (s.available) continue;
    couldNot(`source-${s.table}`, `${SOURCE_LABELS[s.table] || s.table} could not be read`,
      `${s.reason || 'The store did not answer.'} Rows from it may be missing from Events.`, 'feed', 'events');
  }

  if (ov) {
    const drill = ov.backup_dr?.drill;
    const backup = ov.backup_dr?.backup;
    const imp = ov.impersonations;
    const sessions = ov.sessions;
    const se = ov.security_events;
    const sanctions = ov.sanctions;
    const v = ov.ai_safety?.verdicts;
    const e = ov.ai_safety?.enforcement;

    // ── The restore drill. Failed leads; never run is an action too. ──────
    if (drill?.state === 'last_run_failed') {
      const ago = daysBetween(drill.at, overview.at);
      const exit = isNum(drill.exit_code) ? `exit code ${drill.exit_code}` : 'no exit code recorded';
      findings.push({
        id: 'drill-failed',
        state: 'failed',
        title: 'Restore drill failed',
        detail: `The last drill stopped at the ${drill.step || 'unrecorded'} step (${exit}). `
          + (backup?.available
            ? 'A backup exists but is not verified restorable until a drill passes.'
            : 'No restore is verified until a drill passes.'),
        when: [stampOf(drill.at) || 'Undated', ago === null ? null : `${plural(ago, 'day', 'days')} ago`].filter(Boolean).join(' · '),
        where: 'Resilience',
        tab: 'resilience',
        action: { label: 'Open drill evidence', tab: 'resilience' },
      });
    } else if (drill?.state === 'never_run') {
      findings.push({
        id: 'drill-never',
        state: 'action_required',
        title: 'Restore drill has never run',
        detail: `${drill.reason || 'No drill has recorded a run.'} No backup is verified restorable until one passes.`,
        when: readNote(readOv),
        where: 'Resilience',
        tab: 'resilience',
        action: { label: 'Open Resilience', tab: 'resilience' },
      });
    } else if (!drill || drill.available === false || drill.state !== 'last_run_passed') {
      couldNot('drill-unreadable', 'The restore drill could not be checked',
        `${drill?.reason || 'The drill marker could not be read.'} This is not a pass.`, 'overview', 'resilience');
    } else if (drill.fresh === false) {
      // D4691: a pass older than its window is history; it does not vouch for recovery today.
      findings.push({
        id: 'drill-stale', state: 'stale', title: 'The last restore drill is out of date',
        detail: `It passed ${stampOf(drill.at) || 'on an unstamped date'}, more than ${drill.stale_after_days ?? 'the allowed number of'} days ago. This is not a current pass.`,
        when: stampOf(drill.at) || 'Undated', where: 'Resilience', tab: 'resilience', action: { label: 'Open Resilience', tab: 'resilience' },
      });
    }

    // ── Administrator MFA, "x of n", linking to the admins (D4803). ───────
    const mfa = ov.mfa;
    const total = isNum(mfa?.admins_total) ? Number(mfa.admins_total) : null;
    const withMfa = isNum(mfa?.admins_with_mfa) ? Number(mfa.admins_with_mfa) : null;
    const without = total !== null && withMfa !== null ? total - withMfa : null;
    if (without === null) {
      couldNot('mfa-unreadable', 'Administrator MFA could not be checked', 'The overview carried no MFA figures.', 'overview', 'access');
    } else if (without > 0) {
      findings.push({
        id: 'mfa-gap',
        state: 'action_required',
        title: 'Administrators without MFA',
        detail: `${fmt(withMfa)} of ${fmt(total)} HQ administrators have a second factor. `
          + `${fmt(without)} ${without === 1 ? 'account can' : 'accounts can'} still sign in with a password alone.`
          + namedAdmins(mfa.admins_without_mfa, without),
        admins: Array.isArray(mfa.admins_without_mfa) ? mfa.admins_without_mfa : null,
        when: readNote(readOv),
        where: 'Access',
        tab: 'access',
        action: { label: 'Review administrators', href: '/admin/hq-team' },
      });
    } else if (total > 0) {
      clear.push({ id: 'mfa', state: 'healthy', label: `${fmt(withMfa)} of ${fmt(total)} admins with MFA`, evidence: `${readNote(readOv)} · users` });
    }

    // ── Deletion requests against their statutory clock. ─────────────────
    // D4691: an unreadable deletion-request read is said so, never counted as none.
    const dsrReadable = ov.dsr?.available !== false;
    if (!dsrReadable) {
      couldNot('dsr-unreadable', 'Deletion requests could not be checked', ov.dsr?.reason || 'The deletion-request store could not be read. This is not a claim that none are open.', 'overview', 'privacy');
    }
    const dsr = dsrReadable ? ov.dsr?.rows || [] : [];
    // D4675 part 2: a calendar month has no fixed day count, so the clock is named, not counted.
    const clock = ov.dsr?.clock?.rule === 'calendar_month' ? 'one-month clock' : 'statutory clock';
    const overdue = dsr.filter((d) => isNum(d.days_left) && d.days_left < 0).length;
    const near = dsr.filter((d) => isNum(d.days_left) && d.days_left >= 0 && d.days_left <= 14).length;
    if (overdue > 0) {
      findings.push({
        id: 'dsr-overdue', state: 'action_required',
        title: `${plural(overdue, 'deletion request', 'deletion requests')} overdue`,
        detail: `The ${clock} from receipt has run out. Record the outcome once the erasure is done or refused.`,
        when: readNote(readOv), where: 'Privacy', tab: 'privacy', action: { label: 'Open Privacy', tab: 'privacy' },
      });
    }
    if (near > 0) {
      findings.push({
        id: 'dsr-near', state: 'action_required',
        title: `${plural(near, 'deletion request', 'deletion requests')} due within 14 days`,
        detail: `Each is inside the last 14 days of its ${clock}.`,
        when: readNote(readOv), where: 'Privacy', tab: 'privacy', action: { label: 'Open Privacy', tab: 'privacy' },
      });
    }
    if (dsrReadable && overdue === 0 && near === 0) {
      clear.push({ id: 'dsr', state: 'measured_zero', label: '0 deletion requests near deadline', evidence: `${readNote(readOv)} · ${plural(dsr.length, 'open request', 'open requests')}` });
    }

    // ── Sanctions: unreviewed hits are an action; zero is evidence. ───────
    if (!sanctions?.available) {
      couldNot('sanctions-unreadable', 'Sanctions hits could not be checked', sanctions?.reason || 'The screening store could not be read.', 'overview', 'trust');
    } else if (Number(sanctions.unreviewed_hits) > 0) {
      findings.push({
        id: 'sanctions-hits', state: 'action_required',
        title: `${plural(Number(sanctions.unreviewed_hits), 'unreviewed sanctions hit', 'unreviewed sanctions hits')}`,
        detail: 'A screening matched a list and has no reviewer\'s note yet.',
        when: sanctions.last_run_at ? `Last run ${stampOf(sanctions.last_run_at)}` : readNote(readOv),
        where: 'Trust', tab: 'trust', action: { label: 'Open Trust', tab: 'trust' },
      });
    } else if (isNum(sanctions.unreviewed_hits)) {
      clear.push({ id: 'sanctions', state: 'measured_zero', label: '0 unreviewed sanctions hits', evidence: `${readNote(readOv)} · ${isNum(sanctions.runs_total) ? plural(Number(sanctions.runs_total), 'run', 'runs') : 'run count unreadable'} on record, on request` });
    }

    // ── Live support sessions and the session count. ──────────────────────
    if (!imp?.available) {
      couldNot('impersonations-unreadable', 'Live support sessions could not be checked', imp?.reason || 'The support-session store could not be read.', 'overview', 'access');
    } else if (isNum(imp.active) && Number(imp.active) === 0) {
      clear.push({ id: 'impersonations', state: 'measured_zero', label: '0 live impersonations', evidence: `${readNote(readOv)} · support sessions` });
    }
    if (!sessions?.available) {
      couldNot('sessions-unreadable', 'Active sessions could not be counted', sessions?.reason || 'The session store could not be read.', 'overview', 'access');
    }

    // ── The ledger's own counts. ─────────────────────────────────────────
    if (!se?.available) {
      couldNot('ledger-counts-unreadable', 'Refused sign-ins could not be counted', se?.reason || 'The security ledger\'s counts could not be read.', 'overview', 'events');
    } else if (isNum(se.failed_signins_24h) && Number(se.failed_signins_24h) === 0) {
      clear.push({ id: 'refusals', state: 'measured_zero', label: '0 refused sign-ins in 24 hours', evidence: `${readNote(readOv)} · security ledger` });
    }

    // ── AI safety counters. ──────────────────────────────────────────────
    if (!v?.available || !e?.available) {
      couldNot('ai-unreadable', 'AI safety counters could not be read',
        (!v?.available ? v?.reason : e?.reason) || 'The guard\'s counters could not be read.', 'overview', 'ai-safety');
    }
    const ta = ov.ai_safety?.token_anomalies;
    if (ta && !ta.available) {
      couldNot('anomalies-unreadable', 'Token anomalies could not be checked', 'Token consumption could not be read. No account was checked.', 'overview', 'ai-safety');
    } else if (ta?.available && isNum(ta.count) && Number(ta.count) === 0) {
      clear.push({ id: 'anomalies', state: 'measured_zero', label: '0 token anomalies', evidence: `${readNote(readOv)} · ${isNum(ta.accounts_checked) ? plural(Number(ta.accounts_checked), 'account', 'accounts') : 'accounts'} checked` });
    }
  }

  if (fd && sources.length > 0 && sources.every((s) => s.available)) {
    clear.push({ id: 'sources', state: 'healthy', label: `${sources.length} of ${sources.length} sources read`, evidence: readNote(readFeed) });
  }

  findings.sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state]);
  const incomplete = findings.some((f) => f.state === 'unavailable');

  // ── Tab marks: the worst finding per workspace, and how many. ──────────
  const marks = {};
  for (const f of findings) {
    if (!f.tab || f.state === 'unavailable') continue;
    const m = marks[f.tab];
    if (!m) marks[f.tab] = { state: f.state, count: 1 };
    else {
      m.count += 1;
      if (SEVERITY[f.state] < SEVERITY[m.state]) m.state = f.state;
    }
  }

  return {
    loading,
    findings,
    incomplete,
    clear,
    areas: buildAreas({ ov, fd, overview, feed, readOv, readFeed }),
    recent: recentEvents(feed),
    sources: {
      state: feed?.state || 'loading',
      read: sources.filter((s) => s.available).length,
      total: sources.length,
      rows: sources,
      filter: fd?.filter || null,
    },
    marks,
  };
}

/**
 * D4800 — " Without one: Ada (ada@…), Grace." from the names `/overview`
 * returns, or nothing when it returned none (an older Worker): the count above
 * stands on its own and no name is guessed. Says how many more when the list
 * was capped.
 */
export function namedAdmins(list, without) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const words = list.map((a) => {
    const name = String(a?.name || '').trim();
    const email = String(a?.email || '').trim();
    return name && email ? `${name} (${email})` : name || email || `account ${a?.id}`;
  });
  const more = isNum(without) && Number(without) > list.length ? ` and ${fmt(Number(without) - list.length)} more` : '';
  return ` Without one: ${words.join(', ')}${more}.`;
}

/** D4800 — how many ledger rows the Overview's "Recent security events" shows. */
export const RECENT_EVENTS = 6;

/**
 * D4800 (hierarchy item 3, SE01's recent-activity column) — the newest rows of
 * the ledger read the page already made, in Events' own words (`eventLabel`,
 * `outcomeState`). Four states, never conflated:
 *   loading     the read is out;
 *   unavailable the ledger could not be read — never "no events";
 *   empty       it was read and holds no row in its window (a measured zero);
 *   rows        up to RECENT_EVENTS, newest first, with the raw action kept.
 * When Events has narrowed the read, `filtered` says so: the list is then the
 * newest matching rows, not the newest rows.
 */
export function recentEvents(feed) {
  if (!feed || feed.state === 'loading') return { state: 'loading', rows: [] };
  if (feed.state !== 'ready') return { state: 'unavailable', rows: [] };
  const fd = feed.value || {};
  const partial = (fd.sources || []).some((s) => !s.available);
  const filtered = (fd.filter && fd.filter !== 'all') || Object.keys(fd.applied || {}).length > 0;
  const rows = (fd.rows || []).slice(0, RECENT_EVENTS).map((r, i) => {
    const { label, raw } = eventLabel(r);
    const { state, word } = outcomeState(r);
    return {
      key: r.key ?? `${r.source}-${r.at}-${i}`,
      label, raw, state, word,
      at: stampOf(r.at) || 'No timestamp recorded',
      actor: r.actor_identity?.label || r.actor || null,
      source: r.source,
    };
  });
  return { state: rows.length ? 'rows' : 'empty', rows, partial, filtered: !!filtered };
}

const TAB_LABELS = {
  overview: 'Overview', events: 'Events', access: 'Access', privacy: 'Privacy', trust: 'Trust', 'ai-safety': 'AI Safety', resilience: 'Resilience',
};
const labelOfTab = (k) => TAB_LABELS[k] || 'Overview';

/**
 * Status by area — eight cells, each reporting its own evidence. While a
 * read is in flight a cell says so rather than guessing a state; a failed
 * read is Unavailable, never Healthy.
 */
function buildAreas({ ov, fd, overview, feed, readOv, readFeed }) {
  const ovPending = overview?.state !== 'ready' && overview?.state !== 'unreadable';
  const ovFailed = overview?.state === 'unreadable';
  const at = readOv ? `Read ${readOv}` : null;
  const area = (id, title, tab, fn) => {
    if (ovPending) return { id, title, tab, state: null, fact: 'Reading…', freshness: null };
    if (ovFailed) return { id, title, tab, state: 'unavailable', fact: 'The security overview could not be read.', freshness: null };
    return { id, title, tab, ...fn() };
  };
  const areas = [
    area('auth', 'Authentication', 'access', () => {
      const t = ov.mfa?.admins_total;
      const w = ov.mfa?.admins_with_mfa;
      if (!isNum(t) || !isNum(w)) return { state: 'unavailable', fact: 'No MFA figures were returned.', freshness: at };
      if (Number(t) === 0) return { state: 'not_applicable', fact: 'No active HQ administrator account.', freshness: at };
      return { state: Number(w) < Number(t) ? 'action_required' : 'healthy', fact: `${fmt(w)} of ${fmt(t)} admins have MFA`, freshness: at };
    }),
    area('sessions', 'Sessions & access', 'access', () => {
      const s = ov.sessions;
      const i = ov.impersonations;
      if (!s?.available || !i?.available) {
        return { state: 'unavailable', fact: (!s?.available ? s?.reason : i?.reason) || 'A session store could not be read.', freshness: at };
      }
      if (!isNum(s.active) || !isNum(i.active)) return { state: 'unavailable', fact: 'A session count was not returned.', freshness: at };
      const live = Number(i.active);
      return {
        state: live > 0 ? 'pending' : 'healthy',
        fact: `${plural(Number(s.active), 'active session', 'active sessions')} · ${plural(live, 'live impersonation', 'live impersonations')}`,
        freshness: at,
      };
    }),
    area('privacy', 'Privacy & DSR', 'privacy', () => {
      const rows = ov.dsr?.rows || [];
      if (rows.length === 0) return { state: 'measured_zero', fact: '0 open deletion requests', freshness: at };
      const left = rows.map((d) => d.days_left).filter(isNum).map(Number);
      const urgent = left.some((n) => n <= 14);
      const next = left.length ? Math.min(...left) : null;
      return {
        state: urgent ? 'action_required' : 'healthy',
        fact: `${fmt(rows.length)} open · ${next === null ? 'next due date unknown' : next < 0 ? `oldest ${plural(-next, 'day', 'days')} overdue` : `next due in ${plural(next, 'day', 'days')}`}`,
        freshness: at,
      };
    }),
    area('trust', 'Trust & sanctions', 'trust', () => {
      const s = ov.sanctions;
      if (!s?.available) return { state: 'unavailable', fact: s?.reason || 'The screening store could not be read.', freshness: at };
      if (!isNum(s.unreviewed_hits)) return { state: 'unavailable', fact: 'No hit count was returned.', freshness: at };
      const n = Number(s.unreviewed_hits);
      return {
        state: n > 0 ? 'action_required' : 'measured_zero',
        fact: `${plural(n, 'unreviewed sanctions hit', 'unreviewed sanctions hits')} · KYC separate`,
        freshness: 'Screened on request',
      };
    }),
    area('ai', 'AI safety', 'ai-safety', () => {
      const v = ov.ai_safety?.verdicts;
      if (!v?.available) return { state: 'unavailable', fact: v?.reason || 'The guard\'s verdicts could not be read.', freshness: at };
      const n = Number(v.evaluated);
      const days = ov.ai_safety?.window_days;
      const fresh = isNum(days) ? `Last ${plural(Number(days), 'day', 'days')} · HQ only` : 'HQ only';
      if (!isNum(v.evaluated) || n === 0) return { state: 'no_data_yet', fact: 'The guard did not run in this window', freshness: fresh };
      const small = n < 20 ? ' · small sample' : '';
      return {
        // An unsafe verdict is a historical check, not an open incident, and
        // the counters cannot say whether the output was delivered.
        state: Number(v.unsafe_count) > 0 ? 'unknown' : 'healthy',
        fact: `${fmt(v.safe_count)} of ${fmt(n)} evaluated outputs judged safe${small}`,
        freshness: fresh,
      };
    }),
    area('recovery', 'Backup & recovery', 'resilience', () => {
      const d = ov.backup_dr?.drill;
      const b = ov.backup_dr?.backup;
      // D4691: a heartbeat older than its window, or not valid evidence, is not a present backup.
      const backup = b?.available && b.fresh !== false ? 'Backup present'
        : b?.available ? 'Backup stale' : b?.state === 'invalid' ? 'Backup heartbeat invalid' : 'Backup heartbeat unavailable';
      if (d?.state === 'last_run_failed') return { state: 'failed', fact: `${backup} · restore drill failed`, freshness: d.at ? `Drill ${stampOf(d.at)}` : null };
      if (d?.state === 'never_run') return { state: 'action_required', fact: `${backup} · restore drill never run`, freshness: at };
      if (d?.state === 'last_run_passed') {
        const current = d.fresh !== false && b?.available && b.fresh !== false;
        const stale = d.fresh === false || (b?.available && b.fresh === false);
        return { state: current ? 'verified' : stale ? 'stale' : 'unavailable', fact: `${backup} · restore drill ${d.fresh === false ? 'passed, out of date' : 'passed'}`, freshness: d.at ? `Drill ${stampOf(d.at)}` : null };
      }
      return { state: 'unavailable', fact: `${backup} · drill record unreadable`, freshness: at };
    }),
  ];

  // Security events read the ledger, which is its own request.
  const feedPending = feed?.state !== 'ready' && feed?.state !== 'unreadable';
  if (feedPending) areas.push({ id: 'events', title: 'Security events', tab: 'events', state: null, fact: 'Reading…', freshness: null });
  else if (feed?.state === 'unreadable') areas.push({ id: 'events', title: 'Security events', tab: 'events', state: 'unavailable', fact: 'The security ledger could not be read.', freshness: null });
  else {
    const src = fd.sources || [];
    const read = src.filter((s) => s.available).length;
    const newest = fd.rows?.[0]?.at ? clockOf(fd.rows[0].at) || stampOf(fd.rows[0].at) : null;
    areas.push({
      id: 'events', title: 'Security events', tab: 'events',
      state: src.length > 0 && read === src.length ? 'healthy' : 'unavailable',
      fact: `${read} of ${src.length} sources${newest ? ` · newest ${newest}` : ' · no row in this view'}`,
      freshness: readFeed ? `Read ${readFeed}` : null,
    });
  }

  // D4803: per-notice subprocessor delivery is not recorded by anything.
  areas.push({
    id: 'subprocessors', title: 'Subprocessor notices', tab: 'trust',
    state: 'not_instrumented', fact: 'Per-notice delivery is not recorded', freshness: 'Nothing records it yet',
  });
  return areas;
}
