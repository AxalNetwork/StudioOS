/**
 * D1304 (#3401, part 5 of #2377) — Admin › Accounts' Overview (ACC1, ACC8–ACC11),
 * as words and rows, over D1301's read (`GET /api/admin/accounts/overview`,
 * `cloudflare-worker/src/routes/admin_accounts_overview.ts`). Pure, so
 * `frontend/test/accounts_overview_d1304.test.mjs` holds each rule.
 *
 * EVERY BLOCK ANSWERS ALONE. The read gives each block as `{ available: true }`,
 * `{ available: false, unreadable: true, reason }` (its store failed: "couldn't
 * be read" with Try again) or `{ available: false, recorded: false, reason }`
 * (nothing records it: "Not recorded" with why). `stateOf` is the one place
 * that tells them apart; a failure is never drawn as a zero, and a zero the
 * read counted is drawn as 0.
 */

/** #2377's profiles (G1), in the canvas's order, with the chart palette's tone for each. */
export const PROFILES = Object.freeze([
  { key: 'founder', label: 'Founders', one: 'Founder', tone: 'violet', none: 'No founders yet' },
  { key: 'investor', label: 'Investors', one: 'Investor', tone: 'sky', none: 'No investors yet' },
  { key: 'advisor', label: 'Advisors', one: 'Advisor', tone: 'amber', none: 'No advisors yet' },
  { key: 'partner', label: 'Operating Partners', one: 'Operating Partner', tone: 'emerald', none: 'No operating partners yet' },
  { key: 'exploring', label: 'Explorers', one: 'Explorer', tone: 'muted', none: 'No explorers yet' },
]);
const LABEL = Object.fromEntries(PROFILES.map((p) => [p.key, p]));

/** A profile key in words: `Founder`, `Admin`, or the key itself. */
export function profileWord(key) {
  if (key === 'admin') return 'Admin';
  if (!key || key === 'no role') return 'No profile';
  return LABEL[key]?.one || String(key);
}
export const profileTone = (key) => LABEL[key]?.tone || 'muted';

