/**
 * D1153 (#3058, part 5 of #2421) — the pure model of the investor's working
 * tabs: Diligence (DL7), Documents and data room (DL8, DL9), Terms (DL10) and
 * Commitment and closing (DL11–DL13). The components in this folder only draw
 * what these functions return, so the tests read the rules without a browser.
 *
 * Never a zero for a missing value: a figure no read holds is "Not recorded"
 * with its reason, and a read that failed is "Unreadable". Behind an NDA a
 * withheld file is counted, never named: the room read returns only the files
 * the investor may open, and `withheld_behind_nda` as a number. Another
 * investor is never named and no amount of theirs is drawn: the round is a
 * count of investors and a total.
 */
import { dealMoney } from '../../components/deals/dealMoney';
import { NOT_RECORDED } from '../../lib/absence';

export { NOT_RECORDED };
const DAY = 86400000;

/** A D1 stamp ("2026-10-24 10:00:00", or ISO) as UTC milliseconds, or null. */
export function stampMs(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim();
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t.replace(' ', 'T') : `${t.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "24 Oct 2026", or null for a stamp that cannot be read. */
export function dayOf(s) {
  const ms = stampMs(s);
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------- DL7 Diligence

export const casePath = (uid) => `/admin/due-diligence/${encodeURIComponent(uid)}`;

const STAGE_WORD = { not_started: 'Not started', in_review: 'In review', ready: 'Ready for a decision', decided: 'Decided', archived: 'Archived' };
const RISK_WORD = { low: 'Low risk', moderate: 'Moderate risk', medium: 'Moderate risk', high: 'High risk', critical: 'Critical risk' };

/**
 * This investor's case on the deal's company, from their own case list (the
 * Worker lists only cases they opened, lead or review). The newest that is not
 * archived; a list that stopped at its page says so rather than "no case".
 */
export function caseForDeal(read, projectId) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const items = Array.isArray(read.data?.items) ? read.data.items : [];
  const mine = items.filter((c) => c.subject_type === 'project' && Number(c.subject_id) === Number(projectId) && c.status !== 'archived');
  if (mine.length) return { state: 'ready', row: mine[0] };
  const total = Number(read.data?.total);
  if (Number.isFinite(total) && total > items.length) return { state: 'not_in_read', line: `Only your newest ${items.length} cases were read, and none of them is on this company.` };
  return { state: 'none' };
}

/** The case card's lines (DL7). */
export function caseCard(row, detail, userId) {
  const total = Number(row.checklist_total);
  const worked = Number(row.checklist_worked);
  const items = Number.isFinite(total) && total > 0 && Number.isFinite(worked)
    ? { line: `${worked} of ${total} items worked`, pct: Math.round((worked / total) * 100) }
    : { line: 'No checklist items are recorded on this case.', pct: null };
  const flags = Number(row.open_flags);
  const sections = (detail?.sections || []).filter((s) => Number(s.assignee_user_id) === Number(userId)
    || (detail?.reviewers || []).some((r) => Number(r.section_id) === Number(s.id) && Number(r.user_id) === Number(userId)));
  return {
    title: row.subject_label || NOT_RECORDED,
    stage: STAGE_WORD[row.stage] || STAGE_WORD.not_started,
    risk: row.risk_band ? (RISK_WORD[String(row.risk_band).toLowerCase()] || `${row.risk_band} risk`) : 'Risk not scored yet',
    items,
    flags: Number.isFinite(flags) ? (flags === 0 ? 'No open flags' : `${flags} open flag${flags === 1 ? '' : 's'}`) : 'Open flags not recorded',
    opened: `Opened ${dayOf(row.created_at) || 'on a date not recorded'}${row.lead_name ? ` · led by ${row.lead_name}` : ''}`,
    yours: detail ? sections.map((s) => ({ title: s.title, status: s.status === 'completed' ? 'Done' : s.status === 'in_review' ? 'In review' : 'Open' })) : null,
    href: casePath(row.uid),
  };
}

/** Requests to the founder, from the case read, each with how long it has waited and its due date (D1248). */
export function requestRows(detail, nowMs = Date.now()) {
  return (detail?.requests || []).map((r) => {
    // D1248: a withdrawn request keeps its state but takes no answer, so it never waits.
    if (r.withdrawn_at) return { id: r.id, title: r.title, tone: 'off', state: `Withdrawn${dayOf(r.withdrawn_at) ? ` ${dayOf(r.withdrawn_at)}` : ''}` };
    if (r.state === 'requested') {
      const at = stampMs(r.created_at);
      const days = at == null ? null : Math.max(0, Math.floor((nowMs - at) / DAY));
      const due = dayOf(r.due_date) ? ` · due ${dayOf(r.due_date)}` : '';
      return { id: r.id, title: r.title, tone: 'wait', state: `${days == null ? 'Waiting · asked on a date not recorded' : `Waiting ${days} day${days === 1 ? '' : 's'}`}${due}` };
    }
    const answered = dayOf(r.responded_at);
    return { id: r.id, title: r.title, tone: 'done', state: r.state === 'reviewed' ? `Reviewed${answered ? ` · answered ${answered}` : ''}` : `Answered${answered ? ` ${answered}` : ''}` };
  });
}

export const QUESTIONS_SLOT = {
  eye: 'Eadwyn · drafted from gaps in the evidence',
  title: 'Questions to ask',
  line: 'Eadwyn’s questions are not read here yet: no read drafts them for a deal. When they arrive they are a draft; nothing is sent until you send it as a diligence request.',
};

// ---------------------------------------------------------------- DL8, DL9 Documents and data room

/**
 * The room's door in one of DL8's three access states, from the room-access
 * read and, once granted, the shared room read. Withheld files are a count.
 */
export function roomStateOf(access, room) {
  if (!access || access.status === 'loading') return { state: 'loading' };
  if (access.status === 'unreadable') return { state: 'unreadable', what: 'Your access to the data room' };
  const a = access.data || {};
  if (!a.granted) {
    const r = a.request;
    let line = 'The founder has not opened their data room to you.';
    let canAsk = true;
    if (r?.state === 'open') { line = `You asked for access on ${dayOf(r.created_at) || 'a date not recorded'}. The founder decides; you’ll get a notice either way.`; canAsk = false; }
    else if (r?.state === 'declined') line = `The founder declined your request on ${dayOf(r.decided_at) || 'a date not recorded'}${r.decline_reason ? `: ${r.decline_reason}` : '.'}`;
    else if (r?.state === 'accepted') line = 'The founder accepted your request, and the access it gave has ended.';
    return { state: 'not_opened', line, canAsk };
  }
  if (!room || room.status === 'loading') return { state: 'loading' };
  if (room.status === 'unreadable') return { state: 'unreadable', what: 'The data room' };
  const d = room.data || {};
  const withheld = Number(d.withheld_behind_nda) || 0;
  const until = a.granted.expires_at ? ` Your access ends ${dayOf(a.granted.expires_at)}.` : '';
  if (d.nda_signed) {
    const end = dayOf(a.nda?.valid_until);
    return { state: 'nda_on_file', line: `You have access and an NDA on file${end ? ` until ${end}` : ', with no end date recorded'}.${until}`, withheld: 0 };
  }
  if (withheld > 0) {
    const pending = a.nda?.status === 'out_for_signature';
    return {
      state: 'behind_nda',
      line: `You have access. ${withheld} file${withheld === 1 ? ' is' : 's are'} behind an NDA.${until}`,
      withheld,
      ndaPending: pending,
      canSign: !pending && a.founder_user_id != null,
    };
  }
  return { state: 'open', line: `You have access. No file you can open here needs an NDA.${until}`, withheld: 0 };
}

/**
 * The folders and files the room read returned — the only files ever listed.
 * Each folder counts its own listed files; a file outside every folder is
 * "Not in a folder".
 */
export function roomListing(data) {
  const files = Array.isArray(data?.files) ? data.files : [];
  const folders = (Array.isArray(data?.folders) ? data.folders : []).map((f) => ({ uid: f.uid, name: f.name, count: files.filter((x) => x.folder_uid === f.uid).length }));
  const loose = files.filter((x) => !x.folder_uid || !folders.some((f) => f.uid === x.folder_uid)).length;
  return { folders, loose, files: files.map((f) => ({ uid: f.uid, name: f.name, folder_uid: f.folder_uid || null, type: f.content_type || NOT_RECORDED, size: sizeOf(f.size_bytes), added: dayOf(f.created_at) || NOT_RECORDED })) };
}

export function sizeOf(bytes) {
  const n = Number(bytes);
  if (bytes == null || !Number.isFinite(n) || n < 0) return NOT_RECORDED;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const PAPER_WORD = { sent: 'Sent', partially_signed: 'Partly signed', completed: 'Fully signed', declined: 'Declined', voided: 'Voided', expired: 'Expired' };
/** The deal's paper: the envelopes for this deal that the e-sign read lets this viewer see. */
export function paperRows(envelopes) {
  return (envelopes || []).map((e) => ({
    id: e.id,
    title: e.document_title || e.document_type || NOT_RECORDED,
    state: `${PAPER_WORD[e.status] || 'Status not recorded'}${e.status === 'completed' ? (dayOf(e.completed_at) ? ` ${dayOf(e.completed_at)}` : '') : (dayOf(e.created_at) ? ` · sent ${dayOf(e.created_at)}` : '')}`,
    tone: e.status === 'completed' ? 'done' : ['declined', 'voided', 'expired'].includes(e.status) ? 'off' : 'wait',
  }));
}

export const ASK_MAX = 2000;

// ---------------------------------------------------------------- DL10 Terms

const NO_FIELD = 'No field on the deal holds it yet.';
const NOT_ON_DEAL = 'The deal does not record it.';

/** Proposed terms, each with where it comes from; a term no field holds says so. */
export function proposedTerms(deal) {
  const cur = deal?.currency || 'USD';
  const pct = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : `${Number(v)}%`);
  const rows = [
    ['Instrument', deal?.instrument || null],
    ['Round size', dealMoney(deal?.target_raise ?? deal?.amount, cur)],
    ['Valuation cap', dealMoney(deal?.valuation_cap, cur)],
    ['Minimum', dealMoney(deal?.minimum_check, cur)],
    ['Carry', pct(deal?.carry_pct)],
    ['Management fee', pct(deal?.management_fee_pct)],
    ['Vehicle jurisdiction', deal?.spv_jurisdiction || null],
    ['Closing date', dayOf(deal?.closing_deadline)],
  ].map(([label, value]) => (value == null
    ? { label, value: NOT_RECORDED, source: NOT_ON_DEAL, missing: true }
    : { label, value, source: 'From the deal', missing: false }));
  return rows.concat(['Discount', 'Pro rata', 'Information rights', 'Board seat']
    .map((label) => ({ label, value: NOT_RECORDED, source: NO_FIELD, missing: true })));
}

export const LEGAL_SLOT = {
  eye: 'Legal paper · the Axal VC templates',
  title: 'Legal paper',
  line: 'Which templates this deal uses is not read here yet: no read ties a template to a deal. The paper sent to you shows on Documents as it goes out.',
};
/** D1027: staff and the founder read the cap table elsewhere; an investor reads the panel (CT15) here. */
export const CAP_TABLE_SLOT = {
  eye: 'CT15 · Cap table',
  title: 'Cap table',
  line: 'Investors read the cap table here, at the level the founder shares with them. The founder keeps it in Raise › Cap table.',
};
export const ROUTES = [
  { key: 'direct', title: 'Direct', line: 'You sign and pay as yourself or your firm.' },
  { key: 'syndicate', title: 'Through a syndicate', line: 'You join a syndicate on this deal, and its lead signs for its members.' },
  { key: 'fund', title: 'Through a fund', line: 'A fund you are in invests, and you hold your share through it.' },
];
export const ROUTE_NOTE = 'The studio sets the route in the closing room. No preference is recorded here yet.';

// ---------------------------------------------------------------- DL11–DL13 Commitment and closing

const STATUS_WORD = { pending: 'Pending', confirmed: 'Confirmed', withdrawn: 'Withdrawn' };

/** Your commitment: the live one, if any; withdrawn ones are history. */
export function myCommitment(read, currency = 'USD') {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const rows = Array.isArray(read.items) ? read.items : [];
  const live = rows.find((r) => r.status === 'pending' || r.status === 'confirmed');
  const history = rows.filter((r) => r !== live).map((r) => ({ uid: r.uid, line: `${dealMoney(r.amount, currency) || NOT_RECORDED} · ${STATUS_WORD[r.status] || r.status} · recorded ${dayOf(r.created_at) || 'on a date not recorded'}` }));
  if (!live) return { state: 'none', history };
  return {
    state: 'ready',
    uid: live.uid,
    amount: dealMoney(live.amount, currency) || NOT_RECORDED,
    status: STATUS_WORD[live.status],
    confirmed: live.status === 'confirmed',
    recorded: `Recorded ${dayOf(live.created_at) || 'on a date not recorded'}`,
    note: live.notes ? String(live.notes) : null,
    // D1155: the row itself, for D752's proof door on your own commitment.
    row: live,
    history,
  };
}

/** Who reads a commitment's note: since D1155 the Worker returns it to you alone (DL15); the founder and the studio see the amount and status. */
export const NOTE_READERS = 'Only you read this note. The founder and the studio see your amount and status, never the note.';

/** The round as a count of investors and a total; never a name, never another investor's amount. */
export function roundLines(read, deal) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const r = read.data || {};
  const cur = r.currency || deal?.currency || 'USD';
  const n = Number(r.investors);
  const target = Number(deal?.target_raise ?? deal?.amount);
  const confirmed = Number(r.confirmed_total);
  return {
    state: 'ready',
    investors: Number.isFinite(n) ? `${n} investor${n === 1 ? ' has' : 's have'} a live commitment` : `Investors: ${NOT_RECORDED}`,
    confirmed: `${dealMoney(confirmed, cur) || NOT_RECORDED} confirmed${Number.isFinite(target) && target > 0 ? ` of ${dealMoney(target, cur)}` : ''}`,
    pending: Number(r.pending_total) > 0 ? `${dealMoney(r.pending_total, cur)} more is pending` : null,
    pct: Number.isFinite(target) && target > 0 && Number.isFinite(confirmed) ? Math.min(100, Math.round((confirmed / target) * 100)) : null,
    privacy: 'Other investors are counted, never named, and their amounts are not shown.',
  };
}

export const WITHDRAW_MAX = 500;
/** Withdraw needs a reason. */
export function withdrawError(reason) {
  const t = String(reason ?? '').trim();
  if (!t) return 'Write why you are withdrawing.';
  if (t.length > WITHDRAW_MAX) return `Keep the reason to ${WITHDRAW_MAX} characters.`;
  return null;
}

export const SYNDICATES_LINE = 'The syndicates you lead or belong to on this company. A syndicate you are not in is not listed: today’s read shows only your own.';
