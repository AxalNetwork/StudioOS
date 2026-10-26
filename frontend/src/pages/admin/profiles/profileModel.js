import { parseStamp } from '../../../ui/parseStamp.js';
import { NOT_RECORDED } from '../../../lib/absence.js';
import { roleWord, trackWord } from './ppModel.js';

/**
 * D995 (#2806) — one partner profile as PRF3's lightbox at its own address,
 * as pure functions: what each block draws, the words of PRF5's dialogs and
 * PRF6's send results. No React here, so `node --test` loads it alone.
 *
 * The reads (`lib/api/partnerProfiles.js`, D990, D991, D993):
 *   - `get(ref)`      the profile, `ein` masked, with the list's derived
 *                     fields on `listed` and whether Unbind applies on `unbind`;
 *   - `history(ref)`  its captures and decisions, newest first;
 *   - `agreements()`  the first-agreement options in their groups, each Ready
 *                     or not ready.
 * The decision itself is the verify route (`/api/profiling/admin/:email/
 * verify`, D991 and D992), and the tax ID is its logged Show (D634).
 */

export const NOT_GIVEN = 'Not given';
export const RECORD_LINE = 'Opening this profile is recorded.';
/** The tax ID shows for this long, then masks again (PRF5e). */
export const TAX_SHOWN_SECONDS = 60;
/** The conversation shows the last turns first (PRF3). */
export const TURNS_SHOWN = 8;
export const REJECT_MIN = 10;
export const REJECT_MAX = 1000;
export const UNBIND_MIN = 10;
export const UNBIND_MAX = 500;

const REF = /^pp_[0-9a-f]{10}$/;
/** The record's own address, written out so the reachability walk finds the door. */
export const recordPath = (ref) => `/admin/partner-profiles/${ref}`;
/** The reference in a record's address, or null on the list's own addresses. */
export function refOfPath(pathname) {
  const m = String(pathname || '').replace(/\/+$/, '').match(/^\/admin\/partner-profiles\/([^/]+)$/);
  return m && REF.test(m[1]) ? m[1] : null;
}

/**
 * Where a record sits in the list it was opened from: "3 of 7", and the
 * references before and after it. A record the list does not hold (a link
 * opened cold, or a page turned) has no place, so no Previous or Next.
 */
export function neighbours(rows, ref) {
  const refs = (rows || []).map((r) => r?.ref).filter(Boolean);
  const i = refs.indexOf(ref);
  if (i < 0) return { label: null, prev: null, next: null };
  return { label: `${i + 1} of ${refs.length}`, prev: i > 0 ? refs[i - 1] : null, next: i < refs.length - 1 ? refs[i + 1] : null };
}

const text = (v) => (v == null ? '' : String(v).trim());
/** A stored value as words: a JSON list joined, blank as Not given. */
export function valueWords(v) {
  const s = text(v);
  if (!s || s === '[]' || s === '{}' || s === 'null') return NOT_GIVEN;
  if (s.startsWith('[')) {
    try { const list = JSON.parse(s); if (Array.isArray(list)) return list.map(String).filter(Boolean).join(', ') || NOT_GIVEN; } catch { /* stored as typed */ }
  }
  return s;
}
/** Capital capacity in dollars, as the invitation asked for it. */
function dollars(v) {
  const n = Number(v);
  if (v == null || text(v) === '' || !Number.isFinite(n)) return valueWords(v);
  return `$${n.toLocaleString('en-US')}`;
}

/** "Who they are" (PRF3): the facts every profile with answers has. */
export function whoFacts(p) {
  const incorporated = p.company_established === 1 || p.company_established === true ? 'Yes'
    : p.company_established === 0 || p.company_established === false ? 'No' : NOT_GIVEN;
  return [
    { k: 'Onboarding category', v: valueWords(p.persona) },
    { k: 'Founder track', v: trackWord(p.founder_track) || NOT_GIVEN },
    { k: 'Legal entity', v: valueWords(p.legal_entity_name) },
    { k: 'Entity type', v: valueWords(p.entity_type) },
    { k: 'Jurisdiction', v: valueWords(p.existing_jurisdiction) },
    { k: 'Incorporated', v: incorporated },
    { k: 'Signatory', v: valueWords(p.signatory_name), sub: text(p.signatory_title) || null },
  ];
}

/** "Founder track details": a Strategic Scale founder only. Each empty field says Not given. */
export function trackDetails(p) {
  if (p.founder_track !== 'Strategic Scale (Existing)') return null;
  return [
    { k: 'Current stage', v: valueWords(p.current_stage) },
    { k: 'Partnership goal', v: valueWords(p.partnership_goal) },
    { k: 'Product strategy', v: valueWords(p.product_strategy) },
    { k: 'Existing investors', v: valueWords(p.existing_investors) },
  ];
}

/** Eadwyn's summary, from the conversation's extraction; null when none was written. */
export function summaryOf(p) {
  try {
    const s = text(JSON.parse(p.extracted_data || '{}')?.summary);
    return s || null;
  } catch { return null; }
}

