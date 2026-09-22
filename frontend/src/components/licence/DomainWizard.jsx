import React, { useState } from 'react';
import { Globe, Loader2, Copy, Check, RefreshCw, Trash2, Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

/**
 * S17–S19 — the custom host the licence's own admin binds (D197).
 *
 * WHY THIS IS THE TENANT'S SCREEN AND NOT HQ'S, in H26's own changelog: "An
 * earlier draft made Domain an HQ console. It is not: Super Admin stays on
 * axal.vc and app.axal.vc and binds nothing else." H31 says the same thing
 * from the other side — HQ's strip is status only, because the two records
 * live in the tenant's own zone and nobody but the tenant can publish them.
 *
 * THE ONE SENTENCE THIS SCREEN CANNOT DO WITHOUT is S17's: **a licence never
 * waits on DNS.** Members are on the platform host the deploy issued, before
 * this form is touched and during every minute of propagation, so nothing on
 * this page is blocking anybody. It is stated at the top rather than implied,
 * because a wizard with a pending state and no such sentence reads as an
 * outage.
 *
 * AND WHAT `verified` DOES NOT MEAN is stated by the server, not by this file.
 * `serves_reason` rides the payload (`services/licenceDomain.ts`), so the
 * tenant's screen and HQ's strip say the same thing about the same row rather
 * than each wording it. Reaching *Active* needs a Cloudflare for SaaS custom
 * hostname on a zone this platform has no groundwork for; the state is NAMED
 * with the credential it needs and never claimed.
 *
 * NO CONTROL IS DRAWN THAT THE SERVER COULD ONLY REFUSE — the `still_an_admin`
 * rule (D134). A detached host offers no Check and no Remove, because Super
 * Admin took it away and both would 409; what it offers is the sentence saying
 * so and the reason HQ typed.
 */

/** The per-record verdict's two failure kinds, which are NOT the same claim. */
function RecordVerdict({ verdict }) {
  const tone = verdict.ok
    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
    : verdict.readable
      ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
      // UNREADABLE IS NOT "NOT PUBLISHED". A resolver that did not answer says
      // nothing about the tenant's zone, and rendering it as a missing record
      // would send somebody to a registrar panel to fix a record that is fine.
      : 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40';
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`} data-testid={`domain-verdict-${verdict.kind}`}>
      <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">{verdict.title}</div>
      <div className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">{verdict.detail}</div>
    </div>
  );
}

/** One DNS row, with the value on a copy button rather than in a paragraph. */
function RecordCard({ record }) {
  const [copied, setCopied] = useState('');
  const copy = (what, value) => {
    navigator.clipboard.writeText(value).then(
      () => { setCopied(what); setTimeout(() => setCopied(''), 1600); },
      (e) => { reportError('DomainWizard:copy', e); setCopied('fail'); },
    );
  };
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid={`domain-record-${record.kind}`}>
      <div className="flex items-center gap-2">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[.06em] text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {record.type}
        </span>
        <span className="text-[11px] uppercase tracking-[.06em] text-gray-500 dark:text-gray-400">
          {record.kind === 'ownership' ? 'Proves the name is yours' : 'Sends traffic to us'}
        </span>
      </div>
      <dl className="mt-2 space-y-1.5">
        {[['Name', record.name], ['Value', record.value], ['TTL', String(record.ttl)]].map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-2">
            <dt className="w-12 shrink-0 text-[11.5px] text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-gray-900 dark:text-gray-100">{value}</dd>
            {label !== 'TTL' && (
              <button
                type="button"
                onClick={() => copy(`${record.kind}-${label}`, value)}
                className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10.5px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {copied === `${record.kind}-${label}`
                  ? <Check size={11} className="inline" aria-hidden="true" />
                  : <Copy size={11} className="inline" aria-hidden="true" />}
                <span className="sr-only">Copy {label}</span>
              </button>
            )}
          </div>
        ))}
      </dl>
      {copied === 'fail' && (
        <p className="mt-1.5 text-[11px] text-rose-700 dark:text-rose-300">
          Your browser refused the clipboard — the value is above, and selecting it works.
        </p>
      )}
    </div>
  );
}

export default function DomainWizard({ domain, available, reason, onChanged }) {
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [check, setCheck] = useState(null);

  const run = (what, fn) => {
    if (busy) return;
    setBusy(what);
    setErr('');
    fn().then(
      (res) => { if (res && res.check) setCheck(res.check); onChanged?.(); },
      (e) => {
        reportError(`DomainWizard:${what}`, e);
        // THE SERVER'S OWN SENTENCE, NOT A GENERIC ONE. Every refusal in
        // `services/licenceDomain.ts` is written for somebody standing in a
        // registrar panel, and collapsing them into "Request failed" is the
        // whole thing that file exists not to do.
        setErr(e?.data?.error || e?.message || 'That did not go through, and nothing was changed.');
      },
    ).finally(() => setBusy(''));
  };

  // A REGISTER THAT COULD NOT BE READ IS NOT A LICENCE WITH NO HOST. The
  // server sends the two apart; showing the form here would invite somebody to
  // bind a host that may already be bound.
  if (available === false) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-600 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400"
        data-testid="domain-unreadable">
        {reason || 'The host register could not be read, so whether a host is bound is unknown rather than none.'}
      </div>
    );
  }

  const verdicts = check?.records || domain?.last_check?.records || null;

  return (
    <div data-testid="domain-wizard">
      {/* S17's load-bearing sentence, first and unconditional. */}
      <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400" data-testid="domain-never-waits">
        Members land on the platform host the deploy issued, and keep landing there while this is set
        up. Nothing below holds anyone up.
      </p>

      {err && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"
          data-testid="domain-error">
          {err}
        </p>
      )}

      {!domain && (
        <form
          className="mt-3"
          onSubmit={(e) => { e.preventDefault(); run('bind', () => api.myDomainBind(host)); }}
        >
          <label htmlFor="domain-host" className="block text-[12px] font-semibold text-gray-900 dark:text-gray-100">
            The hostname members will type
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id="domain-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="app.yourhost.com"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900"
            />
            <button
              type="submit"
              disabled={!host.trim() || busy === 'bind'}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
            >
              {busy === 'bind' ? <Loader2 size={13} className="inline animate-spin" aria-hidden="true" /> : 'Add host'}
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-gray-500 dark:text-gray-400">
            Host only — no scheme, no port, no path. One host per licence in this pass.
          </p>
        </form>
      )}

      {domain && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-[13px] font-semibold text-gray-900 dark:text-gray-100" data-testid="domain-hostname">
              {domain.hostname}
            </span>
            <span
              data-testid="domain-state"
              className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[.05em] ${
                domain.state === 'verified'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : domain.state === 'detached'
                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              }`}
            >
              {domain.state}
            </span>
          </div>

          {domain.state === 'detached' ? (
            /* NO CHECK AND NO REMOVE HERE, and that is the point rather than an
               omission: Super Admin detached this host, both writes 409, and a
               button that could only refuse is not drawn. */
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/30"
              data-testid="domain-detached">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-rose-800 dark:text-rose-300">
                <Lock size={12} aria-hidden="true" /> Super Admin detached this host
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-rose-800 dark:text-rose-300">
                {domain.detach_reason || 'No reason was recorded.'}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-400">
                Removing the record is Super Admin&rsquo;s to do. The host stays claimed until they
                release it, so nobody else can take it in the meantime.
              </p>
            </div>
          ) : (
            <>
              <ol className="space-y-1 text-[12px] text-gray-700 dark:text-gray-300" data-testid="domain-checklist">
                <li>1 · Add both records below at your registrar.</li>
                <li>2 · Leave the CNAME unproxied — the orange cloud off, if your registrar is Cloudflare.</li>
                <li>3 · Press Check now. Most registrars save instantly; some take five minutes.</li>
              </ol>

              <div className="grid gap-2 sm:grid-cols-2">
                {(domain.records || []).map((rec) => <RecordCard key={rec.kind} record={rec} />)}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => run('check', () => api.myDomainCheck())}
                  disabled={busy === 'check'}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40 dark:border-gray-700"
                  data-testid="domain-check-now"
                >
                  {busy === 'check'
                    ? <Loader2 size={13} className="inline animate-spin" aria-hidden="true" />
                    : <RefreshCw size={13} className="inline" aria-hidden="true" />}
                  {' '}Check now
                </button>
                <button
                  type="button"
                  onClick={() => run('remove', () => api.myDomainRemove())}
                  disabled={busy === 'remove'}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12.5px] text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400"
                  data-testid="domain-remove"
                >
                  <Trash2 size={13} className="inline" aria-hidden="true" /> Remove
                </button>
                {domain.last_checked_at && (
                  <span className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="domain-last-checked">
                    Last checked {String(domain.last_checked_at).replace('T', ' ').slice(0, 16)}
                  </span>
                )}
              </div>

              {verdicts && (
                <div className="space-y-2" data-testid="domain-verdicts">
                  {verdicts.map((v) => <RecordVerdict key={v.kind} verdict={v} />)}
                </div>
              )}

              {/* WHAT `verified` IS NOT, in the server's words. The tenant has
                  done everything asked of them and the host still does not
                  serve, so the missing piece is named rather than left as a
                  wait with no end. */}
              {domain.state === 'verified' && (
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11.5px] leading-relaxed text-gray-600 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400"
                  data-testid="domain-serves-reason">
                  {domain.serves_reason}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400" data-testid="domain-hq-note">
        <Globe size={11} className="mr-1 inline" aria-hidden="true" />
        Super Admin does not set a CNAME, a certificate or a fallback host on your behalf, and does
        not add a domain for you. The one thing they can do to this row is detach it, which takes a
        written reason you are sent.
      </p>
    </div>
  );
}
