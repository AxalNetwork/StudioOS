import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { ChevronDown, RefreshCw, KeyRound, Plus, Package, Zap } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import ToastMessage from '../../../components/ToastMessage';
import { useAuth } from '../../../hooks/useAuthSync';
// D223 — the elevation the secret-writing consoles gate on; its own line so
// the `branchOfUser` import D128's test pins stays exactly as it was.
import { isSuperAdminUser } from '../../../lib/shellRole';
import SecretWriteGate from '../../../components/SecretWriteGate';
import { ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Payments console (Stripe products, prices, webhooks).
 */

// Task #9 — Promo Codes admin panel. Lists the D1 mirror and creates Stripe
// Coupons + Promotion Codes (percent / fixed; free-trial-days descoped). Each
// mutation hits a TOTP + step-up-gated endpoint; the global `request` helper
// auto-handles the 403 `step_up_required` challenge, so no extra wiring here.

// Task #16 — Metadata field component for the Payments panel create-product
// form. Defined outside PaymentsPanel to avoid React re-mounting on every
// parent render. Receives `kind`, `metadata`, `onChange`, and `inputCls`.
// Audience categories a product can be filtered by on the storefront
// (Products page). Independent of `kind` — stored as a comma-separated
// `metadata.audience` list so a product can belong to more than one (e.g.
// an incorporation product is both "For Founders" and "Legal Services").
// Mirrors AUDIENCE_CATEGORIES in cloudflare-worker/src/services/catalog.ts.
const AUDIENCE_OPTIONS = [
  { value: 'founders', label: 'For Founders' },
  { value: 'investors_lps', label: 'For Investors / LPs' },
  { value: 'service_partners', label: 'For Service Partners' },
  { value: 'advisors', label: 'For Advisors' },
  { value: 'legal_services', label: 'Legal Services' },
];

function AudienceFields({ metadata, onChange }) {
  const selected = (metadata.audience || '').split(',').map(s => s.trim()).filter(Boolean);
  const toggle = (value) => {
    const next = selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value];
    const meta = { ...metadata };
    if (next.length > 0) meta.audience = next.join(',');
    else delete meta.audience;
    onChange(meta);
  };
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
        Audience filters (Products page)
      </label>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5">
        Leave unchecked to auto-classify from the product's kind/tier/name instead.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {AUDIENCE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
              selected.includes(opt.value)
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-violet-400'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MetadataFields({ kind, metadata, onChange, inputCls }) {
  const setMeta = (k, v) => onChange({ ...metadata, [k]: v });
  if (kind === 'subscription') {
    const currentSel = metadata.plan
      ? 'mi_pro'
      : metadata.tier
      ? metadata.tier
      : metadata.investor_tier
      ? metadata.investor_tier
      : '';
    return (
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Subscription type</label>
        <select
          className={inputCls}
          value={currentSel}
          onChange={e => {
            const v = e.target.value;
            // Only clear the taxonomy keys this selector owns (plan / tier /
            // investor_tier) — preserve everything else (e.g. `audience`,
            // `commission_pct`) so switching subscription type doesn't
            // silently wipe unrelated metadata set elsewhere in the form.
            const { plan, tier, investor_tier, ...rest } = metadata;
            if (v === 'mi_pro') onChange({ ...rest, plan: 'mi_pro' });
            else if (v === 'growth' || v === 'studio') onChange({ ...rest, tier: v });
            else if (v === 'professional' || v === 'institutional') onChange({ ...rest, investor_tier: v });
            else onChange(rest);
          }}
        >
          <option value="">— select —</option>
          <option value="mi_pro">MI Pro (plan=mi_pro)</option>
          <option value="growth">Founder Growth (tier=growth)</option>
          <option value="studio">Founder Studio (tier=studio)</option>
          <option value="professional">Investor Professional (investor_tier=professional)</option>
          <option value="institutional">Investor Institutional (investor_tier=institutional)</option>
        </select>
        {'commission_pct' in metadata ? (
          <input
            className={inputCls}
            placeholder="commission_pct (e.g. 10)"
            value={metadata.commission_pct || ''}
            onChange={e => setMeta('commission_pct', e.target.value)}
          />
        ) : (
          <button type="button" className="text-xs text-violet-600 hover:underline"
            onClick={() => onChange({ ...metadata, commission_pct: '' })}>+ referral commission %</button>
        )}
      </div>
    );
  }
  if (kind === 'incorporation' || kind === 'session') {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Metadata: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">kind={kind}</code> (auto-set)
      </p>
    );
  }
  if (kind === 'alacarte') {
    return (
      <div className="space-y-2">
        <input className={inputCls} placeholder="feature_key (e.g. export_csv)"
          value={metadata.feature_key || ''} onChange={e => setMeta('feature_key', e.target.value)} />
        <input className={inputCls} placeholder="unlock_days (e.g. 30)"
          value={metadata.unlock_days || ''} onChange={e => setMeta('unlock_days', e.target.value)} />
        {'commission_pct' in metadata ? (
          <input
            className={inputCls}
            placeholder="commission_pct (e.g. 10)"
            value={metadata.commission_pct || ''}
            onChange={e => setMeta('commission_pct', e.target.value)}
          />
        ) : (
          <button type="button" className="text-xs text-violet-600 hover:underline"
            onClick={() => onChange({ ...metadata, commission_pct: '' })}>+ referral commission %</button>
        )}
      </div>
    );
  }
  return null;
}

