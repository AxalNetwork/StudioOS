import { Unreadable } from '../ui/Honesty';
import { formatCost } from '../ui/assistCost';
import { observedRunCost } from '../ui/eadwynConfig';

/**
 * What a proposal band's run has cost THIS reader before, shown before they
 * press it (D424).
 *
 * The canvas's proposal band puts a cost at its top right, and on the founder
 * desks that figure only ever appeared AFTER a draft existed — the draft's own
 * row carries what it cost. A reader deciding whether to spend was shown the
 * price once it was paid. `ZoneDraft`'s docblock said the cost was shown
 * before the run; it was not.
 *
 * MEASURED, NEVER MODELLED — D16's rule, the one the rail's estimate follows.
 * The figure is the reader's own average for the router task the band runs,
 * from `/api/ai/me/spend`'s `by_task`, so it is a fact about runs that
 * happened. There is no honest token count to multiply before a run: nothing
 * knows how long a draft will be before it is written.
 *
 * FOUR STATES, KEPT APART:
 *   - still loading: nothing is drawn, rather than a figure that flickers;
 *   - the usage log could not be read (a failed request, `recorded: false`,
 *     or `by_task_recorded: false`): Unreadable with a retry — never "no
 *     runs yet", which the page could not support;
 *   - read, and no run of this task: says there is no average to quote;
 *   - read, with runs: the average and how many runs it is over.
 *
 * `ai` is the host's `useAiSpend()` result, passed down rather than fetched
 * here: a desk mounts up to four bands, and four bands fetching the same two
 * reads would spend more D1 reads describing the cost than the runs cost.
 * A host that passes nothing gets nothing drawn — the other mounts of these
 * bands are unchanged.
 */
export function runEstimate(ai, task) {
  if (!ai || !task) return null;
  if (ai.loading) return { state: 'loading' };
  if (ai.spendError || ai.spend?.recorded === false || ai.spend?.by_task_recorded === false) {
    return { state: 'unreadable' };
  }
  if (!ai.spend) return null;
  const observed = observedRunCost(ai.spend, task);
  return observed ? { state: 'observed', cost: observed.cost, calls: observed.calls } : { state: 'none' };
}

/**
 * `shared` names another surface that runs the same task, when one does. The
 * average is per task because the usage log groups by task, so a band whose
 * task the rail's read-back also runs is quoting an average over both — and
 * says so rather than presenting it as this band's alone.
 */
export default function RunEstimate({ ai, task, shared, testId = 'text-run-estimate' }) {
  const e = runEstimate(ai, task);
  if (!e || e.state === 'loading') return null;
  if (e.state === 'unreadable') {
    return (
      <div className="mt-2" data-testid={testId}>
        <Unreadable
          what="Your average for this run"
          claim="That is not a claim that it costs nothing."
          onRetry={ai.reload}
        />
      </div>
    );
  }
  return (
    <p className="mt-2 text-[10.5px] tabular-nums text-gray-600 dark:text-gray-400" data-testid={testId}>
      {e.state === 'observed'
        ? `Before you run it · your runs of this have averaged ${formatCost(e.cost)}, over ${e.calls}${shared ? ` (${shared} runs the same task, so it is in the average)` : ''}.`
        : 'Before you run it · no run of this is recorded for you yet, so there is no average to quote.'}
    </p>
  );
}
