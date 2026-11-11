import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, WorkerRail } from '../../../ui';
import PitchPage from './PitchPage';
import { myTemplates, saveAsTemplate, templates } from './deckV2Adapter';
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
function Cover({ cover }) {
  if (!cover) return <span className="flex aspect-video w-full rounded-[6px] border border-axal-hairline bg-axal-ground dark:border-gray-700 dark:bg-gray-800" aria-hidden="true" />;
  const face = cover.font ? `'${cover.font}', 'Space Grotesk', system-ui, sans-serif` : "'Space Grotesk', system-ui, sans-serif";
  return (
    <span className="relative flex aspect-video w-full flex-col justify-center gap-1 overflow-hidden rounded-[6px] px-[8%]" style={{ background: cover.ground, border: `1px solid ${cover.rule || 'rgba(0,0,0,.08)'}` }} aria-hidden="true">
      {cover.accent ? <span className="block h-[4px] w-[14%]" style={{ background: cover.accent }} /> : null}
      <span className="text-[15px] font-bold leading-tight" style={{ color: cover.ink, fontFamily: face }}>[Venture name]</span>
      <span className="text-[10px] leading-snug" style={{ color: cover.muted }}>[One-line pitch]</span>
    </span>
  );
}

/** The covers and the preview for one list (the Gallery or Yours). */
function Browse({ read, q, projectId, canUse, filtered = false, testId, label, empty }) {
  const navigate = useNavigate();
  const tiles = useMemo(() => (read.status === 'ok' ? storeTiles(read.data) : []), [read.status, read.data]);
  const [selected, setSelected] = useState(null);
  const tile = tiles.find((t) => t.id === selected) || null;
  const [preview, setPreview] = useState({ status: 'idle', titles: [] });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);

  useEffect(() => {
    if (!tile) { setPreview({ status: 'idle', titles: [] }); return undefined; }
    let live = true;
    setPreview({ status: 'loading', titles: [] });
    deckTemplatesApi.template(tile.id).then(
      (r) => { if (live) setPreview({ status: 'ok', titles: previewTitles(r) }); },
      (e) => { if (live) setPreview({ status: 'error', titles: [] }); reportError('pitch-templates:preview', e); },
    );
    return () => { live = false; };
  }, [tile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label={label} data-testid={testId}>
        {tiles.map((t) => (
          <li key={t.id}>
            <button type="button" aria-pressed={selected === t.id} onClick={() => setSelected(t.id)}
              className={`${CARD} flex w-full flex-col gap-2 p-2.5 text-left ${selected === t.id ? 'outline outline-2 outline-axal-violet dark:outline-violet-400' : ''}`}
              data-testid={`pitch-templates-tile-${t.id}`}>
              <Cover cover={t.cover} />
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
      <aside className={`${CARD} flex flex-col gap-2.5 p-4`} aria-label="Preview" data-testid="pitch-templates-preview">
        {tile ? (
          <>
            <span className={EYE}>Preview · {tile.label}</span>
            {tile.description ? <span className={MUTED}>{tile.description}</span> : null}
            {tile.audiences.length ? <span className={SMALL} data-testid="pitch-templates-audiences">For: {tile.audiences.join(', ')}</span> : null}
            {preview.status === 'loading' ? <span className={SMALL}>Reading the cards…</span> : null}
            {preview.status === 'error' ? <span className={SMALL} role="alert" data-testid="pitch-templates-preview-error">{PREVIEW_FAILED}</span> : null}
            {preview.status === 'ok' ? (
              <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="pitch-templates-strip">
                {preview.titles.map((x, i) => (
                  <li key={`${x}-${i}`} className="flex gap-2 text-[12px]"><span className="font-mono text-axal-muted dark:text-gray-400">{String(i + 1).padStart(2, '0')}</span><span className={INK}>{x}</span></li>
                ))}
              </ol>
            ) : null}
            {canUse ? <button type="button" className={PRIMARY} onClick={() => setConfirm(true)} data-testid="pitch-templates-use">{USE_TEMPLATE}</button> : null}
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
          <p className={`m-0 ${MUTED}`} data-testid="pitch-templates-dialog-sentence">{STORE_SENTENCE}</p>
        </Lightbox>
      ) : null}
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
