import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BarChart3, ChevronRight, FileText, Link2, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { deckShareState } from '../../lib/deckShares';
import { WorkerRail } from '../../ui';
import './founderRaisePitch.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';

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
  // The canvas's two live views. Both cards are on the page either way — this
  // decides which one leads, because a deck's versions and a deck's readers are
  // different questions and the answer to one is not hidden inside the other.
  const [view, setView] = useState('analytics');
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
          <div className="fr-pitch-title-row"><div><h1>Pitch</h1><p className="fr-pitch-subtitle">Versions, narrative variants, exports and share analytics.</p></div></div>
          <nav className="fr-pitch-zone-nav" aria-label="Raise sections">
            <Link to={`/raise/status${query}`}>Status</Link><Link to={`/raise/pitch${query}`} className="is-active" data-testid="link-pitch-zone">Pitch</Link><Link to={`/raise/capital${query}`}>Capital</Link><Link to={`/raise/legal${query}`}>Legal</Link><Link to={`/raise/data-room${query}`}>Data room</Link><span className="fr-pitch-zone-disabled">Liquidity unavailable</span>
          </nav>
          <ZoneToolbar
              filters={founderZoneFilters('raise/pitch', { value: view, onChange: setView })}
              actions={founderZoneActions('raise/pitch', { query })}
            />
        </header>
        {Object.keys(errors).length > 0 && <div className="fr-pitch-alert" role="alert" data-testid="status-pitch-partial"><AlertCircle size={16} /><span>{errors.projects || errors.versions || 'Some pitch sources are unavailable.'}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
        {loading ? <PitchSkeleton /> : errors.projects ? <UnavailablePitch onRetry={load} /> : !project ? <EmptyPitch /> : <PitchContent view={view} project={project} versions={versions} current={current} analytics={analytics} engagementError={errors.engagement} query={query} />}
      </section>
      <PageRail project={project} versions={versions} analytics={analytics} />
    </div>
  </main>;
}

