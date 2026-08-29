import React, { useEffect, useMemo, useState } from 'react';
import { FileText, ExternalLink, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  Chip, Section, EmptyState, StatCard, FilterChips, StatusBadge, RowCard,
  formatDay, formatRelativeDay,
} from './kit';

// Contracts — the advisor's real e-signature envelopes (Wave 1b; previously a
// fixture of five invented MSAs and SOWs with invented values).
//
// `GET /api/legal/esign` is scoped server-side by `esignEnvelopeScope(user)`,
// so an advisor sees their own envelopes and nothing else — this page adds no
// client-side filtering that could be mistaken for a security boundary.
const VIEWS = [
  { id: 'open', label: 'In flight' },
  { id: 'done', label: 'Completed' },
  { id: 'all', label: 'All' },
];

const OPEN_STATES = new Set(['draft', 'sent', 'partially_signed', 'pending']);

export default function ContractsPage() {
  const [envelopes, setEnvelopes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('open');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.esignList();
        setEnvelopes(r.envelopes || []);
      } catch (e) {
        setError(e?.message || 'Could not load your agreements.');
      }
      setLoading(false);
    })();
  }, []);

  const open = useMemo(() => envelopes.filter((e) => OPEN_STATES.has(String(e.status))), [envelopes]);
  const done = useMemo(() => envelopes.filter((e) => String(e.status) === 'completed'), [envelopes]);
  const shown = view === 'open' ? open : view === 'done' ? done : envelopes;

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading agreements…</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="In flight" value={open.length} hint="sent, awaiting signatures" />
        <StatCard label="Completed" value={done.length} />
        <StatCard label="Total" value={envelopes.length} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips options={VIEWS} value={view} onChange={setView} />
        <Link
          to="/legal/send"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700"
        >
          <Send size={13} /> Send for signature
        </Link>
      </div>

      {shown.length === 0 ? (
        <EmptyState>
          {envelopes.length === 0
            ? 'No agreements yet. Send one for signature and it appears here with its per-recipient progress.'
            : view === 'open'
              ? 'Nothing awaiting signature.'
              : 'Nothing completed yet.'}
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          {shown.map((e) => {
            const signed = Number(e.signed_count || 0);
            const total = Number(e.recipient_count || 0);
            return (
              <RowCard key={e.id} onClick={() => { window.location.href = `/legal/send?envelope=${e.id}`; }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
                      <FileText size={15} className="text-violet-500 flex-shrink-0" />
                      <span className="truncate">{e.document_title || e.document_type || `Envelope #${e.id}`}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={String(e.status).replace(/_/g, ' ')} />
                      {e.document_type && <Chip tone="violet">{e.document_type}</Chip>}
                      {total > 0 && (
                        <Chip tone={signed === total ? 'emerald' : 'amber'}>
                          {signed}/{total} signed
                        </Chip>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-gray-600 dark:text-gray-400">{formatDay(e.created_at)}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {e.completed_at ? `completed ${formatRelativeDay(e.completed_at)}` : formatRelativeDay(e.created_at)}
                    </div>
                    {e.signed_r2_key && (
                      <a
                        href={api.esignDocumentUrl(e.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-violet-600 hover:underline"
                      >
                        <ExternalLink size={10} /> Signed PDF
                      </a>
                    )}
                  </div>
                </div>
              </RowCard>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Agreements are scoped by the server to the ones you originated or are a
        party to. Structured deal terms and renewal tracking are not modelled
        yet — this list reflects the envelope record itself.
      </p>
    </div>
  );
}
