import { aiBudgetApi } from '../../lib/api/aiBudget';
import { Card, Pill, Unrecorded, Unreadable } from '../../ui';
import { useAccountRead } from '../account/AccountCenter';
import { billingText, memberMonthView, modelsView, monthOf } from './hqAiModel';

/**
 * D776 PR 2 (#2093) — HQ › AI allowances' read-only cards, beside D642's
 * plans and held runs and D755's packs (`PlatformAllowancesPage.jsx`):
 *
 *   - How members are charged: the Worker's billing mode, and who sets it
 *     (the owner, through `AI_BILLING`, never this page);
 *   - Models offered: each model with its cost and billed price per unit,
 *     Paid only, New, and the pages whose matrix rows name it (D764);
 *   - This month's spend, inside One member's AI account: by page and option,
 *     and each run with its cost, charge and model. Read from
 *     `GET /ai-budget/members/:id/runs`, which the Worker audits.
 *
 * The canvas (`screens['hq-allowances']`) draws none of these three, so they
 * follow the board's own card pattern. Nothing here writes.
 */

const HEADER = 'border-b border-axal-hairline px-4 py-3 text-sm font-bold dark:border-gray-800';
const ROW = 'border-b border-axal-ground px-4 py-2.5 text-[12.5px] last:border-0 dark:border-gray-800';
const NOTE = 'text-[12px] leading-relaxed text-axal-muted dark:text-gray-400';
const SUB = 'border-b border-axal-ground bg-axal-ground/60 px-4 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400';

/** How members are charged, from the models read's billing mode. */
export function BillingCard({ models }) {
  const text = models.status === 'ready' ? billingText(models.data) : null;
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-billing-card">
      <div className={HEADER}>How members are charged</div>
      {models.status === 'loading' ? <p className="px-4 py-3 text-[12.5px] text-axal-muted">Reading the billing mode…</p>
        : !text ? <div className="px-4 py-3"><Unreadable what="The billing mode" claim="This is not a claim about how members are charged." onRetry={models.reload} /></div>
          : (
            <div className="flex flex-col gap-1.5 px-4 py-3">
              <p className="text-[15px] font-bold text-axal-ink dark:text-gray-100" data-testid="hq-billing-mode">{text}</p>
              <p className={NOTE} data-testid="hq-billing-set-by">Set by the owner through <span className="font-mono">AI_BILLING</span>, never on this page.</p>
              <p className={NOTE} data-testid="hq-billing-margin">HQ’s token margin counts token spend only. Allowance draws are already paid for by the plan’s price (D762).</p>
            </div>
          )}
    </Card>
  );
}

/** The models offered, each with its prices, its flags and the pages that name it. */
export function ModelsCard({ models, newIds }) {
  const rows = models.status === 'ready' ? modelsView(models.data, newIds) : null;
  return (
    <Card padding="none" className="overflow-hidden" data-testid="hq-models-card">
      <div className={HEADER}>Models offered</div>
      {models.status === 'loading' ? <p className="px-4 py-3 text-[12.5px] text-axal-muted">Reading the models…</p>
        : !rows ? <div className="px-4 py-3"><Unreadable what="The models" claim="This is not a claim that none is offered." onRetry={models.reload} /></div>
          : rows.length === 0 ? <p className={`${ROW} text-axal-muted`} data-testid="hq-models-none">No model is offered.</p>
            : rows.map((m) => (
              <div key={m.id} className={ROW} data-testid="hq-model-row">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{m.name}</span>
                  {m.kind && <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{m.kind}</span>}
                  {m.paidOnly && <Pill tone="warn" data-testid="hq-model-paid-only">Paid billing only</Pill>}
                  {m.isNew && <Pill tone="info" data-testid="hq-model-new">New</Pill>}
                </div>
                {m.prices.map((p) => (
                  <p key={p.unit} className="font-mono text-[11.5px]" data-testid="hq-model-price">cost {p.cost} · billed {p.billed ?? '—'} {p.unit}</p>
                ))}
                <p className="mt-0.5 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="hq-model-pages">
                  {m.pages.length ? `Named on ${m.pages.join(', ')}` : 'No page’s row names it.'}
                </p>
              </div>
            ))}
    </Card>
  );
}

/** One member's month, drawn inside One member's AI account once a member is found. */
export function MemberSpend({ memberId, api = aiBudgetApi }) {
  const month = monthOf();
  const read = useAccountRead(() => api.memberRuns(memberId, { month }));
  const v = read.status === 'ready' ? memberMonthView(read.data) : null;
  return (
    <div data-testid="hq-member-spend">
      <div className={SUB}>This month · {month}</div>
      {read.status === 'loading' ? <p className="px-4 py-2.5 text-[12.5px] text-axal-muted">Reading this member’s month…</p>
        : !v ? <div className="px-4 py-2"><Unreadable what="This member’s month" claim="This is not a claim that they ran nothing." onRetry={read.reload} /></div>
          : (
            <>
              <p className={`${ROW} font-mono`} data-testid="hq-member-spend-total">{v.total.runs} {v.total.runs === 1 ? 'run' : 'runs'} · charged {v.total.charged ?? 'not recorded'}</p>
              {v.pages.length === 0 ? <p className={`${ROW} text-axal-muted`} data-testid="hq-member-spend-none">No run this month.</p>
                : v.pages.map((p) => (
                  <div key={p.key} className={ROW} data-testid="hq-member-spend-page">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold">{p.noPage ? <Unrecorded reason="These runs recorded no page.">Not recorded</Unrecorded> : p.label}</span>
                      <span className="font-mono">{p.charged ?? 'Not recorded'}</span>
                    </div>
                    {p.options.map((o) => (
                      <div key={o.key} className="flex justify-between gap-2 pl-3 text-[12px] text-axal-muted dark:text-gray-400" data-testid="hq-member-spend-option">
                        <span>{o.noOption ? 'No option' : o.label} · {o.runs} {o.runs === 1 ? 'run' : 'runs'}</span>
                        <span className="font-mono">{o.charged ?? 'Not recorded'}</span>
                      </div>
                    ))}
                  </div>
                ))}
              {v.truncated && <p className={`${ROW} ${NOTE}`}>Only the 200 largest are shown.</p>}
              <div className={SUB}>Each run</div>
              {v.runs.length === 0 ? <p className={`${ROW} text-axal-muted`}>No run this month.</p>
                : v.runs.map((r) => (
                  <p key={r.id} className={`${ROW} font-mono text-[11.5px] ${r.guard ? 'pl-7 text-axal-muted dark:text-gray-400' : ''}`} data-testid="hq-member-run">
                    {r.when} · {r.guard ? 'Guard check' : r.model} · {r.page ?? 'no page'}{r.option ? ` · ${r.option}` : ''} · cost {r.cost ?? '—'} · charged {r.charged ?? 'not recorded'}
                  </p>
                ))}
              {v.runsTruncated && <p className={`${ROW} ${NOTE}`}>Only the 100 newest runs are listed.</p>}
            </>
          )}
    </div>
  );
}

/** The models read, shared by How members are charged and Models offered. */
export function useHqModels(api = aiBudgetApi) {
  return useAccountRead(() => api.models());
}
