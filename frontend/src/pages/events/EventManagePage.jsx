// D567 / #1173 — Ops canvas E1, E2, E4. Host authority is enforced by the Worker.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { events } from '../../lib/api';
import { eventsApi } from '../../lib/eventsApi';
import { PERSONAS } from '../../lib/personas';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import InvitePeopleModal from '../../components/events/InvitePeopleModal';
import CheckinScanner from '../../components/events/CheckinScanner';
import { REGISTRATION_TABS, pageRows, recorded, registrationTab } from './eventOrganiserModel';
import './eventOrganiser.css';

// The Worker's EVENT_ROLES (services/eventOrganiser.ts); D1031 adds advisor.
const roles = ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'];
const blankItem = { title: '', starts_at: '', speaker_name: '', location_text: '', location_url: '' };
export function EventReadState({ loading, error, empty, children }) {
  if (loading) return <p role="status">Loading…</p>;
  if (error) return <p role="alert">Unreadable — {error}</p>;
  if (empty) return <p>No records yet.</p>;
  return children;
}
function Pager({ data, setPage }) {
  return <div className="evo-pager"><span>{data.start}–{data.end} of {data.total}</span><button disabled={data.current <= 1} onClick={() => setPage(data.current - 1)}>Previous</button><button disabled={data.current >= data.lastPage} onClick={() => setPage(data.current + 1)}>Next</button></div>;
}
export default function EventManagePage() {
  const { id } = useParams();
  const location = useLocation();
  const screen = location.pathname.endsWith('/agenda') ? 'agenda' : location.pathname.endsWith('/registrations') ? 'registrations' : 'eligibility';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState({ mode: 'everyone', roles: [], personas: [] });
  const [approval, setApproval] = useState(false);
  const [preview, setPreview] = useState(null);
  const [tab, setTab] = useState('Pending');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('oldest');
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState({});
  const [item, setItem] = useState(blankItem);
  const [editing, setEditing] = useState(null);
  const [invite, setInvite] = useState(false);
  const [scanner, setScanner] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [detail, roster, eligibility] = await Promise.all([events.get(id), events.roster(id), events.eligibility(id)]);
      if (!detail?.event || !Array.isArray(detail.agenda) || !Array.isArray(roster?.registrations) || typeof eligibility?.eligible !== 'boolean' || typeof eligibility.reason !== 'string' || typeof roster?.counts?.seats_taken !== 'number' || typeof roster.counts.waitlisted !== 'number' || (roster.counts.capacity !== null && typeof roster.counts.capacity !== 'number')) throw new Error('The event response is incomplete.');
      setData({ ...detail, roster });
      const parsed = detail.event.audience_rules || JSON.parse(detail.event.audience_rules_json || '{}');
      setRules({ mode: 'everyone', roles: [], personas: [], ...parsed });
      setApproval(Boolean(detail.event.approval_required)); setPreview(eligibility);
    } catch (e) { setError(e.message || 'The event could not be read.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSearch(''); setPage(1); }, [screen]);
  async function act(operation) {
    setBusy(true); setActionError('');
    try { await operation(); await load(); }
    catch (e) { setActionError(e.message || 'The change could not be saved.'); }
    finally { setBusy(false); }
  }
  function toggle(key, value) { setRules(r => ({ ...r, [key]: r[key].includes(value) ? r[key].filter(v => v !== value) : [...r[key], value] })); }
  const agenda = data?.agenda || [];
  const registrations = data?.roster.registrations || [];
  const counts = data?.roster.counts;
  const seatsFree = counts && (counts.capacity === null || counts.seats_taken < counts.capacity);
  const queue = pageRows(registrations.filter(r => registrationTab(r, data?.event.approval_required) === tab), search, page, sort);
  const agendaPage = pageRows(agenda, search, page, 'oldest');
  async function move(index, direction) {
    const ids = agenda.map(a => a.id); const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await act(() => events.reorderAgenda(id, ids));
  }
  const title = screen === 'eligibility' ? 'Eligibility' : screen === 'registrations' ? 'Registration queue' : 'Agenda';
  return <WorkspaceShell title={title} scope={data?.event.title || 'Event organiser'} intro="Manage who may register, their decisions, and the attendee agenda." rail={<aside className="evo-card"><h2>Event organiser</h2><p>Save audience rules before checking the member preview. Pending paid tickets receive no check-in code until payment settles.</p><Link to={`/events/${id}/edit`}>Edit event details</Link></aside>}>
    <div className="evo">
      <nav aria-label="Event management" className="evo-tabs">{['eligibility', 'registrations', 'agenda'].map(s => <Link key={s} aria-current={screen === s ? 'page' : undefined} to={`/events/${id}/manage${s === 'eligibility' ? '' : `/${s}`}`}>{s === 'registrations' ? 'Registrations' : s[0].toUpperCase() + s.slice(1)}</Link>)}</nav>
      {actionError && <p role="alert">Could not save — {actionError}</p>}
      <EventReadState loading={loading} error={error}>
        {screen === 'eligibility' && <div className="evo-grid"><form className="evo-card" onSubmit={e => { e.preventDefault(); act(() => events.update(id, { audience_rules_json: JSON.stringify(rules), approval_required: approval })); }}>
          <h2>Who may register</h2>
          {[['everyone', 'Everyone'], ['selected', 'Chosen roles or personas'], ['invite_only', 'Invite only']].map(([value, label]) => <label key={value}><input type="radio" name="audience" checked={rules.mode === value} onChange={() => setRules(r => ({ ...r, mode: value }))} /> {label}</label>)}
          {rules.mode === 'selected' && <><fieldset><legend>Roles</legend>{roles.map(role => <label key={role}><input type="checkbox" checked={rules.roles.includes(role)} onChange={() => toggle('roles', role)} /> {role}</label>)}</fieldset><fieldset><legend>Personas</legend>{PERSONAS.map(p => <label key={p.id}><input type="checkbox" checked={rules.personas.includes(p.id)} onChange={() => toggle('personas', p.id)} /> {p.label}</label>)}</fieldset></>}
          <label><input type="checkbox" checked={approval} onChange={e => setApproval(e.target.checked)} /> Approval required</label><p>Registrations wait in Pending until you approve them.</p><button className="evo-primary" disabled={busy}>Save rule</button>
        </form><section className="evo-card"><h2>As a member sees it</h2><p>Preview of the saved rule for your signed-in account.</p>{preview ? <><strong>{preview.eligible ? 'Eligible' : 'Not eligible'}: {preview.reason}</strong><p>{preview.requires_approval ? 'Approval is required.' : 'Approval is not required.'}</p><p>{preview.is_full ? preview.waitlist_enabled ? 'The event is full; new registrations join the waitlist.' : 'The event is full.' : 'Registration has available capacity.'}</p></> : <p>Unreadable — eligibility could not be read.</p>}</section></div>}
        {screen === 'registrations' && <section className="evo-card"><h2>Capacity</h2>{counts ? <p>{counts.seats_taken} / {counts.capacity === null ? 'No limit recorded' : counts.capacity} seats · {counts.waitlisted} waitlisted</p> : <p>Unreadable — capacity was not returned.</p>}
          {counts?.capacity > 0 && <progress aria-label="Capacity used" value={Math.min(counts.seats_taken, counts.capacity)} max={counts.capacity} />}
          <div className="evo-toolbar"><button onClick={() => setInvite(true)}>Invite people</button><button onClick={() => setScanner(true)}>Check in</button><a href={eventsApi.exportUrl(id)} target="_blank" rel="noreferrer">Export</a></div>
          <div className="evo-tabs">{REGISTRATION_TABS.map(t => <button key={t} aria-pressed={t === tab} onClick={() => { setTab(t); setPage(1); }}>{t} ({registrations.filter(r => registrationTab(r, data?.event.approval_required) === t).length})</button>)}</div>
          <div className="evo-toolbar"><input aria-label="Search registrations" placeholder="Search members or roles" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /><select aria-label="Sort registrations" value={sort} onChange={e => setSort(e.target.value)}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="name">Name</option></select></div>
          {tab === 'Waitlist' && seatsFree && queue.total > 0 && <p>A seat is available. You may promote a waiting member.</p>}
          <EventReadState empty={queue.total === 0}><div className="evo-table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Registered</th><th>Rule</th><th>Decision</th><th>Actions</th></tr></thead><tbody>{queue.rows.map(r => <tr key={r.id}><td>{recorded(r.name, 'member name is absent')}</td><td>{recorded(r.role, 'member role is absent')}</td><td>{recorded(r.registered_at, 'registration time is absent')}</td><td>Not recorded — eligibility at registration was not saved.</td><td>{recorded(r.decided_by_name, 'no named decision maker')}<br />{recorded(r.decided_at, 'no decision time')}{r.status === 'declined' && <p>{recorded(r.decision_reason, 'no decline reason was supplied')}</p>}</td><td>{tab === 'Pending' && <button disabled={busy} onClick={() => act(() => events.approveRegistration(id, r.id))}>Approve</button>}{tab === 'Waitlist' && <button disabled={busy || !seatsFree} onClick={() => act(() => events.promoteRegistration(id, r.id))}>Promote</button>}{['Pending', 'Approved', 'Waitlist'].includes(tab) && <><input aria-label={`Decline reason for ${r.name || 'member'}`} placeholder="Optional reason the member sees" maxLength={1000} value={reason[r.id] || ''} onChange={e => setReason(v => ({ ...v, [r.id]: e.target.value }))} /><button disabled={busy} onClick={() => act(() => events.declineRegistration(id, r.id, reason[r.id]))}>Decline</button></>}</td></tr>)}</tbody></table></div></EventReadState><Pager data={queue} setPage={setPage} />
        </section>}
        {screen === 'agenda' && <div className="evo-grid"><section className="evo-card"><h2>Agenda items</h2><input aria-label="Search agenda" placeholder="Search titles" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /><EventReadState empty={agendaPage.total === 0}>{agendaPage.rows.map(a => { const index = agenda.findIndex(v => v.id === a.id); return <article key={a.id} className="evo-agenda-row"><strong>{a.title}</strong><p>{recorded(a.starts_at, 'start time is absent')} · {recorded(a.speaker_name, 'speaker is absent')}</p><p>{recorded(a.location_text, 'room is absent')} {a.location_url && <a href={a.location_url} target="_blank" rel="noreferrer">Join</a>}</p><div className="evo-toolbar"><button disabled={busy || Boolean(search) || index === 0} onClick={() => move(index, -1)}>Move up</button><button disabled={busy || Boolean(search) || index === agenda.length - 1} onClick={() => move(index, 1)}>Move down</button><button disabled={busy} onClick={() => { setItem({ ...blankItem, ...a, starts_at: a.starts_at?.slice(0, 16) || '' }); setEditing(a.id); }}>Edit</button><button disabled={busy} onClick={() => act(() => events.deleteAgendaItem(id, a.id))}>Delete</button></div></article>; })}</EventReadState><Pager data={agendaPage} setPage={setPage} />
          <form onSubmit={e => { e.preventDefault(); const payload = { ...item, starts_at: item.starts_at ? new Date(item.starts_at).toISOString() : null, display_order: editing ? item.display_order : agenda.length }; act(async () => { if (editing) await events.updateAgendaItem(id, editing, payload); else await events.addAgendaItem(id, payload); setItem(blankItem); setEditing(null); }); }}><h2>{editing ? 'Edit item' : 'Add item'}</h2>{[['title', 'Title'], ['starts_at', 'Start time'], ['speaker_name', 'Speaker'], ['location_text', 'Room'], ['location_url', 'Link']].map(([key, label]) => <label key={key}>{label}<input required={key === 'title'} type={key === 'starts_at' ? 'datetime-local' : key === 'location_url' ? 'url' : 'text'} value={item[key] || ''} onChange={e => setItem(v => ({ ...v, [key]: e.target.value }))} /></label>)}<button className="evo-primary" disabled={busy}>Save item</button>{editing && <button type="button" onClick={() => { setEditing(null); setItem(blankItem); }}>Cancel edit</button>}</form></section>
          <section className="evo-card"><h2>Attendee preview</h2><EventReadState empty={agenda.length === 0}>{agenda.map(a => <article key={a.id} className="evo-agenda-row"><strong>{a.title}</strong><p>{recorded(a.starts_at, 'time is absent')} · {recorded(a.speaker_name, 'speaker is absent')}</p><p>{recorded(a.location_text, 'room is absent')}</p>{a.location_url && <a href={a.location_url} target="_blank" rel="noreferrer">Join</a>}</article>)}</EventReadState></section></div>}
      </EventReadState>
      {invite && <InvitePeopleModal eventId={id} audienceRules={rules} onClose={() => setInvite(false)} onInvited={load} />}
      {scanner && <CheckinScanner busy={busy} onDetect={code => act(() => events.checkin(id, code))} onClose={() => setScanner(false)} />}
    </div>
  </WorkspaceShell>;
}
