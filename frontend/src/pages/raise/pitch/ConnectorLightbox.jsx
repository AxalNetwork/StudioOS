import React, { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { deckAssistApi } from '../../../lib/api/deckAssist';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import useAssistMode from '../../../hooks/useAssistMode';
import { Lightbox } from '../../../ui';
import { useRailOption } from '../../../ui/railCrumbs';
import { aiTokens, numberIn, refusalOf } from './newDeckModel';
import { AI_OFF_LINE, FREE_LINE, connectorCard, connectorGroups, costLine, syncLine } from './deckAssistModel';
import { COST, EYE, FIELD, GHOST, INK, MUTED, PRIMARY, RefusalLine, TextProposal, TokensDialog } from './AssistParts';

const MAX_TILES = 4;

/**
 * D899 (#2678, part 5 of #2434) — PD9d, "From a connector": each connected
 * integration with its state and last sync (`GET /api/integrations`), and
 * the recorded figures it feeds, grouped by connector. The chosen figures
 * become a new card of metric tiles, each bound to its source: free, and no
 * number is typed. The headline is the founder's, or Eadwyn's with its cost
 * shown first (`deck:rewrite`, action `headline`), and it may name no figure.
 * Opened from `AddMenu.jsx`.
 */
export default function ConnectorLightbox({ deckId, cardIndex, items, onClose, onAdd }) {
  const [on] = useAssistMode('raise');
  const [integrations, setIntegrations] = useState({ status: 'loading', data: [] });
  const [tick, setTick] = useState(0);
  const [chosen, setChosen] = useState([]);
  const [headline, setHeadline] = useState('');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [proposal, setProposal] = useState(null);

  useRailOption(busy ? 'deck:rewrite' : null, 'Headline');

  useEffect(() => {
    let live = true;
    setIntegrations({ status: 'loading', data: [] });
    api.integrationsList().then(
      (r) => { if (live) setIntegrations({ status: 'ok', data: r?.items || [] }); },
      (e) => { if (live) setIntegrations({ status: 'error', data: [] }); reportError('pitch-connector:integrations', e); },
    );
    return () => { live = false; };
  }, [tick]);

  const keys = chosen.map((i) => i.source_key);
  // The headline's cost, read again as the figures change. A quote runs nothing.
  useEffect(() => {
    setQuote(null);
    if (!on || !keys.length) return undefined;
    let live = true;
    deckAssistApi.quote(deckId, cardIndex, { action: 'headline', source_keys: keys }).then(
      (q) => { if (live) setQuote(q); },
      (e) => { if (live) setQuote({ ai: false, message: refusalOf(e)?.message }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, deckId, cardIndex, keys.join('|')]);

  const groups = connectorGroups(integrations.data, items);
  const toggle = (item) => setChosen((cs) => (cs.some((c) => c.source_key === item.source_key)
    ? cs.filter((c) => c.source_key !== item.source_key)
    : cs.length >= MAX_TILES ? cs : [...cs, item]));

  const write = () => {
    setBusy(true); setRefusal(null);
    deckAssistApi.run(deckId, cardIndex, { action: 'headline', source_keys: keys }, railPressHeaders('deck:rewrite')).then(
      (r) => { setBusy(false); setProposal({ uid: r.proposal?.uid, before: headline || 'No headline yet', after: String(r.after || ''), cost: aiTokens(r.cost?.charged_microusd) }); },
      (e) => {
        setBusy(false);
        const r = refusalOf(e);
        if (e?.status === 402 && r?.topUp) { setTokens(r); return; }
        setRefusal(r);
        reportError('pitch-connector:headline', e);
      },
    );
  };
  const decide = (decision) => {
    const p = proposal;
    setProposal(null);
    if (decision === 'accept') setHeadline(p.after);
    if (p?.uid) railProposalsApi.decide(p.uid, decision).catch((e) => reportError('pitch-connector:decide', e));
  };

  const figure = numberIn(headline);
  const canAdd = chosen.length > 0 && !figure;
  return (
    <Lightbox label="From a connector" title="From a connector" width={680} onClose={() => !busy && onClose()} testId="pitch-connector"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <span className={`${MUTED} mr-auto`}>{chosen.length ? `${chosen.length} of ${MAX_TILES} figures on a new card. ${FREE_LINE}` : `Choose up to ${MAX_TILES} figures. ${FREE_LINE}`}</span>
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} disabled={!canAdd || busy} onClick={() => onAdd(connectorCard(chosen, headline))} data-testid="pitch-connector-add">Add card</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        {integrations.status === 'loading' ? <span className={MUTED}>Reading your connectors…</span> : null}
        {integrations.status === 'error' ? (
          <span role="alert" className={MUTED} data-testid="pitch-connector-error">
            Your connectors could not be read. <button type="button" className="font-bold underline" onClick={() => setTick((t) => t + 1)}>Try again</button>
          </span>
        ) : null}
        {integrations.status === 'ok' && !groups.length ? (
          <span className={MUTED} data-testid="pitch-connector-none">No connector is linked yet. Connect GitHub, Stripe or Mercury in Integrations, and their figures appear here.</span>
        ) : null}
        {groups.map((g) => (
          <section key={g.uid} className="flex flex-col gap-1.5" data-testid={`pitch-connector-group-${g.provider}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <b className={`text-[13px] ${INK}`}>{g.name}</b>
              <span className={MUTED} data-testid={`pitch-connector-sync-${g.provider}`}>{syncLine(g)}</span>
              {g.error ? <span className="text-[12px] text-amber-700 dark:text-amber-300">{g.error}</span> : null}
            </div>
            {g.items.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {g.items.map((i) => {
                  const picked = keys.includes(i.source_key);
                  return (
                    <li key={i.source_key}>
                      <label className={`flex min-h-[36px] items-center gap-2 rounded-[8px] px-2 text-[12.5px] ${INK} hover:bg-axal-ground dark:hover:bg-gray-800`}>
                        <input type="checkbox" checked={picked} disabled={!picked && chosen.length >= MAX_TILES} onChange={() => toggle(i)} data-testid={`pitch-connector-item-${i.source_key}`} />
                        <span className="flex-1">{i.label}</span>
                        <span className={MUTED}>{i.grade || 'Recorded'}{i.as_of ? ` · as of ${i.as_of}` : ''}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : <span className={MUTED}>Nothing from {g.name} is recorded on a deck figure yet.</span>}
          </section>
        ))}

        <div className="flex flex-col gap-1.5">
          <span className={EYE}>Headline</span>
          <input className={`${FIELD} w-full`} value={headline} maxLength={120} placeholder="What the card says, in words" onChange={(e) => setHeadline(e.target.value)} aria-label="Headline" data-testid="pitch-connector-headline" />
          {figure ? <span className="text-[12px] font-semibold text-axal-destructive dark:text-red-400" role="alert" data-testid="pitch-connector-figure">Figures come from your records, never from the headline. Take the figure out; the tiles carry it.</span> : null}
          <div className={`flex flex-wrap items-center gap-2 ${on ? '' : 'opacity-60'}`}>
            <button type="button" className={GHOST} disabled={!on || !keys.length || busy || !quote?.ai} onClick={write} data-testid="pitch-connector-write">
              {busy ? 'Writing…' : 'Write it with Eadwyn'}
            </button>
            <span className={COST} data-testid="pitch-connector-cost">{!on ? AI_OFF_LINE : keys.length ? costLine(quote) : 'Choose a figure first.'}</span>
          </div>
          <RefusalLine refusal={refusal} testId="pitch-connector-refusal" />
          {proposal ? <TextProposal proposal={proposal} onAccept={() => decide('accept')} onDiscard={() => decide('discard')} testId="pitch-connector-proposal" /> : null}
        </div>
      </div>
      {tokens ? <TokensDialog refusal={tokens} onClose={() => setTokens(null)} /> : null}
    </Lightbox>
  );
}
