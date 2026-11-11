import React, { useCallback, useEffect, useState } from 'react';
import AskIntent from '../../ui/AskIntent.jsx';
import { acceptAllLabel } from '../../ui/askPanelModel.js';
import { eventSyndicationApi } from '../../lib/api/eventSyndication.js';
import { railProposalsApi } from '../../lib/api/railProposals.js';
import {
  ASK_FOOT_SYNDICATION, ASK_PROPOSE, ASK_SYNDICATION, NOT_READ, SAVE_FAILED,
  askableRows, quoteLine, runCharge, runRefusal, savedChannels, syndicationCard,
} from './syndicationAskModel.js';

/**
 * D1493 (#3906, SY8) — the event editor's Other channels list, with Ask on
 * each listing the event keeps on: Eadwyn proposes the channel's title and
 * description as cards in the Ask panel (`AskIntent`). Accept, Edit and
 * Discard decide one card; "Accept all (n)" decides the open ones. An
 * accepted value is saved to the listing with the page's own
 * `PUT /api/events/:id/syndication`; posting still waits for Approve and
 * publish. No suggestion chips. `syndicationAskModel.js` holds the rules.
 *
 * `api` is for tests: { syndication, proposals } in place of the real clients.
 */
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const GHOST = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 max-sm:min-h-[44px]';
const NOTE = 'm-0 rounded-[10px] border px-3 py-2.5 text-[12.5px]';
const BAD = 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';

