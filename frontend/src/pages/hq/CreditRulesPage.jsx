import React, { useCallback, useEffect, useState } from 'react';
import { Coins, RefreshCw } from 'lucide-react';
import { creditRulesApi } from '../../lib/api/creditRules.js';
import { reportError } from '../../lib/log';
import {
  CREDITS_MAX, dayOf, editSummary, grantRule, grantState, grantWho, groupRules, reasonHint, reasonReady,
  refusalSentence, ruleEdit, ruleLine, usdOfCredits, creditsLabel,
} from '../../lib/creditRules';

/**
 * #1384 — HQ · Credits, at /hq/credits: the Super Admin's page for the credit
 * reward rules and the grants they paid (D540; manual lines since D608).
 * Reached from Platform, beside Promo codes, and lit under the Platform row.
 *
 *   Rules   every rule from `GET /api/admin/credit-rules`, the monthly bounty
 *           cap among them, grouped by kind. An edit changes the credits and
 *           on/off with a typed reason; the dollar value is shown and follows
 *           the credits (1 credit = US$1), so it is never an input.
 *   Grants  the newest 200 from `GET /api/admin/credit-rules/grants`: rule
 *           grants and manual lines, each with its revoke state. A revoke
 *           takes a reason; the Worker refuses one whose credits were spent,
 *           and the page says so in the Worker's words.
 *
 * A list that cannot be read says Unreadable with Retry, never an empty table.
 * Every write is the Worker's to refuse (`requireSuperAdmin`, the reason
 * floor, the credits bound); a refusal is shown as the sentence it carries.
 */

const BTN = {
  primary: 'rounded-[9px] bg-axal-violet px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50',
  quiet: 'rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12px] font-semibold text-axal-ink transition-colors hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
  danger: 'rounded-[9px] bg-red-700 px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50',
  dangerQuiet: 'rounded-[9px] border border-red-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40',
};
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink placeholder:text-axal-faint focus:outline-none focus:ring-2 focus:ring-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const CARD = 'rounded-xl border border-axal-hairline bg-white px-4 py-4 dark:border-gray-800 dark:bg-gray-900';

/** A list that could not be read: the word, what it is not, and Retry. */
export function UnreadableList({ what, testid, onRetry }) {
  return (
    <div role="alert" data-testid={testid} className="flex flex-col gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 dark:border-red-900 dark:bg-red-950/40">
      <span className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">Unreadable</span>
      <span className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">
        {what} could not be read. This is not an empty list.
      </span>
      <button type="button" onClick={onRetry} className="inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-red-700 underline dark:text-red-300">
        <RefreshCw size={12} aria-hidden="true" /> Retry
      </button>
    </div>
  );
}

function Refusal({ text, testid }) {
  if (!text) return null;
  return <p role="alert" data-testid={testid} className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">{text}</p>;
}

