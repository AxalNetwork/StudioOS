import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useEscapeClose } from '../components/useEscapeClose';
import { askPanelAdapter } from './askPanelAdapter.js';
import { setAskSlot, useAskPanel } from './eadwynPanel.js';
import {
  ASK_FOOT, ASK_RUNNING, ASK_SUGGESTED, ASK_PLACEHOLDER, acceptAllLabel, canSend, chargeLine, costLine,
  panelChips, proposalCard, refusalState, stateBlock,
} from './askPanelModel.js';
import { FOUNDER_ASK_CHIPS } from '../lib/railOptions/founder.js';
import { ADVISOR_ASK_CHIPS } from '../lib/railOptions/advisor.js';
import './askPanel.css';

/**
 * D1443 (#3706, canvas AK) — THE ASK PANEL.
 *
 * One Eadwyn panel for every page with an AIRail, opened by the page's Ask
 * button (`ui/AskButton.jsx`'s `PageAsk`). It replaces nothing on the page and
 * holds nothing the rail holds: the AIRail keeps model choice, consumption and
 * the AI switch (the owner, 2026-10-31); asking happens here.
 *
 * WHERE IT SITS is `WorkerRail`'s call (the `layout` prop, `askLayout`): docked
 * to the rail's left edge inside the rail's own column from 1024px, so it can
 * never pass the header above or the footer below; over the content from 640px;
 * a bottom sheet below that. Docked it is `complementary` and not modal, so the
 * page stays usable; as a sheet it is a modal dialog.
 *
 * WHAT IT DRAWS, top to bottom (AK2 to AK15): the head, the page's suggested
 * chips, the conversation with proposal cards, and the composer with the cost
 * line before Send and "Nothing is written until you accept." Every read and
 * write goes through `askPanelAdapter.js`; the two the Worker does not answer
 * yet (the pre-run quote and the "N waiting" count, D1442) are off there.
 */
const CHIP_ROUTES = Object.fromEntries([...FOUNDER_ASK_CHIPS, ...ADVISOR_ASK_CHIPS].map((c) => [c.key, c.route]));