/** PRF4: an invitation's answers, in the canvas's order. */
export const INVITATION_FIELDS = [
  ['organization', 'Organisation'], ['role_title', 'Role'], ['expertise', 'Expertise'], ['sectors', 'Sectors'],
  ['geography', 'Geography'], ['capacity_per_month', 'Hours a month'], ['capital_capacity_usd', 'Capital capacity'],
  ['prior_deals', 'Prior deals'], ['motivation', 'Why they want to partner'], ['linkedin_url', 'LinkedIn'],
];
/** PRF4: the answers Eadwyn's partner questions write. */
export const EADWYN_FIELDS = [
  ['organization', 'Firm'], ['role_title', 'Role'], ['services_offered', 'Services offered'], ['focus_text', 'Deal interest'],
  ['dealflow_channels', 'Dealflow channels'], ['conflicts_text', 'Conflicts'],
];
export function answers(p, fields) {
  return fields.map(([key, k]) => ({ k, v: key === 'capital_capacity_usd' ? dollars(p[key]) : valueWords(p[key]) }));
}

/**
 * Which blocks a record draws (PRF3, PRF4), from where it came from:
 *   - a Draft has nothing to review and no decision buttons;
 *   - the onboarding chat brings Who they are, Eadwyn's summary and the conversation;
 *   - an invitation brings its answers, and its agreement is the invitation's;
 *   - Eadwyn's questions bring their answers.
 */
export function recordShape(p) {
  const listed = p?.listed || {};
  const sources = Array.isArray(listed.sources) ? listed.sources : [];
  const status = listed.status ?? null;
  if (status === 'draft') return { draft: true, who: false, chat: false, invitation: false, eadwyn: false, sources, status };
  const invitation = sources.includes('invitation');
  const chat = sources.includes('chat');
  return { draft: false, who: chat || !invitation, chat, invitation, eadwyn: sources.includes('eadwyn'), sources, status };
}

