import React, { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  StatCard, Section, Chip, SlideOver, Field, FilterChips, EmptyState,
} from './advisor/network/kit';
import {
  CAPITAL_ACCOUNTS, FEES, EXPENSES, STATEMENTS,
} from '../data/fundAnalytics';

const fmtMoney = (v) => (v == null ? '—' : `$${Number(v).toLocaleString()}`);
const fmtM = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtPct = (v) => `${Number(v || 0).toFixed(1)}%`;

const EXPENSE_TONE = {
  Legal: 'violet',
  Audit: 'blue',
  'Fund Admin': 'emerald',
  Tax: 'amber',
  Technology: 'gray',
  Travel: 'gray',
  Insurance: 'rose',
};
const EXPENSE_STATUS_TONE = { Paid: 'emerald', Pending: 'amber', Approved: 'blue' };
const STATEMENT_STATUS_TONE = {
  Finalized: 'emerald', Reconciled: 'emerald', 'In Review': 'amber',
  'In Progress': 'blue', Draft: 'gray',
};

const AXIS = { fontSize: 11, fill: '#9ca3af' };
const tooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid rgba(148,163,184,0.35)',
  background: 'rgba(17,24,39,0.92)',
  color: '#f9fafb',
};

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="mb-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        {subtitle && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

export default function FundAccountingPage({ embedded = false }) {
  const [selectedLp, setSelectedLp] = useState(null);
  const [expenseFilter, setExpenseFilter] = useState('all');

  const totals = useMemo(() => CAPITAL_ACCOUNTS.reduce(
    (acc, a) => ({
      commitment: acc.commitment + a.commitment,
      contributed: acc.contributed + a.contributed,
      distributed: acc.distributed + a.distributed,
      unfunded: acc.unfunded + a.unfunded,
      nav: acc.nav + a.nav,
      ownershipPct: acc.ownershipPct + a.ownershipPct,
    }),
    { commitment: 0, contributed: 0, distributed: 0, unfunded: 0, nav: 0, ownershipPct: 0 },
  ), []);

  const feeTotals = useMemo(() => FEES.reduce(
    (acc, f) => ({
      managementFee: acc.managementFee + f.managementFee,
      carry: acc.carry + f.carry,
    }),
    { managementFee: 0, carry: 0 },
  ), []);

  const expenseCategories = useMemo(() => {
    const counts = EXPENSES.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + 1;
      return acc;
    }, {});
    return [
      { id: 'all', label: 'All', count: EXPENSES.length },
      ...Object.keys(counts).map((c) => ({ id: c, label: c, count: counts[c] })),
    ];
  }, []);

  const expenses = useMemo(
    () => (expenseFilter === 'all' ? EXPENSES : EXPENSES.filter((e) => e.category === expenseFilter)),
    [expenseFilter],
  );
  const expenseTotal = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);

  const content = (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Fund financials — LP capital accounts, management-fee & carry accruals, expense
        tracking and the financial-statement close / reconciliation register.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total commitments" value={fmtM(totals.commitment)} hint={`${CAPITAL_ACCOUNTS.length} LPs`} />
        <StatCard label="Contributed" value={fmtM(totals.contributed)} hint="Paid-in to date" />
        <StatCard label="Distributed" value={fmtM(totals.distributed)} hint="Returned to LPs" />
        <StatCard label="Unfunded" value={fmtM(totals.unfunded)} hint="Remaining commitment" />
      </div>

      {/* Capital accounts table */}
      <Section title="LP capital accounts">
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Limited Partner</th>
                <th className="text-right font-medium px-4 py-2.5">Commitment</th>
                <th className="text-right font-medium px-4 py-2.5">Contributed</th>
                <th className="text-right font-medium px-4 py-2.5">Distributed</th>
                <th className="text-right font-medium px-4 py-2.5">Unfunded</th>
                <th className="text-right font-medium px-4 py-2.5">NAV</th>
                <th className="text-right font-medium px-4 py-2.5">Ownership</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {CAPITAL_ACCOUNTS.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setSelectedLp(a)}
                  className="bg-white dark:bg-gray-900 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{a.lp}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(a.commitment)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(a.contributed)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(a.distributed)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(a.unfunded)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-gray-100">{fmtM(a.nav)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtPct(a.ownershipPct)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-xs text-violet-700 dark:text-violet-300">View</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 dark:bg-gray-900/60 font-semibold text-gray-900 dark:text-gray-100">
                <td className="px-4 py-2.5">Totals</td>
                <td className="px-4 py-2.5 text-right">{fmtM(totals.commitment)}</td>
                <td className="px-4 py-2.5 text-right">{fmtM(totals.contributed)}</td>
                <td className="px-4 py-2.5 text-right">{fmtM(totals.distributed)}</td>
                <td className="px-4 py-2.5 text-right">{fmtM(totals.unfunded)}</td>
                <td className="px-4 py-2.5 text-right">{fmtM(totals.nav)}</td>
                <td className="px-4 py-2.5 text-right">{fmtPct(totals.ownershipPct)}</td>
                <td className="px-4 py-2.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      {/* Management fee & carry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Management fee & carry">
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Period</th>
                  <th className="text-right font-medium px-4 py-2.5">Fee basis</th>
                  <th className="text-right font-medium px-4 py-2.5">Mgmt fee</th>
                  <th className="text-right font-medium px-4 py-2.5">Carry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {FEES.map((f) => (
                  <tr key={f.period} className="bg-white dark:bg-gray-900">
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{f.period}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(f.basis)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(f.managementFee)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">{fmtM(f.carry)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-900/60 font-semibold text-gray-900 dark:text-gray-100">
                  <td className="px-4 py-2.5" colSpan={2}>Totals</td>
                  <td className="px-4 py-2.5 text-right">{fmtM(feeTotals.managementFee)}</td>
                  <td className="px-4 py-2.5 text-right">{fmtM(feeTotals.carry)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>

        <ChartCard title="Fee & carry by period" subtitle="Management fee vs carried interest accrual.">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={FEES} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
              <XAxis dataKey="period" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={fmtM} width={48} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, n) => [fmtM(v), n === 'managementFee' ? 'Mgmt fee' : 'Carry']}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="managementFee" name="Mgmt fee" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              <Bar dataKey="carry" name="Carry" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Expense tracking */}
      <Section title="Fund expenses" action={<span className="text-xs text-gray-500 dark:text-gray-400">{fmtMoney(expenseTotal)} filtered</span>}>
        <div className="mb-3">
          <FilterChips options={expenseCategories} value={expenseFilter} onChange={setExpenseFilter} />
        </div>
        {expenses.length === 0 ? (
          <EmptyState>No expenses in this category.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Category</th>
                  <th className="text-left font-medium px-4 py-2.5">Vendor</th>
                  <th className="text-right font-medium px-4 py-2.5">Amount</th>
                  <th className="text-left font-medium px-4 py-2.5">Date</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {expenses.map((e) => (
                  <tr key={e.id} className="bg-white dark:bg-gray-900">
                    <td className="px-4 py-2.5">
                      <Chip tone={EXPENSE_TONE[e.category] || 'gray'}>{e.category}</Chip>
                    </td>
                    <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100">{e.vendor}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900 dark:text-gray-100">{fmtMoney(e.amount)}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{e.date}</td>
                    <td className="px-4 py-2.5">
                      <Chip tone={EXPENSE_STATUS_TONE[e.status] || 'gray'}>{e.status}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Financial statements / reconciliation */}
      <Section title="Financial statements & reconciliation">
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Period</th>
                <th className="text-left font-medium px-4 py-2.5">Document</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
                <th className="text-left font-medium px-4 py-2.5">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {STATEMENTS.map((s) => (
                <tr key={s.id} className="bg-white dark:bg-gray-900">
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{s.period}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{s.type}</td>
                  <td className="px-4 py-2.5">
                    <Chip tone={STATEMENT_STATUS_TONE[s.status] || 'gray'}>{s.status}</Chip>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{s.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Per-LP capital account slide-over */}
      <SlideOver
        open={!!selectedLp}
        onClose={() => setSelectedLp(null)}
        title={selectedLp?.lp}
        subtitle="LP capital account breakdown"
      >
        {selectedLp && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Commitment" value={fmtM(selectedLp.commitment)} />
              <StatCard label="Current NAV" value={fmtM(selectedLp.nav)} />
            </div>
            <Section title="Account detail">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Contributed">{fmtMoney(selectedLp.contributed)}</Field>
                <Field label="Distributed">{fmtMoney(selectedLp.distributed)}</Field>
                <Field label="Unfunded commitment">{fmtMoney(selectedLp.unfunded)}</Field>
                <Field label="Ownership">{fmtPct(selectedLp.ownershipPct)}</Field>
                <Field label="% called">
                  {fmtPct((selectedLp.contributed / selectedLp.commitment) * 100)}
                </Field>
                <Field label="DPI (account)">
                  {`${(selectedLp.distributed / selectedLp.contributed).toFixed(2)}x`}
                </Field>
                <Field label="Total value">
                  {fmtMoney(selectedLp.distributed + selectedLp.nav)}
                </Field>
                <Field label="TVPI (account)">
                  {`${((selectedLp.distributed + selectedLp.nav) / selectedLp.contributed).toFixed(2)}x`}
                </Field>
              </div>
            </Section>
            <Section title="Capital progression">
              <div className="space-y-2">
                {[
                  { label: 'Contributed', value: selectedLp.contributed, tone: 'bg-violet-500' },
                  { label: 'Distributed', value: selectedLp.distributed, tone: 'bg-emerald-500' },
                  { label: 'Unfunded', value: selectedLp.unfunded, tone: 'bg-amber-500' },
                ].map((row) => {
                  const pct = Math.round((row.value / selectedLp.commitment) * 100);
                  return (
                    <div key={row.label}>
                      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                        <span>{row.label}</span>
                        <span>{fmtMoney(row.value)} · {pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className={`h-full ${row.tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          </>
        )}
      </SlideOver>
    </div>
  );

  if (embedded) return content;
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Calculator className="w-6 h-6 text-violet-600" /> Fund Accounting
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Capital accounts, fees & carry, expenses and the statement close register.
        </p>
      </div>
      {content}
    </div>
  );
}
