// D1211 (#3177, part 6 of #2420) — the Calendar's item drawer at
// /calendar/item/:kind/:id (CAL4, CAL5), its refusal (CAL18), and the
// Reschedule and Cancel dialogs (CAL19). The drawer reads its one item from
// the Worker (`calendarItemsApi.item`), so a deep link works outside the view
// behind it and a meeting the reader is not part of shows nothing about it.
// Every action follows the item's own `can`; the words are in
// calendarItemModel.js.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { calendarItemsApi } from '../lib/api/calendarItems';
import { Lightbox, Unreadable, actionDanger, actionGhost, actionPrimary } from '../ui';
import {
  ANSWERS, ANSWER_WORD, KIND_WORDS, LENGTHS, NOT_PARTY, NOT_PARTY_SUB, SAYS,
  copyLines, goingLine, joinOpen, minutesOf, noChangeLine, refusalOf, startError, startOf, whenLine, whenShort, zoneLabel,
} from './calendarItemModel';

const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const SECTION = 'flex flex-col gap-1.5 border-t border-axal-hairline px-5 py-3.5 dark:border-gray-700';
const PILL = 'inline-flex items-center gap-1 rounded-full border border-axal-hairline px-2 py-0.5 text-[11px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-200';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-400 dark:hover:text-violet-300';
const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

