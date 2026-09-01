import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, RefreshCw, Sparkles, UsersRound } from 'lucide-react';
import { api } from '../../lib/api';
import './founderNetworkRelationships.css';
import './founderNetworkOrganizations.css';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const daysSince = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 86400000)) : null;
};
const organization = (row) => text(row.organization || row.company || row.firm, '');
const isDormant = (people) => people.length > 0 && people.every((row) => {
  const days = daysSince(row.last_activity_at);
  return days !== null && days > 60;
});
const freshest = (people) => {
  const values = people.map((row) => daysSince(row.last_activity_at)).filter((value) => value !== null);
  return values.length ? `${Math.min(...values)} day${Math.min(...values) === 1 ? '' : 's'} ago` : 'Unavailable';
};

export default function FounderNetworkOrganizations() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState('loading');
  const [errors, setErrors] = useState([]);

  const load = async () => {
    setStatus('loading'); setErrors([]);
    const [projectResult, contactResult] = await Promise.allSettled([api.listProjects(), api.contactsList()]);
    const available = projectResult.status === 'fulfilled' ? list(projectResult.value, 'items', 'projects') : [];
    const chosen = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected startup' } : null);
    setProjects(available.length ? available : chosen ? [chosen] : []);
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

  const groups = useMemo(() => {
    const map = new Map();
    contacts.forEach((row) => {
      const name = organization(row);
      if (!name) return;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(row);
    });
    return [...map.entries()].map(([name, people]) => ({ name, people, types: [...new Set(people.map((row) => row.audience).filter(Boolean))] })).sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts]);
  const visible = groups.filter((group) => {
    if (filter === 'funds') return group.types.includes('investor');
    if (filter === 'customers') return group.types.includes('customer');
    if (filter === 'dormant') return isDormant(group.people);
    return true;
  });
  const mapped = contacts.filter((row) => organization(row));
  const dualRole = groups.filter((group) => group.types.length > 1);
  const dormant = groups.filter((group) => isDormant(group.people));
  const contactsUnavailable = errors.includes('relationship contacts');
  const query = project?.id ? `?project_id=${project.id}` : '';

  return <main className="fn-rel fn-org" data-testid="founder-network-organizations"><div className="fn-rel-shell"><section className="fn-rel-main">
    <header className="fn-rel-header"><div className="fn-rel-crumb"><Link to={`/network${query}`}><ArrowLeft size={13} /> Network</Link><span>‹</span><strong>Organizations</strong></div><div className="fn-rel-title-row"><div><h1>Organizations</h1><p>Organization profiles, people and history from the relationship book.</p></div>{projects.length > 1 && <label><span>Startup</span><select data-testid="select-network-organizations-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div><nav aria-label="Network sections"><Link to={`/network/relationships${query}`}>Relationships</Link><Link to={`/network/introductions${query}`}>Introductions</Link><Link className="is-active" to={`/network/organizations${query}`}>Organizations</Link></nav></header>
    {errors.length > 0 && <div className="fn-rel-alert" data-testid="status-network-organizations-partial"><AlertCircle size={15} /><span>{`Some selected-project sources are unavailable: ${errors.join(', ')}.`}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {status === 'loading' && <OrganizationSkeleton />}
    {status === 'empty' && <NoProject />}
    {status === 'error' && !project && <NoProject error />}
    {status === 'ready' && project && <><div className="fn-rel-context"><div><span>Selected startup</span><strong data-testid="text-network-organizations-project">{text(project.name)}</strong><small>{text(project.sector, 'Sector not recorded')}</small></div><div><span>Source</span><strong>Relationship book lens</strong><small>Only explicit organization fields are grouped</small></div></div>
      <div className="fn-rel-tabs"><div><button className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All</button><button className={filter === 'funds' ? 'is-active' : ''} onClick={() => setFilter('funds')}>Funds</button><button className={filter === 'customers' ? 'is-active' : ''} onClick={() => setFilter('customers')}>Customers</button><button className={filter === 'dormant' ? 'is-active' : ''} onClick={() => setFilter('dormant')}>Dormant</button></div><Link data-testid="link-open-network-organizations-relationships" to={`/network/relationships${query}`}>View relationship book <ChevronRight size={13} /></Link></div>
      <div className="fn-rel-stats"><Stat label="Organizations" value={contactsUnavailable ? 'Unavailable' : groups.length} note={contactsUnavailable ? 'Relationship book source unavailable' : groups.length ? 'Explicit organization fields' : 'No organization fields returned'} muted={contactsUnavailable} /><Stat label="People mapped" value={contactsUnavailable ? 'Unavailable' : mapped.length} note={contactsUnavailable ? 'Relationship book source unavailable' : `of ${contacts.length} in the book`} muted={contactsUnavailable} /><Stat label="Dual-role orgs" value={contactsUnavailable ? 'Unavailable' : dualRole.length} note={contactsUnavailable ? 'Relationship book source unavailable' : dualRole.length ? 'Multiple recorded contact types' : 'No dual-role grouping recorded'} muted={contactsUnavailable || !dualRole.length} /><Stat label="Unmapped people" value={contactsUnavailable ? 'Unavailable' : contacts.length - mapped.length} note={contactsUnavailable ? 'Relationship book source unavailable' : contacts.length - mapped.length ? 'No organization on file' : 'All people mapped'} muted={contactsUnavailable || contacts.length - mapped.length > 0} /></div>
      <section className="fn-rel-card"><div className="fn-rel-card-head"><div><UsersRound size={16} /><h2>Organizations</h2></div><span>People counts read from the relationship book</span></div>{contactsUnavailable ? <div className="fn-rel-empty"><AlertCircle size={18} /><div><strong>Organization collection unavailable.</strong><p>The project relationship-book source could not be read, so FN3 does not present an empty collection as fact.</p></div></div> : <OrganizationTable groups={visible} filter={filter} />}<p className="fn-rel-note">Organizations are a lens over stored people, not a second address book. FN3 does not infer membership from email domains, landing pages, source labels, or similar names.</p></section>
      <section className="fn-rel-card fn-rel-unavailable"><div className="fn-rel-card-head"><div><AlertCircle size={16} /><h2>Organization intelligence</h2></div><span>Partially unavailable</span></div><strong>{groups.length ? 'Profiles and history are not recorded for these groups.' : 'No relationship-backed organization rollup is available.'}</strong><p>Profiles, organization history, duplicate review, and merge actions require explicit organization records. This read-only collection does not create or merge them.</p></section>
    </>}
  </section><OrganizationRail project={project} contacts={contacts} groups={groups} dormant={dormant} errors={errors} /></div></main>;
}

function OrganizationTable({ groups, filter }) {
  if (!groups.length) return <div className="fn-rel-empty"><UsersRound size={18} /><div><strong>{filter === 'all' ? 'No explicit organizations are recorded.' : `No ${filter} organizations are recorded.`}</strong><p>People without an organization remain in the relationship book and are not placed into an inferred row.</p></div></div>;
  return <div className="fn-rel-table-wrap"><table><thead><tr><th>Organization</th><th>People</th><th>Freshest contact</th><th>Recorded types</th></tr></thead><tbody>{groups.map((group) => <tr key={group.name} data-testid={`row-network-organization-${group.name}`}><td><strong>{group.name}</strong><small>{group.people.length} relationship book record{group.people.length === 1 ? '' : 's'}</small></td><td>{group.people.length}</td><td>{freshest(group.people)}</td><td>{group.types.length ? group.types.map((type) => text(type).replace(/[_-]/g, ' ')).join(' + ') : 'Not recorded'}</td></tr>)}</tbody></table></div>;
}
function Stat({ label, value, note, muted }) { return <div className={muted ? 'is-muted' : ''}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function OrganizationRail({ project, contacts, groups, dormant, errors }) { return <aside className="fn-rel-rail"><div className="fn-rel-rail-head"><span>Worker AI · Network</span><Sparkles size={14} /></div><div className="fn-rel-callout"><b>Read-only organization lens</b><p>This view does not add organizations, merge duplicates, save profiles, export contacts, or write history.</p></div><div><span>Record coverage</span><strong>{project ? `${groups.length} explicit organization${groups.length === 1 ? '' : 's'}` : 'No project selected'}</strong><p>{errors.includes('relationship contacts') ? 'Contact source unavailable.' : `${contacts.length} people · ${dormant.length} dormant group${dormant.length === 1 ? '' : 's'}.`}</p></div><div className="fn-rel-rail-muted"><span>Unavailable here</span><strong>Organization profiles</strong><p>No explicit profile or history source is connected.</p><strong>Duplicate merging</strong><p>Names are not normalized or merged automatically.</p></div><footer>Read-only summary · no automated actions</footer></aside>; }
function OrganizationSkeleton() { return <div className="fn-rel-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }
function NoProject({ error }) { return <div className="fn-rel-no-project"><UsersRound size={22} /><h2>{error ? 'Startup source unavailable' : 'No startup is available'}</h2><p>Organizations are scoped to an authenticated startup and its stored relationship book.</p><Link to="/network">Back to Network</Link></div>; }