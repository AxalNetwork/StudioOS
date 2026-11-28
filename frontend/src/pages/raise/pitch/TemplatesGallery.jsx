import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, WorkerRail } from '../../../ui';
import PitchPage from './PitchPage';
import { elementsLibrary, myTemplates, saveAsTemplate, templates } from './deckV2Adapter';
import { deckTemplatesApi } from '../../../lib/api/deckTemplates';
import { deckRail } from './deckRailGroups';
import { refusalOf } from './newDeckModel';
import { RefusalLine, reviewHref } from './OneClickBuild';
import { READ_ONLY, asList, currentVersion, isReadOnly, ventureQuery } from './pitchStudioModel';
import {
  GALLERY, NO_MATCH, NO_TEMPLATES, PREVIEW_FAILED, SAVED_MINE, SAVE_MINE, SAVE_MINE_LINE, SAVE_NO_DECK, STORE_FAILED, TEMPLATES_TITLE,
  STORE_SENTENCE, USE_TEMPLATE, YOURS, YOURS_EMPTY, filterGroups, previewTitles, storeTiles, toggleFilter,
} from './templatesModel';
import HeaderAsk from '../../../ui/HeaderAsk.jsx';
import DeckPreview, { previewRead } from './DeckPreview';
import TemplateSlide, { TemplateFullSize, ViewNote, ViewSwitch, useThemeFonts } from './TemplateSlide';
import {
  DEFAULT_VIEW, SCALED_LINE, carryLines, decorArt, decorIcons, needsDecorArt, previewFace, previewSlides, sheetCard, takeaway, templateSets, viewFor,
} from './templatePreviewModel';
import { usePhoneWidth } from '../../../ui/phone/usePhoneWidth.js';

