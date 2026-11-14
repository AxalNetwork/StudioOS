import { useEffect, useRef, useState } from 'react';
import { notionApi } from '../../lib/api/notion';
import { api as mainApi } from '../../lib/api';
import Lightbox from '../../ui/Lightbox';
import { BTN, INPUT } from './AccountCenter';
import {
  NOTION_MODULES, errorSentence, kindFor, kindLabel, lastRead, moduleOf, previewWarning, rowList, sourcesCount,
} from './notionModel';

/**
 * D1086 (#2951, #2405 part 2) — Notion's page draws the pages a founder
 * shared with Axal VC as its own Sources section, in the provider slot of
 * Your connection (as GitHub's Repositories, D753 F4):
 *   - the list (NT1): name, kind, venture, module, last read, and Stop using,
 *     which asks first in an in-page dialog; a phone draws it stacked;
 *   - its states (NT2): loading, the empty "Share pages with Axal VC", and
 *     Unreadable with Try again;
 *   - the two-step Add a source dialog: a venture, a module and a search,
 *     then, for a database, Map properties (NT4) with a five-row preview that
 *     stores nothing and names the rows it would skip.
 *
 * Axal VC reads Notion and never writes to it; every sentence here says so
 * where it matters. Nothing is drawn as a zero: a source never read says
 * "Not read yet". Drawn only for a connection: without one there is nothing
 * to read, and the page's own Connect says how to start.
 */
export const SOURCES_ID = 'notion-sources';

export default function NotionSourcesSection({ p, api = notionApi, projectsApi = mainApi, phone = false }) {
  const uid = p?.connection?.uid || null;
  const [read, setRead] = useState({ status: 'loading', items: [] });
  const [round, setRound] = useState(0);
  const [adding, setAdding] = useState(null);
  const [stopping, setStopping] = useState(null);
  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    setRead((r) => ({ ...r, status: 'loading' }));
    api.sources().then(
      (r) => { if (live) setRead({ status: 'ready', items: Array.isArray(r?.items) ? r.items : [] }); },
      () => { if (live) setRead({ status: 'unreadable', items: [] }); },
    );
    return () => { live = false; };
  }, [uid, api, round]);
  if (!uid) return null;
  const again = () => setRound((n) => n + 1);
  const items = read.items;
  return (
    <section id={SOURCES_ID} aria-label="Pages you shared" data-testid="notion-sources" className="scroll-mt-6 flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[13.5px] font-bold text-axal-ink dark:text-gray-100">
          Pages you shared{read.status === 'ready' && items.length > 0 && <span className="font-normal text-axal-muted dark:text-gray-400" data-testid="notion-sources-count"> · {sourcesCount(items)}</span>}
        </h3>
        {read.status === 'ready' && items.length > 0 && (
          <button type="button" className={BTN.ghost} onClick={() => setAdding({})} data-testid="notion-sources-add">Choose from Notion</button>
        )}
      </div>
      {read.status === 'loading' && <p className={MUTED} role="status" data-testid="notion-sources-loading">Reading the pages you shared…</p>}
      {read.status === 'unreadable' && (
        <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-sources-unreadable">
          The pages you shared could not be read.{' '}
          <button type="button" className={BTN.link} onClick={again} data-testid="notion-sources-retry">Try again</button>
        </p>
      )}
      {read.status === 'ready' && items.length === 0 && (
        <div className={`${BOX} flex flex-col items-start gap-2`} data-testid="notion-sources-empty">
          <p className="m-0 text-[13.5px] font-semibold">Share pages with Axal VC</p>
          <p className={MUTED}>Axal VC opens only the pages you share, for the module you choose. It never changes them in Notion.</p>
          <button type="button" className={BTN.primary} onClick={() => setAdding({})} data-testid="notion-sources-share">Share Notion pages</button>
        </div>
      )}
      {read.status === 'ready' && items.length > 0 && (phone
        ? <SourcesStack items={items} onStop={setStopping} />
        : <SourcesTable items={items} onStop={setStopping} />)}
      {stopping && <StopUsing source={stopping} api={api} onClose={() => setStopping(null)} onDone={() => { setStopping(null); again(); }} />}
      {adding && <AddSource api={api} projectsApi={projectsApi} onClose={() => { setAdding(null); again(); }} />}
    </section>
  );
}

