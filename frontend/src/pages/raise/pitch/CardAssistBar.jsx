import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { deckAssistApi } from '../../../lib/api/deckAssist';
import { railProposalsApi } from '../../../lib/api/railProposals';
import { railPressHeaders } from '../../../lib/railPage';
import { reportError } from '../../../lib/log';
import useAssistMode from '../../../hooks/useAssistMode';
import { useRailOption } from '../../../ui/railCrumbs';
import { aiTokens, refusalOf } from './newDeckModel';
import {
  AI_OFF_LINE, INSTRUCTION_MAX, LANGUAGES, TEXT_TOOLS, TONES, blockRefusal, textBody, textProposal,
} from './deckAssistModel';
import { COST, EYE, FIELD, GHOST, MUTED, PressDialog, RefusalLine, TextProposal, TokensDialog } from './AssistParts';

/**
 * D899 (#2678, part 5 of #2434) — PD7's selection bar under the selected text
 * block: Rewrite, Shorten, Expand, Change tone, Translate and Ask. Each press
 * asks for a quote and shows its cost first (`PressDialog`); Run is charged to
 * the founder who pressed and leaves a proposal (D780), drawn with the before
 * struck and the after on lavender. Accept places the words on the card;
 * Save writes the version. A figure bound to a record takes no tool, and with
 * AI assistance off on the page the bar is greyed with the sentence that says
 * so. Mounted by `PitchEditor.jsx`.
 */
