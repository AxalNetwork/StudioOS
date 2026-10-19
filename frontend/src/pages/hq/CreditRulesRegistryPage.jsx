import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, RefreshCw } from 'lucide-react';
import { creditRulesApi } from '../../lib/api/creditRules.js';
import { reportError } from '../../lib/log';
import { CREDIT_RULES_LINE } from './tokenPacksModel';
import { Card, Unrecorded } from '../../ui';
import {
  GRANT_SOURCES, GRANT_STATES, REASON_MIN, RULE_KINDS, editHint, filterGrants, filterRules, grantState,
  grantStateText, kindLabel, kindNotesFor, pageOf, reasonReady, revokeNotice, ruleAmount, ruleChanges, ruleNotice,
  ruleUpdated, submitRevoke, submitRule, valueLine,
} from '../../lib/creditRulesRegistry.js';

/**
 * D638 (#1384) — HQ · Credit rules: the Super Admin's reward rules and the
 * grants paid under them (D540), with manual adjustments (D608).
 *
 * #1101's rule is that every credit amount "lives in one table that the
 * Super Admin can edit, never in code". The table and its routes existed
 * (routes/admin_credit_rules.ts) and no screen called them; this is that
 * screen. It draws the HQ canvas's registry pattern (`hq-contracts`,
 * `hq-credits`, design/canvases/integrated/ops-data.js):
 *
 *   - two registries, rules and grants, each with search, filters, a count
 *     and pages of 25;
 *   - a reason card for every write, with the 10-character floor the Worker
 *     enforces, and the Worker's refusals as sentences;
 *   - each list in four states: loading, empty, "Not recorded" with its
 *     reason on a cell nothing holds, and "Unreadable" with Try again. A list
 *     that could not be read is never drawn as an empty table.
 *
 * The dollar value is shown, not edited: 1 credit is US$1 (D540). The monthly
 * bounty cap is a rule like the others and is listed with them. A revoke of
 * credits already spent is refused by the Worker, and the refusal is shown
 * as the Worker gives it (D638, #1103's third answer).
 */

const field = 'rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900';
const ghost = 'rounded-lg border border-axal-hairline px-2.5 py-1 text-[12px] font-semibold hover:bg-axal-ground dark:border-gray-700 dark:hover:bg-gray-800';
const primary = 'rounded-lg bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50';

/** A list that could not be read: said, with Try again, never an empty table. */
export function ReadFailed({ what, onRetry }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 py-6 text-[12.5px] text-red-700 dark:text-red-300" data-testid="credit-rules-unreadable">
      <span><strong>Unreadable.</strong> {what} could not be read just now. This is not a sign there are none.</span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline">
        <RefreshCw size={11} aria-hidden="true" /> Try again
      </button>
    </p>
  );
}

function Toolbar({ children, count }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {children}
      <span className="ml-auto font-mono text-[12px] text-axal-muted" data-testid="list-count">{count}</span>
    </div>
  );
}

function Pager({ at, onPage }) {
  if (at.pages <= 1) return null;
  return (
    <div className="mt-2 flex items-center justify-end gap-2 text-[12px]">
      <button type="button" className={ghost} disabled={at.page <= 1} onClick={() => onPage(at.page - 1)}>Previous</button>
      <span className="text-axal-muted">Page {at.page} of {at.pages}</span>
      <button type="button" className={ghost} disabled={at.page >= at.pages} onClick={() => onPage(at.page + 1)}>Next</button>
    </div>
  );
}

