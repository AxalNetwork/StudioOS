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
import { dealMoney, roundAsk } from '../../components/deals/dealMoney';
import { NOT_RECORDED } from '../../lib/absence';
import { FLAG_STATE_WORD, icState, openFlags, sectionWork } from '../duediligence/ddCaseModel.js';
import { DEPTH_WORD, SEVERITY_WORD } from '../duediligence/ddListModel.js';
import { verdictWord } from '../duediligence/ddReviewModel.js';
import { STEPS, STUDIO_PASSED, YOU_PASSED } from './dealFrameModel.js';
import { tabHref } from '../dealPageModel.js';

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

/**
 * The case's own page, under the address every diligence reader opens (D6180,
 * #6180): `/due-diligence/:uid`, never the `/admin/` one, and a tab word only
 * when the door is for one tab (the Memo and the reports are on Sign-off).
 */
export const casePath = (uid, tab = '') => `/due-diligence/${encodeURIComponent(uid)}${tab ? `/${tab}` : ''}`;

const STAGE_WORD = { not_started: 'Not started', in_review: 'In review', ready: 'Ready for a decision', decided: 'Decided', archived: 'Archived' };
const RISK_WORD = { low: 'Low risk', moderate: 'Moderate risk', medium: 'Moderate risk', high: 'High risk', critical: 'Critical risk' };

/**
 * This investor's case on the deal's company, from their own case list (the
 * Worker lists only cases they opened, lead or review). The newest that is not
 * archived. D6181 (#6181): the list is read for this company alone
 * (`subject_id`), so it is never cut short by the caller's other cases and an
 * empty answer is "no case"; the subject check below stays as a guard.
 */
export function caseForDeal(read, projectId) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const items = Array.isArray(read.data?.items) ? read.data.items : [];
  const mine = items.filter((c) => c.subject_type === 'project' && Number(c.subject_id) === Number(projectId) && c.status !== 'archived');
  if (mine.length) return { state: 'ready', row: mine[0] };
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

/**
 * D6180: the open flags on the case read (`flags`: findings, and checklist
 * items marked flag or fail), severest first, each with its severity and its
 * state in words, never a colour alone. Every state but Closed is open, as on
 * the case's Flags tab. A read with no list is not "none": `rows` is null.
 */
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export function openFlagRows(detail) {
  if (!detail || !Array.isArray(detail.flags)) return { line: 'Open flags not recorded', rows: null };
  const titles = new Map((detail.sections || []).map((s) => [Number(s.id), s.title]));
  const rows = [...openFlags(detail.flags)]
    .sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map((f) => ({
      key: `${f.kind}-${f.id ?? f.checklist_item_id}`,
      title: f.title || NOT_RECORDED,
      severity: SEVERITY_WORD[f.severity] ? `${SEVERITY_WORD[f.severity]} severity` : 'Severity not recorded',
      state: FLAG_STATE_WORD[f.state] || NOT_RECORDED,
      section: titles.get(Number(f.section_id)) || (f.section_id == null ? 'Case-wide' : NOT_RECORDED),
    }));
  return { line: rows.length ? `${rows.length} open flag${rows.length === 1 ? '' : 's'}` : 'No open flags', rows };
}

/** D6180: each section's progress on the case read: items worked of its checklist, and its verdict. */
export function sectionProgress(detail) {
  return (detail?.sections || []).map((s) => {
    const w = sectionWork(detail.checklist, s.id);
    return {
      id: s.id, title: s.title || NOT_RECORDED,
      line: w.total ? `${w.worked} of ${w.total} items worked` : 'No checklist items',
      pct: w.total ? Math.round((w.worked / w.total) * 100) : null,
      verdict: verdictWord(s.verdict),
    };
  });
}

/**
 * D6180: the case's next step towards IC, on the case read. The Worker sends a
 * case to IC (`POST /dd/cases/:uid/ic`) only for its lead or an Admin, and
 * only after Proceed or Proceed with conditions is recorded, so the button is
 * offered exactly when the case page's own rule (`icState`) says it may be.
 * "Ready for a decision" comes before that decision: the card says so and
 * opens Sign-off, where the decision is recorded. Before that stage, or with
 * no read, nothing is drawn.
 */
