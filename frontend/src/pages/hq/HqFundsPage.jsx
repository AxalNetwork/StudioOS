/**
 * HQ · Funds — canvas H24, "which branches run which funds" (D245).
 *
 * THE ROW USED TO OPEN THE SHARED /funds PRODUCT, which is where any admin
 * lands and which answers a different question: HQ's own fund operations —
 * capital calls, LPs, reports. H24's question is a registry read across
 * branches: which deployment operates a fund, under which GP entity, with how
 * much committed, and whether its last report period issued. So this page
 * reads `GET /api/admin/hq/funds` and links to /funds for HQ's own operations;
 * the shared product is unchanged and still reachable.
 *
 * WHICH BRANCH IS WHICH DATABASE. No fund table carries a branch, a licence or
 * a territory: a fund belongs to the branch whose database answered with it.
 * HQ's own funds are the row "HQ".
 *
 * THREE STATES PER BRANCH, NEVER A ZERO. A branch that answered is its funds;
 * one that did not is one Unreadable row, and one HQ has provisioned but has
 * no binding to is one Not deployed row. The band counts funds only from the
 * sources that answered, and the coverage says how many did — an unreadable
 * branch is a different fact from a branch with nothing committed, and it
 * never changes another row.
 *
 * NO CURRENCY AND NO TOTAL. No fund table records a currency, so a committed
 * figure is an amount with its currency stated as not recorded — no symbol is
 * drawn, because any symbol would be invented — and nothing sums across funds,
 * which would add euros to dollars. The payload carries both reasons.
 *
 * NOT BUILT: opening a branch's Funds console from a row. No branch read
 * renders a fund console, and the view-as overlay reads only a branch's
 * overview and accounts (D153). The page says so rather than drawing a link
 * that opens HQ's own product under a branch's name.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

const UNAVAILABLE = Symbol('unavailable');

const PILL = 'inline-block shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em]';
const READ_PILL = {
  ok: ['Readable', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'],
  unreadable: ['Unreadable', 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'],
  not_deployed: ['Not deployed', 'border border-axal-hairline bg-axal-ground text-axal-muted'],
};

/** H24's six columns, in the canvas's order. */
export const FUND_COLUMNS = ['Fund', 'Branch', 'GP entity', 'Committed', 'Last issued', 'Read'];

/**
 * A committed amount in the minor units it travels in, as a plain number with
 * two decimals and NO currency symbol: the currency is not recorded, so any
 * symbol would be a guess. Null when the fund records none.
 */