// Task #16 — Admin Payments panel: Stripe publishable key, product catalog
// CRUD, and webhook endpoint management. All mutations are rate-limited
// (admin_catalog_writes bucket) and audit-logged server-side.
export function PaymentsPanel() {
  const { toast, showToast } = useToast(4000);
  const inputCls = 'rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500 w-full';
  const cardCls = 'bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800 mb-6';
  const headerCls = 'px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2 flex-wrap';

  const [config, setConfig] = useState(null);
  const [pkInput, setPkInput] = useState('');
  const [savingPk, setSavingPk] = useState(false);

  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  // D648 — a failed read is said, never drawn as an empty list.
  const [failed, setFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const EMPTY_PROD = { name: '', kind: 'subscription', metadata: {} };
  const [showCreate, setShowCreate] = useState(false);
  const [prodForm, setProdForm] = useState(EMPTY_PROD);
  const [creating, setCreating] = useState(false);

  const EMPTY_PRICE = { currency: 'usd', unit_amount: '', type: 'recurring', interval: 'month', nickname: '' };
  const [addPriceFor, setAddPriceFor] = useState(null);
  const [priceForm, setPriceForm] = useState(EMPTY_PRICE);
  const [addingPrice, setAddingPrice] = useState(false);

  const [editingProductId, setEditingProductId] = useState(null);
  const [editProdForm, setEditProdForm] = useState({ name: '', kind: 'subscription', metadata: {} });
  const [savingEdit, setSavingEdit] = useState(false);

  const [editingPriceId, setEditingPriceId] = useState(null);
  const [editPriceNickname, setEditPriceNickname] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  const [webhooks, setWebhooks] = useState(null);
  const [webhookBusy, setWebhookBusy] = useState(false);
  // D223 — registering writes STRIPE_WEBHOOK_SECRET onto the production Worker.
  const holdsSecretWrites = isSuperAdminUser(useAuth().user);

  const loadConfig = useCallback(async () => {
    try { setConfig(await api.adminStripeGetConfig()); } catch { /* unconfigured */ }
  }, []);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const r = await api.adminCatalogList();
      setProducts(r.products || []);
      setFailed(false);
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to load products' });
      setFailed(true);
    } finally { setProductsLoading(false); }
  }, [showToast]);

  const loadWebhooks = useCallback(async () => {
    try { setWebhooks(await api.adminStripeListWebhooks()); } catch { /* stripe not yet configured */ }
  }, []);

  useEffect(() => {
    loadConfig();
    loadProducts();
    loadWebhooks();
  }, [loadConfig, loadProducts, loadWebhooks]);

  const syncCatalog = async () => {
    setSyncing(true);
    try {
      const r = await api.adminCatalogSync();
      showToast({ kind: 'ok', msg: `Synced ${r.synced ?? 0} products from Stripe` });
      loadProducts();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Sync failed' });
    } finally { setSyncing(false); }
  };

  const savePk = async (e) => {
    e.preventDefault();
    if (!pkInput.trim() || savingPk) return;
    setSavingPk(true);
    try {
      const r = await api.adminStripeSetConfig(pkInput.trim());
      showToast({ kind: 'ok', msg: `Key saved (${r.mode} mode)` });
      setPkInput('');
      loadConfig();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to save key' });
    } finally { setSavingPk(false); }
  };

  const handleKindChange = (kind) => {
    const autoMeta = {
      incorporation: { kind: 'incorporation' },
      session: { kind: 'session' },
      alacarte: { kind: 'alacarte', feature_key: '', unlock_days: '' },
      subscription: {},
    }[kind] || {};
    setProdForm(f => ({ ...f, kind, metadata: autoMeta }));
  };

  const createProduct = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      await api.adminCatalogCreateProduct({ name: prodForm.name.trim(), kind: prodForm.kind, metadata: prodForm.metadata });
      showToast({ kind: 'ok', msg: 'Product created' });
      setProdForm(EMPTY_PROD);
      setShowCreate(false);
      loadProducts();
    } catch (e) {
      const details = e?.data?.details;
      showToast({ kind: 'err', msg: details ? details.join('; ') : (e.message || 'Create failed') });
    } finally { setCreating(false); }
  };

  const archiveProduct = async (id) => {
    if (!confirm('Archive this product? It will no longer be available for new purchases.')) return;
    try {
      await api.adminCatalogArchiveProduct(id);
      showToast({ kind: 'ok', msg: 'Product archived' });
      loadProducts();
    } catch (e) { showToast({ kind: 'err', msg: e.message || 'Archive failed' }); }
  };

  const startEdit = (p) => {
    setEditingProductId(p.id);
    setEditProdForm({ name: p.name, kind: p.kind, metadata: { ...p.metadata } });
    setAddPriceFor(null);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (savingEdit || !editingProductId) return;
    setSavingEdit(true);
    try {
      await api.adminCatalogUpdateProduct(editingProductId, {
        name: editProdForm.name.trim(),
        kind: editProdForm.kind,
        metadata: editProdForm.metadata,
      });
      showToast({ kind: 'ok', msg: 'Product updated' });
      setEditingProductId(null);
      loadProducts();
    } catch (e) {
      const details = e?.data?.details;
      showToast({ kind: 'err', msg: details ? details.join('; ') : (e.message || 'Update failed') });
    } finally { setSavingEdit(false); }
  };

  const addPrice = async (e) => {
    e.preventDefault();
    if (addingPrice || !addPriceFor) return;
    setAddingPrice(true);
    try {
      await api.adminCatalogAddPrice(addPriceFor, {
        currency: priceForm.currency,
        unit_amount: Math.round(Number(priceForm.unit_amount) * 100),
        type: priceForm.type,
        interval: priceForm.type === 'recurring' ? priceForm.interval : undefined,
        nickname: priceForm.nickname || undefined,
      });
      showToast({ kind: 'ok', msg: 'Price added' });
      setPriceForm(EMPTY_PRICE);
      setAddPriceFor(null);
      loadProducts();
    } catch (e) { showToast({ kind: 'err', msg: e.message || 'Failed to add price' }); }
    finally { setAddingPrice(false); }
  };

  const archivePrice = async (priceId) => {
    if (!confirm('Archive this price?')) return;
    try {
      await api.adminCatalogArchivePrice(priceId);
      showToast({ kind: 'ok', msg: 'Price archived' });
      loadProducts();
    } catch (e) { showToast({ kind: 'err', msg: e.message || 'Archive failed' }); }
  };

  const saveEditPrice = async (e) => {
    e.preventDefault();
    if (savingPrice || !editingPriceId) return;
    setSavingPrice(true);
    try {
      await api.adminCatalogUpdatePrice(editingPriceId, { nickname: editPriceNickname });
      showToast({ kind: 'ok', msg: 'Price nickname updated' });
      setEditingPriceId(null);
      loadProducts();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally { setSavingPrice(false); }
  };

  const registerWebhook = async () => {
    if (webhookBusy) return;
    setWebhookBusy(true);
    try {
      await api.adminStripeRegisterWebhook();
      showToast({ kind: 'ok', msg: 'Webhook registered — signing secret stored automatically.' });
      loadWebhooks();
    } catch (e) { showToast({ kind: 'err', msg: e.message || 'Registration failed' }); }
    finally { setWebhookBusy(false); }
  };

  const updateWebhookEvents = async (endpointId) => {
    if (webhookBusy) return;
    setWebhookBusy(true);
    try {
      await api.adminStripeUpdateWebhookEvents(endpointId);
      showToast({ kind: 'ok', msg: 'Webhook events updated' });
      loadWebhooks();
    } catch (e) { showToast({ kind: 'err', msg: e.message || 'Update failed' }); }
    finally { setWebhookBusy(false); }
  };

  const mode = config?.mode || 'unconfigured';
  const modeBadge = mode === 'live'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300'
    : mode === 'test'
    ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300'
    : 'bg-gray-50 border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400';

  const fmtAmount = (cents, currency) =>
    cents != null ? `${(cents / 100).toFixed(2)} ${(currency || 'usd').toUpperCase()}` : 'free';

  const kindBadge = (k) => ({
    subscription: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    incorporation: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    session: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    alacarte: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  }[k] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400');

  return (
    <div>
      <ToastMessage toast={toast} />

      {/* Mode banner */}
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border mb-6 text-sm font-medium ${modeBadge}`}>
        <Zap size={14} />
        Stripe mode: <strong className="ml-0.5">{mode === 'live' ? 'Live' : mode === 'test' ? 'Test' : 'Unconfigured'}</strong>
        {mode === 'unconfigured' && <span className="font-normal ml-1">— configure STRIPE_SECRET_KEY to enable payments</span>}
        {mode === 'live' && <span className="ml-auto font-normal text-xs">✓ Production payments enabled</span>}
      </div>

      {/* Publishable key */}
      <div className={cardCls}>
        <div className={headerCls}>
          <KeyRound size={14} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Publishable Key</span>
          {config?.configured && (
            <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded dark:bg-emerald-900/30 dark:text-emerald-300">configured</span>
          )}
        </div>
        <div className="px-4 py-3 space-y-3">
          {config?.publishable_key && (
            <p className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">{config.publishable_key}</p>
          )}
          <form onSubmit={savePk} className="flex gap-2">
            <input
              className={`${inputCls} flex-1`}
              placeholder="pk_test_… or pk_live_…"
              value={pkInput}
              onChange={e => setPkInput(e.target.value)}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={savingPk || !pkInput.trim()}
              className="px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {savingPk ? 'Saving…' : 'Save Key'}
            </button>
          </form>
          <p className="text-xs text-gray-400 dark:text-gray-500">Stored in KV — takes effect immediately without a frontend rebuild.</p>
        </div>
      </div>

      {/* Product catalog */}
      <div className={cardCls}>
        <div className={headerCls}>
          <Package size={14} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Product Catalog</span>
          <span className="text-xs text-gray-400 ml-0.5">({products.length})</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={syncCatalog}
              disabled={syncing}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync from Stripe'}
            </button>
            <button
              onClick={() => setShowCreate(s => !s)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors"
            >
              <Plus size={12} />
              New Product
            </button>
          </div>
        </div>

        {showCreate && (
          <form onSubmit={createProduct} className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-violet-50 dark:bg-violet-900/10 space-y-3">
            <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">New product</p>
            <input
              className={inputCls}
              placeholder="Product name (e.g. Axal MI Pro)"
              value={prodForm.name}
              onChange={e => setProdForm(f => ({ ...f, name: e.target.value }))}
              required
            />
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Kind</label>
              <select className={inputCls} value={prodForm.kind} onChange={e => handleKindChange(e.target.value)}>
                <option value="subscription">Subscription</option>
                <option value="incorporation">Incorporation</option>
                <option value="session">Session</option>
                <option value="alacarte">À la carte</option>
              </select>
            </div>
            <MetadataFields
              kind={prodForm.kind}
              metadata={prodForm.metadata}
              onChange={meta => setProdForm(f => ({ ...f, metadata: meta }))}
              inputCls={inputCls}
            />
            <AudienceFields
              metadata={prodForm.metadata}
              onChange={meta => setProdForm(f => ({ ...f, metadata: meta }))}
            />
            <div className="flex gap-2">
              <button type="submit" disabled={creating}
                className="px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setProdForm(EMPTY_PROD); }}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:underline">Cancel</button>
            </div>
          </form>
        )}

        {productsLoading ? (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">Loading catalog…</div>
        ) : failed ? (
          <ConsoleUnreadable what="The product catalog" onRetry={() => loadProducts()} />
        ) : products.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">
            No products yet — sync from Stripe or create one above.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {products.map((p) => (
              <div key={p.id}>
                <div
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer select-none"
                  onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium truncate ${p.active ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 line-through'}`}>
                        {p.name}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${kindBadge(p.kind)}`}>{p.kind}</span>
                      {!p.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">archived</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {p.prices.filter(pr => pr.active).length} active price{p.prices.filter(pr => pr.active).length !== 1 ? 's' : ''}
                      <span className="mx-1.5 opacity-50">·</span>
                      <span className="font-mono text-[10px]">{p.id}</span>
                    </div>
                  </div>
                  <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${expanded === p.id ? 'rotate-180' : ''}`} />
                </div>

                {expanded === p.id && (
                  <div className="px-4 pb-4 bg-gray-50 dark:bg-gray-800/30 space-y-3">
                    {Object.keys(p.metadata || {}).length > 0 && (
                      <div className="pt-2">
                        <p className="text-[10px] uppercase font-semibold text-gray-500 mb-1">Metadata</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(p.metadata).map(([k, v]) => (
                            <span key={k} className="text-[10px] font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 rounded">
                              {k}={v}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] uppercase font-semibold text-gray-500 mb-1.5">Prices</p>
                      {p.prices.length === 0 ? (
                        <p className="text-xs text-gray-400 mb-1">No prices yet.</p>
                      ) : (
                        <div className="space-y-1.5 mb-2">
                          {p.prices.map((pr) => (
                            <div key={pr.id}>
                              {editingPriceId === pr.id ? (
                                <form onSubmit={saveEditPrice} className="flex items-center gap-2">
                                  <input
                                    className={`${inputCls} flex-1 text-xs`}
                                    placeholder="Nickname (e.g. Monthly billing)"
                                    value={editPriceNickname}
                                    onChange={e => setEditPriceNickname(e.target.value)}
                                    autoFocus
                                  />
                                  <button type="submit" disabled={savingPrice}
                                    className="text-[10px] font-medium text-violet-600 hover:underline disabled:opacity-50 flex-shrink-0">
                                    {savingPrice ? 'Saving…' : 'Save'}
                                  </button>
                                  <button type="button" onClick={() => setEditingPriceId(null)}
                                    className="text-[10px] text-gray-500 hover:underline flex-shrink-0">Cancel</button>
                                </form>
                              ) : (
                                <div className="flex items-center gap-2 text-xs">
                                  <span className={`flex-1 font-medium ${pr.active ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 line-through'}`}>
                                    {fmtAmount(pr.unit_amount, pr.currency)}
                                    {pr.interval && (
                                      <span className="font-normal text-gray-500">
                                        {' / '}{pr.interval}{pr.interval_count > 1 ? ` × ${pr.interval_count}` : ''}
                                      </span>
                                    )}
                                    {pr.nickname && <span className="ml-1 text-gray-400">({pr.nickname})</span>}
                                  </span>
                                  <span className="font-mono text-[10px] text-gray-400 hidden sm:inline">{pr.id.slice(0, 18)}…</span>
                                  {pr.active && (
                                    <>
                                      <button
                                        onClick={() => { setEditingPriceId(pr.id); setEditPriceNickname(pr.nickname || ''); }}
                                        className="text-[10px] text-violet-600 hover:underline flex-shrink-0">
                                        edit
                                      </button>
                                      <button onClick={() => archivePrice(pr.id)}
                                        className="text-[10px] text-red-500 hover:underline flex-shrink-0">
                                        archive
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {addPriceFor === p.id ? (
                        <form onSubmit={addPrice} className="space-y-2 p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Add price</p>
                          <div className="grid grid-cols-2 gap-2">
                            <input className={inputCls} placeholder="Amount (e.g. 29.00)" type="number" step="0.01" min="0"
                              value={priceForm.unit_amount}
                              onChange={e => setPriceForm(f => ({ ...f, unit_amount: e.target.value }))} required />
                            <input className={inputCls} placeholder="Currency (e.g. usd)"
                              value={priceForm.currency}
                              onChange={e => setPriceForm(f => ({ ...f, currency: e.target.value }))} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <select className={inputCls} value={priceForm.type}
                              onChange={e => setPriceForm(f => ({ ...f, type: e.target.value }))}>
                              <option value="recurring">Recurring</option>
                              <option value="one_time">One-time</option>
                            </select>
                            {priceForm.type === 'recurring' && (
                              <select className={inputCls} value={priceForm.interval}
                                onChange={e => setPriceForm(f => ({ ...f, interval: e.target.value }))}>
                                <option value="month">Monthly</option>
                                <option value="year">Yearly</option>
                                <option value="week">Weekly</option>
                                <option value="day">Daily</option>
                              </select>
                            )}
                          </div>
                          <input className={inputCls} placeholder="Nickname (optional)"
                            value={priceForm.nickname}
                            onChange={e => setPriceForm(f => ({ ...f, nickname: e.target.value }))} />
                          <div className="flex gap-2">
                            <button type="submit" disabled={addingPrice}
                              className="px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50">
                              {addingPrice ? 'Adding…' : 'Add Price'}
                            </button>
                            <button type="button"
                              onClick={() => { setAddPriceFor(null); setPriceForm(EMPTY_PRICE); }}
                              className="px-3 py-1.5 text-xs text-gray-500 hover:underline">Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <button
                          onClick={() => { setAddPriceFor(p.id); setPriceForm(EMPTY_PRICE); }}
                          className="text-xs text-violet-600 hover:underline flex items-center gap-1"
                        >
                          <Plus size={11} /> Add price
                        </button>
                      )}
                    </div>

                    {/* Edit product */}
                    {p.active && editingProductId === p.id ? (
                      <form onSubmit={saveEdit} className="space-y-2 p-3 bg-white dark:bg-gray-900 rounded-lg border border-violet-200 dark:border-violet-800 mt-2">
                        <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">Edit product</p>
                        <input
                          className={inputCls}
                          placeholder="Product name"
                          value={editProdForm.name}
                          onChange={e => setEditProdForm(f => ({ ...f, name: e.target.value }))}
                          required
                        />
                        <MetadataFields
                          kind={editProdForm.kind}
                          metadata={editProdForm.metadata}
                          onChange={meta => setEditProdForm(f => ({ ...f, metadata: meta }))}
                          inputCls={inputCls}
                        />
                        <AudienceFields
                          metadata={editProdForm.metadata}
                          onChange={meta => setEditProdForm(f => ({ ...f, metadata: meta }))}
                        />
                        <div className="flex gap-2">
                          <button type="submit" disabled={savingEdit}
                            className="px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50">
                            {savingEdit ? 'Saving…' : 'Save Changes'}
                          </button>
                          <button type="button" onClick={() => setEditingProductId(null)}
                            className="px-3 py-1.5 text-xs text-gray-500 hover:underline">Cancel</button>
                        </div>
                      </form>
                    ) : (
                      p.active && (
                        <div className="flex items-center gap-4 mt-1">
                          <button onClick={() => startEdit(p)}
                            className="text-xs text-violet-600 hover:underline">
                            Edit product
                          </button>
                          <button onClick={() => archiveProduct(p.id)}
                            className="text-xs text-red-500 hover:underline">
                            Archive product
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhook management */}
      <div className={cardCls}>
        <div className={headerCls}>
          <Zap size={14} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Billing Webhook</span>
          <button onClick={loadWebhooks}
            className="ml-auto text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        <div className="px-4 py-3">
          {!webhooks ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              {mode === 'unconfigured'
                ? 'Configure STRIPE_SECRET_KEY to manage webhooks.'
                : 'Loading webhook data…'}
            </p>
          ) : (
            <div className="space-y-4">
              {webhooks.our_url && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Target URL: <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">{webhooks.our_url}</code>
                </p>
              )}

              {webhooks.endpoints?.length === 0 ? (
                <div>
                  <p className="text-sm text-amber-600 dark:text-amber-400 mb-2">No webhook endpoints found in Stripe.</p>
                  <SecretWriteGate holds={holdsSecretWrites} what="Registering a webhook" testid="stripe-webhook-holder-only">
                    <button
                      onClick={registerWebhook}
                      disabled={webhookBusy}
                      className="px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50"
                    >
                      {webhookBusy ? 'Registering…' : 'Register Webhook'}
                    </button>
                  </SecretWriteGate>
                </div>
              ) : (
                <div className="space-y-2">
                  {webhooks.endpoints.map((ep) => (
                    <div key={ep.id} className={`p-3 rounded-lg border ${
                      ep.is_ours
                        ? 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-900/10'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}>
                      <p className="text-xs font-mono text-gray-700 dark:text-gray-300 break-all">{ep.url}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {ep.is_ours && <span className="text-violet-600 dark:text-violet-400 font-medium mr-1.5">← our endpoint</span>}
                        status: {ep.status}
                        <span className="mx-1.5 opacity-40">·</span>
                        <span className="font-mono">{ep.id}</span>
                      </p>
                      {ep.missing_events?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mb-1">Missing events:</p>
                          <div className="flex flex-wrap gap-1">
                            {ep.missing_events.map(ev => (
                              <span key={ev} className="text-[10px] font-mono bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded">
                                {ev}
                              </span>
                            ))}
                          </div>
                          {ep.is_ours && (
                            <button
                              onClick={() => updateWebhookEvents(ep.id)}
                              disabled={webhookBusy}
                              className="mt-2 px-2.5 py-1 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
                            >
                              {webhookBusy ? 'Updating…' : 'Fix: Add Missing Events'}
                            </button>
                          )}
                        </div>
                      )}
                      {ep.is_ours && (!ep.missing_events || ep.missing_events.length === 0) && (
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">✓ All required events enabled</p>
                      )}
                    </div>
                  ))}
                  <SecretWriteGate holds={holdsSecretWrites} what="Registering a new endpoint" testid="stripe-webhook-holder-only">
                    <div className="flex items-center gap-3 flex-wrap pt-1">
                      <button
                        onClick={registerWebhook}
                        disabled={webhookBusy}
                        className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                      >
                        {webhookBusy ? 'Working…' : 'Register New Endpoint'}
                      </button>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">
                        New registration automatically captures and stores the signing secret.
                      </p>
                    </div>
                  </SecretWriteGate>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PaymentsPanel;
