import TypeformJourney from '../TypeformJourney';
/**
 * Validate's entry in CycleRoute.jsx's cycle table (D661, #1474; split out
 * by D5615, #5615): its modules, the Record a session action and the
 * `RecordMount` lightbox it opens (D685, D686), its tools and Add, the fill
 * bands, the three bottom sections (D697) and its record pages.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { cyclesApi, cyclesWrite } from '../../../lib/api/cycles';
import { cycleValidateApi } from '../../../lib/api/cycleValidate';
import { validateExportsApi } from '../../../lib/api/founderValidateExports';
import { useRailOption } from '../../../ui/railCrumbs';
import Lightbox from '../../../ui/Lightbox';
import RecordLightbox from '../../founder/RecordLightbox';
import { interviewListOf } from '../../../lib/discoveryEvidence';
import { useActiveRecording } from '../../../contexts/ActiveRecordingContext';
import RecordView from '../RecordView';
import FromLovable from '../FromLovable';
import VerdictHome from '../VerdictHome';
import ValidateExperiments from '../ValidateExperiments';
import ValidateFromGoogle from '../ValidateFromGoogle';
import FromNotion from '../FromNotion';
import MarketReadiness, { sizingHref } from '../ValidateMarketReadiness';
import MarketFigureHistory from '../MarketFigureHistory';
import { ValidateDemandPosthog, ValidateExperimentsPosthog } from '../ValidatePosthog';
import NotionInterviewImport from '../NotionInterviewImport';
import { InterviewsSection, PainThemesSection, HypothesesSection, SegmentsSection, ThemeRecordParts } from '../ValidateSections';
import HypothesisRecord from '../HypothesisRecord';
// D5998 (#5998): Validate's V2 overview (boards V1, V2, V13), mounted through `Overview` as Grow's and Build's are.
// Imported statically: its lead (`ValidateLead`, `ValidateObjective`, `PmfChip`) is already in the route's bundle.
import ValidateOverview from '../ValidateOverview';
import { painThemesApi } from '../../../lib/api/painThemes.js';
import { formFor } from '../forms';
import { toFnMap } from '../adapters';
import { MODULES } from '../modules';
import { lazyStep } from '../lazyStep.jsx';
import WaitlistBar from '../ValidateWaitlistBar.jsx';
import { PrepareQuestions } from '../InterviewGuide.jsx';
import { WaitlistLeads, addLeadButton, moveStageAction } from '../ResearchPipeline.jsx';
import { MODULE_LINK_CLASS, projectSearch } from '../founderToolNavigation.js';
import SegmentCompare from '../SegmentCompare.jsx';
import { inCompare, withCompare } from '../segmentCompareModel.js';

// D4574 (#4574, H5): Validate's steps, each behind its own lazy boundary.
const InterviewRecord = lazyStep(() => import('../../founder/InterviewReviewPage'));
const VerdictRecordWithPlan = lazyStep(() => import('../BuildPlan'), 'VerdictRecordWithPlan');

/**
 * A quiet Export button: the CSV downloads, or the Worker's sentence shows
 * (a 403, or D4585's 503 when a source could not be read). D693 decision 13's
 * Export summary is the first; D6019 (#6019) gives Market intelligence, Demand
 * and urgency signals and Experiments and evidence the same button.
 */
