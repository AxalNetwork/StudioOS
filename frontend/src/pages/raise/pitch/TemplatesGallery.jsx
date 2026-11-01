import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { railPressHeaders } from '../../../lib/railPage';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, WorkerRail } from '../../../ui';
import { useRailOption } from '../../../ui/railCrumbs';
import PitchPage from './PitchPage';
import { SURFACES } from './deckV2Adapter';

/**
 * D1535 (#3782) put the template routes on main and swapped the adapter's
 * `templates`, `myTemplates` and `saveAsTemplate`. This screen does not read
 * them yet: until S1 wires the filters and Yours to those methods, they stay
 * greyed with the seam's words, so no chip looks live and does nothing.
 */
const NOT_WIRED = (name) => Object.freeze({ available: false, reason: 'Not switched on yet.', issue: SURFACES[name].issue });
import { LATER } from './deckV2Model';
import { deckRail } from './deckRailGroups';
import { refusalOf } from './newDeckModel';
import { RefusalLine, reviewHref } from './OneClickBuild';
import { EDIT_PATH, READ_ONLY, STUDIO_PATH, asList, isReadOnly, ventureQuery } from './pitchStudioModel';
import {
  FILTERS, GALLERY, LOCKED_LINE, METHODS_FAILED, NO_TEMPLATES, RECOMMENDED, SAVE_MINE, SAVE_MINE_LINE, TEMPLATES_TITLE, USE_TEMPLATE, YOURS,
  galleryTiles, templateSentence,
} from './templatesModel';

/**
 * D1604 (#3716, pd29, plan §7) — the templates gallery at
 * /raise/pitch/templates, behind the same boundary as the studio (App.jsx).
 *
 *   Gallery   wired now from `GET /api/decks/methods`: a tile per template
 *             with a thumbnail of its first cards, its name, "N cards" and
 *             what it is best for; a locked one reads "Part of a paid plan".
 *             `GET /api/decks/recommend` marks the one recommended for the
 *             venture's stage, first, with its reason. Selecting a tile
 *             previews its cards; Use this template fills it from the records
 *             (`POST /api/decks/apply-method`, rail option form:deck-template)
 *             as a proposal and lands on the shared review, so nothing is
 *             saved before Accept. The Spin-Out demo day template is the one
 *             exception on main: it copies Lab records with no model and
 *             writes its version at once, and its dialog says so
 *             (`templateSentence`). A refusal keeps its plan link.
 *   Filters   Stage, Audience (New deck's seven) and Style chips, greyed
 *             "Coming later" from the adapter until #3782's tagged store.
 *   Yours     "Your own templates" and Save as my template, from the adapter
 *             (#3782): "Not switched on yet.", never an empty list.
 *
 * A reader (read-only HQ) browses and gets no Use this template.
 *
 * Gallery and Yours are two buttons with `aria-pressed`, as New deck's Length
 * switcher is, not an ARIA tab list.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50 dark:disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep dark:bg-violet-600 dark:text-white dark:hover:bg-violet-500`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const SMALL = 'text-[11.5px] text-axal-muted dark:text-gray-400';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const PILL = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const PILL_VIO = `${PILL} border-axal-lavender-edge bg-axal-lavender text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300`;
const PILL_MU = `${PILL} border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;

function useRead(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(load).then(
      (data) => { if (live) setState({ status: 'ok', data }); },
      (e) => { if (live) setState({ status: 'error', data: null }); reportError('pitch-templates:read', e); },
    );
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

export default function TemplatesGallery() {
  const { user } = useAuth() || {};
  const readOnly = isReadOnly(user);
  const [params] = useSearchParams();
  const requested = params.get('project_id');
  const projects = useRead(() => api.listProjects(), []);
  const list = asList(projects.data, 'items', 'projects');
  const project = list.find((p) => String(p.id) === String(requested)) || list[0] || null;
  const projectId = project?.id ?? null;
  const q = ventureQuery(projectId || requested);
  const [tab, setTab] = useState('gallery');
  const railGroups = useMemo(() => deckRail(null), []);
  const rail = <WorkerRail workspace="Raise" role="founder" groups={railGroups} note="A template is filled from your records as a proposal; you review it before anything is saved." data-testid="pitch-templates-rail" />;

  return (
    <PitchPage rail={rail} crumb={{ query: q, trail: TEMPLATES_TITLE }} ask={{ projectId, readOnly }} testId="pitch-templates">
      <div className="flex flex-col gap-4 pb-24 lg:pb-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className={`m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] ${INK}`}>{TEMPLATES_TITLE}</h1>
          <div role="group" aria-label={TEMPLATES_TITLE} className="flex gap-1 rounded-[9px] bg-axal-ground p-1 dark:bg-gray-800">
            {[['gallery', GALLERY], ['yours', YOURS]].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
                className={`min-h-[32px] rounded-[7px] px-3 text-[12.5px] font-bold ${tab === id ? 'bg-white text-axal-violet shadow-sm dark:bg-gray-900 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}
                data-testid={`pitch-templates-tab-${id}`}>{label}</button>
            ))}
          </div>
        </header>
        {readOnly ? <div role="note" className="rounded-[10px] bg-amber-100 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="pitch-templates-readonly">{READ_ONLY}</div> : null}
        <Filters />
        {tab === 'yours' ? <Yours /> : <Gallery projectId={projectId} projects={projects} q={q} readOnly={readOnly} />}
      </div>
    </PitchPage>
  );
}

/** Stage, Audience and Style: greyed until #3782's tags, each chip reached by the keyboard so its reason is read. */
function Filters() {
  const off = NOT_WIRED('templates');
  const later = off && off.available !== true;
  return (
    <section className={`${CARD} flex flex-col gap-2 p-3.5`} aria-label="Filters" data-testid="pitch-templates-filters">
      {FILTERS.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center gap-1.5" data-testid={`pitch-templates-filter-${f.id}`}>
          <span className={`${EYE} w-[72px]`}>{f.label}</span>
          {f.chips.map((c) => (
            <button key={c} type="button" aria-pressed="false" aria-disabled={later ? 'true' : undefined} title={later ? off.reason : undefined}
              className="min-h-[30px] rounded-full border border-axal-hairline px-2.5 text-[11.5px] font-semibold text-axal-muted dark:border-gray-700 dark:text-gray-500"
              onClick={(e) => e.preventDefault()}>{c}</button>
          ))}
        </div>
      ))}
      {later ? <span className={`${SMALL} font-mono`} title={off.reason} data-testid="pitch-templates-filters-later">{LATER}</span> : null}
    </section>
  );
}