function PitchContent({ view, project, versions, current, analytics, engagementError, query }) {
  const slideCount = Array.isArray(current?.slides) ? current.slides.length : null;
  return <div className={`fr-pitch-content${view === 'versions' ? ' is-versions-first' : ''}`}>
    <div className="fr-pitch-context"><div><span className="fr-pitch-label">Selected startup</span><strong data-testid="text-pitch-project">{text(project.name)}</strong><span>{text(project.sector, 'Sector not recorded')}</span></div><div className="fr-pitch-context-right"><span className="fr-pitch-label">Current deck</span><strong>{current ? `${displayVersion(current)} · ${text(current.title, 'Untitled deck')}` : 'No current deck recorded'}</strong><span>{current ? `Created ${formatDate(current.created_at)}` : 'Version source returned no decks'}</span></div></div>
    <div className="fr-pitch-stat-strip">
      <Stat label="Versions" value={versions.length || 'Unavailable'} note={versions.length ? `${displayVersion(current)} current when flagged` : 'No deck versions recorded'} muted={!versions.length} />
      <Stat label="Share links" value={analytics.linkCount === null ? 'Unavailable' : analytics.linkCount} note={analytics.linkCount === null ? (engagementError ? 'Share source unavailable' : 'No share-link count returned') : `${analytics.deadCount} no longer open`} muted={analytics.linkCount === null} />
      <Stat label="Total views" value={analytics.totalViews === null ? 'Unavailable' : analytics.totalViews} note={analytics.totalViews === null ? 'Engagement source unavailable' : `across ${analytics.rows.length} returned rows`} muted={analytics.totalViews === null} />
      <Stat label="Drop-off slide" value={analytics.dropOff === null ? 'Unavailable' : `Slide ${analytics.dropOff}`} note={analytics.dropOff === null ? 'No slide analytics returned' : 'From engagement source'} muted={analytics.dropOff === null} />
    </div>
    <section className="fr-pitch-card fr-pitch-analytics">
      <div className="fr-pitch-card-head"><div><BarChart3 size={16} /><h2>{view === 'shares' ? 'Share links' : 'Share analytics, per investor'}</h2></div><span>{engagementError ? 'Source unavailable' : view === 'shares' ? `${analytics.links.length} issued` : 'Updates when returned by source'}</span></div>
      {/* Its filter row moved to the zone header. Variants and Shares
          joined it there as prose: a deck stores versions rather than
          narrative variants, and share links live in the deck builder. */}
      <div className="fr-pitch-toolbar"><Link to={`/raise/pitch?mode=workspace${project.id ? `&project_id=${project.id}` : ''}`} data-testid="link-open-pitch-editor"><FileText size={13} /> Open editor</Link></div>
      {view === 'shares' ? <ShareLinks links={analytics.links} error={engagementError} />
        : analytics.rows.length ? <div className="fr-pitch-table-wrap"><table><thead><tr><th>Investor</th><th>Version</th><th>Views</th><th>Avg time</th><th>Last activity</th></tr></thead><tbody>{analytics.rows.map((row, index) => <tr key={row.id || index} data-testid={`row-pitch-share-${row.id || index}`}><td><strong>{row.investor}</strong><small>{row.source}</small></td><td>{row.version}</td><td>{row.views}</td><td>{row.avgTime}</td><td>{row.lastActivity}</td></tr>)}</tbody></table></div> : <div className="fr-pitch-inline-empty"><Link2 size={18} /><div><strong>{engagementError ? 'Share analytics source unavailable.' : 'No share analytics are recorded.'}</strong><p>This page does not invent investor names, views, activity, or drop-off behavior.</p></div></div>}
      <p className="fr-pitch-note">Share rows and slide behavior are shown only when the engagement source returns them. The read-only collection view never mints, revokes, or edits a share link.</p>
    </section>
    <div className="fr-pitch-lower-grid"><section className="fr-pitch-card"><div className="fr-pitch-card-head"><div><FileText size={16} /><h2>Deck versions</h2></div><span>{versions.length} stored</span></div>{versions.length ? <div className="fr-pitch-version-list">{versions.map((version, index) => <div key={version.id || index}><div><strong>{displayVersion(version)}</strong><span>{text(version.title, 'Untitled deck')}</span></div><small>{version.is_current || version.current ? 'Current' : `Created ${formatDate(version.created_at)}`}</small></div>)}</div> : <p className="fr-pitch-muted-copy">No deck versions are recorded for this startup.</p>}<p className="fr-pitch-note">Variants and PDF exports are not exposed by the current read source.</p></section><section className="fr-pitch-card"><div className="fr-pitch-card-head"><div><Sparkles size={16} /><h2>Narrative variants</h2></div><span>Unavailable</span></div><div className="fr-pitch-unavailable"><Sparkles size={17} /><div><strong>No variant source is connected.</strong><p>The existing editor remains the place to create or revise a deck. FR2 does not claim variants that the API does not return.</p></div></div><Link className="fr-pitch-editor-link" to={`/raise/pitch?mode=workspace${project.id ? `&project_id=${project.id}` : ''}`} data-testid="link-pitch-editor-lower">Open pitch editor <ChevronRight size={13} /></Link></section></div>
    <p className="fr-pitch-footer-note">Current deck: {slideCount === null ? 'slide count not recorded' : `${slideCount} stored slides`}. Export, revocation, and AI rewrite actions are intentionally kept in the detailed editor.</p>
  </div>;
}

/**
 * The links, as links — created, expiring, opened, still open.
 *
 * READ-ONLY HERE, DELIBERATELY. `Revoke a link` on this zone is a `to:` link into
 * the deck builder's Engagement panel, which is where #196 put Withdraw beside
 * each link's view count. Two places to end a link would be two places to get it
 * wrong; this view says which links exist and sends the founder there to change
 * one.
 */
function ShareLinks({ links, error }) {
  if (error) return <div className="fr-pitch-inline-empty" data-testid="shares-error"><Link2 size={18} /><div><strong>The share source is unavailable.</strong><p>No link state is inferred from the deck versions in its place.</p></div></div>;
  if (!links.length) return <div className="fr-pitch-inline-empty" data-testid="shares-empty"><Link2 size={18} /><div><strong>No share link has been issued.</strong><p>Links are minted in the deck builder; this view lists the ones that exist and what each has done.</p></div></div>;
  return <div className="fr-pitch-table-wrap"><table data-testid="table-share-links"><thead><tr><th>Link</th><th>Created</th><th>Expires</th><th>Views</th><th>Last opened</th></tr></thead><tbody>{links.map((link) => <tr key={link.id} data-testid={`row-share-link-${link.id}`}>
    <td><strong>Link #{link.id}</strong><small>{link.state.label}</small></td>
    <td>{link.created}</td>
    <td>{link.expires}</td>
    <td>{link.views}</td>
    <td>{link.lastViewed}</td>
  </tr>)}</tbody></table><p className="fr-pitch-note">A link&apos;s state is the same rule the deck builder&apos;s panel uses, so the two cannot disagree. Withdrawing one happens there.</p></div>;
}

