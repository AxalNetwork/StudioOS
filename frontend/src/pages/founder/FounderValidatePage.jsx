import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, ChevronRight, FileText, Layers3, MessageSquare, Quote, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { Unreadable, WorkerRail } from '../../ui';
import DiscoveryPage from '../DiscoveryPage';
import { zonePillClass } from './deskZoneNav';
import FillProposals from '../../workspaces/FillProposals';
import useAssistMode from '../../hooks/useAssistMode';
import './founderValidate.css';
import './founderValidateWorkspace.css';

/**
 * THE HYPOTHESES CARD AND THE VERDICT READ THE BOARD, NOT THE INTERVIEWS.
 *
 * This desk used to flatten `discovery_interviews.hypotheses_json` into its
 * hypotheses card and count that JSON's `status` into the verdict. The zone
 * page and the proposal band on this very card write somewhere else — the
 * project-level `hypotheses` table (migration 211) — so a claim a founder
 * accepted from the band never appeared on the card the band sits in, and the
 * verdict summarised sentences the board does not hold. `getValidationBoard`
 * is the store both of them write to, and its verdict is derived server-side
 * from the pain links and the ICP fit (`_founder_validate_helpers.ts`), so the
 * desk and `/validate/verdict` cannot disagree about one claim.
 *
 * `verdict: null` is a fourth state and not "unproven": the worker withholds a
 * verdict when an interview touching the claim has no ICP fit recorded.
 */
const VERDICT_LABEL = { validated: 'Validated', invalidated: 'Invalidated', unproven: 'Unproven' };
const verdictLabel = (claim) => (claim.verdict ? VERDICT_LABEL[claim.verdict] : 'Fit not recorded');
const liveClaims = (board) => (board?.hypotheses || []).filter((claim) => !claim.retired_at && clean(claim.claim));

/**
 * How many quotes an interview carries, and how many are QUOTABLE.
 *
 * The artboard's table column is `Quotes`, and its own note is that
 * deck-eligibility "is not a flag someone sets — it derives from consent". So
 * an interview with recorded evidence and no consent has quotes that cannot
 * leave the page, which is a different number from the ones it has. Migration
 * 211 made `quote_consent` three-state on purpose: true, false, or never
 * asked, and folding null into false would report "declined" for everyone
 * nobody has asked yet.
 */
const quoteCount = (row) => (row?.hypotheses || []).length + (row?.pains || []).length;
const quotable = (row) => row?.quote_consent === true;

/** Interviews logged in the last seven days — the artboard's `3 this week`. */
function loggedThisWeek(rows) {
  const cutoff = Date.now() - 7 * 86400000;
  return rows.filter((r) => {
    const t = Date.parse(String(r.interview_date || r.created_at || ''));
    return !Number.isNaN(t) && t >= cutoff;
  }).length;
}

