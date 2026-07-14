import React, { useMemo, useState } from 'react';
import { Building2, FileText, Calendar } from 'lucide-react';
import {
  CONTRACTS, CONTRACT_TYPES, money, formatDay, formatRelativeDay, TODAY,
} from '../../../data/advisor/advisory';
import {
  FilterChips, StatCard, SlideOver, Field, StatusBadge,
  EmptyState, Chip,
} from './kit';

// Contracts — commercial documents across the advisory lifecycle (Proposals,
// SOWs, Advisory Agreements, NDAs, Invoices, Renewals). Filter by document
// type; each row opens a detail panel with statuses and key dates.

const TODAY_MS = new Date(TODAY).getTime();

export default function ContractsPage() {
  const [type, setType] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const filterOptions = useMemo(() => ([
    { id: 'all', label: 'All', count: CONTRACTS.length },
    ...CONTRACT_TYPES.map((t) => ({ id: t.id, label: t.label, count: CONTRACTS.filter((c) => c.docType === t.id).length })),
  ]), []);

  const visible = useMemo(
    () => CONTRACTS.filter((c) => type === 'all' || c.docType === type),
    [type],
  );

  const stats = useMemo(() => {
    const active = CONTRACTS.filter((c) => ['Active', 'Signed'].includes(c.status));
    const contractedValue = active.reduce((a, c) => a + (c.value || 0), 0);
    const pending = CONTRACTS.filter((c) => ['Awaiting signature', 'Under review', 'Sent', 'Upcoming'].includes(c.status)).length;
    const overdue = CONTRACTS.filter((c) => c.status === 'Overdue').length;
    return { contractedValue, pending, overdue };
  }, []);

  const selected = CONTRACTS.find((c) => c.id === selectedId) || null;
  const typeLabel = (id) => CONTRACT_TYPES.find((t) => t.id === id)?.label.replace(/s$/, '') || id;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Documents" value={CONTRACTS.length} hint="All commercial docs" />
        <StatCard label="Contracted value" value={money(stats.contractedValue)} hint="Active + signed" />
        <StatCard label="Pending" value={stats.pending} hint="Awaiting action" />
        <StatCard label="Overdue" value={stats.overdue} hint="Needs attention" />
      </div>

      <FilterChips options={filterOptions} value={type} onChange={setType} />

      {visible.length === 0 ? (
        <EmptyState>No documents of this type.</EmptyState>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="w-full text-left flex items-center gap-3 p-3.5 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
            >
              <FileText size={16} className="text-gray-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{c.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                  <Building2 size={11} className="text-gray-400" /> {c.client} · {typeLabel(c.docType)}
                </div>
              </div>
              <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums">{c.value != null ? money(c.value) : '—'}</span>
              <StatusBadge status={c.status} />
            </button>
          ))}
        </div>
      )}

      <ContractDetail contract={selected} typeLabel={typeLabel} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function ContractDetail({ contract, typeLabel, onClose }) {
  if (!contract) return <SlideOver open={false} onClose={onClose} />;
  const c = contract;
  const expiringSoon = c.expires && c.status !== 'Paid'
    && new Date(c.expires).getTime() >= TODAY_MS
    && new Date(c.expires).getTime() - TODAY_MS <= 30 * 86400000;
  return (
    <SlideOver open onClose={onClose} title={c.title} subtitle={`${c.client} · ${typeLabel(c.docType)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={c.status} />
        {c.value != null && <Chip tone="violet">{money(c.value)}</Chip>}
        {expiringSoon && <Chip tone="amber"><Calendar size={10} /> Expires {formatRelativeDay(c.expires)}</Chip>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Client">{c.client}</Field>
        <Field label="Document type">{typeLabel(c.docType)}</Field>
        <Field label="Value">{c.value != null ? money(c.value) : '—'}</Field>
        <Field label="Status"><StatusBadge status={c.status} /></Field>
        <Field label="Created">{formatDay(c.created)}</Field>
        <Field label="Effective">{c.effective ? formatDay(c.effective) : '—'}</Field>
        <Field label="Expires / due">{c.expires ? `${formatDay(c.expires)} · ${formatRelativeDay(c.expires)}` : '—'}</Field>
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Document preview and e-signature are placeholders in this demo.
      </div>
    </SlideOver>
  );
}