export default function CardAssistBar({ deckId, cardIndex, block, items, onPlace }) {
  const [on] = useAssistMode('raise');
  const [off, setOff] = useState(false);
  const [tone, setTone] = useState(TONES[0][0]);
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [instruction, setInstruction] = useState('');
  const [press, setPress] = useState(null);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [placeError, setPlaceError] = useState(null);

  const action = press?.action || null;
  useRailOption(busy ? ({ rewrite: 'deck:rewrite', ask: 'deck:rewrite', shorten: 'deck:shorten', expand: 'deck:expand', tone: 'deck:tone', translate: 'deck:translate' })[action] : null, press?.label);

  const aiOff = !on || off;
  const why = blockRefusal(block, items);
  const extra = { tone, language, instruction };

  // PD7: each tool shows its cost on the bar. A quote runs nothing and charges nothing.
  const [costs, setCosts] = useState({});
  const text = block?.text ?? '';
  useEffect(() => {
    setCosts({});
    if (!block || aiOff || why) return undefined;
    let live = true;
    for (const tool of TEXT_TOOLS.filter((t) => t.action !== 'ask')) {
      deckAssistApi.quote(deckId, cardIndex, textBody(tool.action, block, { tone: TONES[0][0], language: LANGUAGES[0] })).then(
        (q) => { if (live && q?.ai) setCosts((c) => ({ ...c, [tool.action]: aiTokens(q.hold_microusd) })); },
        () => {},
      );
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, cardIndex, block?.id, text, aiOff, why]);

  const open = (tool) => {
    if (tool.action === 'ask' && !instruction.trim()) return;
    setPress(tool); setQuote(null); setRefusal(null); setPlaceError(null);
    deckAssistApi.quote(deckId, cardIndex, textBody(tool.action, block, extra)).then(
      (q) => { setQuote(q); if (q?.ai === false && q.reason === 'assist_off') setOff(true); },
      (e) => { setQuote({ ai: false, message: refusalOf(e)?.message }); setRefusal(refusalOf(e)); },
    );
  };
  const close = () => { setPress(null); setQuote(null); setRefusal(null); };

  const run = () => {
    setBusy(true); setRefusal(null);
    deckAssistApi.run(deckId, cardIndex, textBody(action, block, extra), railPressHeaders(press.option)).then(
      (r) => { setBusy(false); setProposal({ ...textProposal(r), blockId: block.id }); close(); },
      (e) => {
        setBusy(false);
        const r = refusalOf(e);
        if (e?.status === 402 && r?.topUp) { setTokens(r); close(); return; }
        if (r?.code === 'assist_off') setOff(true);
        setRefusal(r);
        reportError('pitch-assist:run', e);
      },
    );
  };

  const decide = (decision) => {
    setDeciding(true); setPlaceError(null);
    railProposalsApi.decide(proposal.uid, decision).then(
      () => {
        setDeciding(false);
        if (decision === 'accept') onPlace(proposal.blockId, proposal.after);
        setProposal(null);
      },
      (e) => {
        setDeciding(false);
        if (decision === 'discard') { setProposal(null); return; }
        setPlaceError(refusalOf(e));
        reportError('pitch-assist:decide', e);
      },
    );
  };

  if (!block) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="pitch-assist-bar">
      <div className={`flex flex-wrap items-center gap-1.5 rounded-[10px] border border-axal-hairline bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900 ${aiOff ? 'opacity-60' : ''}`}
        role="toolbar" aria-label="Eadwyn on this block" aria-disabled={aiOff || Boolean(why)}>
        <span className={`${EYE} flex items-center gap-1 px-1`}><Sparkles size={12} aria-hidden="true" /> Eadwyn</span>
        {TEXT_TOOLS.map((tool) => (
          <span key={tool.action} className="flex items-center gap-1">
            {tool.action === 'tone' ? (
              <select className={FIELD} value={tone} onChange={(e) => setTone(e.target.value)} disabled={aiOff || Boolean(why)} aria-label="Tone" data-testid="pitch-assist-tone-choice">
                {TONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : null}
            {tool.action === 'translate' ? (
              <select className={FIELD} value={language} onChange={(e) => setLanguage(e.target.value)} disabled={aiOff || Boolean(why)} aria-label="Language" data-testid="pitch-assist-language-choice">
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            ) : null}
            {tool.action === 'ask' ? (
              <input className={`${FIELD} w-[180px]`} value={instruction} maxLength={INSTRUCTION_MAX} placeholder="Ask Eadwyn to change it…"
                onChange={(e) => setInstruction(e.target.value)} disabled={aiOff || Boolean(why)} aria-label="Ask Eadwyn" data-testid="pitch-assist-instruction" />
            ) : null}
            <button type="button" className={GHOST} disabled={aiOff || Boolean(why) || (tool.action === 'ask' && !instruction.trim())}
              onClick={() => open(tool)} data-testid={`pitch-assist-${tool.action}`}>
              {tool.label} <span className={COST} data-testid={`pitch-assist-${tool.action}-cost`}>· {costs[tool.action] ? `up to ${costs[tool.action]}` : tool.action === 'ask' ? 'cost before it runs' : '…'}</span>
            </button>
          </span>
        ))}
      </div>
      {aiOff ? <span className={MUTED} data-testid="pitch-assist-off">{AI_OFF_LINE}</span> : null}
      {!aiOff && why ? <span className={MUTED} data-testid="pitch-assist-why">{why}</span> : null}

      {proposal ? (
        <>
          <TextProposal proposal={proposal} busy={deciding} onAccept={() => decide('accept')} onDiscard={() => decide('discard')} testId="pitch-assist-proposal" />
          <RefusalLine refusal={placeError} testId="pitch-assist-place-error" />
        </>
      ) : null}

      {press ? (
        <PressDialog title={`${press.label} with Eadwyn?`} testId="pitch-assist-dialog" quote={quote} busy={busy} refusal={refusal}
          sentence={press.action === 'ask' ? `Eadwyn changes this block's words as you asked: “${instruction.trim()}”.` : `Eadwyn proposes new words for this block (${press.label.toLowerCase()}).`}
          onRun={run} onClose={close} />
      ) : null}
      {tokens ? <TokensDialog refusal={tokens} onClose={() => setTokens(null)} /> : null}
    </div>
  );
}
