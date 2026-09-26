// The ICP definition module and its five-step wizard — Customer Discovery
// canvas, D353. Stored in projects.icp_definition_meta (migration 308) through
// PUT /api/projects/:id; the Worker's normaliser owns validation, the version
// and the timestamps (see ../../lib/icpDefinition.js).
//
// Every "Next" saves a draft, so closing the wizard never loses answers, and
// "Confirm ICP" is refused by the Worker unless every required answer is on
// file — the button's own gate is a convenience, not the rule.
//
// Not built here, and said so on screen: "Generate landing page" from the ICP.
// The landing-template content sanitizer (landingTemplates.ts) accepts no ICP
// input, so a generator would have nothing to write into.
import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { Unrecorded } from '../../ui';
import { ICP_STEPS, icpPayload, icpProgress, icpSummary, readIcpDefinition } from '../../lib/icpDefinition';

const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const FIELD = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-50 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40';

const STATE_CHIP = {
  empty: ['Not started', 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'],
  draft: ['In progress', 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'],
  confirmed: ['Confirmed', 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'],
  unreadable: ['Unreadable', 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'],
};

function shortDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
}

export default function IcpDefinitionCard({ project, canEdit, onSaved }) {
  const def = useMemo(() => readIcpDefinition(project?.icp_definition_meta), [project?.icp_definition_meta]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [fields, setFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFields({ ...(def.fields || {}) });
      setStep(def.step || 1);
    }
  }, [def, open]);

  const progress = icpProgress(open ? fields : def.fields);
  const [label, chip] = STATE_CHIP[def.state] || STATE_CHIP.empty;
  const cur = ICP_STEPS[Math.min(step, 5) - 1];

  const save = async (status, nextStep) => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateProject(project.id, {
        icp_definition_meta: icpPayload({ status, step: nextStep, fields }),
      });
      onSaved?.(updated);
      return true;
    } catch (e) {
      // The Worker's sentence (D258): an incomplete confirm, a bad choice.
      setError(e?.message || 'The ICP definition was not saved.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (step < 5) {
      if (await save('draft', step + 1)) setStep(step + 1);
      return;
    }
    if (await save('confirmed', 5)) setOpen(false);
  };

  return (
    <div className={CARD} data-testid="discovery-icp-definition">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className={LBL}>ICP definition</div>
        <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${chip}`} data-testid="icp-definition-state">{label}</span>
      </div>

      {def.state === 'unreadable' ? (
        <p className="text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="icp-definition-unreadable">
          The stored ICP definition could not be read. Starting again replaces it.
        </p>
      ) : def.state === 'empty' ? (
        <div data-testid="icp-definition-empty">
          <p className="text-[12.5px] text-gray-600 dark:text-gray-300 mb-2">Five short steps turn your interviews into a definition you can write copy against:</p>
          <ul className="text-[11.5px] text-gray-500 dark:text-gray-400 space-y-1 mb-3 list-disc pl-4">
            <li>Who they are, and what breaks for them today</li>
            <li>What they want, and how they actually buy</li>
            <li>The value proposition, differentiator and tone</li>
          </ul>
        </div>
      ) : def.state === 'draft' ? (
        <div data-testid="icp-definition-draft">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div className="h-full rounded-full bg-violet-600" style={{ width: `${progress.pct}%` }} />
            </div>
            <span className="text-[10.5px] font-bold text-violet-600 dark:text-violet-400 tabular-nums">{progress.done}/{progress.total}</span>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">Step {def.step} of 5 · {ICP_STEPS[def.step - 1].name}</p>
          <ul className="space-y-1 mb-3">
            {progress.steps.map((s) => (
              <li key={s.n} className="flex items-center gap-2 text-[11.5px] text-gray-600 dark:text-gray-300">
                <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold ${s.done === s.total ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
                  {s.done === s.total ? <Check size={9} /> : s.n}
                </span>
                <span className="flex-1">{s.name}</span>
                <span className="tabular-nums text-gray-400">{s.done}/{s.total}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div data-testid="icp-definition-confirmed">
          <div className="text-[14px] font-extrabold text-gray-900 dark:text-gray-50">
            {[def.fields.persona, def.fields.industry].filter(Boolean).join(' · ')}
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">
            {[def.fields.type, def.fields.size, def.fields.geo].filter(Boolean).join(' · ')}
          </div>
          <dl className="mt-3 space-y-1.5">
            {icpSummary(def.fields).map((r) => (
              <div key={r.k}>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{r.k}</dt>
                <dd className="text-[12px] text-gray-700 dark:text-gray-200">{r.v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-2 mt-3 text-[10.5px] text-gray-400 dark:text-gray-500">
            {def.fields.tone && <span className="rounded-full px-2 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-semibold">{def.fields.tone}</span>}
            <span className="ml-auto tabular-nums" data-testid="icp-definition-version">
              v{def.version}{shortDate(def.confirmedAt) ? ` · ${shortDate(def.confirmedAt)}` : ''}
            </span>
          </div>
          <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2" data-testid="icp-landing-unrecorded">
            Generate a landing page from this ICP: <Unrecorded reason="The landing templates accept no ICP input yet, so there is nothing for a generator to write into. Build the page in Brand & Pages." />
          </p>
        </div>
      )}

      {canEdit ? (
        <button
          type="button"
          onClick={() => { setError(''); setOpen(true); if (def.state === 'confirmed') setStep(1); }}
          data-testid="button-icp-open"
          className="mt-3 w-full h-9 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[12.5px] font-bold"
        >
          {def.state === 'empty' || def.state === 'unreadable' ? 'Start ICP →' : def.state === 'draft' ? `Resume — ${ICP_STEPS[def.step - 1].name} →` : 'Edit'}
        </button>
      ) : (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">Only the startup’s founders can edit the ICP definition.</p>
      )}
      {def.state === 'confirmed' && (
        <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">Editing saves a draft; confirming again moves the version on.</p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setOpen(false)} data-testid="modal-icp-wizard">
          <div className="w-full max-w-xl my-auto rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-violet-400">Step {cur.n} of 5</div>
                <h3 className="text-[17px] font-extrabold text-gray-900 dark:text-gray-50">{cur.title}</h3>
                <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">{cur.blurb}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={18} /></button>
            </div>
            <div className="flex gap-1 mb-4">
              {ICP_STEPS.map((s) => (
                <div key={s.n} className={`flex-1 h-1 rounded-full ${s.n <= step ? 'bg-violet-600' : 'bg-gray-100 dark:bg-gray-800'}`} />
              ))}
            </div>
            <div className="space-y-3.5">
              {cur.fields.map((f) => (
                <div key={f.key}>
                  <label className="block text-[12px] font-semibold text-gray-700 dark:text-gray-200" htmlFor={`icp-${f.key}`}>
                    {f.label}{f.optional ? <span className="text-gray-400 font-normal"> · optional</span> : null}
                  </label>
                  <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-1.5">{f.help}</p>
                  {f.kind === 'choice' ? (
                    <div className="flex flex-wrap gap-1.5">
                      {f.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          aria-pressed={fields[f.key] === opt}
                          data-testid={`icp-choice-${f.key}`}
                          onClick={() => setFields((m) => ({ ...m, [f.key]: m[f.key] === opt ? '' : opt }))}
                          className={`text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border ${fields[f.key] === opt ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : f.kind === 'area' ? (
                    <textarea id={`icp-${f.key}`} rows={2} className={FIELD} value={fields[f.key] || ''} onChange={(e) => setFields((m) => ({ ...m, [f.key]: e.target.value }))} />
                  ) : (
                    <input id={`icp-${f.key}`} className={FIELD} value={fields[f.key] || ''} onChange={(e) => setFields((m) => ({ ...m, [f.key]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            {error && <p className="text-[12px] text-rose-600 dark:text-rose-400 mt-3" role="alert" data-testid="icp-wizard-error">{error}</p>}
            <div className="flex items-center gap-2 mt-5">
              {step > 1 && (
                <button type="button" onClick={() => setStep(step - 1)} className="h-9 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-[13px] font-semibold text-gray-600 dark:text-gray-300">← Back</button>
              )}
              <button
                type="button"
                onClick={next}
                disabled={saving || (step === 5 && !icpProgress(fields).complete)}
                title={step === 5 && !icpProgress(fields).complete ? 'Every required answer must be filled before the ICP can be confirmed.' : undefined}
                data-testid="button-icp-next"
                className="ml-auto h-9 px-5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-[13px] font-bold inline-flex items-center gap-1.5"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {step === 5 ? 'Confirm ICP' : 'Save & continue →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
