/**
 * D988 (#2779, part 7 of #2376) — the studio's Programs tab (canvas GR7–GR15),
 * as pure functions over three reads the tab makes:
 *
 *   GET /api/licence/mine/programs            D984: the nine, each with its standing and grant
 *   GET /api/licence/mine/partner-deal-types  D986: the deal types HQ allows
 *   GET /api/licence/mine/requests            D799/D983: this licence's requests to HQ
 *
 * NOTHING HERE GUESSES. A program with no grant row is "Not recorded", never
 * "Not granted" (D981 §3). A term nobody set is "Not recorded" with "HQ has
 * not entered this term", never a zero. A read that failed is "Unreadable",
 * and it is never drawn as none.
 *
 * WHERE EACH TERM IS STATED. D1120's program schedule has no numbered
 * sections: it prints every term under one "Terms" heading, as the terms stood
 * the day HQ sent it. So a term's chip names that schedule and its state
 * (signed, sent, or not sent yet) rather than a "§n" no document carries.
 */
import { NOT_RECORDED } from './absence';
import { bpsPercent } from './bps';
import { longDate, dayOf } from './licencePage';
import { PROGRAMS } from './programGrants';
import {
  ASKED_MAX, NOTE_MAX, PROGRAM_KINDS, TERM_LABEL, answerSentence, askableTerms, termsFor,
} from './studioProgramTerms';

export { ASKED_MAX, NOTE_MAX, PROGRAM_KINDS, TERM_LABEL, answerSentence, askableTerms, termsFor };

export { NOT_RECORDED };
export const UNREADABLE = 'Unreadable';
export const NOT_ENTERED = 'HQ has not entered this term.';

/** The canvas's line under each program's name. */
export const PURPOSE = {
  'spinout-lab': 'Idea to incorporated company in 28 days.',
  'ai-native-venture': 'A venture program built with Eadwyn and the studio’s tools.',
  'mentor-cohorts': 'Advisors who mentor a Lab cohort.',
  'investor-cohorts': 'Verified investors follow one Lab cohort.',
  'referral-partners': 'People who bring events, startups, deals and LPs.',
  'refer-and-earn': 'Members refer founders, users and contacts for credits.',
  perks: 'Partners list perks; members claim them.',
  learning: 'Courses, videos, exercises and exams.',
  'product-testing': 'Members test StudioOS features before they ship.',
};

/** Each program's own page under Programs. Product testing runs at HQ and has none. */
export const PROGRAM_PAGE = {
  'spinout-lab': '/admin/spinout-lab',
  'mentor-cohorts': '/admin/programs/mentor-cohorts',
  'referral-partners': '/admin/programs/referral-partners',
  'refer-and-earn': '/admin/programs/refer-and-earn',
  perks: '/admin/programs/perks',
  learning: '/admin/programs/learning',
  'ai-native-venture': '/admin/programs/ai-native-venture',
  'investor-cohorts': '/admin/programs/investor-cohorts',
};

const WORDS = {
  playbook: { as_written: 'Follow HQ’s playbook as written', may_adapt: 'The studio may adapt HQ’s playbook' },
  brand: { axal: 'Run as an Axal VC program', studio: 'Run under the studio’s brand' },
  reporting: { monthly: 'Report monthly', quarterly: 'Report quarterly', yearly: 'Report yearly' },
};

const set = (v) => v !== null && v !== undefined && v !== '';

