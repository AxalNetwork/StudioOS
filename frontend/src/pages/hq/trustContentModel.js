/**
 * D1079 (#2971, part 7 of #2425) — HQ › Security › Trust center content
 * (TRU14, TRU14d): what the editor derives from D1075's read
 * (`GET /api/admin/security/trust-center`). Pure, so a test reads each rule.
 *
 * The Worker is the judge of every write (`services/trustContent.ts`). What
 * is here only says, before a write, what the Worker will say after it: a
 * line without its words, a gap without its reason, a note too short. Each
 * sentence is the Worker's own (`CONTENT_REFUSALS`), so the two never differ.
 */

export const TRUST_CONTENT_PATH = '/admin/security/trust-center';

/** The note's bounds, as `services/trustContent.ts` keeps them. */
export const NOTE_MIN = 10;
export const NOTE_MAX = 1000;
/** Days between Publish and the day a new subprocessor may start (`NOTICE_DAYS`). */
export const NOTICE_DAYS = 10;

export const REFUSALS = {
  text_required: 'Every line needs its words.',
  text_too_long: 'A line is at most 500 characters.',
  why_required: 'A line that is not recorded says why.',
  note_required: `Publishing needs a change note of ${NOTE_MIN} to ${NOTE_MAX} characters. It appears under Changes to this page.`,
  nothing_to_publish: 'There is nothing to publish: no block or subprocessor has a draft.',
  certification_fields: 'A certification needs its name, its auditor and the day it was issued.',
  report_required: 'A certification cannot be saved without its auditor\'s report on file.',
  subprocessor_fields: 'A subprocessor needs its name, what it does for us, the data it sees and where it is.',
};

/** The day part of a stamp, as written (YYYY-MM-DD), or null. Never a guess. */
export const dayOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Every block in the canvas's list: when it was last published, and whether it holds a draft. */
export function blockRows(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => ({
    key: b.key,
    label: b.label,
    lastPublished: dayOf(b.published?.published_at),
    hasDraft: !!b.draft,
    emptyPublished: b.key === 'certifications' && !!b.published && !(b.published.body?.items || []).length,
  }));
}

/** "Last published …", or "Never published"; a published Certifications block with no item reads "none held". */
export function publishedLine(row) {
  if (!row.lastPublished) return 'Never published';
  return row.emptyPublished ? `Last published ${row.lastPublished} · none held` : `Last published ${row.lastPublished}`;
}

const blankLine = () => ({ text: '', recorded: true, why: '', checked_at: '' });
const blankGroup = () => ({ title: '', lines: [blankLine()] });

/** The body the editor opens on: the draft, else the published copy, else an empty block. */
export function startBody(block) {
  const src = block?.draft || block?.published || null;
  if (block?.key === 'certifications') return { items: (src?.body?.items || []).map((c) => ({ ...c, expires_on: c.expires_on || '' })) };
  const body = src?.body || {};
  return {
    intro: body.intro || '',
    groups: (body.groups || []).map((g) => ({
      title: g.title || '',
      lines: (g.lines || []).map((l) => ({ text: l.text || '', recorded: !!l.recorded, why: l.why || '', checked_at: l.checked_at || '' })),
    })),
  };
}

/** The block's own checked day, as the editor opens on it. */
export const startCheckedAt = (block) => (block?.draft || block?.published)?.checked_at || '';

export { blankLine, blankGroup };

/**
 * What the Worker will refuse in a lines block, before it is sent: the first
 * refusal's sentence, or null. Mirrors `parseBody`'s checks on the words.
 */
export function linesProblem(body) {
  for (const g of body?.groups || []) {
    for (const l of g.lines || []) {
      const text = String(l.text || '').trim();
      if (!text) return REFUSALS.text_required;
      if (text.length > 500) return REFUSALS.text_too_long;
      if (!l.recorded && !String(l.why || '').trim()) return REFUSALS.why_required;
    }
  }
  return null;
}

/** The body as the Worker takes it: a gap keeps its reason and no date; a fact keeps its date and no reason. */
export function linesPayload(body) {
  return {
    intro: String(body.intro || '').trim() || null,
    groups: (body.groups || []).map((g) => ({
      title: String(g.title || '').trim() || null,
      lines: (g.lines || []).map((l) => ({
        text: String(l.text || '').trim(),
        recorded: !!l.recorded,
        why: l.recorded ? null : String(l.why || '').trim(),
        checked_at: l.recorded ? (l.checked_at || null) : null,
      })),
    })),
  };
}

