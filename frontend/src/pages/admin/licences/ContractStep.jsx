/**
 * #4707 — the HQ licence page's contracts. Moved out of `AdminLicences.jsx`
 * unchanged when the page was split by domain; the comments below are the
 * original ones.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Unrecorded } from '../../../ui';
import { Chip } from './licenceShared';

/* ------------------------------------------------------------------ *
 * H3 step 5 — Contract                                                 *
 * ------------------------------------------------------------------ */

/**
 * The licence agreement, instantiated from a master template at a version.
 *
 * TWO HONESTY STATES THIS STEP MUST KEEP. The library may hold no templates at
 * all, in which case there is nothing to instantiate and the step says so
 * rather than showing an empty picker; and a template may ask for a merge
 * field the licence cannot fill, in which case the placeholder is LEFT VISIBLE
 * and listed. A contract with a silently blanked clause reads as finished.
 */
export function ContractStep({ licence, onSaved }) {
  const [data, setData] = useState(null);
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    api.licenceContract(licence.uid)
      .then((d) => { setData(d); setSlug((s) => s || d.templates?.[0]?.slug || ''); })
      .catch((e) => { reportError('licence_contract_load_failed', e); setData(false); });
  }, [licence.uid]);
  useEffect(load, [load]);

  async function instantiate() {
    setBusy(true); setErr(null);
    try { await api.licenceContractCreate(licence.uid, slug); load(); onSaved?.(); }
    catch (e) { reportError('licence_contract_create_failed', e); setErr(e?.message || 'Could not instantiate.'); }
    finally { setBusy(false); }
  }

  if (data === false) return <p className="text-sm text-red-600">Could not load this licence&apos;s contracts.</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;

  const current = (data.contracts || []).find((k) => !k.superseded_at) || null;
  const superseded = (data.contracts || []).filter((k) => k.superseded_at);

  async function sendForSignature() {
    if (!current?.uid) return;
    setSendBusy(true); setErr(null);
    try {
      await api.licenceContractSend(licence.uid, current.uid);
      load();
      onSaved?.();
    } catch (e) {
      reportError('licence_contract_send_failed', e);
      setErr(e?.message || 'Could not send for signature.');
    } finally { setSendBusy(false); }
  }

  return (
    <div data-testid="licence-contract-step" className="space-y-4">
      {!data.contracts_available && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {data.contracts_reason}
        </p>
      )}

      {current ? (
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <div className="flex flex-wrap items-center gap-2">
            <FileText size={14} className="text-gray-500" />
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{current.template_title}</span>
            <Chip tone="bg-gray-100 text-gray-600 border-gray-200">v{current.template_version}</Chip>
            <Chip tone={current.status === 'signed'
              ? 'bg-green-50 text-green-700 border-green-200'
              : current.status === 'void'
                ? 'bg-gray-100 text-gray-600 border-gray-200'
                : 'bg-indigo-50 text-indigo-700 border-indigo-200'}>{current.status}</Chip>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Instantiated {String(current.created_at || '').slice(0, 10)} from{' '}
            <code>{current.template_slug}</code>
          </div>
          {current.unfilled_fields?.length > 0 && (
            <div data-testid="contract-unfilled" className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              This template asks for {current.unfilled_fields.length}{' '}
              {current.unfilled_fields.length === 1 ? 'value' : 'values'} the licence does not carry:{' '}
              {current.unfilled_fields.join(', ')}. They are left as placeholders in the text rather
              than blanked — a contract with an empty clause reads as finished.
            </div>
          )}
          {current.sent_at && (
            <p className="mt-1 text-xs text-gray-500">
              Sent {String(current.sent_at).slice(0, 10)}
              {current.signed_at ? ` · signed ${String(current.signed_at).slice(0, 10)}` : ''}
            </p>
          )}
          <p className="mt-2 text-[11px] text-gray-500">
            {current.status === 'signed'
              ? 'Executed on the envelope shown above. A pending signature still does not block activation; a territory conflict does.'
              : current.status === 'sent'
                ? 'Out for signature on the envelope linked to this contract. Activation is still not blocked by a pending signature.'
                : 'Draft — not sent for signature yet. A pending signature does not block activation; a territory conflict does.'}
          </p>
          <p className="mt-1 text-[11px] text-gray-500">
            HQ countersignature:{' '}
            {current.countersignature?.recorded
              ? 'Recorded.'
              : <Unrecorded reason={current.countersignature?.reason} />}
          </p>
          {current.status === 'draft' && !current.envelope_uid && data.contracts_available && (
            <button
              type="button"
              disabled={sendBusy}
              onClick={sendForSignature}
              className="mt-2 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-200 dark:hover:bg-gray-800"
              data-testid="licence-contract-send"
            >
              {sendBusy ? 'Sending…' : 'Send for signature'}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No contract has been instantiated for this licence.
        </p>
      )}

      {data.templates_reason ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">{data.templates_reason}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600 dark:text-gray-400">
            <span className="block">Master template</span>
            <select
              value={slug} onChange={(e) => setSlug(e.target.value)}
              className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              {data.templates.map((t) => (
                <option key={t.slug} value={t.slug}>{t.title} · v{t.version}</option>
              ))}
            </select>
          </label>
          <button
            type="button" disabled={busy || !slug || !data.contracts_available} onClick={instantiate}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {current ? 'Re-issue at current version' : 'Instantiate'}
          </button>
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {superseded.length > 0 && (
        <div className="text-xs text-gray-500">
          {superseded.length} superseded {superseded.length === 1 ? 'contract' : 'contracts'} kept:
          a re-issue supersedes, it never overwrites.
        </div>
      )}
    </div>
  );
}
