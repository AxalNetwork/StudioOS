import React, { useState } from 'react';
import { Unreadable } from '../../ui';
import { ASSISTANTS, MCP_SERVER_URL, grantRow } from './assistantSetup.js';

/**
 * D668 (#1498) — Connectors' "AI assistants" group: a setup card for each
 * assistant, all holding the one StudioOS server URL, and the grants list
 * (`GET /api/connectors/assistants`, #1496) with Revoke.
 *
 * Handed its read and `onRevoke`; it fetches nothing, so it renders from
 * fixtures until #1496's routes reach `main` (D527's drift rule).
 */

const TONE = 'rounded-axal-sm border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const SMALL = 'rounded-md border border-axal-hairline px-2.5 py-1 text-[12px] font-bold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';

export function CopyUrl({ url = MCP_SERVER_URL, copy = (t) => navigator.clipboard?.writeText(t) }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-gray-50 px-2 py-1 font-mono text-[12px] text-axal-ink dark:bg-gray-800 dark:text-gray-100" data-testid="assistant-server-url">{url}</code>
      <button type="button" className={SMALL} onClick={async () => { try { await copy(url); setDone(true); } catch { setDone(false); } }}>{done ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

export function SetupCard({ a, copy }) {
  return (
    <article className={`${TONE} flex flex-col gap-2.5 p-4`} data-testid={`assistant-card-${a.key}`}>
      <div>
        <h4 className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{a.name}</h4>
        <p className="text-[12px] text-axal-muted dark:text-gray-400">{a.by}</p>
      </div>
      <CopyUrl copy={copy} />
      <ol className="list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-axal-ink/90 dark:text-gray-300">
        {a.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {a.limits && <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid={`assistant-limits-${a.key}`}>{a.limits}</p>}
      <a href={a.doc} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">{a.name}’s instructions ↗</a>
    </article>
  );
}

export function GrantsList({ grants, status = 'ready', onRevoke, onRetry, initialConfirming = null }) {
  // Revoke asks first: the row's button only opens this confirm.
  const [confirming, setConfirming] = useState(initialConfirming);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  if (status === 'loading') return <div className={`${TONE} p-4 text-[13px] text-axal-muted dark:text-gray-400`}>Reading your assistants…</div>;
  if (status === 'unreadable') return <div className={`${TONE} p-4`} data-testid="assistant-grants-unreadable"><Unreadable what="Your connected assistants" claim="This is not a claim that none is connected." onRetry={onRetry} /></div>;
  const rows = (grants || []).map(grantRow);
  if (!rows.length) return <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="assistant-grants-empty">No assistant is connected yet.</p>;
  const revoke = async (id) => {
    setBusy(id); setError('');
    try { await onRevoke?.(id); setConfirming(null); } catch (e) { setError(e?.message || 'The grant could not be revoked.'); } finally { setBusy(null); }
  };
  const revokeCell = (r) => (confirming === r.id ? (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid={`assistant-revoke-confirm-${r.id}`}>
      <span className="text-[12px] text-axal-muted dark:text-gray-400">Revoke now? It stops at once.</span>
      <button type="button" className="rounded-md bg-red-700 px-2.5 py-1 text-[12px] font-bold text-white disabled:opacity-50" disabled={busy === r.id} onClick={() => revoke(r.id)} data-testid={`button-revoke-yes-${r.id}`}>Revoke</button>
      <button type="button" className={SMALL} onClick={() => setConfirming(null)}>Keep</button>
    </span>
  ) : (
    <button type="button" className={SMALL} onClick={() => setConfirming(r.id)} data-testid={`button-revoke-${r.id}`}>Revoke</button>
  ));
  return (
    <div className={`${TONE} min-w-0`}>
      {error && <p role="alert" className="px-4 pt-3 text-[12px] font-semibold text-red-700 dark:text-red-400">{error}</p>}
      {/* A phone gets one card per grant; a table would scroll the page sideways. */}
      <ul className="divide-y divide-axal-hairline sm:hidden dark:divide-gray-800" data-testid="assistant-grants-phone">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 px-4 py-3 text-[12.5px]">
            <div className="font-semibold text-axal-ink dark:text-gray-100">{r.client} <span className="font-mono text-[11.5px] font-normal text-axal-muted dark:text-gray-400">{r.host}</span></div>
            <div className="text-axal-ink/90 dark:text-gray-300">{r.companies}</div>
            <div className="text-axal-muted dark:text-gray-400">Connected {r.connected} · Last used {r.lastUsed}</div>
            <div>{revokeCell(r)}</div>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-left text-[12.5px] sm:table" data-testid="assistant-grants">
        <thead className="text-[11px] uppercase tracking-wide text-axal-faint">
          <tr><th className="px-4 py-2">Assistant</th><th className="px-4 py-2">Companies</th><th className="px-4 py-2">Connected</th><th className="px-4 py-2">Last used</th><th className="px-4 py-2"><span className="sr-only">Revoke</span></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-axal-hairline dark:border-gray-800" data-testid={`assistant-grant-${r.id}`}>
              <td className="px-4 py-2.5"><div className="font-semibold text-axal-ink dark:text-gray-100">{r.client}</div><div className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{r.host}</div></td>
              <td className="px-4 py-2.5 text-axal-ink/90 dark:text-gray-300">{r.companies}</td>
              <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{r.connected}</td>
              <td className="px-4 py-2.5 text-axal-muted dark:text-gray-400">{r.lastUsed}</td>
              <td className="px-4 py-2.5 text-right">{revokeCell(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AssistantsGroup({ grants, status, onRevoke, onRetry, copy }) {
  return (
    <section className="flex min-w-0 flex-col gap-3" id="ai-assistants" data-testid="connectors-section-AI assistants">
      <div>
        <h3 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">AI assistants</h3>
        <p className="text-[13px] text-axal-muted dark:text-gray-400">Add StudioOS to your own assistant to prepare and run interviews there, then review what it sends here. It can read your Validate context and submit interviews for your review; it cannot change a module.</p>
      </div>
      <h4 className="text-[12px] font-bold uppercase tracking-wide text-axal-faint">Connected</h4>
      <GrantsList grants={grants} status={status} onRevoke={onRevoke} onRetry={onRetry} />
      <h4 className="text-[12px] font-bold uppercase tracking-wide text-axal-faint">Set one up</h4>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {ASSISTANTS.map((a) => <SetupCard key={a.key} a={a} copy={copy} />)}
      </div>
    </section>
  );
}
