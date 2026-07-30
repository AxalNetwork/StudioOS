// /checkout/confirmation?order=MRD-YYYY-XXXXX — post-checkout receipt.
//   Shows the order number, an itemized summary (from getOrder), a
//   "Download Invoice PDF" action (authenticated fetch → blob via
//   orderInvoiceBlob — NOT a plain <a href>), and "Go to Dashboard".
// If the order param is missing/invalid → redirect to /products.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Download, LayoutDashboard, Loader2, AlertTriangle, Package } from 'lucide-react';
import { api } from '../lib/api';
import { formatMoney, formatDate } from '../components/products/productsShared';

export default function CheckoutConfirmationPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderRef = params.get('order') || '';

  const [order, setOrder] = useState(null);   // null = loading
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  useEffect(() => {
    if (!orderRef) { navigate('/products', { replace: true }); return; }
    let cancelled = false;
    api.getOrder(orderRef)
      .then((r) => {
        if (cancelled) return;
        if (!r?.order) { navigate('/products', { replace: true }); return; }
        setOrder(r.order);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e?.status === 404) { navigate('/products', { replace: true }); return; }
        setError(e?.message || 'Could not load your order.');
      });
    return () => { cancelled = true; };
  }, [orderRef, navigate]);

  const downloadInvoice = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const { url, filename } = await api.orderInvoiceBlob(orderRef);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `${orderRef}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Release the object URL shortly after the download begins.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setDownloadError(e?.message || 'Invoice download failed.');
    } finally {
      setDownloading(false);
    }
  }, [orderRef, downloading]);

  if (error) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <span className="inline-flex w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/40 text-red-500 items-center justify-center mb-4">
          <AlertTriangle size={26} />
        </span>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{error}</h1>
        <button onClick={() => navigate('/products')} className="mt-4 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium">
          Back to Products
        </button>
      </div>
    );
  }

  if (order === null) {
    return (
      <div className="max-w-lg mx-auto py-20 flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin" /> Loading your order…
      </div>
    );
  }

  const items = Array.isArray(order.items) ? order.items : [];

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-4">
      <div className="text-center">
        <span className="inline-flex w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500 items-center justify-center mb-4">
          <CheckCircle2 size={34} />
        </span>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {order.status === 'paid' ? 'Order confirmed' : 'Order received'}
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
          Thank you — your order number is <span className="font-mono font-semibold text-gray-700 dark:text-gray-200">{order.order_ref}</span>.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Package size={16} className="text-violet-600 dark:text-violet-400" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Order summary</h2>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((it, i) => (
            <div key={it.price_id || i} className="py-3 flex justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Qty {it.quantity} · {formatMoney(it.unit_amount, order.currency)} each</div>
              </div>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatMoney(it.line_total, order.currency)}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2 text-sm border-t border-gray-200 dark:border-gray-800 pt-4">
          <div className="flex justify-between text-gray-500 dark:text-gray-400">
            <span>Subtotal</span>
            <span className="text-gray-900 dark:text-gray-100 font-semibold">{formatMoney(order.subtotal, order.currency)}</span>
          </div>
          {order.discount_cents > 0 && (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
              <span>Discount {order.promo_code ? `(${order.promo_code})` : ''}</span>
              <span className="font-semibold">−{formatMoney(order.discount_cents, order.currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-500 dark:text-gray-400">
            <span>VAT</span>
            <span className="text-gray-900 dark:text-gray-100 font-semibold">{formatMoney(order.vat_cents, order.currency)}</span>
          </div>
          <div className="flex justify-between items-baseline pt-2 border-t border-gray-200 dark:border-gray-800">
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Total</span>
            <span className="text-xl font-extrabold text-gray-900 dark:text-gray-100">{formatMoney(order.total, order.currency)}</span>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          {order.paid_at ? `Paid on ${formatDate(order.paid_at)}` : `Placed on ${formatDate(order.created_at)}`}
        </p>
      </div>

      {downloadError && (
        <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
          <AlertTriangle size={12} /> {downloadError}
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={downloadInvoice}
          disabled={downloading}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          Download Invoice PDF
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
        >
          <LayoutDashboard size={15} /> Go to Dashboard
        </button>
      </div>
    </div>
  );
}
