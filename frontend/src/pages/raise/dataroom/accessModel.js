/**
 * D1107 (#2987) — Data room part 6: Access, Share, one investor, the NDA and
 * Requests as pure rules (DR6–DR9, DR16–DR18). No React, so `node --test`
 * reads it alone.
 *
 * WHO CAN OPEN WHAT is never decided here. Every cell, count and "can open"
 * goes through `filesModel.js`'s `grantOn`, which applies the Worker's one
 * predicate (`dataRoomRead.js`'s `accessNow`: the tier, the end date, the NDA)
 * and then the grant's folders (D1103). So the matrix can never say an
 * investor opens a file `accessNow` refuses.
 *
 * WHAT IS READ:
 *   - the founder's room (`GET /api/data-room/:projectUid`): grants with
 *     `nda_signed`, `nda_pending` (D1107), `committed`, `folders`, and the
 *     last fifty events;
 *   - Share's candidates (`GET …/share-candidates`, D1107): this venture's
 *     prospects in Capital relationships, the owner's only;
 *   - the queue (`GET …/requests`, D1104) with the venture's diligence
 *     requests (D1107).
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { grantIsActive } from '../dataRoomRead.js';
import { grantOn } from './filesModel.js';
import { day } from './dataRoomModel.js';

const DAY_MS = 86_400_000;
export const ENDING_SOON_DAYS = 14;
/** The matrix shows up to six investors side by side; the rest fold into "+N more" (DR6m). */
export const MATRIX_COLUMNS = 6;

const who = (g) => g?.investor_name || g?.investor_email || NOT_RECORDED;
export const isOwner = (room) => room?.role === 'owner';

/** A grant's state now: in force, ended (its date passed) or revoked. */
export function grantState(g, now = Date.now()) {
  if (grantIsActive(g, now)) return 'active';
  return g?.status === 'active' ? 'ended' : 'revoked';
}
export const STATE_WORD = { active: 'Active', ended: 'Ended', revoked: 'Revoked' };

/** The NDA between the venture's founder and this investor, as Access says it (DR8). */
export function ndaOf(g) {
  if (g?.nda_signed) return 'signed';
  if (g?.nda_pending) return 'pending';
  return 'none';
}
export const NDA_WORD = { signed: 'Signed', pending: 'Waiting for signatures', none: 'Not sent' };

/** A grant's folders in words: every folder, the names it opens, or that they could not be read. */
export function foldersWord(room, g) {
  if (g?.folders_unreadable) return 'Could not be read';
  if (g?.folders == null) return 'All folders';
  if (!g.folders.length) return 'No folders';
  const names = new Map((room?.folders || []).map((f) => [f.uid, f.name]));
  return g.folders.map((u) => names.get(u) || 'A folder since deleted').join(', ');
}

/** How many of the room's files this grant opens now, by `grantOn`. */
export function canOpen(room, g, now = Date.now()) {
  return (room?.files || []).filter((f) => grantOn(room, f, g, now).open).length;
}

/** The NDA files this grant would open once the NDA is signed, and does not open now (DR8, named for the founder only). */
export function ndaUnlocks(room, g, now = Date.now()) {
  if (!g || g.nda_signed) return [];
  const signed = { ...g, nda_signed: true };
  return (room?.files || []).filter((f) => f.visibility === 'nda' && !grantOn(room, f, g, now).open && grantOn(room, f, signed, now).open);
}

/** The investor's events among the room's last fifty, newest first (DR7i). */
export function eventsOf(room, g) {
  const email = String(g?.investor_email || '').toLowerCase();
  if (!email) return [];
  return (room?.recent_access || []).filter((a) => String(a.user_email || '').toLowerCase() === email);
}

const LOG_WORD = { open_room: 'Opened the room', download: 'Link issued', blocked: 'Refused' };
/** One event in words. A link issued is not a read; a refusal is never an open. */
export function eventLine(a) {
  const verb = LOG_WORD[a?.action] || String(a?.action || NOT_RECORDED);
  return a?.action === 'open_room' || !a?.file_name ? verb : `${verb} for ${a.file_name}`;
}

/** Access's rows (DR6), with what each grant opens and its last event among the last fifty. */
export function accessRows(room, now = Date.now()) {
  const total = (room?.files || []).length;
  return (room?.grants || []).map((g) => {
    const state = grantState(g, now);
    const ends = g.expires_at ? Date.parse(String(g.expires_at).replace(' ', 'T') + (/[zZ]$/.test(String(g.expires_at)) ? '' : 'Z')) : null;
    const left = ends != null && Number.isFinite(ends) && state === 'active' ? Math.ceil((ends - now) / DAY_MS) : null;
    const last = eventsOf(room, g)[0] || null;
    return {
      uid: g.uid,
      who: who(g),
      email: g.investor_email || '',
      state,
      granted: day(g.created_at),
      by: g.granted_by_name || NOT_RECORDED,
      ends: g.expires_at ? day(g.expires_at) : 'No end date',
      endingSoon: left != null && left <= ENDING_SOON_DAYS ? `in ${left} ${left === 1 ? 'day' : 'days'}` : null,
      folders: foldersWord(room, g),
      nda: ndaOf(g),
      committed: g.committed ? 'Yes' : 'No',
      canOpen: state === 'active' ? `${canOpen(room, g, now)} of ${total}` : '0 of ' + total,
      last: last ? `${eventLine(last)} · ${day(last.created_at)}` : 'None in the last fifty events',
      grant: g,
    };
  });
}