export function committedText(fund) {
  const minor = fund?.committed_minor;
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
  return (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The Last issued cell: the period and its date, "None issued" when the fund
 * has issued none, and null when the periods could not be read — which the
 * page draws as Unreadable, never as "none".
 */
export function issuedText(fund, periodsAvailable) {
  if (periodsAvailable === false || fund?.last_issued === undefined) return null;
  if (fund.last_issued === null) return 'None issued';
  const { period, issued_at: issuedAt } = fund.last_issued;
  return issuedAt ? `${period} · ${String(issuedAt).slice(0, 10)}` : String(period);
}

/**
 * One row per fund, and one row per branch that has no fund to list, with the
 * state that explains why. HQ first, then the branches in the order the Worker
 * sent them.
 */
export function fundRows(payload) {
  if (!payload) return [];
  const rows = [];
  const sources = [
    { ...(payload.hq || {}), code: 'hq', label: 'HQ' },
    ...(payload.branches || []).map((b) => ({ ...b, label: b.label || b.code })),
  ];
  for (const s of sources) {
    if (s.status === 'ok' && s.data) {
      const funds = Array.isArray(s.data.funds) ? s.data.funds : [];
      if (!funds.length) {
        rows.push({ key: `${s.code}:none`, kind: 'none', branch: s.label, code: s.code, read: 'ok' });
      }
      for (const f of funds) {
        rows.push({
          key: `${s.code}:${f.id}`, kind: 'fund', branch: s.label, code: s.code, read: 'ok',
          fund: f, periodsAvailable: s.data.periods_available !== false,
          periodsReason: s.data.periods_reason || null,
        });
      }
      if (s.data.complete === false) {
        rows.push({ key: `${s.code}:cut`, kind: 'cut', branch: s.label, code: s.code, read: 'ok' });
      }
    } else {
      rows.push({
        key: `${s.code}:${s.status || 'unreadable'}`,
        kind: s.status === 'not_deployed' ? 'not_deployed' : 'unreadable',
        branch: s.label, code: s.code,
        read: s.status === 'not_deployed' ? 'not_deployed' : 'unreadable',
        reason: s.reason || null,
      });
    }
  }
  return rows;
}

/**
 * The band, counted ONLY from the sources that answered: how many funds, and
 * across how many of them (HQ included, as the canvas counts it). The coverage
 * beside it is the branches' own: of N branches, M answered.
 */
export function fundsBand(payload) {
  if (!payload) return null;
  const answered = [
    ...(payload.hq?.status === 'ok' ? [payload.hq] : []),
    ...(payload.branches || []).filter((b) => b.status === 'ok'),
  ];
  const counts = answered.map((s) => (Array.isArray(s.data?.funds) ? s.data.funds.length : 0));
  const funds = counts.reduce((a, b) => a + b, 0);
  const holding = counts.filter((n) => n > 0).length;
  const cov = payload.branches_coverage || { total: 0, answered: 0 };
  return {
    funds,
    holding,
    line: `${funds} ${funds === 1 ? 'fund' : 'funds'} across ${holding} ${holding === 1 ? 'deployment' : 'deployments'}, HQ included`,
    coverage: `of ${cov.total} ${cov.total === 1 ? 'branch' : 'branches'}, ${cov.answered} answered`,
    complete: payload.hq?.status === 'ok' && cov.answered === cov.total,
  };
}

function ReadPill({ read }) {
  const [words, tone] = READ_PILL[read] || READ_PILL.unreadable;
  return <span className={`${PILL} ${tone}`}>{words}</span>;
}

/** The table, pure: it renders what it is given, so every state can be drawn by a test. */
export function FundsTable({ payload }) {
  const rows = fundRows(payload);
  return (
    <div className="overflow-x-auto" data-testid="hq-funds-table">
      <table className="w-full min-w-[640px] text-left text-[12px]">
        <thead>
          <tr className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
            {FUND_COLUMNS.map((c) => (
              <th key={c} className="px-2 py-1.5" scope="col">
                {c}
                {c === 'Committed' && <span className="block font-medium normal-case tracking-normal">currency not recorded</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if (r.kind === 'fund') {
              const committed = committedText(r.fund);
              const issued = issuedText(r.fund, r.periodsAvailable);
              return (
                <tr key={r.key} className="border-t border-axal-hairline" data-testid="hq-funds-row">
                  <td className="px-2 py-2">
                    <div className="font-semibold text-axal-ink dark:text-white">{r.fund.name}</div>
                    {r.fund.status && <div className="text-[10.5px] text-axal-faint">{r.fund.status}</div>}
                  </td>
                  <td className="px-2 py-2">{r.branch}</td>
                  <td className="px-2 py-2">
                    {r.fund.gp_entity || <Unrecorded reason="The fund records no GP entity." />}
                  </td>
                  <td className="px-2 py-2 tabular-nums" title={r.fund.committed_source ? `From ${r.fund.committed_source}` : undefined}>
                    {committed ?? <Unrecorded reason="Neither the fund size nor the legacy total commitment is set." />}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {issued ?? <span className="italic text-red-700 dark:text-red-300" title={r.periodsReason || undefined}>Unreadable</span>}
                  </td>
                  <td className="px-2 py-2"><ReadPill read="ok" /></td>
                </tr>
              );
            }
            const statement = {
              none: 'No fund on this deployment',
              cut: `The list stopped at its ceiling; more funds exist than one read returns`,
              unreadable: 'Unreadable',
              not_deployed: 'Not deployed',
            }[r.kind];
            const detail = {
              none: 'It answered, and holds no fund.',
              cut: 'The rows above are the first by name.',
              unreadable: `It did not answer, which is not a claim that it runs no fund. ${r.reason || ''}`.trim(),
              not_deployed: r.reason || 'HQ holds a deployment row for it and no binding to read it through.',
            }[r.kind];
            return (
              <tr key={r.key} className="border-t border-axal-hairline bg-axal-ground/60" data-testid={`hq-funds-row-${r.kind}`}>
                <td className="px-2 py-2 font-semibold text-axal-muted">{statement}</td>
                <td className="px-2 py-2">{r.branch}</td>
                <td className="px-2 py-2 text-[11px] leading-snug text-axal-muted" colSpan={3}>{detail}</td>
                <td className="px-2 py-2"><ReadPill read={r.read} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function HqFundsPage() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqFunds().then(setData, (e) => { reportError('hq-funds', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE;
  const band = ready ? fundsBand(data) : null;

  // ONE LINE PER READ THAT ANSWERED (D126): HQ's own table and the branches.
  const coverage = ready ? [
    ...(data.hq?.status === 'ok' ? [`HQ: ${data.hq.data.funds.length} ${data.hq.data.funds.length === 1 ? 'fund' : 'funds'} read`] : []),
    `Branches: ${band.coverage}`,
    `${band.line}`,
  ] : [];

  const rail = (
    <WorkerRail
      workspace="Funds"
      role="super_admin"
      stance="Reads which deployment runs which fund"
      note="This rail reads back what the page loaded: HQ's own funds and every branch's, each read on its own. It changes nothing."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === null ? 'Reading the funds…' : 'The funds registry could not be read, so there is nothing to read back.')}
      unavailable={[
        ['Currency', ready ? data.committed_unit?.reason : 'No fund table records a currency.'],
        ['A total committed', ready ? data.total?.reason : 'The currency of each figure is not recorded, so no sum is shown.'],
        ['Open in the branch', ready ? data.open_in_branch?.reason : 'Opening a branch’s Funds console from here is not built.'],
      ]}
      data-testid="hq-funds-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-funds-page">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#1e3a8a] px-4 py-2.5 text-white">
          <span className="text-[12.5px] font-bold">All deployments</span>
          <span className="text-[11px] opacity-80 tabular-nums" data-testid="hq-funds-band">
            {data === null ? '…' : !ready ? 'the funds registry could not be read' : `${band.line} · ${band.coverage}`}
          </span>
        </div>

        <header>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Landmark size={13} /> HQ · Funds
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Funds</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Which deployment runs which fund, under which GP entity, with how much committed, and whether its
            last report period issued. HQ&rsquo;s own funds are the row &ldquo;HQ&rdquo;; every branch is read over
            its own binding, and one that does not answer reads Unreadable without changing any other row.
          </p>
        </header>

        {data === UNAVAILABLE && (
          <Unreadable what="The funds registry" claim="This is not a claim that no deployment runs a fund." onRetry={load} />
        )}
        {data === null && <p className="text-[12.5px] text-axal-muted">Reading the funds…</p>}

        {ready && (
          <Card className="p-4">
            <FundsTable payload={data} />
            <p className="mt-3 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-funds-note">
              A deployment that cannot be read reads Unreadable, not zero: a fund that cannot be read is a different
              fact from a fund with nothing committed, and the other rows are unaffected. {data.committed_unit?.reason}{' '}
              {data.total?.reason}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-funds-open-in-branch">
              {data.open_in_branch?.reason}
            </p>
          </Card>
        )}

        <Card className="p-4">
          <p className="text-[12.5px] leading-relaxed text-axal-muted">
            HQ&rsquo;s own fund operations &mdash; capital calls, limited partners and reports &mdash; stay in the
            shared Funds product.
          </p>
          <Link
            to="/funds"
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-violet-700 underline dark:text-violet-300"
            data-testid="hq-funds-link-product"
          >
            Open HQ&rsquo;s fund operations
          </Link>
        </Card>
      </div>
      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
