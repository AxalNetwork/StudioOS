import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { X, RefreshCw, Loader2, Trash2, Ticket, Plus } from 'lucide-react';
import { useToast } from '../../../components/useToast';
import { PromoProductScope } from '../../PromoProductScope';
import { ConsoleUnreadable } from './shared';

/**
 * D648 (#1448) — the Promo codes console.
 */

export function PromoCodesPanel() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  // D648 — a failed read is said, never drawn as an empty list.
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const { toast, showToast } = useToast(3000);

  const EMPTY_FORM = {
    code: '', type: 'percent', percent_off: '', amount_off: '', currency: 'usd',
    duration: 'once', duration_in_months: '', max_redemptions: '', expires_at: '', product_ids: [],
  };
  const [form, setForm] = useState(EMPTY_FORM);
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.adminListPromos();
      setRows(r.promos || []);
      setFailed(false);
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Failed to load promo codes' });
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.catalogProducts().then((r) => setProducts(r.products || [])).catch(() => {});
  }, []);

  const toggleProduct = (id) => setForm((f) => ({
    ...f,
    product_ids: f.product_ids.includes(id)
      ? f.product_ids.filter((x) => x !== id)
      : [...f.product_ids, id],
  }));

  const create = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const body = {
        code: form.code.trim(),
        type: form.type,
        duration: form.duration,
        product_ids: form.product_ids,
      };
      if (form.type === 'percent') {
        body.percent_off = Number(form.percent_off);
      } else {
        body.amount_off = Number(form.amount_off);
        body.currency = form.currency.trim().toLowerCase();
      }
      if (form.duration === 'repeating') body.duration_in_months = Number(form.duration_in_months);
      if (form.max_redemptions) body.max_redemptions = Number(form.max_redemptions);
      if (form.expires_at) body.expires_at = form.expires_at;
      const r = await api.adminCreatePromo(body);
      showToast({ kind: 'ok', msg: `Created ${r.code || form.code}` });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      load();
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Create failed' });
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (promo) => {
    setBusyId(promo.id);
    try {
      const r = await api.adminSetPromoActive(promo.id, !promo.active);
      setRows((prev) => prev.map((p) => (p.id === promo.id ? { ...p, active: r.active } : p)));
      showToast({ kind: 'ok', msg: `${promo.code} ${r.active ? 'activated' : 'deactivated'}` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Update failed' });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (promo) => {
    if (!window.confirm(`Delete promo ${promo.code}? This deactivates it and deletes the backing coupon — it can never be redeemed again.`)) return;
    setBusyId(promo.id);
    try {
      await api.adminDeletePromo(promo.id);
      setRows((prev) => prev.map((p) => (p.id === promo.id ? { ...p, active: false } : p)));
      showToast({ kind: 'ok', msg: `${promo.code} deleted` });
    } catch (e) {
      showToast({ kind: 'err', msg: e.message || 'Delete failed' });
    } finally {
      setBusyId(null);
    }
  };

  const productName = (id) => products.find((p) => p.id === id)?.name || id;
  const discountLabel = (p) => (
    p.percent_off != null ? `${p.percent_off}% off`
      : p.amount_off != null ? `${(p.amount_off / 100).toFixed(2)} ${(p.currency || '').toUpperCase()} off`
        : '—'
  );

  const activeCount = rows.filter((r) => r.active).length;
  const inputCls = 'rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500';

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden dark:bg-gray-900 dark:border-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2 flex-wrap dark:border-gray-800">
        <Ticket size={16} className="text-gray-600" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Promo Codes</h3>
        <span className="text-xs text-gray-500">{activeCount} active · {rows.length} total</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load}
            className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md text-gray-700 inline-flex items-center gap-1 dark:bg-gray-800 dark:text-gray-300">
            <RefreshCw size={11} /> Refresh
          </button>
          <button onClick={() => setShowCreate((v) => !v)}
            className="text-xs px-2.5 py-1 bg-violet-600 hover:bg-violet-700 rounded-md text-white inline-flex items-center gap-1">
            {showCreate ? <X size={11} /> : <Plus size={11} />} {showCreate ? 'Cancel' : 'New code'}
          </button>
        </div>
      </div>

      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/30">
        Codes proxy native Stripe Coupons + Promotion Codes. Restrict a code to specific products via the
        allow-list (leave empty to allow all). 100%-off codes (and sub-minimum totals) complete as free orders.
      </div>

      {showCreate && (
        <form onSubmit={create} className="px-4 py-4 border-b border-gray-200 dark:border-gray-800 space-y-3 bg-gray-50/40 dark:bg-gray-800/20" data-testid="promo-create-form">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Code
              <input required value={form.code} onChange={(e) => setField('code', e.target.value.toUpperCase())}
                placeholder="LAUNCH20" autoCapitalize="characters" className={inputCls} data-testid="promo-code-input" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Type
              <select value={form.type} onChange={(e) => setField('type', e.target.value)} className={inputCls}>
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount off</option>
              </select>
            </label>
            {form.type === 'percent' ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                Percent off (1–100)
                <input required type="number" min="1" max="100" step="1" value={form.percent_off}
                  onChange={(e) => setField('percent_off', e.target.value)} placeholder="20" className={inputCls} />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                  Amount off (minor units, e.g. cents)
                  <input required type="number" min="1" step="1" value={form.amount_off}
                    onChange={(e) => setField('amount_off', e.target.value)} placeholder="500" className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                  Currency
                  <input required value={form.currency} onChange={(e) => setField('currency', e.target.value)}
                    placeholder="usd" maxLength={3} className={inputCls} />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Duration (subscriptions)
              <select value={form.duration} onChange={(e) => setField('duration', e.target.value)} className={inputCls}>
                <option value="once">Once (first invoice)</option>
                <option value="forever">Forever</option>
                <option value="repeating">Repeating (N months)</option>
              </select>
            </label>
            {form.duration === 'repeating' && (
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                Duration in months
                <input required type="number" min="1" step="1" value={form.duration_in_months}
                  onChange={(e) => setField('duration_in_months', e.target.value)} placeholder="3" className={inputCls} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Max redemptions (optional)
              <input type="number" min="1" step="1" value={form.max_redemptions}
                onChange={(e) => setField('max_redemptions', e.target.value)} placeholder="Unlimited" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              Expires at (optional)
              <input type="date" value={form.expires_at} onChange={(e) => setField('expires_at', e.target.value)} className={inputCls} />
            </label>
          </div>

          <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
            Eligible products <span className="font-normal text-gray-400">(none selected = all products)</span>
            <div className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
              {products.length === 0 ? (
                <div className="px-3 py-2 text-gray-400">No catalog products found.</div>
              ) : products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <input type="checkbox" checked={form.product_ids.includes(p.id)} onChange={() => toggleProduct(p.id)} />
                  <span className="text-gray-800 dark:text-gray-200 font-normal">{p.name}</span>
                  <span className="text-gray-400 font-normal">· {p.kind || 'product'}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={creating}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create code
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm inline-flex items-center justify-center gap-2 w-full">
          <Loader2 size={14} className="animate-spin" /> Loading promo codes…
        </div>
      ) : failed ? (
        <ConsoleUnreadable what="The promo codes" onRetry={() => load()} />
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">No promo codes yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/40">
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Code</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Discount</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Products</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Redeemed</th>
                <th className="text-left px-4 py-2.5 text-gray-600 font-medium text-xs">Expires</th>
                <th className="text-center px-4 py-2.5 text-gray-600 font-medium text-xs">Status</th>
                <th className="text-right px-4 py-2.5 text-gray-600 font-medium text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const busy = busyId === p.id;
                const limit = p.max_redemptions != null ? `/${p.max_redemptions}` : '';
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/50 dark:border-gray-800 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3 font-mono font-medium text-gray-900 dark:text-gray-100">{p.code}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{discountLabel(p)}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-[18rem]">
                      <PromoProductScope promo={p} productName={productName} />
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">{p.times_redeemed ?? 0}{limit}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {p.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <button disabled={busy} onClick={() => toggleActive(p)}
                          className={`px-2 py-1 text-xs rounded-md font-medium transition-colors disabled:opacity-50 ${
                            p.active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}>
                          {p.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button disabled={busy} onClick={() => remove(p)}
                          className="px-2 py-1 text-xs rounded-md font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-50 inline-flex items-center gap-1">
                          <Trash2 size={11} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 px-3 py-2 rounded-lg text-sm shadow-lg ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        }`}>{toast.msg}</div>
      )}
    </div>
  );
}

export default PromoCodesPanel;