/** One rule's edit form: credits, on/off, the reason, and the line it would save. */
export function RuleEditor({ rule, busy, error, onCancel, onSave }) {
  const [credits, setCredits] = useState(String(rule.credits));
  const [active, setActive] = useState(!!rule.active);
  const [reason, setReason] = useState('');
  const edit = ruleEdit(rule, { credits, active, reason });
  const id = `credit-rule-${rule.key}`;
  return (
    <div data-testid="credit-rule-editor" className="mt-3 flex flex-col gap-2.5 rounded-xl border border-violet-200 px-4 py-3 dark:border-violet-900">
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={`${id}-credits`} className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
          Credits
          <input
            id={`${id}-credits`} inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value)}
            className={`${FIELD} w-32 tabular-nums`} aria-describedby={`${id}-value`}
          />
        </label>
        <span id={`${id}-value`} className="pb-2 text-[12px] text-axal-muted dark:text-gray-400" data-testid="credit-rule-value">
          {/^\d+$/.test(credits.trim()) ? `Worth ${usdOfCredits(Number(credits.trim()))}. 1 credit is US$1; the value follows the credits.` : `A whole number from 0 to ${CREDITS_MAX.toLocaleString('en-US')}.`}
        </span>
        <label className="flex items-center gap-2 pb-2 text-[12.5px] text-axal-ink dark:text-gray-100">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {rule.kind === 'cap' ? 'Apply the cap' : 'Rule on'}
        </label>
      </div>
      <label htmlFor={`${id}-reason`} className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
        Reason
        <textarea
          id={`${id}-reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD}
          placeholder="Why this changes. It is recorded in the admin audit log."
        />
      </label>
      <span className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="credit-rule-edit-line">
        {edit.ready ? editSummary(rule, edit.body) : edit.why}
      </span>
      <Refusal text={error} testid="credit-rule-refusal" />
      <div className="flex gap-2">
        <button type="button" className={BTN.primary} disabled={!edit.ready || busy} onClick={() => onSave(edit.body)}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={BTN.quiet} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/** The rules, grouped by kind, each with Edit. */
export function RulesSection({ read, editing, busy, error, onEdit, onCancel, onSave, onRetry }) {
  if (!read || read.status === 'loading') return <p className="text-[12.5px] text-axal-muted">Reading the rules…</p>;
  if (read.status !== 'ready') return <UnreadableList what="The credit rules" testid="credit-rules-unreadable" onRetry={onRetry} />;
  const groups = groupRules(read.data?.rules);
  if (!groups.length) {
    return (
      <p data-testid="credit-rules-none" className="text-[12.5px] leading-relaxed text-axal-muted">
        No reward rule is stored. Migration 381 seeds them; until it runs, nothing earns credits.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="credit-rules">
      {groups.map((g) => (
        <section key={g.kind} data-testid={`credit-rules-${g.kind}`}>
          <h3 className="text-[13px] font-bold text-axal-ink dark:text-white">{g.label}</h3>
          <p className="mt-0.5 text-[11.5px] text-axal-faint">{g.note}</p>
          <ul className="mt-2 space-y-1.5">
            {g.rules.map((r) => (
              <li key={r.key} className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 dark:border-gray-800 dark:bg-gray-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-[12px] font-bold text-axal-ink dark:text-gray-100">{r.key}</span>
                    <div className={`mt-0.5 text-[11.5px] tabular-nums ${r.active ? 'text-axal-muted dark:text-gray-400' : 'text-amber-800 dark:text-amber-300'}`} data-testid="credit-rule-line">
                      {ruleLine(r)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.updated_at && <span className="font-mono text-[10.5px] text-axal-faint">changed {dayOf(r.updated_at)}</span>}
                    {editing !== r.key && (
                      <button type="button" className={BTN.quiet} onClick={() => onEdit(r.key)} disabled={busy}>Edit</button>
                    )}
                  </div>
                </div>
                {editing === r.key && (
                  <RuleEditor key={r.key} rule={r} busy={busy} error={error} onCancel={onCancel} onSave={(body) => onSave(r, body)} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The confirm panel on the grant it would take back. */
export function RevokePanel({ grant, busy, error, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const hint = reasonHint(reason);
  const id = `credit-revoke-${grant.id}`;
  return (
    <div data-testid="credit-revoke-panel" className="mt-2 flex flex-col gap-2 rounded-xl border border-red-200 px-4 py-3 dark:border-red-900">
      <span className="text-[12.5px] text-axal-ink dark:text-gray-100">
        Take back {creditsLabel(grant.credits)} from {grantWho(grant)}. They are told, with the reason. If they have
        already spent the credits, it is refused rather than leaving a negative balance.
      </span>
      <label htmlFor={id} className="flex flex-col gap-1 text-[12px] font-semibold text-axal-ink dark:text-gray-100">
        Reason
        <textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD} placeholder="Why it is taken back. The member reads this." />
      </label>
      {hint && <span className="text-[12px] text-axal-muted dark:text-gray-400">{hint}</span>}
      <Refusal text={error} testid="credit-revoke-refusal" />
      <div className="flex gap-2">
        <button type="button" className={BTN.danger} disabled={!reasonReady(reason) || busy} onClick={() => onConfirm(reason.trim())}>
          {busy ? 'Revoking…' : 'Revoke'}
        </button>
        <button type="button" className={BTN.quiet} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

const STATE_CHIP = {
  standing: ['Paid', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'],
  revoked: ['Revoked', 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'],
  deducted: ['Deduction', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
};

/** The grants, newest first, each with its revoke state. */
export function GrantsSection({ read, revoking, busy, error, onRevoke, onCancel, onConfirm, onRetry }) {
  if (!read || read.status === 'loading') return <p className="text-[12.5px] text-axal-muted">Reading the grants…</p>;
  if (read.status !== 'ready') return <UnreadableList what="The grants" testid="credit-grants-unreadable" onRetry={onRetry} />;
  const grants = read.data?.grants || [];
  if (!grants.length) {
    return <p data-testid="credit-grants-none" className="text-[12.5px] leading-relaxed text-axal-muted">No credits have been granted yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="credit-grants">
      <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="credit-grants-count">
        {grants.length >= 200 ? 'The newest 200 grants. Older ones are not listed here.' : `${grants.length} ${grants.length === 1 ? 'grant' : 'grants'}`}
      </span>
      <ul className="space-y-1.5">
        {grants.map((g) => {
          const state = grantState(g);
          const [label, tone] = STATE_CHIP[state];
          return (
            <li key={g.id} data-testid="credit-grant" className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 dark:border-gray-800 dark:bg-gray-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">
                    {grantWho(g)} · <span className="tabular-nums">{Number(g.credits) > 0 ? '+' : ''}{creditsLabel(g.credits)}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-axal-faint">
                    {grantRule(g)} · {dayOf(g.created_at)}{g.note ? ` · ${g.note}` : ''}
                  </div>
                  {state === 'revoked' && (
                    <div className="mt-0.5 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="credit-grant-revoked">
                      Revoked {dayOf(g.revoked_at)}{g.revoke_reason ? `: “${g.revoke_reason}”` : ''}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone}`}>{label}</span>
                  {state === 'standing' && revoking !== g.id && (
                    <button type="button" className={BTN.dangerQuiet} onClick={() => onRevoke(g.id)} disabled={busy}>Revoke</button>
                  )}
                </div>
              </div>
              {revoking === g.id && (
                <RevokePanel key={g.id} grant={g} busy={busy} error={error} onCancel={onCancel} onConfirm={(reason) => onConfirm(g, reason)} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const LOADING = { status: 'loading' };
const READY = (data) => ({ status: 'ready', data });
const UNREADABLE = { status: 'unreadable' };

export default function CreditRulesPage() {
  const [rules, setRules] = useState(LOADING);
  const [grants, setGrants] = useState(LOADING);
  const [editing, setEditing] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadRules = useCallback(() => {
    setRules(LOADING);
    creditRulesApi.rules().then(
      (data) => setRules(READY(data)),
      (e) => { reportError('hq-credit-rules', e); setRules(UNREADABLE); },
    );
  }, []);
  const loadGrants = useCallback(() => {
    setGrants(LOADING);
    creditRulesApi.grants().then(
      (data) => setGrants(READY(data)),
      (e) => { reportError('hq-credit-grants', e); setGrants(UNREADABLE); },
    );
  }, []);
  useEffect(() => { loadRules(); loadGrants(); }, [loadRules, loadGrants]);

  const close = () => { setEditing(null); setRevoking(null); setError(null); };

  const saveRule = async (rule, body) => {
    setBusy(true); setError(null);
    try {
      await creditRulesApi.updateRule(rule.key, body);
      close();
      setNotice(`${rule.key} saved: ${editSummary(rule, body)}`);
      loadRules();
    } catch (e) {
      setError(refusalSentence(e));
    } finally { setBusy(false); }
  };

  const revoke = async (grant, reason) => {
    setBusy(true); setError(null);
    try {
      const out = await creditRulesApi.revokeGrant(grant.id, reason);
      close();
      setNotice(out?.status === 'already_revoked'
        ? `That grant was already revoked. Nothing more was taken back from ${grantWho(grant)}.`
        : `${creditsLabel(grant.credits)} taken back from ${grantWho(grant)}.${out?.notified === false ? ' The inbox notice could not be sent.' : ''}`);
      loadGrants();
    } catch (e) {
      setError(refusalSentence(e));
    } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6" data-testid="hq-credits-page">
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Coins size={13} /> HQ · Platform · Credits
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Credit rules and grants</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
          Every credit amount lives here, never in code. 1 credit is US$1 of perk value, so a rule&apos;s value follows
          its credits. Each change and each revoke needs a reason of at least ten characters, recorded in the admin
          audit log.
        </p>
      </header>

      {notice && (
        <p role="status" data-testid="credit-notice" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </p>
      )}

      <section className={CARD}>
        <h2 className="mb-3 text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Rules</h2>
        <RulesSection
          read={rules} editing={editing} busy={busy} error={editing ? error : null}
          onEdit={(key) => { close(); setNotice(null); setEditing(key); }}
          onCancel={close} onSave={saveRule} onRetry={loadRules}
        />
      </section>

      <section className={CARD}>
        <h2 className="mb-3 text-[14.5px] font-extrabold tracking-tight text-axal-ink dark:text-white">Grants</h2>
        <GrantsSection
          read={grants} revoking={revoking} busy={busy} error={revoking ? error : null}
          onRevoke={(id) => { close(); setNotice(null); setRevoking(id); }}
          onCancel={close} onConfirm={revoke} onRetry={loadGrants}
        />
      </section>
    </main>
  );
}
