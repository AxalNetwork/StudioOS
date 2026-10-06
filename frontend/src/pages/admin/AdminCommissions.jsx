import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { bpsPercent } from '../../lib/bps';
import { isSuperAdminUser } from '../../lib/shellRole';
import { Card, Pill, RailFrame, SectionLabel, Skeleton, Unreadable, Unrecorded, WorkerRail } from '../../ui';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import {
  COMMISSION_STATUS, PAYOUT_ACTIONS, PAYOUT_METHODS, PAYOUT_STATUS, PERIODS, RULE_LIMITS, TABLE_DEFAULT_CURRENCY,
  dayOf, filterCommissions, payoutActionsFor, payoutClaims, payoutDetails, personOf, ruleActive, ruleAmount,
  ruleChanges, ruleDraftOf, ruleEditInput, rulePaysText, sourceLabel, sourcesIn, statusOf, takeRateInput, destinationLine,
} from '../../lib/partnerEarnings';
import {
  ConfirmPanel, Money, Panel, PayoutMoney, RowTable, StatusPill, WriteNote, ghostButton, primaryButton,
} from '../partner/earnings/parts';

/**
 * Admin · Commissions and payouts — `/admin/commissions` (canvas
 * `pea-commissions`, D569).
 *
 * FOUR READS, EACH WITH ITS OWN STATES, and every one `requireAdmin` but the
 * last:
 *   `GET /network/admin/commission-rules`  the rules, with who last edited each
 *   `GET /network/admin/commissions`       every commission, newest 500
 *   `GET /network/admin/payouts`           the queue, newest 200
 *   `GET /admin/platform/take-rate`        super admin only (`requireSuperAdmin`)
 *
 * A RULE IS EDITED, NEVER CREATED. `PATCH /network/admin/commission-rules/:key`
 * (D572) changes what a seeded rule pays, its description and whether it is on,
 * and logs the values before and after. No route creates a rule, so the
 * canvas's "New rule" is drawn disabled, with the reason.
 *
 * A FAILED PAYOUT GIVES ITS COMMISSIONS BACK (D572), when the payout recorded
 * which it claimed. One requested before payouts recorded them gives none
 * back, and its confirmation says so before the click.
 *
 * THE TAKE RATE IS NOT A COMMISSION RATE. The canvas called it "applied to
 * every commission before the partner's share"; the route says, and the code
 * agrees, that it is the platform's take on advisory sessions. No commission
 * is computed with it. The card says so in those words.
 *
 * "PROCESS PAYOUT" MOVES NO MONEY. `action: 'complete'` sets the status and
 * records the admin; the Stripe call it once stood for is gone. The
 * confirmation says to pay it first, by the method the partner chose.
 */

/** The admin console's input: the steel of `ACCENT.admin` on focus. */
const ADMIN_INPUT = 'w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] '
  + 'focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-gray-700 dark:bg-gray-900';

const RULE_COLS = 'md:grid-cols-[minmax(0,1.3fr)_120px_130px_minmax(0,1.6fr)_80px_64px]';
const ALL_COLS = 'md:grid-cols-[minmax(0,1.5fr)_130px_150px_96px_104px_104px]';
const QUEUE_VIEWS = [
  { key: 'open', label: 'Open', statuses: ['requested', 'processing'] },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'failed', label: 'Failed', statuses: ['failed'] },
  { key: 'all', label: 'All', statuses: null },
];

/**
 * One rule's editor, stateless: the draft in, the route's checks made before
 * sending (`ruleEditInput`), then a confirmation of what changes from what to
 * what. Review stays off until the draft is valid and changes something.
 */
