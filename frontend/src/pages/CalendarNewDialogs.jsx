// D1211 (#3177, part 6 of #2420) — the Calendar's New menu (CAL8 A), New IC
// meeting (CAL7) and New check-in (CAL8 B). People and deals are found by
// name through D1207's pickers (`calendarItemsApi.people`, `.deals`), which
// offer only people the caller works with, never by email or user number.
// "Add a Google Meet link" is drawn only when Google is connected (#2420's
// owner question 4, option a); the Worker makes the link before it saves.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { calendarItemsApi } from '../lib/api/calendarItems';
import { Lightbox, actionGhost, actionPrimary } from '../ui';
import { IC_PLAN, IC_PLAN_SUB, SAYS, newMenu, refusalOf, startError, startOf, zoneLabel } from './calendarItemModel';
import { LengthChoice, StartField } from './CalendarItemDrawer';

const INK = 'text-axal-ink dark:text-gray-200';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const CHIP = 'inline-flex items-center gap-1.5 rounded-full border border-axal-hairline bg-white px-2.5 py-1 text-[12px] font-semibold text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
const OPTION = 'flex w-full flex-col items-start rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-violet-50 dark:hover:bg-[#211f3d]';
const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

/** CAL8 A: the New menu. Items that leave the page carry ↗ and say where they go. */
export function NewMenu({ role, onPick }) {
  const [open, setOpen] = useState(false);
  const items = newMenu(role);
  return (
    <span className="relative inline-flex">
      <button type="button" className="cal-btn cal-btn-p" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)} data-testid="cal-new">New ▾</button>
      {open ? (
        <span role="menu" className="absolute right-0 top-full z-20 mt-1 flex w-[280px] flex-col rounded-[12px] border border-axal-hairline bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900" data-testid="cal-new-menu">
          {items.map((it) => it.to ? (
            <Link key={it.key} role="menuitem" to={it.to} className={OPTION} onClick={() => setOpen(false)} data-testid={`cal-new-${it.key}`}>
              <span className={`font-semibold ${INK}`}>{it.label}</span>
              <span className={`text-[11.5px] ${MUTED}`}>{it.sub}</span>
            </Link>
          ) : (
            <button key={it.key} type="button" role="menuitem" className={OPTION} onClick={() => { setOpen(false); onPick(it.key); }} data-testid={`cal-new-${it.key}`}>
              <span className={`font-semibold ${INK}`}>{it.label}</span>
              {it.sub ? <span className={`text-[11.5px] ${MUTED}`}>{it.sub}</span> : null}
            </button>
          ))}
          <span className={`px-2.5 pt-1 text-[11px] ${MUTED}`}>Items that leave the page carry ↗.</span>
        </span>
      ) : null}
    </span>
  );
}