function ExportCsv({ projectId, run: exportCsv, label, failure, testId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = () => {
    if (!projectId || busy) return;
    setBusy(true); setError('');
    Promise.resolve().then(() => exportCsv(projectId))
      .catch((e) => setError(e?.message || failure))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid={testId}>
      <button type="button" onClick={run} disabled={busy}
        className="rounded-lg border border-axal-hairline px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">
        {busy ? 'Exporting…' : label}
      </button>
      {error && <span role="alert" className="text-[12px] text-red-700 dark:text-red-400">{error}</span>}
    </div>
  );
}

/**
 * D693 decision 13: Export summary, the verdict zone's CSV (`founder_validate.ts`,
 * gated by `canReadDecision` as the module is).
 */
function ExportSummary({ projectId }) {
  return <ExportCsv projectId={projectId} run={() => api.exportValidateSummary(projectId)} label="Export summary"
    failure="The summary could not be exported." testId="verdict-export-summary" />;
}

/** D6019 (#6019): the three module exports, each in its module's part. */
export const MODULE_EXPORTS = {
  'market-intelligence': { run: (id) => validateExportsApi.competitors(id), label: 'Export competitors', failure: 'The competitor list could not be exported.', testId: 'validate-export-competitors' },
  'demand-signals': { run: (id) => validateExportsApi.signals(id), label: 'Export signals', failure: 'The signals could not be exported.', testId: 'validate-export-signals' },
  experiments: { run: (id) => validateExportsApi.evidence(id), label: 'Export evidence', failure: 'The evidence could not be exported.', testId: 'validate-export-evidence' },
};
const ModuleExport = ({ slug, projectId }) => <ExportCsv projectId={projectId} {...MODULE_EXPORTS[slug]} />;

/**
 * The lightbox, with the interview it was opened on (`?interview=<id>`, from a
 * row's "Record a session") read first so Who is pre-filled.
 *
 * D4625 (#4625): `listInterviews` answers `{ project_id, interviews: [...] }`,
 * which `interviewListOf` decodes. The requested interview is one of four
 * things, and never silently another:
 *   - none requested: the intentional new-person flow (no read at all);
 *   - found: the lightbox opens on it, Who pre-filled, and Start attaches the
 *     session to that interview;
 *   - not in this venture's list (missing, or out of the caller's scope): said
 *     so, with a deliberate "Record someone new" and a Close;
 *   - unreadable (the read failed, or its answer was not a list): said so,
 *     with Try again. It never falls into the new-person flow.
 * A result is kept with the venture and interview it was read for, so
 * switching either while a read is in flight can never show or apply the
 * earlier one.
 */
export function RecordMount({ projectId, interviewId, setupKey, onClose, onStarted, asPage, read = (id) => api.listInterviews(id), lightboxProps }) {
  const { recorder } = useActiveRecording();
  // D768: while Record a session is open, the rail is that option's (transcription).
  useRailOption('transcribe:interview', 'Record a session');
  const key = interviewId ? `${projectId}|${interviewId}` : null;
  const [result, setResult] = useState(null); // { key, status: 'ready' | 'missing' | 'error', interview }
  const [attempt, setAttempt] = useState(0);
  const [newFor, setNewFor] = useState(null); // the key the founder chose "Record someone new" for
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    const settle = (next) => { if (alive) setResult({ key, ...next }); };
    Promise.resolve().then(() => read(projectId))
      .then((res) => {
        const rows = interviewListOf(res);
        if (!rows) { settle({ status: 'error', interview: null }); return; }
        const found = rows.find((r) => String(r.id) === String(interviewId));
        settle(found ? { status: 'ready', interview: found } : { status: 'missing', interview: null });
      })
      .catch(() => settle({ status: 'error', interview: null }));
    return () => { alive = false; };
  }, [key, projectId, interviewId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- `read` is a test seam, not a trigger
  const lightbox = (interview) => <RecordLightbox projectId={projectId} interview={interview} initialClientKey={setupKey} onClose={onClose} onStarted={onStarted} recorder={recorder} asPage={asPage} {...lightboxProps} />;
  if (!key) return lightbox(null);
  if (newFor === key) return lightbox(null);
  const current = result?.key === key ? result : null;
  if (!current) return null;
  if (current.status === 'ready') return lightbox(current.interview);
  const missing = current.status === 'missing';
  return (
    <Lightbox label="Record a session" eyebrow="Validate · Customer research" title="Record a session" onClose={onClose} testId="record-unavailable" {...asPage}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[9px] px-3 py-2 text-[12.5px] font-bold text-axal-muted hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" data-testid="record-unavailable-close">Close</button>
          {missing
            ? <button type="button" onClick={() => setNewFor(key)} className="rounded-[9px] bg-axal-violet px-3.5 py-2 text-[13px] font-bold text-white hover:bg-axal-violet-deep" data-testid="record-unavailable-new">Record someone new</button>
            : <button type="button" onClick={() => { setResult(null); setAttempt((n) => n + 1); }} className="rounded-[9px] bg-axal-violet px-3.5 py-2 text-[13px] font-bold text-white hover:bg-axal-violet-deep" data-testid="record-unavailable-retry">Try again</button>}
        </div>
      )}>
      <p className="m-0 text-[13px] leading-relaxed text-axal-ink dark:text-gray-100" role={missing ? 'status' : 'alert'} data-testid="record-unavailable-message">
        {missing
          ? 'That interview is not in this venture, or you cannot open it. Nothing was recorded.'
          : 'The interview could not be read just now, so the session was not set up. Nothing was recorded. Try again.'}
      </p>
    </Lightbox>
  );
}

