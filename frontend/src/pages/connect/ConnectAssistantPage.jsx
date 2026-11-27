import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { assistantsApi } from '../../lib/api/assistants.js';
import BrandIcon from '../../ui/BrandIcon.jsx';
import { ASSISTANT_LIMITS, scopesOf, approveBody, canApprove, consentState, hostOf, safeRedirect } from './assistantConsentModel.js';

/**
 * D668 (#1498) — `/connect/assistant?request=:id`: a founder approves an AI
 * assistant (ChatGPT, Claude, Gemini, Grok or another MCP client) for the
 * companies they tick (D665, #1495). Drawn from the Connectors canvas's card,
 * scopes list and per-company ticks (`Connectors Page.dc.html`, D651).
 *
 * THIS VIEW READS AND SENDS NOTHING ITSELF. It is handed the read and two
 * callbacks, so every state renders from a fixture until #1496's routes reach
 * `main` and the page is mounted (the drift test refuses a client method with
 * no route). `onApprove` receives `approveBody(...)`; the caller follows the
 * Worker's `redirectTo` through `safeRedirect`.
 */

const CARD = 'w-full max-w-[560px] rounded-xl border border-axal-hairline bg-white p-6 dark:border-gray-800 dark:bg-gray-900';
const PRIMARY = 'rounded-lg bg-violet-700 px-4 py-2 text-[13px] font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600 dark:hover:bg-violet-500';
const SECONDARY = 'rounded-lg border border-axal-hairline px-4 py-2 text-[13px] font-bold text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';

function Shell({ children, testid, state }) {
  return (
    <main className="flex min-h-[70vh] items-start justify-center bg-gray-50 px-4 py-10 dark:bg-gray-950" data-testid={testid} data-state={state}>
      <div className={CARD}>{children}</div>
    </main>
  );
}

function Notice({ state, title, body, children }) {
  return (
    <Shell testid="assistant-consent" state={state}>
      <h1 className="text-[18px] font-extrabold text-axal-ink dark:text-gray-100">{title}</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">{body}</p>
      {children}
    </Shell>
  );
}

