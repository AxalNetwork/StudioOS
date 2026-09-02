import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, ChevronRight, FileText, Layers3, MessageSquare, Quote, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { FounderWorkerRail } from '../../ui';
import DiscoveryPage from '../DiscoveryPage';
import './founderValidate.css';
import './founderValidateWorkspace.css';

const statusLabel = { validated: 'Validated', invalidated: 'Invalidated', inconclusive: 'Inconclusive' };
const clean = (value) => String(value || '').trim();
const quoteFrom = (notes) => {
  const text = clean(notes).replace(/\s+/g, ' ');
  if (!text) return null;
  const quoted = text.match(/[“"]([^”"]{18,260})[”"]/);
  return quoted ? quoted[1] : text.slice(0, 240);
};

const SECTIONS = [
  ['Interviews', '/validate/interviews'],
  ['Pain map', '/validate/pain-map'],
  ['Hypotheses', '/validate/hypotheses'],
  ['Verdict', '/validate/verdict'],
];

export default function FounderValidatePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationSeed = location.state?.founderValidateSeed;
  const [projects, setProjects] = useState(() => navigationSeed?.projects || []);
  const [projectId, setProjectId] = useState(() => navigationSeed?.projectId || null);
  const [interviews, setInterviews] = useState(() => navigationSeed?.interviews || []);
  const [painView, setPainView] = useState(() => navigationSeed?.painView || null);
  const [signals, setSignals] = useState(() => navigationSeed?.signals || null);
  const [state, setState] = useState(() => navigationSeed ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const workspaceFromUrl = searchParams.get('mode') === 'workspace'
    || ['leads', 'interviews', 'insights'].includes(searchParams.get('tab'));
  const [showWorkspace, setShowWorkspace] = useState(workspaceFromUrl);
  const isWorkspace = showWorkspace;

  useEffect(() => {
    if (workspaceFromUrl) setShowWorkspace(true);
  }, [workspaceFromUrl]);

  useEffect(() => {
    if (isWorkspace) return;
    let alive = true;
    api.listProjects().then((list) => {
      if (!alive) return;
      const available = list || [];
      setProjects(available);
      const requested = Number(searchParams.get('project_id'));
      const selected = available.find((item) => item.id === requested) || available[0];
      setProjectId(selected?.id || null);
      setState('ready');
    }).catch((err) => {
      if (!alive) return;
      const requested = Number(searchParams.get('project_id'));
      if (requested) {
        setProjects([{ id: requested, name: `Startup #${requested}` }]);
        setProjectId(requested);
      }
      setError(err?.message || 'The project list could not be loaded.');
      setState('error');
    });
    return () => { alive = false; };
  }, [isWorkspace, reloadKey]);

  useEffect(() => {
    if (!projectId || isWorkspace) return;
    let alive = true;
    setState('loading');
    setSearchParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(projectId)); return next; }, { replace: true });
    Promise.all([
      api.listInterviews(projectId),
      api.getProgressSignals(projectId).catch(() => null),
      api.painGroups(projectId).catch(() => null),
    ]).then(([interviewResponse, progress, pains]) => {
      if (!alive) return;
      setInterviews(interviewResponse?.interviews || []);
      setSignals(progress);
      setPainView(pains);
      setState('ready');
    }).catch((err) => {
      if (!alive) return;
      setError(err?.message || 'Evidence for this project could not be loaded.');
      setState('error');
    });
    return () => { alive = false; };
  }, [projectId, isWorkspace, reloadKey]);

  const evidence = useMemo(() => {
    const hypotheses = interviews.flatMap((item) => (item.hypotheses || []).filter((hypothesis) => clean(hypothesis.hypothesis)).map((hypothesis) => ({ ...hypothesis, interview: item })));
    const counts = hypotheses.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {});
    const groups = painView?.groups || [];
    const pains = groups.map((group) => ({
      name: group.title,
      count: (group.phrases || []).reduce((sum, phrase) => sum + Number(phrase.count || 1), 0),
    }));
    (painView?.ungrouped || []).forEach((pain) => pains.push({ name: pain.display_phrase, count: Number(pain.count || 1) }));
    const maxPain = Math.max(...pains.map((pain) => pain.count), 1);
    return { hypotheses, counts, pains: pains.sort((a, b) => b.count - a.count), maxPain };
  }, [interviews, painView]);

  if (isWorkspace) {
    return (
      <div className="validate-workspace-shell">
        <button
          type="button"
          className="validate-back"
          onClick={() => {
            setShowWorkspace(false);
            navigate(`/build/discovery${projectId ? `?project_id=${projectId}` : ''}`, { replace: true });
          }}
        >
          Back to evidence desk
        </button>
        <DiscoveryPage
          initialProjects={projects}
          initialProjectId={projectId}
          initialInterviews={interviews}
          initialSignals={signals}
          initialPainView={painView}
          initialTab="interviews"
          workspaceMode
        />
      </div>
    );
  }
  const detailLink = `/build/discovery?mode=workspace${projectId ? `&project_id=${projectId}&tab=interviews` : ''}`;
  // The row navigates. These four were `href="#validate-0"` … `#validate-3`,
  // anchors onto sections of this page — so the buttons that name the four
  // evidence stages did nothing but scroll, and the stage pages they name were
  // reachable only from the sidebar row that used to point at one of them.
  const query = projectId ? `?project_id=${projectId}` : '';
  const workspaceNavigationState = {
    founderValidateSeed: {
      projects,
      projectId,
      interviews,
      painView,
      signals,
    },
  };
  const featured = interviews.find((item) => item.featured && quoteFrom(item.notes)) || interviews.find((item) => quoteFrom(item.notes));
  const dateFormat = (date) => date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`)) : 'Date not recorded';

  return (
    <main className="validate-desk" data-testid="founder-validate-desk">
      <section className="validate-canvas">
        <div className="validate-main">
          <header className="validate-hero">
            <div className="validate-eyebrow">Founder / Validate</div>
            <div className="validate-hero-line">
              <div><h1>Prove someone wants this</h1><p>Every interview, every pain, every hypothesis and the verdict they add up to — on one page.</p></div>
              <div className="validate-project-actions">
                {projects.length > 1 && <select data-testid="select-validate-project" value={projectId || ''} onChange={(event) => setProjectId(Number(event.target.value))}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
                <Link data-testid="link-open-discovery-workspace" className="validate-open" to={detailLink} state={workspaceNavigationState}>Open workspace <ArrowUpRight size={14} /></Link>
              </div>
            </div>
            <nav aria-label="Evidence sections" className="validate-anchors">
              {SECTIONS.map(([label, to], index) => <Link data-testid={`link-anchor-${index}`} key={label} to={`${to}${query}`}>{label}</Link>)}
            </nav>
          </header>
          {state === 'error' && <div className="validate-error" data-testid="status-validate-error"><AlertCircle size={16} /> {error} <button data-testid="button-retry-validate" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>}
          <EvidenceCards loading={state === 'loading'} projects={projects} featured={featured} interviews={interviews} evidence={evidence} signals={signals} dateFormat={dateFormat} detailLink={detailLink} workspaceNavigationState={workspaceNavigationState} />
        </div>
        <FounderWorkerRail
          workspace="Validate"
          className="validate-rail"
          stance="Evidence-led view"
          note="This desk does not generate, transcribe, or change records. It keeps the evidence surface readable."
          coverage={[
            `${interviews.length} interview${interviews.length === 1 ? '' : 's'}`,
            `${evidence.hypotheses.length} hypothesis record${evidence.hypotheses.length === 1 ? '' : 's'}`,
            `${evidence.pains.length} pain theme${evidence.pains.length === 1 ? '' : 's'}`,
          ]}
          action={<Link data-testid="link-rail-open-workspace" to={detailLink} state={workspaceNavigationState}>Open workspace <ChevronRight size={14} /></Link>}
          footer="Traceable surface · no unsupported automated actions"
        />
      </section>
    </main>
  );
}

function EvidenceCards({ loading, projects, featured, interviews, evidence, signals, dateFormat, detailLink, workspaceNavigationState }) {
  const cards = evidence.hypotheses.slice(0, 6);
  return <div className="validate-sections">
    <section className="evidence-card" id="validate-0"><SectionHead icon={MessageSquare} title="Interview library" meta={loading ? 'Reading source records' : `${interviews.length} logged · ${interviews.filter((item) => item.featured).length} featured`} />
      {loading ? <Skeleton rows={4} /> : !projects.length ? <Empty icon={Target} text="No startup is available to this view yet." action="Choose or create a startup in the workspace." link={detailLink} linkState={workspaceNavigationState} /> : featured ? <div className="source-quote"><div className="source-label"><span>Recorded evidence</span><span>{dateFormat(featured.interview_date)}</span></div><strong>{clean(featured.interviewee_name) || 'Unnamed interviewee'}{featured.interviewee_role ? ` · ${featured.interviewee_role}` : ''}</strong><p><Quote size={14} /> {quoteFrom(featured.notes)}</p><div className="source-foot">Source: interview notes · {(featured.hypotheses || []).length} hypothesis record{(featured.hypotheses || []).length === 1 ? '' : 's'} · {(featured.pains || []).length} pain tag{(featured.pains || []).length === 1 ? '' : 's'}</div></div> : <Empty icon={FileText} text="No recorded interview notes with a usable quote yet." action="Log evidence in the detailed workspace; this desk only shows recorded material." link={detailLink} linkState={workspaceNavigationState} />}
      {!loading && interviews.length > 0 && <div className="interview-table"><div className="table-head"><span>Person</span><span>Role</span><span>Date</span><span>Evidence</span></div>{interviews.slice(0, 6).map((item) => <div className="table-row" key={item.id}><strong>{clean(item.interviewee_name) || 'Unnamed'}</strong><span>{clean(item.interviewee_role) || 'Not recorded'}</span><span>{dateFormat(item.interview_date)}</span><span>{(item.hypotheses || []).length + (item.pains || []).length} records</span></div>)}</div>}
      <Link data-testid="link-manage-interviews" className="manage-link" to={detailLink} state={workspaceNavigationState}>Manage interviews and source notes <ChevronRight size={14} /></Link>
    </section>
    <section className="evidence-card" id="validate-1"><SectionHead icon={Layers3} title="Pain map" meta={painLabel(evidence.pains.length)} />{loading ? <Skeleton rows={3} /> : evidence.pains.length ? <div className="pain-map">{evidence.pains.slice(0, 8).map((pain) => <div className="pain-row" key={pain.name}><strong>{pain.name}</strong><div><i style={{ width: `${Math.max(7, pain.count / evidence.maxPain * 100)}%` }} /></div><span>{pain.count} recorded</span></div>)}</div> : <Empty icon={Layers3} text="No pains have been logged or curated yet." action="Pain counts appear only after a recorded pain is grouped." link={detailLink} linkState={workspaceNavigationState} />}</section>
    <section className="evidence-card" id="validate-2"><SectionHead icon={Target} title="Hypotheses" meta={`${evidence.hypotheses.length} stored record${evidence.hypotheses.length === 1 ? '' : 's'}`} />{loading ? <Skeleton rows={2} /> : cards.length ? <div className="hypothesis-grid">{cards.map((item, index) => <article className={`hypothesis hypothesis-${item.status || 'inconclusive'}`} key={`${item.interview.id}-${index}`}><span>{statusLabel[item.status] || 'Unclassified'}</span><strong>{item.hypothesis}</strong><small>{clean(item.evidence) ? `Evidence: ${item.evidence}` : `Linked to ${clean(item.interview.interviewee_name) || 'an interview'} · no evidence note recorded`}</small></article>)}</div> : <Empty icon={Target} text="No hypotheses have been stored yet." action="Create and assess them in the detailed workspace." link={detailLink} linkState={workspaceNavigationState} />}</section>
    <section className="evidence-card" id="validate-3"><SectionHead icon={FileText} title="Validation summary" meta="Derived from stored records" /><Verdict evidence={evidence} interviews={interviews} signals={signals} /></section>
  </div>;
}
function SectionHead({ icon: Icon, title, meta }) { return <div className="section-head"><div><Icon size={16} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Empty({ icon: Icon, text, action, link, linkState }) { return <div className="evidence-empty"><Icon size={21} /><div><strong>{text}</strong><p>{action}</p><Link data-testid="link-empty-to-workspace" to={link} state={linkState}>Open detailed workspace <ChevronRight size={13} /></Link></div></div>; }
function Skeleton({ rows }) { return <div className="evidence-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function painLabel(count) { return count ? `${count} recorded pain theme${count === 1 ? '' : 's'}` : 'No curated pains'; }
function Verdict({ evidence, interviews, signals }) {
  const parts = [];
  if (evidence.counts.validated) parts.push(`${evidence.counts.validated} validated hypothesis record${evidence.counts.validated === 1 ? '' : 's'}`);
  if (evidence.counts.invalidated) parts.push(`${evidence.counts.invalidated} invalidated record${evidence.counts.invalidated === 1 ? '' : 's'}`);
  if (evidence.counts.inconclusive) parts.push(`${evidence.counts.inconclusive} inconclusive record${evidence.counts.inconclusive === 1 ? '' : 's'}`);
  return <div className="verdict"><p>{parts.length ? <>Current evidence contains <strong>{parts.join(', ')}</strong>, sourced across <strong>{interviews.length} interview{interviews.length === 1 ? '' : 's'}</strong>. This is a record summary, not an inferred market verdict.</> : 'There is not enough stored hypothesis evidence to state a verdict yet.'}</p>{signals?.factors?.signals && <small>Discovery signal: {signals.factors.signals.points} / {signals.factors.signals.max} points from the current project.</small>}<div className="provenance">Provenance · all statements above resolve to stored interview, pain, and hypothesis records.</div></div>;
}
