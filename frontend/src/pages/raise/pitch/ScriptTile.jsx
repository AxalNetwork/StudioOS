import React from 'react';
import { useSearchParams } from 'react-router-dom';
import QuestionsTab from './QuestionsTab';
import RehearsalsTab from './RehearsalsTab';
import { SCRIPT_VIEWS, viewOf } from './scriptTileModel';

/**
 * D4254 Script & rehearsal (/raise/pitch/script): its three views, as ps4,
 * ps4b and ps4c's tab list draws them, picked by `?view=` so each has an
 * address. D4270 (#4270, P2c) draws Likely questions and Rehearsals; the
 * Script view is P2a's (#4268), and until it lands it draws what `script`
 * passes (P1's truthful "coming" block).
 */
const TAB = 'rounded-[7px] px-3 py-1.5 text-[12.5px] font-bold';
const ON = `${TAB} bg-white text-axal-ink shadow-sm dark:bg-gray-900 dark:text-gray-100`;
const OFF = `${TAB} text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100`;

export default function ScriptTile({ deck, readOnly, script }) {
  const [params, setParams] = useSearchParams();
  const view = viewOf(params.get('view'));
  const pick = (id) => setParams((old) => {
    const next = new URLSearchParams(old);
    if (id === 'script') next.delete('view'); else next.set('view', id);
    return next;
  });
  return (
    <div className="flex flex-col gap-4" data-testid="pitch-script-tile" data-view={view}>
      <div role="tablist" aria-label="Script and rehearsal"
        className="inline-flex gap-0.5 self-start rounded-[10px] border border-axal-hairline bg-axal-ground p-[3px] dark:border-gray-700 dark:bg-gray-800">
        {SCRIPT_VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={v.id === view} className={v.id === view ? ON : OFF}
            onClick={() => pick(v.id)} data-testid={`pitch-script-view-${v.id}`}>{v.label}</button>
        ))}
      </div>
      {view === 'questions' ? <QuestionsTab deckId={deck?.id ?? null} deckTitle={deck?.title} version={deck?.version ?? null} readOnly={readOnly} />
        : view === 'rehearsals' ? <RehearsalsTab deckId={deck?.id ?? null} deckTitle={deck?.title} />
          : script}
    </div>
  );
}