export const FILTERS = {
  nda: [['all', 'NDA: any'], ['signed', 'Signed'], ['pending', 'Waiting'], ['none', 'Not sent']],
  committed: [['all', 'Committed: any'], ['Yes', 'Committed'], ['No', 'Not committed']],
  state: [['active', 'Grant: Active'], ['ended', 'Ended'], ['revoked', 'Revoked'], ['all', 'Grant: any']],
};

/** The list's filters and search (DR6): Active grants by default, as the canvas draws. */
export function filterRows(rows, { q = '', nda = 'all', committed = 'all', state = 'active' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((r) => (!needle || `${r.who} ${r.email}`.toLowerCase().includes(needle))
    && (nda === 'all' || r.nda === nda)
    && (committed === 'all' || r.committed === committed)
    && (state === 'all' || r.state === state));
}

/**
 * DR6m, the matrix: each file against each active grant, every cell from
 * `grantOn`. A cell that opens says "Can open"; one that does not names the
 * first rule that shuts the investor out.
 */
export function matrix(room, { q = '', folder = 'all' } = {}, now = Date.now()) {
  const grants = (room?.grants || []).filter((g) => grantIsActive(g, now));
  const shown = grants.slice(0, MATRIX_COLUMNS);
  const needle = String(q || '').trim().toLowerCase();
  const folders = new Map((room?.folders || []).map((f) => [Number(f.id), f]));
  const files = (room?.files || []).filter((f) => (!needle || String(f.name || '').toLowerCase().includes(needle))
    && (folder === 'all' || (folder === 'top' ? f.folder_id == null : folders.get(Number(f.folder_id))?.uid === folder)));
  return {
    investors: shown.map((g) => ({ uid: g.uid, who: who(g) })),
    more: grants.length - shown.length,
    rows: files.map((f) => ({
      uid: f.uid, name: f.name, folder: f.folder_id == null ? 'Top level' : folders.get(Number(f.folder_id))?.name || NOT_RECORDED,
      cells: shown.map((g) => { const r = grantOn(room, f, g, now); return { open: r.open, why: r.open ? 'Can open' : r.why }; }),
    })),
  };
}

const STAGE = { to_contact: 'To contact', contacted: 'Contacted', in_conversation: 'In conversation', meeting: 'Meeting', due_diligence: 'Due diligence', committed: 'Committed', passed: 'Passed', declined: 'Declined' };
export const stageWord = (s) => STAGE[s] || (s ? String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : NOT_RECORDED);

/**
 * Share's choices (DR7): this venture's prospects only, each saying whether
 * it already has the room (its address matches a grant in force) or has no
 * email on file. Whether an address has an account is never said.
 */
export function candidateRows(candidates, room, q = '', now = Date.now()) {
  const holding = new Set((room?.grants || []).filter((g) => grantIsActive(g, now)).map((g) => String(g.investor_email || '').toLowerCase()).filter(Boolean));
  const needle = String(q || '').trim().toLowerCase();
  return (Array.isArray(candidates) ? candidates : [])
    .filter((c) => !needle || `${c.firm || ''} ${c.name || ''} ${c.email || ''}`.toLowerCase().includes(needle))
    .map((c) => {
      const email = String(c.email || '').toLowerCase();
      const has = Boolean(email) && holding.has(email);
      return {
        uid: c.uid, title: c.firm || c.name || c.email || NOT_RECORDED, name: c.firm && c.name ? c.name : null,
        sub: `${stageWord(c.stage)} · ${has ? 'already has access' : email ? 'from Capital relationships' : 'no email in Capital relationships'}`,
        disabled: has || !email, has, committed: c.stage === 'committed', email: c.email || null,
      };
    });
}

/** What a new grant would open (DR7): files now, and how many more need the NDA. A new grant has no NDA signed. */
export function shareEffect(room, { folders = null, committed = false } = {}, now = Date.now()) {
  const grant = { status: 'active', expires_at: null, nda_signed: false, committed, folders };
  const signed = { ...grant, nda_signed: true };
  const files = room?.files || [];
  const open = files.filter((f) => grantOn(room, f, grant, now).open).length;
  const nda = files.filter((f) => !grantOn(room, f, grant, now).open && grantOn(room, f, signed, now).open).length;
  const parts = [`They will be able to open ${open} ${open === 1 ? 'file' : 'files'}.`];
  if (nda) parts.push(`${nda} more ${nda === 1 ? 'needs' : 'need'} the NDA.`);
  return parts.join(' ');
}

/** The grant body Share and Change send: an end day or none, and every folder or the chosen ones. */
export function grantBody({ until = '', scope = 'all', chosen = [] } = {}) {
  const out = { expires_at: until ? until : null };
  out.folders = scope === 'all' ? null : [...new Set(chosen)];
  return out;
}
/** A grant body the Worker would refuse, said before it is sent. */
export function grantBodyError({ until = '', scope = 'all', chosen = [] } = {}, today = new Date().toISOString().slice(0, 10)) {
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return 'The end date must be a day.';
  if (until && until < today) return 'The end date must be today or later.';
  if (scope !== 'all' && !chosen.length) return 'Choose at least one folder, or give every folder.';
  return null;
}

/** A Worker refusal on Access or Requests, as one sentence. */
export function accessRefusal(e) {
  const code = e?.data?.code || e?.code || null;
  const said = String(e?.data?.detail || e?.data?.message || '').trim();
  const status = Number(e?.status);
  if (code === 'owner_only') return 'Only the venture’s owner can do that.';
  if (code === 'no_email') return said || 'This investor has no email in Capital relationships. Add one there to share the room.';
  if (code === 'request_decided') return 'This request has already been answered.';
  if (code === 'nda_active') return 'An NDA with this investor is already in force.';
  if (code === 'nda_pending') return 'An NDA with this investor is already out for signature.';
  if (code === 'template_fields_unfilled' || code === 'envelope_creation_failed' || code === 'founder_only') return said || 'The NDA could not be sent. Nothing was sent.';
  if (status === 400 && said) return said;
  if (status === 404) return said && !/not found/i.test(said) ? said : 'That is no longer in the room.';
  return 'That did not go through. Try again.';
}

const SOURCE = { round_call: 'Round call', deal_page: 'Deal page' };
/** The access requests (DR9): open first, as the Worker orders them, each with where it came from and its words. */
export function requestRows(read) {
  return (read?.requests || []).map((q) => ({
    uid: q.uid,
    who: q.investor?.name || q.investor?.email || NOT_RECORDED,
    email: q.investor?.email || null,
    open: q.state === 'open',
    state: q.state === 'open' ? 'Waiting' : q.state === 'accepted' ? 'Shared' : 'Declined',
    line: [q.source === 'round_call' && q.round_call?.name ? `Round call · ${q.round_call.name}` : SOURCE[q.source] || NOT_RECORDED, day(q.created_at)].join(' · '),
    message: q.message || null,
    decided: q.state === 'open' ? null
      : `${q.state === 'accepted' ? 'Shared' : 'Declined'}${q.decided_at ? ` ${day(q.decided_at)}` : ''}${q.decided_by?.name ? ` by ${q.decided_by.name}` : q.decided_at ? '' : ' (who and when were not recorded)'}`,
    reason: q.state === 'declined' ? q.decline_reason || null : null,
    nda: q.nda || 'none',
    hasAccess: Boolean(q.has_access),
  }));
}

/** The diligence requests (DR9), each with the files that answer it. A request with no file reads Requested. */
export function diligenceRows(read) {
  if (!Array.isArray(read?.diligence)) return null;
  return read.diligence.map((d) => ({
    id: d.id, title: d.title || NOT_RECORDED,
    // Reviewed is the diligence team's; a request a file answers reads Answered even before they mark it.
    state: d.state === 'reviewed' ? 'Reviewed' : d.state === 'received' || d.files?.length ? 'Answered' : 'Requested',
    line: [`Asked ${day(d.created_at)}`, d.files?.length ? `answered by ${d.files.map((f) => f.name).join(', ')}` : null, d.reviewed_at ? `reviewed ${day(d.reviewed_at)}` : null].filter(Boolean).join(' · '),
    files: d.files || [],
  }));
}

/** Decline's reason (the Worker requires one, 1 to 500 characters). */
export function declineError(reason) {
  const r = String(reason || '').trim();
  if (!r) return 'Write a short note. They are told you declined, with your note.';
  if (r.length > 500) return 'Keep the note under 500 characters.';
  return null;
}

/** DR18: someone the room is not for, by who they are. */
export function noPermission(role) {
  if (role === 'investor') return { title: 'Rooms shared with you are on your deals.', line: 'A founder shares a room with you by name. It appears on that deal’s page.', cta: 'Go to your deals', to: '/research/diligence' };
  if (role === 'partner' || role === 'advisor') return { title: 'A data room is the founder’s.', line: 'They share it with investors by name. An advisor with a brief sees a count of files, never the files.', cta: 'Go to your home', to: '/' };
  if (role === 'exploring') return { title: 'Data rooms open once your profile is set.', line: 'An Explorer has no venture yet, so there is no room to open.', cta: 'Set up your profile', to: '/exploring' };
  return { title: 'This data room is the venture’s founders’.', line: 'You do not have access to this venture’s data room.', cta: 'Go to your home', to: '/' };
}

/** DR16: what a co-founder reads on Access. */
export const COFOUNDER_LINE = 'Only the venture’s owner shares the room and changes who can open a file. You can upload, move, match and answer requests.';
export const NDA_LINE = 'A three-way NDA between you, the investor and Axal VC, valid 12 months from signing. It unlocks your NDA files for them in every room you share.';
export const REVOKE_LINE = 'They lose the room now. Their past events stay in Activity.';