export function icStep(row, detail) {
  if (!detail?.case || detail.case.scoped) return null;
  const ic = icState(detail.case, detail);
  if (ic.state === 'sent') return { state: 'sent', text: ic.text, href: '/deals/commit' };
  if (ic.state === 'ready') return { state: 'ready', text: ic.text };
  if (row?.stage === 'ready') {
    return { state: 'decide', text: 'Every section has a verdict. Record Proceed or Proceed with conditions on the case before it goes to IC.', href: casePath(row.uid, 'sign-off') };
  }
  if (row?.stage === 'decided') return { state: 'waits', text: ic.text };
  return null;
}

/** D6180: the doors to the case's Memo and reports, both on its Sign-off tab, for the readers the Worker lets read them. */
export function caseDoors(row, detail) {
  if (!detail?.case || detail.case.scoped) return [];
  const doors = [];
  if (detail.allowed?.report) doors.push({ key: 'report', label: 'Reports', href: casePath(row.uid, 'sign-off') });
  if (detail.allowed?.memo_read) doors.push({ key: 'memo', label: 'Memo', href: casePath(row.uid, 'sign-off') });
  return doors;
}

/**
 * D6180: the template depths offered when a case is opened (`GET
 * /dd/templates`), each with its current item count. A picker is drawn only
 * when more than one is offered; otherwise the case opens at Standard.
 */