/** The reason card every write carries. Submit stays disabled until the reason is long enough. */
export function ReasonCard({ title, children, submitLabel, onSubmit, onCancel, busy, error, ready = true }) {
  const [reason, setReason] = useState('');
  const ok = reasonReady(reason);
  return (
    <form
      className="mt-2 rounded-xl border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-900"
      onSubmit={(e) => { e.preventDefault(); if (ok && ready) onSubmit(reason.trim()); }}
      data-testid="reason-card"
    >
      <p className="text-[12.5px] font-bold">{title}</p>
      {children}
      <label className="mt-2 block text-[12px] font-semibold">
        Reason
        <textarea
          value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          placeholder={`Why: at least ${REASON_MIN} characters, kept in the audit log`}
          className={`mt-1 block w-full ${field}`} data-testid="reason-input"
        />
      </label>
      <p className="mt-1 text-[11px] text-axal-muted">{ok ? 'Kept in the audit log with your name.' : `At least ${REASON_MIN} characters (${reason.trim().length} so far).`}</p>
      {error ? <p role="alert" className="mt-1 text-[12px] text-red-700 dark:text-red-300" data-testid="reason-card-error">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="submit" className={primary} disabled={!ok || !ready || busy}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** One rule's edit: its credits and its switch, never its dollar value. */
export function RuleForm({ rule, onSaved, onCancel, save = creditRulesApi.updateRule }) {
  const [credits, setCredits] = useState(String(rule.credits));
  const [active, setActive] = useState(Boolean(rule.active));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const planned = ruleChanges(rule, { credits, active });
  const submit = async (reason) => {
    setBusy(true); setError(null);
    const out = await submitRule(rule, { credits, active }, reason, save);
    setBusy(false);
    if (out.ok) { onSaved(out.rule, ruleNotice(rule, planned.changes)); return; }
    if (out.cause) reportError('CreditRules:update', out.cause);
    setError(out.error);
  };
  return (
    <ReasonCard title={`Change ${rule.key}`} submitLabel="Save rule" onSubmit={submit} onCancel={onCancel} busy={busy} error={error} ready={!planned.error}>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-[12px] font-semibold">
          Credits
          <input type="number" min="0" step="1" value={credits} onChange={(e) => setCredits(e.target.value)} className={`mt-1 block w-32 ${field}`} data-testid="rule-credits-input" />
        </label>
        <label className="flex items-center gap-2 text-[12px] font-semibold">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="rule-active-input" />
          {rule.kind === 'cap' ? 'Cap applies' : 'Rule pays'}
        </label>
        <span className="text-[11.5px] text-axal-muted" data-testid="rule-value">{valueLine(credits)}</span>
      </div>
      <p className="mt-1 text-[11.5px] text-axal-muted" data-testid="rule-form-hint">{editHint(rule, { credits, active })}</p>
    </ReasonCard>
  );
}

export function RulesTable({ read, onRetry, onSaved }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  let body;
  if (read.status === 'loading') body = <p role="status" className="py-6 text-[12.5px] text-axal-muted">Loading the rules…</p>;
  else if (read.status === 'unreadable') body = <ReadFailed what="The reward rules" onRetry={onRetry} />;
  const all = read.status === 'ready' ? read.data?.rules || [] : [];
  const at = pageOf(filterRules(all, { q, kind }), page);
  if (!body && all.length === 0) body = <p className="py-6 text-[12.5px] text-axal-muted" data-testid="rules-empty">No reward rule exists yet. The rules are created by migration 381.</p>;
  else if (!body && at.total === 0) {
    body = <p className="py-6 text-[12.5px] text-axal-muted" data-testid="rules-empty">No rule matches these filters. <button type="button" className="font-semibold underline" onClick={() => { setQ(''); setKind('all'); }}>Clear filters</button></p>;
  }
  return (
    <Card className="p-4" data-testid="credit-rules-table">
      <h2 className="text-[15px] font-bold">Reward rules</h2>
      <p className="mt-0.5 text-[12px] text-axal-muted">What each reward pays, and the monthly limit on bounties. Grants read the amount at the moment they pay.</p>
      {all.length ? (
        <dl className="mt-2 grid gap-x-3 gap-y-0.5 text-[11.5px] sm:grid-cols-[max-content_1fr]" data-testid="rule-kind-notes">
          {kindNotesFor(all).map((k) => (
            <React.Fragment key={k.kind}><dt className="font-semibold">{k.label}</dt><dd className="text-axal-muted">{k.note}</dd></React.Fragment>
          ))}
        </dl>
      ) : null}
      <Toolbar count={read.status === 'ready' ? at.count : ''}>
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search rules…" aria-label="Search rules" className={field} />
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Kind" className={field}>
          {RULE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </Toolbar>
      {body || (
        <>
          <table className="mt-3 w-full text-left text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-axal-muted">
              <tr><th className="py-1">Rule</th><th>Kind</th><th>Amount</th><th>State</th><th>Last changed</th><th /></tr>
            </thead>
            <tbody>
              {at.rows.map((r) => {
                const upd = ruleUpdated(r);
                return (
                  <React.Fragment key={r.key}>
                    <tr className="border-t border-axal-hairline dark:border-gray-800" data-testid={`rule-row-${r.key}`}>
                      <td className="py-2 font-mono text-[12px]">{r.key}</td>
                      <td>{kindLabel(r.kind)}</td>
                      <td>{ruleAmount(r)}</td>
                      <td>{r.active ? (r.kind === 'cap' ? 'Applies' : 'Pays') : (r.kind === 'cap' ? 'Lifted' : 'Off')}</td>
                      <td>{upd.nr ? <Unrecorded reason={upd.reason} /> : upd.text}</td>
                      <td className="text-right"><button type="button" className={ghost} onClick={() => setEditing(editing === r.key ? null : r.key)}>Change</button></td>
                    </tr>
                    {editing === r.key ? (
                      <tr><td colSpan={6}>
                        <RuleForm rule={r} onCancel={() => setEditing(null)} onSaved={(rule, notice) => { setEditing(null); onSaved(rule, notice); }} />
                      </td></tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          <Pager at={at} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

/** Take one grant back. The Worker refuses it when the credits are spent. */
export function RevokeForm({ grant, onDone, onCancel, revoke = creditRulesApi.revokeGrant }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (reason) => {
    setBusy(true); setError(null);
    const out = await submitRevoke(grant, reason, revoke);
    setBusy(false);
    if (out.ok) { onDone(revokeNotice(grant, out.result)); return; }
    if (out.cause) reportError('CreditRules:revoke', out.cause);
    setError(out.error);
  };
  return (
    <ReasonCard title={`Take back ${grant.credits} credits from ${grant.email || `account #${grant.user_id}`}`} submitLabel="Take back" onSubmit={submit} onCancel={onCancel} busy={busy} error={error}>
      <p className="mt-1 text-[11.5px] text-axal-muted">The member is told, with your reason. Credits they have already spent cannot be taken back.</p>
    </ReasonCard>
  );
}

export function GrantsTable({ read, onRetry, onChanged }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [state, setState] = useState('all');
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState(null);
  let body;
  if (read.status === 'loading') body = <p role="status" className="py-6 text-[12.5px] text-axal-muted">Loading the grants…</p>;
  else if (read.status === 'unreadable') body = <ReadFailed what="The grants" onRetry={onRetry} />;
  const all = read.status === 'ready' ? read.data?.grants || [] : [];
  const at = pageOf(filterGrants(all, { q, source, state }), page);
  if (!body && all.length === 0) body = <p className="py-6 text-[12.5px] text-axal-muted" data-testid="grants-empty">No credit has been granted yet.</p>;
  else if (!body && at.total === 0) {
    body = <p className="py-6 text-[12.5px] text-axal-muted" data-testid="grants-empty">No grant matches these filters. <button type="button" className="font-semibold underline" onClick={() => { setQ(''); setSource('all'); setState('all'); }}>Clear filters</button></p>;
  }
  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };
  return (
    <Card className="p-4" data-testid="credit-grants-table">
      <h2 className="text-[15px] font-bold">Grants</h2>
      <p className="mt-0.5 text-[12px] text-axal-muted">Rule grants and manual adjustments, newest first (the latest 200).</p>
      <Toolbar count={read.status === 'ready' ? at.count : ''}>
        <input type="search" value={q} onChange={reset(setQ)} placeholder="Search by member, rule or source…" aria-label="Search grants" className={field} />
        <select value={source} onChange={reset(setSource)} aria-label="Source" className={field}>
          {GRANT_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={state} onChange={reset(setState)} aria-label="State" className={field}>
          {GRANT_STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Toolbar>
      {body || (
        <>
          <table className="mt-3 w-full text-left text-[12.5px]">
            <thead className="text-[11px] uppercase tracking-wide text-axal-muted">
              <tr><th className="py-1">When</th><th>Member</th><th>Change</th><th>Source</th><th>State</th><th /></tr>
            </thead>
            <tbody>
              {at.rows.map((g) => (
                <React.Fragment key={g.id}>
                  <tr className="border-t border-axal-hairline dark:border-gray-800" data-testid={`grant-row-${g.id}`}>
                    <td className="py-2 font-mono text-[12px]">{String(g.created_at || '').slice(0, 10)}</td>
                    <td>{g.email || <Unrecorded reason={`No email is on record for account #${g.user_id}.`} />}</td>
                    <td className="font-mono">{g.credits > 0 ? `+${g.credits}` : `−${Math.abs(g.credits)}`}</td>
                    <td>
                      {g.manual ? 'Manual adjustment' : <span className="font-mono text-[12px]">{g.rule_key}</span>}
                      {g.note ? <span className="block text-[11.5px] text-axal-muted">{g.note}</span> : null}
                    </td>
                    <td data-testid={`grant-state-${g.id}`}>{grantStateText(g)}</td>
                    <td className="text-right">
                      {grantState(g) === 'standing' && g.credits > 0
                        ? <button type="button" className={ghost} onClick={() => setRevoking(revoking === g.id ? null : g.id)}>Take back</button>
                        : null}
                    </td>
                  </tr>
                  {revoking === g.id ? (
                    <tr><td colSpan={6}>
                      <RevokeForm grant={g} onCancel={() => setRevoking(null)} onDone={(notice) => { setRevoking(null); onChanged(notice); }} />
                    </td></tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <Pager at={at} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

/** What the last save or take-back did, in a sentence. */
export function Notice({ text }) {
  if (!text) return null;
  return (
    <p role="status" data-testid="credit-notice" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
      {text}
    </p>
  );
}

function useRead(fn) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const load = useCallback(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    fn().then((data) => { if (live) setRead({ status: 'ready', data }); }, (e) => {
      reportError('CreditRules:read', e);
      if (live) setRead({ status: 'unreadable', data: null });
    });
    return () => { live = false; };
  }, [fn]);
  useEffect(() => load(), [load]);
  return [read, load, setRead];
}

export default function CreditRulesPage() {
  const [rules, reloadRules, setRules] = useRead(creditRulesApi.rules);
  const [grants, reloadGrants] = useRead(creditRulesApi.grants);
  const [notice, setNotice] = useState(null);
  const savedRule = (rule, said) => {
    setNotice(said || null);
    if (!rule) { reloadRules(); return; }
    setRules((r) => ({ ...r, data: { rules: (r.data?.rules || []).map((x) => (x.key === rule.key ? rule : x)) } }));
  };
  const grantsChanged = (said) => { setNotice(said || null); reloadGrants(); };
  return (
    <div className="space-y-4" data-testid="credit-rules-page">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Coins size={13} aria-hidden="true" /> HQ · Platform · Credits
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Credit rules</h1>
        <p className="mt-1 max-w-[720px] text-[13.5px] leading-relaxed text-axal-muted dark:text-gray-400">
          Every credit amount lives here, never in code. 1 credit = US$1 of perk value. Each change and each grant taken
          back is kept in the audit log with its reason.{' '}
          <Link to="/hq/review" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Review queue</Link>
        </p>
        <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-axal-muted dark:text-gray-400" data-testid="credit-rules-ai-tokens">
          {CREDIT_RULES_LINE}{' '}
          <Link to="/admin/platform/allowances" className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300">Open AI allowances</Link>
        </p>
      </header>
      <Notice text={notice} />
      <RulesTable read={rules} onRetry={reloadRules} onSaved={savedRule} />
      <GrantsTable read={grants} onRetry={reloadGrants} onChanged={grantsChanged} />
    </div>
  );
}