const nf = (n) => Number(n).toLocaleString('en-US');
const whole = (v) => (v !== null && v !== undefined && Number.isSafeInteger(Number(v)) ? Number(v) : null);
const pct = (part, of) => (of > 0 ? Math.round((part / of) * 100) : null);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stamp the Worker wrote (ISO, or SQL's `YYYY-MM-DD HH:MM:SS`, read as UTC), in ms, or NaN. */
export function stampMs(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return Date.parse(`${s.replace(' ', 'T')}Z`);
  return Date.parse(s);
}
/** `24 Oct 2026`, or null. */
export function dayWord(raw) {
  const t = stampMs(raw);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** Whole days from a stamp to now, or null. */
export function daysSince(raw, now) {
  const t = stampMs(raw);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
}
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * A block's state: `ok`, `unreadable` (Try again), `not_recorded` (why) or
 * `missing` (the read never named it; said as unreadable, never as none).
 */
export function stateOf(b) {
  if (b?.available === true) return { kind: 'ok', reason: null };
  if (b?.recorded === false) return { kind: 'not_recorded', reason: b.reason || 'Not recorded on this database.' };
  if (b?.unreadable) return { kind: 'unreadable', reason: b.reason || 'This could not be read.' };
  return { kind: 'unreadable', reason: 'The overview did not give this block. That is not the same as none.' };
}

/** ACC9a: a studio with no account yet. Only a counted 0 is empty, never a failed read. */
export const isEmptyStudio = (ov) => ov?.kpis?.accounts?.available === true && ov.kpis.accounts.total === 0;

/** ACC1's four figures. A tile whose block failed carries its state and reason, never a number. */
export function kpiTiles(ov) {
  const k = ov?.kpis || {};
  const tile = (key, label, block, read) => {
    const st = stateOf(block);
    return st.kind === 'ok' ? { key, label, state: st, ...read(block) } : { key, label, state: st, value: null, sub: st.reason };
  };
  return [
    tile('accounts', 'Accounts', k.accounts, (b) => ({
      value: nf(b.total),
      delta: b.total ? `+${nf(b.new_30d)} in 30 days` : null,
      sub: b.deactivated ? `${nf(b.deactivated)} deactivated, not counted` : 'None deactivated',
    })),
    tile('active', 'Active in the last 30 days', k.active_30d, (b) => {
      const p = pct(b.count, b.of);
      const never = whole(b.never_seen);
      return {
        value: nf(b.count),
        sub: [p === null ? null : `${p}% of accounts`, never ? `${nf(never)} never seen` : null].filter(Boolean).join(' · ') || null,
      };
    }),
    tile('unverified', 'Email not verified', k.unverified, (b) => ({
      value: nf(b.count),
      sub: b.overdue ? `${nf(b.overdue)} for more than ${b.overdue_days ?? 7} days` : null,
    })),
    tile('waiting', 'Waiting on you', k.waiting, (b) => ({
      value: nf(b.total),
      sub: [
        `${nf(b.explorers_ready)} ${b.explorers_ready === 1 ? 'explorer' : 'explorers'} ready for a profile`,
        `${nf(b.lp_applications)} LP ${b.lp_applications === 1 ? 'application' : 'applications'}`,
      ].join(' · '),
      note: stateOf(b.tester_applications).kind === 'not_recorded' ? 'Product tester applications are not counted here yet.' : null,
      link: { to: '/admin/approvals', label: 'Open Approvals' },
    })),
  ];
}

/** The profile mix bar: the four profiles, then Other (Explorers and everyone else). Null when not readable. */
export function mixParts(ov) {
  const p = ov?.profiles;
  if (stateOf(p).kind !== 'ok') return null;
  const of = (key) => p.rows.find((r) => r.profile === key)?.count ?? 0;
  const explorers = of('exploring');
  const rest = whole(p.other) ?? 0;
  const parts = PROFILES.slice(0, 4).map((x) => ({ key: x.key, label: x.label, value: of(x.key), tone: x.tone }));
  const otherWords = [explorers ? `Explorers ${nf(explorers)}` : null, p.admins ? `Admins ${nf(p.admins)}` : null,
    rest - (whole(p.admins) ?? 0) > 0 ? `other ${nf(rest - (whole(p.admins) ?? 0))}` : null].filter(Boolean).join(' · ');
  parts.push({ key: 'other', label: `Other${otherWords ? ` (${otherWords})` : ''}`, value: explorers + rest, tone: 'muted' });
  const total = parts.reduce((t, x) => t + x.value, 0);
  return {
    total,
    parts,
    alt: `Profile mix of ${nf(total)} accounts: ${parts.map((x) => `${x.label.replace(/ \(.*\)$/, '')} ${nf(x.value)}`).join(', ')}.`,
    chart: { type: 'bar100', parts: parts.map((x) => ({ label: x.label, value: x.value, tone: x.tone })) },
  };
}

/** A widget's eight weeks as a sparkline: the last week is to date, so its segment is dashed. */
export function sparkline(weeks, w = 160, h = 36) {
  const vals = (weeks || []).map((x) => whole(x?.count) ?? 0);
  if (vals.length < 2) return null;
  const mx = Math.max(...vals, 1);
  const step = w / (vals.length - 1);
  const pts = vals.map((y, i) => [Number((i * step).toFixed(1)), Number((h - 4 - (y / mx) * (h - 10)).toFixed(1))]);
  const toDate = Boolean(weeks[weeks.length - 1]?.to_date);
  const solid = toDate ? pts.slice(0, -1) : pts;
  return {
    solid: solid.map((p) => p.join(',')).join(' '),
    dash: toDate ? `${pts[pts.length - 2].join(',')} ${pts[pts.length - 1].join(',')}` : null,
    last: pts[pts.length - 1],
    toDate,
    table: weeks.map((x) => [x.to_date ? `Week of ${dayWord(x.week) ?? x.week} (to date)` : `Week of ${dayWord(x.week) ?? x.week}`, nf(whole(x.count) ?? 0)]),
  };
}

/**
 * The seven widgets (ACC1). The five profiles come from `profiles`; their facts
 * from `readiness.by_profile` and, for Investors, `lps.by_profile`; the
 * Explorers' split from `explorers`. LPs and Product testers are sub-accounts.
 * A fact whose block failed is said in that fact, and the widget stays.
 */
export function profileWidgets(ov) {
  const prof = stateOf(ov?.profiles);
  const ready = ov?.readiness?.available ? ov.readiness.by_profile : null;
  const lps = ov?.lps?.available ? ov.lps : null;
  const exp = stateOf(ov?.explorers);
  const empty = isEmptyStudio(ov);
  const out = PROFILES.map((p) => {
    if (prof.kind !== 'ok') return { key: p.key, label: p.label, tone: p.tone, state: prof, sub: false };
    const row = ov.profiles.rows.find((r) => r.profile === p.key) || { count: 0, new_30d: 0, weeks: null };
    const facts = [];
    const r = ready?.find((x) => x.profile === p.key);
    if (p.key === 'exploring') {
      if (exp.kind === 'ok') {
        const e = ov.explorers;
        facts.push({ key: 'not_sent', label: 'Agreement not sent', value: nf(e.not_sent) });
        facts.push({ key: 'sent_unsigned', label: 'Sent, not signed', value: nf(e.sent_unsigned) });
        facts.push({ key: 'signed_ready', label: 'Signed, ready for a profile', value: nf(e.signed_ready), link: { to: '/admin/exploring', label: 'Open the Exploring board' } });
      } else {
        facts.push({ key: 'split', failed: exp.kind === 'unreadable', label: 'Agreements', reason: exp.kind === 'unreadable' ? 'Could not be read. The Exploring board did not answer. This is not a claim that there are none.' : exp.reason });
      }
    } else if (r) {
      facts.push({ key: 'identity', label: 'Identity check approved', value: nf(r.identity_approved) });
      facts.push({ key: 'profile_ready', label: 'Profile at least 75% complete', value: nf(r.profile_ready) });
      if (p.key === 'investor') {
        const lp = lps?.by_profile?.find((x) => x.profile === 'investor');
        facts.push(lps ? { key: 'lps', label: 'LPs among them', value: nf(lp?.count ?? 0) }
          : { key: 'lps', label: 'LPs among them', reason: stateOf(ov?.lps).reason });
      }
    }
    return {
      key: p.key, label: p.label, tone: p.tone, sub: false, state: prof,
      count: row.count, value: nf(row.count),
      delta: row.count ? `+${nf(row.new_30d)} in 30 days` : null,
      none: empty || row.count === 0 ? p.none : null,
      spark: row.weeks ? sparkline(row.weeks) : null,
      weeksReason: row.weeks ? null : (row.weeks_reason || 'Sign-ups by week could not be read.'),
      facts,
      link: { to: `/admin/accounts/all`, label: `View ${nf(row.count)} in All accounts →` },
    };
  });
  const lpState = stateOf(ov?.lps);
  out.push(lpState.kind === 'ok'
    ? {
      key: 'lp', label: 'LPs', badge: 'LP', tone: 'ink', sub: true, state: lpState,
      count: ov.lps.count, value: nf(ov.lps.count), none: ov.lps.count === 0 ? 'No LPs yet' : null,
      facts: [
        { key: 'by_profile', label: lpProfilesWord(ov.lps.by_profile) },
        ov.lps.open_applications === null || ov.lps.open_applications === undefined
          ? { key: 'open', label: 'LP applications waiting', reason: ov.lps.open_applications_reason || 'Could not be read.' }
          : { key: 'open', label: 'LP applications waiting', value: nf(ov.lps.open_applications), link: { to: '/admin/lp-applications', label: 'Open' } },
      ],
      weeksReason: 'LPs are counted by approved application, so there are no sign-up weeks to draw.',
    }
    : { key: 'lp', label: 'LPs', badge: 'LP', tone: 'ink', sub: true, state: lpState });
  out.push({ key: 'tester', label: 'Product testers', badge: 'Tester', tone: 'ink', sub: true, state: stateOf(ov?.product_testers) });
  return out;
}

/** `38 investors · 3 other profiles`; `No LP yet`. */
export function lpProfilesWord(byProfile) {
  const rows = (byProfile || []).filter((r) => r.count > 0);
  if (!rows.length) return 'No LP yet';
  const inv = rows.find((r) => r.profile === 'investor')?.count ?? 0;
  const rest = rows.filter((r) => r.profile !== 'investor').reduce((t, r) => t + r.count, 0);
  return [inv ? `${nf(inv)} ${inv === 1 ? 'investor' : 'investors'}` : null, rest ? `${nf(rest)} other ${rest === 1 ? 'profile' : 'profiles'}` : null].filter(Boolean).join(' · ');
}

/** `LPs by profile: Investors 38 · Founders 2`. */
export const lpByProfileLine = (byProfile) => {
  const rows = (byProfile || []).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  return rows.length ? `LPs by profile: ${rows.map((r) => `${LABEL[r.profile]?.label || profileWord(r.profile)} ${nf(r.count)}`).join(' · ')}.` : 'No LP yet.';
};

const STEPS = Object.freeze([
  ['email_verified', 'Email verified', 'verified their email'],
  ['terms_accepted', 'Terms accepted', 'accepted the terms'],
  ['identity_approved', 'Identity check approved', 'have an approved identity check'],
  ['profile_ready', 'Profile at least 75% complete', 'have a profile at least 75% complete'],
  ['active_30d', 'Active in the last 30 days', 'were active in the last 30 days'],
]);
/** The readiness segments: All, then each profile. */
export const READINESS_SEGMENTS = Object.freeze([{ key: 'all', label: 'All' }, ...PROFILES.map((p) => ({ key: p.key, label: p.label }))]);

/**
 * Account readiness for a segment (`all` or a profile): five steps, each a
 * count and a share of the segment. The Terms step is null with its reason
 * when the acceptances could not be read; the others still draw.
 */
export function readinessRows(ov, segment = 'all') {
  const r = ov?.readiness;
  if (stateOf(r).kind !== 'ok') return null;
  const src = segment === 'all' ? r.all : r.by_profile.find((x) => x.profile === segment);
  if (!src) return null;
  const total = whole(src.total) ?? 0;
  const rows = STEPS.map(([key, label, verb]) => {
    const v = whole(src[key]);
    return v === null
      ? { key, label, value: null, share: null, text: 'Not read', reason: key === 'terms_accepted' ? (r.terms_reason || 'The Terms acceptances could not be read.') : 'Not given.', verb }
      : { key, label, value: v, share: total ? v / total : 0, text: `${nf(v)} (${pct(v, total) ?? 0}%)`, without: total - v, verb };
  });
  const read = rows.filter((x) => x.value !== null);
  return {
    total,
    rows,
    alt: `Account readiness: ${read.map((x) => `${pct(x.value, total) ?? 0}% ${x.verb}`).join(', ')}.`,
    chart: { type: 'hbar', rows: rows.map((x) => ({ label: x.label, value: x.value, text: x.text })) },
  };
}

/** Newest accounts (five), each opening its record. */
export function newestRows(ov, now = Date.now()) {
  if (stateOf(ov?.newest).kind !== 'ok') return null;
  return ov.newest.rows.map((r) => ({
    id: r.id,
    name: r.name?.trim() || 'Name not recorded',
    initials: initials(r.name),
    profile: profileWord(r.profile),
    tone: profileTone(r.profile),
    country: r.country || 'Country not recorded',
    joined: dayWord(r.joined_at) ?? 'Date not recorded',
    ago: daysSince(r.joined_at, now),
  }));
}

/** Two initials from a name, or `?`. */
export function initials(name) {
  const w = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

/** Why one account needs you, in the canvas's words. A wait with no recorded start says so. */
export function attentionWord(row, now = Date.now()) {
  const d = daysSince(row.since, now);
  const day = dayWord(row.since);
  switch (row.kind) {
    case 'email_unverified': return d === null ? 'Email not verified, since a date not recorded' : `Email not verified for ${days(d)}`;
    case 'identity_waiting': return day ? `Identity check waiting since ${day}` : 'Identity check waiting, since a date not recorded';
    case 'explorer_signed': return d === null ? 'Explorer, agreement signed on a date not recorded' : `Explorer, agreement signed ${d === 0 ? 'today' : `${days(d)} ago`}`;
    case 'lp_application': return d === null ? 'LP application waiting, since a date not recorded' : `LP application waiting ${days(d)}`;
    default: return 'Waiting on an administrator';
  }
}

const KIND_WORD = { email_unverified: 'email verification', identity_waiting: 'identity checks', explorer_signed: 'Explorer agreements', lp_application: 'LP applications' };

/**
 * Needs attention: up to five rows, oldest wait first, each opening its record.
 * `partial` names the kinds that could not be read; `notCounted` the two kinds
 * the canvas draws that nothing records yet.
 */
export function attentionRows(ov, now = Date.now()) {
  if (stateOf(ov?.attention).kind !== 'ok') return null;
  const a = ov.attention;
  const failed = Object.entries(a.by_kind || {}).filter(([, v]) => v?.available !== true).map(([k]) => KIND_WORD[k] || k);
  return {
    rows: a.rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name?.trim() || 'Name not recorded', initials: initials(r.name), profile: profileWord(r.profile), why: attentionWord(r, now) })),
    partial: a.partial || failed.length > 0
      ? `Some of this list could not be read: ${failed.join(', ') || 'one kind'}. The accounts shown are not all that need you.`
      : null,
    notCounted: Object.values(a.not_recorded || {}),
  };
}
