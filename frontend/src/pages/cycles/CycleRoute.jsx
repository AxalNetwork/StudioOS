import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { cyclesApi, cyclesWrite } from '../../lib/api/cycles';
import { verdictApi } from '../../lib/api/verdict';
import { WorkerRail, Unreadable } from '../../ui';
import { EadwynButton } from '../../ui/EadwynPanel.jsx';
import RailFrame from '../../ui/RailFrame';
import { RailCrumbsProvider, useSetRailCrumbs } from '../../ui/railCrumbs';
import { ASSIST_SURFACES } from '../../ui/eadwynConfig';
import FillProposals from '../../workspaces/FillProposals';
import ZoneDraft from '../../workspaces/ZoneDraft';
import PmfExplain from '../../workspaces/PmfExplain';
import UseOfFundsEadwyn, { UseOfFundsMilestoneWording } from '../../workspaces/UseOfFundsEadwyn.jsx';
import AlsoIn from '../../workspaces/AlsoIn';
import useAssistMode from '../../hooks/useAssistMode';
import useAiSpend from '../../hooks/useAiSpend';
import useScrollToHash from '../../hooks/useScrollToHash';
import { takeBuildProject, toolDeepLink } from '../account/connectorsModel';
import { recordingHref } from '../founder/recordSetup';
import { openingStep } from '../founder/assistantSession.js';
import { reviewPath } from '../../lib/activeRecording';
import { useActiveRecording } from '../../contexts/ActiveRecordingContext';
import CreateStartupForm from '../../components/CreateStartupForm';
import CycleOverview, { CycleHeader } from './CycleOverview';
import RecordView, { RecordPhoneProvider } from './RecordView';
import { HEADER_BUTTON, RecordHeaderProvider } from './RecordHeader.jsx';
import HeaderAsk from '../../ui/HeaderAsk.jsx';
import DistributionTabs from './distribution/DistributionTabs.jsx';
import DistributionAskIntent from './distribution/DistributionAskIntent.jsx';
import InboxTab, { InboxNeedsYou, useInboxUnread } from './distribution/InboxTab.jsx';
import { SequenceNeedsYou } from './distribution/SequenceBuilder.jsx';
import NewsletterTab from './distribution/NewsletterTab.jsx';
import { ComingSoon } from './distribution/DistributionParts.jsx';
import { EmailAction } from '../email/emailParts.jsx';
import RecordEmailSheet from '../email/RecordEmailSheet.jsx';
import { emailHref, personOfRecord } from '../email/emailModel.js';
import { prototypeLovable } from './lovable/lovableModel';
import Lightbox, { LightboxBarProvider } from '../../ui/Lightbox';
import { CYCLE_GUTTER, RECORD_ID } from './cyclePaths';
import { availableRecord, CLIENT_ACTIONS, confirmView, declaredActions, finishRecordWrite, recordActionBody, recordEditAction, recordFormFor, rowAction } from './recordModel';
import PhoneCycleRoot from './PhoneCycleRoot';
import { ValidateLead } from './ValidateNextAction';
import RaiseLead, { RaiseAsk } from './RaiseOverviewLead';
import CycleModulePage from './CycleModulePage';
import PhoneModulePage, { CycleBar, PHONE_GUTTER } from './PhoneModulePage';
import { PmfChip } from './PmfMethod';
import { FromYourInterviews } from './ValidateSections';
import { acceptSuggestions } from './validatePhone';
import { interviewSessionsApi } from '../../lib/api/interviewSessions';
import FormLightbox from './FormLightbox';
import { FillModule } from './FillRowsPanel';
import ModuleWorkingHere from '../team/ModuleWorkingHere.jsx';
import { fillRecordId, fillTable, fillTarget, moduleFillTarget } from '../../lib/fillForms.js';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth';
import { editFor, formsFor } from './forms';
import { adaptCard, adaptModule, adaptOverview, fnOf } from './adapters';
import { cellView, cycleOf } from './cycleModel';
import { useAuth } from '../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../lib/shellRole';
import { moduleToolLinks } from './founderToolNavigation.js';
import { isNarrativeAdmin, isNarrativeTab, SLUG as NARRATIVE, tabSearch } from '../raise/narrative/narrativeModel';
import { NarrativeAdminGate, narrativeFormAccess } from '../raise/narrative/NarrativeAdmin';
import { isCapTableTab, SLUG as CAP_TABLE } from '../raise/captable/capTableModel';
import { isDataRoomTab, isOldFileAddress, SLUG as DATA_ROOM } from '../raise/dataroom/dataRoomModel';
import { DataRoomMovedRedirect } from '../raise/dataroom/DataRoomMoved';
import { isUseOfFundsTab, SLUG as USE_OF_FUNDS } from '../raise/useoffunds/useOfFundsModel';
import { canonicalVentureSearch, legacyVentureRedirect, resolveVenture, ventureRef } from './ventureQuery.js';
import { VentureProvider } from './VentureContext.jsx';
import { PublishTo, PublishedFromHere } from './publish/PublishEntry.jsx';
import RankByFit from '../../ui/RankByFit';
import { applyRank } from '../../lib/rankByFit';
import { isCapRelTab, SLUG as CAP_REL } from '../raise/caprel/capRelModel';
import { lazyStep } from './lazyStep.jsx';
import validateDef from './defs/validate.jsx';
import raiseDef from './defs/raise.jsx';
import growDef from './defs/grow.jsx';
import buildDef from './defs/build.jsx';

// D4574 (#4574, H5): each step's module behind its own lazy boundary, so a step page
// fetches its own step, not all of them. Each keeps its local name, so every render
// site reads as before; only components go lazy (hooks and models stay static).
const OverviewTab = lazyStep(() => import('./distribution/OverviewTab.jsx'));
const ChannelsTab = lazyStep(() => import('./distribution/ChannelsTab.jsx'));
const ProspectsPage = lazyStep(() => import('./distribution/ProspectsPage.jsx'));
const CampaignsTab = lazyStep(() => import('./distribution/CampaignsTab.jsx'));
const ResultsTab = lazyStep(() => import('./distribution/ResultsTab.jsx'));
const NewCampaignPage = lazyStep(() => import('./distribution/NewCampaignPage.jsx'));
const AdsTab = lazyStep(() => import('./distribution/AdsTab.jsx'));
const CalendarTab = lazyStep(() => import('./distribution/CalendarTab.jsx'));
const ReportingDesk = lazyStep(() => import('./ReportingDesk'));
const BuildPlan = lazyStep(() => import('./BuildPlan'));
const BuildPlanDoor = lazyStep(() => import('./BuildPlan'), 'BuildPlanDoor', { fallback: null });
const NarrativeTabBar = lazyStep(() => import('../raise/narrative/NarrativeTool'), 'NarrativeTabBar', { fallback: null });
const NarrativeTabPage = lazyStep(() => import('../raise/narrative/NarrativeTool'), 'NarrativeTabPage');
const CapTableHomeNav = lazyStep(() => import('../raise/captable/CapTableTool'), 'CapTableHomeNav', { fallback: null });
const CapTableTabPage = lazyStep(() => import('../raise/captable/CapTableTool'), 'CapTableTabPage');
const DataRoomHomeNav = lazyStep(() => import('../raise/dataroom/DataRoomTool'), 'DataRoomHomeNav', { fallback: null });
const DataRoomTabPage = lazyStep(() => import('../raise/dataroom/DataRoomTool'), 'DataRoomTabPage');
const DataRoomUpload = lazyStep(() => import('../raise/dataroom/DataRoomUpload.jsx'));
const UseOfFundsHomeNav = lazyStep(() => import('../raise/useoffunds/UseOfFundsTool'), 'UseOfFundsHomeNav', { fallback: null });
const UseOfFundsTabPage = lazyStep(() => import('../raise/useoffunds/UseOfFundsTool'), 'UseOfFundsTabPage');
const CapRelHomeNav = lazyStep(() => import('../raise/caprel/CapRelTool'), 'CapRelHomeNav', { fallback: null });
const CapRelTabPage = lazyStep(() => import('../raise/caprel/CapRelTool'), 'CapRelTabPage');