export function RuleEditor({ rule, stage = 'edit', draft, busy, onDraft, onReview, onConfirm, onCancel }) {
  const parsed = ruleEditInput(draft);
  const changes = parsed.body ? ruleChanges(rule, parsed.body) : [];
  if (stage === 'confirm' && parsed.body && changes.length) {
    return (
      <div className="border-t border-axal-hairline px-4 py-3 dark:border-gray-700">
        <ConfirmPanel
          testid="confirm-rule"
          accent="admin"
          title={`Change ${rule.rule_key}`}
          rows={changes.map(([k, from, to]) => [k, `${from} → ${to}`])}
          consequence="Milestones that fire after the change accrue under the rule as saved; a rule switched off accrues nothing. Commissions already accrued keep their amounts. The edit is logged with the values before and after."
          confirmLabel="Save rule"
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </div>
    );
  }
  const fixed = draft?.kind !== 'percentage';
  return (
    <div className="space-y-2.5 border-t border-axal-hairline px-4 py-3 dark:border-gray-700" data-testid="form-rule">
      <SectionLabel>Edit {rule.rule_key}</SectionLabel>
      <fieldset className="flex flex-wrap gap-4 text-[12.5px]">
        <legend className="sr-only">How the rule pays</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="rule-kind" checked={fixed} onChange={() => onDraft?.({ kind: 'fixed', value: '' })} data-testid="radio-rule-fixed" />
          A flat amount
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="rule-kind" checked={!fixed} onChange={() => onDraft?.({ kind: 'percentage', value: '' })} data-testid="radio-rule-percentage" />
          A share of the amount
        </label>
      </fieldset>
      <label className="block">
        <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{fixed ? `Amount (${TABLE_DEFAULT_CURRENCY})` : 'Share (%)'}</span>
        <input
          className={`mt-1 ${ADMIN_INPUT}`}
          inputMode="decimal" value={draft?.value ?? ''} onChange={(e) => onDraft?.({ value: e.target.value })} data-testid="input-rule-value"
        />
        <span className="mt-1 block text-[11px] text-axal-faint" data-testid="text-rule-check">
          {parsed.error
            || (changes.length ? `Pays ${changes.find(([k]) => k === 'Pays')?.[2] || rulePaysText(rule) || 'nothing'}.` : 'Nothing has changed yet.')}
        </span>
      </label>
      <label className="block">
        <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Description</span>
        <input
          className={`mt-1 ${ADMIN_INPUT}`}
          value={draft?.description ?? ''} maxLength={RULE_LIMITS.descriptionMax} onChange={(e) => onDraft?.({ description: e.target.value })} data-testid="input-rule-description"
        />
      </label>
      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={draft?.active !== false} onChange={(e) => onDraft?.({ active: e.target.checked })} data-testid="checkbox-rule-active" />
        Active: a milestone accrues a commission under this rule
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className={ghostButton} onClick={onCancel} data-testid="button-cancel-rule">Cancel</button>
        <button type="button" className={primaryButton('admin')} disabled={!parsed.body || !changes.length} onClick={onReview} data-testid="button-review-rule">Review</button>
      </div>
    </div>
  );
}

/**
 * The rules, as the route returns them, each with who last edited it, and the
 * editor for one. `editing` is the open edit — `{ key, stage, draft }` — and
 * `result` is the last write's outcome, `{ key, ok, text }`.
 */
