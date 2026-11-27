/**
 * The collapsed "interview complete" row every Studio home shows once its
 * Eadwyn interview is finished (canvas 69dc42f3, S3's "the one improvement";
 * D324). One row: completion, the top three open proposals, Open a ticket,
 * Resume. Resume reopens the full chat; Open a ticket reopens it with the
 * ticket form already open.
 *
 * Pure and PersonalAdvisor-free, so a Node test can render it:
 * StudioInterview.jsx does the reads and mounts the chat. For the same reason
 * it does not import lib/advisor/router (which loads the Worker's bank
 * manifest): the router's two helpers are passed in.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Sparkles, Ticket } from 'lucide-react';
import { Unreadable } from '../../ui';

// The Studio's one chat anchor. StudioInterview renders it; the admin
// posture's "Continue in the chat" and the band's "Begin with the chat" link
// to it.
export const STUDIO_CHAT_ANCHOR = 'studio-chat';

const count = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * What /advisor/progress says about the interview. `overall` is the canonical
 * block; the flat fields beside it are kept for one rollout cycle, so they are
 * read only when `overall` is absent. Complete means the server said so: a
 * failed or partial read never collapses the chat.
 */
export function interviewSummary(progress) {
  if (!progress || typeof progress !== 'object') return null;
  const src = progress.overall && typeof progress.overall === 'object' ? progress.overall : progress;
  return {
    complete: src.complete === true,
    total: count(src.total),
    answered: count(src.answered),
    skipped: count(src.skipped),
    percent: count(src.percent),
  };
}

/**
 * The top `n` open proposals from /advisor/queue, in the order the Worker
 * ranked them (its queue is sorted by score). Each carries the page it opens,
 * from the question itself or, failing that, `predictTarget` (the router's
 * catalogue, passed in). A payload that is not a queue is not an empty queue:
 * it returns null.
 */
export function topProposals(payload, { n = 3, predictTarget = () => null, pageLabel = (to) => to } = {}) {
  if (!payload || !Array.isArray(payload.queue)) return null;
  return payload.queue.slice(0, n).map((item) => {
    const id = item?.id || item?.question_id || null;
    const known = id ? predictTarget(id) : null;
    const target = item?.page_target || known?.page_target || null;
    return {
      id,
      prompt: String(item?.prompt || known?.label || '').trim() || null,
      high: item?.importance === 'high' || item?.importance === 'critical',
      to: target,
      label: target ? pageLabel(target) : null,
    };
  }).filter((p) => p.prompt);
}

function completionLine(persona, s) {
  const parts = [persona];
  if (s?.total != null && s?.answered != null) parts.push(`${s.answered}/${s.total} answered${s.percent != null ? ` (${s.percent}%)` : ''}`);
  if (s?.skipped) parts.push(`${s.skipped} skipped`);
  parts.push('interview complete');
  return parts.filter(Boolean).join(' · ');
}

/**
 * `proposals` is { state: 'loading' | 'unreadable' | 'ready', items }.
 */
export function InterviewCompleteRow({ persona, summary, proposals, onResume, onOpenTicket, onRetryProposals }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[14px] border border-[#ececf1] dark:border-gray-700 bg-white dark:bg-gray-900 px-[22px] py-4"
      data-testid="status-studio-interview-complete"
    >
      <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-300">
        <Sparkles size={18} />
      </span>
      <div className="min-w-0">
        <div className="text-[15px] font-extrabold tracking-[-0.015em] text-gray-900 dark:text-gray-100">Eadwyn</div>
        <div className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400" data-testid="text-studio-interview-progress">{completionLine(persona, summary)}</div>
      </div>
      <div className="flex min-w-[240px] flex-1 flex-wrap gap-2" data-testid="list-studio-interview-proposals">
        {proposals?.state === 'loading' && <span className="text-[12px] text-gray-500 dark:text-gray-400">Loading open proposals…</span>}
        {proposals?.state === 'unreadable' && (
          <Unreadable what="Eadwyn's open proposals" claim="This is not a claim that none are open." onRetry={onRetryProposals} />
        )}
        {proposals?.state === 'ready' && proposals.items.length === 0 && (
          <span className="text-[12px] text-gray-500 dark:text-gray-400">No open proposals.</span>
        )}
        {proposals?.state === 'ready' && proposals.items.map((p, index) => {
          const chip = 'inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-[5px] text-[11.5px] font-semibold text-gray-700 dark:text-gray-200';
          const text = <>{p.high && <b className="text-violet-700 dark:text-violet-300">High ·</b>} {p.prompt}{p.to ? <> — Open {p.label} →</> : null}</>;
          return p.to
            ? <Link key={p.id || index} to={p.to} className={chip} data-testid={`link-studio-proposal-${index}`}>{text}</Link>
            : <span key={p.id || index} className={chip} data-testid={`text-studio-proposal-${index}`}>{text}</span>;
        })}
      </div>
      <div className="flex flex-none items-center gap-3">
        <button type="button" onClick={onOpenTicket} className="inline-flex items-center gap-1 text-[13px] font-bold text-violet-700 dark:text-violet-300" data-testid="button-studio-open-ticket">
          <Ticket size={14} /> Open a ticket
        </button>
        <button type="button" onClick={onResume} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 dark:text-gray-200" data-testid="button-studio-resume-interview">
          Resume <ChevronDown size={13} />
        </button>
      </div>
    </div>
  );
}