const validate = {
  modules: MODULES.validate,
  Overview: ValidateOverview,
  // D685 §5.4: "Record a session" is the lightbox at /validate/record. A plain
  // click opens it over this page (`onOpen`); a new tab or a deep link follows
  // the href to the same place. The interview comes with it, or is made at Start.
  // D686: every cycle's action is `{ path, Mount }` on this one mechanism.
  path: 'record',
  Mount: ValidateMount,
  action: (q, open) => ({ label: 'Record a session', href: `/validate/record${q}`, onOpen: open }),
  tools: toFnMap({
    // D6010 (#6010): Size the market opens the sizing tool for this venture, to any founder of it.
    'market-intelligence': (q) => {
      const venture = new URLSearchParams(projectSearch(q)).get('project_id');
      return [
        { label: 'Open the competitor tracker', href: '/build/competitors' },
        { label: 'Size the market', href: venture ? sizingHref(venture) : '/validate/market-intelligence/sizing' },
      ];
    },
    'demand-signals': (search) => ({ label: 'Open the landing-page builder', href: '/build/brand' + projectSearch(search) }),
    // D6007 (#6007, V21): Compare segments opens the module's compare mode (owner option A: no new route).
    'ideal-customer-profile': (search) => ({ label: 'Compare segments', href: '/validate/ideal-customer-profile' + withCompare(projectSearch(search), []) }),
  }),
  // D6007 (#6007, V24): with `?compare=` the Ideal customer profile page is Compare segments: its body replaces
  // the chart and table, and its line says so. Without it the module draws as before.
  homes: toFnMap({
    'ideal-customer-profile': (data, ctx) => (inCompare(ctx.searchParams) ? {
      sub: 'Two to four segments side by side. Anything unwritten reads Not recorded.',
      action: null,
      body: () => <SegmentCompare projectId={ctx.projectId} records={data?.records} />,
    } : null),
    // D6018 (#6018, V10): the Verdict page leads with the evidence, then the choice.
    verdict: (data, ctx) => ({
      sub: 'Review the evidence, then choose.',
      action: null,
      body: (p) => <VerdictHome {...p} data={data} projectId={ctx.projectId} />,
    }),
  }),
  add: toFnMap({
    // D6001 (#6001): Record a session stays first (the zero state's one action); a writer also gets Add a lead.
    'customer-research': (q, open, ctx) => [{ text: 'Record a session', href: `/validate/record${q}`, onOpen: open },
      addLeadButton(ctx, cyclesWrite)].filter(Boolean),
  }),
  // D6001 (#6001): Move stage on each interview row, the record's `set-stage`, so the move is in its activity.
  rowActions: toFnMap({
    'customer-research': (row, ctx) => moveStageAction(row, ctx,
      (projectId, id, body) => cyclesApi.recordAction('validate', projectId, 'customer-research', id, 'set-stage', body)),
  }),
  // The AI fill bands the Validate desk carried, on the module they fill.
  fills: { 'problem-discovery': 'pain_tag', experiments: 'hypothesis' },
  // D697 (#1659): the three bottom sections, what the Interviews, Pain map
  // and Hypotheses pages drew. They read nothing: counts are the module
  // read's `parts`, writes are these callbacks, and the venture is always
  // the page's, never a row's. Each dialog goes through `ctx.openDialog`.
  parts: toFnMap({
    // D1092 (#2957): each of the three modules Google feeds draws its From Google part after its own section.
    'customer-research': (data, ctx) => (
      <>
        {/* D6008 (#6008): Prepare questions, the interview guide as a sheet (D5995 V27 B). */}
        <PrepareQuestions projectId={ctx.projectId} />
        <InterviewsSection parts={data?.parts} projectId={ctx.projectId} query={ctx.query} openDialog={ctx.openDialog}
          onLog={(payload) => api.createInterview(ctx.projectId, payload).then(ctx.reload)}
          onExport={() => api.exportValidateInterviews(ctx.projectId)} />
        {/* D6001 (#6001): the customer waitlist's sign-ups, where the card's "Invite the N new waitlist leads" lands. */}
        <WaitlistLeads projectId={ctx.projectId} canWrite={data?.parts?.can_write === true} projectSearch={ctx.projectId ? `?project_id=${encodeURIComponent(ctx.projectId)}` : ''}
          load={() => api.listWaitlistCustomers(ctx.projectId)}
          invite={(id) => api.inviteWaitlistCustomer(ctx.projectId, id)}
          followUp={(id) => api.followUpWaitlistCustomer(ctx.projectId, id)} />
        <TypeformJourney projectId={ctx.projectId} />
        <ValidateFromGoogle part={data?.parts?.from_google} module="customer_research" projectId={ctx.projectId} reload={ctx.reload} />
        {/* D1087 (#2952): interview pages from Notion, imported only with the interviewee's consent. */}
        <FromNotion section="validate" projectId={ctx.projectId} module="customer_research" acceptDialog={NotionInterviewImport} />
      </>
    ),
    // D6010 (#6010): the stored positioning and assumptions marks and the sources, under the table.
    // D1087 (#2952): research pages from Notion, as sources (title and link).
    // D6019 (#6019): each of the next three modules' parts opens with its Export.
    'market-intelligence': (data, ctx) => (
      <>
        <ModuleExport slug="market-intelligence" projectId={ctx.projectId} />
        <MarketReadiness projectId={ctx.projectId} />
        <FromNotion section="validate" projectId={ctx.projectId} module="market_intelligence" />
        {/* D6011 (#6011): every change to the three figures, with who and when. */}
        <MarketFigureHistory part={data?.parts?.market_history} />
      </>
    ),
    'demand-signals': (data, ctx) => (
      <>
        <WaitlistBar key={ctx.projectId} projectId={ctx.projectId}
          value={data?.parts?.waitlist_bar ?? null} unreadable={data?.parts?.waitlist_bar_unreadable === true}
          canWrite={data?.parts?.can_write === true} reload={ctx.reload} />
        {data?.parts?.lovable_connected && <Link className={`${MODULE_LINK_CLASS} min-h-11 content-center`}
          to={'/validate/experiments' + projectSearch(ctx.search)}>Open Lovable sign-ups</Link>}
        <ModuleExport slug="demand-signals" projectId={ctx.projectId} />
        <ValidateFromGoogle part={data?.parts?.from_google} module="demand_signals" projectId={ctx.projectId} reload={ctx.reload} />
        {/* D1605 (#3731): the founder's PostHog, beside the waitlist and never added to it. */}
        <ValidateDemandPosthog projectId={ctx.projectId} />
      </>
    ),
    'ideal-customer-profile': (data, ctx) => <SegmentsSection key={ctx.projectId} parts={data?.parts}
      onAssign={(interviewId, segmentId) => cycleValidateApi.setInterviewSegment(ctx.projectId, interviewId, segmentId).then(ctx.reload)} />,
    'problem-discovery': (data, ctx) => <PainThemesSection parts={data?.parts} projectId={ctx.projectId} query={ctx.query} openDialog={ctx.openDialog}
      onExport={() => api.exportValidatePainMap(ctx.projectId)}
      // #1692's `attach` on the theme record, so the theme's activity logs it.
      onAssign={(themeId, body) => cyclesApi.recordAction('validate', ctx.projectId, 'problem-discovery', themeId, 'attach', body).then(ctx.reload)}
      // #6006 (V17): the selection bar's one bulk write, to a theme or a new one.
      onAssignMany={(body) => painThemesApi.assignMany(ctx.projectId, body).then(ctx.reload)}
      newThemeHref={formFor('validate', 'problem-discovery') ? `/validate/problem-discovery/new?project_id=${encodeURIComponent(ctx.projectId)}` : null} />,
    experiments: (data, ctx) => (
      <>
        {/* The evidence CSV names Verdict decisions, so it is offered only to a reader of decisions. */}
        {data?.can_read_decisions !== false && <ModuleExport slug="experiments" projectId={ctx.projectId} />}
        <HypothesesSection parts={data?.parts} projectId={ctx.projectId} query={ctx.query} openDialog={ctx.openDialog}
          // Link to a pain's lists, as FVW handed them: the board's unretired claims and its themes.
          onLoadLinkLists={() => api.getValidationBoard(ctx.projectId).then((board) => ({
            hypotheses: (board?.hypotheses || []).filter((h) => !h.retired_at), painGroups: board?.pain_groups || [],
          }))}
          // #1692's `link` on the theme record, so both sides log it.
          onLink={(painGroupId, body) => cyclesApi.recordAction('validate', ctx.projectId, 'problem-discovery', painGroupId, 'link', body).then(ctx.reload)}
          // Only until #1656 registers New hypothesis as the table's Add (decision 20).
          onNewHypothesis={formFor('validate', 'experiments') ? undefined : (body) => api.createHypothesis(ctx.projectId, body).then(ctx.reload)} />
        <ValidateExperiments part={data?.parts?.experiments} canWrite={data?.parts?.can_write} onRetry={ctx.reload} />
        <ValidateFromGoogle part={data?.parts?.from_google} module="experiments" projectId={ctx.projectId} reload={ctx.reload} />
        {/* D1605 (#3731): PostHog experiments and surveys; the hypothesis and direction are the founder's. */}
        <ValidateExperimentsPosthog projectId={ctx.projectId}
          loadHypotheses={() => api.getValidationBoard(ctx.projectId).then((board) => (board?.hypotheses || []).filter((h) => !h.retired_at))} />
      </>
    ),
    // D693 decision 13 (#1704): the verdict zone's Export summary, under the Decisions table.
    verdict: (_data, ctx) => <ExportSummary projectId={ctx.projectId} />,
  }),
  // D697 (#1659): an interview is Customer research's record. The page draws
  // what the read sends, with the session's working parts inside it.
  recordPage: toFnMap({
    'customer-research': (read, ctx) => <InterviewRecord read={read} {...ctx} />,
    // #6006 (V19): the theme's sources, links, Used on slide and handoffs under the Worker's sections.
    'problem-discovery': (read, ctx) => <div className="space-y-3">
      <RecordView record={read} activity={ctx.activity} cycleName={ctx.cycleName} moduleName={ctx.moduleName} onLink={ctx.onLink}
        onForm={ctx.onForm} onWrite={ctx.onWrite} onClient={ctx.onClient} onShowAll={ctx.onShowAll} />
      <ThemeRecordParts parts={read?.parts} projectId={ctx.projectId} canWrite={Array.isArray(read?.actions) && read.actions.length > 0} />
    </div>,
    // D1069 (#2939, VB2a): after a given Proceed or Pivot, "Plan the build" above the record.
    verdict: (read, ctx) => <VerdictRecordWithPlan read={read} render={(record) => (
      <RecordView record={record} activity={ctx.activity} cycleName={ctx.cycleName} moduleName={ctx.moduleName} onLink={ctx.onLink}
        onForm={ctx.onForm} onWrite={ctx.onWrite} onClient={ctx.onClient} onShowAll={ctx.onShowAll} />
    )} />,
    // D1083 (#2948, LV5–LV7): From Lovable under the claim's record, one slot per experiment.
    // D6016 (#6016, V8): computed state and the founder's decision apart, evidence split by direction.
    experiments: (read, ctx) => <div className="space-y-3">
      <HypothesisRecord read={read} {...ctx} />
      {read?.parts?.lovable && <FromLovable part={read.parts.lovable} cycle="validate" projectId={ctx.projectId} onRetry={ctx.reload} />}
    </div>,
  }),
};

export default validate;

/*
 * Each cycle's open lightbox (D686 §5.1). Build, Raise and Grow each mount a
 * sheet that draws its own `<Lightbox size="tall">` with an `ActionSheet`
 * body: Build's `ConnectToolSheet` (S02-B, #1597), Raise's `RoundCallSheet`
 * in its `CallLightbox` (S03-A) and Grow's `ShareUpdateLightbox` (S03-B).
 * Validate's `RecordMount` draws `RecordLightbox`. This route draws no frame
 * around any of them: two dialogs must never nest.
 */
function ValidateMount({ projectId, searchParams, onClose, onDone, asPage }) {
  return <RecordMount projectId={projectId} interviewId={searchParams.get('interview')} setupKey={searchParams.get('setup_key')} onClose={onClose} onStarted={onDone} asPage={asPage} />;
}
