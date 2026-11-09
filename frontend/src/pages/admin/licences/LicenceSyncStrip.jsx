/**
 * #4686 — the licence page's branch-sync strip and its unfinished-termination
 * notice. HQ revision, branch revision, last successful sync, the pending
 * revision and why it has not landed, from `GET /api/admin/licences/:uid`'s
 * `sync`. A figure nobody recorded reads "Not recorded", never 0, and a failure
 * shows a sentence for its code, never the error's own text.
 */
import React from 'react';
import { RotateCw } from 'lucide-react';
import { Field } from './licenceShared';
import { syncFailureSentence } from '../licenceOverviewModel';

// D4819 part 3: the failure sentences moved to `licenceOverviewModel.js`, which the Overview's Branch fact reads too.

const TERMINATION_STEP_SENTENCE = {
  notices: 'compliance notices were not withdrawn',
  notify: 'the administrators were not told',
  admins: 'HQ administrators were not deprovisioned',
  push: 'the branch has not received the terminated licence',
  unbind: 'the branch administrators were not unbound',
};

/**
 * D4819 part 3: `part` draws one half where the detail puts it: 'strip' on
 * Operations › Branch and domain, 'termination' above the sections (it carries
 * an action that cannot wait for a tab). Without it, both, as before.
 */
export function LicenceSyncStrip({ sync, busy, onResume, part }) {
  if (!sync) return null;
  const t = sync.termination;
  const strip = part !== 'termination';
  const termination = part !== 'strip';
  return (
    <>
      {strip && sync.available !== false && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950" data-testid="licence-sync-strip">
          <div className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400">Branch sync</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="HQ revision" value={sync.hq_revision == null ? null : String(sync.hq_revision)} />
            <Field label="Branch revision" value={sync.branch_revision == null ? null : String(sync.branch_revision)} />
            <Field label="Last successful sync" value={sync.last_success_at || null} />
            <Field
              label="Pending revision"
              value={sync.pending?.revision == null ? null : String(sync.pending.revision)}
              hint={sync.pending ? null : 'Nothing is waiting to be sent.'}
            />
            <Field label="Why it has not landed" value={sync.pending ? syncFailureSentence(sync.pending.failure_code) : null} />
          </div>
        </div>
      )}
      {termination && t && t.status !== 'complete' && (
        <div
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          data-testid="licence-termination-incomplete"
        >
          <div>
            The termination is recorded, but its follow-up is not finished
            {t.failure_step ? `: ${TERMINATION_STEP_SENTENCE[t.failure_step] || 'a step did not complete'}` : ''}.
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onResume}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900"
          >
            <RotateCw size={12} /> Resume the follow-up
          </button>
        </div>
      )}
    </>
  );
}