export function RulesTable({ state, rows, onRetry, editing, busy, result, onEdit, onDraft, onReview, onConfirm, onCancel }) {
  let body;
  if (state === 'loading') body = <div className="p-4"><Skeleton.Table rows={3} cols={4} /></div>;
  else if (state === 'unreadable') {
    body = <div className="p-4"><Unreadable what="The commission rules" claim="This is not a claim that there are none." onRetry={onRetry} /></div>;
  } else {
    const open = editing ? rows.find((r) => r.rule_key === editing.key) : null;
    body = (
      <>
        <RowTable
          testid="table-rules"
          cols={RULE_COLS}
          head={['Key', 'Source', 'Amount', 'Description', 'Active', '']}
          empty={<p className="text-[12.5px] text-axal-muted" data-testid="empty-rules">No commission rule is stored, so no milestone accrues a commission.</p>}
          rows={rows.map((r) => {
            const amount = ruleAmount(r);
            const on = ruleActive(r);
            const edited = dayOf(r.updated_at);
            return {
              key: r.id ?? r.rule_key,
              testid: `row-rule-${r.rule_key}`,
              cells: [
                <span className="break-all font-semibold text-axal-ink dark:text-gray-100">{r.rule_key}</span>,
                sourceLabel(r.source_type) || <Unrecorded>Not recorded</Unrecorded>,
                amount ? (
                  <span className="whitespace-nowrap" title={amount.kind === 'fixed' ? `The rule stores no currency. A commission it accrues is written in the table default, ${TABLE_DEFAULT_CURRENCY}.` : 'A percentage of the amount the milestone carries.'}>
                    <span className="font-semibold tabular-nums">{amount.text}</span>{' '}
                    <span className="text-[10.5px] text-axal-faint">{amount.kind === 'fixed' ? `${amount.currency} · fixed` : 'of the amount'}</span>
                  </span>
                ) : <Unrecorded reason="The rule holds neither a fixed amount nor a percentage, so it accrues nothing.">Not recorded</Unrecorded>,
                <span className="flex flex-col">
                  {String(r.description ?? '').trim() ? <span className="text-axal-muted">{r.description}</span> : <Unrecorded>No description</Unrecorded>}
                  {edited ? (
                    <span className="text-[11px] text-axal-faint" data-testid={`text-rule-edited-${r.rule_key}`}>
                      Edited {edited}{String(r.updated_by_name ?? '').trim() ? ` by ${r.updated_by_name}` : ''}
                    </span>
                  ) : null}
                </span>,
                <Pill tone={on ? 'ok' : 'neutral'} data-testid={`pill-rule-active-${r.rule_key}`}>{on ? 'Active' : 'Off'}</Pill>,
                editing ? null : (
                  <button type="button" className={ghostButton} onClick={() => onEdit?.(r)} data-testid={`button-edit-rule-${r.rule_key}`}>Edit</button>
                ),
              ],
            };
          })}
        />
        {open ? (
          <RuleEditor
            rule={open}
            stage={editing.stage}
            draft={editing.draft}
            busy={busy}
            onDraft={onDraft}
            onReview={onReview}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : null}
        {result ? <div className="border-t border-axal-hairline px-4 py-2.5 dark:border-gray-700"><WriteNote note={{ ...result, text: `${result.key}: ${result.text}` }} testid="note-rule" /></div> : null}
      </>
    );
  }
  return (
    <Panel title="Commission rules" meta={state === 'ready' ? 'Every edit is logged with the values before and after' : null} testid="panel-rules">
      {body}
    </Panel>
  );
}

const SETTLEMENT = {
  none: 'Advisory charging is off, so no session is charged at this rate yet.',
  test: 'Advisory charging runs in Stripe test mode.',
  live: 'Advisory charging is live.',
};

/**
 * The HQ take rate, stateless. `allowed` is the super-admin elevation: without
 * it the route refuses, so the card does not ask and says why.
 *
 *   stage `view`     the rate, where it came from, and Edit
 *   stage `edit`     basis points in, the percentage it means beside them
 *   stage `confirm`  from what to what, and when it applies
 */
export function TakeRateCard({ allowed, state, data, stage = 'view', draft = '', busy, result, onEdit, onDraft, onReview, onConfirm, onCancel, onRetry }) {
  let body;
  if (!allowed) {
    body = (
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-axal-muted" data-testid="take-rate-withheld">
        <Unrecorded reason="GET /admin/platform/take-rate answers HQ's super admin only.">Super admin only</Unrecorded>
        {' '}The take-rate route answers HQ’s super admin alone, so this console does not ask it.
      </p>
    );
  } else if (state === 'loading') body = <div className="mt-2"><Skeleton.Text lines={2} /></div>;
  else if (state === 'unreadable') {
    body = <div className="mt-2"><Unreadable what="The take rate" claim="This is not a claim that none is set." onRetry={onRetry} /></div>;
  } else {
    const pct = bpsPercent(data?.bps);
    const changed = dayOf(data?.updated_at);
    const parsed = stage === 'view' ? null : takeRateInput(draft, data?.max_bps);
    body = (
      <>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          <span className="text-[28px] font-extrabold tabular-nums tracking-tight text-axal-ink dark:text-gray-100" data-testid="text-take-rate">
            {pct || <Unrecorded>Not recorded</Unrecorded>}
          </span>
          {stage === 'view' ? <button type="button" className={ghostButton} onClick={onEdit} data-testid="button-edit-take-rate">Edit</button> : null}
        </div>
        <p className="mt-1 text-[11.5px] text-axal-muted" data-testid="text-take-rate-source">
          {data?.source === 'setting'
            ? (changed ? `Set ${changed}${data?.updated_by ? ` by ${data.updated_by}` : ''}.` : 'A stored setting; when it was set is not recorded.')
            : 'The platform default: nobody has stored a rate.'}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-axal-muted" data-testid="text-take-rate-scope">
          The platform’s take on advisory sessions. No partner commission is computed with it: commissions come from the rules.
          {data?.note ? ` ${data.note}` : ''}
        </p>
        {SETTLEMENT[data?.settlement] ? <p className="mt-1 text-[12px] text-axal-muted">{SETTLEMENT[data.settlement]}</p> : null}
        {stage === 'edit' ? (
          <div className="mt-3 space-y-2" data-testid="form-take-rate">
            <label className="block">
              <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Basis points</span>
              <input
                className={`mt-1 ${ADMIN_INPUT}`}
                inputMode="numeric" value={draft} onChange={(e) => onDraft?.(e.target.value)} data-testid="input-take-rate-bps"
              />
              <span className="mt-1 block text-[11px] text-axal-faint">
                {parsed?.bps != null ? `${parsed.bps} basis points is ${bpsPercent(parsed.bps)}.` : (parsed?.error || '1500 is 15%. A percentage is not accepted: 15 would be 0.15%.')}
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className={ghostButton} onClick={onCancel}>Cancel</button>
              <button type="button" className={primaryButton('admin')} disabled={parsed?.bps == null} onClick={onReview} data-testid="button-review-take-rate">Review</button>
            </div>
          </div>
        ) : null}
        {stage === 'confirm' && parsed?.bps != null ? (
          <div className="mt-3">
            <ConfirmPanel
              testid="confirm-take-rate"
              accent="admin"
              title="Change the take rate"
              rows={[['From', pct || 'Not recorded'], ['To', bpsPercent(parsed.bps)]]}
              consequence="Sessions priced after the change use the new rate. Lines already recorded keep the rate they were stamped with."
              confirmLabel="Save rate"
              busy={busy}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          </div>
        ) : null}
      </>
    );
  }
  return (
    <Card padding="md" data-testid="card-take-rate">
      <SectionLabel>HQ take rate</SectionLabel>
      {body}
      <div className="mt-2"><WriteNote note={result} testid="note-take-rate" /></div>
    </Card>
  );
}

/** A payout method as it reads mid-sentence: "pay it by wire transfer", "by Stripe". */
const METHOD_PHRASE = { stripe: 'Stripe', wire: 'wire transfer', crypto: 'crypto' };

/** What each confirmation says will happen. */
function consequenceOf(action, payout) {
  const method = METHOD_PHRASE[payout?.payout_method] || 'the method the partner chose';
  if (action === 'complete') {
    return `Marks the payout Completed and records you as its processor. Nothing here sends money: pay it by ${method} yourself before you confirm.`;
  }
  if (action === 'process') return 'Marks the payout Processing and records you as its processor. The partner’s activity log says it is being processed.';
  const claims = payoutClaims(payout);
  let back;
  if (!claims) back = 'It was requested before payouts recorded their commissions, so none go back to Accrued: its commissions stay marked Paid.';
  else if (claims.length === 1) back = 'The commission it claimed goes back to Accrued, so the partner can request it again.';
  else back = `The ${claims.length} commissions it claimed go back to Accrued, so the partner can request them again.`;
  return `Marks the payout Failed with your reason, which the partner reads. ${back}`;
}

/**
 * The payout queue, stateless. `pending` is the one row whose confirmation is
 * open — `{ id, action, reason }` — and `result` is the last write's outcome,
 * shown on the row it was about, or above the list when that row has left the
 * view (a completed payout leaves Open the moment it is completed).
 */
export function PayoutQueue({ state, rows, view = 'open', pending, busy, result, onView, onAction, onReason, onConfirm, onCancel, onRetry }) {
  const current = QUEUE_VIEWS.find((v) => v.key === view) || QUEUE_VIEWS[0];
  const visible = current.statuses ? rows.filter((p) => current.statuses.includes(String(p?.status ?? '').toLowerCase())) : rows;
  const resultOnRow = Boolean(result) && state === 'ready' && visible.some((p) => String(p.id) === String(result.id));
  const lifted = result && !resultOnRow
    ? <div className="px-4 pt-3"><WriteNote note={{ ...result, text: `Payout #${result.id}: ${result.text}` }} testid="note-queue-lifted" /></div>
    : null;
  let body;
  if (state === 'loading') body = <div className="p-4"><Skeleton.Text lines={4} /></div>;
  else if (state === 'unreadable') {
    body = <div className="p-4"><Unreadable what="The payout queue" claim="This is not a claim that no payout is waiting." onRetry={onRetry} /></div>;
  } else if (!visible.length) {
    body = (
      <p className="px-4 py-4 text-[12.5px] text-axal-muted" data-testid="empty-queue">
        {view === 'open' ? 'No payouts are waiting.' : `No ${current.label.toLowerCase()} payout${view === 'all' ? '' : 's'}.`}
      </p>
    );
  } else {
    body = (
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="list-queue">
        {visible.map((p) => {
          const status = statusOf(PAYOUT_STATUS, p?.status);
          const method = PAYOUT_METHODS.find((m) => m.value === p?.payout_method)?.label || String(p?.payout_method || '').trim();
          const details = payoutDetails(p?.payout_details);
          const requested = dayOf(p?.created_at);
          const completed = dayOf(p?.completed_at);
          const failed = dayOf(p?.failed_at);
          const processed = dayOf(p?.processed_at);
          const actions = payoutActionsFor(status.key);
          const open = pending && String(pending.id) === String(p.id);
          return (
            <li key={p.id} className="space-y-1.5 px-4 py-3" data-testid={`row-queue-${p.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[13px]">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-axal-ink dark:text-gray-100">{personOf(p) || <Unrecorded>Partner not recorded</Unrecorded>}</span>
                  <PayoutMoney payout={p} />
                  {method ? <span className="text-axal-muted">{method}</span> : <Unrecorded>Method not recorded</Unrecorded>}
                  {destinationLine(p)
                    ? <span className="text-axal-muted" data-testid={`text-queue-dest-${p.id}`}>to {destinationLine(p)}</span>
                    : <Unrecorded reason="The partner named no destination, or requested before destinations were stored. Confirm where with them.">destination not named</Unrecorded>}
                  <StatusPill status={status} />
                  <span className="text-[11.5px] tabular-nums text-axal-faint">{requested ? `requested ${requested}` : 'request date not recorded'}</span>
                </span>
                {!open && actions.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {actions.map((a) => (
                      <button
                        key={a.action}
                        type="button"
                        className={a.action === 'complete' ? primaryButton('admin') : ghostButton}
                        onClick={() => onAction?.(p.id, a.action)}
                        data-testid={`button-${a.action}-${p.id}`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
              {status.key === 'completed' ? (
                <p className="text-[12px] text-axal-muted">Completed {completed || <Unrecorded>on a day not recorded</Unrecorded>}</p>
              ) : null}
              {status.key === 'failed' ? (
                <p className="text-[12px] text-red-700 dark:text-red-300" data-testid={`text-queue-reason-${p.id}`}>
                  {String(p?.failure_reason ?? '').trim() || <Unrecorded>No reason recorded</Unrecorded>}
                  <span className="text-axal-muted">
                    {' · '}{failed ? `failed ${failed}` : <Unrecorded reason="Failed before payouts recorded the day they failed.">the day it failed is not recorded</Unrecorded>}
                  </span>
                </p>
              ) : null}
              {p?.processed_by != null ? (
                <p className="text-[12px] text-axal-muted" data-testid={`text-processed-by-${p.id}`}>
                  {'Recorded by '}
                  {String(p?.processed_by_name ?? '').trim()
                    || <Unrecorded reason="The account that recorded it has no name on file.">account #{p.processed_by}</Unrecorded>}
                  {processed ? ` on ${processed}` : null}
                </p>
              ) : (['completed', 'failed', 'processing'].includes(status.key)
                ? <p className="text-[12px]"><Unrecorded reason="This payout was moved before processing was recorded.">Processor not recorded</Unrecorded></p>
                : null)}
              {details ? (
                <p className="text-[11.5px] text-axal-muted">
                  {Array.isArray(details) ? details.map(([k, v]) => `${k === 'note' ? 'Note' : k}: ${v}`).join(' · ') : `Note: ${details}`}
                </p>
              ) : null}
              {open ? (
                <ConfirmPanel
                  testid={`confirm-${pending.action}`}
                  accent="admin"
                  danger={pending.action === 'fail'}
                  title={`${PAYOUT_ACTIONS[pending.action]?.label || 'Change payout'} · confirm`}
                  rows={[
                    ['Partner', personOf(p) || 'Not recorded'],
                    ['Amount', <PayoutMoney payout={p} />],
                    ['Method', method || 'Not recorded'],
                  ]}
                  consequence={consequenceOf(pending.action, p)}
                  confirmLabel={pending.action === 'complete' ? 'Confirm' : pending.action === 'fail' ? 'Mark failed' : 'Mark processing'}
                  busy={busy}
                  onConfirm={onConfirm}
                  onCancel={onCancel}
                >
                  {pending.action === 'fail' ? (
                    <label className="mt-2.5 block">
                      <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Reason</span>
                      <input
                        className={`mt-1 ${ADMIN_INPUT}`}
                        value={pending.reason || ''} maxLength={300} onChange={(e) => onReason?.(e.target.value)}
                        placeholder="For example: the bank returned the transfer" data-testid="input-fail-reason"
                      />
                    </label>
                  ) : null}
                </ConfirmPanel>
              ) : null}
              {result && String(result.id) === String(p.id) ? <WriteNote note={result} testid={`note-queue-${p.id}`} /> : null}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div>
      <ZoneToolbar
        role="admin"
        className="mb-3"
        filters={QUEUE_VIEWS.map((v) => (state === 'ready'
          ? { label: v.label, testid: `chip-queue-${v.key}`, active: v.key === view, onSelect: () => onView?.(v.key) }
          : { label: v.label, testid: `chip-queue-${v.key}`, disabled: true, title: 'The queue has not been read, so there is nothing to narrow.' }))}
      />
      <Panel title="Payout queue" meta={state === 'ready' ? `${visible.length} of ${rows.length} payout${rows.length === 1 ? '' : 's'}` : null} testid="panel-queue">
        {lifted}
        {body}
      </Panel>
    </div>
  );
}

/** Every commission, newest first, with its filters above it. */
export function AllCommissionsTable({ state, rows, total, onRetry, filters }) {
  let body;
  if (state === 'loading') body = <div className="p-4"><Skeleton.Table rows={5} cols={5} /></div>;
  else if (state === 'unreadable') {
    body = <div className="p-4"><Unreadable what="The commissions" claim="This is not a claim that none have accrued." onRetry={onRetry} /></div>;
  } else if (total === 0) {
    body = <p className="px-4 py-4 text-[12.5px] text-axal-muted" data-testid="empty-all-commissions">No commission has accrued to anyone yet.</p>;
  } else {
    body = (
      <RowTable
        testid="table-all-commissions"
        cols={ALL_COLS}
        head={['Partner', 'Source', 'Amount', 'Status', 'Accrued', 'Paid']}
        empty={<p className="text-[12.5px] text-axal-muted" data-testid="empty-all-filtered">No commission matches these filters.</p>}
        rows={rows.map((c) => {
          const status = statusOf(COMMISSION_STATUS, c?.status);
          const paid = dayOf(c?.paid_at);
          const accrued = dayOf(c?.created_at);
          return {
            key: c.id,
            testid: `row-all-commission-${c.id}`,
            cells: [
              <span className="flex flex-col">
                <span className="font-semibold text-axal-ink dark:text-gray-100">{personOf(c) || <Unrecorded>Not recorded</Unrecorded>}</span>
                {String(c?.description ?? '').trim() ? <span className="text-[11.5px] text-axal-muted">{c.description}</span> : null}
              </span>,
              sourceLabel(c?.source_type) ? <Pill tone="neutral">{sourceLabel(c.source_type)}</Pill> : <Unrecorded>Not recorded</Unrecorded>,
              <Money cents={c?.amount_cents} currency={c?.currency} />,
              <StatusPill status={status} />,
              accrued ? <span className="tabular-nums text-axal-muted">{accrued}</span> : <Unrecorded>Not recorded</Unrecorded>,
              status.key === 'paid'
                ? (paid ? <span className="tabular-nums text-axal-muted">{paid}</span> : <Unrecorded>Not recorded</Unrecorded>)
                : <Unrecorded reason="Accrued: no payout request has claimed it.">Not paid yet</Unrecorded>,
            ],
          };
        })}
      />
    );
  }
  return (
    <Panel
      title="All commissions"
      meta={state === 'ready' && total ? `${rows.length === total ? total : `${rows.length} of ${total}`}${total >= 500 ? ' · the newest 500 the route returns' : ''}` : null}
      testid="panel-all-commissions"
    >
      {filters}
      {body}
    </Panel>
  );
}

/** What a fail's response says came back: `commissions_reopened`, or `unlinked` for a payout from before D572. */
export function reopenedText(r) {
  if (r?.status !== 'failed') return '';
  if (r?.unlinked) return ' It was requested before payouts recorded their commissions, so none went back to Accrued.';
  const n = Number(r?.commissions_reopened);
  if (!Number.isFinite(n)) return '';
  return n === 1 ? ' 1 commission went back to Accrued.' : ` ${n} commissions went back to Accrued.`;
}

/** One read into one state: loading, then ready with the data or unreadable. */
function readInto(fn, set, shape = (d) => d) {
  set({ status: 'loading', data: null });
  return fn()
    .then((d) => set({ status: 'ready', data: shape(d) }))
    .catch(() => set({ status: 'unreadable', data: null }));
}
const asList = (d) => (Array.isArray(d) ? d : []);

export default function AdminCommissions({ user }) {
  const superAdmin = isSuperAdminUser(user);
  const [rules, setRules] = useState({ status: 'loading', data: null });
  const [all, setAll] = useState({ status: 'loading', data: null });
  const [queue, setQueue] = useState({ status: 'loading', data: null });
  const [take, setTake] = useState({ status: 'loading', data: null });
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [period, setPeriod] = useState('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('open');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [takeStage, setTakeStage] = useState('view');
  const [takeDraft, setTakeDraft] = useState('');
  const [takeBusy, setTakeBusy] = useState(false);
  const [takeResult, setTakeResult] = useState(null);
  const [ruleEdit, setRuleEdit] = useState(null);
  const [ruleBusy, setRuleBusy] = useState(false);
  const [ruleResult, setRuleResult] = useState(null);

  const loadRules = useCallback(() => readInto(() => api.adminCommissionRules(), setRules, asList), []);
  const loadAll = useCallback(() => readInto(() => api.adminCommissions(), setAll, asList), []);
  const loadQueue = useCallback(() => readInto(() => api.adminPayouts(), setQueue, asList), []);
  const loadTake = useCallback(() => readInto(() => api.hqTakeRate(), setTake), []);
  // D572 part 2: every read and write here is the Super Admin's on the
  // Worker, so a plain admin is told so, and nothing is fetched to be refused.
  useEffect(() => {
    if (!superAdmin) return;
    loadRules(); loadAll(); loadQueue(); loadTake();
  }, [loadRules, loadAll, loadQueue, loadTake, superAdmin]);

  const allRows = useMemo(() => asList(all.data), [all.data]);
  const queueRows = asList(queue.data);
  const ruleRows = asList(rules.data);
  const visible = useMemo(() => filterCommissions(allRows, { status, source, period, query }), [allRows, status, source, period, query]);
  const sources = useMemo(() => sourcesIn(allRows), [allRows]);

  const confirmPayout = async () => {
    if (!pending) return;
    const reason = String(pending.reason ?? '').trim();
    if (pending.action === 'fail' && !reason) {
      setResult({ id: pending.id, ok: false, text: 'Say why it failed: the partner reads the reason.' });
      return;
    }
    setBusy(true); setResult(null);
    try {
      const r = await api.adminProcessPayout(pending.id, pending.action === 'fail' ? { action: 'fail', failure_reason: reason } : { action: pending.action });
      const label = statusOf(PAYOUT_STATUS, r?.status).label;
      setResult({ id: pending.id, ok: true, text: r?.status ? `Marked ${label}.${reopenedText(r)}` : 'Saved.' });
      setPending(null);
      loadQueue();
    } catch (e) {
      setResult({ id: pending.id, ok: false, text: e?.message || 'The payout was not changed.' });
    } finally { setBusy(false); }
  };

  const saveRule = async () => {
    if (!ruleEdit) return;
    const parsed = ruleEditInput(ruleEdit.draft);
    if (!parsed.body) return;
    setRuleBusy(true); setRuleResult(null);
    try {
      await api.adminUpdateCommissionRule(ruleEdit.key, parsed.body);
      setRuleResult({ key: ruleEdit.key, ok: true, text: 'Saved. Milestones from now on accrue under the rule as saved.' });
      setRuleEdit(null);
      loadRules();
    } catch (e) {
      setRuleResult({ key: ruleEdit.key, ok: false, text: e?.message || 'The rule was not changed.' });
      setRuleEdit((r) => (r ? { ...r, stage: 'edit' } : r));
    } finally { setRuleBusy(false); }
  };

  const saveTake = async () => {
    const parsed = takeRateInput(takeDraft, take.data?.max_bps);
    if (parsed.bps == null) return;
    setTakeBusy(true); setTakeResult(null);
    try {
      const r = await api.setHqTakeRate(parsed.bps);
      setTakeResult({ ok: true, text: `Saved: ${bpsPercent(r?.bps ?? parsed.bps)}.${r?.applies_from ? ` ${r.applies_from}` : ''}` });
      setTakeStage('view');
      loadTake();
    } catch (e) {
      setTakeResult({ ok: false, text: e?.message || 'The rate was not changed.' });
      setTakeStage('edit');
    } finally { setTakeBusy(false); }
  };

  const coverage = [
    rules.status === 'ready' ? `${ruleRows.length} commission rule${ruleRows.length === 1 ? '' : 's'}` : null,
    all.status === 'ready' ? `${allRows.length} commission${allRows.length === 1 ? '' : 's'} read` : null,
    queue.status === 'ready' ? `${queueRows.length} payout${queueRows.length === 1 ? '' : 's'} in the queue read` : null,
  ].filter(Boolean);

  if (!superAdmin) {
    return (
      <div className="max-w-2xl" data-testid="admin-commissions-super-only">
        <h1 className="m-0 text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Commissions and payouts</h1>
        <Card padding="md" className="mt-3">
          <p className="text-[13px] leading-relaxed text-axal-muted dark:text-gray-400">
            Commission rules, every account's commissions and the payout queue are the Super Admin's. They cover every
            partner's earnings, an admin's own included, so a plain admin account cannot read or settle them.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Commissions"
          role="admin"
          stance="Stored records only"
          note="This rail reports what the console read. It processes no payout and changes no rate: each write happens on your confirmed click."
          coverage={coverage}
          coverageNote={coverage.length ? undefined : 'Nothing has been read yet, so there is nothing to report.'}
          unavailable={[
            ['Queue note', 'Eadwyn drafts no note on the queue yet: no draft surface reads payouts.'],
            ['New rules', 'No route creates a commission rule. The seeded rules can be edited.'],
          ]}
        />
      )}
      data-testid="admin-commissions"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="m-0 text-xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Commissions and payouts</h1>
        </div>
        <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-axal-muted dark:text-gray-400">
          The commission rules, every commission, the payout queue and the HQ take rate.
        </p>
        <ZoneToolbar
          role="admin"
          className="mb-3"
          actions={[{ label: 'New rule', testid: 'button-new-rule', disabled: true, title: 'No route creates a commission rule. The seeded rules can be edited.' }]}
        />
        <div className="space-y-3">
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <RulesTable
              state={rules.status}
              rows={ruleRows}
              onRetry={loadRules}
              editing={ruleEdit}
              busy={ruleBusy}
              result={ruleResult}
              onEdit={(r) => { setRuleResult(null); setRuleEdit({ key: r.rule_key, stage: 'edit', draft: ruleDraftOf(r) }); }}
              onDraft={(patch) => setRuleEdit((r) => (r ? { ...r, draft: { ...r.draft, ...patch } } : r))}
              onReview={() => setRuleEdit((r) => (r ? { ...r, stage: 'confirm' } : r))}
              onConfirm={saveRule}
              onCancel={() => setRuleEdit(null)}
            />
            <TakeRateCard
              allowed={superAdmin}
              state={take.status}
              data={take.data}
              stage={takeStage}
              draft={takeDraft}
              busy={takeBusy}
              result={takeResult}
              onRetry={loadTake}
              onEdit={() => { setTakeResult(null); setTakeDraft(String(take.data?.bps ?? '')); setTakeStage('edit'); }}
              onDraft={setTakeDraft}
              onReview={() => setTakeStage('confirm')}
              onConfirm={saveTake}
              onCancel={() => setTakeStage('view')}
            />
          </div>
          <PayoutQueue
            state={queue.status}
            rows={queueRows}
            view={view}
            pending={pending}
            busy={busy}
            result={result}
            onView={(v) => { setView(v); setPending(null); }}
            onAction={(id, action) => { setResult(null); setPending({ id, action, reason: '' }); }}
            onReason={(reason) => setPending((p) => (p ? { ...p, reason } : p))}
            onConfirm={confirmPayout}
            onCancel={() => setPending(null)}
            onRetry={loadQueue}
          />
          <AllCommissionsTable
            state={all.status}
            rows={visible}
            total={allRows.length}
            onRetry={loadAll}
            filters={all.status === 'ready' && allRows.length ? (
              <div className="grid gap-2 border-b border-axal-hairline px-4 py-3 sm:grid-cols-4 dark:border-gray-700">
                <label className="block sm:col-span-1">
                  <span className="sr-only">Search by partner or description</span>
                  <input className={ADMIN_INPUT} type="search" value={query} placeholder="Partner or description…"
                    onChange={(e) => setQuery(e.target.value)} data-testid="input-search-all" />
                </label>
                <label className="block">
                  <span className="sr-only">Source</span>
                  <select className={ADMIN_INPUT} value={source} onChange={(e) => setSource(e.target.value)} data-testid="select-all-source">
                    <option value="all">Every source</option>
                    {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">Status</span>
                  <select className={ADMIN_INPUT} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="select-all-status">
                    <option value="all">Every status</option>
                    {Object.entries(COMMISSION_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">Period</span>
                  <select className={ADMIN_INPUT} value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="select-all-period">
                    {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
          />
          <Card variant="sunken" padding="md">
            <SectionLabel tone="faint">What this console does not claim</SectionLabel>
            <div className="mt-1.5 max-w-2xl space-y-2 text-[12px] leading-relaxed text-axal-muted">
              <p><strong>Older payouts recorded less.</strong> A payout requested before payouts recorded their currency and their commissions shows no currency, and marking it failed returns none of its commissions to Accrued.</p>
              <p><strong>A failed payout is final.</strong> No route retries one or moves it again. Its commissions, once back in Accrued, go into the partner’s next request.</p>
              <p><strong>A rule is edited, not created.</strong> No route adds a commission rule, so the rules are the seeded ones.</p>
            </div>
          </Card>
        </div>
      </div>
    </RailFrame>
  );
}