export function templateChoices(read) {
  const list = read?.status === 'ready' && Array.isArray(read.data?.templates) ? read.data.templates : [];
  return list.filter((t) => t && DEPTH_WORD[t.depth]).map((t) => {
    const n = Number(t.current?.item_count);
    return { depth: t.depth, label: DEPTH_WORD[t.depth], line: Number.isFinite(n) ? `${n} checklist item${n === 1 ? '' : 's'}` : 'Item count not recorded' };
  });
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
    return {
      id: r.id, title: r.title, tone: 'done',
      state: r.state === 'reviewed' ? `Reviewed${answered ? ` · answered ${answered}` : ''}` : `Answered${answered ? ` ${answered}` : ''}`,
      answer: {
        note: r.response_note || null,
        url: r.response_url || null,
        files: Array.isArray(r.files) ? r.files : null,
      },
    };
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
 *
 * D4815 DX10 (#5907, board DE10): four access states and a fifth for a read
 * that failed, in DE10's words:
 *   not_opened   A · "The founder has not opened the data room to you." · Ask for access
 *   behind_nda   B · "You have access. 6 files require an NDA." · Sign NDA
 *   nda_pending  C · "Waiting for signatures." (its own state, never B's footnote)
 *   open / nda_on_file   D · folders, search and files
 *   unreadable   E · "Data room access could not be confirmed." · Try again, never Ask
 * DE10 also draws a signed count ("2 of 3 signed"); the access read carries
 * the NDA's status only, so no count is drawn.
 */
export function roomStateOf(access, room) {
  if (!access || access.status === 'loading') return { state: 'loading' };
  if (access.status === 'unreadable') return { state: 'unreadable', what: 'Data room access', line: 'Data room access could not be confirmed.' };
  const a = access.data || {};
  if (!a.granted) {
    const r = a.request;
    let line = 'The founder has not opened the data room to you.';
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
    // C: the NDA is out for signature. Its own state, so nothing offers Sign NDA twice.
    if (pending) {
      return {
        state: 'nda_pending',
        line: 'Waiting for signatures.',
        sub: `${withheld} file${withheld === 1 ? ' opens' : 's open'} once every party has signed.${until}`,
        withheld,
        ndaPending: true,
        canSign: false,
      };
    }
    return {
      state: 'behind_nda',
      line: `You have access. ${withheld} file${withheld === 1 ? ' requires' : 's require'} an NDA.${until}`,
      withheld,
      ndaPending: false,
      canSign: a.founder_user_id != null,
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
  return { folders, loose, files: files.map((f) => ({ uid: f.uid, name: f.name, folder_uid: f.folder_uid || null, type: fileTypeOf(f.content_type, f.name), size: sizeOf(f.size_bytes), added: dayOf(f.created_at) || NOT_RECORDED })) };
}

/**
 * D4815 DX10 (#5907): a file's type in a reader's word (DE10's Type column:
 * PDF, Excel, Archive), from its stored content type, else its extension.
 * Neither recorded is "Not recorded"; a known type with no word is "File".
 */
const TYPE_BY_MIME = [
  [/^application\/pdf$/, 'PDF'],
  [/spreadsheet|ms-excel|^text\/csv$/, 'Spreadsheet'],
  [/wordprocessing|msword|opendocument\.text/, 'Document'],
  [/presentation|ms-powerpoint/, 'Slides'],
  [/zip|x-7z|x-rar|x-tar|gzip/, 'Archive'],
  [/^image\//, 'Image'],
  [/^video\//, 'Video'],
  [/^audio\//, 'Audio'],
  [/^text\//, 'Text'],
];
const TYPE_BY_EXT = {
  pdf: 'PDF', xlsx: 'Spreadsheet', xls: 'Spreadsheet', csv: 'Spreadsheet', numbers: 'Spreadsheet',
  docx: 'Document', doc: 'Document', pages: 'Document', odt: 'Document',
  pptx: 'Slides', ppt: 'Slides', key: 'Slides',
  zip: 'Archive', '7z': 'Archive', rar: 'Archive', gz: 'Archive', tar: 'Archive',
  png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', webp: 'Image',
  mp4: 'Video', mov: 'Video', mp3: 'Audio', wav: 'Audio', txt: 'Text', md: 'Text',
};
export function fileTypeOf(contentType, name) {
  const mime = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (mime) {
    const hit = TYPE_BY_MIME.find(([re]) => re.test(mime));
    if (hit) return hit[1];
  }
  const ext = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''))?.[1]?.toLowerCase();
  if (ext && TYPE_BY_EXT[ext]) return TYPE_BY_EXT[ext];
  return mime ? 'File' : NOT_RECORDED;
}

export function sizeOf(bytes) {
  const n = Number(bytes);
  if (bytes == null || !Number.isFinite(n) || n < 0) return NOT_RECORDED;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const PAPER_WORD = { sent: 'Sent', partially_signed: 'Partly signed', completed: 'Fully signed', declined: 'Declined', voided: 'Voided', expired: 'Expired', rejected: 'Declined', void: 'Voided' };
// D6184 (#6184): the Worker writes `rejected` and `void` (esign.ts); the older words stay for rows written before.
const PAPER_CLOSED = ['declined', 'voided', 'expired', 'rejected', 'void'];
/** The deal's paper: the envelopes for this deal that the e-sign read lets this viewer see. */
export function paperRows(envelopes) {
  return (envelopes || []).map((e) => ({
    id: e.id,
    title: e.document_title || e.document_type || NOT_RECORDED,
    state: `${PAPER_WORD[e.status] || 'Status not recorded'}${e.status === 'completed' ? (dayOf(e.completed_at) ? ` ${dayOf(e.completed_at)}` : '') : (dayOf(e.created_at) ? ` · sent ${dayOf(e.created_at)}` : '')}`,
    tone: e.status === 'completed' ? 'done' : PAPER_CLOSED.includes(e.status) ? 'off' : 'wait',
    // D6184 (#6184): what the viewer can do with it. Download is the completed envelope's alone
    // (the Worker refuses any other with 409); an open one says how to sign; a closed one, neither.
    signed: signedLine(e),
    action: e.status === 'completed' ? 'download' : ['sent', 'partially_signed'].includes(e.status) ? 'sign' : PAPER_CLOSED.includes(e.status) ? 'closed' : 'none',
  }));
}

const countOf = (v) => (v == null || v === '' || !Number.isInteger(Number(v)) || Number(v) < 0 ? null : Number(v));
/** "2 of 3 signed", from the list's `recipient_count` and `signed_count`; never a guessed zero. */
export function signedLine(e) {
  const of = countOf(e?.recipient_count);
  const n = countOf(e?.signed_count);
  if (of == null || n == null) return 'Signatures not recorded';
  if (of === 0) return 'No signer is recorded on this envelope';
  return `${n} of ${of} signed`;
}

export const PAPER_CLOSED_LINE = 'It can no longer be signed, and there is no signed copy to download.';
export const PAPER_WAIT_DOWNLOAD = 'Download opens once the envelope is fully signed.';
export const SIGN_BY_EMAIL = 'Your signing link was sent by email';
/** D6197 (#6197): the signer's own link again, by email, and the finished envelope's file. */
export const PAPER_WORDS = Object.freeze({
  resend: 'Send me the link again',
  resending: 'Sending…',
  resent: 'Sent again. Look for it in your inbox, and in spam if it is not there.',
  resendFailed: 'The link could not be sent again. Try again.',
  download: 'Download the executed copy',
});

/**
 * D6184 (#6184): how the viewer signs an open envelope, from `GET /api/legal/esign/:id`. That read returns each
 * recipient's email and status and never a signing link (the token is the recipient's inbox's alone, D410), so
 * the line points to the email and no URL is ever built here. The viewer is matched by email, which is what the
 * recipient rows carry.
 */
export function paperSigning(read, email) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status !== 'ready') return { state: 'unreadable' };
  const me = String(email || '').trim().toLowerCase();
  const rows = Array.isArray(read.data?.recipients) ? read.data.recipients : [];
  const mine = me ? rows.find((r) => String(r.recipient_email || '').trim().toLowerCase() === me) : null;
  if (!mine) return { state: 'not_signer', line: 'You are not a signer on this envelope. It is waiting on the others.' };
  if (mine.status === 'signed') return { state: 'signed', line: `You signed${dayOf(mine.signed_at) ? ` on ${dayOf(mine.signed_at)}` : ''}. It is waiting on the others.` };
  if (mine.status === 'rejected') return { state: 'declined', line: 'You declined this envelope.' };
  if (mine.status === 'void') return { state: 'closed', line: PAPER_CLOSED_LINE };
  return { state: 'yours', line: `${SIGN_BY_EMAIL} to ${mine.recipient_email}. Open it from that email to review and sign.` };
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
    ['Round size', dealMoney(roundAsk(deal), cur)],
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
/** D6195: the owner's rule (#6195), said wherever the preference shows. */
export const ROUTE_NOTE = 'This is your preference. The studio sets the route in the closing room.';
export const ROUTE_NONE = 'No preference recorded';
/** D6195: a stored preference in words, or null for none (never Direct by default). */
export function routePreferenceWord(key) {
  return ROUTES.find((r) => r.key === key)?.title || null;
}
/**
 * D6195: the investor's own preference for the Terms tab, from `myCommitment`'s answer.
 * Loading and unreadable are said as such: an unread preference is never shown as none.
 */
export function termsPreference(mine) {
  if (!mine || mine.state === 'loading') return { state: 'loading', key: null, line: null };
  if (mine.state === 'unreadable') return { state: 'unreadable', key: null, line: 'Your preference could not be read just now. That is not a claim that you have none.' };
  if (mine.state === 'none') return { state: 'none', key: null, line: `${ROUTE_NONE}. You can record one when you commit.` };
  return { state: 'ready', key: mine.preference || null, line: preferenceLine(mine.preference) };
}
/** D6195: the investor's preference as the Terms and Commitment tabs say it. */
export function preferenceLine(pref) {
  return routePreferenceWord(pref) || ROUTE_NONE;
}

// ---------------------------------------------------------------- DL11–DL13 Commitment and closing

const STATUS_WORD = { pending: 'Pending', confirmed: 'Confirmed', withdrawn: 'Withdrawn' };

/** D4633: whom a commitment is held for, said outright. */
export function firmLine(row) {
  if (!row) return null;
  if (row.company_id == null) return 'Held in your own name.';
  return `Held for ${row.company_name || 'your firm'}.`;
}

/**
 * Your commitment: the live one, if any; withdrawn ones are history.
 * D4633: `read.dealId` is the deal the read was for. A read for another deal
 * (an answer that arrived after the page moved on) reads as loading, never as
 * this deal's commitment. The live row is the one in the firm context the
 * Worker read under (`in_context`). D5355 retired the pre-firm compatibility
 * branch after a production count found no such rows.
 */
export function myCommitment(read, currency = 'USD', dealId = undefined) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (dealId !== undefined && read.dealId !== undefined && String(read.dealId) !== String(dealId)) return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const rows = (Array.isArray(read.items) ? read.items : []).filter((r) => dealId === undefined || r.deal_id == null || String(r.deal_id) === String(dealId));
  const liveOf = (r) => r.status === 'pending' || r.status === 'confirmed';
  const live = rows.find((r) => liveOf(r) && r.in_context !== false);
  const history = rows.filter((r) => r !== live && !liveOf(r)).map((r) => ({ uid: r.uid, line: `${dealMoney(r.amount, currency) || NOT_RECORDED} · ${STATUS_WORD[r.status] || r.status} · recorded ${dayOf(r.created_at) || 'on a date not recorded'}` }));
  if (!live) return { state: 'none', history };
  return {
    state: 'ready',
    firm: firmLine(live),
    uid: live.uid,
    amount: dealMoney(live.amount, currency) || NOT_RECORDED,
    status: STATUS_WORD[live.status],
    confirmed: live.status === 'confirmed',
    recorded: `Recorded ${dayOf(live.created_at) || 'on a date not recorded'}`,
    note: live.notes ? String(live.notes) : null,
    // D6195: the stored preference key (direct, syndicate, fund) or null for none recorded.
    preference: routePreferenceWord(live.route_preference) ? live.route_preference : null,
    // D1155: the row itself, for D752's proof door on your own commitment.
    row: live,
    history,
  };
}

/**
 * D6191 (#6191): the one commitment action an investor is offered, from the deal's status and their
 * own commitment (`myCommitment`). `commit` only on an active deal with no live commitment;
 * `change` with a Pending one on an active deal; nothing with a Confirmed one (it changes only by
 * withdrawing) or while the read is loading or unreadable. A deal that is not open offers nothing and says why.
 */
export function commitAction(deal, mine) {
  if (!deal || mine?.state === 'loading' || mine?.state === 'unreadable' || !mine) return { kind: null, reason: null };
  if (deal.status !== 'active') return { kind: null, reason: closedReason(deal) };
  if (mine.state === 'ready') return mine.confirmed ? { kind: null, reason: null } : { kind: 'change', reason: null, row: mine.row };
  return { kind: 'commit', reason: null };
}
/** Why a deal takes no commitment now, in the deal page's own status word. */
export function closedReason(deal) {
  const status = deal?.status ? String(deal.status).replace(/_/g, ' ') : null;
  return status
    ? `This deal is not open for commitments: its status is ${status}.`
    : 'This deal is not open for commitments: its status is not recorded.';
}
/** D6191: the Worker's refusals of `POST /api/deals/:id/commitments`, each as a sentence. Nothing was recorded on any of them. */
export function commitRefusal(e, deal) {
  const said = String(e?.message || e?.detail || '');
  const minimum = deal?.minimum_check ? dealMoney(deal.minimum_check, deal.currency || 'USD') : null;
  if (/KYC required/i.test(said)) return 'Finish identity verification (KYC) before you commit. Nothing was recorded.';
  if (/must be invited/i.test(said)) return 'You need an invitation to this deal before you can commit. Nothing was recorded.';
  if (/below the deal minimum/i.test(said)) return minimum ? `The minimum check is ${minimum}. Nothing was recorded.` : 'That amount is below the deal minimum. Nothing was recorded.';
  if (/not open for commitments/i.test(said)) return 'This deal is no longer open for commitments. Nothing was recorded.';
  if (/Withdraw the confirmed commitment/i.test(said)) return 'Your commitment is confirmed. Withdraw it before committing a new amount. Nothing was recorded.';
  if (/changed; refresh/i.test(said)) return 'This deal or your commitment changed while you were editing. Close and open it again. Nothing was recorded.';
  if (/must be positive/i.test(said)) return 'Enter a positive amount.';
  return 'Your commitment could not be recorded. Try again.';
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
  const target = roundAsk(deal) ?? NaN;
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

// ---------------------------------------------------------------- D5906 DX9 the Investment tab (DE09)

/**
 * D5906 (#5906, board DE09): Change amount… and Withdraw…, offered exactly
 * where the Worker takes them. `POST /api/deals/:id/commitments` changes a
 * Pending commitment on an active deal and refuses a Confirmed one (409);
 * `POST …/commitments/:uid/withdrawal` withdraws a Pending or Confirmed one on
 * any deal. A commitment still loading, unreadable or absent offers neither.
 */
export function commitmentActions(deal, mine) {
  if (!mine || mine.state !== 'ready') return { change: false, withdraw: false };
  return { change: !mine.confirmed && deal?.status === 'active', withdraw: true };
}

/** D5906: the Note row of Your commitment, and who reads it, said whether or not a note is recorded. */
export function noteRow(mine) {
  if (mine?.note) return { text: mine.note, readers: NOTE_READERS, recorded: true };
  return { text: 'No note recorded.', readers: 'A note is yours alone: the founder and the studio see your amount and status, never a note.', recorded: false };
}

/**
 * D5906: the Investment route card. The three routes, with the investor's
 * stored preference (D6195) marked; none recorded marks none, never Direct.
 * A preference that could not be read draws no route at all, so an unread
 * preference is never drawn as none.
 */
export function routeCard(mine) {
  const pref = termsPreference(mine);
  const known = pref.state === 'ready' || pref.state === 'none';
  return {
    state: pref.state,
    options: known ? ROUTES.map((r) => ({ key: r.key, title: r.title, line: r.line, chosen: pref.key === r.key })) : [],
    line: pref.state === 'ready'
      ? (pref.key ? `Your preference: ${preferenceLine(pref.key)}.` : `${ROUTE_NONE}. No route is selected.`)
      : pref.line,
    note: ROUTE_NOTE,
  };
}

const CLOSING_STEP = {
  Terms: { word: 'Terms ready', tone: 'now', next: 'Next: review the terms. Your line and signing are in the closing room.', action: { label: 'Review terms', tab: 'terms' } },
  Committed: { word: 'Committed', tone: 'wait', next: 'Next: sign in the closing room once the paper is sent to you.', action: { label: 'Review signing', tab: 'closing' } },
  Signed: { word: 'Signed', tone: 'wait', next: 'Next: pay by the instructions in the closing room.', action: { label: 'Review funding', tab: 'closing' } },
  Funded: { word: 'Funded', tone: 'done', next: 'Your money was received. The company now reports to you.', action: { label: 'View company reports', href: '/portfolio/updates' } },
};
const TERMS_STEP = STEPS.indexOf('Terms');

/**
 * D5906: the Closing status card, from the stage read (`GET
 * /api/deals/:id/stage`, D1150) the header reads too. Its one primary action
 * follows the step: Review terms at Terms, the closing room at Committed and
 * Signed, the company's reports once Funded. Before Terms closing has not
 * started and nothing is offered; a pass offers nothing. A stage read that
 * failed is unreadable, never "not started".
 */
export function closingStatus(read, dealId) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'unreadable') return { state: 'unreadable' };
  const stage = read.data?.my_stage ?? null;
  const closingHref = tabHref(dealId, 'closing');
  if (stage === YOU_PASSED) return { state: 'ready', word: 'Passed', tone: 'off', next: 'You passed on this deal. Nothing is left to close.', action: null, closingHref };
  if (stage === STUDIO_PASSED) return { state: 'ready', word: 'Closed by the studio', tone: 'off', next: 'The studio closed this deal. Nothing is left to close.', action: null, closingHref };
  const step = CLOSING_STEP[stage];
  if (step) {
    const href = step.action.href || tabHref(dealId, step.action.tab);
    return { state: 'ready', word: step.word, tone: step.tone, next: step.next, action: { label: step.action.label, href, closing: href === closingHref }, closingHref };
  }
  const at = STEPS.indexOf(stage);
  const where = at >= 0 && at < TERMS_STEP ? ` Your step now: ${stage}.` : ' No step on this deal is recorded for you yet.';
  return { state: 'ready', word: 'Not started', tone: 'off', next: `Closing starts once the terms are ready.${where}`, action: null, closingHref };
}
