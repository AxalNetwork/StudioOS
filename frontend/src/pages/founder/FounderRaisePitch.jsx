import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BarChart3, ChevronRight, FileText, Filter, Link2, RefreshCw, Sparkles, SquareStack } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderRaisePitch.css';

const asList = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const formatDate = (value) => {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const formatDateTime = (value) => {
  if (!value) return 'Activity not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(parsed);
};
const status = (value) => text(value).replace(/[_-]/g, ' ');
const currentVersion = (versions) => versions.find((item) => item.is_current || item.current) || versions[0] || null;
const displayVersion = (version) => version?.version == null ? 'Version not recorded' : `v${version.version}`;

export default function FounderRaisePitch() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(Number(requestedId) || null);
  const [versions, setVersions] = useState([]);
  const [engagement, setEngagement] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const lastAutoLoad = useRef(null);

  const load = async () => {
    setLoading(true);
    const nextErrors = {};
    try {
      const available = asList(await api.listProjects(), 'items', 'projects');
      const requested = Number(requestedId);
      const chosen = available.find((item) => Number(item.id) === requested) || available[0];
      setProjects(available);
      setProjectId(chosen?.id || null);
      if (!chosen) {
        setVersions([]);
        setEngagement(null);
        setErrors({});
        return;
      }
      if (String(chosen.id) !== requestedId) {
        setParams((old) => {
          const next = new URLSearchParams(old);
          next.set('project_id', String(chosen.id));
          return next;
        }, { replace: true });
      }
      try {
        const response = await api.deckListVersions(chosen.id);
        const nextVersions = asList(response, 'versions', 'decks');
        setVersions(nextVersions);
        const current = currentVersion(nextVersions);
        if (current?.id) {
          try {
            setEngagement(await api.deckEngagement(current.id));
          } catch (cause) {
            nextErrors.engagement = cause?.message || 'Share analytics unavailable.';
            setEngagement(null);
          }
        } else {
          setEngagement(null);
        }
      } catch (cause) {
        nextErrors.versions = cause?.message || 'Pitch versions unavailable.';
        setVersions([]);
        setEngagement(null);
      }
    } catch (cause) {
      nextErrors.projects = cause?.message || 'The project list is unavailable.';
      setVersions([]);
      setEngagement(null);
    } finally {
      setErrors(nextErrors);
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
  const current = currentVersion(versions);
  const analytics = useMemo(() => normalizeAnalytics(engagement), [engagement]);
  const query = projectId ? `?project_id=${projectId}` : '';
  const selectProject = (value) => {
    const id = Number(value);
    setProjectId(id);
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set('project_id', String(id));
      return next;
    }, { replace: true });
  };

  return <main className="fr-pitch" data-testid="founder-raise-pitch">
    <div className="fr-pitch-shell">
      <section className="fr-pitch-main">
        <header className="fr-pitch-header">
          <div className="fr-pitch-crumb"><Link to={`/raise/status${query}`} data-testid="link-pitch-back"><ArrowLeft size={13} /> Raise</Link><span>/</span><strong>Pitch</strong></div>
          <div className="fr-pitch-title-row"><div><p className="fr-pitch-kicker">Founder / Raise</p><h1>Pitch</h1><p className="fr-pitch-subtitle">Versions, narrative variants, exports and share analytics.</p></div>{projects.length > 1 && <label className="fr-pitch-picker"><span>Startup</span><select data-testid="select-pitch-project" value={projectId || ''} onChange={(event) => selectProject(event.target.value)}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
          <nav className="fr-pitch-zone-nav" aria-label="Raise sections">
            <Link to={`/raise/status${query}`}>Status</Link><Link to={`/raise/pitch${query}`} className="is-active" data-testid="link-pitch-zone">Pitch</Link><Link to={`/raise/capital${query}`}>Capital</Link><Link to={`/raise/legal${query}`}>Legal</Link><Link to={`/raise/data-room${query}`}>Data room</Link><span className="fr-pitch-zone-disabled">Liquidity unavailable</span>
          </nav>
        </header>
        {Object.keys(errors).length > 0 && <div className="fr-pitch-alert" role="alert" data-testid="status-pitch-partial"><AlertCircle size={16} /><span>{errors.projects || errors.versions || 'Some pitch sources are unavailable.'}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
        {loading ? <PitchSkeleton /> : errors.projects ? <UnavailablePitch onRetry={load} /> : !project ? <EmptyPitch /> : <PitchContent project={project} versions={versions} current={current} analytics={analytics} engagementError={errors.engagement} query={query} />}
      </section>
      <WorkerRail project={project} versions={versions} analytics={analytics} />
    </div>
  </main>;
}

function PitchContent({ project, versions, current, analytics, engagementError, query }) {
  const slideCount = Array.isArray(current?.slides) ? current.slides.length : null;
  return <div className="fr-pitch-content">
    <div className="fr-pitch-context"><div><span className="fr-pitch-label">Selected startup</span><strong data-testid="text-pitch-project">{text(project.name)}</strong><span>{text(project.sector, 'Sector not recorded')}</span></div><div className="fr-pitch-context-right"><span className="fr-pitch-label">Current deck</span><strong>{current ? `${displayVersion(current)} · ${text(current.title, 'Untitled deck')}` : 'No current deck recorded'}</strong><span>{current ? `Created ${formatDate(current.created_at)}` : 'Version source returned no decks'}</span></div></div>
    <div className="fr-pitch-stat-strip">
      <Stat label="Versions" value={versions.length || 'Unavailable'} note={versions.length ? `${displayVersion(current)} current when flagged` : 'No deck versions recorded'} muted={!versions.length} />
      <Stat label="Share links" value={analytics.linkCount === null ? 'Unavailable' : analytics.linkCount} note={analytics.linkCount === null ? (engagementError ? 'Share source unavailable' : 'No share-link count returned') : `${analytics.expiringCount} expiring`} muted={analytics.linkCount === null} />
      <Stat label="Total views" value={analytics.totalViews === null ? 'Unavailable' : analytics.totalViews} note={analytics.totalViews === null ? 'Engagement source unavailable' : `across ${analytics.rows.length} returned rows`} muted={analytics.totalViews === null} />
      <Stat label="Drop-off slide" value={analytics.dropOff === null ? 'Unavailable' : `Slide ${analytics.dropOff}`} note={analytics.dropOff === null ? 'No slide analytics returned' : 'From engagement source'} muted={analytics.dropOff === null} />
    </div>
    <section className="fr-pitch-card fr-pitch-analytics">
      <div className="fr-pitch-card-head"><div><BarChart3 size={16} /><h2>Share analytics, per investor</h2></div><span>{engagementError ? 'Source unavailable' : 'Updates when returned by source'}</span></div>
      <div className="fr-pitch-toolbar"><div className="fr-pitch-filters"><Filter size={13} /><button type="button" className="is-selected">Shares</button><button type="button" disabled>Versions</button><button type="button" disabled>Variants unavailable</button><button type="button" disabled>Analytics</button></div><div className="fr-pitch-actions"><span><SquareStack size={13} /> Draft actions unavailable</span><Link to={`/raise/pitch?mode=workspace${project.id ? `&project_id=${project.id}` : ''}`} data-testid="link-open-pitch-editor"><FileText size={13} /> Open editor</Link></div></div>
      {analytics.rows.length ? <div className="fr-pitch-table-wrap"><table><thead><tr><th>Investor</th><th>Version</th><th>Views</th><th>Avg time</th><th>Last activity</th></tr></thead><tbody>{analytics.rows.map((row, index) => <tr key={row.id || index} data-testid={`row-pitch-share-${row.id || index}`}><td><strong>{row.investor}</strong><small>{row.source}</small></td><td>{row.version}</td><td>{row.views}</td><td>{row.avgTime}</td><td>{row.lastActivity}</td></tr>)}</tbody></table></div> : <div className="fr-pitch-inline-empty"><Link2 size={18} /><div><strong>{engagementError ? 'Share analytics source unavailable.' : 'No share analytics are recorded.'}</strong><p>This page does not invent investor names, views, activity, or drop-off behavior.</p></div></div>}
      <p className="fr-pitch-note">Share rows and slide behavior are shown only when the engagement source returns them. The read-only collection view never mints, revokes, or edits a share link.</p>
    </section>
    <div className="fr-pitch-lower-grid"><section className="fr-pitch-card"><div className="fr-pitch-card-head"><div><FileText size={16} /><h2>Deck versions</h2></div><span>{versions.length} stored</span></div>{versions.length ? <div className="fr-pitch-version-list">{versions.map((version, index) => <div key={version.id || index}><div><strong>{displayVersion(version)}</strong><span>{text(version.title, 'Untitled deck')}</span></div><small>{version.is_current || version.current ? 'Current' : `Created ${formatDate(version.created_at)}`}</small></div>)}</div> : <p className="fr-pitch-muted-copy">No deck versions are recorded for this startup.</p>}<p className="fr-pitch-note">Variants and PDF exports are not exposed by the current read source.</p></section><section className="fr-pitch-card"><div className="fr-pitch-card-head"><div><Sparkles size={16} /><h2>Narrative variants</h2></div><span>Unavailable</span></div><div className="fr-pitch-unavailable"><Sparkles size={17} /><div><strong>No variant source is connected.</strong><p>The existing editor remains the place to create or revise a deck. FR2 does not claim variants that the API does not return.</p></div></div><Link className="fr-pitch-editor-link" to={`/raise/pitch?mode=workspace${project.id ? `&project_id=${project.id}` : ''}`} data-testid="link-pitch-editor-lower">Open pitch editor <ChevronRight size={13} /></Link></section></div>
    <p className="fr-pitch-footer-note">Current deck: {slideCount === null ? 'slide count not recorded' : `${slideCount} stored slides`}. Export, revocation, and AI rewrite actions are intentionally kept in the detailed editor.</p>
  </div>;
}

function normalizeAnalytics(value) {
  const source = value?.engagement || value?.analytics || value || {};
  const rawRows = asList(source, 'rows', 'investors', 'shares', 'links', 'share_links');
  const rows = rawRows.map((row, index) => ({
    id: row.id || row.share_id || row.investor_id || index,
    investor: text(row.investor_name || row.investor || row.name || row.email, 'Anonymous share'),
    version: row.version == null ? 'Version not recorded' : `v${row.version}`,
    views: row.views ?? row.view_count ?? 'Not recorded',
    avgTime: row.avg_time || row.average_time || row.read_time || 'Not recorded',
    lastActivity: row.last_activity || row.last_opened_at || row.updated_at ? formatDateTime(row.last_activity || row.last_opened_at || row.updated_at) : 'Activity not recorded',
    source: text(row.status, 'Share record'),
  }));
  const sumViews = rows.reduce((sum, row) => Number.isFinite(Number(row.views)) ? sum + Number(row.views) : sum, 0);
  const hasViewValue = rows.some((row) => Number.isFinite(Number(row.views)));
  const totalViews = source.total_views ?? source.views ?? (hasViewValue ? sumViews : null);
  const linkCount = source.share_link_count ?? source.share_links_count ?? source.link_count ?? (Array.isArray(source.share_links) ? source.share_links.length : (Array.isArray(source.links) ? source.links.length : (rawRows.length ? rawRows.length : null)));
  return { rows, totalViews: totalViews == null || totalViews === '' ? null : totalViews, linkCount: linkCount == null || linkCount === '' ? null : linkCount, expiringCount: rawRows.filter((row) => String(row.status || '').toLowerCase().includes('expir')).length, dropOff: source.drop_off_slide ?? source.dropoff_slide ?? source.drop_off ?? null };
}

function Stat({ label, value, note, muted }) { return <div className={`fr-pitch-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function WorkerRail({ project, versions, analytics }) {
  return <WorkerRail
    workspace="Raise"
    className="fr-pitch-rail"
    stance="Manual pitch collection"
    note="This page reads stored deck versions and returned engagement. It does not rewrite, export, mint, or revoke pitch materials."
    coverage={[project ? `${versions.length} stored version${versions.length === 1 ? '' : 's'}` : 'No project selected']}
    coverageNote={project ? `${analytics.rows.length} engagement row${analytics.rows.length === 1 ? '' : 's'} returned` : 'Select a startup to read its pitch records.'}
    unavailable={[['AI rewrite', 'No automated proposal or draft action is enabled.'], ['Variants and exports', 'Not returned by the current read source.']]}
    footer="Read-only collection · edit through pitch workspace"
  />;
}
function EmptyPitch() { return <div className="fr-pitch-empty" data-testid="empty-raise-pitch"><FileText size={24} /><h2>No startup is available</h2><p>This founder pitch collection is scoped to authenticated startup records. There is no project to inspect yet.</p><Link to="/raise/status">Back to raise</Link></div>; }
function UnavailablePitch({ onRetry }) { return <div className="fr-pitch-empty" data-testid="unavailable-raise-pitch"><AlertCircle size={24} /><h2>Project source unavailable</h2><p>The selected startup cannot be read right now. No pitch versions or share analytics are inferred from a failed request.</p><button type="button" onClick={onRetry}><RefreshCw size={13} /> Retry</button></div>; }
function PitchSkeleton() { return <div className="fr-pitch-loading" data-testid="status-raise-pitch-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }