// Solo-founder path — a READ-ONLY readout, never a document flow.
//
// Why: the generator hard-rejects fewer than two founders, no solo-declaration
// template exists in either runtime, and nothing in the schema records a "chose
// solo" decision. Each signal below states what it does NOT prove, the caveat
// is rendered prominently, and the action is permanently disabled.
import React from 'react';
import { Link } from 'react-router-dom';
import { UserRound, AlertTriangle, Lock, ArrowRight } from 'lucide-react';
import StatusPill from './StatusPill';

export default function SoloDeclaration({ solo }) {
  const s = solo || {};
  const items = Array.isArray(s.items) ? s.items : [];
  const steps = Array.isArray(s.nextSteps) ? s.nextSteps : [];

  return (
    <div data-testid="card-solo">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl bg-gray-600 dark:bg-gray-700 text-white flex items-center justify-center shrink-0">
          <UserRound size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Agreement path · Solo founder
          </div>
          <div className="text-[15px] font-bold text-gray-900 dark:text-gray-50 mt-0.5 truncate">{s.headline}</div>
        </div>
      </div>

      {/* What the solo path IS, stated as guidance. The design's paragraph
          asserted a Week-3 decision Axal does not record; this one describes
          the path without claiming the reader has chosen it. */}
      {s.body && (
        <p className="text-[13px] text-gray-600 dark:text-gray-300 leading-relaxed mb-4" data-testid="solo-body">{s.body}</p>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 mb-4" data-testid="solo-caveat">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
        <p className="text-[12px] text-amber-700 dark:text-amber-300 leading-snug">{s.caveat}</p>
      </div>

      <div className="space-y-2.5">
        {items.map((it, i) => (
          <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5" data-testid={`solo-item-${i}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-gray-700 dark:text-gray-200">{it.label}</span>
              <StatusPill tone={it.tone} label={it.value} size="xs" />
            </div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{it.detail}</div>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled
        title={s.reason}
        data-testid="button-solo-execute"
        className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[12.5px] font-bold py-3 cursor-not-allowed"
      >
        <Lock size={12} /> Solo declaration not available
      </button>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 text-center leading-snug">{s.reason}</p>

      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-4">
        {steps.map((n, i) => (
          <Link key={i} to={n.to} className="text-[11.5px] font-bold text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1" data-testid={`solo-next-${i}`}>
            {n.label} <ArrowRight size={11} />
          </Link>
        ))}
      </div>
    </div>
  );
}
