/**
 * D1295 (#3391, ART17b) — a member who is not an admin and opens a Content
 * queue address (`/admin/articles`, or a notice's `/admin/articles/<id>`)
 * sees the canvas's words instead of being sent home with none. It makes no
 * read. App.jsx's ROUTE_BOUNDARIES draws it; an admin previewing another role
 * keeps today's redirect.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { actionPrimary } from '../../../ui';
import { NO_PERMISSION } from './pipelineModel';

export default function ContentQueueBoundary() {
  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6" data-testid="cq-no-permission">
      <section className="mx-auto mt-[70px] flex w-full max-w-[600px] flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <span aria-hidden="true" className="text-[22px] leading-none text-slate-500 dark:text-slate-400">⊘</span>
        <h1 className="m-0 text-[18px] font-extrabold tracking-[-.01em] text-slate-900 dark:text-slate-100">{NO_PERMISSION.title}</h1>
        <p className="m-0 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{NO_PERMISSION.line}</p>
        <Link to={NO_PERMISSION.action.to} className={`${actionPrimary} mt-2`} data-testid="cq-no-permission-action">{NO_PERMISSION.action.label}</Link>
      </section>
    </main>
  );
}