/** Money in the grant's currency; a currency nobody recorded is said, never assumed. */
export function grantMoney(cents, currency) {
  if (!set(cents) || !Number.isFinite(Number(cents))) return NOT_RECORDED;
  const amount = Number(cents) / 100;
  if (!currency) return `${amount.toLocaleString('en-GB')} (currency not recorded)`;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString('en-GB')} ${currency}`;
  }
}


/** One term's value as the studio reads it, or null when nobody set it. */
export function termValue(key, terms = {}) {
  const v = terms?.[key];
  if (!set(v)) return null;
  switch (key) {
    case 'starts_on':
    case 'ends_on':
      return longDate(v);
    case 'ends_with_licence':
    case 'capacity_uncapped':
    case 'hq_approves_each_cohort':
    case 'requires_signed_schedule':
      return Number(v) === 1 ? 'Yes' : 'No';
    case 'fee_cents':
    case 'hq_approval_above_cents':
      return grantMoney(v, terms.currency);
    case 'hq_share_bps':
      return bpsPercent(v);
    case 'capacity_cap':
      return `Up to ${v}`;
    case 'cohorts_per_year':
      return `${v} cohorts a year`;
    case 'credits_per_quarter':
      return `${v} credits a quarter`;
    case 'playbook':
    case 'brand':
    case 'reporting':
      return WORDS[key][String(v)] || String(v);
    default:
      return String(v);
  }
}

// ─────────────────────────────────────────────────────────────── the requests

const nameOf = (key) => PROGRAMS.find((p) => p.key === key)?.name || key || NOT_RECORDED;

/** The open program requests, oldest first: the "Requests with HQ" tile and each row's "Requested". */
export function openProgramRequests(items) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it?.status === 'open' && PROGRAM_KINDS.includes(it.kind))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

/** How many requests of any kind this licence holds open: the Worker's limit counts them all. */
export const openCount = (items) => (Array.isArray(items) ? items : []).filter((it) => it?.status === 'open').length;

/** "Learning · sent 12 Oct 2026", the canvas's line under a request. */
export const requestLine = (it) => `${nameOf(it?.request?.program)} · sent ${longDate(it?.created_at)}`;

// ──────────────────────────────────────────────────────────────── the rows

const HELD = ['in_force', 'granted', 'paused', 'ended'];
const OFFERED = ['in_force', 'granted', 'paused', 'ended', 'not_recorded'];
export const isHeld = (p) => ['in_force', 'granted', 'paused'].includes(p?.standing);
export const isOffered = (p) => OFFERED.includes(p?.standing);

const WAITING = {
  licence_active: 'the licence to be active',
  schedule_signed: 'the schedule to be signed',
  start_date: 'its start date',
  ended_by_date: 'nothing: its end date has passed',
};

/** The status cell: the read's word, the tone, and the line under it. */
export function statusOf(p, open = []) {
  const asked = open.find((r) => r.kind === 'program_grant' && r.request?.program === p.program_key);
  if (asked && !isHeld(p)) {
    return { word: 'Requested', tone: 'asked', line: `Waiting for HQ since ${longDate(asked.created_at)}`, request: asked };
  }
  const tone = p.standing === 'in_force' ? 'held'
    : p.standing === 'granted' ? 'waiting'
      : p.standing === 'paused' ? 'paused'
        : p.standing === 'not_recorded' ? 'unrecorded' : 'muted';
  let line = p.line || null;
  if (p.standing === 'granted' && Array.isArray(p.grant?.waiting_on) && p.grant.waiting_on.length) {
    line = `It waits on ${p.grant.waiting_on.map((w) => WAITING[w] || w).join(', ')}.`;
  }
  if (p.standing === 'paused' && p.grant?.note) line = `HQ’s note: ${p.grant.note}`;
  const changing = open.find((r) => r.kind !== 'program_grant' && r.request?.program === p.program_key);
  if (changing) {
    line = `${changing.kind === 'program_end' ? 'Your request to end it' : 'Your change request'} waits for HQ since ${longDate(changing.created_at)}`;
  }
  return { word: p.word || NOT_RECORDED, tone, line, request: changing || null };
}

/** The "Your terms" cell: the two terms that say most about this program, or nothing to claim. */
export function termsSummary(p) {
  const t = p.grant?.terms;
  if (!t) return null;
  const parts = [];
  if (t.capacity_uncapped === 1) parts.push('No cap');
  else if (set(t.capacity_cap)) parts.push(termValue('capacity_cap', t));
  for (const k of ['cohorts_per_year', 'credits_per_quarter']) if (set(t[k])) parts.push(termValue(k, t));
  if (set(t.hq_share_bps)) parts.push(`${termValue('hq_share_bps', t)} to HQ`);
  if (t.hq_approves_each_cohort === 1) parts.push('HQ approves each cohort');
  if (set(t.hq_approval_above_cents)) parts.push(`HQ approves payouts above ${termValue('hq_approval_above_cents', t)}`);
  return parts.length ? parts.slice(0, 2) : [NOT_RECORDED];
}

/** "1 Nov 2024 → 31 Oct 2027", with "Not recorded" on a side nobody set. */
export function periodOf(p) {
  const g = p.grant;
  if (!g) return null;
  const from = set(g.terms?.starts_on) ? longDate(g.terms.starts_on) : NOT_RECORDED;
  const to = set(g.effective_end) ? longDate(g.effective_end) : (g.terms?.ends_with_licence === 0 ? 'No end date' : NOT_RECORDED);
  return `${from} → ${to}`;
}

/** The Schedule cell: "Signed 2 Oct 2026", "Sent, not signed" or "Not sent". */
export function scheduleOf(p) {
  const s = p.grant?.schedule;
  if (!p.grant) return null;
  if (s?.status === 'signed') return { text: `Signed ${longDate(s.signed_at)}`, muted: false };
  if (s?.status === 'sent') return { text: 'Sent, not signed', muted: false };
  if (s?.status === 'not_sent') return { text: 'Not sent', muted: true };
  return { text: NOT_RECORDED, muted: true };
}

/**
 * The Action cell. A held program opens its page and its terms; a program HQ
 * offers and the studio does not hold can be asked for; one asked for shows
 * the request. Runs at HQ, and a program HQ does not offer, have none.
 */
export function actionOf(p, status) {
  if (status.word === 'Requested') return { kind: 'view_request' };
  if (HELD.includes(p.standing)) {
    return { kind: 'open', page: PROGRAM_PAGE[p.program_key] || null, change: isHeld(p), end: isHeld(p) };
  }
  if (p.standing === 'not_recorded') return { kind: 'request' };
  return null;
}

// ──────────────────────────────────────────────────────────────── the tiles

const DAY = 86_400_000;

/**
 * GR7's four tiles. Each takes the read it depends on: `programs` undefined is
 * reading, null unreadable; `requests` the same. A tile never shows a zero for
 * a read that did not answer.
 */
export function programTiles({ programs, requests, today = new Date() }) {
  const reading = programs === undefined;
  const lost = programs === null;
  const list = Array.isArray(programs) ? programs : [];
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const horizon = new Date(t0 + 90 * DAY);
  const read = (fn) => (reading ? { value: '', sub: 'Reading…' } : lost ? { value: UNREADABLE, sub: 'Not read with the programs' } : fn());

  const granted = read(() => {
    const held = list.filter(isHeld).length;
    return { value: String(held), sub: `of ${list.filter(isOffered).length} HQ offers` };
  });

  const asked = requests === undefined ? { value: '', sub: 'Reading…' }
    : requests === null ? { value: UNREADABLE, sub: 'Your requests could not be read' }
      : (() => {
        const open = openProgramRequests(requests.items);
        return { value: String(open.length), sub: open.length ? requestLine(open[0]) : 'none waiting on HQ' };
      })();

  const ending = read(() => {
    const soon = list.filter((p) => isHeld(p) && p.grant?.effective_end)
      .filter((p) => { const d = dayOf(p.grant.effective_end); return d && d.getTime() >= t0 && d <= horizon; })
      .sort((a, b) => String(a.grant.effective_end).localeCompare(String(b.grant.effective_end)));
    return soon.length
      ? { value: String(soon.length), sub: `${nameOf(soon[0].program_key)} ends ${longDate(soon[0].grant.effective_end)}` }
      : { value: '0', sub: `none end before ${longDate(horizon)}` };
  });

  const fees = read(() => {
    const held = list.filter(isHeld);
    const byCur = new Map();
    let unset = 0;
    for (const p of held) {
      const t = p.grant?.terms || {};
      if (!set(t.fee_cents)) { unset += 1; continue; }
      const cur = t.currency || '';
      byCur.set(cur, (byCur.get(cur) || 0) + Number(t.fee_cents));
    }
    if (!byCur.size) return { value: NOT_RECORDED, sub: held.length ? 'no fee is in your grant terms' : 'no program is granted' };
    const value = [...byCur].map(([cur, cents]) => grantMoney(cents, cur || null)).join(' + ');
    return { value, sub: unset ? `${unset} grant${unset === 1 ? ' has' : 's have'} no fee recorded` : 'set in your grant terms' };
  });

  return [
    { id: 'granted', label: 'Programs granted', ...granted },
    { id: 'requests', label: 'Requests with HQ', ...asked },
    { id: 'ending', label: 'Ending in 90 days', ...ending },
    { id: 'fees', label: 'Program fees a year', ...fees },
  ];
}

/** The Summary card's line (GR7 inset 1): "4 granted · 1 with HQ". */
export function summaryLine(programs, requests) {
  const held = Array.isArray(programs) ? `${programs.filter(isHeld).length} granted` : programs === null ? 'Programs unreadable' : 'Reading…';
  const open = requests && Array.isArray(requests.items) ? `${openProgramRequests(requests.items).length} with HQ` : requests === null ? 'requests unreadable' : null;
  return [held, open].filter(Boolean).join(' · ');
}

/** "As of 10:42, 18 Oct" on a branch's copy (GR13 C); nothing on HQ, whose read is the store. */
export function copyStamp(read) {
  if (read?.source !== 'copy') return null;
  const t = Date.parse(String(read.as_of || ''));
  if (!Number.isFinite(t)) return 'HQ’s copy of your grants has no date. It updates when HQ changes them.';
  const d = new Date(t);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `As of ${hm} UTC, ${longDate(d)}. This is HQ’s copy of your grants. It updates when HQ changes them.`;
}

// ──────────────────────────────────────────────────────────────── the terms card (GR8)

/** The chip that names where a term is stated. */
export function scheduleChip(grant) {
  const s = grant?.schedule?.status;
  if (s === 'signed') return 'Program schedule · signed';
  if (s === 'sent') return 'Program schedule · sent';
  return 'No schedule sent yet';
}

/**
 * GR8's rows for one grant. Each is { eye, text, sub, unset, chip }: a term
 * nobody set reads "Not recorded" with "HQ has not entered this term", and
 * carries no chip, because no schedule states it.
 */
export function termRows(p) {
  const g = p?.grant;
  if (!g) return [];
  const t = g.terms || {};
  const applies = termsFor(p.program_key);
  const chip = scheduleChip(g);
  const row = (eye, text, extra = {}) => (text === null
    ? { eye, text: NOT_RECORDED, sub: NOT_ENTERED, unset: true, chip: null }
    : { eye, text, sub: extra.sub || null, unset: false, chip });
  const out = [];

  const from = set(t.starts_on) ? `From ${longDate(t.starts_on)}` : null;
  const to = set(t.ends_on) ? `ends ${longDate(t.ends_on)}`
    : t.ends_with_licence === 1 ? `ends with the licence term${g.effective_end ? `, ${longDate(g.effective_end)}` : ''}`
      : t.ends_with_licence === 0 ? 'no end date' : null;
  out.push(row('PERIOD', from && to ? `${from} · ${to}` : from || (to ? to.charAt(0).toUpperCase() + to.slice(1) : null),
    from && !to ? { sub: 'No end is recorded.' } : {}));

  if (applies.includes('capacity_cap')) {
    out.push(t.capacity_uncapped === 1
      ? row('CAPACITY', 'No cap', { sub: 'An empty capacity means no cap.' })
      : row('CAPACITY', set(t.capacity_cap) ? termValue('capacity_cap', t) : null));
  }
  if (applies.includes('cohorts_per_year')) out.push(row('COHORTS', termValue('cohorts_per_year', t)));
  if (applies.includes('hq_approves_each_cohort')) {
    out.push(row('APPROVAL', set(t.hq_approves_each_cohort) ? (t.hq_approves_each_cohort === 1 ? 'HQ approves each cohort' : 'The studio opens cohorts without HQ’s approval') : null));
  }

  const money = [];
  if (set(t.fee_cents)) money.push(`Program fee to HQ ${termValue('fee_cents', t)} a year`);
  if (applies.includes('hq_share_bps') && set(t.hq_share_bps)) money.push(`HQ share ${termValue('hq_share_bps', t)}`);
  if (applies.includes('hq_approval_above_cents') && set(t.hq_approval_above_cents)) money.push(`HQ approves each payout above ${termValue('hq_approval_above_cents', t)}`);
  out.push(row('MONEY', money.length ? money.join(' · ') : null));

  if (applies.includes('credits_per_quarter')) {
    // D540: one credit is US$1 of perk value (the catalogue's CREDIT_FOOT).
    out.push(row('CREDITS', termValue('credits_per_quarter', t), { sub: '1 credit is worth $1 of perk value.' }));
  }
  out.push(row('PLAYBOOK', termValue('playbook', t)));
  out.push(row('BRAND', termValue('brand', t)));
  out.push(row('REPORTING', termValue('reporting', t)));

  const s = g.schedule || {};
  const contract = s.status === 'signed' ? `Program schedule: ${nameOf(p.program_key)} · Signed ${longDate(s.signed_at)}`
    : s.status === 'sent' ? `Program schedule: ${nameOf(p.program_key)} · Sent, not signed`
      : 'Not sent';
  out.push({
    eye: 'CONTRACT', text: contract, unset: s.status !== 'signed' && s.status !== 'sent', chip: null,
    sub: t.requires_signed_schedule === 0
      ? 'HQ does not wait on a signed schedule for this program.'
      : s.status === 'signed' ? 'It states the terms as they stood the day HQ sent it.' : 'This program is in force only once the schedule is signed.',
  });
  out.push(g.note
    ? { eye: 'NOTE TO THE STUDIO', text: g.note, sub: null, unset: false, chip: null }
    : { eye: 'NOTE TO THE STUDIO', text: 'No note', sub: 'HQ left no note on this grant.', unset: true, chip: null });
  return out;
}

/**
 * "What HQ recorded on this grant": the dates the grant itself carries. The
 * full history is HQ's ledger, which the studio's read does not carry.
 */
export function grantDates(p) {
  const g = p?.grant;
  if (!g) return [];
  const out = [];
  if (g.ended_at) out.push({ at: g.ended_at, t: 'Ended by HQ' });
  if (g.paused_at) out.push({ at: g.paused_at, t: 'Paused by HQ' });
  if (g.schedule?.signed_at) out.push({ at: g.schedule.signed_at, t: 'Program schedule signed' });
  if (g.set_at) out.push({ at: g.set_at, t: 'Terms last set by HQ' });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ──────────────────────────────────────────────────────────────── the request sheet (GR9)

export const ASKS = [
  { id: 'grant', t: 'Grant', kind: 'program_grant' },
  { id: 'change', t: 'Change a term', kind: 'program_terms_change' },
  { id: 'end', t: 'End', kind: 'program_end' },
];

/** Only programs HQ offers can be asked for (GR9's "Only programs HQ offers"). */
export const requestablePrograms = (programs) => (Array.isArray(programs) ? programs : []).filter(isOffered);

/** Which asks a program allows: Grant when the studio does not hold it, Change and End when it does. */
export function asksFor(p) {
  if (!p) return [];
  if (isHeld(p)) return ['change', 'end'];
  if (p.standing === 'not_recorded' || p.standing === 'ended') return ['grant'];
  return [];
}

/**
 * The body D983's door takes, or why it cannot be sent. What the term stands
 * at is HQ's to fill (the Worker refuses `current`), so it is never sent.
 */
export function buildProgramRequest({ program, ask, term, asked, why }) {
  const p = program?.program_key;
  const name = nameOf(p);
  const note = String(why ?? '').trim();
  if (!p) return { ok: false, message: 'Pick the program you are asking about.' };
  const kind = ASKS.find((a) => a.id === ask)?.kind;
  if (!kind || !asksFor(program).includes(ask)) return { ok: false, message: 'Pick what you are asking HQ for.' };
  if (!note) return { ok: false, message: 'Say why your studio needs it. HQ reads this first.' };
  if (note.length > NOTE_MAX) return { ok: false, message: `Keep the reason to ${NOTE_MAX} characters.` };
  if (kind === 'program_grant') return { ok: true, body: { kind, subject: `Program · ${name}`, detail: note, request: { program: p } } };
  if (kind === 'program_end') return { ok: true, body: { kind, subject: `End program · ${name}`, detail: note, request: { program: p } } };
  if (!term || !askableTerms(p).includes(term)) return { ok: false, message: 'Pick the term you want changed.' };
  const want = String(asked ?? '').trim();
  if (!want) return { ok: false, message: 'Say what you ask for instead.' };
  if (want.length > ASKED_MAX) return { ok: false, message: `Keep what you ask for to ${ASKED_MAX} characters. Put the reasoning in the reason.` };
  return { ok: true, body: { kind, subject: `Program change · ${name} · ${TERM_LABEL[term]}`, detail: note, request: { program: p, term, asked: want } } };
}


/** The request's kind as "Your requests" reads it: "Program · Learning", "Program change · Perks · Credits a quarter". */
export function programRequestKind(item) {
  const r = item?.request || {};
  const name = nameOf(r.program);
  if (item?.kind === 'program_grant') return `Program · ${name}`;
  if (item?.kind === 'program_end') return `End program · ${name}`;
  if (item?.kind === 'program_terms_change') return `Program change · ${name}${r.term ? ` · ${TERM_LABEL[r.term] || r.term}` : ''}`;
  return null;
}