export function ConsentView({ request, error, loading = false, busy = false, sendError = '', onApprove, onDeny, initialTicked }) {
  const state = consentState({ request, error, loading });
  const [ticked, setTicked] = useState(() => new Set((initialTicked || []).map(String)));

  if (state === 'loading') return <Notice state={state} title="Connect an AI assistant" body="Reading the request…" />;
  if (state === 'off') return <Notice state={state} title="Not available yet" body="Connecting an AI assistant to StudioOS is not switched on yet. Nothing was connected." />;
  if (state === 'expired' || state === 'used') {
    return (
      <Notice state={state} title={state === 'expired' ? 'This request has expired' : 'This request was already used'}
        body="Start again from your assistant: add StudioOS there once more, and it will bring you back here. Nothing was connected." />
    );
  }
  if (state === 'unreadable') {
    return <Notice state={state} title="The request could not be read" body="Nothing was connected. This is not a claim that the request is invalid: try again from your assistant." />;
  }

  const name = String(request.client_name || '').trim();
  const host = hostOf(request);
  const toggle = (id) => setTicked((s) => { const n = new Set(s); const k = String(id); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <Shell testid="assistant-consent" state={state}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-axal-faint">Connect an AI assistant</p>
      <h1 className="mt-1 text-[18px] font-extrabold text-axal-ink dark:text-gray-100">
        {name ? <><span data-testid="consent-client-name">{name}</span> wants to connect to StudioOS</> : 'An assistant wants to connect to StudioOS'}
      </h1>
      {/* D687: the mark follows only the identity the Worker verified from the redirect URI (assistantIdentity.ts), never the self-declared client_name above. */}
      <p className="mt-2 flex items-center gap-1.5 text-[12px] font-bold text-amber-800 dark:text-amber-300" data-testid="consent-assistant-identity"><BrandIcon provider={verifiedAssistantKey(request.verified_assistant)} size={16} variant="bare" />{request.verified_assistant || 'Unverified assistant'}</p>
      <p className="mt-1 text-[12px] text-axal-muted dark:text-gray-400">Approving another company keeps your earlier connections.</p>
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/30" data-testid="consent-redirect-host">
        <div className="text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">It returns to</div>
        <div className="break-all font-mono text-[16px] font-bold text-axal-ink dark:text-gray-100">{host || 'Not recorded'}</div>
        <div className="mt-0.5 text-[12px] text-amber-900/80 dark:text-amber-200/80">An assistant names itself; this address is where the connection goes. Approve only if you recognise it.</div>
      </div>

      <h2 className="mt-5 text-[11px] font-bold uppercase tracking-wide text-axal-faint">It may</h2>
      <ul className="mt-1.5 space-y-1 text-[13.5px] text-axal-ink dark:text-gray-200" data-testid="consent-scopes">
        {scopesOf(request).map((s) => <li key={s} className="flex gap-2"><span aria-hidden="true" className="text-emerald-600">✓</span>{s}</li>)}
      </ul>
      <p className="mt-2 text-[13px] text-axal-muted dark:text-gray-400" data-testid="consent-limits">{ASSISTANT_LIMITS}</p>

      <h2 className="mt-5 text-[11px] font-bold uppercase tracking-wide text-axal-faint">For these companies</h2>
      {state === 'empty' ? (
        <p className="mt-1.5 text-[13px] text-axal-muted dark:text-gray-400" data-testid="consent-no-companies">
          You have no company you own, so there is nothing to connect it to. <Link to="/studio" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Go to your studio</Link>
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1" data-testid="consent-companies">
          {request.companies.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] text-axal-ink hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800">
                <input type="checkbox" checked={ticked.has(String(c.id))} onChange={() => toggle(c.id)} data-testid={`consent-company-${c.id}`} />
                {c.name || `Company #${c.id}`}
              </label>
            </li>
          ))}
        </ul>
      )}

      {sendError && <p role="alert" className="mt-3 text-[12.5px] font-semibold text-red-700 dark:text-red-400" data-testid="consent-error">{sendError}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" className={SECONDARY} disabled={busy} onClick={() => onDeny?.()} data-testid="button-consent-deny">Deny</button>
        {state === 'ready' && (
          <button type="button" className={PRIMARY} disabled={busy || !canApprove(request, ticked)} onClick={() => onApprove?.(approveBody(request, ticked))} data-testid="button-consent-approve">
            {busy ? 'Connecting…' : 'Approve'}
          </button>
        )}
      </div>
    </Shell>
  );
}

/**
 * The mounted page: reads `?request=`, answers it through `assistantsApi`, and
 * follows the Worker's `redirectTo` only when `safeRedirect` allows it. The
 * route itself sends a signed-out visitor to sign-in and back (`App.jsx`).
 */
// D687: the four identities assistantIdentity.ts verifies, to their keys. Anything else is the generic client.
const VERIFIED_KEY = Object.freeze({ ChatGPT: 'chatgpt', Claude: 'claude', Gemini: 'gemini', Grok: 'grok' });
export function verifiedAssistantKey(verified) {
  return typeof verified === 'string' && Object.hasOwn(VERIFIED_KEY, verified) ? VERIFIED_KEY[verified] : 'other';
}

export default function ConnectAssistantPage({ api = assistantsApi, go = (url) => window.location.assign(url) }) {
  const location = useLocation();
  const id = new URLSearchParams(location.search).get('request') || '';
  const [read, setRead] = useState({ loading: true });
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    let alive = true;
    api.consent(id).then(
      (request) => { if (alive) setRead({ request }); },
      (error) => { if (alive) setRead({ error: { status: error?.status ?? 0 } }); },
    );
    return () => { alive = false; };
  }, [api, id]);

  const answer = async (call) => {
    setBusy(true); setSendError('');
    try {
      const { redirectTo } = await call();
      const to = safeRedirect(redirectTo);
      if (!to) { setSendError('The assistant gave an address StudioOS will not send you to. Nothing more was done.'); return; }
      go(to);
    } catch (e) {
      // A request answered or lapsed meanwhile reads as its own state.
      if ([404, 409, 410].includes(e?.status)) setRead({ error: { status: e.status } });
      else setSendError(e?.message || 'That could not be sent. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <ConsentView
      request={read.request} error={read.error} loading={!!read.loading} busy={busy} sendError={sendError}
      onApprove={(body) => answer(() => api.approve(id, body.companies))}
      onDeny={() => answer(() => api.deny(id))}
    />
  );
}