function Section({ title, meta = null, children, testId }) {
  return (
    <section className={SECTION} data-testid={testId}>
      {title ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className={`m-0 ${EYEBROW}`}>{title}</h3>
          {meta ? <span className={`text-[11.5px] font-semibold ${MUTED}`}>{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The length choices as a segmented row. */
export function LengthChoice({ kind, value, onChange, testId }) {
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" data-testid={testId}>
      <legend className={EYEBROW}>Length</legend>
      <span className="flex flex-wrap gap-1.5">
        {(LENGTHS[kind] || LENGTHS.ic_meeting).map((m) => (
          <button key={m} type="button" aria-pressed={value === m} onClick={() => onChange(m)}
            className={value === m ? actionPrimary : actionGhost}>{m} min</button>
        ))}
      </span>
    </fieldset>
  );
}

/** A start field in the reader's own time, with CAL7's inline error under it. */
export function StartField({ label = 'Start', value, onChange, zoneWords, testId }) {
  const error = startError(value);
  return (
    <label className="flex flex-col gap-1">
      <span className={EYEBROW}>{label}</span>
      <input type="datetime-local" className={`${FIELD} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
      {zoneWords ? <span className={`text-[11.5px] ${MUTED}`}>{zoneWords}</span> : null}
      {error ? <span role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-400" data-testid={`${testId}-error`}>{error}</span> : null}
    </label>
  );
}

/** CAL19, left: a new start and length. Only the kinds whose Worker route moves them. */
export function RescheduleDialog({ item, onClose, onDone }) {
  const zone = viewerZone();
  const kind = item.kind;
  const [start, setStart] = useState('');
  const [length, setLength] = useState(() => {
    const mins = minutesOf(item);
    return (LENGTHS[kind] || []).includes(mins) ? mins : kind === 'ic_meeting' ? 60 : 30;
  });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const ready = !!startOf(start) && !startError(start);
  const save = async () => {
    setBusy(true); setSaid(null);
    try {
      const body = { start_at: startOf(start).toISOString(), duration_min: length };
      if (kind === 'ic_meeting') await calendarItemsApi.rescheduleIcMeeting(item.source_id, body);
      else await calendarItemsApi.rescheduleCheckin(item.source_id, body);
      onDone();
    } catch (e) { setSaid(refusalOf(e).text); }
    setBusy(false);
  };
  const noun = kind === 'ic_meeting' ? 'meeting' : 'check-in';
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={onClose}>Back</button>
      <button type="button" className={actionPrimary} disabled={!ready || busy} onClick={save} data-testid="cal-reschedule-save">{busy ? 'Moving…' : `Move ${noun}`}</button>
    </div>
  );
  return (
    <Lightbox label={`Reschedule ${item.title}`} title={`Reschedule ${item.title}`} sub={`Now ${whenShort(item, zone)}.`} onClose={onClose} width={480} phone="sheet" footer={footer} testId="cal-reschedule-dialog">
      <div className="flex flex-col gap-3 px-5 py-4">
        <StartField label="New start" value={start} onChange={setStart} zoneWords={zoneLabel(zone)} testId="cal-reschedule-start" />
        <LengthChoice kind={kind} value={length} onChange={setLength} testId="cal-reschedule-length" />
        <p className={`m-0 text-[12.5px] ${INK}`} data-testid="cal-reschedule-says">{SAYS.move}</p>
        {said ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="cal-reschedule-refused">{said}</p> : null}
      </div>
    </Lightbox>
  );
}

/** CAL19, right. An IC meeting takes a reason; a check-in has nowhere to keep one, so it is not asked. */
export function CancelDialog({ item, onClose, onDone }) {
  const zone = viewerZone();
  const ic = item.kind === 'ic_meeting';
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const invited = Array.isArray(item.people) ? item.people.length : null;
  const save = async () => {
    setBusy(true); setSaid(null);
    try {
      if (ic) await api.cancelIcMeeting(item.source_id, reason.trim() || undefined);
      else await api.cancelCheckin(item.source_id);
      onDone();
    } catch (e) { setSaid(refusalOf(e).text); }
    setBusy(false);
  };
  const noun = ic ? 'meeting' : 'check-in';
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={onClose} data-testid="cal-cancel-keep">Keep {noun}</button>
      <button type="button" className={actionDanger} disabled={busy} onClick={save} data-testid="cal-cancel-save">{busy ? 'Cancelling…' : `Cancel ${noun}`}</button>
    </div>
  );
  return (
    <Lightbox label={`Cancel ${item.title}?`} title={`Cancel ${item.title}?`} sub={`${whenShort(item, zone)}${invited != null ? ` · ${invited} invited` : ''}.`} onClose={onClose} width={480} phone="sheet" footer={footer} testId="cal-cancel-dialog">
      <div className="flex flex-col gap-3 px-5 py-4">
        {ic ? (
          <label className="flex flex-col gap-1">
            <span className={EYEBROW}>Reason · optional</span>
            <textarea rows={2} maxLength={240} className={FIELD} placeholder="Write a reason…" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cal-cancel-reason" />
          </label>
        ) : <p className={`m-0 text-[12px] ${MUTED}`} data-testid="cal-cancel-no-reason">A check-in keeps no reason, so none is asked.</p>}
        <p className={`m-0 text-[12.5px] ${INK}`} data-testid="cal-cancel-says">{SAYS.cancel}</p>
        {said ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="cal-cancel-refused">{said}</p> : null}
      </div>
    </Lightbox>
  );
}

/** CAL4's Where: the link, Copy, and Join from 15 minutes before. */
function Where({ item, now }) {
  const [copied, setCopied] = useState(false);
  if (!item.location_uri) {
    const calendly = item.kind === 'calendly_event';
    return (
      <Section title="Where" testId="cal-item-where">
        <p className={`m-0 text-[13px] font-semibold ${INK}`}>No place recorded</p>
        <p className={`m-0 text-[12px] ${MUTED}`}>{calendly ? 'Calendly did not send a place for this booking.' : 'Nobody added a place or a link to this item.'}</p>
      </Section>
    );
  }
  const open = joinOpen(item, now);
  const copy = async () => {
    try { await navigator.clipboard.writeText(item.location_uri); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Section title="Where" testId="cal-item-where">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <a className={`font-mono text-[12.5px] font-semibold ${LINK}`} href={item.location_uri} target="_blank" rel="noopener noreferrer">{item.location_uri.replace(/^https?:\/\//, '')}</a>
        <span className="flex gap-1.5">
          <button type="button" className={actionGhost} onClick={copy} data-testid="cal-item-copy-link">{copied ? 'Copied' : 'Copy'}</button>
          {open
            ? <a className={actionPrimary} href={item.location_uri} target="_blank" rel="noopener noreferrer" data-testid="cal-item-join">Join</a>
            : <button type="button" className={actionGhost} disabled data-testid="cal-item-join-quiet">Join</button>}
        </span>
      </span>
      <span className={`text-[11.5px] ${MUTED}`}>Join turns violet 15 minutes before the start.</span>
    </Section>
  );
}

/**
 * CAL4 and CAL5: the item over the current view. `kind` and `id` come from the
 * address; `onClose` returns to the view; `onChanged` re-reads it after a
 * change. `canCopy` is whether a calendar is connected to copy to.
 */
export default function CalendarItemDrawer({ kind, id, onClose, onChanged, canCopy = false }) {
  const zone = viewerZone();
  const [read, setRead] = useState({ status: 'loading', item: null, error: null });
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState(null);
  const load = useCallback(async () => {
    setRead((r) => ({ ...r, status: 'loading' }));
    try {
      const out = await calendarItemsApi.item(kind, id);
      setRead({ status: 'ready', item: out?.item || null, error: null });
    } catch (e) {
      setRead({ status: e?.status === 404 ? 'not_party' : 'error', item: null, error: e });
    }
  }, [kind, id]);
  useEffect(() => { load(); }, [load]);

  const item = read.item;
  const done = () => { setDialog(null); load(); onChanged?.(); };
  const answer = async (value) => {
    setBusy('rsvp'); setSaid(null);
    try { await api.rsvpIcMeeting(item.source_id, value); await load(); onChanged?.(); }
    catch (e) { setSaid(refusalOf(e).text); }
    setBusy('');
  };
  const copyOut = async () => {
    setBusy('copy'); setSaid(null);
    try {
      const r = await api.pushOneToExternal(item.kind, item.source_id);
      const to = [r?.pushed?.google && 'Google', r?.pushed?.microsoft && 'Outlook'].filter(Boolean);
      setSaid(to.length ? `Copied to ${to.join(' and ')}.` : 'Already on your connected calendars.');
      await load();
    } catch (e) { setSaid(refusalOf(e).text); }
    setBusy('');
  };

  if (read.status === 'not_party') {
    return (
      <Lightbox label="Calendar item" title="Calendar item" onClose={onClose} width={480} phone="sheet" testId="cal-item-refused">
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <span aria-hidden="true" className={`text-[22px] ${MUTED}`}>⊘</span>
          <p className={`m-0 text-[14px] font-bold ${INK}`} data-testid="cal-item-not-party">{NOT_PARTY}</p>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{NOT_PARTY_SUB}</p>
          <button type="button" className={actionGhost} onClick={onClose}>Back to Calendar</button>
        </div>
      </Lightbox>
    );
  }
  if (!item) {
    return (
      <Lightbox label="Calendar item" title="Calendar item" onClose={onClose} width={640} testId="cal-item-drawer">
        <div className="px-5 py-6" data-testid="cal-item-state">
          {read.status === 'error'
            ? <Unreadable what="This item" claim="That is not the same as it not existing." onRetry={load} />
            : <p className={`m-0 text-[13px] ${MUTED}`}>Reading…</p>}
        </div>
      </Lightbox>
    );
  }

  const cancelled = item.status === 'cancelled';
  const kindWord = KIND_WORDS[item.kind] || item.kind;
  const people = Array.isArray(item.people) ? item.people : [];
  const can = item.can || {};
  const why = noChangeLine(item);
  const going = goingLine(people);
  const venture = item.kind === 'ic_meeting' ? { title: 'Deal', name: item.deal_name, sub: 'In your deal room', act: 'Open deal' }
    : item.project_name ? { title: 'Venture', name: item.project_name, sub: null, act: 'Open venture' } : null;
  const pageAct = { advisor_booking: 'Open booking', partner_office_hour: 'Open booking', expert_booking: 'Open wellbeing', event_ticket: 'Show ticket', event_hosted: 'Open hosted event', investor_meeting: 'Open Capital relationships' }[item.kind];
  const head = (
    <span className="flex flex-col gap-1.5">
      <span className={EYEBROW}>{cancelled ? `${kindWord} · Cancelled` : kindWord}</span>
      <span className="flex flex-wrap gap-1.5">
        <span className={PILL}>{kindWord}</span>
        {cancelled ? <span className={PILL} data-testid="cal-item-cancelled">✕ Cancelled</span> : null}
        {!cancelled && item.my_role?.words ? <span className={PILL} data-testid="cal-item-role">{item.my_role.words}</span> : null}
        {!cancelled && item.my_rsvp ? <span className={PILL} data-testid="cal-item-answer">{ANSWER_WORD[item.my_rsvp] || item.my_rsvp}</span> : null}
        {item.status === 'pending' ? <span className={PILL} data-testid="cal-item-pending">◷ Waiting for confirmation</span> : null}
      </span>
    </span>
  );
  const changes = !cancelled && (can.reschedule || can.cancel);
  const footer = (changes || why) ? (
    <div className="flex flex-col gap-2">
      {changes ? (
        <span className="flex flex-wrap gap-2">
          {can.reschedule ? <button type="button" className={actionGhost} onClick={() => setDialog('reschedule')} data-testid="cal-item-reschedule">Reschedule</button> : null}
          {can.cancel ? <button type="button" className={actionDanger} onClick={() => setDialog('cancel')} data-testid="cal-item-cancel">{item.kind === 'ic_meeting' ? 'Cancel meeting' : 'Cancel'}</button> : null}
        </span>
      ) : null}
      {why ? <p className={`m-0 text-[11.5px] ${MUTED}`} data-testid="cal-item-why">{why}</p> : null}
    </div>
  ) : null;

  return (
    <>
      <Lightbox label={item.title || kindWord} eyebrow={null} title={item.title || 'Not recorded'} sub={head} onClose={onClose} width={640} footer={footer} testId="cal-item-drawer">
        <div className={`flex flex-col ${cancelled ? 'opacity-90' : ''}`} data-testid={`cal-item-${item.kind}`}>
          {cancelled ? (
            <Section testId="cal-item-cancel-reason">
              <p className={`m-0 text-[13px] ${INK}`}>{item.cancel_reason ? `Cancelled: ‘${item.cancel_reason}’` : 'Cancelled. No reason was recorded.'}</p>
            </Section>
          ) : null}
          <Section title="When" testId="cal-item-when">
            <p className={`m-0 font-mono text-[12.5px] font-semibold leading-relaxed ${INK}`}>{whenLine(item, zone)}</p>
          </Section>
          <Where item={item} now={Date.now()} />
          {can.rsvp ? (
            <Section title="Your answer" testId="cal-item-rsvp">
              <span className="flex flex-wrap gap-1.5" role="group" aria-label="Your answer">
                {ANSWERS.map(([value, word]) => (
                  <button key={value} type="button" aria-pressed={item.my_rsvp === value} disabled={busy !== ''}
                    className={item.my_rsvp === value ? actionPrimary : actionGhost} onClick={() => answer(value)} data-testid={`cal-item-rsvp-${value}`}>{word}</button>
                ))}
              </span>
            </Section>
          ) : null}
          {item.kind === 'expert_booking' ? (
            <Section testId="cal-item-private"><p className={`m-0 text-[12.5px] ${MUTED}`}>Only you see this. A private session shows no people list.</p></Section>
          ) : people.length ? (
            <Section title="People" meta={going} testId="cal-item-people">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {people.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-[13px]" data-testid="cal-item-person">
                    <span className={`font-semibold ${INK}`}>{p.name || 'Not recorded'}{p.profile ? <span className={`font-normal ${MUTED}`}> · {p.profile}</span> : null}</span>
                    <span className={`text-[12px] ${MUTED}`}>{p.stands}{p.answer ? ` · ${p.answer}` : ''}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {venture ? (
            <Section title={venture.title} testId="cal-item-venture">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-col">
                  <span className={`text-[13px] font-semibold ${INK}`}>{venture.name || 'Not recorded'}</span>
                  {venture.sub ? <span className={`text-[11.5px] ${MUTED}`}>{venture.sub}</span> : null}
                </span>
                {item.href ? <Link className={LINK} to={item.href} data-testid="cal-item-open">{venture.act}</Link> : null}
              </span>
            </Section>
          ) : item.href && pageAct ? (
            <Section testId="cal-item-page"><Link className={LINK} to={item.href} data-testid="cal-item-open">{pageAct}</Link></Section>
          ) : null}
          {item.notes ? (
            <Section title={item.kind === 'ic_meeting' ? 'Agenda' : 'Notes'} testId="cal-item-notes">
              <p className={`m-0 whitespace-pre-line text-[13px] leading-relaxed ${INK}`}>{item.notes}</p>
            </Section>
          ) : null}
          {!cancelled && can.copy ? (
            <Section title="Copies" testId="cal-item-copies">
              {copyLines(item).map((c) => (
                <span key={c.key} className={`text-[12.5px] ${c.copied ? INK : MUTED}`} data-testid={`cal-item-copy-${c.key}`}>
                  {c.copied ? `✓ Copied to ${c.name}` : `${c.name} · Not copied`}
                </span>
              ))}
              {canCopy
                ? <button type="button" className={`${actionGhost} self-start`} disabled={busy !== ''} onClick={copyOut} data-testid="cal-item-copy-now">{busy === 'copy' ? 'Copying…' : 'Copy to my calendar'}</button>
                : <span className={`text-[11.5px] ${MUTED}`}>Connect Google or Outlook to copy this there.</span>}
            </Section>
          ) : null}
          {said ? <p role="status" className={`m-0 px-5 pb-3 text-[12.5px] font-semibold ${INK}`} data-testid="cal-item-said">{said}</p> : null}
        </div>
      </Lightbox>
      {dialog === 'reschedule' ? <RescheduleDialog item={item} onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog === 'cancel' ? <CancelDialog item={item} onClose={() => setDialog(null)} onDone={done} /> : null}
    </>
  );
}
