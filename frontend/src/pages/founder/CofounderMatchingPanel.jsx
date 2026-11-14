import React, { useCallback, useEffect, useState } from 'react';
import { Check, Circle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * D637 — co-founder matching controls (Ops canvas `sp-cofounder`), the
 * `cofounders` tab of `/build/team`. Laid out for a 390-wide phone first.
 *
 * - **Your listing:** Listed or Unlisted, with "Unlist me" (the profile stays,
 *   browse stops showing it) or "List me again".
 * - **Interest you sent:** each one, with "Withdraw interest".
 * - **Connections:** Waiting for both NDAs, Active or Closed; who has signed;
 *   the other person's name always (the NDA names them) and their email only
 *   once both have signed (D610 — the Worker withholds it until then).
 *
 * States: loading; empty; "Not recorded" for the withheld email, with its
 * reason; "Unreadable" with Try again. A failed read never draws an empty list.
 */

export const CONNECTION_STATUS = {
  pending_nda: { label: 'Waiting for both NDAs', tone: 'amber' },
  active: { label: 'Active', tone: 'ok' },
  closed: { label: 'Closed', tone: 'grey' },
};

const TONE = {
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  grey: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

const BTN = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800 sm:w-auto';

function Pill({ tone, children }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>{children}</span>;
}

/** What the email line says, from the connection the Worker returned. */
export function emailLine(conn) {
  const email = conn?.counterparty?.email;
  if (email) return { shown: true, text: email };
  if (conn?.status === 'closed') return { shown: false, text: 'Email: not shared. You did not both sign the NDA before it closed.' };
  return { shown: false, text: 'Email: shown once both NDAs are signed.' };
}

const day = (v) => {
  if (!v) return '';
  const d = new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

function Section({ title, children, testid }) {
  return (
    <section data-testid={testid} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** The panel from a finished read. Pure, so each state renders in a test. */
export function CofounderMatchingView({ read, busy = false, error = '', onRetry, onUnlist, onRelist, onWithdraw, onBrowse }) {
  if (read.kind === 'loading') {
    return <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="matching-loading">Loading your matching…</p>;
  }
  if (read.kind === 'unreadable') {
    return (
      <div data-testid="matching-unreadable" className="rounded-xl border border-dashed border-rose-300 p-4 dark:border-rose-800">
        <p className="text-sm text-rose-700 dark:text-rose-300">Matching could not be read just now.</p>
        {read.message ? <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{read.message}</p> : null}
        <button type="button" onClick={onRetry} className={`mt-3 inline-flex items-center justify-center gap-1 ${BTN}`}>
          <RefreshCw size={13} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }
  const { me, sent, connections } = read;
  return (
    <div className="space-y-3" data-testid="cofounder-matching">
      {error ? <p className="text-sm text-rose-700 dark:text-rose-300" data-testid="matching-error">{error}</p> : null}

      <Section title="Your listing" testid="matching-listing">
        {!me ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">You have no co-founder profile yet, so you are not listed.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Pill tone={me.listed ? 'ok' : 'grey'}>{me.listed ? 'Listed' : 'Unlisted'}</Pill>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {me.listed ? 'Founders browsing can see your profile and send interest.' : 'Your profile is kept, but nobody browsing can see it.'}
              </span>
            </div>
            {me.listed
              ? <button type="button" className={BTN} disabled={busy} onClick={onUnlist}>Unlist me</button>
              : <button type="button" className={BTN} disabled={busy} onClick={onRelist}>List me again</button>}
          </div>
        )}
      </Section>

      <Section title="Interest you sent" testid="matching-sent">
        {!sent.length ? (
          <div data-testid="matching-sent-empty">
            <p className="text-sm text-gray-600 dark:text-gray-400">You have not sent interest to anyone.</p>
            {onBrowse ? <button type="button" className={`mt-2 ${BTN}`} onClick={onBrowse}>Browse profiles</button> : null}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {sent.map((s) => (
              <li key={s.user_uid} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{s.name || 'Name not recorded'}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {s.looking_for ? `Looking for: ${s.looking_for}` : 'Looking for: not recorded'}
                    {s.sent_at ? ` · sent ${day(s.sent_at)}` : ''}
                    {!s.listed ? ' · no longer listed' : ''}
                    {s.connection_uid ? ' · mutual, see Connections' : ''}
                  </div>
                </div>
                <button type="button" className={BTN} disabled={busy} onClick={() => onWithdraw?.(s)}>Withdraw interest</button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Connections" testid="matching-connections">
        {!connections.length ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">No connection yet. One opens when interest is mutual.</p>
        ) : (
          <ul className="space-y-3">
            {connections.map((c) => {
              const st = CONNECTION_STATUS[c.status] || { label: c.status, tone: 'grey' };
              const email = emailLine(c);
              const other = c.counterparty?.name || 'The other founder';
              return (
                <li key={c.uid} data-testid={`connection-${c.uid}`} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{other}</span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-gray-700 dark:text-gray-300" aria-label="Who has signed the NDA">
                    {[['You', c.i_signed_at], [other, c.they_signed_at]].map(([who, at]) => (
                      <li key={who} className="flex items-center gap-1.5">
                        {at
                          ? <Check size={13} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                          : <Circle size={13} className="text-gray-400" aria-hidden="true" />}
                        {who} {at ? `signed ${day(at)}` : 'has not signed'}
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-2 text-xs ${email.shown ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`} data-testid={`connection-email-${c.uid}`}>
                    {email.shown ? <>Email: <a className="text-violet-700 underline dark:text-violet-300" href={`mailto:${email.text}`}>{email.text}</a></> : email.text}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default function CofounderMatchingPanel({ client = api, onBrowse }) {
  const [read, setRead] = useState({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRead((r) => (r.kind === 'ready' ? r : { kind: 'loading' }));
    try {
      const me = await client.cofounderMe().catch((e) => {
        if (e?.status === 404) return null; // no profile yet: a state, not a failure
        throw e;
      });
      const [sent, conns] = await Promise.all([client.cofounderSentInterests(), client.cofounderListConnections()]);
      setRead({
        kind: 'ready', me,
        sent: Array.isArray(sent?.items) ? sent.items : [],
        connections: Array.isArray(conns?.items) ? conns.items : [],
      });
    } catch (e) {
      setRead({ kind: 'unreadable', message: e?.message || '' });
    }
  }, [client]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e?.message || 'That did not save.'); } finally { setBusy(false); }
  };

  return (
    <CofounderMatchingView
      read={read} busy={busy} error={error} onRetry={load} onBrowse={onBrowse}
      onUnlist={() => act(() => client.cofounderUnlistMe())}
      onRelist={() => act(() => client.cofounderUpsertMe({ ...read.me, listed: true }))}
      onWithdraw={(s) => act(() => client.cofounderWithdrawInterest(s.user_uid))}
    />
  );
}
