// Public credential verification — /verify/:token. Unauthenticated.
//
// This is the page a third party lands on from a shared credential link. It
// renders ONLY what GET /api/public/verify/:token returns, which is the
// public_* snapshot frozen at issuance plus lifecycle state. There is no
// authenticated fetch on this page and no admin surface reachable from it.
//
// Keyed on the credential's random public_token, not on its credential_id:
// the credential id embeds the graduate's user id, so keying here would let
// anyone enumerate graduates by walking that number.
//
// A revoked credential renders as REVOKED rather than 404. Someone checking a
// credential that was withdrawn needs to be told it was withdrawn — silently
// 404ing it looks identical to a typo, which is the wrong answer to
// "is this real?".
//
// For the same reason only a 404 says "No matching credential" (#9178). A 503,
// any other error or a network failure says verification is unavailable and
// offers a retry: calling a genuine credential unknown because the API was down
// is the same wrong answer.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, CloudOff, Loader2, RotateCw, ShieldOff } from 'lucide-react';
import { api } from '../lib/api';

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Only the API's own 404 means the token matches nothing. A network failure
// has no status, so it never reads as not found.
export function verifyFailureStatus(err) {
  return err?.status === 404 ? 'notfound' : 'unavailable';
}

export default function PublicCertificateVerifyPage() {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null });
    api.publicVerifyCertificate(token)
      .then((d) => alive && setState({ status: 'ready', data: d }))
      .catch((err) => alive && setState({ status: verifyFailureStatus(err), data: null }));
    return () => { alive = false; };
  }, [token, attempt]);

  const d = state.data;
  const verified = state.status === 'ready' && d?.verified;
  const revoked = state.status === 'ready' && d?.status === 'revoked';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-start justify-center px-4 py-16" data-testid="page-verify">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-400">Axal VC · Spin-Out Lab</div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50 mt-1">Credential verification</h1>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
          {state.status === 'loading' && (
            <div className="p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 size={15} className="animate-spin" /> Checking credential…
            </div>
          )}

          {state.status === 'notfound' && (
            <div className="p-8 text-center" data-testid="verify-notfound">
              <AlertTriangle size={26} className="mx-auto text-amber-500 mb-3" />
              <div className="text-base font-bold text-gray-900 dark:text-gray-50">No matching credential</div>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                This link does not correspond to a credential we can verify. Check the link is
                complete, or ask the holder to re-share it.
              </p>
            </div>
          )}

          {state.status === 'unavailable' && (
            <div className="p-8 text-center" data-testid="verify-unavailable" role="alert">
              <CloudOff size={26} className="mx-auto text-gray-400 mb-3" />
              <div className="text-base font-bold text-gray-900 dark:text-gray-50">Verification is temporarily unavailable, try again</div>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                We could not reach the credential registry, so this check has no answer yet.
                It does not mean the credential is invalid.
              </p>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 px-3.5 py-2 text-[13px] font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
                data-testid="verify-retry"
              >
                <RotateCw size={14} /> Try again
              </button>
            </div>
          )}

          {state.status === 'ready' && (
            <>
              <div className={`px-6 py-5 flex items-center gap-3 ${
                verified ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-rose-50 dark:bg-rose-950/30'
              }`}
              >
                {verified
                  ? <BadgeCheck size={22} className="text-emerald-600 dark:text-emerald-400 flex-none" />
                  : <ShieldOff size={22} className="text-rose-600 dark:text-rose-400 flex-none" />}
                <div>
                  <div className={`text-[15px] font-extrabold ${
                    verified ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'
                  }`}
                  >
                    {/* Only claim REVOCATION when the record actually says
                        revoked. Any other non-verified state is reported as
                        not-valid rather than asserting a withdrawal that did
                        not happen. */}
                    {verified ? 'Verified credential' : revoked ? 'Credential revoked' : 'Credential not valid'}
                  </div>
                  <div className="text-[12px] text-gray-600 dark:text-gray-400 mt-0.5">
                    {verified
                      ? 'Issued by Axal VC and valid at the time of this check.'
                      : revoked
                        ? `Withdrawn${d.revoked_at ? ` on ${fmt(d.revoked_at)}` : ''}. It should no longer be relied on.`
                        : 'This credential is not in a valid state and should not be relied on.'}
                  </div>
                </div>
              </div>

              <dl className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {[
                  ['Graduate', d.name],
                  ['Company', d.company],
                  ['Cohort', d.cohort],
                  ['Conferred', fmt(d.issued_on)],
                  ['Jurisdiction', d.jurisdiction],
                  ['Program length', d.program_days ? `${d.program_days} days` : null],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{k}</dt>
                    <dd className="text-[14px] font-semibold text-gray-900 dark:text-gray-50 mt-0.5">{v}</dd>
                  </div>
                ))}
                <div className="sm:col-span-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <dt className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Credential ID</dt>
                  <dd className="text-[13px] font-semibold tabular-nums text-gray-700 dark:text-gray-300 mt-0.5" data-testid="verify-credential-id">
                    {d.credential_id}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>

        <p className="text-center text-[12px] text-gray-400 dark:text-gray-500 mt-5">
          <Link to="/spinout-lab" className="font-semibold text-violet-700 dark:text-violet-300">Axal VC Spin-Out Lab</Link>
          {' '}— four weeks of execution, four gates that open on evidence, one cohort a month.
        </p>
      </div>
    </div>
  );
}