/** A search box with results under it: `search(q)` answers a list; `render` draws one. */
function Finder({ label, placeholder, search, render, onChoose, disabled = false, testId, note }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ status: 'idle', items: [] });
  const seq = useRef(0);
  useEffect(() => {
    if (disabled) { setFound({ status: 'idle', items: [] }); return undefined; }
    const mine = ++seq.current;
    setFound((f) => ({ ...f, status: 'loading' }));
    const t = setTimeout(async () => {
      try {
        const out = await search(q);
        if (mine === seq.current) setFound({ status: 'ready', items: out });
      } catch {
        if (mine === seq.current) setFound({ status: 'error', items: [] });
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, disabled, search]);
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <label className="flex flex-col gap-1">
        <span className={EYEBROW}>{label}</span>
        <input type="search" className={FIELD} placeholder={placeholder} value={q} disabled={disabled} onChange={(e) => setQ(e.target.value)} data-testid={`${testId}-q`} />
      </label>
      {note ? <span className={`text-[11.5px] ${MUTED}`}>{note}</span> : null}
      {found.status === 'error' ? <span role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-400" data-testid={`${testId}-unreadable`}>The list could not be read. Type again to retry.</span> : null}
      {found.status === 'ready' && !found.items.length ? <span className={`text-[12px] ${MUTED}`} data-testid={`${testId}-none`}>Nobody matches.</span> : null}
      {found.items.length ? (
        <ul className="m-0 flex max-h-40 list-none flex-col overflow-y-auto p-0">
          {found.items.map((x, i) => (
            <li key={i}><button type="button" className={OPTION} onClick={() => onChoose(x)} data-testid={`${testId}-option`}>{render(x)}</button></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const personLine = (p) => (
  <>
    <span className={`font-semibold ${INK}`}>{p.name || 'Not recorded'}{p.profile ? <span className={`font-normal ${MUTED}`}> · {p.profile}</span> : null}</span>
    {Array.isArray(p.how) && p.how.length ? <span className={`text-[11.5px] ${MUTED}`}>{p.how.join(' · ')}</span> : null}
  </>
);

/** Place: the Meet switch where Google is connected, or a pasted link. */
function Place({ meetAvailable, meet, setMeet, link, setLink, testId }) {
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid={testId}>
      <legend className={EYEBROW}>Place</legend>
      {meetAvailable ? (
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-1" checked={meet} onChange={(e) => setMeet(e.target.checked)} data-testid={`${testId}-meet`} />
          <span className="flex flex-col">
            <span className={`font-semibold ${INK}`}>Add a Google Meet link</span>
            <span className={`text-[11.5px] ${MUTED}`}>{SAYS.meet}</span>
          </span>
        </label>
      ) : <span className={`text-[11.5px] ${MUTED}`} data-testid={`${testId}-no-meet`}>Connect Google to add a Meet link here.</span>}
      {meet ? null : (
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Or paste a link</span>
          <input type="url" className={FIELD} placeholder="Paste a link" value={link} onChange={(e) => setLink(e.target.value)} data-testid={`${testId}-link`} />
        </label>
      )}
    </fieldset>
  );
}

function Refused({ refusal, testId }) {
  if (!refusal) return null;
  if (refusal.plan) {
    return (
      <div role="alert" className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2 dark:border-gray-700" data-testid={`${testId}-plan`}>
        <span className={`text-[13px] font-bold ${INK}`}>{IC_PLAN}</span>
        <span className={`text-[12px] ${MUTED}`}>{IC_PLAN_SUB}</span>
        <Link className={`${actionPrimary} self-start`} to="/pricing">See plans</Link>
      </div>
    );
  }
  return <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid={testId}>{refusal.text}</p>;
}

/** CAL7: New IC meeting. The deal first; then its people; a past start is refused inline. */
export function NewIcDialog({ meetAvailable, onClose, onSaved }) {
  const zone = viewerZone();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [length, setLength] = useState(60);
  const [deal, setDeal] = useState(null);
  const [people, setPeople] = useState([]);
  const [meet, setMeet] = useState(!!meetAvailable);
  const [link, setLink] = useState('');
  const [agenda, setAgenda] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const ready = title.trim().length >= 2 && deal && startOf(start) && !startError(start);
  const findDeals = useRef(async (q) => (await calendarItemsApi.deals(q))?.items || []).current;
  const dealId = deal?.id;
  const [findPeople, setFindPeople] = useState(() => async () => []);
  useEffect(() => {
    setFindPeople(() => async (q) => (dealId ? (await calendarItemsApi.people({ for: 'ic', deal_id: dealId, q }))?.items || [] : []));
  }, [dealId]);
  const save = async () => {
    setBusy(true); setRefusal(null);
    try {
      await calendarItemsApi.newIcMeeting({
        title: title.trim(), start_at: startOf(start).toISOString(), duration_min: length, deal_id: deal.id,
        attendee_uids: people.map((p) => p.uid), agenda: agenda.trim() || null,
        ...(meet ? { add_meet: true } : { location_uri: link.trim() || null }),
      });
      onSaved();
    } catch (e) { setRefusal(refusalOf(e)); }
    setBusy(false);
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={onClose}>Back</button>
      <button type="button" className={actionPrimary} disabled={!ready || busy} onClick={save} data-testid="cal-ic-save">{busy ? 'Creating…' : 'Create meeting'}</button>
    </div>
  );
  return (
    <Lightbox label="New IC meeting" title="New IC meeting" sub="Only investors and admins can join an IC meeting." onClose={onClose} width={560} phone="sheet" footer={footer} testId="cal-ic-dialog">
      <div className="flex flex-col gap-3 px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Title</span>
          <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="[Venture · Round] — IC" data-testid="cal-ic-title" />
        </label>
        <StartField value={start} onChange={setStart} zoneWords={zoneLabel(zone)} testId="cal-ic-start" />
        <LengthChoice kind="ic_meeting" value={length} onChange={setLength} testId="cal-ic-length" />
        {deal ? (
          <span className="flex flex-col gap-1" data-testid="cal-ic-deal-chosen">
            <span className={EYEBROW}>Deal</span>
            <span className={CHIP}>{deal.name || 'Not recorded'}<button type="button" aria-label={`Change the deal ${deal.name || ''}`} onClick={() => { setDeal(null); setPeople([]); }}>✕</button></span>
          </span>
        ) : (
          <Finder label="Deal" placeholder="Find a deal you can see" search={findDeals} testId="cal-ic-deal"
            render={(d) => <><span className={`font-semibold ${INK}`}>{d.name || 'Not recorded'}</span>{d.status ? <span className={`text-[11.5px] ${MUTED}`}>{d.status}</span> : null}</>}
            onChoose={setDeal} />
        )}
        <div className="flex flex-col gap-1.5">
          {people.length ? (
            <span className="flex flex-wrap gap-1.5" data-testid="cal-ic-people-chosen">
              {people.map((p) => <span key={p.uid} className={CHIP}>{p.name}{p.profile ? <span className={MUTED}>{p.profile}</span> : null}<button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPeople((l) => l.filter((x) => x.uid !== p.uid))}>✕</button></span>)}
            </span>
          ) : null}
          <Finder label="People" placeholder={deal ? 'Search by name' : 'Choose the deal first'} disabled={!deal} search={findPeople} testId="cal-ic-people"
            note={SAYS.create} render={personLine}
            onChoose={(p) => setPeople((l) => (l.some((x) => x.uid === p.uid) ? l : [...l, p]))} />
        </div>
        <Place meetAvailable={meetAvailable} meet={meet} setMeet={setMeet} link={link} setLink={setLink} testId="cal-ic-place" />
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Agenda</span>
          <textarea rows={3} className={FIELD} value={agenda} onChange={(e) => setAgenda(e.target.value)} data-testid="cal-ic-agenda" />
        </label>
        <Refused refusal={refusal} testId="cal-ic-refused" />
      </div>
    </Lightbox>
  );
}

/**
 * CAL8 B: New check-in. A founder picks who it is with; anyone else picks the
 * founder (the Worker books only a founder). The venture comes from the
 * person picked.
 */
export function NewCheckinDialog({ role, meetAvailable, onClose, onSaved }) {
  const zone = viewerZone();
  const founder = String(role || '').toLowerCase() === 'founder';
  const [who, setWho] = useState(null);
  const [venture, setVenture] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [length, setLength] = useState(30);
  const [meet, setMeet] = useState(!!meetAvailable);
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const findPeople = useRef(async (q) => (await calendarItemsApi.people({ for: 'checkin', q }))?.items || []).current;
  const ventures = Array.isArray(who?.ventures) ? who.ventures : [];
  const ready = who && title.trim().length >= 2 && startOf(start) && !startError(start);
  const choose = (p) => {
    setWho(p);
    const only = Array.isArray(p.ventures) && p.ventures.length === 1 ? p.ventures[0] : null;
    setVenture(only ? String(only.id) : '');
    if (only && !title) setTitle(`${only.name} check-in`);
  };
  const save = async () => {
    setBusy(true); setRefusal(null);
    try {
      await api.createCheckin({
        ...(founder ? { counterpart_uid: who.uid } : { founder_uid: who.uid }),
        project_id: venture ? Number(venture) : null,
        title: title.trim(), start_at: startOf(start).toISOString(), duration_min: length, notes: notes.trim() || null,
        ...(meet ? { add_meet: true } : { location_uri: link.trim() || null }),
      });
      onSaved();
    } catch (e) { setRefusal(refusalOf(e)); }
    setBusy(false);
  };
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className={actionGhost} onClick={onClose}>Back</button>
      <button type="button" className={actionPrimary} disabled={!ready || busy} onClick={save} data-testid="cal-ck-save">{busy ? 'Booking…' : 'Book check-in'}</button>
    </div>
  );
  return (
    <Lightbox label="New check-in" title="New check-in" sub="Book a check-in with someone you work with." onClose={onClose} width={560} phone="sheet" footer={footer} testId="cal-ck-dialog">
      <div className="flex flex-col gap-3 px-5 py-4">
        {who ? (
          <span className="flex flex-col gap-1" data-testid="cal-ck-with-chosen">
            <span className={EYEBROW}>With</span>
            <span className={CHIP}>{who.name}{who.profile ? <span className={MUTED}>{who.profile}</span> : null}<button type="button" aria-label={`Change ${who.name}`} onClick={() => { setWho(null); setVenture(''); }}>✕</button></span>
          </span>
        ) : (
          <Finder label="With" placeholder={founder ? 'Search the people on your ventures' : 'Search the founders you work with'} search={findPeople} testId="cal-ck-with"
            note="Search is limited to people you work with." render={personLine} onChoose={choose} />
        )}
        {ventures.length ? (
          <label className="flex flex-col gap-1">
            <span className={EYEBROW}>Venture</span>
            <select className={FIELD} value={venture} onChange={(e) => setVenture(e.target.value)} data-testid="cal-ck-venture">
              {ventures.length > 1 ? <option value="">Any venture you share</option> : null}
              {ventures.map((v) => <option key={v.id} value={String(v.id)}>{v.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Title</span>
          <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="[Venture] weekly check-in" data-testid="cal-ck-title" />
        </label>
        <StartField value={start} onChange={setStart} zoneWords={zoneLabel(zone)} testId="cal-ck-start" />
        <LengthChoice kind="founder_checkin" value={length} onChange={setLength} testId="cal-ck-length" />
        <Place meetAvailable={meetAvailable} meet={meet} setMeet={setMeet} link={link} setLink={setLink} testId="cal-ck-place" />
        <label className="flex flex-col gap-1">
          <span className={EYEBROW}>Notes</span>
          <textarea rows={2} className={FIELD} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Write notes…" data-testid="cal-ck-notes" />
        </label>
        <p className={`m-0 text-[12px] ${MUTED}`}>{SAYS.create}</p>
        <Refused refusal={refusal} testId="cal-ck-refused" />
      </div>
    </Lightbox>
  );
}
