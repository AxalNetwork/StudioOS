import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, Eye, FileText, Filter, FolderOpen, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { api } from '../../lib/api';
import './founderRaiseCapital.css';
import './founderRaiseDataRoom.css';

const asList = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const clean = (value) => String(value ?? '').trim();
const display = (value, fallback = 'Not recorded') => clean(value) || fallback;
const formatDate = (value) => {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const grantIsActive = (grant) => clean(grant.status).toLowerCase() === 'active'
  && (!grant.expires_at || new Date(grant.expires_at).getTime() > Date.now());
const fileAccess = (file, grant) => {
  if (!grantIsActive(grant)) return { label: 'None', tone: 'neutral' };
  if (file.visibility === 'nda' && !grant.nda_signed) return { label: 'NDA gated', tone: 'warn' };
  return { label: 'Granted', tone: 'good' };
};

export default function FounderRaiseDataRoom() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(Number(requestedId) || null);
  const [room, setRoom] = useState(null);
  const [projectError, setProjectError] = useState('');
  const [roomError, setRoomError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('matrix');
  const lastAutoLoad = useRef(null);

  const load = async () => {
    setLoading(true);
    setProjectError('');
    setRoomError('');
    try {
      const available = asList(await api.listProjects(), 'items', 'projects');
      const requested = Number(requestedId);
      const selected = available.find((item) => Number(item.id) === requested) || available[0];
      setProjects(available);
      setProjectId(selected?.id || null);
      if (!selected) {
        setRoom(null);
        return;
      }
      if (String(selected.id) !== requestedId) {
        setParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(selected.id));
          return next;
        }, { replace: true });
      }
      if (!selected.uid) {
        setRoom(null);
        setRoomError('The selected startup has no data-room identifier.');
        return;
      }
      try {
        setRoom(await api.dataRoom(selected.uid));
      } catch (cause) {
        setRoom(null);
        setRoomError(cause?.message || 'The data-room source is unavailable.');
      }
    } catch (cause) {
      setProjectError(cause?.message || 'The project list is unavailable.');
      setRoom(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const key = requestedId || 'default';
    if (lastAutoLoad.current === key) return;
    lastAutoLoad.current = key;
    load();
  }, [requestedId]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const files = asList(room?.files);
  const folders = asList(room?.folders);
  const grants = asList(room?.grants);
  const access = asList(room?.recent_access);
  const activeGrants = grants.filter(grantIsActive);
  const fileActivity = access.filter((event) => event.file_name);
  const mostViewed = useMemo(() => {
    const counts = new Map();
    fileActivity.forEach((event) => counts.set(event.file_name, (counts.get(event.file_name) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  }, [fileActivity]);
  const query = projectId ? `?project_id=${projectId}` : '';

  const chooseProject = (value) => {
    const id = Number(value);
    setProjectId(id);
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set('project_id', String(id));
      return next;
    }, { replace: true });
  };

  return <main className="fr-capital" data-testid="founder-raise-data-room">
    <div className="fr-capital-shell">
      <section className="fr-capital-main">
        <header className="fr-capital-header">
          <div className="fr-capital-crumb"><Link to={`/raise/status${query}`} data-testid="link-data-room-back"><ArrowLeft size={13} /> Raise</Link><span>/</span><strong>Data room</strong></div>
          <div className="fr-capital-title-row"><div><p className="fr-capital-kicker">Founder / Raise</p><h1>Data room</h1><p className="fr-capital-subtitle">Permission matrix, per-investor grants, view analytics and gap analysis.</p></div>{projects.length > 1 && <label className="fr-capital-picker"><span>Startup</span><select data-testid="select-data-room-project" value={projectId || ''} onChange={(event) => chooseProject(event.target.value)}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
          <nav className="fr-capital-zone-nav" aria-label="Raise sections"><Link to={`/raise/status${query}`}>Status</Link><Link to={`/raise/pitch${query}`}>Pitch</Link><Link to={`/raise/capital${query}`}>Capital</Link><Link to={`/raise/legal${query}`}>Legal</Link><Link to={`/raise/data-room${query}`} className="is-active" data-testid="link-data-room-zone">Data room</Link><span className="fr-capital-zone-disabled">Liquidity unavailable</span></nav>
        </header>
        {(projectError || roomError) && <div className="fr-capital-alert" role="alert" data-testid="status-data-room-partial"><AlertCircle size={16} /><span>{projectError || roomError}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
        {loading ? <RoomSkeleton /> : projectError ? <UnavailableRoom onRetry={load} /> : !project ? <EmptyRoom /> : <RoomContent project={project} files={files} folders={folders} grants={grants} activeGrants={activeGrants} access={access} fileActivity={fileActivity} mostViewed={mostViewed} roomError={roomError} view={view} setView={setView} query={query} />}
      </section>
      <WorkerRail project={project} files={files} grants={activeGrants} fileActivity={fileActivity} roomError={roomError} />
    </div>
  </main>;
}

function RoomContent({ project, files, folders, grants, activeGrants, access, fileActivity, mostViewed, roomError, view, setView, query }) {
  return <div className="fr-capital-content">
    <div className="fr-capital-context"><div><span className="fr-capital-label">Selected startup</span><strong data-testid="text-data-room-project">{display(project.name)}</strong><span>{display(project.sector, 'Sector not recorded')}</span></div><div className="fr-capital-context-right"><span className="fr-capital-label">Room source</span><strong>{roomError ? 'Data-room source unavailable' : display(project.uid, 'Identifier unavailable')}</strong><span>{roomError ? 'No room records inferred' : 'Project-scoped Worker room'}</span></div></div>
    <div className="fr-capital-stat-strip"><RoomStat label="Staged" value={roomError ? 'Unavailable' : files.length} note={roomError ? 'Room source unavailable' : `${folders.length} folders · expected set unavailable`} muted={Boolean(roomError)} /><RoomStat label="Investors granted" value={roomError ? 'Unavailable' : activeGrants.length} note={roomError ? 'Room source unavailable' : `${grants.length - activeGrants.length} inactive or expired`} muted={Boolean(roomError)} /><RoomStat label="Items viewed" value={roomError ? 'Unavailable' : fileActivity.length} note={roomError ? 'Room source unavailable' : `from ${access.length} recent access events`} muted={Boolean(roomError)} /><RoomStat label="Most viewed" value={roomError ? 'Unavailable' : (mostViewed?.[0] || 'Not recorded')} note={roomError ? 'Room source unavailable' : (mostViewed ? `${mostViewed[1]} logged event${mostViewed[1] === 1 ? '' : 's'}` : 'No file activity returned')} muted={Boolean(roomError) || !mostViewed} /></div>
    <section className="fr-capital-card fr-capital-ledger"><div className="fr-capital-card-head"><div><FolderOpen size={16} /><h2>{view === 'investors' ? 'Investor grants' : view === 'gaps' ? 'Gap coverage' : 'Permission matrix'}</h2></div><span>{view === 'matrix' ? 'File × investor · derived from room grants and NDA state' : 'Read-only source view'}</span></div><div className="fr-capital-toolbar"><div className="fr-capital-filters"><Filter size={13} />{[['matrix', 'Matrix'], ['artifacts', 'By artifact'], ['investors', 'By investor'], ['gaps', 'Gaps']].map(([key, label]) => <button type="button" key={key} className={view === key ? 'is-selected' : ''} onClick={() => setView(key)}>{label}</button>)}</div><div className="fr-capital-actions"><span><ShieldCheck size={13} /> Read-only permissions</span><Link to={`/raise/data-room?mode=workspace${project.id ? `&project_id=${project.id}` : ''}`} data-testid="link-open-data-room-workspace"><FolderOpen size={13} /> Open workspace</Link></div></div>
      {view === 'investors' ? <InvestorList grants={grants} /> : view === 'gaps' ? <GapState roomError={roomError} /> : <PermissionTable files={files} grants={activeGrants} artifactOnly={view === 'artifacts'} roomError={roomError} />}
      <p className="fr-capital-note">Access is room-wide for open files. NDA-marked files require both an active room grant and a live pairwise NDA. FR5 does not claim independent per-file grants because the source does not store them.</p>
    </section>
    <div className="fr-capital-lower-grid"><section className="fr-capital-card"><div className="fr-capital-card-head"><div><Eye size={16} /><h2>Recent access</h2></div><span>{roomError ? 'Source unavailable' : `${access.length} events`}</span></div>{access.length ? access.slice(0, 6).map((event, index) => <div className="fr-capital-coverage-row" key={`${event.created_at}-${index}`}><span>{display(event.file_name, prettyAction(event.action))}</span><strong>{prettyAction(event.action)} · {formatDate(event.created_at)}</strong></div>) : <div className="fr-capital-unavailable"><Eye size={17} /><div><strong>{roomError ? 'Access-log source unavailable.' : 'No recent access is recorded.'}</strong><p>FR5 does not interpret an empty log as confirmed zero lifetime views.</p></div></div>}</section><section className="fr-capital-card"><div className="fr-capital-card-head"><div><Users size={16} /><h2>Grant coverage</h2></div><span>Room-level</span></div><Coverage label="Active grants" value={roomError ? 'Unavailable' : activeGrants.length} /><Coverage label="NDA-cleared grants" value={roomError ? 'Unavailable' : activeGrants.filter((grant) => grant.nda_signed).length} /><Coverage label="NDA files" value={roomError ? 'Unavailable' : files.filter((file) => file.visibility === 'nda').length} /><p className="fr-capital-note">Use the detailed workspace to grant, revoke, upload, or change visibility. This collection performs no writes.</p></section></div>
    <section className="fr-capital-card fr-capital-waterfall"><div className="fr-capital-card-head"><div><Sparkles size={16} /><h2>Gap analysis</h2></div><span>Unavailable</span></div><div className="fr-capital-unavailable"><Sparkles size={17} /><div><strong>No expected-artifact checklist is connected.</strong><p>The room source returns files, grants, and recent access—not stage-specific requirements or investor requests—so FR5 does not generate placeholders or name missing diligence items.</p></div></div><p className="fr-capital-note">No create-placeholder, accept, edit, discard, export-log, grant, or revoke action is enabled here.</p></section>
  </div>;
}

function PermissionTable({ files, grants, artifactOnly, roomError }) {
  if (!files.length) return <div className="fr-capital-inline-empty"><FileText size={18} /><div><strong>{roomError ? 'Data-room source unavailable.' : 'No files are staged.'}</strong><p>Only files returned for the selected startup appear in this matrix.</p></div></div>;
  return <div className="fr-capital-table-wrap"><table className="fr-room-matrix"><thead><tr><th>Artifact</th>{!artifactOnly && grants.slice(0, 4).map((grant) => <th key={grant.uid}>{display(grant.investor_name || grant.investor_email, 'Investor')}</th>)}<th>Visibility</th></tr></thead><tbody>{files.map((file, index) => <tr key={file.uid || index} data-testid={`row-data-room-file-${file.uid || index}`}><td><strong>{display(file.name, 'Untitled file')}</strong><small>{display(file.content_type, 'Type not recorded')}</small></td>{!artifactOnly && grants.slice(0, 4).map((grant) => { const state = fileAccess(file, grant); return <td key={grant.uid}><span className={`fr-room-pill is-${state.tone}`}>{state.label}</span></td>; })}<td><span className={`fr-room-pill ${file.visibility === 'nda' ? 'is-warn' : 'is-neutral'}`}>{file.visibility === 'nda' ? 'NDA required' : 'Open to invited'}</span></td></tr>)}</tbody></table>{!artifactOnly && grants.length > 4 && <p className="fr-room-overflow-note">{grants.length - 4} more active grants are available in the workspace.</p>}</div>;
}
function InvestorList({ grants }) { return grants.length ? <div className="fr-room-investors">{grants.map((grant) => <div key={grant.uid}><div><strong>{display(grant.investor_name || grant.investor_email, 'Investor')}</strong><span>{grant.nda_signed ? 'Pairwise NDA active' : 'NDA not recorded'}</span></div><span className={`fr-room-pill ${grantIsActive(grant) ? 'is-good' : 'is-neutral'}`}>{grantIsActive(grant) ? 'Active' : prettyAction(grant.status)}</span></div>)}</div> : <div className="fr-capital-inline-empty"><Users size={18} /><div><strong>No investor grants are recorded.</strong><p>Room access appears here only after the source returns a grant.</p></div></div>; }
function GapState({ roomError }) { return <div className="fr-capital-inline-empty"><Sparkles size={18} /><div><strong>{roomError ? 'Room source unavailable.' : 'Expected-artifact coverage is unavailable.'}</strong><p>No stage checklist, investor request log, or gap-analysis source is returned by this API.</p></div></div>; }
function prettyAction(value) { return display(value).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function RoomStat({ label, value, note, muted }) { return <div className={`fr-capital-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function Coverage({ label, value }) { return <div className="fr-capital-coverage-row"><span>{label}</span><strong>{value}</strong></div>; }
function WorkerRail({ project, files, grants, fileActivity, roomError }) { return <aside className="fr-capital-rail"><div className="fr-capital-rail-heading"><span>Worker AI · Raise</span><Sparkles size={14} /></div><div className="fr-capital-rail-callout"><b>Manual room collection</b><p>This page reads project files, room grants, NDA state, and recent access. It does not share, revoke, upload, or create gaps.</p></div><div className="fr-capital-rail-block"><span className="fr-capital-label">Record coverage</span><strong>{project ? `${files.length} staged file${files.length === 1 ? '' : 's'}` : 'No project selected'}</strong><p>{project ? (roomError ? 'The room source is unavailable.' : `${grants.length} active grant${grants.length === 1 ? '' : 's'} · ${fileActivity.length} recent file event${fileActivity.length === 1 ? '' : 's'}`) : 'Select a startup to read its data room.'}</p></div><div className="fr-capital-rail-block fr-capital-rail-muted"><span>Unavailable here</span><strong>Stage gap analysis</strong><p>No expected-artifact or investor-request source is connected.</p><strong>AI placeholder proposal</strong><p>No generate, accept, or mutation action is enabled.</p></div><div className="fr-capital-rail-foot">Read-only permissions · source records only</div></aside>; }
function EmptyRoom() { return <div className="fr-capital-empty" data-testid="empty-raise-data-room"><FolderOpen size={24} /><h2>No startup is available</h2><p>This data-room collection is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/raise/status">Back to raise</Link></div>; }
function UnavailableRoom({ onRetry }) { return <div className="fr-capital-empty" data-testid="unavailable-raise-data-room"><AlertCircle size={24} /><h2>Project source unavailable</h2><p>The selected startup cannot be read right now. No staged, grant, or view totals are inferred.</p><button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div>; }
function RoomSkeleton() { return <div className="fr-capital-loading" data-testid="status-raise-data-room-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }