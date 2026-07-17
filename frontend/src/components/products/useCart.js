// One-time cart — React/session state only (per-session, no DB). Holds ONLY
// one_time catalog items. Subscription products bypass the cart entirely.
//
// Persisted to sessionStorage so the drawer/checkout survive a page reload
// within the same tab session (cleared when the tab closes).
import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'axal_cart_v1';
const PROMO_KEY = 'axal_cart_promo_v1';

function readStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeStored(items) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* private mode / quota — ignore */ }
}

function readPromo() {
  try {
    const raw = sessionStorage.getItem(PROMO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePromo(promo) {
  try {
    if (promo) sessionStorage.setItem(PROMO_KEY, JSON.stringify(promo));
    else sessionStorage.removeItem(PROMO_KEY);
  } catch { /* private mode / quota — ignore */ }
}

// A cart line: { price_id, product_id, name, currency, unit_amount, quantity }
export function useCart() {
  const [items, setItems] = useState(readStored);
  const [promo, setPromoState] = useState(readPromo);

  useEffect(() => { writeStored(items); }, [items]);

  // Cross-tab-in-session sync + same-tab broadcast so the sticky bar and the
  // drawer stay in lock-step no matter which component mutates the cart.
  useEffect(() => {
    const onChange = () => { setItems(readStored()); setPromoState(readPromo()); };
    window.addEventListener('axal:cart', onChange);
    return () => window.removeEventListener('axal:cart', onChange);
  }, []);

  const broadcast = useCallback(() => {
    try { window.dispatchEvent(new Event('axal:cart')); } catch { /* noop */ }
  }, []);

  const add = useCallback((line, qty = 1) => {
    setItems((prev) => {
      const next = prev.slice();
      const i = next.findIndex((x) => x.price_id === line.price_id);
      if (i >= 0) next[i] = { ...next[i], quantity: next[i].quantity + qty };
      else next.push({ ...line, quantity: Math.max(1, qty) });
      writeStored(next);
      return next;
    });
    broadcast();
  }, [broadcast]);

  const setQty = useCallback((priceId, qty) => {
    setItems((prev) => {
      const next = prev
        .map((x) => (x.price_id === priceId ? { ...x, quantity: qty } : x))
        .filter((x) => x.quantity > 0);
      writeStored(next);
      return next;
    });
    broadcast();
  }, [broadcast]);

  const changeQty = useCallback((priceId, delta) => {
    setItems((prev) => {
      const next = prev
        .map((x) => (x.price_id === priceId ? { ...x, quantity: x.quantity + delta } : x))
        .filter((x) => x.quantity > 0);
      writeStored(next);
      return next;
    });
    broadcast();
  }, [broadcast]);

  const remove = useCallback((priceId) => {
    setItems((prev) => {
      const next = prev.filter((x) => x.price_id !== priceId);
      writeStored(next);
      return next;
    });
    broadcast();
  }, [broadcast]);

  const setPromo = useCallback((p) => {
    setPromoState(p);
    writePromo(p);
    broadcast();
  }, [broadcast]);

  const clear = useCallback(() => {
    setItems([]);
    writeStored([]);
    setPromoState(null);
    writePromo(null);
    broadcast();
  }, [broadcast]);

  const count = useMemo(() => items.reduce((a, l) => a + l.quantity, 0), [items]);
  const subtotal = useMemo(
    () => items.reduce((a, l) => a + (Number(l.unit_amount) || 0) * l.quantity, 0),
    [items],
  );
  const currency = items[0]?.currency || 'usd';

  return { items, add, setQty, changeQty, remove, clear, count, subtotal, currency, promo, setPromo };
}
