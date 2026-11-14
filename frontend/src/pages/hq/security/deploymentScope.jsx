import React from 'react';

/**
 * D4669 (#4669) — what an HQ · Security session act reaches, and what it did on
 * each deployment. Session acts write this deployment's database; a branch is
 * its own deployment, with its own accounts and sessions, and is not reached.
 *
 * The server states the scope (`list.scope`, and `scope` on every act's answer)
 * and, for the sign-out acts, one `outcomes` row per deployment. When it does
 * not state the scope, the sentence says so and reads the act as reaching this
 * deployment only, never as platform-wide.
 */

export function scopeSentence(scope) {
  if (scope && typeof scope.summary === 'string' && scope.summary) return `Scope · ${scope.summary}`;
  return 'Scope · not stated by the server. Treat every act here as reaching this deployment only.';
}

const OUTCOME_LABEL = {
  done: 'done',
  failed: 'failed — nothing changed',
  // D4669 part 2: asked and did not answer. Never "done", and never "failed"
  // either, which would claim nothing changed there.
  unreachable: 'unreachable — not known whether it acted',
  not_reached: 'not reached',
  unknown: 'unknown',
};

const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : null);

/** One line per deployment, as the server reported it. Pure, for the tests. */
export function outcomeLines(outcomes) {
  if (!Array.isArray(outcomes)) return [];
  return outcomes.map((o) => {
    const where = o?.deployment === 'hq' ? 'HQ' : String(o?.deployment ?? 'unnamed deployment');
    const what = OUTCOME_LABEL[o?.outcome] || `unrecognised outcome (${String(o?.outcome)})`;
    const n = count(o?.affected) !== null ? ` · ${count(o.affected)} account${o.affected === 1 ? '' : 's'}` : '';
    // D4669 part 2: a branch that already held this act answers from its record.
    const again = o?.replayed ? ' · already on record from an earlier attempt' : '';
    return `${where} · ${what}${n}${again}${o?.reason ? ` — ${o.reason}` : ''}`;
  });
}

export function DeploymentOutcomes({ outcomes }) {
  const lines = outcomeLines(outcomes);
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[11.5px] text-axal-muted dark:text-gray-300" data-testid="hq-deployment-outcomes" aria-label="Outcome per deployment">
      {lines.map((l, i) => (
        <li key={i} className="font-mono">{l}</li>
      ))}
    </ul>
  );
}
