import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  Database, Upload, FileText, Briefcase, BarChart3, Building2, Layers,
  AlertCircle, CheckCircle2, Clock, ArrowLeft, RefreshCw, Download,
} from 'lucide-react';

const BASE = (typeof window !== 'undefined' && window.__API_BASE__) || '/api';

const WIZARDS = [
  { id: 'universal', label: 'Universal CSV', icon: Layers, desc: 'Map any CSV to platform fields (contacts, holders, KYC partners).' },
  { id: 'angellist', label: 'AngelList Stack', icon: FileText, desc: 'Import projects, cap-table, and rounds from the AngelList CSV export.' },
  { id: 'portfolio', label: 'Investor Portfolio', icon: BarChart3, desc: 'Upload your portfolio holdings (CSV) — surfaces in Investor Portal.' },
  { id: 'deck', label: 'Pitch Deck (PDF/PPTX)', icon: FileText, desc: 'Extract slides from a deck and pre-fill the Pitch Deck Builder.' },
  { id: 'carta', label: 'Carta', icon: Building2, desc: 'One-shot pull of company + cap-table from your linked Carta account.' },
  { id: 'hubspot', label: 'HubSpot Pipeline', icon: Briefcase, desc: 'Import a HubSpot pipeline into the Deals board.' },
  { id: 'affinity', label: 'Affinity List', icon: Briefcase, desc: 'Import an Affinity list/pipeline into the Deals board.' },
];