/**
 * D1604 (#3716, pd29), wired to the template store by #3876 (canvas pd29c,
 * pd29s, pd29y): the templates gallery at /raise/pitch/templates, behind the
 * same boundary as the studio (App.jsx).
 *
 *   Gallery   the store's templates (`deckV2Adapter.templates`, D1535): 24
 *             covers, each the template's title card on its own swatch
 *             ("[Venture name]" and "[One-line pitch]" only), its name, "N
 *             cards", its stage, style and audiences. The Stage, Audience
 *             (New deck's seven) and Style chips filter the list on the
 *             Worker, one chip per group. Selecting a cover opens PREVIEW
 *             with every card in order (`GET /decks/templates/:uid`); Use this
 *             template writes a proposal (`POST …/:uid/apply`), which runs no
 *             model, and lands on the shared review: nothing is saved before
 *             Accept. v1's deck methods stay on New deck (D1535 Q5).
 *   Yours     the caller's own templates, used the same way, and Save as my
 *             template from the venture's current version: text and figures
 *             are removed; structure, theme and decor are kept.
 *
 * D8770 (#8770, canvas PTP01 to PTP05): every preview card is the card laid
 * out once at export size in the template's own theme and scaled
 * (`TemplateSlide`), with charts plotted. The aside and Preview all slides
 * switch between Example (a marked fictional company, `templateExamples.js`,
 * first, owner Q1 A) and Blank structure (the store's placeholders, the only
 * thing Use this template sends for: it posts the uid). Each card offers Open
 * full size, which has Previous, Next and Read this slide.
 *
 * D8770 part 3 (canvas PTP16, PTP20 to PTP25): each card draws its
 * template's chrome and decor (the library's icons, shapes and textures read
 * once per preview, `elementsLibrary`). A preview whose cards could not be
 * read offers Try again, and Use this template stays off until they read. A
 * template the example covers none of shows its blank structure and says the
 * example is unavailable. Below 1024 px the preview opens as a sheet over the
 * covers (one card, Preview all N slides, Use this template pinned to its
 * foot), not under all 24 of them, and its controls are 44 px on a phone.
 *
 * A reader (read-only HQ) browses and gets no Use this template and no Save.
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
const TAG = 'inline-flex items-center rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
const FIELD = 'min-h-[40px] w-full rounded-[9px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

/** An adapter read (`{ available, value }`): loading → ok | error, with Try again. */
function useAdapter(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, reason: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.resolve().then(load).then(
      (r) => {
        if (!live) return;
        if (r && r.available === false) setState({ status: 'error', data: null, reason: r.reason || null });
        else setState({ status: 'ok', data: r && 'value' in r ? r.value : r, reason: null });
      },
      (e) => { if (live) setState({ status: 'error', data: null, reason: null }); reportError('pitch-templates:read', e); },
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
  const projects = useAdapter(() => api.listProjects(), []);
  const list = asList(projects.data, 'items', 'projects');
  const project = list.find((p) => String(p.id) === String(requested)) || list[0] || null;
  const projectId = project?.id ?? null;
  const q = ventureQuery(projectId || requested);
  const [tab, setTab] = useState('gallery');
  const [filters, setFilters] = useState({ stage: null, audience: null, style: null });
  const railGroups = useMemo(() => deckRail(null), []);
  const rail = <WorkerRail workspace="Raise" role="founder" groups={railGroups} note="A template becomes a proposal with your venture's name; you review it before anything is saved. No model runs to use one." data-testid="pitch-templates-rail" />;
  const gallery = useAdapter(() => templates(filters), [filters.stage, filters.audience, filters.style]);
  const canUse = !readOnly && projectId != null && projects.status === 'ok';

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
          <HeaderAsk />
        </header>
        {readOnly ? <div role="note" className="rounded-[10px] bg-amber-100 px-3 py-2 text-[12.5px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="pitch-templates-readonly">{READ_ONLY}</div> : null}
        {tab === 'yours'
          ? <Yours projectId={projectId} q={q} canUse={canUse} readOnly={readOnly} />
          : (
            <>
              <Filters read={gallery} filters={filters} onToggle={(g, k) => setFilters((f) => toggleFilter(f, g, k))} />
              <Browse read={gallery} q={q} projectId={projectId} canUse={canUse} filtered={Boolean(filters.stage || filters.audience || filters.style)} testId="pitch-templates-gallery" label={GALLERY} empty={NO_TEMPLATES} />
            </>
          )}
      </div>
    </PitchPage>
  );
}

/** Stage, Audience and Style from the store's own list: one chip per group; pressing the chosen one clears it. */
function Filters({ read, filters, onToggle }) {
  const groups = filterGroups(read.data);
  if (!groups.some((g) => g.chips.length)) return null;
  return (
    <section className={`${CARD} flex flex-col gap-2 p-3.5`} aria-label="Filters" data-testid="pitch-templates-filters">
      {groups.map((g) => (
        <div key={g.id} role="group" aria-label={g.label} className="flex flex-wrap items-center gap-1.5" data-testid={`pitch-templates-filter-${g.id}`}>
          <span className={`${EYE} w-[72px]`}>{g.label}</span>
          {g.chips.map((c) => {
            const on = filters[g.id] === c.key;
            return (
              <button key={c.key} type="button" aria-pressed={on} onClick={() => onToggle(g.id, c.key)}
                className={`min-h-[30px] rounded-full border px-2.5 text-[11.5px] font-semibold ${on ? 'border-violet-300 bg-axal-lavender text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200' : 'border-axal-hairline text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                data-testid={`pitch-templates-chip-${g.id}-${c.key}`}>{c.label}</button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

/** pd29c: the template's title card on its swatch, placeholders only; its accent and display face when the store gives them. */
/** The covers and the preview for one list (the Gallery or Yours). */
function Browse({ read, q, projectId, canUse, filtered = false, testId, label, empty }) {
  const navigate = useNavigate();
  const tiles = useMemo(() => (read.status === 'ok' ? storeTiles(read.data) : []), [read.status, read.data]);
  const [selected, setSelected] = useState(null);
  const cache = useRef(new Map()).current;
  const [all, setAll] = useState(false);
  const tile = tiles.find((t) => t.id === selected) || null;
  const [preview, setPreview] = useState({ status: 'idle', titles: [] });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  // D8770: Example first (owner Q1, option A); `full` is the card open at full size.
  const [view, setView] = useState(DEFAULT_VIEW);
  const [full, setFull] = useState(null);
  // D8770 part 3: Try again on a preview that could not be read (PTP16), and the sheet below 1024 px (PTP21).
  const [tries, setTries] = useState(0);
  const phone = usePhoneWidth();
  const deck = preview.status === 'ok' ? preview.deck : null;
  useThemeFonts(deck?.theme);
  const face = useMemo(() => previewFace(deck?.theme), [deck]);
  const blank = useMemo(() => (Array.isArray(deck?.cards) ? deck.cards : []), [deck]);
  // A template the example covers none of is shown as its blank structure, never placeholders posing as the example.
  const exampleOff = blank.length > 0 && viewFor('example', blank) === 'blank';
  const shownView = viewFor(view, blank);
  const shown = useMemo(() => previewSlides(blank, shownView, face), [blank, shownView, face]);
  // The template's decor drawn by the elements library, read once per preview; without it the ornament is left out.
  const wantsArt = useMemo(() => needsDecorArt(blank), [blank]);
  const iconKey = useMemo(() => decorIcons(blank).join(','), [blank]);
  const [art, setArt] = useState(null);
  useEffect(() => {
    setArt(null);
    if (!wantsArt) return undefined;
    let live = true;
    Promise.resolve().then(() => elementsLibrary(iconKey ? { refs: iconKey.split(',') } : {})).then(
      (r) => { if (live) setArt(decorArt(r)); },
      (e) => reportError('pitch-templates:decor', e),
    );
    return () => { live = false; };
  }, [wantsArt, iconKey]);
  const aspect = deck?.template?.aspect === '4:3' ? '4:3' : '16:9';
  const cardLabel = (i) => `Slide ${i + 1} of ${shown.length}, ${blank[i]?.title || `Card ${i + 1}`}: ${takeaway(shown[i]) || ''}`;

  useEffect(() => {
    setFull(null);
    if (!tile) { setPreview({ status: 'idle', titles: [] }); return undefined; }
    let live = true;
    setPreview({ status: 'loading', titles: [] });
    previewRead(cache, tile.id, () => deckTemplatesApi.template(tile.id)).then(
      (r) => { if (live) setPreview({ status: 'ok', titles: previewTitles(r), deck: r }); },
      (e) => { if (live) setPreview({ status: 'error', titles: [] }); reportError('pitch-templates:preview', e); },
    );
    return () => { live = false; };
  }, [tile?.id, tries]); // eslint-disable-line react-hooks/exhaustive-deps

  const use = async () => {
    if (!tile || projectId == null) return;
    setBusy(true); setRefusal(null);
    try {
      const r = await deckTemplatesApi.applyTemplate(tile.id, projectId);
      setConfirm(false);
      if (r?.proposal?.id != null) navigate(reviewHref(q, r.proposal.id));
    } catch (e) { setRefusal(refusalOf(e)); setConfirm(false); reportError('pitch-templates:use', e); } finally { setBusy(false); }
  };

  if (read.status === 'loading') {
    return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" data-testid="pitch-templates-loading">{[0, 1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-[12px] bg-axal-hairline dark:bg-gray-800" aria-hidden="true" />)}</div>;
  }
  if (read.status === 'error') {
    return (
      <div className={`${CARD} flex flex-col items-start gap-2.5 p-5`} role="alert" data-testid="pitch-templates-error">
        <span className={`text-[13.5px] font-bold ${INK}`}>{read.reason && read.reason !== 'could not be read' ? read.reason : STORE_FAILED}</span>
        <button type="button" className={GHOST} onClick={read.retry}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
      </div>
    );
  }
  if (!tiles.length) return <div className={`${CARD} p-6 text-center ${MUTED}`} data-testid={`${testId}-empty`}>{filtered ? NO_MATCH : empty}</div>;

  // Use this template stays off until the template's cards have been read (PTP16).
  const useButton = canUse && preview.status === 'ok'
    ? <button type="button" className={`${PRIMARY} max-sm:min-h-[44px]`} onClick={() => setConfirm(true)} data-testid="pitch-templates-use">{USE_TEMPLATE}</button>
    : null;
  // The aside shows the first three cards; the phone sheet one, the first with a chart (PTP21).
  const asideCards = (phone ? [sheetCard(shown)] : [0, 1, 2]).filter((i) => i < shown.length);
  const previewBody = tile ? (
    <>
      {tile.description ? <span className={MUTED}>{tile.description}</span> : null}
      {tile.audiences.length ? <span className={SMALL} data-testid="pitch-templates-audiences">For: {tile.audiences.join(', ')}</span> : null}
      {preview.status === 'loading' ? <span className={SMALL} aria-busy="true" data-testid="pitch-templates-preview-loading">Reading the cards…</span> : null}
      {preview.status === 'error' ? (
        <div className="flex flex-col items-start gap-2" role="alert" data-testid="pitch-templates-preview-error">
          <span className={`text-[12.5px] font-bold ${INK}`}>{PREVIEW_FAILED}</span>
          <button type="button" className={`${GHOST} max-sm:min-h-[44px]`} onClick={() => setTries((t) => t + 1)} data-testid="pitch-templates-preview-retry"><RefreshCw size={14} aria-hidden="true" /> Try again</button>
        </div>
      ) : null}
      {preview.status === 'ok' ? (
        <div className="flex flex-col gap-3">
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]" data-testid="pitch-templates-sets">
            {templateSets(preview.deck).map(([k, v]) => <React.Fragment key={k}><dt className={`${EYE} self-center`}>{k}</dt><dd className={`m-0 ${INK}`}>{v}</dd></React.Fragment>)}
          </dl>
          <ViewSwitch view={shownView} onChange={setView} exampleOff={exampleOff} testId="pitch-templates-view" />
          <ViewNote view={shownView} exampleOff={exampleOff} testId="pitch-templates-example-note" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{asideCards.map((i) => <TemplateSlide key={`${shownView}-${i}`} slide={shown[i]} index={i} count={shown.length} face={face} aspect={aspect} label={cardLabel(i)} onOpen={() => setFull(i)} initialWidth={phone ? 336 : 306} art={art} testId={`pitch-templates-card-${i}`} />)}</div>
          <button type="button" className={`${GHOST} max-sm:min-h-[44px]`} onClick={() => setAll(true)} data-testid="pitch-templates-all">{phone ? `Preview all ${shown.length} slides` : 'Preview all slides'}</button>
          {phone ? null : (
            <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="pitch-templates-strip">
              {preview.titles.map((x, i) => (
                <li key={`${x}-${i}`} className="flex gap-2 text-[12px]"><span className="font-mono text-axal-muted dark:text-gray-400">{String(i + 1).padStart(2, '0')}</span><span className={INK}>{x}</span></li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </>
  ) : null;

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label={label} data-testid={testId}>
        {tiles.map((t) => (
          <li key={t.id}>
            <button type="button" aria-pressed={selected === t.id} onClick={() => setSelected(t.id)}
              className={`${CARD} flex w-full flex-col gap-2 p-2.5 text-left ${selected === t.id ? 'outline outline-2 outline-axal-violet dark:outline-violet-400' : ''}`}
              data-testid={`pitch-templates-tile-${t.id}`}>
              <DeckPreview cache={cache} cacheKey={t.id} load={() => deckTemplatesApi.template(t.id)} scaled />
              <span className={SMALL}>Template preview · placeholders</span>
              <span className={`text-[13px] font-bold ${INK}`}>{t.label}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {t.count ? <span className={SMALL}>{t.count}</span> : null}
                {t.stage ? <span className={TAG}>{t.stage}</span> : null}
                {t.style ? <span className={TAG}>{t.style}</span> : null}
                {t.audiences[0] ? <span className={TAG}>{t.audiences[0]}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {phone ? (tile ? (
        <Lightbox phone="sheet" label={`Preview · ${tile.label}`} title={tile.label} width={560} onClose={() => setSelected(null)} testId="pitch-templates-sheet"
          footer={useButton || refusal ? <div className="flex flex-col gap-2">{useButton}<RefusalLine refusal={refusal} testId="pitch-templates-refusal" /></div> : null}>
          <div className="flex flex-col gap-2.5">{previewBody}</div>
        </Lightbox>
      ) : null) : (
        <aside className={`${CARD} flex flex-col gap-2.5 p-4`} aria-label="Preview" data-testid="pitch-templates-preview">
          {tile ? (
            <>
              <span className={EYE}>Preview · {tile.label}</span>
              {previewBody}
              {useButton}
              <RefusalLine refusal={refusal} testId="pitch-templates-refusal" />
            </>
          ) : <span className={MUTED}>Select a template to see its cards.</span>}
        </aside>
      )}
      {all && tile && preview.status === 'ok' && full == null ? <Lightbox label={`Preview · ${tile.label}`} title={`Preview · ${tile.label}`} width={1100} onClose={() => setAll(false)} testId="pitch-templates-all-dialog"
        footer={canUse ? <div className="flex justify-end"><button type="button" className={`${PRIMARY} max-sm:min-h-[44px] max-sm:w-full`} onClick={() => { setAll(false); setConfirm(true); }} data-testid="pitch-templates-all-use">{USE_TEMPLATE}</button></div> : null}>
        <div className="flex flex-col gap-3">
          <span className="flex flex-wrap items-center gap-3"><ViewSwitch view={shownView} onChange={setView} exampleOff={exampleOff} testId="pitch-templates-all-view" /><span className={SMALL}>{shown.length} cards · {aspect} · {SCALED_LINE}</span></span>
          <ViewNote view={shownView} exampleOff={exampleOff} testId="pitch-templates-all-note" />
          <div className="grid gap-3 sm:grid-cols-2">{shown.map((slide, i) => (
            <figure key={`${shownView}-${i}`} className="m-0 flex min-w-0 flex-col gap-1">
              <TemplateSlide slide={slide} index={i} count={shown.length} face={face} aspect={aspect} label={cardLabel(i)} onOpen={() => setFull(i)} initialWidth={phone ? 358 : 500} art={art} testId={`pitch-templates-all-${i}`} />
              <figcaption className={SMALL}>{i + 1}. {blank[i]?.title || preview.titles[i]}</figcaption>
            </figure>
          ))}</div>
        </div>
      </Lightbox> : null}
      {full != null && tile && preview.status === 'ok' ? (
        <TemplateFullSize blank={blank} shown={shown} at={full} onMove={setFull} onClose={() => setFull(null)} view={shownView} onView={setView} face={face} aspect={aspect} art={art} exampleOff={exampleOff} phone={phone} />
      ) : null}
      {confirm && tile ? (
        <Lightbox label={USE_TEMPLATE} title={USE_TEMPLATE} width={480} onClose={() => !busy && setConfirm(false)} testId="pitch-templates-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={use} disabled={busy} data-testid="pitch-templates-confirm">{busy ? 'Working…' : USE_TEMPLATE}</button>
            </div>
          )}>
          <p className={`m-0 ${MUTED}`} data-testid="pitch-templates-dialog-sentence">{STORE_SENTENCE}</p>
          {preview.status === 'ok' ? <CarryOver lines={carryLines(preview.deck, tile.label)} /> : null}
        </Lightbox>
      ) : null}
    </div>
  );
}

/** D8770 (PTP05): what Use this template carries over and what it does not; the example never does. */
function CarryOver({ lines }) {
  const list = (title, rows, testId) => (
    <div className="flex flex-col gap-1">
      <span className={EYE}>{title}</span>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]" data-testid={testId}>
        {rows.map(([k, v]) => <React.Fragment key={k}><dt className={`font-bold ${INK}`}>{k}</dt><dd className={`m-0 ${MUTED}`}>{v}</dd></React.Fragment>)}
      </dl>
    </div>
  );
  return (
    <div className="mt-3 flex flex-col gap-3">
      {list('Carries over', lines.carries, 'pitch-templates-carries')}
      {list('Does not carry over', lines.not, 'pitch-templates-not-carried')}
    </div>
  );
}

/** pd29y: the caller's own templates, and Save as my template from the venture's current version. */
function Yours({ projectId, q, canUse, readOnly }) {
  const mine = useAdapter(() => myTemplates(), []);
  const versions = useAdapter(() => (projectId == null ? { value: null } : api.deckListVersions(projectId)), [projectId]);
  const current = versions.status === 'ok' ? currentVersion(asList(versions.data, 'versions', 'decks')) : null;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!current?.id || !name.trim()) return;
    setBusy(true); setRefusal(null);
    const r = await saveAsTemplate(current.id, name.trim());
    setBusy(false);
    if (r?.available === false) { setRefusal({ message: r.reason }); return; }
    setNaming(false); setName(''); setSaved(true); mine.retry();
  };

  return (
    <div className="flex flex-col gap-3.5">
      {!readOnly ? (
        <section className={`${CARD} flex flex-col gap-2 p-4`} aria-label={SAVE_MINE} data-testid="pitch-templates-yours">
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" className={GHOST} disabled={!current?.id || !canUse} onClick={() => { setSaved(false); setNaming(true); }} data-testid="pitch-templates-save-mine">{SAVE_MINE}</button>
            {saved ? <span className={SMALL} role="status" data-testid="pitch-templates-saved">{SAVED_MINE}</span> : null}
          </span>
          <span className={SMALL}>{current?.id ? SAVE_MINE_LINE : SAVE_NO_DECK}</span>
          <RefusalLine refusal={refusal} testId="pitch-templates-save-refusal" />
        </section>
      ) : null}
      <Browse read={mine} q={q} projectId={projectId} canUse={canUse} testId="pitch-templates-mine" label={YOURS} empty={YOURS_EMPTY} />
      {naming ? (
        <Lightbox label={SAVE_MINE} title={SAVE_MINE} width={460} onClose={() => !busy && setNaming(false)} testId="pitch-templates-save-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setNaming(false)} disabled={busy}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={save} disabled={busy || !name.trim()} data-testid="pitch-templates-save-confirm">{busy ? 'Saving…' : 'Save'}</button>
            </div>
          )}>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-axal-ink dark:text-gray-200">
            Name
            <input className={FIELD} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-testid="pitch-templates-save-name" />
          </label>
          <p className={`m-0 mt-2 ${MUTED}`}>{SAVE_MINE_LINE}</p>
        </Lightbox>
      ) : null}
    </div>
  );
}
