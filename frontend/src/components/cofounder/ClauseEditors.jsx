// One editor per editable clause. Each of these owns REAL generator inputs of
// POST /legal/cofounder-agreement — every data-testid here is preserved from
// the previous flat form so existing selectors keep resolving.
//
// Contract: every editor takes { draft, set, canEdit }.
//   draft — the flat builder state (the generator request model)
//   set   — set(patch) merges a partial into the draft
//   canEdit — false disables every control (server-side write access mirror)
import React from 'react';
import { Link } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { ACCELERATION, DISPUTE, THRESHOLDS } from '../../lib/cofounderAgreementViewModel';

export const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
export const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-[12.5px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40';
const HINT = 'text-[10.5px] text-gray-400 dark:text-gray-500 mt-2';
const PROSE = 'text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed';

/* ------------------------------------------------------------------ */

export function CompanyEditor({ draft, set, canEdit }) {
  return (
    <label className="block max-w-sm">
      <span className={LBL}>Legal company name</span>
      <input
        type="text"
        className={INPUT}
        value={draft.companyName}
        onChange={(e) => set({ companyName: e.target.value })}
        disabled={!canEdit}
        placeholder="e.g. NovaCraft AI, Inc."
        data-testid="input-company"
      />
    </label>
  );
}

export function EquityEditor({ draft, set, canEdit }) {
  const founders = draft.founders;
  const total = founders.reduce((a, f) => a + (Number(f.equity_pct) || 0), 0);
  const patchFounder = (i, patch) => set({ founders: founders.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });

  return (
    <div>
      <div className="space-y-2">
        {founders.map((f, i) => (
          <div key={i} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center" data-testid={`founder-row-${i}`}>
            <input type="text" className={`${INPUT} col-span-2 md:col-span-3`} value={f.name} onChange={(e) => patchFounder(i, { name: e.target.value })} disabled={!canEdit} placeholder="Full name" data-testid={`input-founder-name-${i}`} />
            <input type="email" className={`${INPUT} col-span-2 md:col-span-3`} value={f.email} onChange={(e) => patchFounder(i, { email: e.target.value })} disabled={!canEdit} placeholder="Email (optional)" data-testid={`input-founder-email-${i}`} />
            <input type="text" className={`${INPUT} col-span-1 md:col-span-2`} value={f.role} onChange={(e) => patchFounder(i, { role: e.target.value })} disabled={!canEdit} placeholder="Role" data-testid={`input-founder-role-${i}`} />
            <div className="col-span-1 md:col-span-2 flex items-center gap-1">
              <input type="number" min="0" max="100" step="0.1" className={`${INPUT} text-right`} value={f.equity_pct} onChange={(e) => patchFounder(i, { equity_pct: e.target.value })} disabled={!canEdit} data-testid={`input-founder-equity-${i}`} />
              <span className="text-[11px] text-gray-400 dark:text-gray-500">%</span>
            </div>
            <div className="col-span-2 md:col-span-2 flex items-center gap-2">
              <input type="date" className={`${INPUT} !text-[11px]`} value={f.start_date} onChange={(e) => patchFounder(i, { start_date: e.target.value })} disabled={!canEdit} data-testid={`input-founder-start-${i}`} />
              {canEdit && founders.length > 1 && (
                <button type="button" onClick={() => set({ founders: founders.filter((_, fi) => fi !== i) })} className="text-gray-300 dark:text-gray-600 hover:text-rose-500 shrink-0" aria-label="Remove founder" data-testid={`button-remove-founder-${i}`}>
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        {canEdit && (
          <button type="button" onClick={() => set({ founders: [...founders, { name: '', email: '', role: '', equity_pct: 0, start_date: '' }] })} data-testid="button-add-founder" className="text-[11.5px] font-bold text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1">
            <Plus size={11} /> Add founder
          </button>
        )}
        <span className={`text-[11px] font-semibold ${total > 100.001 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400 dark:text-gray-500'}`} data-testid="text-equity-total">
          Total {total.toFixed(2)}%{total > 100.001 ? ' — must be ≤ 100%' : ''}
        </span>
      </div>
      <p className={HINT}>
        Percentages are relative founder ownership before any option pool. Share counts live in the{' '}
        <Link to="/spinout-lab/captable" className="text-violet-600 dark:text-violet-400 hover:underline">Cap Table</Link>.
      </p>
    </div>
  );
}

export function VestingEditor({ draft, set, canEdit }) {
  const fields = [
    { label: 'Years', testid: 'input-years', val: draft.vestingYears, key: 'vestingYears', min: 1, max: 10 },
    { label: 'Cliff (months)', testid: 'input-cliffmonths', val: draft.cliffMonths, key: 'cliffMonths', min: 0, max: 48 },
    { label: 'Cliff vest %', testid: 'input-cliffvest', val: draft.cliffPct, key: 'cliffPct', min: 0, max: 100 },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className={LBL}>{f.label}</span>
            <input type="number" min={f.min} max={f.max} className={`${INPUT} !w-24 text-right`} value={f.val} onChange={(e) => set({ [f.key]: e.target.value })} disabled={!canEdit} data-testid={f.testid} />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
        {ACCELERATION.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => canEdit && set({ acceleration: o.v })}
            data-testid={`accel-${o.v}`}
            className={`text-left p-2.5 rounded-xl border-2 transition ${draft.acceleration === o.v ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20' : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}`}
          >
            <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{o.label}</div>
            <div className="text-[10.5px] text-gray-500 dark:text-gray-400 mt-0.5">{o.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function IpEditor({ draft, set, canEdit }) {
  return (
    <div>
      <p className={`${PROSE} mb-2`}>
        All prior and future IP related to the business is assigned to the entity; each founder signs a standard PIIA. List exclusions below.
      </p>
      <textarea
        rows={2}
        className={INPUT}
        value={draft.ipExclusions}
        onChange={(e) => set({ ipExclusions: e.target.value })}
        disabled={!canEdit}
        placeholder="Pre-existing IP to exclude (optional) — e.g. a patent held by a founder, unrelated to the Company."
        data-testid="input-ip-exclusions"
      />
    </div>
  );
}

export function RolesEditor({ draft, set, canEdit }) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className={LBL}>Day-to-day decisions by</span>
          <input type="text" className={INPUT} value={draft.decisionDayToDay} onChange={(e) => set({ decisionDayToDay: e.target.value })} disabled={!canEdit} data-testid="input-daytoday" />
        </label>
        <label className="block">
          <span className={LBL}>Strategic decision threshold</span>
          <select className={INPUT} value={draft.decisionThreshold} onChange={(e) => set({ decisionThreshold: e.target.value })} disabled={!canEdit} data-testid="select-threshold">
            {THRESHOLDS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <p className={HINT}>Per-founder titles come from the Role column of the equity split above.</p>
    </div>
  );
}

export function CommitmentEditor({ draft, set, canEdit }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        {['full-time', 'part-time'].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => canEdit && set({ commitment: v })}
            data-testid={`commit-${v}`}
            className={`text-[11.5px] font-bold rounded-full px-3 py-1.5 ${draft.commitment === v ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
          >
            {v === 'full-time' ? 'Full-time' : 'Part-time'}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConfidentialityEditor({ draft, set, canEdit }) {
  return (
    <div className="flex items-center gap-2">
      <input type="number" min="1" max="10" className={`${INPUT} !w-20 text-right`} value={draft.confidentialityYears} onChange={(e) => set({ confidentialityYears: e.target.value })} disabled={!canEdit} data-testid="input-confidentiality-years" />
      <span className="text-[12px] text-gray-500 dark:text-gray-400">years of confidentiality, surviving termination</span>
    </div>
  );
}

export function AmendmentEditor({ draft, set, canEdit }) {
  const matters = draft.unanimousMatters;
  return (
    <div>
      <p className={`${PROSE} mb-2`}>Matters requiring unanimous founder consent (§4.2):</p>
      <div className="space-y-1.5">
        {matters.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="text" className={INPUT} value={m} onChange={(e) => set({ unanimousMatters: matters.map((x, xi) => (xi === i ? e.target.value : x)) })} disabled={!canEdit} data-testid={`input-unanimous-${i}`} />
            {canEdit && (
              <button type="button" onClick={() => set({ unanimousMatters: matters.filter((_, xi) => xi !== i) })} className="text-gray-300 dark:text-gray-600 hover:text-rose-500 shrink-0" aria-label="Remove matter">
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button type="button" onClick={() => set({ unanimousMatters: [...matters, ''] })} data-testid="button-add-matter" className="mt-2 text-[11.5px] font-bold text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1">
          <Plus size={11} /> Add matter
        </button>
      )}
    </div>
  );
}

export function DisputeEditor({ draft, set, canEdit, explain, clauseSentence }) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {DISPUTE.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => canEdit && set({ deadlock: o.v })}
            data-testid={`dispute-${o.label.toLowerCase().replace(/\s/g, '-')}`}
            className={`text-left p-2.5 rounded-xl border-2 transition ${draft.deadlock === o.v ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20' : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}`}
          >
            <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{o.label}</div>
            <div className="text-[10.5px] text-gray-500 dark:text-gray-400 mt-0.5">{o.desc}</div>
          </button>
        ))}
      </div>
      {explain && (
        <div className="mt-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 text-[11.5px] text-gray-600 dark:text-gray-300 leading-relaxed" data-testid="dispute-explain">
          {explain}
        </div>
      )}
      {clauseSentence && (
        <p className={HINT} data-testid="dispute-clause-sentence">
          Written into §4.4 verbatim: “{clauseSentence}”
        </p>
      )}
    </div>
  );
}

export function LawEditor({ draft, set, canEdit }) {
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className={LBL}>Governing law</span>
          <input type="text" className={INPUT} value={draft.governingLaw} onChange={(e) => set({ governingLaw: e.target.value })} disabled={!canEdit} data-testid="input-law" />
        </label>
        <label className="block">
          <span className={LBL}>Arbitration venue</span>
          <input type="text" className={INPUT} value={draft.arbitrationVenue} onChange={(e) => set({ arbitrationVenue: e.target.value })} disabled={!canEdit} data-testid="input-venue" />
        </label>
      </div>
      <p className={HINT}>
        The document generates with wet-ink signature blocks. Axal has no in-app signing flow for this document.
      </p>
    </div>
  );
}

/** Read-only prose for the three template-fixed clauses (no generator inputs). */
export function ReadOnlyClause({ children }) {
  return <p className={PROSE}>{children}</p>;
}

export const EDITORS = {
  CompanyEditor, EquityEditor, VestingEditor, IpEditor, RolesEditor,
  CommitmentEditor, ConfidentialityEditor, AmendmentEditor, DisputeEditor, LawEditor,
};
