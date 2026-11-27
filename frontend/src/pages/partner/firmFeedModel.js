/**
 * D8733 (#8733) — the Operating Partner's firm feed, as a model: every alert the three reads produce, each naming
 * its client and the exact item it opens, the six-row summary that reserves a row for each kind present, the kind
 * chips' counts, and the sentence that names what the summary hides. Pure over the reads and a `now`, so a test
 * drives it with a fixed clock. `PartnerHomeP2.jsx` draws it; the canvas is `Studio Home Operating Partner`
 * (boards SOP01 to SOP12).
 *
 * WHAT CHANGED FROM D394. `homeFeed` used to push the lines in kind order and keep `out.slice(0, 6)`, so six blocked
 * clients hid a milestone due tomorrow and a renewal, and every action opened a whole zone. Now every alert is kept,
 * the summary is chosen by `feedSummary`, and each alert links to its engagement, person or retainer with
 * `from=studio`, which puts "Back to Studio · Firm feed" on the page it opens.
 */

/** Closed engagements are off the feed, as they are off the tiles. */
export const CLOSED = ['delivered', 'reviewed', 'invoiced', 'cancelled'];

/** How many rows the summary keeps (the module's six, unchanged). */
export const SUMMARY_ROWS = 6;

/**
 * The kinds, in the order the feed lists them. `chip` names the kind chip, `group` the heading over its rows when
 * the list is expanded, `count` the phrase in the disclosure and the phone jump link, `read` the read it comes from.
 */
export const FEED_KINDS = [
  { key: 'blk', chip: 'Blocked', group: 'Blocked', count: (n) => `${n} blocked`, read: 'board', action: 'Open engagement' },
  { key: 'risk', chip: 'At risk', group: 'At risk', count: (n) => `${n} at risk`, read: 'board', action: 'Open engagement' },
  { key: 'due', chip: 'Due this week', group: 'Due this week', count: (n) => `${n} due this week`, read: 'board', action: 'Open milestones' },
  { key: 'cap', chip: 'Over cap', group: 'Over a stated cap', count: (n) => `${n} over cap`, read: 'capacity', action: 'Open capacity' },
  { key: 'ren', chip: 'Renewing', group: 'Renewing within 60 days', count: (n) => `${n} renewing`, read: 'retainers', action: 'Open retainer' },
  { key: 'seat', chip: 'Embedded', group: 'Embedded seats', count: (n) => `${n} embedded`, read: 'board', action: 'Open seats' },
];
export const KIND = Object.fromEntries(FEED_KINDS.map((k) => [k.key, k]));
const ORDER = Object.fromEntries(FEED_KINDS.map((k, i) => [k.key, i]));

/** The five kinds the chip row always accounts for (a seat chip appears only when there is a seat). */
export const CHIP_KINDS = ['blk', 'risk', 'due', 'cap', 'ren'];

/** The `?feed=` values the module keeps in the URL: `all`, or one kind. */
export const FEED_VIEWS = ['all', ...FEED_KINDS.map((k) => k.key)];

const dayIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dateOf = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const daysFrom = (iso, now) => {
  const d = dateOf(iso);
  const t = dateOf(dayIso(now));
  return d === null || t === null ? null : Math.round((d - t) / 86400000);
};
const within = (iso, days, now) => {
  const n = daysFrom(iso, now);
  return n !== null && n >= 0 && n <= days;
};
const fmt = (iso, opts) => {
  const d = dateOf(iso);
  if (d === null) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return opts?.year ? `${p.weekday} ${p.day} ${p.month} ${p.year}` : `${p.weekday} ${p.day} ${p.month}`;
};
/** "today", "tomorrow" or "in 5 days". */
export function relativeDay(iso, now) {
  const n = daysFrom(iso, now);
  if (n === null) return null;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return n > 1 ? `in ${n} days` : `${-n} day${n === -1 ? '' : 's'} ago`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const engKey = (i) => String(i.engagement_uid || i.engagement_id || '');
const studioLink = (path, params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  q.set('from', 'studio');
  return `${path}?${q.toString()}`;
};

/** The live rows of the board read: neither closed nor on a fully revoked seat. */
export function liveRows(board) {
  return (board?.items || []).filter((i) => !i.seat_revoked_at && !CLOSED.includes(i.status));
}

const byName = (a, b) => String(a.who).localeCompare(String(b.who));

/**
 * Every alert the reads produce, in feed order: kind first, then within a kind the most pressing first. Blocked and
 * at risk: most overdue milestones, then most open blockers, then name. Due: soonest next milestone. Over cap: the
 * furthest over. Renewing: soonest. Seats: by name. A read that failed (`null`) produces nothing here; the module
 * says which kinds it could not read (`unreadKinds`).
 */
export function homeFeed({ board, retainers, capacity } = {}, now = Date.now()) {
  const out = [];
  const live = liveRows(board);
  for (const i of live.filter((x) => x.health === 'blocked' || x.health === 'at_risk')) {
    const kind = i.health === 'blocked' ? 'blk' : 'risk';
    out.push({
      key: `${kind === 'blk' ? 'blk' : 'risk'}-${i.engagement_id}`, kind,
      who: i.client || 'Client not recorded',
      body: Array.isArray(i.health_reasons) && i.health_reasons.length ? i.health_reasons.join(' · ') : null,
      receipt: 'Read from milestones, blockers and deliverables',
      to: studioLink('/delivery/board', { engagement: engKey(i) }),
      rank: [-(Number(i.milestones_overdue) || 0), -(Number(i.open_blockers) || 0)],
    });
  }
  for (const i of live.filter((x) => x.milestones_due_7d > 0)) {
    const next = i.next_milestone_due_at && within(i.next_milestone_due_at, 6, now) ? i.next_milestone_due_at : null;
    out.push({
      key: `due-${i.engagement_id}`, kind: 'due',
      who: i.client || 'Client not recorded',
      body: `${plural(i.milestones_due_7d, 'milestone')} due this week`,
      // D8733's backend half: the board row names its next open milestone, so the line can say which and when.
      when: next ? `${i.next_milestone_title || 'Untitled milestone'} · due ${fmt(next)}, ${relativeDay(next, now)}` : null,
      receipt: 'Milestone due dates, as the firm entered them',
      to: studioLink('/delivery/health', { engagement: engKey(i) }),
      rank: [next ? daysFrom(next, now) : 7],
    });
  }
  for (const p of (capacity?.people || []).filter((x) => x.over_committed === true)) {
    const has = p.total_hours_per_week != null && p.cap_hours != null;
    out.push({
      key: `cap-${p.user_id ?? p.name}`, kind: 'cap',
      who: p.name || 'A team member',
      body: has ? `${p.total_hours_per_week} h a week against a cap of ${p.cap_hours} h a week` : null,
      receipt: p.cap_source === 'person' ? 'Their own cap, stated by the firm' : 'The firm-wide cap, stated by the firm',
      to: studioLink('/delivery/capacity', { person: p.user_id ?? null }),
      rank: [has ? -(Number(p.total_hours_per_week) - Number(p.cap_hours)) : 0],
    });
  }
  for (const r of (retainers?.items || []).filter((x) => x.retainer && within(x.retainer.renews_at, 60, now))) {
    const at = String(r.retainer.renews_at).slice(0, 10);
    out.push({
      key: `renew-${r.engagement_id ?? r.founder_name}`, kind: 'ren',
      who: r.founder_name || 'Client not recorded',
      body: `Retainer renews ${fmt(at, { year: true })} · ${relativeDay(at, now)}`,
      receipt: 'Retainer record',
      to: studioLink('/pipeline/retainers', { engagement: r.engagement_uid || r.engagement_id }),
      rank: [daysFrom(at, now)],
    });
  }
  for (const i of live.filter((x) => x.mode === 'embedded' && x.grant)) {
    out.push({
      key: `seat-${i.engagement_id}`, kind: 'seat',
      who: i.client || 'Client not recorded',
      grant: `Scope recorded by the firm: ${i.grant}`,
      body: i.grant_holder ? `Seat held by ${i.grant_holder}` : null,
      receipt: 'Seat record, entered by this firm',
      to: studioLink('/delivery/capacity', { engagement: engKey(i) }),
      rank: [],
    });
  }
  const cmp = (a, b) => {
    if (ORDER[a.kind] !== ORDER[b.kind]) return ORDER[a.kind] - ORDER[b.kind];
    for (let x = 0; x < Math.max(a.rank.length, b.rank.length); x += 1) {
      const d = (a.rank[x] ?? 0) - (b.rank[x] ?? 0);
      if (d) return d;
    }
    return byName(a, b);
  };
  return out.sort(cmp).map(({ rank, ...a }) => ({ ...a, action: KIND[a.kind].action, label: `${KIND[a.kind].action}: ${a.who}` }));
}

/**
 * Owner answer Q3 (A): the summary keeps six rows but reserves one for each kind present — the most pressing of
 * each — and gives the rest to the most pressing alerts in feed order. The rows come back in feed order.
 */
export function feedSummary(all, limit = SUMMARY_ROWS) {
  if (all.length <= limit) return all.slice();
  const chosen = new Set();
  for (const k of FEED_KINDS) {
    if (chosen.size >= limit) break;
    const first = all.find((a) => a.kind === k.key);
    if (first) chosen.add(first);
  }
  for (const a of all) {
    if (chosen.size >= limit) break;
    chosen.add(a);
  }
  return all.filter((a) => chosen.has(a));
}

/** How many alerts of each kind. */
export function kindCounts(all) {
  const c = Object.fromEntries(FEED_KINDS.map((k) => [k.key, 0]));
  for (const a of all) c[a.kind] += 1;
  return c;
}

/** The reads that did not answer, and so the kinds that could not be read. */
export const FEED_READS = { board: 'the delivery board', retainers: 'retainers', capacity: 'capacity' };
export function unreadFeedReads(reads) {
  return Object.keys(FEED_READS).filter((key) => !reads?.[key]);
}
export function unreadKinds(reads) {
  const down = unreadFeedReads(reads);
  return FEED_KINDS.filter((k) => down.includes(k.read)).map((k) => k.key);
}

/**
 * The partial-read sentence's subject (SOP09's copy fix: main built "The feed's the delivery board"). The board
 * leads with its own article; the others are the feed's.
 */
export function unreadSubject(reads) {
  const names = unreadFeedReads(reads).map((k) => FEED_READS[k]);
  if (!names.length) return '';
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return names[0] === FEED_READS.board ? `T${joined.slice(1)}` : `The feed's ${joined}`;
}

/** "N of 3 reads", for the module note when at least one read failed. */
export function partialNote(reads) {
  const down = unreadFeedReads(reads).length;
  return down ? `Partial · ${3 - down} of 3 reads` : null;
}

/**
 * What the summary leaves out, said by kind and client: "2 more not shown · 2 blocked: Marlow Bio, Tidewater
 * Robotics". Null when nothing is hidden.
 */
export function hiddenSentence(all, shown) {
  const hidden = all.filter((a) => !shown.includes(a));
  if (!hidden.length) return null;
  const parts = FEED_KINDS.map((k) => {
    const of = hidden.filter((a) => a.kind === k.key);
    return of.length ? `${k.count(of.length)}: ${of.map((a) => a.who).join(', ')}` : null;
  }).filter(Boolean);
  return { count: hidden.length, lead: `${hidden.length} more not shown`, detail: parts.join(' · ') };
}

/** The kinds present, as the phone jump link and the module note count them: "6 blocked · 1 due this week". */
export function kindsLine(all) {
  const c = kindCounts(all);
  return FEED_KINDS.filter((k) => c[k.key] > 0).map((k) => k.count(c[k.key])).join(' · ');
}

/** The module note: "8 alerts · 6 shown", plus the partial-read qualifier. */
export function feedNote(all, shown, reads) {
  const parts = [plural(all.length, 'alert')];
  if (shown.length < all.length) parts.push(`${shown.length} shown`);
  const partial = partialNote(reads);
  if (partial) parts.push(partial);
  return parts.join(' · ');
}

/** `?feed=` read back: a known view, or the summary (`''`). */
export function feedView(value) {
  return FEED_VIEWS.includes(value) ? value : '';
}

/** The rows the expanded list shows for a view, and its count line ("Showing 1 of 8 alerts · Renewing"). */
export function expandedRows(all, view) {
  const rows = view && view !== 'all' ? all.filter((a) => a.kind === view) : all;
  const line = view && view !== 'all'
    ? `Showing ${rows.length} of ${plural(all.length, 'alert')} · ${KIND[view].chip}`
    : `Showing all ${plural(all.length, 'alert')}`;
  return { rows, line };
}

/**
 * Where focus goes on return (SOP07): the alert opened, if it is still listed; otherwise the alert now in its place
 * (the same position, or the last one), and a line saying why. `opened` is the return record the feed kept.
 */
export function returnFocus(rows, opened) {
  if (!opened?.key) return null;
  const still = rows.find((a) => a.key === opened.key);
  if (still) return { key: still.key, message: `Back from ${still.who}. Your view of the feed was kept.` };
  const who = opened.who || 'The alert you opened';
  const why = opened.kind && KIND[opened.kind] ? `${who} is no longer ${KIND[opened.kind].chip.toLowerCase()}, so it left the feed.` : `${who} left the feed.`;
  if (!rows.length) return { key: null, message: `${why} Nothing else is listed.` };
  const at = Math.min(Math.max(Number(opened.index) || 0, 0), rows.length - 1);
  return { key: rows[at].key, message: `${why} Focus is on the next alert.` };
}
