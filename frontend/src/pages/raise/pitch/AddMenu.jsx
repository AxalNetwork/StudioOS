import React, { useEffect, useState } from 'react';
import { BarChart3, Image as ImageIcon, LayoutGrid, Palette, Plug, Plus, Type } from 'lucide-react';
import { deckAssistApi } from '../../../lib/api/deckAssist';
import { publicPricingApi } from '../../../lib/api/publicPricing';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import useAssistMode from '../../../hooks/useAssistMode';
import { useRailOption } from '../../../ui/railCrumbs';
import { aiTokens, refusalOf } from './newDeckModel';
import { addBlock, firstFree } from './editorModel';
import { ADD_ITEMS, AI_OFF_LINE, CHART_TOOLS, FREE_LINE, chartProposal, railModelRows } from './deckAssistModel';
import { COST, EYE, GHOST, INK, LAV, MUTED, PRIMARY, PressDialog, RefusalLine, TokensDialog } from './AssistParts';
import ConnectorLightbox from './ConnectorLightbox';

const ICONS = { text: Type, chart: BarChart3, image: ImageIcon, background: Palette, connector: Plug, layout: LayoutGrid };

/**
 * D899 (#2678, part 5 of #2434) — PD7's Add menu on the card: Text, Chart,
 * Image, Background, From a connector and Layout.
 *
 *   Text, Image          the existing Add a block dialog (PD8c), on that kind
 *   Chart                Eadwyn picks which recorded figures to show as a
 *                        chart, a table or a timeline; code binds each series
 *                        to its source, so no number is typed. Cost first.
 *   Background, Layout   the Design panel (PD8)
 *   From a connector     PD9d's lightbox (`ConnectorLightbox`)
 *
 * The rail row (PD28) lists this page's models with their catalogue prices.
 * Mounted by `PitchEditor.jsx`.
 */
