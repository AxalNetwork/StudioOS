import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useEscapeClose } from '../../components/useEscapeClose';
import { parseLinkedInCsv } from '../../lib/linkedinCsv';

/**
 * D651 (#1463) — the provider-specific tools the Connectors sheet opens, moved
 * here unchanged from the retired `IntegrationsPage.jsx`: the LinkedIn
 * connections import, HubSpot's pipeline picker and Salesforce's stage and
 * field mapping. Each writes through the same `/api/integrations` methods it
 * always did; the sheet only decides when to open it.
 */

// lucide-react in this repo predates the `Linkedin` glyph, so we ship
// a tiny inline SVG (same approach as the Twitter glyph in
// ReferEarnPage.jsx). Sized + coloured via currentColor so it matches
// the surrounding tile typography.
export const Linkedin = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.024-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.602 0 4.268 2.37 4.268 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.778 13.019H3.555V9h3.56v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);


// Task #70 — LinkedIn CSV import modal lives directly inside Settings →
// Integrations so users can preview and import their Connections.csv in
// place. After parsing we hand the rows off to /refer via
// PENDING_LINKEDIN_IMPORT_KEY (localStorage) so the existing referral
// send flow stays the single owner of the personalised-mailto + invite
// pipeline. Keeps responsibilities clean: Integrations imports, Refer
// sends. Max 2 MB file size mirrors the ReferEarnPage check.
export function LinkedInCsvImportModal({ onClose, onImported }) {
  useEscapeClose(onClose);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      setError('File too large (max 2 MB). LinkedIn exports above this size are unusual — please trim before re-uploading.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseLinkedInCsv(text);
      if (parsed.length === 0) {
        setError('No emailed contacts found. LinkedIn only includes email for connections who chose to share theirs — you may need to invite them manually.');
        setRows(null);
      } else {
        setRows(parsed);
      }
    } catch (err) {
      setError('Could not parse the CSV: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" data-testid="linkedin-csv-modal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Linkedin size={16} className="text-[#0a66c2]" />
            <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm">Import LinkedIn contacts</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Export your connections from LinkedIn: <span className="font-medium">Settings → Data privacy → Get a copy of your data → Connections</span>.
            Upload the <code className="text-[11px] bg-gray-100 dark:bg-gray-800 px-1 rounded">Connections.csv</code> file below.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            disabled={busy}
            data-testid="linkedin-csv-input"
            className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
          />
          {error && (
            <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-md px-2 py-1.5 flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {rows && rows.length > 0 && (
            <div data-testid="linkedin-csv-preview" className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <div className="text-[11px] px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center justify-between">
                <span><span className="font-semibold">{rows.length}</span> contacts ready to import</span>
                <span className="text-gray-500">showing first {Math.min(5, rows.length)}</span>
              </div>
              <table className="w-full text-[11px]">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500">
                  <tr><th className="text-left px-3 py-1.5 font-normal">Name</th><th className="text-left px-3 py-1.5 font-normal">Email</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100 truncate max-w-[180px]">{r.name || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400 truncate max-w-[220px]">{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="text-xs font-medium px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
          <button
            onClick={() => rows && onImported(rows)}
            disabled={!rows || rows.length === 0}
            data-testid="linkedin-csv-import-btn"
            className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
              !rows || rows.length === 0
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            }`}
          >
            <Check size={12} /> Import {rows ? `${rows.length} contacts` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      {children}
    </label>
  );
}

// ─────────────────────────────────────────────── HubSpot pipeline picker

const STUDIO_STAGES = ['applied', 'scored', 'active', 'funded', 'rejected'];

export function HubspotConfigModal({ integration, onClose, onSaved }) {
  useEscapeClose(onClose);
  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState(integration?.config?.pipeline_id || 'default');
  const [stageMap, setStageMap] = useState(integration?.config?.dealstage_map || {});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.integrationsAction(integration.uid, 'list_pipelines');
        if (!alive) return;
        setPipelines(res?.result?.pipelines || []);
      } catch (e) {
        if (alive) setError(e.message || 'Failed to load pipelines');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [integration.uid]);

  const selected = pipelines.find(p => p.id === pipelineId);
  const stages = (selected?.stages || []).slice().sort((a, b) => a.order - b.order);

  const onSelectPipeline = (id) => {
    setPipelineId(id);
    // Reset map when pipeline changes — old stage IDs won't exist on a different pipeline.
    if (id !== integration?.config?.pipeline_id) setStageMap({});
  };

  const setStage = (studio, hubspotId) => setStageMap(m => ({ ...m, [studio]: hubspotId }));

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.integrationsPatchConfig(integration.uid, {
        pipeline_id: pipelineId,
        pipeline_label: selected?.label || pipelineId,
        dealstage_map: stageMap,
      });
      onSaved?.();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">HubSpot pipeline</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        {loading ? (
          <div className="text-sm text-gray-500 py-6 text-center">Loading pipelines…</div>
        ) : error ? (
          <div className="text-sm text-red-600 flex items-center gap-2"><AlertCircle size={14} /> {error}</div>
        ) : (
          <div className="space-y-4">
            <Field label="Pipeline">
              <select
                value={pipelineId}
                onChange={e => onSelectPipeline(e.target.value)}
                className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2"
              >
                {pipelines.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                {!pipelines.find(p => p.id === pipelineId) && (
                  <option value={pipelineId}>{pipelineId} (current)</option>
                )}
              </select>
            </Field>
            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Map StudioOS stages → HubSpot</div>
              <div className="space-y-2">
                {STUDIO_STAGES.map(s => (
                  <div key={s} className="flex items-center gap-2">
                    <div className="w-20 text-xs text-gray-600 dark:text-gray-400 capitalize">{s}</div>
                    <select
                      value={stageMap[s] || ''}
                      onChange={e => setStage(s, e.target.value)}
                      className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5"
                    >
                      <option value="">— use default —</option>
                      {stages.map(st => (
                        <option key={st.id} value={st.id}>{st.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Empty entries fall back to the built-in defaults (appointmentscheduled / qualifiedtobuy / presentationscheduled / closedwon / closedlost).
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700">Cancel</button>
              <button
                onClick={onSave}
                disabled={saving}
                className="text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Check size={14} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Salesforce stage + field mapping

const SF_OBJECTS = [
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'account',     label: 'Account' },
  { key: 'contact',     label: 'Contact' },
];

export function SalesforceConfigModal({ integration, onClose, onSaved }) {
  useEscapeClose(onClose);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState([]);
  const [stageMap, setStageMap] = useState(integration?.config?.stage_map || {});
  const [fieldMap, setFieldMap] = useState(integration?.config?.field_map || null);
  const [defaults, setDefaults] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [stagesRes, fieldsRes] = await Promise.all([
          api.integrationsAction(integration.uid, 'list_stages').catch(() => null),
          api.integrationsAction(integration.uid, 'list_field_map').catch(() => null),
        ]);
        if (!alive) return;
        setStages(stagesRes?.result?.stages || []);
        const fm = fieldsRes?.result?.field_map || null;
        const def = fieldsRes?.result?.defaults || null;
        if (fm && !fieldMap) setFieldMap(fm);
        setDefaults(def);
      } catch (e) {
        if (alive) setError(e.message || 'Failed to load Salesforce metadata');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integration.uid]);

  const setStage = (studio, sfName) => setStageMap(m => ({ ...m, [studio]: sfName }));
  const effectiveFieldMap = fieldMap || defaults || { opportunity: {}, account: {}, contact: {} };
  const updateField = (obj, studioKey, sfField) => {
    setFieldMap(m => {
      const base = m || defaults || { opportunity: {}, account: {}, contact: {} };
      return { ...base, [obj]: { ...(base[obj] || {}), [studioKey]: sfField } };
    });
  };

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      const patch = { stage_map: stageMap };
      if (fieldMap) patch.field_map = fieldMap;
      await api.integrationsPatchConfig(integration.uid, patch);
      onSaved?.();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Salesforce field mapping</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        {loading ? (
          <div className="text-sm text-gray-500 py-6 text-center">Loading metadata…</div>
        ) : (
          <div className="space-y-5">
            {error && <div className="text-sm text-red-600 flex items-center gap-2"><AlertCircle size={14} /> {error}</div>}
            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Map StudioOS deal status → Opportunity StageName</div>
              <div className="space-y-2">
                {STUDIO_STAGES.map(s => (
                  <div key={s} className="flex items-center gap-2">
                    <div className="w-20 text-xs text-gray-600 dark:text-gray-400 capitalize">{s}</div>
                    <select
                      value={stageMap[s] || ''}
                      onChange={e => setStage(s, e.target.value)}
                      className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5"
                    >
                      <option value="">— use default —</option>
                      {stages.map(st => (
                        <option key={st.value} value={st.value}>{st.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Defaults: Prospecting / Qualification / Proposal / Closed Won / Closed Lost.
              </p>
            </div>

            <div>
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Field mapping (StudioOS → Salesforce)</div>
              <div className="space-y-3">
                {SF_OBJECTS.map(obj => (
                  <div key={obj.key} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">{obj.label}</div>
                    <div className="space-y-1.5">
                      {Object.keys(effectiveFieldMap[obj.key] || {}).map(studioKey => (
                        <div key={studioKey} className="flex items-center gap-2 text-xs">
                          <div className="w-28 text-gray-600 dark:text-gray-400 truncate">{studioKey}</div>
                          <span className="text-gray-400">→</span>
                          <input
                            value={effectiveFieldMap[obj.key]?.[studioKey] || ''}
                            onChange={e => updateField(obj.key, studioKey, e.target.value)}
                            className="flex-1 text-xs font-mono rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1"
                            placeholder="SF field API name"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Custom fields ending in <code>__c</code> that don't exist on your org are skipped automatically; standard fields must match exact API names.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700">Cancel</button>
              <button
                onClick={onSave}
                disabled={saving}
                className="text-sm px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Check size={14} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