function normalizeAnalytics(value) {
  const source = value?.engagement || value?.analytics || value || {};
  const rawRows = asList(source, 'rows', 'investors', 'shares', 'links', 'share_links');
  // Task #196 — the state is computed ONCE per row, then read twice: as the cell
  // under the investor name, and as the count in the stat strip. `row.status` DOES
  // NOT EXIST on a deck share row — the engagement route returns `revoked_at`,
  // `exhausted`, `expires_at`, `view_count` and `view_limit`, and never a
  // `status` — so that cell read "Share record" for every row and the stat below
  // counted 0 expiring forever. It matters now because a withdrawn link would
  // otherwise be indistinguishable here from a live one, on a page whose own note
  // says it shows share state and only declines to CHANGE it. `deckShareState` is
  // the same rule the deck builder's panel uses, so the two cannot disagree.
  const states = rawRows.map((row) => deckShareState(row));
  const rows = rawRows.map((row, index) => ({
    id: row.id || row.share_id || row.investor_id || index,
    investor: text(row.investor_name || row.investor || row.name || row.email, 'Anonymous share'),
    version: row.version == null ? 'Version not recorded' : `v${row.version}`,
    views: row.views ?? row.view_count ?? 'Not recorded',
    avgTime: row.avg_time || row.average_time || row.read_time || 'Not recorded',
    lastActivity: row.last_activity || row.last_opened_at || row.updated_at || row.last_viewed_at ? formatDateTime(row.last_activity || row.last_opened_at || row.updated_at || row.last_viewed_at) : 'Activity not recorded',
    source: text(row.status, states[index].label),
  }));
  const sumViews = rows.reduce((sum, row) => Number.isFinite(Number(row.views)) ? sum + Number(row.views) : sum, 0);
  const hasViewValue = rows.some((row) => Number.isFinite(Number(row.views)));
  const totalViews = source.total_views ?? source.views ?? (hasViewValue ? sumViews : null);
  const linkCount = source.share_link_count ?? source.share_links_count ?? source.link_count ?? (Array.isArray(source.share_links) ? source.share_links.length : (Array.isArray(source.links) ? source.links.length : (rawRows.length ? rawRows.length : null)));
  // What a founder can act on is whether a link still opens, so that is counted.
  const deadCount = states.filter((s) => !s.live).length;
  // THE SHARE LINKS THEMSELVES, kept alongside the per-investor rows above.
  //
  // The `Shares` chip was refused with "share links are held by the deck builder
  // and are not returned to this page". `GET /decks/:id/engagement` returns a
  // `shares` array — id, created_at, expires_at, view_limit, view_count,
  // exhausted and (since #196) `revoked_at` — and this function has been reading
  // that very array for the Analytics table all along. The links were never
  // absent; they were on screen in the shape of their READERS. `Shares` asks the
  // other question: what links exist and which still open.
  const links = rawRows.map((row, index) => ({
    id: row.id || row.share_id || index,
    created: row.created_at ? formatDateTime(row.created_at) : 'Created date not recorded',
    expires: row.expires_at ? formatDateTime(row.expires_at) : 'No expiry set',
    views: `${row.view_count ?? 0} of ${row.view_limit ?? 1}`,
    lastViewed: row.last_viewed_at ? formatDateTime(row.last_viewed_at) : 'Never opened',
    state: states[index],
  }));
  return { rows, links, totalViews: totalViews == null || totalViews === '' ? null : totalViews, linkCount: linkCount == null || linkCount === '' ? null : linkCount, deadCount, dropOff: source.drop_off_slide ?? source.dropoff_slide ?? source.drop_off ?? null };
}

function Stat({ label, value, note, muted }) { return <div className={`fr-pitch-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function PageRail({ project, versions, analytics }) {
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