/**
 * D661 (#1474) — a cycle's overview and module pages, wired to its read.
 *
 * `/<cycle>` draws the overview and `/<cycle>/:slug` one module page, from
 * `GET /api/cycles/<cycle>/…` through `adapters/` (Validate #1487, Raise
 * #1501, Grow #1488, Build #1475). The project is `?project_id=`, else the founder's
 * first, as the retired desks chose it.
 *
 * THE AI BANDS ARE A TABLE (`drafts`), rendered by one `<ZoneDraft {...draft}>`
 * below. `research_ask_session.test.mjs` censuses every band against the
 * Worker's `DRAFT_SURFACES` and reads the `surface: '…'` entries in `defs/` for
 * it, and `validate_fills_the_blanks.test.mjs` holds each cycle's rail
 * sentence to the bands in its own entry.
 *
 * THE MODULES' WORKING TOOLS STAY WHERE THEY ARE. D696 draws records with
 * D695's Add/Edit forms. D661 gives a module page a link to "the module's own
 * tool where it has one, rather than a second copy of it". Validate's zone
 * pages are gone (D704): its curation lives on its module pages and records,
 * and only Market intelligence still links a tool of its own. Each Add has an address, `/<cycle>/<slug>/new` (`?form=<key>` for a
 * later one): its form is a dialog over the module page, or the page itself
 * on a phone (D695). Add is offered only where it opens a form; a button with
 * nothing behind it is not drawn.
 */

// D5615 (#5615): each cycle's entry is its own file under `defs/`, so a
// change to one cycle's modules, parts, bands or lightbox edits that file.
const CYCLE_DEFS = { validate: validateDef, raise: raiseDef, grow: growDef, build: buildDef };

const filterString = (filter) => Object.entries(filter || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}:${v}`).join(',');

/** D4484: a module may replace its cycle's primary without changing its neighbours. */
export function primaryForModule(cycle, slug, search = '', open) {
  const def = Object.hasOwn(CYCLE_DEFS, cycle) ? CYCLE_DEFS[cycle] : null;
  return fnOf(def?.actions, slug)?.(search, open) ?? def?.action(search, open);
}

export function useProject(reloadKey = 0, { kept = null, drop = [], immediate = false } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Writes build on the latest query, never on a render's (react-router hands a
  // functional update the search params of the render that made the setter), and
  // drop `drop`'s keys in the same write: a sign-in's return or `?tool=` that the
  // lightbox has read must not come back with the venture (D686 §5.4, #1597).
  const latest = useRef(searchParams);
  latest.current = searchParams;
  const dropRef = useRef(drop);
  const writeProject = useCallback((id, extraDrop = []) => {
    const next = new URLSearchParams(latest.current);
    for (const k of dropRef.current || []) next.delete(k);
    for (const k of extraDrop) next.delete(k);
    // D5074: the one form, so a legacy `?project=` never travels beside it.
    setSearchParams(new URLSearchParams(canonicalVentureSearch(next, id)), { replace: true });
  }, [setSearchParams]);
  // D5074 (#5074): the address is parsed here and nowhere else (`ventureQuery.js`).
  // The read's own links (`next.href`) say `?project=`, older ones a project UID;
  // each names the venture, and the address is then replaced with `?project_id=`.
  const ref = ventureRef(searchParams);
  const named = ref?.id ?? null;
  const namedUid = ref?.uid ?? null;
  // Back from a provider's sign-in at /build/connect with no venture named: the
  // one Build kept before the redirect (D686 §5.4), taken once.
  const [stashed] = useState(() => (named ? null : kept?.() ?? null));
  const requested = named || stashed;
  useEffect(() => {
    if (named || !stashed) return;
    writeProject(stashed);
  }, [named, stashed, writeProject]);
  const [projectId, setProjectId] = useState(requested);
  const [status, setStatus] = useState(requested ? 'ready' : 'loading');
  useEffect(() => {
    if (requested) { setProjectId(requested); setStatus('ready'); return undefined; }
    let alive = true;
    api.listProjects().then((list) => {
      if (!alive) return;
      // A UID names its venture; one not in the list falls back to the first, as an unreadable id always has.
      const first = (namedUid ? resolveVenture(list, ref)?.project : null) || (list || [])[0];
      setProjectId(first?.id || null);
      setStatus(first ? 'ready' : 'none');
      // A UID's address is rewritten by the redirect below, which keeps the hash.
      if (first && !namedUid) writeProject(first.id);
    }).catch(() => { if (alive) setStatus('unreadable'); });
    return () => { alive = false; };
  }, [requested, writeProject, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps -- `namedUid` is read with `requested`
  // D5074: a legacy address (`?project=N`, a UID) is replaced with the canonical
  // one once its venture is known, every other query key and the hash kept.
  const current = immediate && requested ? requested : projectId;
  useEffect(() => {
    const to = legacyVentureRedirect(location, current);
    if (to) navigate(to, { replace: true, state: location.state });
  }, [current, location, navigate]);
  return { projectId: current, status: immediate && requested ? 'ready' : status, writeProject };
}

/**
 * The writes an Add form submits through: the cycles' own, and Verdict's
 * `record` as `w.verdict` (D693, Record a decision).
 */
const formWrites = { ...cyclesWrite, verdict: verdictApi };

/** The module page under the lightbox: the founder's, when it is one of this cycle's modules; else the overview (null). */
export function underModule(modules, path, cycle = 'validate', action = 'record') {
  const slug = underSlug(path, cycle, action);
  return (modules || []).some((m) => m.slug === slug) ? slug : null;
}

/** The module slug of a cycle path (`/validate/customer-research?…`), or null for the overview and the cycle's own action path. */
export function underSlug(path, cycle = 'validate', action = 'record') {
  // One fixed pattern reads the cycle segment, which is then compared, so no
  // regex is ever built from `cycle`.
  const m = /^\/([a-z]+)\/([a-z0-9-]+)(?:[/?#]|$)/.exec(String(path || ''));
  return m && m[1] === cycle && m[2] !== action ? m[2] : null;
}

/**
 * Where a Record a session finish lands (D694): the live view while it
 * records here; a channel session still waiting for its messages or its
 * transcript keeps its session page, the one page that draws that wait; every
 * other finish is Customer research, in the session's venture, else the page's.
 */
export function finishPath(session, where, projectId) {
  if (where === 'live') return `/validate/record/live?session=${encodeURIComponent(session?.id)}`;
  if (session?.submitted_via === 'meeting_bot') return `/validate/session/${encodeURIComponent(session?.id)}`;
  if (openingStep(session) === 'channel') return `/validate/session/${encodeURIComponent(session?.id)}`;
  return reviewPath({ ...session, project_id: session?.project_id ?? projectId });
}

/** D696: a scoped record read and its declared actions; the route owns every mount. */
export function useCycleRecord({ fillFor = () => null, enabled, cycle, projectId, slug, id, reload, edit, navigate, back }) {
  const location = useLocation();
  const key = `${cycle}/${projectId}/${slug}/${id}`;
  const currentKey = useRef(key); currentKey.current = key;
  const sequence = useRef(0);
  const [read, setRead] = useState(null);
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState(null);
  const writing = useRef(false);
  const activityBusy = useRef(false);
  const page = useRef(1);
  const load = useCallback(async (afterWrite = false) => {
    const serial = ++sequence.current;
    const fresh = () => currentKey.current === key && serial === sequence.current;
    try {
      const data = await cyclesApi.record(cycle, projectId, slug, id);
      if (fresh()) { page.current = 1; setRead({ key, status: 'ready', data, activity: data.activity ?? [] }); }
    } catch (error) {
      if (!fresh()) return;
      if (afterWrite && error?.status === 404) { navigate(back, { replace: true }); return; }
      setRead({ key, status: [403, 404].includes(error?.status) ? 'refused' : 'unreadable', error: error?.message || 'This record could not be read.' });
    }
  }, [cycle, projectId, slug, id, key, navigate, back]);
  useEffect(() => {
    setRead(null); setActionError(''); setPending(null);
    if (enabled) void load();
    return () => { sequence.current += 1; };
  }, [enabled, load, reload]);
  const state = read?.key === key ? read : null;
  const raw = state?.data;
  const declarations = declaredActions(raw);
  const data = raw ? availableRecord(raw, edit) : null;
  const selected = raw && typeof location.state?.editing === 'string'
    ? rowAction(location.state.editingPayload?.record === key
      ? { key: location.state.editing, body: location.state.editingPayload.body } : location.state.editing, declarations) : null;
  const formSpec = selected ? recordFormFor(selected, raw, edit) : null;
  const closeForm = () => {
    if (currentKey.current !== key) return;
    if (location.key === 'default') {
      navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: { ...location.state, editing: null } });
      return;
    }
    navigate(-1);
  };
  const perform = async (action, values) => {
    if (writing.current) throw new Error('A change is already being saved.');
    writing.current = true; setActionError('');
    try {
      const result = action.key === 'edit'
        ? await edit.submit(cyclesWrite, projectId, formSpec.id, values)
        : await cyclesApi.recordAction(cycle, projectId, slug, id, action.key, recordActionBody(action, values));
      if (currentKey.current !== key) return result;
      await finishRecordWrite(result, {
        open: (...args) => window.open(...args),
        onError: sentence => { throw new Error(sentence); },
        reread: () => load(true),
      });
      return result;
    } finally { writing.current = false; }
  };
  const send = action => { void perform(action).catch(error => {
    if (currentKey.current === key) setActionError(error?.message || 'This change could not be saved.');
  }); };
  const write = action => { if (action.confirm) setPending({ key, action }); else send(action); };
  const confirmation = pending?.key === key ? confirmView(pending.action) : null;
  return {
    status: state?.status ?? 'loading', data, error: state?.error, activity: state?.activity, actionError,
    link: action => { if (action.href?.startsWith('mailto:')) window.location.href = action.href; else navigate(action.href); },
    openForm: action => navigate(`${location.pathname}${location.search}${location.hash}`, { state: { ...location.state, editing: action.key, editingPayload: { record: key, body: action.body } } }),
    write,
    client: action => { Promise.resolve().then(() => CLIENT_ACTIONS.get(action.key)?.(raw)).catch(error => {
      if (currentKey.current === key) setActionError(error?.message || 'The export could not be created.');
    }); },
    showAll: async () => {
      if (activityBusy.current) return;
      activityBusy.current = true;
      const serial = sequence.current;
      try {
        const result = await cyclesApi.recordActivity(cycle, projectId, slug, id, page.current + 1);
        if (currentKey.current !== key || sequence.current !== serial) return;
        page.current += 1;
        setRead(previous => ({ ...previous, activity: [...previous.activity, ...(result.items ?? [])],
          data: { ...previous.data, activity_total: result.total ?? previous.data.activity_total } }));
      } catch (error) { if (currentKey.current === key) setActionError(error?.message || 'Activity could not be read.'); }
      finally { activityBusy.current = false; }
    },
    form: formSpec ? <FormLightbox key={`${key}/${selected.key}`} form={formSpec.form} current={formSpec.current}
      cycle={cycle} slug={slug}
      fill={selected.key === 'edit' ? fillFor(formSpec.form, formSpec.id) : null}
      loadOptions={selected.key === 'edit' && edit.loadOptions ? () => edit.loadOptions(cyclesWrite, projectId, formSpec.id) : null}
      onSubmit={values => perform(selected, values)} onClose={closeForm} /> : null,
    confirm: confirmation ? <Lightbox size="fit" width={420} label={confirmation.title} title={confirmation.title}
      onClose={() => setPending(null)} footer={<div className="flex justify-end gap-2 p-4">
        <button type="button" className="rounded-lg border border-axal-hairline px-3 py-2 text-axal-ink dark:border-gray-700 dark:text-gray-100" onClick={() => setPending(null)}>Cancel</button>
        <button type="button" className={`rounded-lg border px-3 py-2 ${pending.action.tone === 'danger'
          ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300'
          : pending.action.tone === 'primary' ? 'border-axal-violet bg-axal-violet text-white dark:border-violet-500 dark:bg-violet-600'
          : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'}`}
          onClick={() => { const action = pending.action; setPending(null); send(action); }}>{confirmation.cta}</button>
      </div>}><p className="p-4 text-sm text-axal-ink dark:text-gray-100">{confirmation.body}</p></Lightbox> : null,
  };
}