/** A certification may be saved only with its name, auditor, issue day and a report on file. */
export function certificationProblem(c) {
  if (!String(c?.name || '').trim() || !String(c?.auditor || '').trim() || !dayOf(c?.issued_on)) return REFUSALS.certification_fields;
  if (!c?.report_uid) return REFUSALS.report_required;
  return null;
}

export const certificationsPayload = (body) => ({
  items: (body.items || []).map((c) => ({
    name: String(c.name).trim(), auditor: String(c.auditor).trim(), issued_on: c.issued_on,
    expires_on: c.expires_on || null, report_uid: c.report_uid,
  })),
});

/** A subprocessor's row: its state as the editor names it, and the actions that state allows. */
export function subprocessorRow(s) {
  const since = s.state === 'draft'
    ? (s.starts_at ? `From ${s.starts_at}` : `${NOTICE_DAYS} days after you publish`)
    : (s.starts_at ? `From ${s.starts_at}` : 'Not recorded');
  const state = { draft: 'Draft', removing: 'Removing', removed: 'Removed', published: 'Listed' }[s.state] || 'Listed';
  const actions = s.state === 'draft' ? ['edit', 'delete'] : s.state === 'published' ? ['remove'] : s.state === 'removing' ? ['keep'] : [];
  return { ...s, since, stateLabel: state, actions };
}

/** Subprocessors HQ still edits or lists, in the store's order; removed ones are history and stay off the table. */
export const subprocessorRows = (subs) => (Array.isArray(subs) ? subs : []).filter((s) => s.state !== 'removed').map(subprocessorRow);

/**
 * What one Publish changes (TRU14d): the blocks with a draft, and the
 * subprocessors it adds and removes. `count` is the blocks that change,
 * counting Subprocessors once when its list changes.
 */
export function pendingChanges(read) {
  const blocks = (read?.blocks || []).filter((b) => b.draft).map((b) => ({ key: b.key, label: b.label }));
  const subs = Array.isArray(read?.subprocessors) ? read.subprocessors : [];
  const added = subs.filter((s) => s.state === 'draft');
  const removed = subs.filter((s) => s.state === 'removing');
  const listChanges = added.length + removed.length > 0;
  const count = blocks.length + (listChanges && !blocks.some((b) => b.key === 'subprocessors') ? 1 : 0);
  return { blocks, added, removed, count, any: blocks.length > 0 || listChanges };
}

/**
 * The day a drafted subprocessor becomes active if published now: its own
 * start day, or ten days after today when that is later (`publish`'s rule).
 */
export function activeFrom(startsAt, now = Date.now()) {
  const earliest = new Date(Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) + NOTICE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const own = dayOf(startsAt);
  return own && own > earliest ? own : earliest;
}

/** The dialog's first line: how many blocks change, and who is emailed. */
export function publishLine(p, confirmed) {
  const n = `${p.count} ${p.count === 1 ? 'block changes' : 'blocks change'}.`;
  if (!p.added.length) return n;
  if (confirmed === 0) return `${n} No one has subscribed to subprocessor changes yet, so no one is emailed.`;
  if (Number.isFinite(confirmed)) return `${n} ${confirmed} confirmed ${confirmed === 1 ? 'subscriber is' : 'subscribers are'} emailed about the new ${p.added.length === 1 ? 'subprocessor' : 'subprocessors'}.`;
  return `${n} Confirmed subprocessor subscribers are emailed.`;
}

/** The note's state: whether Publish may go, and what to say under the field. */
export function noteState(note) {
  const n = String(note || '').trim().length;
  if (n < NOTE_MIN) return { ok: false, n, hint: `At least ${NOTE_MIN} characters. ${n} so far.` };
  if (n > NOTE_MAX) return { ok: false, n, hint: `At most ${NOTE_MAX} characters. ${n} now.` };
  return { ok: true, n, hint: `${n} of ${NOTE_MAX} characters.` };
}

/** A refusal in words: the Worker's sentence, or one that says nothing changed. Never a code. */
export function refusalText(e, fallback = 'That could not be saved just now. Nothing changed. Try again.') {
  const m = e?.message;
  if (typeof m === 'string' && m && !/^[a-z_]+$/.test(m) && !/^HTTP \d+/.test(m)) return m;
  if (e?.code && REFUSALS[e.code]) return REFUSALS[e.code];
  return fallback;
}

/** The confirmed subscribers, or null when the count was not read. */
export const confirmedCount = (subscribers) => (Number.isFinite(subscribers?.confirmed) ? subscribers.confirmed : null);
