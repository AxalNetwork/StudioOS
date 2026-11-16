/**
 * #5310 part 3 — NW3.2 and NW3.4 of the approved Network workspace canvas
 * (`design/incoming/network-workspace/NW3-Intro-detail.dc.html`, D4799): one
 * introduction request as its record, from `GET
 * /api/relationships/intro-requests/:uid` (the log's own shape, to the asker
 * or the teammate only). `IntroRecordSheet.jsx` draws what these return.
 *
 * Only recorded states are drawn. "Made" is a fact the introducer records,
 * by sending from their mailbox or by reconciling a send the mail server
 * took (D4604); accepting is not making. The asker never reads the
 * introducer's delivery, so for the asker the send is never claimed either way.
 */
import { NOT_RECORDED, STATUS_LABEL, deliveryOf, followUpLine, personOf } from './relationshipsModel';

export { NOT_RECORDED };

/** A stamp as "2026-10-31 10:02", or null. */
export function stampOf(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s ?? ''));
  if (m) return `${m[1]} ${m[2]}`;
  const d = /^(\d{4}-\d{2}-\d{2})$/.exec(String(s ?? ''));
  return d ? d[1] : null;
}
const first = (name) => String(name || '').trim().split(/\s+/)[0] || null;
const teammateName = (r) => r?.teammate?.name || 'your teammate';
const askerName = (r) => r?.requester?.name || 'a teammate';

/** The sheet's title: who asked, for whom, through whom, from the reader's side. */
export function headline(r, side) {
  const person = r?.person?.name || 'someone';
  return side === 'asker' ? `You → ${person}, via ${teammateName(r)}` : `${askerName(r)} → ${person}, via you`;
}
export const subline = (r) => `Requested ${stampOf(r?.created_at)?.slice(0, 10) || NOT_RECORDED} · ${personOf(r)}`;

/**
 * The five steps, each done, ended or not yet. Declined and Withdrawn end the
 * request at the step they happened on; the steps after an ending are not
 * drawn as waiting.
 */
export function lifecycle(r) {
  const ended = r?.status === 'declined' ? 'declined' : r?.status === 'withdrawn' ? 'withdrawn' : null;
  const step = (key, label, done) => ({ key, label, state: done ? 'done' : ended ? 'ended' : 'todo' });
  return [
    step('requested', 'Requested', Boolean(r?.created_at)),
    { key: 'decided', label: r?.status === 'declined' ? 'Declined' : 'Decided', state: r?.decided_at || r?.accepted_at ? 'done' : ended === 'withdrawn' ? 'ended' : 'todo' },
    step('accepted', 'Accepted', Boolean(r?.accepted_at)),
    step('made', 'Made', Boolean(r?.made_at)),
    step('outcome', 'Outcome', Boolean(r?.outcome?.value)),
  ];
}
export const ENDINGS_LINE = 'Other recorded endings: Declined (with an optional note the requester can read) · Withdrawn by the requester.';

/**
 * The recorded entries, oldest first, each Recorded or Not recorded. The
 * introduction email is the introducer's to see (D4604): the asker reads
 * only that Made is not recorded yet.
 */
