/**
 * D4803 (#4803, canvas SE07 Trust) — what the Trust workspace says, from
 * `/overview`'s `sanctions` and `kyc`, and from the Trust Center admin read
 * (`/admin/security/trust-center`). Pure, for the tests.
 *
 * SANCTIONS AND KYC ARE SEPARATE FACTS from separate stores, and each says
 * when it could not be read. PUBLISHING compares each draft with the
 * published revision, line by line, so the reviewer sees what goes public.
 * NOTICE DELIVERY is what the sweep recorded: sent means the mail provider
 * accepted it; an inbox is not recorded.
 */
import { PUBLISH_UNCONFIRMED, activeFrom, pendingChanges, publishRefusalText } from '../trustContentModel.js';

export const KYC_HREF = '/admin/kyc';
export const OBLIGATIONS_HREF = '/admin/security/obligations';
export const TRUST_CONTENT_HREF = '/admin/security/trust-center';

const parse = (s) => {
  if (!s) return NaN;
  const t = String(s);
  return Date.parse(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`);
};
/** "5 Nov 2026, 16:20 UTC", or null. */
export function whenOf(s) {
  const t = parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${d.toISOString().slice(11, 16)} UTC`;
}
/** "14:29:40 UTC", or null. */
export const clockOf = (s) => {
  const t = parse(s);
  return Number.isFinite(t) ? `${new Date(t).toISOString().slice(11, 19)} UTC` : null;
};
/** "1 Dec 2026" from a YYYY-MM-DD day, or null. */
export function dayWords(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The sanctions block: its state, and its facts, or why it could not be read. */
export function sanctionsBlock(s) {
  if (!s) return { state: 'pending', label: 'Reading…', facts: [] };
  if (s.available === false) return { state: 'unavailable', label: 'Unavailable', reason: s.reason || 'The screening runs could not be read.', facts: [] };
  const unreviewed = Number(s.unreviewed_hits) || 0;
  const runs = Number(s.runs_total) || 0;
  const state = unreviewed > 0 ? 'action_required' : runs === 0 ? 'no_data_yet' : 'measured_zero';
  const label = unreviewed > 0 ? `${unreviewed} unreviewed hit${unreviewed === 1 ? '' : 's'}` : runs === 0 ? 'No screening run yet' : '0 unreviewed hits';
  const last = s.last_run_at
    ? `${whenOf(s.last_run_at) || s.last_run_at} · ${s.last_run_hit === true ? 'matched a list' : s.last_run_hit === false ? 'no match' : 'result not recorded'}`
    : 'None has been asked for';
  const reviewed = Number(s.reviewed_hits);
  return {
    state,
    label,
    facts: [
      ['How it runs', 'On request, per entity · not on a schedule'],
      ['Last screening', last],
      ['Runs recorded', String(runs)],
      ['Reviewed hits', Number.isFinite(reviewed) ? `${reviewed}${reviewed && s.last_reviewed_at ? ` (latest reviewed ${whenOf(s.last_reviewed_at) || s.last_reviewed_at})` : ''}` : 'Not recorded'],
    ],
    href: s.path || '/trust',
  };
}

/** The KYC block from the overview's counts; unreadable says so, never zeros. */
export function kycBlock(data) {
  if (!data) return { state: 'pending', label: 'Reading…', rows: [] };
  if (data.kyc_available === false) return { state: 'unavailable', label: 'Unavailable', reason: data.kyc_reason || 'The KYC queue could not be read.', rows: [] };
  const k = data.kyc || {};
  const pending = Number(k.pending) || 0;
  return {
    state: pending > 0 ? 'action_required' : 'measured_zero',
    label: pending > 0 ? `${pending} awaiting review` : 'None awaiting review',
    rows: [['Pending', pending], ['Approved', Number(k.approved) || 0], ['Rejected', Number(k.rejected) || 0]],
  };
}

/** One block body as plain lines, so a draft and its published revision compare line by line. */
export function bodyLines(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.items)) {
    return body.items.map((c) => [c.name, c.auditor, c.issued_on && `issued ${c.issued_on}`, c.expires_on && `expires ${c.expires_on}`].filter(Boolean).join(' · '));
  }
  const out = [];
  if (body.intro) out.push(body.intro);
  for (const g of body.groups || []) {
    for (const l of g.lines || []) out.push(g.title ? `${g.title} · ${l.text}` : l.text);
  }
  return out;
}

/** What a draft changes against what is published: lines removed and added, in order, counted with repeats. */
export function lineDiff(published, draft) {
  const left = bodyLines(published);
  const right = bodyLines(draft);
  const pool = new Map();
  for (const l of left) pool.set(l, (pool.get(l) || 0) + 1);
  const added = [];
  for (const l of right) {
    const n = pool.get(l) || 0;
    if (n > 0) pool.set(l, n - 1); else added.push(l);
  }
  const removed = [];
  const keep = new Map();
  for (const l of right) keep.set(l, (keep.get(l) || 0) + 1);
  for (const l of left) {
    const n = keep.get(l) || 0;
    if (n > 0) keep.set(l, n - 1); else removed.push(l);
  }
  return { removed, added };
}

/**
 * The publish review's sections (SE07b): one per block with a draft, its lines
 * removed and added, and the subprocessor list's own changes under
 * "Subprocessors". A draft identical to what is published says so.
 */
export function publishSections(read, now = Date.now()) {
  const p = pendingChanges(read);
  const byKey = new Map((read?.blocks || []).map((b) => [b.key, b]));
  const sections = p.blocks.map((b) => {
    const blk = byKey.get(b.key);
    const d = lineDiff(blk?.published?.body, blk?.draft?.body);
    const n = d.removed.length + d.added.length;
    return {
      key: b.key,
      label: b.label,
      ...d,
      summary: !blk?.published ? 'First publish of this block' : n === 0 ? 'No line differs (dates or order only)' : `${n} line${n === 1 ? '' : 's'} changed`,
    };
  });
  if (p.added.length || p.removed.length) {
    const lines = {
      added: p.added.map((s) => [s.name, s.purpose, s.location, `from ${dayWords(activeFrom(s.starts_at, now)) || activeFrom(s.starts_at, now)}`].filter(Boolean).join(' · ')),
      removed: p.removed.map((s) => s.name),
    };
    const at = sections.findIndex((s) => s.key === 'subprocessors');
    const summary = [p.added.length && `${p.added.length} added`, p.removed.length && `${p.removed.length} removed`].filter(Boolean).join(' · ');
    if (at >= 0) {
      sections[at] = { ...sections[at], added: [...sections[at].added, ...lines.added], removed: [...sections[at].removed, ...lines.removed], summary: `${sections[at].summary} · ${summary}` };
    } else {
      sections.push({ key: 'subprocessors', label: 'Subprocessors', ...lines, summary });
    }
  }
  return { sections, count: p.count, any: p.any, added: p.added, removed: p.removed };
}

/** The publishing block: published revision, how many blocks differ, and its state. */
export function publishingBlock(read) {
  if (!read) return { state: 'pending', label: 'Reading…' };
  if (read.unreadable) return { state: 'unavailable', label: 'Unavailable', reason: read.reason || 'The Trust Center content could not be read.' };
  const p = pendingChanges(read);
  const rev = read.revision;
  const published = rev?.available === false
    ? 'Unknown: the change log could not be read'
    : rev?.revision
      ? `Revision ${rev.revision}${rev.published_at ? ` · ${whenOf(rev.published_at)}` : ''}`
      : 'Never published';
  return {
    state: p.any ? 'action_required' : rev?.revision ? 'healthy' : 'no_data_yet',
    label: p.any ? `${p.count} draft change${p.count === 1 ? '' : 's'}` : rev?.revision ? 'Published, no drafts' : 'Nothing published yet',
    published,
    draft: p.any ? `${p.count} block${p.count === 1 ? ' differs' : 's differ'} from published` : 'No draft',
    canReview: p.any,
    revision: rev?.available === false ? null : (rev?.revision ?? null),
  };
}

/** The notices block: subscribers, whether mail is configured, and one row per notice. */
export function noticesBlock(read) {
  if (!read) return { state: 'pending', rows: [] };
  if (read.unreadable) return { state: 'unavailable', reason: read.reason, rows: [] };
  const subs = read.subscribers || {};
  const n = read.notices;
  const subscribers = `${Number(subs.confirmed) || 0} confirmed · ${Number(subs.pending) || 0} pending`;
  if (!n || n.available === false) {
    return { state: 'unavailable', subscribers, reason: n?.reason || 'The notice deliveries were not read.', rows: [] };
  }
  const rows = n.rows.map((r) => {
    const queued = r.started ? 0 : r.not_sent;
    const missed = r.started ? r.not_sent : 0;
    const state = r.failed > 0 || missed > 0 ? 'action_required' : r.sending > 0 || queued > 0 ? 'pending' : 'healthy';
    return {
      uid: r.uid,
      name: r.name,
      starts: dayWords(r.starts_at) || r.starts_at,
      started: r.started,
      state,
      word: r.failed > 0 ? 'Some failed' : missed > 0 ? 'Not all sent before start' : r.sending > 0 || queued > 0 ? 'In progress' : 'Sent',
      counts: [['Queued', queued], ['Sending', r.sending], ['Sent', r.sent], ['Failed', r.failed], ...(missed ? [['Not sent before start', missed]] : [])],
    };
  });
  return {
    state: !n.mail_configured && rows.some((r) => r.state !== 'healthy') ? 'action_required' : rows.length ? 'healthy' : 'measured_zero',
    subscribers,
    mailConfigured: n.mail_configured,
    rows,
  };
}

/**
 * What a Publish answered: done (with how many blocks and whether notices
 * went out), stale (the drafts changed since this review — SE07c), unconfirmed
 * (no answer, or the server could not confirm: Try again resends the same
 * key), or refused with the server's words.
 */
export function publishResultOf(res, err) {
  if (!err) return { result: 'done', replayed: Boolean(res?.replayed), notices: res?.notices === 'queued', blocks: (res?.blocks || []).length, added: (res?.added || []).length, removed: (res?.removed || []).length };
  if (err?.code === 'changed_since_review') return { result: 'stale' };
  if (err?.code === 'not_confirmed' || !err?.status || err.status >= 500) {
    return { result: 'unconfirmed', message: PUBLISH_UNCONFIRMED };
  }
  return { result: 'refused', message: publishRefusalText(err) };
}
