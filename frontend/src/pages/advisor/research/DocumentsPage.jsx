import React, { useMemo, useState } from 'react';
import { FileText, FileSpreadsheet, FileSignature, File, BookOpen, Download, Eye } from 'lucide-react';
import { DOCUMENTS, DOCUMENT_TYPES, formatDay } from '../../../data/advisor/research';
import {
  SearchInput, FilterChips, SlideOver, Section, Field, Badge, EmptyState, Chip,
} from './kit';

// Documents — a searchable knowledge library across document types (pitch decks,
// investment memos, PDFs, contracts, research papers) with search + type filter
// and a detail panel per document.

const TYPE_ICON = {
  deck: FileSpreadsheet,
  memo: FileText,
  pdf: File,
  contract: FileSignature,
  paper: BookOpen,
};
const typeLabel = (id) => DOCUMENT_TYPES.find((t) => t.id === id)?.label || id;

export default function DocumentsPage() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [id, setId] = useState(null);

  const filters = useMemo(() => ([
    { id: 'all', label: 'All', count: DOCUMENTS.length },
    ...DOCUMENT_TYPES.map((t) => ({ id: t.id, label: t.label, count: DOCUMENTS.filter((d) => d.type === t.id).length })),
  ]), []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return DOCUMENTS.filter((d) => {
      if (type !== 'all' && d.type !== type) return false;
      if (!term) return true;
      return [d.title, d.author, d.summary, ...(d.tags || [])].some((v) => String(v).toLowerCase().includes(term));
    });
  }, [q, type]);

  const sel = DOCUMENTS.find((x) => x.id === id) || null;
  const SelIcon = sel ? (TYPE_ICON[sel.type] || File) : File;

  return (
    <div className="space-y-4">
      <SearchInput value={q} onChange={setQ} placeholder="Search documents, tags, authors…" />
      <FilterChips options={filters} value={type} onChange={setType} />
      {rows.length === 0 ? <EmptyState>No documents match your filters.</EmptyState> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((d) => {
            const Icon = TYPE_ICON[d.type] || File;
            return (
              <button key={d.id} onClick={() => setId(d.id)} className="text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-violet-300 transition-colors flex gap-3">
                <div className="w-10 h-10 rounded-lg bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center flex-shrink-0">
                  <Icon size={18} className="text-violet-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{d.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{typeLabel(d.type)} · {d.pages}p · {formatDay(d.date)}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.tags.slice(0, 3).map((t) => <Chip key={t}>{t}</Chip>)}
                  </div>
                </div>
                <Badge>{d.confidentiality}</Badge>
              </button>
            );
          })}
        </div>
      )}
      {sel && (
        <SlideOver open onClose={() => setId(null)} title={sel.title} subtitle={`${typeLabel(sel.type)} · ${sel.pages} pages`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{sel.confidentiality}</Badge>
            <Chip>{sel.source}</Chip>
          </div>
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 h-40 flex flex-col items-center justify-center gap-1 text-gray-400">
            <SelIcon size={28} />
            <span className="text-xs">Document preview placeholder</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Author">{sel.author}</Field>
            <Field label="Date">{formatDay(sel.date)}</Field>
            <Field label="Source">{sel.source}</Field>
            <Field label="Pages">{sel.pages}</Field>
          </div>
          <Section title="Summary"><p className="text-sm text-gray-700 dark:text-gray-300">{sel.summary}</p></Section>
          <Section title="Tags">
            <div className="flex flex-wrap gap-1.5">{sel.tags.map((t) => <Chip key={t} tone="violet">{t}</Chip>)}</div>
          </Section>
          <div className="flex gap-2 pt-1">
            <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700"><Eye size={14} /> Open</button>
            <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"><Download size={14} /> Download</button>
          </div>
        </SlideOver>
      )}
    </div>
  );
}
