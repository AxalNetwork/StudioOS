import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, Handshake, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowPartnerships.css';
import ZoneActions from '../../workspaces/ZoneActions';
import { founderZoneActions } from '../../workspaces/founderZoneActions';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const dateLabel = (value) => {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const statusLabel = (value) => text(value, 'State not recorded').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const linked = (row, project) => {
  if (!project || !row) return false;
  const numeric = [row.project_id, row.projectId].some((value) => value != null && String(value) === String(project.id));
  const uid = project.uid && [row.project_uid, row.projectUid].some((value) => value != null && String(value) === String(project.uid));
  return numeric || uid;
};

export default function FounderGrowPartnerships() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [pitches, setPitches] = useState([]);
  const [attributions, setAttributions] = useState([]);
  const [view, setView] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      let available = [];
      try { available = list(await api.listProjects(), 'items', 'projects'); } catch (cause) {
        if (!requestedId) throw cause;
        setError('The startup list is unavailable; partnership records are still being checked.');
      }
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected project' } : null);
      setProjects(available.length ? available : selected ? [selected] : []);
      setProject(selected);
      if (!selected) { setPitches([]); setAttributions([]); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      const results = await Promise.allSettled([
        api.listMyCoMarketingPitches(),
        api.listMyCoMarketingAttributions(),
      ]);
      const pitchResult = results[0];
      const attributionResult = results[1];
      const allPitches = pitchResult.status === 'fulfilled' ? list(pitchResult.value, 'items', 'pitches') : [];
      const nextAttributions = attributionResult.status === 'fulfilled' ? list(attributionResult.value, 'items', 'attributions').filter((row) => linked(row, selected)) : [];
      const linkedPitchIds = new Set(nextAttributions.map((row) => String(row.pitch_id ?? '')).filter(Boolean));
      const nextPitches = allPitches.filter((row) => linkedPitchIds.has(String(row.id)));
      setPitches(nextPitches); setAttributions(nextAttributions);
      if (results.some((result) => result.status === 'rejected')) setError('Some selected-project partnership sources are unavailable.');
    } catch (cause) {
      setProject(null); setPitches([]); setAttributions([]); setError(cause?.message || 'The partnership source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const query = project?.id ? `?project_id=${project.id}` : '';
  const visible = useMemo(() => {
    if (view === 'all') return pitches;
    if (view === 'signed') return pitches.filter((row) => ['signed', 'accepted', 'active', 'finalized'].includes(String(row.status || row.state || '').toLowerCase()));
    if (view === 'in-motion') return pitches.filter((row) => ['proposed', 'negotiating', 'in_progress', 'in_motion', 'pending'].includes(String(row.status || row.state || '').toLowerCase()));
    if (view === 'dormant') return [];
    return pitches;
  }, [pitches, view]);
  const signedCount = pitches.filter((row) => ['signed', 'accepted', 'active', 'finalized'].includes(String(row.status || row.state || '').toLowerCase())).length;
  const motionCount = pitches.filter((row) => ['proposed', 'negotiating', 'in_progress', 'in_motion', 'pending'].includes(String(row.status || row.state || '').toLowerCase())).length;
  const nav = [['Focus', `/grow/focus${query}`], ['Talent', `/grow/talent${query}`], ['Customers', `/grow/customers${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Capital match', `/grow/capital-match${query}`], ['Brand', `/grow/brand${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-partnerships" data-testid="founder-grow-partnerships"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-partnerships-crumb"><Link to={`/grow/focus${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Partnerships</b></div><span>Founder / Grow</span><div><h1>Partnerships</h1><p>Partner pipeline, proposals and retainers.</p></div>{projects.length > 1 && <label className="fg-partnerships-picker"><span>Startup</span><select data-testid="select-grow-partnerships-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<nav aria-label="Grow sections">{nav.map(([label, to]) => <Link data-testid={`link-grow-partnerships-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Partnerships' ? 'is-active' : ''}>{label}</Link>)}</nav>
    <ZoneActions className="mt-3" items={founderZoneActions('grow/partnerships', { query, view: { scope: project?.name, header: ['Partner', 'Type', 'Status', 'State', 'Created'], rows: visible, cells: (r) => [r.title, r.type, r.status, r.state, r.created_at] } })} /></header>
    {error && <div className="a5-grow-error" data-testid="status-grow-partnerships-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <PartnershipsSkeleton /> : !project ? <EmptyPartnerships /> : <PartnershipsContent project={project} pitches={pitches} attributions={attributions} visible={visible} view={view} setView={setView} query={query} error={error} signedCount={signedCount} motionCount={motionCount} />}
  </div><PartnershipsRail project={project} pitches={pitches} attributions={attributions} error={error} /></div></main>;
}

function PartnershipsContent({ project, pitches, attributions, visible, view, setView, query, error, signedCount, motionCount }) {
  return <div className="a5-sections"><div className="fg-partnerships-context"><div><span>Selected startup</span><strong data-testid="text-grow-partnerships-project">{text(project.name)}</strong></div><div><span>Partnership source</span><strong>{error ? 'Unavailable' : pitches.length ? 'Stored co-marketing records' : 'No records recorded'}</strong></div></div>
    <div className="fg-partnerships-tabs"><div><button type="button" className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}>All</button><button type="button" className={view === 'in-motion' ? 'is-active' : ''} onClick={() => setView('in-motion')}>In motion</button><button type="button" className={view === 'signed' ? 'is-active' : ''} onClick={() => setView('signed')}>Signed</button><button type="button" className={view === 'dormant' ? 'is-active' : ''} onClick={() => setView('dormant')}>Dormant</button></div><div className="fg-partnerships-actions"><Link to={`/comarketing?project_id=${project.id}`} data-testid="link-open-grow-partnerships-workspace"><Handshake size={13} /> Open workspace</Link></div></div>
    <div className="fg-partnerships-stats"><Stat label="Partners tracked" value={error ? 'Unavailable' : pitches.length} note={error ? 'Partnership source unavailable' : `${attributions.length} linked attribution${attributions.length === 1 ? '' : 's'}`} muted={Boolean(error)} /><Stat label="Signed value" value="Unavailable" note="No contract-value source connected" muted /><Stat label="Referrals received" value="Unavailable" note="No partner-delivery source connected" muted /><Stat label="Dormant > 60d" value={view === 'dormant' ? 'Unavailable' : 'Unavailable'} note="No activity timeline connected" muted /></div>
    <section className="a5-card fg-partnerships-table"><Head icon={Handshake} title="Partner pipeline" meta={view === 'all' ? 'What each delivered, not announced' : `${visible.length} matching record${visible.length === 1 ? '' : 's'}`} />{error ? <EmptyTable error /> : view === 'dormant' ? <UnavailableTable /> : <PartnerTable rows={visible} attributions={attributions} />}</section>
    <section className="a5-focus fg-partnerships-read"><div className="a5-head"><div><Sparkles size={15} /><h2>Read the partnership honestly</h2></div><span>Source-derived</span></div><p>{error ? 'The selected-project partnership source is unavailable, so FG4 cannot determine which partners are tracked. Signed value, referrals, dormant age, delivered outcomes, and proposals remain unavailable.' : pitches.length ? `FG4 shows ${pitches.length} stored partnership record${pitches.length === 1 ? '' : 's'} and ${attributions.length} linked attribution record${attributions.length === 1 ? '' : 's'}. It does not infer signed value, partner delivery, or referral performance from a pitch record.` : 'No project-linked partnership records are stored for this startup, so partner count, signed value, referrals, dormant age, and delivered outcomes remain unavailable.'}</p><Link className="a5-link" to={`/comarketing?project_id=${project.id}`}>Open co-marketing workspace <ChevronRight size={14} /></Link></section>
  </div>;
}
function PartnerTable({ rows, attributions }) {
  if (!rows.length) return <EmptyTable />;
  return <div className="fg-partnerships-table-wrap"><table><thead><tr><th>Partner</th><th>Type</th><th>State</th><th>Delivered so far</th></tr></thead><tbody>{rows.map((row, index) => { const delivered = attributions.filter((item) => String(item.pitch_id) === String(row.id)); const kinds = [...new Set(delivered.map((item) => text(item.event_kind, 'event')))]; return <tr key={row.id || row.uid || index}><td><strong>{text(row.partner_name || row.partner || row.name || row.title, 'Partner name not recorded')}</strong><small>{row.created_at ? `Recorded ${dateLabel(row.created_at)}` : 'Date not recorded'}</small></td><td>{text(row.asset_type || row.partnership_type || row.type || row.kind)}</td><td><span className="fg-partnerships-pill">{statusLabel(row.status || row.state)}</span></td><td className="fg-partnerships-reason">{delivered.length ? `${delivered.length} project-linked attribution event${delivered.length === 1 ? '' : 's'} · ${kinds.join(', ')}` : 'Partner delivery is not recorded.'}</td></tr>; })}</tbody></table></div>;
}
function UnavailableTable() { return <div className="a5-empty"><Handshake size={18} /><div><b>Dormant filtering is unavailable.</b><p>No activity timeline or last-contact source is connected, so partnership dates are not treated as dormant age.</p></div></div>; }
function EmptyTable({ error }) { return <div className="a5-empty"><Handshake size={18} /><div><b>{error ? 'Partnership source unavailable.' : 'No project-linked partnership records are recorded.'}</b><p>FG4 does not infer partner delivery, value, referrals, or dormant age.</p></div></div>; }
function Head({ icon: Icon, title, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-partnerships-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function PartnershipsRail({ project, pitches, attributions, error }) {
  return <WorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only partner board"
    note="This rail summarizes stored partnership records. It does not propose, send, export terms, or modify partner data."
    coverage={[!project ? 'No project selected' : error ? 'Partnership source unavailable' : `${pitches.length} tracked record${pitches.length === 1 ? '' : 's'}`, !project || error ? 'Attribution source unavailable' : `${attributions.length} attribution record${attributions.length === 1 ? '' : 's'}`]}
    unavailable={[['Contract value', 'No signed-value source is connected.'], ['Partner delivery', 'No referral or delivery source is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function PartnershipsSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-partnerships-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyPartnerships() { return <div className="a5-empty fg-partnerships-empty"><Handshake size={20} /><div><b>No startup is available.</b><p>Partnerships is scoped to an authenticated startup and its stored co-marketing records.</p></div></div>; }