import React, { useEffect, useState } from 'react';
import { Layers, Award } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  Chip, Section, SlideOver, EmptyState, Badge, RowCard, StatCard, Stars,
  formatDay, moneyUsd,
} from './kit';

// Portfolio — proof of work, from REAL engagements (Wave 1a; previously six
// fictional clients and three fabricated case studies with invented metrics).
//
// Everything here is derived from delivered/reviewed/invoiced engagement rows
// and the reviews founders actually left. There is deliberately no free-form
// "case study" authoring in this pass: proof a partner writes about
// themselves and proof a counterparty recorded are different classes of
// evidence, and only the second exists in the schema today.
export default function PortfolioPage() {
  const [engagements, setEngagements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [reviews, setReviews] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.listEngagements();
        setEngagements(r.items || []);
      } catch (e) {
        setError(e?.message || 'Could not load engagements.');
      }
      setLoading(false);
    })();
  }, []);

  const openDetail = async (e) => {
    setOpen(e); setReviews(null);
    try {
      const r = await api.listEngagementReviews(e.id);
      setReviews(r.items || []);
    } catch { setReviews([]); }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Loading your track record…</div>;
  }

  const done = engagements.filter((e) => ['delivered', 'reviewed', 'invoiced'].includes(e.status));
  const deliveredValue = done.reduce((a, e) => a + (Number(e.price) || 0), 0);
  const clients = new Set(done.map((e) => e.project_name || e.founder_name || e.founder_id));

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/20 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Completed engagements" value={done.length} />
        <StatCard label="Clients served" value={clients.size} />
        <StatCard label="Delivered value" value={moneyUsd(deliveredValue)} />
        <StatCard label="Reviewed" value={done.filter((e) => e.status === 'reviewed').length} hint="founder review recorded" />
      </div>

      <Section title="Completed work">
        {done.length === 0 ? (
          <EmptyState>
            <p className="font-medium text-gray-700 dark:text-gray-300">No completed engagements yet.</p>
            <p className="mt-1">
              Your track record builds itself: win a founder request in
              Engagements, deliver it, and it appears here with the founder&apos;s review.
            </p>
          </EmptyState>
        ) : (
          <div className="space-y-2.5">
            {done.map((e) => (
              <RowCard key={e.id} onClick={() => openDetail(e)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 inline-flex items-center gap-2">
                      <Layers size={15} className="text-violet-500 flex-shrink-0" />
                      <span className="truncate">{e.need_title || `Engagement ${e.uid?.slice(0, 8)}`}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge>{e.status}</Badge>
                      {e.need_category && <Chip tone="violet">{e.need_category}</Chip>}
                      {(e.project_name || e.founder_name) && <Chip>{e.project_name || e.founder_name}</Chip>}
                    </div>
                    {e.delivery_notes && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{e.delivery_notes}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{moneyUsd(e.price)}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">delivered {formatDay(e.delivered_at)}</div>
                  </div>
                </div>
              </RowCard>
            ))}
          </div>
        )}
      </Section>

      <SlideOver
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.need_title || (open ? `Engagement ${open.uid?.slice(0, 8)}` : '')}
        subtitle={open ? `${open.project_name || open.founder_name || ''} · delivered ${formatDay(open.delivered_at)}` : ''}
      >
        {open && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Value</div>
                <div className="text-sm font-semibold">{moneyUsd(open.price)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</div>
                <Badge>{open.status}</Badge>
              </div>
            </div>
            {open.delivery_notes && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Delivery notes</div>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{open.delivery_notes}</p>
              </div>
            )}
            <Section title="Reviews">
              {reviews === null ? (
                <div className="text-sm text-gray-500">Loading reviews…</div>
              ) : reviews.length === 0 ? (
                <EmptyState>No review left on this engagement.</EmptyState>
              ) : (
                <div className="space-y-2.5">
                  {reviews.map((r) => (
                    <div key={r.id || r.uid} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3.5">
                      <div className="flex items-center justify-between">
                        <Stars value={r.rating} showValue={false} />
                        <Chip tone={r.reviewer_role === 'founder' ? 'emerald' : 'violet'}>
                          <Award size={10} /> {r.reviewer_role}
                        </Chip>
                      </div>
                      {r.comment && <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">“{r.comment}”</p>}
                      <div className="text-[11px] text-gray-400 mt-2">{formatDay(r.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