export default function AskPanel({ page, label, crumb, options = [], aiOn = true, layout = 'dock', onClose }) {
  const intent = useAskPanel().intent;
  const [convUid, setConvUid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [cards, setCards] = useState([]);
  const [run, setRun] = useState(null);
  const [state, setState] = useState(aiOn ? 'ok' : 'off');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [hold, setHold] = useState(null);
  const inputRef = useRef(null);
  const chips = panelChips(options);
  const modal = layout === 'sheet';
  const name = label || page || 'this page';

  useEscapeClose(() => onClose?.('escape'), { active: true });
  useEffect(() => { inputRef.current?.focus?.(); }, []);
  useEffect(() => { setState(aiOn ? 'ok' : 'off'); }, [aiOn]);

  // The page's own thread: its conversation (keyed by the rail's page key) and
  // the open proposals of its run chips.
  useEffect(() => {
    let live = true;
    setConvUid(null); setMessages([]); setCards([]); setRun(null);
    if (!page) return undefined;
    (async () => {
      try {
        const list = await askPanelAdapter.conversations(page);
        const uid = list.data?.conversations?.[0]?.uid ?? null;
        if (!live || !uid) return;
        setConvUid(uid);
        const one = await askPanelAdapter.conversation(uid);
        if (live) setMessages(Array.isArray(one.data?.messages) ? one.data.messages : []);
      } catch { /* an unread thread starts empty; asking starts a new one */ }
      for (const c of chips.filter((x) => x.run)) {
        try {
          const got = await askPanelAdapter.proposals(c.key);
          if (live) setCards((prev) => [...prev, ...(got.data?.proposals || []).map((r) => ({ ...proposalCard(r), option: c.key }))]);
        } catch { /* the chip still runs; its old cards are not shown */ }
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // D1442's quote: off until the Worker answers, so the line says the hold is
  // not shown rather than inventing one.
  useEffect(() => {
    let live = true;
    askPanelAdapter.quote(convUid, text).then((q) => { if (live) setHold(q.available ? q.data?.hold_microusd ?? null : null); });
    return () => { live = false; };
  }, [convUid, text]);

  const send = useCallback(async (question) => {
    const q = String(question ?? text).trim();
    if (!canSend({ text: q, state, busy })) return;
    setBusy(true); setState('ok');
    try {
      let uid = convUid;
      if (!uid) {
        const started = await askPanelAdapter.start(page);
        uid = started.data?.conversation?.uid ?? null;
        setConvUid(uid);
      }
      if (!uid) throw Object.assign(new Error('no conversation'), { code: 'unreadable' });
      const res = await askPanelAdapter.ask(uid, q, page);
      const answer = res.data?.answer;
      if (!answer) throw Object.assign(new Error('no answer'), { code: 'unreadable' });
      setMessages((m) => [...m, { id: `u${m.length}`, role: 'user', content: q }, { id: `a${m.length}`, role: 'assistant', content: answer }]);
      setText('');
    } catch (err) {
      setState(refusalState(err));
    } finally {
      setBusy(false);
    }
  }, [busy, convUid, page, state, text]);

  const runChip = useCallback(async (key) => {
    if (busy || state === 'tok' || state === 'paused' || state === 'off') return;
    setBusy(true); setState('ok'); setRun({ key });
    try {
      const events = (await askPanelAdapter.run(page, key)).data || [];
      const done = events.find((e) => e.event === 'done')?.data || {};
      const got = await askPanelAdapter.proposals(key);
      const fresh = (got.data?.proposals || []).map((r) => ({ ...proposalCard(r), option: key }));
      setCards((prev) => [...prev.filter((c) => c.option !== key), ...fresh]);
      setRun({ key, charged: done.charged_microusd ?? null, hold: done.hold_microusd ?? null });
      if (!fresh.length) setState('none');
    } catch (err) {
      setState(refusalState(err));
      setRun(null);
    } finally {
      setBusy(false);
    }
  }, [busy, page, state]);

  const decide = useCallback(async (card, decision) => {
    try {
      await askPanelAdapter.decide(card.uid, decision);
      setCards((prev) => prev.map((c) => (c.uid === card.uid ? { ...c, status: decision === 'discard' ? 'discarded' : 'accepted' } : c)));
    } catch (err) {
      setState(refusalState(err));
    }
  }, []);

  const block = stateBlock(state);
  const open = cards.filter((c) => c.status === 'proposed');
  const all = acceptAllLabel(cards);
  const sendOk = canSend({ text, state, busy });

  return (
    <section
      className="ead-ask"
      data-layout={layout}
      role={modal ? 'dialog' : 'complementary'}
      {...(modal ? { 'aria-modal': 'true' } : {})}
      aria-label={`Eadwyn · ${name}`}
      data-testid="ask-panel"
    >
      {modal && <span className="ead-ask-grip" aria-hidden="true" />}
      <header className="ead-ask-head">
        <img src="/eadwyn-ai.png" alt="" width="22" height="22" className={state === 'paused' ? 'ead-ask-mark is-grey' : 'ead-ask-mark'} />
        <span className="ead-ask-title">
          <b>{name}</b>
          <span className="ead-ask-eyebrow">{`Eadwyn · ${crumb || name}`}</span>
        </span>
        <button type="button" className="ead-ask-close" aria-label="Close Eadwyn" onClick={() => onClose?.('close')} data-testid="ask-panel-close">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="ead-ask-body">
        {/* D1443 part 4 (#3992): a page's own task (a form's Sources and Preview, a module's row proposals) is drawn here, by its host's AskIntent. */}
        {intent ? <div ref={setAskSlot} className="ead-ask-intent" data-testid="ask-panel-intent" /> : null}
        {chips.length > 0 && (
          <div className="ead-ask-chips" data-testid="ask-panel-chips">
            <span className="ead-ask-eyebrow">{ASK_SUGGESTED}</span>
            <div className="ead-ask-chip-row">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="ead-ask-chip"
                  data-run={c.run ? 'true' : 'false'}
                  disabled={busy || state === 'tok' || state === 'paused' || state === 'off'}
                  onClick={() => (c.run ? runChip(c.key) : setText(c.label))}
                  data-testid={`ask-chip-${c.key}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ead-ask-log" role="log" aria-label="Conversation" data-testid="ask-panel-log">
          {messages.map((m) => (m.role === 'user'
            ? <p key={m.id} className="ead-ask-you">{m.content}</p>
            : (
              <div key={m.id} className="ead-ask-said">
                <span className="ead-ask-who"><img src="/eadwyn-ai.png" alt="" width="16" height="16" />Eadwyn</span>
                <p>{m.content}</p>
              </div>
            )))}

          {open.length > 0 && (
            <div className="ead-ask-cards" data-testid="ask-panel-cards">
              {cards.map((c) => (
                <div key={c.uid} className="ead-ask-card" data-status={c.status} data-testid={`ask-card-${c.uid}`}>
                  <span className="ead-ask-card-head">
                    <span className="ead-ask-eyebrow is-violet">{c.eyebrow}</span>
                    {c.source && <span className="ead-ask-source">{c.source}</span>}
                  </span>
                  <span className="ead-ask-card-text">{c.text}</span>
                  {c.status === 'proposed' ? (
                    <span className="ead-ask-card-acts">
                      <button type="button" className="ead-ask-btn is-primary" onClick={() => decide(c, 'accept')}>Accept</button>
                      {CHIP_ROUTES[c.option] ? <a className="ead-ask-btn" href={CHIP_ROUTES[c.option]}>Edit</a> : null}
                      <button type="button" className="ead-ask-btn is-ghost" onClick={() => decide(c, 'discard')}>Discard</button>
                    </span>
                  ) : (
                    <span className="ead-ask-decided">{c.status === 'accepted' ? 'Accepted' : 'Discarded'}</span>
                  )}
                </div>
              ))}
              <span className="ead-ask-all">
                {all && (
                  <button type="button" className="ead-ask-btn is-primary" onClick={() => open.slice(0, 50).forEach((c) => decide(c, 'accept'))} data-testid="ask-accept-all">{all}</button>
                )}
                {run && <span className="ead-ask-mono" data-testid="ask-charge">{chargeLine(run.charged, run.hold)}</span>}
              </span>
            </div>
          )}

          {busy && (
            <div className="ead-ask-running" role="status" data-testid="ask-panel-running">
              <span className="ead-ask-spin" aria-hidden="true" />{ASK_RUNNING}
            </div>
          )}

          {block && (
            <div className="ead-ask-state" data-tone={block.tone} role={block.tone === 'red' ? 'alert' : 'status'} data-testid={`ask-state-${state}`}>
              <b>{block.title}</b>
              {block.line && <span>{block.line}</span>}
              {block.action?.href && <a className="ead-ask-btn is-primary" href={block.action.href}>{block.action.label}</a>}
              {block.action?.retry && <button type="button" className="ead-ask-btn" onClick={() => setState('ok')}>{block.action.label}</button>}
            </div>
          )}
        </div>
      </div>

      <form className="ead-ask-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={inputRef}
          className="ead-ask-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ASK_PLACEHOLDER(name)}
          aria-label={`Ask Eadwyn about ${name}`}
          maxLength={2000}
          rows={2}
          disabled={state === 'off' || state === 'paused'}
          data-testid="ask-panel-input"
        />
        <span className="ead-ask-send-row">
          <span className="ead-ask-mono" data-testid="ask-cost-line">{costLine(hold)}</span>
          <button type="submit" className="ead-ask-btn is-primary" disabled={!sendOk} data-testid="ask-panel-send">Send</button>
        </span>
        <span className="ead-ask-foot">{ASK_FOOT}</span>
      </form>
    </section>
  );
}
