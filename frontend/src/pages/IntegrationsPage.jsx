import React, { useEffect, useMemo, useState } from 'react';
import {
  Plug, Plus, RefreshCw, Trash2, FileText, X, AlertCircle, Check,
  ExternalLink, Webhook, Database, Scale, Building2, Shield,
} from 'lucide-react';
import { api } from '../lib/api';

const TYPE_ICONS = {
  crm: Building2,
  legal_provider: Scale,
  data_feed: Database,
  custom: Webhook,
};

const STATUS_PILL = {
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
};

export default function IntegrationsPage() {
  const [available, setAvailable] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectFor, setConnectFor] = useState(null); // provider object
  const [logsFor, setLogsFor] = useState(null);       // integration object
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [toast, setToast] = useState('');

  const refresh = async () => {
    try {
      setError('');
      const [av, mine] = await Promise.all([api.integrationsAvailable(), api.integrationsList()]);
      setAvailable(av.providers || []);
      setItems(mine.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const onConnect = async (form) => {
    setBusy(true);
    try {
      await api.integrationsConnect(form);
      setConnectFor(null);
      await refresh();
      showToast('Integration connected.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onSync = async (uid) => {
    try {
      await api.integrationsSync(uid);
      await refresh();
      showToast('Sync triggered.');
    } catch (e) { setError(e.message); }
  };

  const onDisconnect = async (uid) => {
    if (!confirm('Disconnect this integration? Stored credentials will be removed.')) return;
    try {
      await api.integrationsDisconnect(uid);
      await refresh();
      showToast('Integration removed.');
    } catch (e) { setError(e.message); }
  };

  const openLogs = async (integ) => {
    setLogsFor(integ);
    setLogsLoading(true);
    setLogs([]);
    try {
      const res = await api.integrationsLogs(integ.uid, { limit: 100 });
      setLogs(res.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLogsLoading(false);
    }
  };

  const connectedByProvider = useMemo(() => {
    const map = {};
    for (const it of items) map[it.provider_name] = it;
    return map;
  }, [items]);

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Plug className="text-violet-600" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
          <p className="text-sm text-gray-600">Connect your CRM, legal providers, and data feeds. Push deals out, receive webhooks back.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700"><X size={14} /></button>
        </div>
      )}
      {toast && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg px-4 py-2 flex items-center gap-2">
          <Check size={14} /> {toast}
        </div>
      )}

      {/* Connected list */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Your connections</h2>
        {items.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-500">
            No integrations connected yet. Pick a provider below to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map(it => {
              const Icon = TYPE_ICONS[it.integration_type] || Plug;
              return (
                <div key={it.uid} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center"><Icon size={18} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-gray-900 truncate">{it.display_name || it.provider_name}</div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_PILL[it.status] || 'bg-gray-100 text-gray-600'}`}>{it.status}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{it.integration_type.replace('_', ' ')}</div>
                      {it.api_key_preview && (
                        <div className="text-[11px] text-gray-500 font-mono mt-1">key: {it.api_key_preview}</div>
                      )}
                      {it.last_synced_at && (
                        <div className="text-[11px] text-gray-500 mt-1">last synced {new Date(it.last_synced_at).toLocaleString()}</div>
                      )}
                      {it.last_error && (
                        <div className="text-[11px] text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {it.last_error}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
                    <button onClick={() => openLogs(it)} className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1">
                      <FileText size={12} /> Logs
                    </button>
                    <button onClick={() => onSync(it.uid)} className="text-xs text-violet-600 hover:text-violet-700 flex items-center gap-1 px-2 py-1">
                      <RefreshCw size={12} /> Sync
                    </button>
                    <button onClick={() => onDisconnect(it.uid)} className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 px-2 py-1">
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Marketplace */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Marketplace</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {available.map(p => {
            const Icon = TYPE_ICONS[p.integration_type] || Plug;
            const connected = !!connectedByProvider[p.provider_name];
            return (
              <div key={p.provider_name} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col">
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-gray-50 text-gray-700 flex items-center justify-center"><Icon size={18} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">{p.display_name}</div>
                    <div className="text-[11px] text-gray-500 uppercase tracking-wide">{p.integration_type.replace('_', ' ')}</div>
                  </div>
                </div>
                <p className="text-xs text-gray-600 flex-1">{p.description}</p>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  {p.docs_url ? (
                    <a href={p.docs_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-500 hover:text-violet-600 flex items-center gap-1">
                      Docs <ExternalLink size={10} />
                    </a>
                  ) : <span />}
                  <button
                    onClick={() => setConnectFor(p)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${connected ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-violet-600 text-white hover:bg-violet-700'}`}
                  >
                    {connected ? <><RefreshCw size={12} /> Update</> : <><Plus size={12} /> Connect</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 mt-3 flex items-center gap-1">
          <Shield size={11} /> All API keys and webhook secrets are encrypted at rest.
        </p>
      </section>

      {connectFor && (
        <ConnectModal
          provider={connectFor}
          existing={connectedByProvider[connectFor.provider_name]}
          onClose={() => setConnectFor(null)}
          onSubmit={onConnect}
          busy={busy}
        />
      )}

      {logsFor && (
        <LogsModal
          integration={logsFor}
          logs={logs}
          loading={logsLoading}
          onClose={() => { setLogsFor(null); setLogs([]); }}
        />
      )}
    </div>
  );
}

function ConnectModal({ provider, existing, onClose, onSubmit, busy }) {
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [displayName, setDisplayName] = useState(existing?.display_name || provider.display_name);
  const [configText, setConfigText] = useState(existing?.config ? JSON.stringify(existing.config, null, 2) : '');
  const [err, setErr] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    let config = {};
    if (configText.trim()) {
      try { config = JSON.parse(configText); }
      catch { setErr('Config must be valid JSON.'); return; }
    }
    onSubmit({
      provider_name: provider.provider_name,
      integration_type: provider.integration_type,
      display_name: displayName,
      api_key: apiKey || undefined,
      webhook_secret: webhookSecret || undefined,
      config,
    });
  };

  const inputCls = "w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-violet-100 focus:border-violet-300 outline-none";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-gray-900">{existing ? 'Update' : 'Connect'} {provider.display_name}</h3>
            <p className="text-xs text-gray-500">{provider.description}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
          <Field label="Display name">
            <input className={inputCls} value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </Field>
          {provider.auth_type === 'api_key' && (
            <Field label={existing ? 'New API key (leave blank to keep current)' : 'API key'}>
              <input type="password" className={inputCls} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={existing?.api_key_preview || ''} required={!existing} />
            </Field>
          )}
          <Field label="Webhook secret (optional)">
            <input type="password" className={inputCls} value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder={existing?.has_webhook_secret ? '••••••••' : ''} />
            <p className="text-[11px] text-gray-500 mt-1">Used to validate inbound webhooks at <code className="bg-gray-100 px-1 rounded">/api/integrations/webhook/{provider.provider_name}/{'{uid}'}</code> using HMAC-SHA256 in the <code className="bg-gray-100 px-1 rounded">X-Axal-Signature</code> header.</p>
          </Field>
          <Field label="Config (JSON, optional)">
            <textarea rows={4} className={`${inputCls} font-mono text-xs`} value={configText} onChange={e => setConfigText(e.target.value)} placeholder='{"portal_id": "12345"}' />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
            <button type="submit" disabled={busy} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {busy ? 'Saving…' : (existing ? 'Update' : 'Connect')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LogsModal({ integration, logs, loading, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Logs — {integration.display_name || integration.provider_name}</h3>
            <p className="text-xs text-gray-500">Most recent activity (newest first).</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-gray-500">Loading…</div>
          ) : logs.length === 0 ? (
            <div className="p-6 text-sm text-gray-500 text-center">No log entries yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs text-gray-600">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Direction</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(l => (
                  <tr key={l.id} className="align-top">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${l.direction === 'inbound' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>{l.direction}</span>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-700">{l.event_type}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${l.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">{l.response_summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-gray-700 mb-1">{label}</div>
      {children}
    </label>
  );
}