/**
 * `lightbox` is the cycle's action route (D685 §5.4, D686 §5.1):
 * `/validate/record`, `/build/connect`, `/raise/call`, `/grow/update`, the
 * cycle page with its lightbox open over it. The page underneath is the one the
 * founder was on (`location.state.under`), the overview on a deep link. Closing
 * goes back to it; the lightbox makes no server call.
 */
/**
 * D695 (#1656): a row's Edit that reads its record (Validate's rows carry no
 * `edit`) opens once the record answers, through `recordFormFor`, as the
 * record page opens it. `target` is null when no such Edit is open.
 */
function useRowRecordEdit(target) {
  const [state, setState] = useState(null);
  const key = target ? `${target.cycle}/${target.slug}/${target.projectId}/${target.row.id}` : null;
  useEffect(() => {
    if (!target) return undefined;
    let live = true;
    cyclesApi.record(target.cycle, target.projectId, target.slug, target.row.id)
      .then((read) => { if (live) setState({ key, spec: recordFormFor(recordEditAction(read), read, target.edit), error: null }); },
        (error) => { if (live) setState({ key, spec: null, error: error?.message || 'This record could not be read.' }); });
    return () => { live = false; };
    // `key` names the record; a new `target` object for it does not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state && state.key === key ? state : null;
}

/**
 * D696 (#1658): a record's title as the rail's third crumb, "section › module
 * › record", while the record is drawn; leaving the record drops it. It sits
 * inside `RailCrumbsProvider`, whose setter it calls, and draws nothing.
 */
function RecordCrumb({ title, type = null, id = null }) {
  const setCrumbs = useSetRailCrumbs();
  useEffect(() => {
    // D768: `ref` names the record a run on this page reads (D765's `record`).
    setCrumbs({ record: title || null, ref: title && type && id != null ? { type, id } : null });
    return () => setCrumbs({ record: null });
  }, [setCrumbs, title, type, id]);
  return null;
}

/** D1178: a Use of funds page under a tab, and the tab it sits under. */
const UOF_SUB_TAB = { forecast: 'runway', compare: 'scenarios' };

export default function CycleRoute({ cycle, tab = null, campaignNew = false, lightbox = false, adding = false, record = false, slug: suppliedSlug, reporting = null, buildPlan = null, dataRoomFile = false, capTableProposal = false, capTableScenario = false, uofSub = null }) {
  const { slug: routeSlug, id: recordId, uid: campaignUid, proposal: proposalId, instrument: instrumentId, scenario: scenarioId } = useParams();
  const location = useLocation();
  const { user } = useAuth() || {};
  const def = Object.prototype.hasOwnProperty.call(CYCLE_DEFS, cycle) ? CYCLE_DEFS[cycle] : null;
  // D685 §5.4: while this tab records (or holds a paused recording), the setup
  // never opens over it: `/validate/record` is that recording's live view.
  const { state: recording } = useActiveRecording();
  const toLive = lightbox && cycle === 'validate' ? recordingHref(recording) : null;
  // Under the lightbox is the module page the founder was on, when it is one of
  // this cycle's modules; otherwise (a deep link, or the interview log) the overview.
  const slug = lightbox ? underModule(def?.modules, location.state?.under, cycle, def?.path) : suppliedSlug ?? routeSlug;
  const distribution = cycle === 'grow' && slug === 'distribution' && !record && !lightbox && !adding;
  const distributionTab = tab || 'overview';
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectsKey, setProjectsKey] = useState(0);
  // D1464 (#4021): a per-open support read of the Data room or Capital relationships is showing; the rail goes read only.
  const [supportOpen, setSupportOpen] = useState(false);
  // Build's lightbox reads a sign-in's return or `?tool=` once; the venture's write drops those keys too (#1597).
  const [connectDrop] = useState(() => (lightbox && cycle === 'build' ? toolDeepLink(location.search, [])?.strip || [] : []));
  const { projectId, status: projectStatus, writeProject } = useProject(projectsKey, { kept: lightbox && cycle === 'build' ? takeBuildProject : null, drop: connectDrop, immediate: record });
  const inboxUnread = useInboxUnread(distribution && projectStatus === 'ready' ? projectId : null, { enabled: distributionTab !== 'inbox' });
  const creates = Boolean(def?.creates);
  const [creating, setCreating] = useState(() => creates && searchParams.get('new') === '1');
  // Followed, not only seeded: the Command Palette can address `?new=1` from
  // this very page, which changes the search without a remount.
  useEffect(() => {
    if (creates && searchParams.get('new') === '1') setCreating(true);
  }, [creates, searchParams]);
  const name = cycleOf(cycle)?.name || 'Validate';
  const moduleName = slug ? def?.moduleName?.(slug) || (def?.modules || []).find((m) => m.slug === slug)?.name || null : null;
  const [fillsOn] = useAssistMode(name);
  const q = projectId ? `?project_id=${projectId}` : '';
  const navigate = useNavigate();
  // A lightbox that changed something (a tool connected) marks the page dirty;
  // it reloads on close, not behind the lightbox, so nothing flashes.
  const dirty = useRef(false);
  // The module's Add and Edit forms (`forms.js`), for a store with no page of
  // its own (D695). The open Add is the address's: `/new` opens the first form,
  // `?form=<key>` a later one. The open Edit is the row the history entry names
  // (`state.editing`), so Back closes it as it closes an Add.
  const forms = useMemo(() => (slug && def ? formsFor(cycle, slug) : []), [cycle, slug, def]);
  const edit = slug && def ? editFor(cycle, slug) : null;
  // D1025 (#2862): Cap table's `/new` is Record an issuance (CT12a), not the old Add holder form.
  const capTableAdding = adding && cycle === 'raise' && slug === CAP_TABLE;
  const formOpen = adding && forms.length && !capTableAdding ? forms.find((f) => f.key === searchParams.get('form')) || forms[0] : null;
  const editingId = !adding && edit && location.state?.editing != null ? String(location.state.editing) : null;
  const phone = usePhoneWidth();
  // #1652's `?add=1` (the Worker's card hrefs) is the first Add's address: the
  // URL becomes `/new`, the rest of the query kept. A module with no form, and
  // the overview, ignore it (D688).
  useEffect(() => {
    if (record) return;
    if (adding || lightbox || !slug || !forms.length || searchParams.get('add') !== '1') return;
    const params = new URLSearchParams(searchParams);
    params.delete('add');
    const rest = params.toString();
    navigate(`/${cycle}/${slug}/new${rest ? `?${rest}` : ''}`, { replace: true });
  }, [record, adding, lightbox, slug, forms, searchParams, cycle, navigate]);
  // D914 (#2698): an admin reads the Investor narrative read only, after giving a reason; no Add, edit, fill or draft.
  const narrativeAdmin = cycle === 'raise' && slug === NARRATIVE && isNarrativeAdmin(user);
  // D1464 (#4021): the access pill and banner say HQ for the Super Admin, Studio admin for an Admin.
  const supportViewer = isSuperAdminUser(user) ? 'super_admin' : 'admin';
  /**
   * D5079 (#5079): a sensitive Raise tool's own authoritative read can be
   * refused while this page's module read succeeds — the two are gated
   * differently, and an admin passes one and not the other. The tool reports
   * its refusal here, and this page then draws none of the module's
   * authoritative data for it. The page's own refused branch is what withholds
   * it — the card, the records table with its Add and row actions, and the
   * children: Eadwyn's bands, the module's parts and the Evidence block — so
   * this flag only has to reach it. Only the tool's own refusal and its tab
   * row stay, because `subnav` sits outside that branch. "Not allowed to
   * read" must never be drawn as "read, and empty".
   */
  const [toolRefusal, setToolRefusal] = useState(null);
  const onToolRefused = useCallback((refusal) => setToolRefusal(refusal ?? null), []);
  useEffect(() => { setToolRefusal(null); }, [cycle, slug, projectId]);
  const refusedTool = !record && toolRefusal?.refused ? toolRefusal : null;
  const drafts = !record && slug && !narrativeAdmin && def?.drafts instanceof Map && Array.isArray(def.drafts.get(slug)) ? def.drafts.get(slug) : [];
  const fillKind = !record && slug && !narrativeAdmin && def?.fills && Object.prototype.hasOwnProperty.call(def.fills, slug) ? def.fills[slug] : null;
  // The cost before a run (D424), read only while a band is drawn: a draft
  // band or a fill band, which quotes its own kind's task from the same read.
  const ai = useAiSpend({ enabled: Boolean(fillsOn && projectId && (drafts.length || fillKind)) });

  const [overview, setOverview] = useState(null);
  // D685 §5.12: the phone focus reads the overview as sent; adapting a card replaces its series.
  const [rawOverview, setRawOverview] = useState(null);
  const [overviewStatus, setOverviewStatus] = useState('loading');
  // D1466 (#3714, RO15): a 403 or 404 on the overview is a refusal, drawn as the Worker's sentence.
  const [overviewMessage, setOverviewMessage] = useState('');
  const [module, setModule] = useState(null);
  // #3938 GR17 (D1478 part 9): the Partner network's "Rank by fit" answer, a view of the rows read; any new read puts the list back.
  const [partnerRank, setPartnerRank] = useState(null);
  useEffect(() => { setPartnerRank(null); }, [module, slug]);
  const [moduleStatus, setModuleStatus] = useState('loading');
  // D693 decision 7: a read refused on purpose keeps the Worker's sentence.
  const [moduleMessage, setModuleMessage] = useState('');
  // D693 decision 7: false once a Validate read says the viewer may not read
  // decisions, or the Verdict read refuses; the tabs then drop Verdict.
  const [canReadDecisions, setCanReadDecisions] = useState(true);
  // D686: a history address (`#tools`, `#calls`, `#updates`) scrolls once its section is drawn.

  const [query, setQuery] = useState({ q: '', filter: {}, sort: '', page: 1 });
  const [reload, setReload] = useState(0);
  // #4017 (#3710 IV-D3): the record's Email composes in the right Sheet over the record.
  const [emailing, setEmailing] = useState(false);
  // D1454 (#3710, IV-D1): the record header's two slots, filled by the record page's portal.
  const [headerSlots, setHeaderSlots] = useState({ pills: null, actions: null });
  const pillsSlot = useCallback((el) => setHeaderSlots((s) => (s.pills === el ? s : { ...s, pills: el })), []);
  const actionsSlot = useCallback((el) => setHeaderSlots((s) => (s.actions === el ? s : { ...s, actions: el })), []);
  // D697 decision 21: the one dialog a module's further parts opened. It is
  // drawn after the size container (a `fixed` layer inside it would sit against
  // the column), or as the body below 1024px when it is a page; a new module
  // or record closes it.
  const [dialog, setDialog] = useState(null);
  const openDialog = useCallback((element, { page = false } = {}) => setDialog(element ? { element, page } : null), []);
  useEffect(() => { setDialog(null); setEmailing(false); }, [cycle, slug, recordId]);
  const openEmail = useCallback(() => setEmailing(true), []);
  const known = !slug || (def?.modules || []).some((m) => m.slug === slug);
  const validRecord = RECORD_ID.test(recordId ?? '') && recordId !== 'new';
  // D906 (#2454): under Investor narrative a record id that is a tab word
  // (`/story`, `/check`, …) is the tool's tab, never a version (versions are numbers).
  const narrativeTab = record && cycle === 'raise' && isNarrativeTab(slug, recordId) ? recordId : null;
  // D1015 (#2432): under Cap table a record id that is a tab word (`/instruments`, …)
  // is the tool's tab, never a row (rows are `h-<n>`, `e-<n>` and `pool`).
  // D1022 (#2859): `h-<n>` is the tool's too, the holder drawer over Overview.
  // D1025 (#2862): `/new` opens Record an issuance over Overview, and
  // `/raise/cap-table/proposal/<id>` a proposal's drawer (CT11), both the tool's own.
  // D1023 (#2860): `/raise/cap-table/instrument/<uid>` is the instrument drawer (CT4).
  // D1024 (#2861): `/raise/cap-table/scenarios/<uid>` is a scenario, and `/scenarios/compare` the compare page.
  const capTableTab = capTableScenario && cycle === 'raise' ? 'scenario'
    : capTableProposal && cycle === 'raise' ? (instrumentId ? 'instrument' : 'proposal')
    : capTableAdding ? 'new'
      : record && cycle === 'raise' && isCapTableTab(slug, recordId) ? recordId : null;
  // D1101 (#2456): the Data room tool's tabs are words under its module, never file records.
  // D1106 (#2986): `/raise/data-room/file/<id>` is a file's lightbox over Files.
  const dataRoomTab = record && cycle === 'raise' && (dataRoomFile ? 'files' : isDataRoomTab(slug, recordId) ? recordId : null);
  // D1109 (#2989): a file's number was its record page; it forwards to its window over Files, counted.
  const dataRoomOldFile = record && cycle === 'raise' && !dataRoomFile && isOldFileAddress(slug, recordId) ? recordId : null;
  // D1173 (#2455): the Use of funds tool's tabs are words under its module, never section records.
  // D1178 (#3105): `/runway/forecast` and `/scenarios/compare` are pages under a tab, given as `uofSub`.
  const uofTab = uofSub && cycle === 'raise' ? UOF_SUB_TAB[uofSub] || null
    : record && cycle === 'raise' && isUseOfFundsTab(slug, recordId) ? recordId : null;
  // D1188 (#2457): the Capital relationships tool's tabs are words under its module, never investor records.
  const capRelTab = record && cycle === 'raise' && isCapRelTab(slug, recordId) ? recordId : null;
  // D1328 (#3489): Fill with Eadwyn on a founder form FILL_FIELDS lists (AF3, AF7), and a
  // waiting row's Edit (AF16), which opens its Add form with the row's values.
  // #3740 part 1: an Edit form passes its row id, so the sheet reads the saved row (`record`).
  const fillRow = location.state?.fillRow && typeof location.state.fillRow.uid === 'string' ? location.state.fillRow : null;
  const fillFor = (entry, rowId = null) => {
    const t = !narrativeAdmin && projectId ? fillTarget(cycle, slug, entry?.key) : null;
    if (!t) return null;
    const record = fillRecordId(rowId, fillTable(t.page, t.form));
    return { ...t, project: projectId, aiOff: !fillsOn, ...(record ? { record } : {}),
      edited: rowId == null && fillRow && fillRow.form === entry.key ? fillRow : null };
  };
  const recordState = useCycleRecord({ fillFor, enabled: record && known && validRecord && !narrativeTab && !capTableTab && !dataRoomTab && !dataRoomOldFile && !uofTab && !capRelTab && !!projectId && !!def,
    cycle, projectId, slug, id: recordId, reload, edit, navigate, back: `/${cycle}/${slug}${q}` });
  useScrollToHash(record ? recordState.status !== 'ready' : moduleStatus !== 'ready');
  // The page re-reads once the lightbox is gone, however it went: ×, Escape and
  // a finish navigate away from the action route, and so does the browser's
  // Back, which never calls `closeAction`. The route keeps this component
  // mounted across that change, so the dirty mark survives to be read here.
  useEffect(() => {
    if (!lightbox && dirty.current) { dirty.current = false; setReload((n) => n + 1); }
  }, [lightbox]);
  // An Add or an Edit (D695) is followed the same way: a save marks the page,
  // and it re-reads once the form's address or history entry is left.
  useEffect(() => {
    if (!adding && !editingId && dirty.current) { dirty.current = false; setReload((n) => n + 1); }
  }, [adding, editingId]);

  // The table's query resets when the module changes.
  // D5072: when the query already is the default, keep the SAME object. A fresh `{}` on mount re-ran the module
  // read below (its dependency is `query`), so every module page read its module twice when it opened.
  useEffect(() => {
    setQuery((cur) => (cur.q === '' && Object.keys(cur.filter || {}).length === 0 && !cur.sort && cur.page === 1 ? cur : { q: '', filter: {}, sort: '', page: 1 }));
  }, [slug]);

  // D4601: the overview on screen has an identity: its cycle, its venture and a generation that every
  // (re)read, venture switch or page change advances. A card retry applies only to the identity it started under.
  const overviewId = useRef({ gen: 0, key: '' });
  const retrySeq = useRef({});
  useEffect(() => {
    overviewId.current = { gen: overviewId.current.gen + 1, key: `${cycle}|${projectId}|${overviewId.current.gen + 1}` };
    // D1056, D1063: the Reporting desk and Build's plan make their own reads, never the overview's.
    if (record || slug || reporting || buildPlan || !projectId || !def) return undefined;
    let alive = true;
    setOverviewStatus('loading');
    cyclesApi.overview(cycle, projectId)
      .then((data) => {
        if (!alive) return;
        if (typeof data?.can_read_decisions === 'boolean') setCanReadDecisions(data.can_read_decisions);
        setRawOverview(data); setOverview(adaptOverview(cycle, data)); setOverviewStatus('ready');
      })
      .catch((error) => {
        if (!alive) return;
        const refused = [403, 404].includes(error?.status);
        setOverviewMessage(refused ? error?.message || '' : '');
        setOverviewStatus(refused ? 'refused' : 'unreadable');
      });
    return () => { alive = false; };
  }, [record, cycle, slug, reporting, buildPlan, projectId, reload, def]);

  useEffect(() => {
    if (record || !slug || !known || !projectId || !def) return undefined;
    if (distribution && distributionTab !== 'overview') return undefined;
    let alive = true;
    setModuleStatus('loading');
    cyclesApi.module(cycle, projectId, slug, { q: query.q, filter: filterString(query.filter), sort: query.sort, page: query.page })
      .then((data) => {
        if (!alive) return;
        if (typeof data?.can_read_decisions === 'boolean') setCanReadDecisions(data.can_read_decisions);
        setModule(adaptModule(cycle, slug, data)); setModuleMessage(''); setModuleStatus('ready');
      })
      // A 403 is a refusal, not a failure (D693 decision 7: "Partners do not
      // see decisions."), so it is drawn as the Worker's sentence, with no Retry.
      .catch((error) => {
        if (!alive) return;
        if (error?.status === 403) {
          if (slug === 'verdict') setCanReadDecisions(false);
          setModuleMessage(error?.message || ''); setModuleStatus('refused');
        } else setModuleStatus('unreadable');
      });
    return () => { alive = false; };
  }, [record, cycle, slug, known, projectId, query, reload, def, distribution, distributionTab]);

  // One card re-read: the module read returns that card on its own, so the
  // others stay drawn (D656: a failing source leaves the others alone).
  const retryCard = useCallback((cardSlug) => {
    if (!projectId) return;
    const started = overviewId.current.key;
    const seq = (retrySeq.current[cardSlug] || 0) + 1;
    retrySeq.current[cardSlug] = seq;
    cyclesApi.module(cycle, projectId, cardSlug, {})
      .then((data) => {
        // A venture switch, a re-read or a newer retry of this card has happened since: this answer is obsolete.
        if (overviewId.current.key !== started || retrySeq.current[cardSlug] !== seq) return;
        setOverview((o) => (o ? { ...o, cards: o.cards.map((c) => (c.slug === cardSlug ? adaptCard(cycle, { slug: cardSlug, ...data.card }) : c)) } : o));
      })
      .catch(() => {});
  }, [cycle, projectId]);

  const tabs = useMemo(() => (def?.modules || [])
    .filter((m) => canReadDecisions || !(cycle === 'validate' && m.slug === 'verdict'))
    .map((m) => ({ slug: m.slug, name: m.name })), [def, cycle, canReadDecisions]);
  const editing = editingId ? (module?.records?.rows || []).find((row) => String(row?.id) === editingId) || null : null;
  const rowEdit = useRowRecordEdit(!record && projectId && edit?.readsRecord && editing && edit.idOf(editing) != null
    ? { cycle, slug, projectId, edit, row: editing } : null);

  if (toLive) return <Navigate to={toLive} replace />;
  if (!def) return null;
  if (!known) return <Navigate to={`/${cycle}${q}`} replace />;
  if (record && !validRecord) return <Navigate to={`/${cycle}/${slug}${q}`} replace />;
  // A known module with no Add form has no `/new`: its page instead.
  if (adding && slug && !forms.length) return <Navigate to={`/${cycle}/${slug}${location.search}`} replace />;

  const openAction = projectId && def.path
    ? () => navigate(`/${cycle}/${def.path}${q}`, { state: { under: `${location.pathname}${location.search}` } })
    : undefined;
  const closeAction = () => {
    if (location.state?.under) navigate(-1);
    else navigate(`/${cycle}${q}`, { replace: true });
  };
  // An Add pushed from the page goes back to it; a deep link to `/new` replaces
  // itself with the module page, the venture kept (as `closeAction` does). An
  // Edit is the same URL with `state.editing`, so closing it is Back.
  const closeAdd = () => {
    if (location.state?.under) { navigate(-1); return; }
    const params = new URLSearchParams(searchParams);
    params.delete('form');
    const rest = params.toString();
    navigate(`/${cycle}/${slug}${rest ? `?${rest}` : ''}`, { replace: true });
  };
  const closeEdit = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate(`${location.pathname}${location.search}`, { replace: true });
  };
  const addHref = (entry, i) => {
    const params = new URLSearchParams(q);
    if (i > 0) params.set('form', entry.key);
    const rest = params.toString();
    return `/${cycle}/${slug}/new${rest ? `?${rest}` : ''}`;
  };
  // The one open form, Add or Edit. Below 1024px it is the page, drawn in the
  // body's gutter; at 1024px and up it is the dialog at the mount below.
  const saved = () => { dirty.current = true; };
  const uofAssistant = cycle === 'raise' && slug === USE_OF_FUNDS && user?.role === 'founder'
    ? props => <UseOfFundsMilestoneWording key={projectId} projectId={projectId} {...props} /> : undefined;
  const moduleFill = !narrativeAdmin && projectId && slug ? moduleFillTarget(cycle, slug, forms) : null;
  // #3712: Add/Edit dialogs sit outside the page gate, including phone sheets.
  // The authenticated role decides read-only access; shell preview never grants writes.
  const narrativeAccess = cycle === 'raise' && slug === NARRATIVE ? narrativeFormAccess(projectId, user) : {};
  const openForm = record ? recordState.form
    : !projectId ? null
    // D1106 (#2986): DR4, Data room's Upload is its own sheet, the queue in states.
    : formOpen && cycle === 'raise' && slug === DATA_ROOM ? (
      <DataRoomUpload key="dataroom-upload" projectId={projectId} onSaved={saved} onClose={closeAdd} />
    ) : formOpen ? (
      <FormLightbox key={`add-${projectId}-${formOpen.key}${fillRow ? `-${fillRow.uid}` : ''}`} form={formOpen} {...narrativeAccess} cycle={cycle} slug={slug} search={location.search}
        renderAssistant={uofAssistant}
        fill={fillFor(formOpen)}
        // An Add whose choices are the Worker's (Record a decision's For and Evidence, D693) reads them here.
        loadOptions={formOpen.loadOptions ? () => formOpen.loadOptions(formWrites, projectId) : null}
        onSearch={formOpen.search ? (_field, q) => formOpen.search(formWrites, projectId, q) : null}
        onSubmit={(values, memory) => formOpen.submit(formWrites, projectId, values, memory)}
        onSaved={saved}
        onClose={closeAdd} />
    ) : editing && edit.idOf(editing) != null && edit.readsRecord ? (
      // Drawn once the record answers: its values, or the refusal in the dialog.
      rowEdit?.spec ? (
        <FormLightbox key={`edit-${projectId}-${editing.id}`} form={rowEdit.spec.form} current={rowEdit.spec.current} {...narrativeAccess} cycle={cycle} slug={slug}
          renderAssistant={uofAssistant}
          fill={fillFor(rowEdit.spec.form, rowEdit.spec.id)}
          loadOptions={edit.loadOptions ? () => edit.loadOptions(cyclesWrite, projectId, rowEdit.spec.id) : null}
          onSubmit={(values) => edit.submit(cyclesWrite, projectId, rowEdit.spec.id, values)}
          onSaved={saved}
          onClose={closeEdit} />
      ) : rowEdit ? (
        <FormLightbox key={`edit-${projectId}-${editing.id}-refused`} form={{ ...edit, fields: [] }} {...narrativeAccess} cycle={cycle} slug={slug}
          refused={rowEdit.error || 'This record has no Edit.'} onSubmit={() => {}} onClose={closeEdit} />
      ) : null
    ) : editing && edit.idOf(editing) != null ? (
      <FormLightbox key={`edit-${projectId}-${editing.id}`} form={edit} current={edit.valuesOf(editing)} {...narrativeAccess} cycle={cycle} slug={slug}
        renderAssistant={uofAssistant}
        fill={fillFor(edit, edit.idOf(editing))}
        loadOptions={edit.loadOptions ? () => edit.loadOptions(cyclesWrite, projectId, edit.idOf(editing)) : null}
        onSubmit={(values) => edit.submit(cyclesWrite, projectId, edit.idOf(editing), values)}
        onSaved={saved}
        onClose={closeEdit} />
    ) : null;
  // What finishing does: `finishPath`'s page replaces the action route, and a
  // sent update opens its page, so Back never reopens the lightbox. Only the
  // session page reads the interview it was opened for.
  const onDone = cycle === 'validate'
    ? (session, interview, where) => {
      const to = finishPath(session, where, projectId);
      navigate(to, to.startsWith('/validate/session/') ? { state: { interview }, replace: true } : { replace: true });
    }
    : cycle === 'grow' ? (uid) => navigate(`/updates/${encodeURIComponent(uid)}`, { replace: true }) : undefined;
  const action = primaryForModule(cycle, slug, q, openAction);
  const Mount = def.Mount || null;
  const rail = (
    <WorkerRail
      workspace={name}
      role="founder"
      readOnlyFor={narrativeAdmin || supportOpen ? 'founder-record' : null}
      stance="Evidence-led view"
      fills
      note={ASSIST_SURFACES.workspace.desks[name]?.fills}
      coverage={[projectId ? `Venture #${projectId} selected` : 'No venture selected']}
      footer="Traceable surface · no unsupported automated actions"
    />
  );

  // D703 step 8: the bar every phone page below 1024px draws, as a function
  // of the page's own title, sub and Back (the `Lightbox` page mode calls it).
  // Its back label names where Back goes (decision 5).
  const phoneBar = (backLabel, showEadwyn = true) => ({ title, sub, onBack }) => (
    <CycleBar back={{ label: backLabel, onClick: onBack }} title={title} sub={sub} eadwynLabel={showEadwyn ? `${name} · ${title}` : undefined} />
  );
  // An Add or Edit page's Back returns to the module, or in record mode to the record (step 9).
  const pageBack = record ? (recordState.data?.title || moduleName || name) : (moduleName || name);
  // Below 1024px an action page is the route's only content (decision 11).
  const actionPage = phone && lightbox && Mount && projectId;

  let body;
  if (projectStatus === 'none') {
    // A founder with no venture yet is offered the one way to make one.
    const createBtn = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep';
    body = (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-axal-hairline bg-white p-4 text-[13px] text-axal-muted dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400" data-testid="cycle-no-venture">
        <p className="m-0">There is no venture to show yet. {name} fills in once you have one.</p>
        {creates
          ? <button type="button" className={createBtn} onClick={() => setCreating(true)} data-testid="cycle-create-venture">Create your startup</button>
          : <Link className={createBtn} to="/build?new=1" data-testid="cycle-create-venture">Create your startup</Link>}
      </div>
    );
  } else if (narrativeTab) {
    body = (
      <NarrativeTabPage tab={narrativeTab} projectId={projectId} projectStatus={projectStatus} onRetryProject={() => setProjectsKey((n) => n + 1)}
        fixOn={fillsOn} search={location.search} cards={tabs} action={action} phone={phone} admin={narrativeAdmin} />
    );
  } else if (reporting && cycle === 'grow') {
    // D1056 (#2427): Grow's Reporting desk, under the tab row with Reporting lit.
    // D1060 (#2930): and one report, `reporting="report"|"edit"` with its uid as `:id`.
    body = (
      <ReportingDesk tab={reporting} projectId={projectId} projectStatus={projectStatus} onRetryProject={() => setProjectsKey((n) => n + 1)}
        search={location.search} cards={tabs} action={action} phone={phone} reportUid={recordId ?? null} role={user?.role ?? null} />
    );
  } else if (buildPlan && cycle === 'build') {
    // D1063 (#2426): Validate → Build's plan, under Build's header and tab row.
    body = (
      <BuildPlan tab={buildPlan} projectId={projectId} projectStatus={projectStatus} onRetryProject={() => setProjectsKey((n) => n + 1)}
        search={location.search} cards={tabs} action={action} phone={phone} role={user?.role ?? null} lab={user?.spinout_lab_active === 1 && user?.role !== 'admin'} />
    );
  } else if (capTableTab) {
    body = (
      <CapTableTabPage tab={capTableTab} proposal={proposalId} instrument={instrumentId} scenario={scenarioId} projectId={projectId} projectStatus={projectStatus} onRetryProject={() => setProjectsKey((n) => n + 1)}
        search={location.search} cards={tabs} action={action} phone={phone} />
    );
  } else if (dataRoomOldFile) {
    body = <DataRoomMovedRedirect kind="file" id={dataRoomOldFile} />;
  } else if (dataRoomTab) {
    body = (
      <DataRoomTabPage tab={dataRoomTab} projectId={projectId} projectStatus={projectStatus} onRetryProject={() => setProjectsKey((n) => n + 1)}
        search={location.search} cards={tabs} action={action} phone={phone} fileId={dataRoomFile ? recordId : null}
        viewer={supportViewer} onSupportRead={setSupportOpen} />
    );
  } else if (uofTab) {
    body = (
      <div className="space-y-4">
      <UseOfFundsTabPage tab={uofTab} sub={uofSub} projectId={projectId} projectStatus={projectStatus} onRetryProject={() => setProjectsKey((n) => n + 1)}
        search={location.search} cards={tabs} action={action} phone={phone} />
      {uofTab === 'runway' && !uofSub && user?.role === 'founder' && projectStatus === 'ready' && projectId && <UseOfFundsEadwyn key={projectId} projectId={projectId} ai={ai} />}
      </div>
    );
  } else if (capRelTab) {
    body = (
      <CapRelTabPage tab={capRelTab} projectId={projectId} projectStatus={projectStatus} onRetryProject={() => setProjectsKey((n) => n + 1)}
        search={location.search} cards={tabs} action={action} phone={phone}
        admin={String(user?.role || '') === 'admin'} viewer={supportViewer} onSupportRead={setSupportOpen} />
    );
  } else if (record) {
    const recordTitle = recordState.data?.title || moduleName;
    const emailPerson = recordState.data ? personOfRecord(cycle, slug, recordId) : null;
    const emailFrom = `${recordTitle} · ${moduleName}`;
    body = <div className="space-y-4" data-testid="cycle-record-page">
      {/* D703 step 7: below 1024px the record is a pushed page under
          `CycleBar`, whose Back goes to the module; the loading, refused and
          unreadable states draw under it too. */}
      {phone ? (
        <CycleBar back={{ label: moduleName || name, to: `/${cycle}/${slug}${q}` }} title={recordTitle}
          sub={recordState.data?.sub || undefined} eadwynLabel={`${name} · ${recordTitle}`} />
      ) : (
        <CycleHeader cycle={cycle} cards={tabs} active={slug} record moduleName={moduleName}
          title={recordTitle} sub={recordState.data?.sub || ''} search={q} slots={{ pills: pillsSlot, actions: actionsSlot }} />
      )}
      <RecordPhoneProvider phone={phone}>
      {/* D1344 (EM4): the one Email action, on a record with a person; a record with none draws nothing.
          D1454 (#3710, IV-D1): it sits in the record's one action row, after Ask, never on a row of its own. */}
      <RecordHeaderProvider pills={phone ? null : headerSlots.pills} actions={phone ? null : headerSlots.actions}
        email={emailPerson ? <EmailAction person={emailPerson} from={emailFrom} className={HEADER_BUTTON.default} onOpen={openEmail} /> : null}
        emailTo={emailPerson ? emailHref(emailPerson, emailFrom) : null}
        onEmail={emailPerson ? openEmail : null}
        ask={<HeaderAsk label={`${name} · ${recordTitle}`} testId="record-ask" />}>
      {recordState.status === 'loading' ? <p className="text-sm text-axal-muted dark:text-gray-400" aria-busy="true">Loading record…</p>
        : recordState.status === 'refused' ? <p className="text-sm text-axal-ink dark:text-gray-100">{recordState.error}</p>
        : recordState.status === 'unreadable' ? <Unreadable what="This record" claim={recordState.error} onRetry={() => setReload(n => n + 1)} />
        : recordState.data && (fnOf(def.recordPage, slug)?.(recordState.data, { projectId, id: recordId, activity: recordState.activity, cycleName: name, moduleName, onLink: recordState.link, onForm: recordState.openForm, onWrite: recordState.write, onClient: recordState.client, onShowAll: recordState.showAll, act: (key, body) => cyclesApi.recordAction(cycle, projectId, slug, recordId, key, body), reload: () => setReload((n) => n + 1), openDialog })
          ?? <RecordView record={recordState.data} activity={recordState.activity}
          cycleName={name} moduleName={moduleName} onLink={recordState.link} onForm={recordState.openForm}
          onWrite={recordState.write} onClient={recordState.client} onShowAll={recordState.showAll} />)}
      </RecordHeaderProvider>
      </RecordPhoneProvider>
      {emailing && emailPerson && <RecordEmailSheet person={emailPerson} label={recordTitle} from={emailFrom} readOnly={Boolean(narrativeAdmin || supportOpen)} onClose={() => setEmailing(false)} />}
      {recordState.actionError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{recordState.actionError}</p>}
    </div>;
  } else if (!slug) {
    // D703 decision 1: below 1024px the root is the phone page, in place of
    // the overview and `AlsoIn`, never beside them. Both read the same overview.
    const overviewState = projectStatus === 'unreadable' ? 'unreadable' : overviewStatus;
    body = def?.Overview ? <>
      <def.Overview raw={rawOverview} data={overview} status={overviewState} search={q} action={action} message={overviewMessage} readOnly={Boolean(narrativeAdmin || supportOpen)} onRetry={() => setReload((n) => n + 1)}
        more={cycle === 'grow' && projectId ? <PublishTo part={rawOverview?.publish} projectId={projectId} module="overview" /> : null} />
      {cycle === 'grow' && <PublishedFromHere part={rawOverview?.publish} />}
    </> : phone ? (
      <PhoneCycleRoot cycle={cycle} raw={rawOverview} status={overviewState} search={q} projectId={projectId} message={overviewMessage}
        openAction={openAction} onChanged={() => setReload((n) => n + 1)} onRetry={() => setReload((n) => n + 1)} />
    ) : (
      <>
        <CycleOverview
          cycle={cycle}
          data={overview}
          status={overviewState}
          message={overviewStatus === 'refused' ? overviewMessage : undefined}
          onRetry={() => setReload((n) => n + 1)}
          onRetryCard={retryCard}
          action={action}
          search={q}
          // D1466 (#3714): Raise's lead row (Next steps, From your tools), drawn from the read's own parts.
          // D4589 (#4589): Validate's next action, the same Worker focus the phone root draws;
          // #5999: beside it the same meter and "Set a target" (`CycleMeter.jsx`).
          lead={cycle === 'raise' ? <RaiseLead data={rawOverview} search={q} onRetry={() => setReload((n) => n + 1)} />
            : cycle === 'validate' && rawOverview ? <ValidateLead raw={rawOverview} search={q} openAction={openAction} projectId={projectId} onChanged={() => setReload((n) => n + 1)} /> : null}
          // D1146 (#3032, RD12): Validate's header chip, the stored band, opening Fundraising readiness.
          chip={cycle === 'validate' && projectId ? <PmfChip projectId={projectId} search={q} /> : null}
          // D1466 (RO00): Raise's header Ask, beside Build your deck.
          ask={cycle === 'raise' && projectId ? <RaiseAsk /> : null}
        />
        {/* D1063 (#2426): the door to the plan, under Build's overview. */}
        {cycle === 'build' && <BuildPlanDoor search={q} />}
        <AlsoIn role="founder" row={name} />
      </>
    );
  } else {
    const read = module?.records;
    const rankable = cycle === 'grow' && slug === 'partner-network' && projectId && !narrativeAdmin && Array.isArray(read?.rows) && read.rows.length > 0;
    const ranked = rankable && partnerRank ? applyRank(read.rows, (row) => row.id, partnerRank) : null;
    const recs = ranked ? { ...read, rows: ranked.list } : read;
    // D703 step 6: below 1024px the module is a pushed page with the same props.
    const ModulePage = phone ? PhoneModulePage : CycleModulePage;
    body = (
      <ModulePage
        cycle={cycle}
        slug={slug}
        moduleName={moduleName}
        header={distribution ? null : undefined}
        cards={tabs}
        data={module}
        status={projectStatus === 'unreadable' ? 'unreadable' : refusedTool ? 'refused' : moduleStatus}
        message={refusedTool ? refusedTool.message : moduleStatus === 'refused' ? moduleMessage : undefined}
        onRetry={() => setReload((n) => n + 1)}
        records={recs}
        showRecords={!distribution}
        recordsStatus={!refusedTool && moduleStatus === 'ready' ? (recs?.state === 'unreadable' ? 'unreadable' : 'ready') : undefined}
        recordsMessage={recs?.state === 'unreadable' ? recs.reason : undefined}
        query={query}
        onQuery={setQuery}
        action={action}
        add={narrativeAdmin ? undefined : forms.length && projectId
          ? forms.map((entry, i) => ({ text: entry.button, href: addHref(entry, i), state: { under: `${location.pathname}${location.search}` } }))
          : fnOf(def.add, slug)?.(q, openAction)}
        lovable={narrativeAdmin ? undefined : prototypeLovable(cycle, slug, module)}
        rowAction={!narrativeAdmin && edit && projectId && !edit.hiddenFor?.(module) ? (row) => (edit.idOf(row) == null ? null : {
          text: edit.button,
          label: `${edit.button} ${((v) => (v.nr ? 'this row' : v.text))(cellView(row?.cells?.[recs?.cols?.[0]?.key]))}`,
          onClick: () => navigate(`${location.pathname}${location.search}`, { state: { editing: String(row.id) } }),
        }) : undefined}
        tool={fnOf(def.tools, slug)?.(q)}
        tools={moduleToolLinks(cycle, slug, user, q)}
        search={q}
        subnav={cycle === 'raise' && slug === NARRATIVE ? <NarrativeTabBar active="home" search={tabSearch(q, searchParams.get('version'))} />
          : cycle === 'raise' && slug === CAP_TABLE ? <CapTableHomeNav search={q} projectId={projectId} onRefused={onToolRefused} />
          : cycle === 'raise' && slug === DATA_ROOM ? <DataRoomHomeNav search={q} onRefused={onToolRefused} />
          : cycle === 'raise' && slug === USE_OF_FUNDS ? <UseOfFundsHomeNav search={q} projectId={projectId} />
          : cycle === 'raise' && slug === CAP_REL ? <CapRelHomeNav search={q} projectId={projectId} onRefused={onToolRefused} /> : undefined}
        // #3938 GR17: the venture's partners ranked against a need the founder types (the route refuses without one), above the table it reorders.
        aboveRecords={rankable ? <RankByFit run={(need) => cyclesWrite.grow.partnerRank(projectId, need)} onRanked={setPartnerRank}
          ranked={ranked ? ranked.ranked : null} total={read.rows.length} label="What do you need a partner for?" needsQuery testid="grow-partners-rank" /> : null}
        // D1321 (#3482): each Grow module's Publish to… in its header, on part 2's gate (D1333's `parts.publish`).
        more={<>{cycle === 'grow' && projectId ? <PublishTo part={module?.parts?.publish} projectId={projectId} module={slug} />
          // D1328 (#3489, AF1): the module's "Fill with Eadwyn", with its waiting row proposals (AF16).
          : moduleFill ? <FillModule key={`${slug}-${projectId}`} refresh={reload} target={moduleFill} projectId={projectId} moduleName={moduleName} aiOff={!fillsOn}
            onChanged={() => setReload((n) => n + 1)}
            onEdit={(p) => {
              const i = forms.findIndex((f) => f.key === moduleFill.form);
              navigate(addHref(forms[i], i), { state: { under: `${location.pathname}${location.search}`, fillRow: { uid: p.uid, row: p.row, form: moduleFill.form } } });
            }} /> : null}
          {projectId && slug && !narrativeAdmin && <ModuleWorkingHere key={`${projectId}:${slug}`} projectId={projectId} module={slug} moduleLabel={moduleName} readOnly={Boolean(supportOpen)} />}
        </>}
      >
        {cycle === 'grow' && <PublishedFromHere part={module?.parts?.publish} />}
        {fillKind && projectId && (
          <FillProposals key={`${slug}-${fillKind}`} projectId={projectId} kind={fillKind} enabled={fillsOn} ai={ai} workspace={name} onApplied={() => setReload((n) => n + 1)}
            railOption={`fill:${fillKind}`} />
        )}
        {fillsOn && projectId ? drafts.map((draft) => (
          <ZoneDraft key={`${slug}-${draft.surface}`} {...draft} scopeKey={String(projectId)} scoped={cycle === 'raise' && slug === 'investor-narrative'} ai={ai} accent="violet" railOption={`draft:${draft.surface}`} />
        )) : null}
        {/* D757 §2.7 (#1928): each Validate module's interview suggestions, writers only. Verdict takes none. */}
        {moduleStatus === 'ready' && cycle === 'validate' && slug !== 'verdict' && (
          <FromYourInterviews parts={module?.parts}
            onAccept={(id, payload) => interviewSessionsApi.accept(id, payload).then(() => setReload((n) => n + 1))}
            onDiscard={(id) => interviewSessionsApi.discard(id).then(() => setReload((n) => n + 1))}
            onAcceptAll={(batches) => acceptSuggestions(batches, interviewSessionsApi).finally(() => setReload((n) => n + 1))} />
        )}
        {moduleStatus === 'ready' && fnOf(def.parts, slug)?.(module, { projectId, reload: () => setReload((n) => n + 1), openAction, query, openDialog, role: user?.role ?? null })}
        {moduleStatus === 'ready' && cycle === 'raise' && slug === 'fundraising-readiness' && module?.parts?.pmf?.inputs_hash && user?.role === 'founder' && projectId && <PmfExplain key={projectId} projectId={projectId} inputsHash={module.parts.pmf.inputs_hash} ai={ai} />}
        {moduleStatus === 'ready' && cycle === 'raise' && slug === USE_OF_FUNDS && user?.role === 'founder' && projectId && <UseOfFundsEadwyn key={projectId} projectId={projectId} ai={ai} />}
      </ModulePage>
    );
  }
  // D4485: DS1 cards sit above the existing channels, draft and connector tools.
  if (distribution && distributionTab === 'overview' && projectStatus === 'ready') {
    body = <OverviewTab key={projectId} projectId={projectId} search={q} refresh={reload}>{body}</OverviewTab>;
  }
  // D4484: Overview keeps the existing module body; unlanded tabs read no campaign data.
  // D4487: new campaigns are full pages; a campaign uid is a sheet over its list.
  if (distribution) {
    if (distributionTab === 'overview' && projectStatus === 'ready') body = <><InboxNeedsYou reading={inboxUnread} search={q} /><SequenceNeedsYou projectId={projectId} search={q} />{body}</>;
    if (distributionTab === 'calendar' && projectStatus === 'ready') body = <CalendarTab projectId={projectId} key={projectId} aiOff={!fillsOn} />;
    if (distributionTab === 'channels' && projectStatus === 'ready') body = <ChannelsTab projectId={projectId} refresh={reload} onChanged={() => setReload((n) => n + 1)} fillFor={fillFor} />;
    if (distributionTab === 'prospects' && projectStatus === 'ready') body = <ProspectsPage key={projectId} projectId={projectId} />;
    if (distributionTab === 'inbox' && projectStatus === 'ready') body = <InboxTab projectId={projectId} DraftIntent={DistributionAskIntent} onUnreadChange={inboxUnread.acceptRead} />;
    // D4490 integration (#4484): Ads was built in #4510 but never mounted; it reads its own campaign list and Ask.
    if (distributionTab === 'ads' && projectStatus === 'ready') body = <AdsTab projectId={projectId} aiOff={!fillsOn} />;
    body = campaignNew ? (projectStatus === 'ready' ? <NewCampaignPage key={`${projectId}:${location.search}`} projectId={projectId} role={user?.role} search={q} aiOff={!fillsOn} /> : body) : <DistributionTabs projectId={projectStatus==='ready'?projectId:null} tab={distributionTab} search={q} action={action} aiOff={!fillsOn} inboxCount={inboxUnread.count}
      loading={projectStatus === 'loading' || (distributionTab === 'overview' && projectStatus === 'ready' && moduleStatus === 'loading')}>
      {['channels', 'inbox', 'calendar', 'prospects', 'ads'].includes(distributionTab) && projectStatus === 'ready' ? body : distributionTab === 'overview' || projectStatus !== 'ready' ? body : distributionTab === 'campaigns' ? <CampaignsTab key={projectId} projectId={projectId} role={user?.role} search={q} campaignUid={campaignUid}/> : distributionTab === 'results' ? <ResultsTab key={projectId} projectId={projectId} /> : distributionTab === 'newsletter' ? <NewsletterTab /> : <ComingSoon />}
    </DistributionTabs>;
  }

  // D914: nothing of the narrative is drawn for an admin before their reason; then it is read only.
  if (narrativeAdmin && projectStatus !== 'none' && !actionPage) {
    body = <NarrativeAdminGate projectId={projectId} onOpened={() => setReload((n) => n + 1)} back={{ to: `/raise${q}`, label: 'Back to Raise' }}>{body}</NarrativeAdminGate>;
  }

  // D698 — where the rail is: the cycle, and on a module route the module, so
  // it reads "Validate › Customer research". In record mode `RecordCrumb`
  // adds the record's title (D696). The provider draws no element.
  // The rail sits in the one frame every rail host uses (D556), as the
  // Validate desk's own did; the frame is this page's outermost element so it
  // docks to the edge.
  // D5074 (#5074): the venture this page resolved, for every tool under it (`useVenture()`).
  return (
    <VentureProvider projectId={projectId} status={projectStatus} reloadKey={projectsKey}>
    <RailCrumbsProvider section={name} module={moduleName}>
    <RailFrame rail={rail} className={distribution ? 'distribution-frame' : undefined} data-testid={`cycle-route-${cycle}`}>
      {/* Every cycle path is full-bleed (`cyclePaths.js`, D694), so this is the
          one gutter: the canvas's 22/24/30px (CO:54), 14/14/40px in a cycle
          column under 760px (CO:18), and 14/22/18px on a phone (CO:25-26).
          The column is the size container. The form sheets and the action
          Mount draw `fixed` layers, so they sit after it: an older browser
          would place them against the column (decision 13). */}
      {/* D703 decision 11: below 1024px an action page is the route's only
          content, so neither the size container nor the body is drawn. */}
      {!actionPage && (
      <div className="@container/cycle min-w-0">
      <div className={distribution ? 'min-w-0' : CYCLE_GUTTER} data-testid="cycle-route-body">
        <LightboxBarProvider bar={phone ? phoneBar(pageBack) : null}>
        {phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}
        </LightboxBarProvider>
        {creates && !record && (
          <CreateStartupForm
            open={creating}
            onOpenChange={(next) => {
              setCreating(next);
              // Drop ?new=1 once the form closes, so a reload does not reopen it.
              if (!next && searchParams.get('new') === '1') {
                setSearchParams((old) => { const params = new URLSearchParams(old); params.delete('new'); return params; }, { replace: true });
              }
            }}
            onCreated={(created) => { if (created?.id) writeProject(created.id, ['new']); setProjectsKey((n) => n + 1); }}
          />
        )}
      </div>
      </div>
      )}
      {!phone && openForm}
      {record && recordState.confirm}
      {lightbox && Mount && projectId && (
        <Mount projectId={projectId} q={q} searchParams={searchParams} onClose={closeAction} onDone={onDone}
          asPage={phone ? { pageBelow: 'lg', bar: phoneBar(moduleName || name, cycle !== 'validate'), pageClass: PHONE_GUTTER } : undefined}
          onChanged={() => { dirty.current = true; }} />
      )}
      {actionPage && cycle === 'validate' && (
        <div className="px-[22px] pb-6" data-testid="record-eadwyn-entry">
          <EadwynButton label="Validate · Record a session" inline />
        </div>
      )}
      {dialog && !(phone && dialog.page) && dialog.element}
      <RecordCrumb title={record && recordState.status === 'ready' ? recordState.data?.title : null} type={`${cycle}/${slug}`} id={narrativeTab || capTableTab || dataRoomTab ? null : recordId ?? null} />
    </RailFrame>
    </RailCrumbsProvider>
    </VentureProvider>
  );
}
