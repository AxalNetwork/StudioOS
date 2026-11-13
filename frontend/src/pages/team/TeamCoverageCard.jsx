import React, { useEffect, useState } from 'react';
import { BTN_TEXT, HonestBlock, MUTED, TeamCard } from './teamUi.jsx';
import * as agents from './agentsAdapter.js';
import { coverageRows, coverageSummary } from './skillsModel.js';

/**
 * D1612 (#3952, SK8) — Team coverage on the People and agents tab: people and
 * agents side by side on the 8 /studio axes, from A2's
 * `GET /api/teams/:scope/:id/coverage` (#3956). Agent coverage is labelled
 * "Agent", and an axis covered only by agents still reads as a people gap.
 * A level the read did not answer is "Not recorded", never 0. While the route
 * is off the card is not drawn: the People and agents tab says nothing about
 * coverage it has not read.
 */

export function CoverageTable({ axes }) {
  const rows = coverageRows(axes);
  const summary = coverageSummary(rows);
  return (
    <div className="flex flex-col gap-2" data-testid="team-coverage">
      <p className="m-0 text-[13px] leading-[1.5] text-axal-ink dark:text-gray-200">{summary ? <b>{summary}</b> : 'Every category with an agent on it also has a person on it.'}</p>
      <div role="table" aria-label="Team coverage" className="flex flex-col">
        <div role="row" className="hidden grid-cols-[150px_120px_130px_minmax(0,1fr)] gap-2.5 border-b border-axal-hairline pb-1.5 dark:border-gray-800 md:grid">
          {['Category', 'People', 'Agent', ''].map((c, i) => <span key={i} role="columnheader" className="font-mono text-[11px] uppercase tracking-[.11em] text-axal-muted dark:text-gray-400">{c}</span>)}
        </div>
        {rows.map((r) => (
          <div key={r.slug} role="row" className="grid grid-cols-2 items-center gap-2.5 border-t border-axal-hairline py-1.5 text-[12.5px] first-of-type:border-t-0 dark:border-gray-800 md:grid-cols-[150px_120px_130px_minmax(0,1fr)]" data-testid={`coverage-${r.slug}`}>
            <span role="cell" className="font-semibold text-axal-ink dark:text-gray-100">{r.label}</span>
            <span role="cell" className="text-axal-ink dark:text-gray-200">{r.people || <span className="text-axal-muted dark:text-gray-400">Not recorded</span>}</span>
            <span role="cell" className="text-axal-ink dark:text-gray-200">{r.agent ? `Agent · ${r.agent}` : <span className="text-axal-muted dark:text-gray-400">—</span>}</span>
            <span role="cell">{r.peopleGap ? <span className="inline-flex rounded-axal-pill border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200" data-testid="coverage-gap">People gap · covered only by agents</span> : null}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TeamCoverageCard({ kind, id }) {
  const [block, setBlock] = useState(null);
  const load = () => { setBlock(null); agents.coverage(kind, id).then(setBlock); };
  useEffect(() => { let alive = true; agents.coverage(kind, id).then((b) => { if (alive) setBlock(b); }); return () => { alive = false; }; }, [kind, id]);
  if (!block || (!block.available && !block.unreadable)) return null;
  return (
    <TeamCard title="Team coverage" aside={<span className={MUTED}>People and agents on the same eight categories</span>} testId="team-coverage-card">
      {block.available ? <CoverageTable axes={block.value?.axes} />
        : <HonestBlock role="alert" action={<button type="button" className={`w-fit ${BTN_TEXT}`} onClick={load}>Try again</button>}>Team coverage could not be read.</HonestBlock>}
    </TeamCard>
  );
}
