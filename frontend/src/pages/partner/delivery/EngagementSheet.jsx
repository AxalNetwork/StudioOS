// D4822 (#4822) — PD6, the cross-zone engagement Sheet: one engagement's header, its next action, and a compact
// summary of each Delivery zone with a link into it. Built from the Board's own row (`GET /partner-delivery/board`),
// so there is no second data model and nothing here is fetched twice.
//
// HONEST BY CONSTRUCTION. Every line says what the record holds: "Not recorded" where nothing is, "Not rated"
// where no health was read, and "Read status unavailable" for deliverables, because no product surface sets
// `opened_at`. Nothing in the Sheet writes: each section links to the zone where the edit lives.
import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { HEALTH_WORD, NOT_RATED, modeValue, nextAction, progressText } from './boardAttention';
import HealthPill from './HealthPill';

const monthName = (period) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) : null;
};

/** The five zone summaries, pure over the row so a test reads them. */
export function sheetSections(row) {
  const month = monthName(row.report_period) || 'This period';
  const progress = progressText(row);
  const scope = row.scope_state === 'drift' ? 'scope drift recorded' : row.scope_state === 'within' ? 'in scope' : 'scope not assessed';
  return [
    {
      key: 'progress', title: 'Progress',
      text: progress
        ? `${progress}${row.milestones_overdue ? ` · ${row.milestones_overdue} overdue` : ''}`
        : 'Not recorded · no milestones yet',
      to: 'health', link: 'Health',
    },
    {
      key: 'deliverables', title: 'Deliverables',
      text: row.deliverables_sent
        ? `${row.deliverables_sent} sent · ${row.deliverables_signed_off || 0} signed off · read status unavailable`
        : 'None sent yet',
      to: 'deliverables', link: 'Deliverables',
    },
    {
      key: 'report', title: 'Status report',
      text: `${month} · ${row.report_state === 'sent' ? 'marked sent' : row.report_state === 'draft' ? 'draft saved, not sent' : 'not started'}`,
      to: 'status-reports', link: 'Status reports',
    },
    {
      key: 'health', title: 'Health',
      text: `${row.health ? HEALTH_WORD[row.health] : NOT_RATED} · ${scope}${row.health && row.health_reasons?.length ? ` · ${row.health_reasons.join(' · ')}` : ''}`,
      to: 'health', link: 'Health',
    },
    {
      key: 'capacity', title: 'Capacity',
      text: row.mode === 'embedded'
        ? `${row.grant_holder ? `${row.grant_holder} · ` : ''}${progressText(row) || 'no hours logged'}`
        : 'No embedded seat on this engagement',
      to: 'capacity', link: 'Capacity',
    },
  ];
}

export default function EngagementSheet({ row, onClose }) {
  const closeRef = useRef(null);
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const back = opener.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      if (back && typeof back.focus === 'function') back.focus();
    };
  }, [onClose]);
  if (!row) return null;
  const next = nextAction(row);
  const headingId = `engagement-sheet-${row.engagement_id}`;
  return (
    <div className="fixed inset-0 z-50" data-testid="delivery-engagement-sheet">
      <button type="button" aria-label="Close engagement" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default bg-black/30" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col overflow-y-auto border-l border-[#ececf1] bg-white shadow-xl dark:border-gray-800 dark:bg-[#111827]"
      >
        <div className="border-b border-[#ececf1] px-5 py-4 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b6577] dark:text-gray-400">Engagement</span>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close engagement"
              className="grid h-11 w-11 place-items-center rounded-lg text-[#18181b] hover:bg-[#f4f3f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c3aed] dark:text-gray-100 dark:hover:bg-gray-800">✕</button>
          </div>
          <h2 id={headingId} className="mt-1 text-[20px] font-extrabold text-[#18181b] dark:text-gray-100">{row.client || 'Client not recorded'}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-[#6b6577] dark:text-gray-400">
            <HealthPill health={row.health} />
            <span>{modeValue(row)}</span>
            <span>· {row.owner_name ? `owner ${row.owner_name}` : 'no owner assigned'}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <section className={`rounded-xl border px-4 py-3 ${next?.quiet ? 'border-[#ececf1] dark:border-gray-800' : 'border-[#fcd34d] bg-[#fffbeb] dark:border-amber-700 dark:bg-amber-950/30'}`} data-testid="delivery-sheet-next">
            <h3 className="text-[13px] font-bold text-[#18181b] dark:text-gray-100">Next action</h3>
            <p className="mt-0.5 text-[14px] text-[#18181b] dark:text-gray-100">{next?.text}</p>
            {next?.why && <p className="mt-0.5 text-[13px] text-[#92400e] dark:text-amber-300">{next.why}</p>}
          </section>
          {sheetSections(row).map((s) => (
            <section key={s.key} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-3 border-t border-[#ececf1] pt-3 dark:border-gray-800" data-testid={`delivery-sheet-${s.key}`}>
              <h3 className="text-[13px] font-bold text-[#18181b] dark:text-gray-100">{s.title}</h3>
              <span className="text-[14px] text-[#18181b] dark:text-gray-200">{s.text}</span>
              <Link to={`/delivery/${s.to}?engagement=${encodeURIComponent(row.engagement_uid || row.engagement_id)}`}
                className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-[13px] font-semibold text-[#7c3aed] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c3aed] dark:text-[#a78bfa]">
                {s.link} →
              </Link>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}
