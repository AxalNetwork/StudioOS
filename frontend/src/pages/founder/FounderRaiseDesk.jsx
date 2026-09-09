import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, ChevronRight, FileText, Folder, Landmark, Scale, Sparkles, Target } from 'lucide-react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import ZoneDraft from '../../workspaces/ZoneDraft';
import useAssistMode from '../../hooks/useAssistMode';
import { zonePillClass } from './deskZoneNav';
import './founderRaiseDesk.css';

// Six labels, six routes — A4's `anchR`, in its order. This was a six-deep
// ternary chain ending in an `<a href="#raise-…">` fallback no label could
// reach — every branch already resolved to a Link, so the anchor was dead code
// the shape still advertised.
const SECTIONS = [
  ['Status', 'status'], ['Pitch', 'pitch'], ['Capital', 'capital'],
  ['Legal', 'legal'], ['Data room', 'data-room'], ['Liquidity', 'liquidity'],
];

const asList = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
const clean = (value) => String(value || '').trim();
const money = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? 'Not recorded'
  : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
const date = (value) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const status = (value) => clean(value).replace(/[_-]/g, ' ') || 'Not recorded';
/** Whole days since a stored timestamp, or null when there is none to count from. */
const daysSince = (value) => {
  const t = Date.parse(String(value || ''));
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};
/**
 * A4's status card is a FUNNEL, and the endpoint has returned one all along.
 *
 * `GET /api/contacts/raise-round` carries `progress` — wired, signed, soft,
 * committed, pipeline, committed_pct, remaining (`services/roundMath.ts`) —
 * and this desk read `raised` alone, so the artboard's two-segment bar and its
 * "signed / soft-circled" legend had nothing to draw from even though the
 * numbers were already on the wire.
 */
const RAISE_STAGES_IN_PLAY = ['contacted', 'meeting', 'diligence'];