function LastRead({ source, prefix = '' }) {
  const l = lastRead(source);
  const tone = l.tone === 'bad' ? 'text-red-700 dark:text-red-300' : l.tone === 'warn' ? 'text-amber-800 dark:text-amber-200' : l.tone === 'muted' ? 'text-axal-faint dark:text-gray-500' : 'text-axal-ink dark:text-gray-200';
  return <span className={tone}>{prefix}{l.text}</span>;
}

function SourceName({ s }) {
  const title = s.title || 'Untitled';
  return s.url
    ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-axal-ink hover:underline dark:text-gray-100 dark:hover:underline">{title}</a>
    : <span className="font-semibold">{title}</span>;
}

function SourcesTable({ items, onStop }) {
  return (
    <div className={`${BOX} overflow-x-auto !p-0`}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]" data-testid="notion-sources-table">
        <thead>
          <tr className="border-b border-axal-hairline dark:border-gray-800">
            {['Name', 'Kind', 'Venture', 'Module', 'Last read', ''].map((h) => <th key={h || 'act'} scope="col" className={TH}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid={`notion-source-${s.uid}`}>
              <td className={TD}><SourceName s={s} /></td>
              <td className={TD}>{kindLabel(s.kind)}</td>
              <td className={TD}>{s.project_name || `Venture ${s.project_id}`}</td>
              <td className={TD}>{s.module_label || moduleOf(s.module)?.label || s.module}</td>
              <td className={TD}><LastRead source={s} /></td>
              <td className={`${TD} text-right`}>
                <button type="button" className={BTN.link} onClick={() => onStop(s)} data-testid={`notion-source-stop-${s.uid}`}>Stop using</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourcesStack({ items, onStop }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="notion-sources-stack">
      {items.map((s) => (
        <li key={s.uid} className={`${BOX} flex flex-col gap-1 !p-3`} data-testid={`notion-source-${s.uid}`}>
          <SourceName s={s} />
          <span className={MUTED}>{kindLabel(s.kind)} · {s.project_name || `Venture ${s.project_id}`} · {s.module_label || s.module}</span>
          <span className="text-[12px]"><LastRead source={s} prefix="Last read " /></span>
          <button type="button" className={`${BTN.link} self-start`} onClick={() => onStop(s)} data-testid={`notion-source-stop-${s.uid}`}>Stop using</button>
        </li>
      ))}
    </ul>
  );
}

/** Stop using, asked first: the rows already read stay in their module; Notion is not changed. */
function StopUsing({ source, api, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const title = source.title || 'this page';
  const label = source.module_label || source.module;
  const stop = async () => {
    setBusy(true); setError(null);
    try { await api.stopSource(source.uid); onDone(); } catch (e) { setError(errorSentence(e)); setBusy(false); }
  };
  return (
    <Lightbox label={`Stop using “${title}”?`} title={`Stop using “${title}”?`} onClose={onClose} width={460} testId="notion-stop-dialog" phone="sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onClose} disabled={busy}>Keep using</button>
          <button type="button" className={BTN.dangerSolid} onClick={stop} disabled={busy} data-testid="notion-stop-confirm">{busy ? 'Stopping…' : 'Stop using'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-2 text-[13px] text-axal-ink dark:text-gray-200">
        <p className="m-0">{label} keeps the rows already read, marked “No longer synced”.</p>
        <p className={MUTED}>Axal VC can no longer open this page. The page in Notion is not changed.</p>
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-stop-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

/**
 * Add a source, in two steps. 1: the venture, the module and a search; a
 * result the module cannot take is not offered. A page is saved at once. 2: a
 * database is saved unmapped, then its properties are mapped here, with a
 * preview of its first five rows that stores nothing.
 */
export function AddSource({ api, projectsApi, onClose }) {
  const [step, setStep] = useState('choose');
  const [saved, setSaved] = useState(null);
  return step === 'map' && saved
    ? <MapProperties api={api} source={saved} onClose={onClose} onBack={() => setStep('choose')} />
    : <ChooseSource api={api} projectsApi={projectsApi} onClose={onClose} onSaved={(s) => { if (s.kind === 'database') { setSaved(s); setStep('map'); } else onClose(); }} />;
}

function ChooseSource({ api, projectsApi, onClose, onSaved }) {
  const [projects, setProjects] = useState(null);
  const [project, setProject] = useState('');
  const [module, setModule] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    projectsApi.listProjects().then(
      (r) => { if (live) setProjects(Array.isArray(r) ? r : r?.items || r?.projects || []); },
      () => { if (live) setProjects(false); },
    );
    return () => { live = false; };
  }, [projectsApi]);
  const search = async (e) => {
    e?.preventDefault?.();
    if (!project || !module) return;
    setBusy(true); setError(null);
    try { const r = await api.search(project, q.trim()); setFound(Array.isArray(r?.items) ? r.items : []); } catch (err) { setError(errorSentence(err)); setFound(null); }
    setBusy(false);
  };
  const choose = async (item) => {
    const kind = kindFor(module, item);
    if (!kind) return;
    setBusy(true); setError(null);
    try { const r = await api.addSource({ project: Number(project), module, kind, notion_id: item.id }); onSaved(r.source); } catch (err) { setError(errorSentence(err)); setBusy(false); }
  };
  const offered = (found || []).filter((f) => kindFor(module, f));
  return (
    <Lightbox label="Choose from Notion" eyebrow="Step 1 of 2" title="Choose from Notion" sub="Axal VC opens only the pages you share. It never changes them." onClose={onClose} width={560} testId="notion-add-dialog">
      <form className="flex flex-col gap-3 text-[13px]" onSubmit={search} data-testid="notion-add-choose">
        {projects === false && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert">Your ventures could not be read.</p>}
        <label className="block font-semibold text-axal-ink dark:text-gray-200">Venture
          <select className={`${INPUT} mt-1`} value={project} onChange={(e) => { setProject(e.target.value); setFound(null); }} disabled={!projects} data-testid="notion-add-project">
            <option value="">{projects === null ? 'Reading your ventures…' : 'Choose a venture'}</option>
            {(projects || []).map((x) => <option key={x.id} value={x.id}>{x.name || `Venture ${x.id}`}</option>)}
          </select>
        </label>
        <label className="block font-semibold text-axal-ink dark:text-gray-200">Module it feeds
          <select className={`${INPUT} mt-1`} value={module} onChange={(e) => { setModule(e.target.value); setFound(null); }} data-testid="notion-add-module">
            <option value="">Choose a module</option>
            {NOTION_MODULES.map((m) => <option key={m.key} value={m.key}>{m.label} · {m.kinds.map(kindLabel).join(' or ')}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <label className="min-w-0 flex-1 font-semibold text-axal-ink dark:text-gray-200">Search your Notion
            <input className={`${INPUT} mt-1`} value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="A page or database title" data-testid="notion-add-q" />
          </label>
          <button type="submit" className={`${BTN.ghost} self-end`} disabled={busy || !project || !module} data-testid="notion-add-search">{busy && !found ? 'Searching…' : 'Search'}</button>
        </div>
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-add-error">{error}</p>}
        {found && (offered.length === 0
          ? <p className={MUTED} data-testid="notion-add-none">Nothing you shared matches, or {moduleOf(module)?.label} takes only a {moduleOf(module)?.kinds.map(kindLabel).join(' or ').toLowerCase()}. Share it with Axal VC in Notion, then search again.</p>
          : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="notion-add-results">
              {offered.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded-axal-sm border border-axal-hairline px-3 py-2 dark:border-gray-800">
                  <span className="min-w-0 break-words"><span className="font-semibold">{f.title || 'Untitled'}</span> <span className="text-axal-muted dark:text-gray-400">· {kindLabel(kindFor(module, f))}</span></span>
                  <button type="button" className={BTN.primary} disabled={busy} onClick={() => choose(f)} data-testid={`notion-add-pick-${f.id}`}>Use this</button>
                </li>
              ))}
            </ul>
          ))}
      </form>
    </Lightbox>
  );
}

/** The map as the Worker takes it, from the dialog's choices: unmapped fields and blank values are left out. */
export function mapFrom(choice, valueChoice, defaultSource) {
  const fields = {};
  for (const [field, property] of Object.entries(choice)) {
    if (!property) continue;
    const values = {};
    for (const [to, from] of Object.entries(valueChoice[field] || {})) if (from && from.trim()) values[from.trim()] = to;
    fields[field] = Object.keys(values).length ? { property, values } : { property };
  }
  return defaultSource ? { fields, default_source: defaultSource } : { fields };
}

function MapProperties({ api, source, onClose, onBack }) {
  const [schema, setSchema] = useState({ status: 'loading' });
  const [choice, setChoice] = useState({});
  const [valueChoice, setValueChoice] = useState({});
  const [defaultSource, setDefaultSource] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [round, setRound] = useState(0);
  const asked = useRef(0);
  useEffect(() => {
    let live = true;
    setSchema({ status: 'loading' });
    api.schema(source.uid).then(
      (r) => {
        if (!live) return;
        const names = (r?.properties || []).map((x) => x.name);
        const pre = {};
        // A property named as the field is chosen for it; nothing else is guessed.
        for (const f of r?.fields || []) { const hit = names.find((n) => n.toLowerCase() === f.label.toLowerCase()); if (hit) pre[f.key] = hit; }
        setChoice(pre);
        setSchema({ status: 'ready', properties: names, fields: r?.fields || [], defaults: r?.default_sources || null });
      },
      () => { if (live) setSchema({ status: 'unreadable' }); },
    );
    return () => { live = false; };
  }, [api, source.uid, round]);
  const fields = schema.fields || [];
  const missing = fields.filter((f) => f.required && !choice[f.key]);
  const map = mapFrom(choice, valueChoice, defaultSource);
  const look = async () => {
    const n = ++asked.current;
    setBusy(true); setError(null);
    try { const r = await api.preview(source.uid, map); if (n === asked.current) setPreview(r); } catch (e) { if (n === asked.current) { setError(errorSentence(e)); setPreview(null); } }
    if (n === asked.current) setBusy(false);
  };
  const use = async () => {
    setBusy(true); setError(null);
    try { await api.mapSource(source.uid, map); onClose(); } catch (e) { setError(errorSentence(e)); setBusy(false); }
  };
  const title = source.title || 'this database';
  const label = source.module_label || moduleOf(source.module)?.label || source.module;
  return (
    <Lightbox label={`Map “${title}” to ${label}`} eyebrow="Step 2 of 2" title={`Map “${title}” to ${label}`} sub="From a Notion database. Axal VC reads this database. It never changes it."
      onClose={onClose} onEscape={onBack} width={640} testId="notion-map-dialog"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={BTN.ghost} onClick={onBack} disabled={busy}>Back</button>
          <button type="button" className={BTN.ghost} onClick={look} disabled={busy || schema.status !== 'ready' || missing.length > 0} data-testid="notion-map-preview">Preview</button>
          <button type="button" className={BTN.primary} onClick={use} disabled={busy || schema.status !== 'ready' || missing.length > 0} data-testid="notion-map-use">Use this mapping</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px] text-axal-ink dark:text-gray-200" data-testid="notion-map">
        {schema.status === 'loading' && <p className={MUTED} role="status">Reading “{title}”…</p>}
        {schema.status === 'unreadable' && (
          <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-map-unreadable">
            “{title}” could not be read.{' '}
            <button type="button" className={BTN.link} onClick={() => setRound((n) => n + 1)}>Try again</button>
          </p>
        )}
        {schema.status === 'ready' && (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2" data-testid="notion-map-rows">
              <span className={TH}>Property in the database</span><span aria-hidden="true" /><span className={TH}>Field</span>
              {fields.map((f) => (
                <MapRow key={f.key} f={f} properties={schema.properties} value={choice[f.key] || ''}
                  onChange={(v) => { setChoice((c) => ({ ...c, [f.key]: v })); setPreview(null); }}
                  values={valueChoice[f.key] || {}} onValues={(v) => { setValueChoice((c) => ({ ...c, [f.key]: v })); setPreview(null); }} />
              ))}
            </div>
            {schema.defaults && !choice.source && (
              <label className="block font-semibold">Where this feedback comes from, when no column says
                <select className={`${INPUT} mt-1`} value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)} data-testid="notion-map-default-source">
                  <option value="">Not recorded</option>
                  {schema.defaults.map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
                </select>
              </label>
            )}
            {missing.length > 0 && <p className={MUTED} data-testid="notion-map-missing">Choose a property for {missing.map((f) => f.label).join(' and ')}: a row without it is not read.</p>}
          </>
        )}
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="notion-map-error">{error}</p>}
        {preview && <Preview preview={preview} fields={fields} map={map} />}
      </div>
    </Lightbox>
  );
}

function MapRow({ f, properties, value, onChange, values, onValues }) {
  return (
    <>
      <select className={INPUT} value={value} onChange={(e) => onChange(e.target.value)} aria-label={`The property for ${f.label}`} data-testid={`notion-map-${f.key}`}>
        <option value="">Don’t use</option>
        {properties.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <span aria-hidden="true" className="text-axal-faint dark:text-gray-500">→</span>
      <span>{f.label}{f.required && <span className="text-axal-muted dark:text-gray-400"> · required</span>}</span>
      {f.type === 'choice' && value && Array.isArray(f.values) && (
        <div className="col-span-3 flex flex-wrap gap-2 pl-3" data-testid={`notion-map-values-${f.key}`}>
          {f.values.map((v) => (
            <label key={v} className="flex items-center gap-1 text-[12px] text-axal-muted dark:text-gray-400">“{v}” is
              <input className={`${INPUT} !w-32 !py-1 !text-[12px]`} value={values[v] || ''} maxLength={200} placeholder={v}
                onChange={(e) => onValues({ ...values, [v]: e.target.value })} aria-label={`The ${value} value that means ${v}`} data-testid={`notion-map-value-${f.key}-${v}`} />
            </label>
          ))}
        </div>
      )}
    </>
  );
}

function Preview({ preview, fields, map }) {
  const shown = fields.filter((f) => map.fields[f.key]);
  const rows = Array.isArray(preview.rows) ? preview.rows : [];
  const skipped = Array.isArray(preview.skipped) ? preview.skipped : [];
  return (
    <div className="flex flex-col gap-2" data-testid="notion-map-preview-rows">
      <p className={TH}>Preview · first {rows.length} rows</p>
      {skipped.map((s) => (
        <div key={`${s.reason}:${s.field}`} className="rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="alert" data-testid={`notion-map-skipped-${s.field}`}>
          <p className="m-0 font-semibold">{previewWarning(s, fields, map)}</p>
          <p className="m-0">{rowList(s.rows)} of the first {preview.read} read.</p>
        </div>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead><tr>{['Row', ...shown.map((f) => f.label)].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`notion-map-preview-${r.n}`}>
                <td className={TD}>{r.n}</td>
                {r.values
                  ? shown.map((f) => <td key={f.key} className={TD}>{r.values[f.key] == null || r.values[f.key] === '' ? <span className="text-axal-faint dark:text-gray-500">—</span> : String(r.values[f.key])}</td>)
                  : <td className={`${TD} text-amber-800 dark:text-amber-200`} colSpan={shown.length}>Skipped: {fields.find((f) => f.key === r.skipped?.field)?.label || 'a field'} {r.skipped?.reason === 'empty_required' ? 'is empty' : 'could not be read'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={MUTED}>A “—” means the cell is empty in the database, so nothing is recorded for it. Nothing is saved until you use this mapping{preview.more ? '; the database has more rows than these' : ''}.</p>
    </div>
  );
}

const BOX = 'rounded-axal-sm border border-axal-hairline bg-white p-4 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const TH = 'm-0 px-3 py-2 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const TD = 'px-3 py-2 align-top';
