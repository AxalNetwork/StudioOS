import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import {
  ADDRESS_RULES, ADDRESS_WARNING, availabilityOf, checkAddress, pageUrl, refusalLine, siteUrl,
} from '../../lib/brandAddress';

/**
 * D636 (#1394) — the Ops canvas's sp-brand screen, its address half: the
 * startup's address (`axal.vc/p/[slug]`, with Edit, the rule, the warning that
 * old links stop working, and the Worker's refusal as a sentence), then each
 * page's own address under it, with an availability check as you type.
 *
 * Reads `GET /api/brand/site/by-project/:pid`; writes the site address with
 * `PUT …/site/by-project/:pid` and a page's with `PUT …/landing/pages/:id/address`
 * (both record their actor). An address that could not be read says
 * Unreadable with Try again, never an empty one.
 */

const CARD = 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const FIELD = 'h-8 w-full rounded-lg border border-gray-200 bg-white px-2.5 font-mono text-[12.5px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400/40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
const BTN = 'inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} bg-violet-600 text-white hover:bg-violet-700`;
const QUIET = `${BTN} border border-gray-200 bg-white text-gray-700 hover:border-violet-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200`;
const TONE = {
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  bad: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  grey: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

function Refusal({ text, testid }) {
  if (!text) return null;
  return <p role="alert" data-testid={testid} className="mt-1.5 text-[12px] text-red-700 dark:text-red-300">{text}</p>;
}

/** The startup's address, read or being edited. `site` is a read: loading, unreadable or ready. */
export function SiteAddressCard({ site, editing, draft, error, busy, onEdit, onDraft, onSave, onCancel, onRetry }) {
  if (!site || site.status === 'loading') {
    return <p className="text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="brand-address-loading">Reading the address…</p>;
  }
  if (site.status !== 'ready') {
    return (
      <div role="alert" data-testid="brand-address-unreadable" className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300">
        <span className="font-semibold">Unreadable</span>
        <span>The address could not be read just now. This is not a missing address.</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline">
          <RefreshCw size={12} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }
  const slug = site.data?.slug;
  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-semibold text-gray-900 dark:text-white" data-testid="brand-site-url">{siteUrl(slug)}</span>
        <button type="button" className={QUIET} onClick={onEdit}>Edit</button>
      </div>
    );
  }
  const check = checkAddress(draft);
  const unchanged = check.ok && check.slug === slug;
  return (
    <div data-testid="brand-address-editor">
      <label htmlFor="brand-site-address" className="text-[11.5px] font-semibold text-gray-600 dark:text-gray-300">Address</label>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="font-mono text-[12.5px] text-gray-500 dark:text-gray-400">axal.vc/p/</span>
        <input id="brand-site-address" value={draft} onChange={(e) => onDraft(e.target.value)} className={FIELD} autoComplete="off" spellCheck={false} />
      </div>
      <p className="mt-1.5 text-[11.5px] text-gray-500 dark:text-gray-400">{ADDRESS_RULES}</p>
      <p className="mt-1 text-[11.5px] font-semibold text-amber-700 dark:text-amber-300" data-testid="brand-address-warning">{ADDRESS_WARNING}</p>
      {!check.ok && String(draft || '').trim() !== '' && <Refusal text={check.message} testid="brand-address-check" />}
      <Refusal text={error} testid="brand-address-refusal" />
      <div className="mt-2 flex gap-2">
        <button type="button" className={PRIMARY} disabled={!check.ok || unchanged || busy} onClick={() => onSave(check.slug)}>
          {busy ? 'Saving…' : 'Save address'}
        </button>
        <button type="button" className={QUIET} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/** One page's own address under the site, with its availability while it is edited. */
export function PageAddressRow({ page, siteSlug, editing, draft, availability, error, busy, onEdit, onDraft, onSave, onCancel }) {
  const own = page.page_slug;
  const verdict = availabilityOf(availability);
  return (
    <li className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950" data-testid="brand-page-address">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white">{page.name}</div>
          {own ? (
            <div className="font-mono text-[11.5px] text-gray-500 dark:text-gray-400">{siteSlug ? pageUrl(siteSlug, own) : `…/${own}`}</div>
          ) : (
            <div className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="brand-page-address-nr">
              <b>Not recorded</b>. Address: this page has no address of its own yet.
            </div>
          )}
        </div>
        {!editing && <button type="button" className={QUIET} onClick={onEdit} disabled={busy}>Change address</button>}
      </div>
      {editing && (
        <div className="mt-2" data-testid="brand-page-address-editor">
          <div className="flex items-center gap-2">
            <input aria-label={`Address for ${page.name}`} value={draft} onChange={(e) => onDraft(e.target.value)} className={FIELD} autoComplete="off" spellCheck={false} />
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE[verdict.tone]}`} data-testid="brand-page-availability">{verdict.label}</span>
          </div>
          {verdict.message && <p className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-300" data-testid="brand-page-availability-line">{verdict.message}</p>}
          <p className="mt-1 text-[11.5px] font-semibold text-amber-700 dark:text-amber-300">{ADDRESS_WARNING}</p>
          <Refusal text={error} testid="brand-page-address-refusal" />
          <div className="mt-2 flex gap-2">
            <button
              type="button" className={PRIMARY}
              disabled={busy || availability?.status !== 'ready' || !availability?.data?.available}
              onClick={() => onSave(availability.data.slug)}
            >
              {busy ? 'Saving…' : 'Save address'}
            </button>
            <button type="button" className={QUIET} onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

const LOADING = { status: 'loading' };

export default function BrandAddressPanel({ projectId, pages, onPagesChanged }) {
  const [site, setSite] = useState(LOADING);
  const [editing, setEditing] = useState(null); // 'site' | page id
  const [draft, setDraft] = useState('');
  const [availability, setAvailability] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setSite(LOADING);
    api.brandGetSite(projectId).then(
      (data) => setSite({ status: 'ready', data }),
      (e) => { reportError('BrandAddressPanel:site', e); setSite({ status: 'unreadable' }); },
    );
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const close = () => { setEditing(null); setDraft(''); setError(null); setAvailability(null); clearTimeout(timer.current); };

  // As-you-type check for a page's address, a beat after the last keystroke.
  const checkPage = (pageId, text) => {
    setDraft(text);
    setError(null);
    clearTimeout(timer.current);
    if (!String(text).trim()) { setAvailability(null); return; }
    setAvailability({ status: 'checking' });
    timer.current = setTimeout(() => {
      api.brandPageSlugAvailable(projectId, text, pageId).then(
        (data) => setAvailability({ status: 'ready', data }),
        (e) => { reportError('BrandAddressPanel:availability', e); setAvailability({ status: 'unreadable' }); },
      );
    }, 300);
  };

  const saveSite = async (slug) => {
    setBusy(true); setError(null);
    try {
      const data = await api.brandSetSiteSlug(projectId, slug);
      setSite({ status: 'ready', data });
      close();
    } catch (e) {
      setError(refusalLine(e, 'The address could not be saved. Nothing changed; try again.'));
    } finally { setBusy(false); }
  };

  const savePage = async (pageId, slug) => {
    setBusy(true); setError(null);
    try {
      await api.brandSetPageAddress(pageId, slug);
      close();
      await onPagesChanged?.();
    } catch (e) {
      setError(refusalLine(e, 'The page address could not be saved. Nothing changed; try again.'));
    } finally { setBusy(false); }
  };

  const siteSlug = site.status === 'ready' ? site.data?.slug : null;
  return (
    <section className={`${CARD} mb-6`} data-testid="brand-address-panel">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Globe size={13} aria-hidden="true" /> Address
      </div>
      <SiteAddressCard
        site={site} editing={editing === 'site'} draft={draft} error={editing === 'site' ? error : null} busy={busy}
        onEdit={() => { close(); setEditing('site'); setDraft(siteSlug || ''); }}
        onDraft={(v) => { setDraft(v); setError(null); }} onSave={saveSite} onCancel={close} onRetry={load}
      />
      {(pages || []).length > 0 && (
        <>
          <div className="mt-4 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300">Each page&apos;s own address</div>
          <ul className="mt-1.5 space-y-1.5">
            {pages.map((p) => (
              <PageAddressRow
                key={p.id} page={p} siteSlug={siteSlug} editing={editing === p.id} draft={draft}
                availability={editing === p.id ? availability : null} error={editing === p.id ? error : null} busy={busy}
                onEdit={() => { close(); setEditing(p.id); setDraft(p.page_slug || ''); }}
                onDraft={(v) => checkPage(p.id, v)} onSave={(slug) => savePage(p.id, slug)} onCancel={close}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