export function timeline(r, side) {
  const you = (who) => (who === 'asker' && side === 'asker') || (who === 'teammate' && side === 'teammate');
  const by = (who, name) => (you(who) ? 'you' : name);
  const rows = [{
    key: 'requested', recorded: true, at: stampOf(r?.created_at),
    title: `Requested by ${by('asker', askerName(r))}`, note: r?.note || null,
  }];
  if (r?.status === 'withdrawn') rows.push({ key: 'withdrawn', recorded: true, at: stampOf(r?.withdrawn_at), title: `Withdrawn by ${by('asker', askerName(r))}`, note: null });
  if (r?.status === 'declined') rows.push({ key: 'declined', recorded: true, at: stampOf(r?.decided_at), title: `Declined by ${by('teammate', teammateName(r))} · Not now`, note: r?.decision_note || null });
  if (r?.accepted_at) rows.push({ key: 'accepted', recorded: true, at: stampOf(r.accepted_at), title: `Accepted by ${by('teammate', teammateName(r))}`, note: r?.decision_note || null });
  if (r?.status === 'accepted') {
    const d = side === 'teammate' ? deliveryOf(r) : { state: null, line: null };
    rows.push({
      key: 'email', recorded: Boolean(d.state), at: null,
      title: side === 'teammate' ? 'Introduction email' : 'Introduction email · sent from the introducer’s own mailbox',
      note: side === 'teammate' ? (d.line || 'Not sent yet. Write it from your mailbox; sending it records Made.') : `Made is recorded when ${first(teammateName(r))} sends it or records it. Their mailbox is theirs; this record does not read it.`,
    });
  }
  if (!['declined', 'withdrawn'].includes(r?.status)) {
    rows.push(r?.made_at
      ? { key: 'made', recorded: true, at: stampOf(r.made_at), title: 'Made', note: null }
      : { key: 'made', recorded: false, at: null, title: 'Made', note: 'Not recorded yet' });
    rows.push(r?.outcome?.value
      ? { key: 'outcome', recorded: true, at: stampOf(r.outcome.recorded_at), title: `Outcome · ${r.outcome.label || r.outcome.value}`, note: r.outcome.note || null }
      : { key: 'outcome', recorded: false, at: null, title: 'Outcome · meeting held, replied, no reply or not a fit', note: 'Either of you records this after the introduction is made' });
  }
  return rows;
}

/**
 * The banner over an accepted request that is not made. For the teammate,
 * a send the mail server took and the record has not caught up with is
 * NW3.4's reconciliation: Update the record, never Resend.
 */
export function banner(r, side) {
  if (r?.status !== 'accepted' || r?.made_at) return null;
  if (side === 'teammate') {
    const d = deliveryOf(r);
    if (d.state === 'record_pending') return { tone: 'reconcile', text: d.line, action: 'reconcile' };
    if (d.state) return { tone: 'wait', text: d.line, action: null };
    return { tone: 'wait', text: 'You accepted this introduction. It is made when you send it from your mailbox. Nothing is sent for you.', action: null };
  }
  const t = first(teammateName(r));
  return { tone: 'wait', text: `${t} accepted this introduction. It has not been made yet. Accepting is ${t}’s yes; the introduction counts as made only when ${t} sends it or records it. Nothing is sent for them.`, action: null };
}

/** The people on the request, from the reader's side. */
export function people(r, side) {
  return [
    { role: 'Target', name: r?.person?.name || NOT_RECORDED, line: r?.person?.company || null },
    { role: 'Introducer', name: side === 'teammate' ? 'You' : teammateName(r), line: side === 'teammate' ? null : 'your teammate · shares their book with your team' },
    { role: 'Requester', name: side === 'asker' ? 'You' : askerName(r), line: null },
  ];
}

/** What happens next, and what the reader may do here. Every action is one the Worker allows that side. */
export function nextStep(r, side) {
  const t = first(teammateName(r));
  switch (r?.status) {
    case 'pending':
      return side === 'asker'
        ? { text: `Waiting on ${t} to decide. You can withdraw the request while it waits.`, actions: ['withdraw'] }
        : { text: 'Waiting on you: accept it or say Not now, from Asked of you on Introductions.', actions: [] };
    case 'accepted':
      return side === 'asker'
        ? { text: `Waiting on ${t} to make the introduction.`, actions: ['follow_up'] }
        : { text: 'Write the introduction from your mailbox, from Asked of you on Introductions. Sending it records Made.', actions: banner(r, side)?.action === 'reconcile' ? ['reconcile', 'follow_up'] : ['follow_up'] };
    case 'made':
      return { text: r?.outcome?.value ? `Outcome recorded: ${r.outcome.label || r.outcome.value}.` : 'Record the outcome once you know it.', actions: r?.outcome?.value ? ['follow_up'] : ['outcome', 'follow_up'] };
    case 'declined':
    case 'withdrawn':
      return { text: `This request has ended: ${STATUS_LABEL[r.status]}.`, actions: [] };
    default:
      return { text: NOT_RECORDED, actions: [] };
  }
}

/** The reader's own follow-up on it, in the log's words. */
export const followUpOf = (r) => (r?.follow_up ? followUpLine(r.follow_up) : 'None set');

export const CREDITS_LINE = 'Team introductions spend no intro credits. Curated matches do.';
export const NO_RESEND = 'No “Resend”: a second email would be a duplicate introduction.';