/** The transcript as stored (`chat_history`), oldest first; a turn with no words is left out. */
export function transcript(p) {
  let list = [];
  try { list = JSON.parse(p.chat_history || '[]'); } catch { return []; }
  return (Array.isArray(list) ? list : []).filter((m) => m && text(m.content)).map((m) => ({ role: m.role === 'user' ? 'member' : 'eadwyn', content: String(m.content), ts: m.ts ?? null }));
}
/** The conversation's line: live or not, and how many turns show. */
export function turnsLine(total, live) {
  const shown = Math.min(TURNS_SHOWN, total);
  const part = total > TURNS_SHOWN ? `the last ${shown} of ${total} turns` : `${total} ${total === 1 ? 'turn' : 'turns'}`;
  return live ? `● Live · ${part}` : part;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "22 Oct 2026, 09:12", in UTC as D1 stores it. */
export function whenOf(stamp) {
  const at = parseStamp(stamp);
  if (at == null) return NOT_RECORDED;
  const d = new Date(at);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

const CAPTURED_FROM = { chat: 'the onboarding chat', invitation: 'the partner invitation', eadwyn: 'Eadwyn’s questions' };
/** One history item (D991) in PRF3's words: what happened, by whom, and when. */
export function historyLine(item) {
  const who = item?.by ? (item.by.name || `account ${item.by.user_id}`) : null;
  const reason = text(item?.reason);
  const by = who ? ` by ${who}` : '';
  if (item?.kind === 'captured') return { glyph: '+', text: `Captured from ${CAPTURED_FROM[item.source] || 'an unknown source'}`, when: whenOf(item.created_at) };
  if (item?.kind === 'verified') return { glyph: '✓', text: `Verified${by}`, when: whenOf(item.created_at) };
  if (item?.kind === 'rejected') return { glyph: '✕', text: `Rejected${by}${reason ? `: “${reason}”` : ''}`, when: whenOf(item.created_at) };
  if (item?.kind === 'reopened') return { glyph: '↻', text: `Put back in the queue${by}${reason ? `: “${reason}”` : ''}`, when: whenOf(item.created_at) };
  return { glyph: '·', text: NOT_RECORDED, when: whenOf(item?.created_at) };
}

/** The account in the Decision card: its role, an Explorer's note, or none yet. */
export function accountLine(listed) {
  const a = listed?.account;
  if (!a) return { has: false, text: 'No account yet', sub: null, exploring: false };
  return {
    has: true,
    text: roleWord(a.role) || NOT_RECORDED,
    sub: a.exploring ? 'Profile is given on the Exploring board, after the binding agreement is signed.' : null,
    exploring: Boolean(a.exploring),
    userId: a.user_id,
  };
}

/** The first-agreement choices (D993), grouped as in Contracts; a not-ready one cannot be picked. */
export function agreementChoices(read) {
  const groups = Array.isArray(read?.groups) ? read.groups : [];
  return groups.map((g) => ({
    label: String(g.label || ''),
    options: (Array.isArray(g.options) ? g.options : []).map((o) => ({
      value: String(o.value), label: String(o.label || o.value), ready: o.ready === true,
      note: o.ready === true ? 'Ready' : (o.readiness || 'Not ready: no text in the library yet'),
    })),
  })).filter((g) => g.options.length);
}

const REC = 'The decision is recorded in the profile’s history under your name.';
const PROFILE_SAME = 'Verifying does not change their profile. Explorers get one on the Exploring board.';
/**
 * PRF5's dialogs, A to C and F: what each changes, who is told and what is
 * recorded. `agreement` is the chosen first agreement's label, if any.
 */
export function dialogWords(kind, { name, email, agreement = null, holder = null } = {}) {
  const who = name || email || 'this person';
  if (kind === 'verify' && agreement) {
    return {
      title: `Verify ${who}’s profile and send the ${agreement} for signature?`, sub: null,
      lines: ['They are told by email and in their activity.', `The agreement goes from StudioOS signing to ${email}.`, PROFILE_SAME, REC],
      action: 'Verify and send',
    };
  }
  if (kind === 'verify') {
    return { title: `Verify ${who}’s profile?`, sub: 'No agreement is sent.', lines: ['They are told by email and in their activity.', PROFILE_SAME, REC], action: 'Verify' };
  }
  if (kind === 'reject') {
    return {
      title: `Reject ${who}’s profile?`, sub: 'They are told, and they read your reason.',
      lines: [`Their account stays as it is. They can re-do the onboarding chat, and the profile comes back to the queue. ${REC}`],
      action: 'Reject',
    };
  }
  if (kind === 'unbind') {
    return {
      title: 'Unbind this profile from the account?',
      sub: holder?.name
        ? `This profile’s address now belongs to ${holder.name}’s account, not the one it was written for. Unbind it so the right account can answer?`
        : 'No account holds this profile’s address now, so the account it was written for no longer matches it. Unbind it so the right account can answer?',
      lines: ['It asks for a fresh sign-in check and is recorded in Governance.'],
      action: 'Unbind',
    };
  }
  return null;
}

/** A reason's count, "68 / 1,000". */
export const countLine = (s, max) => `${String(s || '').length.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`;

/**
 * PRF6: what a decision did, from the verify route's answer. A tone and a
 * sentence; a signing link to copy when the email did not go.
 */
export function sendResult(res, { status, email } = {}) {
  const told = res?.member_notified == null ? ' The notice to them could not be sent: tell them yourself.' : '';
  if (status === 'rejected') return { tone: 'green', text: `Rejected. They are told, and they read your reason.${told}` };
  if (res?.esign_refusal) {
    return { tone: 'amber', text: `Verified. The agreement was not sent: ${String(res.esign_refusal.message || 'its text is not ready in the library.').replace(/\.?$/, '.')} Finish it in Contracts.${told}`, contracts: true };
  }
  const e = res?.esign;
  if (e?.envelope_id && e.email_sent) return { tone: 'green', text: `Verified. The agreement is out for signature, sent to ${email}.${told}` };
  if (e?.envelope_id && e.signing_url) return { tone: 'amber', text: `Verified. The agreement was created, but the email did not go. Copy the signing link and send it yourself.${told}`, link: e.signing_url };
  if (e?.envelope_id) return { tone: 'green', text: `Verified. Its agreement was already out for signature, so no second one was sent.${told}` };
  return { tone: 'green', text: `Verified. No agreement was sent.${told}` };
}

/** PRF6's plan line: said before anything is saved, and nothing changes. */
export const PLAN_LINE = 'DocuSign needs the Raise + Grow plan. Choose StudioOS signing, or upgrade first. Nothing was changed.';
/** Whether a refused decision was the plan check (402 `tier_required`), which changes nothing. */
export const isPlanRefusal = (err) => Number(err?.status) === 402 || err?.code === 'tier_required';

/** PRF5e: the tax ID's line, masked or shown with its countdown. */
export function taxLine(shown, secondsLeft) {
  if (!shown) return 'Masked. Showing it is recorded under your name.';
  const s = Math.max(0, Math.floor(secondsLeft));
  const at = parseStamp(shown.shown_at);
  const hhmm = at == null ? null : `${String(new Date(at).getUTCHours()).padStart(2, '0')}:${String(new Date(at).getUTCMinutes()).padStart(2, '0')}`;
  return `Shown to you${hhmm ? ` at ${hhmm}` : ''}. This is recorded. It hides again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.`;
}

/** A refused write, in the Worker's words when it gave them. */
export function refusalOf(err, fallback) {
  const said = String(err?.message || '').trim();
  return said || fallback;
}

/**
 * D996 (PRF11b): the "Agreement and notes" row's line on a phone: the first
 * agreement chosen (or none, or the invitation's), whether it is ready, and
 * whether a note is written. `groups` is `agreementChoices`' answer, or null
 * while the agreements are unread.
 */
export function agreementRowLine({ agreement, agreementLabel, notes } = {}, groups, { invitation = false } = {}) {
  const note = String(notes || '').trim() ? '1 note' : 'No note';
  if (invitation) return `Sent by the invitation · ${note}`;
  if (!agreement) return `No agreement · ${note}`;
  const opt = (groups || []).flatMap((g) => g.options).find((o) => o.value === agreement);
  const ready = groups == null ? null : opt ? opt.note : 'Not in the agreements list';
  return [agreementLabel || agreement, ready, note].filter(Boolean).join(' · ');
}
