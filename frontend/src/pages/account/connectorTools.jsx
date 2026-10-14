import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { connectorsApi } from '../../lib/api/connectors';
import Lightbox from '../../ui/Lightbox.jsx';
import BrandIcon from '../../ui/BrandIcon.jsx';
import { parseLinkedInCsv } from '../../lib/linkedinCsv';

/**
 * D651 (#1463) — the provider-specific tools the Connectors sheet opens, moved
 * here unchanged from the retired `IntegrationsPage.jsx`: the LinkedIn
 * connections import, HubSpot's pipeline picker and Salesforce's stage and
 * field mapping. Each writes through the same `/api/integrations` methods it
 * always did; the sheet only decides when to open it.
 */

// Task #70 — LinkedIn CSV import modal lives directly inside Settings →
// Integrations so users can preview and import their Connections.csv in
// place. After parsing we hand the rows off to /refer via
// PENDING_LINKEDIN_IMPORT_KEY (localStorage) so the existing referral
// send flow stays the single owner of the personalised-mailto + invite
// pipeline. Keeps responsibilities clean: Integrations imports, Refer
// sends. Max 2 MB file size mirrors the ReferEarnPage check.
export function LinkedInCsvImportModal({ onClose, onImported }) {
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
    <Lightbox label="Import LinkedIn contacts" onClose={onClose} width={512} testId="linkedin-csv-modal">
      <div className="min-h-0 overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <BrandIcon provider="linkedin" name="LinkedIn" size={16} variant="bare" />
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
    </Lightbox>
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
        const res = await connectorsApi.action(integration.uid, 'list_pipelines');
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
      await connectorsApi.patchConfig(integration.uid, {
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
    <Lightbox label="HubSpot pipeline" onClose={onClose} width={512} testId="hubspot-config-modal">
      <div className="min-h-0 overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100"><BrandIcon provider="hubspot" name="HubSpot" size={24} />HubSpot pipeline</h3>
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
    </Lightbox>
  );
}

// ─────────────────────────────────────────────── Salesforce stage + field mapping

const SF_OBJECTS = [
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'account',     label: 'Account' },
  { key: 'contact',     label: 'Contact' },
];

export function SalesforceConfigModal({ integration, onClose, onSaved }) {
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
          connectorsApi.action(integration.uid, 'list_stages').catch(() => null),
          connectorsApi.action(integration.uid, 'list_field_map').catch(() => null),
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
      await connectorsApi.patchConfig(integration.uid, patch);
      onSaved?.();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Lightbox label="Salesforce field mapping" onClose={onClose} width={672} testId="salesforce-config-modal">
      <div className="min-h-0 overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100"><BrandIcon provider="salesforce" name="Salesforce" size={24} />Salesforce field mapping</h3>
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
    </Lightbox>
  );
}
