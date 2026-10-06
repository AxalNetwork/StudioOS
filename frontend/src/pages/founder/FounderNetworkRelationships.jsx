import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, RefreshCw, UsersRound } from 'lucide-react';
import { api } from '../../lib/api';
import { NOT_RECORDED, text, titleCase } from '../../lib/absence';
import { WorkerRail } from '../../ui';
import { STRENGTHS, daysSince, followUp, isCold, lastNote, organizationOf, strengthLabel } from '../../lib/networkBook';
import './founderNetworkRelationships.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const title = (value) => titleCase(value) || NOT_RECORDED;
/**
 * One contact's strength and organisation, edited in place (D551). Saves
 * through `PUT /api/contacts/:uid`, which only the contact's owner may call;
 * a failed save says so and keeps what was stored.
 */
/** What a save sends: a blank clears the value (null), never an empty string. */
export const profileBody = (strength, organization) => ({
  strength: strength || null,
  organization: String(organization || '').trim() || null,
});

export function ContactProfileEditor({ row, onSaved, save = (uid, body) => api.contactUpdate(uid, body) }) {
  const [strength, setStrength] = useState(row.strength || '');
  const [organization, setOrganization] = useState(organizationOf(row));
  const [state, setState] = useState('idle');
  const dirty = strength !== (row.strength || '') || organization.trim() !== organizationOf(row);
  const submit = async (event) => {
    event.preventDefault();
    setState('saving');
    try {
      const fresh = await save(row.uid, profileBody(strength, organization));
      setState('saved');
      onSaved?.(fresh);
    } catch {
      setState('failed');
    }
  };
  return <form className="fn-rel-edit" onSubmit={submit} data-testid={`form-contact-profile-${row.id || row.uid}`}>
    <select aria-label={`Strength for ${text(row.name, 'this contact')}`} value={strength} onChange={(e) => { setStrength(e.target.value); setState('idle'); }}>
      <option value="">Not recorded</option>
      {STRENGTHS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
    <input aria-label={`Organization for ${text(row.name, 'this contact')}`} value={organization} placeholder="Organization" maxLength={200}
      onChange={(e) => { setOrganization(e.target.value); setState('idle'); }} />
    <button type="submit" disabled={!dirty || state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save'}</button>
    {state === 'failed' ? <small className="is-cold" role="alert">Not saved. The stored values are unchanged.</small> : null}
    {state === 'saved' ? <small role="status">Saved</small> : null}
  </form>;
}

const lastTouch = (value) => {
  const days = daysSince(value);
  if (days === null) return 'Not recorded';
  if (days === 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/**
 * `embedded`: `workspaces/NetworkWorkspace` mounts this page inside
 * `workspaces/WorkspaceShell`, which already draws the crumb, the h1, the zone
 * pill row and the Worker AI rail. This page draws all four of its own, so
 * without this prop a founder on /network/relationships saw two of every piece
 * of chrome — two crumbs, two headings, two pill rows and two rails, each pair
 * saying something different. The advisor and investor arms of that workspace
 * have had this seam since #391 and #399; the founder arm never got it.
 *
 * It suppresses the page's own header and rail and drops the two-column grid
 * (`.fn-rel.is-embedded` in founderNetworkRelationships.css) — the shell owns
 * both columns now, and the page's `min-height:100vh` would otherwise stretch
 * a short zone the full viewport inside a container that is already full.
 */
export default function FounderNetworkRelationships({ embedded = false, role = 'founder', zoneFilters = null }) {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [project, setProject] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter] = useState('everyone');
  const [status, setStatus] = useState('loading');
  const [errors, setErrors] = useState([]);

  const load = async () => {
    setStatus('loading'); setErrors([]);
    const [projectResult, contactResult] = await Promise.allSettled([api.listProjects(), api.contactsList()]);
    const available = projectResult.status === 'fulfilled' ? list(projectResult.value, 'items', 'projects') : [];
    const requested = Number(requestedId);
    const chosen = available.find((item) => Number(item.id) === requested) || available[0] || (requestedId ? { id: requested, name: 'Selected startup' } : null);
    setProject(chosen);
    if (chosen && String(chosen.id) !== requestedId) {
      setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(chosen.id)); return next; }, { replace: true });
    }
    const all = contactResult.status === 'fulfilled' ? list(contactResult.value, 'items', 'contacts') : [];
    setContacts(chosen ? all.filter((row) => row.project_id != null && String(row.project_id) === String(chosen.id)) : []);
    const failed = [];
    if (projectResult.status === 'rejected') failed.push('startup list');
    if (contactResult.status === 'rejected') failed.push('relationship contacts');
    setErrors(failed);
    setStatus(chosen ? 'ready' : failed.length ? 'error' : 'empty');
  };
  useEffect(() => { load(); }, [requestedId]);

  const visible = useMemo(() => contacts.filter((row) => {
    const audience = String(row.audience || '').toLowerCase();
    if (filter === 'investors') return audience === 'investor';
    if (filter === 'advisors') return audience === 'advisor' || audience === 'mentor';
    if (filter === 'cold') return isCold(row);
    return true;
  }), [contacts, filter]);
  const cold = contacts.filter(isCold);
  const knownTypes = new Set(contacts.map((row) => row.audience).filter(Boolean));
  const query = project?.id ? `?project_id=${project.id}` : '';

  return <main className={`fn-rel${embedded ? ' is-embedded' : ''}`} data-testid="founder-network-relationships"><div className="fn-rel-shell"><section className="fn-rel-main">
    {!embedded && <header className="fn-rel-header"><div className="fn-rel-crumb"><Link to={`/network${query}`}><ArrowLeft size={13} /> Network</Link><span>‹</span><strong>Relationships</strong></div><div className="fn-rel-title-row"><div><h1>Relationship book</h1><p>Project-linked contacts, relationship context and explicit last activity.</p></div></div><nav aria-label="Network sections"><Link className="is-active" to={`/network/relationships${query}`}>Relationships</Link><Link to={`/network/introductions${query}`}>Introductions</Link><Link to={`/network/organizations${query}`}>Organizations</Link></nav></header>}
    {/* Outside the header on purpose. These three zones only ever render
        through NetworkWorkspace, which passes `embedded` and draws the crumb,
        heading and zone nav itself — so everything inside that guard is dead
        on the route a founder actually opens. The actions row placed in there
        rendered nowhere, which a source test cannot see and a browser found. */}
    <ZoneToolbar
      className="mt-3"
      role={role}
      filters={zoneFilters ? zoneFilters({ value: filter, onChange: setFilter }) : []}
      actions={founderZoneActions('network/relationships', { query, view: { scope: project?.name, header: ['Person', 'Email', 'Context', 'Type', 'Last activity'], rows: visible, cells: (r) => [r.name, r.email, r.landing_page_name || r.source, r.audience, r.last_activity_at] } })}
    />
    {errors.length > 0 && <div className="fn-rel-alert" data-testid="status-network-relationships-partial"><AlertCircle size={15} /><span>{`Some selected-project sources are unavailable: ${errors.join(', ')}.`}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {status === 'loading' && <RelationshipSkeleton />}
    {status === 'empty' && <NoProject />}
    {status === 'error' && !project && <NoProject error />}
    {status === 'ready' && project && <><div className="fn-rel-context"><div><span>Selected startup</span><strong data-testid="text-network-relationships-project">{text(project.name)}</strong><small>{text(project.sector, 'Sector not recorded')}</small></div><div><span>Source</span><strong>Project-linked authorized contacts</strong><small>Strength and organization as you set them; follow-ups from each contact's tasks</small></div></div>
      {/* THE FOUR CHIPS MOVED UP INTO THE ZONE HEADER ROW, which is where the
          canvas draws them and where the ops half already sat. Same four
          labels, same four predicates, one row instead of two. What stays here
          is the link out, which is navigation rather than a view. */}
      <div className="fn-rel-tabs"><Link data-testid="link-open-network-relationships-workspace" to={`/network?mode=workspace&tab=contacts&project_id=${project.id}`}>Open contacts <ChevronRight size={13} /></Link></div>
      <div className="fn-rel-stats"><Stat label="In the book" value={contacts.length} note={`${knownTypes.size} recorded type${knownTypes.size === 1 ? '' : 's'}`} /><Stat label="Strong" value={contacts.filter((row) => row.strength === 'strong').length} note={`${contacts.filter((row) => !row.strength).length} not scored`} muted={!contacts.some((row) => row.strength === 'strong')} /><Stat label="Going cold" value={cold.length} note="Past 60 days of explicit activity" /><Stat label="Coldest" value={cold.length ? `${Math.max(...cold.map((row) => daysSince(row.last_activity_at)))} d` : 'Unavailable'} note={cold.length ? 'From stored last activity' : 'No cold relationship recorded'} muted={!cold.length} /></div>
      <section className="fn-rel-card"><div className="fn-rel-card-head"><div><UsersRound size={16} /><h2>The book</h2></div><span>Cold flag uses explicit last activity only</span></div><RelationshipTable rows={visible} onSaved={(fresh) => setContacts((all) => all.map((row) => (row.uid === fresh?.uid ? { ...row, ...fresh } : row)))} /><p className="fn-rel-note">Contact status is not relationship strength. A contact is flagged going cold when `last_activity_at` is more than 60 days old — and that column is stamped when the contact is created, so a record nobody has touched ages into this set on its 61st day. The flag is honest about the column it reads; the column does not yet distinguish a touch from an arrival.</p></section>
      <section className="fn-rel-card fn-rel-unavailable"><div className="fn-rel-card-head"><div><AlertCircle size={16} /><h2>What the book records</h2></div><span>Set by you</span></div><strong>Strength and organization are what you set on a contact; follow-ups and the last note come from its tasks and replies.</strong><p>None of them is derived from email domains, lead status, landing pages, or contact age. A contact nobody has scored reads Not recorded.</p></section>
    </>}
  </section>{!embedded && <RelationshipRail project={project} contacts={contacts} cold={cold} errors={errors} />}</div></main>;
}

export function RelationshipTable({ rows, onSaved, save }) {
  if (!rows.length) return <div className="fn-rel-empty"><UsersRound size={18} /><div><strong>No matching project-linked contacts are recorded.</strong><p>This filter contains no stored relationship records.</p></div></div>;
  return <div className="fn-rel-table-wrap"><table><thead><tr><th>Person</th><th>Context</th><th>Type</th><th>Strength</th><th>Last touch</th><th>Follow-up</th><th>Last note</th><th>Edit</th></tr></thead><tbody>{rows.map((row, index) => {
    const due = followUp(row);
    return <tr key={row.id || row.uid || index} data-testid={`row-network-relationship-${row.id || index}`}><td><strong>{text(row.name, text(row.email, 'Name not recorded'))}</strong><small>{organizationOf(row) || (row.name && row.email ? row.email : 'Authorized contact')}</small></td><td>{text(row.landing_page_name, text(row.source, 'Context not recorded'))}</td><td>{title(row.audience)}</td><td>{strengthLabel(row)}</td><td><span className={isCold(row) ? 'is-cold' : ''}>{lastTouch(row.last_activity_at)}{isCold(row) ? ' · going cold' : ''}</span></td><td><span className={due.state === 'overdue' ? 'is-cold' : ''}>{due.text}</span></td><td>{lastNote(row)}</td><td><ContactProfileEditor row={row} onSaved={onSaved} {...(save ? { save } : {})} /></td></tr>;
  })}</tbody></table></div>;
}
function Stat({ label, value, note, muted }) { return <div className={muted ? 'is-muted' : ''}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function RelationshipRail({ project, contacts, cold, errors }) {
  return <WorkerRail
    workspace="Network"
    className="fn-rel-rail"
    stance="Read-only relationship coverage"
    note="This view does not draft outreach, set reminders, add people, export contacts, or change records."
    coverage={[project ? text(project.name) : 'No project selected']}
    coverageNote={errors.includes('relationship contacts') ? 'Contact source unavailable.' : `${contacts.length} project-linked contact${contacts.length === 1 ? '' : 's'} · ${cold.length} going cold.`}
    unavailable={[['Re-engagement lines', 'Drafted on the Network desk, from the replies a contact has logged.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function RelationshipSkeleton() { return <div className="fn-rel-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }
function NoProject({ error }) { return <div className="fn-rel-no-project"><UsersRound size={22} /><h2>{error ? 'Startup source unavailable' : 'No startup is available'}</h2><p>Relationships are scoped to an authenticated startup and its stored contacts.</p><Link to="/network">Back to Network</Link></div>; }