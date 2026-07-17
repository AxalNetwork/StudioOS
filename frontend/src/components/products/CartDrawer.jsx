// Right slide-over cart drawer for one-time items. Live subtotal / discount /
// VAT / grand total, per-line qty controls, and a promo field validated via
// /payments/promo/validate. Prices come from the cart lines (catalog-sourced);
// VAT is a display estimate mirrored from the pinned contract (5% UAE/Dubai).
import React, { useCallback, useEffect, useState } from 'react';
import { ShoppingCart, X, Loader2, ArrowRight, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { formatMoney, vatRate, cycleCadenceLabel } from './productsShared';

const PROMO_REASONS = {
  not_found: "That code isn't valid.",
  inactive: 'This code is no longer active.',
  expired: 'This code has expired.',
  product_not_eligible: "This code doesn't apply to these items.",
  usage_limit_reached: 'This code has reached its usage limit.',
  currency_mismatch: "This code can't be used for this purchase.",
  amount_below_minimum: 'This code lowers the total below what we can process.',
};

function LineRow({ line, onDec, onInc, onRemove }) {
  const lineTotal = (Number(line.unit_amount) || 0) * line.quantity;
  return (
    <div className="py-4 border-b border-gray-200 dark:border-gray-800">
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{line.name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {cycleCadenceLabel(line.cycle || 'onetime')}
          </div>
        </div>
        <button
          onClick={onRemove}
          className="text-xs text-gray-400 hover:text-red-500 h-fit"
        >
          Remove
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="inline-flex items-center border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden">
          <button onClick={onDec} className="w-7 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">−</button>
          <span className="min-w-[24px] text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{line.quantity}</span>
          <button onClick={onInc} className="w-7 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">+</button>
        </div>
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatMoney(lineTotal, line.currency)}</span>
      </div>
    </div>
  );
}

export default function CartDrawer({ open, onClose, cart, billingCountry = '', onCheckout, appliedPromo, onPromoChange }) {
  const [code, setCode] = useState(appliedPromo?.code || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);          // { ok, text }

  useEffect(() => { setCode(appliedPromo?.code || ''); }, [appliedPromo]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const subtotal = cart.subtotal;
  const discount = appliedPromo?.discount_cents || 0;
  const taxable = Math.max(0, subtotal - discount);
  const vat = Math.round(taxable * vatRate(billingCountry));
  const total = taxable + vat;

  const applyPromo = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed || busy || !cart.items.length) return;
    setBusy(true);
    setMsg(null);
    try {
      // Validate against the first line's price (the promo path scopes to a
      // catalog price); the server recomputes discount over the whole cart on
      // /orders/intent, so this is a friendly pre-check + code capture.
      const res = await api.validatePromo({ code: trimmed, price_id: cart.items[0].price_id });
      if (!res?.valid) {
        onPromoChange(null);
        setMsg({ ok: false, text: PROMO_REASONS[res?.reason] || "That code can't be applied." });
      } else {
        // Recompute discount over the full cart subtotal for the drawer preview.
        let discountCents = 0;
        if (res.percent_off) discountCents = Math.round(subtotal * (res.percent_off / 100));
        else if (res.amount_off) discountCents = Math.min(res.amount_off, subtotal);
        onPromoChange({ ...res, code: res.code || trimmed, discount_cents: discountCents });
        setMsg({ ok: true, text: res.free ? 'Your order is free.' : (res.percent_off ? `${res.percent_off}% off applied.` : `${formatMoney(res.amount_off, res.currency || cart.currency)} off applied.`) });
      }
    } catch (e) {
      onPromoChange(null);
      setMsg({ ok: false, text: e?.message || "Couldn't check that code." });
    } finally {
      setBusy(false);
    }
  }, [code, busy, cart.items, cart.currency, subtotal, onPromoChange]);

  if (!open) return null;

  const hasItems = cart.items.length > 0;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[80] bg-gray-900/40"
        style={{ animation: 'mrdFade .18s ease' }}
      />
      <div
        className="fixed top-0 right-0 bottom-0 z-[81] w-[420px] max-w-[92vw] bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        style={{ animation: 'mrdSlide .24s cubic-bezier(.2,.8,.2,1)' }}
        role="dialog"
        aria-label="Your order"
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Your order</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {cart.count} {cart.count === 1 ? 'item' : 'items'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {hasItems ? (
            <div>
              {cart.items.map((l) => (
                <LineRow
                  key={l.price_id}
                  line={l}
                  onDec={() => cart.changeQty(l.price_id, -1)}
                  onInc={() => cart.changeQty(l.price_id, 1)}
                  onRemove={() => cart.remove(l.price_id)}
                />
              ))}

              <div className="mt-4">
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => { setCode(e.target.value); setMsg(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyPromo(); }}
                    placeholder="Promo code"
                    autoCapitalize="characters"
                    className="flex-1 h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                  <button
                    onClick={applyPromo}
                    disabled={busy || !code.trim()}
                    className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : 'Apply'}
                  </button>
                </div>
                {msg && (
                  <p className={`mt-2 text-xs flex items-center gap-1 ${msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {msg.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {msg.text}
                  </p>
                )}
              </div>

              <div className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between text-gray-500 dark:text-gray-400">
                  <span>Subtotal</span>
                  <span className="text-gray-900 dark:text-gray-100 font-semibold">{formatMoney(subtotal, cart.currency)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Discount ({appliedPromo?.code})</span>
                    <span className="font-semibold">−{formatMoney(discount, cart.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-500 dark:text-gray-400">
                  <span>VAT ({Math.round(vatRate(billingCountry) * 100)}%, est.)</span>
                  <span className="text-gray-900 dark:text-gray-100 font-semibold">{formatMoney(vat, cart.currency)}</span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-between items-baseline">
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Total</span>
                <span className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">{formatMoney(total, cart.currency)}</span>
              </div>
            </div>
          ) : (
            <div className="py-14 text-center">
              <span className="inline-flex w-16 h-16 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-300 dark:text-violet-500 items-center justify-center mb-4">
                <ShoppingCart size={30} />
              </span>
              <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">No items selected</h4>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400 max-w-[220px] mx-auto">
                Browse the catalog to build your one-time order.
              </p>
            </div>
          )}
        </div>

        {hasItems && (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40">
            <div className="flex items-center justify-center gap-3 mb-3 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1.5"><Lock size={12} /> 256-bit SSL</span>
              <span>·</span>
              <span>Powered by Stripe</span>
            </div>
            <button
              onClick={onCheckout}
              className="w-full h-11 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold flex items-center justify-center gap-2"
            >
              Review &amp; Checkout <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