export default function FounderRaiseDesk() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const seed = location.state?.founderRaiseSeed;
  const [projects, setProjects] = useState(() => seed?.projects || []);
  const [projectId, setProjectId] = useState(() => Number(searchParams.get('project_id')) || seed?.projectId || null);
  const [records, setRecords] = useState(() => seed?.records || {});
  const [loading, setLoading] = useState(!seed);
  const [projectError, setProjectError] = useState('');
  const [errors, setErrors] = useState({});
  const [reload, setReload] = useState(0);
  const [fillsOn] = useAssistMode('Raise');

  useEffect(() => {
    let alive = true;
    setLoading(true); setProjectError('');
    api.listProjects().then((response) => {
      if (!alive) return;
      const list = asList(response, 'items');
      const requested = Number(searchParams.get('project_id'));
      const selected = list.find((item) => Number(item.id) === requested) || list.find((item) => Number(item.id) === Number(projectId)) || list[0];
      setProjects(list); setProjectId(selected?.id || (requested || null));
      if (!selected && requested) setProjects([{ id: requested, name: `Startup #${requested}` }]);
    }).catch((error) => {
      if (!alive) return;
      const requested = Number(searchParams.get('project_id'));
      if (requested) { setProjects([{ id: requested, name: `Startup #${requested}` }]); setProjectId(requested); }
      setProjectError(error?.message || 'The project list is unavailable.');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const project = projects.find((item) => Number(item.id) === Number(projectId));
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('project_id', String(projectId)); return next; }, { replace: true });
    setLoading(true); setErrors({});
    const calls = {
      round: api.raiseRound(projectId),
      prospects: api.raiseProspects(projectId),
      legal: api.listDocuments(projectId),
      deck: api.deckListVersions(projectId),
      room: project?.uid ? api.dataRoom(project.uid) : Promise.reject(new Error('Project room identifier is unavailable.')),
    };
    Promise.allSettled(Object.entries(calls).map(async ([key, request]) => [key, await request])).then((results) => {
      if (!alive) return;
      const next = {}; const nextErrors = {};
      results.forEach((result, index) => {
        const key = Object.keys(calls)[index];
        if (result.status === 'fulfilled') next[key] = result.value[1];
        else nextErrors[key] = result.reason?.message || 'Unavailable';
      });
      setRecords(next); setErrors(nextErrors);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, projects, reload, setSearchParams]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const data = useMemo(() => {
    const prospects = asList(records.prospects, 'items');
    const docs = asList(records.legal, 'documents');
    const versions = asList(records.deck, 'versions');
    const room = records.room || {};
    return {
      prospects, docs, versions, room,
      roundInfo: records.round || { round: null, raised: 0, committed_count: 0 },
      progress: records.round?.progress || null,
      inPlay: prospects.filter((row) => RAISE_STAGES_IN_PLAY.includes(clean(row.stage))).length,
    };
  }, [records]);
  const query = projectId ? `?project_id=${projectId}` : '';
  const state = { founderRaiseSeed: { projects, projectId, records } };

  return <main className="raise-desk" data-testid="founder-raise-desk">
    <section className="raise-canvas">
      <div className="raise-main">
        <header className="raise-hero">
          <div className="raise-heading"><div><h1>Get capital, stay legal</h1><p>The highest-stakes page in the product. Its model menu leads with quality, because a wrong answer here costs more than tokens.</p></div>
            {projects.length > 1 && <select data-testid="select-raise-project" value={projectId || ''} onChange={(event) => setProjectId(Number(event.target.value))}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          </div>
          <nav className="raise-anchors" aria-label="Raise desk sections">{SECTIONS.map(([label, slug]) => <NavLink data-testid={`link-raise-anchor-${slug}`} to={`/raise/${slug}${query}`} key={label} className={zonePillClass}>{label}</NavLink>)}</nav>
        </header>
        {(projectError || Object.keys(errors).length > 0) && <div className="raise-error" data-testid="status-raise-partial"><AlertCircle size={16} /><span>{projectError || 'Some selected-project records are unavailable.'}</span><button data-testid="button-retry-raise" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
        <RaiseSections loading={loading} project={project} data={data} errors={errors} query={query} state={state} projectId={projectId} fillsOn={fillsOn} />
      </div>
      <WorkerRail
        workspace="Raise"
        className="raise-rail"
        stance="Manual raise view"
        note="This surface reads selected-project records only. It does not generate, score, or change fundraising materials."
        coverage={[
          `${data.prospects.length} prospect${data.prospects.length === 1 ? '' : 's'} · ${data.docs.length} legal doc${data.docs.length === 1 ? '' : 's'}`,
          `${data.versions.length} deck version${data.versions.length === 1 ? '' : 's'} · ${asList(data.room, 'files').length} data-room file${asList(data.room, 'files').length === 1 ? '' : 's'}`,
        ]}
        action={<Link data-testid="link-rail-open-raise-workspace" to={`/raise/pitch${query}`} state={state}>Open pitch <ArrowUpRight size={13} /></Link>}
      />
    </section>
  </main>;
}

function RaiseSections({ loading, project, data, errors, query, state, projectId, fillsOn }) {
  // `prospects` is deliberately not destructured here. The status card counted
  // every stored prospect before A4; it now reads `inPlay`, which is the same
  // list narrowed to the three stages that are actually in play, and the full
  // count survives where it belongs — the rail's coverage line, off `data`.
  // CodeQL raised the leftover binding (alert 6054).
  const { roundInfo, progress, docs, versions, room, inPlay } = data;
  const round = roundInfo.round;
  const target = round?.target_amount;
  const files = asList(room, 'files'); const folders = asList(room, 'folders'); const grants = asList(room, 'grants');
  const activeGrants = grants.filter((grant) => clean(grant.status) === 'active');
  const access = asList(room, 'recent_access');
  const current = versions.find((deck) => deck.is_current) || versions[0];
  // A LITERAL `surface=` ON A `<ZoneDraft>` ELEMENT, four times, rather than a
  // helper taking a props object. `research_ask_session` censuses every mount
  // in the tree against `DRAFT_SURFACES` and reads the surface off the JSX
  // attribute — which is what caught five bands shipping with no allow-list
  // entry, 400ing in silence behind a page that looked finished. A helper hides
  // the mount from that census, so the repetition is the point.
  const bandOn = fillsOn && Boolean(projectId);
  const scope = String(projectId || '');
  return <div className="raise-sections">
    <section className="raise-status-card" id="raise-status"><Head icon={Target} title="Round status" meta={loading ? 'Reading source records' : roundLabel(round)} />
      {loading ? <Skeleton rows={2} /> : !project ? <Empty icon={Target} title="No startup is available to this view yet." body="Select or create a startup to see its raise records." /> : errors.round && errors.prospects ? <Unavailable /> : <>
        <div className="raise-headline">
          <div><strong data-testid="text-raise-committed">{money(progress ? progress.committed : roundInfo.raised)}</strong><span>of {money(target)}</span></div>
          <div className="status-grid">
            <Metric label="Days open" value={daysOpen(round)} />
            <Metric label="Investors in play" value={`${inPlay} stored`} />
            <Metric label="Projected close" value={date(round?.close_date)} />
          </div>
        </div>
        <RoundBar progress={progress} target={target} />
        {round?.notes && <p className="round-notes">{round.notes}</p>}
        <p className="source-note">{round ? 'Committed and soft-circled totals are the stored allocation states — signed and wired count as committed, soft-circled does not. No blocker is recorded against a round, so none is counted.' : 'No round is recorded for this startup.'}</p>
      </>}<DeskLink testid="link-open-round-status" to={`/raise/status${query}`} state={state}>Open round status</DeskLink>
    </section>
    <div className="raise-pair">
      <section className="raise-card" id="raise-capital"><Head icon={Landmark} title="Capital · dilution" meta="Round planner" />{loading ? <Skeleton rows={3} /> : errors.round ? <Unavailable /> : <><div className="capital-figures"><Metric label="Round target" value={money(target)} /><Metric label="Committed" value={money(progress ? progress.committed : roundInfo.raised)} /><Metric label="Pre-money" value={money(round?.pre_money)} /></div>
        {bandOn ? <ZoneDraft
          surface="raise/capital"
          scopeKey={scope}
          accent="violet"
          label="Proposal · plain-language read"
          run="Read the round back"
          accept="Attach to scenario"
          empty="Nothing proposed yet. Eadwyn will read your round and cap-table scenario back in plain language, and show every step of the arithmetic."
          nothingToDraft="No round and no cap-table scenario are recorded for this startup yet."
          foot="Shown step by step, because you will be asked to defend this number."
        /> : null}
        <DeskLink testid="link-open-capital" to={`/raise/capital${query}`} state={state}>Open capital planner</DeskLink></>}</section>
      <section className="raise-card" id="raise-legal"><Head icon={Scale} title="Legal engine" meta={loading ? 'Reading documents' : termSheetLabel(docs)} />{loading ? <Skeleton rows={3} /> : errors.legal ? <Unavailable /> : <><div className="legal-list">{docs.slice(0, 4).map((doc, index) => <div key={doc.id || index}><FileText size={14} /><span>{clean(doc.title || doc.name || doc.doc_type) || 'Untitled document'}</span><small>{status(doc.status)}</small></div>)}{!docs.length && <Empty icon={FileText} title="No legal documents are recorded." body="Stored legal documents appear here." />}</div>
        {bandOn ? <ZoneDraft
          surface="raise/legal"
          scopeKey={scope}
          accent="violet"
          tone="warn"
          label="Clause explained"
          run="Explain the clauses"
          accept="Keep this reading"
          empty="Nothing proposed yet. Eadwyn will read the documents you have stored and name the clauses worth looking at again, quoting each one."
          nothingToDraft="No stored legal document has any text to read."
          foot="Not legal advice. Counsel is on the Team page."
        /> : null}
        <DeskLink testid="link-open-legal" to={`/raise/legal${query}`} state={state}>Open legal collection</DeskLink></>}</section>
    </div>
    <section className="raise-card" id="raise-data-room"><Head icon={Folder} title="Data room" meta={loading ? 'Reading room' : `${files.length + folders.length} artifact${files.length + folders.length === 1 ? '' : 's'} · ${activeGrants.length} investor${activeGrants.length === 1 ? '' : 's'} with access`} />{loading ? <Skeleton rows={3} /> : errors.room ? <Unavailable /> : <>
      {bandOn ? <ZoneDraft
        surface="raise/data-room"
        scopeKey={scope}
        accent="violet"
        label="Gap analysis"
        run="Read the room"
        accept="Keep this reading"
        empty="Nothing proposed yet. Eadwyn will read what this room holds, what sits behind NDA, and what the investors with access have actually opened."
        nothingToDraft="This room holds no folders and no files yet."
        foot="Read from the room itself, never from a generic diligence checklist."
      /> : null}
      <div className="artifact-grid">{[...folders.map((item) => ({ ...item, kind: 'Folder' })), ...files.map((item) => ({ ...item, kind: 'File' }))].slice(0, 8).map((item, index) => <article key={item.uid || index}><span>{item.kind}</span><strong>{clean(item.name) || 'Unnamed artifact'}</strong><small>{artifactState(item, access)}</small></article>)}{!files.length && !folders.length && <Empty icon={Folder} title="No artifacts are recorded in this room." body="This workspace does not create placeholders." />}</div>
      <p className="source-note">Nothing is screened before it is shared: no content review runs anywhere in this build, so no artifact carries a screened mark.</p>
      <DeskLink testid="link-open-data-room" to={`/raise/data-room${query}`} state={state}>Open data room</DeskLink></>}</section>
    <section className="raise-card" id="raise-pitch"><Head icon={Sparkles} title="Pitch" meta={loading ? 'Reading versions' : deckLabel(current, versions)} />{loading ? <Skeleton rows={2} /> : errors.deck ? <Unavailable /> : <><div className="deck-list">{versions.slice(0, 4).map((deck, index) => <div key={deck.id || index}><strong>{clean(deck.name || deck.title) || `Version ${deck.version ?? index + 1}`}</strong><span>{slideCount(deck)}</span><small>{status(deck.status || deck.updated_at || deck.created_at)}</small></div>)}{!versions.length && <Empty icon={Sparkles} title="No deck version is recorded." body="Create or edit a deck in the detailed workspace." />}</div><p className="source-note">Cover imagery is not generated here, and nothing investor-facing passes a content review before it is shared — neither exists in this build.</p><DeskLink testid="link-open-pitch-workspace" to={`/raise/pitch${query}`} state={state}>Open pitch</DeskLink></>}</section>
    <section className="raise-card exits" id="raise-liquidity"><Head icon={Landmark} title="Liquidity & exits" meta="Nothing live — modelled, not marketed" />
      <p>No secondary is open, and none should be at seed. This zone exists so the waterfall is understood <em>before</em> terms are signed rather than after — but no liquidation preference, participation right or exit model is recorded for this company, so there is no waterfall to draw and this desk does not invent one.</p>
      {bandOn ? <ZoneDraft
        surface="raise/liquidity"
        scopeKey={scope}
        accent="violet"
        label="Proposal · plain-language read"
        run="Explain the order of payment"
        accept="Attach to term sheet"
        empty="Nothing proposed yet. Eadwyn will explain who is paid what and in what order from your cap table and round — and name every term the answer needs that nothing here records."
        nothingToDraft="No cap-table scenario is recorded, so there is no ownership to pay out."
        foot="No preference term is stored, so none is assumed."
      /> : null}
      <DeskLink testid="link-open-liquidity" to={`/raise/liquidity${query}`} state={state}>Open liquidity</DeskLink></section>
  </div>;
}

/** A4's eyebrow: the round's own name and how long it has been open. */
function roundLabel(round) {
  if (!round) return 'No round recorded';
  const days = daysSince(round.created_at);
  const opened = round.created_at ? ` · open since ${date(round.created_at)}` : '';
  return `${clean(round.name) || 'Unnamed round'}${days === null ? '' : opened}`;
}
function daysOpen(round) {
  const days = daysSince(round?.created_at);
  return days === null ? 'Not recorded' : `${days}`;
}
/**
 * The artboard's two-segment bar: committed against soft-circled, both against
 * target. `progress` is what the endpoint already returned; the legend prints
 * the two figures rather than only the ratio, so a founder can see which half
 * of the bar is a signature and which is a conversation.
 */
function RoundBar({ progress, target }) {
  if (!progress || !(Number(target) > 0)) {
    return <p className="source-note" data-testid="text-raise-no-bar">No target is recorded for this round, so there is no share of it to draw.</p>;
  }
  const pct = (value) => Math.max(0, Math.min(100, (Number(value) || 0) / Number(target) * 100));
  const committed = pct(progress.committed);
  const soft = Math.max(0, Math.min(100 - committed, pct(progress.soft)));
  return <>
    <div className="raise-progress" data-testid="chart-raise-progress"><i className="is-committed" style={{ width: `${committed}%` }} /><i className="is-soft" style={{ width: `${soft}%` }} /></div>
    <div className="raise-legend">
      <span className="is-committed">{money(progress.committed)} signed or wired</span>
      <span className="is-soft">{money(progress.soft)} soft-circled</span>
      {progress.remaining != null ? <span>{money(progress.remaining)} to target</span> : null}
    </div>
  </>;
}
/** The counterparty on the most recent term sheet, when one is stored. */
function termSheetLabel(docs) {
  const sheet = docs.find((doc) => /term.?sheet/i.test(`${doc.doc_type || ''} ${doc.title || ''}`));
  if (!sheet) return `${docs.length} stored document${docs.length === 1 ? '' : 's'}`;
  return `Term sheet · ${clean(sheet.title) || status(sheet.status)}`;
}
function slideCount(deck) {
  return Array.isArray(deck?.slides) ? `${deck.slides.length} slide${deck.slides.length === 1 ? '' : 's'}` : 'Slide count not recorded';
}
/** A4's `11 slides · v4 shared with 3 investors`, minus the share count. */
function deckLabel(current, versions) {
  if (!current) return 'No deck version recorded';
  const version = current.version == null ? null : `v${current.version}`;
  return [slideCount(current), version, `${versions.length} stored version${versions.length === 1 ? '' : 's'}`]
    .filter(Boolean).join(' · ');
}
/**
 * A4 prints `Shared · 3 viewers` under an artifact. The room's access log is
 * the only record of a view, and it names files rather than folders — so a
 * folder gets its visibility and nothing that pretends to be a view count.
 */
function artifactState(item, access) {
  const visibility = status(item.visibility);
  if (item.kind !== 'File') return visibility;
  const viewers = new Set(access.filter((row) => row.file_name === item.name).map((row) => row.user_email)).size;
  return viewers ? `${visibility} · ${viewers} viewer${viewers === 1 ? '' : 's'}` : `${visibility} · never opened`;
}
function Head({ icon: Icon, title, meta }) { return <div className="raise-head"><div><Icon size={16} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Metric({ label, value }) { return <div className="raise-metric"><span>{label}</span><strong>{value}</strong></div>; }
function Skeleton({ rows }) { return <div className="raise-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function Unavailable() { return <div className="raise-unavailable">This selected-project record is unavailable. Retry when the source is reachable.</div>; }
function Empty({ icon: Icon, title, body }) { return <div className="raise-empty"><Icon size={19} /><div><strong>{title}</strong><p>{body}</p></div></div>; }
function DeskLink({ to, state, testid, children }) { return <Link data-testid={testid} className="raise-link" to={to} state={state}>{children}<ChevronRight size={14} /></Link>; }
