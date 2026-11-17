/**
 * D6016 (#6016, V8): one hypothesis's page. The computed evidence state and the founder's decision sit apart above
 * the record; the record's evidence is split into Supporting and Contradictory (`hypothesisRecordView`), and the rest
 * is `RecordView` as before, with every action it declares.
 */
import { Link } from 'react-router-dom';
import RecordView from './RecordView';
import { hypothesisRecordView } from './hypothesisRecord.js';

const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  vio: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  amb: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  grey: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

export function HypothesisStanding({ standing, onLink }) {
  if (!standing) return null;
  const { state, decision } = standing;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-4 py-3 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5"
      aria-label="Evidence state and decision" data-testid="hypothesis-standing">
      <div className="flex flex-wrap items-center gap-2" data-testid="hypothesis-computed-state">
        <span className="text-axal-muted dark:text-gray-400">Computed evidence state</span>
        {state
          ? <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${TONE[state.tone] || TONE.grey}`}>{state.text}</span>
          : <span className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10.5px] font-semibold text-axal-muted dark:border-gray-600 dark:text-gray-400">Not recorded</span>}
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">from linked evidence, not proof</span>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-testid="hypothesis-founder-decision">
        <span className="text-axal-muted dark:text-gray-400">Founder decision</span>
        <span className="text-axal-ink/80 dark:text-gray-300">recorded in Verdict</span>
        {decision && (onLink
          ? <button type="button" onClick={() => onLink({ kind: 'link', href: decision.href })}
            className="min-h-[44px] font-semibold text-axal-violet-deep hover:underline sm:min-h-0 dark:text-violet-300" data-testid="hypothesis-record-decision">{decision.label} →</button>
          : <Link to={decision.href} className="font-semibold text-axal-violet-deep hover:underline dark:text-violet-300" data-testid="hypothesis-record-decision">{decision.label} →</Link>)}
      </div>
    </section>
  );
}

export default function HypothesisRecord({ read, ...ctx }) {
  const { record, standing } = hypothesisRecordView(read);
  return (
    <div className="space-y-3" data-testid="hypothesis-record">
      <HypothesisStanding standing={standing} onLink={ctx.onLink} />
      <RecordView record={record} activity={ctx.activity} cycleName={ctx.cycleName} moduleName={ctx.moduleName} onLink={ctx.onLink}
        onForm={ctx.onForm} onWrite={ctx.onWrite} onClient={ctx.onClient} onShowAll={ctx.onShowAll} />
    </div>
  );
}