export default function AddMenu({ deckId, cardIndex, card, model, items, onBlock, onDesign, onPlace, onAddCard }) {
  const [on] = useAssistMode('raise');
  const [open, setOpen] = useState(false);
  const [charts, setCharts] = useState(false);
  const [connector, setConnector] = useState(false);
  const [press, setPress] = useState(null);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [placeError, setPlaceError] = useState(null);
  const [costs, setCosts] = useState({});
  const [catalogue, setCatalogue] = useState(null);

  useRailOption(busy ? ({ chart: 'deck:chart', table: 'deck:table', timeline: 'deck:timeline' })[press?.action] : null, press?.label);

  const heading = String(card?.title || '').trim();
  const body = (action) => ({ action, ...(heading ? { heading } : {}) });

  // The costs and the models are read when the chart tools open, not before.
  useEffect(() => {
    if (!charts) return undefined;
    let live = true;
    if (on) {
      for (const tool of CHART_TOOLS) {
        deckAssistApi.quote(deckId, cardIndex, body(tool.action)).then(
          (q) => { if (live && q?.ai) setCosts((c) => ({ ...c, [tool.action]: aiTokens(q.hold_microusd) })); },
          () => {},
        );
      }
    }
    publicPricingApi.aiModels().then((r) => { if (live) setCatalogue(r?.models || []); }, () => { if (live) setCatalogue([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charts, on, deckId, cardIndex]);

  const pick = (id) => {
    setOpen(false);
    if (id === 'text' || id === 'image') onBlock(id);
    else if (id === 'background' || id === 'layout') onDesign();
    else if (id === 'chart') setCharts(true);
    else if (id === 'connector') setConnector(true);
  };

  const start = (tool) => {
    setPress(tool); setQuote(null); setRefusal(null); setPlaceError(null);
    deckAssistApi.quote(deckId, cardIndex, body(tool.action)).then(setQuote,
      (e) => { setQuote({ ai: false, message: refusalOf(e)?.message }); setRefusal(refusalOf(e)); });
  };
  const close = () => { setPress(null); setQuote(null); setRefusal(null); };

  const run = () => {
    setBusy(true); setRefusal(null);
    deckAssistApi.run(deckId, cardIndex, body(press.action), railPressHeaders(press.option)).then(
      (r) => { setBusy(false); setProposal(chartProposal(r, press)); close(); },
      (e) => {
        setBusy(false);
        const r = refusalOf(e);
        if (e?.status === 402 && r?.topUp) { setTokens(r); close(); return; }
        setRefusal(r);
        reportError('pitch-assist:chart', e);
      },
    );
  };

  const accept = () => {
    const grid = firstFree(card, proposal.size.cols, proposal.size.rows, model);
    if (!grid) { setPlaceError({ message: `No free ${proposal.size.cols} × ${proposal.size.rows} range on this card. Remove a block, then accept.` }); return; }
    const r = addBlock(card, { ...proposal.block, grid }, model);
    if (r.error) { setPlaceError({ message: r.error }); return; }
    railProposalsApi.decide(proposal.uid, 'accept').then(
      () => { onPlace(r.card); setProposal(null); setCharts(false); },
      (e) => { setPlaceError(refusalOf(e)); reportError('pitch-assist:decide', e); },
    );
  };
  const discard = () => {
    railProposalsApi.decide(proposal.uid, 'discard').catch(() => {});
    setProposal(null);
  };

  const shown = (proposal?.block?.series || []).map((s) => s.label).join(', ');
  return (
    <div className="relative flex flex-col gap-2" data-testid="pitch-add-menu">
      <button type="button" className={GHOST} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} data-testid="pitch-add-menu-open">
        <Plus size={14} aria-hidden="true" /> Add
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 top-[38px] z-20 flex w-[220px] flex-col rounded-[10px] border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {ADD_ITEMS.map(({ id, label }) => {
            const Icon = ICONS[id];
            return (
              <button key={id} type="button" role="menuitem" className={`flex min-h-[36px] items-center gap-2 rounded-[8px] px-2.5 text-left text-[12.5px] ${INK} hover:bg-axal-ground dark:hover:bg-gray-800`}
                onClick={() => pick(id)} data-testid={`pitch-add-${id}`}>
                <Icon size={14} aria-hidden="true" /> {label}
              </button>
            );
          })}
        </div>
      ) : null}

      {charts ? (
        <div className={`${LAV} flex flex-col gap-2 p-3`} data-testid="pitch-add-charts">
          <span className={EYE}>From your records, chosen by Eadwyn</span>
          {!on ? <span className={MUTED} data-testid="pitch-add-off">{AI_OFF_LINE}</span> : null}
          <div className={`flex flex-wrap gap-1.5 ${on ? '' : 'opacity-60'}`}>
            {CHART_TOOLS.map((tool) => (
              <button key={tool.action} type="button" className={GHOST} disabled={!on} onClick={() => start(tool)} data-testid={`pitch-add-${tool.action}`}>
                {tool.label} <span className={COST} data-testid={`pitch-add-${tool.action}-cost`}>· {costs[tool.action] ? `up to ${costs[tool.action]}` : '…'}</span>
              </button>
            ))}
            <button type="button" className={GHOST} onClick={() => { setCharts(false); setProposal(null); }}>Close</button>
          </div>
          <span className={MUTED}>Eadwyn chooses which recorded figures to show. Each series is bound to its source, so its values come from your records. {FREE_LINE}</span>
          {proposal ? (
            <div className="flex flex-col gap-2 rounded-[8px] bg-white/70 p-2.5 dark:bg-violet-950/60" data-testid="pitch-add-proposal">
              <span className={EYE}>Proposed by Eadwyn{proposal.cost ? ` · ${proposal.cost}` : ''}</span>
              <span className={`text-[13px] ${INK}`}>{proposal.title ? `${proposal.title}: ` : ''}a {String(proposal.block.chart_type).replace(/_/g, ' ')} of {shown}.</span>
              <span className={MUTED}>Accept places it on the card. Nothing is a version until you save.</span>
              <div className="flex gap-2">
                <button type="button" className={PRIMARY} onClick={accept} data-testid="pitch-add-proposal-accept">Accept</button>
                <button type="button" className={GHOST} onClick={discard} data-testid="pitch-add-proposal-discard">Discard</button>
              </div>
              <RefusalLine refusal={placeError} testId="pitch-add-place-error" />
            </div>
          ) : null}
          <RailModels catalogue={catalogue} />
        </div>
      ) : null}

      {press ? (
        <PressDialog title={`${press.label}?`} testId="pitch-add-dialog" quote={quote} busy={busy} refusal={refusal}
          sentence={`Eadwyn chooses which of your recorded figures this ${press.action} shows. The values are read from your records, not written by Eadwyn.`}
          onRun={run} onClose={close} />
      ) : null}
      {tokens ? <TokensDialog refusal={tokens} onClose={() => setTokens(null)} /> : null}
      {connector ? (
        <ConnectorLightbox deckId={deckId} cardIndex={cardIndex} items={items} onClose={() => setConnector(false)}
          onAdd={(c) => { setConnector(false); onAddCard(c); }} />
      ) : null}
    </div>
  );
}

/** PD28: the models on this page's rail, priced from the catalogue. */
function RailModels({ catalogue }) {
  if (!catalogue) return <span className={MUTED}>Reading the models…</span>;
  return (
    <div className="flex flex-col gap-1" data-testid="pitch-add-models">
      <span className={EYE}>Models on this page</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {railModelRows(catalogue).map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]" data-testid={`pitch-add-model-${m.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`}>
            <b className={INK}>{m.name}</b>
            <span className={MUTED}>{m.role}</span>
            {m.price ? <span className={COST}>{m.price}</span> : null}
            {m.unrouted ? <span className={MUTED}>{m.unrouted}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