export default function SyndicationAsk({ eventId, api = null, onSaved = null }) {
  const syn = api?.syndication || eventSyndicationApi;
  const props = api?.proposals || railProposalsApi;
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [open, setOpen] = useState(null); // the row Ask is open on

  const load = useCallback(async () => {
    try { setRead({ status: 'ready', data: await syn.forEvent(eventId) }); } catch { setRead({ status: 'unreadable', data: null }); }
  }, [syn, eventId]);
  useEffect(() => { load(); }, [load]);

  if (read.status === 'unreadable') return <p className={`mt-2 text-xs text-red-700 dark:text-red-300`} role="alert" data-testid="syndication-ask-unreadable">{NOT_READ}</p>;
  const rows = askableRows(read.data);
  if (!rows.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="syndication-ask">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((r) => (
          <li key={r.uid} className="flex flex-wrap items-center justify-between gap-2 text-[13px]" data-testid={`syndication-ask-row-${r.account_uid}`}>
            <span className={INK}>{r.display_name || r.channel}</span>
            <button type="button" className={GHOST} onClick={() => setOpen(r)} data-testid={`syndication-ask-open-${r.account_uid}`}>{ASK_SYNDICATION}</button>
          </li>
        ))}
      </ul>
      {open ? (
        <AskCopy key={open.account_uid} eventId={eventId} row={open} syn={syn} proposals={props}
          onSaved={(data, values) => { setRead({ status: 'ready', data }); setOpen((askableRows(data).find((x) => x.account_uid === open.account_uid)) || open); onSaved?.(data, { eventId, row: data?.rows?.find((x) => x.account_uid === open.account_uid), fields: Object.keys(values) }); }}
          onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function AskCopy({ eventId, row, syn, proposals, onSaved, onClose }) {
  const name = row.display_name || row.channel;
  const [quote, setQuote] = useState(null);
  const [cards, setCards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { tone, title, line }
  const [editing, setEditing] = useState(null); // { uid, value }

  useEffect(() => {
    let live = true;
    syn.assistQuote(eventId, row.account_uid).then((q) => { if (live) setQuote(q); }, () => { if (live) setQuote({ ai: false, message: null }); });
    return () => { live = false; };
  }, [syn, eventId, row.account_uid]);

  const propose = async () => {
    setBusy(true); setNote(null);
    try {
      const got = await syn.assist(eventId, row.account_uid);
      setCards((got?.proposals || []).map(syndicationCard).filter((c) => c.field));
      setNote({ tone: 'plain', title: null, line: runCharge(got?.cost, quote) });
    } catch (e) {
      setNote({ tone: 'bad', ...runRefusal(e) });
    } finally { setBusy(false); }
  };

  // Decide each card, then save every value kept in one PUT on this listing.
  const keep = async (list, edited = null) => {
    setBusy(true); setNote(null);
    const values = {};
    const decided = new Map();
    for (const c of list) {
      const value = edited && edited.uid === c.uid ? edited.value : c.value;
      try {
        if (edited && edited.uid === c.uid) await proposals.decide(c.uid, 'edit', { ...c.payload, value });
        else await proposals.decide(c.uid, 'accept');
        values[c.field] = value;
        decided.set(c.uid, edited && edited.uid === c.uid ? 'edited' : 'accepted');
      } catch (e) {
        setNote({ tone: 'bad', ...runRefusal(e) });
      }
    }
    setCards((prev) => prev.map((c) => (decided.has(c.uid) ? { ...c, status: decided.get(c.uid), value: values[c.field] ?? c.value, text: values[c.field] ?? c.text } : c)));
    if (Object.keys(values).length) {
      try {
        onSaved(await syn.choose(eventId, savedChannels(row, values)), values);
      } catch {
        setNote({ tone: 'bad', title: SAVE_FAILED, line: null });
      }
    }
    setEditing(null);
    setBusy(false);
  };

  const discard = async (c) => {
    setBusy(true); setNote(null);
    try {
      await proposals.decide(c.uid, 'discard');
      setCards((prev) => prev.map((x) => (x.uid === c.uid ? { ...x, status: 'discarded' } : x)));
    } catch (e) { setNote({ tone: 'bad', ...runRefusal(e) }); }
    setBusy(false);
  };

  const openCards = cards.filter((c) => c.status === 'proposed');
  const all = acceptAllLabel(cards);
  return (
    <AskIntent label={`Copy for ${name}`} eyebrow="Ask Eadwyn" title={`Copy for ${name}`} onClose={onClose} testId="syndication-ask-panel"
      footer={<span className={`text-[11.5px] ${MUTED}`}>{ASK_FOOT_SYNDICATION}</span>}>
      <div className="flex flex-col gap-3">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {cards.map((c) => (
            <li key={c.uid} className="flex flex-col gap-1.5 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`syndication-card-${c.uid}`} data-status={c.status}>
              <span className="ead-ask-eyebrow">{c.eyebrow}</span>
              {editing?.uid === c.uid ? (
                <textarea className="w-full rounded-[8px] border border-axal-hairline bg-white p-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" rows={c.field === 'title' ? 2 : 6}
                  value={editing.value} onChange={(e) => setEditing({ uid: c.uid, value: e.target.value })} aria-label={`Edit the ${c.eyebrow.toLowerCase()}`} data-testid={`syndication-card-input-${c.uid}`} />
              ) : (
                <span className={`whitespace-pre-wrap text-[13px] ${INK}`}>{c.text}</span>
              )}
              {c.source ? <span className={`text-[11.5px] ${MUTED}`}>{c.source}</span> : null}
              {c.status === 'proposed' ? (
                <span className="flex flex-wrap gap-2">
                  {editing?.uid === c.uid ? (
                    <>
                      <button type="button" className={GHOST} disabled={busy || !editing.value.trim()} onClick={() => keep([c], editing)} data-testid={`syndication-card-save-${c.uid}`}>Save</button>
                      <button type="button" className={GHOST} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className={GHOST} disabled={busy} onClick={() => keep([c])} aria-label={`Accept the ${c.eyebrow.toLowerCase()}`} data-testid={`syndication-card-accept-${c.uid}`}>Accept</button>
                      <button type="button" className={GHOST} disabled={busy} onClick={() => setEditing({ uid: c.uid, value: c.value })} aria-label={`Edit the ${c.eyebrow.toLowerCase()}`} data-testid={`syndication-card-edit-${c.uid}`}>Edit</button>
                      <button type="button" className={GHOST} disabled={busy} onClick={() => discard(c)} aria-label={`Discard the ${c.eyebrow.toLowerCase()}`} data-testid={`syndication-card-discard-${c.uid}`}>Discard</button>
                    </>
                  )}
                </span>
              ) : (
                <span className={`text-[11.5px] ${MUTED}`}>{c.status === 'discarded' ? 'Discarded' : 'Accepted · saved to this channel'}</span>
              )}
            </li>
          ))}
        </ul>
        {all ? <button type="button" className={`${GHOST} self-start`} disabled={busy} onClick={() => keep(openCards)} data-testid="syndication-accept-all">{all}</button> : null}
        {note ? (
          <div role={note.tone === 'bad' ? 'alert' : 'status'} className={note.tone === 'bad' ? `${NOTE} ${BAD}` : `text-[12px] ${MUTED}`} data-testid="syndication-ask-note">
            {note.title ? <b className="block">{note.title}</b> : null}{note.line}
          </div>
        ) : null}
        <div className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-800">
          <button type="button" className={`${GHOST} self-start`} disabled={busy || quote?.ai === false} onClick={propose} data-testid="syndication-ask-run">
            {busy ? 'Eadwyn is reading…' : ASK_PROPOSE}
          </button>
          <span className={`text-[11.5px] ${MUTED}`} data-testid="syndication-ask-cost">{quoteLine(quote)}</span>
        </div>
      </div>
    </AskIntent>
  );
}