/** `44 min audio` — the artboard's cost line, from the stored duration. */
function clipLength(sec) {
  if (sec == null || !Number.isFinite(Number(sec)) || Number(sec) <= 0) return null;
  const mins = Math.round(Number(sec) / 60);
  return mins < 1 ? '<1 min audio' : `${mins} min audio`;
}
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
  // `undefined` while unread, `null` when the read FAILED — a failed board is
  // not an empty one, and the card says which.
  const [board, setBoard] = useState(() => navigationSeed?.board);
  const [state, setState] = useState(() => navigationSeed ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  // The same per-workspace mode the hypotheses page reads, so a founder who
  // turned fills on once does not have to turn it on again here — and one who
  // has not is offered nothing that spends their budget.
  const [fillsOn] = useAssistMode('Validate');
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
      api.getValidationBoard(projectId).catch(() => null),
    ]).then(([interviewResponse, progress, pains, claims]) => {
      if (!alive) return;
      setInterviews(interviewResponse?.interviews || []);
      setSignals(progress);
      setPainView(pains);
      setBoard(claims);
      setState('ready');
    }).catch((err) => {
      if (!alive) return;
      setError(err?.message || 'Evidence for this project could not be loaded.');
      setState('error');
    });
    return () => { alive = false; };
  }, [projectId, isWorkspace, reloadKey]);

  const evidence = useMemo(() => {
    const hypotheses = liveClaims(board);
    const groups = painView?.groups || [];
    const pains = groups.map((group) => ({
      name: group.title,
      count: (group.phrases || []).reduce((sum, phrase) => sum + Number(phrase.count || 1), 0),
    }));
    (painView?.ungrouped || []).forEach((pain) => pains.push({ name: pain.display_phrase, count: Number(pain.count || 1) }));
    const maxPain = Math.max(...pains.map((pain) => pain.count), 1);
    return { hypotheses, pains: pains.sort((a, b) => b.count - a.count), maxPain, boardUnreadable: board === null };
  }, [board, painView]);

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
  const query = projectId ? `?project_id=${projectId}` : '';
  /**
   * EVERY LINK ON THIS PAGE GOES TO THE STAGE IT SUMMARISES.
   *
   * All of them used to go to ONE place — `/build/discovery?mode=workspace` —
   * which is not in this bucket and, because of the `mode` parameter, is not
   * even the Discovery subpage: `App.jsx` reads that parameter and renders the
   * shared `FounderWorkspaceTabs` instead. So a reader who pressed `Open
   * detailed workspace` under Pain map, under Hypotheses, or under the
   * interview library landed in the same workspace every time, and none of the
   * four stage pages this desk summarises could be reached from the summary of
   * it. That is what an overview is FOR.
   *
   * `SECTIONS` already held the four routes for the chip row above; the cards
   * take their targets from the same list now, so a stage cannot be renamed in
   * one place and left stale in the other.
   */
  const stage = Object.fromEntries(SECTIONS.map(([label, to]) => [label, `${to}${query}`]));
  const stageLinks = {
    interviews: stage.Interviews,
    pains: stage['Pain map'],
    hypotheses: stage.Hypotheses,
    verdict: stage.Verdict,
  };
  const workspaceNavigationState = {
    founderValidateSeed: {
      projects,
      projectId,
      interviews,
      painView,
      signals,
      board,
    },
  };
  const featured = interviews.find((item) => item.featured && quoteFrom(item.notes)) || interviews.find((item) => quoteFrom(item.notes));
  const dateFormat = (date) => date ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`)) : 'Date not recorded';

  return (
    <main className="validate-desk" data-testid="founder-validate-desk">
      <section className="validate-canvas">
        <div className="validate-main">
          <header className="validate-hero">
            <div className="validate-hero-line">
              <div><h1>Prove someone wants this</h1><p>Every interview, every pain, every hypothesis and the verdict they add up to — on one page.</p></div>
              <div className="validate-project-actions">
                <Link data-testid="link-open-discovery-workspace" className="validate-open" to={stageLinks.interviews} state={workspaceNavigationState}>Open interviews <ArrowUpRight size={14} /></Link>
              </div>
            </div>
            <nav aria-label="Evidence sections" className="validate-anchors">
              {SECTIONS.map(([label, to], index) => <NavLink data-testid={`link-anchor-${index}`} key={label} to={`${to}${query}`} className={zonePillClass}>{label}</NavLink>)}
            </nav>
          </header>
          {state === 'error' && <div className="validate-error" data-testid="status-validate-error"><AlertCircle size={16} /> {error} <button data-testid="button-retry-validate" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>}
          <EvidenceCards loading={state === 'loading'} projects={projects} projectId={projectId} fillsOn={fillsOn} onApplied={() => setReloadKey((value) => value + 1)} featured={featured} interviews={interviews} evidence={evidence} signals={signals} dateFormat={dateFormat} stageLinks={stageLinks} workspaceNavigationState={workspaceNavigationState} bar={board?.bar} />
        </div>
        <WorkerRail
          workspace="Validate"
          className="validate-rail"
          stance="Evidence-led view"
          note="This desk does not generate, transcribe, or change records. It keeps the evidence surface readable."
          coverage={[
            `${interviews.length} interview${interviews.length === 1 ? '' : 's'}`,
            evidence.boardUnreadable ? 'Hypothesis board unreadable' : `${evidence.hypotheses.length} claim${evidence.hypotheses.length === 1 ? '' : 's'} on the hypothesis board`,
            `${evidence.pains.length} pain theme${evidence.pains.length === 1 ? '' : 's'}`,
          ]}
          action={<Link data-testid="link-rail-open-workspace" to={stageLinks.interviews} state={workspaceNavigationState}>Open interviews <ChevronRight size={14} /></Link>}
          footer="Traceable surface · no unsupported automated actions"
        />
      </section>
    </main>
  );
}

function EvidenceCards({ loading, projects, projectId, fillsOn, onApplied, featured, interviews, evidence, signals, dateFormat, stageLinks, workspaceNavigationState, bar }) {
  const cards = evidence.hypotheses.slice(0, 6);
  const retry = onApplied;
  return <div className="validate-sections">
    <section className="evidence-card" id="validate-0"><SectionHead icon={MessageSquare} title="Interview library" meta={loading ? 'Reading source records' : `${interviews.length} logged · ${loggedThisWeek(interviews)} this week`} />
      {loading ? <Skeleton rows={4} /> : !projects.length ? <Empty icon={Target} text="No startup is available to this view yet." action="Choose or create a startup on the interviews page." link={stageLinks.interviews} linkState={workspaceNavigationState} label="Open interviews" /> : featured ? <div className="source-quote">{featured.transcript != null && <div className="source-transcribed" data-testid="mark-transcribed"><span>Transcribed{featured.transcribed_by_model ? ` · ${featured.transcribed_by_model}` : ''}</span>{clipLength(featured.recording_duration_sec) ? <span className="num">{clipLength(featured.recording_duration_sec)}</span> : null}</div>}<div className="source-label"><span>Recorded evidence</span><span>{dateFormat(featured.interview_date)}</span></div><strong>{clean(featured.interviewee_name) || 'Unnamed interviewee'}{featured.interviewee_role ? ` · ${featured.interviewee_role}` : ''}</strong><p><Quote size={14} /> {quoteFrom(featured.notes)}</p><div className="source-foot">Source: interview notes · {(featured.hypotheses || []).length} hypothesis record{(featured.hypotheses || []).length === 1 ? '' : 's'} · {(featured.pains || []).length} pain tag{(featured.pains || []).length === 1 ? '' : 's'}</div></div> : <Empty icon={FileText} text="No recorded interview notes with a usable quote yet." action="Log evidence on the interviews page; this desk only shows recorded material." link={stageLinks.interviews} linkState={workspaceNavigationState} label="Open interviews" />}
      {/* THE ARTBOARD'S `Accept tags · Review each · Discard` BAND, under the
          featured quote: the phrases these interviews logged, sorted into the
          pain map's themes. The SAME component and kind the pain-map page
          mounts (`FounderValidateWorkspace`), so a tag accepted here is the
          same alias write as one accepted there. Off until the founder turns
          the Validate mode on — every run spends their own budget. */}
      <FillProposals key="overview-pain-tags" projectId={projectId} kind="pain_tag" enabled={fillsOn} onApplied={onApplied} />
      {!loading && interviews.length > 0 && <div className="interview-table"><div className="table-head"><span>Person</span><span>Role</span><span>Date</span><span>Quotes</span></div>{interviews.slice(0, 6).map((item) => <div className="table-row" key={item.id}><strong>{clean(item.interviewee_name) || 'Unnamed'}</strong><span>{clean(item.interviewee_role) || 'Not recorded'}</span><span>{dateFormat(item.interview_date)}</span><span>{quoteCount(item)}{quoteCount(item) > 0 && !quotable(item) ? <em className="not-quotable" title={item.quote_consent === false ? 'Consent was declined, so nothing here can be quoted.' : 'Nobody has asked for consent yet, so nothing here can be quoted.'}> · not quotable</em> : null}</span></div>)}</div>}
      <div className="evidence-ops" data-testid="ops-interviews">
        <Link data-testid="op-record-now" to={`${stageLinks.interviews}${stageLinks.interviews.includes('?') ? '&' : '?'}new=record`} state={workspaceNavigationState}>+ Record now</Link>
        <Link data-testid="op-upload-audio" to={`${stageLinks.interviews}${stageLinks.interviews.includes('?') ? '&' : '?'}new=upload`} state={workspaceNavigationState}>Upload audio</Link>
        <Link data-testid="op-type-notes" to={`${stageLinks.interviews}${stageLinks.interviews.includes('?') ? '&' : '?'}new=notes`} state={workspaceNavigationState}>Type notes</Link>
      </div>
      <Link data-testid="link-manage-interviews" className="manage-link" to={stageLinks.interviews} state={workspaceNavigationState}>Manage interviews and source notes <ChevronRight size={14} /></Link>
    </section>
    <section className="evidence-card" id="validate-1"><SectionHead icon={Layers3} title="Pain map" meta={painLabel(evidence.pains.length)} sub="Edit any grouping on the pain map" />{loading ? <Skeleton rows={3} /> : evidence.pains.length ? <div className="pain-map">{evidence.pains.slice(0, 8).map((pain) => <div className="pain-row" key={pain.name}><strong>{pain.name}</strong><div><i style={{ width: `${Math.max(7, pain.count / evidence.maxPain * 100)}%` }} /></div><span>{pain.count} recorded</span></div>)}</div> : <Empty icon={Layers3} text="No pains have been logged or curated yet." action="Pain counts appear only after a recorded pain is grouped." link={stageLinks.pains} linkState={workspaceNavigationState} label="Open the pain map" />}<Link data-testid="link-open-pain-map" className="manage-link" to={stageLinks.pains}>Open the pain map <ChevronRight size={14} /></Link></section>
    <section className="evidence-card" id="validate-2"><SectionHead icon={Target} title="Hypotheses" meta={evidence.boardUnreadable ? 'Board unreadable' : `${evidence.hypotheses.length} claim${evidence.hypotheses.length === 1 ? '' : 's'} on the board`} sub="Each carries its evidence" />{loading ? <Skeleton rows={2} /> : evidence.boardUnreadable ? <Unreadable what="The hypothesis board" claim="This is not a sign that no claim is recorded." onRetry={retry} /> : cards.length ? <div className="hypothesis-grid">{cards.map((item) => <article className={`hypothesis hypothesis-${item.verdict || 'withheld'}`} key={item.id} data-testid={`card-desk-hypothesis-${item.id}`}><span>{verdictLabel(item)}</span><strong>{item.claim}</strong><small>{claimEvidence(item, bar)}</small></article>)}</div> : <Empty icon={Target} text="No hypotheses have been stored yet." action="Create and assess them on the hypotheses page." link={stageLinks.hypotheses} linkState={workspaceNavigationState} label="Open hypotheses" />}
      {/* THE ARTBOARD'S `Proposal · Advisor` BAND — "Three interviews mention
          procurement blocking a trial, which no hypothesis covers yet", and a
          drafted card under it. This is the SAME component the hypotheses page
          mounts, with the same `hypothesis` kind: one drafter, so a claim
          accepted here and a claim accepted there are the same write, and the
          copy about what accepting means cannot drift between two surfaces.
          Gated on the same per-workspace mode, which is OFF until a founder
          turns it on — every run spends their own budget. */}
      <FillProposals key="overview-hypotheses" projectId={projectId} kind="hypothesis" enabled={fillsOn} onApplied={onApplied} />
      <Link data-testid="link-open-hypotheses" className="manage-link" to={stageLinks.hypotheses}>Open hypotheses <ChevronRight size={14} /></Link></section>
    <section className="evidence-card" id="validate-3"><SectionHead icon={FileText} title="Validation summary" meta="Living verdict · rewrites as evidence lands" /><Verdict evidence={evidence} interviews={interviews} signals={signals} link={stageLinks.hypotheses} onRetry={retry} /><Link data-testid="link-open-verdict" className="manage-link" to={stageLinks.verdict}>Open the verdict <ChevronRight size={14} /></Link></section>
  </div>;
}
/**
 * The artboard's `zh` row: a title, a count, and the line that says what the
 * card is FOR.
 *
 * `sub` carries the artboard's second half — "each carries its evidence",
 * "edit any grouping" — which the count alone cannot say. Two of the three
 * were dropped when this desk was first built and the third
 * ("Derived from stored records") was a description of the plumbing rather
 * than of the card.
 */
function SectionHead({ icon: Icon, title, meta, sub }) { return <div className="section-head"><div><Icon size={16} /><h2>{title}</h2></div><span>{meta}{sub ? <em className="section-sub"> · {sub}</em> : null}</span></div>; }
function Empty({ icon: Icon, text, action, link, linkState, label = 'Open the stage page' }) { return <div className="evidence-empty"><Icon size={21} /><div><strong>{text}</strong><p>{action}</p><Link data-testid="link-empty-to-workspace" to={link} state={linkState}>{label} <ChevronRight size={13} /></Link></div></div>; }
function Skeleton({ rows }) { return <div className="evidence-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function painLabel(count) { return count ? `${count} recorded pain theme${count === 1 ? '' : 's'}` : 'No curated pains'; }
/**
 * What a claim's evidence IS, from the board's own counts.
 *
 * "Each carries its evidence" is the artboard's subtitle. The counts are the
 * worker's (`evidenceFor`): ICP interviews that support the claim, and every
 * interview that contradicts it. `bar_note` is null exactly when the fit is
 * unrecorded, and then `_note` says why no distance can be given.
 */
function claimEvidence(item, bar) {
  const e = item.evidence || {};
  const counts = `${e.supporting ?? 0} ICP interview${e.supporting === 1 ? '' : 's'} support · ${e.contradicting ?? 0} contradict`;
  const distance = item.bar_note || clean(item._note) || (bar ? `bar is ${bar}` : '');
  return distance ? `${counts} · ${distance}` : counts;
}
/**
 * THE LIVING VERDICT, ONE CLAUSE PER CLAIM, EACH A LINK TO ITS RECEIPTS.
 *
 * The artboard's provenance shield promises that "every clause above links to
 * the quotes behind it". A claim's quotes are the interviews that touch the
 * pain themes it is linked to, and the page that lays those links out is
 * `/validate/hypotheses` — so each clause is a link there, never a sentence
 * with nothing under it. A claim whose verdict is withheld says so rather than
 * reading as unproven.
 */
function Verdict({ evidence, interviews, signals, link, onRetry }) {
  if (evidence.boardUnreadable) return <div className="verdict"><Unreadable what="The hypothesis board" claim="No verdict is stated from a board that could not be read." onRetry={onRetry} /></div>;
  const clauses = evidence.hypotheses.filter((claim) => claim.verdict || claim._note).slice(0, 6);
  return <div className="verdict">{clauses.length ? <><p>Across <strong>{interviews.length} interview{interviews.length === 1 ? '' : 's'}</strong>, the board holds:</p><ul className="verdict-clauses" data-testid="list-verdict-clauses">{clauses.map((claim) => <li key={claim.id}><Link data-testid={`link-verdict-clause-${claim.id}`} to={link}><strong>{claim.claim}</strong> is {claim.verdict ? verdictLabel(claim).toLowerCase() : 'withheld — ICP fit not recorded'}</Link>{claim.bar_note ? <small> · {claim.bar_note}</small> : null}</li>)}</ul></> : <p>There is not enough stored hypothesis evidence to state a verdict yet.</p>}{signals?.factors?.signals && <small>Discovery signal: {signals.factors.signals.points} / {signals.factors.signals.max} points from the current project.</small>}<div className="provenance">Provenance · each clause opens its claim on the hypotheses page, where the pain themes and interviews behind it are linked.</div></div>;
}