function Yours() {
  const mine = NOT_WIRED('myTemplates');
  const save = NOT_WIRED('saveAsTemplate');
  return (
    <section className={`${CARD} flex flex-col gap-2.5 p-5`} aria-label={YOURS} data-testid="pitch-templates-yours">
      <span className={`text-[14px] font-extrabold ${INK}`}>{YOURS}</span>
      <span className={MUTED} data-testid="pitch-templates-yours-off">{mine?.available === true ? null : mine?.reason}</span>
      <span className="flex flex-wrap items-center gap-2" title={save?.reason}>
        <button type="button" className={GHOST} aria-disabled="true" onClick={(e) => e.preventDefault()} data-testid="pitch-templates-save-mine">{SAVE_MINE}</button>
        <span className="font-mono text-[10px] text-axal-muted dark:text-gray-500">{LATER}</span>
      </span>
      <span className={SMALL}>{SAVE_MINE_LINE}</span>
    </section>
  );
}

function Gallery({ projectId, projects, q, readOnly }) {
  const navigate = useNavigate();
  const methods = useRead(() => api.deckMethods(), []);
  const recommended = useRead(() => (projectId == null ? null : api.deckRecommend(projectId)), [projectId]);
  const tiles = useMemo(() => galleryTiles(methods.data?.methods, recommended.status === 'ok' ? recommended.data : null), [methods.data, recommended.status, recommended.data]);
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  useRailOption(busy ? 'form:deck-template' : null, USE_TEMPLATE);
  const tile = tiles.find((t) => t.id === selected) || null;

  const use = async () => {
    if (!tile || projectId == null) return;
    setBusy(true); setRefusal(null);
    try {
      const r = await api.deckApplyMethod(projectId, tile.id, railPressHeaders('form:deck-template'));
      setConfirm(false);
      if (r?.deck) navigate(`${EDIT_PATH}${q}`);
      else if (r?.proposal?.id != null) navigate(reviewHref(q, r.proposal.id));
      else navigate(`${STUDIO_PATH}${q}`);
    } catch (e) { setRefusal(refusalOf(e)); setConfirm(false); reportError('pitch-templates:use', e); } finally { setBusy(false); }
  };

  if (methods.status === 'loading') {
    return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" data-testid="pitch-templates-loading">{[0, 1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" />)}</div>;
  }
  if (methods.status === 'error') {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} role="alert" data-testid="pitch-templates-error">
        <span className={`text-[13.5px] font-bold ${INK}`}>{METHODS_FAILED}</span>
        <button type="button" className={GHOST} onClick={methods.retry}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
      </div>
    );
  }
  if (!tiles.length) return <div className={`${CARD} p-6 text-center ${MUTED}`} data-testid="pitch-templates-empty">{NO_TEMPLATES}</div>;
  const canUse = !readOnly && projectId != null && projects.status === 'ok';

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3" aria-label={GALLERY} data-testid="pitch-templates-gallery">
        {tiles.map((t) => (
          <li key={t.id}>
            <button type="button" aria-pressed={selected === t.id} onClick={() => setSelected(t.id)}
              className={`${CARD} flex w-full flex-col gap-2 p-2.5 text-left ${selected === t.id ? 'outline outline-2 outline-axal-violet dark:outline-violet-400' : ''}`}
              data-testid={`pitch-templates-tile-${t.id}`}>
              <span className="flex aspect-video w-full flex-col justify-end gap-0.5 rounded-[6px] border border-axal-hairline bg-axal-ground p-2.5 dark:border-gray-700 dark:bg-gray-800" aria-hidden="true">
                <span className={`text-[12.5px] font-extrabold leading-tight ${INK}`}>{t.titles[0] || t.label}</span>
                {t.titles.slice(1, 4).map((x, i) => <span key={`${x}-${i}`} className="text-[10px] text-axal-muted dark:text-gray-400">{x}</span>)}
              </span>
              <span className={`text-[13px] font-bold ${INK}`}>{t.label}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {t.count ? <span className={SMALL}>{t.count}</span> : null}
                {t.recommended ? <span className={PILL_VIO} data-testid="pitch-templates-recommended">{RECOMMENDED}</span> : null}
                {t.locked ? <span className={PILL_MU}><Lock size={11} aria-hidden="true" />{LOCKED_LINE}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <aside className={`${CARD} flex flex-col gap-2.5 p-4`} aria-label="Preview" data-testid="pitch-templates-preview">
        {tile ? (
          <>
            <span className={EYE}>Preview · {tile.label}</span>
            {tile.bestFor ? <span className={MUTED}>{tile.bestFor}</span> : null}
            {tile.reason ? <span className={SMALL} data-testid="pitch-templates-reason">{tile.reason}</span> : null}
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {tile.titles.map((x, i) => (
                <li key={`${x}-${i}`} className="flex gap-2 text-[12px]"><span className="font-mono text-axal-muted dark:text-gray-400">{String(i + 1).padStart(2, '0')}</span><span className={INK}>{x}</span></li>
              ))}
            </ol>
            {tile.locked ? <span className={SMALL}>{LOCKED_LINE}. <Link to="/pricing" className="font-bold text-axal-violet hover:underline dark:text-violet-300">See plans ›</Link></span> : null}
            {canUse && !tile.locked ? <button type="button" className={PRIMARY} onClick={() => setConfirm(true)} data-testid="pitch-templates-use">{USE_TEMPLATE}</button> : null}
            <RefusalLine refusal={refusal} testId="pitch-templates-refusal" />
          </>
        ) : <span className={MUTED}>Select a template to see its cards.</span>}
      </aside>
      {confirm && tile ? (
        <Lightbox label={USE_TEMPLATE} title={USE_TEMPLATE} width={480} onClose={() => !busy && setConfirm(false)} testId="pitch-templates-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={use} disabled={busy} data-testid="pitch-templates-confirm">{busy ? 'Working…' : USE_TEMPLATE}</button>
            </div>
          )}>
          <p className={`m-0 ${MUTED}`} data-testid="pitch-templates-dialog-sentence">{templateSentence(tile.id)}</p>
        </Lightbox>
      ) : null}
    </div>
  );
}
