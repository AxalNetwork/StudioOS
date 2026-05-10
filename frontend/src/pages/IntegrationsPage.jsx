import React, { useEffect, useMemo, useState } from 'react';
import {
  Plug, Plus, RefreshCw, Trash2, FileText, X, AlertCircle, Check,
  ExternalLink, Webhook, Database, Shield, Calendar, Cloud, PieChart,
  MessageSquare, PenTool, Network, Building2, Lock, Bell, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../components/useToast';
import { useEscapeClose } from '../components/useEscapeClose';
import { safeReadJSON } from '../lib/storage';

const ICON_MAP = {
  Building2, Calendar, Cloud, PieChart, MessageSquare, PenTool, Database,
  Network, Webhook, Plug,
};

const TIER_PILL = {
  free:   { label: 'Free',   cls: 'bg-gray-100 text-gray-700 border border-gray-200' },
  growth: { label: 'Growth', cls: 'bg-violet-50 text-violet-700 border border-violet-200' },
  studio: { label: 'Studio', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
};

const STATUS_PILL = {
  active:       'bg-emerald-100 text-emerald-700',
  paused:       'bg-amber-100 text-amber-700',
  error:        'bg-red-100 text-red-700',
  disconnected: 'bg-gray-100 text-gray-600',
};

const BYPASS_ROLES = new Set(['admin', 'partner', 'investor', 'mentor']);

function ProviderIcon({ name, size = 18 }) {
  const Icon = ICON_MAP[name] || Plug;
  return <Icon size={size} />;
}

export default function IntegrationsPage() {
  const [providers, setProviders] = useState([]);     // registry, includes tier_locked
  const [items, setItems] = useState([]);             // user's connections
  const [waitlist, setWaitlist] = useState([]);       // user's waitlist entries
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connectFor, setConnectFor] = useState(null);
  const [logsFor, setLogsFor] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  // Task #2 — HubSpot pipeline picker modal target.
  const [configFor, setConfigFor] = useState(null);
  const { toast, showToast } = useToast(2500);

  const me = safeReadJSON('user') || {};
  const role = (me.role || '').toLowerCase();
  const bypassesTier = BYPASS_ROLES.has(role);

  const refresh = async () => {
    try {
      setError('');
      const [av, mine, wl] = await Promise.all([
        api.integrationsAvailable(),
        api.integrationsList(),
        api.integrationsWaitlist().catch(() => ({ items: [] })),
      ]);
      setProviders(av.providers || []);
      setItems(mine.items || []);
      setWaitlist(wl.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const onConnect = async (form) => {
    setBusy(true);
    try {
      await api.integrationsConnect(form);
      setConnectFor(null);
      await refresh();
      showToast('Integration connected.');
    } catch (e) {
      // 402 path is auto-handled by api.js (PaywallModal opens). Surface
      // the message inside the modal for everything else.
      if (e.status !== 402) setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onSync = async (uid) => {
    try {
      await api.integrationsSync(uid);
      await refresh();
      showToast('Sync triggered.');
    } catch (e) {
      if (e.status !== 402) setError(e.message);
    }
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

  const onJoinWaitlist = async (provider) => {
    try {
      await api.integrationsWaitlistJoin({ provider_key: provider.key });
      await refresh();
      showToast(`We'll let you know when ${provider.display_name} is ready.`);
    } catch (e) { setError(e.message); }
  };

  const onLeaveWaitlist = async (provider) => {
    try {
      await api.integrationsWaitlistLeave(provider.key);
      await refresh();
      showToast('Removed from waitlist.');
    } catch (e) { setError(e.message); }
  };

  const connectedByProvider = useMemo(() => {
    const m = {};
    for (const it of items) m[it.provider_key] = it;
    return m;
  }, [items]);

  const waitlistKeys = useMemo(() => new Set(waitlist.map(w => w.provider_key)), [waitlist]);

  const sections = useMemo(() => {
    const live = [];
    const coming = [];
    for (const p of providers) {
      if (p.status === 'coming_soon' || !p.has_implementation) coming.push(p);
      else live.push(p);
    }
    return { live, coming };
  }, [providers]);

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto" data-density-target>
      <header className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center"><Plug size={20} /></div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 leading-snug">
          Integrations <span className="text-gray-500 dark:text-gray-400 font-normal">— Connect your CRM, legal providers, and data feeds. Push deals out, receive webhooks back.</span>
        </h1>
      </header>

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

      {/* Connected */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          Connected <span className="text-xs font-normal text-gray-500">({items.length})</span>
        </h2>
        {items.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No integrations connected yet. Pick one from the marketplace below to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map(it => {
              const desc = providers.find(p => p.key === it.provider_key);
              return (
                <div key={it.uid} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
                      <ProviderIcon name={desc?.icon} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{it.display_name || it.provider_key}</div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_PILL[it.status] || 'bg-gray-100 text-gray-600'}`}>{it.status}</span>
                        {desc?.tier && desc.tier !== 'free' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIER_PILL[desc.tier].cls}`}>{TIER_PILL[desc.tier].label}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 capitalize">{(it.integration_type || '').replace(/_/g, ' ')}</div>
                      {it.api_key_preview && (
                        <div className="text-[11px] text-gray-500 font-mono mt-1">key: {it.api_key_preview}</div>
                      )}
                      {it.external_account_name && (
                        <div className="text-[11px] text-gray-500 mt-1">account: {it.external_account_name}</div>
                      )}
                      {!!(it.capabilities || []).length && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {it.capabilities.map(cap => (
                            <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">{cap}</span>
                          ))}
                        </div>
                      )}
                      {it.last_synced_at && (
                        <div className="text-[11px] text-gray-500 mt-1">last synced {new Date(it.last_synced_at).toLocaleString()}</div>
                      )}
                      {it.last_error && (
                        <div className="text-[11px] text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> {it.last_error}</div>
                      )}
                    </div>
                  </div>
                  {it.provider_key === 'hubspot' && it.config && (it.config.portal_id || it.config.pipeline_label) && (
                    <div className="text-[11px] text-gray-500 mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                      {it.config.portal_id && <span>portal #{it.config.portal_id}</span>}
                      {it.config.pipeline_label && <span>pipeline: {it.config.pipeline_label}</span>}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                    {it.provider_key === 'hubspot' && (
                      <button onClick={() => setConfigFor(it)} className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-2 py-1">
                        <PieChart size={12} /> Pipeline
                      </button>
                    )}
                    <button onClick={() => openLogs(it)} className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 px-2 py-1">
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

      {/* Available marketplace */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Available</h2>
        {sections.live.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 text-sm text-gray-500 text-center">
            All current providers are still rolling out — see Coming Soon below.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sections.live.map(p => (
              <ProviderCard
                key={p.key}
                provider={p}
                connected={!!connectedByProvider[p.key]}
                bypassesTier={bypassesTier}
                onConnect={() => setConnectFor(p)}
              />
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-500 mt-3 flex items-center gap-1">
          <Shield size={11} /> All API keys, OAuth tokens, and webhook secrets are encrypted at rest with AES-GCM.
        </p>
      </section>

      {/* Coming Soon */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
          <Sparkles size={14} className="text-violet-500" /> Coming soon
        </h2>
        {sections.coming.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 text-sm text-gray-500 text-center">
            Nothing on the horizon yet — check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sections.coming.map(p => (
              <ComingSoonCard
                key={p.key}
                provider={p}
                joined={waitlistKeys.has(p.key)}
                onJoin={() => onJoinWaitlist(p)}
                onLeave={() => onLeaveWaitlist(p)}
              />
            ))}
          </div>
        )}
      </section>

      {connectFor && (
        <ConnectModal
          provider={connectFor}
          existing={connectedByProvider[connectFor.key]}
          bypassesTier={bypassesTier}
          onClose={() => setConnectFor(null)}
          onSubmit={onConnect}
          busy={busy}
        />
      )}

      {configFor && (
        <HubspotConfigModal
          integration={configFor}
          onClose={() => setConfigFor(null)}
          onSaved={async () => { setConfigFor(null); await refresh(); showToast('Pipeline saved.'); }}
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

function ProviderCard({ provider, connected, bypassesTier, onConnect }) {
  const tierLocked = !bypassesTier && provider.tier_locked;
  const beta = provider.status === 'beta';
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex flex-col">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center justify-center">
          <ProviderIcon name={provider.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="font-medium text-gray-900 dark:text-gray-100">{provider.display_name}</div>
            {beta && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Beta</span>}
            {!bypassesTier && provider.tier !== 'free' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIER_PILL[provider.tier].cls}`}>{TIER_PILL[provider.tier].label}</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide capitalize">{provider.integration_type.replace(/_/g, ' ')}</div>
        </div>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 flex-1">{provider.description}</p>
      {!!provider.capabilities?.length && (
        <div className="flex flex-wrap gap-1 mt-2">
          {provider.capabilities.map(cap => (
            <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">{cap}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        {provider.docs_url ? (
          <a href={provider.docs_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-500 hover:text-violet-600 flex items-center gap-1">
            Docs <ExternalLink size={10} />
          </a>
        ) : <span />}
        <button
          onClick={onConnect}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${
            connected ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200'
            : tierLocked ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
            : 'bg-violet-600 text-white hover:bg-violet-700'
          }`}
        >
          {connected ? <><RefreshCw size={12} /> Update</>
            : tierLocked ? <><Lock size={12} /> Upgrade to connect</>
            : <><Plus size={12} /> Connect</>}
        </button>
      </div>
    </div>
  );
}

function ComingSoonCard({ provider, joined, onJoin, onLeave }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-4 flex flex-col opacity-90">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center">
          <ProviderIcon name={provider.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="font-medium text-gray-900 dark:text-gray-100">{provider.display_name}</div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">Soon</span>
            {provider.tier !== 'free' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIER_PILL[provider.tier].cls}`}>{TIER_PILL[provider.tier].label}</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wide capitalize">{provider.integration_type.replace(/_/g, ' ')}</div>
        </div>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 flex-1">{provider.description}</p>
      {!!provider.capabilities?.length && (
        <div className="flex flex-wrap gap-1 mt-2">
          {provider.capabilities.map(cap => (
            <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">{cap}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        {joined ? (
          <button onClick={onLeave} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex items-center gap-1.5">
            <Check size={12} /> On the waitlist
          </button>
        ) : (
          <button onClick={onJoin} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 flex items-center gap-1.5">
            <Bell size={12} /> Notify me
          </button>
        )}
      </div>
    </div>
  );
}

function ConnectModal({ provider, existing, bypassesTier, onClose, onSubmit, busy }) {
  useEscapeClose(onClose);
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [displayName, setDisplayName] = useState(existing?.display_name || provider.display_name);
  const [configText, setConfigText] = useState(existing?.config ? JSON.stringify(existing.config, null, 2) : '');
  const [err, setErr] = useState('');
  const tierLocked = !bypassesTier && provider.tier_locked;

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    let config = {};
    if (configText.trim()) {
      try { config = JSON.parse(configText); }
      catch { setErr('Config must be valid JSON.'); return; }
    }
    onSubmit({
      provider_key: provider.key,
      display_name: displayName,
      api_key: apiKey || undefined,
      webhook_secret: webhookSecret || undefined,
      config,
    });
  };

  const startOauth = async () => {
    setErr('');
    try {
      const res = await api.integrationsOauthStart(provider.key);
      if (res.authorize_url) window.location.href = res.authorize_url;
    } catch (e) {
      setErr(e.message);
    }
  };

  const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-md px-3 py-2 focus:ring-2 focus:ring-violet-100 focus:border-violet-300 outline-none";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{existing ? 'Update' : 'Connect'} {provider.display_name}</h3>
            <p className="text-xs text-gray-500">{provider.description}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        {tierLocked ? (
          <div className="p-5">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
              <Lock size={16} className="mt-0.5" />
              <div>
                <div className="font-medium">{TIER_PILL[provider.tier].label} plan required</div>
                <p className="text-xs text-amber-800 mt-1">Upgrade your subscription to connect {provider.display_name}.</p>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 px-4 py-2">Close</button>
              <a href="/billing" className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg">View plans</a>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
            <Field label="Display name">
              <input className={inputCls} value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </Field>
            {provider.auth_type === 'oauth2' && !existing && (
              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-700 dark:text-gray-300">
                <p className="mb-2">{provider.display_name} uses OAuth — sign in to authorize StudioOS:</p>
                <button type="button" onClick={startOauth} className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded inline-flex items-center gap-1.5">
                  <ExternalLink size={12} /> Continue with {provider.display_name}
                </button>
                {provider.supports_pat && (
                  <p className="mt-2 text-[11px] text-gray-500">
                    Or paste a Personal Access Token below — useful if your workspace blocks third-party OAuth apps.
                  </p>
                )}
              </div>
            )}
            {provider.auth_type === 'api_key' && (
              <Field label={existing ? 'New API key (leave blank to keep current)' : 'API key'}>
                <input type="password" className={inputCls} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={existing?.api_key_preview || ''} required={!existing} />
              </Field>
            )}
            {provider.auth_type === 'oauth2' && provider.supports_pat && !existing && (
              <Field label="Personal Access Token (optional)">
                <input type="password" className={inputCls} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="cal_pat_..." autoComplete="off" />
                <p className="text-[11px] text-gray-500 mt-1">Generate one in {provider.display_name} → Integrations → API & Webhooks.</p>
              </Field>
            )}
            <Field label="Webhook secret (optional)">
              <input type="password" className={inputCls} value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder={existing?.has_webhook_secret ? '••••••••' : ''} />
              <p className="text-[11px] text-gray-500 mt-1">Used to validate inbound webhooks at <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">/api/integrations/webhook/{provider.key}/{'{uid}'}</code> using HMAC-SHA256 in the <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">X-Axal-Signature</code> header.</p>
            </Field>
            <Field label="Config (JSON, optional)">
              <textarea rows={4} className={`${inputCls} font-mono text-xs`} value={configText} onChange={e => setConfigText(e.target.value)} placeholder='{"portal_id": "12345"}' />
            </Field>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 px-4 py-2">Cancel</button>
              {provider.auth_type !== 'oauth2' || existing || (provider.supports_pat && apiKey) ? (
                <button type="submit" disabled={busy} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  {busy ? 'Saving…' : (existing ? 'Update' : 'Connect')}
                </button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function LogsModal({ integration, logs, loading, onClose }) {
  useEscapeClose(onClose);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Logs — {integration.display_name || integration.provider_key}</h3>
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
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                <tr className="text-left text-xs text-gray-600 dark:text-gray-300">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Direction</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {logs.map(l => (
                  <tr key={l.id} className="align-top">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${l.direction === 'inbound' ? 'bg-blue-100 text-blue-700' : l.direction === 'outbound' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-700'}`}>{l.direction}</span>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-700 dark:text-gray-300">{l.event_type}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${l.status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">{l.response_summary || '—'}</td>
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
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      {children}
    </label>
  );
}

// ─────────────────────────────────────────────── HubSpot pipeline picker

const STUDIO_STAGES = ['applied', 'scored', 'active', 'funded', 'rejected'];

function HubspotConfigModal({ integration, onClose, onSaved }) {
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