export default function DataImportsTab({ flash }) {
  const [wizard, setWizard] = useState(null);
  const [list, setList] = useState([]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drillId, setDrillId] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([api.importsList(), api.importsQuota()])
      .then(([l, q]) => { setList(l?.imports || []); setQuota(q || null); })
      .catch(() => flash?.('Failed to load imports', 'error'))
      .finally(() => setLoading(false));
  }, [flash]);

  useEffect(() => { reload(); }, [reload]);

  if (wizard) {
    return (
      <div data-card className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <button
          onClick={() => { setWizard(null); reload(); }}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to imports
        </button>
        {wizard === 'universal' && <UniversalCsvWizard flash={flash} onDone={() => { setWizard(null); reload(); }} />}
        {wizard === 'angellist' && <SimpleCsvWizard flash={flash} title="AngelList Stack" previewFn={api.angellistPreview} commitFn={api.angellistCommit} templateUrl={`${BASE}/imports/angellist/template.csv`} onDone={() => { setWizard(null); reload(); }} />}
        {wizard === 'portfolio' && <SimpleCsvWizard flash={flash} title="Investor Portfolio" previewFn={api.portfolioPreview} commitFn={api.portfolioCommit} templateUrl={`${BASE}/imports/portfolio/template.csv`} onDone={() => { setWizard(null); reload(); }} />}
        {wizard === 'deck' && <DeckWizard flash={flash} onDone={() => { setWizard(null); reload(); }} />}
        {wizard === 'carta' && <ProviderWizard flash={flash} provider="carta" title="Carta" onDone={() => { setWizard(null); reload(); }} />}
        {wizard === 'hubspot' && <PipelineCrmWizard flash={flash} title="HubSpot pipeline" listFn={api.hubspotPipelines} importFn={api.hubspotImport} listLabel="Pipeline" entityKey="pipelines" onDone={() => { setWizard(null); reload(); }} />}
        {wizard === 'affinity' && <PipelineCrmWizard flash={flash} title="Affinity list" listFn={api.affinityLists} importFn={api.affinityImport} listLabel="List" entityKey="lists" onDone={() => { setWizard(null); reload(); }} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quota banner */}
      <div data-card className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Data Imports</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Migrate from Carta, AngelList, HubSpot, deck files, or any CSV.
            </p>
          </div>
          {quota && (
            <div className="text-right text-sm">
              <div className="text-gray-700 dark:text-gray-200 font-medium">
                {quota.unlimited ? 'Unlimited' : `${quota.used} / ${quota.cap} this month`}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                {quota.tier} tier
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {WIZARDS.map(w => (
            <button
              key={w.id}
              onClick={() => setWizard(w.id)}
              className="text-left p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
            >
              <div className="flex items-center gap-2 mb-1">
                <w.icon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <div className="font-medium text-gray-900 dark:text-white">{w.label}</div>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">{w.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* History */}
      <div data-card className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Recent imports</h3>
          <button onClick={reload} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No imports yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Target</th>
                  <th className="py-2 pr-3">Rows</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.source}</td>
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{r.target}</td>
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                      {r.rows_succeeded ?? 0}<span className="text-gray-400">/{r.rows_attempted ?? 0}</span>
                      {(r.rows_failed ?? 0) > 0 && <span className="ml-1 text-red-600">({r.rows_failed} err)</span>}
                    </td>
                    <td className="py-2 pr-3"><StatusPill status={r.status} /></td>
                    <td className="py-2 pr-3">
                      {(r.rows_failed > 0 || r.status === 'failed' || r.status === 'partial') && (
                        <button onClick={() => setDrillId(r.id)} className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400">View errors</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {drillId && <ErrorDrillModal id={drillId} onClose={() => setDrillId(null)} />}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    succeeded: { cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
    partial:   { cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', icon: AlertCircle },
    failed:    { cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: AlertCircle },
    running:   { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: Clock },
    pending:   { cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', icon: Clock },
  };
  const cfg = map[status] || map.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${cfg.cls}`}>
      <Icon className="w-3 h-3" /> {status || 'pending'}
    </span>
  );
}

function ErrorDrillModal({ id, onClose }) {
  const [row, setRow] = useState(null);
  useEffect(() => {
    api.importsGet(id).then(setRow).catch(() => setRow(null));
  }, [id]);
  const errs = useMemo(() => {
    // Backend returns `{ import: row }` with row.errors_json as a JSON-encoded
    // array of `{row, error}` entries. Older shapes may also surface a parsed
    // `errors` array directly — accept both.
    const r = row?.import || row;
    if (Array.isArray(r?.errors)) return r.errors;
    try { return JSON.parse(r?.errors_json || '[]'); } catch { return []; }
  }, [row]);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">Import #{id} errors</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">×</button>
        </div>
        {errs.length === 0 ? (
          <div className="text-sm text-gray-500">No row-level errors recorded.</div>
        ) : (
          <ul className="text-sm space-y-1">
            {errs.map((e, i) => (
              <li key={i} className="text-gray-700 dark:text-gray-300">
                <span className="text-red-600 font-mono">row {e.row}:</span> {e.error}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Universal CSV wizard

const UNIVERSAL_TARGETS = [
  { id: 'contacts', label: 'Contacts (Network)', fields: ['name*', 'email', 'company', 'title', 'phone', 'notes'] },
  { id: 'captable_holders', label: 'Cap-table holders', fields: ['name*', 'email', 'security_type', 'shares', 'ownership_pct'] },
  { id: 'kyc_partners', label: 'KYC partner list', fields: ['legal_name*', 'contact_email', 'entity_type', 'jurisdiction'] },
];

function UniversalCsvWizard({ flash, onDone }) {
  const [target, setTarget] = useState('contacts');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);

  const onFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  };

  const doPreview = async () => {
    setBusy(true);
    try {
      const p = await api.universalPreview(csv, target);
      setPreview(p);
      setMapping(p.detected_mapping || p.mapping || {});
    } catch (e) { flash?.(e.message || 'Preview failed', 'error'); }
    finally { setBusy(false); }
  };

  const doCommit = async () => {
    setBusy(true);
    try {
      const out = await api.universalCommit(csv, target, mapping);
      flash?.(`Imported ${out.rows_succeeded}/${out.rows_attempted} rows (${out.rows_failed} failed)`, 'success');
      onDone?.();
    } catch (e) { flash?.(e.message || 'Import failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Universal CSV importer</h3>
      <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Target</label>
      <select value={target} onChange={e => { setTarget(e.target.value); setPreview(null); }}
        className="w-full mb-4 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded">
        {UNIVERSAL_TARGETS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>

      <CsvDrop csv={csv} onCsv={setCsv} onFile={onFile} />

      <div className="mt-4 flex gap-2">
        <button disabled={!csv.trim() || busy} onClick={doPreview}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">Preview</button>
      </div>

      {preview && (
        <div className="mt-6">
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
            Detected <span className="font-medium">{preview.row_count}</span> rows.
          </div>
          <div className="space-y-2 mb-4">
            {UNIVERSAL_TARGETS.find(t => t.id === target).fields.map(f => {
              const key = f.replaceAll('*', '');
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-40 text-sm text-gray-700 dark:text-gray-300">
                    {f.endsWith('*') ? <span><span className="text-red-500">*</span> {key}</span> : key}
                  </div>
                  <select value={mapping[key] || ''} onChange={e => setMapping({ ...mapping, [key]: e.target.value })}
                    className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded text-sm">
                    <option value="">— skip —</option>
                    {(preview.headers || []).map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <button disabled={busy} onClick={doCommit}
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50">Commit import</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Simple CSV wizard (preview + commit, server-driven mapping)

function SimpleCsvWizard({ flash, title, previewFn, commitFn, templateUrl, onDone }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ''));
    reader.readAsText(file);
  };

  const doPreview = async () => {
    setBusy(true);
    try { setPreview(await previewFn(csv)); }
    catch (e) { flash?.(e.message || 'Preview failed', 'error'); }
    finally { setBusy(false); }
  };
  const doCommit = async () => {
    setBusy(true);
    try {
      const out = await commitFn(csv);
      flash?.(`Imported ${out.rows_succeeded}/${out.rows_attempted} rows`, 'success');
      onDone?.();
    } catch (e) { flash?.(e.message || 'Import failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
        {templateUrl && (
          <a href={templateUrl} className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
            <Download className="w-4 h-4" /> Download template
          </a>
        )}
      </div>
      <CsvDrop csv={csv} onCsv={setCsv} onFile={onFile} />
      <div className="mt-4 flex gap-2">
        <button disabled={!csv.trim() || busy} onClick={doPreview}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">Preview</button>
        {preview && (
          <button disabled={busy} onClick={doCommit}
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50">
            Commit ({preview.row_count} rows)
          </button>
        )}
      </div>
      {(preview?.preview || preview?.sample) && (preview.preview || preview.sample).length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="text-xs border border-gray-200 dark:border-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>{(preview.headers || []).map(h => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(preview.preview || preview.sample).map((row, i) => (
                <tr key={i} className="border-t border-gray-100 dark:border-gray-700/50">
                  {(preview.headers || []).map(h => <td key={h} className="px-2 py-1 text-gray-700 dark:text-gray-300">{row[h]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Deck wizard

function DeckWizard({ flash, onDone }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    api.listProjects?.().then(out => {
      const list = Array.isArray(out) ? out : (out?.projects || []);
      setProjects(list);
    }).catch(() => {});
  }, []);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const out = await api.deckImport(file, projectId ? Number(projectId) : null);
      setResult(out);
      flash?.(`Extracted ${out.slide_count || 0} slides${projectId ? ' and pre-filled the Pitch Deck Builder' : ''}`, 'success');
    } catch (e) { flash?.(e.message || 'Import failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Pitch deck import</h3>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        Upload a PDF or PPTX deck. Per-slide text is extracted and pre-fills the Pitch Deck Builder for the selected startup. Image-only PDFs (scanned decks) cannot be extracted without OCR.
      </p>
      {projects.length > 0 && (
        <>
          <label className="block text-sm mb-1">Target startup (pre-fills Pitch Deck Builder)</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="w-full mb-3 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded text-sm">
            <option value="">— extract only, do not save —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}
      <input ref={fileRef} type="file" accept=".pdf,.pptx" onChange={e => setFile(e.target.files?.[0] || null)}
        className="block text-sm mb-3" />
      <button disabled={!file || busy} onClick={submit}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
        <Upload className="w-4 h-4 inline mr-1" /> Upload &amp; extract
      </button>
      {result && (
        <div className="mt-4 text-sm">
          <div className="text-gray-700 dark:text-gray-300 mb-2">
            Extracted <strong>{result.slide_count || 0}</strong> slides{result.deck_id && <> → Deck #{result.deck_id}</>}.
          </div>
          {(result.slides || []).slice(0, 5).map((s, i) => (
            <div key={i} className="p-2 mb-1 border border-gray-200 dark:border-gray-700 rounded">
              <div className="text-xs text-gray-500">Slide {s.index}</div>
              <div className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap line-clamp-3">{s.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Carta / generic provider one-shot wizard

function ProviderWizard({ flash, provider, title, onDone }) {
  const [integrations, setIntegrations] = useState([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.integrationsList?.().then(rows => {
      const list = (rows?.integrations || rows || []).filter(r => (r.provider_key || r.provider) === provider && (r.status === 'active' || r.status === 'connected'));
      setIntegrations(list);
      if (list[0]) setSelected(String(list[0].id));
    }).catch(() => {});
  }, [provider]);

  const run = async () => {
    setBusy(true);
    try {
      const out = await api.cartaImport(Number(selected));
      flash?.(out.summary || 'Carta import done', 'success');
      onDone?.();
    } catch (e) { flash?.(e.message || 'Import failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title} import</h3>
      {integrations.length === 0 ? (
        <div className="text-sm text-gray-600 dark:text-gray-300">
          No connected {title} integration. Connect it under Settings → Integrations first.
        </div>
      ) : (
        <>
          <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Integration</label>
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className="w-full mb-4 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded">
            {integrations.map(i => <option key={i.id} value={i.id}>{i.account_label || `#${i.id}`}</option>)}
          </select>
          <button disabled={!selected || busy} onClick={run}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">Run import</button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── CRM pipeline wizard (HubSpot + Affinity)

// Must match the `deals.status` CHECK constraint
// (`applied`, `scored`, `active`, `funded`, `rejected`). Adding values
// outside this set causes silent insert failures on the CRM importers.
const STUDIO_STAGES = ['applied', 'scored', 'active', 'funded', 'rejected'];

// Shared wizard for any CRM-pipeline-style importer. The provider integration
// (HubSpot/Affinity) is resolved server-side by user_id+provider, so the UI
// only needs to surface the list/pipeline picker + stage map.
function PipelineCrmWizard({ flash, title, listFn, importFn, listLabel, entityKey, onDone }) {
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [stageMap, setStageMap] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    listFn()
      .then(out => setItems(out?.[entityKey] || []))
      .catch(e => setErr(e.message || 'Failed to load'));
  }, [listFn, entityKey]);

  const selected = items.find(p => p.id === itemId);

  const run = async () => {
    if (!itemId) return;
    setBusy(true);
    try {
      const out = await importFn(itemId, stageMap);
      const imp = out.imported ?? out.counts?.imported ?? 0;
      const errs = out.errors ?? out.counts?.errors ?? 0;
      flash?.(`Imported ${imp} deals (${errs} errors)`, 'success');
      onDone?.();
    } catch (e) { flash?.(e.message || 'Import failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title} import</h3>
      {err && <div className="text-sm text-rose-700 mb-3">{err}</div>}
      {items.length === 0 && !err ? (
        <div className="text-sm text-gray-600 dark:text-gray-300">Loading… If this stalls, make sure the integration is connected under Settings → Integrations.</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-600 dark:text-gray-300">No {listLabel.toLowerCase()}s found. Connect the integration first under Settings → Integrations.</div>
      ) : (
        <>
          <label className="block text-sm mb-1">{listLabel}</label>
          <select value={itemId} onChange={e => { setItemId(e.target.value); setStageMap({}); }}
            className="w-full mb-4 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded">
            <option value="">— select —</option>
            {items.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {selected && Array.isArray(selected.stages) && selected.stages.length > 0 && (
            <div className="mb-4">
              <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Map stages → StudioOS status</div>
              {selected.stages.map(s => (
                <div key={s.id} className="flex items-center gap-3 mb-1">
                  <div className="w-48 text-sm text-gray-600 dark:text-gray-400">{s.label}</div>
                  <select value={stageMap[s.id] || ''} onChange={e => setStageMap({ ...stageMap, [s.id]: e.target.value })}
                    className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded text-sm">
                    <option value="">— skip —</option>
                    {STUDIO_STAGES.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <button disabled={!itemId || busy} onClick={run}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">Run import</button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── shared CSV drop

function CsvDrop({ csv, onCsv, onFile }) {
  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center"
      >
        <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
        <input type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
          className="block mx-auto text-sm" />
        <div className="text-xs text-gray-500 mt-2">Or paste CSV below.</div>
      </div>
      <textarea
        value={csv} onChange={e => onCsv(e.target.value)}
        className="w-full mt-3 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded font-mono text-xs"
        rows={6} placeholder="name,email,company&#10;Jane,jane@x.com,Acme"
      />
    </div>
  );
}
