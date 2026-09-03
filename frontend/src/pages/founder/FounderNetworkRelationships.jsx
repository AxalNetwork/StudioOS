import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, RefreshCw, UsersRound } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderNetworkRelationships.css';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const title = (value) => text(value).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const daysSince = (value) => {
  if (!value) return null;
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, Math.floor((Date.now() - stamp) / 86400000));
};
const lastTouch = (value) => {
  const days = daysSince(value);
  if (days === null) return 'Not recorded';
  if (days === 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
};
const isCold = (row) => {
  const days = daysSince(row.last_activity_at);
  return days !== null && days > 60;
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
export default function FounderNetworkRelationships({ embedded = false }) {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
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
    {!embedded && <header className="fn-rel-header"><div className="fn-rel-crumb"><Link to={`/network${query}`}><ArrowLeft size={13} /> Network</Link><span>‹</span><strong>Relationships</strong></div><div className="fn-rel-title-row"><div><h1>Relationship book</h1><p>Project-linked contacts, relationship context and explicit last activity.</p></div>{projects.length > 1 && <label><span>Startup</span><select data-testid="select-network-relationships-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div><nav aria-label="Network sections"><Link className="is-active" to={`/network/relationships${query}`}>Relationships</Link><Link to={`/network/introductions${query}`}>Introductions</Link><Link to={`/network/organizations${query}`}>Organizations</Link></nav></header>}
    {errors.length > 0 && <div className="fn-rel-alert" data-testid="status-network-relationships-partial"><AlertCircle size={15} /><span>{`Some selected-project sources are unavailable: ${errors.join(', ')}.`}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {status === 'loading' && <RelationshipSkeleton />}
    {status === 'empty' && <NoProject />}
    {status === 'error' && !project && <NoProject error />}
    {status === 'ready' && project && <><div className="fn-rel-context"><div><span>Selected startup</span><strong data-testid="text-network-relationships-project">{text(project.name)}</strong><small>{text(project.sector, 'Sector not recorded')}</small></div><div><span>Source</span><strong>Project-linked authorized contacts</strong><small>Strength, notes and reminders are not exposed</small></div></div>
      <div className="fn-rel-tabs"><div><button className={filter === 'everyone' ? 'is-active' : ''} onClick={() => setFilter('everyone')}>Everyone</button><button className={filter === 'investors' ? 'is-active' : ''} onClick={() => setFilter('investors')}>Investors</button><button className={filter === 'advisors' ? 'is-active' : ''} onClick={() => setFilter('advisors')}>Advisors</button><button className={filter === 'cold' ? 'is-active' : ''} onClick={() => setFilter('cold')}>Going cold</button></div><Link data-testid="link-open-network-relationships-workspace" to={`/network?mode=workspace&tab=contacts&project_id=${project.id}`}>Open contacts <ChevronRight size={13} /></Link></div>
      <div className="fn-rel-stats"><Stat label="In the book" value={contacts.length} note={`${knownTypes.size} recorded type${knownTypes.size === 1 ? '' : 's'}`} /><Stat label="Strong" value="Unavailable" note="No relationship strength source" muted /><Stat label="Going cold" value={cold.length} note="Past 60 days of explicit activity" /><Stat label="Coldest" value={cold.length ? `${Math.max(...cold.map((row) => daysSince(row.last_activity_at)))} d` : 'Unavailable'} note={cold.length ? 'From stored last activity' : 'No cold relationship recorded'} muted={!cold.length} /></div>
      <section className="fn-rel-card"><div className="fn-rel-card-head"><div><UsersRound size={16} /><h2>The book</h2></div><span>Cold flag uses explicit last activity only</span></div><RelationshipTable rows={visible} /><p className="fn-rel-note">Contact status is not relationship strength. A contact is flagged going cold only when `last_activity_at` is stored and more than 60 days old; creation or signup age is never substituted for a touch.</p></section>
      <section className="fn-rel-card fn-rel-unavailable"><div className="fn-rel-card-head"><div><AlertCircle size={16} /><h2>Relationship intelligence</h2></div><span>Unavailable</span></div><strong>No project-scoped relationship history is connected.</strong><p>Notes, reminders, organization membership, strength scoring, and message context require a dedicated relationship-book source. FN1 does not derive them from email domains, lead status, landing pages, or contact age.</p></section>
    </>}
  </section>{!embedded && <RelationshipRail project={project} contacts={contacts} cold={cold} errors={errors} />}</div></main>;
}

function RelationshipTable({ rows }) {
  if (!rows.length) return <div className="fn-rel-empty"><UsersRound size={18} /><div><strong>No matching project-linked contacts are recorded.</strong><p>This filter contains no stored relationship records.</p></div></div>;
  return <div className="fn-rel-table-wrap"><table><thead><tr><th>Person</th><th>Context</th><th>Type</th><th>State</th><th>Last touch</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || row.uid || index} data-testid={`row-network-relationship-${row.id || index}`}><td><strong>{text(row.name, text(row.email, 'Name not recorded'))}</strong><small>{row.name && row.email ? row.email : 'Authorized contact'}</small></td><td>{text(row.landing_page_name, text(row.source, 'Context not recorded'))}</td><td>{title(row.audience, 'Type not recorded')}</td><td><span className={isCold(row) ? 'is-cold' : ''}>{isCold(row) ? 'Going cold' : 'Not scored'}</span></td><td>{lastTouch(row.last_activity_at)}</td></tr>)}</tbody></table></div>;
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
    unavailable={[['Re-engagement lines', 'No message or discussion history is connected.'], ['Strength and reminders', 'No project-scoped relationship-book source exposes them.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function RelationshipSkeleton() { return <div className="fn-rel-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }
function NoProject({ error }) { return <div className="fn-rel-no-project"><UsersRound size={22} /><h2>{error ? 'Startup source unavailable' : 'No startup is available'}</h2><p>Relationships are scoped to an authenticated startup and its stored contacts.</p><Link to="/network">Back to Network</Link></div>; }