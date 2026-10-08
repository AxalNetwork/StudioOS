import React, { useCallback, useEffect, useState } from 'react';
import { useEscapeClose } from '../../../components/useEscapeClose';
import { reportError } from '../../../lib/log';

export const card = 'rounded-xl border border-axal-hairline bg-white dark:bg-gray-900';
export const button = 'rounded-lg border border-axal-hairline px-3 py-2 text-xs font-semibold disabled:opacity-40';
export const input = 'w-full rounded-lg border border-axal-hairline bg-white dark:bg-gray-900 px-3 py-2 text-sm';
export function useRead(load, dependencies = []) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, data: null, error: false });
  useEffect(() => {
    let active = true;
    setState({ loading: true, data: null, error: false });
    Promise.resolve().then(load).then(data => {
      if (active) setState({ loading: false, data, error: false });
    }, e => {
      reportError('contracts:read', e);
      if (active) setState({ loading: false, data: null, error: true });
    });
    return () => { active = false; };
  // The caller provides the primitive values which define this read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, attempt]);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { ...state, retry };
}
export function ReadState({ read, what, children }) {
  if (read.loading) return <p role="status" className="p-6">Loading {what.toLowerCase()}…</p>;
  if (read.error) return <div role="alert" className="p-6"><b>Unreadable.</b> {what} could not be read. <button type="button" className={button} onClick={read.retry}>Try again</button></div>;
  return children;
}
export function Missing({ reason }) { return <span className="text-axal-muted"><span>Not recorded</span>{reason && <small className="block text-[11px]">{reason}</small>}</span>; }
export function Recorded({ value, reason }) { return value == null || value === '' ? <Missing reason={reason} /> : <>{value}</>; }
export function date(value) {
  if (!value) return null;
  const raw = String(value);
  const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  if (Number.isNaN(Date.parse(timestamp))) return null;
  return new Date(timestamp).toLocaleString('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' });
}
export function Pagination({ data, offset, onPage }) {
  return <div className="flex items-center justify-between gap-3 border-t border-axal-hairline p-3 text-xs">
    <span>{data.total ? `${offset + 1}–${Math.min(offset + data.items.length, data.total)}` : '0'} of {data.total}</span>
    <div className="flex gap-2"><button type="button" className={button} disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - 25))}>Previous</button>
      <button type="button" className={button} disabled={offset + data.items.length >= data.total} onClick={() => onPage(offset + 25)}>Next</button></div>
  </div>;
}
export function SidePanel({ title, onClose, children }) {
  useEscapeClose(onClose);
  return <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={title} className="absolute right-0 top-0 flex h-full w-full max-w-[640px] flex-col bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
      <header className="flex items-center justify-between gap-3 border-b border-axal-hairline p-4"><h2 className="text-lg font-bold">{title}</h2><button type="button" className={button} onClick={onClose}>Close</button></header>
      <div className="overflow-y-auto p-4 space-y-4">{children}</div>
    </section>
  </div>;
}
export function pdfBlob(base64) {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return new Blob([bytes], { type: 'application/pdf' });
}
export function downloadPdf(base64, filename) {
  const url = URL.createObjectURL(pdfBlob(base64));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
