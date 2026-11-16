/**
 * D4708 part 3 (#4708) — the Access workspace's two zones from the page's own reads, moved out of
 * `../SecurityPage.jsx`'s `SecurityConsole` unchanged: the sessions-and-access tiles above the
 * session list, and H7's data-access zone below it. The reads and the acts stay on the page.
 */
import React from 'react';
import { Unrecorded, Unreadable } from '../../../ui';
import { Stat, Zone } from './SecurityParts.jsx';
import { impersonationNote, num, UNAVAILABLE } from './securityShared.js';

/** The four tiles: active sessions, live support sessions, admins with MFA, failed sign-ins. */
export function AccessSummaryZone({ sessions, imp, mfa, withoutMfa, se }) {
  return (
    <Zone title="Sessions and access" sub="each act recorded with its reason">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat unread label="Active sessions" value={sessions?.available ? num(sessions.active) : null} note={sessions?.available ? `token under ${sessions.token_hours}h old, not revoked or signed out` : (sessions?.reason || 'unreadable')} />
        <Stat unread label="Live support sessions" value={imp?.available ? num(imp.active) : null} note={imp?.available ? impersonationNote(imp) : (imp?.reason || 'unreadable')} tone={imp?.available && imp.active ? 'text-red-700 dark:text-red-300' : 'text-axal-ink dark:text-white'} />
        <Stat unread label="Admins with MFA" value={mfa ? `${num(mfa.admins_with_mfa)} of ${num(mfa.admins_total)}` : null} note={withoutMfa === null ? 'unreadable' : withoutMfa > 0 ? `${num(withoutMfa)} without` : 'every admin enrolled'} tone={withoutMfa ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
        {/* D200 — this tile was `value={null}` under "no security_events".
            It reads the ledger now: refused sign-ins in the last 24
            hours, and its reason when the ledger could not be read. */}
        <Stat unread label="Failed sign-ins" value={se?.available ? num(se.failed_signins_24h) : null} note={se?.available ? 'refused in 24 hours, from security_events' : (se?.reason || 'unreadable')} tone={se?.available && se.failed_signins_24h ? 'text-amber-700 dark:text-amber-300' : 'text-axal-ink dark:text-white'} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-axal-muted">
        Each account can also revoke its own devices under Settings.
      </p>
    </Zone>
  );
}

/** H7's data-access zone: impersonations and exports, each half read on its own. */
export function DataAccessZone({ feed, access, onRetry }) {
  const loadFeed = onRetry;
  return (
    <>
      {/* H7's own zone. Not "what changed" — who read rows they do not
          own. The two halves are separate blocks so one unreadable store
          cannot make the other half look like the whole answer. */}
      <Zone title="Data access" sub="impersonations and exports">
        {feed === UNAVAILABLE && (
          <Unreadable
            what="The security ledger"
            claim="This is not a claim that nothing happened."
            onRetry={loadFeed}
          />
        )}
        {feed === null && <p className="text-[12px] text-axal-muted">Loading…</p>}
        {access && (
          <div className="grid gap-3 md:grid-cols-2" data-testid="hq-data-access">
            <div>
              <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted">
                Impersonations · {access.expiry_minutes}-minute limit
              </div>
              {access.impersonations.available ? (
                access.impersonations.items.length === 0
                  ? <p className="mt-1.5 text-[12px] text-axal-muted">No support session is on record.</p>
                  : (
                    <ul className="mt-1.5 space-y-1.5">
                      {access.impersonations.items.map((d) => (
                        <li
                          key={d.what + d.meta}
                          className={`rounded-lg border px-3 py-2 text-[11.5px] ${
                            d.live
                              ? 'border-red-200 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20'
                              : 'border-axal-hairline bg-axal-ground'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate font-semibold">{d.what}</span>
                            <span className={`shrink-0 font-mono text-[10px] ${d.overdue ? 'text-red-700 dark:text-red-300' : 'text-axal-muted'}`}>
                              {d.dur || <Unrecorded>clock unknown</Unrecorded>}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-axal-muted">{d.meta}</div>
                        </li>
                      ))}
                    </ul>
                  )
              ) : (
                <p className="mt-1.5 text-[12.5px] text-axal-muted"><Unrecorded /> — {access.impersonations.reason}</p>
              )}
            </div>
            <div>
              <div className="text-[9.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted">Exports</div>
              {access.exports.available ? (
                access.exports.items.length === 0
                  ? <p className="mt-1.5 text-[12px] text-axal-muted">No export is on record.</p>
                  : (
                    <ul className="mt-1.5 space-y-1.5">
                      {access.exports.items.map((d) => (
                        <li key={d.what + d.meta} className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[11.5px]">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate font-semibold">{d.what}</span>
                            <span className="shrink-0 font-mono text-[10px] text-axal-muted">{d.dur}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-axal-muted">{d.meta}</div>
                        </li>
                      ))}
                    </ul>
                  )
              ) : (
                <p className="mt-1.5 text-[12.5px] text-axal-muted"><Unrecorded /> — {access.exports.reason}</p>
              )}
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-axal-muted">
          A session that ran to its limit is recorded exactly like one ended early — the log does not
          distinguish diligence from the clock running out, and it should not. A row still open past the
          limit reads <b>not closed</b>: the token expired on time, the closing write is best-effort, and
          &ldquo;0m left&rdquo; would say somebody is still inside.
        </p>
      </Zone>
    </>
  );
}
