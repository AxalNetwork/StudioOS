// Cap Table share links (D364) — the Worker's audience-scoped links
// (POST /captable/scenarios/:uid/share), which no page called until now.
//
// What a link reveals is shown BEFORE it is minted (lib/capTableShare.js
// mirrors the Worker's AUDIENCE_SCOPE), and an investor or full link, which
// names people and their positions, needs the founder to confirm those people
// agreed. The raw link is returned once — only its hash is stored — so the
// sheet says so and keeps it on screen until closed. Listed links show the
// Worker's own view counts; a failed list is Unreadable, never "no links".

import React, { useEffect, useState } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Unreadable } from '../../ui';
import {
  CAP_TABLE_AUDIENCES, CONSENT_COPY, SHARE_DAYS_DEFAULT, SHARE_DAYS_MAX,
  SHARE_VIEWS_DEFAULT, SHARE_VIEWS_MAX, capShareState, needsHolderConsent, shareRequest,
} from '../../lib/capTableShare';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-[12.5px] text-gray-900 dark:text-gray-100';
const STATE_LABEL = { live: 'Live', used_up: 'Used up', expired: 'Expired', withdrawn: 'Revoked' };

export default function CapTableShareModal({ scenarioUid, onClose }) {
  const [form, setForm] = useState({ audience: 'summary', days: String(SHARE_DAYS_DEFAULT), views: String(SHARE_VIEWS_DEFAULT), label: '', consent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [minted, setMinted] = useState(null); // { url, expires_at, view_limit, audience }
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState({ status: 'loading', items: [] });

  const loadLinks = async () => {
    setLinks((l) => ({ ...l, status: 'loading' }));
    try {
      const r = await api.capTableShareList(scenarioUid);
      if (!Array.isArray(r?.items)) throw new Error('share list returned no items');
      setLinks({ status: 'ready', items: r.items });
    } catch (e) {
      reportError('spinout-captable:share-list', e);
      setLinks({ status: 'failed', items: [] });
    }
  };
  useEffect(() => { loadLinks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scenarioUid]);

  const aud = CAP_TABLE_AUDIENCES.find((a) => a.k === form.audience);
  const consentNeeded = needsHolderConsent(form.audience);

  const create = async () => {
    if (busy) return;
    const req = shareRequest(form);
    if (!req.ok) { setError(req.message); return; }
    setBusy(true); setError(''); setCopied(false);
    try {
      const r = await api.capTableShareCreate(scenarioUid, req.body);
      const path = r?.share_path;
      if (!path) throw new Error('The server did not return a link.');
      setMinted({ url: `${window.location.origin}${path}`, expires_at: r.expires_at, view_limit: r.view_limit, audience: r.audience });
      setForm((f) => ({ ...f, consent: false }));
      loadLinks();
    } catch (e) {
      reportError('spinout-captable:share-create', e);
      setError(e?.message || 'The link was not created.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id) => {
    try {
      await api.capTableShareRevoke(id);
      loadLinks();
    } catch (e) {
      reportError('spinout-captable:share-revoke', e);
      setError(e?.message || 'That link was not revoked. It may still open.');
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(minted.url); setCopied(true); } catch { setCopied(false); setError('Copy was blocked — select the link and copy it by hand.'); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-gray-900/50 flex items-center justify-center p-4" onClick={onClose} data-testid="captable-share-modal">
      <div className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[16px] font-extrabold text-gray-900 dark:text-gray-50">Share the cap table</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" data-testid="button-close-captable-share"><X size={16} /></button>
        </div>

        <div className={`${LBL} mb-1.5`}>Who is it for</div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {CAP_TABLE_AUDIENCES.map((a) => (
            <button
              key={a.k}
              type="button"
              onClick={() => setForm({ ...form, audience: a.k, consent: false })}
              data-testid={`share-audience-${a.k}`}
              className={`rounded-lg border px-2 py-1.5 text-[12.5px] font-semibold ${form.audience === a.k ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3 mb-3 text-[12px]" data-testid="share-audience-scope">
          <div className="font-bold text-gray-700 dark:text-gray-200 mb-1">They will see</div>
          <ul className="list-disc pl-4 text-gray-600 dark:text-gray-300">{aud.sees.map((s) => <li key={s}>{s}</li>)}</ul>
          {aud.hidden.length > 0 && (
            <>
              <div className="font-bold text-gray-700 dark:text-gray-200 mt-2 mb-1">Hidden from them</div>
              <ul className="list-disc pl-4 text-gray-500 dark:text-gray-400">{aud.hidden.map((s) => <li key={s}>{s}</li>)}</ul>
            </>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <label className="block">
            <span className={LBL}>Days (max {SHARE_DAYS_MAX})</span>
            <input type="number" min="1" max={SHARE_DAYS_MAX} step="1" className={INPUT} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} data-testid="input-share-days" />
          </label>
          <label className="block">
            <span className={LBL}>Opens (max {SHARE_VIEWS_MAX})</span>
            <input type="number" min="1" max={SHARE_VIEWS_MAX} step="1" className={INPUT} value={form.views} onChange={(e) => setForm({ ...form, views: e.target.value })} data-testid="input-share-views" />
          </label>
          <label className="block">
            <span className={LBL}>Label</span>
            <input type="text" maxLength={120} className={INPUT} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Optional" data-testid="input-share-label" />
          </label>
        </div>

        {consentNeeded && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3 mb-3 text-[12px] text-amber-800 dark:text-amber-200" data-testid="share-consent">
            <input type="checkbox" className="mt-0.5" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} data-testid="input-share-consent" />
            <span>{CONSENT_COPY}</span>
          </label>
        )}

        {error && <p className="text-[12px] text-rose-600 dark:text-rose-400 mb-2" data-testid="share-error">{error}</p>}

        <button
          type="button"
          onClick={create}
          disabled={busy || (consentNeeded && !form.consent)}
          data-testid="button-create-captable-share"
          className="w-full rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-[12.5px] font-bold py-2 inline-flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 size={12} className="animate-spin" />} Create link
        </button>

        {minted && (
          <div className="mt-3 rounded-lg border border-violet-200 dark:border-violet-900/50 p-3" data-testid="share-minted">
            <div className="flex gap-2">
              <input readOnly className={`${INPUT} flex-1`} value={minted.url} onFocus={(e) => e.target.select()} data-testid="text-share-url" />
              <button type="button" onClick={copy} className="rounded-lg bg-violet-600 text-white text-[12px] font-semibold px-3 inline-flex items-center gap-1">
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
              Copy it now: the link is shown once and cannot be shown again. If it is lost, revoke it below and create another.
              {minted.view_limit ? ` It opens ${minted.view_limit === 1 ? 'once' : `up to ${minted.view_limit} times`}` : ''}
              {minted.expires_at ? ` and stops on ${String(minted.expires_at).slice(0, 10)}.` : '.'}
            </p>
          </div>
        )}

        <div className={`${LBL} mt-4 mb-1.5`}>Links issued</div>
        {links.status === 'loading' ? (
          <div className="text-[12px] text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</div>
        ) : links.status === 'failed' ? (
          <div data-testid="share-links-unreadable">
            <Unreadable what="The links issued for this cap table" claim="This is not a claim that none are live." onRetry={loadLinks} />
          </div>
        ) : links.items.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="share-links-empty">No links issued for this cap table.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 text-[12px]" data-testid="share-links">
            {links.items.map((l) => {
              const st = capShareState(l);
              return (
                <li key={l.id} className="py-1.5 flex items-center gap-2">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{CAP_TABLE_AUDIENCES.find((a) => a.k === l.audience)?.label || l.audience}</span>
                  {l.label && <span className="text-gray-500 truncate">{l.label}</span>}
                  <span className="ml-auto tabular-nums text-gray-500">{Number.isInteger(l.view_count) ? l.view_count : '—'} of {Number.isInteger(l.view_limit) ? l.view_limit : '—'} opens</span>
                  <span className="text-gray-500">{STATE_LABEL[st]}</span>
                  {st === 'live' && (
                    <button type="button" onClick={() => revoke(l.id)} className="text-rose-600 font-semibold hover:underline" data-testid={`button-revoke-share-${l.id}`}>Revoke</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
